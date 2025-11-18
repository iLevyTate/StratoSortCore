# HIGH Stability Bugs - Fixed

This document details the 5 HIGH-severity stability bugs that have been fixed in this codebase.

---

## BUG #6: Initialization Race Condition in ChromaDB ✅ FIXED

**File:** `src/main/services/ChromaDBService.js` (Lines 172-283)

**Issue:**
Concurrent initialization calls could resolve before service was actually ready, causing crashes and inconsistent state. The atomic flag and promise reference were not properly synchronized.

**Root Cause:**

- `_isInitializing` flag and `_initPromise` were set separately, creating a race window
- Concurrent calls could return `_initPromise` before it was assigned
- State transitions weren't atomic, allowing `initialized=true` while `_isInitializing=true`

**Fix Implemented:**

1. **Atomic State Checks**: Return existing `_initPromise` immediately if `_isInitializing` is true
2. **Edge Case Handling**: Added fallback polling mechanism if promise is null but flag is set
3. **Consistent State Updates**: Set both `initialized` and `_isInitializing` atomically in try/catch
4. **Failure Recovery**: Clear both promise and flag on error to allow retries
5. **Enhanced Logging**: Added detailed logging for initialization state transitions

**Code Example:**

```javascript
// BUG FIX #6: Atomic flag + promise reference for race condition prevention
if (this._isInitializing) {
  // Return the existing init promise if available
  if (this._initPromise) {
    return this._initPromise;
  }
  // Edge case handling with polling...
}

// ATOMIC OPERATION: Set both flags before starting async work
this._isInitializing = true;
this._initPromise = (async () => {
  try {
    // ... initialization logic ...

    // ATOMIC STATE UPDATE: Set both flags together
    this.initialized = true;
    this._isInitializing = false;
  } catch (error) {
    // ATOMIC CLEANUP: Clear both promise and lock on failure
    this._initPromise = null;
    this._isInitializing = false;
    this.initialized = false;
    throw error;
  }
})();
```

**Impact:**

- Eliminates race conditions in concurrent initialization
- Prevents inconsistent state during startup
- Ensures service is truly ready before resolving
- Allows safe retry on failure

---

## BUG #7: Infinite Loop in Undo Memory Pruning ✅ FIXED

**File:** `src/main/services/UndoRedoService.js` (Lines 153-225)

**Issue:**
Single large action exceeding memory limit caused infinite loop in pruning logic. The while loop condition `this.actions.length > 1` meant if only 1 oversized action remained, the loop would never exit.

**Root Cause:**

- Pruning loop checked `actions.length > 1` to prevent removing the last action
- If a single action exceeded memory limit, condition was false but memory still exceeded
- Loop would hang indefinitely trying to prune when only 1 action existed
- No escape condition or iteration limit

**Fix Implemented:**

1. **Iteration Limit**: Added `maxPruneIterations` counter with safety limit
2. **Escape Condition**: Added iteration counter check to while loop
3. **Oversized Action Handling**: Truncate single oversized action if it exceeds limit
4. **Secondary Safety Check**: Clear all history if truncation still exceeds limit
5. **Memory Desync Detection**: Reset estimate to 0 if actions are empty but estimate is non-zero
6. **Enhanced Logging**: Log when safety limits are hit with diagnostics

**Code Example:**

```javascript
// BUG FIX #7: Prevent infinite loop when single action exceeds memory limit
const maxMemoryBytes = this.maxMemoryMB * 1024 * 1024;

// Safety check: Prevent infinite loop by tracking iterations
let pruneIterations = 0;
const maxPruneIterations = this.maxActions + 10; // Safety margin

while (
  this.actions.length > 1 &&
  (this.actions.length > this.maxActions ||
    this.currentMemoryEstimate > maxMemoryBytes) &&
  pruneIterations < maxPruneIterations // ESCAPE CONDITION
) {
  const removedAction = this.actions.shift();
  this.currentIndex--;
  this.currentMemoryEstimate -= this._estimateActionSize(removedAction);
  pruneIterations++;
}

// Handle single oversized action
if (this.currentMemoryEstimate > maxMemoryBytes && this.actions.length === 1) {
  // Truncate action data
  largeAction.data = { truncated: true, ... };
  this._recalculateMemoryEstimate();

  // SAFETY CHECK: If still over limit, clear everything
  if (this.currentMemoryEstimate > maxMemoryBytes) {
    this.actions = [];
    this.currentIndex = -1;
    this.currentMemoryEstimate = 0;
  }
}
```

**Impact:**

- Prevents infinite loops in memory pruning
- Handles single oversized actions gracefully
- Provides multiple safety layers
- Prevents memory exhaustion from undo history

---

## BUG #8: Null Dereference in Image Analysis ✅ FIXED

**File:** `src/main/analysis/ollamaImageAnalysis.js` (Lines 438-551)

**Issue:**
`folderMatcher` could be an object with undefined methods, causing crashes when calling methods like `upsertFolderEmbedding()`. Simple truthy check wasn't sufficient - needed duck typing validation.

