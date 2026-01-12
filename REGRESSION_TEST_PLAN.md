# ElStratoSort Regression Test Plan

**Version:** 1.0.0  
**Date:** 2026-01-11  
**Purpose:** Comprehensive regression testing to verify all features work correctly before release

---

## Executive Summary

This regression test plan covers all major features and implementations of ElStratoSort to ensure
nothing was unintentionally broken during development. The plan includes:

1. **Automated Tests** (6,172 tests) - Unit and Integration
2. **E2E Tests** (25 test specs) - Playwright-based
3. **Manual Verification** - Critical user flows
4. **Feature-Specific Testing** - Recent changes from CHANGELOG

---

## 🔄 Current Test Baseline

| Category               | Status     | Count       |
| ---------------------- | ---------- | ----------- |
| Unit/Integration Tests | ✅ PASSING | 6,172 tests |
| Test Suites            | ✅ PASSING | 263 suites  |
| ESLint                 | ✅ CLEAN   | 0 errors    |
| Coverage               | ⚠️ 76.4%   | Target: 80% |

---

## 📋 Phase 1: Automated Test Suite

### 1.1 Run Full Test Suite

```powershell
# Run all unit/integration tests
npm test

# Run with coverage report
npm run test:coverage
```

**Expected:** All 6,172 tests pass

### 1.2 Run E2E Tests

```powershell
# Run Playwright E2E tests (requires app to be built)
npm run build
npm run test:e2e

# Run with UI for debugging
npm run test:e2e:ui
```

### 1.3 E2E Test Coverage

| Test File                            | Feature Area                 | Priority    |
| ------------------------------------ | ---------------------------- | ----------- |
| `app-launch.spec.js`                 | Application startup          | 🔴 Critical |
| `analysis-flow.spec.js`              | File analysis pipeline       | 🔴 Critical |
| `analysis-history.spec.js`           | Analysis history persistence | 🟡 High     |
| `dependency-management.spec.js`      | Ollama/ChromaDB deps         | 🔴 Critical |
| `drag-drop.spec.js`                  | Drag and drop file import    | 🟡 High     |
| `error-handling.spec.js`             | Error recovery               | 🔴 Critical |
| `file-import.spec.js`                | File selection/import        | 🔴 Critical |
| `keyboard-navigation.spec.js`        | Keyboard accessibility       | 🟢 Medium   |
| `last-browsed-path.spec.js`          | Path memory                  | 🟢 Medium   |
| `menu-shortcuts.spec.js`             | Application menu             | 🟢 Medium   |
| `naming-strategy.spec.js`            | File naming conventions      | 🟡 High     |
| `navigation.spec.js`                 | Phase navigation             | 🔴 Critical |
| `notifications.spec.js`              | Toast/notification system    | 🟢 Medium   |
| `organize-phase.spec.js`             | File organization            | 🔴 Critical |
| `search-modal.spec.js`               | Search functionality         | 🟡 High     |
| `semantic-search-functional.spec.js` | Vector search                | 🔴 Critical |
| `settings-panel.spec.js`             | Settings persistence         | 🔴 Critical |
| `smart-folder-add.spec.js`           | Smart folder creation        | 🟡 High     |
| `smart-folders.spec.js`              | Smart folder operations      | 🔴 Critical |
| `undo-redo.spec.js`                  | Undo/Redo system             | 🔴 Critical |
| `window-state.spec.js`               | Window persistence           | 🟢 Medium   |

---

## 📋 Phase 2: Critical Feature Verification

### 2.1 Core Features (Must Pass)

#### 🤖 AI Analysis System

| Test   | Description             | How to Verify                             |
| ------ | ----------------------- | ----------------------------------------- |
| ANA-01 | PDF document analysis   | Add PDF, verify AI summary generated      |
| ANA-02 | Image analysis (Vision) | Add image, verify visual content analysis |
| ANA-03 | Batch analysis          | Add 10+ files, verify all analyzed        |
| ANA-04 | Analysis cancellation   | Start batch, cancel, verify clean stop    |
| ANA-05 | Analysis progress       | Verify progress bar updates correctly     |

