import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

// Thunk to fetch smart folders with optional cache bypass
// FIX: Added forceRefresh parameter to allow cache invalidation when folders change
export const fetchSmartFolders = createAsyncThunk(
  'files/fetchSmartFolders',
  async (forceRefresh = false, { getState }) => {
    const { files } = getState();
    // Return cached value if already fetched, not empty, and not forcing refresh
    if (!forceRefresh && files.smartFolders && files.smartFolders.length > 0) {
      return files.smartFolders;
    }
    const folders = await window.electronAPI?.smartFolders?.get?.();
    return Array.isArray(folders) ? folders : [];
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
const serializeFile = (file) => {
  if (!file || typeof file !== 'object') return file;
  const serialized = { ...file };
  // Convert Date objects to ISO strings
  ['created', 'modified', 'accessed', 'birthtime', 'mtime', 'atime', 'ctime'].forEach((key) => {
    if (serialized[key] instanceof Date) {
      serialized[key] = serialized[key].toISOString();
    }
  });
  return serialized;
};

const serializeFiles = (files) => {
  if (!Array.isArray(files)) return files;
  return files.map(serializeFile);
};

const initialState = {
  selectedFiles: [], // Array of file objects
  smartFolders: [], // Array of configured smart folders
  smartFoldersLoading: false, // Loading state for smart folders
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
      state.selectedFiles = serializeFiles(action.payload);
    },
    addSelectedFiles: (state, action) => {
      // Filter duplicates and serialize
      const newFiles = serializeFiles(action.payload).filter(
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
      state.fileStates[path] = {
        state: fileState,
        timestamp: new Date().toISOString(),
        ...metadata
      };
    },
    setFileStates: (state, action) => {
      state.fileStates = action.payload;
    },
    setSmartFolders: (state, action) => {
      state.smartFolders = action.payload;
    },
    addSmartFolder: (state, action) => {
      state.smartFolders.push(action.payload);
    },
    setOrganizedFiles: (state, action) => {
      state.organizedFiles = action.payload;
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
      if (oldPaths.length !== newPaths.length) return;

      // Create path mapping
      const pathMap = {};
      oldPaths.forEach((oldPath, i) => {
        pathMap[oldPath] = newPaths[i];
      });

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
      const newFileStates = {};
      Object.entries(state.fileStates).forEach(([path, fileState]) => {
        const newPath = pathMap[path];
        newFileStates[newPath || path] = fileState;
      });
      state.fileStates = newFileStates;

      // Update organizedFiles if present
      state.organizedFiles = state.organizedFiles.map((file) => {
        const newPath = pathMap[file.originalPath] || pathMap[file.path];
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
      })
      .addCase(fetchSmartFolders.fulfilled, (state, action) => {
        state.smartFolders = action.payload;
        state.smartFoldersLoading = false;
      })
      .addCase(fetchSmartFolders.rejected, (state) => {
        state.smartFoldersLoading = false;
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
  updateFilePathsAfterMove
} = filesSlice.actions;

export default filesSlice.reducer;
