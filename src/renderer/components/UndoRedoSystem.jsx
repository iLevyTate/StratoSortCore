// Undo/Redo System - Implementing Shneiderman's Golden Rule #6: Action Reversal Infrastructure
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import {
  FileText,
  Trash2,
  Edit2,
  FolderPlus,
  FolderMinus,
  FileEdit,
  Settings,
  Search,
  Package
} from 'lucide-react';
import { createLogger } from '../../shared/logger';
import Modal, { ConfirmModal } from './ui/Modal';
import { useNotification } from '../contexts/NotificationContext';
import { ACTION_TYPES as SHARED_ACTION_TYPES } from '../../shared/constants';
import Button from './ui/Button';
import StateMessage from './ui/StateMessage';
import { Text } from './ui/Typography';

const logger = createLogger('UndoRedoSystem');

const generateSecureId = () => {
  const array = new Uint8Array(6);
  crypto.getRandomValues(array);
  return `action-${Date.now()}-${Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('')}`;
};

const UndoRedoContext = createContext();
const ACTION_TYPES = SHARED_ACTION_TYPES;

const ACTION_METADATA = {
  [ACTION_TYPES.FILE_MOVE]: {
    description: 'Move file',
    icon: FileText,
    category: 'File Operations'
  },
  [ACTION_TYPES.FILE_DELETE]: {
    description: 'Delete file',
    icon: Trash2,
    category: 'File Operations'
  },
  [ACTION_TYPES.FILE_RENAME]: {
    description: 'Rename file',
    icon: Edit2,
    category: 'File Operations'
  },
  [ACTION_TYPES.FOLDER_CREATE]: {
    description: 'Create folder',
    icon: FolderPlus,
    category: 'Folder Operations'
  },
  [ACTION_TYPES.FOLDER_DELETE]: {
    description: 'Delete folder',
    icon: FolderMinus,
    category: 'Folder Operations'
  },
  [ACTION_TYPES.FOLDER_RENAME]: {
    description: 'Rename folder',
    icon: FileEdit,
    category: 'Folder Operations'
  },
  [ACTION_TYPES.SETTINGS_CHANGE]: {
    description: 'Change settings',
    icon: Settings,
    category: 'Configuration'
  },
  [ACTION_TYPES.ANALYSIS_RESULT]: {
    description: 'File analysis',
    icon: Search,
    category: 'Analysis'
  },
  [ACTION_TYPES.BATCH_OPERATION]: {
    description: 'Batch operation',
    icon: Package,
    category: 'Batch Operations'
  }
};

export const createFileAction = ({ actionType, description, source, destination }) => ({
  type: actionType,
  description,
  execute: async () => {
    if (destination) {
      return await window.electronAPI.files.performOperation({
        type: 'move',
        source,
        destination
      });
    }
    throw new Error('Unsupported operation: destination required for move');
  },
  undo: async () => {
    if (destination) {
      return await window.electronAPI.files.performOperation({
        type: 'move',
        source: destination,
        destination: source
      });
    }
    throw new Error('Unsupported undo operation');
  },
  metadata: { source, destination }
});

export const createSettingsAction = (description, newSettings, oldSettings) => ({
  type: ACTION_TYPES.SETTINGS_CHANGE,
  description,
  execute: async () => {
    return await window.electronAPI.settings.save(newSettings);
  },
  undo: async () => {
    return await window.electronAPI.settings.save(oldSettings);
  },
  metadata: { newSettings, oldSettings }
});

