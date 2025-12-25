import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import ReactFlow, { Background, Controls, MiniMap } from 'reactflow';
import 'reactflow/dist/style.css';
import {
  ExternalLink,
  FolderOpen,
  Plus,
  RefreshCw,
  Search as SearchIcon,
  Sparkles
} from 'lucide-react';

import Modal from '../Modal';
import { Button, Input } from '../ui';
import { TIMEOUTS } from '../../../shared/performanceConstants';
import { logger } from '../../../shared/logger';

logger.setContext('ExploreGraphModal');

function safeBasename(p) {
  if (typeof p !== 'string') return '';
  const normalized = p.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

function makeQueryNodeId(query, salt) {
  const short = String(query || '')
    .trim()
    .slice(0, 64)
    .replace(/\s+/g, '_');
  return `query:${short}:${salt}`;
}

function clamp01(v) {
  if (typeof v !== 'number' || Number.isNaN(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function scoreToOpacity(score) {
  const s = clamp01(score);
  return 0.25 + s * 0.75;
}

function defaultNodePosition(index) {
  const spacingX = 260;
  const spacingY = 90;
  const col = index % 3;
  const row = Math.floor(index / 3);
  return { x: 80 + col * spacingX, y: 80 + row * spacingY };
}

export default function ExploreGraphModal({ isOpen, onClose, defaultTopK = 20 }) {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [selectedNodeId, setSelectedNodeId] = useState(null);

  const [globalQuery, setGlobalQuery] = useState('');
  const [addMode, setAddMode] = useState(true); // Add vs Replace

  const [withinQuery, setWithinQuery] = useState('');
  const [debouncedWithinQuery, setDebouncedWithinQuery] = useState('');

  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [stats, setStats] = useState(null);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [isRebuildingFolders, setIsRebuildingFolders] = useState(false);
  const [isRebuildingFiles, setIsRebuildingFiles] = useState(false);

  const withinReqRef = useRef(0);

  // Reset on open for predictable UX
  useEffect(() => {
    if (!isOpen) return;
    setNodes([]);
    setEdges([]);
    setSelectedNodeId(null);
    setGlobalQuery('');
    setAddMode(true);
    setWithinQuery('');
    setDebouncedWithinQuery('');
    setStatus('');
    setError('');
    setStats(null);
    setIsLoadingStats(false);
    setIsRebuildingFolders(false);
    setIsRebuildingFiles(false);
  }, [isOpen]);

  const refreshStats = useCallback(async () => {
    if (!window?.electronAPI?.embeddings?.getStats) return;
    setIsLoadingStats(true);
    try {
      const res = await window.electronAPI.embeddings.getStats();
      if (res && res.success) {
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

  const fileNodeIds = useMemo(
    () => nodes.filter((n) => n?.data?.kind === 'file').map((n) => n.id),
    [nodes]
  );

  const selectedNode = useMemo(
    () => (selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) : null),
    [nodes, selectedNodeId]
  );

  const openFile = useCallback(async (filePath) => {
    if (!filePath) return;
    try {
      await window.electronAPI?.files?.open?.(filePath);
    } catch (e) {
      logger.error('[Explore] Failed to open file', e);
    }
  }, []);

  const revealFile = useCallback(async (filePath) => {
    if (!filePath) return;
    try {
      await window.electronAPI?.files?.reveal?.(filePath);
    } catch (e) {
      logger.error('[Explore] Failed to reveal file', e);
    }
  }, []);

  const upsertFileNode = useCallback((result, preferredPosition) => {
    const id = result?.id;
    if (!id) return null;
    const path = result?.metadata?.path || '';
    const name = result?.metadata?.name || safeBasename(path) || id;
    const score = typeof result?.score === 'number' ? result.score : undefined;

    return {
      id,
      type: 'default',
      position: preferredPosition || { x: 0, y: 0 },
      data: {
        kind: 'file',
        label: name,
        path,
        score
      }
    };
  }, []);

  const runGlobalSearch = useCallback(async () => {
    const q = globalQuery.trim();
    if (q.length < 2) return;

    setError('');
    setStatus('Searching…');

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
        type: 'default',
        position: { x: 40, y: 40 },
        data: { kind: 'query', label: `Query: ${q}` }
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
          data: { kind: 'query_match', weight: r.score }
        });
      });

      setNodes((prev) => {
        if (!addMode) return nextNodes;
        const map = new Map(prev.map((n) => [n.id, n]));
        nextNodes.forEach((n) => {
          if (!map.has(n.id)) map.set(n.id, n);
        });
        return Array.from(map.values());
      });

      setEdges((prev) => {
        if (!addMode) return nextEdges;
        const map = new Map(prev.map((e) => [e.id, e]));
        nextEdges.forEach((e) => map.set(e.id, e));
        return Array.from(map.values());
      });

      setSelectedNodeId(results[0]?.id || queryNodeId);
      setStatus(`${results.length} result${results.length === 1 ? '' : 's'}`);
    } catch (e) {
      setStatus('');
      setError(e?.message || 'Search failed');
    }
  }, [globalQuery, defaultTopK, addMode, upsertFileNode]);

  const expandFromSelected = useCallback(async () => {
    const seed = selectedNode;
    if (!seed || seed.data?.kind !== 'file') return;
    const seedId = seed.id;

    setError('');
    setStatus('Expanding…');

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
          data: { kind: 'similarity', weight: r.score }
        });
      });

      setNodes((prev) => {
        const map = new Map(prev.map((n) => [n.id, n]));
        nextNodes.forEach((n) => {
          if (!map.has(n.id)) map.set(n.id, n);
        });
        return Array.from(map.values());
      });
      setEdges((prev) => {
        const map = new Map(prev.map((e) => [e.id, e]));
        nextEdges.forEach((e) => map.set(e.id, e));
        return Array.from(map.values());
      });

      setStatus(`Expanded: +${results.length}`);
    } catch (e) {
      setStatus('');
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

  // Score within current graph and update node highlight
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!isOpen) return;
      const q = debouncedWithinQuery;
      if (!q || q.length < 2) {
        // Clear highlight
        setNodes((prev) =>
          prev.map((n) => {
            if (n.data?.kind !== 'file') return n;
            const restData = { ...(n.data || {}) };
            delete restData.withinScore;
            return { ...n, data: restData, style: { ...(n.style || {}), opacity: 1 } };
          })
        );
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

        setNodes((prev) =>
          prev.map((n) => {
            if (n.data?.kind !== 'file') return n;
            const s = scoreMap.get(n.id);
            if (typeof s !== 'number')
              return {
                ...n,
                data: { ...n.data, withinScore: 0 },
                style: { ...(n.style || {}), opacity: 0.3 }
              };
            const opacity = scoreToOpacity(s);
            return {
              ...n,
              data: { ...n.data, withinScore: s },
              style: {
                ...(n.style || {}),
                opacity,
                borderColor: s > 0.75 ? 'rgba(37,99,235,0.9)' : undefined,
                borderWidth: s > 0.75 ? 2 : undefined
              }
            };
          })
        );
      } catch (e) {
        // Non-fatal: keep graph usable, show error banner
        setError(e?.message || 'Score failed');
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [debouncedWithinQuery, fileNodeIds, isOpen]);

  const onNodeClick = useCallback((_, node) => {
    if (!node?.id) return;
    setSelectedNodeId(node.id);
  }, []);

  const selectedPath = selectedNode?.data?.path || '';
  const selectedLabel = selectedNode?.data?.label || selectedNode?.id || '';
  const selectedKind = selectedNode?.data?.kind || '';

  const showEmptyEmbeddingsBanner =
    stats && typeof stats.files === 'number' && stats.files === 0 && !error;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Explore" size="full">
      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr_360px] gap-3 min-h-[70vh]">
        {/* Left: controls */}
        <div className="surface-panel p-4 flex flex-col gap-4">
          <div>
            <div className="text-xs font-semibold text-system-gray-500 uppercase tracking-wider mb-2">
              Global search
            </div>
            <Input
              value={globalQuery}
              onChange={(e) => setGlobalQuery(e.target.value)}
              placeholder="Search to add nodes…"
              aria-label="Global search"
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <label className="text-xs text-system-gray-600 flex items-center gap-2 select-none">
                <input
                  type="checkbox"
                  checked={addMode}
                  onChange={(e) => setAddMode(e.target.checked)}
                />
                Add results to graph (unchecked = Replace)
              </label>
              <Button variant="secondary" size="sm" onClick={runGlobalSearch}>
                <SearchIcon className="h-4 w-4" /> Search
              </Button>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <div className="text-xs text-system-gray-500">
                {stats
                  ? `${stats.folders} folder • ${stats.files} file embeddings`
                  : 'Embeddings status unavailable'}
              </div>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs text-system-gray-500 hover:text-system-gray-800"
                onClick={refreshStats}
                disabled={isLoadingStats}
                title="Refresh embeddings status"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isLoadingStats ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>

          {showEmptyEmbeddingsBanner ? (
            <div className="glass-panel border border-stratosort-warning/30 bg-stratosort-warning/10 p-3 text-sm text-system-gray-800">
              <div className="font-medium">No file embeddings yet</div>
              <div className="text-xs text-system-gray-600 mt-1">
                Rebuild embeddings to enable semantic search and graph exploration.
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={rebuildFolders}
                  disabled={isRebuildingFolders}
                >
                  {isRebuildingFolders ? 'Rebuilding…' : 'Rebuild Folder Embeddings'}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={rebuildFiles}
                  disabled={isRebuildingFiles}
                >
                  {isRebuildingFiles ? 'Rebuilding…' : 'Rebuild File Embeddings'}
                </Button>
              </div>
            </div>
          ) : null}

          <div>
            <div className="text-xs font-semibold text-system-gray-500 uppercase tracking-wider mb-2">
              Search within graph
            </div>
            <Input
              value={withinQuery}
              onChange={(e) => setWithinQuery(e.target.value)}
              placeholder="Re-rank/highlight current nodes…"
              aria-label="Search within current graph"
            />
            <div className="mt-2 text-xs text-system-gray-500">
              Highlights are computed locally from stored vectors for current nodes.
            </div>
          </div>

          <div className="flex items-center justify-between">
            <Button
              variant="secondary"
              size="sm"
              onClick={expandFromSelected}
              disabled={!selectedNode || selectedKind !== 'file'}
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
                setStatus('');
              }}
            >
              Clear
            </Button>
          </div>

          {status ? <div className="text-xs text-system-gray-600">{status}</div> : null}

          {error ? (
            <div className="glass-panel border border-stratosort-danger/30 bg-stratosort-danger/10 p-3 text-sm text-system-gray-800">
              {error}
            </div>
          ) : null}
        </div>

        {/* Center: graph */}
        <div className="surface-panel p-0 overflow-hidden min-h-[60vh]">
          <ReactFlow
            nodes={nodes.map((n) => ({
              ...n,
              data: {
                ...n.data,
                label:
                  n.data?.kind === 'file' && typeof n.data?.withinScore === 'number'
                    ? `${n.data.label} (${Math.round(n.data.withinScore * 100)}%)`
                    : n.data?.label
              }
            }))}
            edges={edges}
            fitView
            onNodeClick={onNodeClick}
          >
            <Background />
            <MiniMap pannable zoomable />
            <Controls />
          </ReactFlow>
        </div>

        {/* Right: details */}
        <div className="surface-panel p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-stratosort-blue" aria-hidden="true" />
            <div className="text-sm font-semibold text-system-gray-900">Details</div>
          </div>

          {selectedNode ? (
            <>
              <div className="text-sm font-medium text-system-gray-900 break-all">
                {selectedLabel}
              </div>
              {selectedPath ? (
                <div className="text-xs text-system-gray-500 break-all">{selectedPath}</div>
              ) : null}

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

              {selectedNode.data?.kind === 'file' ? (
                <div className="text-xs text-system-gray-500">
                  ID: <span className="break-all">{selectedNode.id}</span>
                </div>
              ) : null}
            </>
          ) : (
            <div className="text-sm text-system-gray-500">Click a node to see details.</div>
          )}
        </div>
      </div>
    </Modal>
  );
}

ExploreGraphModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  defaultTopK: PropTypes.number
};
