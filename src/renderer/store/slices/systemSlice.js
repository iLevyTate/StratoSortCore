import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

// Normalize the documents path returned from IPC to a plain string.
// Some IPC implementations return { success, path }, while others return the
// string path directly. We only want to store the path string in Redux.
const normalizeDocumentsPath = (value) => {
  if (!value) return 'Documents';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && typeof value.path === 'string') {
    return value.path;
  }
  return 'Documents';
};

// Thunk to fetch documents path (only once)
export const fetchDocumentsPath = createAsyncThunk(
  'system/fetchDocumentsPath',
  async (_, { getState }) => {
    const { system } = getState();
    // Return cached value if already fetched
    if (system.documentsPath) {
      return system.documentsPath;
    }
    const path = await window.electronAPI?.files?.getDocumentsPath?.();
    return normalizeDocumentsPath(path);
  },
);

const initialState = {
  metrics: {
    cpu: 0,
    memory: 0,
    uptime: 0,
  },
  health: {
    chromadb: 'unknown', // 'online', 'offline', 'connecting'
    ollama: 'unknown',
  },
  notifications: [],
  version: '1.0.0',
  documentsPath: null, // Cached documents path
  documentsPathLoading: false,
};

const systemSlice = createSlice({
  name: 'system',
  initialState,
  reducers: {
    updateMetrics: (state, action) => {
      state.metrics = { ...state.metrics, ...action.payload };
    },
    updateHealth: (state, action) => {
      state.health = { ...state.health, ...action.payload };
    },
    addNotification: (state, action) => {
      // Limit notifications history
      if (state.notifications.length >= 50) {
        state.notifications.shift();
      }
      state.notifications.push({
        id: Date.now().toString(),
        timestamp: new Date().toISOString(),
        ...action.payload,
      });
    },
    removeNotification: (state, action) => {
      state.notifications = state.notifications.filter(
        (n) => n.id !== action.payload,
      );
    },
    clearNotifications: (state) => {
      state.notifications = [];
    },
    setDocumentsPath: (state, action) => {
      state.documentsPath = normalizeDocumentsPath(action.payload);
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchDocumentsPath.pending, (state) => {
        state.documentsPathLoading = true;
      })
      .addCase(fetchDocumentsPath.fulfilled, (state, action) => {
        state.documentsPath = action.payload;
        state.documentsPathLoading = false;
      })
      .addCase(fetchDocumentsPath.rejected, (state) => {
        state.documentsPath = 'Documents';
        state.documentsPathLoading = false;
      });
  },
});

export const {
  updateMetrics,
  updateHealth,
  addNotification,
  removeNotification,
  clearNotifications,
  setDocumentsPath,
} = systemSlice.actions;

export default systemSlice.reducer;
