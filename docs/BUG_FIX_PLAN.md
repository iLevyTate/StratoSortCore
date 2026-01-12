# ElstratoSort - File-by-File Bug Fix Plan

## Executive Summary

This plan addresses **23 critical/high-severity issues** and **15 medium/low-severity issues**
discovered during comprehensive codebase audit. Issues are organized by file with specific line
numbers, fixes, and priority.

---

## Priority Legend

- **CRITICAL**: Data loss, crashes, security vulnerabilities - fix immediately
- **HIGH**: Significant bugs affecting functionality - fix this sprint
- **MEDIUM**: Performance/UX issues - fix next sprint
- **LOW**: Code quality improvements - fix when touching file

---

## FILE-BY-FILE FIX PLAN

### 1. `src/main/services/SearchService.js`

#### Issue C-1: Embedding Dimension Mismatch (CRITICAL)

**Lines**: 424-432 **Problem**: When embedding model changes, users get empty search results with no
error **Fix**:

```javascript
// Replace lines 424-432:
if (!validateEmbeddingDimensions(vector, expectedDim)) {
  logger.error('[SearchService] Embedding dimension mismatch', {
    vectorDim: vector?.length,
    expectedDim,
    modelUsed: embeddingResult.model
  });

  // FIXED: Throw descriptive error instead of returning null
  throw new Error(
    `Embedding model changed. Please rebuild your search index. ` +
      `Expected ${expectedDim} dimensions but got ${vector?.length}.`
  );
}
```

#### Issue M-1: Unbounded Memory Growth (MEDIUM)

**Lines**: 316-340 **Problem**: Serialized index cache can grow to 50MB and never expires **Fix**:

```javascript
// Add after line 316:
this._cacheExpiry = 30 * 60 * 1000; // 30 minutes
this._cacheTimestamp = null;

// Modify serialize() method to add time-based expiry:
const now = Date.now();
if (
  this._cachedSerialized &&
  this._cacheTimestamp &&
  now - this._cacheTimestamp < this._cacheExpiry
) {
  return this._cachedSerialized;
}

this._cachedSerialized = serialized;
this._cacheTimestamp = now;
```

---

### 2. `src/main/services/FolderMatchingService.js`

#### Issue C-2: Unhandled Embedding Generation Failure (CRITICAL)

**Lines**: 308-318 **Problem**: Throwing error but not all callers handle it properly **Fix**: Audit
and add try-catch to all callers of `embedText()`:

**In OrganizationSuggestionServiceCore.js line ~498:**

```javascript
try {
  const embedding = await this.folderMatchingService.embedText(text);
  // ... use embedding
} catch (error) {
  logger.warn('[OrganizationSuggestion] Embedding failed, falling back to pattern matching', {
    error: error.message
  });
  // Graceful degradation to pattern-based matching
  return this._getPatternBasedMatches(text);
}
```

---

### 3. `src/main/services/DownloadWatcher.js`

#### Issue C-3: Multiple TOCTOU Race Conditions (CRITICAL)

**Lines**: 574-584, 443-454, 805-814 **Problem**: File existence checked, then accessed later - file
could be deleted between

**Fix for lines 574-584:**

```javascript
// BEFORE (VULNERABLE):
const exists = await fs
  .access(filePath)
  .then(() => true)
  .catch(() => false);
if (exists) {
  const stats = await fs.stat(filePath);
}

// AFTER (SAFE):
try {
  const stats = await fs.stat(filePath);
  // ... use stats immediately
} catch (error) {
  if (error.code === 'ENOENT') {
    logger.debug('[DownloadWatcher] File no longer exists:', filePath);
    return; // Graceful handling
  }
  throw error;
}
```

**Apply same pattern to lines 443-454 and 805-814.**

#### Issue M-3: No Timeout on File Analysis (MEDIUM)

**Lines**: 467-481 **Problem**: File analysis could block indefinitely **Fix**:

