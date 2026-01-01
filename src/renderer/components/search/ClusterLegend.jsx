/**
 * ClusterLegend - Visual legend for cluster visualization
 *
 * Shows the meaning of different confidence levels, colors, and sizes
 * in the cluster graph visualization.
 */

import React, { memo } from 'react';
import PropTypes from 'prop-types';
import { Layers, FileText, HelpCircle } from 'lucide-react';

const ClusterLegend = memo(({ className = '', compact = false }) => {
  if (compact) {
    // Compact inline legend
    return (
      <div className={`flex items-center gap-3 text-[10px] text-system-gray-500 ${className}`}>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span>High</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-blue-500" />
          <span>Medium</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-gray-400" />
          <span>Low</span>
        </div>
        <div className="flex items-center gap-1 pl-2 border-l border-system-gray-200">
          <span className="text-amber-600">Size</span>
          <span>= file count</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`bg-white/90 backdrop-blur-sm border border-system-gray-200 rounded-lg p-3 ${className}`}
    >
      <div className="flex items-center gap-1.5 text-xs font-medium text-system-gray-700 mb-2">
        <HelpCircle className="w-3.5 h-3.5" />
        <span>Legend</span>
      </div>

      <div className="space-y-2">
        {/* Node types */}
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-system-gray-400 font-medium">
            Node Types
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <div className="w-4 h-4 rounded bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-300 flex items-center justify-center">
              <Layers className="w-2.5 h-2.5 text-amber-600" />
            </div>
            <span className="text-system-gray-600">Cluster</span>
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <div className="w-4 h-4 rounded bg-white border border-system-gray-200 flex items-center justify-center">
              <FileText className="w-2.5 h-2.5 text-stratosort-blue" />
            </div>
            <span className="text-system-gray-600">File</span>
          </div>
        </div>

        {/* Confidence levels */}
        <div className="space-y-1 pt-2 border-t border-system-gray-100">
          <div className="text-[10px] uppercase tracking-wider text-system-gray-400 font-medium">
            Cluster Confidence
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="px-1.5 py-0.5 rounded text-[9px] bg-emerald-100 text-emerald-700 border border-emerald-200">
              ● high
            </span>
            <span className="text-system-gray-500">Strong metadata match</span>
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="px-1.5 py-0.5 rounded text-[9px] bg-blue-100 text-blue-700 border border-blue-200">
              ◐ medium
            </span>
            <span className="text-system-gray-500">Partial match / LLM</span>
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="px-1.5 py-0.5 rounded text-[9px] bg-gray-100 text-gray-600 border border-gray-200">
              ○ low
            </span>
            <span className="text-system-gray-500">Fallback label</span>
          </div>
        </div>

        {/* Size meaning */}
        <div className="space-y-1 pt-2 border-t border-system-gray-100">
          <div className="text-[10px] uppercase tracking-wider text-system-gray-400 font-medium">
            Size
          </div>
          <div className="flex items-center gap-3 text-[11px]">
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded bg-amber-100 border border-amber-300" />
              <span className="text-system-gray-500">Few files</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-5 h-5 rounded bg-amber-100 border border-amber-300" />
              <span className="text-system-gray-500">Many files</span>
            </div>
          </div>
        </div>

        {/* Interactions */}
        <div className="space-y-1 pt-2 border-t border-system-gray-100">
          <div className="text-[10px] uppercase tracking-wider text-system-gray-400 font-medium">
            Interactions
          </div>
          <div className="text-[11px] text-system-gray-500 space-y-0.5">
            <div>
              <strong>Click</strong> to select
            </div>
            <div>
              <strong>Double-click</strong> cluster to expand
            </div>
            <div>
              <strong>Drag</strong> to rearrange
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

ClusterLegend.displayName = 'ClusterLegend';

ClusterLegend.propTypes = {
  className: PropTypes.string,
  compact: PropTypes.bool
};

export default ClusterLegend;
