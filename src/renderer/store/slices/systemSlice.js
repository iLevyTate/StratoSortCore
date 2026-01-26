import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { serializeData } from '../../utils/serialization';
import { filesIpc, systemIpc } from '../../services/ipc';

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
  async (_, { getState, rejectWithValue }) => {
    const { system } = getState();
    // Return cached value if already fetched
    if (system.documentsPath) {
      return system.documentsPath;
    }
    try {
      const path = await filesIpc.getDocumentsPath();
      return normalizeDocumentsPath(path);
    } catch (error) {
      return rejectWithValue(error?.message || 'Failed to load documents path');
    }
  }
);

// Thunk to fetch privacy flag for UI path redaction (only once)
export const fetchRedactPaths = createAsyncThunk(
  'system/fetchRedactPaths',
  async (_, { getState, rejectWithValue }) => {
    const { system } = getState();
    // Return cached value if already fetched
    if (typeof system.redactPaths === 'boolean') {
      return system.redactPaths;
    }
    try {
      const value = await systemIpc.getConfigValue('FEATURES.redactPaths');
      return Boolean(value);
    } catch (error) {
      return rejectWithValue(error?.message || 'Failed to load redactPaths flag');
    }
  }
);

/**
 * Notification status constants (mirrors shared/notificationTypes.js)
 */
const NotificationStatus = {
  PENDING: 'pending',
  DISPLAYED: 'displayed',
  SEEN: 'seen',
  DISMISSED: 'dismissed'
};

const initialState = {
  metrics: {
    cpu: 0,
    memory: 0,
    uptime: 0
  },
  health: {
    chromadb: 'unknown', // 'online', 'offline', 'connecting'
    ollama: 'unknown'
  },
  notifications: [],
  // Track unread count for UI badge
  unreadNotificationCount: 0,
  version: '1.0.0',
  documentsPath: null, // Cached documents path
  documentsPathLoading: false,
  documentsPathError: null,
  // Privacy / recording mode flags
  redactPaths: null, // null = unknown/unfetched, boolean once loaded
  redactPathsLoading: false,
  redactPathsError: null
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
      const safePayload = serializeData(action.payload);
      const notification = {
        // Preserve ID from main process if present, otherwise generate
        id: safePayload.id || Date.now().toString(),
        timestamp: safePayload.timestamp || new Date().toISOString(),
        // Mark as displayed when added to Redux
        status: NotificationStatus.DISPLAYED,
        displayedAt: new Date().toISOString(),
        seenAt: null,
        dismissedAt: null,
        ...safePayload
      };
      state.notifications.push(notification);
      // Increment unread count
      state.unreadNotificationCount += 1;
    },
    removeNotification: (state, action) => {
      const notification = state.notifications.find((n) => n.id === action.payload);
      // Decrement unread count if notification was not yet seen
      if (
        notification &&
        notification.status !== NotificationStatus.SEEN &&
        notification.status !== NotificationStatus.DISMISSED
      ) {
        state.unreadNotificationCount = Math.max(0, state.unreadNotificationCount - 1);
      }
      state.notifications = state.notifications.filter((n) => n.id !== action.payload);
    },
    clearNotifications: (state) => {
      state.notifications = [];
      state.unreadNotificationCount = 0;
    },
    /**
     * Mark a notification as seen (user has viewed it but not dismissed)
     */
    markNotificationSeen: (state, action) => {
      const notification = state.notifications.find((n) => n.id === action.payload);
      if (
        notification &&
        notification.status !== NotificationStatus.SEEN &&
        notification.status !== NotificationStatus.DISMISSED
      ) {
        notification.status = NotificationStatus.SEEN;
        notification.seenAt = new Date().toISOString();
        state.unreadNotificationCount = Math.max(0, state.unreadNotificationCount - 1);
      }
    },
    /**
     * Mark a notification as dismissed (user explicitly closed it)
     */
    markNotificationDismissed: (state, action) => {
      const notification = state.notifications.find((n) => n.id === action.payload);
      if (notification) {
        // If not already seen, decrement unread count
        if (
          notification.status !== NotificationStatus.SEEN &&
          notification.status !== NotificationStatus.DISMISSED
        ) {
          state.unreadNotificationCount = Math.max(0, state.unreadNotificationCount - 1);
        }
        notification.status = NotificationStatus.DISMISSED;
        notification.dismissedAt = new Date().toISOString();
      }
    },
    /**
     * Mark all notifications as seen
     */
    markAllNotificationsSeen: (state) => {
      const now = new Date().toISOString();
      state.notifications.forEach((notification) => {
        if (
          notification.status !== NotificationStatus.SEEN &&
          notification.status !== NotificationStatus.DISMISSED
        ) {
          notification.status = NotificationStatus.SEEN;
          notification.seenAt = now;
        }
      });
      state.unreadNotificationCount = 0;
    },
    setDocumentsPath: (state, action) => {
      state.documentsPath = normalizeDocumentsPath(action.payload);
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchDocumentsPath.pending, (state) => {
        state.documentsPathLoading = true;
        state.documentsPathError = null;
      })
      .addCase(fetchDocumentsPath.fulfilled, (state, action) => {
        state.documentsPath = action.payload;
        state.documentsPathLoading = false;
        state.documentsPathError = null;
      })
      .addCase(fetchDocumentsPath.rejected, (state, action) => {
        state.documentsPath = 'Documents';
        state.documentsPathLoading = false;
        state.documentsPathError =
          action.payload || action.error?.message || 'Failed to load documents path';
      })
      .addCase(fetchRedactPaths.pending, (state) => {
        state.redactPathsLoading = true;
        state.redactPathsError = null;
      })
      .addCase(fetchRedactPaths.fulfilled, (state, action) => {
        state.redactPaths = Boolean(action.payload);
        state.redactPathsLoading = false;
        state.redactPathsError = null;
      })
      .addCase(fetchRedactPaths.rejected, (state, action) => {
        state.redactPaths = false;
        state.redactPathsLoading = false;
        state.redactPathsError =
          action.payload || action.error?.message || 'Failed to load redactPaths flag';
      });
  }
});

export const {
  updateMetrics,
  updateHealth,
  addNotification,
  removeNotification,
  clearNotifications,
  markNotificationSeen,
  markNotificationDismissed,
  markAllNotificationsSeen,
  setDocumentsPath
} = systemSlice.actions;

// Export status constants for use in components
export { NotificationStatus };

export default systemSlice.reducer;
