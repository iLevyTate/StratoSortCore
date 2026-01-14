/**
 * Redux thunks index
 *
 * Export all thunks for atomic operations across slices.
 */

export {
  removeFileWithCleanup,
  removeFilesWithCleanup,
  clearAllFilesWithCleanup
} from './fileThunks';
