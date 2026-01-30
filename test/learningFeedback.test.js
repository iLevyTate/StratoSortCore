/**
 * Tests for LearningFeedbackService and helper functions.
 */

// Mock electron
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => '/mock/userData')
  }
}));

// Mock logger
jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  },
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }))
}));

// Mock folderUtils
jest.mock('../src/shared/folderUtils', () => ({
  findContainingSmartFolder: jest.fn()
}));

// Mock ServiceContainer to prevent import errors
jest.mock('../src/main/services/ServiceContainer', () => ({
  container: {
    has: jest.fn().mockReturnValue(false),
    resolve: jest.fn()
  },
  ServiceIds: {
    LEARNING_FEEDBACK: 'learningFeedback'
  }
}));

const {
  buildFolderSuggestion,
  buildFileMetadata,
  FEEDBACK_SOURCES
} = require('../src/main/services/organization/learningFeedback');

describe('buildFolderSuggestion', () => {
  test('should return null for null or undefined smartFolder', () => {
    expect(buildFolderSuggestion(null)).toBeNull();
    expect(buildFolderSuggestion(undefined)).toBeNull();
  });

  test('should return null for smartFolder without path', () => {
    expect(buildFolderSuggestion({ name: 'Test' })).toBeNull();
    expect(buildFolderSuggestion({ name: 'Test', path: '' })).toBeNull();
  });

  test('should use smartFolder.name when provided', () => {
    const result = buildFolderSuggestion({
      name: 'Documents',
      path: '/home/user/Documents',
      id: 'doc-1'
    });

    expect(result).toEqual({
      folder: 'Documents',
      path: '/home/user/Documents',
      folderId: 'doc-1',
      confidence: expect.any(Number),
      method: 'implicit_feedback',
      isSmartFolder: true,
      description: ''
    });
  });

  test('should fall back to path.basename when name is empty', () => {
    const result = buildFolderSuggestion({
      name: '',
      path: '/home/user/Documents',
      id: 'doc-1'
    });

    expect(result.folder).toBe('Documents');
  });

  test('should handle path ending with separator (FIX MED-7)', () => {
    // This tests the edge case where path.basename returns empty string
    const result = buildFolderSuggestion({
      name: '',
      path: '/home/user/Documents/', // Note trailing slash
      id: 'doc-1'
    });

    // Should fall back to full path if basename is empty
    // path.basename('/home/user/Documents/') returns 'Documents' on most systems
    // but we want to test the fallback logic
    expect(result.folder).toBeTruthy();
    expect(result.folder).not.toBe('');
  });

  test('should handle completely empty folder name and empty basename', () => {
    // Extreme edge case: name is empty and path is just a separator
    const result = buildFolderSuggestion({
      name: '',
      path: '/', // basename returns empty string
      id: 'root'
    });

    // Should fall back to full path as last resort
    expect(result.folder).toBe('/');
  });

  test('should apply confidence weight correctly', () => {
    const fullWeight = buildFolderSuggestion({ name: 'Test', path: '/test' }, 1.0);
    const halfWeight = buildFolderSuggestion({ name: 'Test', path: '/test' }, 0.5);

    expect(fullWeight.confidence).toBeCloseTo(0.85);
    expect(halfWeight.confidence).toBeCloseTo(0.425);
  });

  test('should include description when provided', () => {
    const result = buildFolderSuggestion({
      name: 'Work',
      path: '/work',
      description: 'Work-related documents'
    });

    expect(result.description).toBe('Work-related documents');
  });
});

describe('buildFileMetadata', () => {
  test('should extract basic file metadata', () => {
    const result = buildFileMetadata('/home/user/report.pdf');

    expect(result).toEqual({
      name: 'report.pdf',
      path: '/home/user/report.pdf',
      extension: 'pdf',
      category: null,
      subject: null,
      keywords: [],
      confidence: null
    });
  });

  test('should handle file without extension', () => {
    const result = buildFileMetadata('/home/user/README');

    expect(result.extension).toBe('unknown');
    expect(result.name).toBe('README');
  });

  test('should include analysis data when provided', () => {
    const analysis = {
      category: 'Documents',
      subject: 'Quarterly Report',
      keywords: ['finance', 'quarterly'],
      confidence: 0.95
    };

    const result = buildFileMetadata('/home/user/report.pdf', analysis);

    expect(result.category).toBe('Documents');
    expect(result.subject).toBe('Quarterly Report');
    expect(result.keywords).toEqual(['finance', 'quarterly']);
    expect(result.confidence).toBe(0.95);
  });

  test('should use tags as fallback for keywords', () => {
    const analysis = {
      tags: ['tag1', 'tag2']
    };

    const result = buildFileMetadata('/home/user/file.txt', analysis);

    expect(result.keywords).toEqual(['tag1', 'tag2']);
  });

  test('should use smartFolder as fallback for category', () => {
    const analysis = {
      smartFolder: 'Projects'
    };

    const result = buildFileMetadata('/home/user/file.txt', analysis);

    expect(result.category).toBe('Projects');
  });
});

describe('FEEDBACK_SOURCES', () => {
  test('should have all expected feedback sources', () => {
    expect(FEEDBACK_SOURCES.MANUAL_MOVE).toBe('manual_move');
    expect(FEEDBACK_SOURCES.WATCHER_DETECTION).toBe('watcher_detection');
    expect(FEEDBACK_SOURCES.STARTUP_SCAN).toBe('startup_scan');
    expect(FEEDBACK_SOURCES.AUTO_ORGANIZE_CONFIRMED).toBe('auto_organize_confirmed');
    expect(FEEDBACK_SOURCES.DRAG_DROP).toBe('drag_drop');
  });

  test('should be frozen (immutable)', () => {
    expect(Object.isFrozen(FEEDBACK_SOURCES)).toBe(true);
  });
});
