import React, { memo, useCallback, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { BaseEdge, getSmoothStepPath } from 'reactflow';
import BaseEdgeTooltip from './BaseEdgeTooltip';

/**
 * KnowledgeEdge
 *
 * Edge component for knowledge graph relationships (co-occurrence).
 * Shows a tooltip with shared concepts and strength.
 */
const KnowledgeEdge = memo(
  ({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition = 'right',
    targetPosition = 'left',
    data = null,
    style,
    markerEnd
  }) => {
    const [isHovered, setIsHovered] = useState(false);

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

    const [smoothPath, labelX, labelY] = getSmoothStepPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
      borderRadius: 16,
      centerX: (sourceX + targetX) / 2,
      centerY: (sourceY + targetY) / 2
    });

    const edgePath = elkPath || smoothPath;
    const weight = typeof data?.weight === 'number' ? data.weight : 0;
    const concepts = Array.isArray(data?.concepts) ? data.concepts : [];
    const sourceLabel = data?.sourceData?.label || '';
    const targetLabel = data?.targetData?.label || '';
    const tooltipsEnabled = data?.showEdgeTooltips !== false;

    const handleMouseEnter = useCallback(() => setIsHovered(true), []);
    const handleMouseLeave = useCallback(() => setIsHovered(false), []);

    const edgeStyle = {
      stroke: '#22c55e',
      strokeWidth: isHovered ? 2.5 : 1.5,
      strokeDasharray: '4 4',
      opacity: isHovered ? 1 : 0.8,
      filter: isHovered ? 'drop-shadow(0 0 4px #22c55e)' : 'none',
      transition: 'all 0.2s ease',
      ...style
    };

    const conceptPreview = concepts.slice(0, 4);

    return (
      <>
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
        <BaseEdge id={id} path={edgePath} style={edgeStyle} markerEnd={markerEnd} />
        {tooltipsEnabled && (
          <BaseEdgeTooltip
            isHovered={isHovered}
            labelX={labelX}
            labelY={labelY}
            badgeText="Knowledge"
            badgeColorClass="bg-emerald-50 text-emerald-700 border border-emerald-200"
            title="Why connected"
            headerColorClass="text-emerald-600"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            <div className="flex items-center gap-2">
              <span className="text-system-gray-500">Strength:</span>
              <span className="font-medium text-emerald-600">{weight}</span>
            </div>
            {conceptPreview.length > 0 ? (
              <div className="text-system-gray-600">
                Shared signals: {conceptPreview.join(', ')}
                {concepts.length > conceptPreview.length &&
                  ` +${concepts.length - conceptPreview.length} more`}
              </div>
            ) : (
              <div className="text-system-gray-500">Shared analysis metadata</div>
            )}
            {(sourceLabel || targetLabel) && (
              <div className="text-[11px] text-system-gray-500 pt-1 border-t border-system-gray-200">
                {sourceLabel && <div>A: {sourceLabel.slice(0, 50)}</div>}
                {targetLabel && <div>B: {targetLabel.slice(0, 50)}</div>}
              </div>
            )}
          </BaseEdgeTooltip>
        )}
      </>
    );
  }
);

KnowledgeEdge.displayName = 'KnowledgeEdge';

KnowledgeEdge.propTypes = {
  id: PropTypes.string.isRequired,
  sourceX: PropTypes.number.isRequired,
  sourceY: PropTypes.number.isRequired,
  targetX: PropTypes.number.isRequired,
  targetY: PropTypes.number.isRequired,
  sourcePosition: PropTypes.oneOf(['top', 'right', 'bottom', 'left']),
  targetPosition: PropTypes.oneOf(['top', 'right', 'bottom', 'left']),
  data: PropTypes.shape({
    weight: PropTypes.number,
    concepts: PropTypes.arrayOf(PropTypes.string),
    showEdgeTooltips: PropTypes.bool,
    elkSections: PropTypes.arrayOf(
      PropTypes.shape({
        startPoint: PropTypes.shape({
          x: PropTypes.number,
          y: PropTypes.number
        }),
        endPoint: PropTypes.shape({
          x: PropTypes.number,
          y: PropTypes.number
        }),
        bendPoints: PropTypes.arrayOf(
          PropTypes.shape({
            x: PropTypes.number,
            y: PropTypes.number
          })
        )
      })
    ),
    sourceData: PropTypes.shape({
      label: PropTypes.string
    }),
    targetData: PropTypes.shape({
      label: PropTypes.string
    })
  }),
  style: PropTypes.object,
  markerEnd: PropTypes.oneOfType([PropTypes.string, PropTypes.object])
};

export default KnowledgeEdge;
