import React, { useEffect, useState, memo } from 'react';
import PropTypes from 'prop-types';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Textarea from '../ui/Textarea';

/**
 * SmartFolderItem - Displays a smart folder with compact/expanded modes
 *
 * @param {boolean} compact - When true, shows minimal info (name + path only)
 * @param {boolean} isExpanded - Controls expanded state in compact mode
 * @param {function} onToggleExpand - Callback when expand/collapse is clicked
 */
const SmartFolderItem = memo(function SmartFolderItem({
  folder,
  index = 0,
  editingFolder,
  setEditingFolder,
  isSavingEdit,
  isDeleting,
  onSaveEdit,
  onCancelEdit,
  onEditStart,
  onDeleteFolder,
  onCreateDirectory,
  onOpenFolder,
  addNotification,
  compact = false,
  isExpanded = true,
  onToggleExpand
}) {
  const isEditing = editingFolder?.id === folder.id;
  const [hasMounted, setHasMounted] = useState(false);

  // Avoid re-triggering entrance animation on expand/collapse toggles
  useEffect(() => {
    setHasMounted(true);
  }, []);

  const shouldAnimateEntrance = !hasMounted;
  const cardAnimationClass = shouldAnimateEntrance ? 'animate-slide-in-right' : '';
  const cardAnimationDelay = shouldAnimateEntrance ? `${index * 0.05}s` : undefined;

  // Compact view - just name, path snippet, and expand button
  if (compact && !isExpanded && !isEditing) {
    return (
      <div
        className="group flex items-center bg-white/70 rounded-xl border border-border-soft/60 shadow-sm hover:shadow-md hover:border-stratosort-blue/30 transition-all cursor-pointer h-full"
        style={{ padding: 'var(--spacing-cozy)', gap: 'var(--spacing-cozy)' }}
        onClick={() => onToggleExpand?.(folder.id)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggleExpand?.(folder.id);
          }
        }}
        aria-expanded={false}
        aria-label={`${folder.name} - click to expand`}
        data-testid="folder-item"
      >
        {/* Folder icon with status */}
        <div className="h-10 w-10 rounded-xl bg-stratosort-blue/10 text-stratosort-blue flex items-center justify-center shrink-0">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
            />
          </svg>
        </div>

        {/* Name and path */}
        <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 2 }}>
          <div className="font-medium text-system-gray-800 text-sm truncate">{folder.name}</div>
          <div className="text-xs text-system-gray-500 truncate">{folder.path}</div>
        </div>

        {/* Quick actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenFolder(folder.path);
            }}
            className="p-1.5 text-system-gray-400 hover:text-stratosort-blue hover:bg-stratosort-blue/10 rounded-lg transition-colors"
            title="Open folder"
            disabled={!folder.physicallyExists}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEditStart(folder);
            }}
            className="p-1.5 text-system-gray-400 hover:text-stratosort-blue hover:bg-stratosort-blue/10 rounded-lg transition-colors"
            title="Edit folder"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
          </button>
        </div>

        {/* Expand chevron */}
        <svg
          className="w-4 h-4 text-system-gray-400 shrink-0 group-hover:text-stratosort-blue transition-colors"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>
    );
  }

  // Edit mode
  if (isEditing) {
    return (
      <div
        className={`bg-white/90 rounded-xl border-2 border-stratosort-blue/40 shadow-lg h-full flex flex-col ${cardAnimationClass}`}
        style={{ padding: 'var(--spacing-default)', animationDelay: cardAnimationDelay }}
      >
        <div
          className="flex flex-col flex-1"
          style={{ gap: 'var(--spacing-cozy)' }}
          role="form"
          aria-label="Edit smart folder"
        >
          {/* Header */}
          <div
            className="flex items-center"
            style={{ gap: 'var(--spacing-cozy)', marginBottom: 'var(--spacing-compact)' }}
          >
            <div className="h-10 w-10 rounded-xl bg-stratosort-blue/10 text-stratosort-blue flex items-center justify-center">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-system-gray-800">Editing Smart Folder</p>
              <p className="text-xs text-system-gray-500">Press Enter to save, Escape to cancel</p>
            </div>
          </div>

          <div className="flex flex-col md:flex-row" style={{ gap: 'var(--spacing-cozy)' }}>
            <Input
              type="text"
              value={editingFolder.name || ''}
              onChange={(e) => setEditingFolder({ ...editingFolder, name: e.target.value })}
              className="flex-1"
              placeholder="Folder name"
              aria-label="Folder name"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSaveEdit();
                if (e.key === 'Escape') onCancelEdit();
              }}
            />
            <Input
              type="text"
              value={editingFolder.path || ''}
              onChange={(e) => setEditingFolder({ ...editingFolder, path: e.target.value })}
              className="flex-1"
              placeholder="Folder path"
              aria-label="Folder path"
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSaveEdit();
                if (e.key === 'Escape') onCancelEdit();
              }}
            />
          </div>
          {/* Description with AI generate button */}
          <div className="relative">
            <Textarea
              value={editingFolder.description || ''}
              onChange={(e) =>
                setEditingFolder({
                  ...editingFolder,
                  description: e.target.value
                })
              }
              className="w-full pr-10"
              placeholder="Describe what types of files should go in this folder (helps AI match files)"
              rows={2}
              aria-label="Folder description"
            />
            {/* FIX: AI Generate Description button (Issue 2.5) */}
            <button
              type="button"
              onClick={async () => {
                try {
                  const result = await window.electronAPI?.smartFolders?.generateDescription?.(
                    editingFolder.name
                  );
                  if (result?.success && result.description) {
                    setEditingFolder({ ...editingFolder, description: result.description });
                    addNotification?.('Description generated', 'success');
                  } else {
                    addNotification?.(result?.error || 'Failed to generate description', 'error');
                  }
                } catch (err) {
                  addNotification?.('Failed to generate description', 'error');
                }
              }}
              className="absolute right-2 top-2 p-1.5 text-system-gray-400 hover:text-stratosort-blue hover:bg-stratosort-blue/10 rounded-lg transition-colors"
              title="Generate description with AI"
              aria-label="Generate description with AI"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
                />
              </svg>
            </button>
          </div>
          <div
            className="flex justify-end"
            style={{ gap: 'var(--spacing-cozy)', paddingTop: 'var(--spacing-compact)' }}
          >
            <Button
              onClick={onCancelEdit}
              disabled={isSavingEdit}
              variant="secondary"
              size="sm"
              title="Cancel edits"
              aria-label="Cancel edits"
              className="p-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
              <span className="sr-only">Cancel edits</span>
            </Button>
            <Button
              onClick={onSaveEdit}
              disabled={isSavingEdit}
              variant="primary"
              size="sm"
              title="Save smart folder"
              aria-label="Save smart folder"
              className="p-2"
            >
              {isSavingEdit ? (
                <>
                  <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span className="sr-only">Saving</span>
                </>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              )}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Expanded view (default)
  return (
    <div
      className={`bg-white/70 rounded-xl border border-border-soft/60 shadow-sm hover:shadow-md transition-all h-full flex flex-col ${cardAnimationClass}`}
      style={{ padding: 'var(--spacing-default)', animationDelay: cardAnimationDelay }}
      data-testid="folder-item"
    >
      <div className="flex flex-col flex-1" style={{ gap: 'var(--spacing-cozy)' }}>
        {/* Header with collapse button (if in compact mode) */}
        <div className="flex items-start justify-between" style={{ gap: 'var(--spacing-cozy)' }}>
          <div className="flex items-start" style={{ gap: 'var(--spacing-cozy)' }}>
            {/* Folder icon */}
            <div className="h-12 w-12 rounded-xl bg-stratosort-blue/10 text-stratosort-blue flex items-center justify-center shrink-0">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                />
              </svg>
            </div>

            <div className="flex-1 min-w-0">
              <div
                className="flex items-center"
                style={{ gap: 'var(--spacing-compact)', marginBottom: 2 }}
              >
                {compact && onToggleExpand && (
                  <button
                    onClick={() => onToggleExpand(folder.id)}
                    className="p-1 -ml-1 text-system-gray-400 hover:text-system-gray-600 transition-colors rounded"
                    aria-label="Collapse"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 15l7-7 7 7"
                      />
                    </svg>
                  </button>
                )}
                <h3 className="font-semibold text-system-gray-800 truncate">{folder.name}</h3>
              </div>
              <p
                className="text-sm text-system-gray-500 break-all"
                style={{ wordBreak: 'break-word' }}
              >
                {folder.path}
              </p>
            </div>
          </div>

          {/* Status badge */}
          <div
            className="flex items-center rounded-full border px-2.5 py-1 bg-stratosort-success/10 border-stratosort-success/20 shrink-0"
            style={{ gap: 'var(--spacing-compact)' }}
          >
            <div className="w-2 h-2 rounded-full bg-stratosort-success" />
            <span className="text-xs font-medium text-stratosort-success">Active</span>
          </div>
        </div>

        {/* Description */}
        {folder.description && (
          <div
            className="text-sm text-system-gray-600 bg-stratosort-blue/5 rounded-xl border border-stratosort-blue/10"
            style={{ padding: 'var(--spacing-cozy)' }}
          >
            <div
              className="flex items-center"
              style={{ gap: 'var(--spacing-compact)', marginBottom: 'var(--spacing-compact)' }}
            >
              <svg
                className="w-4 h-4 text-stratosort-blue"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                />
              </svg>
              <span className="text-xs font-semibold text-stratosort-blue uppercase tracking-wide">
                AI Context
              </span>
            </div>
            <p className="text-system-gray-600">{folder.description}</p>
          </div>
        )}

        {/* Actions */}
        <div
          className="flex items-center justify-between border-t border-border-soft/50 mt-auto"
          style={{ gap: 'var(--spacing-cozy)', paddingTop: 'var(--spacing-cozy)' }}
        >
          <div className="flex items-center" style={{ gap: 'var(--spacing-compact)' }}>
            {!folder.physicallyExists && (
              <button
                onClick={async () => {
                  const result = await onCreateDirectory(folder.path);
                  if (result.success) {
                    addNotification?.(`Created directory: ${folder.name}`, 'success');
                  } else {
                    addNotification?.(`Failed to create: ${result.error}`, 'error');
                  }
                }}
                className="p-2 text-stratosort-blue hover:bg-stratosort-blue/10 rounded-xl transition-colors"
                title="Create directory"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"
                  />
                </svg>
              </button>
            )}
            <button
              onClick={() => onOpenFolder(folder.path)}
              disabled={!folder.physicallyExists}
              className={`p-2 rounded-xl transition-colors ${
                folder.physicallyExists
                  ? 'text-stratosort-success hover:bg-stratosort-success/10'
                  : 'text-system-gray-300 cursor-not-allowed'
              }`}
              title={folder.physicallyExists ? 'Open in explorer' : "Folder doesn't exist"}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                />
              </svg>
            </button>
            <button
              onClick={() => onEditStart(folder)}
              className="p-2 text-stratosort-blue hover:bg-stratosort-blue/10 rounded-xl transition-colors"
              title="Edit folder"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                />
              </svg>
            </button>
            {/* FIX Issue 3.1-C, 3.1-D: Removed per-folder rebuild button.
                Rebuild embeddings is available in Settings > Embeddings for advanced users. */}
          </div>

          <button
            onClick={() => onDeleteFolder(folder.id)}
            disabled={isDeleting}
            className="p-2 text-stratosort-danger hover:bg-stratosort-danger/10 rounded-xl transition-colors disabled:opacity-50"
            title="Remove folder"
          >
            {isDeleting ? (
              <span className="inline-block w-4 h-4 border-2 border-stratosort-danger border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
});

const folderShape = PropTypes.shape({
  id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  name: PropTypes.string.isRequired,
  path: PropTypes.string,
  description: PropTypes.string,
  physicallyExists: PropTypes.bool
});

SmartFolderItem.propTypes = {
  folder: folderShape.isRequired,
  index: PropTypes.number,
  editingFolder: folderShape,
  setEditingFolder: PropTypes.func.isRequired,
  isSavingEdit: PropTypes.bool,
  isDeleting: PropTypes.bool,
  onSaveEdit: PropTypes.func.isRequired,
  onCancelEdit: PropTypes.func.isRequired,
  onEditStart: PropTypes.func.isRequired,
  onDeleteFolder: PropTypes.func.isRequired,
  onCreateDirectory: PropTypes.func.isRequired,
  onOpenFolder: PropTypes.func.isRequired,
  addNotification: PropTypes.func,
  compact: PropTypes.bool,
  isExpanded: PropTypes.bool,
  onToggleExpand: PropTypes.func
};

export default SmartFolderItem;
