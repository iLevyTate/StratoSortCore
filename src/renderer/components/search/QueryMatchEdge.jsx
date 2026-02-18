import React, { memo, useCallback, useMemo } from 'react';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath } from 'reactflow';
import PropTypes from 'prop-types';
import BaseEdgeTooltip from './BaseEdgeTooltip';
import { useEdgeHover } from './useEdgeInteraction';

/**
 * Custom edge component for query-to-file match connections
 * Shows WHY a file matched the search query (keywords, tags, semantic similarity)
 */
const QueryMatchEdge = memo(
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

    // Get the edge path
    // Position label 75% along the path (much closer to target file) to clearly associate score with file
    const [edgePath, labelX, labelY] = getSmoothStepPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
      borderRadius: 8,
      centerX: (sourceX + targetX * 3) / 4,
      centerY: (sourceY + targetY * 3) / 4
    });

    const score = data?.score ?? 0;
    const scorePercent = Math.round(score * 100);
    const matchDetails = useMemo(() => data?.matchDetails || {}, [data?.matchDetails]);
    // Fix: Depend on matchDetails object to ensure updates when parent changes
    const sources = useMemo(() => matchDetails.sources || [], [matchDetails]);
    const tooltipsEnabled = data?.showEdgeTooltips !== false;

    // Build match reason list for tooltip
    const buildMatchReasons = useCallback(() => {
      const reasons = [];

      // BM25 keyword matches
      if (matchDetails.matchedTerms?.length > 0) {
        const terms = matchDetails.matchedTerms.slice(0, 3).join('", "');
        reasons.push({ type: 'keyword', text: `Keywords: "${terms}"` });
      }

      // Tag matches from vector search
      if (matchDetails.queryTermsInTags?.length > 0) {
        const tags = matchDetails.queryTermsInTags.slice(0, 3).join(', ');
        reasons.push({ type: 'tag', text: `Tags: ${tags}` });
      }

      // Category match
      if (matchDetails.queryTermsInCategory) {
        reasons.push({ type: 'category', text: 'Category match' });
      }

      // Field-specific matches from BM25
      if (matchDetails.matchedFields?.length > 0) {
        const fieldLabels = {
          fileName: 'filename',
          subject: 'subject',
          summary: 'summary',
          extractedText: 'content',
          tags: 'tags',
          category: 'category'
        };
        const fields = matchDetails.matchedFields.map((f) => fieldLabels[f] || f).slice(0, 3);
        reasons.push({ type: 'field', text: `Found in: ${fields.join(', ')}` });
      }

      // Semantic similarity indicator
      if (sources.includes('vector') && matchDetails.semanticScore > 0.7) {
        reasons.push({ type: 'semantic', text: 'High semantic similarity' });
      } else if (sources.includes('vector') && matchDetails.semanticScore > 0.5) {
        reasons.push({ type: 'semantic', text: 'Related content' });
      }

      // Fallback if no specific reasons
      if (reasons.length === 0) {
        if (sources.includes('vector')) {
          reasons.push({ type: 'semantic', text: 'Semantic match' });
        } else if (sources.includes('bm25')) {
          reasons.push({ type: 'keyword', text: 'Keyword match' });
        } else {
          reasons.push({ type: 'default', text: 'Search match' });
        }
      }

      return reasons;
    }, [matchDetails, sources]);

    // Dynamic styling based on hover (uses theme stratosort-indigo)
    const edgeStyle = {
      ...style,
      stroke: 'var(--color-stratosort-indigo)',
      strokeWidth: isHovered ? 2.5 : 2,
      opacity: isHovered ? 1 : 0.8,
      filter: isHovered ? 'drop-shadow(0 0 4px rgba(79, 70, 229, 0.5))' : 'none',
      transition: 'all 0.2s ease'
    };

    const reasons = buildMatchReasons();

    // Color mapping for reason types
    const typeColors = {
      keyword: 'text-stratosort-accent',
      tag: 'text-stratosort-blue',
      category: 'text-stratosort-purple',
      field: 'text-stratosort-indigo',
      semantic: 'text-stratosort-success',
      default: 'text-system-gray-500'
    };

    const showCompactBadge = !tooltipsEnabled;

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
              <span className="px-1.5 py-0.5 rounded-full bg-stratosort-indigo/10 text-stratosort-indigo border border-stratosort-indigo/30 font-medium whitespace-nowrap">
                {scorePercent}%
              </span>
            </div>
          </EdgeLabelRenderer>
        )}

        {/* Edge label and tooltip */}
        {tooltipsEnabled && (
          <BaseEdgeTooltip
            isHovered={isHovered}
            labelX={labelX}
            labelY={labelY}
            badgeText={`${scorePercent}%`}
            badgeColorClass={
              isHovered
                ? 'bg-stratosort-indigo text-white'
                : 'bg-stratosort-indigo/10 text-stratosort-indigo'
            }
            title="Why this matched"
            headerColorClass="text-stratosort-indigo"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            {/* Match score */}
            <div className="flex items-center gap-2">
              <span className="text-system-gray-500">Relevance:</span>
              <span className="font-medium text-stratosort-indigo">{scorePercent}%</span>
              <div className="flex-1 h-1.5 bg-system-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-stratosort-indigo rounded-full"
                  style={{ width: `${scorePercent}%` }}
                />
              </div>
            </div>

            {/* Match reasons */}
            <div className="space-y-1">
              {reasons.map((reason) => (
                <div key={`${reason.type}:${reason.text}`} className="flex items-start gap-1.5">
                  <span className="text-system-gray-400 mt-0.5">•</span>
                  <span className={typeColors[reason.type] || 'text-system-gray-500'}>
                    {reason.text}
                  </span>
                </div>
              ))}
            </div>

            {/* Source indicator */}
            {sources.length > 0 && (
              <div className="text-system-gray-400 text-xs pt-1 border-t border-system-gray-200">
                Match sources: {sources.join(' + ')}
              </div>
            )}
          </BaseEdgeTooltip>
        )}
      </>
    );
  }
);

QueryMatchEdge.displayName = 'QueryMatchEdge';

QueryMatchEdge.propTypes = {
  id: PropTypes.string.isRequired,
  sourceX: PropTypes.number.isRequired,
  sourceY: PropTypes.number.isRequired,
  targetX: PropTypes.number.isRequired,
  targetY: PropTypes.number.isRequired,
  sourcePosition: PropTypes.oneOf(['top', 'right', 'bottom', 'left']),
  targetPosition: PropTypes.oneOf(['top', 'right', 'bottom', 'left']),
  data: PropTypes.shape({
    score: PropTypes.number,
    showEdgeTooltips: PropTypes.bool,
    matchDetails: PropTypes.shape({
      matchedTerms: PropTypes.arrayOf(PropTypes.string),
      matchedFields: PropTypes.arrayOf(PropTypes.string),
      semanticScore: PropTypes.number,
      queryTermsInTags: PropTypes.arrayOf(PropTypes.string),
      queryTermsInCategory: PropTypes.bool,
      sources: PropTypes.arrayOf(PropTypes.string)
    })
  }),
  style: PropTypes.object,
  markerEnd: PropTypes.oneOfType([PropTypes.string, PropTypes.object])
};

export default QueryMatchEdge;
