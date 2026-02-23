import React, { useState, useMemo, useRef } from 'react';
import PropTypes from 'prop-types';
import { Trash2, Check } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { Heading, Text } from '../ui/Typography';
import FileIcon from '../ui/FileIcon';
import { useFileActions } from '../../hooks/useFileActions';
import { safeBasename } from '../../utils/pathUtils';
import { formatBytes } from '../../utils/format';
import { createLogger } from '../../../shared/logger';

const logger = createLogger('DuplicateResolutionModal');

/**
 * DuplicateResolutionModal
 *
 * A modal for resolving duplicate files.
 * Presents groups of duplicates and allows the user to select one to keep.
 */
export default function DuplicateResolutionModal({
  isOpen,
  onClose,
  duplicateGroups = [], // Array of groups ({ members: [] }) or file arrays
  onResolve // (resolutions) => Promise<void>  where resolutions is array of { keep: file, delete: [files] }
}) {
  // Map of groupIndex -> fileId (or path) to keep
  const [selections, setSelections] = useState({});
  const [isResolving, setIsResolving] = useState(false);
  const [resolveError, setResolveError] = useState(null);
  const { openFile, revealFile } = useFileActions();
  const prevIsOpenRef = useRef(false);
  const normalizedGroups = useMemo(
    () =>
      (Array.isArray(duplicateGroups) ? duplicateGroups : [])
        .map((group) => {
          const members = Array.isArray(group)
            ? group
            : Array.isArray(group?.members)
              ? group.members
              : [];
          const normalizedMembers = members
            .map((member) => {
              const resolvedPath =
                member?.path ||
                member?.filePath ||
                member?.metadata?.path ||
                member?.originalPath ||
                '';
              const resolvedId = member?.id || resolvedPath;
              return {
                ...member,
                id: resolvedId,
                path: resolvedPath,
                name:
                  member?.name ||
                  member?.fileName ||
                  member?.metadata?.name ||
                  safeBasename(resolvedPath || resolvedId || ''),
                size: Number(member?.size ?? member?.fileSize ?? member?.metadata?.size ?? 0)
              };
            })
            .filter((member) => Boolean(member.id));

          const similarity = Number(group?.averageSimilarity);
          return {
            id: group?.id,
            members: normalizedMembers,
            averageSimilarity: Number.isFinite(similarity)
              ? Math.max(0, Math.min(1, similarity))
              : null
          };
        })
        .filter((group) => group.members.length > 0),
    [duplicateGroups]
  );

  // Initialize selections only when isOpen transitions from false to true
  React.useEffect(() => {
    const wasOpen = prevIsOpenRef.current;
    prevIsOpenRef.current = isOpen;

    if (isOpen && !wasOpen && normalizedGroups.length > 0) {
      const initialSelections = {};
      normalizedGroups.forEach((group, index) => {
        if (group.members.length > 0) {
          // Default to the one with the shortest path (often the "original") or just the first
          // Simple heuristic: prefer shorter path length
          const sorted = [...group.members].sort(
            (a, b) => (a.path || '').length - (b.path || '').length
          );
          initialSelections[index] = sorted?.[0]?.path || sorted?.[0]?.id;
        }
      });
      setSelections(initialSelections);
    }
  }, [isOpen, normalizedGroups]);

  const handleSelectKeep = (groupIndex, filePath) => {
    setSelections((prev) => ({
      ...prev,
      [groupIndex]: filePath
    }));
  };

  const handleResolve = async () => {
    setIsResolving(true);
    setResolveError(null);
    try {
      const resolutions = [];
      normalizedGroups.forEach((group, index) => {
        const keepId = selections[index];
        if (!keepId) return;

        const keepFile = group.members.find((f) => (f.path || f.id) === keepId);
        const deleteFiles = group.members.filter((f) => (f.path || f.id) !== keepId);

        if (keepFile && deleteFiles.length > 0) {
          resolutions.push({
            keep: keepFile,
            delete: deleteFiles
          });
        }
      });

      await onResolve(resolutions);
      onClose();
    } catch (error) {
      logger.error('Failed to resolve duplicates', {
        error: error?.message,
        stack: error?.stack
      });
      setResolveError(error?.message || 'Failed to resolve duplicates');
    } finally {
      setIsResolving(false);
    }
  };

  const totalSavings = useMemo(() => {
    let bytes = 0;
    normalizedGroups.forEach((group, index) => {
      const keepId = selections[index];
      group.members.forEach((file) => {
        if ((file.path || file.id) !== keepId) {
          bytes += file.size || 0;
        }
      });
    });
    return bytes;
  }, [normalizedGroups, selections]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Resolve Duplicates"
      description={`Found ${normalizedGroups.length} sets of duplicates. Select which version to keep.`}
      size="xl"
      closeOnOverlayClick={!isResolving}
      closeOnEsc={!isResolving}
      closeDisabled={isResolving}
      footer={
        <>
          <Text as="div" variant="small" className="flex-1 text-system-gray-500">
            Potential savings:{' '}
            <Text as="span" variant="small" className="font-medium text-system-gray-900">
              {formatBytes(totalSavings)}
            </Text>
          </Text>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={isResolving}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={handleResolve}
            disabled={isResolving || normalizedGroups.length === 0}
            isLoading={isResolving}
            leftIcon={<Trash2 className="w-4 h-4" />}
          >
            Delete Duplicates
          </Button>
        </>
      }
    >
      <div className="flex flex-col h-[60vh] space-y-6 overflow-y-auto pr-2">
        {resolveError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
            {resolveError}
          </div>
        )}
        {normalizedGroups.map((group, groupIndex) => (
          <div
            key={group.id || groupIndex}
            className="bg-system-gray-50 rounded-xl p-4 border border-system-gray-100"
          >
            <div className="flex items-center justify-between mb-3">
              <Heading as="h4" variant="h6" className="text-system-gray-700">
                Duplicate Set {groupIndex + 1}
              </Heading>
              <div className="flex items-center gap-2">
                {Number.isFinite(group.averageSimilarity) && group.averageSimilarity < 1 && (
                  <Text
                    as="span"
                    variant="tiny"
                    className="inline-flex items-center px-2 py-0.5 rounded-md font-medium bg-amber-50 text-amber-700 border border-amber-100"
                  >
                    {Math.floor(group.averageSimilarity * 1000) / 10}% similar
                  </Text>
                )}
                <Text variant="small" className="text-system-gray-500">
                  {group.members.length} files • {formatBytes(group.members[0]?.size || 0)} each
                </Text>
              </div>
            </div>

            <div className="space-y-2">
              {group.members.map((file) => {
                const path = file.path || file.id;
                const isKept = selections[groupIndex] === path;

                return (
                  <div
                    key={path}
                    className={`
                      relative flex items-center gap-3 p-3 rounded-lg border transition-all
                      ${
                        isKept
                          ? 'bg-white border-stratosort-blue ring-1 ring-stratosort-blue shadow-sm z-10'
                          : 'bg-white/50 border-system-gray-200 hover:border-system-gray-300 opacity-70 hover:opacity-100'
                      }
                    `}
                    onClick={() => handleSelectKeep(groupIndex, path)}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isKept}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleSelectKeep(groupIndex, path);
                      }
                    }}
                  >
                    <div className="flex items-center justify-center w-6 h-6 shrink-0">
                      <input
                        type="radio"
                        name={`group-${groupIndex}`}
                        checked={isKept}
                        onChange={() => handleSelectKeep(groupIndex, path)}
                        className="text-stratosort-blue focus:ring-stratosort-blue"
                      />
                    </div>

                    <FileIcon
                      fileName={file.name || safeBasename(path)}
                      className="w-8 h-8 shrink-0"
                    />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Text
                          as="span"
                          variant="small"
                          className={`font-medium truncate ${isKept ? 'text-system-gray-900' : 'text-system-gray-600'}`}
                        >
                          {file.name || safeBasename(path)}
                        </Text>
                        {isKept && (
                          <Text
                            as="span"
                            variant="tiny"
                            className="inline-flex items-center px-1.5 py-0.5 rounded-md font-medium bg-stratosort-blue/10 text-stratosort-blue"
                          >
                            Keep
                          </Text>
                        )}
                        {!isKept && (
                          <Text
                            as="span"
                            variant="tiny"
                            className="inline-flex items-center px-1.5 py-0.5 rounded-md font-medium bg-red-50 text-red-600"
                          >
                            Delete
                          </Text>
                        )}
                      </div>
                      <Text
                        as="div"
                        variant="tiny"
                        className="text-system-gray-500 truncate font-mono"
                        title={path}
                      >
                        {path}
                      </Text>
                    </div>

                    <div className="flex gap-1">
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          openFile(path);
                        }}
                        title="Open File"
                      >
                        Open
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          revealFile(path);
                        }}
                        title="Show in Folder"
                      >
                        Reveal
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {normalizedGroups.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-system-gray-400">
            <Check className="w-12 h-12 mb-2 text-stratosort-success opacity-50" />
            <Text>No duplicates found!</Text>
          </div>
        )}
      </div>
    </Modal>
  );
}

DuplicateResolutionModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  duplicateGroups: PropTypes.array,
  onResolve: PropTypes.func.isRequired
};
