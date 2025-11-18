# Edge Case Utilities - Integration Guide

## Quick Start

This guide shows you how to use the new edge case utilities to write more robust code.

---

## Node.js / Main Process Utilities

### Import

```javascript
const {
  safeArray,
  safeString,
  safeDivide,
  withTimeout,
  retry,
  createBoundedCache,
} = require('../../shared/edgeCaseUtils');
```

### Common Patterns

#### 1. Safe Array Access

```javascript
// ❌ BEFORE: Crashes if props.items is null/undefined
const count = props.items.length;

// ✅ AFTER: Safe with default value
const { safeArray } = require('../../shared/edgeCaseUtils');
const count = safeArray(props.items, []).length;
```

#### 2. Division by Zero Protection

```javascript
// ❌ BEFORE: Returns Infinity or NaN
const average = total / count;

// ✅ AFTER: Safe with default
const { safeDivide } = require('../../shared/edgeCaseUtils');
const average = safeDivide(total, count, 0);
```

#### 3. Async with Timeout

```javascript
// ❌ BEFORE: Might hang forever
const data = await fetchFromAPI();

// ✅ AFTER: Times out after 5 seconds
const { withTimeout } = require('../../shared/edgeCaseUtils');
const data = await withTimeout(fetchFromAPI(), 5000, 'API request timed out');
```

#### 4. Retry with Backoff

```javascript
// ❌ BEFORE: Fails on first error
const data = await unstableOperation();

// ✅ AFTER: Retries up to 3 times with backoff
const { retry } = require('../../shared/edgeCaseUtils');
const data = await retry(() => unstableOperation(), {
  maxRetries: 3,
  initialDelay: 1000,
  backoffFactor: 2,
});
```

#### 5. Bounded Cache

```javascript
// ❌ BEFORE: Unbounded memory growth
const cache = {};
cache[key] = value; // Grows forever

// ✅ AFTER: Automatic LRU eviction
const { createBoundedCache } = require('../../shared/edgeCaseUtils');
const cache = createBoundedCache(100); // Max 100 entries

cache.set(key, value);
const value = cache.get(key);
```

---

## React / Renderer Process Utilities

### Import

```javascript
import {
  useStableCallback,
  useSafeState,
  useEventListener,
  useDebounce,
  useCancellablePromises,
} from '../utils/reactEdgeCaseUtils';
```

### Common Patterns

#### 1. Prevent Stale Closures

```javascript
// ❌ BEFORE: Closure captures old value
function MyComponent({ onSave }) {
  const handleClick = () => {
    setTimeout(() => {
      onSave(); // Might be stale after 1 second
    }, 1000);
  };

  return <button onClick={handleClick}>Save Later</button>;
}

// ✅ AFTER: Always uses latest callback
import { useStableCallback } from '../utils/reactEdgeCaseUtils';

function MyComponent({ onSave }) {
  const handleClick = useStableCallback(() => {
    setTimeout(() => {
      onSave(); // Always latest version
    }, 1000);
  });

  return <button onClick={handleClick}>Save Later</button>;
}
```

#### 2. Safe State Updates

```javascript
// ❌ BEFORE: State update after unmount warning
function MyComponent() {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetchData().then(setData); // Might update after unmount
  }, []);

  return <div>{data}</div>;
}

// ✅ AFTER: Automatically prevents updates after unmount
import { useSafeState } from '../utils/reactEdgeCaseUtils';

function MyComponent() {
  const [data, setData] = useSafeState(null);

  useEffect(() => {
    fetchData().then(setData); // Safe - no warning
  }, []);

  return <div>{data}</div>;
}
```

#### 3. Event Listener Cleanup

```javascript
// ❌ BEFORE: Manual cleanup (easy to forget)
function MyComponent() {
  useEffect(() => {
    const handleResize = () => console.log('resize');
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return <div>Resize the window</div>;
}

// ✅ AFTER: Automatic cleanup
import { useEventListener } from '../utils/reactEdgeCaseUtils';

function MyComponent() {
  useEventListener('resize', () => console.log('resize'));
  return <div>Resize the window</div>;
}
```

#### 4. Debounced Input

```javascript
// ❌ BEFORE: Triggers on every keystroke
function SearchBox() {
  const [query, setQuery] = useState('');

  const handleSearch = (q) => {
    // Expensive operation on every keystroke
    expensiveSearchAPI(q);
  };

  return (
    <input
      onChange={(e) => {
        setQuery(e.target.value);
        handleSearch(e.target.value);
      }}
    />
  );
}

// ✅ AFTER: Debounced to reduce API calls
import { useDebounce, useDebouncedCallback } from '../utils/reactEdgeCaseUtils';

function SearchBox() {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 500);

  useEffect(() => {
    if (debouncedQuery) {
      expensiveSearchAPI(debouncedQuery);
    }
  }, [debouncedQuery]);

  return <input onChange={(e) => setQuery(e.target.value)} />;
}
```

#### 5. Cancel Pending Promises

