jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => 'C:\\fake-user-data')
  }
}));

jest.mock('../src/shared/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

jest.mock('../src/shared/errorClassifier', () => ({
  isNotFoundError: jest.fn()
}));

jest.mock('../src/shared/performanceConstants', () => ({
  RETRY: {
    ATOMIC_BACKOFF_STEP_MS: 5
  }
}));

const fs = require('fs').promises;
const { isNotFoundError } = require('../src/shared/errorClassifier');
const ProcessingStateService = require('../src/main/services/ProcessingStateService');

jest.spyOn(fs, 'readFile').mockResolvedValue(
  JSON.stringify({
    schemaVersion: '1.0.0',
    analysis: { jobs: {}, lastUpdated: '' },
    organize: { batches: {}, lastUpdated: '' }
  })
);
jest.spyOn(fs, 'writeFile').mockResolvedValue();
jest.spyOn(fs, 'rename').mockResolvedValue();
jest.spyOn(fs, 'mkdir').mockResolvedValue();
jest.spyOn(fs, 'unlink').mockResolvedValue();

describe('ProcessingStateService', () => {
  let service;

  beforeEach(() => {
    isNotFoundError.mockReset();
    service = new ProcessingStateService();
    service._startSweepInterval = jest.fn();
  });

  afterEach(async () => {
    if (service) {
      await service.destroy();
    }
  });

  test('constructor initializes defaults', () => {
    expect(service.state).toBeNull();
    expect(service.initialized).toBe(false);
    expect(service.SCHEMA_VERSION).toBe('1.0.0');
  });

  test('createEmptyState returns base structure', () => {
    const state = service.createEmptyState();
    expect(state.schemaVersion).toBe('1.0.0');
    expect(state.analysis.jobs).toEqual({});
    expect(state.organize.batches).toEqual({});
  });

  test('initialize loads existing state', async () => {
    await service.initialize();
    expect(service.initialized).toBe(true);
    expect(service.state.schemaVersion).toBe('1.0.0');
  });

  test('initialize creates empty state when file missing', async () => {
    fs.readFile.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    isNotFoundError.mockReturnValue(true);

    await service.initialize();

    expect(service.state.analysis.jobs).toEqual({});
    expect(service.initialized).toBe(true);
  });

  test('loadState recovers from corrupted JSON by resetting state', async () => {
    fs.readFile.mockResolvedValueOnce('{ invalid json');
    isNotFoundError.mockReturnValue(false);
    const saveSpy = jest.spyOn(service, '_saveStateInternal').mockResolvedValue();

    await service.loadState();

    expect(service.state).toBeTruthy();
    expect(service.state.analysis.jobs).toEqual({});
    expect(saveSpy).toHaveBeenCalled();
  });

  test('loadState recovers when persisted state has invalid shape', async () => {
    fs.readFile.mockResolvedValueOnce(JSON.stringify(['bad-shape']));
    isNotFoundError.mockReturnValue(false);
    const saveSpy = jest.spyOn(service, '_saveStateInternal').mockResolvedValue();

    await service.loadState();

    expect(service.state).toBeTruthy();
    expect(service.state.organize.batches).toEqual({});
    expect(saveSpy).toHaveBeenCalled();
  });

  test('saveState debounces multiple calls into one write', async () => {
    jest.useFakeTimers();
    service.state = service.createEmptyState();
    const writeSpy = jest.spyOn(service, '_performAtomicWrite').mockResolvedValue();

    const p1 = service.saveState();
    const p2 = service.saveState();
    jest.advanceTimersByTime(service._saveDebounceMs + 1);

    await Promise.all([p1, p2]);
    expect(writeSpy).toHaveBeenCalledTimes(1);

    jest.useRealTimers();
  });

  test('_performAtomicWrite retries rename on EPERM', async () => {
    const state = service.createEmptyState();
    const renameSpy = jest
      .spyOn(fs, 'rename')
      .mockRejectedValueOnce(Object.assign(new Error('locked'), { code: 'EPERM' }))
      .mockResolvedValueOnce();

    jest.useFakeTimers();
    const promise = service._performAtomicWrite(state);
    await jest.runAllTimersAsync();
    await promise;
    expect(renameSpy).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });

  test('markAnalysisStart updates state and persists', async () => {
    service.state = service.createEmptyState();
    service.initialized = true;
    const saveSpy = jest.spyOn(service, 'saveState').mockResolvedValue({ success: true });

    await service.markAnalysisStart('C:\\file.txt');

    expect(service.state.analysis.jobs['C:\\file.txt'].status).toBe('in_progress');
    expect(saveSpy).toHaveBeenCalled();
  });
});
