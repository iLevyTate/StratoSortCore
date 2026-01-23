import React, { memo } from 'react';
import PropTypes from 'prop-types';
import { EdgeLabelRenderer } from 'reactflow';

/**
 * Shared tooltip component for edges in the graph visualization.
 * Handles positioning, hover state, and common styling.
 */
const BaseEdgeTooltip = memo(
  ({
    isHovered,
    labelX,
    labelY,
    badgeText,
    badgeColorClass,
    title,
    headerColorClass,
    onMouseEnter,
    onMouseLeave,
    children
  }) => {
    return (
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan"
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
            zIndex: isHovered ? 1000 : 1
          }}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
        >
          {/* Badge */}
          <div
            className={`
              px-1.5 py-0.5 rounded text-[10px] font-medium cursor-pointer
              transition-all duration-200
              ${badgeColorClass}
              ${isHovered ? 'shadow-lg scale-110' : ''}
            `}
          >
            {badgeText}
          </div>

          {/* Tooltip on hover */}
          {isHovered && (
            <div
              className="absolute left-1/2 -translate-x-1/2 mt-2 z-50"
              style={{ minWidth: '200px', maxWidth: '280px' }}
            >
              <div className="bg-white/95 backdrop-blur-md text-system-gray-700 text-xs rounded-xl shadow-xl border border-system-gray-200 p-3 space-y-2 animate-in fade-in zoom-in-95 duration-150">
                {/* Header */}
                <div
                  className={`font-semibold border-b border-system-gray-100 pb-1.5 ${headerColorClass}`}
                >
                  {title}
                </div>

                {/* Content */}
                {children}

                {/* Arrow pointing up */}
                <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-white border-t border-l border-system-gray-200 rotate-45" />
              </div>
            </div>
          )}
        </div>
      </EdgeLabelRenderer>
    );
  }
);

BaseEdgeTooltip.displayName = 'BaseEdgeTooltip';

BaseEdgeTooltip.propTypes = {
  isHovered: PropTypes.bool.isRequired,
  labelX: PropTypes.number.isRequired,
  labelY: PropTypes.number.isRequired,
  badgeText: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  badgeColorClass: PropTypes.string.isRequired,
  title: PropTypes.string.isRequired,
  headerColorClass: PropTypes.string,
  onMouseEnter: PropTypes.func,
  onMouseLeave: PropTypes.func,
  children: PropTypes.node
};

BaseEdgeTooltip.defaultProps = {
  headerColorClass: 'text-system-gray-900',
  onMouseEnter: null,
  onMouseLeave: null,
  children: null
};

export default BaseEdgeTooltip;
