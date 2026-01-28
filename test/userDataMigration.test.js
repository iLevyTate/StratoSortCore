/**
 * Tests for userData migration helpers
 */

const mockFs = {
  stat: jest.fn(),
  copyFile: jest.fn()
};

jest.mock('fs', () => ({
  promises: mockFs
}));

jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => '/mock/userData/StratoSort')
  }
}));

jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn()
  }
}));

const createFileStat = (size, mtimeMs) => ({
  isFile: () => true,
  size,
  mtimeMs
});

describe('userDataMigration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  test('copies legacy file when current is missing', async () => {
    const { migrateUserDataState } = require('../src/main/core/userDataMigration');
    const currentPath = '/mock/userData/StratoSort/settings.json';
    const legacyA = '/mock/userData/stratosort/settings.json';
    const legacyB = '/mock/userData/Electron/settings.json';

    mockFs.stat.mockImplementation((filePath) => {
      const normalizedPath = String(filePath).replace(/\\/g, '/');
      if (normalizedPath === currentPath) {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      }
      if (normalizedPath === legacyA) return createFileStat(10, 100);
      if (normalizedPath === legacyB) return createFileStat(10, 200);
      const err = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    });

    await migrateUserDataState({
      files: [{ name: 'settings.json', label: 'settings' }],
      legacyPaths: ['/mock/userData/stratosort', '/mock/userData/Electron']
    });

    const [from, to] = mockFs.copyFile.mock.calls[0].map((value) =>
      String(value).replace(/\\/g, '/')
    );
    expect(from).toBe(legacyB);
    expect(to).toBe(currentPath);
  });

  test('does not overwrite current file when it exists', async () => {
    const { migrateUserDataState } = require('../src/main/core/userDataMigration');
    const currentPath = '/mock/userData/StratoSort/settings.json';

    mockFs.stat.mockImplementation((filePath) => {
      const normalizedPath = String(filePath).replace(/\\/g, '/');
      if (normalizedPath === currentPath) return createFileStat(25, 200);
      const err = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    });

    await migrateUserDataState({
      files: [{ name: 'settings.json', label: 'settings' }],
      legacyPaths: ['/mock/userData/stratosort']
    });

    expect(mockFs.copyFile).not.toHaveBeenCalled();
  });
});
