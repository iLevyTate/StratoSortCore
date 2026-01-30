import React, { memo } from 'react';
import PropTypes from 'prop-types';
import { FileText, Info, Sparkles, Lightbulb, Tag, AlignLeft } from 'lucide-react';
import { Text, Code, Caption } from './ui/Typography';
import { Stack } from './layout';
import StatusBadge from './ui/StatusBadge';
import Card from './ui/Card';
import { formatDisplayPath } from '../utils/pathDisplay';

const isValuePresent = (value) => value !== null && value !== undefined && value !== '';

const truncateContent = (content, maxLength = 10000) => {
  if (typeof content !== 'string') return content;
  if (content.length <= maxLength) return content;
  return (
    content.slice(0, maxLength) +
    `... (${(content.length - maxLength).toLocaleString()} more characters)`
  );
};

const DetailRow = ({ label, value, truncate = false }) => {
  if (!isValuePresent(value)) return null;
  return (
    <div className="grid grid-cols-[120px_1fr] gap-4 py-1.5">
      <Text variant="tiny" className="uppercase tracking-wider font-semibold text-system-gray-400">
        {label}
      </Text>
      <div className={`min-w-0 ${truncate ? 'truncate' : ''}`}>
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

const SectionCard = ({ title, icon: Icon, children, className = '' }) => (
  <Card variant="static" className={`space-y-3 ${className}`.trim()}>
    <div className="flex items-center gap-2">
      {Icon && (
        <span className="w-7 h-7 rounded-lg bg-stratosort-blue/10 text-stratosort-blue flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4" aria-hidden="true" />
        </span>
      )}
      <Caption className="text-system-gray-500">{title}</Caption>
    </div>
    {children}
  </Card>
);

const MetaItem = ({ label, value, truncate = false }) => {
  if (!isValuePresent(value)) return null;
  return (
    <div className="rounded-lg border border-border-soft/70 bg-white px-3 py-2">
      <Text variant="tiny" className="uppercase tracking-wider font-semibold text-system-gray-400">
        {label}
      </Text>
      <div className={`min-w-0 ${truncate ? 'truncate' : ''}`}>
        {typeof value === 'string' ? (
          <Text variant="small" className="text-system-gray-800">
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
    ? analysis.keywords.filter((k) => typeof k === 'string' && k.trim().length > 0).slice(0, 50) // Limit to 50 keywords to prevent rendering issues
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
  const contentLength =
    typeof analysis.contentLength === 'number' && Number.isFinite(analysis.contentLength)
      ? `${analysis.contentLength.toLocaleString()} chars`
      : null;
  const confidenceBarValue =
    displayConfidence === null ? null : Math.min(100, Math.max(0, displayConfidence));
  const metadataItems = [
    { label: 'Entity', value: analysis.entity },
    { label: 'Project', value: analysis.project },
    { label: 'Purpose', value: analysis.purpose },
    { label: 'Date', value: displayDate },
    { label: 'Document Type', value: documentType },
    { label: 'Content Type', value: displayContentType },
    { label: 'Method', value: analysis.extractionMethod },
    { label: 'Length', value: contentLength }
  ].filter((item) => isValuePresent(item.value));

  return (
    <Stack gap="relaxed" className="w-full">
      <SectionCard
        title="Overview"
        icon={FileText}
        className="bg-gradient-to-br from-white to-system-gray-50/80 border-border-soft/70"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-2">
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
          </div>
          <div className="flex flex-col items-start sm:items-end gap-3">
            {showCategory && analysis.category && (
              <div className="flex items-center gap-2">
                <Text
                  variant="tiny"
                  className="uppercase tracking-wider font-semibold text-system-gray-400"
                >
                  Category
                </Text>
                <StatusBadge variant="info" size="sm" className="shadow-sm">
                  {analysis.category}
                </StatusBadge>
              </div>
            )}
            {displayConfidence !== null && (
              <div className="flex flex-col items-start sm:items-end gap-1">
                <Text
                  variant="tiny"
                  className="uppercase tracking-wider font-semibold text-system-gray-400"
                >
                  Confidence
                </Text>
                <div className="flex items-center gap-2">
                  <div className="w-28 h-2 bg-system-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        displayConfidence > 80
                          ? 'bg-stratosort-success'
                          : displayConfidence > 50
                            ? 'bg-stratosort-warning'
                            : 'bg-stratosort-danger'
                      }`}
                      style={{ width: `${confidenceBarValue}%` }}
                    />
                  </div>
                  <Text variant="small" className="font-medium text-system-gray-700">
                    {displayConfidence}%
                  </Text>
                </div>
              </div>
            )}
          </div>
        </div>
      </SectionCard>

      {metadataItems.length > 0 && (
        <SectionCard title="Metadata" icon={Info}>
          <div className="grid sm:grid-cols-2 gap-3">
            {metadataItems.map((item) => (
              <MetaItem key={item.label} label={item.label} value={item.value} />
            ))}
          </div>
        </SectionCard>
      )}

      {analysis.summary && (
        <SectionCard
          title="Summary"
          icon={Sparkles}
          className="bg-gradient-to-br from-system-gray-50/80 to-white border-border-soft/70"
        >
          <Text variant="small" className="leading-relaxed text-system-gray-700">
            {truncateContent(analysis.summary, 2000)}
          </Text>
        </SectionCard>
      )}

      {analysis.reasoning && (
        <SectionCard title="Reasoning" icon={Lightbulb}>
          <Text variant="small" className="leading-relaxed text-system-gray-700">
            {truncateContent(analysis.reasoning, 2000)}
          </Text>
        </SectionCard>
      )}

      {keywordList.length > 0 && (
        <SectionCard title="Keywords" icon={Tag}>
          <div className="flex flex-wrap gap-2">
            {keywordList.map((keyword, i) => (
              <Text
                as="span"
                variant="tiny"
                key={i}
                className="px-2.5 py-1 bg-white border border-system-gray-200 rounded-full text-system-gray-600 font-medium shadow-sm"
              >
                {keyword}
              </Text>
            ))}
          </div>
        </SectionCard>
      )}

      {(analysis.ocrText || analysis.transcript || analysis.extractedText) && (
        <SectionCard title="Extracted Text" icon={AlignLeft} className="bg-system-gray-50/60">
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
                  className="font-mono bg-white/80 p-2 rounded border border-border-soft line-clamp-4"
                  title={
                    analysis.ocrText.length > 10000 ? 'Content truncated for display' : undefined
                  }
                >
                  {truncateContent(analysis.ocrText)}
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
                  className="font-mono bg-white/80 p-2 rounded border border-border-soft line-clamp-4"
                  title={
                    analysis.transcript.length > 10000 ? 'Content truncated for display' : undefined
                  }
                >
                  {truncateContent(analysis.transcript)}
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
                  className="font-mono bg-white/80 p-2 rounded border border-border-soft line-clamp-4"
                  title={
                    analysis.extractedText.length > 10000
                      ? 'Content truncated for display'
                      : undefined
                  }
                >
                  {truncateContent(analysis.extractedText)}
                </Text>
              </div>
            )}
          </div>
        </SectionCard>
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