**Services to verify:**

- `src/main/services/OllamaService.js`
- `src/main/services/OllamaClient.js`
- `src/main/analysis/documentLlm.js`
- `src/main/analysis/ollamaImageAnalysis.js`

#### 📁 Smart Folder System

| Test   | Description                   | How to Verify                             |
| ------ | ----------------------------- | ----------------------------------------- |
| SMT-01 | Create smart folder           | Settings → Smart Folders → Create new     |
| SMT-02 | Folder description embeddings | Verify embeddings generated               |
| SMT-03 | Semantic matching             | Add file, verify correct folder suggested |
| SMT-04 | AI description generation     | Click "Generate with AI" button           |
| SMT-05 | Folder deletion               | Delete folder, verify cleanup             |

**Services to verify:**

- `src/main/services/FolderMatchingService.js`
- `src/main/services/SmartFoldersLLMService.js`
- `src/main/services/chromadb/folderEmbeddings.js`

#### 👁️ Watcher Services

| Test   | Description                | How to Verify                             |
| ------ | -------------------------- | ----------------------------------------- |
| WAT-01 | Download folder watcher    | Enable in settings, add file to Downloads |
| WAT-02 | Smart folder watcher       | Enable, add file to watched folder        |
| WAT-03 | Auto-analyze new files     | Verify analysis triggers automatically    |
| WAT-04 | Watcher confidence scoring | Verify confidence based on folder match   |
| WAT-05 | Temp file filtering        | Add .tmp file, verify ignored             |

**Critical fixes verified:**

- ✅ Race condition: watcher null during IPC registration (NEW-1)
- ✅ DownloadWatcher starting before services initialized (C-2)
- ✅ Watcher reporting high confidence for unrelated files (NEW-11)

**Services to verify:**

- `src/main/services/DownloadWatcher.js`
- `src/main/services/SmartFolderWatcher.js`
- `src/main/services/confidence/watcherConfidence.js`

#### ↩️ Undo/Redo System

| Test   | Description               | How to Verify                         |
| ------ | ------------------------- | ------------------------------------- |
| UND-01 | Single file undo          | Move file, undo, verify restored      |
| UND-02 | Batch undo                | Move multiple files, undo all         |
| UND-03 | Redo operation            | Undo then redo, verify re-applied     |
| UND-04 | History navigation        | Jump to specific point in history     |
| UND-05 | Concurrent operation lock | Verify mutex prevents race conditions |

**Critical fixes verified:**

- ✅ UI not updating despite filesystem changes (H-3)
- ✅ Race condition allowing concurrent action execution

**Services to verify:**

- `src/main/services/UndoRedoService.js`
- `src/renderer/components/UndoRedoSystem.jsx`

#### 🔍 Search & Embeddings

| Test   | Description              | How to Verify                   |
| ------ | ------------------------ | ------------------------------- |
| SRC-01 | Semantic search          | Ctrl+K, search by meaning       |
| SRC-02 | Graph visualization      | Verify nodes/edges render       |
| SRC-03 | List view toggle         | Switch between graph/list       |
| SRC-04 | Autocomplete suggestions | Type, verify suggestions appear |
| SRC-05 | Embedding count display  | Verify correct count shown      |

**Critical fixes verified:**

- ✅ Embeddings showing "0" count (NEW-2/9)

**Services to verify:**

- `src/main/services/SearchService.js`
- `src/main/services/chromadb/ChromaDBServiceCore.js`
- `src/main/services/ParallelEmbeddingService.js`

---

### 2.2 Recent Bug Fixes (CHANGELOG Verification)

These fixes were implemented recently and need explicit verification:

