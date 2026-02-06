const path = require('path');
const fs = require('fs');
const { app } = require('electron');

// Resolve app root reliably in both dev (webpack bundles to dist/) and packaged builds.
// Avoids __dirname which points to dist/ after webpack bundling.
function _getAppRoot() {
  try {
    const appPath = app.getAppPath();
    if (appPath.endsWith('src/main') || appPath.endsWith('src\\main')) {
      return path.resolve(appPath, '../..');
    }
    return appPath;
  } catch {
    return process.cwd();
  }
}

function resolveRuntimeRoot() {
  const override = process.env.STRATOSORT_RUNTIME_DIR;
  if (override && override.trim()) {
    return override.trim();
  }

  const resourcesCandidate = process.resourcesPath
    ? path.join(process.resourcesPath, 'assets', 'runtime')
    : null;
  const devCandidate = path.join(_getAppRoot(), 'assets', 'runtime');

  if (
    resourcesCandidate &&
    typeof fs.existsSync === 'function' &&
    fs.existsSync(resourcesCandidate)
  ) {
    return resourcesCandidate;
  }

  return devCandidate;
}

function resolveRuntimePath(...segments) {
  return path.join(resolveRuntimeRoot(), ...segments);
}

module.exports = {
  resolveRuntimeRoot,
  resolveRuntimePath
};
