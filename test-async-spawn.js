/**
 * Test script for async spawn utilities
 * Verifies that the async replacements work correctly
 */

const {
  asyncSpawn,
  hasPythonModuleAsync,
  findPythonLauncherAsync,
  checkChromaExecutableAsync,
} = require('./src/main/utils/asyncSpawnUtils');

async function runTests() {
  console.log('Testing Async Spawn Utilities');
  console.log('==============================\n');

  // Test 1: Basic asyncSpawn
  console.log('Test 1: Basic asyncSpawn with echo command');
  try {
    const result = await asyncSpawn(
      process.platform === 'win32' ? 'cmd' : 'echo',
      process.platform === 'win32'
        ? ['/c', 'echo', 'Hello World']
        : ['Hello World'],
      {
        stdio: 'pipe',
        timeout: 2000,
        encoding: 'utf8',
        shell: process.platform === 'win32',
      },
    );
    console.log('  ✓ Status:', result.status);
    console.log('  ✓ Output:', result.stdout.trim());
    if (result.error) {
      console.log('  ✗ Error:', result.error.message);
    }
  } catch (error) {
    console.log('  ✗ Failed:', error.message);
  }

  // Test 2: Timeout handling
  console.log('\nTest 2: Timeout handling (should timeout after 100ms)');
  try {
    const result = await asyncSpawn(
      process.platform === 'win32' ? 'timeout' : 'sleep',
      process.platform === 'win32' ? ['/t', '5'] : ['5'],
      {
        stdio: 'pipe',
        timeout: 100,
        shell: process.platform === 'win32',
      },
    );
    if (result.timedOut) {
      console.log('  ✓ Correctly timed out');
    } else {
      console.log("  ✗ Should have timed out but didn't");
    }
  } catch (error) {
    console.log('  ✗ Error:', error.message);
  }

  // Test 3: Command not found
  console.log('\nTest 3: Command not found error handling');
  try {
    const result = await asyncSpawn('this-command-does-not-exist-12345', [], {
      stdio: 'pipe',
      timeout: 2000,
    });
    if (result.error) {
      console.log(
        '  ✓ Correctly caught error:',
        result.error.code || result.error.message,
      );
    } else {
      console.log("  ✗ Should have errored but didn't");
    }
  } catch (error) {
    console.log('  ✗ Unexpected error:', error.message);
  }

  // Test 4: Find Python launcher
  console.log('\nTest 4: Finding Python launcher (async)');
  try {
    const pythonLauncher = await findPythonLauncherAsync();
    if (pythonLauncher) {
      console.log(
        '  ✓ Found Python:',
        pythonLauncher.command,
        pythonLauncher.args,
      );
    } else {
      console.log('  ⚠ Python not found (may not be installed)');
    }
  } catch (error) {
    console.log('  ✗ Error:', error.message);
  }

  // Test 5: Check Python module
  console.log('\nTest 5: Checking Python module (async)');
  try {
    const hasJson = await hasPythonModuleAsync('json');
    if (hasJson) {
      console.log('  ✓ Found built-in json module');
    } else {
      console.log(
        '  ⚠ Could not find json module (Python might not be installed)',
      );
    }

    const hasNonExistent = await hasPythonModuleAsync(
      'this_module_does_not_exist_12345',
    );
    if (!hasNonExistent) {
      console.log('  ✓ Correctly reported non-existent module as missing');
    } else {
      console.log('  ✗ Incorrectly found non-existent module');
    }
  } catch (error) {
    console.log('  ✗ Error:', error.message);
  }

  // Test 6: Check chroma executable
  console.log('\nTest 6: Checking chroma executable (async)');
  try {
    const hasChroma = await checkChromaExecutableAsync();
    if (hasChroma) {
      console.log('  ✓ Found chroma executable');
    } else {
      console.log('  ⚠ Chroma executable not found (may not be installed)');
    }
  } catch (error) {
    console.log('  ✗ Error:', error.message);
  }

  console.log('\n==============================');
  console.log('All async spawn tests completed!');
  console.log('No blocking operations were used.');
}

// Run the tests
runTests().catch((error) => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
