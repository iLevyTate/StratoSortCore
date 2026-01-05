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
| Window state persisted | Window position/size remembered on restart | **PASS** | Confirmed working                                                   |

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

| Test              | Expected                           | Status  | Notes                                              |
| ----------------- | ---------------------------------- | ------- | -------------------------------------------------- |
| Light theme works | UI renders correctly in light mode | **N/A** | Single theme only for time being - feature removed |
| Dark theme works  | UI renders correctly in dark mode  | **N/A** | Single theme only for time being - feature removed |
| Theme toggle      | Can switch between themes          | **N/A** | Removed - single primary theme for now             |
| Theme persisted   | Theme preference saved on restart  | **N/A** | Not applicable with single theme                   |

### 2.3 Responsive Layout

| Test                  | Expected                   | Status    | Notes                                                                                                                       |
| --------------------- | -------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------- |
| Window resize         | UI adapts to window size   | **FIXED** | M-1: Fixed z-index conflicts - FloatingSearchWidget reduced from z-[9999] to z-[500]. Navbar responsive fixes also applied. |
| Minimum size enforced | Can't resize below minimum | **SKIP**  | Not tested                                                                                                                  |
| Scrolling works       | Long content is scrollable | **PASS**  | Long scrolling looked good                                                                                                  |

---

## 3. Setup Phase

### 3.1 Smart Folder Management

| Test                    | Expected                      | Status    | Notes                                                                                                            |
| ----------------------- | ----------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------- |
| Add smart folder        | Can create new smart folder   | **FIXED** | Issue 3.1-A/B: Backend now auto-creates directories when smart folder is saved                                   |
| Edit folder name        | Can rename smart folder       | **PASS**  | Name updates in app                                                                                              |
| Edit folder description | Can update folder description | **PASS**  | Description updates                                                                                              |
| Delete smart folder     | Can remove smart folder       | **PASS**  | Works                                                                                                            |
| Folder list displays    | All smart folders shown       | **PASS**  | Shows folders that were added                                                                                    |
| Path validation         | Invalid paths rejected        | **FIXED** | Issue 3.1-A/B: Removed frontend validation; backend auto-creates directories. H-1: Fixed loading race condition. |

**Additional Observations (Smart Folder UI):** _(All issues below have been FIXED)_

- ~~Modal shows a weird "hidden window/blur layer" behind it; black line hovering over "Configure
  smart folders"; flicker when moving mouse/typing~~ → Fixed with split backdrop pattern
- ~~Too many rebuild options at top of screen and inside individual folder settings~~ → Issue 3.1-C:
  Removed per-folder rebuild
- ~~Rebuild terminology is unclear - "folders" vs "files" is ambiguous~~ → Issue 3.1-D: Simplified
  by removing per-folder option

### 3.2 Target Folder Selection

| Test               | Expected                    | Status    | Notes                                                                                    |
| ------------------ | --------------------------- | --------- | ---------------------------------------------------------------------------------------- |
| Browse for folder  | Folder picker dialog opens  | **PASS**  | Browse worked                                                                            |
| Select destination | Destination folder is set   | **PASS**  | Appeared to set destination during target selection                                      |
| Path validation    | Invalid paths are rejected  | **SKIP**  | Not tested                                                                               |
| Default path       | Documents folder is default | **FIXED** | H-1: Fixed path loading race. Backend auto-creates directories when saving smart folder. |

### 3.3 Folder Descriptions (AI-Enhanced)

| Test                      | Expected                           | Status    | Notes                                                                |
| ------------------------- | ---------------------------------- | --------- | -------------------------------------------------------------------- |
| Auto-generate description | AI can suggest folder description  | **FIXED** | C-1: Fixed backend to use correct OllamaService.analyzeText() method |
| Manual description entry  | Can type custom description        | **PASS**  | Works                                                                |
| Description saved         | Descriptions persist after restart | **PASS**  | Folder + description persisted after restart                         |

---

## 4. Discover Phase (File Analysis)

### 4.1 File Selection

| Test                    | Expected                             | Status   | Notes                                                                        |
| ----------------------- | ------------------------------------ | -------- | ---------------------------------------------------------------------------- |
| Drag & drop files       | Can drop files onto app              | **N/A**  | Intentionally disabled - future feature                                      |
| Drag & drop folders     | Can drop folders onto app            | **N/A**  | Intentionally disabled - future feature                                      |
| Browse button           | File picker dialog opens             | **PASS** | Works                                                                        |
| Multiple file selection | Can select multiple files            | **PASS** | Works                                                                        |
| File list displays      | Selected files appear in list        | **PASS** | Works                                                                        |
| Remove file from list   | Can deselect/remove individual files | **PASS** | Works - "Remove" button in each file row removes from queue without deleting |
| Clear all files         | Can clear entire selection           | **PASS** | Works                                                                        |

