import React, { memo, useState, useCallback } from 'react';
import { BaseEdge, getSmoothStepPath, EdgeLabelRenderer } from 'reactflow';
import PropTypes from 'prop-types';

/**
 * Custom edge component for similarity connections with hover tooltip
 * Shows common keywords, categories, and explanation on hover
 */
const SimilarityEdge = memo(
  ({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
    style,
    markerEnd
  }) => {
    const [isHovered, setIsHovered] = useState(false);

    // Get the edge path
    const [edgePath, labelX, labelY] = getSmoothStepPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
      borderRadius: 8
    });

    const similarity = data?.similarity ?? 0;
    const similarityPercent = Math.round(similarity * 100);

    // Source and target metadata from data
    const sourceData = data?.sourceData || {};
    const targetData = data?.targetData || {};

    // Find common tags/keywords
    const sourceTags = sourceData.tags || [];
    const targetTags = targetData.tags || [];
    const commonTags = sourceTags.filter((tag) => targetTags.includes(tag));

    // Categories
    const sourceCategory = sourceData.category || '';
    const targetCategory = targetData.category || '';
    const sameCategory = sourceCategory && sourceCategory === targetCategory;

    // Build explanation text
    const buildExplanation = useCallback(() => {
      const parts = [];

      if (sameCategory) {
        parts.push(`Both in "${sourceCategory}"`);
      }

      if (commonTags.length > 0) {
        const tagList = commonTags.slice(0, 3).join(', ');
        parts.push(`Share tags: ${tagList}`);
      }

      if (similarityPercent >= 80) {
        parts.push('Very similar content');
      } else if (similarityPercent >= 60) {
        parts.push('Related topics');
      } else {
        parts.push('Some overlap');
      }

      return parts.join(' • ');
    }, [sameCategory, sourceCategory, commonTags, similarityPercent]);

    const handleMouseEnter = useCallback(() => setIsHovered(true), []);
    const handleMouseLeave = useCallback(() => setIsHovered(false), []);

    // Dynamic styling based on hover
    const edgeStyle = {
      ...style,
      stroke: isHovered ? '#059669' : '#10b981',
      strokeWidth: isHovered ? 2.5 : 1.5,
      strokeDasharray: isHovered ? 'none' : '4 2',
      opacity: isHovered ? 1 : Math.max(0.4, similarity),
      filter: isHovered ? 'drop-shadow(0 0 4px rgba(16, 185, 129, 0.5))' : 'none',
      transition: 'all 0.2s ease'
    };

    return (
      <>
        {/* Invisible wider path for easier hovering */}
        <path
          d={edgePath}
          fill="none"
          stroke="transparent"
          strokeWidth={20}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          style={{ cursor: 'pointer' }}
        />

        {/* Visible edge */}
        <BaseEdge id={id} path={edgePath} style={edgeStyle} markerEnd={markerEnd} />

        {/* Edge label and tooltip */}
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
              zIndex: isHovered ? 1000 : 1
            }}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            {/* Percentage badge */}
            <div
              className={`
                px-1.5 py-0.5 rounded text-[10px] font-medium cursor-pointer
                transition-all duration-200
                ${
                  isHovered
                    ? 'bg-emerald-500 text-white shadow-lg scale-110'
                    : 'bg-emerald-100 text-emerald-700'
                }
              `}
            >
              {similarityPercent}%
            </div>

            {/* Tooltip on hover */}
            {isHovered && (
              <div
                className="absolute left-1/2 -translate-x-1/2 mt-2 z-50"
                style={{ minWidth: '200px', maxWidth: '280px' }}
              >
                <div className="bg-gray-900 text-white text-xs rounded-lg shadow-xl p-3 space-y-2">
                  {/* Header */}
                  <div className="font-semibold text-emerald-400 border-b border-gray-700 pb-1.5">
                    Connection Details
                  </div>

                  {/* Similarity score */}
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400">Similarity:</span>
                    <span className="font-medium text-emerald-400">{similarityPercent}%</span>
                    <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full"
                        style={{ width: `${similarityPercent}%` }}
                      />
                    </div>
                  </div>

                  {/* Common tags */}
                  {commonTags.length > 0 && (
                    <div>
                      <span className="text-gray-400">Common tags: </span>
                      <span className="text-blue-400">
                        {commonTags.slice(0, 4).join(', ')}
                        {commonTags.length > 4 && ` +${commonTags.length - 4} more`}
                      </span>
                    </div>
                  )}

                  {/* Category match */}
                  {sameCategory && (
                    <div>
                      <span className="text-gray-400">Category: </span>
                      <span className="text-purple-400">{sourceCategory}</span>
                    </div>
                  )}

                  {/* Explanation */}
                  <div className="text-gray-300 italic text-[11px] pt-1 border-t border-gray-700">
                    {buildExplanation()}
                  </div>

                  {/* Arrow pointing up */}
                  <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-gray-900 rotate-45" />
                </div>
              </div>
            )}
          </div>
        </EdgeLabelRenderer>
      </>
    );
  }
);

SimilarityEdge.displayName = 'SimilarityEdge';

SimilarityEdge.propTypes = {
  id: PropTypes.string.isRequired,
  sourceX: PropTypes.number.isRequired,
  sourceY: PropTypes.number.isRequired,
  targetX: PropTypes.number.isRequired,
  targetY: PropTypes.number.isRequired,
  sourcePosition: PropTypes.string,
  targetPosition: PropTypes.string,
  data: PropTypes.shape({
    similarity: PropTypes.number,
    sourceData: PropTypes.shape({
      tags: PropTypes.arrayOf(PropTypes.string),
      category: PropTypes.string
    }),
    targetData: PropTypes.shape({
      tags: PropTypes.arrayOf(PropTypes.string),
      category: PropTypes.string
    })
  }),
  style: PropTypes.object,
  markerEnd: PropTypes.string
};

export default SimilarityEdge;
