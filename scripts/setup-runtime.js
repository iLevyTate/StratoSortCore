#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const AdmZip = require('adm-zip');
const { asyncSpawn } = require('../src/main/utils/asyncSpawnUtils');
const { resolveRuntimeRoot } = require('../src/main/utils/runtimePaths');

const manifestPath = path.resolve(__dirname, '../assets/runtime/runtime-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const args = new Set(process.argv.slice(2));
const isCheckOnly = args.has('--check');
const force = args.has('--force');

const runtimeRoot = resolveRuntimeRoot();
const cacheRoot = path.join(runtimeRoot, '.cache');

const log = {
  info: (msg) => console.log(msg),
  warn: (msg) => console.warn(msg),
  error: (msg) => console.error(msg)
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function verifyHash(filePath, expected) {
  if (!expected) {
    log.warn(`⚠ No SHA256 for ${path.basename(filePath)}; skipping verification`);
    return true;
  }
  const actual = await hashFile(filePath);
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`SHA256 mismatch for ${filePath}: expected ${expected}, got ${actual}`);
  }
  return true;
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(downloadFile(res.headers.location, destPath));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`Download failed (${res.statusCode})`));
      }

      ensureDir(path.dirname(destPath));
      const file = fs.createWriteStream(destPath);
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    });
    request.on('error', reject);
  });
}

async function ensureDownloaded(url, targetPath, sha256) {
  if (fs.existsSync(targetPath) && !force) {
    await verifyHash(targetPath, sha256);
    return targetPath;
  }
  log.info(`↓ Downloading ${url}`);
  await downloadFile(url, targetPath);
  await verifyHash(targetPath, sha256);
  return targetPath;
}

async function verifyBinary(command, args = ['--version']) {
  const res = await asyncSpawn(command, args, { timeout: 5000, windowsHide: true });
  return res.status === 0;
}

function patchPythonPth(pythonDir, pthFile) {
  const pthPath = path.join(pythonDir, pthFile);
  if (!fs.existsSync(pthPath)) return;
  const raw = fs.readFileSync(pthPath, 'utf8');
  const lines = raw.split(/\r?\n/);

  const siteLine = '.\\Lib\\site-packages';
  const hasSiteLine = lines.some((l) => l.trim() === siteLine);
  const nextLines = lines.map((line) => (line.trim() === '#import site' ? 'import site' : line));
  if (!hasSiteLine) {
    const insertAt = Math.max(1, nextLines.length - 1);
    nextLines.splice(insertAt, 0, siteLine);
  }

  fs.writeFileSync(pthPath, nextLines.join('\n'), 'utf8');
}

async function runPython(pythonExe, args, opts = {}) {
  const env = {
    ...process.env,
    PYTHONHOME: path.dirname(pythonExe),
    PATH: `${path.dirname(pythonExe)};${path.join(path.dirname(pythonExe), 'Scripts')};${process.env.PATH || ''}`
  };
  return asyncSpawn(pythonExe, args, { timeout: 10 * 60 * 1000, windowsHide: true, env, ...opts });
}

async function ensurePythonAndChroma() {
  const cfg = manifest.windows.python;
  const pythonDir = path.join(runtimeRoot, cfg.targetDir);
  const pythonExe = path.join(pythonDir, cfg.exe);
  const zipPath = path.join(cacheRoot, `python-${cfg.version || 'embed'}.zip`);

  if (!fs.existsSync(pythonExe) || force) {
    log.info('→ Staging embedded Python...');
    ensureDir(pythonDir);
    await ensureDownloaded(cfg.url, zipPath, cfg.sha256);
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(pythonDir, true);
  }

  patchPythonPth(pythonDir, cfg.pthFile);

  const pythonOk = await verifyBinary(pythonExe, ['--version']);
  if (!pythonOk) {
    throw new Error('Embedded Python failed to run');
  }

  const pipCheck = await runPython(pythonExe, ['-m', 'pip', '--version']);
  if (pipCheck.status !== 0) {
    const getPipPath = path.join(cacheRoot, 'get-pip.py');
    await ensureDownloaded(manifest.pip.getPipUrl, getPipPath, manifest.pip.sha256);
    const res = await runPython(pythonExe, [getPipPath]);
    if (res.status !== 0) {
      throw new Error('Failed to bootstrap pip in embedded Python');
    }
  }

  await runPython(pythonExe, ['-m', 'pip', 'install', '--upgrade', 'pip']);
  const chromaCheck = await runPython(pythonExe, ['-c', 'import chromadb']);
  if (chromaCheck.status !== 0 || force) {
    log.info('→ Installing ChromaDB into embedded Python...');
    const res = await runPython(pythonExe, ['-m', 'pip', 'install', 'chromadb']);
    if (res.status !== 0) {
      throw new Error('Failed to install chromadb into embedded Python');
    }
  }
}