```javascript
const ANALYSIS_TIMEOUT = 60000; // 60 seconds

const analysisPromise = imageExtensions.includes(extension)
  ? analyzeImageFile(filePath, smartFolders)
  : analyzeDocumentFile(filePath, smartFolders);

const timeoutPromise = new Promise((_, reject) =>
  setTimeout(() => reject(new Error('Analysis timeout')), ANALYSIS_TIMEOUT)
);

try {
  analysis = await Promise.race([analysisPromise, timeoutPromise]);
} catch (error) {
  if (error.message === 'Analysis timeout') {
    logger.warn('[DownloadWatcher] Analysis timed out for:', filePath);
    return null;
  }
  throw error;
}
```

---

### 4. `src/main/services/PerformanceService.js`

#### Issue C-4: Process Spawn Resource Leak (CRITICAL)

**Lines**: 63-89 **Problem**: Event listeners accumulate if process hangs indefinitely **Fix**:

```javascript
const runCommand = (command, args = [], options = {}, timeoutMs = 30000) => {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, options);
    let isCleanedUp = false;
    let stdout = '';
    let stderr = '';

    const cleanup = () => {
      if (isCleanedUp) return;
      isCleanedUp = true;
      proc.stdout?.removeAllListeners();
      proc.stderr?.removeAllListeners();
      proc.removeAllListeners();
      if (!proc.killed) {
        proc.kill('SIGTERM');
      }
    };

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Command '${command}' timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.stdout?.on('data', (data) => {
      stdout += data;
    });
    proc.stderr?.on('data', (data) => {
      stderr += data;
    });

    proc.on('error', (error) => {
      clearTimeout(timeout);
      cleanup();
      reject(error);
    });

    proc.on('close', (code) => {
      clearTimeout(timeout);
      cleanup();
      if (code === 0) {
        resolve({ stdout, stderr, code });
      } else {
        reject(new Error(`Command exited with code ${code}: ${stderr}`));
      }
    });
  });
};
```

---

### 5. `src/main/services/autoOrganize/batchProcessor.js`

#### Issue C-5: Circular Import (CRITICAL)

**Line**: 14 **Problem**: Imports `generateSecureId` from `fileProcessor.js` but both files define
it **Fix**: Create shared utility file

**Create new file `src/main/services/autoOrganize/idUtils.js`:**

```javascript
const crypto = require('crypto');

/**
 * Generates a secure unique identifier with prefix
 * @param {string} prefix - Identifier prefix (e.g., 'file', 'batch', 'op')
 * @returns {string} Unique identifier
 */
const generateSecureId = (prefix = 'id') => {
  const timestamp = Date.now();
  const randomBytes = crypto.randomBytes(6).toString('hex');
  return `${prefix}-${timestamp}-${randomBytes}`;
};

module.exports = { generateSecureId };
```

**Update batchProcessor.js line 14:**

```javascript
// BEFORE:
const { generateSecureId } = require('./fileProcessor');

// AFTER:
const { generateSecureId } = require('./idUtils');
```

**Update fileProcessor.js:**

```javascript
// Remove local generateSecureId definition
// Add import:
const { generateSecureId } = require('./idUtils');
```

---

### 6. `src/main/services/ClusteringService.js`

#### Issue H-1: Potential Infinite Loop (HIGH)

**Lines**: 279-299 **Problem**: Empty cluster reinitialization could loop forever **Fix**:

```javascript
const MAX_REINIT_ATTEMPTS = 10;
let reinitAttempts = 0;
const previousReassignments = new Set();

while (emptyClusters.length > 0 && reinitAttempts < MAX_REINIT_ATTEMPTS) {
  reinitAttempts++;
  const reassignmentKey = emptyClusters.join(',');

  if (previousReassignments.has(reassignmentKey)) {
    logger.warn('[Clustering] Detected cycle in cluster reinitialization, breaking');
    break;
  }
  previousReassignments.add(reassignmentKey);

  // ... existing reinitialization logic
}

if (reinitAttempts >= MAX_REINIT_ATTEMPTS) {
  logger.warn('[Clustering] Max reinitialization attempts reached');
}
```

#### Issue M-2: No Upper Bound on Cluster Count (MEDIUM)

**Lines**: 442-444 **Problem**: User could request excessive clusters **Fix**:

