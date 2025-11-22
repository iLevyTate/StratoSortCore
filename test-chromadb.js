/**
 * ChromaDB Test Script
 * Tests if ChromaDB can be started successfully with the current configuration
 */

const { spawn } = require('child_process');
const {
  asyncSpawn,
  findPythonLauncherAsync,
} = require('./src/main/utils/asyncSpawnUtils');
const path = require('path');
const fs = require('fs');

async function main() {
  console.log('=================================');
  console.log('ChromaDB Configuration Test');
  console.log('=================================\n');

  // Test 1: Check Python installation
  console.log('1. Checking Python installation...');
  const pythonLauncher = await findPythonLauncherAsync();

  if (!pythonLauncher) {
    console.log('   ✗ Python not found!');
    console.log(
      '   Please install Python 3 from https://www.python.org/downloads/',
    );
    process.exit(1);
  }

  // Get Python version
  const versionCheck = await asyncSpawn(
    pythonLauncher.command,
    [...pythonLauncher.args, '--version'],
    {
      stdio: 'pipe',
      windowsHide: true,
      timeout: 2000,
    },
  );

  if (versionCheck.status === 0) {
    const version = versionCheck.stdout.trim() || versionCheck.stderr.trim();
    console.log(
      `   ✓ Found Python: ${version} (using ${pythonLauncher.command})`,
    );
  }

  // Test 2: Check ChromaDB module
  console.log('\n2. Checking ChromaDB module...');
  const checkModule = await asyncSpawn(
    pythonLauncher.command,
    [
      ...pythonLauncher.args,
      '-c',
      'import chromadb; print(f"ChromaDB version: {chromadb.__version__}")',
    ],
    {
      stdio: 'pipe',
      windowsHide: true,
      timeout: 5000,
    },
  );

  if (checkModule.status === 0) {
    console.log(`   ✓ ${checkModule.stdout.trim()}`);
  } else {
    console.log('   ✗ ChromaDB module not found!');
    console.log('   Run install-chromadb.bat to install it');
    const stderr = checkModule.stderr?.trim();
    if (stderr) {
      console.log(`   Error: ${stderr}`);
    }
    process.exit(1);
  }

  // Test 3: Try to start ChromaDB server
  console.log('\n3. Testing ChromaDB server startup...');
  const dbPath = path.join(
    process.env.APPDATA || '.',
    'stratosort',
    'chromadb-test',
  );
  const host = '127.0.0.1';
  const port = 8001; // Use different port to avoid conflicts

  // Create test directory
  if (!fs.existsSync(dbPath)) {
    fs.mkdirSync(dbPath, { recursive: true });
  }

  console.log(`   Database path: ${dbPath}`);
  console.log(`   Server URL: http://${host}:${port}`);
  console.log('   Starting server (this may take a moment)...');

  const chromaProcess = spawn(
    pythonLauncher.command,
    [
      ...pythonLauncher.args,
      '-m',
      'chromadb',
      'run',
      '--path',
      dbPath,
      '--host',
      host,
      '--port',
      String(port),
    ],
    {
      stdio: 'pipe',
      windowsHide: true,
    },
  );

  let serverStarted = false;
  let errorMessages = [];

  chromaProcess.stdout?.on('data', (data) => {
    const output = data.toString();
    if (
      output.includes('Application startup complete') ||
      output.includes('Uvicorn running')
    ) {
      serverStarted = true;
    }
  });

  chromaProcess.stderr?.on('data', (data) => {
    errorMessages.push(data.toString());
  });

  chromaProcess.on('error', (error) => {
    console.log(`   ✗ Failed to start ChromaDB: ${error.message}`);
    process.exit(1);
  });

  // Wait for server to start or timeout
  await new Promise((resolve) => {
    setTimeout(() => {
      if (serverStarted) {
        console.log('   ✓ ChromaDB server started successfully!');
        console.log('\n=================================');
        console.log('All tests passed!');
        console.log('ChromaDB is properly configured.');
        console.log('=================================');
      } else {
        console.log('   ✗ ChromaDB server failed to start within 10 seconds');
        if (errorMessages.length > 0) {
          console.log('\n   Error messages:');
          errorMessages.forEach((msg) => console.log(`   ${msg.trim()}`));
        }
      }

      // Clean up
      chromaProcess.kill();

      // Remove test directory
      try {
        fs.rmSync(dbPath, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }

      resolve();
      process.exit(serverStarted ? 0 : 1);
    }, 10000);
  });

  console.log('   (Press Ctrl+C to cancel)');
}

// Run the async main function
main().catch((error) => {
  console.error('Test failed with error:', error);
  process.exit(1);
});
