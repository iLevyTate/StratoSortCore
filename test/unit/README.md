# Unit Tests

Unit tests mock external dependencies and test internal logic in isolation.

## Running Unit Tests Only

```bash
npm test -- --testPathPattern="test/unit"
```

## Test Structure

- Mock ALL external services (LLM, vector DB, filesystem)
- Test single functions/methods
- No network calls
- No file I/O

## Guidelines

1. **Isolation**: Each test should be independent and not rely on external state
2. **Mocking**: Use Jest mocks for external dependencies
3. **Focused**: Test one behavior per test case
4. **Fast**: Unit tests should complete quickly (< 100ms per test)

## Example Structure

```javascript
describe('FunctionName', () => {
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
  });

  it('should handle normal input', () => {
    // Test normal case
  });

  it('should handle edge cases', () => {
    // Test edge cases
  });

  it('should throw on invalid input', () => {
    // Test error handling
  });
});
```
