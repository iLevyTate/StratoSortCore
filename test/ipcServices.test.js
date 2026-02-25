jest.mock('../src/renderer/services/ipc/electronApi', () => ({
  requireElectronAPI: jest.fn()
}));

const { requireElectronAPI } = require('../src/renderer/services/ipc/electronApi');
const { filesIpc } = require('../src/renderer/services/ipc/filesIpc');
const { settingsIpc } = require('../src/renderer/services/ipc/settingsIpc');
const { smartFoldersIpc } = require('../src/renderer/services/ipc/smartFoldersIpc');
const { embeddingsIpc } = require('../src/renderer/services/ipc/embeddingsIpc');
const { eventsIpc } = require('../src/renderer/services/ipc/eventsIpc');
const { llamaIpc } = require('../src/renderer/services/ipc/llamaIpc');
const { systemIpc } = require('../src/renderer/services/ipc/systemIpc');

describe('ipc services', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    embeddingsIpc.invalidateStatsCache();
  });

  test('filesIpc calls underlying file methods', () => {
    const api = {
      files: {
        selectDirectory: jest.fn(() => 'selected'),
        getDocumentsPath: jest.fn(() => 'docs'),
        createFolder: jest.fn(() => 'created'),
        openFolder: jest.fn(() => 'opened')
      }
    };
    requireElectronAPI.mockReturnValue(api);

    expect(filesIpc.selectDirectory()).toBe('selected');
    expect(filesIpc.getDocumentsPath()).toBe('docs');
    expect(filesIpc.createFolder('path')).toBe('created');
    expect(filesIpc.openFolder('folder')).toBe('opened');
  });

  test('settingsIpc proxies get and save', () => {
    const api = {
      settings: {
        get: jest.fn(() => ({ theme: 'dark' })),
        save: jest.fn(() => ({ success: true }))
      }
    };
    requireElectronAPI.mockReturnValue(api);

    expect(settingsIpc.get()).toEqual({ theme: 'dark' });
    expect(settingsIpc.save({ theme: 'light' })).toEqual({ success: true });
  });

  test('smartFoldersIpc proxies smart folder methods', async () => {
    const api = {
      smartFolders: {
        get: jest.fn(() => []),
        add: jest.fn(() => ({ id: '1' })),
        edit: jest.fn(() => ({ id: '1', name: 'updated' })),
        delete: jest.fn(() => ({ success: true })),
        resetToDefaults: jest.fn(() => ({ success: true })),
        generateDescription: jest.fn(() => 'desc')
      }
    };
    requireElectronAPI.mockReturnValue(api);

    expect(smartFoldersIpc.get()).toEqual([]);
    expect(smartFoldersIpc.add({ name: 'x' })).toEqual({ id: '1' });
    expect(smartFoldersIpc.edit('1', { name: 'updated' })).toEqual({
      id: '1',
      name: 'updated'
    });
    expect(smartFoldersIpc.delete('1')).toEqual({ success: true });
    expect(smartFoldersIpc.resetToDefaults()).toEqual({ success: true });
    await expect(smartFoldersIpc.generateDescription('Folder')).resolves.toBe('desc');
  });

  test('smartFoldersIpc.generateDescription resolves timeout response when request hangs', async () => {
    jest.useFakeTimers();
    try {
      const api = {
        smartFolders: {
          generateDescription: jest.fn(
            () =>
              new Promise(() => {
                // Intentionally unresolved promise
              })
          )
        }
      };
      requireElectronAPI.mockReturnValue(api);

      const pending = smartFoldersIpc.generateDescription('Folder', { timeoutMs: 25 });
      jest.advanceTimersByTime(30);

      await expect(pending).resolves.toEqual({
        success: false,
        error: 'Description generation timed out. Please try again.'
      });
    } finally {
      jest.useRealTimers();
    }
  });

  test('embeddingsIpc proxies embedding methods', () => {
    const api = {
      embeddings: {
        getStats: jest.fn(() => ({ size: 10 })),
        rebuildFiles: jest.fn(() => ({ success: true }))
      }
    };
    requireElectronAPI.mockReturnValue(api);

    expect(embeddingsIpc.getStats()).toEqual({ size: 10 });
    expect(embeddingsIpc.rebuildFiles()).toEqual({ success: true });
  });

  test('embeddingsIpc.getStatsCached coalesces concurrent requests', async () => {
    const api = {
      embeddings: {
        getStats: jest.fn(() =>
          Promise.resolve({
            success: true,
            files: 10
          })
        )
      }
    };
    requireElectronAPI.mockReturnValue(api);

    const [a, b] = await Promise.all([
      embeddingsIpc.getStatsCached(),
      embeddingsIpc.getStatsCached()
    ]);

    expect(api.embeddings.getStats).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(a.files).toBe(10);
  });

  test('embeddingsIpc.invalidateStatsCache forces a fresh fetch', async () => {
    const api = {
      embeddings: {
        getStats: jest
          .fn()
          .mockResolvedValueOnce({ success: true, files: 1 })
          .mockResolvedValueOnce({ success: true, files: 2 })
      }
    };
    requireElectronAPI.mockReturnValue(api);

    await embeddingsIpc.getStatsCached({ forceRefresh: true });
    await embeddingsIpc.getStatsCached();
    embeddingsIpc.invalidateStatsCache();
    const latest = await embeddingsIpc.getStatsCached();

    expect(api.embeddings.getStats).toHaveBeenCalledTimes(2);
    expect(latest.files).toBe(2);
  });

  test('embeddingsIpc.getStatsCached forwards forceRefresh to preload bridge', async () => {
    const api = {
      embeddings: {
        getStats: jest.fn().mockResolvedValue({ success: true, files: 42 })
      }
    };
    requireElectronAPI.mockReturnValue(api);

    await embeddingsIpc.getStatsCached({ forceRefresh: true });

    expect(api.embeddings.getStats).toHaveBeenCalledWith({ forceRefresh: true });
  });

  test('eventsIpc registers progress handler', () => {
    const unsubscribe = jest.fn();
    const api = {
      events: {
        onOperationProgress: jest.fn(() => unsubscribe)
      }
    };
    requireElectronAPI.mockReturnValue(api);

    const handler = jest.fn();
    const result = eventsIpc.onOperationProgress(handler);

    expect(api.events.onOperationProgress).toHaveBeenCalledWith(handler);
    expect(result).toBe(unsubscribe);
  });

  test('llamaIpc proxies model management methods', () => {
    const api = {
      llama: {
        getModels: jest.fn(() => ['a']),
        getConfig: jest.fn(() => ({ threads: 2 })),
        updateConfig: jest.fn(() => ({ success: true })),
        testConnection: jest.fn(() => ({ ok: true })),
        downloadModel: jest.fn(() => ({ jobId: '1' })),
        deleteModel: jest.fn(() => ({ success: true })),
        getDownloadStatus: jest.fn(() => ({ active: [] }))
      }
    };
    requireElectronAPI.mockReturnValue(api);

    expect(llamaIpc.getModels()).toEqual(['a']);
    expect(llamaIpc.getConfig()).toEqual({ threads: 2 });
    expect(llamaIpc.updateConfig({ threads: 4 })).toEqual({ success: true });
    expect(llamaIpc.testConnection()).toEqual({ ok: true });
    expect(llamaIpc.downloadModel('m')).toEqual({ jobId: '1' });
    expect(llamaIpc.deleteModel('m')).toEqual({ success: true });
    expect(llamaIpc.getDownloadStatus()).toEqual({ active: [] });
  });

  test('systemIpc normalizes config value response', async () => {
    const api = {
      system: {
        getConfigValue: jest.fn().mockResolvedValue({ success: true, value: 'ok' })
      }
    };
    requireElectronAPI.mockReturnValue(api);

    await expect(systemIpc.getConfigValue('path')).resolves.toBe('ok');
  });

  test('systemIpc throws on error responses', async () => {
    const api = {
      system: {
        getConfigValue: jest.fn().mockResolvedValue({ success: false, error: 'nope' })
      }
    };
    requireElectronAPI.mockReturnValue(api);

    await expect(systemIpc.getConfigValue('path')).rejects.toThrow('nope');
  });

  test('systemIpc.exportLogs returns successful result', async () => {
    const api = {
      system: {
        exportLogs: jest.fn().mockResolvedValue({ success: true, filePath: '/tmp/logs.zip' })
      }
    };
    requireElectronAPI.mockReturnValue(api);

    await expect(systemIpc.exportLogs()).resolves.toEqual({
      success: true,
      filePath: '/tmp/logs.zip'
    });
  });

  test('systemIpc.exportLogs throws on error response', async () => {
    const api = {
      system: {
        exportLogs: jest.fn().mockResolvedValue({ success: false, error: 'export failed' })
      }
    };
    requireElectronAPI.mockReturnValue(api);

    await expect(systemIpc.exportLogs()).rejects.toThrow('export failed');
  });
});
