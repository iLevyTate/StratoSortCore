describe('platform utils', () => {
  let savedNavigator;

  beforeEach(() => {
    savedNavigator = global.navigator;
  });

  afterEach(() => {
    document.body.className = '';
    try {
      Object.defineProperty(global, 'navigator', {
        value: savedNavigator,
        configurable: true,
        writable: true
      });
    } catch {
      // Restore failed; not critical for cleanup
    }
  });

  test('joinPath and normalizePath on Linux use forward slashes', () => {
    jest.resetModules();
    document.body.className = '';
    Object.defineProperty(global, 'navigator', {
      value: { userAgentData: { platform: 'Linux' }, platform: 'Linux' },
      configurable: true,
      writable: true
    });

    let mod;
    jest.isolateModules(() => {
      mod = require('../src/renderer/utils/platform');
    });
    const { joinPath, normalizePath, applyPlatformClass } = mod;

    expect(joinPath('/usr', 'local/bin')).toBe('/usr/local/bin');
    expect(normalizePath('/usr//local///bin')).toBe('/usr/local/bin');
    expect(applyPlatformClass()).toBe('platform-linux');
    expect(document.body.classList.contains('platform-linux')).toBe(true);
  });

  test('joinPath and normalizePath on Windows preserve separators', () => {
    jest.resetModules();
    document.body.className = '';
    Object.defineProperty(global, 'navigator', {
      value: { userAgentData: { platform: 'Windows' }, platform: 'Windows' },
      configurable: true,
      writable: true
    });

    let mod;
    jest.isolateModules(() => {
      mod = require('../src/renderer/utils/platform');
    });
    const { joinPath, normalizePath, applyPlatformClass } = mod;

    expect(joinPath('C:\\\\Users', 'Alice/Docs')).toBe('C:\\Users\\Alice\\Docs');
    const normalized = normalizePath('\\\\\\\\server//share\\\\folder');
    expect(normalized.startsWith('\\\\')).toBe(true);
    expect(normalized.replace(/^\\\\+/, '\\\\')).toBe('\\\\server\\share\\folder');
    expect(applyPlatformClass()).toBe('platform-win32');
    expect(document.body.classList.contains('platform-win32')).toBe(true);
  });
});
/**
 * Tests for Platform Utilities
 * Tests cross-platform utilities
 */

const path = require('path');