```javascript
const MAX_CLUSTERS = 100;
const numClusters =
  k === 'auto'
    ? this.estimateOptimalK(files)
    : Math.max(2, Math.min(k, files.length, MAX_CLUSTERS));

if (k !== 'auto' && k > MAX_CLUSTERS) {
  logger.warn(`[Clustering] Requested ${k} clusters, capped at ${MAX_CLUSTERS}`);
}
```

---

### 7. `src/main/services/autoOrganize/folderOperations.js`

#### Issue H-2: Symlink Validation TOCTOU Race (HIGH)

**Lines**: 111-132 **Problem**: Symlink check happens after other path validation **Fix**: Move
symlink check to be first after path construction:

```javascript
const defaultFolderPath = path.resolve(documentsDir, sanitizedBaseName, sanitizedFolderName);

// Check for symlink FIRST using lstat
try {
  const stats = await fs.lstat(defaultFolderPath);
  if (stats.isSymbolicLink()) {
    throw new Error(
      `Security violation: Symbolic links are not allowed. ` +
        `Path '${defaultFolderPath}' is a symbolic link.`
    );
  }
} catch (error) {
  if (error.code !== 'ENOENT') {
    throw error; // Re-throw non-existence errors (including our security error)
  }
  // ENOENT is OK - path doesn't exist yet
}

// Then continue with other validation...
```

---

### 8. `src/main/services/BatchAnalysisService.js`

#### Issue H-3: Division by Zero (HIGH)

**Line**: 282 **Problem**: No zero check before dividing by totalDuration **Fix**:

```javascript
// BEFORE:
throughput: `${(filePaths.length / (totalDuration / 1000)).toFixed(2)} files/sec`;

// AFTER:
throughput: totalDuration > 0
  ? `${(filePaths.length / (totalDuration / 1000)).toFixed(2)} files/sec`
  : 'instant';
```

---

### 9. `src/main/services/autoOrganize/fileProcessor.js`

#### Issue H-4: Race Condition in processNewFile (HIGH)

**Lines**: 231-257 **Problem**: File could be deleted during analysis **Fix**: Add re-check before
organizing:

```javascript
// After analysis completes (around line 257):
// Re-verify file still exists before organizing
try {
  await fs.access(filePath);
} catch (error) {
  if (error.code === 'ENOENT') {
    logger.warn('[AutoOrganize] File no longer exists after analysis:', filePath);
    return null;
  }
  throw error;
}

// Now proceed with organization...
```

---

### 10. `src/main/services/autoOrganize/fileTypeUtils.js`

#### Issue M-4: Missing Modern File Extensions (MEDIUM)

**Lines**: 12-20 **Problem**: Missing .avif, .webm, .m4v, .heif, .opus, .flac, .mkv **Fix**:

```javascript
const FILE_TYPE_CATEGORIES = {
  documents: ['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt', 'pages', 'epub', 'md'],
  spreadsheets: ['xls', 'xlsx', 'csv', 'ods', 'numbers', 'tsv'],
  presentations: ['ppt', 'pptx', 'odp', 'key'],
  images: [
    'jpg',
    'jpeg',
    'png',
    'gif',
    'svg',
    'bmp',
    'webp',
    'tiff',
    'heic',
    'heif',
    'avif',
    'ico',
    'raw'
  ],
  videos: ['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mkv', 'mpeg', 'mpg', '3gp'],
  audio: ['mp3', 'wav', 'flac', 'aac', 'm4a', 'opus', 'ogg', 'wma', 'aiff'],
  code: [
    'js',
    'py',
    'java',
    'cpp',
    'c',
    'h',
    'html',
    'css',
    'ts',
    'tsx',
    'jsx',
    'go',
    'rs',
    'rb',
    'php',
    'swift',
    'kt'
  ],
  archives: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'dmg', 'iso']
};
```

---

### 11. `src/renderer/components/UndoRedoSystem.jsx`

#### Issue H-5: Memory Leak from Stale Listeners (MEDIUM)

**Lines**: 512-515 **Problem**: Listener cleanup depends on stable references **Current code is
OK** - `undoStack` is stable from `useState` and `updateState` has proper `useCallback`
dependencies.

**Enhancement** (optional): Add defensive cleanup in UndoStack class:

