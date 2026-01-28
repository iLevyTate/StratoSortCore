/**
 * Global Setup for Playwright E2E Tests
 *
 * This file runs once before all tests.
 * Use it to set up test environment, verify prerequisites, etc.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Global setup function
 * @param {Object} config - Playwright config
 */
async function globalSetup(_config) {
  console.log('\n========================================');
  console.log('StratoSort E2E Test Suite - Global Setup');
  console.log('========================================\n');

  const projectRoot = path.resolve(__dirname, '../../..');

  // 1. Verify the build exists
  console.log('[Setup] Checking for renderer build...');
  const distPath = path.join(projectRoot, 'dist', 'renderer');
  const indexHtmlPath = path.join(distPath, 'index.html');

  if (!fs.existsSync(indexHtmlPath)) {
    console.log('[Setup] Build not found, building renderer...');
    try {
      execSync('npm run build:dev', {
        cwd: projectRoot,
        stdio: 'inherit',
        timeout: 120000 // 2 minutes
      });
      console.log('[Setup] Build completed successfully');
    } catch (error) {
      console.error('[Setup] Build failed:', error.message);
      console.error('[Setup] Please run "npm run build:dev" manually before running E2E tests');
      throw new Error('Renderer build required for E2E tests');
    }
  } else {
    console.log('[Setup] Renderer build found');
  }

  // 2. Check Ollama availability (optional - tests should handle missing Ollama)
  console.log('[Setup] Checking Ollama availability...');
  try {
    execSync('ollama --version', { stdio: 'pipe', timeout: 5000 });
    console.log('[Setup] Ollama is installed');

    // Check if Ollama is running
    try {
      const response = await fetch('http://127.0.0.1:11434/api/tags', {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });
      if (response.ok) {
        console.log('[Setup] Ollama is running');
        process.env.OLLAMA_AVAILABLE = 'true';
      }
    } catch (e) {
      console.log('[Setup] Ollama is not running (tests will handle this)');
      process.env.OLLAMA_AVAILABLE = 'false';
    }
  } catch (e) {
    console.log('[Setup] Ollama is not installed (AI features may be limited in tests)');
    process.env.OLLAMA_AVAILABLE = 'false';
  }

  // 3. Create test output directories
  console.log('[Setup] Creating test output directories...');
  const outputDirs = [
    path.join(projectRoot, 'test-results', 'e2e'),
    path.join(projectRoot, 'test-results', 'e2e', 'screenshots'),
    path.join(projectRoot, 'test-results', 'e2e-report')
  ];

  for (const dir of outputDirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`[Setup] Created: ${dir}`);
    }
  }

  // 4. Set environment variables for tests
  process.env.E2E_TESTS_RUNNING = 'true';
  process.env.NODE_ENV = 'development';

  console.log('\n[Setup] Global setup complete');
  console.log('========================================\n');
}

module.exports = globalSetup;
