# Fix Verification Checklist

**Purpose:** Manual verification of all fixes applied during fix sessions. Test each item and mark
PASS/FAIL.

**Date:** 2026-01-04 **Tester:** Manual Testing Session **Build:** `npm run dev`

---

## Pre-Test Setup

- [ ] Ollama is running (`ollama serve`)
- [ ] App started with `npm run dev`
- [ ] Have 3-5 test files ready (PDFs, images, etc.)

---

## Critical Fixes

### C-1: AI Description Generation

**File:** `src/main/ipc/smartFolders.js` **Issue:** "Generate with AI" button failed - called
non-existent `OllamaService.chat()` method

| Step | Action                                          | Expected                                          | Status   |
| ---- | ----------------------------------------------- | ------------------------------------------------- | -------- |
| 1    | Go to Setup phase                               | Smart folders section visible                     | **PASS** |
| 2    | Click "Add Smart Folder"                        | Modal opens                                       | **PASS** |
| 3    | Enter folder name (e.g., "Recipes")             | Name field populated                              | **PASS** |
| 4    | Click "Generate with AI" button (sparkles icon) | Loading indicator appears                         | **PASS** |
| 5    | Wait for response                               | Description auto-populates with AI-generated text | **PASS** |

**Result:** [X] PASS [ ] FAIL **Notes:** Steps 1-5 verified passing in 2026-01-03 testing session

---

### C-2: Auto-Organize Race Condition

**File:** `src/main/simple-main.js` **Issue:** DownloadWatcher started before services initialized

| Step | Action                           | Expected                                                             | Status   |
| ---- | -------------------------------- | -------------------------------------------------------------------- | -------- |
| 1    | Open Settings                    | Settings panel opens                                                 |          |
| 2    | Enable "Auto-organize downloads" | Toggle turns on                                                      |          |
| 3    | Close and restart app            | App restarts without errors                                          |          |
| 4    | Check DevTools console           | No "Cannot read property" errors related to autoOrganize             |          |
| 5    | Drop a file in Downloads folder  | File should be processed (if Ollama connected) or gracefully ignored | **PASS** |

**Result:** [X] PASS [ ] FAIL **Notes:** No race condition errors. File processed and renamed with
current naming convention via DownloadWatcher (subject-date). Prior “not renamed” observation
resolved after naming settings sync.

---

## High Priority Fixes

### H-1: Smart Folder Path Loading Race

**Files:** `src/renderer/phases/SetupPhase.jsx`,
`src/renderer/components/setup/AddSmartFolderModal.jsx` **Issue:** Modal opened before default path
loaded, showing "Documents" string instead of real path

| Step | Action                           | Expected                                                           | Status   |
| ---- | -------------------------------- | ------------------------------------------------------------------ | -------- |
| 1    | Start app fresh                  | App loads                                                          | **PASS** |
| 2    | Immediately go to Setup phase    | Setup phase loads                                                  | **PASS** |
| 3    | Click "Add Smart Folder" quickly | Modal opens                                                        | **PASS** |
| 4    | Check the path field             | Shows full path like `C:\Users\...\Documents` NOT just "Documents" | **PASS** |
| 5    | Try to save without browsing     | Should work if path is valid absolute path                         | N/A      |

**Result:** [X] PASS [ ] FAIL **Notes:** Steps 1-4 verified. Step 5 N/A (still need folder name to
save). Core fix validated: path shows full absolute path on modal open.

---

### H-2: Settings Debounce Flush on Close

**File:** `src/renderer/components/SettingsPanel.jsx` **Issue:** Model changes lost when closing
settings quickly (800ms debounce)

| Step | Action                                              | Expected                                    | Status   |
| ---- | --------------------------------------------------- | ------------------------------------------- | -------- |
| 1    | Open Settings                                       | Settings panel opens                        | **PASS** |
| 2    | Change the Text Model dropdown to a different model | Selection changes                           | **PASS** |
| 3    | Immediately close Settings (within 1 second)        | Settings panel closes                       | **PASS** |
| 4    | Re-open Settings                                    | Settings panel opens                        | **PASS** |
| 5    | Check Text Model dropdown                           | Shows the model you selected (not reverted) | **PASS** |