| ID        | Fix Description                       | Verification Steps                        |
| --------- | ------------------------------------- | ----------------------------------------- |
| NEW-1     | SmartFolderWatcher race condition     | Enable watcher on fresh start             |
| NEW-5/12  | Confidence slider resetting to 75%    | Change slider, navigate away, return      |
| NEW-10    | Image files missing keywords          | Analyze image, check history entry        |
| H-1       | Smart folder path showing "Documents" | Create folder with custom path            |
| H-2       | Settings debounce flushing on close   | Change setting, close immediately         |
| F-3/M-1   | Modal backdrop blur/z-index           | Open multiple modals, verify stacking     |
| LLM-CACHE | Cache contamination across file types | Analyze doc then image with similar names |
| BULK-CAT  | Stale closure in bulk category change | Select files, change category in bulk     |

---

## 📋 Phase 3: Settings & Configuration

### 3.1 Settings Persistence

| Test   | Description          | Expected               |
| ------ | -------------------- | ---------------------- |
| SET-01 | Theme change         | Persists after restart |
| SET-02 | Model selection      | Persists after restart |
| SET-03 | Watch folder toggles | Persists after restart |
| SET-04 | Naming strategy      | Persists after restart |
| SET-05 | Smart folders        | Persists after restart |

### 3.2 Settings Backup/Export/Import

| Test   | Description       | Expected                    |
| ------ | ----------------- | --------------------------- |
| BKP-01 | Create backup     | Backup file created         |
| BKP-02 | Restore backup    | Settings restored correctly |
| EXP-01 | Export settings   | JSON file exported          |
| IMP-01 | Import settings   | Settings applied correctly  |
| IMP-02 | Import validation | Invalid settings rejected   |

**Services to verify:**

- `src/main/services/SettingsService.js`
- `src/main/services/SettingsBackupService.js`

---

## 📋 Phase 4: UI/UX Verification

### 4.1 Phase Navigation

| Phase    | Entry Point           | Exit Condition          |
| -------- | --------------------- | ----------------------- |
| Welcome  | App start (first run) | Click "Get Started"     |
| Setup    | Complete welcome      | Configure smart folders |
| Discover | Add files             | Files analyzed          |
| Organize | Review suggestions    | Apply changes           |
| Complete | Files organized       | View summary            |

### 4.2 Error Boundaries

| Test   | Description             | Expected                              |
| ------ | ----------------------- | ------------------------------------- |
| ERR-01 | Malformed file data     | Error boundary catches, app continues |
| ERR-02 | Analysis failure        | Error shown, other files continue     |
| ERR-03 | Network error (offline) | App functions 100% offline            |

### 4.3 Accessibility

| Test    | Description           | Expected                |
| ------- | --------------------- | ----------------------- |
| A11Y-01 | Screen reader support | `aria-live` on progress |
| A11Y-02 | Keyboard navigation   | All features accessible |
| A11Y-03 | Focus management      | Focus moves logically   |

---

## 📋 Phase 5: Integration Points

### 5.1 Ollama Integration

| Test   | Description        | Expected                    |
| ------ | ------------------ | --------------------------- |
| OLL-01 | Connection check   | Detects running Ollama      |
| OLL-02 | Model availability | Lists available models      |
| OLL-03 | Model download     | Progress shown, model works |
| OLL-04 | Analysis request   | Returns valid response      |
| OLL-05 | Retry on failure   | Retries with backoff        |

### 5.2 ChromaDB Integration

| Test   | Description           | Expected                    |
| ------ | --------------------- | --------------------------- |
| CHR-01 | Service startup       | ChromaDB starts correctly   |
| CHR-02 | Embedding storage     | Embeddings persist          |
| CHR-03 | Query response        | Returns similar files       |
| CHR-04 | Health check          | Health endpoint responds    |
| CHR-05 | Collection management | Collections created/managed |

---

## 📋 Phase 6: Edge Cases & Resilience

### 6.1 File Edge Cases

