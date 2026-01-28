/**
 * Tests for Platform Utilities
 * Tests legacy-compatible APIs and cross-platform utilities
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
    test('returns npm for Unix', () => {
      if (!platformUtils.isWindows) {
        expect(platformUtils.getNpmCommand()).toBe('npm');
      }
    });

    test('returns npm.cmd for Windows', () => {
      if (platformUtils.isWindows) {
        expect(platformUtils.getNpmCommand()).toBe('npm.cmd');
      }
    });
  });

  describe('getChromaDbBinName', () => {
    test('returns chromadb for Unix', () => {
      if (!platformUtils.isWindows) {
        expect(platformUtils.getChromaDbBinName()).toBe('chroma');
      }
    });

    test('returns chromadb.cmd for Windows', () => {
      if (platformUtils.isWindows) {
        expect(platformUtils.getChromaDbBinName()).toBe('chroma.cmd');
      }
    });
  });

  describe('getNvidiaSmiCommand', () => {
    test('returns nvidia-smi for Unix', () => {
      if (!platformUtils.isWindows) {
        expect(platformUtils.getNvidiaSmiCommand()).toBe('nvidia-smi');
      }
    });

    test('returns nvidia-smi.exe for Windows', () => {
      if (platformUtils.isWindows) {
        expect(platformUtils.getNvidiaSmiCommand()).toBe('nvidia-smi.exe');
      }
    });
  });

  describe('getSleepCommand', () => {
    test('returns command with cmd and args', () => {
      const result = platformUtils.getSleepCommand(5);
      expect(result).toHaveProperty('cmd');
      expect(result).toHaveProperty('args');
    });

    test('returns timeout for Windows', () => {
      if (platformUtils.isWindows) {
        const result = platformUtils.getSleepCommand(5);
        expect(result.cmd).toBe('timeout');
      }
    });

    test('returns sleep for Unix', () => {
      if (!platformUtils.isWindows) {
        const result = platformUtils.getSleepCommand(5);
        expect(result.cmd).toBe('sleep');
      }
    });
  });

  describe('getKillCommand', () => {
    test('returns command with cmd and args', () => {
      const result = platformUtils.getKillCommand(1234);
      expect(result).toHaveProperty('cmd');
      expect(result).toHaveProperty('args');
    });

    test('returns taskkill for Windows', () => {
      if (platformUtils.isWindows) {
        const result = platformUtils.getKillCommand(1234);
        expect(result.cmd).toBe('taskkill');
      }
    });

    test('returns kill for Unix', () => {
      if (!platformUtils.isWindows) {
        const result = platformUtils.getKillCommand(1234);
        expect(result.cmd).toBe('kill');
      }
    });

    test('includes force flag', () => {
      const result = platformUtils.getKillCommand(1234, true);
      if (platformUtils.isWindows) {
        expect(result.args).toContain('/f');
      } else {
        expect(result.args).toContain('-KILL');
      }
    });
  });

  describe('shouldUseShell', () => {
    test('returns true on Windows', () => {
      if (platformUtils.isWindows) {
        expect(platformUtils.shouldUseShell()).toBe(true);
      }
    });

    test('returns false on Unix by default', () => {
      if (!platformUtils.isWindows) {
        expect(platformUtils.shouldUseShell()).toBe(false);
      }
    });

    test('returns true when forceShell is true', () => {
      expect(platformUtils.shouldUseShell(true)).toBe(true);
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
