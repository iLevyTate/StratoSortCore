#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const chalk = require('chalk');
const { asyncSpawn } = require('../src/main/utils/asyncSpawnUtils');

try {
  require('dotenv').config({ path: path.join(__dirname, '../.env') });
} catch {
  // Silently ignore dotenv errors (file may not exist)
}

function checkFileExists(relativePath) {
  const fullPath = path.join(__dirname, '../', relativePath);
  return fs.existsSync(fullPath);
}

function printStatus(ok, label, details) {
  const icon = ok ? chalk.green('✓') : chalk.red('✗');

  console.log(`${icon} ${label}${details ? chalk.gray(` — ${details}`) : ''}`);
}

async function runCmd(cmd, args = []) {
  return await asyncSpawn(cmd, args, {
    encoding: 'utf8',
    timeout: 5000
  });
}

async function main() {
  console.log(chalk.cyan.bold('\nStratoSort Startup Checklist'));
  // Basic file presence
  const hasDistIndex = checkFileExists('dist/index.html');
  const hasWebpackConfig = checkFileExists('webpack.config.js');
  const hasRendererIndex = checkFileExists('src/renderer/index.html');
  printStatus(hasWebpackConfig, 'Webpack config present', 'webpack.config.js');
  printStatus(hasRendererIndex, 'Renderer index present', 'src/renderer/index.html');
  printStatus(hasDistIndex, 'Built renderer present', 'dist/index.html');

  // Check Ollama (optional) - using async spawn to avoid blocking
  const ollamaHost = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
  const curl = await runCmd(
    process.platform === 'win32' ? 'powershell.exe' : 'curl',
    process.platform === 'win32'
      ? [
          '-NoProfile',
          '-Command',
          `try { (Invoke-WebRequest -Uri "${ollamaHost}/api/tags" -UseBasicParsing).StatusCode } catch { 0 }`
        ]
      : ['-s', '-o', '/dev/null', '-w', '%{http_code}', `${ollamaHost}/api/tags`]
  );
  const httpCode = (curl.stdout || '').toString().trim();
  const connected = httpCode && httpCode !== '0' && httpCode !== '000';
  printStatus(
    connected,
    'Ollama reachable',
    connected ? `${ollamaHost}` : 'Optional: start with "ollama serve"'
  );

  // Final hint

  console.log(
    `\n${chalk.gray('Tip:')} Run ${chalk.yellow('npm run dev')} to build and launch in development mode.`
  );
}

// Run async main function
main().catch((error) => {
  console.error('Startup check failed:', error);
  process.exit(1);
});
