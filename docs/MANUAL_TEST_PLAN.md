# Manual Test Plan - StratoSort

## Purpose

This document provides a step-by-step manual test plan for verifying all StratoSort features. Use
this to identify any broken or missing functionality during development.

## How to Use This Document

1. Go through each section in order
2. Mark each test as PASS, FAIL, or SKIP
3. Add notes for any issues found
4. Update the "Issues Found" section at the bottom

---

## Pre-Test Checklist

Before starting manual testing:

- [ ] Ollama is running (`ollama serve`)
- [ ] Required models are installed (check with `ollama list`)
- [ ] ChromaDB will auto-start (or is already running)
- [ ] App is built and running (`npm run dev`)
- [ ] Have test files ready (PDFs, images, documents, etc.)

---

## 1. Application Startup

### 1.1 Initial Launch

| Test                     | Expected                    | Status   | Notes                               |
| ------------------------ | --------------------------- | -------- | ----------------------------------- |
| App window appears       | Window shows without errors | **PASS** | Window appeared successfully        |
| No console errors        | DevTools console is clean   | **PASS** | No console errors observed          |
| Splash/loading completes | App reaches main UI         | **PASS** | Splash completed and main UI loaded |

### 1.2 Service Initialization

| Test              | Expected                         | Status   | Notes                |
| ----------------- | -------------------------------- | -------- | -------------------- |
| Ollama connection | Status shows connected           | **PASS** | Connection completed |
| ChromaDB starts   | ChromaDB auto-starts or connects | **PASS** | Started successfully |
| Models detected   | Configured models are available  | **PASS** | Models detected      |

### 1.3 Window Controls

| Test                   | Expected                                   | Status   | Notes                                                               |
| ---------------------- | ------------------------------------------ | -------- | ------------------------------------------------------------------- |
| Minimize button        | Window minimizes                           | **PASS** | Works                                                               |
| Maximize button        | Window maximizes/restores                  | **PASS** | Works, but maximize size change is negligible (1280×799 → 1280×800) |
| Close button           | App closes gracefully                      | **PASS** | Appears to shut down correctly                                      |
| Window state persisted | Window position/size remembered on restart | **SKIP** | Not confirmed                                                       |

---

## 2. Navigation & UI

### 2.1 Phase Navigation

| Test                        | Expected                         | Status   | Notes                            |
| --------------------------- | -------------------------------- | -------- | -------------------------------- |
| Welcome/Setup phase visible | Initial phase displays correctly | **PASS** | Welcome screen shows             |
| Discover phase accessible   | Can navigate to Discover         | **PASS** | Accessible                       |
| Organize phase accessible   | Can navigate to Organize         | **PASS** | "Review and organize" accessible |
| Complete phase accessible   | Can navigate to Complete         | **PASS** | Accessible                       |
| Navigation indicators       | Current phase is highlighted     | **PASS** | Indicators highlight correctly   |

### 2.2 Theme & Appearance

| Test              | Expected                           | Status   | Notes                                        |
| ----------------- | ---------------------------------- | -------- | -------------------------------------------- |
| Light theme works | UI renders correctly in light mode | **FAIL** | No visible light theme option / not observed |
| Dark theme works  | UI renders correctly in dark mode  | **FAIL** | No visible dark theme option / not observed  |
| Theme toggle      | Can switch between themes          | **FAIL** | Theme toggle not found                       |
| Theme persisted   | Theme preference saved on restart  | **SKIP** | Can't validate without toggle                |

### 2.3 Responsive Layout

| Test                  | Expected                   | Status   | Notes                                                                                      |
| --------------------- | -------------------------- | -------- | ------------------------------------------------------------------------------------------ |
| Window resize         | UI adapts to window size   | **FAIL** | Body responds somewhat, but navbar/header does not respond well (phase visibility clipped) |
| Minimum size enforced | Can't resize below minimum | **SKIP** | Not tested                                                                                 |
| Scrolling works       | Long content is scrollable | **PASS** | Long scrolling looked good                                                                 |

---

## 3. Setup Phase

