import React, { useMemo } from 'react';
import PropTypes from 'prop-types';
import { FileText, ExternalLink, Tag, Users } from 'lucide-react';
import { Button } from '../ui';
import { Text } from '../ui/Typography';
import { formatDisplayPath } from '../../utils/pathDisplay';
import normalizeList from '../../utils/normalizeList';
import { useSelector } from 'react-redux';
import { selectRedactPaths } from '../../store/selectors';

export default function CitationPreview({ source, onOpen, style }) {
  const redactPaths = useSelector(selectRedactPaths);

  const tags = useMemo(() => normalizeList(source?.tags).slice(0, 3), [source?.tags]);
  const entities = useMemo(() => normalizeList(source?.entities).slice(0, 3), [source?.entities]);

  if (!source) return null;

  const scorePct = Math.round((source.semanticScore ?? source.score ?? 0) * 100);
  const displayPath = source.path
    ? formatDisplayPath(source.path, { redact: redactPaths, segments: 2 })
    : '';

  const description = source.summary || source.purpose || '';
  const typeParts = [];
  if (source.documentType) typeParts.push(source.documentType);
  if (source.category && source.category !== source.documentType) typeParts.push(source.category);
  const typeLabel = typeParts.join(' · ');

  return (
    <div
      className="absolute z-50 w-80 bg-white rounded-lg shadow-xl border border-system-gray-200 p-3 animate-in fade-in zoom-in-95 duration-100"
      style={style}
    >
      {/* Header */}
      <div className="flex items-start gap-2.5 mb-2">
        <div
          className={`p-1.5 rounded-md shrink-0 ${
            scorePct >= 70
              ? 'bg-stratosort-success/10'
              : scorePct >= 50
                ? 'bg-stratosort-blue/10'
                : 'bg-system-gray-50'
          }`}
        >
          <FileText
            className={`w-4 h-4 ${
              scorePct >= 70
                ? 'text-stratosort-success'
                : scorePct >= 50
                  ? 'text-stratosort-blue'
                  : 'text-system-gray-400'
            }`}
          />
        </div>
        <div className="min-w-0 flex-1">
          <Text variant="small" className="font-semibold text-system-gray-900 truncate">
            {source.name || source.fileId || 'Untitled document'}
          </Text>
          {(typeLabel || displayPath) && (
            <Text variant="tiny" className="text-system-gray-500 truncate" title={source.path}>
              {typeLabel || displayPath}
            </Text>
          )}
        </div>
        <Text
          as="div"
          variant="tiny"
          className={`font-bold tabular-nums px-1.5 py-0.5 rounded-full shrink-0 ${
            scorePct >= 70
              ? 'bg-stratosort-success/10 text-stratosort-success'
              : scorePct >= 50
                ? 'bg-stratosort-blue/10 text-stratosort-blue'
                : 'bg-system-gray-100 text-system-gray-500'
          }`}
        >
          {scorePct}%
        </Text>
      </div>

      {/* Subject line */}
      {source.subject && (
        <Text as="div" variant="tiny" className="mb-1.5 font-medium text-system-gray-700">
          {source.subject}
        </Text>
      )}

      {/* Summary / purpose */}
      {description && (
        <Text
          as="div"
          variant="tiny"
          className="mb-2 text-system-gray-600 leading-relaxed line-clamp-2"
        >
          {description}
        </Text>
      )}

      {/* Snippet — only if no description */}
      {source.snippet && !description && (
        <Text
          as="div"
          variant="tiny"
          className="mb-2 p-2 bg-system-gray-50 rounded-md text-system-gray-600 italic line-clamp-3 leading-relaxed border border-system-gray-100"
        >
          &ldquo;{source.snippet}&rdquo;
        </Text>
      )}

      {/* Entities + tags chips */}
      {(entities.length > 0 || tags.length > 0) && (
        <div className="mb-2.5 flex flex-wrap gap-1">
          {entities.map((ent, i) => (
            <span
              key={`e-${i}-${ent}`}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium bg-violet-50 text-violet-700 rounded-md"
            >
              <Users className="w-2.5 h-2.5" />
              {ent}
            </span>
          ))}
          {tags.map((tag, i) => (
            <span
              key={`t-${i}-${tag}`}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium bg-system-gray-100 text-system-gray-600 rounded-md"
            >
              <Tag className="w-2.5 h-2.5" />
              {tag}
            </span>
          ))}
        </div>
      )}

      <Button
        variant="secondary"
        size="sm"
        className="w-full justify-center"
        onClick={(e) => {
          e.stopPropagation();
          onOpen?.(source);
        }}
      >
        <ExternalLink className="w-3 h-3 mr-2" />
        Open File
      </Button>
    </div>
  );
}

CitationPreview.propTypes = {
  source: PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    path: PropTypes.string,
    snippet: PropTypes.string,
    score: PropTypes.number,
    semanticScore: PropTypes.number,
    fileId: PropTypes.string,
    summary: PropTypes.string,
    purpose: PropTypes.string,
    subject: PropTypes.string,
    documentType: PropTypes.string,
    category: PropTypes.string,
    tags: PropTypes.oneOfType([PropTypes.arrayOf(PropTypes.string), PropTypes.string]),
    entities: PropTypes.oneOfType([PropTypes.arrayOf(PropTypes.string), PropTypes.string])
  }),
  onOpen: PropTypes.func.isRequired,
  style: PropTypes.object
};
