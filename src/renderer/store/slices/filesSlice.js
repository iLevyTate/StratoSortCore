import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { logger } from '../../../shared/logger';
import { serializeData } from '../../utils/serialization';
import { smartFoldersIpc } from '../../services/ipc';

// Thunk to fetch smart folders with optional cache bypass
// FIX: Added forceRefresh parameter to allow cache invalidation when folders change
export const fetchSmartFolders = createAsyncThunk(
  'files/fetchSmartFolders',
  async (forceRefresh = false, { getState, rejectWithValue }) => {
    const { files } = getState();
    // Return cached value if already fetched, not empty, and not forcing refresh
    if (!forceRefresh && files.smartFolders && files.smartFolders.length > 0) {
      return files.smartFolders;
    }
    try {
      const folders = await smartFoldersIpc.get();
      return Array.isArray(folders) ? folders : [];
    } catch (error) {
      logger.error('[filesSlice] Failed to fetch smart folders', { error: error?.message });
      return rejectWithValue(error?.message || 'Failed to load smart folders');
    }
  }
);

// Thunk to invalidate and refetch smart folders
// Call this when smart folders are modified (added, removed, or edited)
export const invalidateSmartFolders = createAsyncThunk(
  'files/invalidateSmartFolders',
  async (_, { dispatch }) => {
    // Force a refresh by dispatching fetchSmartFolders with forceRefresh=true
    const result = await dispatch(fetchSmartFolders(true));
    return result.payload;
  }
);

// Helper to serialize file objects - converts Date to ISO string for Redux compatibility
// REPLACED by shared serializeData utility

const initialState = {
  selectedFiles: [], // Array of file objects
  smartFolders: [], // Array of configured smart folders
  smartFoldersLoading: false, // Loading state for smart folders
  smartFoldersError: null, // FIX: Track smart folders fetch errors
  organizedFiles: [], // History of organized files
  fileStates: {}, // Map of path -> state (pending, analyzing, ready, error)
  namingConvention: {
    convention: 'subject-date',
    dateFormat: 'YYYY-MM-DD',
    caseConvention: 'kebab-case',
    separator: '-'
  }
};

