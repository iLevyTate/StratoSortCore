#!/usr/bin/env node
/**
 * Generate Preload Channels Script
 *
 * This script generates the IPC_CHANNELS and IPC_EVENTS constants for preload.js
 * from the centralized definitions in src/shared/constants.js.
 *
 * The preload script runs in a sandboxed environment and cannot use require()
 * to import from shared modules. This script solves the duplication problem by:
 * 1. Reading IPC_CHANNELS and IPC_EVENTS from shared/constants.js
 * 2. Generating JavaScript string representations
 * 3. Optionally updating preload.js with the generated constants
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

// Markers in preload.js for the generated block
const START_MARKER = '// === START GENERATED IPC_CHANNELS ===';
const END_MARKER = '// === END GENERATED IPC_CHANNELS ===';

/**
 * Load IPC_CHANNELS and IPC_EVENTS from shared constants
 */
function loadChannels() {
  // Clear require cache to ensure fresh load
  delete require.cache[require.resolve(CONSTANTS_PATH)];
  const { IPC_CHANNELS, IPC_EVENTS } = require(CONSTANTS_PATH);
  return { IPC_CHANNELS, IPC_EVENTS };
}

/**
 * Generate JavaScript code for a nested object constant (IPC_CHANNELS)
 */
function generateNestedObjectCode(varName, obj, indent) {
  let code = `const ${varName} = {\n`;

  const categories = Object.entries(obj);
  categories.forEach(([category, endpoints], categoryIndex) => {
    const isLastCategory = categoryIndex === categories.length - 1;
    code += `${indent}// ${category}\n`;
    code += `${indent}${category}: {\n`;

    const endpointEntries = Object.entries(endpoints);
    endpointEntries.forEach(([name, channel], endpointIndex) => {
      const isLastEndpoint = endpointIndex === endpointEntries.length - 1;
      code += `${indent}${indent}${name}: '${channel}'${isLastEndpoint ? '' : ','}\n`;
    });

    code += `${indent}}${isLastCategory ? '' : ','}\n`;
    if (!isLastCategory) {
      code += `\n`;
    }
  });
  code += `};\n`;
  return code;
}

/**
 * Generate JavaScript code for a flat object constant (IPC_EVENTS)
 */
function generateFlatObjectCode(varName, obj, indent) {
  let code = `const ${varName} = {\n`;

  const entries = Object.entries(obj);
  entries.forEach(([name, value], index) => {
    const isLast = index === entries.length - 1;
    code += `${indent}${name}: '${value}'${isLast ? '' : ','}\n`;
  });

  code += `};\n`;
  return code;
}

/**
 * Generate the complete code block for both IPC_CHANNELS and IPC_EVENTS
 */
function generateChannelsCode({ IPC_CHANNELS, IPC_EVENTS }) {
  const indent = '  ';
  let code = `${START_MARKER}\n`;
  code += `// Auto-generated from src/shared/constants.js\n`;
  code += `// Run 'npm run generate:channels' to update\n`;
  code += generateNestedObjectCode('IPC_CHANNELS', IPC_CHANNELS, indent);
  code += `\n`;
  code += generateFlatObjectCode('IPC_EVENTS', IPC_EVENTS, indent);
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
  const constants = loadChannels();
  const newCode = generateChannelsCode(constants);

  const preloadContent = fs.readFileSync(PRELOAD_PATH, 'utf8');
  const currentBlock = extractCurrentChannels(preloadContent);

  if (!currentBlock) {
    console.error('ERROR: Could not find generated channels block in preload.js');
    console.error('Run with --update to add the generated block');
    return false;
  }

  if (currentBlock.trim() !== newCode.trim()) {
    console.error('ERROR: IPC_CHANNELS/IPC_EVENTS in preload.js is out of sync with constants.js');
    console.error('Run "npm run generate:channels -- --update" to sync');
    return false;
  }

  console.log('OK: IPC_CHANNELS and IPC_EVENTS are in sync');
  return true;
}

/**
 * Update preload.js with new channels
 */
function updatePreload() {
  const constants = loadChannels();
  const newCode = generateChannelsCode(constants);

  let preloadContent = fs.readFileSync(PRELOAD_PATH, 'utf8');
  const currentBlock = extractCurrentChannels(preloadContent);

  if (currentBlock) {
    preloadContent = preloadContent.replace(currentBlock, newCode);
  } else {
    const hardcoded = findHardcodedChannels(preloadContent);

    if (hardcoded) {
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
  console.log('Updated preload.js with IPC_CHANNELS and IPC_EVENTS from constants.js');
  return true;
}

/**
 * Print generated channels to stdout
 */
function printChannels() {
  const constants = loadChannels();
  const code = generateChannelsCode(constants);
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
