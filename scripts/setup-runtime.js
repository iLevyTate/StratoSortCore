#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const os = require('os');
const AdmZip = require('adm-zip');
const { asyncSpawn } = require('../src/main/utils/asyncSpawnUtils');
const { resolveRuntimeRoot } = require('../src/main/utils/runtimePaths');

const manifestPath = path.resolve(__dirname, '../assets/runtime/runtime-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const args = new Set(process.argv.slice(2));
const isCheckOnly = args.has('--check');
// NOTE: `npm` itself uses `--force`, so prefer `--stage-force` for this script.
const force = args.has('--stage-force') || args.has('--runtime-force') || args.has('--force');

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
  const actual = await hashFile(filePath);
  if (!expected) {
    log.warn(`⚠ No SHA256 for ${path.basename(filePath)}; skipping verification`);
    log.info(`  Computed SHA256: ${actual}`);
    log.info(`  To pin this hash, add it to runtime-manifest.json`);
    return true;
  }
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

/**
 * Some Windows environments refuse to execute freshly-downloaded .exe from certain
 * locations (e.g., inside user profile folders) and Node's spawn() returns EACCES.
 * Workaround: copy the installer to %TEMP% and execute from there.
 */
async function runInstallerFromTemp(installerPath, args, options) {
  if (process.platform !== 'win32') {
    return asyncSpawn(installerPath, args, options);
  }

  let tempDir = null;
  let tempExePath = null;
  try {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratosort-runtime-'));
    tempExePath = path.join(tempDir, path.basename(installerPath));
    fs.copyFileSync(installerPath, tempExePath);
    return await asyncSpawn(tempExePath, args, options);
  } finally {
    // Best-effort cleanup
    try {
      if (tempExePath && fs.existsSync(tempExePath)) fs.unlinkSync(tempExePath);
    } catch {
      // ignore
    }
    try {
      if (tempDir && fs.existsSync(tempDir)) fs.rmdirSync(tempDir);
    } catch {
      // ignore
    }
  }
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

function formatSpawnFailure(prefix, res) {
  const status = res?.status ?? 'unknown';
  const errorMsg = res?.error?.message ? String(res.error.message).trim() : '';
  const signal = res?.signal ? String(res.signal).trim() : '';
  const timedOut = res?.timedOut ? 'true' : 'false';
  const stderr = (res?.stderr || '').trim();
  const stdout = (res?.stdout || '').trim();
  return (
    `${prefix} (exit ${status})` +
    (signal ? `\n[signal]\n${signal}` : '') +
    (errorMsg ? `\n[error]\n${errorMsg}` : '') +
    (timedOut === 'true' ? `\n[timedOut]\ntrue` : '') +
    (stderr ? `\n[stderr]\n${stderr}` : '') +
    (stdout ? `\n[stdout]\n${stdout}` : '')
  );
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
      throw new Error(formatSpawnFailure('Failed to bootstrap pip in embedded Python', res));
    }
  }

  const pipUpgrade = await runPython(pythonExe, ['-m', 'pip', 'install', '--upgrade', 'pip']);
  if (pipUpgrade.status !== 0) {
    throw new Error(formatSpawnFailure('Failed to upgrade pip in embedded Python', pipUpgrade));
  }
  const chromaCheck = await runPython(pythonExe, ['-c', 'import chromadb']);
  if (chromaCheck.status !== 0 || force) {
    log.info('→ Installing ChromaDB into embedded Python...');
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const res = await runPython(pythonExe, [
        '-m',
        'pip',
        'install',
        '--disable-pip-version-check',
        '--no-input',
        'chromadb'
      ]);
      if (res.status === 0) {
        return;
      }

      const stderr = (res.stderr || '').toString();
      const isFileInUse =
        /WinError\s*32/i.test(stderr) ||
        /being used by another process/i.test(stderr) ||
        /used by another process/i.test(stderr);

      if (isFileInUse && attempt < maxAttempts) {
        const delayMs = 2000 * attempt;
        log.warn(
          `⚠ ChromaDB install hit file-lock (WinError 32). Retrying in ${delayMs}ms... (attempt ${attempt}/${maxAttempts})`
        );
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }

      throw new Error(formatSpawnFailure('Failed to install chromadb into embedded Python', res));
    }
  }
}

