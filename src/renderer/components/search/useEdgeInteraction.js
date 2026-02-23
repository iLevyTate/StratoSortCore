/**
 * useEdgeInteraction
 *
 * Shared hooks and utilities for ReactFlow edge components.
 * Consolidates the ELK path calculation and hover interaction logic
 * that was previously duplicated across KnowledgeEdge, SimilarityEdge,
 * QueryMatchEdge, and SmartStepEdge.
 *
 * @module search/useEdgeInteraction
 */

import { useState, useCallback, useMemo } from 'react';

/**
 * Build an SVG path string from ELK-routed edge sections.
 * Returns null if no valid sections are provided, signalling
 * the caller should fall back to ReactFlow's built-in pathing.
 *
 * @param {Array|null|undefined} elkSections - ELK edge sections from layout
 * @param {number} parallelOffset - Perpendicular pixel offset for multi-edges
 * @returns {string|null} SVG path string or null
 */
export function buildElkPath(elkSections, parallelOffset = 0) {
  if (!elkSections || elkSections.length === 0) return null;

  // Shift all ELK points along a single edge-normal so parallel relations do not
  // render directly on top of each other for the same source/target pair.
  const firstSection = elkSections[0];
  const lastSection = elkSections[elkSections.length - 1];
  const dx = (lastSection?.endPoint?.x ?? 0) - (firstSection?.startPoint?.x ?? 0);
  const dy = (lastSection?.endPoint?.y ?? 0) - (firstSection?.startPoint?.y ?? 0);
  const length = Math.hypot(dx, dy) || 1;
  const normalX = -dy / length;
  const normalY = dx / length;
  const shiftX = normalX * parallelOffset;
  const shiftY = normalY * parallelOffset;

  return elkSections
    .map((section) => {
      let pathStr = `M ${section.startPoint.x + shiftX},${section.startPoint.y + shiftY}`;
      if (section.bendPoints) {
        section.bendPoints.forEach((bp) => {
          pathStr += ` L ${bp.x + shiftX},${bp.y + shiftY}`;
        });
      }
      pathStr += ` L ${section.endPoint.x + shiftX},${section.endPoint.y + shiftY}`;
      return pathStr;
    })
    .join(' ');
}

/**
 * Hook that memoizes the ELK path calculation for an edge.
 *
 * @param {object|null} data - Edge data from ReactFlow (must contain elkSections)
 * @returns {string|null} Memoized SVG path string or null
 */
export function useElkPath(data) {
  return useMemo(
    () => buildElkPath(data?.elkSections, Number(data?.parallelOffset || 0)),
    [data?.elkSections, data?.parallelOffset]
  );
}

/**
 * Hook that provides hover state and stable callbacks for edge interaction.
 *
 * @returns {{ isHovered: boolean, handleMouseEnter: Function, handleMouseLeave: Function }}
 */
export function useEdgeHover() {
  const [isHovered, setIsHovered] = useState(false);
  const handleMouseEnter = useCallback(() => setIsHovered(true), []);
  const handleMouseLeave = useCallback(() => setIsHovered(false), []);

  return { isHovered, handleMouseEnter, handleMouseLeave };
}
