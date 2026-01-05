import React, { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import PropTypes from 'prop-types';
import ReactFlow, { Background, Controls, MiniMap, Handle, Position } from 'reactflow';
import 'reactflow/dist/style.css';
import {
  ExternalLink,
  FolderOpen,
  FolderInput,
  RefreshCw,
  Search as SearchIcon,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Copy,
  Network,
  List,
  HelpCircle,
  FileText,
  MessageSquare,
  LayoutGrid,
  Layers,
  GitBranch,
  CheckSquare,
  Square
} from 'lucide-react';

import Modal, { ConfirmModal } from '../Modal';
import { Button, Input } from '../ui';
import { TIMEOUTS } from '../../../shared/performanceConstants';
import { logger } from '../../../shared/logger';
import { safeBasename } from '../../utils/pathUtils';
import { formatScore, scoreToOpacity, clamp01 } from '../../utils/scoreUtils';
import { makeQueryNodeId, defaultNodePosition } from '../../utils/graphUtils';
import {
  elkLayout,
  debouncedElkLayout,
  cancelPendingLayout,
  smartLayout,
  clusterRadialLayout,
  clusterExpansionLayout,
  LARGE_GRAPH_THRESHOLD
} from '../../utils/elkLayout';
import ClusterNode from './ClusterNode';
import SimilarityEdge from './SimilarityEdge';
import QueryMatchEdge from './QueryMatchEdge';
import SearchAutocomplete from './SearchAutocomplete';
import ClusterLegend from './ClusterLegend';

logger.setContext('UnifiedSearchModal');

// Temporary feature flag: hide graph view
const SHOW_GRAPH = false;

// Maximum nodes allowed in graph to prevent memory exhaustion
const MAX_GRAPH_NODES = 300;

/**
 * Format error messages to be more user-friendly and actionable
 */
const getErrorMessage = (error, context = 'Operation') => {
  const msg = error?.message || '';

  // Connection errors - service unavailable
  if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND')) {
    return `${context} failed: Embedding service unavailable. Is Ollama running?`;
  }

  // Timeout errors
  if (msg.includes('timeout') || msg.includes('Timeout')) {
    return `${context} timed out. Try a shorter query or fewer files.`;
  }

  // ChromaDB not available
  if (msg.includes('ChromaDB') || msg.includes('not available yet')) {
    return `${context} failed: Semantic search is initializing. Please wait a moment and try again.`;
  }

  // Generic fallback with original message
  return msg || `${context} failed`;
};

// ============================================================================
// Custom Node Components
// ============================================================================

const FileNode = memo(({ data, selected }) => {
  const [showActions, setShowActions] = useState(false);
  const score = data?.withinScore ?? data?.score;
  const hasScore = typeof score === 'number';
  const filePath = data?.path || '';

  const handleOpen = useCallback(
    (e) => {
      e.stopPropagation();
      if (filePath) {
        window.electronAPI?.files?.open?.(filePath);
      }
    },
    [filePath]
  );

  const handleReveal = useCallback(
    (e) => {
      e.stopPropagation();
      if (filePath) {
        window.electronAPI?.files?.reveal?.(filePath);
      }
    },
    [filePath]
  );

  return (
    <div
      className={`
        relative px-3 py-2 rounded-lg border-2 shadow-sm min-w-[140px] max-w-[200px]
        transition-all duration-200 cursor-pointer group
        ${
          selected
            ? 'border-stratosort-blue bg-stratosort-blue/10 shadow-md ring-2 ring-stratosort-blue/30'
            : 'border-system-gray-200 bg-white hover:border-stratosort-blue/50 hover:shadow-md'
        }
      `}
      style={{ opacity: data?.style?.opacity ?? 1 }}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <Handle type="target" position={Position.Left} className="!bg-stratosort-blue !w-2 !h-2" />

      {/* Quick actions on hover */}
      {showActions && filePath && (
        <div className="absolute -top-7 left-1/2 -translate-x-1/2 flex gap-1 bg-white shadow-md rounded-lg px-1.5 py-1 border border-system-gray-200 z-10">
          <button
            onClick={handleOpen}
            className="p-1 rounded hover:bg-stratosort-blue/10 transition-colors"
            title="Open file"
          >
            <ExternalLink className="w-3 h-3 text-stratosort-blue" />
          </button>
          <button
            onClick={handleReveal}
            className="p-1 rounded hover:bg-stratosort-blue/10 transition-colors"
            title="Reveal in folder"
          >
            <FolderOpen className="w-3 h-3 text-stratosort-blue" />
          </button>
        </div>
      )}

      <div className="flex items-start gap-2">
        <FileText className="w-4 h-4 text-stratosort-blue shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-system-gray-900 truncate" title={data?.label}>
            {data?.label}
          </div>
          {hasScore && (
            <div className="text-[10px] text-system-gray-500 mt-0.5">
              {Math.round(score * 100)}% match
            </div>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-stratosort-blue !w-2 !h-2" />
    </div>
  );
});

FileNode.displayName = 'FileNode';

FileNode.propTypes = {
  data: PropTypes.shape({
    withinScore: PropTypes.number,
    score: PropTypes.number,
    label: PropTypes.string,
    path: PropTypes.string,
    style: PropTypes.shape({
      opacity: PropTypes.number
    })
  }),
  selected: PropTypes.bool
};

const QueryNode = memo(({ data, selected }) => {
  return (
    <div
      className={`
        px-3 py-2 rounded-lg border-2 shadow-sm min-w-[120px] max-w-[180px]
        transition-all duration-200
        ${
          selected
            ? 'border-stratosort-indigo bg-stratosort-indigo/10 shadow-md ring-2 ring-stratosort-indigo/30'
            : 'border-stratosort-indigo/50 bg-gradient-to-br from-stratosort-indigo/5 to-stratosort-blue/5'
        }
      `}
    >
      <div className="flex items-start gap-2">
        <MessageSquare className="w-4 h-4 text-stratosort-indigo shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-stratosort-indigo/70 font-medium">
            Query
          </div>
          <div className="text-xs font-medium text-system-gray-900 truncate" title={data?.label}>
            {data?.label}
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-stratosort-indigo !w-2 !h-2" />
    </div>
  );
});

QueryNode.displayName = 'QueryNode';

QueryNode.propTypes = {
  data: PropTypes.shape({
    label: PropTypes.string
  }),
  selected: PropTypes.bool
};

// Node types for ReactFlow
const nodeTypes = {
  fileNode: FileNode,
  queryNode: QueryNode,
  clusterNode: ClusterNode
};

// Edge types for ReactFlow
const edgeTypes = {
  similarity: SimilarityEdge,
  queryMatch: QueryMatchEdge
};

// ============================================================================
// Sub-Components
// ============================================================================

function ResultRow({
  result,
  isSelected,
  isBulkSelected,
  onSelect,
  onToggleBulk,
  onOpen,
  onReveal,
  onCopyPath
}) {
  const path = result?.metadata?.path || '';
  const name = result?.metadata?.name || safeBasename(path) || result?.id || 'Unknown';
  const type = result?.metadata?.type || '';
  const summaryText =
    result?.metadata?.summary || (typeof result?.document === 'string' ? result.document : '');
  const trimmedSummary = summaryText ? summaryText.slice(0, 200) : '';
  const hasMoreSummary = Boolean(summaryText && summaryText.length > 200);
  const sources = Array.isArray(result?.matchDetails?.sources) ? result.matchDetails.sources : [];
  const tags = Array.isArray(result?.metadata?.tags) ? result.metadata.tags.slice(0, 3) : [];
  const relevancePercent =
    typeof result?.score === 'number' ? Math.round(clamp01(result.score) * 100) : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(result)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(result);
        }
      }}
      className={`
        w-full text-left rounded-xl border p-3 transition-colors cursor-pointer
        ${isSelected ? 'border-stratosort-blue bg-stratosort-blue/5' : 'border-border-soft bg-white/70 hover:bg-white'}
        ${isBulkSelected ? 'ring-2 ring-stratosort-blue/30' : ''}
      `}
    >
      <div className="flex items-start gap-3">
        {/* Bulk selection checkbox */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleBulk(result.id);
          }}
          className="shrink-0 mt-0.5 p-0.5 rounded hover:bg-system-gray-100 transition-colors"
          title={isBulkSelected ? 'Deselect' : 'Select for bulk action'}
        >
          {isBulkSelected ? (
            <CheckSquare className="w-4 h-4 text-stratosort-blue" />
          ) : (
            <Square className="w-4 h-4 text-system-gray-400" />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-semibold text-system-gray-900 truncate">{name}</span>
            {type ? (
              <span className="status-chip info shrink-0" title={type}>
                {type}
              </span>
            ) : null}
          </div>
          <div className="mt-1 text-xs text-system-gray-500 break-all">{path}</div>

          {(sources.length > 0 || result?.metadata?.category || tags.length > 0) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {sources.map((source) => (
                <span
                  key={source}
                  className="px-2 py-1 rounded-full bg-stratosort-blue/10 text-stratosort-blue text-[11px] font-medium"
                >
                  {source}
                </span>
              ))}
              {result?.metadata?.category ? (
                <span className="px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-medium">
                  {result.metadata.category}
                </span>
              ) : null}
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-1 rounded-full bg-system-gray-100 text-system-gray-600 text-[11px] font-medium"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {trimmedSummary ? (
            <div className="mt-2 bg-white border border-system-gray-200 rounded-lg p-2 shadow-[0_1px_0_rgba(0,0,0,0.02)]">
              <div className="flex items-center gap-2 text-[11px] font-semibold text-system-gray-700">
                <MessageSquare className="w-3.5 h-3.5 text-stratosort-indigo" />
                Quick summary
              </div>
              <div className="text-xs text-system-gray-600 leading-relaxed mt-1">
                {trimmedSummary}
                {hasMoreSummary ? '…' : ''}
              </div>
            </div>
          ) : null}

          {/* Match details - shows why this result matched */}
          {result?.matchDetails && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {/* Matched keywords from BM25 */}
              {result.matchDetails.matchedTerms?.slice(0, 3).map((term) => (
                <span
                  key={term}
                  className="text-[10px] px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded border border-amber-200"
                  title={`Keyword match: "${term}"`}
                >
                  {term}
                </span>
              ))}
              {/* Category match from vector search */}
              {result.matchDetails.queryTermsInCategory && result.metadata?.category && (
                <span
                  className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded border border-blue-200"
                  title="Category matches your query"
                >
                  {result.metadata.category}
                </span>
              )}
              {/* Tags that match query terms */}
              {result.matchDetails.queryTermsInTags?.slice(0, 2).map((tag) => (
                <span
                  key={tag}
                  className="text-[10px] px-1.5 py-0.5 bg-green-50 text-green-700 rounded border border-green-200"
                  title={`Tag matches your query: ${tag}`}
                >
                  {tag}
                </span>
              ))}
              {/* Search sources indicator */}
              {result.matchDetails.sources?.length > 1 && (
                <span
                  className="text-[10px] px-1.5 py-0.5 bg-purple-50 text-purple-600 rounded border border-purple-200"
                  title="Found by both keyword and semantic search"
                >
                  hybrid
                </span>
              )}
            </div>
          )}
        </div>
        <div className="shrink-0 text-xs font-medium text-system-gray-600">
          {formatScore(result?.score)}
        </div>
      </div>

      {relevancePercent !== null && (
        <div className="mt-2">
          <div className="flex items-center justify-between text-[11px] text-system-gray-500">
            <span>Relevance blend</span>
            <span className="font-semibold text-system-gray-700">{formatScore(result?.score)}</span>
          </div>
          <div className="h-1.5 w-full bg-system-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-stratosort-blue to-stratosort-indigo"
              style={{ width: `${relevancePercent}%` }}
            />
          </div>
        </div>
      )}

      {isSelected ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={(e) => (e.stopPropagation(), onOpen(path))}
          >
            <ExternalLink className="h-4 w-4" /> Open
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={(e) => (e.stopPropagation(), onReveal(path))}
          >
            <FolderOpen className="h-4 w-4" /> Reveal
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => (e.stopPropagation(), onCopyPath(path))}
          >
            <Copy className="h-4 w-4" /> Copy path
          </Button>
        </div>
      ) : null}
    </div>
  );
}

