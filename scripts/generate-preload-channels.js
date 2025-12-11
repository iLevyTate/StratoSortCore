#!/usr/bin/env node
/**
 * Generate Preload Channels Script
 *
 * This script generates the IPC_CHANNELS constant for preload.js from the
 * centralized definition in src/shared/constants.js.
 *
 * The preload script runs in a sandboxed environment and cannot use require()
 * to import from shared modules. This script solves the duplication problem by:
 * 1. Reading the IPC_CHANNELS from shared/constants.js
 * 2. Generating a JavaScript string representation
 * 3. Optionally updating preload.js with the generated channels
 *
 * Usage:
 *   node scripts/generate-preload-channels.js [--check] [--update]
 *
 * Options:
 *   --check   Check if preload.js is in sync with constants.js (exit 1 if not)
 *   --update  Update preload.js with the current channels from constants.js
 *   (default) Print the generated channels to stdout
 */

const fs = require('fs');
const path = require('path');

// Paths
const CONSTANTS_PATH = path.join(__dirname, '../src/shared/constants.js');
const PRELOAD_PATH = path.join(__dirname, '../src/preload/preload.js');

// Markers in preload.js for the IPC_CHANNELS block
const START_MARKER = '// === START GENERATED IPC_CHANNELS ===';
const END_MARKER = '// === END GENERATED IPC_CHANNELS ===';

/**
 * Load IPC_CHANNELS from shared constants
 */
function loadChannels() {
  // Clear require cache to ensure fresh load
  delete require.cache[require.resolve(CONSTANTS_PATH)];
  const { IPC_CHANNELS } = require(CONSTANTS_PATH);
  return IPC_CHANNELS;
}

/**
 * Generate JavaScript code for IPC_CHANNELS
 */
function generateChannelsCode(channels) {
  const indent = '  ';
  let code = `${START_MARKER}\n`;
  code += `// Auto-generated from src/shared/constants.js\n`;
  code += `// Run 'npm run generate:channels' to update\n`;
  code += `const IPC_CHANNELS = {\n`;

  for (const [category, endpoints] of Object.entries(channels)) {
    code += `${indent}// ${category}\n`;
    code += `${indent}${category}: {\n`;

    for (const [name, channel] of Object.entries(endpoints)) {
      code += `${indent}${indent}${name}: '${channel}',\n`;
    }

    code += `${indent}},\n\n`;
  }

  // Remove trailing newline from last category
  code = code.slice(0, -1);
  code += `};\n`;
  code += `${END_MARKER}`;

  return code;
}

/**
 * Extract current channels block from preload.js
 */
function extractCurrentChannels(preloadContent) {
  const startIdx = preloadContent.indexOf(START_MARKER);
  const endIdx = preloadContent.indexOf(END_MARKER);

  if (startIdx === -1 || endIdx === -1) {
    return null;
  }

  return preloadContent.slice(startIdx, endIdx + END_MARKER.length);
}

/**
 * Find the hardcoded IPC_CHANNELS in preload.js (for migration)
 */
function findHardcodedChannels(preloadContent) {
  // Look for the pattern of hardcoded channels
  const hardcodedStart = preloadContent.indexOf('const IPC_CHANNELS = {');
  if (hardcodedStart === -1) return null;

  // Find the matching closing brace
  let braceCount = 0;
  let foundStart = false;
  let endIdx = hardcodedStart;

  for (let i = hardcodedStart; i < preloadContent.length; i++) {
    if (preloadContent[i] === '{') {
      braceCount++;
      foundStart = true;
    } else if (preloadContent[i] === '}') {
      braceCount--;
      if (foundStart && braceCount === 0) {
        endIdx = i + 1;
        break;
      }
    }
  }

  // Include the semicolon if present
  if (preloadContent[endIdx] === ';') {
    endIdx++;
  }

  return {
    start: hardcodedStart,
    end: endIdx,
    content: preloadContent.slice(hardcodedStart, endIdx)
  };
}

/**
 * Check if channels are in sync
 */
function checkSync() {
  const channels = loadChannels();
  const newCode = generateChannelsCode(channels);

  const preloadContent = fs.readFileSync(PRELOAD_PATH, 'utf8');
  const currentBlock = extractCurrentChannels(preloadContent);

  if (!currentBlock) {
    console.error('ERROR: Could not find generated channels block in preload.js');
    console.error('Run with --update to add the generated block');
    return false;
  }

  if (currentBlock.trim() !== newCode.trim()) {
    console.error('ERROR: IPC_CHANNELS in preload.js is out of sync with constants.js');
    console.error('Run "npm run generate:channels -- --update" to sync');
    return false;
  }

  console.log('OK: IPC_CHANNELS are in sync');
  return true;
}

/**
 * Update preload.js with new channels
 */
function updatePreload() {
  const channels = loadChannels();
  const newCode = generateChannelsCode(channels);

  let preloadContent = fs.readFileSync(PRELOAD_PATH, 'utf8');
  const currentBlock = extractCurrentChannels(preloadContent);

  if (currentBlock) {
    // Replace existing generated block
    preloadContent = preloadContent.replace(currentBlock, newCode);
  } else {
    // Look for hardcoded channels to replace
    const hardcoded = findHardcodedChannels(preloadContent);

    if (hardcoded) {
      // Replace hardcoded block with generated block
      preloadContent =
        preloadContent.slice(0, hardcoded.start) + newCode + preloadContent.slice(hardcoded.end);

      console.log('Migrated hardcoded IPC_CHANNELS to generated block');
    } else {
      console.error('ERROR: Could not find IPC_CHANNELS in preload.js');
      console.error('Please add the following after the imports:');
      console.log(newCode);
      return false;
    }
  }

  fs.writeFileSync(PRELOAD_PATH, preloadContent, 'utf8');
  console.log('Updated preload.js with IPC_CHANNELS from constants.js');
  return true;
}

/**
 * Print generated channels to stdout
 */
function printChannels() {
  const channels = loadChannels();
  const code = generateChannelsCode(channels);
  console.log(code);
}

// Main
const args = process.argv.slice(2);

if (args.includes('--check')) {
  process.exit(checkSync() ? 0 : 1);
} else if (args.includes('--update')) {
  process.exit(updatePreload() ? 0 : 1);
} else {
  printChannels();
}
