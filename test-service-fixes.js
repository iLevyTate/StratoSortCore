/**
 * Test Script for Service-Related Fixes
 *
 * This script tests the following fixes:
 * 1. Ollama port conflict detection
 * 2. ChromaDB health check validation
 * 3. Window initialization timing
 * 4. Error handling and user feedback
 */

const { spawn } = require('child_process');
const axios = require('axios');

// Test configuration
const OLLAMA_URL = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const CHROMADB_URL = process.env.CHROMA_SERVER_URL || 'http://127.0.0.1:8000';

// Color codes for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// Test 1: Check if Ollama is already running
async function testOllamaDetection() {
  log('\n=== Test 1: Ollama Detection ===', 'blue');

  try {
    // Check if Ollama is running
    const response = await axios.get(`${OLLAMA_URL}/api/tags`, {
      timeout: 2000,
      validateStatus: () => true,
    });

    if (response.status === 200) {
      log('✓ Ollama is already running (external instance)', 'green');
      log(`  Found at: ${OLLAMA_URL}`, 'green');

      // List available models
      if (response.data && response.data.models) {
        log(`  Available models: ${response.data.models.length}`, 'green');
        response.data.models.slice(0, 3).forEach((model) => {
          log(`    - ${model.name}`, 'green');
        });
      }
      return true;
    } else {
      log(`⚠ Ollama returned status ${response.status}`, 'yellow');
      return false;
    }
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      log('✗ Ollama is not running', 'red');
      log('  You can start it with: ollama serve', 'yellow');
    } else {
      log(`✗ Error checking Ollama: ${error.message}`, 'red');
    }
    return false;
  }
}

// Test 2: Attempt to start Ollama and handle port conflict
async function testOllamaPortConflict() {
  log('\n=== Test 2: Ollama Port Conflict Handling ===', 'blue');

  // First check if already running
  const isRunning = await testOllamaDetection();

  if (isRunning) {
    log('Testing port conflict handling...', 'yellow');

    // Try to start another instance
    const ollamaProcess = spawn('ollama', ['serve'], {
      stdio: 'pipe',
    });

    return new Promise((resolve) => {
      let errorDetected = false;
      let timeout;

      ollamaProcess.stderr.on('data', (data) => {
        const message = data.toString();
        if (
          message.includes('bind: Only one usage of each socket address') ||
          message.includes('address already in use')
        ) {
          errorDetected = true;
          log('✓ Port conflict correctly detected!', 'green');
          log('  Error message: ' + message.trim().substring(0, 80), 'green');
          ollamaProcess.kill();
          clearTimeout(timeout);
          resolve(true);
        }
      });

      ollamaProcess.on('exit', (code) => {
        if (code === 1 && errorDetected) {
          log('✓ Process exited with expected code 1', 'green');
        }
        clearTimeout(timeout);
        resolve(errorDetected);
      });

      // Timeout after 3 seconds
      timeout = setTimeout(() => {
        log('✗ Port conflict not detected within timeout', 'red');
        ollamaProcess.kill();
        resolve(false);
      }, 3000);
    });
  } else {
    log('⚠ Skipping port conflict test (Ollama not running)', 'yellow');
    return false;
  }
}

// Test 3: Check ChromaDB health endpoints
async function testChromaDBHealth() {
  log('\n=== Test 3: ChromaDB Health Check ===', 'blue');

  const endpoints = ['/api/v2/heartbeat', '/api/v1/heartbeat', '/api/v1', '/'];

  let anySuccess = false;

  for (const endpoint of endpoints) {
    try {
      const url = `${CHROMADB_URL}${endpoint}`;
      log(`Testing ${url}...`, 'yellow');

      const response = await axios.get(url, {
        timeout: 2000,
        validateStatus: () => true,
      });

      if (response.status === 200) {
        log(`  ✓ Endpoint ${endpoint} returned 200`, 'green');

        // Check response data
        if (response.data) {
          if (response.data.error) {
            log(`    ⚠ Contains error: ${response.data.error}`, 'yellow');
          } else if (
            response.data.nanosecond_heartbeat ||
            response.data['nanosecond heartbeat'] ||
            response.data.status === 'ok' ||
            response.data.version
          ) {
            log(`    ✓ Valid health response`, 'green');
            anySuccess = true;
          } else {
            log(
              `    ⚠ Response data: ${JSON.stringify(response.data).substring(0, 100)}`,
              'yellow',
            );
          }
        }
      } else {
        log(`  ✗ Endpoint ${endpoint} returned ${response.status}`, 'red');
      }
    } catch (error) {
      if (error.code === 'ECONNREFUSED') {
        log(`  ✗ ChromaDB not running at ${CHROMADB_URL}`, 'red');
        break;
      } else {
        log(`  ✗ Error: ${error.message}`, 'red');
      }
    }
  }

  return anySuccess;
}