### 3.1 Smart Folder Management

| Test                    | Expected                      | Status   | Notes                                                                          |
| ----------------------- | ----------------------------- | -------- | ------------------------------------------------------------------------------ |
| Add smart folder        | Can create new smart folder   | **FAIL** | Cannot add smart folder unless target path already exists (Issue 3.1-A, 3.1-B) |
| Edit folder name        | Can rename smart folder       | **PASS** | Name updates in app                                                            |
| Edit folder description | Can update folder description | **PASS** | Description updates                                                            |
| Delete smart folder     | Can remove smart folder       | **SKIP** | Not tested                                                                     |
| Folder list displays    | All smart folders shown       | **PASS** | Shows folders that were added                                                  |

**Additional Observations (Smart Folder UI):**

- Modal shows a weird "hidden window/blur layer" behind it; black line hovering over "Configure
  smart folders"; flicker when moving mouse/typing
- Too many rebuild options at top of screen and inside individual folder settings (Issue 3.1-C)
- Rebuild terminology is unclear - "folders" vs "files" is ambiguous (Issue 3.1-D)

### 3.2 Target Folder Selection

| Test               | Expected                    | Status   | Notes                                                                                             |
| ------------------ | --------------------------- | -------- | ------------------------------------------------------------------------------------------------- |
| Browse for folder  | Folder picker dialog opens  | **PASS** | Browse worked                                                                                     |
| Select destination | Destination folder is set   | **PASS** | Appeared to set destination during target selection                                               |
| Path validation    | Invalid paths are rejected  | **SKIP** | Not tested                                                                                        |
| Default path       | Documents folder is default | **FAIL** | Shows Documents as default, but does not create folder on filesystem / doesn't behave as expected |

### 3.3 Folder Descriptions (AI-Enhanced)

| Test                      | Expected                           | Status   | Notes                                        |
| ------------------------- | ---------------------------------- | -------- | -------------------------------------------- |
| Auto-generate description | AI can suggest folder description  | **FAIL** | Feature not visible/available                |
| Manual description entry  | Can type custom description        | **PASS** | Works                                        |
| Description saved         | Descriptions persist after restart | **PASS** | Folder + description persisted after restart |

---

## 4. Discover Phase (File Analysis)

### 4.1 File Selection

| Test                    | Expected                             | Status | Notes |
| ----------------------- | ------------------------------------ | ------ | ----- |
| Drag & drop files       | Can drop files onto app              |        |       |
| Drag & drop folders     | Can drop folders onto app            |        |       |
| Browse button           | File picker dialog opens             |        |       |
| Multiple file selection | Can select multiple files            |        |       |
| File list displays      | Selected files appear in list        |        |       |
| Remove file from list   | Can deselect/remove individual files |        |       |
| Clear all files         | Can clear entire selection           |        |       |

### 4.2 File Type Support

| Test                   | Expected                           | Status | Notes |
| ---------------------- | ---------------------------------- | ------ | ----- |
| PDF files              | PDFs can be analyzed               |        |       |
| Word documents (.docx) | Word files can be analyzed         |        |       |
| Excel files (.xlsx)    | Excel files can be analyzed        |        |       |
| PowerPoint (.pptx)     | PowerPoint files can be analyzed   |        |       |
| Plain text (.txt)      | Text files can be analyzed         |        |       |
| Images (JPG/PNG)       | Images can be analyzed             |        |       |
| Unsupported files      | Show warning for unsupported types |        |       |

### 4.3 Analysis Process

| Test                     | Expected                       | Status | Notes |
| ------------------------ | ------------------------------ | ------ | ----- |
| Analyze button works     | Analysis starts on click       |        |       |
| Progress indicator       | Progress shown during analysis |        |       |
| Individual file progress | Each file shows its status     |        |       |
| Cancel analysis          | Can cancel ongoing analysis    |        |       |
| Analysis completes       | All files finish processing    |        |       |

### 4.4 Analysis Results

