const path = require('path');
const fs = require('fs').promises;
const { logger } = require('../../shared/logger');
logger.setContext('ChromaSpawnUtils');
const {
  findPythonLauncherAsync,
  checkChromaExecutableAsync,
} = require('./asyncSpawnUtils');

/**
 * Utility functions for ChromaDB spawning
 * Extracted from simple-main.js to avoid circular dependencies
 */

async function resolveChromaCliExecutable() {
  try {
    const binName = process.platform === 'win32' ? 'chromadb.cmd' : 'chromadb';
    const nodeModulesPath = path.resolve(
      __dirname,
      '../../../node_modules/.bin',
    );
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
    logger.warn(
      '[ChromaDB] Failed to resolve local CLI executable:',
      error?.message || error,
    );
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
        options: { windowsHide: true },
      };
    }
  }

  const localCli = await resolveChromaCliExecutable();
  if (localCli) {
    return {
      command: localCli,
      args: [
        'run',
        '--path',
        config.dbPath,
        '--host',
        config.host,
        '--port',
        String(config.port),
      ],
      source: 'local-cli',
      options: { windowsHide: true },
    };
  }

  // Check for system-installed chroma executable (ChromaDB 1.0.x+)
  // This is the preferred method for newer ChromaDB versions
  const chromaExecutable = process.platform === 'win32' ? 'chroma' : 'chroma';
  const hasChroma = await checkChromaExecutableAsync();

  if (hasChroma) {
    logger.info('[ChromaDB] Found system chroma executable');
    return {
      command: chromaExecutable,
      args: [
        'run',
        '--path',
        config.dbPath,
        '--host',
        config.host,
        '--port',
        String(config.port),
      ],
      source: 'system-chroma',
      options: {
        windowsHide: true,
        shell: process.platform === 'win32', // Consistent shell usage for spawn
      },
    };
  }

  // Fallback to Python module execution (deprecated in ChromaDB 1.0.x+)
  // This won't work with ChromaDB 1.0.x but kept for backward compatibility
  const pythonLauncher = await findPythonLauncher();
  if (pythonLauncher) {
    logger.warn(
      '[ChromaDB] Attempting to use Python -m chromadb (may not work with ChromaDB 1.0.x+)',
    );
    return {
      command: pythonLauncher.command,
      args: [
        ...pythonLauncher.args,
        '-m',
        'chromadb',
        'run',
        '--path',
        config.dbPath,
        '--host',
        config.host,
        '--port',
        String(config.port),
      ],
      source: 'python',
      options: { windowsHide: true },
    };
  }

  return null;
}

module.exports = {
  buildChromaSpawnPlan,
  resolveChromaCliExecutable,
  findPythonLauncher,
};