| Test   | Description              | Expected                      |
| ------ | ------------------------ | ----------------------------- |
| EDG-01 | 0-byte file              | Handled gracefully            |
| EDG-02 | Very large file (>100MB) | Timeout/warning, no crash     |
| EDG-03 | Corrupted PDF            | Error logged, continue        |
| EDG-04 | Unicode filename         | Handled correctly             |
| EDG-05 | Long path (>260 chars)   | Handled correctly             |
| EDG-06 | Read-only file           | Clear error message           |
| EDG-07 | File in use              | "File in use" handled (NEW-4) |

### 6.2 System Edge Cases

| Test   | Description       | Expected            |
| ------ | ----------------- | ------------------- |
| SYS-01 | Offline mode      | App works 100%      |
| SYS-02 | Low disk space    | Warning shown       |
| SYS-03 | Permission denied | Clear error message |
| SYS-04 | Cross-device move | Works correctly     |

---

## 📋 Phase 7: Performance Verification

### 7.1 Performance Tests

```powershell
# Run performance tests
npm run test:perf

# Run stress tests
npm run test:stress
```

### 7.2 Performance Benchmarks

| Metric            | Target    | How to Verify             |
| ----------------- | --------- | ------------------------- |
| App startup       | <5s       | Time from launch to ready |
| File analysis     | <10s/file | Average analysis time     |
| Search response   | <500ms    | Time to show results      |
| Memory usage      | <500MB    | Check Task Manager        |
| UI responsiveness | 60fps     | No jank during operations |

---

## ✅ Test Execution Checklist

### Pre-Test Setup

- [ ] Clean build: `npm run build`
- [ ] Fresh app data: Delete `%APPDATA%/stratosort`
- [ ] Ollama running: `ollama serve`
- [ ] Models available: `ollama list`

### Automated Tests

- [ ] `npm run lint` - 0 errors
- [ ] `npm test` - All 6,172 tests pass
- [ ] `npm run test:e2e` - All E2E tests pass
- [ ] `npm run test:perf` - Performance targets met
- [ ] `npm run test:stress` - Stress tests pass

### Manual Tests

- [ ] Phase 2: All critical features verified
- [ ] Phase 3: Settings persistence verified
- [ ] Phase 4: UI/UX flows verified
- [ ] Phase 5: Integration points verified
- [ ] Phase 6: Edge cases handled
- [ ] Phase 7: Performance acceptable

---

## 🐛 Issue Tracking

### Found Issues

| ID  | Severity | Description | Status |
| --- | -------- | ----------- | ------ |
|     |          |             |        |

### Regression Notes

| Feature | Was Working | Still Working | Notes |
| ------- | ----------- | ------------- | ----- |
|         |             |               |       |

---

## 📊 Sign-Off

| Role      | Name | Date | Status |
| --------- | ---- | ---- | ------ |
| Tester    |      |      |        |
| Developer |      |      |        |
| Reviewer  |      |      |        |

---

## Appendix A: Test Commands Quick Reference

```powershell
# Full test suite
npm test

# With coverage
npm run test:coverage

# E2E tests
npm run test:e2e

# E2E with UI
npm run test:e2e:ui

# E2E debug mode
npm run test:e2e:debug

# Performance tests
npm run test:perf

# Stress tests
npm run test:stress

# All tests
npm run test:all

# Lint
npm run lint

# Build
npm run build

# Dev mode
npm run dev
```

## Appendix B: Key File Locations

```
src/main/services/          # Backend services
src/main/ipc/               # IPC handlers
src/main/analysis/          # AI analysis
src/renderer/components/    # UI components
src/renderer/phases/        # Phase logic
src/renderer/store/         # Redux state
src/shared/                 # Shared utilities
test/                       # Unit/Integration tests
test/e2e/                   # Playwright E2E tests
```

## Appendix C: Naming Convention Systems

Per memory [[memory:12222694]], ElStratoSort has two independent naming systems:

1. **Settings-based (Persistent)**: Controls DownloadWatcher, SmartFolderWatcher, and Reanalyze
   operations via SettingsService
2. **Discover-phase (Session-based)**: Controls manual analysis UI via Redux state

These do NOT sync intentionally - verify both work independently.