const filesSlice = createSlice({
  name: 'files',
  initialState,
  reducers: {
    setSelectedFiles: (state, action) => {
      state.selectedFiles = serializeData(action.payload);
    },
    addSelectedFiles: (state, action) => {
      // Filter duplicates and serialize
      const newFiles = serializeData(action.payload).filter(
        (newFile) => !state.selectedFiles.some((f) => f.path === newFile.path)
      );
      state.selectedFiles = [...state.selectedFiles, ...newFiles];
    },
    removeSelectedFile: (state, action) => {
      state.selectedFiles = state.selectedFiles.filter((f) => f.path !== action.payload);
      // Also cleanup file state
      if (state.fileStates[action.payload]) {
        delete state.fileStates[action.payload];
      }
    },
    removeSelectedFiles: (state, action) => {
      if (!Array.isArray(action.payload)) return;
      const pathsToRemove = new Set(action.payload);
      state.selectedFiles = state.selectedFiles.filter((f) => !pathsToRemove.has(f.path));
      // Batch cleanup file states
      action.payload.forEach((path) => {
        if (state.fileStates[path]) {
          delete state.fileStates[path];
        }
      });
    },
    updateFileState: (state, action) => {
      const { path, state: fileState, metadata } = action.payload;
      const safeMetadata = serializeData(metadata);
      state.fileStates[path] = {
        state: fileState,
        timestamp: new Date().toISOString(),
        ...safeMetadata
      };
    },
    setFileStates: (state, action) => {
      const serializedStates = {};
      if (action.payload && typeof action.payload === 'object') {
        Object.entries(action.payload).forEach(([path, data]) => {
          serializedStates[path] = serializeData(data);
        });
      }
      state.fileStates = serializedStates;
    },
    setSmartFolders: (state, action) => {
      state.smartFolders = action.payload;
    },
    addSmartFolder: (state, action) => {
      state.smartFolders.push(action.payload);
    },
    setOrganizedFiles: (state, action) => {
      state.organizedFiles = serializeData(action.payload);
    },
    addOrganizedFiles: (state, action) => {
      const newFiles = serializeData(action.payload);
      state.organizedFiles = [...state.organizedFiles, ...newFiles];
    },
    removeOrganizedFiles: (state, action) => {
      if (!Array.isArray(action.payload)) return;
      const normalize = (p) => (p || '').replace(/[\\/]+/g, '/').toLowerCase();
      const pathsToRemove = new Set(action.payload.map(normalize));

      state.organizedFiles = state.organizedFiles.filter(
        (file) => !pathsToRemove.has(normalize(file.originalPath))
      );
    },
    setNamingConvention: (state, action) => {
      state.namingConvention = { ...state.namingConvention, ...action.payload };
    },
    clearFiles: (state) => {
      state.selectedFiles = [];
      state.fileStates = {};
    },
    resetFilesState: () => {
      return initialState;
    },
    // FIX: Update file paths after organize/move operations
    // This ensures Redux state stays in sync with actual file locations
    updateFilePathsAfterMove: (state, action) => {
      const { oldPaths, newPaths } = action.payload;
      if (!Array.isArray(oldPaths) || !Array.isArray(newPaths)) return;

      // FIX: Handle partial failures gracefully instead of silently returning
      // If arrays have different lengths, still update what we can (matches analysisSlice behavior)
      if (oldPaths.length !== newPaths.length) {
        logger.warn('[filesSlice] updateFilePathsAfterMove: array length mismatch', {
          oldPathsLength: oldPaths.length,
          newPathsLength: newPaths.length,
          action: 'proceeding with partial update'
        });
      }

      // Create path mapping using minimum length to avoid undefined entries
      const minLength = Math.min(oldPaths.length, newPaths.length);
      const pathMap = {};
      for (let i = 0; i < minLength; i++) {
        pathMap[oldPaths[i]] = newPaths[i];
      }

      // Update selectedFiles
      state.selectedFiles = state.selectedFiles.map((file) => {
        const newPath = pathMap[file.path];
        if (newPath) {
          return {
            ...file,
            path: newPath,
            name: newPath.split(/[\\/]/).pop() || file.name
          };
        }
        return file;
      });

      // Update fileStates (rename keys)
      // FIX HIGH-43: Inconsistent state updates after move
      // Ensure we clean up old keys and only set new ones
      const newFileStates = { ...state.fileStates };

      // First pass: identify moves
      const moves = [];
      Object.keys(state.fileStates).forEach((path) => {
        const newPath = pathMap[path];
        if (newPath && newPath !== path) {
          moves.push({ old: path, new: newPath });
        }
      });

      // Second pass: apply moves
      moves.forEach(({ old, new: newPath }) => {
        if (newFileStates[old]) {
          newFileStates[newPath] = { ...newFileStates[old], path: newPath };
          delete newFileStates[old];
        }
      });
      state.fileStates = newFileStates;

      // Update organizedFiles if present
      // FIX: Add null guard for file entries that may be undefined
      state.organizedFiles = state.organizedFiles.map((file) => {
        if (!file) return file; // Skip null/undefined entries
        const newPath =
          (file.originalPath && pathMap[file.originalPath]) || (file.path && pathMap[file.path]);
        if (newPath) {
          return {
            ...file,
            currentPath: newPath,
            path: file.path ? newPath : file.path
          };
        }
        return file;
      });
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchSmartFolders.pending, (state) => {
        state.smartFoldersLoading = true;
        state.smartFoldersError = null;
      })
      .addCase(fetchSmartFolders.fulfilled, (state, action) => {
        state.smartFolders = action.payload;
        state.smartFoldersLoading = false;
        state.smartFoldersError = null;
      })
      .addCase(fetchSmartFolders.rejected, (state, action) => {
        // FIX: Preserve existing smartFolders on failure instead of losing them
        // Only log the error, don't clear the array
        state.smartFoldersLoading = false;
        state.smartFoldersError =
          action.payload || action.error?.message || 'Failed to load smart folders';
      });
  }
});

export const {
  setSelectedFiles,
  addSelectedFiles,
  removeSelectedFile,
  removeSelectedFiles,
  updateFileState,
  setFileStates,
  setSmartFolders,
  addSmartFolder,
  setOrganizedFiles,
  setNamingConvention,
  clearFiles,
  resetFilesState,
  updateFilePathsAfterMove,
  addOrganizedFiles,
  removeOrganizedFiles
} = filesSlice.actions;

// FIX: Re-export atomic actions from dedicated module to avoid circular dependency
// The actual implementations are in atomicActions.js which properly imports from both slices
export { atomicUpdateFilePathsAfterMove, atomicRemoveFilesWithCleanup } from './atomicActions';

export default filesSlice.reducer;
