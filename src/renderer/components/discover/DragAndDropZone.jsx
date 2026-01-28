import React, { memo } from 'react';
import PropTypes from 'prop-types';
import { Download } from 'lucide-react';

/**
 * Reusable drag-and-drop zone UI.
 * Not currently wired in the default Discover UI, but kept for reuse.
 */
const DragAndDropZone = memo(function DragAndDropZone({ isDragging, dragProps, className = '' }) {
  // Add keyboard affordance for accessibility: treat the zone as a button
  const handleKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      // Prefer onClick when available; avoid firing onDrop without data transfer
      dragProps?.onClick?.(event);
    }
  };

  return (
    <div
      className={`border-2 border-dashed rounded-xl transition-colors duration-200 ${
        isDragging
          ? 'border-stratosort-blue bg-stratosort-blue/5'
          : 'border-system-gray-300 hover:border-system-gray-400 hover:bg-system-gray-50/50'
      } ${className || 'p-8'}`}
      role="button"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      {...dragProps}
    >
      <div className="mb-4" aria-hidden="true">
        <Download className="w-8 h-8 text-system-gray-400" />
      </div>
      <div className="text-sm text-system-gray-600">Drop files or folders here</div>
    </div>
  );
});

DragAndDropZone.propTypes = {
  isDragging: PropTypes.bool,
  dragProps: PropTypes.object,
  className: PropTypes.string
};

export default DragAndDropZone;
