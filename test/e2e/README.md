# StratoSort E2E Tests

End-to-end tests for the StratoSort Electron application using Playwright.

## Overview

This test suite covers full user flows through the application UI, including:

- **App Launch** (`app-launch.spec.js`): Verifies the application starts correctly
- **Navigation** (`navigation.spec.js`): Tests phase transitions and navigation
- **File Import** (`file-import.spec.js`): Tests file selection and import flows
- **Analysis Flow** (`analysis-flow.spec.js`): Tests document analysis with the in-process AI engine
- **Error Handling** (`error-handling.spec.js`): Verifies graceful error handling

## Prerequisites

1. **Node.js 18+** - Required for Playwright and Electron
2. **Build the renderer** - Run `npm run build:dev` before testing
3. **Models downloaded (optional)** - Required for AI analysis tests, but tests handle missing
   models gracefully

## Running Tests

### Basic Commands

```bash
# Run all E2E tests (headless)
npm run test:e2e

# Run with visible Electron window
npm run test:e2e:headed

# Run in debug mode (with Playwright Inspector)
npm run test:e2e:debug

# Open Playwright UI for interactive testing
npm run test:e2e:ui

# View test report
npm run test:e2e:report
```

### Running Specific Tests

```bash
# Run only app launch tests
npx playwright test --grep "App Launch"

# Run only navigation tests
npx playwright test --grep "Navigation"

# Run a specific test file
npx playwright test test/e2e/app-launch.spec.js

# Run tests with specific tag
npx playwright test --grep "@smoke"
```

### Debug Options

```bash
# Run with trace recording
npx playwright test --trace on

# Run with video recording
npx playwright test --video on

# Run with slow motion (500ms between actions)
npx playwright test --slow-mo 500
```

## Test Structure

```
test/e2e/
├── helpers/
│   ├── electronApp.js      # Electron app launch/control utilities
│   ├── testFixtures.js     # Test data and fixtures
│   ├── pageObjects.js      # Page object models for UI
│   ├── globalSetup.js      # Runs once before all tests
│   ├── globalTeardown.js   # Runs once after all tests
│   └── index.js            # Main export file
├── app-launch.spec.js      # App startup tests
├── navigation.spec.js      # Navigation tests
├── file-import.spec.js     # File import tests
├── analysis-flow.spec.js   # Analysis workflow tests
├── error-handling.spec.js  # Error handling tests
└── README.md               # This file
```

## Writing New Tests

### Basic Test Template

```javascript
const { test, expect } = require('@playwright/test');
const { launchApp, closeApp, waitForAppReady } = require('./helpers/electronApp');
const { NavigationPage } = require('./helpers/pageObjects');

test.describe('My Feature', () => {
  let app;
  let window;

  test.beforeEach(async () => {
    const result = await launchApp();
    app = result.app;
    window = result.window;
    await waitForAppReady(window);
  });

  test.afterEach(async () => {
    await closeApp(app);
  });

  test('should do something', async () => {
    // Use page objects for cleaner code
    const nav = new NavigationPage(window);

    // Perform actions
    await nav.goToPhase('setup');

    // Make assertions
    const phase = await nav.getCurrentPhase();
    expect(phase).toBe('setup');
  });
});
```

### Using Page Objects

```javascript
const { NavigationPage, DiscoverPage, OrganizePage } = require('./helpers/pageObjects');

test('workflow test', async () => {
  const nav = new NavigationPage(window);
  const discover = new DiscoverPage(window);

  // Navigate to Discover
  await nav.goToPhase('discover');

  // Check file drop zone
  const hasDropZone = await discover.isDragDropVisible();
  expect(hasDropZone).toBe(true);
});
```

### Using Test Fixtures

```javascript
const { TEST_FILES, setupTestFiles, cleanupTempDir } = require('./helpers/testFixtures');

test('test with files', async () => {
  // Create temp directory with test files
  const { tempDir, files } = await setupTestFiles(['sampleTxt', 'contract']);

  try {
    // Use files in test
    console.log(
      'Test files:',
      files.map((f) => f.name)
    );
  } finally {
    // Clean up
    await cleanupTempDir(tempDir);
  }
});
```

## Configuration

The Playwright configuration is in `playwright.config.js` at the project root:

- **Test timeout**: 3 minutes (for analysis tests)
- **Expect timeout**: 30 seconds
- **Workers**: 1 (Electron tests run serially)
- **Retries**: 2 on CI, 1 locally

## Test Artifacts

Test artifacts are saved to:

- **Screenshots**: `test-results/e2e/screenshots/`
- **Videos**: `test-results/e2e/` (on retry)
- **Traces**: `test-results/e2e/` (on retry)
- **HTML Report**: `test-results/e2e-report/`

## CI/CD Integration

The tests are designed to run in CI environments:

1. Tests handle missing models gracefully
2. Headless mode is default
3. Screenshots/videos captured on failure
4. HTML report generated for review

### GitHub Actions Example

```yaml
- name: Run E2E tests
  run: |
    npm run build:dev
    npm run test:e2e
```

## Troubleshooting

### Tests failing with "No window found"

Ensure the build is complete:

```bash
npm run build:dev
```

### Tests timing out

- Increase timeout in `playwright.config.js`
- Check if Electron app is starting correctly
- Run with `--debug` to see what's happening

### AI model-related test failures

These are expected if models are not available. Tests should pass with warnings. To run with local
models:

```bash
# Ensure models are downloaded
npm run setup:models

# Then run tests
npm run test:e2e
```

### Windows-specific issues

- Ensure GPU acceleration is working or disabled
- Check that the app path doesn't contain special characters
- Run as administrator if file access is restricted

## Contributing

When adding new tests:

1. Follow the existing file naming convention (`*.spec.js`)
2. Use page objects for UI interactions
3. Add appropriate test descriptions
4. Handle model unavailability gracefully
5. Clean up any created resources in `afterEach`
