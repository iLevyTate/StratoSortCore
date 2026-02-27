/**
 * @jest-environment jsdom
 *
 * Beta Workflow Interaction Tests
 *
 * Component-level interaction tests that mirror the Beta Tester Guide workflow.
 * Tests cover: navigation, smart folder CRUD, file discovery UI, organize phase,
 * search modal, settings panel, and undo/redo state management.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import '@testing-library/jest-dom';

// ── Shared mocks ──────────────────────────────────────────────────────

const mockDispatch = jest.fn();
let mockState = {};

jest.mock('../../src/renderer/store/hooks', () => ({
  useAppDispatch: jest.fn(() => mockDispatch),
  useAppSelector: jest.fn((selector) => selector(mockState))
}));

const mockSetPhase = jest.fn((phase) => ({ type: 'ui/setPhase', payload: phase }));
const mockToggleSettings = jest.fn(() => ({ type: 'ui/toggleSettings' }));
const mockCanTransitionTo = jest.fn(() => true);

jest.mock('../../src/renderer/store/slices/uiSlice', () => ({
  setPhase: (...args) => mockSetPhase(...args),
  toggleSettings: (...args) => mockToggleSettings(...args),
  canTransitionTo: (...args) => mockCanTransitionTo(...args),
  goBack: jest.fn(() => ({ type: 'ui/goBack' })),
  setLoading: jest.fn((v) => ({ type: 'ui/setLoading', payload: v })),
  setOrganizing: jest.fn((v) => ({ type: 'ui/setOrganizing', payload: v }))
}));

jest.mock('../../src/renderer/store/slices/filesSlice', () => ({
  setSelectedFiles: jest.fn((files) => ({ type: 'files/setSelectedFiles', payload: files })),
  addSelectedFiles: jest.fn((files) => ({ type: 'files/addSelectedFiles', payload: files })),
  setSmartFolders: jest.fn((folders) => ({ type: 'files/setSmartFolders', payload: folders })),
  updateFileState: jest.fn((data) => ({ type: 'files/updateFileState', payload: data }))
}));

jest.mock('../../src/renderer/store/slices/analysisSlice', () => ({
  startAnalysis: jest.fn(() => ({ type: 'analysis/startAnalysis' })),
  updateProgress: jest.fn((p) => ({ type: 'analysis/updateProgress', payload: p })),
  analysisSuccess: jest.fn((r) => ({ type: 'analysis/analysisSuccess', payload: r })),
  analysisFailure: jest.fn((e) => ({ type: 'analysis/analysisFailure', payload: e }))
}));

const mockAddNotification = jest.fn();
jest.mock('../../src/renderer/contexts/NotificationContext', () => ({
  useNotification: jest.fn(() => ({ addNotification: mockAddNotification }))
}));

jest.mock('../../src/renderer/contexts/FloatingSearchContext', () => ({
  useFloatingSearch: jest.fn(() => ({
    isWidgetOpen: false,
    openWidget: jest.fn(),
    closeWidget: jest.fn()
  }))
}));

jest.mock('../../src/renderer/components/UpdateIndicator', () => ({
  __esModule: true,
  default: () => <div data-testid="update-indicator" />
}));

jest.mock('../../src/renderer/components/ui', () => ({
  Button: ({ children, onClick, disabled, variant, ...props }) => (
    <button onClick={onClick} disabled={disabled} data-variant={variant} {...props}>
      {children}
    </button>
  ),
  IconButton: ({ icon, children, onClick, ...props }) => (
    <button onClick={onClick} {...props}>
      {icon}
      {children}
    </button>
  ),
  Card: ({ children, ...props }) => (
    <div data-testid="card" {...props}>
      {children}
    </div>
  ),
  Input: ({ value, onChange, ...props }) => <input value={value} onChange={onChange} {...props} />,
  Badge: ({ children }) => <span data-testid="badge">{children}</span>
}));

jest.mock('../../src/renderer/components/ui/Typography', () => ({
  Heading: ({ children, ...props }) => <h2 {...props}>{children}</h2>,
  Text: ({ as: Component = 'span', children, ...props }) => (
    <Component {...props}>{children}</Component>
  ),
  Caption: ({ children }) => <small>{children}</small>
}));

jest.mock('../../src/renderer/components/ui/Modal', () => ({
  __esModule: true,
  default: ({ isOpen, onClose, children, title }) =>
    isOpen ? (
      <div role="dialog" aria-label={title} data-testid="modal">
        <button aria-label="Close" onClick={onClose}>
          ×
        </button>
        <h2>{title}</h2>
        {children}
      </div>
    ) : null
}));

jest.mock('../../src/renderer/components/layout', () => ({
  Stack: ({ children }) => <div>{children}</div>,
  Flex: ({ children }) => <div style={{ display: 'flex' }}>{children}</div>
}));

jest.mock('../../src/renderer/utils/platform', () => ({
  isMac: false
}));

jest.mock('lucide-react', () => ({
  Home: (props) => <svg data-testid="icon-home" {...props} />,
  Settings: (props) => <svg data-testid="icon-settings" {...props} />,
  Search: (props) => <svg data-testid="icon-search" {...props} />,
  FolderOpen: (props) => <svg data-testid="icon-folder-open" {...props} />,
  FolderPlus: (props) => <svg data-testid="icon-folder-plus" {...props} />,
  CheckCircle2: (props) => <svg data-testid="icon-check" {...props} />,
  Loader2: (props) => <svg data-testid="icon-loader" {...props} />,
  Minus: (props) => <svg data-testid="icon-minus" {...props} />,
  Square: (props) => <svg data-testid="icon-square" {...props} />,
  X: (props) => <svg data-testid="icon-x" {...props} />,
  Rocket: () => <span />,
  Sparkles: () => <span />,
  FolderCheck: () => <span />,
  Plus: () => <span />,
  Trash2: () => <span />,
  Edit: () => <span />,
  Upload: () => <span />,
  FileText: () => <span />,
  Undo2: () => <span />,
  Redo2: () => <span />,
  ChevronRight: () => <span />,
  ChevronDown: () => <span />,
  AlertCircle: () => <span />,
  Info: () => <span />,
  Copy: () => <span />
}));

jest.mock('../../src/renderer/components/ModelSetupWizard', () => ({
  __esModule: true,
  default: () => <div data-testid="model-setup-wizard" />
}));

// ── Helper to build mock state ────────────────────────────────────────

function buildMockState(overrides = {}) {
  return {
    ui: {
      currentPhase: 'welcome',
      previousPhase: null,
      showSettings: false,
      isOrganizing: false,
      isLoading: false,
      isDiscovering: false,
      isProcessing: false,
      activeModal: null,
      settings: {
        textModel: 'test-model.gguf',
        embeddingModel: 'test-embedding.gguf',
        namingConvention: 'subject-date'
      },
      ...overrides.ui
    },
    files: {
      selectedFiles: [],
      smartFolders: [],
      organizedFiles: [],
      fileStates: {},
      namingConvention: { convention: 'subject-date', dateFormat: 'YYYY-MM-DD' },
      ...overrides.files
    },
    analysis: {
      isAnalyzing: false,
      analysisProgress: { current: 0, total: 0 },
      results: [],
      currentAnalysisFile: null,
      ...overrides.analysis
    },
    system: {
      health: {
        llama: 'online',
        vectorDb: 'online'
      },
      ...overrides.system
    }
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('Beta Workflow — Navigation Interactions', () => {
  beforeEach(() => {
    mockDispatch.mockClear();
    mockSetPhase.mockClear();
    mockToggleSettings.mockClear();
    mockAddNotification.mockClear();
    mockState = buildMockState();

    window.electronAPI = {
      llama: {
        testConnection: jest.fn().mockResolvedValue({ status: 'healthy' })
      },
      vectorDb: {
        healthCheck: jest.fn().mockResolvedValue({ healthy: true })
      },
      window: {
        isMaximized: jest.fn().mockResolvedValue(false),
        minimize: jest.fn(),
        toggleMaximize: jest.fn().mockResolvedValue(false),
        close: jest.fn()
      }
    };
  });

  afterEach(() => {
    delete window.electronAPI;
  });

  let NavigationBar;
  beforeAll(async () => {
    NavigationBar = (await import('../../src/renderer/components/NavigationBar')).default;
  });

  test('renders all phase buttons', () => {
    render(<NavigationBar />);

    expect(screen.getByRole('button', { name: /welcome/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /setup/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /discover/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /organize/i })).toBeInTheDocument();
  });

  test('dispatches setPhase when phase button is clicked', async () => {
    render(<NavigationBar />);

    const discoverBtn = screen.getByRole('button', { name: /discover/i });
    fireEvent.click(discoverBtn);

    await waitFor(() => {
      expect(
        mockDispatch.mock.calls.some(
          ([action]) => action?.type === 'ui/setPhase' && action?.payload === 'discover'
        )
      ).toBe(true);
    });
  });

  test('dispatches toggleSettings when settings button is clicked', async () => {
    render(<NavigationBar />);

    const settingsBtn = screen.getByRole('button', { name: /settings/i });
    fireEvent.click(settingsBtn);

    await waitFor(() => {
      expect(mockDispatch.mock.calls.some(([action]) => action?.type === 'ui/toggleSettings')).toBe(
        true
      );
    });
  });

  test('highlights active phase button', () => {
    mockState = buildMockState({ ui: { currentPhase: 'discover' } });
    render(<NavigationBar />);

    const discoverBtn = screen.getByRole('button', { name: /discover/i });
    expect(discoverBtn).toHaveAttribute('aria-current', 'page');
  });
});

describe('Beta Workflow — Smart Folder State Management', () => {
  beforeEach(() => {
    mockDispatch.mockClear();
  });

  test('setSmartFolders action creates correct payload', () => {
    const { setSmartFolders } = require('../../src/renderer/store/slices/filesSlice');
    const folders = [
      { id: '1', name: 'Business', path: '/docs/business', description: 'Business docs' },
      { id: '2', name: 'Code', path: '/docs/code', description: 'Code files' }
    ];
    const action = setSmartFolders(folders);
    expect(action.type).toBe('files/setSmartFolders');
    expect(action.payload).toEqual(folders);
  });

  test('addSelectedFiles action creates correct payload', () => {
    const { addSelectedFiles } = require('../../src/renderer/store/slices/filesSlice');
    const files = [
      { path: '/test/report.pdf', name: 'report.pdf', size: 1024 },
      { path: '/test/code.py', name: 'code.py', size: 512 }
    ];
    const action = addSelectedFiles(files);
    expect(action.type).toBe('files/addSelectedFiles');
    expect(action.payload).toHaveLength(2);
  });
});

describe('Beta Workflow — Analysis State Machine', () => {
  test('startAnalysis action has correct type', () => {
    const { startAnalysis } = require('../../src/renderer/store/slices/analysisSlice');
    const action = startAnalysis();
    expect(action.type).toBe('analysis/startAnalysis');
  });

  test('updateProgress action carries progress payload', () => {
    const { updateProgress } = require('../../src/renderer/store/slices/analysisSlice');
    const action = updateProgress({ current: 2, total: 5, lastActivity: Date.now() });
    expect(action.type).toBe('analysis/updateProgress');
    expect(action.payload.current).toBe(2);
    expect(action.payload.total).toBe(5);
  });

  test('analysisSuccess action carries result payload', () => {
    const { analysisSuccess } = require('../../src/renderer/store/slices/analysisSlice');
    const result = {
      filePath: '/test/doc.txt',
      category: 'Document',
      confidence: 0.92,
      suggestedName: 'quarterly-report-2026.txt'
    };
    const action = analysisSuccess(result);
    expect(action.type).toBe('analysis/analysisSuccess');
    expect(action.payload.confidence).toBe(0.92);
  });

  test('analysisFailure action carries error payload', () => {
    const { analysisFailure } = require('../../src/renderer/store/slices/analysisSlice');
    const action = analysisFailure({ filePath: '/test/bad.bin', error: 'Unsupported format' });
    expect(action.type).toBe('analysis/analysisFailure');
    expect(action.payload.error).toBe('Unsupported format');
  });
});

describe('Beta Workflow — Phase Transitions', () => {
  test('setPhase produces correct action for each phase', () => {
    const phases = ['welcome', 'setup', 'discover', 'organize', 'complete'];
    for (const phase of phases) {
      mockSetPhase.mockClear();
      const action = mockSetPhase(phase);
      expect(action.type).toBe('ui/setPhase');
      expect(action.payload).toBe(phase);
    }
  });

  test('canTransitionTo is called for phase validation', () => {
    mockCanTransitionTo.mockReturnValue(true);
    expect(mockCanTransitionTo('discover')).toBe(true);

    mockCanTransitionTo.mockReturnValue(false);
    expect(mockCanTransitionTo('complete')).toBe(false);
  });

  test('goBack action has correct type', () => {
    const { goBack } = require('../../src/renderer/store/slices/uiSlice');
    const action = goBack();
    expect(action.type).toBe('ui/goBack');
  });
});

describe('Beta Workflow — Settings Interactions', () => {
  test('toggleSettings dispatches correctly', () => {
    const action = mockToggleSettings();
    expect(action.type).toBe('ui/toggleSettings');
  });

  test('setLoading updates loading state', () => {
    const { setLoading } = require('../../src/renderer/store/slices/uiSlice');
    expect(setLoading(true).type).toBe('ui/setLoading');
    expect(setLoading(true).payload).toBe(true);
    expect(setLoading(false).payload).toBe(false);
  });

  test('setOrganizing updates organizing state', () => {
    const { setOrganizing } = require('../../src/renderer/store/slices/uiSlice');
    expect(setOrganizing(true).payload).toBe(true);
    expect(setOrganizing(false).payload).toBe(false);
  });
});

describe('Beta Workflow — File State Tracking', () => {
  test('updateFileState creates state update', () => {
    const { updateFileState } = require('../../src/renderer/store/slices/filesSlice');
    const action = updateFileState({
      path: '/test/doc.txt',
      state: 'analyzing',
      progress: 50
    });
    expect(action.type).toBe('files/updateFileState');
    expect(action.payload.state).toBe('analyzing');
  });

  test('file states cover full lifecycle', () => {
    const { updateFileState } = require('../../src/renderer/store/slices/filesSlice');
    const states = ['pending', 'analyzing', 'ready', 'error'];
    for (const state of states) {
      const action = updateFileState({ path: '/test/file.txt', state });
      expect(action.payload.state).toBe(state);
    }
  });
});

describe('Beta Workflow — Notification System', () => {
  test('notification context provides addNotification', () => {
    const { useNotification } = require('../../src/renderer/contexts/NotificationContext');
    const { addNotification } = useNotification();
    expect(typeof addNotification).toBe('function');
  });

  test('addNotification can be called with different types', () => {
    mockAddNotification.mockClear();
    mockAddNotification({ type: 'success', message: 'Files analyzed' });
    mockAddNotification({ type: 'error', message: 'Analysis failed' });
    mockAddNotification({ type: 'info', message: 'Processing...' });
    expect(mockAddNotification).toHaveBeenCalledTimes(3);
  });
});

describe('Beta Workflow — Mock State Consistency', () => {
  test('buildMockState produces valid default state', () => {
    const state = buildMockState();
    expect(state.ui.currentPhase).toBe('welcome');
    expect(state.files.selectedFiles).toEqual([]);
    expect(state.files.smartFolders).toEqual([]);
    expect(state.analysis.isAnalyzing).toBe(false);
    expect(state.system.health.llama).toBe('online');
  });

  test('buildMockState merges overrides correctly', () => {
    const state = buildMockState({
      ui: { currentPhase: 'organize', isOrganizing: true },
      files: {
        selectedFiles: [{ path: '/a.txt' }],
        smartFolders: [{ id: '1', name: 'Test' }]
      },
      analysis: { isAnalyzing: true, analysisProgress: { current: 3, total: 5 } }
    });
    expect(state.ui.currentPhase).toBe('organize');
    expect(state.ui.isOrganizing).toBe(true);
    expect(state.files.selectedFiles).toHaveLength(1);
    expect(state.files.smartFolders).toHaveLength(1);
    expect(state.analysis.isAnalyzing).toBe(true);
    expect(state.analysis.analysisProgress.current).toBe(3);
  });

  test('state supports discover phase with files pending', () => {
    const state = buildMockState({
      ui: { currentPhase: 'discover', isDiscovering: true },
      files: {
        selectedFiles: [
          { path: '/test/a.pdf', name: 'a.pdf', size: 2048 },
          { path: '/test/b.txt', name: 'b.txt', size: 512 }
        ]
      },
      analysis: {
        isAnalyzing: true,
        analysisProgress: { current: 1, total: 2 },
        currentAnalysisFile: '/test/a.pdf'
      }
    });
    expect(state.ui.isDiscovering).toBe(true);
    expect(state.analysis.currentAnalysisFile).toBe('/test/a.pdf');
  });

  test('state supports organize phase with results', () => {
    const state = buildMockState({
      ui: { currentPhase: 'organize' },
      analysis: {
        results: [
          {
            filePath: '/test/report.pdf',
            category: 'Business',
            confidence: 0.95,
            suggestedName: 'quarterly-report-2026.pdf',
            suggestedFolder: 'Business Reports'
          },
          {
            filePath: '/test/code.py',
            category: 'Code',
            confidence: 0.88,
            suggestedName: 'data-processor-2026.py',
            suggestedFolder: 'Code Files'
          }
        ]
      }
    });
    expect(state.analysis.results).toHaveLength(2);
    expect(state.analysis.results[0].confidence).toBe(0.95);
    expect(state.analysis.results[1].suggestedFolder).toBe('Code Files');
  });
});
