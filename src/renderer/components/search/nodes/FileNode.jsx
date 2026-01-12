import React, { memo, useState, useCallback, useRef } from 'react';
import PropTypes from 'prop-types';
import { Handle, Position } from 'reactflow';
import { FileText, ExternalLink, FolderOpen, Copy, GitBranch } from 'lucide-react';
import { useMenuAutoClose, useFileActions } from '../../../hooks';
import { logger } from '../../../../shared/logger';

const FileNode = memo(({ data, selected }) => {
  const [showActions, setShowActions] = useState(false);
  const [contextMenu, setContextMenu] = useState({ open: false, x: 0, y: 0 });
  const menuRef = useRef(null);
  const filePath = data?.path || '';

  // Use shared hooks for menu auto-close and file actions
  const closeMenu = useCallback(() => setContextMenu({ open: false, x: 0, y: 0 }), []);
  useMenuAutoClose(menuRef, contextMenu.open, closeMenu);
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
      // Dispatch custom event that UnifiedSearchModal can listen for
      if (data?.id || filePath) {
        const event = new CustomEvent('graph:findSimilar', {
          detail: { nodeId: data?.id || filePath, path: filePath }
        });
        window.dispatchEvent(event);
      }
    },
    [data?.id, filePath]
  );

  const handleContextMenu = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    // Position menu relative to the node
    const rect = e.currentTarget.getBoundingClientRect();
    setContextMenu({
      open: true,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    });
  }, []);

  // Use closeMenu for context menu actions (avoid duplicate function)
  const handleMenuAction = useCallback(
    async (action) => {
      closeMenu();
      try {
        await action?.();
      } catch (e) {
        // Prevent unhandled rejection if action fails
        logger.warn('[FileNode] Menu action failed:', e?.message || e);
      }
    },
    [closeMenu]
  );

  // Calculate display score from withinScore or score
  const displayScore = data?.withinScore ?? data?.score ?? null;
  const hasHighScore = displayScore !== null && displayScore > 0.75;

  return (
    <div
      className={`
        relative px-3 py-2 rounded-lg border-2 shadow-sm min-w-[140px] max-w-[200px]
        transition-all duration-200 cursor-pointer group
        ${
          selected
            ? 'border-[var(--color-stratosort-blue)] bg-[var(--color-stratosort-blue)]/10 shadow-md ring-2 ring-[var(--color-stratosort-blue)]/30'
            : 'border-[var(--color-border-soft)] bg-white hover:border-[var(--color-stratosort-blue)]/50 hover:shadow-md'
        }
        ${hasHighScore ? 'ring-1 ring-blue-400' : ''}
      `}
      style={{ opacity: data?.style?.opacity ?? 1 }}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
      onContextMenu={handleContextMenu}
      onDoubleClick={handleOpen}
      title="Double-click to open file"
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-[var(--color-stratosort-blue)] !w-2 !h-2"
      />

      {/* Quick actions on hover */}
      {showActions && filePath && !contextMenu.open && (
        <div className="absolute -top-7 left-1/2 -translate-x-1/2 flex gap-1 bg-white shadow-md rounded-lg px-1.5 py-1 border border-[var(--color-border-soft)] z-10">
          <button
            onClick={handleOpen}
            className="p-1 rounded hover:bg-[var(--color-stratosort-blue)]/10 transition-colors"
            title="Open file"
          >
            <ExternalLink className="w-3 h-3 text-[var(--color-stratosort-blue)]" />
          </button>
          <button
            onClick={handleReveal}
            className="p-1 rounded hover:bg-[var(--color-stratosort-blue)]/10 transition-colors"
            title="Reveal in folder"
          >
            <FolderOpen className="w-3 h-3 text-[var(--color-stratosort-blue)]" />
          </button>
        </div>
      )}

      {/* Context menu */}
      {contextMenu.open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="File actions"
          className="absolute bg-white shadow-lg rounded-lg border border-gray-200 z-50 w-44 py-1 animate-in fade-in zoom-in-95 duration-100"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            role="menuitem"
            onClick={(e) => {
              e.stopPropagation();
              handleMenuAction(handleOpen);
            }}
            className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-blue-50 flex items-center gap-2"
          >
            <ExternalLink className="w-4 h-4 text-blue-600" />
            Open File
          </button>
          <button
            role="menuitem"
            onClick={(e) => {
              e.stopPropagation();
              handleMenuAction(handleReveal);
            }}
            className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-blue-50 flex items-center gap-2"
          >
            <FolderOpen className="w-4 h-4 text-amber-600" />
            Reveal in Folder
          </button>
          <div className="border-t border-gray-100 my-1" />
          <button
            role="menuitem"
            onClick={(e) => {
              e.stopPropagation();
              handleMenuAction(handleFindSimilar);
            }}
            className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-blue-50 flex items-center gap-2"
          >
            <GitBranch className="w-4 h-4 text-emerald-600" />
            Find Similar
          </button>
          <button
            role="menuitem"
            onClick={(e) => {
              e.stopPropagation();
              handleMenuAction(handleCopyPath);
            }}
            className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-blue-50 flex items-center gap-2"
          >
            <Copy className="w-4 h-4 text-gray-500" />
            Copy Path
          </button>
        </div>
      )}

      {/* Score badge for relevance indicator - only show if score is meaningful (> 0) */}
      {displayScore !== null && displayScore > 0 && (
        <div
          className={`
            absolute -top-2 -right-2 text-[9px] font-bold rounded-full px-1.5 h-5 min-w-[28px] flex items-center justify-center shadow-md border border-white z-10
            ${hasHighScore ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 border-gray-200'}
          `}
          title={`Relevance: ${Math.round(displayScore * 100)}%`}
        >
          {Math.round(displayScore * 100)}%
        </div>
      )}

      <div className="flex items-start gap-2">
        <FileText className="w-4 h-4 text-[var(--color-stratosort-blue)] shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div
            className="text-xs font-medium text-[var(--color-system-gray-900)] truncate"
            title={data?.label}
          >
            {data?.label}
          </div>
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
    style: PropTypes.shape({
      opacity: PropTypes.number
    })
  }),
  selected: PropTypes.bool
};

export default FileNode;
