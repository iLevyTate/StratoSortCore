const path = require('path');
const fs = require('fs').promises;
const { logger } = require('../../shared/logger');

logger.setContext('ChromaSpawnUtils');
const {
  findPythonLauncherAsync,
  checkChromaExecutableAsync,
  asyncSpawn,
  hasPythonModuleAsync
} = require('./asyncSpawnUtils');
const { getChromaDbBinName, shouldUseShell } = require('../../shared/platformUtils');

/**
 * Utility functions for ChromaDB spawning
 * Extracted from simple-main.js to avoid circular dependencies
 */

async function resolveChromaCliExecutable() {
  try {
    // Use cross-platform utility for chromadb binary name
    const binName = getChromaDbBinName();
    const nodeModulesPath = path.resolve(__dirname, '../../../node_modules/.bin');
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
  if (process.env.CHROMA_SERVER_COMMAND) {
    const parts = splitCommandLine(process.env.CHROMA_SERVER_COMMAND);
    if (parts.length > 0) {
      return {
        command: parts[0],
        args: parts.slice(1),
        source: 'custom-command',
        options: { windowsHide: true }
      };
    }
  }

  const localCli = await resolveChromaCliExecutable();
  if (localCli) {
    return {
      command: localCli,
      args: ['run', '--path', config.dbPath, '--host', config.host, '--port', String(config.port)],
      source: 'local-cli',
      options: { windowsHide: true }
    };
  }

  // If chroma was installed via pip --user, it might not be on PATH.
  // Resolve it from the Python user scripts directory.
  const pythonScriptsChroma = await resolveChromaFromPythonUserScripts();
  if (pythonScriptsChroma) {
    logger.info('[ChromaDB] Found chroma executable in Python scripts directory');
    return {
      command: pythonScriptsChroma,
      args: ['run', '--path', config.dbPath, '--host', config.host, '--port', String(config.port)],
      source: 'python-scripts-chroma',
      // Absolute path to an .exe: do not use a shell (avoids quoting/escaping issues).
      options: { windowsHide: true, shell: false }
    };
  }

  // Check for system-installed chroma executable (ChromaDB 1.0.x+)
  // This is the preferred method for newer ChromaDB versions
  // System-installed chroma binary is just 'chroma' on all platforms
  const chromaExecutable = 'chroma';
  const hasChroma = await checkChromaExecutableAsync();

  if (hasChroma) {
    logger.info('[ChromaDB] Found system chroma executable');
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

  // FIX: Fallback to python -m chromadb for users who have the module but no CLI
  // This addresses the documented behavior and supports pip --user installs
  const pythonLauncher = await findPythonLauncherAsync();
  if (pythonLauncher) {
    const hasChromaModule = await hasPythonModuleAsync('chromadb');
    if (hasChromaModule) {
      logger.info('[ChromaDB] Using python -m chromadb fallback');
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
  }

  return null;
}

module.exports = {
  buildChromaSpawnPlan,
  resolveChromaCliExecutable,
  findPythonLauncher
};
