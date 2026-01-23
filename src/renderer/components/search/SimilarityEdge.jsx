import React, { memo, useState, useCallback, useMemo } from 'react';
import { BaseEdge, getSmoothStepPath } from 'reactflow';
import PropTypes from 'prop-types';
import BaseEdgeTooltip from './BaseEdgeTooltip';

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
    // Position label 66% along the path (closer to target) for better association
    const [edgePath, labelX, labelY] = getSmoothStepPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
      borderRadius: 8,
      centerX: (sourceX + targetX * 2) / 3,
      centerY: (sourceY + targetY * 2) / 3
    });

    const similarity = data?.similarity ?? 0;
    const similarityPercent = Math.round(similarity * 100);

    // Source and target metadata from data
    const sourceData = data?.sourceData || {};
    const targetData = data?.targetData || {};

    // Memoize derived values to prevent unnecessary re-renders
    // Use data?.sourceData?.tags directly to ensure stable dependency references
    const sourceTags = useMemo(() => data?.sourceData?.tags || [], [data?.sourceData?.tags]);
    const targetTags = useMemo(() => data?.targetData?.tags || [], [data?.targetData?.tags]);
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

    // Generate a concise relationship label for display on the edge
    const relationshipLabel = useMemo(() => {
      // Priority: shared tags > same category > similarity level
      if (commonTags.length > 0) {
        const tag = commonTags[0];
        return tag.length > 15 ? `${tag.slice(0, 15)}…` : tag;
      }
      if (sameCategory && sourceCategory) {
        const cat = sourceCategory;
        return cat.length > 15 ? `${cat.slice(0, 15)}…` : cat;
      }
      if (similarityPercent >= 85) return 'Near identical';
      if (similarityPercent >= 70) return 'Strongly related';
      if (similarityPercent >= 55) return 'Related';
      return null; // Don't show weak connections
    }, [commonTags, sameCategory, sourceCategory, similarityPercent]);

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
        <BaseEdgeTooltip
          isHovered={isHovered}
          labelX={labelX}
          labelY={labelY}
          badgeText={
            isHovered ? `${similarityPercent}%` : relationshipLabel || `${similarityPercent}%`
          }
          badgeColorClass={
            isHovered
              ? 'bg-emerald-500 text-white'
              : relationshipLabel
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : 'bg-emerald-100 text-emerald-700'
          }
          title="Relationship Analysis"
          headerColorClass="text-emerald-600"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {/* Similarity score */}
          <div className="flex items-center gap-2">
            <span className="text-system-gray-500">Similarity:</span>
            <span className="font-medium text-emerald-600">{similarityPercent}%</span>
            <div className="flex-1 h-1.5 bg-system-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full"
                style={{ width: `${similarityPercent}%` }}
              />
            </div>
          </div>

          {/* Common tags */}
          {commonTags.length > 0 && (
            <div>
              <span className="text-system-gray-500">Common tags: </span>
              <span className="text-blue-600">
                {commonTags.slice(0, 4).join(', ')}
                {commonTags.length > 4 && ` +${commonTags.length - 4} more`}
              </span>
            </div>
          )}

          {/* Category match */}
          {sameCategory && (
            <div>
              <span className="text-system-gray-500">Category: </span>
              <span className="text-purple-600">{sourceCategory}</span>
            </div>
          )}

          {/* Subjects if available */}
          {hasSubjects && (
            <div className="space-y-0.5">
              {sourceSubject && (
                <div className="text-[11px]">
                  <span className="text-system-gray-500">A: </span>
                  <span className="text-amber-600 truncate">{sourceSubject.slice(0, 40)}</span>
                </div>
              )}
              {targetSubject && (
                <div className="text-[11px]">
                  <span className="text-system-gray-500">B: </span>
                  <span className="text-amber-600 truncate">{targetSubject.slice(0, 40)}</span>
                </div>
              )}
            </div>
          )}

          {/* Explanation */}
          <div className="text-system-gray-500 italic text-[11px] pt-1 border-t border-system-gray-200">
            {explanation}
          </div>
        </BaseEdgeTooltip>
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
