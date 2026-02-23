# StratoSort Core Testing Guide

**Version:** 2.0.2  
**Date:** 2026-02-18  
**Purpose:** Single source of truth for manual QA and automated test expectations.

---

## 1) Quick Manual Checklist (Smoke Test)

Use this checklist before release candidates and before merging changes that impact user workflows.
Every item should pass. If time is limited, focus on Sections A-C.

### A. Launch and Baseline

- [ ] App launches without fatal errors or blank white screen.
- [ ] AI setup/readiness state is clear (either "Ready" badge or Model Setup Wizard is shown).
- [ ] Existing settings load correctly (theme, preferences, configured smart folders).
- [ ] Navigation bar renders all phase tabs (Welcome, Setup, Discover, Organize, Complete).
- [ ] Clicking each nav tab transitions to the correct phase without errors.
- [ ] Window controls (minimize, maximize, close) work on all platforms.

### B. File Intake and Analysis

- [ ] Import a mixed set of files (PDF, image, and text-based document).
- [ ] Analysis completes and results include classification/tags without UI freezes.
- [ ] Progress indicator is visible during analysis and disappears when complete.
- [ ] Unsupported or empty files are handled gracefully (no crash, clear status message).

### C. Organization and Safety

- [ ] Suggestions are sensible for at least one known test folder.
- [ ] Apply organization action and verify the file moved to the expected location.
- [ ] Undo restores the file to its original location.
- [ ] Redo re-applies the move.
- [ ] Filename collisions/permission issues are surfaced clearly and do not corrupt data.

### D. Search and Knowledge Graph

- [ ] Unified search (Ctrl+K / Cmd+K) opens and accepts input.
- [ ] Typing a known term returns meaningful results.
- [ ] Search filtering (file type, date, tags) updates results in real time.
- [ ] Knowledge graph view renders nodes and edges without errors.
- [ ] Graph remains interactive (pan, zoom, click node) under normal load.

### E. Resilience

- [ ] Restart app and confirm key state persists (phase, settings, smart folders).
- [ ] Validate core analysis flow still works offline after models are installed.

---

## 2) Detailed Feature QA

Work through these sections when testing specific features or validating a branch with broad
changes.

### F. Model Setup Wizard

- [ ] Wizard appears on first launch (or when required models are missing).
- [ ] System info (RAM, GPU) is detected and displayed.
- [ ] "Base (Small & Fast)" and "Better Quality" profiles are selectable.
- [ ] Selecting a profile updates the model list shown.
- [ ] Download starts for each model and progress bars update.
- [ ] Download completes and status changes to checkmark/ready.
- [ ] "Get Started" button is enabled only after all required models are ready.
- [ ] "Skip" (if shown) bypasses wizard without crash.
- [ ] Re-entering wizard from Settings shows already-downloaded models as ready.

### G. Welcome Phase

- [ ] Welcome screen renders with quick-start cards.
- [ ] "How it works" modal opens and closes cleanly.
- [ ] Model status indicator reflects actual download state (loading/missing/ready/downloading).
- [ ] Navigation to Setup phase from Welcome works.

### H. Smart Folder Setup (AddSmartFolderModal)

- [ ] "Add Smart Folder" modal opens from the Setup phase.
- [ ] Folder name input accepts text and validates (no empty submit).
- [ ] "Browse" button opens native directory picker and populates path.
- [ ] "Generate Description" button calls AI and populates description field.
- [ ] Adding a folder with a duplicate name or path shows a warning.
- [ ] Successfully added folder appears in the list immediately.
- [ ] Cancel closes modal without side effects.
- [ ] Form resets when modal is re-opened.

### I. Discover Phase and Naming Settings

- [ ] Discover phase loads and shows the drag-and-drop zone and explicit "Select" / "Scan Folder"
      buttons.
- [ ] Naming Settings modal opens and closes.
- [ ] Naming convention dropdown changes (keep-original, date-category, etc.).
- [ ] Date format, case convention, and separator options update the live preview.
- [ ] Closing modal with "Done" preserves selections.

### J. Organize Modals

#### Triage Modal

- [ ] Opens with a list of files to review.
- [ ] Individual file checkboxes toggle selection.
- [ ] "Select All" / "Deselect All" toggle works correctly.
- [ ] "Browse" opens directory picker for destination.
- [ ] "Move" button is disabled when no destination or no files selected.
- [ ] Moving files completes without error and modal closes.
- [ ] Error during move is surfaced (not swallowed silently).

#### Duplicate Resolution Modal

