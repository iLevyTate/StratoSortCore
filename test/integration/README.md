# Integration Tests

Integration tests verify component interactions with real or semi-real dependencies.

## Prerequisites

- Local models downloaded (`npm run setup:models`)

## Running Integration Tests

```bash
npm test -- --testPathPattern="test/integration"
```

## Skip if Services Unavailable

Tests automatically skip if required services aren't running.

## Test Structure

- Test interactions between multiple components
- May use real filesystem (in temp directories)
- May initialize in-process AI and vector services
- Longer running than unit tests

## Guidelines

1. **Setup/Teardown**: Clean up resources after tests
2. **Skip Logic**: Use `describe.skip` or conditional skipping for unavailable services
3. **Timeouts**: Set appropriate timeouts for service calls
4. **Isolation**: Use temp directories for file operations

## Example Structure

```javascript
describe('ServiceIntegration', () => {
  let tempDir;

  beforeAll(async () => {
    // Check if required services are available
    const llamaAvailable = await checkLlamaHealth();
    if (!llamaAvailable) {
      console.log('Skipping: AI service not available');
      return;
    }

    // Create temp directory
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test-'));
  });

  afterAll(async () => {
    // Cleanup temp directory
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('should process file through pipeline', async () => {
    // Test full pipeline
  }, 30000); // 30 second timeout for integration tests
});
```

## Environment Variables

- `SKIP_INTEGRATION_TESTS=1` - Skip all integration tests
