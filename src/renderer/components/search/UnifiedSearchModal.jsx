import React, { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import PropTypes from 'prop-types';
import ReactFlow, { Background, Controls, MiniMap, Handle, Position } from 'reactflow';
import 'reactflow/dist/style.css';
import {
  ExternalLink,
  FolderOpen,
  Plus,
  RefreshCw,
  Search as SearchIcon,
  Sparkles,
  Copy,
  Network,
  List,
  HelpCircle,
  FileText,
  MessageSquare
} from 'lucide-react';

import Modal from '../Modal';
import { Button, Input } from '../ui';
import { TIMEOUTS } from '../../../shared/performanceConstants';
import { logger } from '../../../shared/logger';
import { safeBasename } from '../../utils/pathUtils';
import { formatScore, scoreToOpacity, clamp01 } from '../../utils/scoreUtils';
import { makeQueryNodeId, defaultNodePosition } from '../../utils/graphUtils';

logger.setContext('UnifiedSearchModal');

// ============================================================================
// Custom Node Components
// ============================================================================

const FileNode = memo(({ data, selected }) => {
  const score = data?.withinScore ?? data?.score;
  const hasScore = typeof score === 'number';

  return (
    <div
      className={`
        px-3 py-2 rounded-lg border-2 shadow-sm min-w-[140px] max-w-[200px]
        transition-all duration-200 cursor-pointer
        ${
          selected
            ? 'border-stratosort-blue bg-stratosort-blue/10 shadow-md ring-2 ring-stratosort-blue/30'
            : 'border-system-gray-200 bg-white hover:border-stratosort-blue/50 hover:shadow-md'
        }
      `}
      style={{ opacity: data?.style?.opacity ?? 1 }}
    >
      <Handle type="target" position={Position.Left} className="!bg-stratosort-blue !w-2 !h-2" />
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
  queryNode: QueryNode
};

// ============================================================================
// Sub-Components
// ============================================================================

function ResultRow({ result, isSelected, onSelect, onOpen, onReveal, onCopyPath }) {
  const path = result?.metadata?.path || '';
  const name = result?.metadata?.name || safeBasename(path) || result?.id || 'Unknown';
  const type = result?.metadata?.type || '';

  return (
    <button
      type="button"
      onClick={() => onSelect(result)}
      className={`
        w-full text-left rounded-xl border p-3 transition-colors
        ${isSelected ? 'border-stratosort-blue bg-stratosort-blue/5' : 'border-border-soft bg-white/70 hover:bg-white'}
      `}
    >
      <div className="flex items-start justify-between gap-3">
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
        </div>
        <div className="shrink-0 text-xs font-medium text-system-gray-600">
          {formatScore(result?.score)}
        </div>
      </div>

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
    </button>
  );
}

ResultRow.propTypes = {
  result: PropTypes.object.isRequired,
  isSelected: PropTypes.bool.isRequired,
  onSelect: PropTypes.func.isRequired,
  onOpen: PropTypes.func.isRequired,
  onReveal: PropTypes.func.isRequired,
  onCopyPath: PropTypes.func.isRequired
};

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
  const [activeTab, setActiveTab] = useState(initialTab);

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

  // Graph tab state
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [addMode, setAddMode] = useState(true);
  const [withinQuery, setWithinQuery] = useState('');
  const [debouncedWithinQuery, setDebouncedWithinQuery] = useState('');
  const [graphStatus, setGraphStatus] = useState('');

  // Refs
  const lastSearchRef = useRef(0);
  const withinReqRef = useRef(0);

  // ============================================================================
  // Reset on open
  // ============================================================================

  useEffect(() => {
    if (!isOpen) return;
    setActiveTab(initialTab);
    setQuery('');
    setDebouncedQuery('');
    setError('');
    // Search state
    setSearchResults([]);
    setSelectedSearchId(null);
    setIsSearching(false);
    // Graph state
    setNodes([]);
    setEdges([]);
    setSelectedNodeId(null);
    setAddMode(true);
    setWithinQuery('');
    setDebouncedWithinQuery('');
    setGraphStatus('');
  }, [isOpen, initialTab]);

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
    } catch {
      setStats(null);
    } finally {
      setIsLoadingStats(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    refreshStats();
  }, [isOpen, refreshStats]);

  const rebuildFolders = useCallback(async () => {
    if (!window?.electronAPI?.embeddings?.rebuildFolders) return;
    setIsRebuildingFolders(true);
    setError('');
    try {
      const res = await window.electronAPI.embeddings.rebuildFolders();
      if (!res?.success) throw new Error(res?.error || 'Folder rebuild failed');
      await refreshStats();
    } catch (e) {
      setError(e?.message || 'Folder rebuild failed');
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
      setError(e?.message || 'File rebuild failed');
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
        const response = await window.electronAPI?.embeddings?.search?.(q, defaultTopK);
        if (cancelled) return;
        if (lastSearchRef.current !== requestId) return;

        if (!response || response.success !== true) {
          setSearchResults([]);
          setSelectedSearchId(null);
          setError(response?.error || 'Search failed');
          return;
        }

        const next = Array.isArray(response.results) ? response.results : [];
        setSearchResults(next);
        setSelectedSearchId(next[0]?.id || null);
      } catch (e) {
        if (cancelled) return;
        if (lastSearchRef.current !== requestId) return;
        setSearchResults([]);
        setSelectedSearchId(null);
        setError(e?.message || 'Search failed');
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
  }, [debouncedQuery, isOpen, defaultTopK, activeTab]);

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

  const upsertFileNode = useCallback((result, preferredPosition) => {
    const id = result?.id;
    if (!id) return null;
    const path = result?.metadata?.path || '';
    const name = result?.metadata?.name || safeBasename(path) || id;
    const score = typeof result?.score === 'number' ? result.score : undefined;

    return {
      id,
      type: 'fileNode', // Custom node type for card-like styling
      position: preferredPosition || { x: 0, y: 0 },
      data: {
        kind: 'file',
        label: name,
        path,
        score
      },
      draggable: true
    };
  }, []);

  const runGraphSearch = useCallback(async () => {
    const q = query.trim();
    if (q.length < 2) return;

    setError('');
    setGraphStatus('Searching...');

    try {
      const resp = await window.electronAPI?.embeddings?.search?.(q, defaultTopK);
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
          type: 'default',
          animated: true, // Animated edge for visual interest
          style: { stroke: '#6366f1', strokeWidth: 2 },
          data: { kind: 'query_match', weight: r.score }
        });
      });

      setNodes((prev) => {
        if (!addMode) return nextNodes;

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
        if (!addMode) return nextEdges;

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

      setSelectedNodeId(results[0]?.id || queryNodeId);
      setGraphStatus(`${results.length} result${results.length === 1 ? '' : 's'}`);
    } catch (e) {
      setGraphStatus('');
      setError(e?.message || 'Search failed');
    }
  }, [query, defaultTopK, addMode, upsertFileNode]);

  const expandFromSelected = useCallback(async () => {
    const seed = selectedNode;
    if (!seed || seed.data?.kind !== 'file') return;
    const seedId = seed.id;

    setError('');
    setGraphStatus('Expanding...');

    try {
      const resp = await window.electronAPI?.embeddings?.findSimilar?.(seedId, 10);
      if (!resp || resp.success !== true) {
        throw new Error(resp?.error || 'Expand failed');
      }

      const results = Array.isArray(resp.results) ? resp.results : [];
      const seedPos = seed.position || { x: 200, y: 200 };

      const nextNodes = [];
      const nextEdges = [];

      results.forEach((r, idx) => {
        const pos = {
          x: seedPos.x + 280,
          y: seedPos.y + idx * 80
        };
        const node = upsertFileNode(r, pos);
        if (!node) return;
        nextNodes.push(node);
        nextEdges.push({
          id: `e:${seedId}->${node.id}`,
          source: seedId,
          target: node.id,
          type: 'default',
          animated: false,
          style: { stroke: '#3b82f6', strokeWidth: 1.5 },
          data: { kind: 'similarity', weight: r.score }
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
    } catch (e) {
      setGraphStatus('');
      setError(e?.message || 'Expand failed');
    }
  }, [selectedNode, upsertFileNode]);

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
      } catch (e) {
        setError(e?.message || 'Score failed');
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

  // Double-click on a file node to expand it
  const onNodeDoubleClick = useCallback(
    (_, node) => {
      if (!node?.id || node?.data?.kind !== 'file') return;
      setSelectedNodeId(node.id);
      // Trigger expansion
      expandFromSelected();
    },
    [expandFromSelected]
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
  const selectedPath = selectedNode?.data?.path || '';
  const selectedLabel = selectedNode?.data?.label || selectedNode?.id || '';
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
            <TabButton
              active={activeTab === 'graph'}
              onClick={() => setActiveTab('graph')}
              icon={Network}
              label="Explore Graph"
            />
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
            {/* Search input */}
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search your library (e.g., W2 2024, car registration renewal)"
                  aria-label="Search query"
                />
              </div>
              <div className="flex items-center gap-2 text-xs text-system-gray-500 shrink-0">
                <SearchIcon className="h-4 w-4" aria-hidden="true" />
                <span>{searchStatusLabel}</span>
              </div>
            </div>

            {/* Results grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1">
              <div className="flex flex-col gap-2 overflow-y-auto max-h-[50vh]">
                {searchResults.length === 0 && !error ? (
                  <div className="text-sm text-system-gray-500 py-6 text-center">
                    {debouncedQuery && debouncedQuery.length >= 2 ? (
                      'No matches found.'
                    ) : (
                      <div className="flex flex-col items-center gap-2">
                        <HelpCircle className="w-8 h-8 text-system-gray-300" />
                        <span>Enter a query to search across your indexed files.</span>
                        <span className="text-xs text-system-gray-400">
                          Tip: Describe what you are looking for in natural language.
                        </span>
                      </div>
                    )}
                  </div>
                ) : null}

                {searchResults.map((r) => (
                  <ResultRow
                    key={r.id}
                    result={r}
                    isSelected={r.id === selectedSearchId}
                    onSelect={(res) => setSelectedSearchId(res.id)}
                    onOpen={openFile}
                    onReveal={revealFile}
                    onCopyPath={copyPath}
                  />
                ))}
              </div>

              <div className="surface-panel p-4 min-h-[12rem]">
                <h3 className="text-sm font-semibold text-system-gray-900 mb-2">Preview</h3>
                {selectedSearchResult ? (
                  <div className="text-sm text-system-gray-700 flex flex-col gap-2">
                    <div className="text-xs text-system-gray-500">
                      Score: {formatScore(selectedSearchResult.score)}
                    </div>
                    <div className="font-medium break-all">
                      {selectedSearchResult?.metadata?.path || selectedSearchResult.id}
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
        {activeTab === 'graph' && (
          <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr_320px] gap-3 flex-1 min-h-[60vh]">
            {/* Left: Controls */}
            <div className="surface-panel p-4 flex flex-col gap-4">
              <div>
                <div className="text-xs font-semibold text-system-gray-500 uppercase tracking-wider mb-2">
                  Add to Graph
                </div>
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search to add nodes..."
                  aria-label="Search to add nodes"
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

              <div className="flex items-center justify-between pt-2 border-t border-system-gray-200">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={expandFromSelected}
                  disabled={!selectedNode || selectedKind !== 'file'}
                  title="Find similar files to the selected node"
                >
                  <Plus className="h-4 w-4" /> Expand
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setNodes([]);
                    setEdges([]);
                    setSelectedNodeId(null);
                    setError('');
                    setGraphStatus('');
                  }}
                >
                  Clear
                </Button>
              </div>

              {graphStatus && <div className="text-xs text-system-gray-600">{graphStatus}</div>}
            </div>

            {/* Center: Graph */}
            <div className="surface-panel p-0 overflow-hidden min-h-[50vh] rounded-xl border border-system-gray-200">
              {nodes.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center p-8">
                  <Network className="w-12 h-12 text-system-gray-300 mb-3" />
                  <div className="text-sm font-medium text-system-gray-600 mb-1">
                    Graph is empty
                  </div>
                  <div className="text-xs text-system-gray-400 max-w-xs mb-3">
                    Search for files to add them as nodes.
                  </div>
                  <div className="text-xs text-system-gray-400 max-w-xs space-y-1">
                    <div>
                      <strong>Click</strong> a node to select it
                    </div>
                    <div>
                      <strong>Double-click</strong> to find similar files
                    </div>
                    <div>
                      <strong>Drag</strong> nodes to rearrange
                    </div>
                  </div>
                </div>
              ) : (
                <ReactFlow
                  nodes={rfNodes}
                  edges={edges}
                  nodeTypes={nodeTypes}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onNodeClick={onNodeClick}
                  onNodeDoubleClick={onNodeDoubleClick}
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
                    <div className="text-xs text-system-gray-500 break-all">{selectedPath}</div>
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
    </Modal>
  );
}

UnifiedSearchModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  defaultTopK: PropTypes.number,
  initialTab: PropTypes.oneOf(['search', 'graph'])
};