- [ ] Opens showing groups of duplicate files.
- [ ] Each group defaults to keeping the file with the shortest path.
- [ ] Clicking a different file in a group changes the "keep" selection.
- [ ] "Open" and "Reveal in Explorer/Finder" buttons work for each file.
- [ ] "Resolve" processes all groups and modal closes on success.
- [ ] File sizes are displayed and formatted correctly.
- [ ] Empty or malformed groups are filtered out (no crash).

#### Tag Cluster Modal

- [ ] Opens with cluster name in title.
- [ ] Typing a tag and pressing Enter adds it to the list.
- [ ] Duplicate tags are rejected (not added twice).
- [ ] Tags can be removed with the X button.
- [ ] "Apply" is disabled when tag list is empty.
- [ ] Applying tags completes and modal closes.

### K. Unified Search Modal (Full)

- [ ] Modal opens via Ctrl+K / Cmd+K or nav bar search icon.
- [ ] Search input is focused on open.
- [ ] Typing a query triggers search with a brief debounce.
- [ ] Results list renders with file icons, names, and relevance scores.
- [ ] Switching between List, Grid, and Graph views works.
- [ ] "Open" and "Reveal in Explorer/Finder" work from result items.
- [ ] Drag-and-drop files into the search modal triggers intake (if supported).
- [ ] Expanding/collapsing the search panel works without layout breakage.
- [ ] Bulk selection (checkboxes) enables batch actions.

### L. Chat Panel

- [ ] Chat panel opens from the search modal sidebar.
- [ ] Sending a message shows a thinking indicator, then a response.
- [ ] Fast/Deep mode toggle switches and the response style reflects the mode.
- [ ] Persona dropdown changes the active persona.
- [ ] Source citations render with file names, relevance %, and snippets.
- [ ] Clicking a source citation opens or reveals the file.
- [ ] Image sources render inline thumbnails.
- [ ] "New Conversation" resets the chat history.
- [ ] "Stop" button halts a streaming response.
- [ ] Warning banner appears for model issues (e.g., not ready).
- [ ] Conversation sidebar lists past conversations and selecting one loads it.
- [ ] Document scope panel filters which files the chat queries against.

### M. Settings Panel (All Sections)

Open Settings (gear icon or nav bar) and walk through each collapsible section.

#### AI Configuration

- [ ] **Llama Config**: Health badge shows "Ready (GPU)" or "Ready (CPU)" or error state.
- [ ] Model count label is accurate.
- [ ] "Refresh" re-fetches model list without crash.
- [ ] "Show All Models" toggle reveals the full catalog.
- [ ] Downloading a model shows progress; deleting a model removes it from the list.
- [ ] **Model Selection**: Text, Vision, and Embedding model dropdowns populate.
- [ ] Changing the embedding model shows a confirmation dialog warning about rebuild.
- [ ] Confirming the change updates the setting; cancelling reverts.
- [ ] **Chat Persona**: Dropdown lists all personas with descriptions.
- [ ] Changing persona updates the description text below the dropdown.

#### Embeddings and Search

- [ ] **Embedding Rebuild**: Stats load (file count, folder count, model info).
- [ ] "Rebuild Embeddings" button triggers rebuild with progress feedback.
- [ ] "Re-analyze All Files" button triggers reanalysis.
- [ ] Advanced section expands to show "Apply naming on reanalyze" toggle.
- [ ] Embedding model mismatch warning appears when appropriate.
- [ ] **Embedding Behavior**: Scope, Timing, and Policy dropdowns change and persist.
- [ ] **Graph Retrieval**: Graph-boost toggle, weight slider, neighbors, and context-neighbors
      inputs accept valid ranges.
- [ ] Out-of-range values are clamped (not accepted raw).
- [ ] Graph stats load and display.

#### Performance

- [ ] **Auto-Organize**: Toggle enables/disables auto-organize.
- [ ] Confidence threshold slider moves between 50%-95% and displays percentage.
- [ ] **Background Mode**: Toggle enables tray mode.
- [ ] Warning appears when background mode is on but auto-organize is off.
- [ ] **Notifications**: Master toggle enables/disables all notifications.
- [ ] Display mode radio buttons (Both, Desktop, In-App) select correctly.
- [ ] Individual event toggles (analysis complete, organize complete, errors) work.

#### Default Locations

- [ ] Naming convention, date format, case, and separator settings render and save.

#### Application

