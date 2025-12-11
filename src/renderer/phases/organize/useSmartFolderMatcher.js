/**
 * useSmartFolderMatcher Hook
 *
 * Smart folder matching with caching.
 *
 * @module organize/useSmartFolderMatcher
 */

import { useMemo } from 'react';

/**
 * Hook for smart folder matching with caching
 * @param {Array} smartFolders - Smart folders array
 * @returns {Function} Function to find smart folder for category
 */
export function useSmartFolderMatcher(smartFolders) {
  return useMemo(() => {
    const folderCache = new Map();

    // Pre-normalize smart folders once for efficient matching
    const normalizedFolders = smartFolders.map((folder) => {
      const baseName = folder?.name?.toLowerCase()?.trim() || '';
      return {
        original: folder,
        normalized: baseName,
        variants: [
          baseName,
          baseName.replace(/s$/, ''),
          `${baseName}s`,
          baseName.replace(/\s+/g, ''),
          baseName.replace(/\s+/g, '-'),
          baseName.replace(/\s+/g, '_')
        ]
      };
    });

    return (category) => {
      if (!category) return null;

      // Check cache first
      if (folderCache.has(category)) {
        return folderCache.get(category);
      }

      const normalizedCategory = category.toLowerCase().trim();

      // Generate category variants
      const categoryVariants = [
        normalizedCategory,
        normalizedCategory.replace(/s$/, ''),
        `${normalizedCategory}s`,
        normalizedCategory.replace(/\s+/g, ''),
        normalizedCategory.replace(/\s+/g, '-'),
        normalizedCategory.replace(/\s+/g, '_')
      ];

      // Try to find a match
      let matchedFolder = null;

      for (const normalizedFolder of normalizedFolders) {
        // Direct match on normalized name
        if (normalizedFolder.normalized === normalizedCategory) {
          matchedFolder = normalizedFolder.original;
          break;
        }

        // Try all variant combinations
        for (const categoryVariant of categoryVariants) {
          if (normalizedFolder.variants.includes(categoryVariant)) {
            matchedFolder = normalizedFolder.original;
            break;
          }
        }

        if (matchedFolder) break;
      }

      // Cache the result (even if null to avoid repeated lookups)
      folderCache.set(category, matchedFolder);
      return matchedFolder;
    };
  }, [smartFolders]);
}

export default useSmartFolderMatcher;
