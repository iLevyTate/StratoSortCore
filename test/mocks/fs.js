/**
 * Centralized File System Mock
 *
 * Provides standardized mocks for fs and fs/promises modules.
 * Import this in test files instead of defining mocks inline.
 *
 * @example
 * jest.mock('fs/promises', () => require('./mocks/fs').promises);
 * jest.mock('fs', () => require('./mocks/fs').fs);
 */

const createFsPromisesMock = () => ({
  readFile: jest.fn(() => Promise.resolve('')),
  writeFile: jest.fn(() => Promise.resolve()),
  appendFile: jest.fn(() => Promise.resolve()),
  unlink: jest.fn(() => Promise.resolve()),
  rename: jest.fn(() => Promise.resolve()),
  copyFile: jest.fn(() => Promise.resolve()),
  mkdir: jest.fn(() => Promise.resolve()),
  rmdir: jest.fn(() => Promise.resolve()),
  rm: jest.fn(() => Promise.resolve()),
  readdir: jest.fn(() => Promise.resolve([])),
  stat: jest.fn(() =>
    Promise.resolve({
      isFile: () => true,
      isDirectory: () => false,
      size: 0,
      mtime: new Date(),
      birthtime: new Date()
    })
  ),
  lstat: jest.fn(() =>
    Promise.resolve({
      isFile: () => true,
      isDirectory: () => false,
      isSymbolicLink: () => false,
      size: 0,
      mtime: new Date()
    })
  ),
  access: jest.fn(() => Promise.resolve()),
  realpath: jest.fn((p) => Promise.resolve(p)),
  chmod: jest.fn(() => Promise.resolve()),
  chown: jest.fn(() => Promise.resolve()),
  utimes: jest.fn(() => Promise.resolve())
});

const createFsMock = () => ({
  existsSync: jest.fn(() => true),
  readFileSync: jest.fn(() => ''),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  readdirSync: jest.fn(() => []),
  statSync: jest.fn(() => ({
    isFile: () => true,
    isDirectory: () => false,
    size: 0,
    mtime: new Date()
  })),
  unlinkSync: jest.fn(),
  renameSync: jest.fn(),
  copyFileSync: jest.fn(),
  createReadStream: jest.fn(() => ({
    pipe: jest.fn(),
    on: jest.fn((event, cb) => {
      if (event === 'end') setTimeout(cb, 0);
      return { pipe: jest.fn(), on: jest.fn() };
    })
  })),
  createWriteStream: jest.fn(() => ({
    write: jest.fn(),
    end: jest.fn(),
    on: jest.fn()
  })),
  watch: jest.fn(() => ({
    close: jest.fn(),
    on: jest.fn()
  })),
  promises: createFsPromisesMock(),
  constants: {
    F_OK: 0,
    R_OK: 4,
    W_OK: 2,
    X_OK: 1
  }
});

module.exports = {
  promises: createFsPromisesMock(),
  fs: createFsMock(),
  createFsPromisesMock,
  createFsMock
};
