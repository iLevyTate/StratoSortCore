# StratoSort - Plans Document

This document contains two plans:

1. **Documentation Plan**: Update the manual testing documentation with test results
2. **Bug Fix Plan**: Fix the issues discovered during manual testing

---

## Plan 1: Update Manual Testing Documentation

### Goal

Update `docs/MANUAL_TEST_PLAN.md` with the test results from sections 1-3.3, and add detailed issue
documentation.

### Tasks

#### 1.1 Update Test Results (Sections 1-3.3)

Update each test table with PASS/FAIL/SKIP status and notes:

**Section 1.1 - Initial Launch**

- App window appears: PASS
- No console errors: PASS
- Splash/loading completes: PASS

**Section 1.2 - Service Initialization**

- Ollama connection: PASS
- ChromaDB starts: PASS
- Models detected: PASS

**Section 1.3 - Window Controls**

- Minimize button: PASS
- Maximize button: PASS (note: size change negligible 1280×799 → 1280×800)
- Close button: PASS
- Window state persisted: SKIP (not confirmed)

**Section 2.1 - Phase Navigation**

- Welcome/Setup phase visible: PASS
- Discover phase accessible: PASS
- Organize phase accessible: PASS
- Complete phase accessible: PASS
- Navigation indicators: PASS

**Section 2.2 - Theme & Appearance**

