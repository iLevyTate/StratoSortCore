# Error Handling Guide

## Overview

This guide provides comprehensive patterns and best practices for error handling across the StratoSort codebase. It consolidates all error handling utilities and provides clear guidance on when to use each pattern.

---

## Table of Contents

1. [Error Handling Utilities](#error-handling-utilities)
2. [When to Use Each Pattern](#when-to-use-each-pattern)
3. [Decision Tree](#decision-tree)
4. [Code Examples](#code-examples)
5. [Best Practices](#best-practices)
6. [Common Patterns](#common-patterns)

---

## Error Handling Utilities

### 1. `errorHandlingUtils.js` (Shared)

**Location:** `src/shared/errorHandlingUtils.js`

**Purpose:** Centralized error handling for general async operations

**Functions:**

- `createErrorResponse(message, code, details)` - Standardized error response
- `createSuccessResponse(data)` - Standardized success response
- `withErrorHandling(fn, options)` - Wrapper for async functions
- `withRetry(fn, options)` - Retry logic with exponential backoff
- `withTimeout(promise, timeoutMs, operationName)` - Promise timeout wrapper

**Use When:**

- General async operations
- Service-level error handling
- Operations that need retry logic
- Operations that need timeout protection

### 2. `withErrorLogging.js` (IPC)

**Location:** `src/main/ipc/withErrorLogging.js`

**Purpose:** IPC handler-specific error handling

**Functions:**

- `withErrorLogging(logger, fn)` - Wraps IPC handlers with error logging
- `withValidation(logger, schema, handler)` - Adds validation to IPC handlers
- `createErrorResponse(error, context)` - IPC-specific error response
- `createSuccessResponse(data)` - IPC-specific success response

**Use When:**

- IPC handlers (`ipcMain.handle`)
- Need validation with Zod schemas
- IPC-specific error formatting required

### 3. `promiseUtils.js` (Main Utils)

**Location:** `src/main/utils/promiseUtils.js`

**Purpose:** Promise-specific utilities

**Functions:**

- `withTimeout(promise, timeoutMs, operationName)` - Promise timeout
- `withRetry(fn, options)` - Retry with exponential backoff
- `delay(ms)` - Simple delay utility

**Use When:**

- Need timeout protection for promises
- Need retry logic for operations
- Simple delay needed

### 4. `safeAccess.js` (Main Utils)

**Location:** `src/main/utils/safeAccess.js`

**Purpose:** Safe property access and function execution

**Functions:**

- `safeGet(obj, path, defaultValue)` - Safe nested property access
- `safeCall(fn, args, defaultValue)` - Safe function execution
- `safeFilePath(path)` - Safe file path validation

**Use When:**

- Accessing nested object properties
- Calling functions that might throw
- Validating file paths

### 5. Error Boundaries (Renderer)

**Locations:**

- `src/renderer/components/GlobalErrorBoundary.jsx`
- `src/renderer/components/PhaseErrorBoundary.jsx`
- `src/renderer/components/ErrorBoundary.jsx`

**Purpose:** React error boundaries for UI error handling

**Use When:**

- React component errors
- Need graceful UI fallback
- Phase-specific error handling

---

## When to Use Each Pattern

### Pattern 1: Standard Async Function Wrapper

**Utility:** `withErrorHandling` from `errorHandlingUtils.js`

**Use When:**

- General async operations
- Service methods
- Operations that should return standardized responses

**Example:**

```javascript
const { withErrorHandling } = require('../../shared/errorHandlingUtils');

const analyzeFile = withErrorHandling(
  async (filePath) => {
    const result = await performAnalysis(filePath);
    return result;
  },
  {
    context: 'FileAnalysis',
    operation: 'analyze-file',
  },
);
```

### Pattern 2: IPC Handler Wrapper

**Utility:** `withErrorLogging` from `withErrorLogging.js`

**Use When:**

- IPC handlers (`ipcMain.handle`)
- Need automatic error logging
- IPC communication

**Example:**

```javascript
const { withErrorLogging } = require('./withErrorLogging');

ipcMain.handle(
  IPC_CHANNELS.FILES.ANALYZE,
  withErrorLogging(logger, async (event, filePath) => {
    const result = await analyzeFile(filePath);
    return createSuccessResponse(result);
  }),
);
```

### Pattern 3: IPC Handler with Validation

**Utility:** `withValidation` from `withErrorLogging.js`

**Use When:**

- IPC handlers need input validation
- Using Zod schemas
- Need structured validation errors

**Example:**

```javascript
const { withValidation } = require('./withErrorLogging');
const z = require('zod');

const schema = z.object({
  filePath: z.string().min(1),
  options: z.object({}).optional(),
});

ipcMain.handle(
  IPC_CHANNELS.FILES.ANALYZE,
  withValidation(logger, schema, async (event, { filePath, options }) => {
    const result = await analyzeFile(filePath, options);
    return createSuccessResponse(result);
  }),
);
```

### Pattern 4: Retry Logic

**Utility:** `withRetry` from `errorHandlingUtils.js` or `promiseUtils.js`

**Use When:**

- Network operations
- Transient failures expected
- Operations that can be safely retried

**Example:**

```javascript
const { withRetry } = require('../../shared/errorHandlingUtils');

const result = await withRetry(
  async () => {
    return await fetchDataFromAPI();
  },
  {
    maxAttempts: 3,
    delay: 1000,
    backoff: 2,
    operationName: 'FetchData',
    shouldRetry: (error) => {
      return error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT';
    },
  },
);
```

### Pattern 5: Timeout Protection

**Utility:** `withTimeout` from `promiseUtils.js` or `errorHandlingUtils.js`

**Use When:**

- Long-running operations
- Network requests
- Operations that might hang

**Example:**

```javascript
const { withTimeout } = require('../utils/promiseUtils');

const result = await withTimeout(
  performLongOperation(),
  30000, // 30 seconds
  'LongOperation',
);
```

### Pattern 6: Safe Property Access

**Utility:** `safeGet` from `safeAccess.js`

**Use When:**

- Accessing nested object properties
- Properties might not exist
- Need default values

**Example:**

```javascript
const { safeGet } = require('../utils/safeAccess');

const userName = safeGet(user, 'profile.name', 'Anonymous');
const settings = safeGet(config, 'app.settings', {});
```

### Pattern 7: Safe Function Execution

**Utility:** `safeCall` from `safeAccess.js`

**Use When:**

- Calling functions that might throw
- Need fallback values
- Optional operations

**Example:**

```javascript
const { safeCall } = require('../utils/safeAccess');

const result = await safeCall(async () => await riskyOperation(), [], {
  default: 'fallback',
});
```

### Pattern 8: React Error Boundaries

**Utility:** Error Boundary components

**Use When:**

- React component errors
- Need UI fallback
- Prevent full app crash

**Example:**

```javascript
import GlobalErrorBoundary from './components/GlobalErrorBoundary';

function App() {
  return (
    <GlobalErrorBoundary>
      <YourComponent />
    </GlobalErrorBoundary>
  );
}
```

---

## Decision Tree

```
Start: Need error handling?
│
├─ Is it an IPC handler?
│  ├─ Yes → Use `withErrorLogging` or `withValidation`
│  │         └─ Need validation? → Use `withValidation`
│  │         └─ No validation? → Use `withErrorLogging`
│  │
│  └─ No → Continue
│
├─ Is it a React component?
│  ├─ Yes → Use Error Boundary
│  │         └─ Global? → `GlobalErrorBoundary`
│  │         └─ Phase-specific? → `PhaseErrorBoundary`
│  │
│  └─ No → Continue
│
├─ Need retry logic?
│  ├─ Yes → Use `withRetry`
│  │         └─ Also need timeout? → Combine with `withTimeout`
│  │
│  └─ No → Continue
│
├─ Need timeout protection?
│  ├─ Yes → Use `withTimeout`
│  │
│  └─ No → Continue
│
├─ Accessing nested properties?
│  ├─ Yes → Use `safeGet`
│  │
│  └─ No → Continue
│
├─ Calling function that might throw?
│  ├─ Yes → Use `safeCall` or try/catch
│  │
│  └─ No → Continue
│
└─ General async operation?
   └─ Yes → Use `withErrorHandling`
```

---

## Code Examples

### Example 1: Service Method with Error Handling

```javascript
const { withErrorHandling } = require('../../shared/errorHandlingUtils');

class FileAnalysisService {
  async analyzeFile(filePath) {
    return withErrorHandling(
      async () => {
        // Your logic here
        const result = await performAnalysis(filePath);
        return result;
      },
      {
        context: 'FileAnalysisService',
        operation: 'analyzeFile',
        onError: (error) => {
          // Custom error handling
          logger.error('Custom error handling', { filePath });
        },
      },
    )();
  }
}
```

### Example 2: IPC Handler with Validation

```javascript
const { withValidation } = require('./withErrorLogging');
const z = require('zod');

const analyzeSchema = z.object({
  filePath: z.string().min(1),
  options: z
    .object({
      includeMetadata: z.boolean().optional(),
    })
    .optional(),
});

ipcMain.handle(
  IPC_CHANNELS.FILES.ANALYZE,
  withValidation(
    logger,
    analyzeSchema,
    async (event, { filePath, options }) => {
      const result = await analyzeFile(filePath, options);
      return createSuccessResponse(result);
    },
  ),
);
```

### Example 3: Retry with Timeout

```javascript
const { withRetry } = require('../../shared/errorHandlingUtils');
const { withTimeout } = require('../utils/promiseUtils');

async function fetchWithRetryAndTimeout() {
  return await withRetry(
    async () => {
      return await withTimeout(
        fetchDataFromAPI(),
        10000, // 10 second timeout
        'FetchData',
      );
    },
    {
      maxAttempts: 3,
      delay: 1000,
      operationName: 'FetchData',
    },
  );
}
```

### Example 4: Safe Property Access

```javascript
const { safeGet } = require('../utils/safeAccess');

function getUserDisplayName(user) {
  // Safe access with fallback
  return safeGet(
    user,
    'profile.displayName',
    safeGet(user, 'email', 'Anonymous'),
  );
}
```

### Example 5: Error Boundary Usage

```javascript
import PhaseErrorBoundary from './components/PhaseErrorBoundary';

function DiscoverPhase() {
  return (
    <PhaseErrorBoundary phaseName="DISCOVER">
      <DiscoverContent />
    </PhaseErrorBoundary>
  );
}
```

---

## Best Practices

### 1. Always Log Errors

```javascript
// Bad: Silent failure
try {
  await operation();
} catch (error) {
  // Nothing
}

// Good: Log errors
try {
  await operation();
} catch (error) {
  logger.error('Operation failed', {
    error: error.message,
    stack: error.stack,
  });
  throw error;
}
```

### 2. Use Standardized Responses

```javascript
// Bad: Inconsistent response format
return { success: true, data: result };
return { ok: true, result };
return result;

// Good: Standardized format
return createSuccessResponse(result);
return createErrorResponse('Error message', ERROR_CODES.FILE_NOT_FOUND);
```

### 3. Provide Context in Errors

```javascript
// Bad: Generic error
throw new Error('Failed');

// Good: Contextual error
throw new Error(`Failed to analyze file: ${filePath}`, {
  filePath,
  errorCode: ERROR_CODES.ANALYSIS_FAILED,
});
```

### 4. Use Appropriate Error Codes

```javascript
// Use ERROR_CODES from errorHandlingUtils.js
const { ERROR_CODES } = require('../../shared/errorHandlingUtils');

return createErrorResponse('File not found', ERROR_CODES.FILE_NOT_FOUND, {
  filePath,
});
```

### 5. Handle Errors at the Right Level

```javascript
// Bad: Catching and swallowing at low level
function helper() {
  try {
    riskyOperation();
  } catch (error) {
    // Swallowed
  }
}

// Good: Let errors bubble up to appropriate handler
function helper() {
  return riskyOperation(); // Let caller handle
}
```

### 6. Use Error Boundaries for UI Errors

```javascript
// Always wrap components that might error
<GlobalErrorBoundary>
  <App />
</GlobalErrorBoundary>
```

---

## Common Patterns

### Pattern: Try-Catch with Logging

```javascript
try {
  const result = await operation();
  return result;
} catch (error) {
  logger.error('Operation failed', {
    error: error.message,
    stack: error.stack,
    context: 'additional context',
  });
  throw error; // Re-throw or return error response
}
```

### Pattern: Validation Before Operation

```javascript
if (!filePath || typeof filePath !== 'string') {
  return createErrorResponse('Invalid file path', ERROR_CODES.INVALID_INPUT, {
    filePath,
  });
}

try {
  const result = await processFile(filePath);
  return createSuccessResponse(result);
} catch (error) {
  logger.error('File processing failed', { filePath, error: error.message });
  return createErrorResponse(error.message, ERROR_CODES.FILE_READ_ERROR);
}
```

### Pattern: Retry with Exponential Backoff

```javascript
const { withRetry } = require('../../shared/errorHandlingUtils');

const result = await withRetry(async () => await networkOperation(), {
  maxAttempts: 3,
  delay: 1000, // Initial delay: 1 second
  backoff: 2, // Double each time
  // Attempt 1: 1s delay
  // Attempt 2: 2s delay
  // Attempt 3: 4s delay
});
```

### Pattern: Timeout with Fallback

```javascript
const { withTimeout } = require('../utils/promiseUtils');

try {
  const result = await withTimeout(
    slowOperation(),
    5000, // 5 second timeout
    'SlowOperation',
  );
  return result;
} catch (error) {
  if (error.message.includes('timed out')) {
    logger.warn('Operation timed out, using fallback');
    return fallbackValue;
  }
  throw error;
}
```

---

## Error Response Format

All error responses follow this structure:

```javascript
{
  success: false,
  error: "Error message",
  code: "ERROR_CODE",
  details: {
    // Additional context
  }
}
```

All success responses follow this structure:

```javascript
{
  success: true,
  data: {
    // Response data
  }
}
```

---

## Summary

1. **IPC Handlers** → Use `withErrorLogging` or `withValidation`
2. **React Components** → Use Error Boundaries
3. **General Async** → Use `withErrorHandling`
4. **Need Retry** → Use `withRetry`
5. **Need Timeout** → Use `withTimeout`
6. **Safe Access** → Use `safeGet` or `safeCall`
7. **Always Log** → Never swallow errors silently
8. **Standardize** → Use `createErrorResponse` and `createSuccessResponse`

---

**Last Updated:** 2025-01-16  
**Version:** 1.0
