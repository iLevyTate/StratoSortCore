import React from 'react';
import PropTypes from 'prop-types';

const AnalysisDetails = React.memo(function AnalysisDetails({
  analysis,
  options = {},
}) {
  // Comprehensive null check for analysis object
  if (!analysis || typeof analysis !== 'object') return null;

  // Safely extract options with defaults
  const { showName = true, showCategory = true } = options || {};

  // Safe array checks with proper validation
  const hasKeywords =
    analysis.keywords !== null &&
    analysis.keywords !== undefined &&
    Array.isArray(analysis.keywords) &&
    analysis.keywords.length > 0;
  const hasColors =
    analysis.colors !== null &&
    analysis.colors !== undefined &&
    Array.isArray(analysis.colors) &&
    analysis.colors.length > 0;
  const displayDate = analysis.date;
  const displayProject = analysis.project;
  const displayPurpose = analysis.purpose;
  const displayContentType = analysis.content_type || analysis.contentType;
  const displayHasText =
    typeof analysis.has_text === 'boolean'
      ? analysis.has_text
      : typeof analysis.hasText === 'boolean'
        ? analysis.hasText
        : undefined;

  return (
    <div className="space-y-3">
      {showName && analysis.suggestedName && (
        <div className="text-sm text-system-gray-700">
          <strong>Suggested Name:</strong>{' '}
          <span className="text-stratosort-blue font-mono">
            {analysis.suggestedName}
          </span>
        </div>
      )}

      {showCategory && analysis.category && (
        <div className="text-sm text-system-gray-700">
          <strong>Category:</strong>{' '}
          <span className="text-stratosort-blue">{analysis.category}</span>
        </div>
      )}

      {displayPurpose && (
        <div className="text-sm text-system-gray-600">
          <strong>Purpose:</strong> {displayPurpose}
        </div>
      )}

      {displayProject && (
        <div className="text-sm text-system-gray-600">
          <strong>Project:</strong> {displayProject}
        </div>
      )}

      {displayDate && (
        <div className="text-sm text-system-gray-600">
          <strong>Date:</strong> {displayDate}
        </div>
      )}

      {hasKeywords && (
        <div className="text-sm text-system-gray-500">
          <strong>Keywords:</strong>{' '}
          {analysis.keywords
            .filter((k) => k != null && typeof k === 'string')
            .join(', ')}
        </div>
      )}

      {typeof analysis.confidence !== 'undefined' &&
        analysis.confidence !== null && (
          <div className="text-xs text-system-gray-400">
            <strong>AI Confidence:</strong> {analysis.confidence}%
          </div>
        )}

      {displayContentType && (
        <div className="text-xs text-system-gray-500">
          <strong>Content Type:</strong> {displayContentType}
        </div>
      )}

      {typeof displayHasText !== 'undefined' && (
        <div className="text-xs text-system-gray-500">
          <strong>Has Text:</strong> {displayHasText ? 'Yes' : 'No'}
        </div>
      )}

      {hasColors && (
        <div className="text-xs text-system-gray-500">
          <strong>Colors:</strong>{' '}
          {analysis.colors
            .filter((c) => c != null && typeof c === 'string')
            .join(', ')}
        </div>
      )}

      {analysis.ocrText && typeof analysis.ocrText === 'string' && (
        <div className="text-xs text-system-gray-500 line-clamp-6">
          <strong>OCR:</strong> {analysis.ocrText.slice(0, 300)}
          {analysis.ocrText.length > 300 ? '…' : ''}
        </div>
      )}

      {analysis.transcript && typeof analysis.transcript === 'string' && (
        <div className="text-xs text-system-gray-500 line-clamp-6">
          <strong>Transcript:</strong> {analysis.transcript.slice(0, 300)}
          {analysis.transcript.length > 300 ? '…' : ''}
        </div>
      )}
    </div>
  );
});

AnalysisDetails.propTypes = {
  analysis: PropTypes.shape({
    suggestedName: PropTypes.string,
    category: PropTypes.string,
    purpose: PropTypes.string,
    project: PropTypes.string,
    date: PropTypes.string,
    keywords: PropTypes.arrayOf(PropTypes.string),
    confidence: PropTypes.number,
    content_type: PropTypes.string,
    contentType: PropTypes.string,
    has_text: PropTypes.bool,
    hasText: PropTypes.bool,
    colors: PropTypes.arrayOf(PropTypes.string),
    ocrText: PropTypes.string,
    transcript: PropTypes.string,
  }),
  options: PropTypes.shape({
    showName: PropTypes.bool,
    showCategory: PropTypes.bool,
  }),
};

export default AnalysisDetails;