```javascript
// ❌ BEFORE: Promise continues after unmount
function MyComponent() {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetchData().then(setData); // Continues even after unmount
  }, []);

  return <div>{data}</div>;
}

// ✅ AFTER: Automatically cancels on unmount
import {
  useCancellablePromises,
  useSafeState,
} from '../utils/reactEdgeCaseUtils';

function MyComponent() {
  const [data, setData] = useSafeState(null);
  const { makeCancellable } = useCancellablePromises();

  useEffect(() => {
    const { promise } = makeCancellable(fetchData());
    promise.then(setData);
  }, []);

  return <div>{data}</div>;
}
```

---

## API Reference

### Node.js Utilities (`src/shared/edgeCaseUtils.js`)

#### Array/String Safety

- `safeArray(value, default)` - Convert to array or return default
- `safeNonEmptyArray(value, default)` - Ensure non-empty array
- `safeString(value, default)` - Convert to string or return default
- `safeNonEmptyString(value, default)` - Ensure non-empty string
- `safeNumber(value, default)` - Convert to number or return default
- `safePositiveNumber(value, default)` - Ensure positive number

#### Math Safety

- `safeAverage(values, default)` - Calculate average with empty array handling
- `safeDivide(num, denom, default)` - Division with zero protection
- `safePercentage(part, total, default)` - Safe percentage calculation

#### Array Operations

- `safeFirst(arr, default)` - Get first element safely
- `safeLast(arr, default)` - Get last element safely
- `safeGet(arr, index, default)` - Get element at index safely
- `safeFind(arr, predicate, default)` - Find with fallback
- `safeFilter(arr, predicate)` - Filter with error handling
- `safeMap(arr, mapper)` - Map with error handling

#### Object Access

- `safeGetNestedProperty(obj, path, default)` - Get nested property safely
- `safeHasProperty(obj, prop)` - Check property existence safely

#### Async Helpers

- `withTimeout(promise, ms, message)` - Add timeout to promise
- `retry(fn, options)` - Retry with exponential backoff
- `safeAwait(promise, default)` - Await with fallback value

#### Type Validation

- `isPlainObject(value)` - Check if plain object
- `validateType(value, constraints)` - Validate and sanitize type

#### Resource Management

- `createBoundedCache(maxSize)` - Create LRU cache
- `createRateLimiter(maxCalls, windowMs)` - Rate limiting
- `debounce(fn, waitMs)` - Debounce function

---

### React Hooks (`src/renderer/utils/reactEdgeCaseUtils.js`)

#### State Management

- `useLatest(value)` - Get ref to latest value
- `useStableCallback(callback)` - Stable callback with latest values
- `usePrevious(value)` - Get previous value
- `useSafeState(initial)` - State with unmount protection

#### Event Listeners

- `useEventListener(eventName, handler, target, options)` - Auto-cleanup listener
- `useWindowResize(callback, delay)` - Debounced resize handler
- `useClickOutside(ref, callback)` - Detect clicks outside element

#### Debounce/Throttle

- `useDebounce(value, delay)` - Debounce value
- `useDebouncedCallback(callback, delay)` - Debounce callback
- `useThrottledCallback(callback, limit)` - Throttle callback

#### Async Operations

- `useAsync(asyncFn, deps)` - Async with loading/error states
- `useCancellablePromises()` - Cancel promises on unmount

#### Performance

- `useMountTracking(componentName)` - Track mount/unmount
- `useForceUpdate()` - Force re-render
- `useInterval(callback, delay)` - Interval with cleanup
- `useTimeout(callback, delay)` - Timeout with cleanup

#### Data Validation

- `useValidatedProp(prop, validator, fallback)` - Validate props
- `useNonEmptyArray(arr, fallback)` - Ensure non-empty array
- `useNonEmptyString(str, fallback)` - Ensure non-empty string

#### Utilities

- `useIsMounted()` - Check if mounted
- `useWindowFocus()` - Track window focus
- `useOnlineStatus()` - Track online/offline

---

## Migration Examples

### Example 1: Fixing Array Iteration

```javascript
// ❌ BEFORE
function processItems(items) {
  // Crashes if items is null/undefined
  return items.map((item) => item.id);
}

// ✅ AFTER
const { safeArray } = require('../../shared/edgeCaseUtils');

function processItems(items) {
  return safeArray(items, []).map((item) => item.id);
}
```

### Example 2: Fixing Statistics Calculation

```javascript
// ❌ BEFORE
function getStatistics(entries) {
  const total = entries.reduce((sum, e) => sum + e.value, 0);
  return total / entries.length; // NaN if entries is empty!
}

// ✅ AFTER
const { safeDivide } = require('../../shared/edgeCaseUtils');

function getStatistics(entries) {
  if (!entries || entries.length === 0) {
    return 0;
  }

  const total = entries.reduce((sum, e) => sum + e.value, 0);
  return safeDivide(total, entries.length, 0);
}
```

### Example 3: Fixing React Event Handler

