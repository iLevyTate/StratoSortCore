# Code Quality Standards and Style Guide

## Overview

This document establishes coding standards for consistency, readability, and maintainability across the StratoSort codebase.

## Table of Contents

1. [Naming Conventions](#naming-conventions)
2. [Error Handling Standards](#error-handling-standards)
3. [Promise Handling](#promise-handling)
4. [Code Formatting](#code-formatting)
5. [JSDoc Documentation](#jsdoc-documentation)
6. [Function Length and Complexity](#function-length-and-complexity)
7. [Import Organization](#import-organization)

## Naming Conventions

### Variables and Functions

#### Use Descriptive Names

```javascript
// Bad: Ambiguous, unclear purpose
const d = new Date();
const x = files.length;
function proc(f) { ... }

// Good: Clear, descriptive
const currentDate = new Date();
const fileCount = files.length;
function processFileAnalysis(filePath) { ... }
```

#### Naming Patterns by Type

**Boolean Variables** - Use `is`, `has`, `should` prefixes

```javascript
const isAnalyzing = false;
const hasResults = results.length > 0;
const shouldRetry = attempt < maxAttempts;
```

**Arrays and Collections** - Use plural nouns

```javascript
const files = [];
const results = [];
const analysisErrors = new Map();
```

**Functions** - Use verb + noun pattern

```javascript
function analyzeFile(filePath) {}
function getSettings() {}
function validateInput(data) {}
function createFolder(path) {}
```

**Async Functions** - Consider async prefix for clarity

```javascript
async function fetchAnalysisResults() {}
async function loadConfiguration() {}
```

**Event Handlers** - Use `handle` or `on` prefix

```javascript
function handleFileSelect(event) {}
function onAnalysisComplete(results) {}
```

**Class Names** - Use PascalCase nouns

```javascript
class FileAnalysisService {}
class ChromaDBService {}
class ErrorHandler {}
```

**Constants** - Use UPPER_SNAKE_CASE for true constants

```javascript
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const DEFAULT_TIMEOUT = 5000;
const ERROR_CODES = { ... };
```

**Private Methods** - Use underscore prefix (convention, not enforcement)

```javascript
class Service {
  publicMethod() {}
  _privateHelper() {}
}
```

### Avoid Ambiguous Names

```javascript
// Bad: Unclear what these represent
const data = getInfo();
const temp = process(input);
const result = doStuff();

// Good: Clear purpose
const analysisResults = getFileAnalysis();
const temporaryFilePath = createTempFile(input);
const folderMatchScore = calculateSimilarity();
```

## Error Handling Standards

### Use Centralized Error Utilities

```javascript
const {
  createErrorResponse,
  createSuccessResponse,
  withErrorHandling,
} = require('../shared/errorHandlingUtils');

// Wrap IPC handlers
const handler = withErrorHandling(
  async (filePath) => {
    const result = await analyzeFile(filePath);
    return result;
  },
  {
    context: 'FileAnalysis',
    operation: 'analyze-file',
  },
);
```

### Standardized Error Format

```javascript
// Always return consistent error structure
try {
  const result = await operation();
  return createSuccessResponse(result);
} catch (error) {
  logger.error('Operation failed', { error: error.message });
  return createErrorResponse(error.message, ERROR_CODES.OPERATION_FAILED, {
    originalError: error.name,
  });
}
```

### Error Logging Pattern

```javascript
// Standard error logging format
logger.error('Failed to analyze file', {
  filePath,
  error: error.message,
  stack: error.stack,
  code: error.code,
  context: 'additional context',
});
```

### Never Swallow Errors

```javascript
// Bad: Silent failure
try {
  await riskyOperation();
} catch (error) {
  // Nothing - error is lost!
}

// Good: Log and handle
try {
  await riskyOperation();
} catch (error) {
  logger.error('Risky operation failed', { error: error.message });
  // Rethrow, return error, or provide fallback
  throw error;
}
```

## Promise Handling

### Prefer async/await Over .then()

```javascript
// Bad: Promise chains with .then()
function processFile(filePath) {
  return readFile(filePath)
    .then((content) => extractText(content))
    .then((text) => analyzeText(text))
    .then((results) => saveResults(results))
    .catch((error) => handleError(error));
}

// Good: async/await for clarity
async function processFile(filePath) {
  try {
    const content = await readFile(filePath);
    const text = await extractText(content);
    const results = await analyzeText(text);
    await saveResults(results);
    return results;
  } catch (error) {
    handleError(error);
    throw error;
  }
}
```

### Parallel vs Sequential

```javascript
// Sequential (when order matters or operations depend on each other)
async function processInOrder() {
  const file1 = await readFile('file1.txt');
  const file2 = await readFile('file2.txt'); // Waits for file1
  return [file1, file2];
}

// Parallel (when operations are independent)
async function processInParallel() {
  const [file1, file2] = await Promise.all([
    readFile('file1.txt'),
    readFile('file2.txt'), // Runs concurrently
  ]);
  return [file1, file2];
}
```

### Always Handle Promise Rejections

```javascript
// Bad: Unhandled rejection
someAsyncFunction(); // If this rejects, it's unhandled

// Good: Proper handling
someAsyncFunction().catch((error) => {
  logger.error('Async operation failed', { error: error.message });
});

// Better: Use try-catch in async context
async function caller() {
  try {
    await someAsyncFunction();
  } catch (error) {
    logger.error('Async operation failed', { error: error.message });
  }
}
```

## Code Formatting

### Indentation

- **Standard**: 2 spaces (already configured in project)
- Use consistent indentation across all files
- Configure editor to show whitespace

### Semicolons

- **Standard**: Use semicolons (project convention)
- Prevents ASI (Automatic Semicolon Insertion) bugs

```javascript
// Good: Explicit semicolons
const value = getValue();
doSomething(value);

// Bad: Missing semicolons (can cause issues)
const value = getValue();
doSomething(value);
```

### Line Length

- **Target**: 80-100 characters
- **Maximum**: 120 characters
- Break long lines for readability

```javascript
// Bad: Too long
const result = await someVeryLongFunctionName(
  parameter1,
  parameter2,
  parameter3,
  parameter4,
  parameter5,
);

// Good: Broken for readability
const result = await someVeryLongFunctionName(
  parameter1,
  parameter2,
  parameter3,
  parameter4,
  parameter5,
);
```

### Object and Array Formatting

```javascript
// Short objects: Single line
const point = { x: 10, y: 20 };

// Long objects: Multi-line with trailing comma
const config = {
  timeout: 5000,
  retries: 3,
  model: 'llama3.2:1b',
  verbose: true,
};

// Arrays: Multi-line for multiple items
const supportedFormats = ['.pdf', '.docx', '.txt', '.jpg'];
```

### Blank Lines

```javascript
// Use blank lines to separate logical sections
function processFile(filePath) {
  // Validation
  if (!filePath) {
    throw new Error('File path required');
  }

  // Processing
  const content = readFile(filePath);
  const analysis = analyzeContent(content);

  // Return results
  return {
    filePath,
    analysis,
    timestamp: Date.now(),
  };
}
```

## JSDoc Documentation

### Document All Public Methods

```javascript
/**
 * Analyzes a file and generates organization suggestions
 * @param {string} filePath - Absolute path to the file
 * @param {Object} options - Analysis options
 * @param {boolean} [options.skipCache=false] - Skip cache lookup
 * @param {number} [options.timeout=30000] - Timeout in milliseconds
 * @returns {Promise<AnalysisResult>} Analysis results with suggestions
 * @throws {Error} If file cannot be read or analysis fails
 * @example
 * const result = await analyzeFile('/path/to/file.pdf', { skipCache: true });
 */
async function analyzeFile(filePath, options = {}) {
  // Implementation
}
```

### Type Definitions

```javascript
/**
 * @typedef {Object} AnalysisResult
 * @property {string} filePath - Path to analyzed file
 * @property {string} category - Detected category
 * @property {string[]} keywords - Extracted keywords
 * @property {number} confidence - Confidence score (0-1)
 * @property {string} suggestedFolder - Suggested destination folder
 */

/**
 * @typedef {Object} FileMetadata
 * @property {string} name - File name
 * @property {number} size - File size in bytes
 * @property {Date} created - Creation date
 * @property {Date} modified - Last modified date
 */
```

### Class Documentation

```javascript
/**
 * Service for analyzing files using AI models
 * Handles document and image analysis with caching
 */
class FileAnalysisService {
  /**
   * Creates a new FileAnalysisService
   * @param {OllamaService} ollamaService - Ollama service instance
   */
  constructor(ollamaService) {
    this.ollamaService = ollamaService;
  }

  /**
   * Analyzes a document file
   * @param {string} filePath - Path to document
   * @returns {Promise<AnalysisResult>} Analysis results
   */
  async analyzeDocument(filePath) {
    // Implementation
  }
}
```

## Function Length and Complexity

### Function Length Guidelines

- **Target**: < 50 lines
- **Warning**: 50-100 lines
- **Refactor**: > 100 lines

```javascript
// Bad: Long function doing too much (150+ lines)
async function processAndOrganizeFiles(files) {
  // Validation (20 lines)
  // File reading (30 lines)
  // Analysis (40 lines)
  // Suggestion generation (30 lines)
  // Organization (30 lines)
  // Error handling (20 lines)
}

// Good: Split into focused functions
async function processAndOrganizeFiles(files) {
  validateFiles(files);
  const contents = await readFiles(files);
  const analyses = await analyzeFiles(contents);
  const suggestions = generateSuggestions(analyses);
  await organizeFiles(suggestions);
}
```

### Reduce Nesting Depth

- **Target**: < 3 levels
- **Warning**: 3-4 levels
- **Refactor**: > 4 levels

```javascript
// Bad: Deep nesting (5 levels)
function processItem(item) {
  if (item) {
    if (item.isValid) {
      if (item.hasData) {
        if (item.data.length > 0) {
          if (item.data[0].isReady) {
            return process(item.data[0]);
          }
        }
      }
    }
  }
}

// Good: Early returns (2 levels max)
function processItem(item) {
  if (!item) return null;
  if (!item.isValid) return null;
  if (!item.hasData) return null;
  if (item.data.length === 0) return null;
  if (!item.data[0].isReady) return null;

  return process(item.data[0]);
}
```

### Cyclomatic Complexity

- **Target**: < 10
- **Warning**: 10-15
- **Refactor**: > 15

```javascript
// Bad: High complexity (many branches)
function determineAction(type, status, user) {
  if (type === 'A') {
    if (status === 'active') {
      if (user.isAdmin) {
        return 'admin-action-A';
      } else {
        return 'user-action-A';
      }
    } else {
      return 'inactive-A';
    }
  } else if (type === 'B') {
    // More branches...
  }
  // ... many more conditions
}

// Good: Use lookup tables or strategy pattern
const ACTION_MAP = {
  'A-active-admin': 'admin-action-A',
  'A-active-user': 'user-action-A',
  'A-inactive': 'inactive-A',
  // ...
};

function determineAction(type, status, user) {
  const role = user.isAdmin ? 'admin' : 'user';
  const key = `${type}-${status}-${role}`;
  return ACTION_MAP[key] || 'default-action';
}
```

## Import Organization

### Import Order

1. Node built-ins
2. External packages
3. Internal absolute imports
4. Internal relative imports

```javascript
// 1. Node built-ins
const fs = require('fs').promises;
const path = require('path');

// 2. External packages
const { Ollama } = require('ollama');
const sharp = require('sharp');

// 3. Internal absolute imports (from src/)
const { logger } = require('../shared/logger');
const { ERROR_CODES } = require('../shared/errorHandlingUtils');

// 4. Internal relative imports
const { extractText } = require('./documentExtractors');
const { analyzeImage } = require('./imageAnalysis');
```

### Remove Unused Imports

```javascript
// Bad: Unused imports
const fs = require('fs'); // Not used
const path = require('path'); // Used
const { logger } = require('../shared/logger'); // Not used

// Good: Only what's needed
const path = require('path');
```

### Group Related Imports

```javascript
// Good: Grouped by purpose
// File operations
const fs = require('fs').promises;
const path = require('path');

// AI services
const { Ollama } = require('ollama');
const { analyzeWithLLM } = require('./llmService');

// Utilities
const { logger } = require('../shared/logger');
const { sanitizePath } = require('../shared/pathSanitization');
```

## Code Review Checklist

Before submitting code, verify:

### Naming

- [ ] Variables have descriptive names
- [ ] Functions use verb+noun pattern
- [ ] Boolean variables use is/has/should prefix
- [ ] Constants use UPPER_SNAKE_CASE
- [ ] No single-letter variables (except loop counters)

### Error Handling

- [ ] All promises have .catch() or try-catch
- [ ] Errors are logged with context
- [ ] Error responses use standard format
- [ ] No swallowed errors

### Formatting

- [ ] Consistent 2-space indentation
- [ ] Semicolons used consistently
- [ ] Line length < 120 characters
- [ ] Blank lines separate logical sections

### Documentation

- [ ] Public functions have JSDoc
- [ ] Complex logic has inline comments
- [ ] Type definitions for complex objects
- [ ] Examples for non-obvious usage

### Function Quality

- [ ] Functions < 100 lines
- [ ] Nesting depth < 4 levels
- [ ] Single responsibility principle
- [ ] Extracted helper functions for repeated logic

### Imports

- [ ] Organized by category
- [ ] No unused imports
- [ ] No commented-out imports

### Testing

- [ ] Unit tests for new functions
- [ ] Edge cases covered
- [ ] Error cases tested

## Automated Checks

Configure ESLint rules:

```json
{
  "rules": {
    "max-len": ["warn", { "code": 120 }],
    "max-lines-per-function": ["warn", 100],
    "max-depth": ["warn", 4],
    "complexity": ["warn", 15],
    "no-unused-vars": "error",
    "semi": ["error", "always"],
    "indent": ["error", 2]
  }
}
```

Configure Prettier:

```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "printWidth": 100,
  "trailingComma": "es5"
}
```
