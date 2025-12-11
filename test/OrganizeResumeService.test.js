/**
 * Tests for OrganizeResumeService
 * Tests resuming incomplete organize batches
 */

const path = require('path');
const fs = require('fs').promises;
const os = require('os');

describe('OrganizeResumeService', () => {
  let resumeIncompleteBatches;
  let testDir;
  let mockServiceIntegration;
  let mockLogger;
  let mockGetMainWindow;

  beforeEach(async () => {
    // jest.resetModules(); // Removed - breaks module imports

    // Create temp directory for tests
    testDir = path.join(os.tmpdir(), `resume-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    const module = require('../src/main/services/OrganizeResumeService');
    resumeIncompleteBatches = module.resumeIncompleteBatches;

    // Setup mocks
    mockLogger = {
      warn: jest.fn(),
      info: jest.fn()
    };

    mockServiceIntegration = {
      processingState: {
        getIncompleteOrganizeBatches: jest.fn().mockReturnValue([]),
        markOrganizeOpStarted: jest.fn().mockResolvedValue(),
        markOrganizeOpDone: jest.fn().mockResolvedValue(),
        markOrganizeOpError: jest.fn().mockResolvedValue(),
        completeOrganizeBatch: jest.fn().mockResolvedValue()
      }
    };

    mockGetMainWindow = jest.fn().mockReturnValue({
      isDestroyed: () => false,
      webContents: {
        send: jest.fn()
      }
    });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('resumeIncompleteBatches', () => {
    test('returns early when no incomplete batches', async () => {
      await resumeIncompleteBatches(mockServiceIntegration, mockLogger, mockGetMainWindow);

      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    test('logs warning when incomplete batches exist', async () => {
      mockServiceIntegration.processingState.getIncompleteOrganizeBatches.mockReturnValue([
        { id: 'batch1', operations: [] }
      ]);

      await resumeIncompleteBatches(mockServiceIntegration, mockLogger, mockGetMainWindow);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Resuming 1 incomplete')
      );
    });

    test('skips already done operations', async () => {
      mockServiceIntegration.processingState.getIncompleteOrganizeBatches.mockReturnValue([
        {
          id: 'batch1',
          operations: [{ source: '/a', destination: '/b', status: 'done' }]
        }
      ]);

      await resumeIncompleteBatches(mockServiceIntegration, mockLogger, mockGetMainWindow);

      expect(mockServiceIntegration.processingState.markOrganizeOpStarted).not.toHaveBeenCalled();
    });

    test('processes pending operations', async () => {
      const source = path.join(testDir, 'source.txt');
      const dest = path.join(testDir, 'dest.txt');
      await fs.writeFile(source, 'content');

      mockServiceIntegration.processingState.getIncompleteOrganizeBatches.mockReturnValue([
        {
          id: 'batch1',
          operations: [{ source, destination: dest, status: 'pending' }]
        }
      ]);

      await resumeIncompleteBatches(mockServiceIntegration, mockLogger, mockGetMainWindow);

      expect(mockServiceIntegration.processingState.markOrganizeOpStarted).toHaveBeenCalled();
      expect(mockServiceIntegration.processingState.markOrganizeOpDone).toHaveBeenCalled();
    });

    test('handles name collision', async () => {
      const source = path.join(testDir, 'source.txt');
      const dest = path.join(testDir, 'dest.txt');
      await fs.writeFile(source, 'content');
      await fs.writeFile(dest, 'existing');

      mockServiceIntegration.processingState.getIncompleteOrganizeBatches.mockReturnValue([
        {
          id: 'batch1',
          operations: [{ source, destination: dest, status: 'pending' }]
        }
      ]);

      await resumeIncompleteBatches(mockServiceIntegration, mockLogger, mockGetMainWindow);

      // Should complete with a modified destination
      expect(mockServiceIntegration.processingState.markOrganizeOpDone).toHaveBeenCalled();
    });

    test('sends progress updates', async () => {
      const source = path.join(testDir, 'source.txt');
      const dest = path.join(testDir, 'dest.txt');
      await fs.writeFile(source, 'content');

      mockServiceIntegration.processingState.getIncompleteOrganizeBatches.mockReturnValue([
        {
          id: 'batch1',
          operations: [{ source, destination: dest, status: 'pending' }]
        }
      ]);

      await resumeIncompleteBatches(mockServiceIntegration, mockLogger, mockGetMainWindow);

      const window = mockGetMainWindow();
      expect(window.webContents.send).toHaveBeenCalledWith(
        'operation-progress',
        expect.objectContaining({
          type: 'batch_organize',
          current: 1,
          total: 1
        })
      );
    });

    test('handles operation error gracefully', async () => {
      const source = path.join(testDir, 'notexists.txt');
      const dest = path.join(testDir, 'dest.txt');

      mockServiceIntegration.processingState.getIncompleteOrganizeBatches.mockReturnValue([
        {
          id: 'batch1',
          operations: [{ source, destination: dest, status: 'pending' }]
        }
      ]);

      await resumeIncompleteBatches(mockServiceIntegration, mockLogger, mockGetMainWindow);

      expect(mockServiceIntegration.processingState.markOrganizeOpError).toHaveBeenCalled();
    });

    test('completes batch after processing all operations', async () => {
      const source = path.join(testDir, 'source.txt');
      const dest = path.join(testDir, 'dest.txt');
      await fs.writeFile(source, 'content');

      mockServiceIntegration.processingState.getIncompleteOrganizeBatches.mockReturnValue([
        {
          id: 'batch1',
          operations: [{ source, destination: dest, status: 'pending' }]
        }
      ]);

      await resumeIncompleteBatches(mockServiceIntegration, mockLogger, mockGetMainWindow);

      expect(mockServiceIntegration.processingState.completeOrganizeBatch).toHaveBeenCalledWith(
        'batch1'
      );
    });

    test('handles null service integration', async () => {
      await expect(
        resumeIncompleteBatches(null, mockLogger, mockGetMainWindow)
      ).resolves.not.toThrow();
    });

    test('handles undefined processingState', async () => {
      await expect(
        resumeIncompleteBatches({}, mockLogger, mockGetMainWindow)
      ).resolves.not.toThrow();
    });

    test('handles missing getIncompleteOrganizeBatches', async () => {
      await expect(
        resumeIncompleteBatches({ processingState: {} }, mockLogger, mockGetMainWindow)
      ).resolves.not.toThrow();
    });

    test('handles destroyed window', async () => {
      const source = path.join(testDir, 'source.txt');
      const dest = path.join(testDir, 'dest.txt');
      await fs.writeFile(source, 'content');

      mockGetMainWindow.mockReturnValue({
        isDestroyed: () => true,
        webContents: { send: jest.fn() }
      });

      mockServiceIntegration.processingState.getIncompleteOrganizeBatches.mockReturnValue([
        {
          id: 'batch1',
          operations: [{ source, destination: dest, status: 'pending' }]
        }
      ]);

      await expect(
        resumeIncompleteBatches(mockServiceIntegration, mockLogger, mockGetMainWindow)
      ).resolves.not.toThrow();
    });

    test('handles null window', async () => {
      const source = path.join(testDir, 'source.txt');
      const dest = path.join(testDir, 'dest.txt');
      await fs.writeFile(source, 'content');

      mockGetMainWindow.mockReturnValue(null);

      mockServiceIntegration.processingState.getIncompleteOrganizeBatches.mockReturnValue([
        {
          id: 'batch1',
          operations: [{ source, destination: dest, status: 'pending' }]
        }
      ]);

      await expect(
        resumeIncompleteBatches(mockServiceIntegration, mockLogger, mockGetMainWindow)
      ).resolves.not.toThrow();
    });

    test('processes multiple batches', async () => {
      const source1 = path.join(testDir, 'source1.txt');
      const dest1 = path.join(testDir, 'dest1.txt');
      const source2 = path.join(testDir, 'source2.txt');
      const dest2 = path.join(testDir, 'dest2.txt');
      await fs.writeFile(source1, 'content1');
      await fs.writeFile(source2, 'content2');

      mockServiceIntegration.processingState.getIncompleteOrganizeBatches.mockReturnValue([
        {
          id: 'batch1',
          operations: [{ source: source1, destination: dest1, status: 'pending' }]
        },
        {
          id: 'batch2',
          operations: [{ source: source2, destination: dest2, status: 'pending' }]
        }
      ]);

      await resumeIncompleteBatches(mockServiceIntegration, mockLogger, mockGetMainWindow);

      expect(mockServiceIntegration.processingState.completeOrganizeBatch).toHaveBeenCalledWith(
        'batch1'
      );
      expect(mockServiceIntegration.processingState.completeOrganizeBatch).toHaveBeenCalledWith(
        'batch2'
      );
    });

    test('logs batch completion', async () => {
      const source = path.join(testDir, 'source.txt');
      const dest = path.join(testDir, 'dest.txt');
      await fs.writeFile(source, 'content');

      mockServiceIntegration.processingState.getIncompleteOrganizeBatches.mockReturnValue([
        {
          id: 'batch1',
          operations: [{ source, destination: dest, status: 'pending' }]
        }
      ]);

      await resumeIncompleteBatches(mockServiceIntegration, mockLogger, mockGetMainWindow);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Completed batch resume'),
        'batch1'
      );
    });
  });
});
