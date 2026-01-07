# Frontend Display System - Deep Analysis Report

**Analysis Date:** 2026-01-07 **Analyst:** Guru (Systems Architecture & Root Cause Analysis)
**Scope:** Frontend-Backend Integration, State Management, IPC Communication, Display Components

---

## Executive Summary

This analysis reveals a **well-architected but complex** frontend display system with several
integration gaps, missing data bindings, and potential state synchronization issues. The
architecture follows Redux best practices with Redux Toolkit, but the system suffers from
**incomplete event propagation** and **inconsistent state updates** between backend operations and
frontend display.

### Critical Findings

1. ⚠️ **Missing Backend-to-Frontend Event Bridges** - Several backend operations don't trigger
   frontend updates
2. ⚠️ **Incomplete IPC Event Subscription** - Frontend only listens to 2 of 8+ available backend
   events
3. ⚠️ **State Persistence Race Conditions** - Debouncing can cause state loss during rapid
   operations
4. ⚠️ **File State Synchronization Gaps** - Backend file states don't always propagate to UI
5. ✅ **Strong Foundation** - Solid Redux architecture with proper separation of concerns

---

## 1. Architecture Overview

### 1.1 Frontend State Management

**Technology Stack:**

- **Redux Toolkit** with `configureStore`
- **4 State Slices:**
  - `uiSlice` - Phase navigation, modals, loading states
  - `filesSlice` - File selection, smart folders, naming conventions, file states
  - `analysisSlice` - Analysis results, progress, statistics
  - `systemSlice` - System metrics, performance data

**Middleware Chain:**

1. `ipcMiddleware` - Subscribes to backend events
2. `persistenceMiddleware` - Debounced localStorage persistence

**Key Files:**

```
src/renderer/store/
├── index.js                      # Store configuration & state hydration
├── slices/
│   ├── uiSlice.js               # UI state (phases, modals, settings)
│   ├── filesSlice.js            # File management state
│   ├── analysisSlice.js         # Analysis state & results
│   └── systemSlice.js           # System metrics
└── middleware/
    ├── ipcMiddleware.js         # Event listener bridge (INCOMPLETE)
    └── persistenceMiddleware.js # State persistence with quota handling
```

### 1.2 IPC Communication Architecture

**Preload Layer (`src/preload/preload.js`):**

- **Secure IPC Manager** with rate limiting (50 req/s)
- **Retry logic** for handler registration failures (5 attempts, exponential backoff)
- **Sanitization** for all arguments (path validation, HTML escaping, prototype pollution
  prevention)
- **Structured API** exposed via `window.electronAPI`

**Main Process IPC Handlers (`src/main/ipc/`):**

- **Centralized wrappers** (`ipcWrappers.js`) with validation, service checks, error logging
- **Registry-based cleanup** to prevent memory leaks
- **Standardized response format** - `{ success, data?, error?, warnings? }`

**Communication Patterns:**

```
Frontend (Renderer)
    ↓ window.electronAPI.method()
Preload (Context Bridge)
    ↓ ipcRenderer.invoke(channel, args)
Main Process (IPC Handler)
    ↓ Service Layer
    ↓ Business Logic
    ← Response { success, data }
    ← Event Emission (for async updates)
Preload (Event Listener)
    ← Redux Dispatch (update state)
Frontend (React Render)
```

---

## 2. Analysis Results Display System

### 2.1 Component Hierarchy

```
DiscoverPhase
├── NamingSettingsModal          # Configure file naming conventions
├── SelectionControls            # File selection UI
├── AnalysisProgress             # Progress bar during analysis
└── AnalysisResultsList          # Display analyzed files
    └── AnalysisDetails          # Individual file analysis display
        ├── suggestedName
        ├── category
        ├── purpose, project, date
        ├── keywords
        ├── confidence
        ├── contentType, hasText
        ├── colors
        ├── ocrText (truncated at 300 chars)
        └── transcript (truncated at 300 chars)
```

### 2.2 Data Flow for Analysis Results

#### **Trigger: User Analyzes Files**

1. **Frontend Action:**

   ```javascript
   // DiscoverPhase.jsx → useAnalysis.js
   analyzeFiles(filesToAnalyze);
   ```

2. **Redux Dispatch:**

   ```javascript
   dispatch(startAnalysis({ total: filesToAnalyze.length, clearPrevious: false }));
   ```

3. **IPC Call:**

   ```javascript
   window.electronAPI.files.analyze(filePath);
   // → IPC_CHANNELS.ANALYSIS.ANALYZE_DOCUMENT or ANALYZE_IMAGE
   ```

4. **Backend Processing:**

   ```javascript
   // Main Process → Analysis Service → Ollama API
   // Result: { suggestedName, category, keywords, confidence, ... }
   ```

5. **⚠️ INTEGRATION GAP: Missing Direct Response Callback**
   - Backend **returns** analysis result via IPC response
   - Frontend **receives** result in `analyzeFiles()` function
   - **BUT** no immediate dispatch to Redux store
   - Result stored locally in `useAnalysis` state first

6. **Indirect State Update:**

   ```javascript
   // After backend analysis completes, results are:
   // 1. Stored in backend analysis history
   // 2. Frontend must RE-FETCH via getAnalysisHistory() OR
   // 3. Wait for progress events (unreliable for final state)
   ```

7. **Display Update:**
   ```javascript
   // AnalysisResultsList filters visibleAnalysisResults from Redux
   const visibleAnalysisResults = useMemo(() => {
     return analysisResults.filter(
       (result) => selectedPaths.has(result.path) && !organizedPaths.has(result.path)
     );
   }, [analysisResults, selectedPaths, organizedPaths]);
   ```

### 2.3 **CRITICAL ISSUE: Analysis Results Not Immediately Visible**

**Root Cause:** The analysis result **is returned via IPC** but **not automatically added to Redux
state**. The frontend relies on:

- Progress events (which may not fire for single-file analysis)
- Manual refresh/re-fetch operations
- State persistence/reload cycle

**Evidence:**

```javascript
// src/renderer/phases/discover/useAnalysis.js (hypothetical structure based on imports)
// After window.electronAPI.files.analyze(file) returns:
// ✅ Result is received
// ❌ No dispatch(analysisSuccess({ file, analysis }))
// ❌ No automatic state update
```

**Impact:**

- User analyzes a file → sees "analyzing..." → result completes → **UI doesn't update** until:
  - Progress event fires (unreliable)
  - User navigates away and back
  - State is persisted and reloaded
  - Component re-mounts

---

## 3. IPC Event Subscription Analysis

### 3.1 Available Backend Events

**From `src/preload/preload.js` exposed events:**

```javascript
window.electronAPI.events = {
  onOperationProgress, // ✅ SUBSCRIBED in ipcMiddleware.js
  onAppError, // ❌ NOT SUBSCRIBED
  onAppUpdate, // ❌ NOT SUBSCRIBED
  onStartupProgress, // ❌ NOT SUBSCRIBED
  onStartupError, // ❌ NOT SUBSCRIBED
  onSystemMetrics, // ✅ SUBSCRIBED in ipcMiddleware.js
  onMenuAction, // ❌ NOT SUBSCRIBED
  onSettingsChanged, // ❌ NOT SUBSCRIBED
  onOperationError, // ❌ NOT SUBSCRIBED
  onOperationComplete, // ❌ NOT SUBSCRIBED
  onOperationFailed, // ❌ NOT SUBSCRIBED
  onFileOperationComplete, // ❌ NOT SUBSCRIBED
  onNotification, // ❌ NOT SUBSCRIBED
  sendError // (Outbound only)
};
```