async function ensureOllama() {
  const cfg = manifest.windows.ollama;
  const ollamaDir = path.join(runtimeRoot, cfg.targetDir);
  const ollamaExe = path.join(ollamaDir, cfg.exe);
  const installerPath = path.join(cacheRoot, 'ollama-setup.exe');

  if (fs.existsSync(ollamaExe) && !force) {
    return;
  }

  log.info('→ Staging Ollama runtime...');
  await ensureDownloaded(cfg.url, installerPath, cfg.sha256);
  ensureDir(ollamaDir);

  const args = [...(cfg.install?.silentArgs || [])];
  if (cfg.install?.dirArg) {
    args.push(`${cfg.install.dirArg}"${ollamaDir}"`);
  }

  const res = await asyncSpawn(installerPath, args, {
    timeout: 10 * 60 * 1000,
    windowsHide: true,
    shell: false
  });
  if (res.status !== 0) {
    throw new Error(`Ollama installer failed (exit ${res.status ?? 'unknown'})`);
  }

  if (!fs.existsSync(ollamaExe)) {
    const found = findFileRecursive(ollamaDir, cfg.exe, 3);
    if (found) {
      fs.copyFileSync(found, ollamaExe);
    }
  }

  if (!fs.existsSync(ollamaExe)) {
    throw new Error('Ollama binary not found after install');
  }

  const ok = await verifyBinary(ollamaExe, ['--version']);
  if (!ok) {
    throw new Error('Ollama binary failed to run after install');
  }
}

async function ensureTesseract() {
  const cfg = manifest.windows.tesseract;
  const tesseractDir = path.join(runtimeRoot, cfg.targetDir);
  const tesseractExe = path.join(tesseractDir, cfg.exe);
  const installerPath = path.join(cacheRoot, 'tesseract-setup.exe');

  if (fs.existsSync(tesseractExe) && !force) {
    return;
  }

  log.info('→ Staging Tesseract runtime...');
  await ensureDownloaded(cfg.url, installerPath, cfg.sha256);
  ensureDir(tesseractDir);

  const args = [...(cfg.install?.silentArgs || [])];
  if (cfg.install?.dirArg) {
    args.push(`${cfg.install.dirArg}"${tesseractDir}"`);
  }

  const res = await asyncSpawn(installerPath, args, {
    timeout: 10 * 60 * 1000,
    windowsHide: true,
    shell: false
  });
  if (res.status !== 0) {
    throw new Error(`Tesseract installer failed (exit ${res.status ?? 'unknown'})`);
  }

  if (!fs.existsSync(tesseractExe)) {
    const found = findFileRecursive(tesseractDir, cfg.exe, 4);
    if (found) {
      fs.copyFileSync(found, tesseractExe);
    }
  }

  if (!fs.existsSync(tesseractExe)) {
    throw new Error('Tesseract binary not found after install');
  }

  const ok = await verifyBinary(tesseractExe, ['--version']);
  if (!ok) {
    throw new Error('Tesseract binary failed to run after install');
  }
}

function findFileRecursive(root, filename, maxDepth, currentDepth = 0) {
  if (currentDepth > maxDepth) return null;
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) {
      return fullPath;
    }
    if (entry.isDirectory()) {
      const found = findFileRecursive(fullPath, filename, maxDepth, currentDepth + 1);
      if (found) return found;
    }
  }
  return null;
}

async function checkOnly() {
  const pythonExe = path.join(
    runtimeRoot,
    manifest.windows.python.targetDir,
    manifest.windows.python.exe
  );
  const ollamaExe = path.join(
    runtimeRoot,
    manifest.windows.ollama.targetDir,
    manifest.windows.ollama.exe
  );
  const tesseractExe = path.join(
    runtimeRoot,
    manifest.windows.tesseract.targetDir,
    manifest.windows.tesseract.exe
  );

  const status = {
    python: fs.existsSync(pythonExe),
    ollama: fs.existsSync(ollamaExe),
    tesseract: fs.existsSync(tesseractExe)
  };

  log.info(JSON.stringify(status, null, 2));
  return status.python && status.ollama && status.tesseract ? 0 : 1;
}

async function main() {
  if (process.platform !== 'win32') {
    log.info('[runtime] Windows-only setup; skipping');
    return 0;
  }

  ensureDir(runtimeRoot);
  ensureDir(cacheRoot);

  if (isCheckOnly) {
    return checkOnly();
  }

  log.info('== StratoSort Runtime Setup (Windows) ==');
  log.info('Phase 1: Ollama');
  await ensureOllama();
  log.info('Phase 2: Python + ChromaDB');
  await ensurePythonAndChroma();
  log.info('Phase 3: Tesseract');
  await ensureTesseract();
  log.info('✓ Runtime setup complete');
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    log.error(`[runtime] Failed: ${err?.message || err}`);
    process.exit(1);
  });