**Result:** [X] PASS [ ] FAIL **Notes:** Verified working in 2026-01-03 testing session - text model
change persisted correctly

---

### H-3: Undo/Redo UI Sync

**Files:** `src/main/ipc/undoRedo.js`, `src/preload/preload.js`,
`src/renderer/hooks/useKeyboardShortcuts.js` **Issue:** Undo/Redo worked on filesystem but UI didn't
update

| Step | Action                     | Expected                                            | Status |
| ---- | -------------------------- | --------------------------------------------------- | ------ |
| 1    | Add files and analyze them | Files analyzed                                      |        |
| 2    | Go to Organize phase       | Files listed                                        |        |
| 3    | Organize the files         | Files moved to destinations                         |        |
| 4    | Press Ctrl+Z (undo)        | Notification appears "Undone: ..." AND UI refreshes |        |
| 5    | Check filesystem           | Files are back in original location                 |        |
| 6    | Press Ctrl+Shift+Z (redo)  | Notification appears "Redone: ..." AND UI refreshes |        |

**Result:** [ ] PASS [ ] FAIL **Notes:** FIX APPLIED - stale ref issue in onUndo/onRedo callbacks.
Re-test required.

---

## Medium Priority Fixes

### M-1: Z-Index Conflicts

**File:** `src/renderer/components/search/FloatingSearchWidget.jsx` **Issue:** Search widget covered
navbar elements

| Step | Action                                                       | Expected                                          | Status |
| ---- | ------------------------------------------------------------ | ------------------------------------------------- | ------ |
| 1    | Open the floating search (Ctrl+Shift+F or click search icon) | Search widget appears                             |        |
| 2    | Drag search widget near the navbar                           | Widget is draggable                               |        |
| 3    | Try to click navbar items while search is open               | Navbar items are clickable, not blocked by search |        |
| 4    | Resize window to small size                                  | Navbar and search don't overlap awkwardly         |        |

**Result:** [ ] PASS [ ] FAIL **Notes:** ******\_\_\_******

---

### M-3: Retry Failed Files

**Files:** `src/renderer/phases/discover/useAnalysis.js`, `src/renderer/phases/DiscoverPhase.jsx`
**Issue:** No way to retry failed file analysis

| Step | Action                                                   | Expected                                   | Status |
| ---- | -------------------------------------------------------- | ------------------------------------------ | ------ |
| 1    | Add files for analysis                                   | Files added to queue                       |        |
| 2    | Disconnect Ollama mid-analysis (or use unsupported file) | Some files fail with error state           |        |
| 3    | Look for "Retry X Failed" button                         | Button appears when failed files exist     |        |
| 4    | Reconnect Ollama, click "Retry Failed"                   | Failed files are re-queued and re-analyzed |        |

**Result:** [ ] PASS [ ] FAIL **Notes:** ******\_\_\_******

---

### M-4: Organize Conflict Detection

**Files:** `src/renderer/phases/organize/useOrganization.js`,
`src/renderer/phases/OrganizePhase.jsx` **Issue:** No warning when multiple files would overwrite
same destination

| Step | Action                                               | Expected                                 | Status |
| ---- | ---------------------------------------------------- | ---------------------------------------- | ------ |
| 1    | Add 2+ files with same suggested name to same folder | Files analyzed                           |        |
| 2    | Go to Organize phase                                 | Files listed                             |        |
| 3    | Ensure files have conflicting destinations           | Check suggested paths are identical      |        |
| 4    | Try to click Organize                                | Warning banner appears listing conflicts |        |
| 5    | Organize button should be disabled                   | Cannot proceed until conflicts resolved  |        |

**Result:** [ ] PASS [ ] FAIL **Notes:** ******\_\_\_******

---

### M-5: Embeddings Status Context