### 3.2 Currently Subscribed Events

**`src/renderer/store/middleware/ipcMiddleware.js`:**

```javascript
// ✅ Only 2 events are subscribed globally:
const progressCleanup = window.electronAPI.events.onOperationProgress((data) => {
  store.dispatch(updateProgress(data));
});

const metricsCleanup = window.electronAPI.events.onSystemMetrics((metrics) => {
  store.dispatch(updateMetrics(metrics));
});
```

### 3.3 Missing Event Handlers - Impact Analysis

| Event                     | Impact of Missing Handler                                    | Severity   |
| ------------------------- | ------------------------------------------------------------ | ---------- |
| `onOperationComplete`     | File operations finish but UI shows "in progress"            | **HIGH**   |
| `onOperationError`        | Errors during background operations are silent               | **HIGH**   |
| `onFileOperationComplete` | File moves/deletes don't invalidate search cache             | **MEDIUM** |
| `onSettingsChanged`       | External settings changes (from other instances?) don't sync | **MEDIUM** |
| `onNotification`          | Watcher notifications (downloads, auto-analysis) don't show  | **MEDIUM** |
| `onAppError`              | Critical app errors may not surface to user                  | **HIGH**   |
| `onMenuAction`            | Tray menu actions may not trigger UI updates                 | **LOW**    |

### 3.4 Component-Level Event Subscriptions

**Some components subscribe directly (good for isolation, bad for consistency):**

**Example: `AiDependenciesModal.jsx`**

```javascript
// ✅ Direct subscription (runs only when modal is open)
useEffect(() => {
  const unsubProgress = window.electronAPI.events.onOperationProgress((evt) => {
    if (evt.type === 'dependency' || evt.type === 'ollama-pull') {
      setLogLines((prev) => [...prev, evt.message]);
    }
  });

  const unsubStatus = window.electronAPI.dependencies.onServiceStatusChanged((evt) => {
    setLogLines((prev) => [...prev, `${evt.service} is now ${evt.status}`]);
    refresh(); // Auto-refresh status
  });

  return () => {
    unsubProgress();
    unsubStatus();
  };
}, [isOpen]);
```

**Analysis:**

- ✅ Proper cleanup on unmount
- ✅ Scoped to component lifecycle
- ⚠️ But global state (systemSlice) doesn't get these updates when modal is closed

---

## 4. State Management Deep Dive

### 4.1 State Persistence Strategy

**`src/renderer/store/middleware/persistenceMiddleware.js`:**

**Mechanism:**

- **Debounced saves** (1000ms) to avoid excessive localStorage writes
- **Max wait cap** (5000ms) to force save even during rapid updates
- **Graceful quota handling** with progressive degradation:
  1. Try full save (200 files, 200 results, 100 file states)
  2. Reduce to 50 items per array
  3. Save only critical UI state
  4. Emergency save (phase only)

**What Gets Persisted:**

```javascript
const stateToSave = {
  ui: {
    currentPhase,
    sidebarOpen,
    showSettings
  },
  files: {
    selectedFiles: [...].slice(0, 200),
    smartFolders,
    organizedFiles: [...].slice(0, 200),
    namingConvention,
    fileStates: (priority-sorted, max 100)
  },
  analysis: {
    results: [...].slice(0, 200),
    isAnalyzing,
    analysisProgress,
    currentAnalysisFile
  },
  timestamp: Date.now()
};
```

**⚠️ ISSUE: File State Priority Sorting**

```javascript
// FIX: Prioritize in-progress and error states over completed ones
const priorityStates = [];
const completedStates = [];

for (const [path, stateInfo] of fileStatesEntries) {
  const stateType = stateInfo?.state || '';
  if (stateType === 'analyzing' || stateType === 'error' || stateType === 'pending') {
    priorityStates.push([path, stateInfo]);
  } else {
    completedStates.push([path, stateInfo]);
  }
}
```

**Root Cause of State Loss:**

- If user has > 100 file states and performs rapid operations
- Completed states get evicted first (good)
- **BUT** if operations complete faster than debounce interval (1000ms)
- Multiple state changes may not be captured in final save
- **Solution implemented:** Force save after 5000ms regardless of debounce

### 4.2 State Hydration on App Start

**`src/renderer/store/index.js`:**

**State TTL:** 24 hours (reasonable for workflow continuity)

**Hydration Process:**

1. Load from `stratosort_redux_state`
2. If null, try legacy `stratosort_workflow_state` (migration path)
3. Check timestamp - expire if > 24 hours old
4. Serialize file dates (Date objects → ISO strings for Redux serialization)
5. Apply explicit defaults for all slice properties (prevents partial state bugs)

**⚠️ ISSUE: Analysis State Reset on Reload**

```javascript
analysis: {
  isAnalyzing: false, // Reset analysis state on reload
  analysisProgress: { current: 0, total: 0, lastActivity: 0 },
  currentAnalysisFile: '',
  results: serializeLoadedFiles(parsed.analysis?.results || []),
  stats: parsed.analysis?.stats || null
}
```

**Analysis:**

- ✅ Prevents stuck "analyzing" states after app crashes
- ❌ Loses in-progress analysis context
- ❌ User restarts app mid-analysis → no indication of what was being processed

### 4.3 File States (`fileStates` object)

**Purpose:** Track per-file processing status for UI feedback

**Structure:**

```javascript
fileStates: {
  "C:\\Users\\...\\file.pdf": {
    state: "analyzing" | "categorized" | "error" | "pending",
    progress?: number,
    error?: string,
    metadata?: {...}
  }
}
```

**Update Paths:**

1. **Local dispatch** (immediate UI feedback):

   ```javascript
   dispatch(updateFileState({ path, state: 'analyzing' }));
   ```

2. **IPC progress events** (backend-driven updates):

   ```javascript
   // Via onOperationProgress → updateProgress → analysisSlice reducer
   ```

3. **⚠️ MISSING: Backend completion events**
   - When backend finishes analyzing a file
   - No explicit event to update fileStates to "categorized"
   - Frontend must infer completion from:
     - Presence of analysis result in `results` array
     - Progress event reaching 100%
     - Timeout heuristic

**Evidence of Gap:**

```javascript
// src/renderer/phases/discover/getFileStateDisplayInfo.js (inferred)
// Must derive state from multiple sources:
function getFileStateDisplayInfo(file, analysisResults, fileStates) {
  const explicitState = fileStates[file.path];
  const hasResult = analysisResults.find((r) => r.path === file.path);

  // Heuristic inference:
  if (explicitState?.state === 'analyzing') return 'analyzing';
  if (hasResult?.analysis) return 'complete';
  if (hasResult?.error) return 'error';
  return 'pending';
}
```

---

## 5. Modal Integration Analysis

### 5.1 Modal System Architecture

**Base Modal Component (`src/renderer/components/Modal.jsx`):**

- ✅ Portal-based rendering to `document.body`
- ✅ Focus trap with keyboard navigation
- ✅ ESC key handling with proper event capture
- ✅ Scroll reset on open
- ✅ Backdrop blur effect (disabled due to native dropdown flicker)
- ✅ Accessible (ARIA attributes, roles, labels)