ResultRow.propTypes = {
  result: PropTypes.object.isRequired,
  isSelected: PropTypes.bool.isRequired,
  isBulkSelected: PropTypes.bool.isRequired,
  onSelect: PropTypes.func.isRequired,
  onToggleBulk: PropTypes.func.isRequired,
  onOpen: PropTypes.func.isRequired,
  onReveal: PropTypes.func.isRequired,
  onCopyPath: PropTypes.func.isRequired
};
ResultRow.displayName = 'ResultRow';

function StatsDisplay({ stats, isLoadingStats, onRefresh }) {
  return (
    <div className="flex items-center gap-2">
      {stats ? (
        <span className="flex items-center gap-1 text-xs text-system-gray-500">
          <span className="font-medium text-system-gray-700">{stats.folders}</span>
          <span>folder{stats.folders !== 1 ? 's' : ''}</span>
          <span className="text-system-gray-300">•</span>
          <span className="font-medium text-system-gray-700">{stats.files}</span>
          <span>file{stats.files !== 1 ? 's' : ''} indexed</span>
        </span>
      ) : (
        <span className="text-xs text-system-gray-400">No embeddings</span>
      )}
      <button
        type="button"
        className="inline-flex items-center gap-1 text-xs text-system-gray-400 hover:text-system-gray-700 p-1 rounded hover:bg-system-gray-100 transition-colors"
        onClick={onRefresh}
        disabled={isLoadingStats}
        title="Refresh embeddings status"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${isLoadingStats ? 'animate-spin' : ''}`} />
      </button>
    </div>
  );
}

StatsDisplay.propTypes = {
  stats: PropTypes.object,
  isLoadingStats: PropTypes.bool.isRequired,
  onRefresh: PropTypes.func.isRequired
};
StatsDisplay.displayName = 'StatsDisplay';

function EmptyEmbeddingsBanner({
  onRebuildFolders,
  onRebuildFiles,
  isRebuildingFolders,
  isRebuildingFiles
}) {
  return (
    <div className="glass-panel border border-stratosort-warning/30 bg-stratosort-warning/10 p-4 text-sm text-system-gray-800 rounded-xl">
      <div className="flex items-start gap-3">
        <div className="p-2 bg-stratosort-warning/20 rounded-lg shrink-0">
          <Sparkles className="w-5 h-5 text-stratosort-warning" />
        </div>
        <div className="flex-1">
          <div className="font-semibold text-system-gray-900">No embeddings yet</div>
          <div className="text-xs text-system-gray-600 mt-1 mb-3">
            Semantic search requires file embeddings. If you already analyzed files in the past but
            this number is still zero, your search index was likely reset and needs a one-time
            rebuild from analysis history.
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={onRebuildFolders}
              disabled={isRebuildingFolders}
            >
              {isRebuildingFolders ? 'Building...' : 'Build Folder Embeddings'}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={onRebuildFiles}
              disabled={isRebuildingFiles}
            >
              {isRebuildingFiles ? 'Building...' : 'Build File Embeddings'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

EmptyEmbeddingsBanner.propTypes = {
  onRebuildFolders: PropTypes.func.isRequired,
  onRebuildFiles: PropTypes.func.isRequired,
  isRebuildingFolders: PropTypes.bool.isRequired,
  isRebuildingFiles: PropTypes.bool.isRequired
};
EmptyEmbeddingsBanner.displayName = 'EmptyEmbeddingsBanner';

function TabButton({ active, onClick, icon: Icon, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-all
        ${
          active
            ? 'bg-stratosort-blue text-white shadow-md'
            : 'bg-system-gray-100 text-system-gray-600 hover:bg-system-gray-200 hover:text-system-gray-900'
        }
      `}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );
}

TabButton.propTypes = {
  active: PropTypes.bool.isRequired,
  onClick: PropTypes.func.isRequired,
  icon: PropTypes.elementType.isRequired,
  label: PropTypes.string.isRequired
};
TabButton.displayName = 'TabButton';

