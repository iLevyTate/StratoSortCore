/**
 * Tests for File Pattern Analyzer
 * Tests pattern detection in file batches for organization
 */

describe('File Pattern Analyzer', () => {
  let analyzeFilePatterns;
  let getDateRange;
  let findDominantCategory;
  let generateBatchRecommendations;
  let generateFileSummary;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    const module = require('../src/main/services/organization/filePatternAnalyzer');
    analyzeFilePatterns = module.analyzeFilePatterns;
    getDateRange = module.getDateRange;
    findDominantCategory = module.findDominantCategory;
    generateBatchRecommendations = module.generateBatchRecommendations;
    generateFileSummary = module.generateFileSummary;
  });

  describe('analyzeFilePatterns', () => {
    test('detects common project', () => {
      const files = [
        { name: 'file1.pdf', extension: 'pdf', analysis: { project: 'Alpha' } },
        { name: 'file2.pdf', extension: 'pdf', analysis: { project: 'Alpha' } }
      ];

      const result = analyzeFilePatterns(files);

      expect(result.hasCommonProject).toBe(true);
      expect(result.project).toBe('Alpha');
    });

    test('no common project when projects differ', () => {
      const files = [
        { name: 'file1.pdf', extension: 'pdf', analysis: { project: 'Alpha' } },
        { name: 'file2.pdf', extension: 'pdf', analysis: { project: 'Beta' } }
      ];

      const result = analyzeFilePatterns(files);

      expect(result.hasCommonProject).toBe(false);
      expect(result.project).toBeNull();
    });

    test('detects date patterns', () => {
      const files = [
        { name: 'report.pdf', extension: 'pdf', analysis: { documentDate: '2024-01-01' } },
        { name: 'summary.pdf', extension: 'pdf', analysis: { documentDate: '2024-01-15' } }
      ];

      const result = analyzeFilePatterns(files);

      expect(result.hasDatePattern).toBe(true);
      expect(result.dateRange).toBeDefined();
    });

    test('collects file types', () => {
      const files = [
        { name: 'doc.pdf', extension: 'pdf' },
        { name: 'image.jpg', extension: 'jpg' },
        { name: 'data.csv', extension: 'csv' }
      ];

      const result = analyzeFilePatterns(files);

      expect(result.fileTypes).toContain('pdf');
      expect(result.fileTypes).toContain('jpg');
      expect(result.fileTypes).toContain('csv');
    });

    test('finds dominant category', () => {
      const files = [
        { name: 'a.pdf', extension: 'pdf', analysis: { category: 'Reports' } },
        { name: 'b.pdf', extension: 'pdf', analysis: { category: 'Reports' } },
        { name: 'c.pdf', extension: 'pdf', analysis: { category: 'Invoices' } }
      ];

      const result = analyzeFilePatterns(files);

      expect(result.dominantCategory).toBe('Reports');
    });

    test('extracts common terms from filenames', () => {
      const files = [
        { name: 'project_report_2024.pdf', extension: 'pdf' },
        { name: 'project_summary_2024.pdf', extension: 'pdf' },
        { name: 'project_analysis_2024.pdf', extension: 'pdf' }
      ];

      const result = analyzeFilePatterns(files);

      expect(result.commonTerms).toContain('project');
      expect(result.commonTerms).toContain('2024');
    });

    test('ignores short words in common terms', () => {
      const files = [
        { name: 'the_doc.pdf', extension: 'pdf' },
        { name: 'the_file.pdf', extension: 'pdf' },
        { name: 'the_data.pdf', extension: 'pdf' }
      ];

      const result = analyzeFilePatterns(files);

      // 'the' has only 3 chars, should be ignored
      expect(result.commonTerms).not.toContain('the');
    });

    test('handles files without analysis', () => {
      const files = [
        { name: 'file1.pdf', extension: 'pdf' },
        { name: 'file2.pdf', extension: 'pdf' }
      ];

      const result = analyzeFilePatterns(files);

      expect(result.hasCommonProject).toBe(false);
      expect(result.project).toBeNull();
      expect(result.hasDatePattern).toBe(false);
    });
  });

  describe('getDateRange', () => {
    test('returns null for empty set', () => {
      const result = getDateRange(new Set());
      expect(result).toBeNull();
    });

    test('returns single date info', () => {
      const dates = new Set(['2024-01-15']);
      const result = getDateRange(dates);

      expect(result.start).toBe('2024-01-15');
      expect(result.end).toBe('2024-01-15');
      expect(result.description).toContain('Single date');
    });

    test('returns date range info', () => {
      const dates = new Set(['2024-01-01', '2024-03-15', '2024-02-10']);
      const result = getDateRange(dates);

      expect(result.start).toBe('2024-01-01');
      expect(result.end).toBe('2024-03-15');
      expect(result.description).toContain('2024-01-01');
      expect(result.description).toContain('2024-03-15');
    });
  });

  describe('findDominantCategory', () => {
    test('returns null for empty object', () => {
      const result = findDominantCategory({});
      expect(result).toBeNull();
    });

    test('returns single category', () => {
      // Now expects object with category counts
      const result = findDominantCategory({ Reports: 1 });
      expect(result).toBe('Reports');
    });

    test('returns most frequent category', () => {
      // Object with category counts - Reports has highest count
      const categoryCounts = { Reports: 5, Invoices: 3, Contracts: 2 };
      const result = findDominantCategory(categoryCounts);

      // Should return the category with highest count
      expect(result).toBe('Reports');
    });
  });

  describe('generateBatchRecommendations', () => {
    test('recommends project grouping for common project', () => {
      const patterns = {
        hasCommonProject: true,
        project: 'Alpha',
        hasDatePattern: false,
        commonTerms: []
      };

      const result = generateBatchRecommendations(new Map(), patterns);

      const projectRec = result.find((r) => r.type === 'project_grouping');
      expect(projectRec).toBeDefined();
      expect(projectRec.confidence).toBe(0.9);
      expect(projectRec.description).toContain('Alpha');
    });

    test('recommends temporal organization for date patterns', () => {
      const patterns = {
        hasCommonProject: false,
        hasDatePattern: true,
        dateRange: { description: '2024-01 to 2024-03' },
        commonTerms: []
      };

      const result = generateBatchRecommendations([], patterns);

      const temporalRec = result.find((r) => r.type === 'temporal_organization');
      expect(temporalRec).toBeDefined();
      expect(temporalRec.confidence).toBe(0.7);
    });

    test('recommends workflow organization for workflow terms', () => {
      const patterns = {
        hasCommonProject: false,
        hasDatePattern: false,
        commonTerms: ['draft', 'final']
      };

      const result = generateBatchRecommendations([], patterns);

      const workflowRec = result.find((r) => r.type === 'workflow_organization');
      expect(workflowRec).toBeDefined();
      expect(workflowRec.confidence).toBe(0.8);
    });

    test('recommends batch cleanup for many groups', () => {
      const patterns = {
        hasCommonProject: false,
        hasDatePattern: false,
        commonTerms: []
      };

      // Create 6+ groups
      const groups = [1, 2, 3, 4, 5, 6];

      const result = generateBatchRecommendations(groups, patterns);

      const cleanupRec = result.find((r) => r.type === 'batch_cleanup');
      expect(cleanupRec).toBeDefined();
      expect(cleanupRec.confidence).toBe(0.6);
    });

    test('handles Map input for groups', () => {
      const patterns = {
        hasCommonProject: false,
        hasDatePattern: false,
        commonTerms: []
      };

      const groups = new Map([
        ['a', 1],
        ['b', 2],
        ['c', 3],
        ['d', 4],
        ['e', 5],
        ['f', 6]
      ]);

      const result = generateBatchRecommendations(groups, patterns);

      const cleanupRec = result.find((r) => r.type === 'batch_cleanup');
      expect(cleanupRec).toBeDefined();
    });
  });

  describe('generateFileSummary', () => {
    test('generates summary from file properties', () => {
      const file = {
        name: 'report.pdf',
        extension: 'pdf',
        analysis: {
          project: 'Alpha',
          purpose: 'Financial reporting',
          category: 'Reports',
          keywords: ['quarterly', 'finance']
        }
      };

      const summary = generateFileSummary(file);

      expect(summary).toContain('report.pdf');
      expect(summary).toContain('pdf');
      expect(summary).toContain('Alpha');
      expect(summary).toContain('Financial reporting');
      expect(summary).toContain('Reports');
      expect(summary).toContain('quarterly');
    });

    test('handles missing analysis', () => {
      const file = {
        name: 'file.txt',
        extension: 'txt'
      };

      const summary = generateFileSummary(file);

      expect(summary).toContain('file.txt');
      expect(summary).toContain('txt');
    });

    test('filters out falsy values', () => {
      const file = {
        name: 'test.pdf',
        extension: 'pdf',
        analysis: {
          project: null,
          purpose: undefined,
          category: '',
          keywords: []
        }
      };

      const summary = generateFileSummary(file);

      // Should not have extra spaces from filtered values
      // Now includes semantic keywords for the file extension
      expect(summary).toContain('test.pdf');
      expect(summary).toContain('pdf');
      // Semantic keywords are appended after a pipe separator
      expect(summary).toMatch(/test\.pdf.*pdf/);
    });
  });
});