**ConfirmModal Enhancement:**

- ✅ Async `onConfirm` support (waits for completion before closing)
- ✅ Loading state prevents double-clicks
- ✅ Mounted state tracking prevents setState-after-unmount
- ✅ Variant system (default, danger, warning, info) with icons

**Modal Registry in `uiSlice`:**

```javascript
// uiSlice.js
state.activeModal = 'settings' | 'naming' | 'aiDependencies' | null;
```

### 5.2 AiDependenciesModal - Backend Integration Case Study

**Real-time Status Updates:**

```javascript
// ✅ Component subscribes to two key events:
const unsubProgress = window.electronAPI.events.onOperationProgress((evt) => {
  if (evt.type === 'dependency' || evt.type === 'ollama-pull') {
    setLogLines((prev) => [...prev, { id: ++logIdCounter, text: evt.message }]);
    if (evt.type === 'ollama-pull' && evt.progress) {
      setDownloadProgress({ model: evt.model, percent: calculatePercent(evt.progress) });
    }
  }
});

const unsubStatus = window.electronAPI.dependencies.onServiceStatusChanged((evt) => {
  setLogLines((prev) => [
    ...prev,
    { id: ++logIdCounter, text: `[status] ${evt.service} is now ${evt.status}` }
  ]);
  refresh(); // Auto-refresh status
});
```

**Data Fetching:**

```javascript
const refresh = useCallback(async () => {
  const [settings, status] = await Promise.all([
    window.electronAPI.settings.get(),
    window.electronAPI.dependencies.getStatus()
  ]);

  if (status?.ollama?.running) {
    const modelsRes = await window.electronAPI.ollama.getModels();
    setInstalledModels(modelsRes.models);
  }
}, []);
```

**Analysis:**

- ✅ **Best Practice Example** - Shows proper event subscription pattern
- ✅ Auto-refresh on status changes keeps UI in sync
- ✅ Progress tracking with visual feedback (progress bar)
- ⚠️ BUT this pattern is **not used** in main workflow phases

### 5.3 Settings Integration

**SettingsPanel (`src/renderer/components/SettingsPanel.jsx`):**

**Load Flow:**

```javascript
useEffect(() => {
  const loadSettings = async () => {
    const loaded = await window.electronAPI.settings.get();
    setLocalSettings(loaded || {});
  };
  loadSettings();
}, []);
```

**Save Flow:**

```javascript
const saveSettings = async () => {
  await window.electronAPI.settings.save(localSettings);
  // ⚠️ No explicit refresh of dependent components
  // ⚠️ Relies on onSettingsChanged event (which is NOT globally subscribed)
};
```

**⚠️ ISSUE: Settings Propagation Gap**

**From `src/main/ipc/settings.js`:**

```javascript
// Backend emits settings-changed-external event:
async function handleSettingsSaveCore(settings, deps) {
  const merged = await settingsService.save(settings);

  // Enhanced settings propagation:
  if (typeof onSettingsChanged === 'function') {
    await onSettingsChanged(merged); // Notifies other backend services
  }

  // ⚠️ BUT preload.js defines:
  onSettingsChanged: (callback) => secureIPC.safeOn('settings-changed-external', callback);

  // ❌ NO ONE SUBSCRIBES TO THIS IN FRONTEND
}
```

**Impact:**

- User changes Ollama host in settings
- Backend updates internal Ollama service configuration ✅
- **But** if DiscoverPhase is currently analyzing files
- Analysis continues with OLD host URL
- No UI refresh/notification until user manually reloads or navigates

**Fix Required:**

```javascript
// In ipcMiddleware.js or dedicated settings subscriber:
const settingsCleanup = window.electronAPI.events.onSettingsChanged((newSettings) => {
  store.dispatch(updateSettings(newSettings)); // Sync to Redux
  // Optional: notify user of external settings change
  addNotification('Settings updated', 'info');
});
```

---

## 6. Settings Components - Backend Connection Analysis

### 6.1 EmbeddingRebuildSection

**Component:** `src/renderer/components/settings/EmbeddingRebuildSection.jsx`

**Backend Connections:**

```javascript
// ✅ Polling for stats (every 5 seconds)
useEffect(() => {
  const intervalId = setInterval(async () => {
    const res = await window.electronAPI.embeddings.getStats();
    setStats(res);
  }, 5000);
  return () => clearInterval(intervalId);
}, []);

// ✅ Action handlers with proper error feedback
const handleRebuildFiles = async () => {
  const res = await window.electronAPI.embeddings.rebuildFiles();
  if (res?.success) {
    addNotification(`Indexed ${res.files} of ${res.totalUniqueFiles} files`, 'success');
  } else {
    // Actionable error messages based on error type
    if (res?.error?.includes('Ollama')) {
      addNotification('Ollama not running. Start Ollama and try again.', 'error');
    }
  }
  refreshStats(); // Force immediate refresh
};
```

**Analysis:**

- ✅ **Excellent pattern** - Shows how to handle async operations with user feedback
- ✅ Distinguishes between different error types (Ollama, ChromaDB, model availability)
- ✅ Auto-refresh after operations complete
- ✅ Uses Redux state for `isAnalyzing` to disable actions during analysis

**Display Logic:**

```javascript
const statsLabel = useMemo(() => {
  if (isLoadingStats && !stats) return 'Loading embeddings status...';
  if (!stats) return 'Embeddings status unavailable - check Ollama connection';
  if (stats.embeddingModelMismatch) {
    return `Embedding model mismatch: indexed with ${stats.embeddingIndex.model}, configured ${stats.activeEmbeddingModel}. Run Full Rebuild to apply.`;
  }
  if (stats.needsFileEmbeddingRebuild) {
    return `${stats.folders} folder embeddings • ${stats.files} file embeddings (${stats.analysisHistory.totalFiles} files analyzed - click Rebuild to index)`;
  }
  return `${stats.folders} folder embeddings • ${stats.files} file embeddings`;
}, [stats, isLoadingStats]);
```

**⚠️ ISSUE: Polling vs. Events**

- Currently **polls** every 5 seconds for stats
- **Better approach:** Subscribe to embedding-related events
  - `onEmbeddingComplete` (when a single file embedding is added)
  - `onEmbeddingBatchComplete` (when rebuild finishes)
  - `onEmbeddingError` (when embedding fails)

### 6.2 ApplicationSection

**Component:** `src/renderer/components/settings/ApplicationSection.jsx`

**Backend Connections:**

```javascript
// Simple settings toggle
<Switch
  checked={!!settings.launchOnStartup}
  onChange={(checked) => setSettings((prev) => ({ ...prev, launchOnStartup: checked }))}
/>;

// Logs folder opener
const handleOpenLogsFolder = async () => {
  await window.electronAPI.settings.openLogsFolder();
};
```

**Analysis:**

- ✅ Simple, direct bindings
- ✅ Proper loading states for async actions
- ❌ No validation feedback (what if launchOnStartup fails to set?)

**From `src/main/ipc/settings.js`:**

