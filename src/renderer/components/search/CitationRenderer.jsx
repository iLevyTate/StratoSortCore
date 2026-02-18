import React, { useState, useRef, useEffect } from 'react';
import PropTypes from 'prop-types';
import { createPortal } from 'react-dom';
import { Button } from '../ui';
import CitationPreview from './CitationPreview';

export default function CitationRenderer({ text, sources, onOpenSource }) {
  const [hoveredCitation, setHoveredCitation] = useState(null);
  const [previewPos, setPreviewPos] = useState({ top: 0, left: 0 });
  const timeoutRef = useRef(null);

  const sourceById = new Map((sources || []).map((s) => [s.id, s]));

  const handleMouseEnter = (e, docId) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    const rect = e.currentTarget.getBoundingClientRect();
    // FIX BUG-005: Portal uses position:fixed (viewport-relative), don't add scroll offsets
    setPreviewPos({
      top: rect.top - 10,
      left: rect.left
    });
    setHoveredCitation(docId);
  };

  const handleMouseLeave = () => {
    timeoutRef.current = setTimeout(() => {
      setHoveredCitation(null);
    }, 300); // Delay to allow moving mouse to the preview
  };

  // Cleanup timeout
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  if (!text) return null;

  // Split on citation markers like [doc-1], [doc-12]
  const parts = text.split(/(\[doc-\d+\])/g);

  return (
    <>
      <span>
        {parts.map((part, i) => {
          const match = part.match(/^\[(doc-\d+)\]$/);
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
                  onOpenSource(source);
                }}
                onMouseEnter={(e) => handleMouseEnter(e, docId)}
                onMouseLeave={handleMouseLeave}
                aria-label={`Citation ${docNum}: ${source.name}`}
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
              transform: 'translateY(-100%)' // Shift up by its own height
            }}
            onMouseEnter={() => {
              if (timeoutRef.current) clearTimeout(timeoutRef.current);
            }}
            onMouseLeave={() => setHoveredCitation(null)}
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
