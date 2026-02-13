#!/usr/bin/env node
/**
 * Model Setup Script
 *
 * Downloads recommended GGUF models for node-llama-cpp.
 * Supports --check mode to verify model availability and --download mode to fetch models.
 *
 * Usage:
 *   node scripts/setup-models.js          # Interactive mode
 *   node scripts/setup-models.js --check  # Check if models are available
 *   node scripts/setup-models.js --auto   # Download recommended models automatically
 *   node scripts/setup-models.js --download # Same as --auto
 */

const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const { createWriteStream } = require('fs');
const { getRecommendedModels } = require('../src/shared/modelRegistry');

function buildRecommendedModels() {
  const recommended = getRecommendedModels();
  const models = {};

  for (const [name, info] of Object.entries(recommended)) {
    models[name] = {
      type: info.type,
      displayName: info.displayName,
      description: info.description,
      size: info.size,
      url: info.url
    };

    if (info.clipModel) {
      models[info.clipModel.name] = {
        type: 'vision-helper',
        displayName: 'Vision Projector (mmproj)',
        description: `Required for ${info.displayName}`,
        size: info.clipModel.size,
        url: info.clipModel.url
      };
    }
  }

  return models;
}

// Model registry (derived from shared model registry)
const RECOMMENDED_MODELS = buildRecommendedModels();

// Get user data directory
function getModelsPath() {
  const appName = 'stratosort-core';
  const home = process.env.HOME || process.env.USERPROFILE;

  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA || path.join(home, 'AppData', 'Roaming'),
      appName,
      'models'
    );
  } else if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', appName, 'models');
  } else {
    return path.join(
      process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'),
      appName,
      'models'
    );
  }
}

// Format bytes to human-readable
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

const MIN_SIZE_RATIO = 0.9;

// Check if model exists and is likely complete
async function getModelStatus(modelPath, expectedSize) {
  try {
    const stat = await fs.stat(modelPath);
    if (!stat?.isFile?.() || stat.size <= 0) {
      return { exists: false, size: 0, complete: false };
    }

    if (!Number.isFinite(expectedSize) || expectedSize <= 0) {
      return { exists: true, size: stat.size, complete: true };
    }

    const complete = stat.size >= expectedSize * MIN_SIZE_RATIO;
    return { exists: true, size: stat.size, complete };
  } catch {
    return { exists: false, size: 0, complete: false };
  }
}

// Download a file with progress
async function downloadFile(url, destPath) {
  let startByte = 0;
  try {
    const stat = await fs.stat(destPath);
    if (stat?.isFile?.() && stat.size > 0) {
      startByte = stat.size;
    }
  } catch {
    startByte = 0;
  }

  return new Promise((resolve, reject) => {
    const file = createWriteStream(destPath, { flags: startByte > 0 ? 'a' : 'w' });
    let downloadedBytes = startByte;
    let totalBytes = 0;
    let lastLogTime = 0;

    const headers = startByte > 0 ? { Range: `bytes=${startByte}-` } : {};
    const request = https.get(url, { followRedirect: false, headers }, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        file.close();
        fs.unlink(destPath).catch(() => {});
        downloadFile(redirectUrl, destPath).then(resolve).catch(reject);
        return;
      }

      // If server ignored Range, restart clean download
      if (startByte > 0 && response.statusCode === 200) {
        file.close();
        fs.unlink(destPath).catch(() => {});
        downloadFile(url, destPath).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200 && response.statusCode !== 206) {
        file.close();
        fs.unlink(destPath).catch(() => {});
        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
        return;
      }

      const contentLength = parseInt(response.headers['content-length'], 10) || 0;
      const contentRange = response.headers['content-range'];
      if (contentRange) {
        const match = contentRange.match(/\/(\d+)/);
        totalBytes = match ? parseInt(match[1], 10) : startByte + contentLength;
      } else {
        totalBytes = startByte + contentLength;
      }

      response.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        const now = Date.now();
        if (now - lastLogTime > 2000) {
          // Log every 2 seconds
          const progress = totalBytes
            ? ((downloadedBytes / totalBytes) * 100).toFixed(1)
            : 'unknown';
          process.stdout.write(
            `\r  Progress: ${formatSize(downloadedBytes)} / ${formatSize(totalBytes)} (${progress}%)    `
          );
          lastLogTime = now;
        }
      });

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        process.stdout.write('\n');
        resolve();
      });

      file.on('error', (error) => {
        file.close();
        fs.unlink(destPath).catch(() => {});
        reject(error);
      });

      response.on('error', (error) => {
        file.close();
        fs.unlink(destPath).catch(() => {});
        reject(error);
      });
    });

    request.on('error', (error) => {
      file.close();
      fs.unlink(destPath).catch(() => {});
      reject(error);
    });

    // Allow large files to download over slower connections (5 minute inactivity window).
    request.setTimeout(300000, () => {
      request.destroy();
      reject(new Error('Download timeout'));
    });
  });
}

