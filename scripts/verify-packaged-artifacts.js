#!/usr/bin/env node

/**
 * Validates packaged build outputs contain runtime-critical files.
 * This catches missing unpacked native modules and runtime assets.
 */

const fs = require('fs');
const path = require('path');

const REQUIRED_NATIVE_MODULE_PATHS = [
  ['sharp'],
  ['better-sqlite3'],
  ['@napi-rs', 'canvas'],
  ['lz4-napi'],
  ['node-llama-cpp'],
  ['@node-llama-cpp']
];

function parseArgs() {
  const args = process.argv.slice(2);
  const output = {};

  args.forEach((arg) => {
    if (!arg.startsWith('--')) return;
    const [rawKey, rawValue] = arg.slice(2).split('=');
    output[rawKey] = rawValue === undefined ? true : rawValue;
  });

  return output;
}

function ensureExists(targetPath, label) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`${label} missing: ${targetPath}`);
  }
}

function findMacAppBundles(buildRoot, arch) {
  const entries = fs
    .readdirSync(buildRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('mac'))
    .map((entry) => entry.name);

  let ordered = entries;
  if (arch) {
    const archMatches = entries.filter((name) => name.includes(arch));
    if (archMatches.length > 0) {
      ordered = archMatches;
    } else if (entries.includes('mac')) {
      // electron-builder can emit a plain "mac" directory for single-arch builds.
      ordered = ['mac'];
    } else {
      throw new Error(`No mac build directory matched requested arch "${arch}" in ${buildRoot}`);
    }
  }

  const found = [];
  for (const dirName of ordered) {
    const appPath = path.join(buildRoot, dirName, 'StratoSort Core.app');
    if (fs.existsSync(appPath)) {
      found.push(appPath);
    }
  }

  if (found.length > 0) {
    return found;
  }

  throw new Error(
    `No mac app bundle found in ${buildRoot} (arch=${arch || 'any'}; searched: ${ordered.join(', ') || 'none'})`
  );
}

function verifyNativeModuleFolders(unpackedNodeModulesRoot) {
  REQUIRED_NATIVE_MODULE_PATHS.forEach((segments) => {
    const modulePath = path.join(unpackedNodeModulesRoot, ...segments);
    ensureExists(modulePath, `Unpacked native module ${segments.join('/')}`);
  });
}

function verifyWindowsArtifacts(buildRoot) {
  const appRoot = path.join(buildRoot, 'win-unpacked');
  const resources = path.join(appRoot, 'resources');
  const unpackedModules = path.join(resources, 'app.asar.unpacked', 'node_modules');

  ensureExists(path.join(appRoot, 'StratoSort Core.exe'), 'Windows executable');
  ensureExists(path.join(resources, 'app.asar'), 'Windows app.asar');
  ensureExists(
    path.join(resources, 'assets', 'runtime', 'llama-server.exe'),
    'Windows runtime binary'
  );
  verifyNativeModuleFolders(unpackedModules);
}

function verifyMacArtifacts(buildRoot, arch) {
  const appBundles = findMacAppBundles(buildRoot, arch);
  appBundles.forEach((appBundle) => {
    const contents = path.join(appBundle, 'Contents');
    const resources = path.join(contents, 'Resources');
    const unpackedModules = path.join(resources, 'app.asar.unpacked', 'node_modules');

    ensureExists(path.join(contents, 'MacOS', 'StratoSort Core'), 'macOS executable');
    ensureExists(path.join(resources, 'app.asar'), 'macOS app.asar');
    ensureExists(path.join(resources, 'assets', 'runtime', 'llama-server'), 'macOS runtime binary');
    verifyNativeModuleFolders(unpackedModules);
  });
}

function run() {
  const args = parseArgs();
  const platform = String(args.platform || '').toLowerCase();
  const arch = args.arch ? String(args.arch).toLowerCase() : '';
  const buildRoot = path.resolve(__dirname, '..', 'release', 'build');

  if (!platform || (platform !== 'win' && platform !== 'mac')) {
    throw new Error(
      'Usage: node scripts/verify-packaged-artifacts.js --platform=win|mac [--arch=x64|arm64]'
    );
  }

  ensureExists(buildRoot, 'Build output root');

  if (platform === 'win') {
    verifyWindowsArtifacts(buildRoot);
  } else {
    verifyMacArtifacts(buildRoot, arch);
  }

  console.log(
    `Packaged artifact verification passed for platform=${platform}${arch ? ` arch=${arch}` : ''}.`
  );
}

try {
  run();
} catch (error) {
  console.error(`Packaged artifact verification failed: ${error?.message || error}`);
  process.exit(1);
}
