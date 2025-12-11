jest.mock('fs', () => {
  return require('memfs').fs;
});
jest.mock('fs/promises', () => {
  return require('memfs').fs.promises;
});

const fs = require('fs').promises;
const fssync = require('fs');
const path = require('path');
const os = require('os');

describe('UndoRedoService', () => {
  let tmpDir;
  let electron;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `stratosort-undo-redo-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });
    // jest.resetModules(); // This is likely causing the issue
    electron = require('./mocks/electron');
    electron.app.getPath.mockReturnValue(tmpDir);
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test('memfs is working as expected', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    await fs.writeFile(filePath, 'hello');
    const content = await fs.readFile(filePath, 'utf8');
    expect(content).toBe('hello');
  });

  test('records actions and persists across instances', async () => {
    const UndoRedoService = require('../src/main/services/UndoRedoService');
    const service = new UndoRedoService();

    // Create file paths in temp directory
    const src = path.normalize(path.join(tmpDir, 'original.txt'));
    const dest = path.normalize(path.join(tmpDir, 'moved', 'original.txt'));
    await fs.mkdir(path.dirname(src), { recursive: true });
    await fs.mkdir(path.dirname(dest), { recursive: true }); // Ensure dest directory exists
    await fs.writeFile(src, 'original-content');

    // Record a move action
    const action = {
      type: 'FILE_MOVE',
      data: {
        originalPath: src,
        newPath: dest
      }
    };
    await service.recordAction(action.type, action.data);

    // Manually execute the forward action to simulate the app's behavior
    await service.executeForwardAction(action);
    expect(fssync.existsSync(dest)).toBe(true);
    expect(fssync.existsSync(src)).toBe(false);

    // Undo should move file back to original
    const undoResult = await service.undo();
    expect(undoResult.success).toBe(true);
    expect(fssync.existsSync(src)).toBe(true);
    expect(fssync.existsSync(dest)).toBe(false);

    // Redo should move file again to destination
    const redoResult = await service.redo();
    expect(redoResult.success).toBe(true);
    expect(fssync.existsSync(dest)).toBe(true);

    // History API
    const history = service.getActionHistory(5);
    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBeGreaterThan(0);
    expect(history[history.length - 1].type).toBe('FILE_MOVE');

    // New instance should load persisted actions
    const electronReloaded = require('./mocks/electron');
    electronReloaded.app.getPath.mockReturnValue(tmpDir);
    const UndoRedoServiceReloaded = require('../src/main/services/UndoRedoService');
    const serviceReloaded = new UndoRedoServiceReloaded();
    await serviceReloaded.initialize();
    expect(serviceReloaded.canUndo()).toBe(true);
  });

  test('batch operation undo reverses moves', async () => {
    const UndoRedoService = require('../src/main/services/UndoRedoService');
    const service = new UndoRedoService();

    // Set up two files moved to new paths
    const aSrc = path.normalize(path.join(tmpDir, 'A.txt'));
    const aDest = path.normalize(path.join(tmpDir, 'out', 'A.txt'));
    const bSrc = path.normalize(path.join(tmpDir, 'B.txt'));
    const bDest = path.normalize(path.join(tmpDir, 'out', 'B.txt'));
    await fs.mkdir(path.join(tmpDir, 'out'), { recursive: true });
    await fs.writeFile(aSrc, 'A');
    await fs.writeFile(bSrc, 'B');

    const batchAction = {
      type: 'BATCH_OPERATION',
      data: {
        operations: [
          { type: 'move', originalPath: aSrc, newPath: aDest },
          { type: 'move', originalPath: bSrc, newPath: bDest }
        ]
      }
    };
    await service.recordAction(batchAction.type, batchAction.data);

    // Manually execute the forward action
    await service.executeForwardAction(batchAction);
    expect(fssync.existsSync(aDest)).toBe(true);
    expect(fssync.existsSync(bDest)).toBe(true);

    await service.undo();
    expect(fssync.existsSync(aSrc)).toBe(true);
    expect(fssync.existsSync(bSrc)).toBe(true);
    expect(fssync.existsSync(aDest)).toBe(false);
    expect(fssync.existsSync(bDest)).toBe(false);
  });
});
