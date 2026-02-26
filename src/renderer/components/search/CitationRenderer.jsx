import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import PropTypes from 'prop-types';
import { createPortal } from 'react-dom';
import { Button } from '../ui';
import CitationPreview from './CitationPreview';

/** Pre-compiled regex — avoids re-creating on every render. */
const CITATION_SPLIT_RE = /(\[doc-\d+\])/g;
const CITATION_MATCH_RE = /^\[(doc-\d+)\]$/;

/** Clamp the preview position so it stays within the visible viewport. */
function clampPreviewPosition(rect) {
  const PREVIEW_W = 320; // matches CitationPreview w-80
  const PREVIEW_H_EST = 280; // estimated max height of preview card
  const MARGIN = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = rect.left;
  if (left + PREVIEW_W > vw - MARGIN) {
    left = Math.max(MARGIN, vw - PREVIEW_W - MARGIN);
  }
  if (left < MARGIN) left = MARGIN;

  // Prefer showing above the citation; fall back to below if not enough room
  let top = rect.top - 10;
  let flipBelow = false;
  if (top - PREVIEW_H_EST < MARGIN) {
    top = rect.bottom + 10;
    flipBelow = true;
  }
  // If below would also overflow, clamp to bottom
  if (flipBelow && top + PREVIEW_H_EST > vh - MARGIN) {
    top = vh - PREVIEW_H_EST - MARGIN;
  }

  return { top, left, flipBelow };
}

export default function CitationRenderer({ text, sources, onOpenSource }) {
  const [hoveredCitation, setHoveredCitation] = useState(null);
  const [previewPos, setPreviewPos] = useState({ top: 0, left: 0, flipBelow: false });
  const timeoutRef = useRef(null);

  const sourceById = useMemo(() => new Map((sources || []).map((s) => [s.id, s])), [sources]);

  const handleMouseEnter = useCallback((e, docId) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    const rect = e.currentTarget.getBoundingClientRect();
    setPreviewPos(clampPreviewPosition(rect));
    setHoveredCitation(docId);
  }, []);

  const handleMouseLeave = useCallback(() => {
    timeoutRef.current = setTimeout(() => {
      setHoveredCitation(null);
    }, 300);
  }, []);

  const cancelDismiss = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  const dismissPreview = useCallback(() => setHoveredCitation(null), []);

  // Cleanup timeout
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  if (!text) return null;

  const parts = text.split(CITATION_SPLIT_RE);

  return (
    <>
      <span>
        {parts.map((part, i) => {
          const match = part.match(CITATION_MATCH_RE);
          if (match) {
            const docId = match[1];
            const source = sourceById.get(docId);

            // If source not found (hallucination), don't render badge
            if (!source) return null;

            const docNum = docId.replace('doc-', '');

            return (
              <Button
                key={i}
                variant="ghost"
                size="xs"
                className="align-super font-bold text-stratosort-blue bg-stratosort-blue/10 hover:bg-stratosort-blue hover:text-white rounded-md px-1 min-w-[16px] h-4 mx-0.5 select-none"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenSource?.(source);
                }}
                onMouseEnter={(e) => handleMouseEnter(e, docId)}
                onMouseLeave={handleMouseLeave}
                aria-label={`Citation ${docNum}: ${source.name || 'document'}`}
              >
                {docNum}
              </Button>
            );
          }
          return <span key={i}>{part}</span>;
        })}
      </span>

      {hoveredCitation &&
        sourceById.get(hoveredCitation) &&
        createPortal(
          <div
            className="fixed z-50"
            style={{
              top: previewPos.top,
              left: previewPos.left,
              transform: previewPos.flipBelow ? 'none' : 'translateY(-100%)'
            }}
            onMouseEnter={cancelDismiss}
            onMouseLeave={dismissPreview}
          >
            <CitationPreview source={sourceById.get(hoveredCitation)} onOpen={onOpenSource} />
          </div>,
          document.body
        )}
    </>
  );
}

CitationRenderer.propTypes = {
  text: PropTypes.string,
  sources: PropTypes.array,
  onOpenSource: PropTypes.func.isRequired
};
