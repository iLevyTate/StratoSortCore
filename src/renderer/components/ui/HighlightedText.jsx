import React, { memo, useMemo } from 'react';
import PropTypes from 'prop-types';
import { highlightMatches } from '../../utils/highlightUtils';

/**
 * Component that renders text with highlighted search matches
 */
const HighlightedText = memo(function HighlightedText({
  text,
  query,
  className = '',
  highlightClassName = 'bg-stratosort-warning/15 text-system-gray-900 rounded-sm px-0.5',
  as: Component = 'span'
}) {
  const segments = useMemo(() => highlightMatches(text, query), [text, query]);

  if (text == null || text === '') return null;

  return (
    <Component className={className}>
      {segments.map((segment, index) =>
        segment.highlight ? (
          <mark key={`h-${index}-${segment.text}`} className={highlightClassName}>
            {segment.text}
          </mark>
        ) : (
          <span key={`t-${index}-${segment.text}`}>{segment.text}</span>
        )
      )}
    </Component>
  );
});

HighlightedText.propTypes = {
  /** Text to display and highlight */
  text: PropTypes.string,
  /** Search query to highlight matches for */
  query: PropTypes.string,
  /** Additional CSS classes for the container */
  className: PropTypes.string,
  /** CSS classes for highlighted text */
  highlightClassName: PropTypes.string,
  /** HTML element or component to render as */
  as: PropTypes.elementType
};

export default HighlightedText;