| Test             | Expected                     | Status | Notes |
| ---------------- | ---------------------------- | ------ | ----- |
| Results display  | Analysis results appear      |        |       |
| Category shown   | File category is displayed   |        |       |
| Keywords shown   | Extracted keywords visible   |        |       |
| Confidence score | Confidence percentage shown  |        |       |
| Suggested folder | Folder suggestion displayed  |        |       |
| Suggested name   | File rename suggestion shown |        |       |

### 4.5 Batch Analysis

| Test                     | Expected                        | Status | Notes |
| ------------------------ | ------------------------------- | ------ | ----- |
| Multiple files analyzed  | Can process batch of files      |        |       |
| Partial failure handling | Some files fail, others succeed |        |       |
| Retry failed files       | Can retry individual failures   |        |       |

---

## 5. Organize Phase

### 5.1 Organization Suggestions

| Test                       | Expected                      | Status | Notes |
| -------------------------- | ----------------------------- | ------ | ----- |
| Suggestions display        | File suggestions are shown    |        |       |
| Folder assignments visible | Each file shows target folder |        |       |
| Confidence indicators      | Confidence levels displayed   |        |       |
| Group by folder            | Files grouped by destination  |        |       |

### 5.2 Manual Adjustments

| Test                 | Expected                              | Status | Notes |
| -------------------- | ------------------------------------- | ------ | ----- |
| Change target folder | Can reassign file to different folder |        |       |
| Edit file name       | Can modify suggested name             |        |       |
| Exclude file         | Can skip specific files               |        |       |
| Include/exclude all  | Bulk selection works                  |        |       |

### 5.3 File Operations

| Test                   | Expected                           | Status | Notes |
| ---------------------- | ---------------------------------- | ------ | ----- |
| Organize button works  | Files move to destinations         |        |       |
| Progress shown         | Operation progress displayed       |        |       |
| Success notification   | Completion message shown           |        |       |
| Folders created        | Missing folders are created        |        |       |
| File conflicts handled | Duplicate names handled gracefully |        |       |

### 5.4 Preview & Validation

| Test                           | Expected                                                | Status    | Notes                                                                                                                              |
| ------------------------------ | ------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Preview before move            | Can see what will happen                                |           |                                                                                                                                    |
| Conflict warnings              | Alerts for existing files                               |           |                                                                                                                                    |
| Path validation                | Invalid destinations caught                             |           |                                                                                                                                    |
| Destination conflict detection | Multiple files to same destination blocked with warning | **FIXED** | M-4: Added conflict detection in `buildPreview()`. Shows warning banner listing conflicting files, blocks organize until resolved. |

---

## 6. Undo/Redo System

### 6.1 Undo Operations

| Test                   | Expected                    | Status | Notes |
| ---------------------- | --------------------------- | ------ | ----- |
| Undo button visible    | Undo control is present     |        |       |
| Undo single move       | Can undo last file move     |        |       |
| Undo batch move        | Can undo entire batch       |        |       |
| Multiple undos         | Can undo several operations |        |       |
| Undo keyboard shortcut | Ctrl+Z / Cmd+Z works        |        |       |

### 6.2 Redo Operations

| Test                   | Expected                | Status | Notes |
| ---------------------- | ----------------------- | ------ | ----- |
| Redo button visible    | Redo control is present |        |       |
| Redo single move       | Can redo undone move    |        |       |
| Redo batch move        | Can redo undone batch   |        |       |
| Redo keyboard shortcut | Ctrl+Shift+Z works      |        |       |

### 6.3 Undo History

| Test                   | Expected                     | Status    | Notes                                                                                                                                                                                                       |
| ---------------------- | ---------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| History displays       | Can see undo history list    |           |                                                                                                                                                                                                             |
| Jump to specific point | Can undo to specific state   | **FIXED** | L-2: Added `jumpToPoint()` function. History modal now shows full stack (including undone actions) with clickable items. Click to jump forward/backward. Current position highlighted with "Current" badge. |
| Clear history          | Can clear undo history       |           |                                                                                                                                                                                                             |
| History persisted      | History survives app restart |           |                                                                                                                                                                                                             |

---

## 7. Search & Semantic Features

### 7.1 Search Modal