**File:** `src/renderer/components/settings/EmbeddingRebuildSection.jsx` **Issue:** "0 embeddings"
shown without explanation

| Step | Action                              | Expected                                                                   | Status |
| ---- | ----------------------------------- | -------------------------------------------------------------------------- | ------ |
| 1    | Open Settings > Embeddings section  | Section visible                                                            |        |
| 2    | If no files analyzed, check message | Should say "No embeddings yet - analyze files and add smart folders first" |        |
| 3    | Analyze some files                  | Files analyzed                                                             |        |
| 4    | Check embeddings section again      | Shows count with helpful context if rebuild needed                         |        |

**Result:** [ ] PASS [ ] FAIL **Notes:** ******\_\_\_******

---

## Low Priority Fixes

### L-1: Duplicate Loading Indicators

**File:** `src/renderer/phases/DiscoverPhase.jsx` **Issue:** Two progress indicators shown during
analysis

| Step | Action                                    | Expected                             | Status |
| ---- | ----------------------------------------- | ------------------------------------ | ------ |
| 1    | Add files and start analysis              | Analysis begins                      |        |
| 2    | Look at the results section header        | Shows "X successful, Y failed" count |        |
| 3    | Should NOT show "Analyzing files..." text | Only progress bar indicates status   |        |

**Result:** [ ] PASS [ ] FAIL **Notes:** ******\_\_\_******

---

### L-2: History Jump to Point

**File:** `src/renderer/components/undo/UndoRedoSystem.jsx` **Issue:** History modal showed items
but couldn't jump to specific point

| Step | Action                                                 | Expected                       | Status |
| ---- | ------------------------------------------------------ | ------------------------------ | ------ |
| 1    | Perform several organize operations                    | Multiple items in undo history |        |
| 2    | Open undo/redo history (clock icon or menu)            | History modal opens            |        |
| 3    | Click on a specific history item (not the most recent) | Jumps to that point in history |        |
| 4    | Verify filesystem matches that point                   | Files in expected state        |        |

**Result:** [ ] PASS [ ] FAIL **Notes:** Not re-run in this pass.

---

## Additional Fixes Verified

### Remove File from List (4.1)

**File:** `src/renderer/components/discover/AnalysisResultsList.jsx`

| Step | Action                                            | Expected                                        | Status |
| ---- | ------------------------------------------------- | ----------------------------------------------- | ------ |
| 1    | Add multiple files                                | Files in queue                                  |        |
| 2    | Find "Remove" button on any file row              | Button visible                                  |        |
| 3    | Click "Remove"                                    | File removed from queue (not deleted from disk) |        |
| 4    | Notification shows "Removed from queue: filename" | Confirmation shown                              |        |

**Result:** [ ] PASS [ ] FAIL **Notes:** ******\_\_\_******

---

### Include/Exclude All - Bulk Selection (5.2)

**File:** `src/renderer/phases/OrganizePhase.jsx`

| Step | Action                                       | Expected                                               | Status |
| ---- | -------------------------------------------- | ------------------------------------------------------ | ------ |
| 1    | Analyze multiple files, go to Organize       | Files listed                                           |        |
| 2    | Select some files using checkboxes (not all) | Files selected                                         |        |
| 3    | Look at Organize button                      | Shows "Organize X Selected" (not "Organize All Files") |        |
| 4    | Click the button                             | Only selected files are organized                      |        |
| 5    | Deselect all files                           | Button shows "Organize All Files"                      |        |

**Result:** [ ] PASS [ ] FAIL **Notes:** ******\_\_\_******

---

## Window/UI Fixes

### Window Resize Responsiveness (2.3)

| Step | Action                                | Expected                                 | Status |
| ---- | ------------------------------------- | ---------------------------------------- | ------ |
| 1    | Resize window to minimum size         | UI adapts, no overlapping elements       |        |
| 2    | Check navbar                          | All nav items visible or properly hidden |        |
| 3    | Check search widget doesn't block nav | Can click nav items                      |        |

