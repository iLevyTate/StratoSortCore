const path = require('path');
const fs = require('fs').promises;
const { app } = require('electron');
const { logger } = require('../../shared/logger');

logger.setContext('ChromaSpawnUtils');
const {
  findPythonLauncherAsync,
  checkPythonVersionAsync,
  checkChromaExecutableAsync,
  asyncSpawn,
  hasPythonModuleAsync
} = require('./asyncSpawnUtils');
const { getChromaDbBinName, shouldUseShell } = require('../../shared/platformUtils');

/**
 * Utility functions for ChromaDB spawning
 * Extracted from simple-main.js to avoid circular dependencies
 */

/**
 * Get node_modules/.bin path, handling both development and packaged contexts
 */
function getNodeModulesBinPath() {
  if (app.isPackaged) {
    // In packaged app: node_modules/.bin is unpacked to app.asar.unpacked
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '.bin');
  }
  // Development: use relative path from __dirname
  return path.resolve(__dirname, '../../../node_modules/.bin');
}

async function resolveChromaCliExecutable() {
  try {
    // Use cross-platform utility for chromadb binary name
    const binName = getChromaDbBinName();
    const nodeModulesPath = getNodeModulesBinPath();
    const cliPath = path.join(nodeModulesPath, binName);

    // Validate path is within node_modules (prevent traversal)
    const normalizedCliPath = path.normalize(cliPath);
    const normalizedNodeModules = path.normalize(nodeModulesPath);

    if (!normalizedCliPath.startsWith(normalizedNodeModules)) {
      logger.error('[ChromaDB] Potential path traversal detected:', cliPath);
      return null;
    }

    try {
      await fs.access(normalizedCliPath);
      return normalizedCliPath;
    } catch {
      return null;
    }
  } catch (error) {
    logger.warn('[ChromaDB] Failed to resolve local CLI executable:', error?.message || error);
  }
  return null;
}

async function resolveChromaFromPythonUserScripts() {
  const pythonLauncher = await findPythonLauncherAsync();
  if (!pythonLauncher) return null;

  // Ask Python for likely script directories. For pip --user installs on Windows,
  // chroma.exe commonly ends up in the user base Scripts directory (which may differ
  // from sysconfig's "scripts" path, especially with Microsoft Store Python).
  const result = await asyncSpawn(
    pythonLauncher.command,
    [
      ...pythonLauncher.args,
      '-c',
      [
        // NOTE: This must be valid Python (newlines + indentation). We cannot rely on semicolon-joining
        // because `def/try/except/for` blocks require real newlines.
        'import os, sys, sysconfig, site',
        'paths = []',
        '',
        'def add(p):',
        '    p = (p or "").strip()',
        '    if p and p not in paths:',
        '        paths.append(p)',
        '',
        'add(sysconfig.get_path("scripts"))',
        'try:',
        '    ub = site.getuserbase()',
        'except Exception:',
        '    ub = ""',
        '',
        'add(os.path.join(ub, "Scripts"))',
        // Microsoft Store Python puts --user entrypoints under:
        //   <userbase>\\PythonXY\\Scripts
        // Example:
        //   C:\\Users\\<user>\\AppData\\Local\\Packages\\PythonSoftwareFoundation.Python.3.13_*\\LocalCache\\local-packages\\Python313\\Scripts
        'add(os.path.join(ub, "Python" + str(sys.version_info[0]) + str(sys.version_info[1]), "Scripts"))',
        'add(os.path.join(ub, "bin"))',
        '',
        'for p in paths:',
        '    print(p)'
      ].join('\n')
    ],
    {
      timeout: 3000,
      windowsHide: true,
      // Important: do NOT use a shell here.
      // On Windows, `shell: true` can interfere with passing `py -3 -c "<code>"` correctly,
      // which results in empty output and prevents us from finding `chroma.exe`.
      shell: false
    }
  );

  const output = (result.stdout || result.stderr || '').toString().trim();
  if (!output) return null;

  const scriptsDirs = output
    .split(/\r?\n/g)
    .map((s) => s.trim())
    .filter(Boolean);

  const exeName = process.platform === 'win32' ? 'chroma.exe' : 'chroma';

  for (const scriptsDir of scriptsDirs) {
    const candidate = path.join(scriptsDir, exeName);

    // Validate path traversal safety (must remain under scripts dir).
    const normalizedCandidate = path.normalize(candidate);
    const normalizedScriptsDir = path.normalize(scriptsDir);
    if (!normalizedCandidate.startsWith(normalizedScriptsDir)) {
      logger.warn('[ChromaDB] Potential path traversal in python scripts resolution', {
        scriptsDir,
        candidate
      });
      continue;
    }

    try {
      await fs.access(normalizedCandidate);
      return normalizedCandidate;
    } catch {
      // try next directory
    }
  }

  return null;
}

function splitCommandLine(value) {
  if (!value || typeof value !== 'string') return [];
  const matches = value.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  return matches.map((token) => token.replace(/^"(.*)"$/, '$1'));
}

async function findPythonLauncher() {
  // Use async version to prevent UI blocking
  return await findPythonLauncherAsync();
}