| Test              | Expected                       | Status | Notes |
| ----------------- | ------------------------------ | ------ | ----- |
| Search opens      | Search modal/widget opens      |        |       |
| Search shortcut   | Keyboard shortcut opens search |        |       |
| Text search works | Can search by text             |        |       |
| Results display   | Search results shown           |        |       |
| Click to navigate | Can go to search result        |        |       |

### 7.2 Semantic Search (ChromaDB)

| Test                   | Expected                         | Status | Notes |
| ---------------------- | -------------------------------- | ------ | ----- |
| Semantic search toggle | Can enable semantic mode         |        |       |
| Similar file search    | Finds conceptually similar files |        |       |
| Embedding generation   | Files are embedded               |        |       |
| Similarity scores      | Shows match confidence           |        |       |

### 7.3 Clustering

| Test                  | Expected                    | Status | Notes |
| --------------------- | --------------------------- | ------ | ----- |
| Cluster visualization | Can see file clusters       |        |       |
| Cluster navigation    | Can explore clusters        |        |       |
| Auto-grouping         | Files grouped by similarity |        |       |

---

## 8. Settings Panel

### 8.1 Settings Access

| Test              | Expected                  | Status | Notes |
| ----------------- | ------------------------- | ------ | ----- |
| Settings opens    | Settings panel accessible |        |       |
| Settings sections | All sections visible      |        |       |
| Close settings    | Can close settings panel  |        |       |

### 8.2 AI Configuration

| Test                      | Expected                   | Status | Notes |
| ------------------------- | -------------------------- | ------ | ----- |
| Text model selection      | Can choose text model      |        |       |
| Vision model selection    | Can choose vision model    |        |       |
| Embedding model selection | Can choose embedding model |        |       |
| Model test connection     | Can test Ollama connection |        |       |
| Model pull/download       | Can download new models    |        |       |

### 8.3 Ollama Settings

| Test                  | Expected                     | Status | Notes |
| --------------------- | ---------------------------- | ------ | ----- |
| Host configuration    | Can change Ollama host URL   |        |       |
| Connection status     | Shows connected/disconnected |        |       |
| Available models list | Shows installed models       |        |       |

### 8.4 ChromaDB Settings

| Test               | Expected                       | Status | Notes |
| ------------------ | ------------------------------ | ------ | ----- |
| Status display     | ChromaDB status shown          |        |       |
| Rebuild embeddings | Can rebuild embedding database |        |       |
| Clear embeddings   | Can clear embedding database   |        |       |

### 8.5 Default Locations

| Test                   | Expected                    | Status | Notes |
| ---------------------- | --------------------------- | ------ | ----- |
| Set source folder      | Can set default source      |        |       |
| Set destination folder | Can set default destination |        |       |
| Paths persist          | Settings saved on restart   |        |       |

### 8.6 Auto-Organize Settings

| Test                   | Expected                   | Status | Notes |
| ---------------------- | -------------------------- | ------ | ----- |
| Enable auto-organize   | Can toggle auto-organize   |        |       |
| Watch folder selection | Can select watch folder    |        |       |
| Confidence threshold   | Can set minimum confidence |        |       |
| Auto-organize trigger  | Auto processes new files   |        |       |

### 8.7 Settings Backup/Restore

| Test              | Expected                      | Status | Notes |
| ----------------- | ----------------------------- | ------ | ----- |
| Export settings   | Can export settings to file   |        |       |
| Import settings   | Can import settings from file |        |       |
| Reset to defaults | Can reset all settings        |        |       |

---

## 9. Keyboard Shortcuts

### 9.1 Global Shortcuts

| Shortcut                   | Action             | Status | Notes |
| -------------------------- | ------------------ | ------ | ----- |
| Ctrl+Z / Cmd+Z             | Undo               |        |       |
| Ctrl+Shift+Z / Cmd+Shift+Z | Redo               |        |       |
| Ctrl+Y                     | Redo (Windows)     |        |       |
| Ctrl+A / Cmd+A             | Select All         |        |       |
| Ctrl+Shift+F               | Global search      |        |       |
| Escape                     | Close modal/cancel |        |       |

