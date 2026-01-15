import React, { memo, useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import { Handle, Position, NodeToolbar } from 'reactflow';
import { FileText, ExternalLink, FolderOpen, Copy, GitBranch, Focus } from 'lucide-react';
import { useFileActions } from '../../../hooks';
import { logger } from '../../../../shared/logger';

const FileNode = memo(({ data, selected }) => {
  const [showActions, setShowActions] = useState(false);
  const filePath = data?.path || '';

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

  const handleMenuAction = useCallback(async (action) => {
    try {
      await action?.();
    } catch (e) {
      logger.warn('[FileNode] Menu action failed:', e?.message || e);
    }
  }, []);

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
      onDoubleClick={handleOpen}
      title="Double-click to open file"
    >
      <NodeToolbar isVisible={selected} position={Position.Top}>
        <div className="flex gap-1 bg-white shadow-lg rounded-lg border border-gray-200 p-1">
          <button
            onClick={() => handleMenuAction(handleOpen)}
            className="p-1.5 rounded hover:bg-blue-50 text-blue-600 transition-colors"
            title="Open File"
          >
            <ExternalLink className="w-4 h-4" />
          </button>
          <button
            onClick={() => handleMenuAction(handleReveal)}
            className="p-1.5 rounded hover:bg-amber-50 text-amber-600 transition-colors"
            title="Reveal in Folder"
          >
            <FolderOpen className="w-4 h-4" />
          </button>
          <button
            onClick={() => handleMenuAction(handleFindSimilar)}
            className="p-1.5 rounded hover:bg-emerald-50 text-emerald-600 transition-colors"
            title="Find Similar"
          >
            <GitBranch className="w-4 h-4" />
          </button>
          <button
            onClick={() => handleMenuAction(handleFocusOnNode)}
            className="p-1.5 rounded hover:bg-indigo-50 text-indigo-600 transition-colors"
            title="Focus on Node"
          >
            <Focus className="w-4 h-4" />
          </button>
          <button
            onClick={() => handleMenuAction(handleCopyPath)}
            className="p-1.5 rounded hover:bg-gray-50 text-gray-500 transition-colors"
            title="Copy Path"
          >
            <Copy className="w-4 h-4" />
          </button>
        </div>
      </NodeToolbar>

      <Handle
        type="target"
        position={Position.Left}
        className="!bg-[var(--color-stratosort-blue)] !w-2 !h-2"
      />

      {/* Quick actions on hover */}
      {showActions && filePath && !selected && (
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
