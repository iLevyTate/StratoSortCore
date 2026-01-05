#!/usr/bin/env node

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  isOllamaInstalled,
  isOllamaRunning,
  getInstalledModels
} = require('../src/main/utils/ollamaDetection');
const { asyncSpawn } = require('../src/main/utils/asyncSpawnUtils');

// Simple color output without external dependencies
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

const chalk = {
  red: (text) => `${colors.red}${text}${colors.reset}`,
  green: (text) => `${colors.green}${text}${colors.reset}`,
  yellow: (text) => `${colors.yellow}${text}${colors.reset}`,
  blue: (text) => `${colors.blue}${text}${colors.reset}`,
  cyan: (text) => `${colors.cyan}${text}${colors.reset}`,
  gray: (text) => `${colors.gray}${text}${colors.reset}`,
  bold: {
    green: (text) => `${colors.bold}${colors.green}${text}${colors.reset}`,
    cyan: (text) => `${colors.bold}${colors.cyan}${text}${colors.reset}`,
    red: (text) => `${colors.bold}${colors.red}${text}${colors.reset}`
  }
};

// Configuration
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
// Ultra-lightweight models for accessibility (~2.3GB total vs previous ~8GB)
const ESSENTIAL_MODELS = {
  text: ['qwen3:0.6b', 'llama3.2:latest', 'gemma2:2b', 'phi3:mini'], // 523MB - Ultra-fast, 40K context
  vision: ['gemma3:latest', 'moondream:latest', 'llava:latest'], // Gemma 3 is multimodal (4B+ support vision)
  embedding: ['embeddinggemma:latest', 'mxbai-embed-large:latest', 'nomic-embed-text:latest'] // 308MB - Google's best, 768 dims
};

function normalizeOllamaModelName(name) {
  if (!name || typeof name !== 'string') return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  return trimmed.includes(':') ? trimmed : `${trimmed}:latest`;
}

function getConfiguredModels() {
  // Prefer environment overrides (matches config schema env vars)
  const fromEnv = {
    text: normalizeOllamaModelName(process.env.OLLAMA_TEXT_MODEL),
    vision: normalizeOllamaModelName(
      process.env.OLLAMA_VISION_MODEL || process.env.OLLAMA_MULTIMODAL_MODEL
    ),
    embedding: normalizeOllamaModelName(process.env.OLLAMA_EMBEDDING_MODEL)
  };

  // Fall back to app defaults
  let defaults = null;
  try {
    // eslint-disable-next-line global-require
    defaults = require('../src/shared/defaultSettings').DEFAULT_SETTINGS;
  } catch {
    defaults = null;
  }

  const fromDefaults = {
    text: normalizeOllamaModelName(defaults?.textModel),
    vision: normalizeOllamaModelName(defaults?.visionModel),
    embedding: normalizeOllamaModelName(defaults?.embeddingModel)
  };

  return {
    text: fromEnv.text || fromDefaults.text,
    vision: fromEnv.vision || fromDefaults.vision,
    embedding: fromEnv.embedding || fromDefaults.embedding
  };
}

function hasModelInstalled(installedModels, modelName) {
  if (!modelName) return false;
  const base = modelName.split(':')[0].toLowerCase();
  return (installedModels || []).some((m) =>
    String(m || '')
      .toLowerCase()
      .startsWith(base)
  );
}

// Minimum required: at least one text model AND one vision model
const MINIMUM_REQUIREMENT = {
  text: 1,
  vision: 1, // Required for image analysis
  embedding: 0 // Optional but recommended for semantic search
};

