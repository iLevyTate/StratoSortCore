/**
 * ClusterNode - ReactFlow node component for semantic clusters
 *
 * Displays a cluster as an expandable node in the graph visualization.
 * Shows cluster label, member count, confidence, and metadata preview.
 */

import React, { memo, useState, useCallback, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { Handle, Position } from 'reactflow';
import {
  Folder,
  ChevronRight,
  ChevronDown,
  Layers,
  Tag,
  FolderOpen,
  FolderPlus,
  MoreVertical,
  FolderInput,
  Download
} from 'lucide-react';

const ClusterNode = memo(({ data, selected }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  const isExpanded = data?.expanded || false;
  const memberCount = data?.memberCount || 0;
  const label = data?.label || 'Cluster';
  // Normalize confidence to valid values with fallback
  const rawConfidence = data?.confidence || 'low';
  const confidence = ['high', 'medium', 'low'].includes(rawConfidence) ? rawConfidence : 'low';
  const dominantCategory = data?.dominantCategory;
  const commonTags = data?.commonTags || [];
  const onCreateSmartFolder = data?.onCreateSmartFolder;
  const onMoveAllToFolder = data?.onMoveAllToFolder;
  const onExportFileList = data?.onExportFileList;

  // Close menu when clicking outside or pressing Escape
  useEffect(() => {
    if (!menuOpen) return undefined;
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    // FIX: Add keyboard accessibility - Escape key closes menu
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  const handleMenuAction = useCallback(
    (action) => {
      setMenuOpen(false);
      action?.(data);
    },
    [data]
  );

  // Confidence badge colors
  const confidenceColors = {
    high: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    medium: 'bg-blue-100 text-blue-700 border-blue-200',
    low: 'bg-gray-100 text-gray-600 border-gray-200'
  };

  // Scale node size based on member count (min: 180px, max: 280px)
  // Uses logarithmic scale for better visual distribution
  const baseWidth = 180;
  const maxWidth = 280;
  const scaleFactor = Math.min(1, Math.log10(memberCount + 1) / 2);
  const dynamicWidth = Math.round(baseWidth + scaleFactor * (maxWidth - baseWidth));

  // Scale padding slightly based on size
  const paddingClass = memberCount > 10 ? 'px-5 py-4' : 'px-4 py-3';

  return (
    <div
      className={`
        ${paddingClass} rounded-xl border-2 shadow-sm
        transition-all duration-200 cursor-pointer
        ${
          selected
            ? 'border-amber-500 bg-amber-50 shadow-md ring-2 ring-amber-200'
            : 'border-amber-300 bg-gradient-to-br from-amber-50 to-orange-50 hover:border-amber-400 hover:shadow-md'
        }
      `}
      style={{ minWidth: `${dynamicWidth}px`, maxWidth: `${dynamicWidth + 40}px` }}
    >
      <Handle type="target" position={Position.Left} className="!bg-amber-500 !w-2.5 !h-2.5" />

      {/* Header row with icon, label, and expand chevron */}
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
        {/* Context menu for cluster actions */}
        {(onCreateSmartFolder || onMoveAllToFolder || onExportFileList) && (
          <div className="relative" ref={menuRef}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((prev) => !prev);
              }}
              className="p-1 rounded hover:bg-amber-200/50 transition-colors"
              title="Cluster actions"
              aria-label="Cluster actions"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
            >
              <MoreVertical className="w-4 h-4 text-amber-600" />
            </button>

            {menuOpen && (
              <div
                role="menu"
                aria-label="Cluster actions"
                className="absolute right-0 top-7 bg-white shadow-lg rounded-lg border border-gray-200 z-50 w-48 py-1 animate-in fade-in zoom-in-95 duration-100"
              >
                {onCreateSmartFolder && (
                  <button
                    role="menuitem"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleMenuAction(onCreateSmartFolder);
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-amber-50 flex items-center gap-2"
                  >
                    <FolderPlus className="w-4 h-4 text-amber-600" />
                    Create Smart Folder
                  </button>
                )}
                {onMoveAllToFolder && (
                  <button
                    role="menuitem"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleMenuAction(onMoveAllToFolder);
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-amber-50 flex items-center gap-2"
                  >
                    <FolderInput className="w-4 h-4 text-blue-600" />
                    Move All to Folder...
                  </button>
                )}
                {onExportFileList && (
                  <button
                    role="menuitem"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleMenuAction(onExportFileList);
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-amber-50 flex items-center gap-2"
                  >
                    <Download className="w-4 h-4 text-green-600" />
                    Export File List
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        <div className="text-amber-500">
          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </div>
      </div>

      {/* Metadata preview section */}
      <div className="mt-2 pt-2 border-t border-amber-200/50 space-y-1.5">
        {/* Confidence badge */}
        <div className="flex items-center gap-1.5">
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded border ${confidenceColors[confidence]}`}
          >
            {confidence === 'high' ? '●' : confidence === 'medium' ? '◐' : '○'} {confidence}
          </span>
        </div>

        {/* Dominant category */}
        {dominantCategory && (
          <div className="flex items-center gap-1 text-[11px] text-gray-600">
            <FolderOpen className="w-3 h-3 text-amber-500" />
            <span className="truncate" title={dominantCategory}>
              {dominantCategory}
            </span>
          </div>
        )}

        {/* Common tags */}
        {commonTags.length > 0 && (
          <div className="flex items-start gap-1">
            <Tag className="w-3 h-3 text-blue-400 mt-0.5 flex-shrink-0" />
            <div className="flex flex-wrap gap-1">
              {commonTags.slice(0, 3).map((tag, idx) => (
                <span
                  key={`${tag}-${idx}`}
                  className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded"
                  title={tag}
                >
                  {tag.length > 12 ? `${tag.slice(0, 12)}…` : tag}
                </span>
              ))}
              {commonTags.length > 3 && (
                <span className="text-[10px] text-gray-400">+{commonTags.length - 3}</span>
              )}
            </div>
          </div>
        )}
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
    memberIds: PropTypes.arrayOf(PropTypes.string),
    confidence: PropTypes.oneOf(['high', 'medium', 'low']),
    dominantCategory: PropTypes.string,
    commonTags: PropTypes.arrayOf(PropTypes.string),
    onCreateSmartFolder: PropTypes.func,
    onMoveAllToFolder: PropTypes.func,
    onExportFileList: PropTypes.func
  }),
  selected: PropTypes.bool
};

export default ClusterNode;