- [ ] "Launch at startup" toggle works.
- [ ] "Open Logs Folder" opens the correct OS directory.
- [ ] "Export Logs" creates a shareable log file.
- [ ] "Check for Updates" runs without crash (success or "no update" message).
- [ ] **Settings Backup**: "Create Backup" creates a timestamped backup.
- [ ] Backup list loads and displays timestamps.
- [ ] "Restore" from a backup restores settings and shows confirmation.
- [ ] "Delete" removes a backup from the list.
- [ ] "Export Settings" saves a file; "Import Settings" loads it.
- [ ] **API Test**: "Run API Tests" executes and shows pass/fail for each subsystem (files, smart
      folders, analysis history, undo/redo, system monitoring, llama).

#### Settings Persistence

- [ ] Change a setting, close Settings panel, re-open — value persists.
- [ ] Change a setting, restart app — value persists.
- [ ] "Save" button (if shown) is disabled when no changes are pending.

### N. Navigation Bar

- [ ] All phase tabs (Welcome, Setup, Discover, Organize, Complete) render with correct icons and
      labels.
- [ ] Active phase tab is visually highlighted.
- [ ] Transition guards prevent invalid phase jumps (e.g., skipping Setup).
- [ ] Health status indicator shows AI readiness state.
- [ ] Settings gear icon opens/closes the settings panel.
- [ ] Search shortcut (Ctrl+K / Cmd+K) works from any phase.
- [ ] Update indicator appears when an app update is available.
- [ ] Window title bar drag region works (frameless window).
- [ ] macOS traffic lights are not obscured.

### O. UI Components (Visual Spot-Check)

- [ ] **Buttons**: Primary, secondary, ghost, destructive variants all render distinctly.
- [ ] Disabled buttons are visually muted and non-interactive.
- [ ] Loading state buttons show spinner and are non-interactive.
- [ ] **IconButtons**: Render icons at correct size with hover/focus states.
- [ ] **SidePanel**: Opens from the correct edge, scrolls internally, close button works.
- [ ] **AlertBox**: Info, warning, error, and success variants render with correct colors and icons.
- [ ] **SelectionCard**: Selected state is visually distinct from unselected.
- [ ] **Modals**: Overlay darkens background, Escape key closes, click-outside closes (where
      enabled).

---

## 3) Automated Test Commands

Run these locally before opening a PR.

```powershell
# Formatting and lint
npm run format:check
npm run lint

# Unit/integration tests
npm test

# Optional deeper coverage
npm run test:integration
npm run test:coverage

# Optional E2E (slower)
npm run build
npm run test:e2e
```

Notes:

- `npm run ci` runs the core quality gates: `format:check`, `lint`, `test:coverage`,
  `verify:ipc-handlers`, and `build`. CI additionally runs E2E tests (`test:e2e`) and IPC channel
  sync (`generate:channels:check`).
- Use targeted test commands when iterating (`npm test -- <pattern>`).

---

## 4) Critical Test Focus Areas

Prioritize these paths when time is limited:

1. **Analysis pipeline**: import -> validate -> extract -> classify -> render results.
2. **Organization safety**: suggest -> apply move -> undo/rollback.
3. **Search quality**: semantic search relevance and ranking stability.
4. **Chat accuracy**: persona behavior, citation rendering, Fast vs Deep mode.
5. **Settings round-trip**: change -> persist -> restart -> verify.
6. **IPC resilience**: renderer/main interactions under repeated rapid actions.

---

## 5) Debugging and Troubleshooting

### Log Locations

- **Windows:** `%APPDATA%/StratoSort Core/logs/`
- **macOS:** `~/Library/Application Support/StratoSort Core/logs/`
- **Linux:** `~/.config/StratoSort Core/logs/`

### Common Issues

| Symptom                | Probable Cause              | Recommended Fix                                  |
| ---------------------- | --------------------------- | ------------------------------------------------ |
| Analysis never starts  | Models unavailable          | Run `npm run setup:models:check`                 |
| OCR results are poor   | OCR runtime missing/failed  | Run `npm run setup:vision-runtime:check`         |
| Test flakiness         | Stale build artifacts       | Run `npm run clean` then re-run tests            |
| Build/test environment | Dependency drift            | Run `npm ci` to restore lockfile-based install   |
| Settings don't persist | localStorage quota full     | Clear app data or check console for quota errors |
| Graph view blank       | No embeddings built         | Run embedding rebuild from Settings              |
| Chat returns empty     | Model not loaded or crashed | Check AI health badge in Settings > AI Config    |

---

## 6) Reporting Bugs

When filing a bug report, include:

1. Reproduction steps (exact sequence).
2. Expected behavior and actual behavior.
3. Environment (OS version, app version, hardware details when relevant).
4. Relevant logs from the paths above.
5. Screenshots or short screen recordings when the issue is visual.
