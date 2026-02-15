import React, { memo } from 'react';
import PropTypes from 'prop-types';
import { BaseEdge, getSmoothStepPath, EdgeLabelRenderer } from 'reactflow';
import { useElkPath } from './useEdgeInteraction';

/**
 * SmartStepEdge
 *
 * A custom edge component that uses smooth step pathing.
 * This provides cleaner orthogonal routing compared to default bezier curves,
 * especially for the hierarchical layout used in the graph.
 */
const SmartStepEdge = ({
  id: _id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  label = null,
  data
}) => {
  // Prefer ELK-routed path if available for collision avoidance
  const elkPath = useElkPath(data);

  const [smoothPath, smoothLabelX, smoothLabelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 16, // Increased border radius for smoother corners
    offset: 20 // Offset for the path to avoid hugging nodes too closely
  });

  const edgePath = elkPath || smoothPath;
  const labelX = smoothLabelX;
  const labelY = smoothLabelY;

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              background: 'white',
              padding: '2px 6px',
              borderRadius: 4,
              fontSize: 10,
              fontWeight: 500,
              border: '1px solid #e5e7eb',
              pointerEvents: 'none',
              zIndex: 10
            }}
            className="nodrag nopan"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
};

SmartStepEdge.propTypes = {
  id: PropTypes.string.isRequired,
  sourceX: PropTypes.number.isRequired,
  sourceY: PropTypes.number.isRequired,
  targetX: PropTypes.number.isRequired,
  targetY: PropTypes.number.isRequired,
  sourcePosition: PropTypes.string,
  targetPosition: PropTypes.string,
  style: PropTypes.object,
  markerEnd: PropTypes.oneOfType([PropTypes.string, PropTypes.object]),
  label: PropTypes.node,
  data: PropTypes.shape({
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
    )
  })
};

export default memo(SmartStepEdge);