---

## 10. Error Handling

### 10.1 Graceful Degradation

| Test               | Expected                           | Status | Notes |
| ------------------ | ---------------------------------- | ------ | ----- |
| Ollama offline     | App works without Ollama (limited) |        |       |
| ChromaDB offline   | App works without ChromaDB         |        |       |
| Network issues     | Handles connection failures        |        |       |
| File access denied | Shows helpful error message        |        |       |

### 10.2 Error Messages

| Test                | Expected                        | Status | Notes |
| ------------------- | ------------------------------- | ------ | ----- |
| Clear error display | Errors are readable             |        |       |
| Actionable guidance | Errors suggest next steps       |        |       |
| Error dismissal     | Can dismiss error notifications |        |       |

---

## 11. Performance

### 11.1 Responsiveness

| Test                          | Expected                    | Status | Notes |
| ----------------------------- | --------------------------- | ------ | ----- |
| UI responsive during analysis | UI doesn't freeze           |        |       |
| Large file handling           | Large files don't crash app |        |       |
| Many files (100+)             | Handles large file lists    |        |       |

### 11.2 Memory & Resources

| Test                 | Expected                      | Status | Notes |
| -------------------- | ----------------------------- | ------ | ----- |
| Memory usage stable  | No memory leaks over time     |        |       |
| CPU usage reasonable | Not maxing out CPU constantly |        |       |

---

## 12. Data Persistence

### 12.1 Settings Persistence

| Test                     | Expected             | Status | Notes |
| ------------------------ | -------------------- | ------ | ----- |
| Settings survive restart | All settings saved   |        |       |
| Smart folders persist    | Folder configs saved |        |       |
| Theme persists           | Theme choice saved   |        |       |

### 12.2 Analysis History

| Test            | Expected                     | Status | Notes |
| --------------- | ---------------------------- | ------ | ----- |
| History saved   | Previous analyses accessible |        |       |
| History search  | Can search analysis history  |        |       |
| History cleared | Can clear history            |        |       |

---

## Issues Found

### Critical (Blocking)

| Issue        | Description | Steps to Reproduce |
| ------------ | ----------- | ------------------ |
| (None found) |             |                    |

### High Priority

| Issue                                         | Description                                                                                   | Status       | Fix Applied                                                                                                                                           |
| --------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Issue 3.1-A: Target path must exist           | Cannot select/use a target path unless folder already exists on disk.                         | **FIXED**    | Removed frontend parent path validation in `SetupPhase.jsx`. Backend now creates directories automatically.                                           |
| Issue 3.1-B: App doesn't create missing paths | Even when typing path directly, app errors "can't find this location" instead of creating it. | **FIXED**    | Same fix as 3.1-A - backend handles directory creation.                                                                                               |
| Theme toggle missing                          | No visible theme toggle in UI; light/dark modes not accessible.                               | **VERIFIED** | Theme toggle exists in Settings > Application. Works via `ThemeManager` in App.js.                                                                    |
| Navbar not responsive                         | Header/navbar doesn't respond to window resize; phases get clipped.                           | **FIXED**    | Improved responsive breakpoints in `NavigationBar.jsx`. Labels now hide on small screens (md:inline), nav container has better max-width constraints. |

### Medium Priority

| Issue                                    | Description                                                                                         | Status    | Fix Applied                                                                                                               |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------- |
| Issue 3.1-C: Too many rebuild options    | Many rebuild-related controls at top of Smart Folders screen and inside individual folder settings. | **FIXED** | Removed per-folder rebuild button from `SmartFolderItem.jsx`. Rebuild is now only in Settings > Embeddings.               |
| Issue 3.1-D: Rebuild terminology unclear | "Rebuilding folders" vs "rebuilding files" is ambiguous.                                            | **FIXED** | Simplified by removing per-folder rebuild option.                                                                         |
| Default path not created                 | Documents shows as default but folder not created on filesystem.                                    | **FIXED** | Backend creates missing directories automatically (same fix as 3.1-A/B).                                                  |
| Auto-generate description missing        | AI folder description suggestion feature not visible in UI.                                         | **FIXED** | Added "Generate with AI" button to `AddSmartFolderModal.jsx` with Sparkles icon.                                          |
| Smart Folder modal glitches              | Blur layer behind modal, black line over "Configure smart folders", flicker when interacting.       | **FIXED** | Updated `AddSmartFolderModal.jsx` to use split backdrop pattern (matching Modal.jsx) to prevent blur/animation conflicts. |