// Helper functions
async function run(cmd, args = [], opts = {}) {
  const res = await asyncSpawn(cmd, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...opts
  });
  return res.status === 0;
}

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Start Ollama server in background
async function startOllamaServer() {
  console.log(chalk.cyan('Starting Ollama server...'));

  // Check if already running
  if (await isOllamaRunning()) {
    console.log(chalk.green('✓ Ollama server is already running'));
    return true;
  }

  // Try to start Ollama
  const ollamaProcess = spawn('ollama', ['serve'], {
    detached: true,
    stdio: 'ignore',
    shell: process.platform === 'win32'
  });

  ollamaProcess.unref();

  // Wait for server to start (max 10 seconds)
  for (let i = 0; i < 20; i++) {
    await delay(500);
    if (await isOllamaRunning()) {
      console.log(chalk.green('✓ Ollama server started successfully'));
      return true;
    }
  }

  console.log(chalk.yellow('⚠ Ollama server failed to start within 10 seconds'));
  return false;
}

// Pull a model with progress indication
async function pullModel(modelName) {
  return new Promise((resolve) => {
    console.log(chalk.cyan(`Pulling model: ${modelName}...`));

    const pullProcess = spawn('ollama', ['pull', modelName], {
      shell: process.platform === 'win32'
    });

    pullProcess.stdout.on('data', (data) => {
      const output = data.toString();
      // Only show progress updates, not every byte
      if (output.includes('%') || output.includes('success')) {
        process.stdout.write(`\r${chalk.gray(output.trim().slice(0, 80).padEnd(80))}`);
      }
    });

    pullProcess.stderr.on('data', (data) => {
      const output = data.toString();
      if (output.includes('%') || output.includes('success')) {
        process.stdout.write(`\r${chalk.gray(output.trim().slice(0, 80).padEnd(80))}`);
      }
    });

    pullProcess.on('close', (code) => {
      process.stdout.write(`\r${' '.repeat(80)}\r`); // Clear line
      if (code === 0) {
        console.log(chalk.green(`✓ Successfully pulled ${modelName}`));
        resolve(true);
      } else {
        console.log(chalk.yellow(`⚠ Failed to pull ${modelName}`));
        resolve(false);
      }
    });

    pullProcess.on('error', (err) => {
      console.log(chalk.red(`✗ Error pulling ${modelName}: ${err.message}`));
      resolve(false);
    });
  });
}