async function ensureOllama() {
  const cfg = manifest.windows.ollama;
  const ollamaDir = path.join(runtimeRoot, cfg.targetDir);
  const ollamaExe = path.join(ollamaDir, cfg.exe);
  const payloadIsZip = String(cfg.type || '').toLowerCase() === 'zip';
  const payloadPath = path.join(cacheRoot, payloadIsZip ? 'ollama.zip' : 'ollama-setup.exe');

  const shouldKeepGpuLibs =
    process.env.STRATOSORT_BUNDLE_OLLAMA_GPU === '1' ||
    process.env.STRATOSORT_BUNDLE_OLLAMA_GPU === 'true';

  const pruneOllama = () => {
    if (process.platform !== 'win32' || shouldKeepGpuLibs) return;
    const gpuLibRoot = path.join(ollamaDir, 'lib', 'ollama');
    for (const dir of ['cuda_v12', 'cuda_v13', 'rocm', 'vulkan']) {
      const p = path.join(gpuLibRoot, dir);
      if (fs.existsSync(p)) {
        fs.rmSync(p, { recursive: true, force: true });
      }
    }
    // Optional: remove the desktop "Ollama app.exe" helper (not required for `ollama.exe` CLI/server).
    const appExe = path.join(ollamaDir, 'ollama app.exe');
    if (fs.existsSync(appExe)) {
      fs.unlinkSync(appExe);
    }
  };

  // If already staged, still enforce pruning policy (keeps installers small and stable).
  if (fs.existsSync(ollamaExe) && !force) {
    try {
      pruneOllama();
    } catch {
      // best-effort
    }
    return;
  }

  log.info('→ Staging Ollama runtime...');
  await ensureDownloaded(cfg.url, payloadPath, cfg.sha256);

  // Clean existing content to avoid carrying over old layouts (and bloating packaged size).
  try {
    if (fs.existsSync(ollamaDir)) {
      fs.rmSync(ollamaDir, { recursive: true, force: true });
    }
  } catch {
    // best-effort
  }
  ensureDir(ollamaDir);

  if (payloadIsZip) {
    const zip = new AdmZip(payloadPath);
    zip.extractAllTo(ollamaDir, true);
  } else {
    const installType = (cfg.install?.type || '').toLowerCase();
    const args = [...(cfg.install?.silentArgs || [])];
    if (cfg.install?.dirArg) {
      const dirArg = `${cfg.install.dirArg}${ollamaDir}`;
      if (installType === 'nsis') args.push(dirArg);
      else args.push(dirArg);
    }

    const res = await runInstallerFromTemp(payloadPath, args, {
      timeout: 10 * 60 * 1000,
      windowsHide: true,
      shell: false
    });
    if (res.status !== 0) {
      throw new Error(formatSpawnFailure('Ollama installer failed', res));
    }
  }

  try {
    pruneOllama();
  } catch {
    // best-effort
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

  // Allow packaging to proceed even if Tesseract cannot be staged in restricted environments.
  // The app has OCR fallbacks (e.g., tesseract.js / vision OCR). Set STRATOSORT_STRICT_TESSERACT=1
  // to make this step mandatory.
  const strictTesseract = process.env.STRATOSORT_STRICT_TESSERACT === '1';

  log.info('→ Staging Tesseract runtime...');
  ensureDir(tesseractDir);

  // First: if system Tesseract exists, copy it instead of running an installer.
  // This avoids Windows policies that block executing downloaded installers (EACCES/AppLocker).
  if (process.platform === 'win32') {
    try {
      const whereRes = await asyncSpawn('where', ['tesseract.exe'], {
        timeout: 5000,
        windowsHide: true,
        shell: false
      });
      if (whereRes.status === 0 && whereRes.stdout) {
        const candidates = whereRes.stdout
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        const first = candidates.find((p) => fs.existsSync(p));
        if (first) {
          const sourceDir = path.dirname(first);
          log.info(`→ Using system Tesseract from: ${sourceDir}`);
          // Copy the whole install directory so DLLs + tessdata come along.
          // Node 18+ supports fs.cpSync.
          fs.cpSync(sourceDir, tesseractDir, { recursive: true, force: true });
          if (fs.existsSync(tesseractExe)) {
            const ok = await verifyBinary(tesseractExe, ['--version']);
            if (ok) return;
            log.warn('⚠ Copied system Tesseract but binary did not run; falling back to installer');
          } else {
            log.warn(
              '⚠ System Tesseract copy did not produce expected exe; falling back to installer'
            );
          }
        }
      }
    } catch (e) {
      log.warn(`⚠ Could not detect/copy system Tesseract: ${e?.message || e}`);
    }
  }

  // Fallback: attempt to download and run the installer
  await ensureDownloaded(cfg.url, installerPath, cfg.sha256);

  const args = [...(cfg.install?.silentArgs || [])];
  if (cfg.install?.dirArg) {
    // Inno Setup /DIR= should not contain embedded quotes when using shell: false
    args.push(`${cfg.install.dirArg}${tesseractDir}`);
  }

  const res = await runInstallerFromTemp(installerPath, args, {
    timeout: 10 * 60 * 1000,
    windowsHide: true,
    shell: false
  });
  if (res.status !== 0) {
    // If execution is blocked by OS policy, don't block packaging unless strict.
    if (res?.error?.code === 'EACCES' && !strictTesseract) {
      log.warn(
        '⚠ Tesseract installer could not be executed (EACCES). Continuing without bundled Tesseract.'
      );
      return;
    }
    throw new Error(formatSpawnFailure('Tesseract installer failed', res));
  }

  if (!fs.existsSync(tesseractExe)) {
    const found = findFileRecursive(tesseractDir, cfg.exe, 4);
    if (found) {
      fs.copyFileSync(found, tesseractExe);
    }
  }

  if (!fs.existsSync(tesseractExe)) {
    if (!strictTesseract) {
      log.warn('⚠ Tesseract binary not found after install. Continuing without bundled Tesseract.');
      return;
    }
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

  // Build-time hygiene: don't ship transient download caches inside assets/runtime.
  // The packaged app does not write into this directory; caches here just bloat installers.
  try {
    if (fs.existsSync(cacheRoot)) {
      fs.rmSync(cacheRoot, { recursive: true, force: true });
    }
  } catch {
    // best-effort
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    log.error(`[runtime] Failed: ${err?.message || err}`);
    process.exit(1);
  });
