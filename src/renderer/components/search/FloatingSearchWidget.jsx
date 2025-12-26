import React, { useState, useRef, useCallback, useEffect } from 'react';
import PropTypes from 'prop-types';
import { Search as SearchIcon, Network, X, GripVertical } from 'lucide-react';
import { Button } from '../ui';

/**
 * FloatingSearchWidget - A draggable floating widget for quick access to semantic search
 * Similar to notification system but draggable and always accessible
 */
const FloatingSearchWidget = ({ isOpen, onClose, onOpenSearch, onOpenGraph }) => {
  const [position, setPosition] = useState({ x: 20, y: 100 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
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
      setDragOffset({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      });
    }

    dragStartRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  // Handle drag
  useEffect(() => {
    if (!isDragging) return undefined;

    const handleMouseMove = (e) => {
      if (!dragStartRef.current) return;

      const newX = e.clientX - dragOffset.x;
      const newY = e.clientY - dragOffset.y;

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
  }, [isDragging, dragOffset, savePosition]);

  if (!isOpen) return null;

  return (
    <div
      ref={widgetRef}
      className="fixed z-[9999] pointer-events-auto"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        cursor: isDragging ? 'grabbing' : 'default'
      }}
      onMouseDown={handleMouseDown}
    >
      <div className="glass-panel border border-stratosort-blue/20 bg-gradient-to-br from-stratosort-blue/5 to-stratosort-indigo/5 p-4 rounded-xl shadow-lg w-[320px]">
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
              <button
                onClick={onClose}
                className="p-1 hover:bg-white/50 rounded transition-colors"
                aria-label="Close widget"
                title="Close widget"
              >
                <X className="w-3.5 h-3.5 text-system-gray-500" />
              </button>
            </div>
            <p className="text-xs text-system-gray-600 mb-3">
              Use Semantic Search to find files by meaning — describe what you are looking for in
              natural language.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" size="sm" onClick={onOpenSearch} className="text-xs">
                <SearchIcon className="w-3.5 h-3.5" /> Try Semantic Search
              </Button>
              <Button variant="secondary" size="sm" onClick={onOpenGraph} className="text-xs">
                <Network className="w-3.5 h-3.5" /> Explore Graph
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

FloatingSearchWidget.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onOpenSearch: PropTypes.func.isRequired,
  onOpenGraph: PropTypes.func.isRequired
};

export default FloatingSearchWidget;
