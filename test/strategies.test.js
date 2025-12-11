/**
 * Tests for Organization Strategies
 * Tests strategy definitions and file-to-strategy matching
 */

describe('Organization Strategies', () => {
  let strategies;
  let fileTypeCategories;
  let getFileTypeCategory;
  let scoreFileForStrategy;
  let matchesStrategyPattern;
  let mapFileToStrategy;
  let getStrategyBasedSuggestions;
  let getApplicableStrategies;
  let selectBestStrategy;
  let getFallbackSuggestion;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    const module = require('../src/main/services/organization/strategies');
    strategies = module.strategies;
    fileTypeCategories = module.fileTypeCategories;
    getFileTypeCategory = module.getFileTypeCategory;
    scoreFileForStrategy = module.scoreFileForStrategy;
    matchesStrategyPattern = module.matchesStrategyPattern;
    mapFileToStrategy = module.mapFileToStrategy;
    getStrategyBasedSuggestions = module.getStrategyBasedSuggestions;
    getApplicableStrategies = module.getApplicableStrategies;
    selectBestStrategy = module.selectBestStrategy;
    getFallbackSuggestion = module.getFallbackSuggestion;
  });

  describe('strategies', () => {
    test('defines project-based strategy', () => {
      expect(strategies['project-based']).toBeDefined();
      expect(strategies['project-based'].name).toBe('Project-Based');
      expect(strategies['project-based'].priority).toContain('project');
    });

    test('defines date-based strategy', () => {
      expect(strategies['date-based']).toBeDefined();
      expect(strategies['date-based'].priority).toContain('date');
    });

    test('defines type-based strategy', () => {
      expect(strategies['type-based']).toBeDefined();
      expect(strategies['type-based'].priority).toContain('file_type');
    });

    test('defines workflow-based strategy', () => {
      expect(strategies['workflow-based']).toBeDefined();
      expect(strategies['workflow-based'].priority).toContain('stage');
    });

    test('defines hierarchical strategy', () => {
      expect(strategies['hierarchical']).toBeDefined();
      expect(strategies['hierarchical'].priority).toContain('category');
    });
  });

  describe('fileTypeCategories', () => {
    test('categorizes documents', () => {
      expect(fileTypeCategories.documents).toContain('pdf');
      expect(fileTypeCategories.documents).toContain('doc');
      expect(fileTypeCategories.documents).toContain('docx');
    });

    test('categorizes images', () => {
      expect(fileTypeCategories.images).toContain('jpg');
      expect(fileTypeCategories.images).toContain('png');
      expect(fileTypeCategories.images).toContain('gif');
    });

    test('categorizes code', () => {
      expect(fileTypeCategories.code).toContain('js');
      expect(fileTypeCategories.code).toContain('py');
      expect(fileTypeCategories.code).toContain('java');
    });
  });

  describe('getFileTypeCategory', () => {
    test('returns Documents for pdf', () => {
      expect(getFileTypeCategory('pdf')).toBe('Documents');
    });

    test('returns Images for jpg', () => {
      expect(getFileTypeCategory('jpg')).toBe('Images');
    });

    test('returns Spreadsheets for xlsx', () => {
      expect(getFileTypeCategory('xlsx')).toBe('Spreadsheets');
    });

    test('returns Code for js', () => {
      expect(getFileTypeCategory('js')).toBe('Code');
    });

    test('returns Files for unknown extension', () => {
      expect(getFileTypeCategory('xyz')).toBe('Files');
    });

    test('is case-insensitive', () => {
      expect(getFileTypeCategory('PDF')).toBe('Documents');
      expect(getFileTypeCategory('JPG')).toBe('Images');
    });
  });

  describe('scoreFileForStrategy', () => {
    test('scores based on analysis properties', () => {
      const file = {
        name: 'report.pdf',
        extension: 'pdf',
        analysis: { project: 'Alpha', client: 'Acme' }
      };

      const score = scoreFileForStrategy(file, strategies['project-based']);

      expect(score).toBeGreaterThan(0);
    });

    test('returns 0 for file with no matching properties', () => {
      const file = {
        name: 'random.xyz',
        extension: 'xyz',
        analysis: {}
      };

      const score = scoreFileForStrategy(file, strategies['project-based']);

      expect(score).toBe(0);
    });

    test('adds pattern match bonus', () => {
      const file = {
        name: 'project_alpha_report.pdf',
        extension: 'pdf',
        analysis: {}
      };

      const score = scoreFileForStrategy(file, strategies['project-based']);

      // Should get pattern match bonus
      expect(score).toBeGreaterThan(0);
    });

    test('caps score at 1.0', () => {
      const file = {
        name: 'project.pdf',
        extension: 'pdf',
        analysis: {
          project: 'Alpha',
          client: 'Acme',
          task: 'Review'
        }
      };

      const score = scoreFileForStrategy(file, strategies['project-based']);

      expect(score).toBeLessThanOrEqual(1.0);
    });
  });

  describe('matchesStrategyPattern', () => {
    test('returns true for matching pattern', () => {
      const result = matchesStrategyPattern('project_alpha_report.pdf', 'Projects/{project_name}');

      expect(result).toBe(true);
    });

    test('returns false for non-matching pattern', () => {
      const result = matchesStrategyPattern('random_file.txt', 'Workflow/{stage}');

      expect(result).toBe(false);
    });

    test('is case-insensitive', () => {
      const result = matchesStrategyPattern('PROJECT_ALPHA.pdf', 'projects/{name}');

      expect(result).toBe(true);
    });
  });

  describe('mapFileToStrategy', () => {
    test('maps file to strategy folder', () => {
      const file = {
        name: 'report.pdf',
        extension: 'pdf',
        analysis: { project: 'Alpha', category: 'Reports' }
      };

      const result = mapFileToStrategy(file, strategies['project-based'], []);

      expect(result.name).toBeDefined();
      expect(result.path).toBeDefined();
    });

    test('uses default values for missing analysis', () => {
      const file = {
        name: 'file.pdf',
        extension: 'pdf',
        analysis: {}
      };

      const result = mapFileToStrategy(file, strategies['project-based'], []);

      expect(result.path).toContain('General');
    });

    test('uses pattern-based folder when no smart folder matches', () => {
      const file = {
        name: 'report.pdf',
        extension: 'pdf',
        analysis: { project: 'Alpha' }
      };

      const smartFolders = [{ name: 'Other', path: '/Other' }];

      const result = mapFileToStrategy(file, strategies['project-based'], smartFolders);

      // Should generate path from pattern
      expect(result.path).toBeDefined();
      expect(result.name).toBeDefined();
    });
  });

  describe('getStrategyBasedSuggestions', () => {
    test('returns suggestions for applicable strategies', () => {
      const file = {
        name: 'project_report.pdf',
        extension: 'pdf',
        analysis: { project: 'Alpha', date: '2024-01-01', category: 'Reports' }
      };

      // Use lower threshold to ensure matches
      const suggestions = getStrategyBasedSuggestions(file, [], 0.1);

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0].method).toBe('strategy_based');
    });

    test('filters by threshold', () => {
      const file = {
        name: 'random.xyz',
        extension: 'xyz',
        analysis: {}
      };

      const suggestions = getStrategyBasedSuggestions(file, [], 0.9);

      expect(suggestions).toHaveLength(0);
    });

    test('sorts by score', () => {
      const file = {
        name: 'project_report.pdf',
        extension: 'pdf',
        analysis: { project: 'Alpha', category: 'Reports' }
      };

      const suggestions = getStrategyBasedSuggestions(file, [], 0);

      if (suggestions.length > 1) {
        expect(suggestions[0].score).toBeGreaterThanOrEqual(suggestions[1].score);
      }
    });
  });

  describe('getApplicableStrategies', () => {
    test('returns strategies with applicability scores', () => {
      const file = {
        name: 'report.pdf',
        extension: 'pdf',
        analysis: { project: 'Alpha' }
      };

      const result = getApplicableStrategies(file);

      expect(Array.isArray(result)).toBe(true);
      if (result.length > 0) {
        expect(result[0].applicability).toBeDefined();
        expect(result[0].id).toBeDefined();
      }
    });

    test('filters low applicability strategies', () => {
      const file = {
        name: 'random.xyz',
        extension: 'xyz',
        analysis: {}
      };

      const result = getApplicableStrategies(file);

      // All returned strategies should have applicability > 0.2
      expect(result.every((s) => s.applicability > 0.2)).toBe(true);
    });

    test('sorts by applicability descending', () => {
      const file = {
        name: 'project_report.pdf',
        extension: 'pdf',
        analysis: { project: 'Alpha', category: 'Reports' }
      };

      const result = getApplicableStrategies(file);

      if (result.length > 1) {
        expect(result[0].applicability).toBeGreaterThanOrEqual(result[1].applicability);
      }
    });
  });

  describe('selectBestStrategy', () => {
    test('selects project-based for common project', () => {
      const patterns = {
        hasCommonProject: true,
        hasDatePattern: false,
        commonTerms: [],
        fileTypes: ['pdf']
      };

      const result = selectBestStrategy(patterns);

      expect(result.id).toBe('project-based');
    });

    test('selects date-based for date patterns', () => {
      const patterns = {
        hasCommonProject: false,
        hasDatePattern: true,
        commonTerms: [],
        fileTypes: ['pdf']
      };

      const result = selectBestStrategy(patterns);

      expect(result.id).toBe('date-based');
    });

    test('selects type-based for many file types', () => {
      const patterns = {
        hasCommonProject: false,
        hasDatePattern: false,
        commonTerms: [],
        fileTypes: ['pdf', 'jpg', 'xlsx', 'mp4']
      };

      const result = selectBestStrategy(patterns);

      expect(result.id).toBe('type-based');
    });

    test('returns adaptive strategy as fallback', () => {
      const patterns = {
        hasCommonProject: false,
        hasDatePattern: false,
        commonTerms: [],
        fileTypes: ['xyz']
      };

      const result = selectBestStrategy(patterns);

      expect(result.id).toBe('adaptive');
      expect(result.name).toBe('Adaptive Categorization');
    });

    test('boosts adaptive score based on file count', () => {
      const patterns = {
        hasCommonProject: false,
        hasDatePattern: false,
        commonTerms: [],
        fileTypes: ['xyz']
      };

      const resultNoFiles = selectBestStrategy(patterns, []);
      const resultWithFiles = selectBestStrategy(patterns, Array(20).fill({}));

      expect(resultWithFiles.score).toBeGreaterThanOrEqual(resultNoFiles.score);
    });
  });

  describe('getFallbackSuggestion', () => {
    test('returns category-based folder', () => {
      const file = { extension: 'pdf' };

      const result = getFallbackSuggestion(file, []);

      expect(result.folder).toBe('Documents');
      expect(result.confidence).toBe(0.3);
      expect(result.method).toBe('fallback');
    });

    test('matches existing smart folder', () => {
      const file = { extension: 'jpg' };
      const smartFolders = [{ name: 'My Images', path: '/My Images' }];

      const result = getFallbackSuggestion(file, smartFolders);

      expect(result.folder).toBe('My Images');
      expect(result.path).toBe('/My Images');
    });

    test('returns Files for unknown extension', () => {
      const file = { extension: 'xyz' };

      const result = getFallbackSuggestion(file, []);

      expect(result.folder).toBe('Files');
    });
  });
});