**Result:** [ ] PASS [ ] FAIL **Notes:** ******\_\_\_******

---

### Smart Folder Modal (3.1)

| Step | Action                        | Expected                               | Status |
| ---- | ----------------------------- | -------------------------------------- | ------ |
| 1    | Open Add Smart Folder modal   | Modal opens cleanly                    |        |
| 2    | Check for blur/flicker issues | No black lines, no flickering backdrop |        |
| 3    | Type in fields, move mouse    | Smooth interaction, no visual glitches |        |

**Result:** [ ] PASS [ ] FAIL **Notes:** ******\_\_\_******

---

## New Features

### F-1: SmartFolderWatcher - Auto-Analyze Files in Smart Folders

**Files:** `src/main/services/SmartFolderWatcher.js`,
`src/renderer/components/settings/SmartFolderWatchSection.jsx` **Feature:** Automatically analyze
files when they are added to or modified in smart folders

#### Pre-Test Setup

| Step | Action                                               | Expected                           | Status |
| ---- | ---------------------------------------------------- | ---------------------------------- | ------ |
| 1    | Have at least 1 smart folder configured              | Smart folders exist in Setup phase |        |
| 2    | Place a test file (PDF, image, etc.) on your Desktop | File ready for testing             |        |
| 3    | Ensure Ollama is running                             | `ollama serve` active              |        |

#### Enable Smart Folder Watching

| Step | Action                                                   | Expected                                     | Status |
| ---- | -------------------------------------------------------- | -------------------------------------------- | ------ |
| 1    | Open Settings (gear icon)                                | Settings panel opens                         |        |
| 2    | Scroll to "Performance" section                          | Section visible                              |        |
| 3    | Find "Watch smart folders for new/modified files" toggle | Toggle visible with eye icon                 |        |
| 4    | Enable the toggle                                        | Toggle turns on, shows "Starting..." briefly |        |
| 5    | Wait for status indicator                                | Green dot with "Watching" status appears     |        |
| 6    | Check folder count                                       | Shows "X folders" being watched              |        |

**Result:** [ ] PASS [ ] FAIL **Notes:** ******\_\_\_******

#### Test Auto-Analysis of New Files

| Step | Action                                                     | Expected                         | Status |
| ---- | ---------------------------------------------------------- | -------------------------------- | ------ |
| 1    | Copy/move a test file INTO one of your smart folders       | File appears in folder           |        |
| 2    | Wait 3-5 seconds (stability threshold)                     | Watcher detects file             |        |
| 3    | Check Settings > Performance section                       | "Analyzed: 1" counter increments |        |
| 4    | Open Analysis History (Settings > Analysis History > View) | New file appears in history      |        |
| 5    | Check embedding count (Settings > Embeddings)              | File count increased             |        |

**Result:** [ ] PASS [ ] FAIL **Notes:** ******\_\_\_******

#### Test Re-Analysis of Modified Files

| Step | Action                                            | Expected                            | Status |
| ---- | ------------------------------------------------- | ----------------------------------- | ------ |
| 1    | Open a text file that's already in a smart folder | File opens in editor                |        |
| 2    | Make a change and save the file                   | File saved                          |        |
| 3    | Wait 3-5 seconds                                  | Watcher detects modification        |        |
| 4    | Check Settings > Performance section              | "Re-analyzed: 1" counter increments |        |
| 5    | Check Analysis History                            | File's timestamp updated            |        |

**Result:** [ ] PASS [ ] FAIL **Notes:** ******\_\_\_******

#### Test Manual Scan for Unanalyzed Files

| Step | Action                                    | Expected                                                    | Status |
| ---- | ----------------------------------------- | ----------------------------------------------------------- | ------ |
| 1    | Ensure watcher is enabled and running     | Green "Watching" status                                     |        |
| 2    | Click "Scan for Unanalyzed Files" button  | Button shows "Scanning..."                                  |        |
| 3    | Wait for scan to complete                 | Notification shows "Scanned X files, queued Y for analysis" |        |
| 4    | If files were queued, wait for processing | Files are analyzed automatically                            |        |

