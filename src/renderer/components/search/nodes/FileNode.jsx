import React, { memo, useState, useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
import { Handle, Position, NodeToolbar } from 'reactflow';
import { ExternalLink, FolderOpen, Copy, GitBranch, Focus } from 'lucide-react';
import { useFileActions } from '../../../hooks';
import { useAppSelector } from '../../../store/hooks';
import { useNotification } from '../../../contexts/NotificationContext';
import { logger } from '../../../../shared/logger';
import FileIcon, { getFileCategory } from '../../ui/FileIcon';
import { IconButton } from '../../ui';
import { formatDisplayPath } from '../../../utils/pathDisplay';

const CATEGORY_STYLES = {
  Documents: {
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    text: 'text-blue-700',
    ring: 'ring-blue-100'
  },
  Spreadsheets: {
    bg: 'bg-green-50',
    border: 'border-green-200',
    text: 'text-green-700',
    ring: 'ring-green-100'
  },
  Presentations: {
    bg: 'bg-orange-50',
    border: 'border-orange-200',
    text: 'text-orange-700',
    ring: 'ring-orange-100'
  },
  Images: {
    bg: 'bg-purple-50',
    border: 'border-purple-200',
    text: 'text-purple-700',
    ring: 'ring-purple-100'
  },
  Videos: {
    bg: 'bg-pink-50',
    border: 'border-pink-200',
    text: 'text-pink-700',
    ring: 'ring-pink-100'
  },
  Audio: {
    bg: 'bg-cyan-50',
    border: 'border-cyan-200',
    text: 'text-cyan-700',
    ring: 'ring-cyan-100'
  },
  Code: {
    bg: 'bg-yellow-50',
    border: 'border-yellow-200',
    text: 'text-yellow-700',
    ring: 'ring-yellow-100'
  },
  Data: {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-700',
    ring: 'ring-amber-100'
  },
  Archives: {
    bg: 'bg-stone-50',
    border: 'border-stone-200',
    text: 'text-stone-700',
    ring: 'ring-stone-100'
  },
  Other: {
    bg: 'bg-system-gray-50',
    border: 'border-system-gray-200',
    text: 'text-system-gray-700',
    ring: 'ring-gray-100'
  }
};

const FileNode = memo(({ data, selected }) => {
  const [showActions, setShowActions] = useState(false);
  const { showError } = useNotification();
  const redactPaths = useAppSelector((state) => Boolean(state?.system?.redactPaths));
  const filePath = data?.path || '';
  const tags = Array.isArray(data?.tags) ? data.tags.slice(0, 3) : [];
  const suggestedFolder =
    typeof data?.suggestedFolder === 'string' ? data.suggestedFolder.trim() : '';
  const rawLabel = data?.label || filePath;
  const displayLabel = formatDisplayPath(rawLabel, { redact: redactPaths, segments: 2 });
  const displaySuggestedFolder = suggestedFolder
    ? formatDisplayPath(suggestedFolder, { redact: redactPaths, segments: 2 })
    : '';

  // Determine category and style
  const category = useMemo(() => getFileCategory(filePath), [filePath]);
  const style = CATEGORY_STYLES[category] || CATEGORY_STYLES.Other;

  // Use shared hooks for file actions
  const { openFile, revealFile, copyPath } = useFileActions();

  const handleOpen = useCallback(
    (e) => {
      e?.stopPropagation?.();
      openFile(filePath);
    },
    [filePath, openFile]
  );

  const handleReveal = useCallback(
    (e) => {
      e?.stopPropagation?.();
      revealFile(filePath);
    },
    [filePath, revealFile]
  );

  const handleCopyPath = useCallback(
    (e) => {
      e?.stopPropagation?.();
      copyPath(filePath);
    },
    [filePath, copyPath]
  );

  const handleFindSimilar = useCallback(
    (e) => {
      e?.stopPropagation?.();
      if (data?.id || filePath) {
        const event = new CustomEvent('graph:findSimilar', {
          detail: { nodeId: data?.id || filePath, path: filePath }
        });
        window.dispatchEvent(event);
      }
    },
    [data?.id, filePath]
  );

  const handleFocusOnNode = useCallback(
    (e) => {
      e?.stopPropagation?.();
      if (data?.id || filePath) {
        const event = new CustomEvent('graph:focusNode', {
          detail: { nodeId: data?.id || filePath }
        });
        window.dispatchEvent(event);
      }
    },
    [data?.id, filePath]
  );

  const handleMenuAction = useCallback(
    async (action) => {
      try {
        await action?.();
      } catch (e) {
        const message = e?.message || 'Action failed';
        logger.warn('[FileNode] Menu action failed:', message);
        showError(message);
      }
    },
    [showError]
  );

  // Calculate display score from withinScore or score
  const displayScore = data?.withinScore ?? data?.score ?? null;
  const hasHighScore = displayScore !== null && displayScore > 0.75;

  return (
    <div
      className={`
        relative px-2.5 py-1.5 rounded-lg border-2 shadow-sm min-w-[140px] max-w-[200px]
        transition-all duration-200 cursor-pointer group backface-hidden transform-gpu
        ${
          selected
            ? `border-[var(--color-stratosort-blue)] ring-2 ring-[var(--color-stratosort-blue)]/20 shadow-lg scale-105 z-10 bg-white`
            : `${style.border} ${style.bg} hover:border-[var(--color-stratosort-blue)]/50 hover:shadow-md hover:scale-102 hover:z-10`
        }
      `}
      style={{ opacity: data?.style?.opacity ?? 1 }}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
      onDoubleClick={handleOpen}
      title="Double-click to open file"
    >
      <NodeToolbar isVisible={selected} position={Position.Top}>
        <div className="flex gap-1 bg-white shadow-lg rounded-lg border border-system-gray-200 p-1">
          <IconButton
            onClick={() => handleMenuAction(handleOpen)}
            icon={<ExternalLink className="w-4 h-4 text-blue-600" />}
            size="sm"
            variant="ghost"
            className="h-7 w-7 hover:bg-blue-50"
            title="Open File"
            aria-label="Open File"
          />
          <IconButton
            onClick={() => handleMenuAction(handleReveal)}
            icon={<FolderOpen className="w-4 h-4 text-amber-600" />}
            size="sm"
            variant="ghost"
            className="h-7 w-7 hover:bg-amber-50"
            title="Reveal in Folder"
            aria-label="Reveal in Folder"
          />
          <IconButton
            onClick={() => handleMenuAction(handleFindSimilar)}
            icon={<GitBranch className="w-4 h-4 text-emerald-600" />}
            size="sm"
            variant="ghost"
            className="h-7 w-7 hover:bg-emerald-50"
            title="Find Similar"
            aria-label="Find Similar"
          />
          <IconButton
            onClick={() => handleMenuAction(handleFocusOnNode)}
            icon={<Focus className="w-4 h-4 text-indigo-600" />}
            size="sm"
            variant="ghost"
            className="h-7 w-7 hover:bg-indigo-50"
            title="Focus on Node"
            aria-label="Focus on Node"
          />
          <IconButton
            onClick={() => handleMenuAction(handleCopyPath)}
            icon={<Copy className="w-4 h-4 text-system-gray-500" />}
            size="sm"
            variant="ghost"
            className="h-7 w-7 hover:bg-system-gray-50"
            title="Copy Path"
            aria-label="Copy Path"
          />
        </div>
      </NodeToolbar>

      <Handle
        type="target"
        position={Position.Left}
        className="!bg-[var(--color-stratosort-blue)] !w-2 !h-2"
      />

      {/* Quick actions on hover */}
      {showActions && filePath && !selected && (
        <div className="absolute -top-8 left-1/2 -translate-x-1/2 flex gap-1 bg-white shadow-md rounded-lg px-2 py-1.5 border border-[var(--color-border-soft)] z-20">
          <IconButton
            onClick={handleOpen}
            icon={<ExternalLink className="w-3.5 h-3.5 text-[var(--color-stratosort-blue)]" />}
            size="sm"
            variant="ghost"
            className="h-6 w-6 hover:bg-[var(--color-stratosort-blue)]/10"
            title="Open file"
            aria-label="Open file"
          />
          <IconButton
            onClick={handleReveal}
            icon={<FolderOpen className="w-3.5 h-3.5 text-[var(--color-stratosort-blue)]" />}
            size="sm"
            variant="ghost"
            className="h-6 w-6 hover:bg-[var(--color-stratosort-blue)]/10"
            title="Reveal in folder"
            aria-label="Reveal in folder"
          />
        </div>
      )}

      {/* Score badge for relevance indicator */}
      {displayScore !== null && displayScore > 0 && (
        <div
          className={`
            absolute -top-2 -right-2 text-[9px] font-bold rounded-full px-1.5 h-5 min-w-[28px] flex items-center justify-center shadow-md border border-white z-10
            ${hasHighScore ? 'bg-stratosort-blue-600 text-white' : 'bg-system-gray-100 text-system-gray-600 border-system-gray-200'}
          `}
          title={`Relevance: ${Math.round(displayScore * 100)}%`}
        >
          {Math.round(displayScore * 100)}%
        </div>
      )}

      <div className="flex items-start gap-2.5">
        <div className="shrink-0 mt-0.5">
          <FileIcon filename={filePath} className="w-5 h-5" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1 mb-0.5">
            <span className={`text-[10px] font-semibold uppercase tracking-wider ${style.text}`}>
              {category}
            </span>
          </div>

          <div
            className="file-node-label text-xs font-semibold text-[var(--color-system-gray-900)] truncate mb-1"
            title={displayLabel}
          >
            {displayLabel}
          </div>

          {(tags.length > 0 || displaySuggestedFolder) && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {displaySuggestedFolder && (
                <span className="px-1.5 py-0.5 rounded text-[9px] bg-black/5 text-black/60 font-medium truncate max-w-full">
                  📂 {displaySuggestedFolder}
                </span>
              )}
              {tags.map((tag, i) => (
                <span
                  key={i}
                  className="px-1.5 py-0.5 rounded text-[9px] bg-white/60 text-[var(--color-system-gray-600)] border border-black/5"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!bg-[var(--color-stratosort-blue)] !w-2 !h-2"
      />
    </div>
  );
});

FileNode.displayName = 'FileNode';

FileNode.propTypes = {
  data: PropTypes.shape({
    id: PropTypes.string,
    withinScore: PropTypes.number,
    score: PropTypes.number,
    label: PropTypes.string,
    path: PropTypes.string,
    tags: PropTypes.arrayOf(PropTypes.string),
    entities: PropTypes.arrayOf(PropTypes.string),
    dates: PropTypes.arrayOf(PropTypes.string),
    suggestedFolder: PropTypes.string,
    style: PropTypes.shape({
      opacity: PropTypes.number
    })
  }),
  selected: PropTypes.bool
};

export default FileNode;
