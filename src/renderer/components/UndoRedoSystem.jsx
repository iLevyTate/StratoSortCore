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
import { logger } from '../../shared/logger';
import { ConfirmModal } from './Modal';
import { useNotification } from '../contexts/NotificationContext';

// Use shared action type constants so renderer/main/tests are aligned
import { ACTION_TYPES as SHARED_ACTION_TYPES } from '../../shared/constants';

// Set logger context for this component
logger.setContext('UndoRedoSystem');

// Secure random ID generator using Web Crypto API
const generateSecureId = () => {
  const array = new Uint8Array(6);
  crypto.getRandomValues(array);
  return `action-${Date.now()}-${Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('')}`;
};

// Undo/Redo Context
const UndoRedoContext = createContext();
const ACTION_TYPES = SHARED_ACTION_TYPES;

// Action metadata for user-friendly descriptions
// UI-2 FIX: Replace emojis with Lucide icons for professional appearance
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

// Undo Stack Manager
class UndoStack {
  constructor(maxSize = 100) {
    this.stack = [];
    this.pointer = -1;
    this.maxSize = maxSize;
    this.listeners = new Set();
  }

  push(action) {
    // Remove any actions after current pointer (when undoing then doing new action)
    this.stack = this.stack.slice(0, this.pointer + 1);

    // Add new action
    this.stack.push({
      ...action,
      id: generateSecureId(),
      timestamp: new Date().toISOString()
    });

    // Maintain max size
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

  /**
   * Revert a redo operation when the actual action execution fails
   * This safely moves the pointer back without modifying the stack
   */
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

  // FIX L-2: Get the full stack and current pointer for jump-to-point feature
  getFullStack() {
    return this.stack.slice();
  }

  getCurrentIndex() {
    return this.pointer;
  }

  // FIX L-2: Set pointer directly (for use with jumpToPoint which handles execution externally)
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

// Undo/Redo Provider Component
export function UndoRedoProvider({ children }) {
  const [undoStack] = useState(() => new UndoStack());
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [isHistoryVisible, setIsHistoryVisible] = useState(false);
  // FIX: Track full stack and current index as state so HistoryModal re-renders when stack changes
  const [fullStackState, setFullStackState] = useState([]);
  const [currentIndexState, setCurrentIndexState] = useState(-1);
  const { showSuccess, showError, showInfo } = useNotification();

  // FIX: Track mounted state to prevent listener updates after unmount
  const isMountedRef = React.useRef(true);
  React.useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // FIX: Add mutex to prevent concurrent action execution
  const actionMutexRef = React.useRef(false);
  const [isExecuting, setIsExecuting] = useState(false);

  // Local confirmation dialog state for nicer UX than window.confirm
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

  // Update state when stack changes
  const updateState = useCallback(() => {
    // FIX: Check mounted state before updating to prevent memory leak warnings
    if (!isMountedRef.current) return;
    setCanUndo(undoStack.canUndo());
    setCanRedo(undoStack.canRedo());
    // FIX: Update full stack and current index state for HistoryModal reactivity
    setFullStackState(undoStack.getFullStack());
    setCurrentIndexState(undoStack.getCurrentIndex());
  }, [undoStack]);

  useEffect(() => {
    undoStack.addListener(updateState);
    return () => undoStack.removeListener(updateState);
  }, [undoStack, updateState]);

  // Execute action with undo capability
  // FIX: Added mutex to prevent concurrent action execution
  const executeAction = async (actionConfig) => {
    // Prevent concurrent actions
    if (actionMutexRef.current) {
      showInfo('Please wait for the current action to complete');
      return null;
    }

    actionMutexRef.current = true;
    setIsExecuting(true);

    try {
      // Execute the action
      const result = await actionConfig.execute();

      // Add to undo stack if successful
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
  };

  // Undo last action with confirmation for important operations
  // FIX: Added mutex check to prevent concurrent operations
  const undo = async () => {
    if (actionMutexRef.current) {
      showInfo('Please wait for the current action to complete');
      return;
    }

    const action = undoStack.peek();
    if (!action) return;

    // Show confirmation for important operations (like file organization)
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
        return; // User cancelled the undo
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
      await undoAction.undo();
      showSuccess(`Undid: ${undoAction.description}`);
    } catch (error) {
      // If undo fails, restore the action to the stack
      undoStack.push(undoAction);
      showError(`Failed to undo ${undoAction.description}: ${error?.message || String(error)}`);
    } finally {
      actionMutexRef.current = false;
      if (isMountedRef.current) setIsExecuting(false);
    }
  };

  // Redo last undone action
  // FIX: Added mutex check to prevent concurrent operations
  const redo = async () => {
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
      await action.redo();
      showSuccess(`Redid: ${action.description}`);
    } catch (error) {
      // If redo fails, safely revert the pointer using the class method
      undoStack.revertRedo();
      showError(`Failed to redo ${action.description}: ${error?.message || String(error)}`);
    } finally {
      actionMutexRef.current = false;
      if (isMountedRef.current) setIsExecuting(false);
    }
  };

  // Get action description for UI (text only - icons are rendered separately)
  const getActionDescription = (action) => {
    const metadata = ACTION_METADATA[action.type];
    if (metadata) {
      return action.description || metadata.description;
    }
    return action.description || 'Unknown action';
  };

  // Clear history
  const clearHistory = () => {
    undoStack.clear();
    showInfo('Undo/redo history cleared');
  };

  // FIX L-2: Jump to a specific point in history by performing sequential undos/redos
  const jumpToPoint = async (targetIndex) => {
    if (actionMutexRef.current) {
      showInfo('Please wait for the current action to complete');
      return;
    }

    const currentIndex = undoStack.getCurrentIndex();
    if (targetIndex === currentIndex) {
      return; // Already at this point
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
        // Need to undo: go backwards from current to target
        const stepsToUndo = currentIndex - targetIndex;
        showInfo(`Jumping back ${stepsToUndo} step${stepsToUndo > 1 ? 's' : ''}...`);

        for (let i = 0; i < stepsToUndo; i++) {
          const action = undoStack.undo();
          if (action) {
            await action.undo();
          }
        }
        showSuccess(`Jumped back to step ${targetIndex + 1}`);
      } else {
        // Need to redo: go forwards from current to target
        const stepsToRedo = targetIndex - currentIndex;
        showInfo(`Jumping forward ${stepsToRedo} step${stepsToRedo > 1 ? 's' : ''}...`);

        for (let i = 0; i < stepsToRedo; i++) {
          const action = undoStack.redo();
          if (action) {
            await action.redo();
          }
        }
        showSuccess(`Jumped forward to step ${targetIndex + 1}`);
      }
    } catch (error) {
      showError(`Jump failed: ${error?.message || String(error)}`);
      // Note: The stack pointer may be in an intermediate state here.
      // A full refresh or manual undo/redo may be needed to recover.
    } finally {
      actionMutexRef.current = false;
      if (isMountedRef.current) setIsExecuting(false);
    }
  };

