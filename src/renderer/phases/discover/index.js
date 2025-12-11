/**
 * Discover Phase Module
 *
 * Central export for all discover phase utilities and hooks.
 *
 * @module phases/discover
 */

// Utility functions
export {
  formatDate,
  applyCaseConvention,
  generatePreviewName,
  validateProgressState,
  getFileStateDisplayInfo,
  extractExtension,
  extractFileName
} from './namingUtils';

// Custom hooks
export { useDiscoverState } from './useDiscoverState';
export { useAnalysis } from './useAnalysis';
export { useFileHandlers } from './useFileHandlers';
export { useFileActions } from './useFileActions';
