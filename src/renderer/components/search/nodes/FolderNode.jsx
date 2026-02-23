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
        relative px-3 py-2 rounded-lg border-2 shadow-sm w-[220px] min-h-[84px] overflow-hidden
        transition-colors duration-200 cursor-pointer
        ${
          selected
            ? 'border-stratosort-accent bg-stratosort-accent/10 shadow-md ring-2 ring-stratosort-accent/30'
            : 'border-stratosort-accent/50 bg-white hover:border-stratosort-accent/70 hover:shadow-md'
        }
      `}
      title={label}
    >
      <Handle type="target" position={Position.Left} className="!bg-stratosort-accent !w-2 !h-2" />
      <div className="flex items-start gap-2">
        <Folder className="w-4 h-4 text-stratosort-accent shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-system-gray-900 clamp-2 break-all leading-snug">
            {label}
          </div>
          {memberCount > 0 && (
            <div className="text-xs text-system-gray-500 mt-0.5">
              {memberCount} file{memberCount === 1 ? '' : 's'}
            </div>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-stratosort-accent !w-2 !h-2" />
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
