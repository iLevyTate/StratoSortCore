const { spawnSync } = require('child_process');

function parseBool(value) {
  return String(value).toLowerCase() === 'true';
}

function run(cmd, args, options = {}) {
  return spawnSync(cmd, args, { stdio: 'inherit', ...options });
}

function runQuiet(cmd, args, options = {}) {
  return spawnSync(cmd, args, { stdio: 'ignore', ...options });
}

function hasTesseractBinary() {
  const isWindows = process.platform === 'win32';
  const lookupCmd = isWindows ? 'where' : 'which';
  const result = runQuiet(lookupCmd, ['tesseract'], {
    shell: isWindows
  });
  return result.status === 0;
}

function installOnWindows() {
  // Prefer winget if available
  const wingetCheck = runQuiet('winget', ['--version'], { shell: true });
  if (wingetCheck.status === 0) {
    console.log('[tesseract] Installing via winget...');
    return run(
      'winget',
      [
        'install',
        '--id',
        'Tesseract-OCR.Tesseract',
        '-e',
        '--accept-source-agreements',
        '--accept-package-agreements'
      ],
      { shell: true }
    ).status;
  }

  // Fallback to Chocolatey if available
  const chocoCheck = runQuiet('choco', ['-v'], { shell: true });
  if (chocoCheck.status === 0) {
    console.log('[tesseract] Installing via Chocolatey...');
    return run('choco', ['install', 'tesseract', '-y'], { shell: true }).status;
  }

  console.warn('[tesseract] No supported package manager found (winget/choco).');
  return 1;
}

function installOnMac() {
  const brewCheck = runQuiet('brew', ['--version']);
  if (brewCheck.status !== 0) {
    console.warn('[tesseract] Homebrew not found. Skipping auto-install.');
    return 1;
  }
  console.log('[tesseract] Installing via Homebrew...');
  return run('brew', ['install', 'tesseract']).status;
}

function installOnLinux() {
  // Best-effort with apt-get if available
  const aptCheck = runQuiet('apt-get', ['--version']);
  if (aptCheck.status !== 0) {
    console.warn('[tesseract] apt-get not found. Skipping auto-install.');
    return 1;
  }
  console.log('[tesseract] Installing via apt-get...');
  const update = run('sudo', ['apt-get', 'update']);
  if (update.status !== 0) return update.status;
  return run('sudo', ['apt-get', 'install', '-y', 'tesseract-ocr']).status;
}

function main({ env = process.env } = {}) {
  const isCI = parseBool(env.CI);
  const skipSetup = parseBool(env.SKIP_TESSERACT_SETUP) || parseBool(env.SKIP_APP_DEPS);

  if (isCI || skipSetup) {
    console.log('[tesseract] Skipping setup (CI or SKIP_TESSERACT_SETUP)');
    return 0;
  }

  if (env.TESSERACT_PATH && env.TESSERACT_PATH.trim()) {
    console.log('[tesseract] TESSERACT_PATH is set, skipping auto-install');
    return 0;
  }

  if (hasTesseractBinary()) {
    console.log('[tesseract] Tesseract already available');
    return 0;
  }

  let status = 1;
  if (process.platform === 'win32') {
    status = installOnWindows();
  } else if (process.platform === 'darwin') {
    status = installOnMac();
  } else {
    status = installOnLinux();
  }

  if (status !== 0) {
    console.warn('[tesseract] Auto-install failed or was skipped.');
    console.warn('[tesseract] Install manually or set TESSERACT_PATH.');
    return 1;
  }

  console.log('[tesseract] Installation complete');
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main };
