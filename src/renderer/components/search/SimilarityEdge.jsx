import React, { memo, useMemo } from 'react';
import { BaseEdge, getSmoothStepPath, EdgeLabelRenderer } from 'reactflow';
import PropTypes from 'prop-types';
import { Zap } from 'lucide-react';
import BaseEdgeTooltip from './BaseEdgeTooltip';
import { useElkPath, useEdgeHover } from './useEdgeInteraction';
import { Text } from '../ui/Typography';

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
    const { isHovered, handleMouseEnter, handleMouseLeave } = useEdgeHover();
    const elkPath = useElkPath(data);

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

    const isCrossCluster = data?.kind === 'cross_cluster';
    const similarity = data?.similarity ?? 0;
    const similarityPercent = Math.round(similarity * 100);
    const tooltipsEnabled = data?.showEdgeTooltips !== false;

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
      showLabel: logicalShowLabel,
      badgeTitle
    } = useMemo(() => {
      if (isCrossCluster) {
        const bridgeLabel =
          data?.bridgeCount && data.bridgeCount > 0
            ? `Bridge (${data.bridgeCount})`
            : 'Cluster Bridge';
        return {
          primaryType: 'cross',
          labelText: bridgeLabel,
          strokeColor: '#9ca3af',
          showLabel: false,
          badgeTitle: 'Clusters are related'
        };
      }
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
          showLabel: true,
          badgeTitle: 'Shared tags'
        };
      }

      // 2. Same Category (Structural logic)
      if (sameCategory && sourceCategory !== 'Uncategorized') {
        return {
          primaryType: 'category',
          labelText: `${sourceCategory}`,
          strokeColor: '#8b5cf6', // Violet-500
          showLabel: true,
          badgeTitle: 'Same category'
        };
      }

      // 3. High Similarity (Content logic)
      if (similarityPercent >= 85) {
        return {
          primaryType: 'content',
          labelText: 'Near Identical',
          strokeColor: '#10b981', // Emerald-500
          showLabel: true,
          badgeTitle: 'High similarity'
        };
      }

      // 4. Moderate Similarity (Fuzzy logic)
      return {
        primaryType: 'similarity',
        labelText: `${similarityPercent}% Match`,
        strokeColor: '#cbd5e1', // Slate-300 (Subtle)
        showLabel: false, // Hide label for weak/generic connections to reduce clutter
        badgeTitle: 'Similarity'
      };
    }, [
      commonTags,
      sameCategory,
      sourceCategory,
      similarityPercent,
      data?.bridgeCount,
      isCrossCluster
    ]);

    // Apply user preference for label visibility
    // Default to true if not specified (legacy behavior)
    const showLabel = logicalShowLabel && (data?.showEdgeLabels ?? true);

    // Dynamic styling based on hover and relationship strength
    const baseWidth = 1 + relationshipStrength * 0.5;
    const edgeStyle = {
      ...style,
      stroke: isHovered ? strokeColor : strokeColor, // Use the semantic color
      strokeWidth: isHovered ? 2.5 : baseWidth,
      strokeDasharray: primaryType === 'similarity' || primaryType === 'cross' ? '4 4' : 'none', // Dash only purely similar edges
      opacity: isHovered ? 1 : primaryType === 'similarity' ? 0.6 : 0.8,
      filter: isHovered ? `drop-shadow(0 0 4px ${strokeColor})` : 'none',
      transition: 'all 0.2s ease'
    };

    const compactLabelText =
      primaryType === 'cross'
        ? `Bridge ${similarityPercent}%`
        : primaryType === 'tag'
          ? `Tag ${similarityPercent}%`
          : primaryType === 'category'
            ? `${sourceCategory || 'Category'}`
            : `${similarityPercent}%`;
    const showCompactBadge =
      !tooltipsEnabled &&
      (isCrossCluster || commonTags.length > 0 || sameCategory || similarityPercent >= 65);
    const isSurpriseEdge = data?.isSurprise === true;

    return (
      <>
        {/* Invisible wider path for easier hovering */}
        {tooltipsEnabled && (
          <path
            d={edgePath}
            fill="none"
            stroke="transparent"
            strokeWidth={20}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            style={{ cursor: 'pointer' }}
          />
        )}

        {/* Visible edge */}
        <BaseEdge id={id} path={edgePath} style={edgeStyle} markerEnd={markerEnd} />

        {/* Lightweight fallback badge for large graphs */}
        {showCompactBadge && (
          <EdgeLabelRenderer>
            <div
              style={{
                position: 'absolute',
                transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
                fontSize: 10,
                pointerEvents: 'none',
                zIndex: 6
              }}
              className="nodrag nopan"
            >
              <span className="px-1.5 py-0.5 rounded-full bg-system-gray-50 text-system-gray-700 border border-system-gray-200 font-medium whitespace-nowrap">
                {compactLabelText}
              </span>
            </div>
          </EdgeLabelRenderer>
        )}

        {/* Surprise badge for high-similarity, distant-folder connections */}
        {isSurpriseEdge && (
          <EdgeLabelRenderer>
            <div
              style={{
                position: 'absolute',
                transform: `translate(-50%, -50%) translate(${labelX + 20}px,${labelY - 16}px)`,
                pointerEvents: 'none',
                zIndex: 11
              }}
              className="nodrag nopan"
            >
              <span className="inline-flex items-center gap-1 rounded-full border border-stratosort-accent/30 bg-stratosort-accent/10 px-1.5 py-0.5 text-xs font-medium text-stratosort-accent">
                <Zap className="h-2.5 w-2.5" />
                Surprise
              </span>
            </div>
          </EdgeLabelRenderer>
        )}

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
                      ? 'bg-stratosort-blue/10 border-stratosort-blue/30 text-stratosort-blue'
                      : primaryType === 'category'
                        ? 'bg-stratosort-purple/10 border-stratosort-purple/30 text-stratosort-purple'
                        : primaryType === 'content'
                          ? 'bg-stratosort-success/10 border-stratosort-success/30 text-stratosort-success'
                          : 'bg-white border-system-gray-200 text-system-gray-500'
                  }
                `}
                onMouseEnter={tooltipsEnabled ? handleMouseEnter : undefined}
                onMouseLeave={tooltipsEnabled ? handleMouseLeave : undefined}
              >
                {labelText}
              </div>
            </div>
          </EdgeLabelRenderer>
        )}

        {/* Edge label and tooltip */}
        {tooltipsEnabled && (
          <BaseEdgeTooltip
            isHovered={isHovered}
            labelX={labelX}
            labelY={labelY}
            badgeText={labelText}
            badgeColorClass={
              primaryType === 'tag'
                ? 'bg-stratosort-blue/10 text-stratosort-blue border border-stratosort-blue/30'
                : primaryType === 'category'
                  ? 'bg-stratosort-purple/10 text-stratosort-purple border border-stratosort-purple/30'
                  : primaryType === 'content'
                    ? 'bg-stratosort-success/10 border-stratosort-success/30 text-stratosort-success'
                    : primaryType === 'cross'
                      ? 'bg-system-gray-50 text-system-gray-700 border border-system-gray-200'
                      : 'bg-system-gray-100 text-system-gray-500 border border-system-gray-200'
            }
            title={
              badgeTitle || (primaryType === 'cross' ? 'Cluster Bridge' : 'Content Similarity')
            }
            headerColorClass={
              primaryType === 'tag'
                ? 'text-stratosort-blue'
                : primaryType === 'category'
                  ? 'text-stratosort-purple'
                  : primaryType === 'cross'
                    ? 'text-system-gray-600'
                    : 'text-stratosort-success'
            }
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            {!isCrossCluster ? (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-system-gray-500">Similarity:</span>
                  <span className="font-medium text-stratosort-success">{similarityPercent}%</span>
                  <div className="flex-1 h-1.5 bg-system-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-stratosort-success rounded-full"
                      style={{ width: `${similarityPercent}%` }}
                    />
                  </div>
                </div>

                {commonTags.length > 0 && (
                  <div>
                    <span className="text-system-gray-500">Common tags: </span>
                    <span className="text-stratosort-blue">
                      {commonTags.slice(0, 4).join(', ')}
                      {commonTags.length > 4 && ` +${commonTags.length - 4} more`}
                    </span>
                  </div>
                )}

                {sameCategory && (
                  <div>
                    <span className="text-system-gray-500">Category: </span>
                    <span className="text-stratosort-purple">{sourceCategory}</span>
                  </div>
                )}

                {hasSubjects && (
                  <div className="space-y-0.5">
                    {sourceSubject && (
                      <Text as="div" variant="tiny">
                        <span className="text-system-gray-500">A: </span>
                        <span className="text-stratosort-accent truncate">
                          {sourceSubject.slice(0, 40)}
                        </span>
                      </Text>
                    )}
                    {targetSubject && (
                      <Text as="div" variant="tiny">
                        <span className="text-system-gray-500">B: </span>
                        <span className="text-stratosort-accent truncate">
                          {targetSubject.slice(0, 40)}
                        </span>
                      </Text>
                    )}
                  </div>
                )}

                <Text
                  as="div"
                  variant="tiny"
                  className="text-system-gray-500 italic pt-1 border-t border-system-gray-200"
                >
                  {explanation}
                </Text>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-system-gray-500">Bridge strength:</span>
                  <span className="font-medium text-system-gray-700">{similarityPercent}%</span>
                </div>
                {Array.isArray(data?.sharedTerms) && data.sharedTerms.length > 0 && (
                  <Text as="div" variant="tiny" className="text-system-gray-600">
                    Shared terms: {data.sharedTerms.slice(0, 4).join(', ')}
                  </Text>
                )}
                {data?.bridgeCount > 0 && (
                  <Text as="div" variant="tiny" className="text-system-gray-600">
                    Bridge files: {data.bridgeCount}
                  </Text>
                )}
              </>
            )}
          </BaseEdgeTooltip>
        )}
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
    showEdgeLabels: PropTypes.bool,
    showEdgeTooltips: PropTypes.bool,
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
    }),
    isSurprise: PropTypes.bool
  }),
  style: PropTypes.object,
  markerEnd: PropTypes.oneOfType([PropTypes.string, PropTypes.object])
};

export default SimilarityEdge;
