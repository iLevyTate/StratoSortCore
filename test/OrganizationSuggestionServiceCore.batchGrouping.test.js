/**
 * @jest-environment node
 */

const {
  OrganizationSuggestionServiceCore
} = require('../src/main/services/organization/OrganizationSuggestionServiceCore');

describe('OrganizationSuggestionServiceCore batch grouping', () => {
  test('skips files without primary suggestion', async () => {
    const service = new OrganizationSuggestionServiceCore({
      chromaDbService: {},
      folderMatchingService: {},
      settingsService: {},
      config: {}
    });

    // stub methods to avoid heavy work
    service.ensureSmartFolderEmbeddings = jest.fn();
    service.getSemanticFolderMatches = jest.fn().mockResolvedValue([]);
    service.getImprovementSuggestions = jest.fn().mockResolvedValue([]);
    service.patternMatcher = {
      getPatternBasedSuggestions: jest.fn().mockReturnValue([]),
      folderUsageStats: {}
    };

    // create a batch where one file has no primary suggestion
    const files = [
      { name: 'a.txt', path: '/a.txt', extension: '.txt' },
      { name: 'b.txt', path: '/b.txt', extension: '.txt' }
    ];

    // monkeypatch getSuggestionsForFile to simulate one missing primary
    service.getSuggestionsForFile = jest
      .fn()
      .mockResolvedValueOnce({
        success: true,
        primary: { folder: 'Docs' },
        confidence: 0.8,
        alternatives: []
      })
      .mockResolvedValueOnce({
        success: true,
        primary: null,
        confidence: 0.5,
        alternatives: []
      });

    const result = await service.getBatchSuggestions(files, [], {});

    expect(result.success).toBe(true);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].files).toHaveLength(1);
    expect(result.groups[0].files[0].path).toBe('/a.txt');
  });
});
