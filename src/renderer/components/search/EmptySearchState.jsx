/**
 * EmptySearchState - Contextual empty states for search
 *
 * Shows different content based on:
 * - No query entered: Shows recent searches and tips
 * - No results found: Shows suggestions and alternatives
 * - No files indexed: Shows warning to add files
 */

import React, { useState, useEffect, memo } from 'react';
import PropTypes from 'prop-types';
import { Search, Clock, Lightbulb, FolderPlus, X, ArrowRight } from 'lucide-react';
import { Button, IconButton, StateMessage } from '../ui';
import { Text } from '../ui/Typography';

// Storage key matches SearchAutocomplete
const RECENT_SEARCHES_KEY = 'stratosort-recent-searches';
const MAX_DISPLAY_QUERY_LENGTH = 50;

/**
 * Load recent searches from localStorage
 */
function loadRecentSearches() {
  try {
    const stored = localStorage.getItem(RECENT_SEARCHES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

/**
 * Clear a specific search from history
 */
function removeRecentSearch(searchToRemove) {
  try {
    const recent = loadRecentSearches();
    const updated = recent.filter((s) => s !== searchToRemove);
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return [];
  }
}

const EmptySearchState = memo(function EmptySearchState({
  query,
  hasIndexedFiles = true,
  indexingHint = null,
  onOpenSettings,
  onRebuildFiles,
  onSearchClick,
  className = '',
  corrections = []
}) {
  const [recentSearches, setRecentSearches] = useState([]);

  useEffect(() => {
    setRecentSearches(loadRecentSearches());
  }, []);

  const handleRemoveRecent = (e, search) => {
    e.stopPropagation();
    const updated = removeRecentSearch(search);
    setRecentSearches(updated);
  };

  const handleRecentClick = (search) => {
    if (onSearchClick) {
      onSearchClick(search);
    }
  };

  const handleSuggestionClick = (suggestion) => {
    if (onSearchClick) {
      onSearchClick(suggestion);
    }
  };

  // No files indexed - show warning
  if (!hasIndexedFiles) {
    const timing = indexingHint?.timing || null;
    const policy = indexingHint?.policy || null;
    const isManual = timing === 'manual';
    const isPolicyDisabled = policy === 'skip' || policy === 'web_only';
    const isDeferred = timing === 'after_organize';

    const title = isManual
      ? 'Embeddings are set to manual'
      : isPolicyDisabled
        ? 'Embeddings are disabled'
        : isDeferred
          ? 'Embeddings are deferred until after organize'
          : 'No files indexed yet';

    const description = isManual
      ? 'Knowledge OS search needs local embeddings, but your settings are set to Manual only. Enable automatic embedding, or run a rebuild after you switch it back on.'
      : isPolicyDisabled
        ? `Your default embedding policy is set to "${policy}". Knowledge OS won’t create local embeddings, so semantic search will return no results.`
        : isDeferred
          ? 'Your embedding timing is set to After organize/move. Files will be indexed once they are moved into Smart Folders, or you can rebuild embeddings now.'
          : 'Add Smart Folders (so files become eligible for indexing) or rebuild embeddings to start searching.';

    return (
      <StateMessage
        icon={FolderPlus}
        tone="warning"
        size="lg"
        title={title}
        description={description}
        action={
          (onOpenSettings || onRebuildFiles) && (
            <div className="flex flex-wrap gap-2 justify-center">
              {onOpenSettings && (
                <Button type="button" variant="secondary" size="sm" onClick={onOpenSettings}>
                  Open Settings
                </Button>
              )}
              {onRebuildFiles && (
                <Button type="button" variant="primary" size="sm" onClick={onRebuildFiles}>
                  Build File Embeddings
                </Button>
              )}
            </div>
          )
        }
        className={`py-spacious px-relaxed ${className}`.trim()}
        contentClassName="max-w-sm"
      />
    );
  }

  // No query - show recent searches and tips
  if (!query || query.trim().length < 2) {
    return (
      <div className={`p-relaxed ${className}`.trim()}>
        {/* Recent searches */}
        {recentSearches.length > 0 && (
          <div className="mb-6">
            <Text
              as="div"
              variant="tiny"
              className="font-semibold text-system-gray-500 uppercase tracking-wide mb-3 flex items-center gap-compact"
            >
              <Clock className="w-3.5 h-3.5" />
              Recent Searches
            </Text>
            <div className="space-y-compact">
              {recentSearches.slice(0, 5).map((search) => (
                <div
                  key={`recent-${search}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleRecentClick(search)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleRecentClick(search);
                    }
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-system-gray-700 hover:bg-system-gray-50 rounded-lg group transition-colors text-left cursor-pointer"
                >
                  <Clock className="w-4 h-4 text-system-gray-400 shrink-0" />
                  <Text as="span" variant="small" className="flex-1 truncate text-system-gray-700">
                    {search}
                  </Text>
                  <ArrowRight className="w-4 h-4 text-system-gray-300 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  <IconButton
                    icon={<X className="w-3.5 h-3.5" />}
                    size="sm"
                    variant="ghost"
                    onClick={(e) => handleRemoveRecent(e, search)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 h-6 w-6 text-system-gray-400 hover:text-system-gray-600"
                    aria-label="Remove from history"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Search tips */}
        <div>
          <Text
            as="div"
            variant="tiny"
            className="font-semibold text-system-gray-500 uppercase tracking-wide mb-3 flex items-center gap-compact"
          >
            <Lightbulb className="w-3.5 h-3.5" />
            Search Tips
          </Text>
          <Text as="ul" variant="small" className="space-y-cozy text-system-gray-600">
            <li className="flex items-start gap-2">
              <span className="text-system-gray-400 mt-0.5">•</span>
              <span>Use natural language like &quot;vacation photos from beach&quot;</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-system-gray-400 mt-0.5">•</span>
              <span>Search by file type: &quot;PDF documents&quot; or &quot;video files&quot;</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-system-gray-400 mt-0.5">•</span>
              <span>Describe content: &quot;spreadsheet with budget&quot;</span>
            </li>
          </Text>
        </div>
      </div>
    );
  }

  // Has query but no results

  // Construct a suggested query from corrections if available
  let suggestedQuery = null;
  if (corrections && corrections.length > 0) {
    // Basic reconstruction: replace misspelled words in original query
    const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let fixed = query;
    for (const { original, corrected } of corrections) {
      if (original && corrected) {
        // Case-insensitive replacement
        const regex = new RegExp(`\\b${escapeRegExp(original)}\\b`, 'gi');
        fixed = fixed.replace(regex, corrected);
      }
    }
    if (fixed.toLowerCase() !== query.toLowerCase()) {
      suggestedQuery = fixed;
    }
  }

  return (
    <StateMessage
      icon={Search}
      title={
        <>
          No results for &quot;
          {query.length > MAX_DISPLAY_QUERY_LENGTH
            ? `${query.slice(0, MAX_DISPLAY_QUERY_LENGTH)}...`
            : query}
          &quot;
        </>
      }
      description={
        suggestedQuery ? (
          <span className="flex flex-col gap-compact items-center">
            <span>We couldn&apos;t find exact matches.</span>
            <Button
              onClick={() => handleSuggestionClick(suggestedQuery)}
              variant="ghost"
              size="sm"
              className="h-auto px-1 py-0 text-sm text-stratosort-blue hover:underline"
            >
              Did you mean: <span className="italic">{suggestedQuery}</span>?
            </Button>
          </span>
        ) : (
          'Try different keywords or check your spelling'
        )
      }
      size="lg"
      className={`py-spacious px-relaxed ${className}`.trim()}
      contentClassName="max-w-sm"
    >
      <div className="w-full">
        <Text variant="tiny" className="uppercase tracking-wide font-medium text-system-gray-500">
          Try searching for
        </Text>
        <div className="flex flex-wrap gap-compact justify-center mt-2">
          {['documents', 'images', 'recent files', 'projects'].map((suggestion) => (
            <Button
              key={suggestion}
              type="button"
              onClick={() => handleSuggestionClick(suggestion)}
              variant="subtle"
              size="sm"
              className="text-stratosort-blue bg-stratosort-blue/10 border-stratosort-blue/20 hover:bg-stratosort-blue/20"
            >
              {suggestion}
            </Button>
          ))}
        </div>
      </div>
    </StateMessage>
  );
});

EmptySearchState.propTypes = {
  /** Current search query */
  query: PropTypes.string,
  /** Whether there are any files in the index */
  hasIndexedFiles: PropTypes.bool,
  /** Optional hint for why the index is empty */
  indexingHint: PropTypes.shape({
    timing: PropTypes.oneOf(['during_analysis', 'after_organize', 'manual']),
    policy: PropTypes.oneOf(['embed', 'skip', 'web_only'])
  }),
  /** Open settings (for fixing embedding config) */
  onOpenSettings: PropTypes.func,
  /** Trigger a file-embedding rebuild */
  onRebuildFiles: PropTypes.func,
  /** Callback when user clicks a search suggestion or recent search */
  onSearchClick: PropTypes.func,
  /** Additional CSS classes */
  className: PropTypes.string,
  /** Spell corrections from search service */
  corrections: PropTypes.arrayOf(
    PropTypes.shape({
      original: PropTypes.string,
      corrected: PropTypes.string
    })
  )
};

export default EmptySearchState;