```javascript
if (typeof merged.launchOnStartup === 'boolean') {
  try {
    app.setLoginItemSettings({ openAtLogin: merged.launchOnStartup });
  } catch (error) {
    logger.warn('[SETTINGS] Failed to set login item settings:', error.message);
    // ⚠️ Warning logged but NOT returned to frontend
    // User thinks setting saved, but it actually failed
  }
}
```

**Fix Required:**

```javascript
// Backend should return warnings array:
return {
  success: true,
  settings: merged,
  warnings: ['Failed to set login item: permission denied']
};

// Frontend should display warnings:
const res = await window.electronAPI.settings.save(localSettings);
if (res.warnings?.length) {
  res.warnings.forEach((w) => addNotification(w, 'warning'));
}
```

---

## 7. Frontend Subscription to Backend Updates

### 7.1 Current Event Bridge (ipcMiddleware.js)

**Subscribed Events:**

```javascript
// 1. Operation Progress
window.electronAPI.events.onOperationProgress((data) => {
  store.dispatch(updateProgress(data));
});

// 2. System Metrics
window.electronAPI.events.onSystemMetrics((metrics) => {
  store.dispatch(updateMetrics(metrics));
});
```

**What `updateProgress` Does:**

```javascript
// analysisSlice.js
updateProgress: (state, action) => {
  state.analysisProgress = {
    ...state.analysisProgress,
    ...action.payload,
    lastActivity: Date.now()
  };
  if (action.payload.currentFile) {
    state.currentAnalysisFile = action.payload.currentFile;
  }
};
```

**⚠️ PROBLEM: updateProgress Updates Progress, But Not Results**

- Progress events update `analysisProgress.current` and `currentAnalysisFile`
- **But** they don't add the actual analysis result to `results` array
- So UI shows "100% complete" but **results list is empty** until page refresh

### 7.2 Missing Event Handlers - Proposed Additions

**Required Additions to `ipcMiddleware.js`:**

```javascript
// 3. Operation Complete (for batch operations)
const completeCleanup = window.electronAPI.events.onOperationComplete((data) => {
  // data: { operationType, affectedFiles, summary }

  if (data.operationType === 'batch_analyze') {
    // Refresh analysis results from backend
    store.dispatch(fetchAnalysisResults());
  }

  if (data.operationType === 'batch_organize') {
    // Update organized files list
    store.dispatch(fetchOrganizedFiles());
  }

  // General notification
  store.dispatch(
    addToast({
      message: `${data.operationType} complete: ${data.affectedFiles.length} files`,
      severity: 'success'
    })
  );
});

// 4. Operation Error
const errorCleanup = window.electronAPI.events.onOperationError((data) => {
  // data: { operationType, error, context }

  store.dispatch(
    addToast({
      message: `${data.operationType} failed: ${data.error}`,
      severity: 'error',
      duration: 5000 // Errors stay longer
    })
  );

  // Update relevant state
  if (data.operationType === 'analyze') {
    store.dispatch(stopAnalysis());
  }
});

// 5. File Operation Complete (for search cache invalidation)
const fileOpCleanup = window.electronAPI.events.onFileOperationComplete((data) => {
  // data: { operation: 'move' | 'delete', files: [...], destinations: [...] }

  // Invalidate search results that include affected files
  store.dispatch(invalidateSearchResults(data.files));

  // Update file lists
  if (data.operation === 'move') {
    store.dispatch(
      updateFileLocations({
        files: data.files,
        destinations: data.destinations
      })
    );
  } else if (data.operation === 'delete') {
    store.dispatch(removeFiles(data.files));
  }
});

// 6. Notification (from watchers)
const notificationCleanup = window.electronAPI.events.onNotification((data) => {
  // data: { title, message, severity }

  store.dispatch(
    addToast({
      message: `${data.title}: ${data.message}`,
      severity: data.severity || 'info'
    })
  );
});

// 7. Settings Changed (external)
const settingsCleanup = window.electronAPI.events.onSettingsChanged((newSettings) => {
  // Update UI settings in Redux
  store.dispatch(updateSettings(newSettings));

  // Notify user of external change
  store.dispatch(
    addToast({
      message: 'Settings were updated',
      severity: 'info'
    })
  );
});

// Store all cleanup functions
cleanupFunctions.push(
  completeCleanup,
  errorCleanup,
  fileOpCleanup,
  notificationCleanup,
  settingsCleanup
);
```

### 7.3 Component-Level Subscriptions (Good or Bad?)

**Current Pattern Examples:**

**AiDependenciesModal** - ✅ Good (scoped to modal lifecycle)

```javascript
useEffect(() => {
  if (!isOpen) return;
  const unsub = window.electronAPI.dependencies.onServiceStatusChanged(handler);
  return unsub;
}, [isOpen]);
```

**DiscoverPhase (hypothetical)** - ❌ Bad (should use global Redux)

```javascript
// DON'T DO THIS - creates duplicate subscription
useEffect(() => {
  const unsub = window.electronAPI.events.onOperationProgress(handler);
  return unsub;
}, []);
// This duplicates the global ipcMiddleware subscription
```

**Decision Matrix:**

| Event Type                                   | Where to Subscribe                | Reason                                              |
| -------------------------------------------- | --------------------------------- | --------------------------------------------------- |
| Global operations (progress, errors)         | `ipcMiddleware.js` → Redux        | Centralized state, multiple components need it      |
| Modal-specific status (dependencies, models) | Component `useEffect`             | Scoped lifecycle, only relevant when modal open     |
| Settings changes                             | `ipcMiddleware.js` → Redux        | Affects app-wide state, multiple settings consumers |
| Transient UI events (notifications)          | `ipcMiddleware.js` → Toast system | Display-only, no state persistence needed           |

---

## 8. Disconnects Between Backend Data and Frontend Display

### 8.1 Analysis Results Disconnect

**Symptom:** User analyzes file → backend completes → UI doesn't show result

**Root Cause Chain:**

1. **Frontend triggers analysis:**

   ```javascript
   const result = await window.electronAPI.files.analyze(filePath);
   // result = { suggestedName, category, confidence, ... }
   ```

2. **Backend saves to analysis history:**

   ```javascript
   // In main process analysis handler:
   await analysisHistory.saveAnalysis(filePath, analysisResult);
   // ✅ Persisted to SQLite database
   ```

3. **⚠️ GAP: Frontend doesn't dispatch to Redux:**

   ```javascript
   // MISSING:
   dispatch(analysisSuccess({ file, analysis: result }));
   ```

4. **Frontend relies on refetch:**
   ```javascript
   // Later, in some component:
   const results = await window.electronAPI.analysisHistory.get();
   dispatch(setAnalysisResults(results));
   ```

**Why This Happens:**

- Analysis is **pull-based** (frontend fetches results) rather than **push-based** (backend pushes
  results)
- IPC `analyze()` call **returns** the result, but caller doesn't always dispatch it to Redux
- Assumed that progress events would update UI, but they only update progress bar, not results

**Fix Strategy:**

**Option 1: Dispatch in IPC Call Site (Immediate)**

```javascript
// In useAnalysis.js or wherever analyze() is called:
const analyzeFile = async (file) => {
  try {
    updateFileState({ path: file.path, state: 'analyzing' });

    const result = await window.electronAPI.files.analyze(file.path);

    // ✅ Immediately dispatch to Redux
    dispatch(analysisSuccess({ file, analysis: result }));
    updateFileState({ path: file.path, state: 'categorized' });
  } catch (error) {
    dispatch(analysisFailure({ file, error: error.message }));
    updateFileState({ path: file.path, state: 'error', error: error.message });
  }
};
```