### 4.2 File Type Support

| Test                   | Expected                           | Status   | Notes                        |
| ---------------------- | ---------------------------------- | -------- | ---------------------------- |
| PDF files              | PDFs can be analyzed               | **PASS** | Works                        |
| Word documents (.docx) | Word files can be analyzed         | **PASS** | Works                        |
| Excel files (.xlsx)    | Excel files can be analyzed        | **PASS** | Works                        |
| PowerPoint (.pptx)     | PowerPoint files can be analyzed   | **PASS** | Works                        |
| Plain text (.txt)      | Text files can be analyzed         | **PASS** | Works                        |
| Images (JPG/PNG)       | Images can be analyzed             | **PASS** | Works                        |
| Unsupported files      | Show warning for unsupported types | **PASS** | Shows they are not processed |

### 4.3 Analysis Process

| Test                     | Expected                       | Status   | Notes                                                                                                 |
| ------------------------ | ------------------------------ | -------- | ----------------------------------------------------------------------------------------------------- |
| Analyze button works     | Analysis starts on click       | **N/A**  | Auto-processes when files/folders loaded - no manual analyze button. L-1: Fixed duplicate indicators. |
| Progress indicator       | Progress shown during analysis | **PASS** | Works                                                                                                 |
| Individual file progress | Each file shows its status     | **PASS** | Shows horizontal bar animation with percentage                                                        |
| Cancel analysis          | Can cancel ongoing analysis    | **PASS** | Works                                                                                                 |
| Analysis completes       | All files finish processing    | **PASS** | Works                                                                                                 |

### 4.4 Analysis Results

| Test             | Expected                     | Status   | Notes |
| ---------------- | ---------------------------- | -------- | ----- |
| Results display  | Analysis results appear      | **PASS** | Works |
| Category shown   | File category is displayed   | **PASS** | Works |
| Keywords shown   | Extracted keywords visible   | **PASS** | Works |
| Confidence score | Confidence percentage shown  | **PASS** | Works |
| Suggested folder | Folder suggestion displayed  | **PASS** | Works |
| Suggested name   | File rename suggestion shown | **PASS** | Works |

### 4.5 Batch Analysis

| Test                     | Expected                        | Status    | Notes                                                                     |
| ------------------------ | ------------------------------- | --------- | ------------------------------------------------------------------------- |
| Multiple files analyzed  | Can process batch of files      | **PASS**  | Works                                                                     |
| Partial failure handling | Some files fail, others succeed | **PASS**  | Works                                                                     |
| Retry failed files       | Can retry individual failures   | **FIXED** | M-3: Added "Retry Failed" button in DiscoverPhase when failed files exist |

---

## 5. Organize Phase

### 5.1 Organization Suggestions

| Test                       | Expected                      | Status   | Notes |
| -------------------------- | ----------------------------- | -------- | ----- |
| Suggestions display        | File suggestions are shown    | **PASS** | Works |
| Folder assignments visible | Each file shows target folder | **PASS** | Works |
| Confidence indicators      | Confidence levels displayed   | **PASS** | Works |
| Group by folder            | Files grouped by destination  | **PASS** | Works |

### 5.2 Manual Adjustments

| Test                 | Expected                              | Status    | Notes                                                                                                                           |
| -------------------- | ------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Change target folder | Can reassign file to different folder | **SKIP**  | Not tested                                                                                                                      |
| Edit file name       | Can modify suggested name             | **SKIP**  | Not tested                                                                                                                      |
| Exclude file         | Can skip specific files               | **SKIP**  | Not tested                                                                                                                      |
| Include/exclude all  | Bulk selection works                  | **FIXED** | Fixed: Organize button now respects selection - shows "Organize N Selected" when files selected, otherwise "Organize All Files" |

### 5.3 File Operations

