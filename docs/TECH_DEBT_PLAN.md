# Comprehensive Tech Debt & Deduplication Plan

## Executive Summary

Analysis of the elstratosort codebase identified **6 major areas** of technical debt and code
duplication. This plan organizes remediation into **4 phases** by priority and risk level.

**Estimated Impact:**

- ~500+ lines of duplicate code to remove
- 116+ test files with duplicate mocks to consolidate
- 5+ validation schema inconsistencies to fix
- 2 services to migrate to shared singleton factory

---

## Phase 1: Critical Fixes (High Priority, Low Risk)

### 1.1 Validation Schema Inconsistencies

**Problem:** Same validation rules defined differently across files, causing potential bugs.

| Issue                           | Files                                         | Fix                        |
| ------------------------------- | --------------------------------------------- | -------------------------- |
| Theme enum missing 'auto'       | `src/shared/config/configSchema.js:494`       | Add 'auto' to values array |
| maxBatchSize min value (0 vs 1) | `validationSchemas.js` vs `securityConfig.js` | Standardize to min: 1      |
| 5 different theme definitions   | See below                                     | Create single source       |

**Files with theme validation:**

1. `src/main/ipc/validationSchemas.js:148`
2. `src/shared/settingsValidation.js:22`
3. `src/shared/securityConfig.js:153`
4. `src/main/ipc/settings.js:93-94`
5. `src/shared/config/configSchema.js:494` (MISSING 'auto')

**Action:** Create `src/shared/validationConstants.js`:

```javascript
// Single source of truth for validation enums
const THEME_VALUES = ['light', 'dark', 'auto', 'system'];
const LOGGING_LEVELS = ['error', 'warn', 'info', 'debug'];
const NUMERIC_RANGES = {
  cacheSize: { min: 0, max: 100000 },
  maxBatchSize: { min: 1, max: 100000 }
};
```

### 1.2 URL Pattern Consolidation

**Problem:** 4+ different URL regex patterns across codebase.

**Files:**

- `src/shared/settingsValidation.js:14` - URL_PATTERN
- `src/main/ipc/ollama.js:14-15` - OLLAMA_URL_PATTERN (verbose)
- `src/shared/securityConfig.js:167` - url regex
- `src/shared/config/configValidation.js` - validateServiceUrl

**Action:** Consolidate to `src/shared/validationConstants.js`:

```javascript
const URL_PATTERNS = {
  general: /^https?:\/\/...$/,
  ollama: /^https?:\/\/...$/ // If truly different requirements
};
```

---

## Phase 2: Service Layer Cleanup (High Priority, Medium Risk)

### 2.1 Singleton Pattern Migration

**Problem:** 2 services use custom singleton patterns instead of shared factory.

| Service                  | Current Pattern                | Action                                |
| ------------------------ | ------------------------------ | ------------------------------------- |
| SettingsService          | Manual `let singletonInstance` | Migrate to `createSingletonHelpers()` |
| DependencyManagerService | Manual `let singletonInstance` | Migrate to `createSingletonHelpers()` |

**Already Using Factory (Good):**

- OllamaClient ✓
- OllamaService ✓
- ChromaDB ✓
- ParallelEmbeddingService ✓

### 2.2 Error Classification Consolidation

**Problem:** Error code classification duplicated in multiple places.

**Duplicate Locations:**

1. `src/shared/errorClassifier.js` - Centralized (USE THIS)
2. `src/main/utils/ollamaApiRetry.js:35-105` - `isRetryableError()` duplicates logic
3. Multiple services checking `error.code === 'ENOENT'` inline

**Action:**

1. Update `ollamaApiRetry.js` to use `errorClassifier.isRetryable()`
2. Replace all inline `error.code === 'ENOENT'` checks with `errorClassifier.isFileNotFound()`

**Files with inline error code checks:**

- `src/main/services/DownloadWatcher.js` (3 locations)
- `src/main/services/SettingsService.js:743`
- `src/main/services/ProcessingStateService.js:92`
- `src/main/services/organization/persistence.js:46`
- `src/main/services/UndoRedoService.js:60`
- `src/main/services/chromadb/ChromaDBServiceCore.js:1157`