describe('platformUtils', () => {
  let platformUtils;

  beforeEach(() => {
    jest.resetModules();
    platformUtils = require('../src/shared/platformUtils');
  });

  describe('platform detection', () => {
    test('exports PLATFORM', () => {
      expect(platformUtils.PLATFORM).toBe(process.platform);
    });

    test('exports isWindows', () => {
      expect(platformUtils.isWindows).toBe(process.platform === 'win32');
    });

    test('exports isMacOS', () => {
      expect(platformUtils.isMacOS).toBe(process.platform === 'darwin');
    });

    test('exports isLinux', () => {
      expect(platformUtils.isLinux).toBe(process.platform === 'linux');
    });

    test('exports isUnix', () => {
      const expected = process.platform === 'darwin' || process.platform === 'linux';
      expect(platformUtils.isUnix).toBe(expected);
    });
  });

  describe('getNpmCommand', () => {
    test('returns correct npm command for current platform', () => {
      const expected = platformUtils.isWindows ? 'npm.cmd' : 'npm';
      expect(platformUtils.getNpmCommand()).toBe(expected);
    });
  });

  describe('getNvidiaSmiCommand', () => {
    test('returns correct nvidia-smi command for current platform', () => {
      const expected = platformUtils.isWindows ? 'nvidia-smi.exe' : 'nvidia-smi';
      expect(platformUtils.getNvidiaSmiCommand()).toBe(expected);
    });
  });

  describe('getSleepCommand', () => {
    test('returns command with cmd and args', () => {
      const result = platformUtils.getSleepCommand(5);
      expect(result).toHaveProperty('cmd');
      expect(result).toHaveProperty('args');
    });

    test('returns correct sleep command for current platform', () => {
      const result = platformUtils.getSleepCommand(5);
      const expected = platformUtils.isWindows ? 'timeout' : 'sleep';
      expect(result.cmd).toBe(expected);
    });
  });

  describe('getKillCommand', () => {
    test('returns command with cmd and args', () => {
      const result = platformUtils.getKillCommand(1234);
      expect(result).toHaveProperty('cmd');
      expect(result).toHaveProperty('args');
    });

    test('returns correct kill command for current platform', () => {
      const result = platformUtils.getKillCommand(1234);
      const expected = platformUtils.isWindows ? 'taskkill' : 'kill';
      expect(result.cmd).toBe(expected);
    });

    test('includes force flag for current platform', () => {
      const result = platformUtils.getKillCommand(1234, true);
      const expectedFlag = platformUtils.isWindows ? '/f' : '-KILL';
      expect(result.args).toContain(expectedFlag);
    });
  });

  describe('getSpawnOptions', () => {
    test('returns object with windowsHide', () => {
      const result = platformUtils.getSpawnOptions();
      expect(result.windowsHide).toBe(true);
    });

    test('defaults to shell false', () => {
      const result = platformUtils.getSpawnOptions();
      expect(result.shell).toBe(false);
    });

    test('respects forceShell option', () => {
      const result = platformUtils.getSpawnOptions({ forceShell: true });
      expect(result.shell).toBe(true);
    });
  });

  describe('getShortcutModifier', () => {
    test('returns Cmd for macOS', () => {
      if (platformUtils.isMacOS) {
        expect(platformUtils.getShortcutModifier()).toBe('Cmd');
      }
    });

    test('returns Ctrl for Windows/Linux', () => {
      if (!platformUtils.isMacOS) {
        expect(platformUtils.getShortcutModifier()).toBe('Ctrl');
      }
    });
  });

  describe('getQuitAccelerator', () => {
    test('returns accelerator string', () => {
      const result = platformUtils.getQuitAccelerator();
      expect(typeof result).toBe('string');
      expect(result).toContain('+');
      expect(result).toContain('Q');
    });
  });

  describe('getHomeDir', () => {
    test('returns home directory', () => {
      const result = platformUtils.getHomeDir();
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('getPathSeparator', () => {
    test('returns correct separator', () => {
      expect(platformUtils.getPathSeparator()).toBe(path.sep);
    });
  });

  describe('normalizePath', () => {
    test('normalizes path', () => {
      const result = platformUtils.normalizePath('a/b/../c');
      expect(result).toBe(path.normalize('a/b/../c'));
    });
  });

  describe('cross-platform utilities exports', () => {
    test('exports crossSpawn', () => {
      expect(typeof platformUtils.crossSpawn).toBe('function');
    });

    test('exports getExecutableName', () => {
      expect(typeof platformUtils.getExecutableName).toBe('function');
    });

    test('exports getPythonCandidates', () => {
      expect(typeof platformUtils.getPythonCandidates).toBe('function');
    });

    test('exports getAccelerator', () => {
      expect(typeof platformUtils.getAccelerator).toBe('function');
    });

    test('exports getSettingsAccelerator', () => {
      expect(typeof platformUtils.getSettingsAccelerator).toBe('function');
    });

    test('exports getModifierKey', () => {
      expect(typeof platformUtils.getModifierKey).toBe('function');
    });

    test('exports joinPath', () => {
      expect(typeof platformUtils.joinPath).toBe('function');
    });

    test('exports resolvePath', () => {
      expect(typeof platformUtils.resolvePath).toBe('function');
    });

    test('exports isUNCPath', () => {
      expect(typeof platformUtils.isUNCPath).toBe('function');
    });

    test('exports safePathJoin', () => {
      expect(typeof platformUtils.safePathJoin).toBe('function');
    });

    test('exports isFeatureSupported', () => {
      expect(typeof platformUtils.isFeatureSupported).toBe('function');
    });

    test('exports getFeatureDocumentation', () => {
      expect(typeof platformUtils.getFeatureDocumentation).toBe('function');
    });
  });
});
