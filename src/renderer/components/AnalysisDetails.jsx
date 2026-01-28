import React, { memo } from 'react';
import PropTypes from 'prop-types';
import { Text, Code } from './ui/Typography';
import { Stack } from './layout';
import StatusBadge from './ui/StatusBadge';
import { formatDisplayPath } from '../utils/pathDisplay';

const DetailRow = ({ label, value, truncate = false }) => {
  if (!value) return null;
  return (
    <div className="grid grid-cols-[120px_1fr] gap-4 py-1">
      <Text variant="small" className="font-medium text-system-gray-500">
        {label}
      </Text>
      <div className={truncate ? 'truncate' : ''}>
        {typeof value === 'string' ? (
          <Text variant="small" className="text-system-gray-900">
            {value}
          </Text>
        ) : (
          value
        )}
      </div>
    </div>
  );
};

const AnalysisDetails = memo(function AnalysisDetails({
  analysis,
  options = {},
  filePath,
  redactPaths = false
}) {
  if (!analysis || typeof analysis !== 'object') return null;

  const { showName = true, showCategory = true } = options || {};
  const resolvedFilePath =
    typeof filePath === 'string' && filePath.trim().length > 0
      ? filePath
      : typeof analysis.path === 'string'
        ? analysis.path
        : '';
  const displayFilePath = resolvedFilePath
    ? formatDisplayPath(resolvedFilePath, { redact: Boolean(redactPaths), segments: 2 })
    : '';

  const keywordList = Array.isArray(analysis.keywords)
    ? analysis.keywords.filter((k) => typeof k === 'string' && k.trim().length > 0)
    : [];

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

  const displayContentType =
    typeof analysis.content_type === 'object'
      ? analysis.content_type.mime || analysis.content_type.type || 'Unknown'
      : analysis.content_type || analysis.contentType;
  const rawType = typeof analysis.type === 'string' ? analysis.type.trim() : '';
  const isGenericType = ['image', 'document', 'file', 'unknown'].includes(rawType.toLowerCase());
  const documentType = analysis.documentType || (!isGenericType && rawType ? rawType : '');
  const displayDate = analysis.date || analysis.documentDate;

  return (
    <Stack gap="relaxed" className="w-full">
      {/* Primary Info */}
      <div className="space-y-1">
        {showName && analysis.suggestedName && (
          <DetailRow label="Suggested Name" value={<Code>{analysis.suggestedName}</Code>} />
        )}
        {displayFilePath && (
          <DetailRow
            label="File Path"
            value={
              <Code className="break-all" title={redactPaths ? undefined : resolvedFilePath}>
                {displayFilePath}
              </Code>
            }
          />
        )}
        {showCategory && analysis.category && (
          <DetailRow
            label="Category"
            value={
              <StatusBadge variant="info" size="sm">
                {analysis.category}
              </StatusBadge>
            }
          />
        )}
        {displayConfidence !== null && (
          <DetailRow
            label="Confidence"
            value={
              <div className="flex items-center gap-2">
                <div className="w-24 h-2 bg-system-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      displayConfidence > 80
                        ? 'bg-stratosort-success'
                        : displayConfidence > 50
                          ? 'bg-stratosort-warning'
                          : 'bg-stratosort-danger'
                    }`}
                    style={{ width: `${displayConfidence}%` }}
                  />
                </div>
                <Text variant="small">{displayConfidence}%</Text>
              </div>
            }
          />
        )}
      </div>

      <div className="border-t border-border-soft/50" />

      {/* Metadata */}
      <div className="space-y-1">
        <DetailRow label="Entity" value={analysis.entity} />
        <DetailRow label="Project" value={analysis.project} />
        <DetailRow label="Purpose" value={analysis.purpose} />
        <DetailRow label="Date" value={displayDate} />
        <DetailRow label="Document Type" value={documentType} />
        <DetailRow label="Content Type" value={displayContentType} />
        <DetailRow label="Method" value={analysis.extractionMethod} />
        {analysis.contentLength && (
          <DetailRow label="Length" value={`${analysis.contentLength.toLocaleString()} chars`} />
        )}
      </div>

      {/* Summary */}
      {analysis.summary && (
        <div className="bg-system-gray-50 rounded-lg p-3 border border-border-soft">
          <Text
            variant="tiny"
            className="uppercase tracking-wider font-semibold text-system-gray-500 mb-1"
          >
            Summary
          </Text>
          <Text variant="small" className="leading-relaxed">
            {analysis.summary}
          </Text>
        </div>
      )}

      {/* Reasoning */}
      {analysis.reasoning && (
        <div className="bg-system-gray-50 rounded-lg p-3 border border-border-soft">
          <Text
            variant="tiny"
            className="uppercase tracking-wider font-semibold text-system-gray-500 mb-1"
          >
            Reasoning
          </Text>
          <Text variant="small" className="leading-relaxed">
            {analysis.reasoning}
          </Text>
        </div>
      )}

      {/* Keywords */}
      {keywordList.length > 0 && (
        <div>
          <Text
            variant="tiny"
            className="uppercase tracking-wider font-semibold text-system-gray-500 mb-2"
          >
            Keywords
          </Text>
          <div className="flex flex-wrap gap-1.5">
            {keywordList.map((keyword, i) => (
              <Text
                as="span"
                variant="tiny"
                key={i}
                className="px-2 py-1 bg-white border border-system-gray-200 rounded text-system-gray-600"
              >
                {keyword}
              </Text>
            ))}
          </div>
        </div>
      )}

      {/* Extracted Text Preview */}
      {(analysis.ocrText || analysis.transcript || analysis.extractedText) && (
        <div className="space-y-3">
          {analysis.ocrText && (
            <div>
              <Text
                variant="tiny"
                className="uppercase tracking-wider font-semibold text-system-gray-500 mb-1"
              >
                OCR Text
              </Text>
              <Text
                variant="tiny"
                className="font-mono bg-system-gray-50 p-2 rounded border border-border-soft line-clamp-4"
              >
                {analysis.ocrText}
              </Text>
            </div>
          )}
          {analysis.transcript && (
            <div>
              <Text
                variant="tiny"
                className="uppercase tracking-wider font-semibold text-system-gray-500 mb-1"
              >
                Transcript
              </Text>
              <Text
                variant="tiny"
                className="font-mono bg-system-gray-50 p-2 rounded border border-border-soft line-clamp-4"
              >
                {analysis.transcript}
              </Text>
            </div>
          )}
          {analysis.extractedText && (
            <div>
              <Text
                variant="tiny"
                className="uppercase tracking-wider font-semibold text-system-gray-500 mb-1"
              >
                Extracted Content
              </Text>
              <Text
                variant="tiny"
                className="font-mono bg-system-gray-50 p-2 rounded border border-border-soft line-clamp-4"
              >
                {analysis.extractedText}
              </Text>
            </div>
          )}
        </div>
      )}
    </Stack>
  );
});

AnalysisDetails.propTypes = {
  analysis: PropTypes.object,
  options: PropTypes.object,
  filePath: PropTypes.string,
  redactPaths: PropTypes.bool
};

export default AnalysisDetails;
