import React from 'react';
import PropTypes from 'prop-types';
import { FileText, ExternalLink } from 'lucide-react';
import { Button } from '../ui';
import { Text } from '../ui/Typography';
import { formatDisplayPath } from '../../utils/pathDisplay';
import { useSelector } from 'react-redux';
import { selectRedactPaths } from '../../store/selectors';

export default function CitationPreview({ source, onOpen, style }) {
  const redactPaths = useSelector(selectRedactPaths);

  if (!source) return null;

  const scorePct = Math.round((source.semanticScore ?? source.score ?? 0) * 100);
  const displayPath = source.path
    ? formatDisplayPath(source.path, { redact: redactPaths, segments: 2 })
    : '';

  return (
    <div
      className="absolute z-50 w-72 bg-white rounded-lg shadow-xl border border-system-gray-200 p-3 animate-in fade-in zoom-in-95 duration-100"
      style={style}
    >
      <div className="flex items-start gap-3 mb-2">
        <div className="p-1.5 bg-system-gray-50 rounded-md shrink-0">
          <FileText className="w-4 h-4 text-stratosort-blue" />
        </div>
        <div className="min-w-0 flex-1">
          <Text variant="small" className="font-medium text-system-gray-900 truncate">
            {source.name || source.fileId}
          </Text>
          {displayPath && (
            <Text variant="tiny" className="text-system-gray-500 truncate" title={source.path}>
              {displayPath}
            </Text>
          )}
        </div>
        <div
          className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
            scorePct >= 70
              ? 'bg-green-50 text-stratosort-success'
              : scorePct >= 50
                ? 'bg-blue-50 text-stratosort-blue'
                : 'bg-gray-100 text-system-gray-500'
          }`}
        >
          {scorePct}%
        </div>
      </div>

      {source.snippet && (
        <div className="mb-3 p-2 bg-system-gray-50 rounded text-[11px] text-system-gray-600 line-clamp-4 leading-relaxed border border-system-gray-100">
          "{source.snippet}"
        </div>
      )}

      <Button
        variant="secondary"
        size="sm"
        className="w-full justify-center"
        onClick={(e) => {
          e.stopPropagation();
          onOpen(source);
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
    fileId: PropTypes.string
  }),
  onOpen: PropTypes.func.isRequired,
  style: PropTypes.object
};