// Install essential models
async function installEssentialModels() {
  console.log(chalk.cyan('\nChecking installed models...'));

  const installedModels = await getInstalledModels();
  console.log(chalk.gray(`Found ${installedModels.length} installed models`));

  const modelStatus = {
    text: [],
    vision: [],
    embedding: []
  };

  // Check which essential models are already installed
  for (const [category, models] of Object.entries(ESSENTIAL_MODELS)) {
    for (const model of models) {
      const modelBase = model.split(':')[0];
      const isInstalled = installedModels.some((m) => m.startsWith(modelBase.toLowerCase()));

      if (isInstalled) {
        modelStatus[category].push(model);
        console.log(chalk.green(`  ✓ ${model} (${category})`));
      }
    }
  }

  // Check if minimum requirements are met
  const needsText = modelStatus.text.length < MINIMUM_REQUIREMENT.text;
  const needsVision = modelStatus.vision.length < MINIMUM_REQUIREMENT.vision;
  const needsEmbedding = modelStatus.embedding.length < MINIMUM_REQUIREMENT.embedding;

  if (!needsText && !needsVision && !needsEmbedding) {
    console.log(chalk.green('\n✓ All minimum model requirements are met!'));
    // Still report configured model status (developer expectations)
    const configured = getConfiguredModels();
    const cfgTextOk = hasModelInstalled(installedModels, configured.text);
    const cfgVisionOk = hasModelInstalled(installedModels, configured.vision);
    const cfgEmbedOk = hasModelInstalled(installedModels, configured.embedding);

    if (configured.text || configured.vision || configured.embedding) {
      console.log(chalk.gray('\nConfigured models:'));
      if (configured.text) {
        console.log(
          cfgTextOk
            ? chalk.green(`  ✓ text: ${configured.text}`)
            : chalk.yellow(`  ⚠ text missing: ${configured.text}`)
        );
      }
      if (configured.vision) {
        console.log(
          cfgVisionOk
            ? chalk.green(`  ✓ vision: ${configured.vision}`)
            : chalk.yellow(`  ⚠ vision missing: ${configured.vision}`)
        );
      }
      if (configured.embedding && !process.env.MINIMAL_SETUP) {
        console.log(
          cfgEmbedOk
            ? chalk.green(`  ✓ embedding: ${configured.embedding}`)
            : chalk.yellow(`  ⚠ embedding missing: ${configured.embedding}`)
        );
      }
    }

    return true;
  }

  // Pull missing essential models
  console.log(chalk.cyan('\nInstalling essential models...'));

  // Ensure we have at least one text model
  if (needsText) {
    console.log(chalk.yellow('\n⚠ No text model found. Installing essential text model...'));
    for (const model of ESSENTIAL_MODELS.text) {
      const success = await pullModel(model);
      if (success) {
        modelStatus.text.push(model);
        break; // At least one text model is enough
      }
    }
  }

  // Install vision model (required for image analysis)
  if (needsVision) {
    console.log(
      chalk.yellow(
        '\n⚠ No vision model found. Installing essential vision model for image analysis...'
      )
    );
    for (const model of ESSENTIAL_MODELS.vision) {
      const success = await pullModel(model);
      if (success) {
        modelStatus.vision.push(model);
        break; // At least one vision model is enough
      }
    }
  }

  // Try to install embedding model (optional but recommended)
  if (needsEmbedding && !process.env.MINIMAL_SETUP) {
    console.log(chalk.cyan('\nInstalling embedding model for semantic search...'));
    for (const model of ESSENTIAL_MODELS.embedding) {
      const success = await pullModel(model);
      if (success) {
        modelStatus.embedding.push(model);
        break;
      }
    }
  }

  // Final check
  if (modelStatus.text.length === 0 || modelStatus.vision.length === 0) {
    if (modelStatus.text.length === 0) {
      console.log(
        chalk.red(
          '\n✗ Failed to install any text model. StratoSort requires at least one text model.'
        )
      );
    }
    if (modelStatus.vision.length === 0) {
      console.log(
        chalk.red(
          '\n✗ Failed to install any vision model. StratoSort requires at least one vision model for image analysis.'
        )
      );
    }
    return false;
  }

  console.log(chalk.green('\n✓ Model installation complete!'));
  console.log(chalk.gray(`  Text models: ${modelStatus.text.length} ✓`));
  console.log(chalk.gray(`  Vision models: ${modelStatus.vision.length} ✓`));
  console.log(
    chalk.gray(
      `  Embedding models: ${modelStatus.embedding.length}${modelStatus.embedding.length > 0 ? ' ✓' : ' (optional)'}`
    )
  );

  // Ensure configured defaults are installed too (developer ergonomics)
  const configured = getConfiguredModels();
  const after = await getInstalledModels();
  const missingConfigured = [];
  if (configured.text && !hasModelInstalled(after, configured.text))
    missingConfigured.push(configured.text);
  if (configured.vision && !hasModelInstalled(after, configured.vision))
    missingConfigured.push(configured.vision);
  if (
    configured.embedding &&
    !process.env.MINIMAL_SETUP &&
    !hasModelInstalled(after, configured.embedding)
  ) {
    missingConfigured.push(configured.embedding);
  }

  if (missingConfigured.length > 0) {
    console.log(chalk.cyan('\nInstalling configured StratoSort models...'));
    for (const m of missingConfigured) {
      // Best-effort; continue even if one fails
      // eslint-disable-next-line no-await-in-loop
      await pullModel(m);
    }
  }

  return true;
}

