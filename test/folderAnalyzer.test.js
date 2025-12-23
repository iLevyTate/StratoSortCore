/**
 * Tests for Folder Analyzer
 * Tests folder structure analysis and improvement suggestions
 */

// Mock logger
jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe('FolderAnalyzer', () => {
  let folderAnalyzer;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    folderAnalyzer = require('../src/main/services/organization/folderAnalyzer');
  });

  describe('commonCategories', () => {
    test('exports common category list', () => {
      expect(folderAnalyzer.commonCategories).toBeInstanceOf(Array);
      expect(folderAnalyzer.commonCategories).toContain('Projects');
      expect(folderAnalyzer.commonCategories).toContain('Archive');
      expect(folderAnalyzer.commonCategories).toContain('Downloads');
    });
  });

  describe('calculateStringSimilarity', () => {
    test('returns 1 for identical strings', () => {
      const result = folderAnalyzer.calculateStringSimilarity('test words', 'test words');

      expect(result).toBe(1);
    });

    test('returns 0 for completely different strings', () => {
      const result = folderAnalyzer.calculateStringSimilarity('abc def', 'xyz uvw');

      expect(result).toBe(0);
    });

    test('returns partial score for partial overlap', () => {
      const result = folderAnalyzer.calculateStringSimilarity('hello world', 'hello there');

      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThan(1);
    });

    test('handles empty strings', () => {
      // Empty string splits to [''] which has 1 element, so two empty strings match
      expect(folderAnalyzer.calculateStringSimilarity('', '')).toBe(1);
      // 'test' vs '' - 'test' has 1 word, '' has 1 element (''), no common words
      expect(folderAnalyzer.calculateStringSimilarity('test', '')).toBe(0);
      expect(folderAnalyzer.calculateStringSimilarity('', 'test')).toBe(0);
    });

    test('is case sensitive by design (caller should lowercase)', () => {
      const result = folderAnalyzer.calculateStringSimilarity('Test', 'test');

      // With single word strings, if cases differ, they won't match
      expect(result).toBe(0);
    });
  });

  describe('calculateKeywordOverlap', () => {
    test('returns 1 for identical keyword sets', () => {
      const keywords = ['alpha', 'beta', 'gamma'];

      const result = folderAnalyzer.calculateKeywordOverlap(keywords, keywords);

      expect(result).toBe(1);
    });

    test('returns 0 for completely different sets', () => {
      const result = folderAnalyzer.calculateKeywordOverlap(['a', 'b'], ['x', 'y']);

      expect(result).toBe(0);
    });

    test('returns partial score for partial overlap', () => {
      const result = folderAnalyzer.calculateKeywordOverlap(['a', 'b', 'c'], ['a', 'b', 'x']);

      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThan(1);
      expect(result).toBeCloseTo(0.5, 1); // 2 common out of 4 unique
    });

    test('handles empty arrays', () => {
      expect(folderAnalyzer.calculateKeywordOverlap([], [])).toBe(0);
      expect(folderAnalyzer.calculateKeywordOverlap(['a'], [])).toBe(0);
      expect(folderAnalyzer.calculateKeywordOverlap([], ['a'])).toBe(0);
    });

    test('is case insensitive', () => {
      const result = folderAnalyzer.calculateKeywordOverlap(['Alpha', 'Beta'], ['alpha', 'beta']);

      expect(result).toBe(1);
    });
  });

  describe('calculateFolderFitScore', () => {
    test('returns score based on name similarity', () => {
      const file = { name: 'project report.pdf', analysis: {} };
      const folder = { name: 'project' };

      const result = folderAnalyzer.calculateFolderFitScore(file, folder);

      expect(result).toBeGreaterThan(0);
    });

    test('includes description relevance in score', () => {
      const file = {
        name: 'test.pdf',
        analysis: { purpose: 'financial document' }
      };
      const folder = {
        name: 'finance',
        description: 'financial documents and reports'
      };

      const result = folderAnalyzer.calculateFolderFitScore(file, folder);

      expect(result).toBeGreaterThan(0);
    });

    test('boosts score for category match', () => {
      const file = {
        name: 'test.pdf',
        analysis: { category: 'work' }
      };
      const folder = { name: 'Work Projects' };

      const result = folderAnalyzer.calculateFolderFitScore(file, folder);

      expect(result).toBeGreaterThan(0);
    });

    test('includes keyword overlap in score', () => {
      const file = {
        name: 'test.pdf',
        analysis: { keywords: ['finance', 'report'] }
      };
      const folder = {
        name: 'Documents',
        keywords: ['finance', 'accounting']
      };

      const result = folderAnalyzer.calculateFolderFitScore(file, folder);

      expect(result).toBeGreaterThan(0);
    });

    test('caps score at 1.0', () => {
      const file = {
        name: 'financial report.pdf',
        analysis: {
          category: 'financial',
          purpose: 'financial report',
          keywords: ['finance', 'report', 'quarterly']
        }
      };
      const folder = {
        name: 'financial report',
        description: 'financial reports',
        keywords: ['finance', 'report', 'quarterly']
      };

      const result = folderAnalyzer.calculateFolderFitScore(file, folder);

      expect(result).toBeLessThanOrEqual(1.0);
    });

    test('handles files without analysis', () => {
      const file = { name: 'test.pdf' };
      const folder = { name: 'Documents' };

      const result = folderAnalyzer.calculateFolderFitScore(file, folder);

      expect(result).toBeGreaterThanOrEqual(0);
    });
  });

  describe('suggestFolderImprovement', () => {
    test('suggests adding keywords', () => {
      const file = {
        name: 'test.pdf',
        analysis: { keywords: ['finance', 'quarterly', 'report'] }
      };
      const folder = {
        name: 'Reports',
        keywords: ['report']
      };

      const result = folderAnalyzer.suggestFolderImprovement(file, folder);

      expect(result).toContain('Add keywords');
    });

    test('suggests description enhancement for short descriptions', () => {
      const file = {
        name: 'test.pdf',
        analysis: { purpose: 'quarterly financial report' }
      };
      const folder = {
        name: 'Reports',
        description: 'Reports folder'
      };

      const result = folderAnalyzer.suggestFolderImprovement(file, folder);

      expect(result).toContain('description');
    });

    test('suggests subfolder for subcategory', () => {
      const file = {
        name: 'test.pdf',
        analysis: { subcategory: 'Q3 2024' }
      };
      const folder = { name: 'Reports' };

      const result = folderAnalyzer.suggestFolderImprovement(file, folder);

      expect(result).toContain('subfolder');
      expect(result).toContain('Q3 2024');
    });

    test('returns well-suited message when no improvements needed', () => {
      const file = { name: 'test.pdf', analysis: {} };
      const folder = { name: 'Documents' };

      const result = folderAnalyzer.suggestFolderImprovement(file, folder);

      expect(result).toContain('well-suited');
    });
  });

  describe('suggestNewSmartFolder', () => {
    test('suggests folder based on file category', () => {
      const file = {
        name: 'test.pdf',
        extension: '.pdf',
        analysis: { category: 'Finance' }
      };
      const existingFolders = [];
      const getFileTypeCategory = jest.fn(() => 'Documents');

      const result = folderAnalyzer.suggestNewSmartFolder(
        file,
        existingFolders,
        getFileTypeCategory
      );

      expect(result.folder).toBe('Finance');
      expect(result.isNew).toBe(true);
      expect(result.method).toBe('new_folder_suggestion');
    });

    test('uses file type category when no analysis category', () => {
      const file = {
        name: 'test.pdf',
        extension: '.pdf',
        analysis: {}
      };
      const existingFolders = [];
      const getFileTypeCategory = jest.fn(() => 'PDFs');

      const result = folderAnalyzer.suggestNewSmartFolder(
        file,
        existingFolders,
        getFileTypeCategory
      );

      expect(result.folder).toBe('PDFs');
      expect(getFileTypeCategory).toHaveBeenCalledWith('.pdf');
    });

    test('appends project name when folder exists', () => {
      const file = {
        name: 'test.pdf',
        extension: '.pdf',
        analysis: { category: 'Reports', project: 'ProjectX' }
      };
      const existingFolders = [{ name: 'Reports' }];
      const getFileTypeCategory = jest.fn();

      const result = folderAnalyzer.suggestNewSmartFolder(
        file,
        existingFolders,
        getFileTypeCategory
      );

      expect(result.folder).toBe('ProjectX - Reports');
    });

    test('appends subcategory when folder exists and no project', () => {
      const file = {
        name: 'test.pdf',
        extension: '.pdf',
        analysis: { category: 'Reports', subcategory: 'Quarterly' }
      };
      const existingFolders = [{ name: 'Reports' }];
      const getFileTypeCategory = jest.fn();

      const result = folderAnalyzer.suggestNewSmartFolder(
        file,
        existingFolders,
        getFileTypeCategory
      );

      expect(result.folder).toBe('Reports - Quarterly');
    });

    test('includes description in suggestion', () => {
      const file = {
        name: 'test.pdf',
        extension: '.pdf',
        analysis: { purpose: 'budget planning' }
      };
      const existingFolders = [];
      const getFileTypeCategory = jest.fn(() => 'Documents');

      const result = folderAnalyzer.suggestNewSmartFolder(
        file,
        existingFolders,
        getFileTypeCategory
      );

      expect(result.description).toContain('budget planning');
    });
  });

  describe('identifyMissingCategories', () => {
    test('identifies missing categories that would benefit files', () => {
      const smartFolders = [{ name: 'Work' }];
      const files = [
        { name: 'project.pdf', analysis: { category: 'projects' } },
        { name: 'archive.zip', analysis: { category: 'archive' } }
      ];

      const result = folderAnalyzer.identifyMissingCategories(smartFolders, files);

      expect(result.some((m) => m.name === 'Projects')).toBe(true);
      expect(result.some((m) => m.name === 'Archive')).toBe(true);
    });

    test('does not suggest existing categories', () => {
      const smartFolders = [{ name: 'Projects' }, { name: 'Archive' }];
      const files = [{ name: 'project.pdf', analysis: { category: 'projects' } }];

      const result = folderAnalyzer.identifyMissingCategories(smartFolders, files);

      expect(result.some((m) => m.name === 'Projects')).toBe(false);
      expect(result.some((m) => m.name === 'Archive')).toBe(false);
    });

    test('only suggests categories that would benefit existing files', () => {
      const smartFolders = [];
      const files = [{ name: 'test.pdf', analysis: {} }];

      const result = folderAnalyzer.identifyMissingCategories(smartFolders, files);

      // Should not suggest categories that don't match any files
      expect(result.length).toBeLessThan(folderAnalyzer.commonCategories.length);
    });

    test('matches categories by file name', () => {
      const smartFolders = [];
      const files = [{ name: 'downloads.txt' }];

      const result = folderAnalyzer.identifyMissingCategories(smartFolders, files);

      expect(result.some((m) => m.name === 'Downloads')).toBe(true);
    });
  });

  describe('findOverlappingFolders', () => {
    test('identifies folders with similar names', () => {
      // These folders need high similarity (>0.7) to be flagged
      // Similarity = 0.4 * nameSimilarity + 0.3 * descSimilarity + 0.3 * keywordOverlap
      // Using nearly identical names, descriptions, and keywords to exceed threshold
      const smartFolders = [
        {
          name: 'Financial Reports',
          description: 'financial reports folder',
          keywords: ['finance', 'reports', 'budget']
        },
        {
          name: 'Financial Reports Archive',
          description: 'financial reports folder',
          keywords: ['finance', 'reports', 'archive']
        }
      ];

      const result = folderAnalyzer.findOverlappingFolders(smartFolders);

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].suggestion).toContain('merging');
    });

    test('identifies folders with similar keywords', () => {
      // Need high overall similarity (>0.7) combining name, description, and keywords
      const smartFolders = [
        {
          name: 'Finance Budget',
          description: 'budget reports',
          keywords: ['finance', 'budget', 'reports']
        },
        {
          name: 'Finance Budget',
          description: 'budget documents',
          keywords: ['finance', 'budget', 'documents']
        }
      ];

      const result = folderAnalyzer.findOverlappingFolders(smartFolders);

      expect(result.length).toBeGreaterThan(0);
    });

    test('returns empty array for distinct folders', () => {
      const smartFolders = [
        { name: 'Photos', keywords: ['images', 'pictures'] },
        { name: 'Documents', keywords: ['text', 'files'] }
      ];

      const result = folderAnalyzer.findOverlappingFolders(smartFolders);

      expect(result.length).toBe(0);
    });

    test('handles large folder lists with iteration limit', () => {
      // Create many folders to test iteration limit
      const smartFolders = Array.from({ length: 200 }, (_, i) => ({
        name: `Folder ${i}`,
        keywords: ['common', 'keyword']
      }));

      // Should complete without infinite loop
      const result = folderAnalyzer.findOverlappingFolders(smartFolders);

      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('findUnderutilizedFolders', () => {
    test('identifies unused folders', () => {
      const smartFolders = [
        { name: 'Active Folder', id: '1' },
        { name: 'Unused Folder', id: '2' }
      ];
      const usageStats = new Map([
        ['1', 10],
        ['2', 0]
      ]);

      const result = folderAnalyzer.findUnderutilizedFolders(smartFolders, usageStats);

      expect(result.length).toBe(1);
      expect(result[0].name).toBe('Unused Folder');
      expect(result[0].suggestion).toContain('never been used');
    });

    test('identifies rarely used folders', () => {
      const smartFolders = [{ name: 'Rarely Used', id: '1' }];
      const usageStats = new Map([['1', 2]]);

      const result = folderAnalyzer.findUnderutilizedFolders(smartFolders, usageStats);

      expect(result.length).toBe(1);
      expect(result[0].suggestion).toContain('rarely used');
    });

    test('excludes well-used folders', () => {
      const smartFolders = [
        { name: 'Well Used', id: '1' },
        { name: 'Also Used', id: '2' }
      ];
      const usageStats = new Map([
        ['1', 50],
        ['2', 10]
      ]);

      const result = folderAnalyzer.findUnderutilizedFolders(smartFolders, usageStats);

      expect(result.length).toBe(0);
    });

    test('handles folders without stats', () => {
      const smartFolders = [{ name: 'New Folder', id: '1' }];
      const usageStats = new Map();

      const result = folderAnalyzer.findUnderutilizedFolders(smartFolders, usageStats);

      expect(result.length).toBe(1);
      expect(result[0].usageCount).toBe(0);
    });

    test('uses folder name as fallback for id', () => {
      const smartFolders = [{ name: 'No ID Folder' }];
      const usageStats = new Map([['No ID Folder', 1]]);

      const result = folderAnalyzer.findUnderutilizedFolders(smartFolders, usageStats);

      expect(result.length).toBe(1);
      expect(result[0].usageCount).toBe(1);
    });
  });

  describe('suggestHierarchyImprovements', () => {
    test('suggests parent folder for related folders', () => {
      const smartFolders = [
        { name: 'Work Projects' },
        { name: 'Work Documents' },
        { name: 'Work Reports' }
      ];

      const result = folderAnalyzer.suggestHierarchyImprovements(smartFolders);

      expect(result.length).toBe(1);
      expect(result[0].type).toBe('create_parent');
      expect(result[0].parent).toBe('Work');
    });

    test('does not suggest if parent already exists', () => {
      const smartFolders = [
        { name: 'Work' },
        { name: 'Work Projects' },
        { name: 'Work Documents' },
        { name: 'Work Reports' }
      ];

      const result = folderAnalyzer.suggestHierarchyImprovements(smartFolders);

      expect(result.length).toBe(0);
    });

    test('does not suggest for single folders', () => {
      const smartFolders = [{ name: 'Work Projects' }, { name: 'Personal Documents' }];

      const result = folderAnalyzer.suggestHierarchyImprovements(smartFolders);

      expect(result.length).toBe(0);
    });

    test('handles various separators', () => {
      const smartFolders = [
        { name: 'Finance-Budget' },
        { name: 'Finance_Reports' },
        { name: 'Finance Documents' }
      ];

      const result = folderAnalyzer.suggestHierarchyImprovements(smartFolders);

      expect(result.length).toBe(1);
      expect(result[0].parent).toBe('Finance');
    });
  });

  describe('calculateFolderSimilarity', () => {
    test('calculates similarity between folders', () => {
      const folder1 = {
        name: 'Financial Reports',
        description: 'Financial documents',
        keywords: ['finance', 'reports']
      };
      const folder2 = {
        name: 'Financial Documents',
        description: 'Finance related files',
        keywords: ['finance', 'documents']
      };

      const result = folderAnalyzer.calculateFolderSimilarity(folder1, folder2);

      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThanOrEqual(1);
    });

    test('returns high similarity for nearly identical folders', () => {
      const folder1 = {
        name: 'Reports',
        description: 'All reports',
        keywords: ['reports', 'documents']
      };
      const folder2 = {
        name: 'Reports',
        description: 'All reports',
        keywords: ['reports', 'documents']
      };

      const result = folderAnalyzer.calculateFolderSimilarity(folder1, folder2);

      expect(result).toBeGreaterThan(0.9);
    });

    test('handles folders without descriptions', () => {
      const folder1 = { name: 'Reports' };
      const folder2 = { name: 'Reports' };

      const result = folderAnalyzer.calculateFolderSimilarity(folder1, folder2);

      expect(result).toBeGreaterThan(0);
    });

    test('handles folders without keywords', () => {
      const folder1 = { name: 'Reports', description: 'Reports folder' };
      const folder2 = { name: 'Documents', description: 'Documents folder' };

      const result = folderAnalyzer.calculateFolderSimilarity(folder1, folder2);

      expect(result).toBeGreaterThanOrEqual(0);
    });
  });

  describe('analyzeFolderStructure', () => {
    test('returns comprehensive improvement suggestions', () => {
      const smartFolders = [
        { name: 'Work Reports', id: '1' },
        { name: 'Work Documents', id: '2' },
        { name: 'Work Files', id: '3' }
      ];
      const files = [{ name: 'archive.zip', analysis: { category: 'archive' } }];
      const usageStats = new Map([
        ['1', 0],
        ['2', 1],
        ['3', 50]
      ]);

      const result = folderAnalyzer.analyzeFolderStructure(smartFolders, files, usageStats);

      expect(Array.isArray(result)).toBe(true);
      // Should have various improvement types
      const types = result.map((r) => r.type);
      expect(types).toContain('missing_categories');
      expect(types).toContain('underutilized_folders');
      expect(types).toContain('hierarchy_improvements');
    });

    test('handles empty folder list', () => {
      const result = folderAnalyzer.analyzeFolderStructure([], [], new Map());

      expect(Array.isArray(result)).toBe(true);
    });

    test('uses default values for optional parameters', () => {
      const smartFolders = [{ name: 'Test', id: '1' }];

      const result = folderAnalyzer.analyzeFolderStructure(smartFolders);

      expect(Array.isArray(result)).toBe(true);
    });

    test('includes priority levels in suggestions', () => {
      const smartFolders = [{ name: 'Unused', id: '1' }];
      const files = [{ name: 'archive.zip', analysis: { category: 'archive' } }];

      const result = folderAnalyzer.analyzeFolderStructure(smartFolders, files, new Map());

      result.forEach((improvement) => {
        expect(['high', 'medium', 'low']).toContain(improvement.priority);
      });
    });
  });
});
