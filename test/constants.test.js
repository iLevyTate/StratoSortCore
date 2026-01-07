/**
 * Tests for Shared Constants
 * Tests application phases, IPC channels, and file type mappings
 */

describe('constants', () => {
  let constants;

  beforeEach(() => {
    jest.resetModules();
    constants = require('../src/shared/constants');
  });

  describe('PHASES', () => {
    test('defines all application phases', () => {
      expect(constants.PHASES.WELCOME).toBe('welcome');
      expect(constants.PHASES.SETUP).toBe('setup');
      expect(constants.PHASES.DISCOVER).toBe('discover');
      expect(constants.PHASES.ORGANIZE).toBe('organize');
      expect(constants.PHASES.COMPLETE).toBe('complete');
    });

    test('has exactly 5 phases', () => {
      expect(Object.keys(constants.PHASES)).toHaveLength(5);
    });
  });

  describe('PHASE_TRANSITIONS', () => {
    test('defines transitions for each phase', () => {
      Object.values(constants.PHASES).forEach((phase) => {
        expect(constants.PHASE_TRANSITIONS[phase]).toBeDefined();
        expect(Array.isArray(constants.PHASE_TRANSITIONS[phase])).toBe(true);
      });
    });

    test('WELCOME can transition to SETUP and DISCOVER', () => {
      const transitions = constants.PHASE_TRANSITIONS[constants.PHASES.WELCOME];
      expect(transitions).toContain(constants.PHASES.SETUP);
      expect(transitions).toContain(constants.PHASES.DISCOVER);
    });

    test('all phases can transition to WELCOME for error recovery', () => {
      Object.values(constants.PHASES).forEach((phase) => {
        if (phase !== constants.PHASES.WELCOME) {
          expect(constants.PHASE_TRANSITIONS[phase]).toContain(constants.PHASES.WELCOME);
        }
      });
    });
  });

  describe('PHASE_METADATA', () => {
    test('defines metadata for each phase', () => {
      Object.values(constants.PHASES).forEach((phase) => {
        const metadata = constants.PHASE_METADATA[phase];
        expect(metadata).toBeDefined();
        expect(metadata.title).toBeDefined();
        expect(metadata.navLabel).toBeDefined();
        expect(metadata.icon).toBeDefined();
        expect(typeof metadata.progress).toBe('number');
      });
    });

    test('progress increases through phases', () => {
      expect(constants.PHASE_METADATA[constants.PHASES.WELCOME].progress).toBe(0);
      expect(constants.PHASE_METADATA[constants.PHASES.COMPLETE].progress).toBe(100);
    });
  });

  describe('IPC_CHANNELS', () => {
    test('defines FILES channels', () => {
      expect(constants.IPC_CHANNELS.FILES).toBeDefined();
      expect(constants.IPC_CHANNELS.FILES.SELECT).toBeDefined();
      expect(constants.IPC_CHANNELS.FILES.SELECT_DIRECTORY).toBeDefined();
    });

    test('defines SMART_FOLDERS channels', () => {
      expect(constants.IPC_CHANNELS.SMART_FOLDERS).toBeDefined();
      expect(constants.IPC_CHANNELS.SMART_FOLDERS.GET).toBeDefined();
      expect(constants.IPC_CHANNELS.SMART_FOLDERS.SAVE).toBeDefined();
    });

    test('defines SETTINGS channels', () => {
      expect(constants.IPC_CHANNELS.SETTINGS).toBeDefined();
      expect(constants.IPC_CHANNELS.SETTINGS.GET).toBeDefined();
      expect(constants.IPC_CHANNELS.SETTINGS.SAVE).toBeDefined();
    });

    test('defines UNDO_REDO channels', () => {
      expect(constants.IPC_CHANNELS.UNDO_REDO).toBeDefined();
      expect(constants.IPC_CHANNELS.UNDO_REDO.UNDO).toBeDefined();
      expect(constants.IPC_CHANNELS.UNDO_REDO.REDO).toBeDefined();
    });
  });

  describe('SYSTEM_STATUS', () => {
    test('defines all status values', () => {
      expect(constants.SYSTEM_STATUS.CHECKING).toBe('checking');
      expect(constants.SYSTEM_STATUS.HEALTHY).toBe('healthy');
      expect(constants.SYSTEM_STATUS.UNHEALTHY).toBe('unhealthy');
      expect(constants.SYSTEM_STATUS.OFFLINE).toBe('offline');
    });
  });

  describe('NOTIFICATION_TYPES', () => {
    test('defines all notification types', () => {
      expect(constants.NOTIFICATION_TYPES.INFO).toBe('info');
      expect(constants.NOTIFICATION_TYPES.SUCCESS).toBe('success');
      expect(constants.NOTIFICATION_TYPES.WARNING).toBe('warning');
      expect(constants.NOTIFICATION_TYPES.ERROR).toBe('error');
    });
  });

  describe('FILE_STATES', () => {
    test('defines all file states', () => {
      expect(constants.FILE_STATES.PENDING).toBe('pending');
      expect(constants.FILE_STATES.ANALYZING).toBe('analyzing');
      expect(constants.FILE_STATES.CATEGORIZED).toBe('categorized');
      expect(constants.FILE_STATES.APPROVED).toBe('approved');
      expect(constants.FILE_STATES.PROCESSING).toBe('processing');
      expect(constants.FILE_STATES.COMPLETED).toBe('completed');
      expect(constants.FILE_STATES.ERROR).toBe('error');
      expect(constants.FILE_STATES.CANCELLED).toBe('cancelled');
    });
  });

  describe('ERROR_TYPES', () => {
    test('defines error type codes', () => {
      expect(constants.ERROR_TYPES.UNKNOWN).toBe('UNKNOWN');
      expect(constants.ERROR_TYPES.FILE_NOT_FOUND).toBe('FILE_NOT_FOUND');
      expect(constants.ERROR_TYPES.PERMISSION_DENIED).toBe('PERMISSION_DENIED');
      expect(constants.ERROR_TYPES.NETWORK_ERROR).toBe('NETWORK_ERROR');
    });
  });

  describe('FILE_SYSTEM_ERROR_CODES', () => {
    test('defines access errors', () => {
      expect(constants.FILE_SYSTEM_ERROR_CODES.FILE_ACCESS_DENIED).toBeDefined();
      expect(constants.FILE_SYSTEM_ERROR_CODES.FILE_NOT_FOUND).toBeDefined();
      expect(constants.FILE_SYSTEM_ERROR_CODES.PERMISSION_DENIED).toBeDefined();
    });

    test('defines write errors', () => {
      expect(constants.FILE_SYSTEM_ERROR_CODES.WRITE_FAILED).toBeDefined();
      expect(constants.FILE_SYSTEM_ERROR_CODES.READ_FAILED).toBeDefined();
      expect(constants.FILE_SYSTEM_ERROR_CODES.DELETE_FAILED).toBeDefined();
    });

    test('defines integrity errors', () => {
      expect(constants.FILE_SYSTEM_ERROR_CODES.CHECKSUM_MISMATCH).toBeDefined();
      expect(constants.FILE_SYSTEM_ERROR_CODES.SIZE_MISMATCH).toBeDefined();
    });
  });

  describe('ACTION_TYPES', () => {
    test('defines undo/redo action types', () => {
      expect(constants.ACTION_TYPES.FILE_MOVE).toBe('FILE_MOVE');
      expect(constants.ACTION_TYPES.FILE_RENAME).toBe('FILE_RENAME');
      expect(constants.ACTION_TYPES.FILE_DELETE).toBe('FILE_DELETE');
      expect(constants.ACTION_TYPES.FOLDER_CREATE).toBe('FOLDER_CREATE');
      expect(constants.ACTION_TYPES.BATCH_OPERATION).toBe('BATCH_OPERATION');
    });
  });

  describe('SHORTCUTS', () => {
    test('defines keyboard shortcuts', () => {
      expect(constants.SHORTCUTS.UNDO).toBe('Ctrl+Z');
      expect(constants.SHORTCUTS.REDO).toBe('Ctrl+Y');
      expect(constants.SHORTCUTS.SELECT_ALL).toBe('Ctrl+A');
    });
  });

  describe('LIMITS', () => {
    test('defines file size limits', () => {
      expect(constants.LIMITS.MAX_FILE_SIZE).toBe(100 * 1024 * 1024);
      expect(constants.LIMITS.MAX_PATH_LENGTH).toBe(260);
      expect(constants.LIMITS.MAX_FILENAME_LENGTH).toBe(255);
    });
  });

  describe('file extension arrays', () => {
    test('SUPPORTED_TEXT_EXTENSIONS includes common text formats', () => {
      expect(constants.SUPPORTED_TEXT_EXTENSIONS).toContain('.txt');
      expect(constants.SUPPORTED_TEXT_EXTENSIONS).toContain('.md');
      expect(constants.SUPPORTED_TEXT_EXTENSIONS).toContain('.json');
    });

    test('SUPPORTED_DOCUMENT_EXTENSIONS includes office formats', () => {
      expect(constants.SUPPORTED_DOCUMENT_EXTENSIONS).toContain('.pdf');
      expect(constants.SUPPORTED_DOCUMENT_EXTENSIONS).toContain('.docx');
      expect(constants.SUPPORTED_DOCUMENT_EXTENSIONS).toContain('.xlsx');
    });

    test('SUPPORTED_IMAGE_EXTENSIONS includes common image formats', () => {
      expect(constants.SUPPORTED_IMAGE_EXTENSIONS).toContain('.png');
      expect(constants.SUPPORTED_IMAGE_EXTENSIONS).toContain('.jpg');
      expect(constants.SUPPORTED_IMAGE_EXTENSIONS).toContain('.jpeg');
    });

    test('ALL_SUPPORTED_EXTENSIONS combines all extension arrays', () => {
      expect(constants.ALL_SUPPORTED_EXTENSIONS.length).toBeGreaterThan(0);
      expect(constants.ALL_SUPPORTED_EXTENSIONS).toContain('.txt');
      expect(constants.ALL_SUPPORTED_EXTENSIONS).toContain('.pdf');
      expect(constants.ALL_SUPPORTED_EXTENSIONS).toContain('.png');
    });
  });

  describe('DEFAULT_AI_MODELS', () => {
    test('defines default models', () => {
      expect(constants.DEFAULT_AI_MODELS.TEXT_ANALYSIS).toBeDefined();
      expect(constants.DEFAULT_AI_MODELS.IMAGE_ANALYSIS).toBeDefined();
      expect(constants.DEFAULT_AI_MODELS.FALLBACK_MODELS).toBeDefined();
    });

    test('FALLBACK_MODELS is an array', () => {
      expect(Array.isArray(constants.DEFAULT_AI_MODELS.FALLBACK_MODELS)).toBe(true);
      expect(constants.DEFAULT_AI_MODELS.FALLBACK_MODELS.length).toBeGreaterThan(0);
    });
  });

  describe('AI_DEFAULTS', () => {
    test('defines TEXT AI defaults', () => {
      expect(constants.AI_DEFAULTS.TEXT.MODEL).toBeDefined();
      expect(constants.AI_DEFAULTS.TEXT.HOST).toBeDefined();
      expect(constants.AI_DEFAULTS.TEXT.MAX_CONTENT_LENGTH).toBeDefined();
    });

    test('defines IMAGE AI defaults', () => {
      expect(constants.AI_DEFAULTS.IMAGE.MODEL).toBeDefined();
      expect(constants.AI_DEFAULTS.IMAGE.HOST).toBeDefined();
    });
  });

  describe('FILE_SIZE_LIMITS', () => {
    test('defines size limits for different file types', () => {
      expect(constants.FILE_SIZE_LIMITS.MAX_TEXT_FILE_SIZE).toBe(50 * 1024 * 1024);
      expect(constants.FILE_SIZE_LIMITS.MAX_IMAGE_FILE_SIZE).toBe(100 * 1024 * 1024);
      expect(constants.FILE_SIZE_LIMITS.MAX_DOCUMENT_FILE_SIZE).toBe(200 * 1024 * 1024);
    });
  });

  describe('PROCESSING_LIMITS', () => {
    test('defines processing constraints', () => {
      expect(constants.PROCESSING_LIMITS.MAX_CONCURRENT_ANALYSIS).toBe(3);
      expect(constants.PROCESSING_LIMITS.MAX_BATCH_SIZE).toBe(100);
      expect(constants.PROCESSING_LIMITS.RETRY_ATTEMPTS).toBe(3);
    });
  });

  describe('UI_WORKFLOW', () => {
    test('defines UI timing constants', () => {
      expect(constants.UI_WORKFLOW.RESTORE_MAX_AGE_MS).toBe(60 * 60 * 1000);
      expect(constants.UI_WORKFLOW.SAVE_DEBOUNCE_MS).toBe(1000);
    });
  });

  describe('RENDERER_LIMITS', () => {
    test('defines renderer-specific limits', () => {
      expect(constants.RENDERER_LIMITS.FILE_STATS_BATCH_SIZE).toBe(25);
      expect(constants.RENDERER_LIMITS.ANALYSIS_TIMEOUT_MS).toBe(3 * 60 * 1000);
    });
  });
});