```javascript
// ❌ BEFORE
function FileUploader({ onUpload }) {
  const [files, setFiles] = useState([]);

  const handleDrop = (e) => {
    const dropped = Array.from(e.dataTransfer.files);
    setFiles(dropped);

    // Upload after delay - onUpload might be stale
    setTimeout(() => {
      onUpload(files); // BUG: Uses old 'files' value!
    }, 1000);
  };

  return <div onDrop={handleDrop}>Drop files here</div>;
}

// ✅ AFTER
import { useStableCallback } from '../utils/reactEdgeCaseUtils';

function FileUploader({ onUpload }) {
  const [files, setFiles] = useState([]);

  const handleDrop = useStableCallback((e) => {
    const dropped = Array.from(e.dataTransfer.files);
    setFiles(dropped);

    setTimeout(() => {
      onUpload(files); // ✓ Always uses latest 'files' value
    }, 1000);
  });

  return <div onDrop={handleDrop}>Drop files here</div>;
}
```

---

## Best Practices

### 1. Always Validate External Input

```javascript
// ✓ Good
const { safeString, validateType } = require('../../shared/edgeCaseUtils');

function processUserInput(input) {
  const safe = safeString(input, '').trim();

  if (safe.length === 0) {
    throw new Error('Input cannot be empty');
  }

  const validation = validateType(safe, {
    type: 'string',
    minLength: 1,
    maxLength: 100,
    pattern: /^[a-zA-Z0-9\s]+$/,
  });

  if (!validation.valid) {
    throw new Error(`Invalid input: ${validation.errors.join(', ')}`);
  }

  return validation.value;
}
```

### 2. Use Bounded Resources

```javascript
// ✓ Good
const { createBoundedCache } = require('../../shared/edgeCaseUtils');

class MyService {
  constructor() {
    this.cache = createBoundedCache(100); // Prevents memory leaks
  }

  async getData(key) {
    if (this.cache.has(key)) {
      return this.cache.get(key);
    }

    const data = await fetchData(key);
    this.cache.set(key, data);
    return data;
  }
}
```

### 3. Add Timeouts to Network Calls

```javascript
// ✓ Good
const { withTimeout } = require('../../shared/edgeCaseUtils');

async function fetchWithTimeout(url) {
  return withTimeout(
    fetch(url).then((r) => r.json()),
    5000,
    `Request to ${url} timed out`,
  );
}
```

### 4. Clean Up React Effects

```javascript
// ✓ Good
import {
  useEventListener,
  useCancellablePromises,
} from '../utils/reactEdgeCaseUtils';

function MyComponent() {
  const { makeCancellable } = useCancellablePromises();

  // Automatic cleanup
  useEventListener('resize', handleResize);

  useEffect(() => {
    const { promise } = makeCancellable(loadData());
    promise.then(setData);
  }, []);

  return <div>Content</div>;
}
```

---

## Common Gotchas

### 1. Don't Modify Default Values

```javascript
// ❌ BAD: Default array is mutated
const items = safeArray(maybeArray, []);
items.push(newItem); // Modifies the default!

// ✅ GOOD: Create new array
const items = [...safeArray(maybeArray, [])];
items.push(newItem);
```

### 2. Remember Hook Rules

```javascript
// ❌ BAD: Hook in conditional
if (condition) {
  useEventListener('click', handler); // Breaks React!
}

// ✅ GOOD: Use hook unconditionally
useEventListener('click', condition ? handler : null);
```

### 3. Don't Over-Debounce

```javascript
// ❌ BAD: Too aggressive debouncing
const debouncedSave = useDebouncedCallback(save, 5000);
// User might lose work if they close before 5 seconds!

// ✅ GOOD: Reasonable debounce for UX
const debouncedSave = useDebouncedCallback(save, 500);
```

---

## Testing with Utilities

### Unit Test Example

```javascript
const { safeDivide, withTimeout } = require('../../shared/edgeCaseUtils');

describe('Statistics Calculator', () => {
  test('handles empty array', () => {
    const result = calculateAverage([]);
    expect(result).toBe(0); // Not NaN!
  });

  test('handles division by zero', () => {
    const result = safeDivide(10, 0, 999);
    expect(result).toBe(999);
  });

  test('handles timeout', async () => {
    const slowOp = () => new Promise((r) => setTimeout(r, 1000));

    await expect(withTimeout(slowOp(), 100, 'Timeout')).rejects.toThrow(
      'Timeout',
    );
  });
});
```

### React Hook Test Example

```javascript
import { renderHook, act } from '@testing-library/react-hooks';
import { useStableCallback, useSafeState } from '../utils/reactEdgeCaseUtils';

test('useStableCallback always uses latest value', () => {
  let value = 1;

  const { result, rerender } = renderHook(() => useStableCallback(() => value));

  expect(result.current()).toBe(1);

  value = 2;
  rerender();

  expect(result.current()).toBe(2);
});
```

---

## Need Help?

- See `EDGE_CASE_FIXES_COMPREHENSIVE_REPORT.md` for complete bug fixes
- Check `src/shared/edgeCaseUtils.js` for Node.js utilities source
- Check `src/renderer/utils/reactEdgeCaseUtils.js` for React hooks source
- Run tests with `npm test` to see usage examples

---

**Last Updated**: 2025-01-17