  const contextValue = {
    executeAction,
    undo,
    redo,
    canUndo,
    canRedo,
    isExecuting, // FIX: Expose execution state to prevent UI race conditions
    getHistory: () => undoStack.getHistory(),
    // FIX L-2: Expose full stack and current index for jump-to-point UI
    getFullStack: () => undoStack.getFullStack(),
    getCurrentIndex: () => undoStack.getCurrentIndex(),
    // FIX: Expose reactive state for full stack and current index so HistoryModal re-renders
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
      {/* Confirmation dialog for Undo/Redo provider */}
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

// Hook to use undo/redo
export function useUndoRedo() {
  const context = useContext(UndoRedoContext);
  if (!context) {
    throw new Error('useUndoRedo must be used within an UndoRedoProvider');
  }
  return context;
}

// History Modal Component
// FIX L-2: Enhanced with jump-to-point functionality
function HistoryModal() {
  const {
    // FIX: Use reactive state values instead of getter functions so component re-renders when stack changes
    fullStack,
    currentIndex,
    jumpToPoint,
    setIsHistoryVisible,
    clearHistory,
    isExecuting
  } = useUndoRedo();

  const handleJumpToPoint = async (targetIndex) => {
    await jumpToPoint(targetIndex);
  };

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-modal"
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 2147483645
      }}
    >
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden">
        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h2 className="text-xl font-semibold text-system-gray-900">Action History</h2>
            <p className="text-sm text-system-gray-500 mt-1">
              Click any action to jump to that point
            </p>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={clearHistory}
              className="px-3 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
              disabled={isExecuting}
            >
              Clear History
            </button>
            <button
              onClick={() => setIsHistoryVisible(false)}
              className="text-system-gray-400 hover:text-system-gray-600 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto max-h-[60vh]">
          {fullStack.length === 0 ? (
            <div className="text-center py-8 text-system-gray-500">
              <svg
                className="w-12 h-12 mx-auto mb-4 text-system-gray-300"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                />
              </svg>
              <p>No actions in history</p>
            </div>
          ) : (
            <div className="space-y-2">
              {fullStack
                .slice()
                .reverse()
                .map((action, reversedIndex) => {
                  const actualIndex = fullStack.length - 1 - reversedIndex;
                  const isCurrent = actualIndex === currentIndex;
                  const isPast = actualIndex <= currentIndex;
                  const isFuture = actualIndex > currentIndex;

                  return (
                    <button
                      key={action.id}
                      onClick={() => handleJumpToPoint(actualIndex)}
                      disabled={isExecuting || isCurrent}
                      className={`
                        w-full flex items-center justify-between p-3 rounded-lg transition-all text-left
                        ${isCurrent ? 'bg-stratosort-blue/10 border-2 border-stratosort-blue ring-2 ring-stratosort-blue/20' : ''}
                        ${isPast && !isCurrent ? 'bg-system-gray-50 hover:bg-system-gray-100 border border-transparent hover:border-system-gray-200 cursor-pointer' : ''}
                        ${isFuture ? 'bg-system-gray-50/50 hover:bg-system-gray-100 border border-dashed border-system-gray-200 opacity-60 hover:opacity-100 cursor-pointer' : ''}
                        ${isExecuting ? 'cursor-wait opacity-50' : ''}
                      `}
                      title={
                        isCurrent
                          ? 'Current position'
                          : isFuture
                            ? `Click to redo to this point (${actualIndex - currentIndex} step${actualIndex - currentIndex > 1 ? 's' : ''} forward)`
                            : `Click to undo to this point (${currentIndex - actualIndex} step${currentIndex - actualIndex > 1 ? 's' : ''} back)`
                      }
                    >
                      <div className="flex items-center space-x-3">
                        <span className="text-lg flex items-center">
                          {(() => {
                            const IconComponent = ACTION_METADATA[action.type]?.icon || FileText;
                            return <IconComponent className="w-5 h-5" />;
                          })()}
                        </span>
                        <div>
                          <div
                            className={`font-medium ${isCurrent ? 'text-stratosort-blue' : isFuture ? 'text-system-gray-500' : 'text-system-gray-900'}`}
                          >
                            {action.description}
                          </div>
                          <div className="text-sm text-system-gray-500">
                            {new Date(action.timestamp).toLocaleString()}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {isCurrent && (
                          <span className="px-2 py-0.5 text-xs font-medium bg-stratosort-blue text-white rounded-full">
                            Current
                          </span>
                        )}
                        {isFuture && (
                          <span className="px-2 py-0.5 text-xs font-medium bg-system-gray-200 text-system-gray-600 rounded-full">
                            Undone
                          </span>
                        )}
                        <span className="text-sm text-system-gray-400">#{actualIndex + 1}</span>
                      </div>
                    </button>
                  );
                })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Undo/Redo Toolbar Component
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

  // Check if the last action is an important operation that needs confirmation
  const isImportantOperation =
    lastAction?.description &&
    (lastAction.description.toLowerCase().includes('organize') ||
      lastAction.description.toLowerCase().includes('move') ||
      lastAction.description.toLowerCase().includes('delete'));

  return (
    <div className={`flex items-center space-x-5 ${className}`}>
      <button
        onClick={undo}
        disabled={!canUndo}
        className={`p-8 rounded-lg transition-colors border
          ${
            !canUndo
              ? 'text-system-gray-300 cursor-not-allowed border-transparent'
              : isImportantOperation
                ? 'text-orange-700 hover:bg-orange-50 hover:text-orange-900 border-orange-200 hover:border-orange-300'
                : 'text-system-gray-700 hover:bg-system-gray-100 hover:text-system-gray-900 border-transparent hover:border-system-gray-200'
          }
        `}
        title={
          lastAction
            ? `Undo: ${getActionDescription(lastAction)}${isImportantOperation ? ' (Will ask for confirmation)' : ''}`
            : 'Nothing to undo'
        }
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
          />
        </svg>
      </button>

      <button
        onClick={redo}
        disabled={!canRedo}
        className={`
          p-8 rounded-lg transition-colors
          ${
            canRedo
              ? 'text-system-gray-700 hover:bg-system-gray-100 hover:text-system-gray-900'
              : 'text-system-gray-300 cursor-not-allowed'
          }
        `}
        title={nextAction ? `Redo: ${getActionDescription(nextAction)}` : 'Nothing to redo'}
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 10h-10a8 8 0 00-8 8v2m18-10l-6 6m6-6l-6-6"
          />
        </svg>
      </button>

      <div className="w-px h-6 bg-system-gray-300 mx-1" />
      <div className="hidden md:block w-px h-6 bg-system-gray-300" />

      <button
        onClick={() => setIsHistoryVisible(true)}
        className="p-8 rounded-lg text-system-gray-700 hover:bg-system-gray-100 hover:text-system-gray-900 transition-colors"
        title="View action history"
        aria-label="View action history"
      >
        <svg
          className="w-6 h-6"
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
      </button>
    </div>
  );
}

UndoRedoToolbar.propTypes = {
  className: PropTypes.string
};

// Helper functions for common actions
// Update createFileAction to conform to main IPC payloads
export const createFileAction = ({ actionType, description, source, destination }) => ({
  type: actionType,
  description,
  execute: async () => {
    // Only move/copy/delete are supported here; match the main payload shape
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

// Batch organize action that uses main process to perform and record undo/redo
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
  undo: async () => {
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
  redo: async () => {
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
    operationCount: Array.isArray(operations) ? operations.length : 0
  }
});

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
    // Undo in reverse order
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
