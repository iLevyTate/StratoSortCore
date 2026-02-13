/**
 * Edge/bug-catching tests for autoOrganize/fileProcessor
 * Focus: concurrency lock, post-analysis existence check, namingSettings, smart-folder resolution.
 */

jest.mock('../src/shared/logger', () => {
  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  };
  return { logger, createLogger: jest.fn(() => logger) };
});

jest.mock('fs', () => ({
  promises: {
    access: jest.fn(),
    stat: jest.fn()
  }
}));

jest.mock('../src/main/analysis/documentAnalysis', () => ({
  analyzeDocumentFile: jest.fn()
}));

jest.mock('../src/main/analysis/imageAnalysis', () => ({
  analyzeImageFile: jest.fn()
}));

jest.mock('../src/main/services/autoOrganize/namingUtils', () => ({
  generateSuggestedNameFromAnalysis: jest.fn()
}));

jest.mock('../src/main/services/autoOrganize/folderOperations', () => ({
  buildDestinationPath: jest.fn((file, suggestion) => `${suggestion.path}/${file.name}`),
  getFallbackDestination: jest.fn(),
  findDefaultFolder: jest.fn()
}));

describe('autoOrganize/fileProcessor (edge cases)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  function load() {
    return require('../src/main/services/autoOrganize/fileProcessor');
  }

  test('processNewFile skips concurrent processing of the same file (module lock)', async () => {
    const fs = require('fs').promises;
    const { analyzeDocumentFile } = require('../src/main/analysis/documentAnalysis');

    let releaseAnalysis;
    const analysisPromise = new Promise((resolve) => {
      releaseAnalysis = () => resolve({ category: 'Reports', confidence: 0.95 });
    });
    analyzeDocumentFile.mockReturnValueOnce(analysisPromise);
    fs.access.mockResolvedValue(undefined);

    const suggestionService = {
      getSuggestionsForFile: jest.fn().mockResolvedValue({
        success: true,
        primary: { folder: 'Docs', path: 'C:\\Sorted\\Docs', isSmartFolder: true },
        confidence: 0.99
      })
    };

    const { processNewFile } = load();
    const smartFolders = [{ id: 'docs-1', name: 'Docs', path: 'C:\\Sorted\\Docs' }];

    const p1 = processNewFile(
      'C:\\X\\File.pdf',
      smartFolders,
      { autoOrganizeEnabled: true },
      suggestionService
    );
    const p2 = processNewFile(
      'C:\\x\\file.pdf',
      smartFolders,
      { autoOrganizeEnabled: true },
      suggestionService
    ); // different case

    await expect(p2).resolves.toBeNull();
    releaseAnalysis();
    await expect(p1).resolves.toEqual(expect.objectContaining({ source: 'C:\\X\\File.pdf' }));
  });

  test('processNewFile returns null if file is deleted after analysis (ENOENT on access)', async () => {
    const fs = require('fs').promises;
    const { analyzeDocumentFile } = require('../src/main/analysis/documentAnalysis');
    analyzeDocumentFile.mockResolvedValue({ category: 'Reports', confidence: 0.95 });
    fs.access.mockRejectedValue(Object.assign(new Error('gone'), { code: 'ENOENT' }));

    const suggestionService = {
      getSuggestionsForFile: jest.fn()
    };

    const { processNewFile } = load();
    const smartFolders = [{ id: 'docs-1', name: 'Docs', path: 'C:\\Sorted\\Docs' }];
    const res = await processNewFile(
      'C:\\X\\File.pdf',
      smartFolders,
      { autoOrganizeEnabled: true },
      suggestionService
    );
    expect(res).toBeNull();
    expect(suggestionService.getSuggestionsForFile).not.toHaveBeenCalled();
  });

  test('processNewFile applies namingSettings and forwards suggestedName into analysis', async () => {
    const fs = require('fs').promises;
    const { analyzeDocumentFile } = require('../src/main/analysis/documentAnalysis');
    const {
      generateSuggestedNameFromAnalysis
    } = require('../src/main/services/autoOrganize/namingUtils');

    analyzeDocumentFile.mockResolvedValue({ category: 'Reports', confidence: 0.95 });
    fs.access.mockResolvedValue(undefined);
    fs.stat.mockResolvedValue({ birthtime: new Date('2020-01-01'), mtime: new Date('2020-02-01') });
    generateSuggestedNameFromAnalysis.mockReturnValue('Renamed.pdf');

    const suggestionService = {
      getSuggestionsForFile: jest.fn().mockImplementation(async (file) => {
        expect(file.analysis.suggestedName).toBe('Renamed.pdf');
        return {
          success: true,
          primary: { folder: 'Docs', path: 'C:\\Sorted\\Docs', isSmartFolder: true },
          confidence: 0.99
        };
      })
    };

    const { processNewFile } = load();
    const smartFolders = [{ id: 'docs-1', name: 'Docs', path: 'C:\\Sorted\\Docs' }];
    const res = await processNewFile(
      'C:\\X\\File.pdf',
      smartFolders,
      { autoOrganizeEnabled: true, namingSettings: { enabled: true } },
      suggestionService
    );

    expect(res).toEqual(expect.objectContaining({ destination: 'C:\\Sorted\\Docs/File.pdf' }));
  });

  test('processNewFile resolves suggestion to an existing smart folder by name', async () => {
    const fs = require('fs').promises;
    const { analyzeDocumentFile } = require('../src/main/analysis/documentAnalysis');
    const { buildDestinationPath } = require('../src/main/services/autoOrganize/folderOperations');

    analyzeDocumentFile.mockResolvedValue({ category: 'Reports', confidence: 0.95 });
    fs.access.mockResolvedValue(undefined);

    const smartFolders = [{ name: 'Documents', path: 'C:\\Smart\\Documents' }];
    const suggestionService = {
      getSuggestionsForFile: jest.fn().mockResolvedValue({
        success: true,
        primary: { folder: 'Documents', path: 'C:\\SomewhereElse', isSmartFolder: true },
        confidence: 0.99
      })
    };

    const { processNewFile } = load();
    const res = await processNewFile(
      'C:\\X\\File.pdf',
      smartFolders,
      { autoOrganizeEnabled: true },
      suggestionService
    );

    expect(buildDestinationPath).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ folder: 'Documents', path: 'C:\\Smart\\Documents' }),
      undefined,
      false
    );
    expect(res).toEqual(expect.objectContaining({ destination: 'C:\\Smart\\Documents/File.pdf' }));
  });
});
