/**
 * Tests for Redux Selectors
 * Tests memoized selectors for computed state
 */

import {
  selectFilesWithAnalysis,
  selectReadyFiles,
  selectFailedFiles,
  selectPendingFiles,
  selectFileStats,
  selectChromaDBStatus,
  selectChromaDBAvailable,
  selectSelectedFiles,
  selectAnalysisResults,
  selectFileStates,
  selectSmartFolders
} from '../src/renderer/store/selectors';

describe('Redux Selectors', () => {
  describe('selectSelectedFiles', () => {
    test('returns selected files', () => {
      const state = {
        files: {
          selectedFiles: [{ path: '/file.pdf' }]
        }
      };

      const result = selectSelectedFiles(state);

      expect(result).toEqual([{ path: '/file.pdf' }]);
    });
  });

  describe('selectAnalysisResults', () => {
    test('returns analysis results', () => {
      const state = {
        analysis: {
          results: [{ path: '/file.pdf', analysis: { category: 'docs' } }]
        }
      };

      const result = selectAnalysisResults(state);

      expect(result).toHaveLength(1);
    });
  });

  describe('selectFileStates', () => {
    test('returns file states', () => {
      const state = {
        files: {
          fileStates: { '/file.pdf': { state: 'ready' } }
        }
      };

      const result = selectFileStates(state);

      expect(result['/file.pdf'].state).toBe('ready');
    });
  });

  describe('selectSmartFolders', () => {
    test('returns smart folders', () => {
      const state = {
        files: {
          smartFolders: [{ id: '1', name: 'Docs' }]
        }
      };

      const result = selectSmartFolders(state);

      expect(result).toHaveLength(1);
    });
  });

  describe('selectFilesWithAnalysis', () => {
    test('merges files with analysis results', () => {
      const state = {
        files: {
          selectedFiles: [
            { path: '/file1.pdf', name: 'file1.pdf' },
            { path: '/file2.pdf', name: 'file2.pdf' }
          ],
          fileStates: {}
        },
        analysis: {
          results: [
            {
              path: '/file1.pdf',
              analysis: { category: 'documents', subject: 'Report' }
            }
          ]
        }
      };

      const result = selectFilesWithAnalysis(state);

      expect(result).toHaveLength(2);
      expect(result[0].analysis).toEqual({ category: 'documents', subject: 'Report' });
      expect(result[1].analysis).toBeNull();
    });

    test('extracts extension from path', () => {
      const state = {
        files: {
          selectedFiles: [{ path: '/docs/report.pdf', name: 'report.pdf' }],
          fileStates: {}
        },
        analysis: { results: [] }
      };

      const result = selectFilesWithAnalysis(state);

      expect(result[0].extension).toBe('.pdf');
    });

    test('preserves existing extension', () => {
      const state = {
        files: {
          selectedFiles: [{ path: '/file.pdf', extension: '.PDF' }],
          fileStates: {}
        },
        analysis: { results: [] }
      };

      const result = selectFilesWithAnalysis(state);

      expect(result[0].extension).toBe('.PDF');
    });

    test('includes error from analysis results', () => {
      const state = {
        files: {
          selectedFiles: [{ path: '/file.pdf' }],
          fileStates: {}
        },
        analysis: {
          results: [{ path: '/file.pdf', error: 'Analysis failed' }]
        }
      };

      const result = selectFilesWithAnalysis(state);

      expect(result[0].error).toBe('Analysis failed');
    });

    test('returns empty array reference for empty files', () => {
      const state = {
        files: { selectedFiles: [], fileStates: {} },
        analysis: { results: [] }
      };

      const result = selectFilesWithAnalysis(state);

      expect(result).toEqual([]);
    });

    test('uses file state from fileStates', () => {
      const state = {
        files: {
          selectedFiles: [{ path: '/file.pdf' }],
          fileStates: { '/file.pdf': { state: 'analyzing' } }
        },
        analysis: { results: [] }
      };

      const result = selectFilesWithAnalysis(state);

      expect(result[0].status).toBe('analyzing');
    });
  });

  describe('selectReadyFiles', () => {
    test('returns only files with analysis and no error', () => {
      const state = {
        files: {
          selectedFiles: [{ path: '/file1.pdf' }, { path: '/file2.pdf' }, { path: '/file3.pdf' }],
          fileStates: {}
        },
        analysis: {
          results: [
            { path: '/file1.pdf', analysis: { category: 'docs' } },
            { path: '/file2.pdf', error: 'Failed' }
          ]
        }
      };

      const result = selectReadyFiles(state);

      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('/file1.pdf');
    });
  });

  describe('selectFailedFiles', () => {
    test('returns only files with errors', () => {
      const state = {
        files: {
          selectedFiles: [{ path: '/file1.pdf' }, { path: '/file2.pdf' }],
          fileStates: {}
        },
        analysis: {
          results: [
            { path: '/file1.pdf', analysis: { category: 'docs' } },
            { path: '/file2.pdf', error: 'Analysis failed' }
          ]
        }
      };

      const result = selectFailedFiles(state);

      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('/file2.pdf');
    });
  });

  describe('selectPendingFiles', () => {
    test('returns files without analysis or error', () => {
      const state = {
        files: {
          selectedFiles: [{ path: '/file1.pdf' }, { path: '/file2.pdf' }, { path: '/file3.pdf' }],
          fileStates: {
            '/file1.pdf': { state: 'pending' }
          }
        },
        analysis: {
          results: [{ path: '/file2.pdf', analysis: { category: 'docs' } }]
        }
      };

      const result = selectPendingFiles(state);

      expect(result).toHaveLength(2);
    });
  });

  describe('selectFileStats', () => {
    test('returns file statistics', () => {
      const state = {
        files: {
          selectedFiles: [{ path: '/file1.pdf' }, { path: '/file2.pdf' }, { path: '/file3.pdf' }],
          fileStates: {}
        },
        analysis: {
          results: [
            { path: '/file1.pdf', analysis: { category: 'docs' } },
            { path: '/file2.pdf', error: 'Failed' }
          ]
        }
      };

      const result = selectFileStats(state);

      expect(result.total).toBe(3);
      expect(result.ready).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.pending).toBe(1);
    });
  });

  describe('selectChromaDBStatus', () => {
    test('returns chromadb status', () => {
      const state = {
        system: {
          health: { chromadb: 'online' }
        }
      };

      const result = selectChromaDBStatus(state);

      expect(result).toBe('online');
    });

    test('returns unknown for missing status', () => {
      const state = { system: {} };

      const result = selectChromaDBStatus(state);

      expect(result).toBe('unknown');
    });
  });

  describe('selectChromaDBAvailable', () => {
    test('returns true for online status', () => {
      const state = {
        system: { health: { chromadb: 'online' } }
      };

      const result = selectChromaDBAvailable(state);

      expect(result).toBe(true);
    });

    test('returns true for connecting status', () => {
      const state = {
        system: { health: { chromadb: 'connecting' } }
      };

      const result = selectChromaDBAvailable(state);

      expect(result).toBe(true);
    });

    test('returns false for offline status', () => {
      const state = {
        system: { health: { chromadb: 'offline' } }
      };

      const result = selectChromaDBAvailable(state);

      expect(result).toBe(false);
    });
  });
});
