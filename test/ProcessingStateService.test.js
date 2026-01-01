/**
 * Tests for ProcessingStateService
 * Tests analysis job and organize batch tracking with persistence
 */

// Mock logger
jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

// Mock fs
const mockFs = {
  readFile: jest.fn(),
  writeFile: jest.fn().mockResolvedValue(undefined),
  rename: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
  mkdir: jest.fn().mockResolvedValue(undefined)
};
jest.mock('fs', () => ({
  promises: mockFs
}));

// Mock electron
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn().mockReturnValue('/mock/userData')
  }
}));

describe('ProcessingStateService', () => {
  let ProcessingStateService;
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    ProcessingStateService = require('../src/main/services/ProcessingStateService');
    service = new ProcessingStateService();
  });

  describe('constructor', () => {
    test('initializes with correct defaults', () => {
      expect(service.userDataPath).toBe('/mock/userData');
      expect(service.state).toBeNull();
      expect(service.initialized).toBe(false);
      expect(service.SCHEMA_VERSION).toBe('1.0.0');
    });
  });

  describe('createEmptyState', () => {
    test('creates state with correct structure', () => {
      const state = service.createEmptyState();

      expect(state.schemaVersion).toBe('1.0.0');
      expect(state.createdAt).toBeDefined();
      expect(state.updatedAt).toBeDefined();
      expect(state.analysis.jobs).toEqual({});
      expect(state.organize.batches).toEqual({});
    });
  });

  describe('initialize', () => {
    test('loads existing state', async () => {
      const existingState = {
        schemaVersion: '1.0.0',
        analysis: { jobs: {}, lastUpdated: '' },
        organize: { batches: {}, lastUpdated: '' }
      };
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(existingState));

      await service.initialize();

      expect(service.initialized).toBe(true);
      expect(service.state.schemaVersion).toBe('1.0.0');
    });

    test('creates new state when file does not exist', async () => {
      mockFs.readFile.mockRejectedValueOnce({ code: 'ENOENT' });

      await service.initialize();

      expect(service.initialized).toBe(true);
      expect(service.state.analysis.jobs).toEqual({});
    });

    test('only initializes once', async () => {
      mockFs.readFile.mockResolvedValue(
        JSON.stringify({
          schemaVersion: '1.0.0',
          analysis: { jobs: {} },
          organize: { batches: {} }
        })
      );

      await service.initialize();
      await service.initialize();

      expect(mockFs.readFile).toHaveBeenCalledTimes(1);
    });

    test('handles concurrent initialization', async () => {
      mockFs.readFile.mockResolvedValue(
        JSON.stringify({
          schemaVersion: '1.0.0',
          analysis: { jobs: {} },
          organize: { batches: {} }
        })
      );

      await Promise.all([service.initialize(), service.initialize()]);

      expect(mockFs.readFile).toHaveBeenCalledTimes(1);
    });
  });

  describe('loadState', () => {
    test('parses JSON state file', async () => {
      const state = {
        schemaVersion: '1.0.0',
        analysis: { jobs: { '/test': { status: 'done' } } },
        organize: { batches: {} }
      };
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(state));

      await service.loadState();

      expect(service.state.analysis.jobs['/test'].status).toBe('done');
    });

    test('adds schema version if missing', async () => {
      mockFs.readFile.mockResolvedValueOnce(
        JSON.stringify({
          analysis: { jobs: {} },
          organize: { batches: {} }
        })
      );

      await service.loadState();

      expect(service.state.schemaVersion).toBe('1.0.0');
    });

    test('creates empty state for ENOENT', async () => {
      mockFs.readFile.mockRejectedValueOnce({ code: 'ENOENT' });

      await service.loadState();

      expect(service.state).toBeDefined();
      expect(service.state.analysis.jobs).toEqual({});
    });

    test('rethrows other errors', async () => {
      mockFs.readFile.mockRejectedValueOnce(new Error('Permission denied'));

      await expect(service.loadState()).rejects.toThrow('Permission denied');
    });
  });

  describe('saveState', () => {
    beforeEach(async () => {
      mockFs.readFile.mockRejectedValueOnce({ code: 'ENOENT' });
      await service.initialize();
    });

    test('saves state atomically', async () => {
      await service.saveState();

      expect(mockFs.writeFile).toHaveBeenCalled();
      expect(mockFs.rename).toHaveBeenCalled();
    });

    test('updates timestamp on save', async () => {
      const oldTimestamp = service.state.updatedAt;

      await new Promise((r) => setTimeout(r, 10));
      await service.saveState();

      expect(service.state.updatedAt).not.toBe(oldTimestamp);
    });

    test('handles rename retry on EPERM', async () => {
      mockFs.rename.mockRejectedValueOnce({ code: 'EPERM' }).mockResolvedValueOnce(undefined);

      await service.saveState();

      expect(mockFs.rename).toHaveBeenCalledTimes(2);
    });

    test('cleans up temp file on write failure', async () => {
      mockFs.writeFile.mockRejectedValueOnce(new Error('Write failed'));

      // saveState swallows errors for resilience (logs them instead of throwing)
      await service.saveState();

      // But it should still clean up the temp file
      expect(mockFs.unlink).toHaveBeenCalled();
    });
  });

  describe('Analysis tracking', () => {
    beforeEach(async () => {
      mockFs.readFile.mockRejectedValueOnce({ code: 'ENOENT' });
      await service.initialize();
    });

    describe('markAnalysisStart', () => {
      test('creates in_progress job', async () => {
        await service.markAnalysisStart('/test/file.pdf');

        expect(service.state.analysis.jobs['/test/file.pdf'].status).toBe('in_progress');
        expect(service.state.analysis.jobs['/test/file.pdf'].startedAt).toBeDefined();
      });
    });

    describe('markAnalysisComplete', () => {
      test('marks job as done', async () => {
        await service.markAnalysisStart('/test/file.pdf');
        await service.markAnalysisComplete('/test/file.pdf');

        expect(service.state.analysis.jobs['/test/file.pdf'].status).toBe('done');
        expect(service.state.analysis.jobs['/test/file.pdf'].completedAt).toBeDefined();
      });
    });

    describe('markAnalysisError', () => {
      test('marks job as failed with error', async () => {
        await service.markAnalysisStart('/test/file.pdf');
        await service.markAnalysisError('/test/file.pdf', 'Analysis failed');

        expect(service.state.analysis.jobs['/test/file.pdf'].status).toBe('failed');
        expect(service.state.analysis.jobs['/test/file.pdf'].error).toBe('Analysis failed');
      });

      test('uses default error message', async () => {
        await service.markAnalysisStart('/test/file.pdf');
        await service.markAnalysisError('/test/file.pdf', null);

        expect(service.state.analysis.jobs['/test/file.pdf'].error).toBe('Unknown analysis error');
      });
    });

    describe('getIncompleteAnalysisJobs', () => {
      test('returns pending and in_progress jobs', async () => {
        service.state.analysis.jobs = {
          '/file1': { status: 'in_progress' },
          '/file2': { status: 'done' },
          '/file3': { status: 'pending' }
        };

        const incomplete = service.getIncompleteAnalysisJobs();

        expect(incomplete).toHaveLength(2);
        expect(incomplete.map((j) => j.filePath)).toContain('/file1');
        expect(incomplete.map((j) => j.filePath)).toContain('/file3');
      });

      test('returns empty array when state is null', () => {
        service.state = null;

        expect(service.getIncompleteAnalysisJobs()).toEqual([]);
      });
    });

    describe('getState', () => {
      test('returns job status', async () => {
        await service.markAnalysisStart('/test/file.pdf');

        expect(service.getState('/test/file.pdf')).toBe('in_progress');
      });

      test('returns null for unknown file', () => {
        expect(service.getState('/unknown')).toBeNull();
      });

      test('returns null when state is null', () => {
        service.state = null;

        expect(service.getState('/test')).toBeNull();
      });
    });

    describe('clearState', () => {
      test('removes job from tracking', async () => {
        await service.markAnalysisStart('/test/file.pdf');
        await service.clearState('/test/file.pdf');

        expect(service.state.analysis.jobs['/test/file.pdf']).toBeUndefined();
      });

      test('handles non-existent job', async () => {
        await service.clearState('/unknown');
        // Should not throw
      });
    });
  });

  describe('Organize batch tracking', () => {
    beforeEach(async () => {
      mockFs.readFile.mockRejectedValueOnce({ code: 'ENOENT' });
      await service.initialize();
    });

    describe('createOrLoadOrganizeBatch', () => {
      test('creates new batch', async () => {
        const operations = [
          { source: '/src/file1', destination: '/dest/file1' },
          { source: '/src/file2', destination: '/dest/file2' }
        ];

        const batch = await service.createOrLoadOrganizeBatch('batch1', operations);

        expect(batch.id).toBe('batch1');
        expect(batch.operations).toHaveLength(2);
        expect(batch.operations[0].status).toBe('pending');
      });

      test('returns existing batch', async () => {
        const operations = [{ source: '/src/file1', destination: '/dest/file1' }];

        await service.createOrLoadOrganizeBatch('batch1', operations);
        const batch = await service.createOrLoadOrganizeBatch('batch1', []);

        expect(batch.operations).toHaveLength(1);
      });
    });

    describe('markOrganizeOpStarted', () => {
      test('marks operation as in_progress', async () => {
        await service.createOrLoadOrganizeBatch('batch1', [
          { source: '/src', destination: '/dest' }
        ]);

        await service.markOrganizeOpStarted('batch1', 0);

        expect(service.state.organize.batches['batch1'].operations[0].status).toBe('in_progress');
      });

      test('handles missing batch', async () => {
        await service.markOrganizeOpStarted('nonexistent', 0);
        // Should not throw
      });
    });

    describe('markOrganizeOpDone', () => {
      test('marks operation as done', async () => {
        await service.createOrLoadOrganizeBatch('batch1', [
          { source: '/src', destination: '/dest' }
        ]);

        await service.markOrganizeOpDone('batch1', 0);

        expect(service.state.organize.batches['batch1'].operations[0].status).toBe('done');
      });

      test('updates operation with new data', async () => {
        await service.createOrLoadOrganizeBatch('batch1', [
          { source: '/src', destination: '/dest' }
        ]);

        await service.markOrganizeOpDone('batch1', 0, {
          newDestination: '/new/dest'
        });

        expect(service.state.organize.batches['batch1'].operations[0].newDestination).toBe(
          '/new/dest'
        );
      });
    });

    describe('markOrganizeOpError', () => {
      test('marks operation as failed', async () => {
        await service.createOrLoadOrganizeBatch('batch1', [
          { source: '/src', destination: '/dest' }
        ]);

        await service.markOrganizeOpError('batch1', 0, 'File not found');

        const op = service.state.organize.batches['batch1'].operations[0];
        expect(op.status).toBe('failed');
        expect(op.error).toBe('File not found');
      });
    });

    describe('completeOrganizeBatch', () => {
      test('sets completedAt timestamp', async () => {
        await service.createOrLoadOrganizeBatch('batch1', []);

        await service.completeOrganizeBatch('batch1');

        expect(service.state.organize.batches['batch1'].completedAt).toBeDefined();
      });
    });

    describe('getIncompleteOrganizeBatches', () => {
      test('returns batches without completedAt', async () => {
        await service.createOrLoadOrganizeBatch('batch1', []);
        await service.createOrLoadOrganizeBatch('batch2', []);
        await service.completeOrganizeBatch('batch2');

        const incomplete = service.getIncompleteOrganizeBatches();

        expect(incomplete).toHaveLength(1);
        expect(incomplete[0].id).toBe('batch1');
      });

      test('returns empty array when state is null', () => {
        service.state = null;

        expect(service.getIncompleteOrganizeBatches()).toEqual([]);
      });
    });
  });
});
