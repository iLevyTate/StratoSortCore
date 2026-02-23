import React, { useMemo } from 'react';
import PropTypes from 'prop-types';
import { Search, CheckCircle, AlertCircle, HelpCircle } from 'lucide-react';
import { Button } from '../ui';
import { Text } from '../ui/Typography';

const COVERAGE_CHIP_LIMIT = 10;

/**
 * Analyze source coverage to find well-covered, thin-covered, and gap topics.
 * Groups sources by their tags/categories to determine coverage depth.
 */
function analyzeCoverage(sources) {
  if (!sources || sources.length === 0) {
    return { wellCovered: [], thinCovered: [], gaps: [] };
  }

  const normalizeTopic = (value) => {
    if (typeof value !== 'string') return '';
    return value.trim().toLowerCase();
  };
  const extractTags = (value) => {
    if (Array.isArray(value)) {
      return value.map(normalizeTopic).filter(Boolean);
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.split(',').map(normalizeTopic).filter(Boolean);
    }
    return [];
  };

  // Build a topic -> unique source map
  const topicSources = new Map();

  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;

    const topics = new Set();
    const category = normalizeTopic(source.category);
    const documentType = normalizeTopic(source.documentType);
    const entity = normalizeTopic(source.entity);
    if (category) topics.add(category);
    if (documentType) topics.add(documentType);
    if (entity) topics.add(entity);
    extractTags(source.tags).forEach((tag) => topics.add(tag));
    const sourceId = String(source.id || source.path || source.name || '').trim();
    if (!sourceId) continue;

    for (const topic of topics) {
      if (!topicSources.has(topic)) {
        topicSources.set(topic, new Map());
      }
      topicSources.get(topic).set(sourceId, {
        id: sourceId,
        name: source.name
      });
    }
  }

  const wellCovered = [];
  const thinCovered = [];

  for (const [topic, sourceMap] of topicSources) {
    const srcs = [...sourceMap.values()];
    if (srcs.length >= 3) {
      wellCovered.push({ topic, sources: srcs, count: srcs.length });
    } else if (srcs.length === 1) {
      thinCovered.push({ topic, sources: srcs, count: srcs.length });
    }
  }

  // Sort by count descending
  wellCovered.sort((a, b) => b.count - a.count);
  thinCovered.sort((a, b) => a.topic.localeCompare(b.topic));

  return {
    wellCovered,
    thinCovered,
    gaps: [] // Gaps require knowledge of what the user expects; the LLM handles this via prompt
  };
}

function CoverageSection({ icon: Icon, title, items, colorClass, onSend }) {
  if (!items || items.length === 0) return null;
  const visibleItems = items.slice(0, COVERAGE_CHIP_LIMIT);
  const hiddenCount = Math.max(0, items.length - visibleItems.length);

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon className={`w-3.5 h-3.5 ${colorClass}`} />
        <Text as="span" variant="tiny" className="font-semibold text-system-gray-600">
          {title}
        </Text>
        <Text as="span" variant="tiny" className="text-system-gray-400">
          ({items.length})
        </Text>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {visibleItems.map((item, i) => (
          <Button
            key={`${item.topic}-${i}`}
            variant="ghost"
            size="xs"
            className="h-auto inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-white border border-system-gray-200 rounded-md hover:bg-system-gray-50 hover:border-system-gray-300"
            onClick={() => onSend(`Tell me more about "${item.topic}" across my documents`)}
            title={`${item.count} source${item.count !== 1 ? 's' : ''}: ${item.sources.map((s) => s.name).join(', ')}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${colorClass.replace('text-', 'bg-')}`} />
            {item.topic}
            <span className="text-system-gray-400">{item.count}</span>
          </Button>
        ))}
        {hiddenCount > 0 ? (
          <Text as="span" variant="tiny" className="text-system-gray-500">
            +{hiddenCount} more
          </Text>
        ) : null}
      </div>
    </div>
  );
}

CoverageSection.propTypes = {
  icon: PropTypes.elementType.isRequired,
  title: PropTypes.string.isRequired,
  items: PropTypes.array,
  colorClass: PropTypes.string.isRequired,
  onSend: PropTypes.func.isRequired
};

export default function GapAnalysisCard({ sources, onSend }) {
  const coverage = useMemo(() => analyzeCoverage(sources), [sources]);

  const hasAnything = coverage.wellCovered.length > 0 || coverage.thinCovered.length > 0;
  if (!hasAnything) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Search className="w-4 h-4 text-stratosort-purple" />
        <Text
          as="span"
          variant="tiny"
          className="font-semibold text-system-gray-500 uppercase tracking-wide"
        >
          Coverage Analysis
        </Text>
      </div>

      <div className="rounded-lg border border-system-gray-200 bg-white p-3 shadow-sm space-y-3">
        <CoverageSection
          icon={CheckCircle}
          title="Well Covered"
          items={coverage.wellCovered}
          colorClass="text-stratosort-success"
          onSend={onSend}
        />

        <CoverageSection
          icon={AlertCircle}
          title="Thin Coverage (1 source)"
          items={coverage.thinCovered}
          colorClass="text-stratosort-warning"
          onSend={onSend}
        />

        {coverage.thinCovered.length > 0 && (
          <div className="pt-2 border-t border-system-gray-100">
            <div className="flex items-start gap-1.5">
              <HelpCircle className="w-3.5 h-3.5 text-system-gray-400 mt-0.5 shrink-0" />
              <Text as="p" variant="tiny" className="text-system-gray-500">
                Topics with only 1 source may benefit from additional documents. Click any topic to
                explore it further.
              </Text>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

GapAnalysisCard.propTypes = {
  sources: PropTypes.array,
  onSend: PropTypes.func.isRequired
};