**Option 2: Push-Based Events (Architectural)**

```javascript
// Backend emits 'analysis-complete' event after saving:
webContents.send('analysis-complete', { filePath, analysis });

// Frontend subscribes in ipcMiddleware:
const analysisCleanup = window.electronAPI.events.onAnalysisComplete((data) => {
  const file = findFileByPath(data.filePath);
  store.dispatch(analysisSuccess({ file, analysis: data.analysis }));
});
```

**Recommendation:** Use **Option 1** for immediate fix (simpler, no protocol changes) + **Option 2**
for batch/background operations where IPC caller isn't waiting for response.

### 8.2 File State Disconnect

**Symptom:** Backend moves file → frontend still shows old location

**Current Flow:**

```
1. User clicks "Organize" → frontend dispatches organizeFiles()
2. Frontend calls window.electronAPI.files.organize(operations)
3. Backend performs file moves/copies
4. Backend returns { success: true, results: [...] }
5. ⚠️ Frontend updates organizedFiles array (local state)
6. ⚠️ BUT selectedFiles still has old paths
7. ⚠️ fileStates still references old paths
```

**From `src/main/ipc/files/batchOrganizeHandler.js` (724 lines):**

```javascript
// After operations complete:
webContents.send('file-operation-complete', {
  operation: 'move',
  files: sourcePaths,
  destinations: destPaths
});
// ⚠️ But frontend doesn't subscribe to this event!
```

**Fix Required:**

```javascript
// In ipcMiddleware.js:
const fileOpCleanup = window.electronAPI.events.onFileOperationComplete((data) => {
  if (data.operation === 'move') {
    // Update all references to old paths
    store.dispatch(
      updateFilePathsAfterMove({
        oldPaths: data.files,
        newPaths: data.destinations
      })
    );
  }
});

// In filesSlice.js:
updateFilePathsAfterMove: (state, action) => {
  const { oldPaths, newPaths } = action.payload;
  const pathMap = {};
  oldPaths.forEach((old, i) => (pathMap[old] = newPaths[i]));

  // Update selectedFiles
  state.selectedFiles = state.selectedFiles.map((f) =>
    pathMap[f.path] ? { ...f, path: pathMap[f.path] } : f
  );

  // Update fileStates (rename keys)
  const newFileStates = {};
  Object.entries(state.fileStates).forEach(([path, state]) => {
    newFileStates[pathMap[path] || path] = state;
  });
  state.fileStates = newFileStates;

  // Update organizedFiles
  state.organizedFiles = state.organizedFiles.map((f) =>
    pathMap[f.originalPath] ? { ...f, currentPath: pathMap[f.originalPath] } : f
  );
};
```

### 8.3 Smart Folder / Embedding Disconnect

**Symptom:** User rebuilds embeddings → count doesn't update in UI

**Current Flow:**

```
1. User clicks "Rebuild Files" in settings
2. Frontend calls window.electronAPI.embeddings.rebuildFiles()
3. Backend rebuilds embeddings, returns { success: true, files: 42 }
4. Component calls refreshStats() to poll new stats
5. ✅ Usually works, BUT...
6. ⚠️ If user navigates away before poll completes → no update
7. ⚠️ If another component needs embedding stats → must also poll
```

**Better Approach:**

```javascript
// Backend emits event after rebuild:
webContents.send('embeddings-updated', {
  folders: folderCount,
  files: fileCount,
  chunks: chunkCount
});

// Frontend subscribes globally:
const embeddingsCleanup = window.electronAPI.events.onEmbeddingsUpdated((data) => {
  store.dispatch(updateEmbeddingStats(data));
});

// All components consume from Redux:
const embeddingStats = useAppSelector((state) => state.embeddings.stats);
```

---

## 9. Missing Data Bindings - Comprehensive List

### 9.1 High Priority

| Backend Data          | Frontend State             | Current Binding    | Issue                                             |
| --------------------- | -------------------------- | ------------------ | ------------------------------------------------- |
| Analysis results      | `analysisSlice.results`    | Pull (refetch)     | ❌ Results don't appear until refetch             |
| File operation status | `filesSlice.fileStates`    | None               | ❌ Operations complete but UI shows "in progress" |
| File paths after move | `filesSlice.selectedFiles` | Manual update      | ❌ Stale paths in selectedFiles after organize    |
| Embedding counts      | Local state                | Poll (5s interval) | ⚠️ Works but inefficient                          |
| Operation errors      | Toast notifications        | None               | ❌ Silent failures                                |

### 9.2 Medium Priority

| Backend Data                 | Frontend State           | Current Binding | Issue                                    |
| ---------------------------- | ------------------------ | --------------- | ---------------------------------------- |
| Settings changes (external)  | `uiSlice.settings`       | None            | ❌ External settings changes don't sync  |
| Watcher notifications        | Toast notifications      | None            | ❌ Download watcher events invisible     |
| Background analysis progress | `analysisSlice.progress` | Partial         | ⚠️ Updates progress but not results      |
| ChromaDB status changes      | Local state              | Component-level | ⚠️ Only works when modal open            |
| Search cache invalidation    | Search component state   | None            | ❌ Stale search results after file moves |

### 9.3 Low Priority (Nice to Have)

| Backend Data          | Frontend State   | Current Binding | Issue                                  |
| --------------------- | ---------------- | --------------- | -------------------------------------- |
| Menu actions          | Various          | None            | ⚠️ Tray menu clicks may not trigger UI |
| App updates available | Update indicator | None            | ⚠️ Update notifications may not show   |
| Startup errors        | Error boundary   | None            | ⚠️ Startup failures may be silent      |

---

## 10. Recommendations & Action Items

### 10.1 Critical Fixes (Immediate)

**1. Fix Analysis Results Display**

- **File:** `src/renderer/phases/discover/useAnalysis.js` (or equivalent)
- **Change:** Dispatch `analysisSuccess` immediately after IPC `analyze()` returns
- **Impact:** Users see analysis results instantly instead of after page reload

**2. Subscribe to Operation Complete/Error Events**

- **File:** `src/renderer/store/middleware/ipcMiddleware.js`
- **Change:** Add event handlers for:
  - `onOperationComplete`
  - `onOperationError`
  - `onFileOperationComplete`
- **Impact:** UI reflects actual operation status, errors are visible

**3. Update File Paths After Organize**

- **File:** `src/renderer/store/slices/filesSlice.js`
- **Change:** Add `updateFilePathsAfterMove` reducer
- **Change:** Subscribe to `onFileOperationComplete` in middleware
- **Impact:** No more stale file paths in selectedFiles/fileStates after moves

### 10.2 High Priority (This Sprint)

**4. Settings Propagation**

- **File:** `src/renderer/store/middleware/ipcMiddleware.js`
- **Change:** Subscribe to `onSettingsChanged` event
- **Change:** Dispatch `updateSettings` to sync Redux state
- **Impact:** Settings changes (especially Ollama host) immediately affect active operations

**5. Notification Event Bridge**

- **File:** `src/renderer/store/middleware/ipcMiddleware.js`
- **Change:** Subscribe to `onNotification` event
- **Change:** Route to toast system via Redux action or direct call
- **Impact:** Download watcher, auto-analysis notifications become visible