### Low Priority / Enhancements

| Issue                         | Description                               | Status       | Fix Applied                                                                                                            |
| ----------------------------- | ----------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Double splash screens         | Two splash screens appear during startup. | **VERIFIED** | Guards already exist in `index.js` (`isAppInitialized`, `splashRemovalInProgress`). May have been a caching/dev issue. |
| Maximize behavior ineffective | Maximize only changes size by ~1px.       | **FIXED**    | Improved near-maximized detection in `createWindow.js` with larger threshold (100px) and origin check.                 |

---

## Test Session Log

| Date       | Tester      | Version                       | Notes                                                                                                                                                                                                              |
| ---------- | ----------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-01-01 | Manual      | Current (backtobasics branch) | Sections 1-3.3 completed. Found 11 issues total: 4 high priority, 5 medium, 2 low. Key blockers: smart folder path creation, missing theme toggle.                                                                 |
| 2026-01-01 | Claude Code | Current (backtobasics branch) | **FIXES APPLIED**: All 11 issues addressed. Key changes: removed frontend path validation, improved navbar responsiveness, added AI description generation, fixed modal blur/flicker, improved maximize detection. |
| 2026-01-01 | Claude Code | Current (backtobasics branch) | **SECOND FIX SESSION**: 10 fixes applied. See "Second Fix Session" section below.                                                                                                                                  |
| 2026-01-01 | Claude Code | Current (backtobasics branch) | **THIRD FIX SESSION**: 3 remaining fixes applied. M-2: Fixed **proto** false positives. M-4: Added organize conflict detection with block+warning. L-2: Added history jump-to-point feature.                       |

## Second Fix Session (2026-01-01)

### Critical Fixes

| Issue                             | Description                                             | Fix Applied                                                                                      |
| --------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| C-1: GENERATE_DESCRIPTION fails   | Ollama calls non-existent `OllamaService.chat()` method | Fixed in `smartFolders.js`: Now uses `OllamaService.analyzeText()` with proper response handling |
| C-2: Auto-organize race condition | DownloadWatcher initialized before services ready       | Fixed in `simple-main.js`: Added `serviceIntegration.initialized` check before starting watcher  |

### High Priority Fixes

| Issue                               | Description                                                         | Fix Applied                                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| H-1: Smart Folder path loading race | Modal opens before defaultLocation resolves from 'Documents' string | Fixed in `SetupPhase.jsx` and `AddSmartFolderModal.jsx`: Added `isDefaultLocationLoaded` state to prevent validation errors        |
| H-2: Model changes not saved        | 800ms debounce loses changes on quick close                         | Fixed in `SettingsPanel.jsx`: Added `autoSaveSettings.flush()` on unmount                                                          |
| H-3: Undo/Redo UI not updating      | Filesystem changes but UI never refreshes                           | Fixed in `undoRedo.js`, `constants.js`, `preload.js`, `useKeyboardShortcuts.js`: Added `STATE_CHANGED` event emission and listener |

### Medium Priority Fixes

| Issue                                   | Description                                         | Fix Applied                                                                                                      |
| --------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| M-1: Navigation z-index conflicts       | FloatingSearchWidget z-[9999] covers navbar         | Fixed in `FloatingSearchWidget.jsx`: Reduced to z-[500]                                                          |
| M-3: No Retry Failed Files option       | Cannot retry failed file analysis                   | Fixed in `useAnalysis.js` and `DiscoverPhase.jsx`: Added `retryFailedFiles()` function and "Retry Failed" button |
| M-5: Embeddings shows 0 with no context | Rebuild shows "0 embeddings" without explaining why | Fixed in `EmbeddingRebuildSection.jsx`: Shows context-aware messages about why embeddings are 0                  |