- Light theme works: FAIL (no visible option)
- Dark theme works: FAIL (no visible option)
- Theme toggle: FAIL (toggle not found)
- Theme persisted: SKIP (can't validate without toggle)

**Section 2.3 - Responsive Layout**

- Window resize: FAIL (navbar/header doesn't respond, phases clipped)
- Minimum size enforced: SKIP (not tested)
- Scrolling works: PASS

**Section 3.1 - Smart Folder Management**

- Add smart folder: FAIL (requires existing target path)
- Edit folder name: PASS
- Edit folder description: PASS
- Delete smart folder: SKIP (not tested)
- Folder list displays: PASS

**Section 3.2 - Target Folder Selection**

- Browse for folder: PASS
- Select destination: PASS
- Path validation: SKIP (not tested)
- Default path: FAIL (shows Documents but doesn't create folder)

**Section 3.3 - Folder Descriptions (AI-Enhanced)**

- Auto-generate description: FAIL (feature not visible)
- Manual description entry: PASS
- Description saved: PASS

#### 1.2 Add Issues Found Section

Populate the "Issues Found" tables with priority-categorized issues:

**Critical (Blocking)**: None

**High Priority**:

1. Theme system missing/inaccessible - No toggle, no visible modes
2. **Issue 3.1-A**: Target path must already exist on filesystem - App requires folders to exist
   before creating smart folders; breaks "create & configure inside app" expectation
3. **Issue 3.1-B**: App doesn't create missing target paths - Even when explicitly typing a path,
   app errors with "can't find this location" instead of creating it
4. Responsive layout issues - Navbar/header not responsive, phases clipped on resize

**Medium Priority**: 5. **Issue 3.1-C**: Too many rebuild options - Excessive rebuild controls
overwhelm users; UI feels developer-facing 6. Default path behavior incorrect - Documents shown but
folder not created 7. Auto-generate description not implemented - AI suggestion feature not
visible 8. Smart Folder modal visual glitch - Blur layer, black line, flicker

**Low Priority / Enhancements**: 9. Double splash screens - Two splash screens appear during
startup 10. Maximize behavior feels ineffective - Only ~1px size difference

#### 1.3 Add Test Session Log Entry

Add entry with:

- Date: (current date)
- Tester: Manual
- Version: Current
- Notes: Sections 1-3.3 completed

---

## Plan 2: Fix Issues Found During Manual Testing

### Issue Priority Order

| Priority | Issue ID | Issue                                     | Effort | Files Involved                                                                          |
| -------- | -------- | ----------------------------------------- | ------ | --------------------------------------------------------------------------------------- |
| High     | 2.1      | Theme toggle missing                      | Medium | `SettingsPanel.jsx`, `NavigationBar.jsx`, `uiSlice.js`, `tailwind.css`                  |
| High     | 3.1-A    | Target path must exist (hard requirement) | Medium | `SmartFolderItem.jsx`, `AddSmartFolderModal.jsx`, `smartFolders.js`, `customFolders.js` |
| High     | 3.1-B    | App doesn't create missing target paths   | Medium | `smartFolders.js`, `customFolders.js`                                                   |
| High     | 2.3      | Navbar responsiveness                     | Medium | `NavigationBar.jsx`, `tailwind.css`                                                     |
| Medium   | 3.1-C    | Too many rebuild options (UX)             | Low    | `SetupPhase.jsx`, `SmartFolderItem.jsx`                                                 |
| Medium   | 3.1-D    | Rebuild terminology unclear               | Low    | `SetupPhase.jsx`, `SmartFolderItem.jsx`                                                 |
| Medium   | 2.4      | Default path not created                  | Low    | `smartFolders.js`, `customFolders.js`                                                   |
| Medium   | 2.5      | Auto-generate description                 | Medium | `SmartFolderItem.jsx`, new IPC handler                                                  |
| Medium   | 2.6      | Modal visual glitches                     | Low    | `Modal.jsx`, CSS                                                                        |
| Low      | 2.7      | Double splash screens                     | Low    | `index.html`, `index.js`, `simple-main.js`                                              |
| Low      | 2.8      | Maximize behavior                         | Low    | `createWindow.js`, `windowState.js`                                                     |

---

### Fix 2.1: Theme Toggle Missing

**Problem**: No visible theme toggle in UI, light/dark modes not accessible.

**Root Cause Analysis**:

- `uiSlice.js` has theme state (`'light' | 'dark' | 'system'`)
- `tailwind.css` has CSS variables for theming
- But no UI control exposes the toggle

**Solution**:

1. **Add theme toggle to Settings Panel** (`src/renderer/components/SettingsPanel.jsx`)
   - Add a "Theme" section with radio/select for light/dark/system
   - Wire it to Redux `setTheme` action

2. **Add quick toggle to Navigation Bar** (`src/renderer/components/NavigationBar.jsx`)
   - Add a sun/moon icon button near settings
   - Click cycles through themes

3. **Ensure theme CSS classes apply** (`src/renderer/index.js` or `App.js`)
   - On theme change, apply `.theme-light` or `.theme-dark` class to document root
   - Handle `system` preference with `prefers-color-scheme` media query

4. **Verify CSS variables** (`src/renderer/tailwind.css`)
   - Ensure both light and dark variants are defined
   - Add any missing color tokens for light mode

**Files to modify**:

- `src/renderer/components/SettingsPanel.jsx`
- `src/renderer/components/NavigationBar.jsx`
- `src/renderer/store/slices/uiSlice.js`
- `src/renderer/tailwind.css`
- `src/renderer/App.js` (or index.js)

---

### Fix 2.2: Smart Folder Target Path Issues

This fix addresses three related issues discovered during testing:

---

#### Issue 3.1-A: Target path must already exist on filesystem (hard requirement)

**What was observed**: Cannot select/use a target path unless that folder already exists on disk.

**Why it's a problem**: The app's smart-folder workflow effectively depends on external manual
filesystem setup, which breaks the "create & configure inside the app" expectation.

**Impact**: Users hit a blocker when creating a new smart folder for a category that doesn't already
exist.

**Repro steps**:

1. Attempt to create a smart folder with a new target path (e.g., `Documents/<Name>`)
2. App fails because path is missing
3. Manually create the folder in the OS
4. Try again → now it works

---

#### Issue 3.1-B: App does not create missing target paths even when explicitly entered

**What was observed**: Even if you type a path like `Documents/<whatever>` directly (not using
auto-create), the app still errors with "can't find this location," instead of creating it.

**Why it's a problem**: The expected behavior is that the app should create the folder when it
doesn't exist—especially when the user has clearly defined the destination.

**Impact**: Prevents users from creating new smart folders unless they leave the app and do
filesystem prep.

**Likely failure modes (implementation-side)**:

- Validation is only checking existence and rejecting, with no `mkdir` step
- Or the path being checked isn't the same path the UI shows (normalization/quoting/env/sandbox
  mismatch)

---

#### Issue 3.1-C: Too many rebuild options; risk of overwhelming users

**What was observed**: There are many rebuild-related controls/options at the top of the Smart
Folders screen and inside individual smart folder settings.

**Why it's a problem**: The UI complexity increases cognitive load and makes the feature feel
"developer-facing" rather than user-friendly.

**Impact**: Users may be confused or intimidated by options they don't understand, leading to
avoidance of the feature.

---

#### Issue 3.1-D: Rebuild terminology is unclear (folders vs files is ambiguous)

**What was observed**: "Rebuilding folders" vs "rebuilding files" isn't specific enough; unclear
what each rebuild does and when to use it.

**Why it's a problem**: Users can't predict the outcome, and "rebuild" sounds destructive/risky
without clear boundaries.

**Impact**: Users avoid the feature or use it incorrectly; support burden increases.

**Suggested direction**:

- Replace with more intuitive method (e.g., guided action labels like "Re-scan sources" vs
  "Recompute tags" vs "Rebuild index")

---

**Root Cause Analysis**:

- `AddSmartFolderModal.jsx` or `SmartFolderItem.jsx` validates path existence and blocks on failure
- No `fs.mkdir` call exists in the save/create flow
- Path normalization may differ between UI display and validation check
- UI exposes too many technical options that should be hidden or consolidated

**Solution**:

1. **Remove path existence requirement during creation** (Issue 3.1-A)
   - Change validation from "must exist" to "will be created if missing"
   - Generate default path: `Documents/<folder-name>`

2. **Create folder on filesystem when needed** (Issue 3.1-B)
   - Add IPC handler `smart-folders:ensure-path`
   - Called when user confirms creation or during organize phase
   - Uses `fs.mkdir` with `{ recursive: true }`
   - Ensure path normalization is consistent between UI and backend

3. **Update validation logic** (Issue 3.1-A, 3.1-B)
   - Path validation should warn (not block) if path doesn't exist
   - Show "Will be created" indicator instead of error
   - Offer explicit "Create folder" action if user prefers

4. **Simplify rebuild options UI** (Issue 3.1-C)
   - Hide advanced rebuild options behind an "Advanced" toggle or settings section
   - Consolidate multiple rebuild buttons into single "Refresh" action
   - Remove or relocate developer-facing controls from main smart folder UI
   - Consider moving rebuild options to Settings panel instead

**Files to modify**:

- `src/renderer/components/setup/AddSmartFolderModal.jsx`
- `src/renderer/components/setup/SmartFolderItem.jsx`
- `src/renderer/phases/SetupPhase.jsx` (for rebuild options cleanup)
- `src/main/ipc/smartFolders.js`
- `src/main/core/customFolders.js`

---

### Fix 2.3: Navbar/Header Responsiveness

**Problem**: Header/navbar doesn't respond well to window resize; phases get clipped.

**Root Cause Analysis**:

- `NavigationBar.jsx` may have fixed widths
- Phase buttons may not wrap or collapse on smaller screens

**Solution**:

1. **Add responsive breakpoints to navbar**
   - Use Tailwind responsive classes
   - Collapse phase names to icons at smaller widths
   - Add horizontal scroll or hamburger menu for very small sizes

2. **Fix phase button overflow**
   - Use `flex-wrap` or `overflow-x-auto` with scroll
   - Truncate long phase names with ellipsis
   - Consider dropdown for phases on mobile

3. **Update CSS variables**
   - Make `--app-nav-height` responsive
   - Add media queries for different viewport sizes

**Files to modify**:

- `src/renderer/components/NavigationBar.jsx`
- `src/renderer/tailwind.css`

---

### Fix 2.4: Default Path Not Created

**Problem**: Documents shows as default but folder is not created on filesystem.

**Root Cause Analysis**:

- Default path is displayed in UI but never created
- `customFolders.js` doesn't auto-create directories

**Solution**:

1. **Add path creation during smart folder save**
   - When saving a smart folder, check if target path exists
   - If not, create it with `fs.mkdir({ recursive: true })`

2. **Add UI indication**
   - Show "Will be created" badge if path doesn't exist
   - Confirm folder creation with user

**Files to modify**:

- `src/main/ipc/smartFolders.js`
- `src/main/core/customFolders.js`
- `src/renderer/components/setup/SmartFolderItem.jsx`

---

### Fix 2.5: Auto-Generate Description Feature

**Problem**: "AI suggest folder description" feature not visible in UI.

**Root Cause Analysis**:

- Feature may not be implemented
- Or UI button/action not wired up

**Solution**:

1. **Add "Generate Description" button to SmartFolderItem**
   - Add sparkle/magic wand icon button next to description field
   - Shows loading state while generating

2. **Create IPC handler for description generation**
   - `smart-folders:generate-description`
   - Takes folder name and path
   - Uses Ollama to generate appropriate description
   - Returns suggested description text

3. **Wire up Redux action**
   - Add async thunk for description generation
   - Update UI on success/failure

**Files to modify**:

- `src/renderer/components/setup/SmartFolderItem.jsx`
- `src/main/ipc/smartFolders.js` (add new handler)
- `src/main/services/OllamaService.js` (add generation method if needed)

---

### Fix 2.6: Modal Visual Glitches

**Problem**: Blur layer behind modal, black line over "Configure smart folders", flicker on
interaction.

**Root Cause Analysis**:

- CSS stacking context issues
- Possible z-index conflicts
- Animation/transition causing flicker

**Solution**:

1. **Fix backdrop/overlay stacking**
   - Ensure modal portal renders at document root
   - Set explicit z-index hierarchy
   - Check for conflicting backdrop-filter usage

2. **Remove/fix black line artifact**
   - Inspect CSS borders on modal and parent elements
   - Check for box-shadow or pseudo-element issues

3. **Fix flicker**
   - Add `will-change: transform` for animated elements
   - Use `transform: translateZ(0)` for GPU acceleration
   - Check for re-render causes in React

**Files to modify**:

- `src/renderer/components/Modal.jsx`
- `src/renderer/tailwind.css`
- `src/renderer/components/setup/AddSmartFolderModal.jsx` (if specific to this modal)

---

### Fix 2.7: Double Splash Screens

**Problem**: Two splash screens appear ("StratoSort starting" then another).

**Root Cause Analysis**:

- Possibly separate splash in `index.html` + another created by main process
- Or splash logic runs twice

**Solution**:

1. **Consolidate to single splash**
   - Keep only the HTML-based splash in `index.html`
   - Remove any secondary splash creation in `simple-main.js`
   - Or remove HTML splash and use only Electron BrowserWindow splash

2. **Ensure single removal**
   - Check `removeSplashScreen()` guards
   - Verify splash isn't being created after initial one removed

**Files to modify**:

- `src/renderer/index.html`
- `src/renderer/index.js`
- `src/main/simple-main.js`

---

### Fix 2.8: Maximize Behavior Ineffective

**Problem**: Maximize only changes size by ~1px (1280×799 → 1280×800).

**Root Cause Analysis**:

- Window may already be near-maximized
- `electron-window-state` may be saving "maximized" size as default
- Platform-specific maximize behavior

**Solution**:

1. **Check window state persistence**
   - Ensure `electron-window-state` doesn't save maximized bounds as default
   - Reset to reasonable default size on fresh install

2. **Review maximize implementation**
   - Check `window.maximize()` is called correctly
   - Verify no size constraints blocking proper maximize

3. **Test on different displays**
   - Issue may be display-specific
   - Add proper multi-monitor handling

**Files to modify**:

- `src/main/core/createWindow.js`
- `src/main/core/windowState.js`
- `src/main/ipc/window.js`

---

## Implementation Order (Recommended)

1. **Phase 1 - High Priority** (Do first)
   - Fix 2.1: Theme toggle
   - Fix 2.2: Smart folder target path issues (covers 3.1-A, 3.1-B, and 3.1-C)
   - Fix 2.3: Navbar responsiveness

2. **Phase 2 - Medium Priority**
   - Fix 2.4: Default path creation
   - Fix 2.5: Auto-generate description
   - Fix 2.6: Modal visual glitches

3. **Phase 3 - Low Priority**
   - Fix 2.7: Double splash screens
   - Fix 2.8: Maximize behavior

### Implementation Notes for Smart Folder Fixes (3.1-A, 3.1-B, 3.1-C)

These three issues are closely related and should be fixed together:

1. **Start with backend** (`smartFolders.js`, `customFolders.js`):
   - Add `ensurePath` IPC handler that creates directories
   - Modify save logic to auto-create paths
   - Fix path normalization consistency

2. **Then update frontend** (`AddSmartFolderModal.jsx`, `SmartFolderItem.jsx`):
   - Change validation from blocking to warning
   - Add "Will be created" indicator
   - Remove "path not found" error state

3. **Finally simplify UI** (`SetupPhase.jsx`):
   - Audit rebuild options and consolidate
   - Move advanced options to Settings or behind toggle
   - Keep only essential user-facing controls visible

---

## Testing After Fixes

After implementing each fix:

1. Re-run the relevant test from `MANUAL_TEST_PLAN.md`
2. Update status to PASS
3. Clear notes if issue resolved
4. Remove issue from "Issues Found" section

---

## Notes

- All fixes should maintain backward compatibility
- Settings/data persistence must not be affected
- Test on both Windows and Mac where applicable
- Consider adding automated tests for critical functionality
