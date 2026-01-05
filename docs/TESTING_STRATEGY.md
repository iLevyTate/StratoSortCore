# Testing Strategy and Critical Paths

## Overview

This document identifies critical paths in the application that require comprehensive test coverage
and provides testing recommendations.

## Critical Paths Requiring Tests

### 1. File Analysis Pipeline (HIGH PRIORITY)

#### Critical Path

User selects files → File validation → Content extraction → AI analysis → Results returned

#### Components to Test

- `src/main/analysis/documentExtractors.js` - Content extraction
- `src/main/analysis/documentLlm.js` - AI document analysis
- `src/main/analysis/ollamaImageAnalysis.js` - AI image analysis
- `src/main/services/FileAnalysisService.js` - Orchestration
- `src/main/services/BatchAnalysisService.js` - Batch processing

#### Test Scenarios

1. **Happy Path**
   - Valid PDF file analysis
   - Valid image file analysis
   - Valid Word document analysis
   - Batch analysis of multiple files

2. **Error Cases**
   - Corrupted file handling
   - Unsupported file types
   - Very large files (>50MB)
   - Missing file errors
   - Permission denied errors

3. **Edge Cases**
   - Empty files
   - Files with no extractable content
   - Files with special characters in names
   - Concurrent analysis requests
   - Analysis cancellation

#### Recommended Tests

```javascript
// Example test structure
describe('File Analysis Pipeline', () => {
  describe('Document Analysis', () => {
    it('should extract text from PDF', async () => {});
    it('should handle corrupted PDFs gracefully', async () => {});
    it('should timeout on large files', async () => {});
  });

  describe('Image Analysis', () => {
    it('should analyze image content', async () => {});
    it('should extract text via OCR', async () => {});
    it('should handle unsupported formats', async () => {});
  });

  describe('Batch Processing', () => {
    it('should process multiple files', async () => {});
    it('should handle partial failures', async () => {});
    it('should respect cancellation', async () => {});
  });
});
```

### 2. File Organization System (HIGH PRIORITY)

#### Critical Path

Files analyzed → Suggestions generated → User confirms → Files moved → Undo available

#### Components to Test

- `src/main/services/OrganizationSuggestionService.js` - Suggestion generation
- `src/main/services/FolderMatchingService.js` - Folder matching
- `src/main/services/UndoRedoService.js` - Undo/redo functionality
- `src/shared/atomicFileOperations.js` - Atomic file moves

#### Test Scenarios

1. **Happy Path**
   - Generate suggestions for analyzed files
   - Move files to suggested locations
   - Undo file moves
   - Redo file moves

2. **Error Cases**
   - Destination folder doesn't exist
   - File already exists at destination
   - Permission errors during move
   - Disk full errors
   - Undo fails (backup missing)

3. **Edge Cases**
   - Move across different drives
   - Very long file paths
   - Special characters in paths
   - Concurrent organization operations
   - System crash during move

#### Recommended Tests

```javascript
describe('File Organization System', () => {
  describe('Suggestion Generation', () => {
    it('should generate suggestions based on content', async () => {});
    it('should respect user-defined folders', async () => {});
    it('should handle files with no clear category', async () => {});
  });

  describe('File Operations', () => {
    it('should move files atomically', async () => {});
    it('should create backups before moving', async () => {});
    it('should rollback on failure', async () => {});
  });

  describe('Undo/Redo', () => {
    it('should undo file moves', async () => {});
    it('should redo undone moves', async () => {});
    it('should maintain undo stack limit', async () => {});
  });
});
```

### 3. Smart Folders & Embeddings (MEDIUM PRIORITY)

#### Critical Path

User creates folder → Description provided → Embeddings generated → Files matched to folder

#### Components to Test

- `src/main/services/ChromaDBService.js` - Vector database
- `src/main/services/SmartFoldersLLMService.js` - Folder analysis
- `src/main/ipc/semantic.js` - Embedding operations

#### Test Scenarios

1. **Happy Path**
   - Create smart folder with description
   - Generate embeddings for folder
   - Match files to smart folders
   - Update folder descriptions

2. **Error Cases**
   - ChromaDB not available
   - Embedding generation fails
   - Invalid folder descriptions
   - Database corruption

3. **Edge Cases**
   - Very long descriptions
   - Empty descriptions
   - Duplicate folder names
   - Large number of folders (>100)

### 4. Settings Management (MEDIUM PRIORITY)

#### Critical Path

User changes settings → Validation → Save to disk → Settings applied

#### Components to Test

- `src/main/services/SettingsService.js` - Settings management
- `src/shared/settingsValidation.js` - Validation logic

#### Test Scenarios

1. **Happy Path**
   - Load default settings
   - Update settings
   - Save settings
   - Export/import settings

2. **Error Cases**
   - Invalid settings values
   - Corrupted settings file
   - Write permission errors
   - Schema validation failures

3. **Edge Cases**
   - Migrating old settings format
   - Partial settings updates
   - Concurrent settings changes

### 5. IPC Communication (HIGH PRIORITY)

#### Critical Path

Renderer sends IPC → Preload validates → Main handles → Response returned

#### Components to Test