**Result:** [ ] PASS [ ] FAIL **Notes:** ******\_\_\_******

#### Test Watcher Persistence Across Restart

| Step | Action                          | Expected                              | Status |
| ---- | ------------------------------- | ------------------------------------- | ------ |
| 1    | Enable watcher in settings      | Watcher running                       |        |
| 2    | Close the app completely        | App closes                            |        |
| 3    | Restart the app (`npm run dev`) | App starts                            |        |
| 4    | Open Settings > Performance     | Watcher toggle still enabled          |        |
| 5    | Check watcher status            | Shows "Watching" with green indicator |        |

**Result:** [ ] PASS [ ] FAIL **Notes:** ******\_\_\_******

#### Test Watcher Disable

| Step | Action                                   | Expected                                   | Status |
| ---- | ---------------------------------------- | ------------------------------------------ | ------ |
| 1    | Open Settings > Performance              | Section visible                            |        |
| 2    | Disable the "Watch smart folders" toggle | Toggle turns off                           |        |
| 3    | Check status indicator                   | No longer shows "Watching"                 |        |
| 4    | Add a file to a smart folder             | File added                                 |        |
| 5    | Wait 5 seconds                           | File should NOT be auto-analyzed           |        |
| 6    | Check Analysis History                   | New file NOT in history (watcher disabled) |        |

**Result:** [ ] PASS [ ] FAIL **Notes:** ******\_\_\_******

#### Error Handling

| Step | Action                             | Expected                         | Status |
| ---- | ---------------------------------- | -------------------------------- | ------ |
| 1    | Enable watcher with Ollama stopped | Watcher starts                   |        |
| 2    | Add a file to a smart folder       | File queued                      |        |
| 3    | Check for graceful error handling  | Error count increments, no crash |        |
| 4    | Start Ollama                       | Ollama running                   |        |
| 5    | Add another file                   | File analyzed successfully       |        |

**Result:** [ ] PASS [ ] FAIL **Notes:** ******\_\_\_******

---

### F-2: DevTools Separate Window Fix

**File:** `src/main/core/createWindow.js` **Issue:** DevTools detached window not opening in dev
mode

| Step | Action                                        | Expected                            | Status |
| ---- | --------------------------------------------- | ----------------------------------- | ------ |
| 1    | Run `npm run dev`                             | App builds and starts               |        |
| 2    | Wait for main window to appear                | Main window visible                 |        |
| 3    | Check for separate DevTools window            | DevTools window opens automatically |        |
| 4    | DevTools window is detached (separate window) | Not docked in main window           |        |

**Result:** [ ] PASS [ ] FAIL **Notes:** ******\_\_\_******

---

### F-3: Modal Backdrop Blur Fix

**Files:** `src/renderer/components/Modal.jsx`,
`src/renderer/components/setup/AddSmartFolderModal.jsx`, `src/renderer/components/SettingsPanel.jsx`
**Issue:** Multiple overlapping backdrop layers causing visual glitches

| Step | Action                    | Expected                                                   | Status   |
| ---- | ------------------------- | ---------------------------------------------------------- | -------- |
| 1    | Go to Setup phase         | Smart folders visible                                      | **PASS** |
| 2    | Click "Add Smart Folder"  | Modal opens                                                | **PASS** |
| 3    | Check backdrop appearance | Smooth blur effect, no flickering or overlapping artifacts | **PASS** |
| 4    | Check modal edges         | Clean edges, no multiple shadow layers                     | **PASS** |
| 5    | Open Settings panel       | Settings opens                                             | **PASS** |
| 6    | Check Settings backdrop   | Same smooth blur, consistent with Add Folder modal         | **PASS** |

**Result:** [X] PASS [ ] FAIL **Notes:** Smart folder modal background glitch has been fixed -
verified in 2026-01-03 testing session

---

## Ninth Fix Session (2026-01-04)