**Root Cause:**

- Code checked `if (folderMatcher)` but didn't validate methods existed
- `FolderMatchingService` constructor could return partial object
- Duck typing in JavaScript means methods can be undefined even on valid objects
- No validation of method existence before calling

**Fix Implemented:**

1. **Duck Typing Validation**: Check that all required methods exist as functions
2. **Method Existence Checks**: Validate `initialize`, `upsertFolderEmbedding`, `upsertFileEmbedding`, `matchFileToFolders`
3. **Detailed Error Logging**: Log which specific methods are missing for debugging
4. **Smart Folder Validation**: Filter folders to ensure they have required properties
5. **Summary Validation**: Check summary is non-empty before upserting
6. **Candidate Validation**: Validate candidate structure before accessing properties
7. **Early Returns**: Don't continue if initialization fails

**Code Example:**

```javascript
// BUG FIX #8: Duck typing validation - check that all required methods exist
const hasRequiredMethods =
  folderMatcher &&
  typeof folderMatcher === 'object' &&
  typeof folderMatcher.initialize === 'function' &&
  typeof folderMatcher.upsertFolderEmbedding === 'function' &&
  typeof folderMatcher.upsertFileEmbedding === 'function' &&
  typeof folderMatcher.matchFileToFolders === 'function';

if (!hasRequiredMethods) {
  logger.warn('[IMAGE] FolderMatcher invalid or missing required methods', {
    hasFolderMatcher: !!folderMatcher,
    folderMatcherType: typeof folderMatcher,
    hasInitialize: typeof folderMatcher?.initialize === 'function',
    hasUpsertFolder: typeof folderMatcher?.upsertFolderEmbedding === 'function',
    hasUpsertFile: typeof folderMatcher?.upsertFileEmbedding === 'function',
    hasMatchFile: typeof folderMatcher?.matchFileToFolders === 'function',
  });
  return; // Don't continue with invalid object
}

// Validate folders before upserting
const validFolders = smartFolders.filter(
  (f) => f && typeof f === 'object' && (f.name || f.id || f.path),
);

// Validate candidates structure before accessing
if (Array.isArray(candidates) && candidates.length > 0) {
  const top = candidates[0];
  if (
    top &&
    typeof top === 'object' &&
    typeof top.score === 'number' &&
    top.name
  ) {
    // Safe to use
  }
}
```

**Impact:**

- Prevents null/undefined method crashes
- Provides clear diagnostic logging
- Validates all data structures before use
- Graceful degradation when services unavailable

---

## BUG #9: Counter Overflow in File Collisions ✅ FIXED

**File:** `src/main/ipc/files.js` (Lines 459-687)

**Issue:**
When encountering 1000+ file collisions, operation would throw error and fail entire batch organization. No fallback mechanism for extreme collision scenarios.

**Root Cause:**

- Hard limit of 1000 retries with numeric counter
- No alternative naming strategy beyond numeric suffixes
- Threw error on reaching limit, failing entire operation
- In extreme cases (bulk imports, duplicates), 1000 collisions possible

**Fix Implemented:**

1. **Increased Limit**: Raised from 1000 to 5000 numeric attempts
2. **UUID Fallback**: Added 3 UUID-based naming attempts after numeric exhausted
3. **Detailed Error Messages**: Provide context on what failed and why
4. **Cross-Device Support**: UUID fallback works for both same-device and cross-device moves
5. **Full Verification**: UUID fallback uses same checksum verification as regular moves
6. **Enhanced Logging**: Track when fallback is used and success rate

**Code Example:**

```javascript
// BUG FIX #9: Improved collision handling with UUID fallback
const maxNumericRetries = 5000; // Increased from 1000 to 5000

while (!operationComplete && counter < maxNumericRetries) {
  // ... try numeric counter naming ...
}

// BUG FIX #9: UUID fallback if numeric counter exhausted
if (!operationComplete) {
  logger.warn(
    `[FILE-OPS] Exhausted ${maxNumericRetries} numeric attempts, falling back to UUID`,
  );

  const uuidAttempts = 3;
  for (
    let uuidTry = 0;
    uuidTry < uuidAttempts && !operationComplete;
    uuidTry++
  ) {
    const uuid = require('crypto').randomUUID();
    const uuidShort = uuid.split('-')[0]; // First 8 chars
    uniqueDestination = `${baseName}_${uuidShort}${ext}`;

    try {
      await fs.rename(op.source, uniqueDestination);
      operationComplete = true;
      logger.info(`[FILE-OPS] Successfully used UUID fallback`);
    } catch (uuidRenameError) {
      if (uuidRenameError.code === 'EXDEV') {
        // Handle cross-device with full verification...
      }
    }
  }

  if (!operationComplete) {
    throw new Error(
      `Failed after ${maxNumericRetries} numeric and ${uuidAttempts} UUID attempts`,
    );
  }
}
```

**Impact:**

- Handles extreme collision scenarios gracefully
- Provides virtually guaranteed uniqueness with UUIDs
- Maintains data integrity with full verification
- Prevents batch organization failures from collisions

