# Bug Fixes Reference

This document centralizes information about critical bug fixes throughout the codebase.
When you see comments like `// CRITICAL FIX (BUG #N)`, refer here for context.

## Critical Bugs

### BUG #1: Silent File Corruption

**Location:** `src/main/ipc/files.js:204`
**Status:** Fixed
**Issue:** Files could be silently corrupted during batch operations without checksum verification.
**Fix:** Checksum verification is now mandatory for all file operations.

### BUG #2: Undo/Redo Backup Recovery

**Location:** `src/main/services/UndoRedoService.js:323`
**Status:** Fixed
**Issue:** Backup recovery could fail when files were moved across devices.
**Fix:** Added cross-device copy fallback when rename fails.

### BUG #3: Batch Operation Rollback

**Location:** `src/main/ipc/files.js:73`
**Status:** Fixed
**Issue:** Partial batch failures left files in inconsistent state with no rollback.
**Fix:** Implemented transaction-like rollback mechanism for batch operations.

### BUG #4: Auto-Organize Race Condition

**Location:** `src/main/services/AutoOrganizeService.js:587`
**Status:** Fixed
**Issue:** Concurrent auto-organize operations could conflict.
**Fix:** Added mutex-style locking for organize operations.

### BUG #5: Analysis History Corruption

**Location:** `src/main/services/AnalysisHistoryService.js:364`
**Status:** Fixed
**Issue:** Analysis history could become corrupted on app crash.
**Fix:** Atomic write operations with backup/restore.

### BUG #6: ChromaDB Initialization Race

**Location:** `src/main/services/ChromaDBService.js:336`
**Status:** Fixed
**Issue:** Concurrent requests during initialization could cause undefined behavior.
**Fix:** Proper initialization lock with promise chaining.

### BUG #7: Undo Stack Memory Leak

**Location:** `src/main/services/UndoRedoService.js:158`
**Status:** Fixed
**Issue:** Single oversized action could trigger infinite loop in memory limiting.
**Fix:** Added special handling for oversized single actions.

### BUG #8: Image Analysis Buffer Overflow

**Location:** `src/main/analysis/ollamaImageAnalysis.js:523`
**Status:** Fixed
**Issue:** Large images could cause buffer overflow during analysis.
**Fix:** Added size limits and chunked processing.

### BUG #9: File Collision Exhaustion

**Location:** `src/main/ipc/files.js:135`
**Status:** Fixed
**Issue:** File naming collision counter could reach 1000, causing batch failure.
**Fix:** UUID fallback when collision counter exceeds threshold.

### BUG #10: Organization Suggestion Null Reference

**Location:** `src/main/services/OrganizationSuggestionService.js:1042`
**Status:** Fixed
**Issue:** Null reference when suggestions lacked required fields.
**Fix:** Added defensive null checks throughout suggestion processing.

## Priority Fixes

### HIGH-1: IPC Initialization Race

**Location:** `src/main/simple-main.js:1053`
**Issue:** Renderer could call IPC methods before they were registered.
**Fix:** Removed unreliable setImmediate delay, proper initialization sequencing.

### HIGH-2: Cleanup Timeout

**Location:** `src/main/simple-main.js:1406`
**Issue:** Cleanup operations could hang indefinitely.
**Fix:** Hard timeout for all cleanup operations.

### MED-1 through MED-11: Various Fixes

See inline comments for medium-priority fixes related to:

- Settings validation
- GPU failure tracking
- Unicode path support
- Stream handling

## Contributing

When adding a new critical bug fix:

1. Add a numbered comment: `// CRITICAL FIX (BUG #N): Brief description`
2. Document it in this file with location, status, issue, and fix
3. Ensure tests cover the fix
