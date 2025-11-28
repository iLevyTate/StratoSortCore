import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { PHASES } from '../../../shared/constants';

// Thunk to fetch settings (only once, then cached)
export const fetchSettings = createAsyncThunk(
  'ui/fetchSettings',
  async (_, { getState }) => {
    const { ui } = getState();
    // Return cached value if already fetched
    if (ui.settings) {
      return ui.settings;
    }
    const settings = await window.electronAPI?.settings?.get?.();
    return settings || {};
  },
);

const initialState = {
  currentPhase: PHASES.WELCOME || 'welcome',
  theme: 'light', // 'light', 'dark', 'system'
  sidebarOpen: true,
  showSettings: false,
  isLoading: false,
  loadingMessage: '',
  activeModal: null, // 'history', 'confirm', etc.
  settings: null, // Cached settings from main process
  settingsLoading: false,
};

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setPhase: (state, action) => {
      state.currentPhase = action.payload;
    },
    setTheme: (state, action) => {
      state.theme = action.payload;
    },
    toggleSidebar: (state) => {
      state.sidebarOpen = !state.sidebarOpen;
    },
    toggleSettings: (state) => {
      state.showSettings = !state.showSettings;
    },
    setLoading: (state, action) => {
      if (typeof action.payload === 'boolean') {
        state.isLoading = action.payload;
        state.loadingMessage = '';
      } else {
        state.isLoading = action.payload.isLoading;
        state.loadingMessage = action.payload.message || '';
      }
    },
    setActiveModal: (state, action) => {
      state.activeModal = action.payload;
    },
    resetUi: () => {
      return initialState;
    },
    updateSettings: (state, action) => {
      // CRITICAL FIX: Handle case where settings is null before first fetch
      state.settings = { ...(state.settings || {}), ...action.payload };
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchSettings.pending, (state) => {
        state.settingsLoading = true;
      })
      .addCase(fetchSettings.fulfilled, (state, action) => {
        state.settings = action.payload;
        state.settingsLoading = false;
      })
      .addCase(fetchSettings.rejected, (state) => {
        // CRITICAL FIX: Provide default empty object to prevent null reference errors
        // Components accessing settings.someProp will get undefined instead of crashing
        state.settings = {};
        state.settingsLoading = false;
      });
  },
});

export const {
  setPhase,
  setTheme,
  toggleSidebar,
  toggleSettings,
  setLoading,
  setActiveModal,
  resetUi,
  updateSettings,
} = uiSlice.actions;

export default uiSlice.reducer;
