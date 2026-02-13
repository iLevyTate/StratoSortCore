const { EventEmitter } = require('events');

jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => 'C:\\fake-user-data')
  }
}));

const mockFs = {
  mkdir: jest.fn().mockResolvedValue(),
  readdir: jest.fn(),
  stat: jest.fn(),
  unlink: jest.fn().mockResolvedValue(),
  rename: jest.fn().mockResolvedValue(),
  access: jest.fn().mockResolvedValue()
};

jest.mock('fs', () => ({
  promises: mockFs,
  createWriteStream: jest.fn(),
  createReadStream: jest.fn()
}));

jest.mock('child_process', () => ({
  execSync: jest.fn()
}));

jest.mock('https', () => ({
  get: jest.fn()
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
    'alpha.gguf': {
      displayName: 'Alpha',
      type: 'text',
      size: 2048,
      url: 'https://example.com/models/alpha.gguf'
    }
  }
}));

const { execSync } = require('child_process');
const https = require('https');
const fsModule = require('fs');
const { ModelDownloadManager } = require('../src/main/services/ModelDownloadManager');

describe('ModelDownloadManager', () => {
  beforeEach(() => {
    mockFs.readdir.mockReset();
    mockFs.stat.mockReset();
    mockFs.unlink.mockReset();
    mockFs.rename.mockReset();
    mockFs.access.mockReset();
    mockFs.access?.mockReset?.();
    execSync.mockReset();
    https.get.mockReset();
    fsModule.createWriteStream.mockReset();
  });

  test('getDownloadedModels returns empty on error', async () => {
    mockFs.readdir.mockRejectedValueOnce(new Error('fail'));
    const manager = new ModelDownloadManager();
    const result = await manager.getDownloadedModels();
    expect(result).toEqual([]);
  });

  test('getDownloadedModels maps gguf files with registry info', async () => {
    mockFs.readdir.mockResolvedValue(['alpha.gguf', 'note.txt']);
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

  test('_cleanupPartialFile swallows unlink errors', async () => {
    const manager = new ModelDownloadManager();
    mockFs.unlink.mockRejectedValueOnce(new Error('missing'));

    await expect(
      manager._cleanupPartialFile('C:\\fake-user-data\\models\\alpha.gguf.partial')
    ).resolves.toBeUndefined();
  });

  test('downloadModel cleans partial file on size mismatch', async () => {
    const manager = new ModelDownloadManager();
    const partialPath = 'C:\\fake-user-data\\models\\alpha.gguf.partial';

    // No partial at start, then mismatched size at finish check.
    mockFs.stat.mockRejectedValueOnce(new Error('no partial'));
    mockFs.stat.mockResolvedValueOnce({ size: 1234 });
    mockFs.unlink.mockResolvedValue(undefined);

    const writeStream = new EventEmitter();
    writeStream.destroy = jest.fn();
    fsModule.createWriteStream.mockReturnValue(writeStream);

    https.get.mockImplementation((_options, onResponse) => {
      const request = new EventEmitter();
      request.setTimeout = jest.fn();
      request.destroy = jest.fn();

      const response = new EventEmitter();
      response.statusCode = 200;
      response.statusMessage = 'OK';
      response.headers = {};
      response.resume = jest.fn();
      response.pipe = () => {
        setTimeout(() => writeStream.emit('finish'), 0);
        return writeStream;
      };

      setTimeout(() => onResponse(response), 0);
      return request;
    });

    await expect(manager.downloadModel('alpha.gguf')).rejects.toThrow(
      'Download incomplete - file size mismatch'
    );
    expect(mockFs.unlink).toHaveBeenCalledWith(partialPath);
  });

  test('downloadModel resolves relative redirect locations', async () => {
    const manager = new ModelDownloadManager();
    const writeStream = new EventEmitter();
    writeStream.destroy = jest.fn();
    fsModule.createWriteStream.mockReturnValue(writeStream);

    mockFs.stat.mockRejectedValueOnce(new Error('no partial'));
    mockFs.stat.mockRejectedValueOnce(new Error('no partial after redirect'));
    mockFs.stat.mockResolvedValueOnce({ size: 2048 });

    const requestOptionsSeen = [];
    let callCount = 0;
    https.get.mockImplementation((requestOptions, onResponse) => {
      callCount++;
      requestOptionsSeen.push(requestOptions);

      const request = new EventEmitter();
      request.setTimeout = jest.fn();
      request.destroy = jest.fn();

      const response = new EventEmitter();
      response.headers = {};
      response.resume = jest.fn();

      if (callCount === 1) {
        response.statusCode = 302;
        response.statusMessage = 'Found';
        response.headers.location = '/models/alpha.gguf?download=1';
        setTimeout(() => onResponse(response), 0);
        return request;
      }

      response.statusCode = 200;
      response.statusMessage = 'OK';
      response.pipe = () => {
        setTimeout(() => writeStream.emit('finish'), 0);
        return writeStream;
      };
      setTimeout(() => onResponse(response), 0);
      return request;
    });

    await expect(manager.downloadModel('alpha.gguf')).resolves.toEqual(
      expect.objectContaining({ success: true })
    );
    expect(requestOptionsSeen).toHaveLength(2);
    expect(requestOptionsSeen[1].path).toContain('/models/alpha.gguf?download=1');
    expect(mockFs.rename).toHaveBeenCalledTimes(1);
  });

  test('downloadModel honors pre-aborted external signals', async () => {
    const manager = new ModelDownloadManager();
    const controller = new AbortController();
    controller.abort();

    mockFs.stat.mockRejectedValueOnce(new Error('no partial'));

    await expect(
      manager.downloadModel('alpha.gguf', {
        signal: controller.signal
      })
    ).rejects.toThrow('Download cancelled');
    expect(https.get).not.toHaveBeenCalled();
  });

  test('downloadModel preserves partial file on timeout for resume', async () => {
    const manager = new ModelDownloadManager();

    mockFs.stat.mockRejectedValueOnce(new Error('no partial'));

    https.get.mockImplementation((_requestOptions, _onResponse) => {
      const request = new EventEmitter();
      request.destroy = jest.fn();
      request.setTimeout = jest.fn((_ms, cb) => setTimeout(cb, 0));
      return request;
    });

    await expect(manager.downloadModel('alpha.gguf')).rejects.toThrow('Download timeout');
    expect(mockFs.unlink).not.toHaveBeenCalled();
  });

  test('downloadModel discards stale oversized partial before starting', async () => {
    const manager = new ModelDownloadManager();
    const writeStream = new EventEmitter();
    writeStream.destroy = jest.fn();
    fsModule.createWriteStream.mockReturnValue(writeStream);

    mockFs.stat.mockResolvedValueOnce({ size: 4096 });
    mockFs.unlink.mockResolvedValueOnce(undefined);
    mockFs.stat.mockResolvedValueOnce({ size: 2048 });

    const requestOptionsSeen = [];
    https.get.mockImplementation((requestOptions, onResponse) => {
      requestOptionsSeen.push(requestOptions);
      const request = new EventEmitter();
      request.setTimeout = jest.fn();
      request.destroy = jest.fn();

      const response = new EventEmitter();
      response.statusCode = 200;
      response.statusMessage = 'OK';
      response.headers = {};
      response.resume = jest.fn();
      response.pipe = () => {
        setTimeout(() => writeStream.emit('finish'), 0);
        return writeStream;
      };
      setTimeout(() => onResponse(response), 0);
      return request;
    });

    await expect(manager.downloadModel('alpha.gguf')).resolves.toEqual(
      expect.objectContaining({ success: true })
    );
    expect(mockFs.unlink).toHaveBeenCalledWith('C:\\fake-user-data\\models\\alpha.gguf.partial');
    expect(requestOptionsSeen[0].headers.Range).toBeUndefined();
  });
});
