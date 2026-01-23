import React, { useState, useRef, useCallback, useEffect } from 'react';
import PropTypes from 'prop-types';
import { X, GripVertical, Network } from 'lucide-react';
import { Button, IconButton } from '../ui';
import { isMac } from '../../utils/platform';

/**
 * FloatingSearchWidget - A draggable floating widget for quick access to semantic search
 * Similar to notification system but draggable and always accessible
 */
function FloatingSearchWidget({ isOpen, onClose, onOpenSearch }) {
  const [position, setPosition] = useState({ x: 20, y: 100 });
  const [isDragging, setIsDragging] = useState(false);
  // FIX: Use ref instead of state for dragOffset to prevent useEffect re-runs during drag
  // This prevents event listener churn when dragOffset changes
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const widgetRef = useRef(null);
  const dragStartRef = useRef(null);

  // Load saved position from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('floatingSearchWidgetPosition');
      if (saved) {
        const parsed = JSON.parse(saved);
        setPosition(parsed);
      }
    } catch (error) {
      // Ignore localStorage errors
    }
  }, []);

  // Save position to localStorage
  const savePosition = useCallback((pos) => {
    try {
      localStorage.setItem('floatingSearchWidgetPosition', JSON.stringify(pos));
    } catch (error) {
      // Ignore localStorage errors
    }
  }, []);

  // Handle drag start
  const handleMouseDown = useCallback((e) => {
    // Only start drag on the grip handle or header area
    const isGripHandle = e.target.closest('[data-drag-handle]');
    const isHeader = e.target.closest('[data-widget-header]');

    if (!isGripHandle && !isHeader) return;

    e.preventDefault();
    setIsDragging(true);

    const rect = widgetRef.current?.getBoundingClientRect();
    if (rect) {
      // FIX: Use ref instead of setState to avoid triggering useEffect re-run
      dragOffsetRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
    }

    dragStartRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  // Handle drag
  useEffect(() => {
    if (!isDragging) return undefined;

    const handleMouseMove = (e) => {
      if (!dragStartRef.current) return;

      // FIX: Use ref to access dragOffset to avoid adding it to deps
      const newX = e.clientX - dragOffsetRef.current.x;
      const newY = e.clientY - dragOffsetRef.current.y;

      // Constrain to viewport
      const maxX = window.innerWidth - (widgetRef.current?.offsetWidth || 320);
      const maxY = window.innerHeight - (widgetRef.current?.offsetHeight || 200);

      const constrainedX = Math.max(0, Math.min(newX, maxX));
      const constrainedY = Math.max(0, Math.min(newY, maxY));

      setPosition({ x: constrainedX, y: constrainedY });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      if (widgetRef.current) {
        const rect = widgetRef.current.getBoundingClientRect();
        savePosition({ x: rect.left, y: rect.top });
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    // FIX: Removed dragOffset from deps since we now use a ref
  }, [isDragging, savePosition]);

  if (!isOpen) return null;

  return (
    <div
      ref={widgetRef}
      className="fixed z-[500] pointer-events-auto"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        cursor: isDragging ? 'grabbing' : 'default'
      }}
      onMouseDown={handleMouseDown}
    >
      <div className="glass-panel border border-stratosort-blue/20 bg-gradient-to-br from-stratosort-blue/5 to-stratosort-indigo/5 p-4 rounded-xl shadow-lg w-80 max-w-[90vw]">
        {/* Header with drag handle */}
        <div data-widget-header className="flex items-start gap-3 mb-3 cursor-move select-none">
          <div
            data-drag-handle
            className="p-1.5 bg-stratosort-blue/10 rounded-lg shrink-0 cursor-grab active:cursor-grabbing"
          >
            <GripVertical className="w-4 h-4 text-stratosort-blue" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1">
              <h4 className="text-sm font-semibold text-system-gray-900">Looking for a file?</h4>
              <IconButton
                onClick={onClose}
                variant="ghost"
                size="sm"
                aria-label="Close widget"
                icon={<X className="w-3.5 h-3.5" />}
              />
            </div>
            <p className="text-xs text-system-gray-600 mb-3">
              Use Knowledge OS to explore the semantic graph and RAG results — describe what you are
              looking for in natural language.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" size="sm" onClick={onOpenSearch} className="text-xs">
                <Network className="w-3.5 h-3.5" />
                <span>Open Knowledge OS</span>
              </Button>
            </div>
            <div className="mt-2 text-[10px] text-system-gray-400">
              Tip: Press{' '}
              <kbd className="px-1 py-0.5 bg-system-gray-100 rounded text-system-gray-600 font-mono">
                {isMac ? '⌘K' : 'Ctrl+K'}
              </kbd>{' '}
              anytime to search
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

FloatingSearchWidget.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onOpenSearch: PropTypes.func.isRequired
};

export default FloatingSearchWidget;
