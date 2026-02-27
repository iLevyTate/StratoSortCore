#!/usr/bin/env node

/**
 * Release preflight runner.
 * Runs native module verification and platform-specific packaging checks
 * so issues are caught before creating a release tag.
 */

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const releaseBuildDir = path.join(repoRoot, 'release', 'build');
const nodeCmd = process.execPath;
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function parseArgs(argv) {
  const flags = new Set();
  const values = {};

  argv.forEach((arg) => {
    if (!arg.startsWith('--')) return;
    const [rawKey, rawValue] = arg.slice(2).split('=');
    if (rawValue === undefined) {
      flags.add(rawKey);
    } else {
      values[rawKey] = rawValue;
    }
  });

  return { flags, values };
}

function getNpmConfigValue(name) {
  const envKey = `npm_config_${name.replace(/-/g, '_')}`;
  const value = process.env[envKey];
  return value == null ? null : String(value);
}

function hasFlag(name, flags) {
  if (flags.has(name)) return true;
  const envValue = getNpmConfigValue(name);
  if (envValue == null) return false;
  return envValue !== 'false' && envValue !== '0';
}

function getValue(name, values) {
  if (values[name] != null) return values[name];
  return getNpmConfigValue(name);
}

function printHelp() {
  console.log(`Usage: npm run preflight:release -- [options]

Options:
  --help                Show this help output
  --dry-run             Print commands without executing them
  --skip-native         Skip native module verification
  --skip-dist           Skip distribution build and packaged artifact checks
  --dist-script=<name>  Override dist script (example: dist:win)
  --all-mac-arches      Legacy flag (mac builds are arm64-only; treated as dist:mac:arm64)

Examples:
  npm run preflight:release
  npm run preflight:release -- --dry-run
  npm run preflight:release -- --all-mac-arches
  npm run preflight:release -- --dist-script=dist:win
`);
}

function runCommand(command, args, dryRun) {
  const printable = `${command} ${args.join(' ')}`.trim();

  console.log(`\n> ${printable}`);
  if (dryRun) return;

  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env
  });

  if (result.error) {
    throw new Error(`Command execution error: ${printable} (${result.error.message})`);
  }

  if (result.status !== 0) {
    throw new Error(`Command failed: ${printable}`);
  }
}

function runNpmScript(scriptName, dryRun) {
  if (process.env.npm_execpath) {
    runCommand(nodeCmd, [process.env.npm_execpath, 'run', scriptName], dryRun);
    return;
  }
  runCommand(npmCmd, ['run', scriptName], dryRun);
}

function runPackagedArtifactVerify(platform, arch, dryRun) {
  const verifyScript = path.join('scripts', 'verify-packaged-artifacts.js');
  const args = [verifyScript, `--platform=${platform}`];
  if (arch) args.push(`--arch=${arch}`);
  runCommand(nodeCmd, args, dryRun);
}

function cleanReleaseOutput(dryRun) {
  console.log(`\n> clean release output: ${releaseBuildDir}`);
  if (dryRun) return;
  if (!fs.existsSync(releaseBuildDir)) return;

  fs.rmSync(releaseBuildDir, {
    recursive: true,
    force: true,
    maxRetries: 6,
    retryDelay: 1500
  });
}

function inferVerificationForDistScript(scriptName) {
  if (typeof scriptName !== 'string' || !scriptName.trim()) return null;
  const value = scriptName.trim().toLowerCase();

  if (value === 'dist:win' || value.includes(':win')) {
    return { platform: 'win', arch: null };
  }
  if (value === 'dist:mac:arm64' || value.includes(':mac:arm64')) {
    return { platform: 'mac', arch: 'arm64' };
  }
  if (value === 'dist:mac' || value.includes(':mac')) {
    return { platform: 'mac', arch: null };
  }

  return null;
}

function resolveDefaultDistScripts(flags, values) {
  const distScriptOverride = getValue('dist-script', values);
  if (distScriptOverride) {
    return [
      { script: distScriptOverride, verify: inferVerificationForDistScript(distScriptOverride) }
    ];
  }

  if (process.platform === 'win32') {
    return [{ script: 'dist:win', verify: { platform: 'win', arch: null } }];
  }

  if (process.platform === 'darwin') {
    if (flags.has('all-mac-arches')) {
      console.log(
        '\n--all-mac-arches is deprecated. macOS release builds are arm64-only; running dist:mac:arm64.'
      );
    }
    return [
      {
        script: 'dist:mac:arm64',
        verify: { platform: 'mac', arch: 'arm64' }
      }
    ];
  }

  if (process.platform === 'linux') {
    return [{ script: 'dist:linux', verify: null }];
  }

  throw new Error(`Unsupported platform: ${process.platform}`);
}

function run() {
  const { flags, values } = parseArgs(process.argv.slice(2));

  if (hasFlag('help', flags)) {
    printHelp();
    return;
  }

  const dryRun = hasFlag('dry-run', flags);
  const skipNative = hasFlag('skip-native', flags);
  const skipDist = hasFlag('skip-dist', flags);
  const distPlans = resolveDefaultDistScripts(flags, values);

  console.log('Release preflight starting...');

  console.log(`Platform: ${process.platform} (${process.arch})`);

  if (!skipNative) {
    runNpmScript('verify:native-modules', dryRun);
  } else {
    console.log('\nSkipping native module verification (--skip-native).');
  }

  if (!skipDist) {
    distPlans.forEach((plan) => {
      cleanReleaseOutput(dryRun);
      runNpmScript(plan.script, dryRun);
      if (plan.verify) {
        runPackagedArtifactVerify(plan.verify.platform, plan.verify.arch, dryRun);
      }
    });
  } else {
    console.log('\nSkipping dist + packaged checks (--skip-dist).');
  }

  console.log('\nRelease preflight completed successfully.');
}

try {
  run();
} catch (error) {
  console.error(`\nRelease preflight failed: ${error.message}`);
  process.exit(1);
}