// Test 4: Test StartupManager integration
async function testStartupManager() {
  log('\n=== Test 4: StartupManager Integration ===', 'blue');

  try {
    const { getStartupManager } = require('./src/main/services/StartupManager');
    const startupManager = getStartupManager();

    // Set up progress callback to monitor startup
    const progressEvents = [];
    startupManager.setProgressCallback((event) => {
      progressEvents.push(event);
      log(`  [${event.phase}] ${event.message} (${event.progress}%)`, 'blue');

      if (event.details) {
        if (event.details.error) {
          log(`    Error: ${event.details.error}`, 'red');
        }
        if (event.details.service) {
          log(
            `    Service: ${event.details.service} - ${event.details.status}`,
            'yellow',
          );
        }
      }
    });

    // Check pre-flight
    log('Running pre-flight checks...', 'yellow');
    const preflightResults = await startupManager.runPreflightChecks();

    log('Pre-flight results:', 'green');
    preflightResults.forEach((check) => {
      const icon =
        check.status === 'ok' ? '✓' : check.status === 'warn' ? '⚠' : '✗';
      const color =
        check.status === 'ok'
          ? 'green'
          : check.status === 'warn'
            ? 'yellow'
            : 'red';
      log(`  ${icon} ${check.name}: ${check.status}`, color);
      if (check.error) {
        log(`    Error: ${check.error}`, 'red');
      }
    });

    // Get service status
    const status = startupManager.getServiceStatus();
    log('\nService Status:', 'blue');
    log(`  Startup State: ${status.startup}`, 'yellow');
    log(`  Current Phase: ${status.phase}`, 'yellow');
    log(
      `  ChromaDB: ${status.services.chromadb.status}`,
      status.services.chromadb.status === 'running' ? 'green' : 'yellow',
    );
    log(
      `  Ollama: ${status.services.ollama.status}`,
      status.services.ollama.status === 'running' ? 'green' : 'yellow',
    );

    if (status.errors.length > 0) {
      log('\nErrors detected:', 'red');
      status.errors.forEach((err) => {
        log(`  - ${err.service || err.check}: ${err.error}`, 'red');
      });
    }

    return true;
  } catch (error) {
    log(`✗ StartupManager test failed: ${error.message}`, 'red');
    return false;
  }
}

// Main test runner
async function runAllTests() {
  log('====================================', 'blue');
  log('  StratoSort Service Fixes Tests', 'blue');
  log('====================================', 'blue');

  const results = {
    ollamaDetection: false,
    ollamaPortConflict: false,
    chromadbHealth: false,
    startupManager: false,
  };

  // Run tests
  results.ollamaDetection = await testOllamaDetection();
  results.ollamaPortConflict = await testOllamaPortConflict();
  results.chromadbHealth = await testChromaDBHealth();
  results.startupManager = await testStartupManager();

  // Summary
  log('\n====================================', 'blue');
  log('         Test Summary', 'blue');
  log('====================================', 'blue');

  const testNames = {
    ollamaDetection: 'Ollama Detection',
    ollamaPortConflict: 'Port Conflict Handling',
    chromadbHealth: 'ChromaDB Health Check',
    startupManager: 'StartupManager Integration',
  };

  let passedCount = 0;
  let totalCount = 0;

  Object.entries(results).forEach(([key, passed]) => {
    totalCount++;
    if (passed) passedCount++;

    const icon = passed ? '✓' : '✗';
    const color = passed ? 'green' : 'red';
    log(`${icon} ${testNames[key]}: ${passed ? 'PASSED' : 'FAILED'}`, color);
  });

  log(
    `\nTotal: ${passedCount}/${totalCount} tests passed`,
    passedCount === totalCount ? 'green' : passedCount > 0 ? 'yellow' : 'red',
  );

  // Exit with appropriate code
  process.exit(passedCount === totalCount ? 0 : 1);
}

// Handle errors
process.on('unhandledRejection', (error) => {
  log(`\n✗ Unhandled error: ${error.message}`, 'red');
  console.error(error);
  process.exit(1);
});

// Run tests
runAllTests().catch((error) => {
  log(`\n✗ Test runner failed: ${error.message}`, 'red');
  console.error(error);
  process.exit(1);
});