### NEW-5/NEW-12: Confidence Slider Persistence & Interaction (NOTE: Slider Removed)

**Files:** `src/renderer/components/SettingsPanel.jsx`,
`src/renderer/components/settings/AutoOrganizeSection.jsx` **Issue:** Confidence slider was causing
race conditions. Temporarily removed from UI.

| Step | Action                                        | Expected                                             | Status |
| ---- | --------------------------------------------- | ---------------------------------------------------- | ------ |
| 1    | Open Settings > Auto-organize                 | Section visible                                      |        |
| 2    | Enable "Automatically organize new downloads" | Options appear                                       |        |
| 3    | Check "Minimum confidence"                    | Shows "Locked at 75% (temporarily not configurable)" |        |
| 4    | Verify no slider is visible                   | Slider input is absent                               |        |

**Result:** [ ] PASS [ ] FAIL **Notes:** Slider removed to prevent state race conditions (NEW-5/12).
Feature deferred.

---

### NEW-6: Default Smart Folder Location

**Files:** `src/renderer/components/setup/AddSmartFolderModal.jsx`,
`src/renderer/phases/SetupPhase.jsx` **Issue:** "Add Smart Folder" modal ignored the user-configured
default path.

| Step | Action                                 | Expected                         | Status |
| ---- | -------------------------------------- | -------------------------------- | ------ |
| 1    | Open Settings > Locations              | Section visible                  |        |
| 2    | Change "Default Smart Folder Location" | Path updates (e.g. to Downloads) |        |
| 3    | Save/Close Settings                    | Settings saved                   |        |
| 4    | Go to Setup Phase > Add Smart Folder   | Modal opens                      |        |
| 5    | Check "Folder Path" field              | Pre-filled with NEW default path |        |

**Result:** [ ] PASS [ ] FAIL **Notes:** ********\_\_\_********

---

### NEW-8: Deleted Model Cleanup

**Files:** `src/renderer/components/settings/EmbeddingRebuildSection.jsx` **Issue:** Deleted models
still appear in embedding maintenance.

| Step | Action                          | Expected                                | Status |
| ---- | ------------------------------- | --------------------------------------- | ------ |
| 1    | Delete a model via Ollama CLI   | Model removed                           |        |
| 2    | Open Settings > Embeddings      | Model list should update or show status |        |
| 3    | Check "Current Embedding Model" | Should handle missing model gracefully  |        |

**Result:** [ ] PASS [ ] FAIL **Notes:** ********\_\_\_********

---

### NEW-9: Embedding Count Clarity

**Files:** `src/renderer/components/settings/EmbeddingRebuildSection.jsx` **Issue:** Confusing "0
embeddings" display during operations.

| Step | Action                     | Expected                                          | Status |
| ---- | -------------------------- | ------------------------------------------------- | ------ |
| 1    | Analyze 2-3 new files      | Analysis completes                                |        |
| 2    | Open Settings > Embeddings | Shows "X files analyzed, X embedded"              |        |
| 3    | Click "Rebuild Embeddings" | Status changes to "Rebuilding..."                 |        |
| 4    | Watch counts               | Counts update logically, no confusing "0" flicker |        |

**Result:** [ ] PASS [ ] FAIL **Notes:** ********\_\_\_********

---

### NEW-10: Image/Non-Text Keywords

**Files:** `src/main/analysis/ollamaImageAnalysis.js` **Issue:** Image files were missing keywords
in analysis history.

| Step | Action                          | Expected                                                 | Status |
| ---- | ------------------------------- | -------------------------------------------------------- | ------ |
| 1    | Analyze an image file (JPG/PNG) | Analysis completes                                       |        |
| 2    | Check Analysis History          | Entry for image exists                                   |        |
| 3    | Check Keywords column           | Should contain keywords (e.g., "screenshot, text, blue") |        |
| 4    | Export to CSV                   | CSV should include Keywords column                       |        |

**Result:** [ ] PASS [ ] FAIL **Notes:** ********\_\_\_********

---

