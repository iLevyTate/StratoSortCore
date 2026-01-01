import React, { memo, useState, useCallback, useMemo } from 'react';
import { BaseEdge, getSmoothStepPath, EdgeLabelRenderer } from 'reactflow';
import PropTypes from 'prop-types';

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

    const score = data?.score ?? 0;
    const scorePercent = Math.round(score * 100);
    const matchDetails = useMemo(() => data?.matchDetails || {}, [data?.matchDetails]);
    // Fix: Depend on matchDetails object to ensure updates when parent changes
    const sources = useMemo(() => matchDetails.sources || [], [matchDetails]);

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

    const handleMouseEnter = useCallback(() => setIsHovered(true), []);
    const handleMouseLeave = useCallback(() => setIsHovered(false), []);

    // Dynamic styling based on hover
    const edgeStyle = {
      ...style,
      stroke: isHovered ? '#4f46e5' : '#6366f1',
      strokeWidth: isHovered ? 2.5 : 2,
      opacity: isHovered ? 1 : 0.8,
      filter: isHovered ? 'drop-shadow(0 0 4px rgba(99, 102, 241, 0.5))' : 'none',
      transition: 'all 0.2s ease'
    };

    const reasons = buildMatchReasons();

    // Color mapping for reason types
    const typeColors = {
      keyword: 'text-amber-400',
      tag: 'text-blue-400',
      category: 'text-purple-400',
      field: 'text-cyan-400',
      semantic: 'text-emerald-400',
      default: 'text-gray-300'
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
            {/* Score badge */}
            <div
              className={`
                px-1.5 py-0.5 rounded text-[10px] font-medium cursor-pointer
                transition-all duration-200
                ${
                  isHovered
                    ? 'bg-indigo-500 text-white shadow-lg scale-110'
                    : 'bg-indigo-100 text-indigo-700'
                }
              `}
            >
              {scorePercent}%
            </div>

            {/* Tooltip on hover */}
            {isHovered && (
              <div
                className="absolute left-1/2 -translate-x-1/2 mt-2 z-50"
                style={{ minWidth: '200px', maxWidth: '280px' }}
              >
                <div className="bg-gray-900 text-white text-xs rounded-lg shadow-xl p-3 space-y-2">
                  {/* Header */}
                  <div className="font-semibold text-indigo-400 border-b border-gray-700 pb-1.5">
                    Why this matched
                  </div>

                  {/* Match score */}
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400">Relevance:</span>
                    <span className="font-medium text-indigo-400">{scorePercent}%</span>
                    <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-indigo-500 rounded-full"
                        style={{ width: `${scorePercent}%` }}
                      />
                    </div>
                  </div>

                  {/* Match reasons */}
                  <div className="space-y-1">
                    {reasons.map((reason, idx) => (
                      <div key={idx} className="flex items-start gap-1.5">
                        <span className="text-gray-500 mt-0.5">•</span>
                        <span className={typeColors[reason.type] || 'text-gray-300'}>
                          {reason.text}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Source indicator */}
                  {sources.length > 0 && (
                    <div className="text-gray-500 text-[10px] pt-1 border-t border-gray-700">
                      Match sources: {sources.join(' + ')}
                    </div>
                  )}

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

QueryMatchEdge.displayName = 'QueryMatchEdge';

QueryMatchEdge.propTypes = {
  id: PropTypes.string.isRequired,
  sourceX: PropTypes.number.isRequired,
  sourceY: PropTypes.number.isRequired,
  targetX: PropTypes.number.isRequired,
  targetY: PropTypes.number.isRequired,
  sourcePosition: PropTypes.string,
  targetPosition: PropTypes.string,
  data: PropTypes.shape({
    score: PropTypes.number,
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
