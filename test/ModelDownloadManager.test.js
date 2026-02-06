jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => 'C:\\fake-user-data')
  }
}));

const mockFs = {
  mkdir: jest.fn().mockResolvedValue(),
  readdir: jest.fn(),
  stat: jest.fn(),
  unlink: jest.fn().mockResolvedValue()
};

jest.mock('fs', () => ({
  promises: mockFs,
  createWriteStream: jest.fn(),
  createReadStream: jest.fn()
}));

jest.mock('child_process', () => ({
  execSync: jest.fn()
}));

jest.mock('../src/shared/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

jest.mock('../src/shared/modelRegistry', () => ({
  MODEL_CATALOG: {
    'alpha.gguf': { displayName: 'Alpha', type: 'text' }
  }
}));

const { execSync } = require('child_process');
const { ModelDownloadManager } = require('../src/main/services/ModelDownloadManager');

describe('ModelDownloadManager', () => {
  beforeEach(() => {
    mockFs.readdir.mockReset();
    mockFs.stat.mockReset();
    mockFs.unlink.mockReset();
    execSync.mockReset();
  });

  test('getDownloadedModels returns empty on error', async () => {
    mockFs.readdir.mockRejectedValueOnce(new Error('fail'));
    const manager = new ModelDownloadManager();
    const result = await manager.getDownloadedModels();
    expect(result).toEqual([]);
  });

  test('getDownloadedModels maps gguf files with registry info', async () => {
    mockFs.readdir.mockResolvedValueOnce(['alpha.gguf', 'note.txt']);
    mockFs.stat.mockResolvedValueOnce({ size: 1024 * 1024 * 2 });

    const manager = new ModelDownloadManager();
    const result = await manager.getDownloadedModels();

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      filename: 'alpha.gguf',
      sizeMB: 2,
      type: 'text',
      displayName: 'Alpha',
      isComplete: true
    });
  });

  test('checkDiskSpace returns available and sufficient', async () => {
    execSync.mockReturnValueOnce('FreeSpace\r\n2147483648\r\n');
    const manager = new ModelDownloadManager();
    const result = await manager.checkDiskSpace(1024);
    expect(result.available).toBeGreaterThan(0);
    expect(result.sufficient).toBe(true);
  });

  test('checkDiskSpace returns sufficient on failure', async () => {
    execSync.mockImplementationOnce(() => {
      throw new Error('fail');
    });
    const manager = new ModelDownloadManager();
    const result = await manager.checkDiskSpace(1024);
    expect(result.sufficient).toBe(true);
  });

  test('onProgress registers and unregisters callbacks', () => {
    const manager = new ModelDownloadManager();
    const cb = jest.fn();
    const unsubscribe = manager.onProgress(cb);

    manager._notifyProgress({ percent: 5 });
    expect(cb).toHaveBeenCalledTimes(1);

    unsubscribe();
    manager._notifyProgress({ percent: 10 });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  test('_calculateSpeed and _calculateETA handle elapsed time', () => {
    const manager = new ModelDownloadManager();
    const state = {
      startTime: Date.now() - 2000,
      downloadedBytes: 200,
      totalBytes: 1000
    };

    const speed = manager._calculateSpeed(state);
    const eta = manager._calculateETA(state);

    expect(speed).toBe(100);
    expect(eta).toBe(8);
  });

  test('deleteModel removes files', async () => {
    const manager = new ModelDownloadManager();
    const result = await manager.deleteModel('alpha.gguf');
    expect(result.success).toBe(true);
    expect(mockFs.unlink).toHaveBeenCalledTimes(2);
  });
});