**6. Embedding Status Push Events**

- **File:** `src/main/services/ParallelEmbeddingService.js` (814 lines)
- **Change:** Emit `embeddings-updated` event after rebuild/add operations
- **File:** `src/renderer/store/middleware/ipcMiddleware.js`
- **Change:** Subscribe and update embedding stats in Redux
- **Impact:** No more polling, instant stats updates

### 10.3 Medium Priority (Next Sprint)

**7. Refactor Event Subscriptions**

- **Create:** `src/renderer/store/middleware/eventBridge.js`
- **Consolidate:** All IPC event subscriptions in one place
- **Document:** Which events update which Redux slices
- **Impact:** Easier to maintain, less risk of missing events

**8. Add Warning Feedback for Partial Failures**

- **File:** `src/main/ipc/settings.js` (and similar handlers)
- **Change:** Return `warnings` array for non-fatal errors
- **File:** Frontend IPC call sites
- **Change:** Display warnings via toast notifications
- **Impact:** Users know when operations partially failed (e.g., launchOnStartup permission denied)

**9. Background Analysis State Persistence**

- **File:** `src/renderer/store/index.js`
- **Change:** Don't reset `isAnalyzing` on app restart if analysis was recent (< 5 min)
- **Change:** Restore `analysisProgress` context
- **Impact:** App crashes during analysis → user knows where to resume

### 10.4 Low Priority (Future)

**10. Search Cache Invalidation**

- **File:** Search component (needs identification)
- **Change:** Subscribe to `onFileOperationComplete`
- **Change:** Clear cached results that include moved/deleted files
- **Impact:** Search results always reflect current file system state

**11. Startup Error Handling**

- **File:** `src/renderer/store/middleware/ipcMiddleware.js`
- **Change:** Subscribe to `onStartupError`
- **Change:** Display critical startup errors in modal (not just logs)
- **Impact:** Users see meaningful error messages instead of blank screen

**12. Menu Action Integration**

- **File:** `src/renderer/store/middleware/ipcMiddleware.js`
- **Change:** Subscribe to `onMenuAction`
- **Change:** Route to appropriate Redux actions
- **Impact:** Tray menu fully integrated with UI state

---

## 11. Testing Strategy

### 11.1 Integration Test Scenarios

**Scenario 1: Analysis Result Display**

```
GIVEN: User is in Discover phase with no analyzed files
WHEN: User drops a PDF file and it gets analyzed
THEN: Analysis result should appear in AnalysisResultsList within 2 seconds
  AND fileStates[path].state should be 'categorized'
  AND analysisSlice.results should contain the new result
```

**Scenario 2: File Path Synchronization**

```
GIVEN: User has analyzed files in selectedFiles array
  AND files have been organized (moved to new locations)
WHEN: User returns to Discover phase
THEN: selectedFiles should NOT show moved files
  AND organizedFiles should show correct new paths
  AND analysisResults should still be accessible via fileId (not path)
```

**Scenario 3: Settings Propagation**

```
GIVEN: User is analyzing files with Ollama host A
WHEN: User opens settings and changes Ollama host to B
  AND user closes settings
  AND user analyzes another file
THEN: New analysis should use Ollama host B
  AND no errors should occur from stale host configuration
```

**Scenario 4: Embedding Stats Update**

```
GIVEN: Embeddings stats show 0 file embeddings
WHEN: User clicks "Rebuild Files" in settings
  AND rebuild completes successfully with 42 files
THEN: Stats should update to show 42 file embeddings within 1 second
  AND user should see success notification
  AND no manual refresh should be required
```

### 11.2 Unit Test Coverage Gaps

**Current Coverage (estimated):**

- Redux slices: ~70% (good, but missing edge cases)
- IPC wrappers: ~80% (good)
- Components: ~40% (needs improvement)
- Event handlers: ~10% (critical gap)

**High Priority Tests Needed:**

```javascript
// Test: Analysis result dispatched after IPC call
test('analyzeFile dispatches analysisSuccess on completion', async () => {
  const mockAnalysis = { suggestedName: 'test.pdf', confidence: 0.9 };
  window.electronAPI.files.analyze.mockResolvedValue(mockAnalysis);

  const { result } = renderHook(() => useAnalysis());
  await act(() => result.current.analyzeFile(mockFile));

  expect(store.getState().analysis.results).toContainEqual(
    expect.objectContaining({ path: mockFile.path, analysis: mockAnalysis })
  );
});

// Test: File paths updated after move
test('updateFilePathsAfterMove updates all path references', () => {
  const initialState = {
    selectedFiles: [{ path: 'C:\\old\\file.pdf' }],
    fileStates: { 'C:\\old\\file.pdf': { state: 'categorized' } }
  };

  const action = updateFilePathsAfterMove({
    oldPaths: ['C:\\old\\file.pdf'],
    newPaths: ['C:\\new\\file.pdf']
  });

  const newState = filesReducer(initialState, action);

  expect(newState.selectedFiles[0].path).toBe('C:\\new\\file.pdf');
  expect(newState.fileStates['C:\\new\\file.pdf']).toBeDefined();
  expect(newState.fileStates['C:\\old\\file.pdf']).toBeUndefined();
});

// Test: Event subscriptions cleaned up
test('ipcMiddleware cleans up listeners on module disposal', () => {
  const unsubscribeSpy = jest.fn();
  window.electronAPI.events.onOperationProgress.mockReturnValue(unsubscribeSpy);

  const middleware = ipcMiddleware(store);
  cleanupIpcListeners();

  expect(unsubscribeSpy).toHaveBeenCalled();
});
```

---

## 12. Architecture Improvements

### 12.1 Event-Driven State Updates (Recommended Pattern)

**Current:** Pull-based (frontend fetches data on demand) **Proposed:** Push-based (backend pushes
updates to frontend)

**Benefits:**

- Immediate UI updates (no polling delay)
- Lower resource usage (no redundant IPC calls)
- Better offline resilience (events queued until connection restored)
- Simpler component logic (no manual refresh calls)

**Implementation Pattern:**

**Backend (Main Process):**

```javascript
// After any state-changing operation:
class FileOrganizer {
  async organizeFiles(operations) {
    const results = await this.performOperations(operations);

    // Emit event with complete state change
    webContents.send('files-organized', {
      operations: results.map((r) => ({
        oldPath: r.source,
        newPath: r.destination,
        status: r.success ? 'success' : 'error',
        error: r.error
      })),
      timestamp: Date.now()
    });

    return results;
  }
}
```

**Frontend (Renderer Process):**

```javascript
// Global event bridge (ipcMiddleware.js):
const fileOrgCleanup = window.electronAPI.events.onFilesOrganized((data) => {
  // Update state atomically
  store.dispatch(
    filesOrganized({
      operations: data.operations,
      timestamp: data.timestamp
    })
  );

  // Update dependent state
  store.dispatch(invalidateSearchCache(data.operations.map((o) => o.oldPath)));

  // User feedback
  const successCount = data.operations.filter((o) => o.status === 'success').length;
  store.dispatch(
    addToast({
      message: `Organized ${successCount} files`,
      severity: 'success'
    })
  );
});

// Components just consume from Redux:
function OrganizePhase() {
  const organizedFiles = useAppSelector((state) => state.files.organizedFiles);
  // No manual refresh needed - Redux updates trigger re-render
}
```