async function buildChromaSpawnPlan(config) {
  logger.info('[ChromaDB] Building spawn plan...', {
    dbPath: config.dbPath,
    host: config.host,
    port: config.port
  });

  // 1. Check for custom command override
  if (process.env.CHROMA_SERVER_COMMAND) {
    const parts = splitCommandLine(process.env.CHROMA_SERVER_COMMAND);
    if (parts.length > 0) {
      logger.info('[ChromaDB] Using custom command from CHROMA_SERVER_COMMAND env var');
      return {
        command: parts[0],
        args: parts.slice(1),
        source: 'custom-command',
        options: { windowsHide: true }
      };
    }
  }
  logger.debug('[ChromaDB] No custom CHROMA_SERVER_COMMAND set, checking other methods...');

  // 2. Check for local CLI in node_modules
  const localCli = await resolveChromaCliExecutable();
  if (localCli) {
    logger.info('[ChromaDB] Found local CLI executable in node_modules', { path: localCli });
    return {
      command: localCli,
      args: ['run', '--path', config.dbPath, '--host', config.host, '--port', String(config.port)],
      source: 'local-cli',
      options: { windowsHide: true }
    };
  }
  logger.debug('[ChromaDB] No local CLI found in node_modules/.bin');

  // 3. Check Python user scripts directory (pip --user installs)
  // If chroma was installed via pip --user, it might not be on PATH.
  // Resolve it from the Python user scripts directory.
  const pythonScriptsChroma = await resolveChromaFromPythonUserScripts();
  if (pythonScriptsChroma) {
    logger.info('[ChromaDB] Found chroma executable in Python scripts directory', {
      path: pythonScriptsChroma,
      note: 'pip --user install detected'
    });
    return {
      command: pythonScriptsChroma,
      args: ['run', '--path', config.dbPath, '--host', config.host, '--port', String(config.port)],
      source: 'python-scripts-chroma',
      // Absolute path to an .exe: do not use a shell (avoids quoting/escaping issues).
      options: { windowsHide: true, shell: false }
    };
  }
  logger.debug('[ChromaDB] No chroma.exe found in Python scripts directories');

  // 4. Check for system-installed chroma executable (ChromaDB 1.0.x+)
  // This is the preferred method for newer ChromaDB versions
  // System-installed chroma binary is just 'chroma' on all platforms
  const chromaExecutable = 'chroma';
  const hasChroma = await checkChromaExecutableAsync();

  if (hasChroma) {
    logger.info('[ChromaDB] Found system chroma executable on PATH');
    return {
      command: chromaExecutable,
      args: ['run', '--path', config.dbPath, '--host', config.host, '--port', String(config.port)],
      source: 'system-chroma',
      options: {
        windowsHide: true,
        // Use cross-platform shell detection
        shell: shouldUseShell()
      }
    };
  }
  logger.debug('[ChromaDB] No system chroma executable found on PATH');

  // 5. Fallback to python -m chromadb for users who have the module but no CLI
  // This addresses the documented behavior and supports pip --user installs
  const pythonLauncher = await findPythonLauncherAsync();
  if (pythonLauncher) {
    logger.debug('[ChromaDB] Checking for chromadb Python module...', {
      pythonCommand: pythonLauncher.command,
      pythonArgs: pythonLauncher.args
    });

    // FIX: Verify Python version meets ChromaDB requirements (3.9+)
    const versionCheck = await checkPythonVersionAsync(pythonLauncher, 3, 9);
    if (!versionCheck.valid) {
      logger.warn('[ChromaDB] Python version check failed:', {
        version: versionCheck.version,
        error: versionCheck.error
      });
      // Continue to fallback - user may have chroma CLI installed separately
    } else {
      const hasChromaModule = await hasPythonModuleAsync('chromadb');
      if (hasChromaModule) {
        logger.info(
          '[ChromaDB] Using python -m chromadb fallback (module installed but CLI not in PATH)',
          { pythonVersion: versionCheck.version }
        );
        return {
          command: pythonLauncher.command,
          args: [
            ...pythonLauncher.args,
            '-m',
            'chromadb.cli.cli',
            'run',
            '--path',
            config.dbPath,
            '--host',
            config.host,
            '--port',
            String(config.port)
          ],
          source: 'python-module',
          options: { windowsHide: true, shell: false }
        };
      }
      logger.debug('[ChromaDB] chromadb Python module not installed');
    }
  } else {
    logger.warn('[ChromaDB] Python launcher not found - cannot use python -m chromadb fallback');
  }

  logger.warn('[ChromaDB] No viable spawn method found. ChromaDB features will be unavailable.', {
    troubleshooting: [
      'Install ChromaDB: pip install chromadb',
      'Ensure Python 3 is installed and on PATH',
      'On Windows, try: py -3 -m pip install --user chromadb',
      'Or set CHROMA_SERVER_URL to use an external ChromaDB server'
    ]
  });

  return null;
}

module.exports = {
  buildChromaSpawnPlan,
  resolveChromaCliExecutable,
  findPythonLauncher
};
