#!/usr/bin/env node
/**
 * Verify IPC Handler Coverage
 *
 * Statically verifies that every channel defined in IPC_CHANNELS (src/shared/constants.js)
 * has a corresponding handler registered in the IPC handler files (src/main/ipc/).
 *
 * Handler registration patterns detected:
 *   - safeHandle(ipcMain, IPC_CHANNELS.CATEGORY.NAME, ...)
 *   - registerHandlers({ handlers: { [IPC_CHANNELS.CATEGORY.NAME]: ... } })
 *   - safeOn(ipcMain, IPC_CHANNELS.CATEGORY.NAME, ...)
 *
 * Some channels are event-only (main->renderer push) and are expected to not have
 * invoke handlers. These are tracked in KNOWN_EVENT_ONLY_CHANNELS below.
 *
 * Usage:
 *   node scripts/verify-ipc-handlers.js
 *
 * Exit codes:
 *   0 - All channels have handlers (or are known event-only)
 *   1 - One or more channels are missing handlers
 */

const fs = require('fs');
const path = require('path');

const CONSTANTS_PATH = path.join(__dirname, '../src/shared/constants.js');
const IPC_DIR = path.join(__dirname, '../src/main/ipc');

/**
 * Channels that are event-only (pushed from main to renderer) or handled
 * via ipcMain.on() (fire-and-forget) rather than ipcMain.handle().
 * These are not expected to appear in safeHandle/registerHandlers calls.
 */
const KNOWN_EVENT_ONLY_CHANNELS = new Set([
  // Push events (main -> renderer via webContents.send, listened via safeOn in preload)
  'CHAT.STREAM_CHUNK',
  'CHAT.STREAM_END',
  'VECTOR_DB.STATUS_CHANGED',
  'UNDO_REDO.STATE_CHANGED',
  // Fire-and-forget listener registered in simple-main.js via ipcMain.on() (not in src/main/ipc/)
  'SYSTEM.RENDERER_ERROR_REPORT'
]);

/**
 * Recursively collect all .js files in a directory
 */
function collectJsFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectJsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Extract all channel definitions from IPC_CHANNELS as {category, name, channel} tuples
 */
function getDefinedChannels() {
  delete require.cache[require.resolve(CONSTANTS_PATH)];
  const { IPC_CHANNELS } = require(CONSTANTS_PATH);

  const channels = [];

  for (const [category, endpoints] of Object.entries(IPC_CHANNELS)) {
    for (const [name, channel] of Object.entries(endpoints)) {
      channels.push({
        category,
        name,
        channel,
        constantRef: `${category}.${name}`
      });
    }
  }

  return channels;
}

/**
 * Read all IPC handler files and build a set of constant references found.
 *
 * Matches patterns like:
 *   IPC_CHANNELS.WINDOW.MINIMIZE
 *   CHANNELS.WINDOW.MINIMIZE
 *   Also matches the channel string literal as fallback (e.g., 'window:minimize')
 */
function getHandledChannelRefs() {
  const handlerFiles = collectJsFiles(IPC_DIR);
  const allContent = handlerFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');

  const refs = new Set();

  // Match constant references: IPC_CHANNELS.CATEGORY.NAME or CHANNELS.CATEGORY.NAME
  const constPattern = /(?:IPC_)?CHANNELS\.(\w+)\.(\w+)/g;
  let match;
  while ((match = constPattern.exec(allContent)) !== null) {
    refs.add(`${match[1]}.${match[2]}`);
  }

  // Also match literal channel strings as fallback (e.g., 'files:select')
  const literalPattern = /['"]([a-z][\w-]*:[a-z][\w-]*)['"]|['"]([a-z][\w-]*-[a-z][\w-]*)['"]/g;
  while ((match = literalPattern.exec(allContent)) !== null) {
    const val = match[1] || match[2];
    if (val) refs.add(val);
  }

  return refs;
}

// Main
const definedChannels = getDefinedChannels();
const handledRefs = getHandledChannelRefs();

const missing = [];
const eventOnly = [];
const found = [];

for (const entry of definedChannels) {
  const { constantRef, channel } = entry;

  if (KNOWN_EVENT_ONLY_CHANNELS.has(constantRef)) {
    eventOnly.push(entry);
    continue;
  }

  // Check if the channel is referenced by constant ref OR literal string
  if (handledRefs.has(constantRef) || handledRefs.has(channel)) {
    found.push(entry);
  } else {
    missing.push(entry);
  }
}

const total = definedChannels.length;
const coveredCount = found.length;
const eventOnlyCount = eventOnly.length;
const missingCount = missing.length;

console.log(`\nIPC Handler Coverage Report`);
console.log(`${'='.repeat(50)}`);
console.log(`Total channels defined:  ${total}`);
console.log(`Handlers found:          ${coveredCount}`);
console.log(`Event-only (expected):   ${eventOnlyCount}`);
console.log(`Handlers missing:        ${missingCount}`);
console.log(
  `Coverage:                ${(((coveredCount + eventOnlyCount) / total) * 100).toFixed(1)}%`
);
console.log();

if (eventOnlyCount > 0) {
  console.log('EVENT-ONLY CHANNELS (no handler expected):');
  for (const { category, name, channel } of eventOnly) {
    console.log(`  ${category}.${name} (${channel})`);
  }
  console.log();
}

if (missingCount > 0) {
  console.log('MISSING HANDLERS:');
  console.log('-'.repeat(50));

  const byCategory = {};
  for (const { category, name, channel } of missing) {
    if (!byCategory[category]) byCategory[category] = [];
    byCategory[category].push({ name, channel });
  }

  for (const [category, entries] of Object.entries(byCategory)) {
    console.log(`  ${category}:`);
    for (const { name, channel } of entries) {
      console.log(`    - ${name} (${channel})`);
    }
  }

  console.log();
  console.error('ERROR: Some IPC channels are missing handlers. See report above.');
  process.exit(1);
} else {
  console.log('OK: All IPC channels have corresponding handlers.');
  process.exit(0);
}