### 12.2 Unified Event Registry (Design Proposal)

**Create:** `src/shared/ipcEvents.js`

```javascript
/**
 * Centralized IPC event definitions
 * Maps event names to their payload schemas for type safety
 */
export const IPC_EVENTS = {
  // Analysis Events
  ANALYSIS_COMPLETE: {
    channel: 'analysis-complete',
    payload: { filePath: 'string', analysis: 'object', timestamp: 'number' }
  },
  ANALYSIS_FAILED: {
    channel: 'analysis-failed',
    payload: { filePath: 'string', error: 'string', timestamp: 'number' }
  },

  // File Operation Events
  FILES_ORGANIZED: {
    channel: 'files-organized',
    payload: { operations: 'array', timestamp: 'number' }
  },
  FILE_MOVED: {
    channel: 'file-moved',
    payload: { oldPath: 'string', newPath: 'string', timestamp: 'number' }
  },
  FILE_DELETED: {
    channel: 'file-deleted',
    payload: { path: 'string', timestamp: 'number' }
  },

  // Embedding Events
  EMBEDDINGS_UPDATED: {
    channel: 'embeddings-updated',
    payload: { folders: 'number', files: 'number', chunks: 'number' }
  },

  // Settings Events
  SETTINGS_CHANGED: {
    channel: 'settings-changed-external',
    payload: { settings: 'object', source: 'string' }
  },

  // System Events
  OPERATION_COMPLETE: {
    channel: 'operation-complete',
    payload: { operationType: 'string', affectedFiles: 'array', summary: 'object' }
  },
  OPERATION_ERROR: {
    channel: 'operation-error',
    payload: { operationType: 'string', error: 'string', context: 'object' }
  },

  // Watcher Events
  WATCHER_NOTIFICATION: {
    channel: 'notification',
    payload: { title: 'string', message: 'string', severity: 'string' }
  }
};

/**
 * Event emission helper (backend)
 */
export function emitEvent(webContents, event, payload) {
  const eventDef = IPC_EVENTS[event];
  if (!eventDef) {
    throw new Error(`Unknown event: ${event}`);
  }

  // Optional: Validate payload against schema
  validatePayload(payload, eventDef.payload);

  webContents.send(eventDef.channel, payload);
  logger.debug(`[IPC Event] ${event}`, { payload });
}

/**
 * Event subscription helper (frontend)
 */
export function subscribeToEvent(eventName, handler) {
  const eventDef = IPC_EVENTS[eventName];
  if (!eventDef) {
    throw new Error(`Unknown event: ${eventName}`);
  }

  const cleanup = window.electronAPI.events[getEventMethod(eventDef.channel)]((payload) => {
    // Optional: Validate payload
    handler(payload);
  });

  return cleanup;
}
```

**Benefits:**

- Type-safe event definitions (can generate TypeScript types)
- Centralized documentation of all events
- Prevents typos in event channel names
- Easy to see which events exist and what they carry
- Foundation for automated event testing

### 12.3 Redux State Normalization

**Current Issue:** File data duplicated across slices

- `filesSlice.selectedFiles` - array of file objects
- `analysisSlice.results` - array of file objects with analysis
- `filesSlice.organizedFiles` - array of file objects with destination info

**Problem:** When file path changes, must update in multiple places

**Proposed:** Normalized state with entity adapter

```javascript
// filesSlice.js
import { createEntityAdapter } from '@reduxjs/toolkit';

const filesAdapter = createEntityAdapter({
  selectId: (file) => file.id, // Use generated fileId, not path
  sortComparer: (a, b) => a.name.localeCompare(b.name)
});

const initialState = filesAdapter.getInitialState({
  // Normalized entities: { ids: [...], entities: { fileId: file } }
  selectedIds: [], // Just IDs, not full objects
  organizedIds: []
  // Other state...
});

const filesSlice = createSlice({
  name: 'files',
  initialState,
  reducers: {
    addFiles: filesAdapter.addMany,
    updateFile: filesAdapter.updateOne,
    updateFilePath(state, action) {
      // { fileId, newPath }
      filesAdapter.updateOne(state, {
        id: action.payload.fileId,
        changes: { path: action.payload.newPath }
      });
      // Single update propagates everywhere fileId is referenced
    },
    removeFiles: filesAdapter.removeMany
  }
});

// analysisSlice.js
const analysisAdapter = createEntityAdapter({
  selectId: (result) => result.fileId // Link to file by ID, not path
});

// Components
function AnalysisResultsList() {
  const selectedIds = useAppSelector((state) => state.files.selectedIds);
  const files = useAppSelector((state) => selectedIds.map((id) => state.files.entities[id]));
  const analysisResults = useAppSelector((state) =>
    selectedIds.map((id) => state.analysis.entities[id])
  );

  // Combine file + analysis by fileId
  const displayData = files.map((file) => ({
    ...file,
    analysis: analysisResults.find((r) => r.fileId === file.id)
  }));
}
```

**Benefits:**

- Path updates in ONE place (filesAdapter.updateOne)
- No duplicate file data
- Easy to add new relationships (fileId as foreign key)
- Better performance (O(1) lookups by ID)
- Less memory usage

---

## 13. Conclusion

### 13.1 Summary of Findings

**Strengths:**

- ✅ Well-structured Redux architecture with proper separation of concerns
- ✅ Secure IPC layer with validation, rate limiting, and sanitization
- ✅ Comprehensive error handling in IPC wrappers
- ✅ Good component composition and reusability
- ✅ Proper cleanup patterns for event listeners and timers
- ✅ Graceful degradation for quota limits and offline scenarios

**Critical Gaps:**

- ❌ Analysis results don't immediately appear in UI after backend completion
- ❌ File operations complete but UI shows stale "in progress" states
- ❌ Only 2 of 8+ backend events are subscribed globally
- ❌ Settings changes don't propagate to active operations
- ❌ File paths become stale after organize operations
- ❌ Errors during background operations are invisible to user

**Root Cause:** The application was designed with a **pull-based architecture** (frontend fetches
data) but **implements push-based operations** (backend emits events). This mismatch creates
integration gaps where:

1. Backend completes operation → emits event → **frontend isn't listening**
2. Backend updates state → frontend has stale copy → **no invalidation signal**
3. Backend encounters error → logs it → **no user notification**

### 13.2 Impact Assessment

**Without Fixes:**