export const createOrganizeBatchAction = (description, operations, stateCallbacks = {}) => ({
  type: ACTION_TYPES.BATCH_OPERATION,
  description,
  execute: async () => {
    const result = await window.electronAPI.files.performOperation({
      type: 'batch_organize',
      operations
    });
    if (stateCallbacks.onExecute) {
      try {
        stateCallbacks.onExecute(result);
      } catch {
        // Non-fatal if state callback fails
      }
    }
    return result;
  },
  undo: async (action) => {
    if (action && action.result && action.result.results) {
      const reverseOps = action.result.results
        .filter((r) => r.success && r.source && r.destination)
        .map((r) => ({
          source: r.destination,
          destination: r.source
        }));

      if (reverseOps.length > 0) {
        const result = await window.electronAPI.files.performOperation({
          type: 'batch_organize',
          operations: reverseOps
        });

        if (stateCallbacks.onUndo) {
          try {
            stateCallbacks.onUndo(result);
          } catch {
            // Non-fatal if state callback fails
          }
        }
        return result;
      }
    }

    const result = await window.electronAPI.undoRedo.undo();
    if (stateCallbacks.onUndo) {
      try {
        stateCallbacks.onUndo(result);
      } catch {
        // Non-fatal if state callback fails
      }
    }
    return result;
  },
  redo: async (action) => {
    const opsToRun = (action && action.metadata && action.metadata.operations) || operations;

    if (opsToRun && opsToRun.length > 0) {
      const result = await window.electronAPI.files.performOperation({
        type: 'batch_organize',
        operations: opsToRun
      });

      if (stateCallbacks.onRedo) {
        try {
          stateCallbacks.onRedo(result);
        } catch {
          // Non-fatal
        }
      }
      return result;
    }

    const result = await window.electronAPI.undoRedo.redo();
    if (stateCallbacks.onRedo) {
      try {
        stateCallbacks.onRedo(result);
      } catch {
        // Non-fatal if state callback fails
      }
    }
    return result;
  },
  metadata: {
    operationCount: Array.isArray(operations) ? operations.length : 0,
    operations: operations
  }
});

const rehydrateAction = (serializedAction) => {
  const { type, metadata, description } = serializedAction;

  try {
    if (type === ACTION_TYPES.BATCH_OPERATION) {
      if (metadata && metadata.operations) {
        return createOrganizeBatchAction(description, metadata.operations);
      }
    }

    if (
      type === ACTION_TYPES.FILE_MOVE ||
      type === ACTION_TYPES.FILE_DELETE ||
      type === ACTION_TYPES.FILE_RENAME ||
      type === ACTION_TYPES.FOLDER_CREATE ||
      type === ACTION_TYPES.FOLDER_DELETE ||
      type === ACTION_TYPES.FOLDER_RENAME
    ) {
      return createFileAction({
        actionType: type,
        description,
        source: metadata?.source,
        destination: metadata?.destination
      });
    }

    if (type === ACTION_TYPES.SETTINGS_CHANGE) {
      return createSettingsAction(description, metadata?.newSettings, metadata?.oldSettings);
    }
  } catch (err) {
    logger.error('Failed to rehydrate action', { type, error: err.message });
  }

  return null;
};

class UndoStack {
  constructor(maxSize = 100) {
    this.stack = [];
    this.pointer = -1;
    this.maxSize = maxSize;
    this.listeners = new Set();
  }

  push(action) {
    this.stack = this.stack.slice(0, this.pointer + 1);

    this.stack.push({
      ...action,
      id: generateSecureId(),
      timestamp: new Date().toISOString()
    });

    if (this.stack.length > this.maxSize) {
      this.stack.shift();
    } else {
      this.pointer++;
    }

    this.notifyListeners();
  }

  canUndo() {
    return this.pointer >= 0;
  }

  canRedo() {
    return this.pointer < this.stack.length - 1;
  }

  undo() {
    if (!this.canUndo()) return null;

    const action = this.stack[this.pointer];
    this.pointer--;
    this.notifyListeners();

    return action;
  }

  redo() {
    if (!this.canRedo()) return null;

    this.pointer++;
    const action = this.stack[this.pointer];
    this.notifyListeners();

    return action;
  }

  revertRedo() {
    if (this.pointer >= 0) {
      this.pointer--;
      this.notifyListeners();
    }
  }

  peek() {
    return this.canUndo() ? this.stack[this.pointer] : null;
  }

  peekRedo() {
    return this.canRedo() ? this.stack[this.pointer + 1] : null;
  }

  getHistory() {
    return this.stack.slice(0, this.pointer + 1);
  }

  getFullStack() {
    return this.stack.slice();
  }

  getCurrentIndex() {
    return this.pointer;
  }

  setPointer(newPointer) {
    if (newPointer >= -1 && newPointer < this.stack.length) {
      this.pointer = newPointer;
      this.notifyListeners();
    }
  }

  clear() {
    this.stack = [];
    this.pointer = -1;
    this.notifyListeners();
  }