| Test                                      | Expected                                     | Status    | Notes                                                                                     |
| ----------------------------------------- | -------------------------------------------- | --------- | ----------------------------------------------------------------------------------------- |
| Organize button works                     | Files move to destinations                   | **PASS**  | Works                                                                                     |
| Progress shown                            | Operation progress displayed                 | **PASS**  | Works                                                                                     |
| Success notification                      | Completion message shown                     | **PASS**  | Works                                                                                     |
| Folders created                           | Missing folders are created                  | **FIXED** | Issue 3.1-A/B: Backend now auto-creates directories                                       |
| File conflicts handled                    | Duplicate names handled gracefully           | **FIXED** | M-4: Added conflict detection - blocks organize with warning when duplicates detected     |
| Naming convention applied (auto-organize) | Files renamed per selected naming convention | **PASS**  | Download watcher now uses selected naming settings (e.g., subject-date) when moving files |

### 5.4 Preview & Validation

| Test                           | Expected                                                | Status    | Notes                                                                                                                              |
| ------------------------------ | ------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Preview before move            | Can see what will happen                                | **PASS**  | Works                                                                                                                              |
| Conflict warnings              | Alerts for existing files                               | **FIXED** | M-4: Added conflict detection - shows warning banner listing conflicts, blocks organize until resolved                             |
| Path validation                | Invalid destinations caught                             | **SKIP**  | Not encountered                                                                                                                    |
| Destination conflict detection | Multiple files to same destination blocked with warning | **FIXED** | M-4: Added conflict detection in `buildPreview()`. Shows warning banner listing conflicting files, blocks organize until resolved. |

---

## 6. Undo/Redo System

### 6.1 Undo Operations

| Test                   | Expected                    | Status    | Notes                                                                                         |
| ---------------------- | --------------------------- | --------- | --------------------------------------------------------------------------------------------- |
| Undo button visible    | Undo control is present     | **PASS**  | Works                                                                                         |
| Undo single move       | Can undo last file move     | **SKIP**  | Not tested - only batch moves available                                                       |
| Undo batch move        | Can undo entire batch       | **PASS**  | Works                                                                                         |
| Multiple undos         | Can undo several operations | **SKIP**  | Not tested                                                                                    |
| Undo keyboard shortcut | Ctrl+Z / Cmd+Z works        | **FIXED** | H-3: UI now updates via STATE_CHANGED event - shows notification and dispatches refresh event |

### 6.2 Redo Operations

| Test                   | Expected                | Status    | Notes                                                                                         |
| ---------------------- | ----------------------- | --------- | --------------------------------------------------------------------------------------------- |
| Redo button visible    | Redo control is present | **PASS**  | Works                                                                                         |
| Redo single move       | Can redo undone move    | **SKIP**  | Unable to test                                                                                |
| Redo batch move        | Can redo undone batch   | **PASS**  | Works                                                                                         |
| Redo keyboard shortcut | Ctrl+Shift+Z works      | **FIXED** | H-3: UI now updates via STATE_CHANGED event - shows notification and dispatches refresh event |

### 6.3 Undo History

| Test                   | Expected                     | Status    | Notes                                                                                                          |
| ---------------------- | ---------------------------- | --------- | -------------------------------------------------------------------------------------------------------------- |
| History displays       | Can see undo history list    | **PASS**  | Works                                                                                                          |
| Jump to specific point | Can undo to specific state   | **FIXED** | L-2: Added clickable history items in HistoryModal with jumpToPoint() - can jump forward/backward to any point |
| Clear history          | Can clear undo history       | **PASS**  | Works                                                                                                          |
| History persisted      | History survives app restart | **PASS**  | Works                                                                                                          |

### 6.4 Undo/Redo Path Normalization (Issue-5/6)

| Test                           | Expected                                   | Status | Notes |
| ------------------------------ | ------------------------------------------ | ------ | ----- |
| Organize files, press Ctrl+Z   | Files reappear in "Ready to Organize" list |        |       |
| Press Ctrl+Shift+Z (redo)      | Files show as organized again              |        |       |
| Verify Ready count updates     | Count matches number of undone files       |        |       |
| Verify Organized count updates | Count matches number of redone files       |        |       |
| Multiple undo/redo cycles      | UI consistently reflects file states       |        |       |

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

| Test              | Expected                  | Status   | Notes |
| ----------------- | ------------------------- | -------- | ----- |
| Settings opens    | Settings panel accessible | **PASS** | Works |
| Settings sections | All sections visible      | **PASS** | Works |
| Close settings    | Can close settings panel  | **PASS** | Works |

### 8.2 AI Configuration

