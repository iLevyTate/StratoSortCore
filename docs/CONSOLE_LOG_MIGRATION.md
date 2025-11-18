# Console.log to Logger Migration Guide

## Overview

This document provides guidelines for migrating from `console.log` statements to the centralized logger system.

## Why Migrate?

### Benefits of Using Logger

1. **Structured Logging** - Consistent format across the application
2. **Log Levels** - Easy filtering by severity (ERROR, WARN, INFO, DEBUG, TRACE)
3. **Context Tracking** - Automatically includes timestamps and context
4. **File Logging** - Can write to log files in production
5. **Performance** - Can be disabled in production for better performance
6. **Searchability** - Easier to search and analyze logs

### Problems with console.log

1. No severity levels
2. No timestamps or context
3. Cannot be easily disabled
4. Inconsistent formatting
5. Hard to filter or search
6. Not production-friendly

## Logger API Reference

### Import the Logger

```javascript
const { logger } = require('../shared/logger');
// or in ES6 modules:
import { logger } from '../shared/logger';
```

### Log Levels

#### ERROR - Critical errors requiring attention

```javascript
// Before:
console.error('Failed to load file:', error);

// After:
logger.error('Failed to load file', {
  error: error.message,
  stack: error.stack,
});
```

#### WARN - Important but non-critical issues

```javascript
// Before:
console.warn('File already exists, skipping');

// After:
logger.warn('File already exists, skipping', { path: filePath });
```

#### INFO - General informational messages

```javascript
// Before:
console.log('[ANALYSIS] Starting analysis for:', filePath);

// After:
logger.info('Starting analysis', { filePath });
```

#### DEBUG - Detailed debugging information (development only)

```javascript
// Before:
console.log('[DEBUG] Current state:', state);

// After:
logger.debug('Current state', { state });
```

#### TRACE - Very detailed trace information

```javascript
// Before:
console.log('[TRACE] Function called with args:', args);

// After:
logger.trace('Function called', { args });
```

## Migration Patterns

### Pattern 1: Simple Log Messages

```javascript
// Before:
console.log('[RENDERER] Initializing React application...');

// After:
logger.info('Initializing React application');
```

### Pattern 2: Log with Data

```javascript
// Before:
console.log('[ANALYSIS] Batch processing', { filesProcessed, totalFiles });

// After:
logger.info('Batch processing', { filesProcessed, totalFiles });
```

### Pattern 3: Error Logging

```javascript
// Before:
console.error('[ORGANIZE] Error processing progress update:', error);

// After:
logger.error('Error processing progress update', {
  error: error.message,
  stack: error.stack,
  context: 'organize',
});
```

### Pattern 4: Conditional Logging

```javascript
// Before:
if (isDev) {
  console.log('[DEBUG] Cache hit:', cacheKey);
}

// After:
logger.debug('Cache hit', { cacheKey });
// Logger automatically filters based on log level
```

### Pattern 5: Performance Logging

```javascript
// Before:
const start = Date.now();
// ... operation ...
console.log(`Operation took ${Date.now() - start}ms`);

// After:
const start = Date.now();
// ... operation ...
logger.performance('Operation completed', Date.now() - start);
```

## Context-Specific Guidelines

### Renderer Process (React Components)

- Use INFO for component lifecycle events
- Use DEBUG for state changes
- Use WARN for recoverable errors
- Use ERROR for unrecoverable errors

```javascript
// Component example
useEffect(() => {
  logger.info('Component mounted', { component: 'AnalysisProgress' });
  return () => {
    logger.info('Component unmounting', { component: 'AnalysisProgress' });
  };
}, []);
```

### Main Process (Electron/Node)

- Use INFO for IPC handler registration
- Use DEBUG for IPC call details
- Use WARN for validation failures
- Use ERROR for system errors

```javascript
// IPC handler example
ipcMain.handle('analyze-file', async (event, filePath) => {
  logger.info('IPC: analyze-file called', { filePath });
  try {
    const result = await analyzeFile(filePath);
    logger.debug('Analysis complete', { result });
    return result;
  } catch (error) {
    logger.error('Analysis failed', { filePath, error: error.message });
    throw error;
  }
});
```

