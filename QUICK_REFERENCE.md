# Code Quality Quick Reference Guide

## I need to...

### ...handle errors consistently

**Use:** `src/shared/errorHandlingUtils.js`

```javascript
const {
  withErrorHandling,
  createErrorResponse,
} = require('../shared/errorHandlingUtils');

// Wrap your async functions
const handler = withErrorHandling(
  async (arg) => {
    /* your code */
  },
  { context: 'MyModule', operation: 'my-operation' },
);
```

**See:** docs/CODE_QUALITY_STANDARDS.md - Error Handling section

### ...replace console.log with logger

**Use:** `src/shared/logger.js`

```javascript
const { logger } = require('../shared/logger');

// Before: console.log('Message');
// After:
logger.info('Message', { data });
logger.error('Error', { error: error.message });
logger.debug('Debug info', { details });
```

**See:** docs/CONSOLE_LOG_MIGRATION.md

### ...avoid magic numbers

**Use:** `src/shared/performanceConstants.js`

```javascript
const { TIMEOUTS, RETRY, CACHE } = require('../shared/performanceConstants');

// Before: setTimeout(callback, 5000);
// After:
setTimeout(callback, TIMEOUTS.FILE_READ);

// Before: if (size > 50000000)
// After:
if (size > FILE_SIZE.MAX_DOCUMENT_SIZE)
```

### ...add JSDoc to my functions

**Template:**

```javascript
/**
 * Brief description of what the function does
 * @param {string} paramName - Description of parameter
 * @param {Object} [options] - Optional parameter
 * @param {boolean} [options.flag=false] - Optional nested parameter
 * @returns {Promise<ResultType>} Description of return value
 * @throws {Error} When this error occurs
 * @example
 * const result = await myFunction('value', { flag: true });
 */
async function myFunction(paramName, options = {}) {
  // implementation
}
```

**See:** docs/CODE_QUALITY_STANDARDS.md - JSDoc section

### ...write tests for critical paths

**Priority Order:**

1. File analysis pipeline
2. File organization system
3. IPC communication
4. Smart folders & embeddings
5. Settings management

**See:** docs/TESTING_STRATEGY.md

### ...optimize performance

**Check:** docs/PERFORMANCE_BENCHMARKING.md

**Known Bottlenecks:**

1. LLM inference (2-10 seconds per file)
2. File reading and hashing (0.5-5 seconds)
3. Embedding generation (1-3 seconds)
4. Large list rendering in React
5. Database queries without indexing
6. Memory leaks from event listeners

### ...refactor a long function

**Guidelines:**

- Target: < 50 lines
- Warning: 50-100 lines
- Refactor: > 100 lines

**See:** docs/REFACTORING_CANDIDATES.md

**Top Candidates:**

1. DiscoverPhase.jsx (1880 lines total)
2. OrganizationSuggestionService.js (1731 lines)
3. simple-main.js (1697 lines)
4. ChromaDBService.js (1095 lines)

### ...follow naming conventions

**Quick Rules:**

- Variables: `descriptiveName` (camelCase)
- Booleans: `isReady`, `hasData`, `shouldProcess`
- Functions: `doSomething()` (verb + noun)
- Classes: `ClassName` (PascalCase)
- Constants: `MAX_VALUE` (UPPER_SNAKE_CASE)
- Private: `_privateMethod()` (underscore prefix)

**See:** docs/CODE_QUALITY_STANDARDS.md - Naming section

### ...handle promises properly

**Prefer async/await:**

```javascript
// Good
async function process() {
  try {
    const result = await operation();
    return result;
  } catch (error) {
    logger.error('Failed', { error: error.message });
    throw error;
  }
}

// Avoid .then() chains
```

**See:** docs/CODE_QUALITY_STANDARDS.md - Promise Handling section

## Common Tasks

### Add retry logic to a function

```javascript
const { withRetry } = require('../shared/errorHandlingUtils');

const reliableFunction = withRetry(myFunction, {
  maxRetries: 3,
  initialDelay: 1000,
  shouldRetry: (error) => error.code === 'NETWORK_ERROR',
});
```

### Add timeout to an operation

