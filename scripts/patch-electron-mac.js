#!/usr/bin/env node
/**
 * Patch Electron.app Info.plist for macOS development
 *
 * During development, macOS reads the dock label and Activity Monitor process
 * name from the Electron binary's Info.plist, which defaults to "Electron".
 * This script patches CFBundleName and CFBundleDisplayName so the dock shows
 * "StratoSort Core" instead.
 *
 * This is safe and idempotent — re-running produces the same result.
 * Only affects node_modules (dev-only); production builds use electron-builder
 * which sets these values correctly from electron-builder.json.
 *
 * Usage:
 *   node scripts/patch-electron-mac.js          # Patch Info.plist
 *   node scripts/patch-electron-mac.js --check  # Check current values (no changes)
 */

const fs = require('fs');
const path = require('path');

const APP_NAME = 'StratoSort Core';
const BUNDLE_ID = 'com.stratosort.app';

/**
 * Locate the Electron.app Info.plist inside node_modules.
 * Returns null if not found (e.g. running on non-macOS or Electron not installed).
 */
function findInfoPlist() {
  const candidates = [
    // Standard npm install location
    path.join(
      __dirname,
      '..',
      'node_modules',
      'electron',
      'dist',
      'Electron.app',
      'Contents',
      'Info.plist'
    ),
    // Hoisted or alternative layouts
    path.join(__dirname, '..', '..', 'electron', 'dist', 'Electron.app', 'Contents', 'Info.plist')
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Replace a plist string value.
 * Matches: <key>KEY</key>\n\t<string>OLD</string>
 * and replaces OLD with NEW.
 */
function replacePlistValue(content, key, newValue) {
  // Match the key followed by a string value (handles various whitespace)
  const regex = new RegExp(`(<key>${escapeRegex(key)}</key>\\s*<string>)(.*?)(</string>)`, 'g');
  return content.replace(regex, `$1${newValue}$3`);
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readPlistValue(content, key) {
  const regex = new RegExp(`<key>${escapeRegex(key)}</key>\\s*<string>(.*?)</string>`);
  const match = content.match(regex);
  return match ? match[1] : null;
}

function main() {
  if (process.platform !== 'darwin') {
    console.log('[patch-electron-mac] Skipped — not macOS');
    return 0;
  }

  const plistPath = findInfoPlist();
  if (!plistPath) {
    console.log('[patch-electron-mac] Skipped — Electron.app not found');
    return 0;
  }

  const content = fs.readFileSync(plistPath, 'utf8');

  const currentName = readPlistValue(content, 'CFBundleName');
  const currentDisplayName = readPlistValue(content, 'CFBundleDisplayName');
  const currentBundleId = readPlistValue(content, 'CFBundleIdentifier');

  // --check mode: report current values without modifying
  if (process.argv.includes('--check')) {
    console.log('[patch-electron-mac] Info.plist:', plistPath);
    console.log(`  CFBundleName:        ${currentName}`);
    console.log(`  CFBundleDisplayName: ${currentDisplayName}`);
    console.log(`  CFBundleIdentifier:  ${currentBundleId}`);

    const isPatched = currentName === APP_NAME;
    console.log(
      `  Status: ${isPatched ? '✅ Patched' : '⚠️  Not patched (shows "Electron" in dock)'}`
    );
    return isPatched ? 0 : 1;
  }

  // Check if already patched
  if (currentName === APP_NAME && currentDisplayName === APP_NAME) {
    console.log('[patch-electron-mac] Already patched — dock will show "StratoSort Core"');
    return 0;
  }

  // Apply patches
  let patched = content;
  patched = replacePlistValue(patched, 'CFBundleName', APP_NAME);

  // CFBundleDisplayName may not exist in the original; add it if missing
  if (currentDisplayName !== null) {
    patched = replacePlistValue(patched, 'CFBundleDisplayName', APP_NAME);
  } else {
    // Insert after CFBundleName
    patched = patched.replace(
      /(<key>CFBundleName<\/key>\s*<string>.*?<\/string>)/,
      `$1\n\t<key>CFBundleDisplayName</key>\n\t<string>${APP_NAME}</string>`
    );
  }

  // Patch bundle identifier so macOS associates dock state correctly
  if (currentBundleId && currentBundleId !== BUNDLE_ID) {
    patched = replacePlistValue(patched, 'CFBundleIdentifier', BUNDLE_ID);
  }

  fs.writeFileSync(plistPath, patched, 'utf8');

  // Verify
  const verify = fs.readFileSync(plistPath, 'utf8');
  const verifiedName = readPlistValue(verify, 'CFBundleName');
  if (verifiedName !== APP_NAME) {
    console.error('[patch-electron-mac] ❌ Patch failed — CFBundleName is still:', verifiedName);
    return 1;
  }

  console.log('[patch-electron-mac] ✅ Patched Electron.app Info.plist');
  console.log(`  CFBundleName:        "${currentName}" → "${APP_NAME}"`);
  console.log(`  CFBundleDisplayName: "${currentDisplayName || '(missing)'}" → "${APP_NAME}"`);
  if (currentBundleId && currentBundleId !== BUNDLE_ID) {
    console.log(`  CFBundleIdentifier:  "${currentBundleId}" → "${BUNDLE_ID}"`);
  }
  console.log('  The macOS dock will now show "StratoSort Core" in development.');

  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main };
