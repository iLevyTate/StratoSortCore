/**
 * Integration Tests for File Naming
 *
 * Tests file naming utilities using real test fixtures
 * to verify naming conventions, case transformations, and date formatting.
 *
 * Uses real test files from test/StratoSortOfTestFiles/
 */

const {
  TEST_FIXTURE_FILES,
  verifyFixturesExist,
  createMockAnalysisResult
} = require('../utils/fileTypeFixtures');

const {
  formatDate,
  applyCaseConvention,
  generatePreviewName,
  generateSuggestedNameFromAnalysis,
  extractExtension,
  extractFileName
} = require('../../src/renderer/phases/discover/namingUtils');

describe('File Naming - Fixture Integration', () => {
  beforeAll(async () => {
    await verifyFixturesExist();
  });

  describe('Financial PDF Naming', () => {
    const fixture = TEST_FIXTURE_FILES.financialPdf;
    const analysis = createMockAnalysisResult(fixture, {
      date: '2024-01-15',
      project: 'Annual Report',
      category: 'Financial'
    });

    test('generates name with subject-date convention', () => {
      const settings = {
        convention: 'subject-date',
        separator: '-',
        dateFormat: 'YYYY-MM-DD',
        caseConvention: 'kebab-case'
      };

      const result = generateSuggestedNameFromAnalysis({
        originalFileName: fixture.name,
        analysis,
        settings
      });

      expect(result).toBeDefined();
      expect(result.endsWith('.pdf')).toBe(true);
      expect(result).toContain('2024-01-15');
    });

    test('generates name with date-subject convention', () => {
      const settings = {
        convention: 'date-subject',
        separator: '_',
        dateFormat: 'YYYYMMDD',
        caseConvention: 'snake_case'
      };

      const result = generateSuggestedNameFromAnalysis({
        originalFileName: fixture.name,
        analysis,
        settings
      });

      expect(result).toBeDefined();
      expect(result.endsWith('.pdf')).toBe(true);
      expect(result).toMatch(/^20240115_/);
    });

    test('generates name with project-subject-date convention', () => {
      const settings = {
        convention: 'project-subject-date',
        separator: '-',
        dateFormat: 'YYYY-MM-DD',
        caseConvention: 'kebab-case'
      };

      const result = generateSuggestedNameFromAnalysis({
        originalFileName: fixture.name,
        analysis,
        settings
      });

      expect(result).toBeDefined();
      expect(result.endsWith('.pdf')).toBe(true);
      expect(result).toContain('annual-report');
    });

    test('keeps original name when convention is keep-original', () => {
      const settings = {
        convention: 'keep-original',
        separator: '-',
        dateFormat: 'YYYY-MM-DD'
      };

      const result = generateSuggestedNameFromAnalysis({
        originalFileName: fixture.name,
        analysis,
        settings
      });

      expect(result).toBe('Annual_Financial_Statement_2024.pdf');
    });
  });

  describe('Image File Naming', () => {
    const fixture = TEST_FIXTURE_FILES.simplePng;
    const analysis = createMockAnalysisResult(fixture, {
      suggestedName: 'test_image_thumbnail',
      date: '2024-06-20',
      category: 'Images'
    });

    test('uses suggestedName from analysis', () => {
      const settings = {
        convention: 'subject-date',
        separator: '-',
        dateFormat: 'YYYY-MM-DD',
        caseConvention: 'kebab-case'
      };

      const result = generateSuggestedNameFromAnalysis({
        originalFileName: fixture.name,
        analysis,
        settings
      });

      expect(result).toBeDefined();
      expect(result.endsWith('.png')).toBe(true);
      expect(result).toContain('test-image-thumbnail');
    });

    test('falls back to original name if no suggestedName', () => {
      const analysisNoSuggestion = { ...analysis, suggestedName: '' };
      const settings = {
        convention: 'subject-date',
        separator: '-',
        dateFormat: 'YYYY-MM-DD'
      };

      const result = generateSuggestedNameFromAnalysis({
        originalFileName: fixture.name,
        analysis: analysisNoSuggestion,
        settings
      });

      expect(result).toBeDefined();
      expect(result.endsWith('.png')).toBe(true);
    });
  });

  describe('3D Model Naming', () => {
    const fixture = TEST_FIXTURE_FILES.stlFile;
    const analysis = createMockAnalysisResult(fixture, {
      suggestedName: 'bracket_v2_final',
      date: '2024-03-10',
      category: '3D Models'
    });

    test('preserves STL extension', () => {
      const settings = {
        convention: 'subject-date',
        separator: '_',
        dateFormat: 'YYYYMMDD',
        caseConvention: 'snake_case'
      };

      const result = generateSuggestedNameFromAnalysis({
        originalFileName: fixture.name,
        analysis,
        settings
      });

      expect(result.endsWith('.stl')).toBe(true);
    });

    test('handles 3MF extension', () => {
      const fixture3mf = TEST_FIXTURE_FILES.threeMfFile;
      const settings = {
        convention: 'keep-original',
        separator: '-',
        dateFormat: 'YYYY-MM-DD'
      };

      const result = generateSuggestedNameFromAnalysis({
        originalFileName: fixture3mf.name,
        analysis: createMockAnalysisResult(fixture3mf),
        settings
      });

      expect(result.endsWith('.3mf')).toBe(true);
    });
  });
});

