import React from 'react';
import PropTypes from 'prop-types';

const AnalysisDetails = React.memo(function AnalysisDetails({ analysis, options = {} }) {
  // Comprehensive null check for analysis object
  if (!analysis || typeof analysis !== 'object') return null;

  // Safely extract options with defaults
  const { showName = true, showCategory = true } = options || {};

  // Safe array checks with proper validation
  const keywordList = Array.isArray(analysis.keywords)
    ? analysis.keywords
        .filter((k) => typeof k === 'string')
        .map((k) => k.trim())
        .filter((k) => k.length > 0)
    : [];
  const hasKeywords = keywordList.length > 0;

  const colorList = Array.isArray(analysis.colors)
    ? analysis.colors.filter((c) => typeof c === 'string')
    : [];
  const hasColors = colorList.length > 0;
  const displayDate = analysis.date;
  const displayProject = analysis.project;
  const displayPurpose = analysis.purpose;
  const displayContentType = analysis.content_type || analysis.contentType;
  const summaryText =
    analysis.summary && typeof analysis.summary === 'string' ? analysis.summary : null;
  const extractionMethod =
    analysis.extractionMethod && typeof analysis.extractionMethod === 'string'
      ? analysis.extractionMethod
      : null;
  const contentLength =
    typeof analysis.contentLength === 'number' && Number.isFinite(analysis.contentLength)
      ? analysis.contentLength
      : null;
  const displayHasText =
    typeof analysis.has_text === 'boolean'
      ? analysis.has_text
      : typeof analysis.hasText === 'boolean'
        ? analysis.hasText
        : undefined;

  const confidenceValue =
    typeof analysis.confidence === 'number' && Number.isFinite(analysis.confidence)
      ? analysis.confidence
      : null;
  const displayConfidence =
    confidenceValue === null
      ? null
      : Math.max(
          0,
          confidenceValue <= 1 ? Math.round(confidenceValue * 100) : Math.round(confidenceValue)
        );

  const ocrText =
    analysis.ocrText && typeof analysis.ocrText === 'string' ? analysis.ocrText : null;
  const isOcrTruncated = !!ocrText && ocrText.length > 300;

  const transcriptText =
    analysis.transcript && typeof analysis.transcript === 'string' ? analysis.transcript : null;
  const isTranscriptTruncated = !!transcriptText && transcriptText.length > 300;
  const extractedText =
    analysis.extractedText && typeof analysis.extractedText === 'string'
      ? analysis.extractedText
      : null;
  const isExtractedTextTruncated = !!extractedText && extractedText.length > 300;

  return (
    <div className="space-y-3">
      {showName && analysis.suggestedName && (
        <div className="text-sm text-system-gray-700">
          <strong>Suggested Name:</strong>{' '}
          <span className="text-stratosort-blue font-mono">{analysis.suggestedName}</span>
        </div>
      )}

      {showCategory && analysis.category && (
        <div className="text-sm text-system-gray-700">
          <strong>Category:</strong>{' '}
          <span className="text-stratosort-blue">{analysis.category}</span>
        </div>
      )}

      {displayProject && (
        <div className="text-sm text-system-gray-700">
          <strong>Project:</strong> {displayProject}
        </div>
      )}

      {displayPurpose && (
        <div className="text-sm text-system-gray-700">
          <strong>Purpose:</strong> {displayPurpose}
        </div>
      )}

      {summaryText && (
        <div className="text-sm text-system-gray-700 line-clamp-4">
          <strong>Summary:</strong> {summaryText}
        </div>
      )}

      {displayDate && (
        <div className="text-sm text-system-gray-700">
          <strong>Date:</strong> {displayDate}
        </div>
      )}

      {hasKeywords && (
        <div className="text-sm text-system-gray-700">
          <strong className="block mb-1.5">Keywords:</strong>
          <div className="flex flex-wrap gap-1.5">
            {keywordList.map((keyword, i) => (
              <span
                key={i}
                className="px-2 py-1 bg-system-gray-100 text-system-gray-700 rounded-md text-xs font-medium border border-system-gray-200"
              >
                {keyword}
              </span>
            ))}
          </div>
        </div>
      )}

      {displayConfidence !== null && (
        <div className="text-sm text-system-gray-700">
          <strong>AI Confidence:</strong> {displayConfidence}%
        </div>
      )}

      {displayContentType && (
        <div className="text-sm text-system-gray-700">
          <strong>Content Type:</strong>{' '}
          {typeof displayContentType === 'object'
            ? displayContentType.mime ||
              displayContentType.type ||
              displayContentType.name ||
              'Unknown Type'
            : displayContentType}
        </div>
      )}

      {extractionMethod && (
        <div className="text-sm text-system-gray-700">
          <strong>Extraction Method:</strong> {extractionMethod}
        </div>
      )}

      {contentLength !== null && (
        <div className="text-sm text-system-gray-700">
          <strong>Content Length:</strong> {contentLength.toLocaleString()} chars
        </div>
      )}

      {typeof displayHasText !== 'undefined' && (
        <div className="text-sm text-system-gray-700">
          <strong>Has Text:</strong> {displayHasText ? 'Yes' : 'No'}
        </div>
      )}

      {hasColors && (
        <div className="text-sm text-system-gray-700">
          <strong>Colors:</strong> {colorList.join(', ')}
        </div>
      )}

      {ocrText && (
        <div className="text-xs text-system-gray-600 line-clamp-6 pt-1">
          <strong className="text-system-gray-700">OCR:</strong> {ocrText.slice(0, 300)}
          {isOcrTruncated ? '… (truncated)' : ''}
        </div>
      )}

      {transcriptText && (
        <div className="text-xs text-system-gray-600 line-clamp-6 pt-1">
          <strong className="text-system-gray-700">Transcript:</strong>{' '}
          {transcriptText.slice(0, 300)}
          {isTranscriptTruncated ? '… (truncated)' : ''}
        </div>
      )}

      {extractedText && (
        <div className="text-xs text-system-gray-600 line-clamp-6 pt-1">
          <strong className="text-system-gray-700">Extracted Text:</strong>{' '}
          {extractedText.slice(0, 300)}
          {isExtractedTextTruncated ? '… (truncated)' : ''}
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
    content_type: PropTypes.oneOfType([PropTypes.string, PropTypes.object]),
    contentType: PropTypes.oneOfType([PropTypes.string, PropTypes.object]),
    has_text: PropTypes.bool,
    hasText: PropTypes.bool,
    colors: PropTypes.arrayOf(PropTypes.string),
    summary: PropTypes.string,
    extractionMethod: PropTypes.string,
    contentLength: PropTypes.number,
    ocrText: PropTypes.string,
    transcript: PropTypes.string,
    extractedText: PropTypes.string
  }),
  options: PropTypes.shape({
    showName: PropTypes.bool,
    showCategory: PropTypes.bool
  })
};

export default AnalysisDetails;
