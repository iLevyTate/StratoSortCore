const { spawn } = require('child_process');
/**
 * Async utilities to replace blocking spawnSync calls
 * Prevents UI freezing during startup checks
 */

/**
 * Execute a command asynchronously with timeout protection
 * @param {string} command - Command to execute
 * @param {string[]} args - Arguments for the command
 * @param {object} options - Spawn options
 * @returns {Promise<{status: number, stdout: string, stderr: string, error?: Error}>}
 */
async function asyncSpawn(command, args = [], options = {}) {
  return new Promise((resolve) => {
    const timeout = options.timeout || 5000;
    const encoding = options.encoding || 'utf8';

    // Remove timeout from options to pass to spawn
    const spawnOptions = { ...options };
    delete spawnOptions.timeout;
    delete spawnOptions.encoding;

    let stdout = '';
    let stderr = '';
    let resolved = false;
    let timeoutId = null;

    try {
      let child;
      try {
        child = spawn(command, args, spawnOptions);
      } catch (spawnError) {
        // spawn() itself failed (command not found, etc.)
        if (!resolved) {
          resolved = true;
          resolve({
            status: null,
            stdout: '',
            stderr: '',
            error: spawnError
          });
        }
        return;
      }

      const cleanupChild = () => {
        try {
          child.stdout?.removeAllListeners();
          child.stderr?.removeAllListeners();
          child.removeAllListeners();
        } catch {
          // Non-fatal cleanup
        }
      };

      // Set up timeout
      if (timeout) {
        timeoutId = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            try {
              child.kill('SIGTERM');
            } catch {
              // Process may have already exited
            }
            cleanupChild();
            resolve({
              status: null,
              stdout,
              stderr,
              error: new Error(`Command timed out after ${timeout}ms`),
              timedOut: true
            });
          }
        }, timeout);
      }

      // Capture stdout
      if (child.stdout) {
        child.stdout.on('data', (data) => {
          if (encoding) {
            stdout += data.toString(encoding);
          } else {
            stdout += data;
          }
        });
      }

      // Capture stderr
      if (child.stderr) {
        child.stderr.on('data', (data) => {
          if (encoding) {
            stderr += data.toString(encoding);
          } else {
            stderr += data;
          }
        });
      }

      // Handle process exit
      child.on('close', (code, signal) => {
        if (!resolved) {
          resolved = true;
          if (timeoutId) clearTimeout(timeoutId);
          cleanupChild();
          resolve({
            status: code,
            stdout,
            stderr,
            signal
          });
        }
      });

      // Handle process error
      child.on('error', (error) => {
        if (!resolved) {
          resolved = true;
          if (timeoutId) clearTimeout(timeoutId);
          cleanupChild();
          resolve({
            status: null,
            stdout,
            stderr,
            error
          });
        }
      });
    } catch (error) {
      if (!resolved) {
        resolved = true;
        if (timeoutId) clearTimeout(timeoutId);
        resolve({
          status: null,
          stdout: '',
          stderr: '',
          error
        });
      }
    }
  });
}

module.exports = {
  asyncSpawn
};