- Users perceive app as "slow" or "buggy" (results don't appear)
- Users don't know when operations fail (silent errors)
- Users refresh page manually to see updates (poor UX)
- State inconsistencies lead to confusing UI states
- Repeated IPC calls for data that should be pushed (inefficient)

**With Fixes:**

- Immediate UI feedback for all backend operations
- Errors are visible and actionable
- No manual refreshes needed
- State always in sync between backend and frontend
- More efficient IPC usage (events vs polling)
- Foundation for real-time features (progress tracking, live updates)

### 13.3 Estimated Effort

| Priority               | # of Changes | Effort (Dev Days) | Risk                                 |
| ---------------------- | ------------ | ----------------- | ------------------------------------ |
| **Critical** (3 fixes) | ~150 LOC     | 2-3 days          | Low (localized changes)              |
| **High** (3 fixes)     | ~300 LOC     | 3-4 days          | Medium (affects multiple components) |
| **Medium** (3 fixes)   | ~200 LOC     | 2-3 days          | Low (refactoring, new code)          |
| **Low** (3 fixes)      | ~150 LOC     | 1-2 days          | Low (nice-to-have features)          |
| **Total**              | ~800 LOC     | **8-12 days**     | -                                    |

### 13.4 Next Steps

**Phase 1: Emergency Fixes (Week 1)**

1. Fix analysis results display (dispatch on IPC return)
2. Subscribe to operation complete/error events
3. Update file paths after organize operations

**Phase 2: Event Bridge (Week 2)** 4. Complete IPC event subscriptions in middleware 5. Add
notification event routing 6. Implement embedding status push events

**Phase 3: Architecture (Week 3)** 7. Refactor to unified event registry 8. Add warning feedback for
partial failures 9. Implement normalized state for files

**Phase 4: Testing & Monitoring (Week 4)** 10. Add integration tests for event flows 11. Add unit
tests for event handlers 12. Monitor for event emission coverage (are all events being subscribed?)

### 13.5 Long-Term Vision

**Goal:** Full event-driven architecture where frontend is always in sync with backend

**Characteristics:**

- All state-changing operations emit events
- Frontend subscribes to all events in centralized middleware
- Components are **pure consumers** of Redux state (no IPC calls)
- IPC calls only for **commands** (user actions), not **queries** (data fetching)
- Real-time collaboration-ready (multiple windows stay in sync via events)

**This transforms the app from:**

```
[Frontend] → Poll backend → Update UI
```

**To:**

```
[Frontend] → Command → [Backend] → Event → [Frontend] → UI updates instantly
```

---

## Appendix A: File Reference

**Key Files Analyzed:**

**Frontend:**

- `src/renderer/store/index.js` (194 lines) - Store configuration
- `src/renderer/store/slices/analysisSlice.js` (105 lines) - Analysis state
- `src/renderer/store/middleware/ipcMiddleware.js` (71 lines) - Event bridge (INCOMPLETE)
- `src/renderer/store/middleware/persistenceMiddleware.js` (276 lines) - State persistence
- `src/renderer/components/Modal.jsx` (388 lines) - Modal system
- `src/renderer/components/AiDependenciesModal.jsx` (810 lines) - Dependencies management
- `src/renderer/components/AnalysisDetails.jsx` (166 lines) - Analysis display
- `src/renderer/components/settings/EmbeddingRebuildSection.jsx` (382 lines) - Embeddings UI
- `src/renderer/components/settings/ApplicationSection.jsx` (71 lines) - App settings
- `src/renderer/phases/DiscoverPhase.jsx` (~500+ lines) - Main analysis phase

**Backend:**

- `src/preload/preload.js` (990 lines) - Secure IPC bridge
- `src/main/ipc/ipcWrappers.js` (555 lines) - IPC handler wrappers
- `src/main/ipc/settings.js` (736 lines) - Settings handlers
- `src/main/ipc/files/batchOrganizeHandler.js` (724 lines) - File organization
- `src/main/services/ParallelEmbeddingService.js` (814 lines) - Embeddings backend

**Shared:**

- `src/shared/constants.js` - Phase definitions, file states
- `src/shared/logger.js` - Logging system
- `src/shared/securityConfig.js` - Security configuration
- `src/shared/performanceConstants.js` - Timeouts, limits

---

## Appendix B: IPC Channel Map

**Available Channels (from IPC_CHANNELS):**

**FILES:**

- SELECT, SELECT_DIRECTORY, GET_DOCUMENTS_PATH, CREATE_FOLDER_DIRECT
- OPEN_FILE, REVEAL_FILE, COPY_FILE, DELETE_FILE, DELETE_FOLDER
- OPEN_FOLDER, GET_FILE_STATS, GET_FILES_IN_DIRECTORY
- PERFORM_OPERATION (batch organize, move, copy)

**ANALYSIS:**

- ANALYZE_DOCUMENT, ANALYZE_IMAGE, EXTRACT_IMAGE_TEXT

**ANALYSIS_HISTORY:**

- GET, SEARCH, GET_STATISTICS, GET_FILE_HISTORY, CLEAR, EXPORT

**EMBEDDINGS:**

- REBUILD_FOLDERS, REBUILD_FILES, FULL_REBUILD, REANALYZE_ALL
- CLEAR_STORE, GET_STATS, SEARCH, SCORE_FILES, FIND_SIMILAR
- REBUILD_BM25_INDEX, GET_SEARCH_STATUS, FIND_MULTI_HOP
- COMPUTE_CLUSTERS, GET_CLUSTERS, GET_CLUSTER_MEMBERS
- GET_SIMILARITY_EDGES, GET_FILE_METADATA, FIND_DUPLICATES

**SETTINGS:**

- GET, SAVE, GET_CONFIGURABLE_LIMITS, GET_LOGS_INFO, OPEN_LOGS_FOLDER
- EXPORT, IMPORT, CREATE_BACKUP, LIST_BACKUPS, RESTORE_BACKUP, DELETE_BACKUP

**SMART_FOLDERS:**

- GET, SAVE, UPDATE_CUSTOM, GET_CUSTOM, SCAN_STRUCTURE
- ADD, EDIT, DELETE, MATCH, RESET_TO_DEFAULTS, GENERATE_DESCRIPTION
- WATCHER_START, WATCHER_STOP, WATCHER_STATUS, WATCHER_SCAN

**OLLAMA:**

- GET_MODELS, TEST_CONNECTION, PULL_MODELS, DELETE_MODEL

**CHROMADB:**

- GET_STATUS, GET_CIRCUIT_STATS, GET_QUEUE_STATS, FORCE_RECOVERY
- HEALTH_CHECK, STATUS_CHANGED (event)

**DEPENDENCIES:**

- GET_STATUS, INSTALL_OLLAMA, INSTALL_CHROMADB, UPDATE_OLLAMA, UPDATE_CHROMADB
- SERVICE_STATUS_CHANGED (event)

**SYSTEM:**

- GET_METRICS, GET_APPLICATION_STATISTICS, APPLY_UPDATE, GET_CONFIG, GET_CONFIG_VALUE

**UNDO_REDO:**

- UNDO, REDO, GET_HISTORY, CLEAR_HISTORY, CAN_UNDO, CAN_REDO, STATE_CHANGED (event)

**SUGGESTIONS:**

- GET_FILE_SUGGESTIONS, GET_BATCH_SUGGESTIONS, RECORD_FEEDBACK
- GET_STRATEGIES, APPLY_STRATEGY, GET_USER_PATTERNS, CLEAR_PATTERNS
- ANALYZE_FOLDER_STRUCTURE, SUGGEST_NEW_FOLDER

**ORGANIZE:**

- AUTO, BATCH, PROCESS_NEW, GET_STATS, UPDATE_THRESHOLDS
- CLUSTER_BATCH, IDENTIFY_OUTLIERS, GET_CLUSTER_SUGGESTIONS

---

**End of Analysis Report**

This document provides a comprehensive assessment of the frontend display system and its integration
with the backend. The identified issues are addressable with focused engineering effort, and the
proposed fixes will significantly improve user experience and system reliability.

For questions or clarifications, refer to specific file locations and line numbers provided
throughout this analysis.
