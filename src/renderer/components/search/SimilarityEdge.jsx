import React, { memo, useState, useCallback, useMemo } from 'react';
import { BaseEdge, getSmoothStepPath, EdgeLabelRenderer } from 'reactflow';
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
    // Prefer ELK-routed path if available for collision avoidance
    const elkPath = useMemo(() => {
      const sections = data?.elkSections;
      if (!sections || sections.length === 0) return null;

      return sections
        .map((section) => {
          let pathStr = `M ${section.startPoint.x},${section.startPoint.y}`;
          if (section.bendPoints) {
            section.bendPoints.forEach((bp) => {
              pathStr += ` L ${bp.x},${bp.y}`;
            });
          }
          pathStr += ` L ${section.endPoint.x},${section.endPoint.y}`;
          return pathStr;
        })
        .join(' ');
    }, [data?.elkSections]);

    // Fallback to ReactFlow's path routing if ELK path is missing
    const [smoothPath, smoothLabelX, smoothLabelY] = getSmoothStepPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
      borderRadius: 16, // Smoother corners
      centerX: (sourceX + targetX) / 2,
      centerY: (sourceY + targetY) / 2
    });

    const edgePath = elkPath || smoothPath;

    // For label position, if we have a custom path, we might want to calculate it more precisely
    // But for now, using the smooth step midpoint is a reasonable approximation
    const labelX = smoothLabelX;
    const labelY = smoothLabelY;

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

    // Determine primary relationship type and reason
    const {
      primaryType,
      labelText,
      strokeColor,
      showLabel: logicalShowLabel
    } = useMemo(() => {
      // 1. Shared Tags (Strongest logic)
      if (commonTags.length > 0) {
        const tagLabel = commonTags[0];
        return {
          primaryType: 'tag',
          labelText:
            commonTags.length > 1
              ? `Shared: ${tagLabel} +${commonTags.length - 1}`
              : `Shared: ${tagLabel}`,
          strokeColor: '#3b82f6', // Blue-500
          showLabel: true
        };
      }

      // 2. Same Category (Structural logic)
      if (sameCategory && sourceCategory !== 'Uncategorized') {
        return {
          primaryType: 'category',
          labelText: `${sourceCategory}`,
          strokeColor: '#8b5cf6', // Violet-500
          showLabel: true
        };
      }

      // 3. High Similarity (Content logic)
      if (similarityPercent >= 85) {
        return {
          primaryType: 'content',
          labelText: 'Near Identical',
          strokeColor: '#10b981', // Emerald-500
          showLabel: true
        };
      }

      // 4. Moderate Similarity (Fuzzy logic)
      return {
        primaryType: 'similarity',
        labelText: `${similarityPercent}% Match`,
        strokeColor: '#cbd5e1', // Slate-300 (Subtle)
        showLabel: false // Hide label for weak/generic connections to reduce clutter
      };
    }, [commonTags, sameCategory, sourceCategory, similarityPercent]);

    // Apply user preference for label visibility
    // Default to true if not specified (legacy behavior)
    const showLabel = logicalShowLabel && (data?.showEdgeLabels ?? true);

    const handleMouseEnter = useCallback(() => setIsHovered(true), []);
    const handleMouseLeave = useCallback(() => setIsHovered(false), []);

    // Dynamic styling based on hover and relationship strength
    const baseWidth = 1 + relationshipStrength * 0.5;
    const edgeStyle = {
      ...style,
      stroke: isHovered ? strokeColor : strokeColor, // Use the semantic color
      strokeWidth: isHovered ? 2.5 : baseWidth,
      strokeDasharray: primaryType === 'similarity' ? '4 4' : 'none', // Dash only purely similar edges
      opacity: isHovered ? 1 : primaryType === 'similarity' ? 0.6 : 0.8,
      filter: isHovered ? `drop-shadow(0 0 4px ${strokeColor})` : 'none',
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

        {/* Persistent Verbal Label (only for strong connections) */}
        {showLabel && (
          <EdgeLabelRenderer>
            <div
              style={{
                position: 'absolute',
                transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
                fontSize: 10,
                pointerEvents: 'all',
                zIndex: 10
              }}
              className="nodrag nopan"
            >
              <div
                className={`
                  px-2 py-0.5 rounded-full border shadow-sm font-medium whitespace-nowrap transition-all duration-200
                  ${isHovered ? 'scale-110 z-20' : 'scale-100'}
                  ${
                    primaryType === 'tag'
                      ? 'bg-blue-50 border-blue-200 text-blue-700'
                      : primaryType === 'category'
                        ? 'bg-violet-50 border-violet-200 text-violet-700'
                        : primaryType === 'content'
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                          : 'bg-white border-slate-200 text-slate-500'
                  }
                `}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
              >
                {labelText}
              </div>
            </div>
          </EdgeLabelRenderer>
        )}

        {/* Edge label and tooltip */}
        <BaseEdgeTooltip
          isHovered={isHovered}
          labelX={labelX}
          labelY={labelY}
          badgeText={labelText}
          badgeColorClass={
            primaryType === 'tag'
              ? 'bg-blue-50 text-blue-700 border border-blue-200'
              : primaryType === 'category'
                ? 'bg-violet-50 text-violet-700 border border-violet-200'
                : primaryType === 'content'
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'bg-slate-100 text-slate-500 border border-slate-200'
          }
          title={
            primaryType === 'tag'
              ? 'Shared Tags'
              : primaryType === 'category'
                ? 'Same Category'
                : 'Content Similarity'
          }
          headerColorClass={
            primaryType === 'tag'
              ? 'text-blue-600'
              : primaryType === 'category'
                ? 'text-violet-600'
                : 'text-emerald-600'
          }
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {/* Detailed Explanation Content */}
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
