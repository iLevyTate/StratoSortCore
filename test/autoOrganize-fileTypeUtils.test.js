/**
 * Tests for AutoOrganize File Type Utils
 * Tests file type categorization and sanitization utilities
 */

describe('AutoOrganize File Type Utils', () => {
  let FILE_TYPE_CATEGORIES;
  let getFileTypeCategory;
  let sanitizeFile;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    const module = require('../src/main/services/autoOrganize/fileTypeUtils');
    FILE_TYPE_CATEGORIES = module.FILE_TYPE_CATEGORIES;
    getFileTypeCategory = module.getFileTypeCategory;
    sanitizeFile = module.sanitizeFile;
  });

  describe('FILE_TYPE_CATEGORIES', () => {
    test('defines documents category', () => {
      expect(FILE_TYPE_CATEGORIES.documents).toContain('pdf');
      expect(FILE_TYPE_CATEGORIES.documents).toContain('doc');
      expect(FILE_TYPE_CATEGORIES.documents).toContain('docx');
    });

    test('defines images category', () => {
      expect(FILE_TYPE_CATEGORIES.images).toContain('jpg');
      expect(FILE_TYPE_CATEGORIES.images).toContain('png');
      expect(FILE_TYPE_CATEGORIES.images).toContain('gif');
    });

    test('defines code category', () => {
      expect(FILE_TYPE_CATEGORIES.code).toContain('js');
      expect(FILE_TYPE_CATEGORIES.code).toContain('py');
      expect(FILE_TYPE_CATEGORIES.code).toContain('java');
    });

    test('defines archives category', () => {
      expect(FILE_TYPE_CATEGORIES.archives).toContain('zip');
      expect(FILE_TYPE_CATEGORIES.archives).toContain('rar');
      expect(FILE_TYPE_CATEGORIES.archives).toContain('7z');
    });
  });

  describe('getFileTypeCategory', () => {
    test('returns Documents for pdf', () => {
      expect(getFileTypeCategory('pdf')).toBe('Documents');
    });

    test('returns Documents for docx', () => {
      expect(getFileTypeCategory('docx')).toBe('Documents');
    });

    test('returns Images for jpg', () => {
      expect(getFileTypeCategory('jpg')).toBe('Images');
    });

    test('returns Images for png', () => {
      expect(getFileTypeCategory('png')).toBe('Images');
    });

    test('returns Spreadsheets for xlsx', () => {
      expect(getFileTypeCategory('xlsx')).toBe('Spreadsheets');
    });

    test('returns Videos for mp4', () => {
      expect(getFileTypeCategory('mp4')).toBe('Videos');
    });

    test('returns Audio for mp3', () => {
      expect(getFileTypeCategory('mp3')).toBe('Audio');
    });

    test('returns Code for js', () => {
      expect(getFileTypeCategory('js')).toBe('Code');
    });

    test('returns Archives for zip', () => {
      expect(getFileTypeCategory('zip')).toBe('Archives');
    });

    test('returns Files for unknown extension', () => {
      expect(getFileTypeCategory('xyz')).toBe('Files');
    });

    test('is case-insensitive', () => {
      expect(getFileTypeCategory('PDF')).toBe('Documents');
      expect(getFileTypeCategory('JPG')).toBe('Images');
    });

    test('handles extension with leading dot', () => {
      expect(getFileTypeCategory('.pdf')).toBe('Documents');
      expect(getFileTypeCategory('.jpg')).toBe('Images');
    });
  });

  describe('sanitizeFile', () => {
    test('returns null for null input', () => {
      expect(sanitizeFile(null)).toBeNull();
    });

    test('returns null for undefined input', () => {
      expect(sanitizeFile(undefined)).toBeNull();
    });

    test('extracts essential properties', () => {
      const file = {
        name: 'document.pdf',
        path: '/path/to/document.pdf',
        size: 1024,
        extension: 'pdf',
        type: 'document',
        extraField: 'should be removed',
        largeData: Buffer.alloc(1000)
      };

      const sanitized = sanitizeFile(file);

      expect(sanitized.name).toBe('document.pdf');
      expect(sanitized.path).toBe('/path/to/document.pdf');
      expect(sanitized.size).toBe(1024);
      expect(sanitized.extension).toBe('pdf');
      expect(sanitized.type).toBe('document');
      expect(sanitized.extraField).toBeUndefined();
      expect(sanitized.largeData).toBeUndefined();
    });

    test('includes analysis when present', () => {
      const file = {
        name: 'doc.pdf',
        path: '/path/doc.pdf',
        analysis: {
          category: 'Reports',
          suggestedName: 'report.pdf',
          confidence: 0.95,
          summary: 'A report document',
          extraAnalysisField: 'should be removed'
        }
      };

      const sanitized = sanitizeFile(file);

      expect(sanitized.analysis).toBeDefined();
      expect(sanitized.analysis.category).toBe('Reports');
      expect(sanitized.analysis.suggestedName).toBe('report.pdf');
      expect(sanitized.analysis.confidence).toBe(0.95);
      expect(sanitized.analysis.summary).toBe('A report document');
      expect(sanitized.analysis.extraAnalysisField).toBeUndefined();
    });

    test('sets analysis to null when not present', () => {
      const file = {
        name: 'doc.pdf',
        path: '/path/doc.pdf'
      };

      const sanitized = sanitizeFile(file);

      expect(sanitized.analysis).toBeNull();
    });

    test('handles partial analysis', () => {
      const file = {
        name: 'doc.pdf',
        path: '/path/doc.pdf',
        analysis: {
          category: 'Reports'
        }
      };

      const sanitized = sanitizeFile(file);

      expect(sanitized.analysis.category).toBe('Reports');
      expect(sanitized.analysis.suggestedName).toBeUndefined();
    });
  });
});
