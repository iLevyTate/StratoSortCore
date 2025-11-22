/**
 * Test to verify that startup operations are non-blocking
 * This simulates the startup process and measures responsiveness
 */

const { performance } = require('perf_hooks');

// Mock electron app
global.app = {
  getPath: (type) => {
    if (type === 'userData') return process.env.APPDATA || '.';
    return '.';
  },
};

const { StartupManager } = require('./src/main/services/StartupManager');

async function measureStartupResponsiveness() {
  console.log('Testing Startup Non-blocking Operations');
  console.log('========================================\n');

  const manager = new StartupManager();

  // Track responsiveness during startup
  let responseChecks = [];
  let isBlocked = false;

  // Set up a timer to check if the event loop is responsive
  const checkInterval = setInterval(() => {
    const start = performance.now();
    setImmediate(() => {
      const elapsed = performance.now() - start;
      responseChecks.push(elapsed);

      // If it takes more than 50ms, the event loop might be blocked
      if (elapsed > 50) {
        console.log(`  ⚠ Event loop blocked for ${elapsed.toFixed(2)}ms`);
        isBlocked = true;
      }
    });
  }, 100);

  try {
    // Test 1: Check if hasPythonModule is now async
    console.log('Test 1: Python module check (should be non-blocking)');
    const startTime = performance.now();
    const hasChromaDb = await manager.hasPythonModule('chromadb');
    const elapsed = performance.now() - startTime;
    console.log(`  ✓ Completed in ${elapsed.toFixed(2)}ms`);
    console.log(`  ✓ ChromaDB module found: ${hasChromaDb}`);

    // Test 2: Pre-flight checks
    console.log('\nTest 2: Pre-flight checks (should be non-blocking)');
    const preflightStart = performance.now();
    const checks = await manager.runPreflightChecks();
    const preflightElapsed = performance.now() - preflightStart;
    console.log(`  ✓ Completed in ${preflightElapsed.toFixed(2)}ms`);
    console.log(`  ✓ Checks performed: ${checks.length}`);

    // Test 3: Python installation check
    console.log('\nTest 3: Python installation check (should be non-blocking)');
    const pythonStart = performance.now();
    const pythonInfo = await manager.checkPythonInstallation();
    const pythonElapsed = performance.now() - pythonStart;
    console.log(`  ✓ Completed in ${pythonElapsed.toFixed(2)}ms`);
    console.log(`  ✓ Python installed: ${pythonInfo.installed}`);
    if (pythonInfo.version) {
      console.log(`  ✓ Version: ${pythonInfo.version}`);
    }

    // Test 4: Ollama installation check
    console.log('\nTest 4: Ollama installation check (should be non-blocking)');
    const ollamaStart = performance.now();
    const ollamaInfo = await manager.checkOllamaInstallation();
    const ollamaElapsed = performance.now() - ollamaStart;
    console.log(`  ✓ Completed in ${ollamaElapsed.toFixed(2)}ms`);
    console.log(`  ✓ Ollama installed: ${ollamaInfo.installed}`);

    // Clean up
    clearInterval(checkInterval);

    // Analyze responsiveness
    console.log('\n========================================');
    console.log('Responsiveness Analysis:');
    const avgResponseTime =
      responseChecks.reduce((a, b) => a + b, 0) / responseChecks.length;
    const maxResponseTime = Math.max(...responseChecks);

    console.log(`  Average event loop delay: ${avgResponseTime.toFixed(2)}ms`);
    console.log(`  Maximum event loop delay: ${maxResponseTime.toFixed(2)}ms`);
    console.log(`  Event loop blocked: ${isBlocked ? 'YES ⚠' : 'NO ✓'}`);

    if (!isBlocked) {
      console.log('\n✅ SUCCESS: All startup operations are non-blocking!');
      console.log('The UI will remain responsive during startup.');
    } else {
      console.log('\n⚠ WARNING: Some operations may still be blocking.');
      console.log('The UI might experience freezing during startup.');
    }
  } catch (error) {
    clearInterval(checkInterval);
    console.error('Test failed:', error);
    process.exit(1);
  }
}

// Run the test
measureStartupResponsiveness().catch((error) => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
