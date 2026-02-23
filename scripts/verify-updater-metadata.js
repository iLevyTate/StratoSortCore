#!/usr/bin/env node

/**
 * Validates updater metadata files reference artifacts that exist in build output.
 * This catches release jobs that upload metadata under incorrect filenames.
 */

const fs = require('fs');
const path = require('path');

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

function listFiles(buildRoot) {
  return fs
    .readdirSync(buildRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
}

function extractReferencedArtifacts(metadataFilePath) {
  const content = fs.readFileSync(metadataFilePath, 'utf8');
  const references = new Set();

  const matcher = /^\s*(?:-\s*)?(?:url|path):\s*(.+)\s*$/gm;
  let match = matcher.exec(content);
  while (match) {
    const raw = String(match[1] || '')
      .trim()
      .replace(/^['"]|['"]$/g, '');
    if (raw) {
      const decoded = decodeURIComponent(raw);
      references.add(path.basename(decoded));
    }
    match = matcher.exec(content);
  }

  return Array.from(references);
}

function verifyMac(buildRoot) {
  const files = listFiles(buildRoot);
  const metadataFiles = files.filter((name) => /^latest.*\.yml$/i.test(name));
  if (metadataFiles.length === 0) {
    throw new Error('No updater metadata files found (expected latest*.yml).');
  }

  if (!files.includes('latest-mac.yml')) {
    throw new Error('Missing canonical mac updater metadata file: latest-mac.yml');
  }

  const arm64Artifacts = files.filter((name) => /-arm64\.(zip|dmg)$/i.test(name));
  if (arm64Artifacts.length > 0 && !files.includes('latest-mac-arm64.yml')) {
    throw new Error('arm64 mac artifacts detected but latest-mac-arm64.yml is missing.');
  }

  metadataFiles.forEach((metadataName) => {
    const metadataPath = path.join(buildRoot, metadataName);
    const referenced = extractReferencedArtifacts(metadataPath);
    referenced.forEach((artifactName) => {
      if (!files.includes(artifactName)) {
        throw new Error(`${metadataName} references missing artifact: ${artifactName}`);
      }
    });
  });
}

function verifyWin(buildRoot) {
  const files = listFiles(buildRoot);
  if (!files.includes('latest.yml')) {
    throw new Error('Missing canonical Windows updater metadata file: latest.yml');
  }

  const referenced = extractReferencedArtifacts(path.join(buildRoot, 'latest.yml'));
  referenced.forEach((artifactName) => {
    if (!files.includes(artifactName)) {
      throw new Error(`latest.yml references missing artifact: ${artifactName}`);
    }
  });
}

function run() {
  const args = parseArgs();
  const platform = String(args.platform || '').toLowerCase();
  const buildRoot = path.resolve(
    __dirname,
    '..',
    String(args['build-root'] || path.join('release', 'build'))
  );

  if (!platform || (platform !== 'mac' && platform !== 'win')) {
    throw new Error(
      'Usage: node scripts/verify-updater-metadata.js --platform=mac|win [--build-root=release/build]'
    );
  }

  ensureExists(buildRoot, 'Build output root');
  if (platform === 'mac') {
    verifyMac(buildRoot);
  } else {
    verifyWin(buildRoot);
  }

  console.log(`Updater metadata verification passed for platform=${platform}.`);
}

try {
  run();
} catch (error) {
  console.error(`Updater metadata verification failed: ${error?.message || error}`);
  process.exit(1);
}