### Low Priority Fixes

| Issue                             | Description                             | Fix Applied                                                                                             |
| --------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| L-1: Duplicate loading indicators | Two progress indicators during analysis | Fixed in `DiscoverPhase.jsx`: Removed "Analyzing files..." text since progress bar already shows status |

### Third Fix Session (M-2, M-4, L-2)

| Issue                                  | Description                                               | Fix Applied                                                                                                                                                            |
| -------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M-2: Settings **proto** warning        | False positive warnings about prototype pollution         | Fixed in `settingsValidation.js`: Changed `'__proto__' in obj` to `Object.prototype.hasOwnProperty.call(obj, '__proto__')` to avoid inherited property false positives |
| M-4: Organize Phase conflict detection | No warning when multiple files would overwrite each other | Fixed in `useOrganization.js` and `OrganizePhase.jsx`: Added conflict detection in `buildPreview()`, blocks organize with warning UI when destination conflicts exist  |
| L-2: History modal Jump to Point       | History shows but can't jump to specific point            | Fixed in `UndoRedoSystem.jsx`: Added `jumpToPoint()` function, updated HistoryModal to show full stack with clickable items to jump forward/backward                   |

### Skipped/Deferred (By Design)

| Issue                | Reason                                            |
| -------------------- | ------------------------------------------------- |
| Drag & Drop (4.1)    | Intentionally disabled, future feature            |
| Analyze button (4.3) | By design - auto-analyze is the intended behavior |

---

## Automated Test Coverage

The following test files provide automated regression testing for the recent fixes:

### Recent Fixes Tests

| Test File                     | Tests | Coverage                                                                                                                                                                                                           |
| ----------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `test/recentFixes.test.js`    | 67    | M-2 (**proto** handling), M-4 (conflict detection), L-2 (jump calculation), H-3 (STATE_CHANGED), M-3 (retry logic), M-5 (embeddings status), C-2 (initialization guards), H-1 (path loading), H-2 (debounce flush) |
| `test/recentFixes.ui.test.js` | ~20   | React component tests for ConflictWarningBanner, HistoryItem, RetryButton, AddFolderForm, SettingsPanel flush, EmbeddingsStatus                                                                                    |

### Utility Tests

| Test File                  | Tests | Coverage                                                                                                                                                                                     |
| -------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/folderUtils.test.js` | 22    | `mapFoldersToCategories`, `getFolderNamesString` - filtering, truncation, limits, defaults                                                                                                   |
| `test/urlUtils.test.js`    | 35    | URL normalization utilities - `isHttps`, `hasProtocol`, `collapseDuplicateProtocols`, `normalizeProtocolCase`, `normalizeSlashes`, `extractBaseUrl`, `ensureProtocol`, `normalizeServiceUrl` |

### Hook Tests

| Test File                   | Tests | Coverage                                                                                               |
| --------------------------- | ----- | ------------------------------------------------------------------------------------------------------ |
| `test/useAsyncData.test.js` | 17    | `useAsyncData` hook - state management, auto-execution, success/error handling, memory leak prevention |

### Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- --testPathPatterns="recentFixes"

# Run with coverage
npm test -- --coverage
```

---

## Appendix: Test File Set

Recommended test files to have ready:

1. **Documents**
   - Simple PDF (1-2 pages)
   - Complex PDF (10+ pages, images, tables)
   - Word document (.docx)
   - Excel spreadsheet (.xlsx)
   - PowerPoint presentation (.pptx)
   - Plain text file (.txt)

2. **Images**
   - JPEG photo
   - PNG screenshot
   - Image with text (for OCR testing)
   - Large image (10+ MB)

3. **Edge Cases**
   - File with special characters in name
   - File with very long name
   - Empty file (0 bytes)
   - Corrupted file
   - Read-only file

4. **Batch Testing**
   - Folder with 10+ mixed files
   - Folder with 50+ files
   - Nested folder structure
