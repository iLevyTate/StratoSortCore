import React, { memo } from 'react';
import PropTypes from 'prop-types';

const DragAndDropZone = memo(function DragAndDropZone({
  isDragging,
  dragProps,
  className = '',
}) {
  return (
    <div
      className={`border-2 border-dashed rounded-lg transition-colors ${
        isDragging
          ? 'border-stratosort-blue bg-stratosort-blue/5'
          : 'border-system-gray-300 hover:border-system-gray-400 hover:bg-system-gray-50/50'
      } ${className || 'p-21'}`}
      {...dragProps}
    >
      <div className="text-2xl mb-5">📥</div>
      <div className="text-sm text-system-gray-600">
        Drop files or folders here, or click to select
      </div>
    </div>
  );
});

DragAndDropZone.propTypes = {
  isDragging: PropTypes.bool,
  dragProps: PropTypes.object,
  className: PropTypes.string,
};

export default DragAndDropZone;