function SearchProcessCard({ icon: Icon, title, description, badge, footnote }) {
  return (
    <div className="glass-panel border border-system-gray-200 bg-gradient-to-br from-white to-stratosort-blue/5 p-3 rounded-xl shadow-sm">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-white/70 border border-system-gray-200 shadow-sm shrink-0">
          <Icon className="w-4 h-4 text-stratosort-blue" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-system-gray-900">{title}</div>
            {badge ? (
              <span className="px-2 py-1 rounded-full bg-stratosort-blue/10 text-stratosort-blue text-[11px] font-medium">
                {badge}
              </span>
            ) : null}
          </div>
          <div className="text-xs text-system-gray-600 leading-relaxed mt-1">{description}</div>
          {footnote ? (
            <div className="text-[11px] text-system-gray-400 mt-1">{footnote}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

SearchProcessCard.propTypes = {
  icon: PropTypes.elementType.isRequired,
  title: PropTypes.string.isRequired,
  description: PropTypes.string.isRequired,
  badge: PropTypes.string,
  footnote: PropTypes.string
};
SearchProcessCard.displayName = 'SearchProcessCard';

function SearchExplainer({ stats, searchStatusLabel, query, defaultTopK, isSearching }) {
  const queryTip =
    !query || query.length < 2
      ? 'Type at least 2 characters to search'
      : `Searching for “${query}”`;
  const indexedSummary =
    stats && typeof stats.files === 'number'
      ? `${stats.files} file${stats.files === 1 ? '' : 's'} • ${stats.folders || 0} folder${
          stats.folders === 1 ? '' : 's'
        } indexed`
      : 'Index status pending';
  const [showUnderstanding, setShowUnderstanding] = useState(true);
  const [showDirections, setShowDirections] = useState(true);

  return (
    <div className="surface-panel p-4 border border-system-gray-200 rounded-xl space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="space-y-0.5">
          <div className="text-sm font-semibold text-system-gray-900">Semantic search guidance</div>
          <div className="text-xs text-system-gray-500">
            Show or hide the “how it works” explainer and quick directions whenever you need a
            refresher.
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <div
            className={`px-3 py-1 rounded-full text-[11px] font-semibold border ${
              isSearching
                ? 'bg-amber-50 text-amber-700 border-amber-200'
                : 'bg-emerald-50 text-emerald-700 border-emerald-200'
            }`}
          >
            {searchStatusLabel}
          </div>
          <button
            type="button"
            onClick={() => setShowUnderstanding((v) => !v)}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-system-gray-700 bg-white border border-system-gray-200 rounded-lg hover:border-stratosort-blue focus:outline-none focus:ring-2 focus:ring-stratosort-blue/30"
            aria-expanded={showUnderstanding}
            aria-controls="semantic-understanding"
          >
            {showUnderstanding ? (
              <ChevronUp className="w-3.5 h-3.5 text-system-gray-500" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-system-gray-500" />
            )}
            {showUnderstanding ? 'Hide understanding' : 'Show understanding'}
          </button>
          <button
            type="button"
            onClick={() => setShowDirections((v) => !v)}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-system-gray-700 bg-white border border-system-gray-200 rounded-lg hover:border-stratosort-blue focus:outline-none focus:ring-2 focus:ring-stratosort-blue/30"
            aria-expanded={showDirections}
            aria-controls="semantic-directions"
          >
            {showDirections ? (
              <ChevronUp className="w-3.5 h-3.5 text-system-gray-500" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-system-gray-500" />
            )}
            {showDirections ? 'Hide directions' : 'Show directions'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-[11px] text-system-gray-600">
        <span className="px-2 py-1 rounded-full bg-stratosort-blue/10 text-stratosort-blue font-medium">
          Hybrid: semantic + keyword
        </span>
        <span className="px-2 py-1 rounded-full bg-system-gray-100 text-system-gray-700 font-medium">
          Showing top {defaultTopK}
        </span>
        <span className="px-2 py-1 rounded-full bg-system-gray-100 text-system-gray-700 font-medium">
          {indexedSummary}
        </span>
        <span className="px-2 py-1 rounded-full bg-system-gray-50 text-system-gray-500 font-medium">
          {queryTip}
        </span>
      </div>

      {showUnderstanding ? (
        <div id="semantic-understanding" className="grid sm:grid-cols-3 gap-3">
          <SearchProcessCard
            icon={Sparkles}
            title="Understand intent"
            description="Your query is embedded to capture meaning, synonyms, and topics so we can match files even when wording differs."
            badge="Semantic"
          />
          <SearchProcessCard
            icon={Layers}
            title="Hybrid ranker"
            description="We blend semantic similarity with BM25 keywords, balance the weights, and rerank the combined list."
            badge="Hybrid"
            footnote={`Top ${defaultTopK} shown`}
          />
          <SearchProcessCard
            icon={List}
            title="Explain results"
            description="We keep scores visible, highlight matched terms/categories, and show a quick summary for context."
            badge="Transparent"
            footnote={indexedSummary}
          />
        </div>
      ) : null}

      {showDirections ? (
        <div id="semantic-directions" className="grid gap-3 sm:grid-cols-[1.4fr,1fr] items-start">
          <div className="glass-panel border border-system-gray-200 bg-white p-3 rounded-xl shadow-sm space-y-2">
            <div className="text-sm font-semibold text-system-gray-900">Quick directions</div>
            <ol className="list-decimal list-inside text-xs text-system-gray-600 space-y-1.5">
              <li>
                Describe what you need in plain language — topics, people, or outcomes work well.
              </li>
              <li>
                Refine with specifics like dates, file types, or folder names to tighten matches.
              </li>
              <li>Open a result to view, or use “Reveal in folder” to jump to its location.</li>
            </ol>
            <div className="text-[11px] text-system-gray-500">
              Tip: Press <kbd className="px-1 py-0.5 bg-system-gray-100 rounded">Ctrl/Cmd + K</kbd>{' '}
              anytime to open search.
            </div>
          </div>
          <div className="glass-panel border border-system-gray-200 bg-white p-3 rounded-xl shadow-sm space-y-2">
            <div className="text-sm font-semibold text-system-gray-900">Example prompts</div>
            <div className="space-y-1 text-xs text-system-gray-600">
              <div className="italic">tax documents from 2024</div>
              <div className="italic">photos of family vacation</div>
              <div className="italic">project proposal for client</div>
              <div className="italic">invoice for the 3D printer order</div>
            </div>
            {stats?.files === 0 && (
              <div className="mt-1 text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">
                No files indexed yet. Build embeddings first.
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

SearchExplainer.propTypes = {
  stats: PropTypes.object,
  searchStatusLabel: PropTypes.string.isRequired,
  query: PropTypes.string,
  defaultTopK: PropTypes.number.isRequired,
  isSearching: PropTypes.bool.isRequired
};
SearchExplainer.displayName = 'SearchExplainer';

// ============================================================================
// Main Component
// ============================================================================

export default function UnifiedSearchModal({
  isOpen,
  onClose,
  defaultTopK = 20,
  initialTab = 'search'
}) {
  // Tab state
  // Graph is currently feature-flagged off. If callers pass initialTab="graph",
  // ensure we still render the Search tab content instead of a blank body.
  const effectiveInitialTab = SHOW_GRAPH ? initialTab : 'search';
  const [activeTab, setActiveTab] = useState(effectiveInitialTab);

  // Shared state
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [stats, setStats] = useState(null);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [isRebuildingFolders, setIsRebuildingFolders] = useState(false);
  const [isRebuildingFiles, setIsRebuildingFiles] = useState(false);
  const [error, setError] = useState('');

  // Search tab state
  const [searchResults, setSearchResults] = useState([]);
  const [selectedSearchId, setSelectedSearchId] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const [bulkSelectedIds, setBulkSelectedIds] = useState(new Set());
  const [searchRefreshTrigger, setSearchRefreshTrigger] = useState(0);

  // Graph tab state
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [freshMetadata, setFreshMetadata] = useState(null);
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(false);
  const [addMode, setAddMode] = useState(true);
  const [withinQuery, setWithinQuery] = useState('');
  const [debouncedWithinQuery, setDebouncedWithinQuery] = useState('');
  const [graphStatus, setGraphStatus] = useState('');

  // Layout state
  const [autoLayout, setAutoLayout] = useState(true);
  const [isLayouting, setIsLayouting] = useState(false);

  // Multi-hop expansion state
  const [hopCount, setHopCount] = useState(1);
  const [decayFactor, setDecayFactor] = useState(0.7);

  // Clustering state
  const [showClusters, setShowClusters] = useState(false);
  const [isComputingClusters, setIsComputingClusters] = useState(false);

  // Duplicates detection state (duplicateGroups stored for potential future export feature)
  // eslint-disable-next-line no-unused-vars
  const [duplicateGroups, setDuplicateGroups] = useState([]);
  const [isFindingDuplicates, setIsFindingDuplicates] = useState(false);

  // Confirmation modal state
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Refs
  const lastSearchRef = useRef(0);
  const withinReqRef = useRef(0);
  const reactFlowInstance = useRef(null);

  // Refs for tracking auto-load state
  const hasAutoLoadedClusters = useRef(false);

  // Ref to avoid temporal dead zone with loadClusters in keyboard shortcuts
  const loadClustersRef = useRef(null);

  // ============================================================================
  // Reset on open
  // ============================================================================

  useEffect(() => {
    if (!isOpen) {
      // Cancel any pending layout operations when modal closes
      cancelPendingLayout();
      hasAutoLoadedClusters.current = false;
      return () => {};
    }
    setActiveTab(effectiveInitialTab);
    setQuery('');
    setDebouncedQuery('');
    setError('');
    // Search state
    setSearchResults([]);
    setSelectedSearchId(null);
    setIsSearching(false);
    setBulkSelectedIds(new Set());
    // Graph state
    setNodes([]);
    setEdges([]);
    setSelectedNodeId(null);
    setAddMode(true);
    setWithinQuery('');
    setDebouncedWithinQuery('');
    setGraphStatus('');
    // Layout state
    setAutoLayout(true);
    setIsLayouting(false);
    // Multi-hop state
    setHopCount(1);
    setDecayFactor(0.7);
    // Clustering state
    setShowClusters(false);
    setIsComputingClusters(false);
    // Duplicates state
    setDuplicateGroups([]);
    setIsFindingDuplicates(false);

    // Cleanup pending layouts on unmount
    return () => cancelPendingLayout();
  }, [isOpen, effectiveInitialTab]);

  // ============================================================================
  // Keyboard Shortcuts
  // ============================================================================

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleKeyDown = (e) => {
      // Ctrl/Cmd + F: Focus search input
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        // Find and focus the search input
        const searchInput = document.querySelector(
          '[aria-label="Search query"], [aria-label="Search to add nodes"]'
        );
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
      }

      // Escape: Close modal (handled by Modal component, but also clear selection)
      if (e.key === 'Escape') {
        if (selectedNodeId) {
          setSelectedNodeId(null);
        }
      }

      // Ctrl/Cmd + Enter: Run search or load clusters
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (activeTab === 'graph' && nodes.length === 0) {
          loadClustersRef.current?.();
        }
      }

      // Tab switching: Ctrl + 1/2
      if (e.ctrlKey && e.key === '1') {
        e.preventDefault();
        setActiveTab('search');
      }
      if (e.ctrlKey && e.key === '2') {
        e.preventDefault();
        setActiveTab('graph');
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, activeTab, selectedNodeId, nodes.length]);

  // ============================================================================
  // Shared: Stats & Rebuild
  // ============================================================================

  const refreshStats = useCallback(async () => {
    if (!window?.electronAPI?.embeddings?.getStats) return;
    setIsLoadingStats(true);
    try {
      const res = await window.electronAPI.embeddings.getStats();
      if (res?.success) {
        setStats({
          files: typeof res.files === 'number' ? res.files : 0,
          folders: typeof res.folders === 'number' ? res.folders : 0,
          serverUrl: res.serverUrl || ''
        });
      } else {
        setStats(null);
      }
    } catch (e) {
      logger.warn('Failed to load embedding stats', { error: e?.message });
      setStats(null);
    } finally {
      setIsLoadingStats(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    refreshStats();
  }, [isOpen, refreshStats]);

  // Listen for file operation events (move/delete) to refresh search results
  useEffect(() => {
    // Guard: Exit early if API not available to prevent unnecessary effect re-runs
    const api = window.electronAPI?.events?.onFileOperationComplete;
    if (!api) return undefined;

    const cleanup = api((data) => {
      if (data?.operation === 'move' || data?.operation === 'delete') {
        logger.debug('[Search] File operation detected, refreshing search', {
          operation: data.operation,
          oldPath: data.oldPath
        });
        // Trigger search refresh by incrementing counter
        setSearchRefreshTrigger((prev) => prev + 1);
        // Also refresh stats
        refreshStats();
      }
    });
    return cleanup;
  }, [refreshStats]);

  const rebuildFolders = useCallback(async () => {
    if (!window?.electronAPI?.embeddings?.rebuildFolders) return;
    setIsRebuildingFolders(true);
    setError('');
    try {
      const res = await window.electronAPI.embeddings.rebuildFolders();
      if (!res?.success) throw new Error(res?.error || 'Folder rebuild failed');
      await refreshStats();
    } catch (e) {
      setError(getErrorMessage(e, 'Folder rebuild'));
    } finally {
      setIsRebuildingFolders(false);
    }
  }, [refreshStats]);

  const rebuildFiles = useCallback(async () => {
    if (!window?.electronAPI?.embeddings?.rebuildFiles) return;
    setIsRebuildingFiles(true);
    setError('');
    try {
      const res = await window.electronAPI.embeddings.rebuildFiles();
      if (!res?.success) throw new Error(res?.error || 'File rebuild failed');
      await refreshStats();
    } catch (e) {
      setError(getErrorMessage(e, 'File rebuild'));
    } finally {
      setIsRebuildingFiles(false);
    }
  }, [refreshStats]);

  // ============================================================================
  // Shared: File Actions
  // ============================================================================

  const openFile = useCallback(async (filePath) => {
    if (!filePath) return;
    try {
      await window.electronAPI?.files?.open?.(filePath);
    } catch (e) {
      logger.error('[Search] Failed to open file', e);
    }
  }, []);

  const revealFile = useCallback(async (filePath) => {
    if (!filePath) return;
    try {
      await window.electronAPI?.files?.reveal?.(filePath);
    } catch (e) {
      logger.error('[Search] Failed to reveal file', e);
    }
  }, []);

  const copyPath = useCallback(async (filePath) => {
    if (!filePath) return;
    try {
      await navigator.clipboard.writeText(filePath);
    } catch (e) {
      logger.warn('[Search] Clipboard write failed', e?.message || e);
    }
  }, []);

  // ============================================================================
  // Bulk Selection Handlers
  // ============================================================================

  const toggleBulkSelection = useCallback((resultId) => {
    setBulkSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(resultId)) {
        next.delete(resultId);
      } else {
        next.add(resultId);
      }
      return next;
    });
  }, []);

  const selectAllResults = useCallback(() => {
    setBulkSelectedIds(new Set(searchResults.map((r) => r.id)));
  }, [searchResults]);

  const clearBulkSelection = useCallback(() => {
    setBulkSelectedIds(new Set());
  }, []);

  const copySelectedPaths = useCallback(async () => {
    const paths = searchResults
      .filter((r) => bulkSelectedIds.has(r.id))
      .map((r) => r.metadata?.path)
      .filter(Boolean);
    if (paths.length === 0) return;
    try {
      await navigator.clipboard.writeText(paths.join('\n'));
      setGraphStatus(`Copied ${paths.length} path(s) to clipboard`);
    } catch (e) {
      logger.warn('[Search] Clipboard write failed', e);
      setError('Could not copy to clipboard. Check browser permissions.');
    }
  }, [searchResults, bulkSelectedIds]);

  const moveSelectedToFolder = useCallback(async () => {
    const selectedFiles = searchResults.filter((r) => bulkSelectedIds.has(r.id));
    if (selectedFiles.length === 0) return;

    try {
      const dirResult = await window.electronAPI?.files?.selectDirectory?.();
      if (!dirResult?.success || !dirResult?.path) return;

      const destFolder = dirResult.path;
      const totalFiles = selectedFiles.length;
      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < totalFiles; i++) {
        const file = selectedFiles[i];
        const sourcePath = file.metadata?.path;
        if (!sourcePath) continue;

        // Show progress indicator for large batch operations
        if (totalFiles > 3) {
          setGraphStatus(`Moving file ${i + 1} of ${totalFiles}...`);
        }

        const fileName = safeBasename(sourcePath);
        try {
          await window.electronAPI?.files?.performOperation?.({
            operation: 'move',
            source: sourcePath,
            destination: `${destFolder}/${fileName}`
          });
          successCount++;
        } catch (e) {
          logger.error('[Search] Failed to move file', { path: sourcePath, error: e });
          failCount++;
        }
      }

      if (successCount > 0) {
        setGraphStatus(`Moved ${successCount} file(s) to ${safeBasename(destFolder)}`);
        clearBulkSelection();
        // Optionally refresh search results
      }
      if (failCount > 0) {
        setError(`Failed to move ${failCount} file(s)`);
      }
    } catch (e) {
      logger.error('[Search] Move operation failed', e);
      setError(`Move failed: ${e?.message || 'Unknown error'}`);
    }
  }, [searchResults, bulkSelectedIds, clearBulkSelection]);

  /**
   * Create a Smart Folder from a cluster's metadata
   * Uses the cluster's label, category, and tags to define the folder
   */
  const handleCreateSmartFolderFromCluster = useCallback(async (clusterData) => {
    try {
      // Prompt user to select destination directory
      const dirResult = await window.electronAPI?.files?.selectDirectory?.();
      if (!dirResult?.success || !dirResult?.path) {
        // User cancelled
        return;
      }

      const basePath = dirResult.path;
      const folderName = clusterData.label || 'Cluster Folder';

      // Build the full path for the new smart folder
      const folderPath = `${basePath}/${folderName}`;

      // Create the smart folder using existing API
      const result = await window.electronAPI?.smartFolders?.add?.({
        name: folderName,
        path: folderPath,
        description: `Auto-created from cluster with ${clusterData.memberCount || 0} similar files`,
        keywords: clusterData.commonTags || [],
        category: clusterData.dominantCategory || 'General'
      });

      if (result?.success) {
        setError(''); // Clear any existing error
        setGraphStatus(`Smart folder "${folderName}" created successfully!`);
        logger.info('[Graph] Created smart folder from cluster', {
          folderName,
          memberCount: clusterData.memberCount
        });
      } else {
        setError(`Failed to create folder: ${result?.error || 'Unknown error'}`);
      }
    } catch (e) {
      logger.error('[Graph] Failed to create smart folder from cluster', e);
      setError(`Failed to create folder: ${e?.message || 'Unknown error'}`);
    }
  }, []);

  /**
   * Move all files in a cluster to a selected folder
   * Uses the existing FILES.PERFORM_OPERATION handler
   */
  const handleMoveAllToFolder = useCallback(async (clusterData) => {
    try {
      const memberIds = clusterData?.memberIds || [];
      if (memberIds.length === 0) {
        setError('No files in this cluster');
        return;
      }

      // Prompt user to select destination
      const dirResult = await window.electronAPI?.files?.selectDirectory?.();
      if (!dirResult?.success || !dirResult?.path) {
        return; // User cancelled
      }

      const destFolder = dirResult.path;

      // Get file metadata for all members in one call
      const metadataResult = await window.electronAPI?.embeddings?.getFileMetadata?.(memberIds);
      if (!metadataResult?.success) {
        setError('Failed to retrieve file metadata');
        return;
      }

      const metadata = metadataResult.metadata || {};
      let successCount = 0;
      let failCount = 0;

      // Move each file
      for (const id of memberIds) {
        try {
          const fileMetadata = metadata[id];
          const sourcePath = fileMetadata?.path;
          if (!sourcePath) {
            failCount++;
            continue;
          }

          const fileName = safeBasename(sourcePath);
          await window.electronAPI?.files?.performOperation?.({
            operation: 'move',
            source: sourcePath,
            destination: `${destFolder}/${fileName}`
          });
          successCount++;
        } catch (e) {
          logger.error('[Graph] Failed to move cluster file', { id, error: e });
          failCount++;
        }
      }

      if (successCount > 0) {
        setGraphStatus(`Moved ${successCount} file(s) to ${safeBasename(destFolder)}`);
      }
      if (failCount > 0) {
        setError(`Failed to move ${failCount} file(s)`);
      }
    } catch (e) {
      logger.error('[Graph] Move all to folder failed', e);
      setError(`Move failed: ${e?.message || 'Unknown error'}`);
    }
  }, []);

  /**
   * Export a list of file paths from a cluster to clipboard
   */
  const handleExportFileList = useCallback(async (clusterData) => {
    try {
      const memberIds = clusterData?.memberIds || [];
      if (memberIds.length === 0) {
        setError('No files in this cluster');
        return;
      }

      // Get file metadata for all members in one call
      const metadataResult = await window.electronAPI?.embeddings?.getFileMetadata?.(memberIds);
      if (!metadataResult?.success) {
        setError('Failed to retrieve file metadata');
        return;
      }

      const metadata = metadataResult.metadata || {};
      const paths = memberIds.map((id) => metadata[id]?.path).filter(Boolean);

      if (paths.length === 0) {
        setError('Could not retrieve file paths');
        return;
      }

      try {
        await navigator.clipboard.writeText(paths.join('\n'));
        setGraphStatus(`Copied ${paths.length} file path(s) to clipboard`);
      } catch (clipboardErr) {
        logger.error('[Graph] Clipboard write failed', clipboardErr);
        setError('Could not copy to clipboard. Check browser permissions.');
      }
    } catch (e) {
      logger.error('[Graph] Export file list failed', e);
      setError(`Export failed: ${e?.message || 'Unknown error'}`);
    }
  }, []);

  /**
   * Find near-duplicate files across the collection
   * Displays them as special clusters in the graph
   */
  const handleFindDuplicates = useCallback(async () => {
    setIsFindingDuplicates(true);
    setError('');
    setDuplicateGroups([]);

    try {
      const result = await window.electronAPI?.embeddings?.findDuplicates?.({
        threshold: 0.9,
        maxResults: 30
      });

      if (!result?.success) {
        setError(result?.error || 'Failed to find duplicates');
        return;
      }

      if (result.groups.length === 0) {
        setGraphStatus('No duplicate files found');
        return;
      }

      // Store duplicate groups
      setDuplicateGroups(result.groups);

      // Display duplicates as special cluster nodes
      const dupNodes = result.groups.map((group, idx) => ({
        id: group.id,
        type: 'clusterNode',
        position: defaultNodePosition(idx),
        data: {
          kind: 'duplicate',
          label: `Duplicates (${Math.round(group.averageSimilarity * 100)}% similar)`,
          memberCount: group.memberCount,
          memberIds: group.members.map((m) => m.id),
          expanded: false,
          confidence: 'high',
          dominantCategory: 'Duplicate Group',
          commonTags: [],
          onCreateSmartFolder: handleCreateSmartFolderFromCluster,
          onMoveAllToFolder: handleMoveAllToFolder,
          onExportFileList: handleExportFileList
        },
        draggable: true
      }));

      setNodes(dupNodes);
      setEdges([]);
      setShowClusters(false);
      setGraphStatus(
        `Found ${result.groups.length} duplicate group(s) with ${result.totalDuplicates} files`
      );
    } catch (e) {
      logger.error('[Graph] Find duplicates failed', e);
      setError(`Find duplicates failed: ${e?.message || 'Unknown error'}`);
    } finally {
      setIsFindingDuplicates(false);
    }
  }, [handleCreateSmartFolderFromCluster, handleMoveAllToFolder, handleExportFileList]);

  // ============================================================================
  // Debounce query
  // ============================================================================

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(query.trim()), TIMEOUTS.DEBOUNCE_INPUT);
    return () => clearTimeout(handle);
  }, [query]);

  // ============================================================================
  // Search Tab Logic
  // ============================================================================

  const selectedSearchResult = useMemo(
    () => (selectedSearchId ? searchResults.find((r) => r?.id === selectedSearchId) : null),
    [searchResults, selectedSearchId]
  );

  useEffect(() => {
    if (activeTab !== 'search') return undefined;
    let cancelled = false;

    const run = async () => {
      if (!isOpen) return;
      const q = debouncedQuery;
      if (!q || q.length < 2) {
        setSearchResults([]);
        setSelectedSearchId(null);
        setError('');
        return;
      }

      const requestId = Date.now();
      lastSearchRef.current = requestId;
      setIsSearching(true);
      setError('');

      try {
        // Use hybrid search with options
        const response = await window.electronAPI?.embeddings?.search?.(q, {
          topK: defaultTopK,
          mode: 'hybrid'
        });
        if (cancelled) return;
        if (lastSearchRef.current !== requestId) return;

        if (!response || response.success !== true) {
          setSearchResults([]);
          setSelectedSearchId(null);
          setError(getErrorMessage({ message: response?.error }, 'Search'));
          return;
        }

        const next = Array.isArray(response.results) ? response.results : [];
        setSearchResults(next);
        setSelectedSearchId(next[0]?.id || null);
        setBulkSelectedIds(new Set()); // Clear bulk selection on new results
      } catch (e) {
        if (cancelled) return;
        if (lastSearchRef.current !== requestId) return;
        setSearchResults([]);
        setSelectedSearchId(null);
        setError(getErrorMessage(e, 'Search'));
      } finally {
        if (!cancelled && lastSearchRef.current === requestId) {
          setIsSearching(false);
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
    // searchRefreshTrigger triggers re-search when files are moved/deleted
  }, [debouncedQuery, isOpen, defaultTopK, activeTab, searchRefreshTrigger]);

  const searchStatusLabel = useMemo(() => {
    if (isSearching) return 'Searching...';
    if (error) return 'Search error';
    if (!debouncedQuery || debouncedQuery.length < 2) return 'Type to search';
    return `${searchResults.length} result${searchResults.length === 1 ? '' : 's'}`;
  }, [isSearching, error, debouncedQuery, searchResults.length]);

  // ============================================================================
  // Graph Tab Logic
  // ============================================================================

  const fileNodeIds = useMemo(
    () => nodes.filter((n) => n?.data?.kind === 'file').map((n) => n.id),
    [nodes]
  );

  const selectedNode = useMemo(
    () => (selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) : null),
    [nodes, selectedNodeId]
  );

  // Fetch fresh metadata from ChromaDB when a file node is selected
  // This ensures we show the CURRENT file path after files have been moved/organized
  useEffect(() => {
    if (!selectedNode || selectedNode.data?.kind !== 'file') {
      setFreshMetadata(null);
      return undefined;
    }

    let cancelled = false;
    const nodeId = selectedNode.id;

    const fetchFreshMetadata = async () => {
      setIsLoadingMetadata(true);
      try {
        const resp = await window.electronAPI?.embeddings?.getFileMetadata?.([nodeId]);
        if (!cancelled && resp?.success) {
          setFreshMetadata(resp.metadata?.[nodeId] || null);
        }
      } catch (e) {
        // Silently fail - use cached metadata from node
        if (!cancelled) setFreshMetadata(null);
      } finally {
        if (!cancelled) setIsLoadingMetadata(false);
      }
    };

    fetchFreshMetadata();
    return () => {
      cancelled = true;
    };
  }, [selectedNode]);

  const upsertFileNode = useCallback((result, preferredPosition) => {
    const id = result?.id;
    if (!id) return null;
    const metadata = result?.metadata || {};
    const path = metadata.path || '';
    const name = metadata.name || safeBasename(path) || id;
    const score = typeof result?.score === 'number' ? result.score : undefined;

    // Parse tags from JSON string (ChromaDB stores as string) or use array directly
    let tags = [];
    if (Array.isArray(metadata.tags)) {
      tags = metadata.tags;
    } else if (typeof metadata.tags === 'string' && metadata.tags) {
      try {
        tags = JSON.parse(metadata.tags);
      } catch {
        tags = [];
      }
    }
    const category = metadata.category || '';
    const subject = metadata.subject || '';
    const summary = metadata.summary || '';

    return {
      id,
      type: 'fileNode', // Custom node type for card-like styling
      position: preferredPosition || { x: 0, y: 0 },
      data: {
        kind: 'file',
        label: name,
        path,
        score,
        tags,
        category,
        subject,
        summary
      },
      draggable: true
    };
  }, []);

  /**
   * Apply ELK layout to current graph nodes and edges
   */
  const applyLayout = useCallback(async () => {
    if (nodes.length === 0) return;

    setIsLayouting(true);
    setGraphStatus('Applying layout...');

    try {
      const layoutedNodes = await elkLayout(nodes, edges, {
        direction: 'RIGHT',
        spacing: 80,
        layerSpacing: 120
      });

      setNodes(layoutedNodes);
      setGraphStatus('Layout applied');
    } catch (error) {
      logger.error('[Graph] Layout failed:', error);
      setGraphStatus('Layout failed');
    } finally {
      setIsLayouting(false);
    }
  }, [nodes, edges]);

  /**
   * Load and display semantic clusters
   */
  const loadClusters = useCallback(async () => {
    setIsComputingClusters(true);
    setGraphStatus('Computing clusters...');
    setError('');

    try {
      // First compute clusters
      const computeResp = await window.electronAPI?.embeddings?.computeClusters?.('auto');
      if (!computeResp || computeResp.success !== true) {
        throw new Error(computeResp?.error || 'Failed to compute clusters');
      }

      // Get clusters for display
      const clustersResp = await window.electronAPI?.embeddings?.getClusters?.();
      if (!clustersResp || clustersResp.success !== true) {
        throw new Error(clustersResp?.error || 'Failed to get clusters');
      }

      const clusters = clustersResp.clusters || [];
      const crossClusterEdges = clustersResp.crossClusterEdges || [];

      if (clusters.length === 0) {
        setGraphStatus('No clusters found');
        return;
      }

      // Create cluster nodes with rich metadata
      const clusterNodes = clusters.map((cluster, idx) => ({
        id: cluster.id,
        type: 'clusterNode',
        position: defaultNodePosition(idx),
        data: {
          kind: 'cluster',
          label: cluster.label,
          memberCount: cluster.memberCount,
          memberIds: cluster.memberIds,
          expanded: false,
          // Rich metadata for meaningful cluster display
          confidence: cluster.confidence || 'low',
          dominantCategory: cluster.dominantCategory || null,
          commonTags: cluster.commonTags || [],
          // Action callbacks for cluster context menu
          onCreateSmartFolder: handleCreateSmartFolderFromCluster,
          onMoveAllToFolder: handleMoveAllToFolder,
          onExportFileList: handleExportFileList
        },
        draggable: true
      }));

      // Create cross-cluster edges
      const clusterEdges = crossClusterEdges.map((edge) => ({
        id: `cross:${edge.source}->${edge.target}`,
        source: edge.source,
        target: edge.target,
        type: 'default',
        animated: true,
        style: {
          stroke: '#9ca3af',
          strokeWidth: 1.5,
          strokeDasharray: '5,5'
        },
        data: { kind: 'cross_cluster', weight: edge.similarity }
      }));

      // Update graph
      setNodes(clusterNodes);
      setEdges(clusterEdges);
      setShowClusters(true);
      setGraphStatus(`${clusters.length} clusters found`);

      // Apply radial layout for better cluster visualization
      if (clusterNodes.length > 0) {
        try {
          const layoutedNodes = clusterRadialLayout(clusterNodes, clusterEdges, {
            centerX: 400,
            centerY: 300,
            radius: Math.min(250, 80 + clusterNodes.length * 30)
          });
          setNodes(layoutedNodes);
        } catch (layoutError) {
          logger.warn('[Graph] Cluster layout failed:', layoutError);
        }
      }
    } catch (e) {
      setError(getErrorMessage(e, 'Cluster loading'));
      setGraphStatus('');
    } finally {
      setIsComputingClusters(false);
    }
  }, [handleCreateSmartFolderFromCluster, handleMoveAllToFolder, handleExportFileList]);

  // Assign to ref so keyboard shortcuts can access it
  loadClustersRef.current = loadClusters;

  // Auto-load clusters when opening graph tab (if files are indexed)
  useEffect(() => {
    if (!isOpen || activeTab !== 'graph') return;
    if (hasAutoLoadedClusters.current) return;
    if (nodes.length > 0) return; // Already have nodes
    if (!stats?.files || stats.files === 0) return; // No indexed files

    // Auto-load clusters to give users something to explore
    hasAutoLoadedClusters.current = true;
    loadClusters();
  }, [isOpen, activeTab, stats, nodes.length, loadClusters]);

  /**
   * Expand a cluster to show its members with current file names
   */
  const expandCluster = useCallback(
    async (clusterId, memberIds) => {
      if (!Array.isArray(memberIds) || memberIds.length === 0) return;

      setGraphStatus('Expanding cluster...');

      try {
        // Get cluster node for layout calculation
        const clusterNode = nodes.find((n) => n.id === clusterId);

        // Fetch actual file metadata to get current names (not original names)
        let membersWithMetadata = [];
        try {
          // Extract numeric cluster ID from the string ID (e.g., "cluster:0" -> 0)
          const numericClusterId = parseInt(clusterId.replace('cluster:', ''), 10);
          const memberResp =
            await window.electronAPI?.embeddings?.getClusterMembers?.(numericClusterId);

          if (memberResp?.success && Array.isArray(memberResp.members)) {
            membersWithMetadata = memberResp.members;
          }
        } catch (fetchErr) {
          logger.warn('[Graph] Failed to fetch cluster members metadata:', fetchErr);
        }

        // Build a map of id -> metadata for quick lookup
        const metadataMap = new Map(membersWithMetadata.map((m) => [m.id, m.metadata || {}]));

        // Create file nodes with proper current names from metadata
        const memberNodes = memberIds.map((id) => {
          const metadata = metadataMap.get(id) || {};
          // Use metadata.name first (current organized name), fallback to path extraction
          const currentName =
            metadata.name ||
            safeBasename(metadata.path) ||
            safeBasename(id) ||
            id.split('/').pop() ||
            id.split('\\').pop() ||
            id;

          return {
            id,
            type: 'fileNode',
            position: { x: 0, y: 0 }, // Will be set by layout
            data: {
              kind: 'file',
              label: currentName,
              path: metadata.path || id,
              // Include metadata for edge tooltips
              tags: Array.isArray(metadata.tags) ? metadata.tags : [],
              category: metadata.category || '',
              subject: metadata.subject || ''
            },
            draggable: true
          };
        });

        // Apply expansion layout to position nodes nicely
        const layoutedMemberNodes = clusterExpansionLayout(clusterNode, memberNodes, {
          offsetX: 280,
          spacing: 65,
          fanAngle: Math.PI / 2.5
        });

        // Create edges from cluster to members
        const memberEdges = memberIds.map((id) => ({
          id: `cluster:${clusterId}->${id}`,
          source: clusterId,
          target: id,
          type: 'default',
          animated: false,
          style: { stroke: '#f59e0b', strokeWidth: 1.5 },
          data: { kind: 'cluster_member' }
        }));

        // Add to existing graph
        setNodes((prev) => {
          const existingIds = new Set(prev.map((n) => n.id));
          const newNodes = layoutedMemberNodes.filter((n) => !existingIds.has(n.id));

          // Mark cluster as expanded
          const updated = prev.map((n) => {
            if (n.id === clusterId) {
              return { ...n, data: { ...n.data, expanded: true } };
            }
            return n;
          });

          return [...updated, ...newNodes];
        });

        setEdges((prev) => {
          const existingIds = new Set(prev.map((e) => e.id));
          const newEdges = memberEdges.filter((e) => !existingIds.has(e.id));
          return [...prev, ...newEdges];
        });

        setGraphStatus(`Expanded: +${layoutedMemberNodes.length} files`);
      } catch (e) {
        setError(getErrorMessage(e, 'Cluster expansion'));
        setGraphStatus('');
      }
    },
    [nodes]
  );

  const runGraphSearch = useCallback(async () => {
    const q = query.trim();
    if (q.length < 2) return;

    // Capture addMode at search start to prevent race condition if user toggles during async operation
    const shouldAddMode = addMode;

    setError('');
    setGraphStatus('Searching...');

    try {
      // Use hybrid search with options
      const resp = await window.electronAPI?.embeddings?.search?.(q, {
        topK: defaultTopK,
        mode: 'hybrid'
      });
      if (!resp || resp.success !== true) {
        throw new Error(resp?.error || 'Search failed');
      }

      const results = Array.isArray(resp.results) ? resp.results : [];
      const salt = Date.now();
      const queryNodeId = makeQueryNodeId(q, salt);

      const nextNodes = [];
      const nextEdges = [];

      const queryNode = {
        id: queryNodeId,
        type: 'queryNode', // Custom query node type
        position: { x: 40, y: 40 },
        data: { kind: 'query', label: q },
        draggable: true
      };

      nextNodes.push(queryNode);

      results.forEach((r, idx) => {
        const node = upsertFileNode(r, defaultNodePosition(idx));
        if (!node) return;
        nextNodes.push(node);
        nextEdges.push({
          id: `e:${queryNodeId}->${node.id}`,
          source: queryNodeId,
          target: node.id,
          type: 'queryMatch',
          animated: false, // Using custom edge with hover effects
          data: {
            kind: 'query_match',
            score: r.score,
            matchDetails: r.matchDetails || {}
          }
        });
      });

      // Compute final nodes and edges FIRST to avoid stale closure issues
      // These values are used for both state update and layout calculation
      let finalNodes;
      let finalEdges;
      let nodeLimitReached = false;

      if (!shouldAddMode) {
        // Replace mode - use nextNodes directly
        if (nextNodes.length > MAX_GRAPH_NODES) {
          finalNodes = nextNodes.slice(0, MAX_GRAPH_NODES);
          nodeLimitReached = true;
          setError(
            `Graph limit (${MAX_GRAPH_NODES} nodes) exceeded. Showing first ${MAX_GRAPH_NODES} results.`
          );
        } else {
          finalNodes = nextNodes;
        }
        finalEdges = nextEdges;
      } else {
        // Add mode - merge with current state (captured at function start)
        const nodeMap = new Map(nodes.map((n) => [n.id, n]));
        nextNodes.forEach((n) => {
          if (!nodeMap.has(n.id)) nodeMap.set(n.id, n);
        });
        const merged = Array.from(nodeMap.values());

        if (merged.length > MAX_GRAPH_NODES) {
          // Don't add more nodes if limit reached
          finalNodes = nodes;
          nodeLimitReached = true;
          setError(`Graph limit (${MAX_GRAPH_NODES} nodes) reached. Clear graph to start fresh.`);
        } else {
          finalNodes = merged;
        }

        const edgeMap = new Map(edges.map((e) => [e.id, e]));
        nextEdges.forEach((e) => edgeMap.set(e.id, e));
        finalEdges = Array.from(edgeMap.values());
      }

      // Now update state with computed values (only if there are changes)
      setNodes((prev) => {
        // Skip update if nothing changed (add mode and limit reached)
        if (nodeLimitReached && shouldAddMode) return prev;
        // Check if update is needed
        if (prev.length === finalNodes.length && prev.every((n, i) => n.id === finalNodes[i]?.id)) {
          return prev;
        }
        return finalNodes;
      });

      setEdges((prev) => {
        if (nodeLimitReached && shouldAddMode) return prev;
        if (prev.length === finalEdges.length && prev.every((e, i) => e.id === finalEdges[i]?.id)) {
          return prev;
        }
        return finalEdges;
      });

      setSelectedNodeId(results[0]?.id || queryNodeId);
      setGraphStatus(`${results.length} result${results.length === 1 ? '' : 's'}`);

      // Apply auto-layout if enabled (debounced to prevent rapid re-layouts)
      // Uses pre-computed finalNodes/finalEdges to avoid stale state issues
      if (autoLayout && finalNodes.length > 1 && !nodeLimitReached) {
        setGraphStatus('Applying layout...');
        try {
          // Use smart layout for large graphs (progressive rendering)
          // Use debounced layout for smaller graphs
          let layoutedNodes;
          if (finalNodes.length > LARGE_GRAPH_THRESHOLD) {
            const result = await smartLayout(finalNodes, finalEdges, {
              direction: 'RIGHT',
              spacing: 80,
              layerSpacing: 120,
              progressive: true
            });
            layoutedNodes = result.nodes;
            if (result.isPartial) {
              setGraphStatus(
                `${results.length} results (${result.layoutedCount} laid out, ${finalNodes.length - result.layoutedCount} in grid)`
              );
            }
          } else {
            layoutedNodes = await debouncedElkLayout(finalNodes, finalEdges, {
              direction: 'RIGHT',
              spacing: 80,
              layerSpacing: 120,
              debounceMs: 150
            });
          }
          setNodes(layoutedNodes);
          if (finalNodes.length <= LARGE_GRAPH_THRESHOLD) {
            setGraphStatus(`${results.length} result${results.length === 1 ? '' : 's'} (laid out)`);
          }
        } catch (layoutError) {
          logger.warn('[Graph] Auto-layout failed:', layoutError);
        }
      }

      // Fetch and add similarity edges between file nodes
      const fileNodeIds = nextNodes.filter((n) => n.type === 'fileNode').map((n) => n.id);

      if (fileNodeIds.length >= 2) {
        try {
          const simEdgesResp = await window.electronAPI?.embeddings?.getSimilarityEdges?.(
            fileNodeIds,
            { threshold: 0.5, maxEdgesPerNode: 2 }
          );

          if (simEdgesResp?.success && Array.isArray(simEdgesResp.edges)) {
            // Build a map of node data for tooltip info
            const nodeDataMap = new Map();
            nextNodes.forEach((n) => {
              if (n.type === 'fileNode') {
                nodeDataMap.set(n.id, {
                  label: n.data?.label || '',
                  tags: n.data?.tags || [],
                  category: n.data?.category || '',
                  subject: n.data?.subject || ''
                });
              }
            });

            const similarityEdges = simEdgesResp.edges.map((e) => ({
              id: e.id,
              source: e.source,
              target: e.target,
              type: 'similarity', // Use custom edge component
              animated: false,
              data: {
                kind: 'similarity',
                similarity: e.similarity,
                sourceData: nodeDataMap.get(e.source) || {},
                targetData: nodeDataMap.get(e.target) || {}
              }
            }));

            if (similarityEdges.length > 0) {
              setEdges((prev) => {
                const existingIds = new Set(prev.map((e) => e.id));
                const newEdges = similarityEdges.filter((e) => !existingIds.has(e.id));
                if (newEdges.length === 0) return prev;
                return [...prev, ...newEdges];
              });
              setGraphStatus((prev) => `${prev} • ${similarityEdges.length} connections`);
            }
          }
        } catch (simErr) {
          logger.debug('[Graph] Failed to fetch similarity edges:', simErr);
        }
      }
    } catch (e) {
      setGraphStatus('');
      setError(getErrorMessage(e, 'Graph search'));
    }
  }, [query, defaultTopK, addMode, upsertFileNode, autoLayout, nodes, edges]);

  const expandFromSelected = useCallback(
    async (overrideNode = null) => {
      // Use provided node or fall back to selectedNode (fixes stale closure in onNodeDoubleClick)
      const seed = overrideNode || selectedNode;
      if (!seed || seed.data?.kind !== 'file') return;
      const seedId = seed.id;

      setError('');
      setGraphStatus(`Expanding (${hopCount} hop${hopCount > 1 ? 's' : ''})...`);

      try {
        // Use multi-hop expansion when hopCount > 1, otherwise use findSimilar for single hop
        const resp =
          hopCount > 1
            ? await window.electronAPI?.embeddings?.findMultiHop?.([seedId], {
                hops: hopCount,
                decay: decayFactor
              })
            : await window.electronAPI?.embeddings?.findSimilar?.(seedId, 10);
        if (!resp || resp.success !== true) {
          throw new Error(resp?.error || 'Expand failed');
        }

        const results = Array.isArray(resp.results) ? resp.results : [];
        const seedPos = seed.position || { x: 200, y: 200 };

        const nextNodes = [];
        const nextEdges = [];

        // Get seed node data for tooltips
        const seedNodeData = {
          label: seed.data?.label || '',
          tags: seed.data?.tags || [],
          category: seed.data?.category || '',
          subject: seed.data?.subject || ''
        };

        results.forEach((r, idx) => {
          const pos = {
            x: seedPos.x + 280,
            y: seedPos.y + idx * 80
          };
          const node = upsertFileNode(r, pos);
          if (!node) return;
          nextNodes.push(node);

          // Get target node data for tooltip
          const targetNodeData = {
            label: node.data?.label || '',
            tags: node.data?.tags || [],
            category: node.data?.category || '',
            subject: node.data?.subject || ''
          };

          nextEdges.push({
            id: `e:${seedId}->${node.id}`,
            source: seedId,
            target: node.id,
            type: 'similarity', // Use custom edge component
            animated: false,
            data: {
              kind: 'similarity',
              similarity: r.score || 0,
              sourceData: seedNodeData,
              targetData: targetNodeData
            }
          });
        });

        setNodes((prev) => {
          // Check if any new nodes need to be added
          const existingIds = new Set(prev.map((n) => n.id));
          const hasNewNodes = nextNodes.some((n) => !existingIds.has(n.id));

          if (!hasNewNodes) {
            // No new nodes to add, preserve reference to prevent unnecessary updates
            return prev;
          }

          // Merge new nodes with existing ones
          const map = new Map(prev.map((n) => [n.id, n]));
          nextNodes.forEach((n) => {
            if (!map.has(n.id)) map.set(n.id, n);
          });
          return Array.from(map.values());
        });
        setEdges((prev) => {
          // Check if any new edges need to be added
          const existingEdgeIds = new Set(prev.map((e) => e.id));
          const hasNewEdges = nextEdges.some((e) => !existingEdgeIds.has(e.id));

          if (!hasNewEdges) {
            // No new edges to add, preserve reference to prevent unnecessary updates
            return prev;
          }

          // Merge new edges with existing ones
          const map = new Map(prev.map((e) => [e.id, e]));
          nextEdges.forEach((e) => map.set(e.id, e));
          return Array.from(map.values());
        });

        setGraphStatus(`Expanded: +${results.length}`);

        // Apply auto-layout if enabled (debounced)
        if (autoLayout && nextNodes.length > 0) {
          setGraphStatus('Applying layout...');
          try {
            // Get the final nodes and edges for layout
            const finalNodes = (() => {
              const map = new Map(nodes.map((n) => [n.id, n]));
              nextNodes.forEach((n) => {
                if (!map.has(n.id)) map.set(n.id, n);
              });
              return Array.from(map.values());
            })();

            const finalEdges = (() => {
              const map = new Map(edges.map((e) => [e.id, e]));
              nextEdges.forEach((e) => map.set(e.id, e));
              return Array.from(map.values());
            })();

            // Use debounced layout for expansion
            const layoutedNodes = await debouncedElkLayout(finalNodes, finalEdges, {
              direction: 'RIGHT',
              spacing: 80,
              layerSpacing: 120,
              debounceMs: 100 // Shorter debounce for explicit user action
            });
            setNodes(layoutedNodes);
            setGraphStatus(`Expanded: +${results.length} (laid out)`);
          } catch (layoutError) {
            logger.warn('[Graph] Auto-layout after expand failed:', layoutError);
          }
        }
      } catch (e) {
        setGraphStatus('');
        setError(getErrorMessage(e, 'Node expansion'));
      }
    },
    [selectedNode, upsertFileNode, autoLayout, nodes, edges, hopCount, decayFactor]
  );

  // Debounce within-graph query
  useEffect(() => {
    const handle = setTimeout(
      () => setDebouncedWithinQuery(withinQuery.trim()),
      TIMEOUTS.DEBOUNCE_INPUT
    );
    return () => clearTimeout(handle);
  }, [withinQuery]);

  // Score within current graph
  useEffect(() => {
    if (activeTab !== 'graph') return undefined;
    let cancelled = false;

    const run = async () => {
      if (!isOpen) return;
      const q = debouncedWithinQuery;
      if (!q || q.length < 2) {
        setNodes((prev) => {
          let changed = false;
          const updated = prev.map((n) => {
            if (n.data?.kind !== 'file') return n;

            // Check if we need to update (has withinScore or opacity !== 1)
            const hasWithinScore = n.data?.withinScore !== undefined;
            const currentOpacity = n.style?.opacity;

            if (!hasWithinScore && currentOpacity === 1) {
              return n; // Already cleared, no change needed
            }

            changed = true;
            const restData = { ...(n.data || {}) };
            delete restData.withinScore;
            return { ...n, data: restData, style: { ...(n.style || {}), opacity: 1 } };
          });

          // Only return new array if something actually changed
          return changed ? updated : prev;
        });
        return;
      }
      if (fileNodeIds.length === 0) return;

      const requestId = Date.now();
      withinReqRef.current = requestId;

      try {
        const resp = await window.electronAPI?.embeddings?.scoreFiles?.(q, fileNodeIds);
        if (cancelled) return;
        if (withinReqRef.current !== requestId) return;
        if (!resp || resp.success !== true) {
          throw new Error(resp?.error || 'Score failed');
        }

        const scores = Array.isArray(resp.scores) ? resp.scores : [];
        const scoreMap = new Map(scores.map((s) => [s.id, clamp01(s.score)]));

        setNodes((prev) => {
          let changed = false;
          const updated = prev.map((n) => {
            if (n.data?.kind !== 'file') return n;
            const s = scoreMap.get(n.id);
            const currentScore = n.data?.withinScore;
            const currentOpacity = n.style?.opacity;

            if (typeof s !== 'number') {
              // No score - check if we need to update
              if (currentScore === 0 && currentOpacity === 0.3) {
                return n; // Already set to default, no change needed
              }
              changed = true;
              return {
                ...n,
                data: { ...n.data, withinScore: 0 },
                style: { ...(n.style || {}), opacity: 0.3 }
              };
            }

            const opacity = scoreToOpacity(s);
            const borderColor = s > 0.75 ? 'rgba(37,99,235,0.9)' : undefined;
            const borderWidth = s > 0.75 ? 2 : undefined;

            // Check if score/opacity actually changed
            if (
              currentScore === s &&
              currentOpacity === opacity &&
              n.style?.borderColor === borderColor &&
              n.style?.borderWidth === borderWidth
            ) {
              return n; // No change, preserve reference
            }

            changed = true;
            return {
              ...n,
              data: { ...n.data, withinScore: s },
              style: {
                ...(n.style || {}),
                opacity,
                borderColor,
                borderWidth
              }
            };
          });

          // Only return new array if something actually changed
          return changed ? updated : prev;
        });

        // Jump to top matches - find nodes with good scores and zoom to them
        const topMatches = scores
          .filter((s) => s.score > 0.5)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5);

        if (topMatches.length > 0 && reactFlowInstance.current) {
          // Zoom to the top matching nodes
          reactFlowInstance.current.fitView({
            nodes: topMatches.map((m) => ({ id: m.id })),
            padding: 0.3,
            duration: 300,
            maxZoom: 1.5
          });

          // Auto-select the best match
          setSelectedNodeId(topMatches[0].id);
        }
      } catch (e) {
        setError(getErrorMessage(e, 'File scoring'));
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [debouncedWithinQuery, fileNodeIds, isOpen, activeTab]);

  const onNodeClick = useCallback((_, node) => {
    if (!node?.id) return;
    setSelectedNodeId(node.id);
  }, []);

  // Handle ReactFlow change events.
  // Keep selection as a single source of truth (selectedNodeId) to avoid ReactFlow StoreUpdater loops.
  const onNodesChange = useCallback((changes) => {
    // Sync selection without rewriting node objects
    for (const change of changes) {
      if (change.type === 'select') {
        if (change.selected) setSelectedNodeId(change.id);
        else setSelectedNodeId((prev) => (prev === change.id ? null : prev));
      }
    }

    // Persist node position changes from dragging
    // CRITICAL: Only update if position actually changed to prevent infinite loops
    const positionChanges = changes.filter((c) => c.type === 'position' && c.position);
    if (positionChanges.length === 0) return;

    setNodes((nds) => {
      let changed = false;
      const updated = nds.map((n) => {
        const pc = positionChanges.find((c) => c.id === n.id);
        if (!pc) return n;

        // Only update if position actually changed
        const currentPos = n.position || { x: 0, y: 0 };
        const newPos = pc.position;
        if (currentPos.x === newPos.x && currentPos.y === newPos.y) {
          return n; // No change, return same object
        }

        changed = true;
        return { ...n, position: newPos };
      });

      // Only return new array if something actually changed
      return changed ? updated : nds;
    });
  }, []);

  // Double-click on a node to expand it (file or cluster)
  const onNodeDoubleClick = useCallback(
    (_, node) => {
      if (!node?.id) return;

      const kind = node?.data?.kind;

      // Handle cluster node double-click
      if (kind === 'cluster') {
        const memberIds = node?.data?.memberIds;
        if (Array.isArray(memberIds) && memberIds.length > 0) {
          expandCluster(node.id, memberIds);
        }
        return;
      }

      // Handle file node double-click
      if (kind === 'file') {
        setSelectedNodeId(node.id);
        // Pass node directly to avoid stale closure (selectedNode won't update until re-render)
        expandFromSelected(node);
      }
    },
    [expandFromSelected, expandCluster]
  );

  // No-op handler for edge changes to prevent ReactFlow from syncing edges back
  // Edges are managed internally, we don't need to sync ReactFlow's edge state back
  const onEdgesChange = useCallback(() => {
    // No-op: edges are managed internally, don't sync back to avoid loops
    // ReactFlow will still handle edge rendering, we just don't sync state back
  }, []);

  // ============================================================================
  // Computed values
  // ============================================================================

  // Avoid recreating ReactFlow props on every render; unstable refs can trigger StoreUpdater loops.
  // CRITICAL: Only create new objects when selection or node data actually changes
  const rfNodes = useMemo(() => {
    return nodes.map((n) => {
      const isSelected = n.id === selectedNodeId;
      // Only create new object if selection state actually changed
      // Preserve node reference when possible to prevent unnecessary ReactFlow updates
      const currentSelected = n.selected === true || n.selected === false ? n.selected : false;
      if (currentSelected === isSelected) {
        // Selection hasn't changed, return node as-is to preserve reference stability
        // This prevents ReactFlow StoreUpdater from detecting false changes
        return n;
      }
      // Selection changed, create new object with updated selected state
      return {
        ...n,
        selected: isSelected
      };
    });
  }, [nodes, selectedNodeId]);

  const rfFitViewOptions = useMemo(() => ({ padding: 0.2 }), []);
  const rfDefaultViewport = useMemo(() => ({ x: 0, y: 0, zoom: 1 }), []);
  const rfProOptions = useMemo(() => ({ hideAttribution: true }), []);
  const miniMapNodeColor = useCallback(
    (n) => (n.data?.kind === 'query' ? '#6366f1' : '#3b82f6'),
    []
  );

  const showEmptyBanner = stats && typeof stats.files === 'number' && stats.files === 0 && !error;
  // Use fresh metadata from ChromaDB when available (for current file paths after moves)
  const selectedPath = freshMetadata?.path || selectedNode?.data?.path || '';
  const selectedLabel = freshMetadata?.name || selectedNode?.data?.label || selectedNode?.id || '';
  const selectedKind = selectedNode?.data?.kind || '';

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Search & Explore" size="full">
      <div className="flex flex-col gap-4 min-h-[70vh]">
        {/* Header: Tabs + Stats */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-system-gray-200">
          <div className="flex items-center gap-2">
            <TabButton
              active={activeTab === 'search'}
              onClick={() => setActiveTab('search')}
              icon={List}
              label="Search Results"
            />
            {SHOW_GRAPH && (
              <TabButton
                active={activeTab === 'graph'}
                onClick={() => setActiveTab('graph')}
                icon={Network}
                label="Explore Graph"
              />
            )}
          </div>
          <StatsDisplay stats={stats} isLoadingStats={isLoadingStats} onRefresh={refreshStats} />
        </div>

        {/* Empty embeddings banner */}
        {showEmptyBanner && (
          <EmptyEmbeddingsBanner
            onRebuildFolders={rebuildFolders}
            onRebuildFiles={rebuildFiles}
            isRebuildingFolders={isRebuildingFolders}
            isRebuildingFiles={isRebuildingFiles}
          />
        )}

        {/* Error banner */}
        {error && (
          <div className="glass-panel border border-stratosort-danger/30 bg-stratosort-danger/10 p-3 text-sm text-system-gray-800 rounded-xl">
            {error}
          </div>
        )}

        {/* Search Tab Content */}
        {activeTab === 'search' && (
          <div className="flex flex-col gap-4 flex-1">
            <SearchExplainer
              stats={stats}
              searchStatusLabel={searchStatusLabel}
              query={debouncedQuery}
              defaultTopK={defaultTopK}
              isSearching={isSearching}
            />
            {/* Search input with autocomplete */}
            <div className="flex items-center gap-3">
              <SearchAutocomplete
                value={query}
                onChange={setQuery}
                onSearch={(q) => {
                  setQuery(q);
                  // The debounced search will trigger automatically
                }}
                placeholder="Search your library (e.g., W2 2024, car registration renewal)"
                ariaLabel="Search query"
                className="flex-1"
                autoFocus
              />
              <div className="flex items-center gap-2 text-xs text-system-gray-500 shrink-0">
                <SearchIcon className="h-4 w-4" aria-hidden="true" />
                <span>{searchStatusLabel}</span>
              </div>
            </div>

            {/* Bulk action bar - shown when items are selected */}
            {bulkSelectedIds.size > 0 && (
              <div className="flex items-center gap-3 p-3 bg-stratosort-blue/10 border border-stratosort-blue/20 rounded-xl">
                <span className="text-sm font-medium text-stratosort-blue">
                  {bulkSelectedIds.size} selected
                </span>
                <div className="flex gap-2">
                  <Button variant="primary" size="sm" onClick={moveSelectedToFolder}>
                    <FolderInput className="h-4 w-4" /> Move to Folder
                  </Button>
                  <Button variant="secondary" size="sm" onClick={copySelectedPaths}>
                    <Copy className="h-4 w-4" /> Copy Paths
                  </Button>
                </div>
                <div className="ml-auto flex gap-2">
                  <Button variant="ghost" size="sm" onClick={selectAllResults}>
                    Select All ({searchResults.length})
                  </Button>
                  <Button variant="ghost" size="sm" onClick={clearBulkSelection}>
                    Clear
                  </Button>
                </div>
              </div>
            )}

            {/* Results grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1">
              <div className="flex flex-col gap-2 overflow-y-auto max-h-[50vh]">
                {searchResults.length === 0 && !error ? (
                  <div className="text-sm text-system-gray-500 py-6 text-center">
                    {debouncedQuery && debouncedQuery.length >= 2 ? (
                      <div className="flex flex-col items-center gap-2">
                        <SearchIcon className="w-8 h-8 text-system-gray-300" />
                        <span>No matches found for &ldquo;{debouncedQuery}&rdquo;</span>
                        <span className="text-xs text-system-gray-400">
                          Try different keywords or check if files are indexed.
                        </span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-3">
                        <HelpCircle className="w-8 h-8 text-system-gray-300" />
                        <div>
                          <div className="font-medium mb-1">Semantic Search</div>
                          <span>Find files by meaning, not just keywords.</span>
                        </div>
                        <div className="text-xs text-system-gray-400 max-w-xs space-y-1">
                          <div>
                            <strong>Examples:</strong>
                          </div>
                          <div className="italic">tax documents from 2024</div>
                          <div className="italic">photos of family vacation</div>
                          <div className="italic">project proposal for client</div>
                        </div>
                        {stats?.files === 0 && (
                          <div className="mt-2 text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">
                            No files indexed yet. Build embeddings first.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : null}

                {searchResults.map((r) => (
                  <ResultRow
                    key={r.id}
                    result={r}
                    isSelected={r.id === selectedSearchId}
                    isBulkSelected={bulkSelectedIds.has(r.id)}
                    onSelect={(res) => setSelectedSearchId(res.id)}
                    onToggleBulk={toggleBulkSelection}
                    onOpen={openFile}
                    onReveal={revealFile}
                    onCopyPath={copyPath}
                  />
                ))}
              </div>

              <div className="surface-panel p-4 min-h-[12rem]">
                <h3 className="text-sm font-semibold text-system-gray-900 mb-2">Preview</h3>
                {selectedSearchResult ? (
                  <div className="text-sm text-system-gray-700 flex flex-col gap-3">
                    <div className="flex flex-col gap-1">
                      <div className="font-medium break-all">
                        {selectedSearchResult?.metadata?.path || selectedSearchResult.id}
                      </div>
                      <div className="text-xs text-system-gray-500">
                        Combined score: {formatScore(selectedSearchResult.score)}
                      </div>
                      {(() => {
                        const hybrid = selectedSearchResult?.matchDetails?.hybrid || {};
                        const semanticScore = hybrid.semanticScore ?? hybrid.vectorScore;
                        const keywordScore = hybrid.keywordScore ?? hybrid.bm25Score;
                        const combinedScore = hybrid.combinedScore ?? selectedSearchResult.score;
                        const weights =
                          hybrid.semanticWeight || hybrid.keywordWeight
                            ? ` (w_sem=${hybrid.semanticWeight ?? '—'}, w_kw=${hybrid.keywordWeight ?? '—'})`
                            : '';
                        return (
                          <div className="text-xs text-system-gray-500 space-y-0.5">
                            <div>Semantic score: {formatScore(semanticScore)}</div>
                            <div>Keyword score: {formatScore(keywordScore)}</div>
                            <div>
                              Hybrid score: {formatScore(combinedScore)}
                              {weights}
                            </div>
                          </div>
                        );
                      })()}
                    </div>

                    <div className="surface-panel bg-system-gray-50 border border-system-gray-200 rounded-lg p-3 space-y-2">
                      <div className="text-xs font-semibold text-system-gray-600 uppercase">
                        Why this matched
                      </div>
                      <ul className="text-xs text-system-gray-600 space-y-1 list-disc list-inside">
                        {selectedSearchResult?.matchDetails?.matchedTerms?.length ? (
                          <li>
                            Keyword terms:{' '}
                            {selectedSearchResult.matchDetails.matchedTerms.join(', ')}
                          </li>
                        ) : null}
                        {selectedSearchResult?.matchDetails?.sources?.length ? (
                          <li>Sources: {selectedSearchResult.matchDetails.sources.join(', ')}</li>
                        ) : null}
                        {selectedSearchResult?.metadata?.category ? (
                          <li>Category: {selectedSearchResult.metadata.category}</li>
                        ) : null}
                        {Array.isArray(selectedSearchResult?.metadata?.tags) &&
                        selectedSearchResult.metadata.tags.length ? (
                          <li>
                            Tags: {selectedSearchResult.metadata.tags.slice(0, 5).join(', ')}
                            {selectedSearchResult.metadata.tags.length > 5 ? '…' : ''}
                          </li>
                        ) : null}
                        {Array.isArray(selectedSearchResult?.metadata?.keywords) &&
                        selectedSearchResult.metadata.keywords.length ? (
                          <li>
                            Semantic topics:{' '}
                            {selectedSearchResult.metadata.keywords.slice(0, 5).join(', ')}
                            {selectedSearchResult.metadata.keywords.length > 5 ? '…' : ''}
                          </li>
                        ) : null}
                        {selectedSearchResult?.metadata?.subject ? (
                          <li>Subject: {selectedSearchResult.metadata.subject}</li>
                        ) : null}
                        {(() => {
                          const hybrid = selectedSearchResult?.matchDetails?.hybrid || {};
                          if (hybrid.bm25RawScore || hybrid.vectorRawScore) {
                            return (
                              <li>
                                Raw scores — semantic: {formatScore(hybrid.vectorRawScore)};
                                keyword: {formatScore(hybrid.bm25RawScore)}
                              </li>
                            );
                          }
                          return null;
                        })()}
                        {!selectedSearchResult?.matchDetails?.matchedTerms &&
                        !(selectedSearchResult?.metadata?.tags || []).length ? (
                          <li>Semantic similarity matched the overall topic.</li>
                        ) : null}
                      </ul>
                    </div>

                    {selectedSearchResult?.document ? (
                      <div className="text-xs text-system-gray-600 whitespace-pre-wrap">
                        {String(selectedSearchResult.document).slice(0, 800)}
                      </div>
                    ) : (
                      <div className="text-xs text-system-gray-500">No preview text available.</div>
                    )}
                    <div className="pt-2 flex flex-wrap gap-2">
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => openFile(selectedSearchResult?.metadata?.path)}
                      >
                        <ExternalLink className="h-4 w-4" /> Open
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => revealFile(selectedSearchResult?.metadata?.path)}
                      >
                        <FolderOpen className="h-4 w-4" /> Reveal
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyPath(selectedSearchResult?.metadata?.path)}
                      >
                        <Copy className="h-4 w-4" /> Copy path
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-system-gray-500">
                    Select a result to see details.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Graph Tab Content */}
        {SHOW_GRAPH && activeTab === 'graph' && (
          <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr_320px] gap-3 flex-1 min-h-[60vh]">
            {/* Left: Controls */}
            <div className="surface-panel p-4 flex flex-col gap-4">
              <div>
                <div className="text-xs font-semibold text-system-gray-500 uppercase tracking-wider mb-2">
                  Add to Graph
                </div>
                <SearchAutocomplete
                  value={query}
                  onChange={setQuery}
                  onSearch={runGraphSearch}
                  placeholder="Search to add nodes..."
                  ariaLabel="Search to add nodes"
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <label className="text-xs text-system-gray-600 flex items-center gap-2 select-none cursor-pointer">
                    <input
                      type="checkbox"
                      checked={addMode}
                      onChange={(e) => setAddMode(e.target.checked)}
                      className="rounded"
                    />
                    Add to existing
                  </label>
                  <Button variant="primary" size="sm" onClick={runGraphSearch}>
                    <SearchIcon className="h-4 w-4" /> Search
                  </Button>
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-system-gray-500 uppercase tracking-wider mb-2">
                  Highlight in Graph
                </div>
                <Input
                  value={withinQuery}
                  onChange={(e) => setWithinQuery(e.target.value)}
                  placeholder="Re-rank current nodes..."
                  aria-label="Search within current graph"
                />
                <div className="mt-1 text-xs text-system-gray-400">
                  Adjusts opacity based on relevance to your query.
                </div>
              </div>

              {/* Layout Controls */}
              <div className="pt-2 border-t border-system-gray-200">
                <div className="text-xs font-semibold text-system-gray-500 uppercase tracking-wider mb-2">
                  Layout
                </div>
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs text-system-gray-600 flex items-center gap-2 select-none cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoLayout}
                      onChange={(e) => setAutoLayout(e.target.checked)}
                      className="rounded"
                    />
                    Auto-layout
                  </label>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={applyLayout}
                    disabled={nodes.length === 0 || isLayouting}
                    title="Re-apply automatic layout to all nodes"
                  >
                    <LayoutGrid className="h-4 w-4" />
                    {isLayouting ? 'Laying out...' : 'Layout'}
                  </Button>
                </div>
              </div>

              {/* Multi-hop Expansion Controls */}
              <div className="pt-2 border-t border-system-gray-200">
                <div className="text-xs font-semibold text-system-gray-500 uppercase tracking-wider mb-2">
                  Expansion
                </div>
                <div className="flex items-center gap-3 mb-2">
                  <label className="text-xs text-system-gray-600 flex items-center gap-2">
                    <span>Hops:</span>
                    <select
                      value={hopCount}
                      onChange={(e) => setHopCount(Number(e.target.value))}
                      className="text-xs border border-system-gray-200 rounded px-2 py-1"
                    >
                      <option value={1}>1</option>
                      <option value={2}>2</option>
                      <option value={3}>3</option>
                    </select>
                  </label>
                  <label className="text-xs text-system-gray-600 flex items-center gap-2">
                    <span>Decay:</span>
                    <select
                      value={decayFactor}
                      onChange={(e) => setDecayFactor(Number(e.target.value))}
                      className="text-xs border border-system-gray-200 rounded px-2 py-1"
                    >
                      <option value={0.5}>0.5</option>
                      <option value={0.6}>0.6</option>
                      <option value={0.7}>0.7</option>
                      <option value={0.8}>0.8</option>
                      <option value={0.9}>0.9</option>
                    </select>
                  </label>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={expandFromSelected}
                    disabled={!selectedNode || selectedKind !== 'file'}
                    title="Find similar files to the selected node"
                  >
                    <GitBranch className="h-4 w-4" /> Expand
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (nodes.length > 0) {
                        setShowClearConfirm(true);
                      }
                    }}
                    disabled={nodes.length === 0}
                    title={nodes.length === 0 ? 'Nothing to clear' : 'Clear all nodes from graph'}
                  >
                    Clear
                  </Button>
                </div>
              </div>

              {/* Clustering Controls */}
              <div className="pt-2 border-t border-system-gray-200">
                <div className="text-xs font-semibold text-system-gray-500 uppercase tracking-wider mb-2">
                  Clustering
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant={showClusters ? 'primary' : 'secondary'}
                    size="sm"
                    onClick={loadClusters}
                    disabled={isComputingClusters}
                    title="Compute and display semantic clusters of similar files"
                  >
                    <Layers className="h-4 w-4" />
                    {isComputingClusters
                      ? 'Computing...'
                      : showClusters
                        ? 'Refresh Clusters'
                        : 'Show Clusters'}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleFindDuplicates}
                    disabled={isFindingDuplicates}
                    title="Find near-duplicate files (90%+ similarity)"
                  >
                    <Copy className="h-4 w-4" />
                    {isFindingDuplicates ? 'Searching...' : 'Find Duplicates'}
                  </Button>
                </div>
                <div className="mt-1 text-xs text-system-gray-400">
                  Group similar files into clusters. Double-click to expand.
                </div>
              </div>

              {graphStatus && <div className="text-xs text-system-gray-600">{graphStatus}</div>}
            </div>

            {/* Center: Graph */}
            <div className="surface-panel p-0 overflow-hidden min-h-[50vh] rounded-xl border border-system-gray-200 relative">
              {nodes.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center p-8">
                  <Network className="w-12 h-12 text-system-gray-300 mb-3" />
                  <div className="text-sm font-medium text-system-gray-600 mb-1">
                    Start Exploring
                  </div>
                  <div className="text-xs text-system-gray-400 max-w-sm mb-4">
                    Discover relationships between your files using semantic similarity.
                  </div>

                  {/* Quick start options */}
                  <div className="flex flex-col gap-2 mb-4 w-full max-w-xs">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={loadClusters}
                      disabled={isComputingClusters || !stats?.files}
                      className="w-full justify-center"
                    >
                      <Layers className="h-4 w-4" />
                      {isComputingClusters ? 'Computing...' : 'Auto-discover clusters'}
                    </Button>
                    <div className="text-[10px] text-system-gray-400">
                      or search above to add specific files
                    </div>
                  </div>

                  {/* Empty state guidance */}
                  {stats?.files === 0 && (
                    <div className="mb-4 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-4 py-3 rounded-lg max-w-xs">
                      <div className="font-medium mb-1">No files indexed yet</div>
                      <div className="text-amber-600">
                        Go to Settings &rarr; Embeddings &rarr; Rebuild Files to index your analyzed
                        files for semantic search.
                      </div>
                    </div>
                  )}

                  {stats?.files > 0 && stats?.files < 10 && (
                    <div className="mb-4 text-xs text-blue-700 bg-blue-50 border border-blue-200 px-4 py-3 rounded-lg max-w-xs">
                      <div className="font-medium mb-1">Few files indexed ({stats.files})</div>
                      <div className="text-blue-600">
                        Analyze more files to see richer clusters and connections.
                      </div>
                    </div>
                  )}

                  <div className="text-xs text-system-gray-400 max-w-xs space-y-1 border-t border-system-gray-200 pt-3">
                    <div className="font-medium text-system-gray-500 mb-1">Tips:</div>
                    <div>
                      <strong>Click</strong> a node to select it
                    </div>
                    <div>
                      <strong>Double-click</strong> to find similar files
                    </div>
                    <div>
                      <strong>Drag</strong> nodes to rearrange
                    </div>
                    <div className="pt-1">
                      <strong>Ctrl+F</strong> to focus search
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <ReactFlow
                    nodes={rfNodes}
                    edges={edges}
                    nodeTypes={nodeTypes}
                    edgeTypes={edgeTypes}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onNodeClick={onNodeClick}
                    onNodeDoubleClick={onNodeDoubleClick}
                    onInit={(instance) => {
                      reactFlowInstance.current = instance;
                    }}
                    fitView
                    fitViewOptions={rfFitViewOptions}
                    minZoom={0.2}
                    maxZoom={2}
                    defaultViewport={rfDefaultViewport}
                    proOptions={rfProOptions}
                  >
                    <Background color="#e5e7eb" gap={16} />
                    <MiniMap pannable zoomable nodeColor={miniMapNodeColor} />
                    <Controls showInteractive={false} />
                  </ReactFlow>

                  {/* Legend overlay - show when clusters are visible */}
                  {showClusters && (
                    <ClusterLegend className="absolute top-3 left-3 z-10 shadow-md" />
                  )}

                  {/* Compact legend for non-cluster view */}
                  {!showClusters && nodes.length > 0 && (
                    <div className="absolute top-3 left-3 z-10 bg-white/90 backdrop-blur-sm border border-system-gray-200 rounded-lg px-3 py-2">
                      <ClusterLegend compact />
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Right: Details */}
            <div className="surface-panel p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-stratosort-blue" aria-hidden="true" />
                <div className="text-sm font-semibold text-system-gray-900">Node Details</div>
              </div>

              {selectedNode ? (
                <>
                  <div className="text-sm font-medium text-system-gray-900 break-all">
                    {selectedLabel}
                  </div>
                  {selectedPath && (
                    <div className="text-xs text-system-gray-500 break-all flex items-center gap-1">
                      {isLoadingMetadata && (
                        <span className="inline-block w-3 h-3 border border-system-gray-300 border-t-stratosort-blue rounded-full animate-spin flex-shrink-0" />
                      )}
                      <span>{selectedPath}</span>
                    </div>
                  )}

                  <div className="pt-2 flex flex-wrap gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => openFile(selectedPath)}
                      disabled={!selectedPath}
                    >
                      <ExternalLink className="h-4 w-4" /> Open
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => revealFile(selectedPath)}
                      disabled={!selectedPath}
                    >
                      <FolderOpen className="h-4 w-4" /> Reveal
                    </Button>
                  </div>

                  {selectedKind === 'file' && (
                    <div className="text-xs text-system-gray-400 mt-2">
                      ID: <span className="break-all font-mono">{selectedNode.id}</span>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-sm text-system-gray-500">Click a node to see details.</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Clear confirmation modal */}
      <ConfirmModal
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={() => {
          setNodes([]);
          setEdges([]);
          setSelectedNodeId(null);
          setError('');
          setGraphStatus('');
          setShowClusters(false);
        }}
        title="Clear Graph?"
        message="This will remove all nodes and connections from your exploration. This cannot be undone."
        confirmText="Clear Graph"
        cancelText="Cancel"
        variant="warning"
      />
    </Modal>
  );
}

UnifiedSearchModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  defaultTopK: PropTypes.number,
  initialTab: PropTypes.oneOf(['search', 'graph'])
};