```javascript
const { withTimeout } = require('../shared/errorHandlingUtils');

const timedFunction = withTimeout(myAsyncFunction, 5000, 'Operation timed out');
```

### Validate input

```javascript
const { validateInput } = require('../shared/errorHandlingUtils');

validateInput(input, {
  filePath: { required: true, type: 'string' },
  timeout: { type: 'number', min: 0, max: 60000 },
  options: { required: false, type: 'object' },
});
```

### Set logger context

```javascript
const { logger } = require('../shared/logger');

// At top of file
logger.setContext('file-analysis');

// All logs will now include [file-analysis] context
```

## File Locations

### Utilities

- Error handling: `src/shared/errorHandlingUtils.js`
- Logger: `src/shared/logger.js`
- Constants: `src/shared/constants.js`
- Performance constants: `src/shared/performanceConstants.js`
- Path sanitization: `src/shared/pathSanitization.js`
- Settings validation: `src/shared/settingsValidation.js`

### Documentation

- Console.log migration: `docs/CONSOLE_LOG_MIGRATION.md`
- Testing strategy: `docs/TESTING_STRATEGY.md`
- Performance guide: `docs/PERFORMANCE_BENCHMARKING.md`
- Code standards: `docs/CODE_QUALITY_STANDARDS.md`
- Refactoring guide: `docs/REFACTORING_CANDIDATES.md`

### Reports

- Detailed improvements: `CODE_QUALITY_IMPROVEMENTS.md`
- Executive summary: `CODE_QUALITY_SUMMARY.md`

## Checklists

### Before Committing Code

- [ ] No console.log (use logger instead)
- [ ] No magic numbers (use constants)
- [ ] Functions < 100 lines
- [ ] JSDoc on public methods
- [ ] Errors properly handled
- [ ] No unused imports
- [ ] No commented code
- [ ] Tests added/updated

### Code Review Checklist

- [ ] Descriptive variable names
- [ ] Consistent error handling
- [ ] Proper async/await usage
- [ ] No deep nesting (< 4 levels)
- [ ] Documentation complete
- [ ] Tests pass
- [ ] No performance regressions

## Getting Help

### I'm not sure which pattern to use

**Check:** docs/CODE_QUALITY_STANDARDS.md - Has examples for everything

### I need to refactor but don't know where to start

**Check:** docs/REFACTORING_CANDIDATES.md - Prioritized list with strategies

### I need to improve performance

**Check:** docs/PERFORMANCE_BENCHMARKING.md - Bottlenecks and solutions

### I need to write tests

**Check:** docs/TESTING_STRATEGY.md - Critical paths and examples

### I need to migrate from console.log

**Check:** docs/CONSOLE_LOG_MIGRATION.md - Step-by-step guide

## Emergency Quick Fixes

### My function is too long (> 100 lines)

1. Extract repeated code into helper functions
2. Move validation to separate function
3. Extract error handling to wrapper
4. Split into smaller focused functions

### My code is too deeply nested (> 4 levels)

1. Use early returns
2. Extract nested logic into functions
3. Invert if conditions
4. Use guard clauses

### I have magic numbers everywhere

1. Add them to `src/shared/performanceConstants.js`
2. Import and use the constants
3. Document what they represent

### My code has no error handling

1. Wrap with `withErrorHandling` from errorHandlingUtils
2. Add try-catch blocks
3. Use standardized error responses
4. Log errors with context

## Tips for Success

1. **Start Small** - Don't refactor everything at once
2. **Test First** - Write tests before refactoring
3. **One Change at a Time** - Don't mix refactoring with features
4. **Use the Tools** - Leverage the utilities we created
5. **Follow the Guides** - We've documented everything
6. **Ask Questions** - Check the docs before starting

## Next Actions (Prioritized)

### This Week

1. Migrate console.log in DiscoverPhase.jsx
2. Add JSDoc to FileAnalysisService

### Next Week

3. Replace magic numbers with constants
4. Write tests for file analysis pipeline

### This Month

5. Refactor DiscoverPhase component
6. Add performance monitoring

### This Quarter

7. Complete refactoring roadmap
8. Achieve 70% test coverage