describe('File Naming - Date Formatting', () => {
  test('formats date as YYYY-MM-DD', () => {
    const date = new Date(2024, 5, 15); // June 15, 2024
    expect(formatDate(date, 'YYYY-MM-DD')).toBe('2024-06-15');
  });

  test('formats date as MM-DD-YYYY', () => {
    const date = new Date(2024, 0, 1); // Jan 1, 2024
    expect(formatDate(date, 'MM-DD-YYYY')).toBe('01-01-2024');
  });

  test('formats date as DD-MM-YYYY', () => {
    const date = new Date(2024, 11, 25); // Dec 25, 2024
    expect(formatDate(date, 'DD-MM-YYYY')).toBe('25-12-2024');
  });

  test('formats date as YYYYMMDD (compact)', () => {
    const date = new Date(2024, 6, 4); // July 4, 2024
    expect(formatDate(date, 'YYYYMMDD')).toBe('20240704');
  });

  test('defaults to YYYY-MM-DD for unknown format', () => {
    const date = new Date(2024, 2, 15);
    expect(formatDate(date, 'unknown')).toBe('2024-03-15');
  });
});

describe('File Naming - Case Conventions', () => {
  test('applies kebab-case', () => {
    expect(applyCaseConvention('My File Name', 'kebab-case')).toBe('my-file-name');
    expect(applyCaseConvention('test_file', 'kebab-case')).toBe('test-file');
  });

  test('applies snake_case', () => {
    expect(applyCaseConvention('My File Name', 'snake_case')).toBe('my_file_name');
    expect(applyCaseConvention('test-file', 'snake_case')).toBe('test_file');
  });

  test('applies camelCase', () => {
    expect(applyCaseConvention('my file name', 'camelCase')).toBe('myFileName');
    expect(applyCaseConvention('test_file_name', 'camelCase')).toBe('testFileName');
  });

  test('applies PascalCase', () => {
    expect(applyCaseConvention('my file name', 'PascalCase')).toBe('MyFileName');
    expect(applyCaseConvention('test-file-name', 'PascalCase')).toBe('TestFileName');
  });

  test('applies lowercase', () => {
    expect(applyCaseConvention('My File NAME', 'lowercase')).toBe('my file name');
  });

  test('applies UPPERCASE', () => {
    expect(applyCaseConvention('my file name', 'UPPERCASE')).toBe('MY FILE NAME');
  });

  test('returns unchanged for unknown convention', () => {
    expect(applyCaseConvention('My File', 'unknown')).toBe('My File');
  });
});

describe('File Naming - Extension Handling', () => {
  test('extracts .pdf extension', () => {
    expect(extractExtension('document.pdf')).toBe('.pdf');
  });

  test('extracts .png extension', () => {
    expect(extractExtension('image.PNG')).toBe('.png');
  });

  test('handles multiple dots', () => {
    expect(extractExtension('file.backup.tar.gz')).toBe('.gz');
  });

  test('returns empty for no extension', () => {
    expect(extractExtension('filename')).toBe('');
  });

  test('extracts filename from path', () => {
    expect(extractFileName('/path/to/file.txt')).toBe('file.txt');
    expect(extractFileName('C:\\Users\\test\\file.pdf')).toBe('file.pdf');
    expect(extractFileName('simple.txt')).toBe('simple.txt');
  });
});

