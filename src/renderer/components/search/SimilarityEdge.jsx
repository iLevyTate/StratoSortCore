import React, { memo, useState, useCallback, useMemo } from 'react';
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

    // Memoize derived values to prevent unnecessary re-renders and fix useCallback dependencies
    const sourceTags = useMemo(() => sourceData.tags || [], [sourceData.tags]);
    const targetTags = useMemo(() => targetData.tags || [], [targetData.tags]);
    const commonTags = useMemo(
      () => sourceTags.filter((tag) => targetTags.includes(tag)),
      [sourceTags, targetTags]
    );

    // Categories
    const sourceCategory = sourceData.category || '';
    const targetCategory = targetData.category || '';
    const sameCategory = sourceCategory && sourceCategory === targetCategory;

    // Subjects
    const sourceSubject = sourceData.subject || '';
    const targetSubject = targetData.subject || '';
    const hasSubjects = sourceSubject || targetSubject;

    // Count relationship signals for edge thickness
    const relationshipStrength =
      (sameCategory ? 1 : 0) + (commonTags.length > 0 ? 1 : 0) + (hasSubjects ? 0.5 : 0);

    // Build explanation text (useMemo since it computes a value, not a callback)
    const explanation = useMemo(() => {
      const parts = [];

      if (sameCategory) {
        parts.push(`Both "${sourceCategory}"`);
      }

      if (commonTags.length > 0) {
        const tagList = commonTags.slice(0, 2).join(', ');
        parts.push(`Tags: ${tagList}`);
      }

      if (similarityPercent >= 85) {
        parts.push('Nearly identical');
      } else if (similarityPercent >= 70) {
        parts.push('Strongly related');
      } else if (similarityPercent >= 55) {
        parts.push('Related content');
      } else {
        parts.push('Some similarity');
      }

      return parts.join(' • ');
    }, [sameCategory, sourceCategory, commonTags, similarityPercent]);

    const handleMouseEnter = useCallback(() => setIsHovered(true), []);
    const handleMouseLeave = useCallback(() => setIsHovered(false), []);

    // Dynamic styling based on hover and relationship strength
    const baseWidth = 1 + relationshipStrength * 0.5;
    const edgeStyle = {
      ...style,
      stroke: isHovered ? '#059669' : relationshipStrength >= 2 ? '#10b981' : '#6ee7b7',
      strokeWidth: isHovered ? 2.5 : baseWidth,
      strokeDasharray: relationshipStrength >= 1.5 ? 'none' : '4 2',
      opacity: isHovered ? 1 : Math.max(0.5, similarity * 0.8 + relationshipStrength * 0.1),
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

                  {/* Subjects if available */}
                  {hasSubjects && (
                    <div className="space-y-0.5">
                      {sourceSubject && (
                        <div className="text-[11px]">
                          <span className="text-gray-500">A: </span>
                          <span className="text-amber-400 truncate">
                            {sourceSubject.slice(0, 40)}
                          </span>
                        </div>
                      )}
                      {targetSubject && (
                        <div className="text-[11px]">
                          <span className="text-gray-500">B: </span>
                          <span className="text-amber-400 truncate">
                            {targetSubject.slice(0, 40)}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Explanation */}
                  <div className="text-gray-300 italic text-[11px] pt-1 border-t border-gray-700">
                    {explanation}
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
  sourcePosition: PropTypes.oneOf(['top', 'right', 'bottom', 'left']),
  targetPosition: PropTypes.oneOf(['top', 'right', 'bottom', 'left']),
  data: PropTypes.shape({
    similarity: PropTypes.number,
    sourceData: PropTypes.shape({
      label: PropTypes.string,
      tags: PropTypes.arrayOf(PropTypes.string),
      category: PropTypes.string,
      subject: PropTypes.string
    }),
    targetData: PropTypes.shape({
      label: PropTypes.string,
      tags: PropTypes.arrayOf(PropTypes.string),
      category: PropTypes.string,
      subject: PropTypes.string
    })
  }),
  style: PropTypes.object,
  markerEnd: PropTypes.oneOfType([PropTypes.string, PropTypes.object])
};

export default SimilarityEdge;