  load(savedStack, savedPointer) {
    if (Array.isArray(savedStack)) {
      this.stack = savedStack;
      this.pointer = typeof savedPointer === 'number' ? savedPointer : savedStack.length - 1;
      this.notifyListeners();
    }
  }

  addListener(listener) {
    this.listeners.add(listener);
  }

  removeListener(listener) {
    this.listeners.delete(listener);
  }

  notifyListeners() {
    this.listeners.forEach((listener) => listener());
  }
}

export function UndoRedoProvider({ children }) {
  const [undoStack] = useState(() => new UndoStack());
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [isHistoryVisible, setIsHistoryVisible] = useState(false);
  const [fullStackState, setFullStackState] = useState([]);
  const [currentIndexState, setCurrentIndexState] = useState(-1);
  const { showSuccess, showError, showInfo } = useNotification();

  const isMountedRef = React.useRef(true);
  React.useEffect(() => {
    isMountedRef.current = true;

    try {
      const saved = localStorage.getItem('stratosort_undo_stack');
      if (saved) {
        const { stack, pointer } = JSON.parse(saved);
        if (Array.isArray(stack)) {
          const rehydratedStack = stack
            .map((item) => {
              const action = rehydrateAction(item);
              return action ? { ...item, ...action } : null;
            })
            .filter(Boolean);

          if (rehydratedStack.length > 0) {
            undoStack.load(rehydratedStack, pointer);
          }
        }
      }
    } catch (e) {
      logger.error('Failed to load undo stack', e);
    }

    return () => {
      isMountedRef.current = false;
    };
  }, [undoStack]);

  const actionMutexRef = React.useRef(false);
  const [isExecuting, setIsExecuting] = useState(false);

  const [confirmState, setConfirmState] = useState({
    isOpen: false,
    title: '',
    message: '',
    confirmText: 'Confirm',
    cancelText: 'Cancel',
    variant: 'default',
    onConfirm: null,
    onClose: null
  });

  const showConfirm = useCallback(
    ({
      title = 'Confirm Action',
      message = '',
      confirmText = 'Confirm',
      cancelText = 'Cancel',
      variant = 'default'
    }) => {
      return new Promise((resolve) => {
        setConfirmState({
          isOpen: true,
          title,
          message,
          confirmText,
          cancelText,
          variant,
          onConfirm: () => {
            resolve(true);
            setConfirmState((prev) => ({ ...prev, isOpen: false }));
          },
          onClose: () => {
            resolve(false);
            setConfirmState((prev) => ({ ...prev, isOpen: false }));
          }
        });
      });
    },
    []
  );

  const updateState = useCallback(() => {
    if (!isMountedRef.current) return;
    setCanUndo(undoStack.canUndo());
    setCanRedo(undoStack.canRedo());
    const stack = undoStack.getFullStack();
    const pointer = undoStack.getCurrentIndex();

    setFullStackState(stack);
    setCurrentIndexState(pointer);

    try {
      const simplifiedStack = stack.map((item) => ({
        id: item.id,
        timestamp: item.timestamp,
        type: item.type,
        description: item.description,
        metadata: item.metadata,
        result: item.result
      }));

      localStorage.setItem(
        'stratosort_undo_stack',
        JSON.stringify({
          stack: simplifiedStack,
          pointer
        })
      );
    } catch (e) {
      logger.error('Failed to save undo stack', e);
    }
  }, [undoStack]);

  useEffect(() => {
    undoStack.addListener(updateState);
    return () => undoStack.removeListener(updateState);
  }, [undoStack, updateState]);

  const executeAction = useCallback(
    async (actionConfig) => {
      if (actionMutexRef.current) {
        showInfo('Please wait for the current action to complete');
        return null;
      }

      actionMutexRef.current = true;
      setIsExecuting(true);

      try {
        const result = await actionConfig.execute();

        undoStack.push({
          type: actionConfig.type,
          description: actionConfig.description,
          undo: actionConfig.undo,
          redo: actionConfig.redo || actionConfig.execute,
          metadata: actionConfig.metadata || {},
          result
        });

        showSuccess(`${actionConfig.description} completed`);

        return result;
      } catch (error) {
        showError(
          `Failed to ${actionConfig.description.toLowerCase()}: ${error?.message || String(error)}`
        );
        throw error;
      } finally {
        actionMutexRef.current = false;
        if (isMountedRef.current) {
          setIsExecuting(false);
        }
      }
    },
    [undoStack, showInfo, showSuccess, showError]
  );

  const undo = useCallback(async () => {
    if (actionMutexRef.current) {
      showInfo('Please wait for the current action to complete');
      return;
    }

    const action = undoStack.peek();
    if (!action) return;

    if (
      action.description &&
      (action.description.toLowerCase().includes('organize') ||
        action.description.toLowerCase().includes('move') ||
        action.description.toLowerCase().includes('delete'))
    ) {
      const confirmed = await showConfirm({
        title: 'Undo Operation',
        message: (
          <>
            <p>Are you sure you want to undo: &quot;{action.description}&quot;?</p>
            <p className="mt-2">
              This will reverse the file operation and move files back to their original locations.
            </p>
          </>
        ),
        confirmText: 'Undo',
        cancelText: 'Cancel',
        variant: 'warning'
      });
      if (!confirmed) {
        return;
      }
    }

    actionMutexRef.current = true;
    setIsExecuting(true);

    const undoAction = undoStack.undo();
    if (!undoAction) {
      actionMutexRef.current = false;
      if (isMountedRef.current) setIsExecuting(false);
      return;
    }

    try {
      await undoAction.undo(undoAction);
      showSuccess(`Undid: ${undoAction.description}`);
    } catch (error) {
      undoStack.push(undoAction);
      showError(`Failed to undo ${undoAction.description}: ${error?.message || String(error)}`);
    } finally {
      actionMutexRef.current = false;
      if (isMountedRef.current) setIsExecuting(false);
    }
  }, [undoStack, showInfo, showConfirm, showSuccess, showError]);

  const redo = useCallback(async () => {
    if (actionMutexRef.current) {
      showInfo('Please wait for the current action to complete');
      return;
    }

    actionMutexRef.current = true;
    setIsExecuting(true);

    const action = undoStack.redo();
    if (!action) {
      actionMutexRef.current = false;
      if (isMountedRef.current) setIsExecuting(false);
      return;
    }

    try {
      await action.redo(action);
      showSuccess(`Redid: ${action.description}`);
    } catch (error) {
      undoStack.revertRedo();
      showError(`Failed to redo ${action.description}: ${error?.message || String(error)}`);
    } finally {
      actionMutexRef.current = false;
      if (isMountedRef.current) setIsExecuting(false);
    }
  }, [undoStack, showInfo, showSuccess, showError]);

  const getActionDescription = (action) => {
    const metadata = ACTION_METADATA[action.type];
    if (metadata) {
      return action.description || metadata.description;
    }
    return action.description || 'Unknown action';
  };

  const clearHistory = useCallback(() => {
    undoStack.clear();
    localStorage.removeItem('stratosort_undo_stack');
    showInfo('Undo/redo history cleared');
  }, [undoStack, showInfo]);

  const jumpToPoint = useCallback(
    async (targetIndex) => {
      if (actionMutexRef.current) {
        showInfo('Please wait for the current action to complete');
        return;
      }

      const currentIndex = undoStack.getCurrentIndex();
      if (targetIndex === currentIndex) {
        return;
      }

      const fullStack = undoStack.getFullStack();
      if (targetIndex < -1 || targetIndex >= fullStack.length) {
        showError('Invalid history point');
        return;
      }

      actionMutexRef.current = true;
      setIsExecuting(true);

      try {
        if (targetIndex < currentIndex) {
          const stepsToUndo = currentIndex - targetIndex;
          showInfo(`Jumping back ${stepsToUndo} step${stepsToUndo > 1 ? 's' : ''}...`);

          for (let i = 0; i < stepsToUndo; i++) {
            const action = undoStack.undo();
            if (action) {
              await action.undo(action);
            }
          }
          showSuccess(`Jumped back to step ${targetIndex + 1}`);
        } else {
          const stepsToRedo = targetIndex - currentIndex;
          showInfo(`Jumping forward ${stepsToRedo} step${stepsToRedo > 1 ? 's' : ''}...`);

          for (let i = 0; i < stepsToRedo; i++) {
            const action = undoStack.redo();
            if (action) {
              await action.redo(action);
            }
          }
          showSuccess(`Jumped forward to step ${targetIndex + 1}`);
        }
      } catch (error) {
        showError(`Jump failed: ${error?.message || String(error)}`);
      } finally {
        actionMutexRef.current = false;
        if (isMountedRef.current) setIsExecuting(false);
      }
    },
    [undoStack, showInfo, showSuccess, showError]
  );

  const contextValue = {
    executeAction,
    undo,
    redo,
    canUndo,
    canRedo,
    isExecuting,
    getHistory: () => undoStack.getHistory(),
    getFullStack: () => undoStack.getFullStack(),
    getCurrentIndex: () => undoStack.getCurrentIndex(),
    fullStack: fullStackState,
    currentIndex: currentIndexState,
    jumpToPoint,
    peek: () => undoStack.peek(),
    peekRedo: () => undoStack.peekRedo(),
    getActionDescription,
    clearHistory,
    isHistoryVisible,
    setIsHistoryVisible
  };

  return (
    <UndoRedoContext.Provider value={contextValue}>
      {children}
      {isHistoryVisible && <HistoryModal />}
      <ConfirmModal
        isOpen={confirmState.isOpen}
        onClose={
          confirmState.onClose || (() => setConfirmState((prev) => ({ ...prev, isOpen: false })))
        }
        onConfirm={
          confirmState.onConfirm || (() => setConfirmState((prev) => ({ ...prev, isOpen: false })))
        }
        title={confirmState.title}
        message={confirmState.message}
        confirmText={confirmState.confirmText}
        cancelText={confirmState.cancelText}
        variant={confirmState.variant}
      />
    </UndoRedoContext.Provider>
  );
}

