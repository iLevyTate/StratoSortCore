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
 * @returns {string|null} SVG path string or null
 */
export function buildElkPath(elkSections) {
  if (!elkSections || elkSections.length === 0) return null;

  return elkSections
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
}

/**
 * Hook that memoizes the ELK path calculation for an edge.
 *
 * @param {object|null} data - Edge data from ReactFlow (must contain elkSections)
 * @returns {string|null} Memoized SVG path string or null
 */
export function useElkPath(data) {
  return useMemo(() => buildElkPath(data?.elkSections), [data?.elkSections]);
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
