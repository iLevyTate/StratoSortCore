import React from 'react';
import PropTypes from 'prop-types';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { Button } from '../ui';
import { Text } from '../ui/Typography';

function ContradictionPair({ contradiction, onOpenSource, sources }) {
  const { docA, docB, sharedTopics, reason } = contradiction || {};
  const safeDocA = docA && typeof docA === 'object' ? docA : {};
  const safeDocB = docB && typeof docB === 'object' ? docB : {};
  const safeSharedTopics = Array.isArray(sharedTopics)
    ? sharedTopics.map((topic) => (typeof topic === 'string' ? topic.trim() : '')).filter(Boolean)
    : [];
  const sourceA = safeDocA.id ? (sources || []).find((s) => s.id === safeDocA.id) : null;
  const sourceB = safeDocB.id ? (sources || []).find((s) => s.id === safeDocB.id) : null;

  const reasonLabel =
    reason === 'different_dates'
      ? 'Different dates on same topic'
      : 'Different entities, shared topic';

  return (
    <div className="border border-stratosort-warning/30 rounded-lg p-3 bg-stratosort-warning/5 shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="w-3.5 h-3.5 text-stratosort-warning shrink-0" />
        <Text as="span" variant="tiny" className="font-semibold text-stratosort-warning">
          {reasonLabel}
        </Text>
        <div className="flex gap-1 ml-auto">
          {safeSharedTopics.map((topic) => (
            <span
              key={topic}
              className="inline-block px-1.5 py-0.5 text-[10px] font-medium bg-stratosort-warning/10 text-stratosort-warning rounded"
            >
              {topic}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-md bg-white border border-system-gray-200 p-2">
          <div className="flex items-center justify-between mb-1">
            <Text as="span" variant="tiny" className="font-semibold text-system-gray-700 truncate">
              {safeDocA.name || 'Unknown source'}
            </Text>
            {safeDocA.date && (
              <Text as="span" variant="tiny" className="text-system-gray-400 shrink-0 ml-1">
                {safeDocA.date}
              </Text>
            )}
          </div>
          <Text
            as="p"
            variant="tiny"
            className="text-system-gray-600 whitespace-pre-wrap break-words"
          >
            {safeDocA.snippet || 'No preview available'}
          </Text>
          {sourceA?.path && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 h-auto px-1 py-0.5 text-[10px] text-stratosort-blue"
              onClick={() => onOpenSource(sourceA)}
            >
              <ExternalLink className="w-3 h-3 mr-1" /> Open
            </Button>
          )}
        </div>

        <div className="rounded-md bg-white border border-system-gray-200 p-2">
          <div className="flex items-center justify-between mb-1">
            <Text as="span" variant="tiny" className="font-semibold text-system-gray-700 truncate">
              {safeDocB.name || 'Unknown source'}
            </Text>
            {safeDocB.date && (
              <Text as="span" variant="tiny" className="text-system-gray-400 shrink-0 ml-1">
                {safeDocB.date}
              </Text>
            )}
          </div>
          <Text
            as="p"
            variant="tiny"
            className="text-system-gray-600 whitespace-pre-wrap break-words"
          >
            {safeDocB.snippet || 'No preview available'}
          </Text>
          {sourceB?.path && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 h-auto px-1 py-0.5 text-[10px] text-stratosort-blue"
              onClick={() => onOpenSource(sourceB)}
            >
              <ExternalLink className="w-3 h-3 mr-1" /> Open
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

ContradictionPair.propTypes = {
  contradiction: PropTypes.shape({
    docA: PropTypes.object.isRequired,
    docB: PropTypes.object.isRequired,
    sharedTopics: PropTypes.arrayOf(PropTypes.string),
    reason: PropTypes.string
  }).isRequired,
  onOpenSource: PropTypes.func.isRequired,
  sources: PropTypes.array
};

export default function ContradictionCard({ contradictions, sources, onOpenSource }) {
  if (!contradictions || contradictions.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-stratosort-warning" />
        <Text
          as="span"
          variant="tiny"
          className="font-semibold text-system-gray-500 uppercase tracking-wide"
        >
          Potential Conflicts ({contradictions.length})
        </Text>
      </div>
      <div className="space-y-2">
        {contradictions.map((c, i) => (
          <ContradictionPair
            key={`contradiction-${c?.docA?.id || 'a'}-${c?.docB?.id || 'b'}-${i}`}
            contradiction={c}
            sources={sources}
            onOpenSource={onOpenSource}
          />
        ))}
      </div>
    </div>
  );
}

ContradictionCard.propTypes = {
  contradictions: PropTypes.arrayOf(PropTypes.object),
  sources: PropTypes.array,
  onOpenSource: PropTypes.func.isRequired
};
