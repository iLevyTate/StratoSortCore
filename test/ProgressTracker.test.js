/**
 * Tests for ProgressTracker utility
 * Ensures type-safe progress tracking for long-running operations
 */

const {
  ProgressTracker,
  createProgressTracker,
  trackProgress,
} = require('../src/main/utils/ProgressTracker');

describe('ProgressTracker', () => {
  let mockWebContents;

  beforeEach(() => {
    mockWebContents = {
      send: jest.fn(),
      isDestroyed: jest.fn(() => false),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    test('initializes with default values', () => {
      const tracker = new ProgressTracker(
        mockWebContents,
        'test-operation',
        100,
      );

      expect(tracker.webContents).toBe(mockWebContents);
      expect(tracker.operationType).toBe('test-operation');
      expect(tracker.total).toBe(100);
      expect(tracker.current).toBe(0);
      expect(tracker.status).toBe('running');
      expect(tracker.errors).toEqual([]);
      expect(tracker.startTime).toBeLessThanOrEqual(Date.now());
    });

    test('initializes with zero total', () => {
      const tracker = new ProgressTracker(mockWebContents, 'test', 0);

      expect(tracker.total).toBe(0);
      expect(tracker.current).toBe(0);
    });

    test('initializes without webContents', () => {
      const tracker = new ProgressTracker(null, 'test', 10);

      expect(tracker.webContents).toBeNull();
      expect(() => tracker.update(1)).not.toThrow();
    });
  });

  describe('_calculatePercentage', () => {
    let tracker;

    beforeEach(() => {
      tracker = new ProgressTracker(mockWebContents, 'test', 100);
    });

    test('calculates percentage correctly', () => {
      expect(tracker._calculatePercentage(0, 100)).toBe(0);
      expect(tracker._calculatePercentage(25, 100)).toBe(25);
      expect(tracker._calculatePercentage(50, 100)).toBe(50);
      expect(tracker._calculatePercentage(75, 100)).toBe(75);
      expect(tracker._calculatePercentage(100, 100)).toBe(100);
    });

    test('returns 0 for invalid current type', () => {
      expect(tracker._calculatePercentage('invalid', 100)).toBe(0);
      expect(tracker._calculatePercentage(null, 100)).toBe(0);
      expect(tracker._calculatePercentage(undefined, 100)).toBe(0);
      expect(tracker._calculatePercentage({}, 100)).toBe(0);
      expect(tracker._calculatePercentage([], 100)).toBe(0);
    });

    test('returns 0 for invalid total type', () => {
      expect(tracker._calculatePercentage(50, 'invalid')).toBe(0);
      expect(tracker._calculatePercentage(50, null)).toBe(0);
      expect(tracker._calculatePercentage(50, undefined)).toBe(0);
      expect(tracker._calculatePercentage(50, {})).toBe(0);
      expect(tracker._calculatePercentage(50, [])).toBe(0);
    });

    test('returns 0 for zero total', () => {
      expect(tracker._calculatePercentage(50, 0)).toBe(0);
      expect(tracker._calculatePercentage(100, 0)).toBe(0);
    });

    test('returns 0 for negative total', () => {
      expect(tracker._calculatePercentage(50, -10)).toBe(0);
      expect(tracker._calculatePercentage(50, -100)).toBe(0);
    });

    test('caps percentage at 100 when current exceeds total', () => {
      expect(tracker._calculatePercentage(150, 100)).toBe(100);
      expect(tracker._calculatePercentage(200, 100)).toBe(100);
      expect(tracker._calculatePercentage(1000, 100)).toBe(100);
    });

    test('ensures non-negative percentage', () => {
      expect(tracker._calculatePercentage(-10, 100)).toBe(0);
      expect(tracker._calculatePercentage(-50, 100)).toBe(0);
    });

    test('rounds percentage correctly', () => {
      expect(tracker._calculatePercentage(33, 100)).toBe(33);
      expect(tracker._calculatePercentage(66, 100)).toBe(66);
      expect(tracker._calculatePercentage(1, 3)).toBe(33); // 33.333... rounds to 33
      expect(tracker._calculatePercentage(2, 3)).toBe(67); // 66.666... rounds to 67
    });

    test('handles fractional progress', () => {
      expect(tracker._calculatePercentage(0.5, 1)).toBe(50);
      expect(tracker._calculatePercentage(0.25, 1)).toBe(25);
      expect(tracker._calculatePercentage(1.5, 2)).toBe(75);
    });
  });

  describe('update', () => {
    let tracker;

    beforeEach(() => {
      tracker = new ProgressTracker(mockWebContents, 'test-op', 100);
    });

    test('updates current progress and sends event', () => {
      const result = tracker.update(25, 'Processing items...');

      expect(tracker.current).toBe(25);
      expect(result.current).toBe(25);
      expect(result.percentage).toBe(25);
      expect(result.message).toBe('Processing items...');
      expect(mockWebContents.send).toHaveBeenCalledWith(
        'operation-progress',
        expect.objectContaining({
          type: 'test-op',
          current: 25,
          total: 100,
          percentage: 25,
          status: 'running',
          message: 'Processing items...',
        }),
      );
    });

    test('includes custom data in progress', () => {
      const customData = { fileCount: 5, errors: 0 };
      const result = tracker.update(50, 'Halfway', customData);

      expect(result.fileCount).toBe(5);
      expect(result.errors).toBe(0);
      expect(mockWebContents.send).toHaveBeenCalledWith(
        'operation-progress',
        expect.objectContaining(customData),
      );
    });

    test('handles destroyed webContents gracefully', () => {
      mockWebContents.isDestroyed.mockReturnValue(true);

      expect(() => tracker.update(25)).not.toThrow();
      expect(mockWebContents.send).not.toHaveBeenCalled();
    });

    test('handles null webContents gracefully', () => {
      const trackerNoWeb = new ProgressTracker(null, 'test', 100);

      expect(() => trackerNoWeb.update(25)).not.toThrow();
    });

    test('updates lastUpdate timestamp', async () => {
      const before = tracker.lastUpdate;
      // Wait a tiny bit to ensure timestamp changes
      await new Promise((resolve) => setTimeout(resolve, 10));
      tracker.update(25);
      expect(tracker.lastUpdate).toBeGreaterThan(before);
    });

    test('includes elapsed time', () => {
      const result = tracker.update(25);

      expect(result.elapsed).toBeGreaterThanOrEqual(0);
      expect(typeof result.elapsed).toBe('number');
    });
  });

  describe('increment', () => {
    let tracker;

    beforeEach(() => {
      tracker = new ProgressTracker(mockWebContents, 'test', 100);
    });

    test('increments current by 1', () => {
      tracker.current = 10;
      tracker.increment();

      expect(tracker.current).toBe(11);
    });

    test('increments from 0', () => {
      tracker.increment('First item');

      expect(tracker.current).toBe(1);
      expect(mockWebContents.send).toHaveBeenCalledWith(
        'operation-progress',
        expect.objectContaining({
          current: 1,
          message: 'First item',
        }),
      );
    });

    test('increments multiple times', () => {
      tracker.increment();
      tracker.increment();
      tracker.increment();

      expect(tracker.current).toBe(3);
    });

    test('passes message and data through', () => {
      const result = tracker.increment('Processing...', { index: 5 });

      expect(result.message).toBe('Processing...');
      expect(result.index).toBe(5);
    });
  });

  describe('setTotal', () => {
    let tracker;

    beforeEach(() => {
      tracker = new ProgressTracker(mockWebContents, 'test', 0);
    });

    test('updates total dynamically', () => {
      tracker.setTotal(100);

      expect(tracker.total).toBe(100);
    });

    test('recalculates percentage with new total', () => {
      tracker.current = 50;
      tracker.setTotal(100);

      const result = tracker.update(tracker.current);
      expect(result.percentage).toBe(50);
    });

    test('sends update after setting total', () => {
      tracker.setTotal(100);

      expect(mockWebContents.send).toHaveBeenCalled();
    });
  });

  describe('addError', () => {
    let tracker;

    beforeEach(() => {
      tracker = new ProgressTracker(mockWebContents, 'test', 100);
    });

    test('collects error without stopping progress', () => {
      const error = new Error('Test error');
      tracker.addError(error, { index: 5 });

      expect(tracker.errors).toHaveLength(1);
      expect(tracker.errors[0].message).toBe('Test error');
      expect(tracker.errors[0].index).toBe(5);
      expect(tracker.status).toBe('running'); // Still running
    });

    test('sends error notification', () => {
      const error = new Error('Processing failed');
      tracker.addError(error, { file: 'test.txt' });

      expect(mockWebContents.send).toHaveBeenCalledWith(
        'operation-error',
        expect.objectContaining({
          type: 'test',
          error: 'Processing failed',
          context: { file: 'test.txt' },
        }),
      );
    });

    test('handles multiple errors', () => {
      tracker.addError(new Error('Error 1'));
      tracker.addError(new Error('Error 2'));
      tracker.addError(new Error('Error 3'));

      expect(tracker.errors).toHaveLength(3);
      expect(tracker.errors[0].message).toBe('Error 1');
      expect(tracker.errors[1].message).toBe('Error 2');
      expect(tracker.errors[2].message).toBe('Error 3');
    });

    test('includes timestamp with error', () => {
      tracker.addError(new Error('Test'));

      expect(tracker.errors[0].timestamp).toBeLessThanOrEqual(Date.now());
    });

    test('handles non-Error objects', () => {
      tracker.addError('String error');

      expect(tracker.errors[0].message).toBe('String error');
    });

    test('handles destroyed webContents', () => {
      mockWebContents.isDestroyed.mockReturnValue(true);

      expect(() => tracker.addError(new Error('Test'))).not.toThrow();
      expect(mockWebContents.send).not.toHaveBeenCalled();
    });
  });

  describe('complete', () => {
    let tracker;

    beforeEach(() => {
      tracker = new ProgressTracker(mockWebContents, 'test', 100);
    });

    test('marks operation as completed', () => {
      const result = tracker.complete('All done');

      expect(tracker.status).toBe('completed');
      expect(result.message).toBe('All done');
    });

    test('sets current to total', () => {
      tracker.current = 75;
      tracker.complete();

      expect(tracker.current).toBe(100);
    });

    test('includes error count in completion', () => {
      tracker.addError(new Error('Error 1'));
      tracker.addError(new Error('Error 2'));

      const result = tracker.complete();

      expect(result.errorCount).toBe(2);
    });

    test('includes duration in completion', () => {
      const result = tracker.complete();

      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(typeof result.duration).toBe('number');
    });

    test('sends completion event', () => {
      tracker.complete('Finished');

      expect(mockWebContents.send).toHaveBeenCalledWith(
        'operation-complete',
        expect.objectContaining({
          type: 'test',
          status: 'completed',
          message: 'Finished',
        }),
      );
    });

    test('includes custom data in completion', () => {
      const result = tracker.complete('Done', { processed: 100, skipped: 0 });

      expect(result.processed).toBe(100);
      expect(result.skipped).toBe(0);
    });
  });

  describe('fail', () => {
    let tracker;

    beforeEach(() => {
      tracker = new ProgressTracker(mockWebContents, 'test', 100);
    });

    test('marks operation as failed', () => {
      const result = tracker.fail(new Error('Something broke'));

      expect(tracker.status).toBe('failed');
      expect(result.error).toBe('Something broke');
    });

    test('includes duration in failure', () => {
      const result = tracker.fail(new Error('Failed'));

      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    test('sends failure event', () => {
      tracker.fail(new Error('Critical error'));

      expect(mockWebContents.send).toHaveBeenCalledWith(
        'operation-failed',
        expect.objectContaining({
          type: 'test',
          status: 'failed',
          error: 'Critical error',
        }),
      );
    });

    test('handles non-Error objects', () => {
      const result = tracker.fail('String error message');

      expect(result.error).toBe('String error message');
    });

    test('includes custom data in failure', () => {
      const result = tracker.fail(new Error('Failed'), { attemptedFiles: 50 });

      expect(result.attemptedFiles).toBe(50);
    });
  });

  describe('getStatus', () => {
    let tracker;

    beforeEach(() => {
      tracker = new ProgressTracker(mockWebContents, 'test', 100);
    });

    test('returns current status snapshot', () => {
      tracker.current = 50;
      tracker.addError(new Error('Error 1'));

      const status = tracker.getStatus();

      expect(status).toEqual({
        type: 'test',
        current: 50,
        total: 100,
        percentage: 50,
        status: 'running',
        elapsed: expect.any(Number),
        lastUpdate: expect.any(Number),
        errorCount: 1,
        errors: expect.arrayContaining([
          expect.objectContaining({ message: 'Error 1' }),
        ]),
      });
    });

    test('reflects completed status', () => {
      tracker.complete();
      const status = tracker.getStatus();

      expect(status.status).toBe('completed');
    });

    test('reflects failed status', () => {
      tracker.fail(new Error('Failed'));
      const status = tracker.getStatus();

      expect(status.status).toBe('failed');
    });
  });

  describe('createProgressTracker factory', () => {
    test('creates a new ProgressTracker instance', () => {
      const tracker = createProgressTracker(mockWebContents, 'operation', 50);

      expect(tracker).toBeInstanceOf(ProgressTracker);
      expect(tracker.operationType).toBe('operation');
      expect(tracker.total).toBe(50);
    });

    test('creates tracker with default total', () => {
      const tracker = createProgressTracker(mockWebContents, 'operation');

      expect(tracker.total).toBe(0);
    });
  });

  describe('trackProgress helper', () => {
    test('processes items and tracks progress', async () => {
      const items = ['a', 'b', 'c'];
      const processFn = jest.fn(async (item) => item.toUpperCase());

      const result = await trackProgress(
        mockWebContents,
        'batch',
        items,
        processFn,
      );

      expect(result.results).toEqual(['A', 'B', 'C']);
      expect(result.errors).toEqual([]);
      expect(result.summary.successCount).toBe(3);
      expect(result.summary.errorCount).toBe(0);
      expect(processFn).toHaveBeenCalledTimes(3);
    });

    test('sends progress updates for each item', async () => {
      const items = ['a', 'b', 'c'];
      const processFn = jest.fn(async (item) => item.toUpperCase());

      await trackProgress(mockWebContents, 'batch', items, processFn);

      // Should send progress updates: 1/3, 2/3, 3/3, plus complete
      expect(mockWebContents.send).toHaveBeenCalled();
      expect(mockWebContents.send).toHaveBeenCalledWith(
        'operation-progress',
        expect.any(Object),
      );
    });

    test('collects errors without stopping processing', async () => {
      const items = ['a', 'b', 'c', 'd'];
      const processFn = jest.fn(async (item) => {
        if (item === 'b') throw new Error('Failed on b');
        if (item === 'd') throw new Error('Failed on d');
        return item.toUpperCase();
      });

      const result = await trackProgress(
        mockWebContents,
        'batch',
        items,
        processFn,
      );

      expect(result.results).toEqual(['A', 'C']);
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0].error.message).toBe('Failed on b');
      expect(result.errors[1].error.message).toBe('Failed on d');
      expect(result.summary.errorCount).toBe(2);
      expect(processFn).toHaveBeenCalledTimes(4); // All items processed
    });

    test('completes successfully when no errors', async () => {
      const items = ['a', 'b'];
      const processFn = jest.fn(async (item) => item);

      await trackProgress(mockWebContents, 'batch', items, processFn);

      expect(mockWebContents.send).toHaveBeenCalledWith(
        'operation-complete',
        expect.objectContaining({
          successCount: 2,
          errorCount: 0,
        }),
      );
    });

    test('completes with errors message when errors occur', async () => {
      const items = ['a', 'b', 'c'];
      const processFn = jest.fn(async (item) => {
        if (item === 'b') throw new Error('Error');
        return item;
      });

      await trackProgress(mockWebContents, 'batch', items, processFn);

      expect(mockWebContents.send).toHaveBeenCalledWith(
        'operation-complete',
        expect.objectContaining({
          successCount: 2,
          errorCount: 1,
        }),
      );
    });

    test('handles empty items array', async () => {
      const processFn = jest.fn();

      const result = await trackProgress(
        mockWebContents,
        'batch',
        [],
        processFn,
      );

      expect(result.results).toEqual([]);
      expect(result.errors).toEqual([]);
      expect(processFn).not.toHaveBeenCalled();
    });

    test('provides item index to processor', async () => {
      const items = ['a', 'b', 'c'];
      const processFn = jest.fn(async (item, index) => `${item}-${index}`);

      const result = await trackProgress(
        mockWebContents,
        'batch',
        items,
        processFn,
      );

      expect(result.results).toEqual(['a-0', 'b-1', 'c-2']);
      expect(processFn).toHaveBeenCalledWith('a', 0);
      expect(processFn).toHaveBeenCalledWith('b', 1);
      expect(processFn).toHaveBeenCalledWith('c', 2);
    });
  });
});