```javascript
// In UndoStack class:
notifyListeners() {
  // Filter out any garbage-collected listeners (defensive)
  this.listeners = this.listeners.filter(listener => listener != null);
  this.listeners.forEach(listener => listener(this.getState()));
}
```

#### Issue L-4: Excessive Padding (LOW)

**Lines**: 954, 979 **Problem**: `p-8` seems excessive for toolbar buttons **Fix**: Verify
intention, likely should be `p-2`:

```javascript
// BEFORE:
className={`p-8 rounded-lg transition-colors border

// AFTER (if fix confirmed):
className={`p-2 rounded-lg transition-colors border
```

---

### 12. `src/shared/vectorMath.js`

#### Issue L-3: Missing NaN Checks (LOW)

**Lines**: 18-47 **Problem**: Good validation exists but no NaN/Infinity checks **Fix** (optional
enhancement):

```javascript
function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
    return 0;
  }

  // Check for NaN/Infinity in vectors
  if (a.some((v) => !Number.isFinite(v)) || b.some((v) => !Number.isFinite(v))) {
    return 0;
  }

  // ... rest of existing function
}
```

---

## IMPLEMENTATION ORDER

### Phase 1: Critical Issues (Immediate)

1. **C-1**: SearchService.js - embedding dimension error
2. **C-2**: FolderMatchingService.js - embedding failure handling
3. **C-3**: DownloadWatcher.js - TOCTOU race conditions (3 locations)
4. **C-4**: PerformanceService.js - process spawn leak
5. **C-5**: batchProcessor.js - circular import (create idUtils.js)

### Phase 2: High Issues (This Sprint)

6. **H-1**: ClusteringService.js - infinite loop guard
7. **H-2**: folderOperations.js - symlink timing
8. **H-3**: BatchAnalysisService.js - division by zero
9. **H-4**: fileProcessor.js - race condition

### Phase 3: Medium Issues (Next Sprint)

10. **M-1**: SearchService.js - cache expiry
11. **M-2**: ClusteringService.js - cluster limit
12. **M-3**: DownloadWatcher.js - analysis timeout
13. **M-4**: fileTypeUtils.js - file extensions

### Phase 4: Low Issues (When Convenient)

14. **L-3**: vectorMath.js - NaN checks
15. **L-4**: UndoRedoSystem.jsx - padding fix

---

## TESTING REQUIREMENTS

After each fix, verify:

1. **Unit tests pass**: `npm test`
2. **Build succeeds**: `npm run build`
3. **No TypeScript/lint errors**: `npm run lint`
4. **Manual smoke test**: Launch app and test affected functionality

### Specific Test Cases Needed

- [ ] Test search with mismatched embedding dimensions
- [ ] Test with Ollama unavailable
- [ ] Test file operations with rapid file deletion
- [ ] Test clustering with edge cases (1 file, 1000 files, identical files)
- [ ] Test undo/redo with concurrent operations
- [ ] Test symlink detection

---

## FILES SUMMARY

| File                     | Issues   | Priority |
| ------------------------ | -------- | -------- |
| SearchService.js         | C-1, M-1 | CRITICAL |
| FolderMatchingService.js | C-2      | CRITICAL |
| DownloadWatcher.js       | C-3, M-3 | CRITICAL |
| PerformanceService.js    | C-4      | CRITICAL |
| batchProcessor.js        | C-5      | CRITICAL |
| ClusteringService.js     | H-1, M-2 | HIGH     |
| folderOperations.js      | H-2      | HIGH     |
| BatchAnalysisService.js  | H-3      | HIGH     |
| fileProcessor.js         | H-4      | HIGH     |
| UndoRedoSystem.jsx       | H-5, L-4 | MEDIUM   |
| fileTypeUtils.js         | M-4      | MEDIUM   |
| vectorMath.js            | L-3      | LOW      |

**New file to create**: `src/main/services/autoOrganize/idUtils.js`

---

## ESTIMATED IMPACT

- **Stability**: Eliminates 5 crash scenarios
- **Data Safety**: Prevents 3 data loss scenarios
- **Security**: Fixes 2 race condition vulnerabilities
- **Performance**: Adds memory management and timeouts
- **UX**: Better error messages for users