### 2.3 Retry Logic Consolidation

**Problem:** Multiple retry implementations with same exponential backoff pattern.

**Current State:**

- `src/shared/promiseUtils.js` - `withRetry()` (CANONICAL)
- `src/main/utils/ollamaApiRetry.js` - `withOllamaRetry()` (adds Ollama-specific features)
- `src/main/services/startup/StartupManagerCore.js` - Manual retry loop
- `src/main/services/chromadb/ChromaHealthChecker.js` - Manual retry loop

**Action:**

1. Keep `promiseUtils.withRetry()` as base implementation
2. Keep `ollamaApiRetry.withOllamaRetry()` as thin wrapper (already done)
3. Refactor StartupManagerCore to use `withRetry()`
4. Refactor ChromaHealthChecker to use `withRetry()`

---

## Phase 3: IPC Handler Refactoring (Medium Priority, Medium Risk)

### 3.1 Analysis Handler Consolidation

**Problem:** `src/main/ipc/analysis.js` has 400+ lines of duplicated logic between document and
image analysis handlers.

**Duplications:**

- Error context building (3x identical)
- File stats collection (4x identical)
- Processing state lifecycle (8x repeated)
- Error response format (4x identical)

**Action:** Create shared utilities:

```javascript
// src/main/ipc/analysisUtils.js

// Wrapper for processing state lifecycle
async function withProcessingState(filePath, processingState, fn) {
  try {
    await processingState?.markAnalysisStart(filePath);
    const result = await fn();
    await processingState?.markAnalysisComplete(filePath);
    return result;
  } catch (error) {
    await processingState?.markAnalysisError(filePath, error.message);
    throw error;
  } finally {
    await processingState?.clearState(filePath);
  }
}

// File stats and history recording
async function recordFileAnalysis(filePath, result, historyService) { ... }

// Standard fallback response
function createAnalysisFallback(filePath, type) { ... }
```

### 3.2 Error Response Standardization

**Problem:** Inconsistent error response formats across IPC handlers.

**Current Patterns:**

- `createErrorResponse()` wrapper (organize.js, analysisHistory.js) ✓
- Raw error objects (analysis.js) ✗
- `{success: false, error}` format (semantic.js) ✗

**Action:** Ensure all handlers use `createErrorResponse()` from `ipcWrappers.js`.

### 3.3 Initialization Retry Extraction

**Problem:** `src/main/ipc/semantic.js` has ad-hoc initialization retry logic (lines 28-93).

**Action:** Extract to reusable wrapper:

```javascript
// src/main/utils/initializationUtils.js
async function withInitializationRetry(initFn, options) {
  // Memoized initialization with retry
}
```

---

## Phase 4: Test Infrastructure (Medium Priority, Low Risk)

### 4.1 Centralize Test Mocks

**Problem:** Same mocks duplicated across 116+ test files.

| Mock                 | Files Affected | Action                                      |
| -------------------- | -------------- | ------------------------------------------- |
| Logger               | 116+ files     | Create `test/mocks/logger.js`               |
| Electron             | 42 files       | Create `test/mocks/electron.js`             |
| fs                   | 34 files       | Create `test/mocks/fs.js`                   |
| axios                | 6 files        | Create `test/mocks/axios.js`                |
| performanceConstants | 16 files       | Create `test/mocks/performanceConstants.js` |

**Action:** Create `test/mocks/` directory:

```javascript
// test/mocks/logger.js
module.exports = {
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
};

// test/mocks/index.js
module.exports = {
  mockLogger: require('./logger'),
  mockElectron: require('./electron'),
  mockFs: require('./fs')
  // ...
};
```

**Usage in tests:**

```javascript
jest.mock('../src/shared/logger', () => require('./mocks/logger'));
```

### 4.2 Expand test-setup.js

The existing `test/test-setup.js` can be expanded to auto-register common mocks, reducing
boilerplate in individual test files.

---

## Phase 5: Code Organization (Low Priority, Low Risk)

### 5.1 Normalization Functions

**Problem:** 6 separate normalize functions with similar patterns.

