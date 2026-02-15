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

  // Rebuild native modules (including node-llama-cpp and sharp)
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

  // Download recommended GGUF models and vision runtime binary (best-effort).
  // In-process AI stack (node-llama-cpp + Orama) requires local model files.
  // Vision analysis requires the llama-server binary (bundled in production builds).
  const setupScripts = [
    { script: 'scripts/setup-vision-runtime.js', args: [] },
    { script: 'scripts/setup-models.js', args: ['--download'] }
  ];
  for (const { script, args } of setupScripts) {
    try {
      const result = spawnSyncImpl(process.execPath, [script, ...args], {
        stdio: 'inherit',
        env: { ...env, FORCE_COLOR: '1' }
      });
      if (result.status !== 0) {
        log.warn(
          `[postinstall] ${script} failed (non-fatal) — models can be downloaded from the app`
        );
      }
    } catch (e) {
      log.warn(`[postinstall] Failed to run ${script}: ${e.message}`);
    }
  }

  // On macOS, patch the Electron.app Info.plist so the dock label and Activity
  // Monitor show "StratoSort Core" instead of "Electron" during development.
  if (platform === 'darwin') {
    try {
      const { main: patchMac } = require('./patch-electron-mac');
      patchMac();
    } catch (e) {
      log.warn(`[postinstall] macOS Electron patch skipped: ${e.message}`);
    }
  }

  log.log('\n[StratoSort] Setup complete!');
  log.log('  Run: npm run dev');
  log.log('  The app will use local AI engine (node-llama-cpp + Orama).\n');

  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main };