UndoRedoProvider.propTypes = {
  children: PropTypes.node.isRequired
};

export function useUndoRedo() {
  const context = useContext(UndoRedoContext);
  if (!context) {
    throw new Error('useUndoRedo must be used within an UndoRedoProvider');
  }
  return context;
}

function HistoryModal() {
  const { fullStack, currentIndex, jumpToPoint, setIsHistoryVisible, clearHistory, isExecuting } =
    useUndoRedo();

  const handleJumpToPoint = async (targetIndex) => {
    await jumpToPoint(targetIndex);
  };

  return (
    <Modal
      isOpen={true}
      onClose={() => setIsHistoryVisible(false)}
      title="Action History"
      size="md"
      className="max-h-[85vh]"
    >
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-border-soft/60">
        <Text variant="small" className="text-system-gray-600">
          Click any action to jump to that point in time.
        </Text>
        <Button
          onClick={clearHistory}
          variant="danger"
          size="sm"
          disabled={isExecuting}
          title="Clear all history"
        >
          Clear History
        </Button>
      </div>

      <div className="space-y-2">
        {fullStack.length === 0 ? (
          <StateMessage
            icon={FileText}
            tone="neutral"
            size="lg"
            title="No actions recorded"
            description="Actions you take will appear here."
            className="text-center p-8 bg-system-gray-50/50 rounded-xl border border-dashed border-border-soft"
            contentClassName="max-w-sm"
          />
        ) : (
          <div className="relative pl-2">
            <div className="absolute left-[35px] top-6 bottom-6 w-0.5 bg-border-soft/50 -z-10" />

            {fullStack
              .slice()
              .reverse()
              .map((action, reversedIndex) => {
                const actualIndex = fullStack.length - 1 - reversedIndex;
                const isCurrent = actualIndex === currentIndex;
                const isFuture = actualIndex > currentIndex;

                const IconComponent = ACTION_METADATA[action.type]?.icon || FileText;

                return (
                  <button
                    key={action.id}
                    onClick={() => handleJumpToPoint(actualIndex)}
                    disabled={isExecuting || isCurrent}
                    className={`
                      w-full flex items-center gap-4 p-3 rounded-xl transition-all text-left group relative
                      ${
                        isCurrent
                          ? 'bg-stratosort-blue/5 border border-stratosort-blue/30 shadow-sm ring-1 ring-stratosort-blue/20 z-10'
                          : 'hover:bg-system-gray-50 border border-transparent hover:border-border-soft bg-white'
                      }
                      ${isFuture ? 'opacity-60 grayscale-[0.5]' : ''}
                      ${isExecuting ? 'cursor-wait opacity-50' : ''}
                    `}
                  >
                    <div
                      className={`
                      relative flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center border transition-colors
                      ${
                        isCurrent
                          ? 'bg-stratosort-blue text-white border-stratosort-blue shadow-md shadow-stratosort-blue/20'
                          : isFuture
                            ? 'bg-white text-system-gray-400 border-border-soft'
                            : 'bg-white text-system-gray-600 border-border-soft group-hover:border-stratosort-blue/30 group-hover:text-stratosort-blue'
                      }
                    `}
                    >
                      <IconComponent className="w-5 h-5" />
                      {isCurrent && (
                        <span className="absolute -right-1 -top-1 w-3 h-3 bg-stratosort-success border-2 border-white rounded-full shadow-sm" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`font-medium truncate ${isCurrent ? 'text-stratosort-blue' : 'text-system-gray-900'}`}
                        >
                          {action.description}
                        </span>
                        <Text
                          as="span"
                          variant="tiny"
                          className="text-[10px] text-system-gray-400 flex-shrink-0 font-mono"
                        >
                          #{actualIndex + 1}
                        </Text>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Text as="span" variant="tiny" className="text-system-gray-500">
                          {new Date(action.timestamp).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </Text>
                        {isCurrent && (
                          <Text
                            as="span"
                            variant="tiny"
                            className="text-[10px] font-semibold bg-stratosort-blue/10 text-stratosort-blue px-1.5 py-0.5 rounded-full border border-stratosort-blue/10"
                          >
                            Current State
                          </Text>
                        )}
                        {isFuture && (
                          <Text
                            as="span"
                            variant="tiny"
                            className="text-[10px] font-medium bg-system-gray-100 text-system-gray-500 px-1.5 py-0.5 rounded-full border border-border-soft"
                          >
                            Undone
                          </Text>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
          </div>
        )}
      </div>
    </Modal>
  );
}

export function UndoRedoToolbar({ className = '' }) {
  const {
    undo,
    redo,
    canUndo,
    canRedo,
    peek,
    peekRedo,
    getActionDescription,
    setIsHistoryVisible
  } = useUndoRedo();

  const lastAction = peek();
  const nextAction = peekRedo();

  const isImportantOperation =
    lastAction?.description &&
    (lastAction.description.toLowerCase().includes('organize') ||
      lastAction.description.toLowerCase().includes('move') ||
      lastAction.description.toLowerCase().includes('delete'));

  return (
    <div className={`flex items-center space-x-2 ${className}`}>
      <Button
        onClick={undo}
        disabled={!canUndo}
        variant="secondary"
        size="sm"
        className={
          isImportantOperation
            ? 'text-stratosort-warning hover:bg-stratosort-warning/10 border-stratosort-warning/20'
            : ''
        }
        title={
          lastAction
            ? `Undo: ${getActionDescription(lastAction)}${isImportantOperation ? ' (Will ask for confirmation)' : ''}`
            : 'Nothing to undo'
        }
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
          />
        </svg>
      </Button>

      <Button
        onClick={redo}
        disabled={!canRedo}
        variant="secondary"
        size="sm"
        title={nextAction ? `Redo: ${getActionDescription(nextAction)}` : 'Nothing to redo'}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 10h-10a8 8 0 00-8 8v2m18-10l-6 6m6-6l-6-6"
          />
        </svg>
      </Button>

      <div className="w-px h-6 bg-system-gray-300 mx-1" />

      <Button
        onClick={() => setIsHistoryVisible(true)}
        variant="ghost"
        size="sm"
        title="View action history"
        aria-label="View action history"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </Button>
    </div>
  );
}

UndoRedoToolbar.propTypes = {
  className: PropTypes.string
};

export const createBatchAction = (description, actions) => ({
  type: ACTION_TYPES.BATCH_OPERATION,
  description,
  execute: async () => {
    const results = [];
    for (const action of actions) {
      results.push(await action.execute());
    }
    return results;
  },
  undo: async () => {
    const results = [];
    for (const action of actions.slice().reverse()) {
      results.push(await action.undo());
    }
    return results;
  },
  metadata: { actionCount: actions.length }
});

export default {
  UndoRedoProvider,
  useUndoRedo,
  UndoRedoToolbar,
  ACTION_TYPES,
  createFileAction,
  createSettingsAction,
  createOrganizeBatchAction,
  createBatchAction
};