---

## BUG #10: Unbounded Growth in User Patterns ✅ FIXED

**File:** `src/main/services/OrganizationSuggestionService.js` (Lines 975-1103)

**Issue:**
User pattern map could grow unbounded if only updating existing patterns. Feedback history also grew without time-based expiration. Only had count-based limit which could be bypassed.

**Root Cause:**

- Pruning only happened when adding NEW patterns
- Updating existing patterns never triggered pruning
- No time-based expiration for old patterns
- Feedback history had count limit but no age limit
- Patterns from 5 years ago still consumed memory

**Fix Implemented:**

1. **Time-Based Expiration**: Remove feedback entries older than 90 days
2. **Stale Pattern Removal**: Remove patterns unused for 180 days
3. **Enhanced LRU Strategy**: Factor in recency when scoring patterns for removal
4. **Creation Timestamp**: Track `createdAt` for future enhancements
5. **Composite Scoring**: Use `count * confidence * recency_factor` for pruning decisions
6. **Feedback Pruning**: Prune old feedback before adding new entries
7. **Detailed Logging**: Track how many entries pruned and why

**Code Example:**

```javascript
// BUG FIX #10: Add time-based expiration to feedback history
const FEEDBACK_RETENTION_DAYS = 90;
const FEEDBACK_RETENTION_MS = FEEDBACK_RETENTION_DAYS * 24 * 60 * 60 * 1000;

// Prune old feedback before adding new entry
if (this.feedbackHistory.length > 0) {
  const cutoffTime = now - FEEDBACK_RETENTION_MS;
  this.feedbackHistory = this.feedbackHistory.filter(
    (entry) => entry.timestamp > cutoffTime,
  );
}

// BUG FIX #10: Enhanced pruning strategy with time-based expiration
if (this.userPatterns.size >= this.maxUserPatterns) {
  const PATTERN_STALE_DAYS = 180; // 6 months
  const PATTERN_STALE_MS = PATTERN_STALE_DAYS * 24 * 60 * 60 * 1000;
  const staleThreshold = now - PATTERN_STALE_MS;

  // First, remove stale patterns (not used in 6 months)
  const stalePatterns = patternsArray.filter(
    ([, data]) => data.lastUsed < staleThreshold,
  );

  for (const [key] of stalePatterns) {
    this.userPatterns.delete(key);
  }

  // If still at capacity, use LRU with recency factor
  if (this.userPatterns.size >= this.maxUserPatterns) {
    remainingPatterns.sort((a, b) => {
      const ageA = now - a[1].lastUsed;
      const ageB = now - b[1].lastUsed;
      const recencyFactorA = 1 / (1 + ageA / (30 * 24 * 60 * 60 * 1000));
      const recencyFactorB = 1 / (1 + ageB / (30 * 24 * 60 * 60 * 1000));

      const scoreA = a[1].count * a[1].confidence * recencyFactorA;
      const scoreB = b[1].count * b[1].confidence * recencyFactorB;
      return scoreA - scoreB;
    });

    // Remove bottom 10%
    const removeCount = Math.floor(this.maxUserPatterns * 0.1);
    for (let i = 0; i < removeCount; i++) {
      this.userPatterns.delete(remainingPatterns[i][0]);
    }
  }
}
```

**Impact:**

- Prevents unbounded memory growth
- Automatically removes stale/irrelevant patterns
- Balances frequency, confidence, and recency
- Maintains recent, high-value patterns

---

## Summary

All 5 HIGH-severity stability bugs have been comprehensively fixed with:

1. ✅ **Root Cause Analysis**: Each fix addresses the underlying issue, not just symptoms
2. ✅ **Edge Case Handling**: All fixes include comprehensive edge case coverage
3. ✅ **Monitoring/Logging**: Enhanced logging for debugging and monitoring
4. ✅ **Code Comments**: Detailed comments explaining the fix and rationale
5. ✅ **Performance Consideration**: All fixes maintain or improve performance

### Files Modified:

- `src/main/services/ChromaDBService.js` - BUG #6
- `src/main/services/UndoRedoService.js` - BUG #7
- `src/main/analysis/ollamaImageAnalysis.js` - BUG #8
- `src/main/ipc/files.js` - BUG #9
- `src/main/services/OrganizationSuggestionService.js` - BUG #10

### Testing Recommendations:

1. Test concurrent ChromaDB initialization from multiple threads
2. Test undo service with single action >10MB
3. Test image analysis with various FolderMatchingService states
4. Test file organization with 5000+ name collisions
5. Monitor user pattern growth over extended usage periods

### Performance Impact:

- **BUG #6**: No performance impact, prevents crashes
- **BUG #7**: Prevents infinite loops, improves performance
- **BUG #8**: Minimal overhead from validation checks
- **BUG #9**: Slightly slower for extreme collisions, but prevents failures
- **BUG #10**: Improves long-term memory usage and performance

All fixes follow best practices for error handling, logging, and maintainability.
