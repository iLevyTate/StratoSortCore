/**
 * Tests for Naming Utilities
 * Tests file naming conventions and formatting
 *
 * Runs the same test suite against both the Renderer and Main process implementations
 * to ensure consistency and coverage.
 */

const runNamingTests = (moduleName, modulePath) => {
  describe(`namingUtils (${moduleName})`, () => {
    let namingUtils;

    beforeEach(() => {
      // jest.resetModules(); // Removed - breaks module imports
      namingUtils = require(modulePath);
    });

    describe('formatDate', () => {
      // Use explicit time to avoid timezone issues
      const testDate = new Date(2024, 2, 15); // March 15, 2024 (month is 0-indexed)

      test('formats YYYY-MM-DD', () => {
        expect(namingUtils.formatDate(testDate, 'YYYY-MM-DD')).toBe('2024-03-15');
      });

      test('formats MM-DD-YYYY', () => {
        expect(namingUtils.formatDate(testDate, 'MM-DD-YYYY')).toBe('03-15-2024');
      });

      test('formats DD-MM-YYYY', () => {
        expect(namingUtils.formatDate(testDate, 'DD-MM-YYYY')).toBe('15-03-2024');
      });

      test('formats YYYYMMDD', () => {
        expect(namingUtils.formatDate(testDate, 'YYYYMMDD')).toBe('20240315');
      });

      test('defaults to YYYY-MM-DD for unknown format', () => {
        expect(namingUtils.formatDate(testDate, 'unknown')).toBe('2024-03-15');
      });

      test('pads single digit month', () => {
        const jan = new Date(2024, 0, 5); // January 5, 2024
        expect(namingUtils.formatDate(jan, 'YYYY-MM-DD')).toBe('2024-01-05');
      });

      test('pads single digit day', () => {
        const day5 = new Date(2024, 11, 5); // December 5, 2024
        expect(namingUtils.formatDate(day5, 'YYYY-MM-DD')).toBe('2024-12-05');
      });
    });

    describe('applyCaseConvention', () => {
      test('applies kebab-case', () => {
        expect(namingUtils.applyCaseConvention('Hello World Test', 'kebab-case')).toBe(
          'hello-world-test'
        );
      });

      test('applies snake_case', () => {
        expect(namingUtils.applyCaseConvention('Hello World Test', 'snake_case')).toBe(
          'hello_world_test'
        );
      });

      test('applies camelCase', () => {
        expect(namingUtils.applyCaseConvention('Hello World Test', 'camelCase')).toBe(
          'helloWorldTest'
        );
      });

      test('applies PascalCase', () => {
        expect(namingUtils.applyCaseConvention('hello world test', 'PascalCase')).toBe(
          'HelloWorldTest'
        );
      });

      test('applies lowercase', () => {
        expect(namingUtils.applyCaseConvention('Hello World', 'lowercase')).toBe('hello world');
      });

      test('applies UPPERCASE', () => {
        expect(namingUtils.applyCaseConvention('Hello World', 'UPPERCASE')).toBe('HELLO WORLD');
      });

      test('returns original for unknown convention', () => {
        expect(namingUtils.applyCaseConvention('Hello World', 'unknown')).toBe('Hello World');
      });

      test('kebab-case removes leading/trailing dashes', () => {
        expect(namingUtils.applyCaseConvention('  Hello  ', 'kebab-case')).toBe('hello');
      });

      test('snake_case removes leading/trailing underscores', () => {
        expect(namingUtils.applyCaseConvention('  Hello  ', 'snake_case')).toBe('hello');
      });

      test('handles special characters', () => {
        expect(namingUtils.applyCaseConvention('Hello@World#Test', 'kebab-case')).toBe(
          'hello-world-test'
        );
      });
    });

    describe('generatePreviewName', () => {
      const baseSettings = {
        convention: 'keep-original',
        separator: '-',
        dateFormat: 'YYYY-MM-DD',
        caseConvention: 'kebab-case'
      };

      test('keeps original name', () => {
        const result = namingUtils.generatePreviewName('MyFile.txt', {
          ...baseSettings,
          convention: 'keep-original',
          caseConvention: undefined
        });
        expect(result).toBe('MyFile.txt');
      });

      test('applies subject-date convention', () => {
        const result = namingUtils.generatePreviewName('MyFile.txt', {
          ...baseSettings,
          convention: 'subject-date'
        });
        expect(result).toMatch(/myfile-\d{4}-\d{2}-\d{2}\.txt/);
      });

      test('applies date-subject convention', () => {
        const result = namingUtils.generatePreviewName('MyFile.txt', {
          ...baseSettings,
          convention: 'date-subject'
        });
        expect(result).toMatch(/\d{4}-\d{2}-\d{2}-myfile\.txt/);
      });

      test('applies project-subject-date convention', () => {
        const result = namingUtils.generatePreviewName('MyFile.txt', {
          ...baseSettings,
          convention: 'project-subject-date'
        });
        expect(result).toMatch(/project-myfile-\d{4}-\d{2}-\d{2}\.txt/);
      });

      test('applies category-subject convention', () => {
        const result = namingUtils.generatePreviewName('MyFile.txt', {
          ...baseSettings,
          convention: 'category-subject'
        });
        expect(result).toBe('category-myfile.txt');
      });

      test('preserves file extension', () => {
        const result = namingUtils.generatePreviewName('document.pdf', {
          ...baseSettings,
          convention: 'keep-original'
        });
        expect(result).toContain('.pdf');
      });

      test('handles files without extension', () => {
        const result = namingUtils.generatePreviewName('README', {
          ...baseSettings,
          convention: 'keep-original',
          caseConvention: undefined // Override to keep original case
        });
        expect(result).toBe('README');
      });

      test('uses custom separator', () => {
        const result = namingUtils.generatePreviewName('MyFile.txt', {
          ...baseSettings,
          convention: 'subject-date',
          separator: '_',
          caseConvention: undefined
        });
        expect(result).toContain('_');
      });
    });

    describe('generateSuggestedNameFromAnalysis', () => {
      const settings = {
        convention: 'project-subject-date',
        separator: ' - ',
        dateFormat: 'YYYYMMDD',
        caseConvention: 'kebab-case'
      };

      test('uses analysis fields (project/subject/date) and preserves extension', () => {
        const result = namingUtils.generateSuggestedNameFromAnalysis({
          originalFileName: 'Invoice Q1.pdf',
          analysis: {
            date: '2024-01-15',
            project: 'Acme Corp',
            category: 'Financial Documents',
            suggestedName: 'Q1 Invoice'
          },
          settings
        });

        // kebab-case will normalize separators and words; date format is YYYYMMDD
        expect(result).toBe('acme-corp-q1-invoice-20240115.pdf');
      });

      test('category-subject uses analysis category', () => {
        const result = namingUtils.generateSuggestedNameFromAnalysis({
          originalFileName: 'photo.jpg',
          analysis: { category: 'Research', suggestedName: 'Microscopy Image' },
          settings: { ...settings, convention: 'category-subject', separator: '_' }
        });

        // kebab-case normalizes any separators to dashes
        expect(result).toBe('research-microscopy-image.jpg');
      });

      test('keep-original preserves original base name and extension', () => {
        const result = namingUtils.generateSuggestedNameFromAnalysis({
          originalFileName: 'My Original Name.txt',
          analysis: { suggestedName: 'Ignored' },
          settings: { ...settings, convention: 'keep-original', caseConvention: undefined }
        });

        expect(result).toBe('My Original Name.txt');
      });

      test('replaces underscores with spaces before casing', () => {
        // Fix verification: ensure underscores are treated as separators
        const result = namingUtils.generateSuggestedNameFromAnalysis({
          originalFileName: 'test.txt',
          analysis: { suggestedName: 'my_file_name' },
          // Use 'subject-date' to force reconstruction from components, skipping casing for clarity first
          settings: {
            // Use 'subject' logic implied by 'project-subject-date' or similar if we want suggestedName
            // 'project-subject-date' uses 'suggestedName' as subject.
            convention: 'project-subject-date',
            separator: '-',
            dateFormat: 'YYYYMMDD',
            caseConvention: undefined // No casing, just sanitation
          }
        });
        // project (Project) - subject (my file name) - date (YYYYMMDD)
        // sanitizeToken should turn 'my_file_name' into 'my file name'
        expect(result).toMatch(/Project-my file name-\d{8}\.txt/);
      });

      test('does not double-append date when suggestedName already ends with the same date', () => {
        const result = namingUtils.generateSuggestedNameFromAnalysis({
          originalFileName: 'image.png',
          analysis: {
            date: '2023-04-19',
            suggestedName: 'brain inspired decision engine 2023-04-19'
          },
          settings: {
            convention: 'subject-date',
            separator: '-',
            dateFormat: 'YYYY-MM-DD',
            caseConvention: 'kebab-case'
          },
          // Even if the model date is present, we prefer real metadata when provided.
          fileTimestamps: { modified: '2023-04-19' }
        });

        expect(result).toBe('brain-inspired-decision-engine-2023-04-19.png');
      });

      test('strips duplicated trailing date tokens (e.g. ...-2023-04-19-2023-04-19) before appending', () => {
        const result = namingUtils.generateSuggestedNameFromAnalysis({
          originalFileName: 'image.png',
          analysis: {
            date: '2023-04-19',
            suggestedName: 'brain-inspired-decision-engine-2023-04-19-2023-04-19'
          },
          settings: {
            convention: 'subject-date',
            separator: '-',
            dateFormat: 'YYYY-MM-DD',
            caseConvention: 'kebab-case'
          },
          fileTimestamps: { modified: '2023-04-19' }
        });

        expect(result).toBe('brain-inspired-decision-engine-2023-04-19.png');
      });

      test('prefers date from filename over analysis date', () => {
        const result = namingUtils.generateSuggestedNameFromAnalysis({
          originalFileName: 'brain-inspired-decision-engine-2023-04-17.png',
          analysis: { date: '2025-12-24', suggestedName: 'Brain inspired decision engine' },
          settings: {
            convention: 'subject-date',
            separator: '-',
            dateFormat: 'YYYY-MM-DD',
            caseConvention: 'kebab-case'
          }
        });

        expect(result).toBe('brain-inspired-decision-engine-2023-04-17.png');
      });

      test('prefers modified timestamp over analysis date when filename has no date', () => {
        const result = namingUtils.generateSuggestedNameFromAnalysis({
          originalFileName: 'brain-inspired-decision-engine.png',
          analysis: { date: '2023-01-01', suggestedName: 'Brain inspired decision engine' },
          fileTimestamps: { modified: '2023-04-18' },
          settings: {
            convention: 'subject-date',
            separator: '-',
            dateFormat: 'YYYY-MM-DD',
            caseConvention: 'kebab-case'
          }
        });

        expect(result).toBe('brain-inspired-decision-engine-2023-04-18.png');
      });
    });

    describe('makeUniqueFileName', () => {
      test('keeps first occurrence unchanged and appends numeric suffix for duplicates', () => {
        const used = new Map();
        expect(namingUtils.makeUniqueFileName('photo.jpg', used)).toBe('photo.jpg');
        expect(namingUtils.makeUniqueFileName('photo.jpg', used)).toBe('photo-2.jpg');
        expect(namingUtils.makeUniqueFileName('photo.jpg', used)).toBe('photo-3.jpg');
      });

      test('is case-insensitive for uniqueness', () => {
        const used = new Map();
        expect(namingUtils.makeUniqueFileName('Photo.JPG', used)).toBe('Photo.JPG');
        // Current behavior uses the casing of the incoming desired name for the suffixed variant.
        expect(namingUtils.makeUniqueFileName('photo.jpg', used)).toBe('photo-2.jpg');
      });
    });

    if (moduleName === 'Renderer') {
      describe('validateProgressState', () => {
        test('returns true for valid progress', () => {
          const progress = {
            current: 5,
            total: 10,
            lastActivity: Date.now()
          };
          expect(namingUtils.validateProgressState(progress)).toBe(true);
        });

        test('returns false for null', () => {
          expect(namingUtils.validateProgressState(null)).toBe(false);
        });

        test('returns false for undefined', () => {
          expect(namingUtils.validateProgressState(undefined)).toBe(false);
        });

        test('returns false for non-object', () => {
          expect(namingUtils.validateProgressState('string')).toBe(false);
        });

        test('returns false for missing current', () => {
          expect(namingUtils.validateProgressState({ total: 10, lastActivity: Date.now() })).toBe(
            false
          );
        });

        test('returns false for missing total', () => {
          expect(namingUtils.validateProgressState({ current: 5, lastActivity: Date.now() })).toBe(
            false
          );
        });

        test('returns false for negative current', () => {
          expect(
            namingUtils.validateProgressState({ current: -1, total: 10, lastActivity: Date.now() })
          ).toBe(false);
        });

        test('returns false for negative total', () => {
          expect(
            namingUtils.validateProgressState({ current: 5, total: -1, lastActivity: Date.now() })
          ).toBe(false);
        });

        test('returns false when current exceeds total', () => {
          expect(
            namingUtils.validateProgressState({ current: 15, total: 10, lastActivity: Date.now() })
          ).toBe(false);
        });

        test('returns false for missing lastActivity', () => {
          expect(namingUtils.validateProgressState({ current: 5, total: 10 })).toBe(false);
        });

        test('returns false for stale progress (>15 min)', () => {
          const oldActivity = Date.now() - 20 * 60 * 1000; // 20 minutes ago
          expect(
            namingUtils.validateProgressState({ current: 5, total: 10, lastActivity: oldActivity })
          ).toBe(false);
        });

        test('returns true for recent progress', () => {
          const recentActivity = Date.now() - 5 * 60 * 1000; // 5 minutes ago
          expect(
            namingUtils.validateProgressState({
              current: 5,
              total: 10,
              lastActivity: recentActivity
            })
          ).toBe(true);
        });
      });

      describe('getFileStateDisplayInfo', () => {
        test('returns analyzing state', () => {
          const result = namingUtils.getFileStateDisplayInfo('analyzing', false);
          expect(result.label).toBe('Analyzing...');
          expect(result.spinning).toBe(true);
        });

        test('returns error state', () => {
          const result = namingUtils.getFileStateDisplayInfo('error', false);
          expect(result.label).toBe('Error');
          expect(result.color).toContain('red');
        });

        test('returns ready state when has analysis', () => {
          const result = namingUtils.getFileStateDisplayInfo('ready', true);
          expect(result.label).toBe('Ready');
          expect(result.color).toContain('green');
        });

        test('returns pending state', () => {
          const result = namingUtils.getFileStateDisplayInfo('pending', false);
          expect(result.label).toBe('Pending');
          expect(result.color).toContain('yellow');
        });

        test('returns failed state for unknown', () => {
          const result = namingUtils.getFileStateDisplayInfo('unknown', false);
          expect(result.label).toBe('Failed');
          expect(result.color).toContain('red');
        });
      });
    }

    describe('extractExtension', () => {
      test('extracts .txt extension', () => {
        expect(namingUtils.extractExtension('file.txt')).toBe('.txt');
      });

      test('extracts .pdf extension', () => {
        expect(namingUtils.extractExtension('document.pdf')).toBe('.pdf');
      });

      test('handles multiple dots', () => {
        expect(namingUtils.extractExtension('file.backup.txt')).toBe('.txt');
      });

      test('returns empty for no extension', () => {
        expect(namingUtils.extractExtension('README')).toBe('');
      });

      test('converts to lowercase', () => {
        expect(namingUtils.extractExtension('FILE.TXT')).toBe('.txt');
      });
    });

    describe('extractFileName', () => {
      test('extracts filename from Unix path', () => {
        expect(namingUtils.extractFileName('/home/user/file.txt')).toBe('file.txt');
      });

      test('extracts filename from Windows path', () => {
        expect(namingUtils.extractFileName('C:\\Users\\user\\file.txt')).toBe('file.txt');
      });

      test('handles filename only', () => {
        expect(namingUtils.extractFileName('file.txt')).toBe('file.txt');
      });

      test('handles mixed separators', () => {
        expect(namingUtils.extractFileName('/path/to\\file.txt')).toBe('file.txt');
      });
    });
  });
};

// Run tests against Renderer implementation
runNamingTests('Renderer', '../src/renderer/phases/discover/namingUtils');

// Run tests against Main process implementation
runNamingTests('Main', '../src/main/services/autoOrganize/namingUtils');