| Function                        | File               | Purpose                  |
| ------------------------------- | ------------------ | ------------------------ |
| normalizeAnalysisResult         | analysis/utils.js  | LLM output               |
| normalizeTextForModel           | documentLlm.js     | Text truncation          |
| normalizeCategoryToSmartFolders | documentLlm.js     | Category matching        |
| normalizeOllamaUrl              | ollamaUtils.js     | URL handling (DONE)      |
| normalizeOllamaModelName        | backgroundSetup.js | Model name case          |
| normalizeFolderPaths            | customFolders.js   | Batch path normalization |

**Action:** Keep domain-specific functions separate (they serve different purposes), but:

1. Create `src/main/utils/pathUtils.js` for generic path normalization
2. Document which normalizer to use when

### 5.2 JSON Parsing Strategy

**Current State (GOOD):**

- `src/main/utils/jsonRepair.js` - LLM output repair (specialized)
- `src/shared/safeJsonOps.js` - General parsing utilities

**Action:** No changes needed - current separation is appropriate.

---

## Implementation Order

```
Week 1: Phase 1 (Critical Fixes)
├── 1.1 Fix validation schema inconsistencies
├── 1.2 Consolidate URL patterns
└── Run full test suite

Week 2: Phase 2 (Service Layer)
├── 2.1 Migrate SettingsService to singleton factory
├── 2.2 Migrate DependencyManagerService to singleton factory
├── 2.3 Consolidate error classification
└── 2.4 Consolidate retry logic in startup/chromadb

Week 3: Phase 3 (IPC Handlers)
├── 3.1 Create analysisUtils.js with shared utilities
├── 3.2 Refactor analysis.js to use shared utilities
├── 3.3 Standardize error responses
└── 3.4 Extract initialization retry wrapper

Week 4: Phase 4 (Test Infrastructure)
├── 4.1 Create test/mocks/ directory
├── 4.2 Migrate logger mocks (highest impact)
├── 4.3 Migrate electron mocks
└── 4.4 Migrate remaining mocks incrementally
```

---

## Files to Create

| File                                    | Purpose                                   |
| --------------------------------------- | ----------------------------------------- |
| `src/shared/validationConstants.js`     | Single source for validation enums/ranges |
| `src/main/ipc/analysisUtils.js`         | Shared analysis handler utilities         |
| `src/main/utils/initializationUtils.js` | Initialization retry wrapper              |
| `test/mocks/logger.js`                  | Centralized logger mock                   |
| `test/mocks/electron.js`                | Centralized electron mock                 |
| `test/mocks/fs.js`                      | Centralized fs mock                       |
| `test/mocks/index.js`                   | Mock exports                              |

## Files to Modify

| File                                            | Changes                         |
| ----------------------------------------------- | ------------------------------- |
| `src/shared/config/configSchema.js`             | Add 'auto' to theme values      |
| `src/main/ipc/validationSchemas.js`             | Import from validationConstants |
| `src/shared/settingsValidation.js`              | Import from validationConstants |
| `src/shared/securityConfig.js`                  | Import from validationConstants |
| `src/main/ipc/settings.js`                      | Import from validationConstants |
| `src/main/services/SettingsService.js`          | Use createSingletonHelpers      |
| `src/main/services/DependencyManagerService.js` | Use createSingletonHelpers      |
| `src/main/utils/ollamaApiRetry.js`              | Use errorClassifier             |
| `src/main/ipc/analysis.js`                      | Use analysisUtils               |
| `src/main/ipc/semantic.js`                      | Use initializationUtils         |
| 116+ test files                                 | Use centralized mocks           |

---

## Success Metrics

- [ ] All 5 theme enum definitions use same source
- [ ] maxBatchSize validation consistent (min: 1)
- [ ] 0 services with custom singleton patterns
- [ ] 0 inline `error.code === 'ENOENT'` checks
- [ ] analysis.js reduced by ~150 lines
- [ ] Logger mock defined in 1 file instead of 116
- [ ] All tests passing after each phase

---

## Risk Mitigation

1. **Run tests after each file change** - Not after each phase
2. **Phase 1 first** - Fixes actual bugs (missing 'auto', inconsistent min values)
3. **Create before delete** - Add new utilities before removing old code
4. **Incremental mock migration** - Don't change all 116 test files at once