### NEW-11: Watcher Confidence & Matching

**Files:** `src/main/services/FolderMatchingService.js` **Issue:** Watcher reported high confidence
(90%) for unrelated files.

| Step | Action                                              | Expected                                 | Status |
| ---- | --------------------------------------------------- | ---------------------------------------- | ------ |
| 1    | Ensure you have a smart folder (e.g. "Invoices")    | Folder exists                            |        |
| 2    | Add a clearly UNRELATED file (e.g. "funny_cat.jpg") | File added to watch folder               |        |
| 3    | Check Watcher Notification/Log                      | Confidence should be LOW or file skipped |        |
| 4    | Add a RELATED file (e.g. "Invoice_123.pdf")         | File added                               |        |
| 5    | Check Watcher Notification/Log                      | Confidence should be HIGH                |        |

**Result:** [ ] PASS [ ] FAIL **Notes:** ********\_\_\_********

---

## Summary

| Category                             | Total  | Passed | Failed |
| ------------------------------------ | ------ | ------ | ------ |
| Critical (C-1, C-2)                  | 2      |        |        |
| High Priority (H-1, H-2, H-3)        | 3      |        |        |
| Medium Priority (M-1, M-3, M-4, M-5) | 4      |        |        |
| Low Priority (L-1, L-2)              | 2      |        |        |
| Additional Fixes                     | 4      |        |        |
| New Features (F-1, F-2, F-3)         | 3      |        |        |
| Settings & Watcher (NEW-5 to 12)     | 6      |        |        |
| **TOTAL**                            | **24** |        |        |

---

## Issues Found During Verification

| Fix ID | Issue Description                  | Severity | Status      |
| ------ | ---------------------------------- | -------- | ----------- |
| NEW-1  | SmartFolderWatcher race condition  | Critical | FIXED       |
| NEW-2  | Embeddings showing 0               | Critical | FIXED       |
| NEW-3  | Confidence slider resets           | High     | FIXED       |
| NEW-4  | FILE_IN_USE error                  | High     | FIXED       |
| NEW-5  | Confidence slider resets on toggle | High     | In Progress |
| NEW-6  | Default location not persisting    | Medium   | In Progress |
| NEW-8  | Deleted model still showing        | Medium   | In Progress |
| NEW-9  | Confusing embedding counts         | Medium   | In Progress |
| NEW-10 | Image missing keywords             | Medium   | In Progress |
| NEW-11 | Watcher incorrect confidence       | High     | In Progress |
| NEW-12 | Cannot change confidence slider    | High     | In Progress |

---

## UI Improvements

### UI-1: Remove Technical Settings

**Files:** `src/renderer/components/SettingsPanel.jsx` **Issue:** "File size limits" and "Processing
parameters" were cluttering the UI.

| Step | Action                                    | Expected                                     | Status |
| ---- | ----------------------------------------- | -------------------------------------------- | ------ |
| 1    | Open Settings                             | Settings panel opens                         |        |
| 2    | Check "Performance" / "Advanced" sections | "File size limit" inputs should be GONE      |        |
| 3    | Check "Processing parameters"             | "Chunk size", "Overlap", etc. should be GONE |        |

**Result:** [ ] PASS [ ] FAIL **Notes:** ********\_\_\_********

### UI-2: Professional Icons

**Files:** `src/renderer/components/settings/AnalysisHistory.jsx`,
`src/renderer/components/settings/EmbeddingRebuildSection.jsx` **Issue:** Replaced emojis (📊, 🧠)
with professional Lucide icons.

| Step | Action                           | Expected                                               | Status |
| ---- | -------------------------------- | ------------------------------------------------------ | ------ |
| 1    | Open Settings > Analysis History | Check headers/empty states                             |        |
| 2    | Open Settings > Embeddings       | Check statistics display                               |        |
| 3    | Verify Icon Style                | Should use clean, monochrome icons (Lucide), no emojis |        |

**Result:** [ ] PASS [ ] FAIL **Notes:** ********\_\_\_********
