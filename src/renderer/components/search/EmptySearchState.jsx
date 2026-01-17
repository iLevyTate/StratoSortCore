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
  onSearchClick,
  className = ''
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
    return (
      <div
        className={`flex flex-col items-center justify-center py-12 px-6 text-center ${className}`}
      >
        <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center mb-4">
          <FolderPlus className="w-6 h-6 text-amber-600" />
        </div>
        <h3 className="text-base font-medium text-system-gray-900 mb-2">No files indexed yet</h3>
        <p className="text-sm text-system-gray-500 max-w-xs">
          Add folders to your library to start searching. Files will be automatically indexed for
          Knowledge OS.
        </p>
      </div>
    );
  }

  // No query - show recent searches and tips
  if (!query || query.trim().length < 2) {
    return (
      <div className={`py-6 px-4 ${className}`}>
        {/* Recent searches */}
        {recentSearches.length > 0 && (
          <div className="mb-6">
            <h4 className="text-xs font-medium text-system-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              Recent Searches
            </h4>
            <div className="space-y-1">
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
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-system-gray-700 hover:bg-system-gray-50 rounded-lg group transition-colors text-left cursor-pointer"
                >
                  <Clock className="w-4 h-4 text-system-gray-400 shrink-0" />
                  <span className="flex-1 truncate">{search}</span>
                  <ArrowRight className="w-4 h-4 text-system-gray-300 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  <button
                    type="button"
                    onClick={(e) => handleRemoveRecent(e, search)}
                    className="p-0.5 rounded hover:bg-system-gray-200 text-system-gray-400 hover:text-system-gray-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                    aria-label="Remove from history"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Search tips */}
        <div>
          <h4 className="text-xs font-medium text-system-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <Lightbulb className="w-3.5 h-3.5" />
            Search Tips
          </h4>
          <ul className="space-y-2 text-sm text-system-gray-600">
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
          </ul>
        </div>
      </div>
    );
  }

  // Has query but no results
  return (
    <div
      className={`flex flex-col items-center justify-center py-12 px-6 text-center ${className}`}
    >
      <div className="w-12 h-12 rounded-full bg-system-gray-100 flex items-center justify-center mb-4">
        <Search className="w-6 h-6 text-system-gray-400" />
      </div>
      <h3 className="text-base font-medium text-system-gray-900 mb-2">
        No results for &quot;
        {query.length > MAX_DISPLAY_QUERY_LENGTH
          ? `${query.slice(0, MAX_DISPLAY_QUERY_LENGTH)}...`
          : query}
        &quot;
      </h3>
      <p className="text-sm text-system-gray-500 max-w-xs mb-6">
        Try different keywords or check your spelling
      </p>

      {/* Suggestions */}
      <div className="w-full max-w-xs">
        <h4 className="text-xs font-medium text-system-gray-500 uppercase tracking-wide mb-2">
          Try searching for
        </h4>
        <div className="flex flex-wrap gap-2 justify-center">
          {['documents', 'images', 'recent files', 'projects'].map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => handleSuggestionClick(suggestion)}
              className="px-3 py-1.5 text-sm text-stratosort-blue bg-stratosort-blue/10 hover:bg-stratosort-blue/20 rounded-full transition-colors"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
});

EmptySearchState.propTypes = {
  /** Current search query */
  query: PropTypes.string,
  /** Whether there are any files in the index */
  hasIndexedFiles: PropTypes.bool,
  /** Callback when user clicks a search suggestion or recent search */
  onSearchClick: PropTypes.func,
  /** Additional CSS classes */
  className: PropTypes.string
};

export default EmptySearchState;