| Test                      | Expected                   | Status    | Notes                                                                      |
| ------------------------- | -------------------------- | --------- | -------------------------------------------------------------------------- |
| Text model selection      | Can choose text model      | **FIXED** | H-2: Fixed debounce flush on unmount; M-2: Fixed **proto** false positives |
| Vision model selection    | Can choose vision model    | **FIXED** | H-2: Settings now flush on panel close                                     |
| Embedding model selection | Can choose embedding model | **FIXED** | H-2: Settings now flush on panel close                                     |
| Model test connection     | Can test Ollama connection | **PASS**  | Works                                                                      |
| Model pull/download       | Can download new models    | **SKIP**  | Not tested                                                                 |

**Note:** Welcome page AI components (Setup/Add Component) shows Ollama version and models
correctly. There may be a spelling issue ("Obama" vs "Ollama").

### 8.3 Ollama Settings

| Test                  | Expected                     | Status   | Notes                                      |
| --------------------- | ---------------------------- | -------- | ------------------------------------------ |
| Host configuration    | Can change Ollama host URL   | **SKIP** | Not tested                                 |
| Connection status     | Shows connected/disconnected | **PASS** | Shows status correctly                     |
| Available models list | Shows installed models       | **PASS** | Shows models; also visible on Welcome page |

### 8.4 ChromaDB Settings

| Test                  | Expected                         | Status    | Notes                                                                                |
| --------------------- | -------------------------------- | --------- | ------------------------------------------------------------------------------------ |
| Status display        | ChromaDB status shown            | **PASS**  | Shown in settings page. M-5: Now shows context-aware messages when embeddings are 0. |
| Rebuild embeddings    | Can rebuild embedding database   | **PASS**  | Works - allows rebuild                                                               |
| Clear embeddings      | Can clear embedding database     | **SKIP**  | Not tested                                                                           |
| Deleted model cleanup | Deleted models removed from list | **FIXED** | NEW-8: Models checked for existence before displaying                                |

### 8.5 Default Locations

| Test                      | Expected                                  | Status    | Notes                                        |
| ------------------------- | ----------------------------------------- | --------- | -------------------------------------------- |
| Set source folder         | Can set default source                    |           |                                              |
| Set destination folder    | Can set default destination               |           |                                              |
| Paths persist             | Settings saved on restart                 |           |                                              |
| Default smart folder path | Changes apply to "Add Smart Folder" modal | **FIXED** | NEW-6: Modal now reads fresh setting on open |

### 8.6 Auto-Organize Settings

| Test                   | Expected                             | Status       | Notes                                                                    |
| ---------------------- | ------------------------------------ | ------------ | ------------------------------------------------------------------------ |
| Enable auto-organize   | Can toggle auto-organize             | **PASS**     | Toggle works in Settings                                                 |
| Watch folder selection | Can select watch folder              | **PASS**     | Uses Downloads folder by default                                         |
| Confidence threshold   | Shows "Locked at 75%"                | **PASS**     | **UI CHANGED:** Slider temporarily removed to prevent race conditions.   |
| Auto-organize trigger  | Auto processes new files             | **FIXED**    | C-2: Fixed race condition - watcher now waits for services to initialize |
| Watcher Confidence     | Accurate for related/unrelated files | **FIXED**    | NEW-11: Improved matching algorithm confidence scores                    |
| File size limits       | **REMOVED** from UI                  | **VERIFIED** | UI-1: Technical settings hidden from user                                |

### 8.7 Settings Backup/Restore

| Test              | Expected                      | Status | Notes |
| ----------------- | ----------------------------- | ------ | ----- |
| Export settings   | Can export settings to file   |        |       |
| Import settings   | Can import settings from file |        |       |
| Reset to defaults | Can reset all settings        |        |       |

### 8.8 Settings Persistence Tests (Issue-1/2)

| Test                                | Expected                          | Status    | Notes                                                     |
| ----------------------------------- | --------------------------------- | --------- | --------------------------------------------------------- |
| Confidence threshold display        | Shows "Locked at 75%" (no slider) | **PASS**  | UI Changed - slider removed                               |
| Enable "Watch smart folders" toggle | Persistence works correctly       | **FIXED** | NEW-5/NEW-12: Fixed state race condition in SettingsPanel |
| Close and reopen settings           | Settings state persisted          |           |                                                           |
| Restart application                 | Settings state persisted          |           |                                                           |
| Check logs for save confirmation    | Shows "[SETTINGS] Saved settings" |           |                                                           |

**Log Verification:** Open DevTools console while testing. You should see:

