#!/usr/bin/env node

/**
 * Developer helper: ensure ChromaDB (Python module) is installed.
 *
 * Goals:
 * - Best-effort in postinstall (should not fail npm install)
 * - Non-interactive and cross-platform
 *
 * Usage:
 * - node scripts/setup-chromadb.js --auto --ci-skip
 * - node scripts/setup-chromadb.js --check
 */

const http = require('http');
const https = require('https');
const { asyncSpawn, checkPythonVersionAsync } = require('../src/main/utils/asyncSpawnUtils');

// Simple color output without external dependencies
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

const chalk = {
  red: (text) => `${colors.red}${text}${colors.reset}`,
  green: (text) => `${colors.green}${text}${colors.reset}`,
  yellow: (text) => `${colors.yellow}${text}${colors.reset}`,
  cyan: (text) => `${colors.cyan}${text}${colors.reset}`,
  gray: (text) => `${colors.gray}${text}${colors.reset}`,
  bold: {
    green: (text) => `${colors.bold}${colors.green}${text}${colors.reset}`,
    cyan: (text) => `${colors.bold}${colors.cyan}${text}${colors.reset}`,
    red: (text) => `${colors.bold}${colors.red}${text}${colors.reset}`
  }
};

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  return {
    auto: args.has('--auto'),
    check: args.has('--check'),
    ciSkip: args.has('--ci-skip')
  };
}

async function tryCmd(cmd, args, timeout = 5000, options = {}) {
  const res = await asyncSpawn(cmd, args, {
    timeout,
    windowsHide: true,
    shell: process.platform === 'win32',
    ...options
  });
  return res;
}

async function findPythonLauncher() {
  const candidates =
    process.platform === 'win32'
      ? [
          { command: 'py', args: ['-3'] },
          { command: 'python3', args: [] },
          { command: 'python', args: [] }
        ]
      : [
          { command: 'python3', args: [] },
          { command: 'python', args: [] }
        ];

  for (const c of candidates) {
    const res = await tryCmd(c.command, [...c.args, '--version'], 3000);
    if (res.status === 0) return c;
  }
  return null;
}

async function isChromaInstalled(python) {
  const res = await tryCmd(
    python.command,
    [
      ...python.args,
      '-c',
      "import chromadb; import sys; sys.stdout.write(getattr(chromadb,'__version__','unknown'))"
    ],
    5000
  );
  if (res.status === 0) {
    return { installed: true, version: (res.stdout || '').trim() || 'unknown' };
  }
  return { installed: false, version: null };
}

async function pipInstallChroma(
  python,
  { upgradePip = true, userInstall = true, log = console } = {}
) {
  if (upgradePip) {
    log.log(chalk.gray('[chromadb] Upgrading pip...'));
    await tryCmd(
      python.command,
      [...python.args, '-m', 'pip', 'install', '--upgrade', 'pip'],
      5 * 60 * 1000
    )
      .then(() => {})
      .catch(() => {});
  }

  const args = [
    ...python.args,
    '-m',
    'pip',
    'install',
    ...(userInstall ? ['--user'] : []),
    'chromadb'
  ];

  log.log(chalk.cyan('[chromadb] Running: pip install chromadb...'));
  const res = await tryCmd(python.command, args, 10 * 60 * 1000);

  // Provide helpful error messages for common failures
  if (res.status !== 0) {
    const stderr = (res.stderr || '').toLowerCase();

    if (stderr.includes('permission denied') || stderr.includes('access is denied')) {
      log.log(chalk.yellow('\n[chromadb] Permission denied during installation.'));
      log.log(chalk.gray('  Try one of these solutions:'));
      log.log(chalk.gray('  • Run as Administrator (Windows)'));
      log.log(chalk.gray('  • Use a virtual environment: python -m venv .venv'));
      log.log(chalk.gray('  • Install with --user flag (already attempted)'));
    } else if (stderr.includes('no matching distribution') || stderr.includes('could not find')) {
      log.log(chalk.yellow('\n[chromadb] Package not found or incompatible Python version.'));
      log.log(chalk.gray('  ChromaDB requires Python 3.9 or higher.'));
      log.log(chalk.gray('  Check your Python version: python --version'));
    } else if (stderr.includes('network') || stderr.includes('connection')) {
      log.log(chalk.yellow('\n[chromadb] Network error during installation.'));
      log.log(chalk.gray('  Check your internet connection and try again.'));
    } else if (res.stderr) {
      log.log(chalk.yellow(`\n[chromadb] pip install failed: ${res.stderr.slice(0, 200)}`));
    }
  }

  return res.status === 0;
}

