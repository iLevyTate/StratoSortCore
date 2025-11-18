import React, { memo } from 'react';
import PropTypes from 'prop-types';

const DragAndDropZone = memo(function DragAndDropZone({
  isDragging,
  dragProps,
}) {
  return (
    <div
      className={`border-2 border-dashed rounded-lg p-21 text-center transition-colors ${isDragging ? 'border-stratosort-blue bg-stratosort-blue/5' : 'border-system-gray-300'}`}
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
};

export default DragAndDropZone;
