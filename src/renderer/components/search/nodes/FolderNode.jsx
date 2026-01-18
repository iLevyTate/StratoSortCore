import React, { memo } from 'react';
import PropTypes from 'prop-types';
import { Handle, Position } from 'reactflow';
import { Folder } from 'lucide-react';

const FolderNode = memo(({ data, selected }) => {
  const label = data?.label || 'Suggested Folder';
  const memberCount = data?.memberCount || 0;

  return (
    <div
      className={`
        relative px-3 py-2 rounded-lg border-2 shadow-sm min-w-[140px] max-w-[200px]
        transition-colors duration-200 cursor-pointer
        ${
          selected
            ? 'border-amber-500 bg-amber-50 shadow-md ring-2 ring-amber-200'
            : 'border-amber-300 bg-white hover:border-amber-400 hover:shadow-md'
        }
      `}
      title={label}
    >
      <Handle type="target" position={Position.Left} className="!bg-amber-500 !w-2 !h-2" />
      <div className="flex items-start gap-2">
        <Folder className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-system-gray-900 truncate">{label}</div>
          {memberCount > 0 && (
            <div className="text-[10px] text-system-gray-500 mt-0.5">
              {memberCount} file{memberCount === 1 ? '' : 's'}
            </div>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-amber-500 !w-2 !h-2" />
    </div>
  );
});

FolderNode.displayName = 'FolderNode';

FolderNode.propTypes = {
  data: PropTypes.shape({
    label: PropTypes.string,
    memberCount: PropTypes.number
  }),
  selected: PropTypes.bool
};

export default FolderNode;
