import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

// Thunk to fetch smart folders (only once, then cached)
export const fetchSmartFolders = createAsyncThunk(
  'files/fetchSmartFolders',
  async (_, { getState }) => {
    const { files } = getState();
    // Return cached value if already fetched and not empty
    if (files.smartFolders && files.smartFolders.length > 0) {
      return files.smartFolders;
    }
    const folders = await window.electronAPI?.smartFolders?.get?.();
    return Array.isArray(folders) ? folders : [];
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
  },
  watchPaths: [] // Paths being watched (e.g. Downloads)
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
  updateFileState,
  setFileStates,
  setSmartFolders,
  addSmartFolder,
  setOrganizedFiles,
  setNamingConvention,
  clearFiles,
  resetFilesState
} = filesSlice.actions;

export default filesSlice.reducer;