- `src/preload/preload.js` - Security and validation
- `src/main/ipc/*.js` - IPC handlers
- `src/main/ipc/withErrorLogging.js` - Error wrapper

#### Test Scenarios

1. **Happy Path**
   - Valid IPC calls
   - Proper response handling
   - Event subscriptions

2. **Security Cases**
   - Path traversal attempts
   - XSS injection attempts
   - Invalid channel names
   - Malformed arguments

3. **Error Cases**
   - Handler not registered
   - Handler throws error
   - Response serialization fails
   - Timeout errors

## Test Coverage Goals

### Unit Tests

- **Target**: 70% coverage
- **Focus**: Business logic, utilities, services
- **Tools**: Jest, Node test mocks

### Integration Tests

- **Target**: 50% coverage
- **Focus**: IPC communication, file operations, database operations
- **Tools**: Jest with Electron mocks

### End-to-End Tests

- **Target**: Critical paths only (5-10 tests)
- **Focus**: User workflows
- **Tools**: Spectron or Playwright

## Testing Best Practices

### 1. Test Organization

```
test/
├── unit/
│   ├── services/
│   ├── utils/
│   └── analysis/
├── integration/
│   ├── ipc/
│   └── file-operations/
└── e2e/
    └── workflows/
```

### 2. Mock Strategy

- Mock external dependencies (Ollama, file system in unit tests)
- Use real file system in integration tests with temp directories
- Mock IPC in renderer tests

### 3. Test Data

- Create fixtures directory with sample files
- Include edge cases (empty files, large files, corrupted files)
- Use deterministic test data

### 4. Async Testing

```javascript
// Good: Proper async handling
it('should analyze file', async () => {
  const result = await analyzeFile('test.pdf');
  expect(result.success).toBe(true);
});

// Bad: Missing await
it('should analyze file', () => {
  const result = analyzeFile('test.pdf'); // Won't wait!
  expect(result.success).toBe(true); // Will fail
});
```

### 5. Error Testing

```javascript
// Always test error paths
it('should handle missing files', async () => {
  await expect(analyzeFile('nonexistent.pdf')).rejects.toThrow('File not found');
});
```

## Priority Test Implementation Order

1. **Phase 1: Foundation (Week 1)**
   - Atomic file operations tests
   - Settings validation tests
   - Path sanitization tests
   - Error handling utilities tests

2. **Phase 2: Core Features (Week 2)**
   - File analysis pipeline tests
   - Document extraction tests
   - IPC communication tests

3. **Phase 3: Advanced Features (Week 3)**
   - Organization system tests
   - Undo/redo tests
   - Smart folders tests

4. **Phase 4: Integration (Week 4)**
   - End-to-end workflow tests
   - Performance regression tests

## Existing Test Coverage Analysis

### Well-Tested Areas

- Settings service (test/settings-service.test.js)
- Path sanitization (test/pathSanitization.test.js)
- IPC handlers (test/\*-ipc.test.js)

### Areas Needing Tests

- [ ] File extraction (documentExtractors.js)
- [ ] Image analysis (ollamaImageAnalysis.js)
- [ ] Batch processing (BatchAnalysisService.js)
- [ ] Folder matching (FolderMatchingService.js)
- [ ] ChromaDB integration (ChromaDBService.js)
- [ ] Undo/redo system (UndoRedoService.js)
- [ ] Auto-organize (AutoOrganizeService.js)

## Test Execution

### Run All Tests

```bash
npm test
```

### Run Specific Test Suite

```bash
npm test -- settings-service
```

### Run with Coverage

```bash
npm run test:coverage
```

### Watch Mode

```bash
npm test -- --watch
```

## CI/CD Integration

### Pre-commit Hooks

- Run unit tests
- Check code coverage threshold
- Lint tests

### PR Checks

- Full test suite
- Coverage report
- Integration tests

### Release Checks

- E2E tests
- Performance benchmarks
- Manual QA checklist

## Performance Testing

### Load Testing Scenarios

1. Analyze 1000 files in batch
2. Concurrent analysis requests
3. Large file handling (>50MB)
4. Memory usage during extended operation

### Metrics to Track

- Analysis time per file type
- Memory consumption
- CPU usage
- Database query performance

## Regression Testing

### Critical Regressions to Prevent

1. File corruption during move
2. Lost undo history
3. Settings reset
4. Memory leaks
5. Database corruption

### Automated Regression Suite

- Run before each release
- Include known bug scenarios
- Test backward compatibility

## Manual Verification Strategy

While we aim for high automated coverage, certain features require manual verification, particularly
those involving:

1.  **AI Model Output Quality**: Subjective quality of descriptions and suggestions.
2.  **UI/UX Interactions**: Drag-and-drop, animations, and responsive layouts.
3.  **System Integration**: Interaction with external services (Ollama, ChromaDB) across different
    OS environments.

### Verification Documents

- **[Manual Test Plan](MANUAL_TEST_PLAN.md)**: Comprehensive step-by-step validation of all
  features.
- **[Fix Verification Checklist](FIX_VERIFICATION_CHECKLIST.md)**: Targeted checklist for verifying
  specific bug fixes and new features.

These documents should be executed before any major release candidate.
