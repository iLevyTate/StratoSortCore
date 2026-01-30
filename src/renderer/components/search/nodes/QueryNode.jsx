import React, { memo, useState, useCallback, useRef } from 'react';
import PropTypes from 'prop-types';
import { Handle, Position } from 'reactflow';
import { MessageSquare, Copy, Search } from 'lucide-react';
import { Button } from '../../ui';
import { useMenuAutoClose } from '../../../hooks';

const QueryNode = memo(({ data, selected }) => {
  const [contextMenu, setContextMenu] = useState({ open: false, x: 0, y: 0 });
  const menuRef = useRef(null);
  const queryText = data?.label || '';

  // Close context menu when clicking outside or pressing Escape
  useMenuAutoClose(menuRef, contextMenu.open, () => setContextMenu({ open: false, x: 0, y: 0 }));

  const handleCopyQuery = useCallback(
    (e) => {
      e?.stopPropagation?.();
      if (queryText) {
        navigator.clipboard?.writeText?.(queryText);
      }
    },
    [queryText]
  );

  const handleSearchAgain = useCallback(
    (e) => {
      e?.stopPropagation?.();
      // Dispatch custom event that UnifiedSearchModal can listen for
      if (queryText) {
        const event = new CustomEvent('graph:searchAgain', {
          detail: { query: queryText }
        });
        window.dispatchEvent(event);
      }
    },
    [queryText]
  );

  const handleContextMenu = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setContextMenu({
      open: true,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu({ open: false, x: 0, y: 0 });
  }, []);

  const handleMenuAction = useCallback(
    (action) => {
      closeContextMenu();
      action?.();
    },
    [closeContextMenu]
  );

  return (
    <div
      className={`
        relative px-3 py-2 rounded-lg border-2 shadow-sm min-w-[120px] max-w-[180px]
        transition-colors duration-200 cursor-pointer
        ${
          selected
            ? 'border-indigo-500 bg-indigo-50 shadow-md ring-2 ring-indigo-300'
            : 'border-indigo-200 bg-gradient-to-br from-indigo-50 to-blue-50 hover:border-indigo-400'
        }
      `}
      onContextMenu={handleContextMenu}
      title="Right-click for options"
    >
      {/* Context menu */}
      {contextMenu.open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Query actions"
          className="absolute bg-white shadow-lg rounded-lg border border-system-gray-200 z-50 w-40 py-1 animate-in fade-in zoom-in-95 duration-100"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <Button
            role="menuitem"
            variant="ghost"
            size="sm"
            leftIcon={<Copy className="w-4 h-4 text-system-gray-500" />}
            onClick={(e) => {
              e.stopPropagation();
              handleMenuAction(handleCopyQuery);
            }}
            className="w-full justify-start px-3 py-2 text-system-gray-700 hover:bg-stratosort-indigo-50 rounded-none"
          >
            Copy Query
          </Button>
          <Button
            role="menuitem"
            variant="ghost"
            size="sm"
            leftIcon={<Search className="w-4 h-4 text-indigo-600" />}
            onClick={(e) => {
              e.stopPropagation();
              handleMenuAction(handleSearchAgain);
            }}
            className="w-full justify-start px-3 py-2 text-system-gray-700 hover:bg-stratosort-indigo-50 rounded-none"
          >
            Search Again
          </Button>
        </div>
      )}

      <div className="flex items-start gap-2">
        <MessageSquare className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-indigo-500 font-medium">
            Query
          </div>
          <div
            className="file-node-label text-xs font-medium text-[var(--color-system-gray-900)] truncate"
            title={queryText}
          >
            {queryText}
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-indigo-500 !w-2 !h-2" />
    </div>
  );
});

QueryNode.displayName = 'QueryNode';

QueryNode.propTypes = {
  data: PropTypes.shape({
    label: PropTypes.string
  }),
  selected: PropTypes.bool
};

export default QueryNode;
