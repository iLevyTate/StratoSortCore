/**
 * @jest-environment node
 */

const {
  OrganizationSuggestionServiceCore,
} = require('../src/main/services/organization/OrganizationSuggestionServiceCore');

describe('OrganizationSuggestionServiceCore validation', () => {
  test('getSuggestionsForFile throws when path is missing', async () => {
    const service = new OrganizationSuggestionServiceCore({
      chromaDbService: {},
      folderMatchingService: {},
      settingsService: {},
      config: {},
    });

    // Stub heavy dependencies to avoid real work
    service.ensureSmartFolderEmbeddings = jest.fn();
    service.getSemanticFolderMatches = jest.fn().mockResolvedValue([]);
    service.getImprovementSuggestions = jest.fn().mockResolvedValue([]);
    service.patternMatcher = {
      getPatternBasedSuggestions: jest.fn().mockReturnValue([]),
      folderUsageStats: {},
    };

    await expect(
      service.getSuggestionsForFile(
        { name: 'file.pdf', extension: '.pdf' }, // missing path
        [],
        {},
      ),
    ).rejects.toThrow('file.path is required');
  });
});