// Platform-specific installation instructions
function getInstallInstructions() {
  const platform = os.platform();

  if (platform === 'win32') {
    return `
${chalk.cyan('Windows Installation:')}
  
  1. Download Ollama from: ${chalk.blue('https://ollama.com/download/windows')}
  2. Run the installer (OllamaSetup.exe)
  3. After installation, re-run this setup script
  
  Or use winget:
  ${chalk.gray('winget install ollama')}
`;
  }
  if (platform === 'darwin') {
    return `
${chalk.cyan('macOS Installation:')}
  
  1. Download Ollama from: ${chalk.blue('https://ollama.com/download/mac')}
  2. Open the downloaded .zip file
  3. Drag Ollama.app to Applications
  4. Open Ollama from Applications
  5. Re-run this setup script
  
  Or use Homebrew:
  ${chalk.gray('brew install ollama')}
`;
  }
  return `
${chalk.cyan('Linux Installation:')}
  
  Run this command:
  ${chalk.gray('curl -fsSL https://ollama.com/install.sh | sh')}
  
  Or download from: ${chalk.blue('https://ollama.com/download/linux')}
`;
}

// Main setup flow
async function main() {
  // Skip in CI environments
  if (process.env.CI || process.env.GITHUB_ACTIONS || process.env.CONTINUOUS_INTEGRATION) {
    console.log('CI environment detected - skipping Ollama setup');
    process.exit(0);
  }

  const args = process.argv.slice(2);

  // Also skip if --ci-skip flag is passed
  if (args.includes('--ci-skip')) {
    if (process.env.CI || process.env.GITHUB_ACTIONS) {
      console.log('CI environment detected - skipping Ollama setup');
      process.exit(0);
    }
    // If not in CI but --ci-skip was passed, continue normally
    // This allows the flag to be in package.json without breaking local installs
  }

  console.log(chalk.bold.cyan('\n🚀 StratoSort Ollama Setup\n'));

  const isCheck = args.includes('--check');
  const isAutoInstall = args.includes('--auto');
  const isMinimal = args.includes('--minimal') || process.env.MINIMAL_SETUP;

  if (isMinimal) {
    process.env.MINIMAL_SETUP = 'true';
  }

  // Just check status
  if (isCheck) {
    const installed = await isOllamaInstalled();
    const running = await isOllamaRunning();
    const models = await getInstalledModels();
    const configured = getConfiguredModels();
    const cfgTextOk = hasModelInstalled(models, configured.text);
    const cfgVisionOk = hasModelInstalled(models, configured.vision);
    const cfgEmbedOk = hasModelInstalled(models, configured.embedding);

    console.log(
      installed ? chalk.green('✓ Ollama is installed') : chalk.red('✗ Ollama is not installed')
    );

    console.log(
      running
        ? chalk.green('✓ Ollama server is running')
        : chalk.yellow('⚠ Ollama server is not running')
    );

    console.log(
      models.length > 0
        ? chalk.green(`✓ ${models.length} models installed`)
        : chalk.yellow('⚠ No models installed')
    );

    if (configured.text || configured.vision || configured.embedding) {
      console.log(chalk.gray('\nConfigured models:'));
      if (configured.text) {
        console.log(
          cfgTextOk
            ? chalk.green(`  ✓ text: ${configured.text}`)
            : chalk.red(`  ✗ text missing: ${configured.text}`)
        );
      }
      if (configured.vision) {
        console.log(
          cfgVisionOk
            ? chalk.green(`  ✓ vision: ${configured.vision}`)
            : chalk.red(`  ✗ vision missing: ${configured.vision}`)
        );
      }
      if (configured.embedding && !isMinimal) {
        console.log(
          cfgEmbedOk
            ? chalk.green(`  ✓ embedding: ${configured.embedding}`)
            : chalk.yellow(`  ⚠ embedding missing: ${configured.embedding}`)
        );
      }
    }

    // Exit non-zero if required configured models are missing (text + vision)
    const ok = installed && cfgTextOk && cfgVisionOk;
    process.exit(ok ? 0 : 1);
  }

  // Step 1: Check if Ollama is installed
  console.log(chalk.cyan('Step 1: Checking Ollama installation...'));
  if (!(await isOllamaInstalled())) {
    console.log(chalk.red('✗ Ollama is not installed'));
    console.log(getInstallInstructions());

    if (!isAutoInstall) {
      console.log(chalk.yellow('\nPlease install Ollama and run this script again.'));
      console.log(chalk.gray('Or run with --auto flag to attempt automatic setup.'));
      process.exit(1);
    }

    // Attempt automatic installation (platform-specific)
    console.log(chalk.cyan('\nAttempting automatic installation...'));
    const platform = os.platform();

    if (platform === 'linux') {
      const installCmd = 'curl -fsSL https://ollama.com/install.sh | sh';
      const success = await run('sh', ['-c', installCmd]);
      if (!success) {
        console.log(chalk.red('✗ Automatic installation failed'));
        console.log(chalk.yellow('Please install manually and run this script again.'));
        process.exit(1);
      }
    } else {
      console.log(chalk.yellow('Automatic installation is not available for your platform.'));
      console.log('Please install manually from: https://ollama.com/download');
      process.exit(1);
    }
  }

  console.log(chalk.green('✓ Ollama is installed'));

  // Step 2: Start Ollama server
  console.log(chalk.cyan('\nStep 2: Starting Ollama server...'));
  const serverStarted = await startOllamaServer();
  if (!serverStarted) {
    console.log(chalk.yellow('⚠ Could not start Ollama server automatically'));
    console.log(chalk.gray('You may need to start it manually with: ollama serve'));
  }

  // Step 3: Install essential models
  console.log(chalk.cyan('\nStep 3: Installing essential models...'));
  const modelsInstalled = await installEssentialModels();

  if (!modelsInstalled) {
    console.log(chalk.red('\n✗ Setup incomplete - could not install required models'));
    console.log(chalk.yellow('Please ensure Ollama is running and try again.'));
    process.exit(1);
  }

  // Step 4: Verify setup
  console.log(chalk.cyan('\nStep 4: Verifying setup...'));
  const finalCheck = {
    ollama: await isOllamaInstalled(),
    server: await isOllamaRunning(),
    models: await getInstalledModels()
  };

  if (finalCheck.ollama && finalCheck.server && finalCheck.models.length > 0) {
    console.log(chalk.bold.green('\n✅ Ollama setup complete!'));
    console.log(chalk.gray('\nStratoSort is ready to use AI-powered features:'));
    console.log(chalk.gray('  • Intelligent file categorization'));
    console.log(chalk.gray('  • Smart folder suggestions'));
    console.log(chalk.gray('  • Semantic file matching'));
    if (finalCheck.models.some((m) => m.includes('llava') || m.includes('moondream'))) {
      console.log(chalk.gray('  • Image content analysis'));
    }

    // Save successful configuration
    const configPath = path.join(os.homedir(), '.stratosort-ollama-setup');
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          setupDate: new Date().toISOString(),
          ollamaHost: OLLAMA_HOST,
          installedModels: finalCheck.models
        },
        null,
        2
      )
    );

    process.exit(0);
  } else {
    console.log(chalk.red('\n✗ Setup verification failed'));
    if (!finalCheck.ollama) console.log(chalk.red('  ✗ Ollama not installed'));
    if (!finalCheck.server) console.log(chalk.red('  ✗ Ollama server not running'));
    if (finalCheck.models.length === 0) console.log(chalk.red('  ✗ No models installed'));
    process.exit(1);
  }
}

// Handle errors gracefully
process.on('unhandledRejection', (error) => {
  console.error(chalk.red('\n✗ Setup failed with error:'), error.message);
  process.exit(1);
});

// Run main function
if (require.main === module) {
  main().catch((error) => {
    console.error(chalk.red('\n✗ Setup failed:'), error);
    process.exit(1);
  });
}

module.exports = {
  isOllamaInstalled,
  isOllamaRunning,
  getInstalledModels,
  startOllamaServer,
  installEssentialModels
};