async function checkExternalChroma(url) {
  let baseUrl;
  try {
    baseUrl = new URL(url);
  } catch {
    return false;
  }
  const client = baseUrl.protocol === 'https:' ? https : http;
  const endpoints = ['/api/v2/heartbeat', '/api/v1/heartbeat', '/api/v1'];

  for (const endpoint of endpoints) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await new Promise((resolve) => {
      const req = client.get(new URL(endpoint, baseUrl), (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(1500, () => {
        try {
          req.destroy();
        } catch {
          // ignore
        }
        resolve(false);
      });
    });
    if (ok) return true;
  }
  return false;
}

async function checkChromaExecutable(python) {
  // 1. Check if 'chroma' is available on PATH
  const candidates = process.platform === 'win32' ? ['chroma.exe', 'chroma'] : ['chroma'];

  for (const exe of candidates) {
    try {
      const res = await tryCmd(exe, ['--help'], 3000);
      if (res.status === 0) return true;
    } catch (e) {
      // Ignore
    }
  }

  // 2. Check Python script directories
  const script = [
    'import os, sys, sysconfig, site',
    'paths = [sysconfig.get_path("scripts")]',
    'try:',
    '    ub = site.getuserbase()',
    '    if ub:',
    '        paths.append(os.path.join(ub, "Scripts"))',
    '        paths.append(os.path.join(ub, "bin"))',
    '        # Handle Microsoft Store Python paths',
    '        paths.append(os.path.join(ub, "Python" + str(sys.version_info[0]) + str(sys.version_info[1]), "Scripts"))',
    'except:',
    '    pass',
    'print("\\n".join(paths))'
  ].join('\n');

  // FIX: Use shell: false to avoid quoting issues on Windows when passing complex python scripts
  const res = await tryCmd(python.command, [...python.args, '-c', script], 3000, { shell: false });

  if (res.status === 0) {
    const paths = (res.stdout || '').split(/\r?\n/).filter((p) => p.trim());
    const exeName = process.platform === 'win32' ? 'chroma.exe' : 'chroma';
    const fs = require('fs');
    const path = require('path');

    for (const dir of paths) {
      const candidate = path.join(dir.trim(), exeName);
      try {
        if (fs.existsSync(candidate)) return true;
      } catch {
        // ignore
      }
    }
  }

  return false;
}

async function main({
  argv = process.argv,
  env = process.env,
  log = console,
  deps = {
    checkExternalChroma,
    findPythonLauncher,
    isChromaInstalled,
    pipInstallChroma,
    checkChromaExecutable
  }
} = {}) {
  const { auto, check, ciSkip } = parseArgs(argv);

  if (ciSkip && env.CI) {
    log.log(chalk.gray('[chromadb] CI detected, skipping'));
    return 0;
  }

  log.log(chalk.bold.cyan('\nChromaDB Setup (Developer)'));

  // If an external ChromaDB is configured (e.g. Docker), just verify reachability.
  if (env.CHROMA_SERVER_URL) {
    const reachable = await deps.checkExternalChroma(env.CHROMA_SERVER_URL);
    if (reachable) {
      log.log(chalk.green(`✓ External ChromaDB reachable — ${env.CHROMA_SERVER_URL}`));
      return 0;
    }

    log.log(chalk.yellow(`⚠ External ChromaDB not reachable — ${env.CHROMA_SERVER_URL}`));
    // In check mode we should signal failure; in auto mode we keep best-effort behavior.
    return check && !auto ? 1 : 0;
  }

  const python = await deps.findPythonLauncher();
  if (!python) {
    log.log(
      chalk.yellow('\n[chromadb] Python 3 not found. ChromaDB features will be unavailable.')
    );
    log.log(chalk.gray('\nTo install Python 3:'));
    if (process.platform === 'win32') {
      log.log(chalk.gray('  • Download from https://python.org/downloads'));
      log.log(chalk.gray('  • Or install from Microsoft Store: "Python 3.11"'));
      log.log(chalk.gray('  • Ensure "Add Python to PATH" is checked during installation'));
      log.log(chalk.gray('\nAfter installing, run: py -3 --version'));
    } else if (process.platform === 'darwin') {
      log.log(chalk.gray('  • Install via Homebrew: brew install python3'));
      log.log(chalk.gray('  • Or download from https://python.org/downloads'));
    } else {
      log.log(chalk.gray('  • Ubuntu/Debian: sudo apt install python3 python3-pip'));
      log.log(chalk.gray('  • Fedora: sudo dnf install python3 python3-pip'));
      log.log(chalk.gray('  • Or download from https://python.org/downloads'));
    }
    // Best-effort: do not fail npm install
    return check && !auto ? 1 : 0;
  }

  log.log(chalk.green(`✓ Found Python: ${python.command} ${python.args.join(' ')}`));

  // FIX: Verify Python version meets ChromaDB requirements (3.9+)
  const versionCheck = await checkPythonVersionAsync(python, 3, 9);
  if (!versionCheck.valid) {
    log.log(chalk.yellow(`\n[chromadb] Python version check failed: ${versionCheck.error}`));
    log.log(chalk.gray(`  Detected version: ${versionCheck.version || 'unknown'}`));
    log.log(chalk.gray('  ChromaDB requires Python 3.9 or higher'));
    log.log(chalk.gray('\nPlease install or update Python:'));
    if (process.platform === 'win32') {
      log.log(chalk.gray('  • Download Python 3.11+ from https://python.org/downloads'));
      log.log(chalk.gray('  • Or install from Microsoft Store: "Python 3.11"'));
    } else if (process.platform === 'darwin') {
      log.log(chalk.gray('  • brew upgrade python3'));
    } else {
      log.log(chalk.gray('  • Ubuntu/Debian: sudo apt install python3.11 python3.11-venv'));
    }
    return check && !auto ? 1 : 0;
  }

  log.log(chalk.green(`✓ Python version ${versionCheck.version} meets requirements (3.9+)`));

  const pre = await deps.isChromaInstalled(python);
  if (pre.installed) {
    log.log(chalk.green(`✓ ChromaDB installed (python module) — version: ${pre.version}`));
    return 0;
  }

  if (check && !auto) {
    // Check fallback before failing
    try {
      const hasExecutable = await deps.checkChromaExecutable(python);
      if (hasExecutable) {
        log.log(chalk.green(`✓ ChromaDB CLI executable found (import failed, but CLI exists)`));
        return 0;
      }
    } catch (e) {
      // Ignore
    }

    log.log(chalk.red('✗ ChromaDB is not installed'));
    return 1;
  }

  if (!auto) {
    log.log(
      chalk.yellow(
        '[chromadb] Not installed. Run `node scripts/setup-chromadb.js --auto` (or `npm run setup:chromadb`).'
      )
    );
    return 0;
  }

  log.log(chalk.cyan('[chromadb] Installing via pip (user install)…'));
  const ok = await deps.pipInstallChroma(python, { upgradePip: true, userInstall: true, log });
  if (!ok) {
    log.log(
      chalk.yellow(
        '\n[chromadb] Installation failed. See error messages above for troubleshooting steps.'
      )
    );
    return 0;
  }

  const post = await deps.isChromaInstalled(python);
  if (post.installed) {
    log.log(chalk.bold.green(`✓ ChromaDB installed — version: ${post.version}`));
    return 0;
  }

  // Fallback: Check if chroma executable exists in Scripts folder (common on Windows)
  try {
    const hasExecutable = await deps.checkChromaExecutable(python);
    if (hasExecutable) {
      log.log(chalk.bold.green(`✓ ChromaDB CLI executable found (import failed, but CLI exists)`));
      return 0;
    }
  } catch (e) {
    // Ignore error
  }

  log.log(
    chalk.yellow(
      '[chromadb] Install completed but import still failed. Try restarting your shell or verify your Python environment.'
    )
  );
  return 0;
}

if (require.main === module) {
  main().then(
    (code) => {
      // eslint-disable-next-line no-process-exit
      process.exit(code);
    },
    (err) => {
      // Best-effort: don't fail developer install
      console.error(chalk.red(`[chromadb] Unexpected error: ${err?.message || err}`));
      // eslint-disable-next-line no-process-exit
      process.exit(0);
    }
  );
}

module.exports = {
  main,
  parseArgs,
  // export internals for unit tests
  checkExternalChroma,
  findPythonLauncher,
  isChromaInstalled,
  pipInstallChroma,
  checkChromaExecutable
};
