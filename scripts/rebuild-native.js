// scripts/rebuild-native.js

const { rebuild } = require('@electron/rebuild');
const path = require('path');

function parseTargetArch() {
  const archArg = process.argv.find((a) => a.startsWith('--arch='));
  return archArg ? archArg.split('=')[1] : process.arch;
}

async function rebuildNativeModules() {
  const electronVersion = require('electron/package.json').version;
  const targetArch = parseTargetArch();

  console.log(`Rebuilding native modules for Electron ${electronVersion} (${targetArch})...`);

  await rebuild({
    buildPath: path.resolve(__dirname, '..'),
    electronVersion,
    arch: targetArch,
    onlyModules: ['node-llama-cpp', 'sharp', 'better-sqlite3'],
    useElectronClang: true
  });

  console.log('Native module rebuild complete!');
}

rebuildNativeModules().catch(console.error);
