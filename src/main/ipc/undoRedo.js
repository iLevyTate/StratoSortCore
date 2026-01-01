/**
 * Undo/Redo IPC Handlers
 *
 * Handles undo, redo, and action history operations.
 * Demonstrates the service check pattern with fallback responses.
 */
const { createHandler, safeHandle } = require('./ipcWrappers');

function registerUndoRedoIpc({ ipcMain, IPC_CHANNELS, logger, getServiceIntegration }) {
  const context = 'UndoRedo';

  // Helper to get undo/redo service
  const getUndoRedoService = () => getServiceIntegration()?.undoRedo;

  // Undo action
  safeHandle(
    ipcMain,
    IPC_CHANNELS.UNDO_REDO.UNDO,
    createHandler({
      logger,
      context,
      serviceName: 'undoRedo',
      getService: getUndoRedoService,
      fallbackResponse: { success: false, message: 'Undo service unavailable' },
      handler: async (event, service) => {
        try {
          return (
            (await service.undo()) || {
              success: false,
              message: 'Nothing to undo'
            }
          );
        } catch (error) {
          logger.error('Failed to execute undo:', error);
          return { success: false, message: error.message };
        }
      }
    })
  );

  // Redo action
  safeHandle(
    ipcMain,
    IPC_CHANNELS.UNDO_REDO.REDO,
    createHandler({
      logger,
      context,
      serviceName: 'undoRedo',
      getService: getUndoRedoService,
      fallbackResponse: { success: false, message: 'Redo service unavailable' },
      handler: async (event, service) => {
        try {
          return (
            (await service.redo()) || {
              success: false,
              message: 'Nothing to redo'
            }
          );
        } catch (error) {
          logger.error('Failed to execute redo:', error);
          return { success: false, message: error.message };
        }
      }
    })
  );

  // Get action history
  safeHandle(
    ipcMain,
    IPC_CHANNELS.UNDO_REDO.GET_HISTORY,
    createHandler({
      logger,
      context,
      serviceName: 'undoRedo',
      getService: getUndoRedoService,
      fallbackResponse: [],
      handler: async (event, limit = 50, service) => {
        try {
          return (await service.getHistory(limit)) || [];
        } catch (error) {
          logger.error('Failed to get action history:', error);
          return [];
        }
      }
    })
  );

  // Clear action history
  safeHandle(
    ipcMain,
    IPC_CHANNELS.UNDO_REDO.CLEAR_HISTORY,
    createHandler({
      logger,
      context,
      serviceName: 'undoRedo',
      getService: getUndoRedoService,
      fallbackResponse: { success: true },
      handler: async (event, service) => {
        try {
          return (await service.clearHistory()) || { success: true };
        } catch (error) {
          logger.error('Failed to clear action history:', error);
          return { success: false, message: error.message };
        }
      }
    })
  );

  // Check if undo is available
  safeHandle(
    ipcMain,
    IPC_CHANNELS.UNDO_REDO.CAN_UNDO,
    createHandler({
      logger,
      context,
      serviceName: 'undoRedo',
      getService: getUndoRedoService,
      fallbackResponse: false,
      handler: async (event, service) => {
        try {
          return (await service.canUndo()) || false;
        } catch (error) {
          logger.error('Failed to check undo status:', error);
          return false;
        }
      }
    })
  );

  // Check if redo is available
  safeHandle(
    ipcMain,
    IPC_CHANNELS.UNDO_REDO.CAN_REDO,
    createHandler({
      logger,
      context,
      serviceName: 'undoRedo',
      getService: getUndoRedoService,
      fallbackResponse: false,
      handler: async (event, service) => {
        try {
          return (await service.canRedo()) || false;
        } catch (error) {
          logger.error('Failed to check redo status:', error);
          return false;
        }
      }
    })
  );
}

module.exports = registerUndoRedoIpc;
