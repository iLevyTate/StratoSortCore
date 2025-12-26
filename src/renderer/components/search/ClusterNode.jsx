/**
 * ClusterNode - ReactFlow node component for semantic clusters
 *
 * Displays a cluster as an expandable node in the graph visualization.
 * Shows cluster label, member count, and provides expand/collapse functionality.
 */

import React, { memo } from 'react';
import PropTypes from 'prop-types';
import { Handle, Position } from 'reactflow';
import { Folder, ChevronRight, ChevronDown, Layers } from 'lucide-react';

const ClusterNode = memo(({ data, selected }) => {
  const isExpanded = data?.expanded || false;
  const memberCount = data?.memberCount || 0;
  const label = data?.label || 'Cluster';

  return (
    <div
      className={`
        px-4 py-3 rounded-xl border-2 shadow-sm min-w-[160px] max-w-[220px]
        transition-all duration-200 cursor-pointer
        ${
          selected
            ? 'border-amber-500 bg-amber-50 shadow-md ring-2 ring-amber-200'
            : 'border-amber-300 bg-gradient-to-br from-amber-50 to-orange-50 hover:border-amber-400 hover:shadow-md'
        }
      `}
    >
      <Handle type="target" position={Position.Left} className="!bg-amber-500 !w-2.5 !h-2.5" />

      <div className="flex items-center gap-2">
        <div className="p-1.5 bg-amber-100 rounded-lg">
          <Layers className="w-4 h-4 text-amber-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-gray-900 truncate" title={label}>
            {label}
          </div>
          <div className="text-xs text-gray-500 flex items-center gap-1">
            <Folder className="w-3 h-3" />
            <span>
              {memberCount} file{memberCount !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
        <div className="text-amber-500">
          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </div>
      </div>

      <Handle type="source" position={Position.Right} className="!bg-amber-500 !w-2.5 !h-2.5" />
    </div>
  );
});

ClusterNode.displayName = 'ClusterNode';

ClusterNode.propTypes = {
  data: PropTypes.shape({
    expanded: PropTypes.bool,
    memberCount: PropTypes.number,
    label: PropTypes.string,
    memberIds: PropTypes.arrayOf(PropTypes.string)
  }),
  selected: PropTypes.bool
};

export default ClusterNode;