// Main functions
async function checkModels() {
  console.log('Checking for GGUF models...\n');

  const modelsPath = getModelsPath();
  let allFound = true;

  for (const [name, info] of Object.entries(RECOMMENDED_MODELS)) {
    const modelPath = path.join(modelsPath, name);
    const status = await getModelStatus(modelPath, info.size);

    if (status.complete) {
      console.log(`✅ ${info.displayName} (${name})`);
      continue;
    }

    if (status.exists) {
      console.log(
        `⚠️  ${info.displayName} (${name}) - Incomplete (${formatSize(status.size)} of ${formatSize(info.size)})`
      );
    } else {
      console.log(`❌ ${info.displayName} (${name}) - Not found`);
    }
    allFound = false;
  }

  console.log('\nModels directory:', modelsPath);

  if (allFound) {
    console.log('\n✅ All recommended models are available.');
    process.exit(0);
  } else {
    console.log('\n⚠️  Some models are missing. Run with --download to fetch them.');
    process.exit(1);
  }
}

async function downloadModels() {
  console.log('Downloading recommended GGUF models...\n');

  const modelsPath = getModelsPath();

  // Create models directory
  await fs.mkdir(modelsPath, { recursive: true });

  let totalSize = 0;
  const toDownload = [];

  // Check which models need downloading
  for (const [name, info] of Object.entries(RECOMMENDED_MODELS)) {
    const modelPath = path.join(modelsPath, name);
    const status = await getModelStatus(modelPath, info.size);

    if (!status.complete) {
      toDownload.push({ name, info, modelPath, existingSize: status.size });
      totalSize += info.size;
    } else {
      console.log(`✅ ${info.displayName} - Already downloaded`);
    }
  }

  if (toDownload.length === 0) {
    console.log('\n✅ All models already downloaded!');
    return;
  }

  console.log(
    `\n📥 Need to download ${toDownload.length} model(s), total size: ${formatSize(totalSize)}\n`
  );

  // Download each model
  for (const { name, info, modelPath, existingSize } of toDownload) {
    console.log(`\n📥 Downloading ${info.displayName}...`);
    console.log(`   Size: ${formatSize(info.size)}`);
    console.log(`   URL: ${info.url}`);
    if (existingSize > 0) {
      console.log(`   Resuming from: ${formatSize(existingSize)}`);
    }

    try {
      const maxAttempts = 2;
      let attempt = 0;
      let completed = false;

      while (attempt < maxAttempts && !completed) {
        attempt += 1;
        await downloadFile(info.url, modelPath);
        const status = await getModelStatus(modelPath, info.size);
        completed = status.complete;

        if (!completed) {
          await fs.unlink(modelPath).catch(() => {});
          if (attempt < maxAttempts) {
            console.log('   ⚠️  Incomplete download detected, retrying clean...');
          }
        }
      }

      if (completed) {
        console.log(`✅ ${info.displayName} downloaded successfully!`);
      } else {
        console.error(`❌ Failed to download ${name}: Incomplete file after retry`);
      }
    } catch (error) {
      console.error(`❌ Failed to download ${name}: ${error.message}`);
    }
  }

  console.log('\n✅ Model download complete!');
  console.log(`Models saved to: ${modelsPath}`);
}

// Parse arguments and run
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--check')) {
    await checkModels();
  } else if (args.includes('--auto') || args.includes('--download')) {
    await downloadModels();
  } else {
    // Interactive mode - just check for now
    console.log('Stratosort Model Setup\n');
    console.log('Usage:');
    console.log('  --check     Check if recommended models are available');
    console.log('  --download  Download recommended models');
    console.log('  --auto      Same as --download\n');
    await checkModels();
  }
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
