/* eslint-disable no-console */
const { spawnSync } = require('child_process');

function parseBool(value) {
  return String(value).toLowerCase() === 'true';
}

function main(
  { env = process.env, platform = process.platform, spawnSyncImpl = spawnSync, log = console } = {
    env: process.env,
    platform: process.platform,
    spawnSyncImpl: spawnSync,
    log: console
  }
) {
  const isCI = parseBool(env.CI);
  const skipAppDeps = parseBool(env.SKIP_APP_DEPS);

  // Only required step: rebuild native modules (e.g. Sharp) for Electron's Node version.
  // The app's UI (AiDependenciesModal) handles Ollama/ChromaDB installation on first launch.
  if (!isCI && !skipAppDeps) {
    log.log('[postinstall] Rebuilding native modules for Electron...');
    const result = spawnSyncImpl('npx', ['--no', 'electron-builder', 'install-app-deps'], {
      stdio: 'inherit',
      shell: platform === 'win32'
    });

    if (result.status !== 0) {
      log.warn('[postinstall] Native module rebuild had issues (non-fatal)');
    } else {
      log.log('[postinstall] Native modules ready');
    }
  }

  // Run setup scripts (best effort)
  const setupScripts = ['scripts/setup-ollama.js', 'scripts/setup-chromadb.js'];
  for (const script of setupScripts) {
    try {
      // Use node to run the script
      const result = spawnSyncImpl(process.execPath, [script], {
        stdio: 'inherit',
        env: { ...env, FORCE_COLOR: '1' }
      });
      if (result.status !== 0) {
        log.warn(`[postinstall] ${script} failed (non-fatal)`);
      }
    } catch (e) {
      log.warn(`[postinstall] Failed to run ${script}: ${e.message}`);
    }
  }

  log.log('\n[StratoSort] Setup complete!');
  log.log('  Run: npm run dev');
  log.log('  The app will guide you through AI setup on first launch.\n');

  return 0;
}

if (require.main === module) {
  // eslint-disable-next-line no-process-exit
  process.exit(main());
}

module.exports = { main };
