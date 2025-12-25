import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { Search as SearchIcon, ExternalLink, Copy, FolderOpen, RefreshCw } from 'lucide-react';
import Modal from '../Modal';
import { Button, Input } from '../ui';
import { TIMEOUTS } from '../../../shared/performanceConstants';
import { logger } from '../../../shared/logger';

logger.setContext('SemanticSearchModal');

function formatScore(score) {
  if (typeof score !== 'number' || Number.isNaN(score)) return '';
  return `${Math.round(score * 100)}%`;
}

function safeBasename(p) {
  if (typeof p !== 'string') return '';
  const normalized = p.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

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

export default function SemanticSearchModal({ isOpen, onClose, defaultTopK = 20 }) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [stats, setStats] = useState(null);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [isRebuildingFolders, setIsRebuildingFolders] = useState(false);
  const [isRebuildingFiles, setIsRebuildingFiles] = useState(false);

  const lastRequestRef = useRef(0);

  // Debounce input
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(query.trim()), TIMEOUTS.DEBOUNCE_INPUT);
    return () => clearTimeout(handle);
  }, [query]);

  // Reset on open/close for predictable UX
  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setDebouncedQuery('');
    setResults([]);
    setSelectedId(null);
    setIsLoading(false);
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
    } catch (e) {
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

  const selectedResult = useMemo(
    () => (selectedId ? results.find((r) => r?.id === selectedId) : null),
    [results, selectedId]
  );

  const onSelect = useCallback((result) => {
    if (!result?.id) return;
    setSelectedId(result.id);
  }, []);

  const onOpen = useCallback(async (filePath) => {
    if (!filePath) return;
    try {
      await window.electronAPI?.files?.open?.(filePath);
    } catch (e) {
      logger.error('[Search] Failed to open file', e);
    }
  }, []);

  const onReveal = useCallback(async (filePath) => {
    if (!filePath) return;
    try {
      await window.electronAPI?.files?.reveal?.(filePath);
    } catch (e) {
      logger.error('[Search] Failed to reveal file', e);
    }
  }, []);

  const onCopyPath = useCallback(async (filePath) => {
    if (!filePath) return;
    try {
      await navigator.clipboard.writeText(filePath);
    } catch (e) {
      logger.warn('[Search] Clipboard write failed', e?.message || e);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!isOpen) return;

      const q = debouncedQuery;
      if (!q || q.length < 2) {
        setResults([]);
        setSelectedId(null);
        setError('');
        return;
      }

      const requestId = Date.now();
      lastRequestRef.current = requestId;
      setIsLoading(true);
      setError('');

      try {
        const response = await window.electronAPI?.embeddings?.search?.(q, defaultTopK);
        if (cancelled) return;
        if (lastRequestRef.current !== requestId) return;

        if (!response || response.success !== true) {
          const msg = response?.error || 'Search failed';
          setResults([]);
          setSelectedId(null);
          setError(msg);
          return;
        }

        const next = Array.isArray(response.results) ? response.results : [];
        setResults(next);
        setSelectedId(next[0]?.id || null);
      } catch (e) {
        if (cancelled) return;
        if (lastRequestRef.current !== requestId) return;
        setResults([]);
        setSelectedId(null);
        setError(e?.message || 'Search failed');
      } finally {
        if (!cancelled && lastRequestRef.current === requestId) {
          setIsLoading(false);
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, isOpen, defaultTopK]);

  const resultCountLabel = useMemo(() => {
    if (isLoading) return 'Searching…';
    if (error) return 'Search error';
    if (!debouncedQuery || debouncedQuery.length < 2) return 'Type to search';
    return `${results.length} result${results.length === 1 ? '' : 's'}`;
  }, [isLoading, error, debouncedQuery, results.length]);

  const showEmptyEmbeddingsBanner =
    stats && typeof stats.files === 'number' && stats.files === 0 && !error;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Semantic Search" size="large">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your library (e.g., “W2 2024”, “car registration renewal”)"
              aria-label="Search query"
            />
          </div>
          <div className="flex items-center gap-2 text-xs text-system-gray-500">
            <SearchIcon className="h-4 w-4" aria-hidden="true" />
            <span>{resultCountLabel}</span>
            <button
              type="button"
              className="ml-2 inline-flex items-center gap-1 text-xs text-system-gray-500 hover:text-system-gray-800"
              onClick={refreshStats}
              disabled={isLoadingStats}
              title="Refresh embeddings status"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoadingStats ? 'animate-spin' : ''}`} />
              {stats ? `${stats.folders}F/${stats.files}R` : 'Status'}
            </button>
          </div>
        </div>

        {showEmptyEmbeddingsBanner ? (
          <div className="glass-panel border border-stratosort-warning/30 bg-stratosort-warning/10 p-3 text-sm text-system-gray-800">
            <div className="font-medium">No file embeddings yet</div>
            <div className="text-xs text-system-gray-600 mt-1">
              Semantic search needs embeddings. Rebuild them once (or after changing folders).
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

        {error ? (
          <div className="glass-panel border border-stratosort-danger/30 bg-stratosort-danger/10 p-3 text-sm text-system-gray-800">
            {error}
          </div>
        ) : null}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            {results.length === 0 && !error ? (
              <div className="text-sm text-system-gray-500 py-6 text-center">
                {debouncedQuery && debouncedQuery.length >= 2
                  ? 'No matches found.'
                  : 'Enter a query to search across embedded files.'}
              </div>
            ) : null}

            {results.map((r) => (
              <ResultRow
                key={r.id}
                result={r}
                isSelected={r.id === selectedId}
                onSelect={onSelect}
                onOpen={onOpen}
                onReveal={onReveal}
                onCopyPath={onCopyPath}
              />
            ))}
          </div>

          <div className="surface-panel p-4 min-h-[12rem]">
            <h3 className="text-sm font-semibold text-system-gray-900 mb-2">Preview</h3>
            {selectedResult ? (
              <div className="text-sm text-system-gray-700 flex flex-col gap-2">
                <div className="text-xs text-system-gray-500">
                  Score: {formatScore(selectedResult.score)}
                </div>
                <div className="font-medium break-all">
                  {selectedResult?.metadata?.path || selectedResult.id}
                </div>
                {selectedResult?.document ? (
                  <div className="text-xs text-system-gray-600 whitespace-pre-wrap">
                    {String(selectedResult.document).slice(0, 800)}
                  </div>
                ) : (
                  <div className="text-xs text-system-gray-500">No preview text available.</div>
                )}

                <div className="pt-2 flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => onOpen(selectedResult?.metadata?.path)}
                  >
                    <ExternalLink className="h-4 w-4" /> Open
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onReveal(selectedResult?.metadata?.path)}
                  >
                    <FolderOpen className="h-4 w-4" /> Reveal
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onCopyPath(selectedResult?.metadata?.path)}
                  >
                    <Copy className="h-4 w-4" /> Copy path
                  </Button>
                </div>
              </div>
            ) : (
              <div className="text-sm text-system-gray-500">Select a result to see details.</div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

SemanticSearchModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  defaultTopK: PropTypes.number
};