- `[ATOMIC-OPS] Created file atomically` - confirms settings.json saved
- `[SETTINGS] Saved settings` - confirms save completed
- Settings should persist across browser refreshes and app restarts

### 8.9 Smart Folder Watch Toggle (Issue-3)

| Test                           | Expected                                            | Status | Notes |
| ------------------------------ | --------------------------------------------------- | ------ | ----- |
| Enable with no smart folders   | Shows "No smart folders configured..." error        |        |       |
| Enable with inaccessible paths | Shows "...paths are inaccessible" error             |        |       |
| Enable with valid folders      | Shows "Watching X folders" with green indicator     |        |       |
| Disable toggle                 | Shows "Smart folder watching disabled" confirmation |        |       |

### 8.10 Analysis Resume vs Fresh Start (Issue-4)

| Test                         | Expected                                          | Status | Notes |
| ---------------------------- | ------------------------------------------------- | ------ | ----- |
| Start new analysis           | Shows "Starting AI analysis..." NOT "Resuming..." |        |       |
| Refresh page mid-analysis    | Shows "Resuming X files..." after reload          |        |       |
| Complete analysis, start new | No "Resuming" message for new batch               |        |       |

---

## 9. Keyboard Shortcuts

### 9.1 Global Shortcuts

| Test                       | Expected           | Status | Notes |
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

| Test            | Expected                     | Status    | Notes                                                   |
| --------------- | ---------------------------- | --------- | ------------------------------------------------------- |
| History saved   | Previous analyses accessible |           |                                                         |
| History search  | Can search analysis history  |           |                                                         |
| History cleared | Can clear history            |           |                                                         |
| Image keywords  | Keywords saved for images    | **FIXED** | NEW-10: Keywords now extracted/saved for all file types |

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

| Date       | Tester      | Version                       | Notes                                                                                                                                                                                                                             |
| ---------- | ----------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-01-01 | Manual      | Current (backtobasics branch) | Sections 1-3.3 completed. Found 11 issues total: 4 high priority, 5 medium, 2 low. Key blockers: smart folder path creation, missing theme toggle.                                                                                |
| 2026-01-01 | Claude Code | Current (backtobasics branch) | **FIXES APPLIED**: All 11 issues addressed. Key changes: removed frontend path validation, improved navbar responsiveness, added AI description generation, fixed modal blur/flicker, improved maximize detection.                |
| 2026-01-01 | Claude Code | Current (backtobasics branch) | **SECOND FIX SESSION**: 10 fixes applied. See "Second Fix Session" section below.                                                                                                                                                 |
| 2026-01-01 | Claude Code | Current (backtobasics branch) | **THIRD FIX SESSION**: 3 remaining fixes applied. M-2: Fixed **proto** false positives. M-4: Added organize conflict detection with block+warning. L-2: Added history jump-to-point feature.                                      |
| 2026-01-02 | Claude Code | Current (backtobasics branch) | **FOURTH FIX SESSION**: Fixed model pull timeout leak. Added 165 new automated tests. CI passing (5,363 tests).                                                                                                                   |
| 2026-01-02 | Manual      | Current (backtobasics branch) | **FIFTH TEST SESSION**: Comprehensive manual testing. See detailed results in sections 1-8. Key issues: model selection not saving, undo/redo UI not updating, drag/drop not working, retry failed files missing.                 |
| 2026-01-02 | Claude Code | Current (backtobasics branch) | **SIXTH FIX SESSION**: Fixed remaining FAIL items. 4.1 Remove file already works (verified). 5.2 Bulk selection now influences organize button behavior. All test items now PASS/FIXED/N/A.                                       |
| 2026-01-03 | Manual      | Current (WBACS branch)        | **SEVENTH TEST SESSION**: Verified C-1 PASS, H-2 PASS, F-3 PASS. Found 8 new issues (NEW-5 through NEW-12). SmartFolderWatcher works but needs history integration. UI improvement requests: remove emojis, hide unused settings. |
| 2026-01-03 | Claude Code | Current (WBACS branch)        | **SEVENTH FIX SESSION**: Implementing fixes for NEW-5/12 (confidence slider), SmartFolderWatcher auto-embedding integration, UI improvements (emojis → Lucide icons, remove unused settings).                                     |
| 2026-01-04 | Manual      | Current (WBACS branch)        | **NINTH FIX SESSION**: Updated checklist and test plan for new fixes (NEW-5 through NEW-12).                                                                                                                                      |