### Preload Scripts

Keep console.log for critical preload messages as logger may not be available yet:

```javascript
// Acceptable in preload:
console.log('[PRELOAD] Secure preload script loaded');

// But prefer logger when available:
const { logger } = require('../shared/logger');
logger.info('Preload script initialized');
```

## Setting Log Context

Set context for better log organization:

```javascript
// At the top of your module
logger.setContext('file-analysis');

// All subsequent logs will include this context
logger.info('Starting analysis'); // Will show: [file-analysis] Starting analysis
```

## When to Keep console.log

### Acceptable Uses

1. **Early initialization** - Before logger is available
2. **Preload scripts** - Security-critical sandboxed code
3. **Test files** - Quick debugging in tests
4. **Development debugging** - Temporary debug statements (remove before commit)

### Never Use console.log For

1. Production code in main/renderer processes
2. Error logging
3. IPC communication logging
4. User-facing messages
5. Performance metrics

## Configuration

### Set Log Level

```javascript
// In development
logger.setLevel('DEBUG');

// In production
logger.setLevel('INFO');
```

### Enable File Logging

```javascript
const logPath = path.join(app.getPath('userData'), 'app.log');
logger.enableFileLogging(logPath);
```

### Disable Console Output

```javascript
// Useful in production
logger.disableConsoleLogging();
```

## Migration Checklist

- [ ] Replace all `console.log` with `logger.info` or `logger.debug`
- [ ] Replace all `console.error` with `logger.error`
- [ ] Replace all `console.warn` with `logger.warn`
- [ ] Add context to log messages where appropriate
- [ ] Include relevant data objects instead of string interpolation
- [ ] Remove temporary debug console.logs
- [ ] Set appropriate log context in each module
- [ ] Test that log levels work correctly

## Files Requiring Migration

### High Priority (Many console.log statements)

- `src/renderer/phases/DiscoverPhase.jsx` - 30+ statements
- `src/renderer/phases/SetupPhase.jsx` - 10+ statements
- `src/renderer/index.js` - 5 statements
- `src/preload/preload.js` - 15+ statements

### Medium Priority

- `src/renderer/contexts/PhaseContext.jsx`
- `src/renderer/hooks/useConfirmDialog.js`
- `src/renderer/components/dashboard/TabContainer.js`

### Low Priority

- Test files (optional migration)
- Configuration files

## Examples of Good Logging

### Example 1: File Operation

```javascript
async function copyFile(source, destination) {
  logger.info('Copying file', { source, destination });
  try {
    await fs.copyFile(source, destination);
    logger.info('File copied successfully', { source, destination });
  } catch (error) {
    logger.error('File copy failed', {
      source,
      destination,
      error: error.message,
      code: error.code,
    });
    throw error;
  }
}
```

### Example 2: Analysis Operation

```javascript
async function analyzeFile(filePath) {
  const startTime = Date.now();
  logger.info('Starting file analysis', { filePath });

  try {
    const result = await performAnalysis(filePath);
    const duration = Date.now() - startTime;

    logger.info('Analysis completed', {
      filePath,
      duration: `${duration}ms`,
      confidence: result.confidence,
    });

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Analysis failed', {
      filePath,
      duration: `${duration}ms`,
      error: error.message,
    });
    throw error;
  }
}
```

## Automated Migration Script

For bulk replacements, use this regex pattern (with caution):

```javascript
// Find: console\.log\((['"])(.+?)\1,?\s*(.*)?\)
// Replace with appropriate logger call based on message severity
```

**Note**: Manual review is still required to determine correct log level and format data properly.

## Testing Logger Configuration

```javascript
// Test all log levels
logger.setLevel('TRACE');
logger.error('Test error message', { test: true });
logger.warn('Test warning message', { test: true });
logger.info('Test info message', { test: true });
logger.debug('Test debug message', { test: true });
logger.trace('Test trace message', { test: true });

// Verify filtering
logger.setLevel('WARN');
// Only ERROR and WARN should appear
```
