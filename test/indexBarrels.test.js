/**
 * Tests that barrel index modules load correctly
 * Ensures re-export barrels have baseline coverage
 */

describe('index barrels', () => {
  test('renderer/components/ui index exports', () => {
    const ui = require('../src/renderer/components/ui');
    expect(ui).toBeDefined();
    expect(ui.Button).toBeDefined();
    expect(ui.Card).toBeDefined();
    expect(ui.Switch).toBeDefined();
  });

  test('renderer/hooks index exports', () => {
    const hooks = require('../src/renderer/hooks');
    expect(hooks.useConfirmDialog).toBeDefined();
    expect(hooks.useFileActions).toBeDefined();
  });

  test('renderer/services/ipc index exports', () => {
    const ipc = require('../src/renderer/services/ipc');
    expect(ipc.getElectronAPI).toBeDefined();
    expect(ipc.filesIpc).toBeDefined();
    expect(ipc.smartFoldersIpc).toBeDefined();
  });
});