describe('File Naming - Preview Generation', () => {
  test('generates preview with subject-date', () => {
    const result = generatePreviewName('MyDocument.pdf', {
      convention: 'subject-date',
      separator: '-',
      dateFormat: 'YYYY-MM-DD',
      caseConvention: 'kebab-case'
    });

    expect(result).toMatch(/mydocument-\d{4}-\d{2}-\d{2}\.pdf/);
  });

  test('generates preview with date-subject', () => {
    const result = generatePreviewName('Report.docx', {
      convention: 'date-subject',
      separator: '_',
      dateFormat: 'YYYYMMDD',
      caseConvention: 'snake_case'
    });

    expect(result).toMatch(/^\d{8}_report\.docx$/);
  });

  test('keeps original for keep-original convention', () => {
    const result = generatePreviewName('Original_Name.txt', {
      convention: 'keep-original',
      separator: '-',
      dateFormat: 'YYYY-MM-DD',
      caseConvention: 'kebab-case'
    });

    expect(result).toBe('original-name.txt');
  });
});

describe('File Naming - Analysis Integration', () => {
  test('uses analysis date when available', () => {
    const analysis = {
      date: '2023-12-01',
      suggestedName: 'test_document'
    };

    const result = generateSuggestedNameFromAnalysis({
      originalFileName: 'file.pdf',
      analysis,
      settings: {
        convention: 'subject-date',
        separator: '-',
        dateFormat: 'YYYY-MM-DD'
      }
    });

    expect(result).toContain('2023-12-01');
  });

  test('uses current date when analysis date missing', () => {
    const analysis = {
      suggestedName: 'test_document'
    };

    const result = generateSuggestedNameFromAnalysis({
      originalFileName: 'file.pdf',
      analysis,
      settings: {
        convention: 'subject-date',
        separator: '-',
        dateFormat: 'YYYY-MM-DD'
      }
    });

    // Should contain today's date
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    expect(result).toContain(todayStr);
  });

  test('truncates overly long suggested names', () => {
    const analysis = {
      suggestedName: 'a'.repeat(100),
      date: '2024-01-01'
    };

    const result = generateSuggestedNameFromAnalysis({
      originalFileName: 'file.pdf',
      analysis,
      settings: {
        convention: 'subject-date',
        separator: '-',
        dateFormat: 'YYYY-MM-DD'
      }
    });

    // Subject should be truncated to MAX_SUBJECT_LENGTH (50 chars)
    // Total: subject(50) + separator(1) + date(10) + extension(4) = 65 max
    expect(result.length).toBeLessThanOrEqual(70);
  });

  test('sanitizes unsafe characters', () => {
    const analysis = {
      suggestedName: 'file/with:invalid*chars',
      date: '2024-01-01'
    };

    const result = generateSuggestedNameFromAnalysis({
      originalFileName: 'test.pdf',
      analysis,
      settings: {
        convention: 'subject-date',
        separator: '-',
        dateFormat: 'YYYY-MM-DD'
      }
    });

    expect(result).not.toContain('/');
    expect(result).not.toContain(':');
    expect(result).not.toContain('*');
  });
});

describe('File Naming - Fixture Filenames', () => {
  describe.each(Object.entries(TEST_FIXTURE_FILES))('%s', (key, fixture) => {
    test('extractExtension works correctly', () => {
      const ext = extractExtension(fixture.name);
      expect(ext).toBe(fixture.extension);
    });

    test('generateSuggestedNameFromAnalysis preserves extension', () => {
      const analysis = createMockAnalysisResult(fixture);
      const settings = {
        convention: 'subject-date',
        separator: '-',
        dateFormat: 'YYYY-MM-DD'
      };

      const result = generateSuggestedNameFromAnalysis({
        originalFileName: fixture.name,
        analysis,
        settings
      });

      expect(result.endsWith(fixture.extension)).toBe(true);
    });
  });
});
