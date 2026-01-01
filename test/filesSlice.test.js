/**
 * Tests for Files Slice
 * Tests Redux slice for file selection and management
 */

import filesReducer, {
  setSelectedFiles,
  addSelectedFiles,
  removeSelectedFile,
  updateFileState,
  setFileStates,
  setSmartFolders,
  addSmartFolder,
  setOrganizedFiles,
  setNamingConvention,
  clearFiles,
  resetFilesState,
  fetchSmartFolders
} from '../src/renderer/store/slices/filesSlice';

describe('filesSlice', () => {
  const initialState = {
    selectedFiles: [],
    smartFolders: [],
    smartFoldersLoading: false,
    organizedFiles: [],
    fileStates: {},
    namingConvention: {
      convention: 'subject-date',
      dateFormat: 'YYYY-MM-DD',
      caseConvention: 'kebab-case',
      separator: '-'
    }
  };

  describe('initial state', () => {
    test('returns initial state', () => {
      const result = filesReducer(undefined, { type: 'unknown' });

      expect(result.selectedFiles).toEqual([]);
      expect(result.smartFolders).toEqual([]);
      expect(result.fileStates).toEqual({});
    });
  });

  describe('setSelectedFiles', () => {
    test('sets selected files', () => {
      const files = [
        { path: '/file1.pdf', name: 'file1.pdf' },
        { path: '/file2.pdf', name: 'file2.pdf' }
      ];

      const result = filesReducer(initialState, setSelectedFiles(files));

      expect(result.selectedFiles).toHaveLength(2);
      expect(result.selectedFiles[0].path).toBe('/file1.pdf');
    });

    test('serializes Date objects', () => {
      const files = [
        {
          path: '/file.pdf',
          created: new Date('2024-01-01'),
          modified: new Date('2024-01-02')
        }
      ];

      const result = filesReducer(initialState, setSelectedFiles(files));

      expect(typeof result.selectedFiles[0].created).toBe('string');
      expect(result.selectedFiles[0].created).toBe('2024-01-01T00:00:00.000Z');
    });
  });

  describe('addSelectedFiles', () => {
    test('adds new files', () => {
      const state = {
        ...initialState,
        selectedFiles: [{ path: '/file1.pdf' }]
      };
      const newFiles = [{ path: '/file2.pdf' }];

      const result = filesReducer(state, addSelectedFiles(newFiles));

      expect(result.selectedFiles).toHaveLength(2);
    });

    test('filters duplicate files', () => {
      const state = {
        ...initialState,
        selectedFiles: [{ path: '/file1.pdf' }]
      };
      const newFiles = [{ path: '/file1.pdf' }, { path: '/file2.pdf' }];

      const result = filesReducer(state, addSelectedFiles(newFiles));

      expect(result.selectedFiles).toHaveLength(2);
    });
  });

  describe('removeSelectedFile', () => {
    test('removes file by path', () => {
      const state = {
        ...initialState,
        selectedFiles: [{ path: '/file1.pdf' }, { path: '/file2.pdf' }],
        fileStates: {
          '/file1.pdf': { state: 'ready' }
        }
      };

      const result = filesReducer(state, removeSelectedFile('/file1.pdf'));

      expect(result.selectedFiles).toHaveLength(1);
      expect(result.selectedFiles[0].path).toBe('/file2.pdf');
      expect(result.fileStates['/file1.pdf']).toBeUndefined();
    });
  });

  describe('updateFileState', () => {
    test('updates file state', () => {
      const result = filesReducer(
        initialState,
        updateFileState({
          path: '/file.pdf',
          state: 'analyzing',
          metadata: { progress: 50 }
        })
      );

      expect(result.fileStates['/file.pdf'].state).toBe('analyzing');
      expect(result.fileStates['/file.pdf'].progress).toBe(50);
      expect(result.fileStates['/file.pdf'].timestamp).toBeDefined();
    });
  });

  describe('setFileStates', () => {
    test('replaces all file states', () => {
      const newStates = {
        '/file1.pdf': { state: 'ready' },
        '/file2.pdf': { state: 'error' }
      };

      const result = filesReducer(initialState, setFileStates(newStates));

      expect(result.fileStates).toEqual(newStates);
    });
  });

  describe('setSmartFolders', () => {
    test('sets smart folders', () => {
      const folders = [{ id: '1', name: 'Documents', path: '/docs' }];

      const result = filesReducer(initialState, setSmartFolders(folders));

      expect(result.smartFolders).toHaveLength(1);
      expect(result.smartFolders[0].name).toBe('Documents');
    });
  });

  describe('addSmartFolder', () => {
    test('adds a smart folder', () => {
      const folder = { id: '1', name: 'New Folder' };

      const result = filesReducer(initialState, addSmartFolder(folder));

      expect(result.smartFolders).toHaveLength(1);
    });
  });

  describe('setOrganizedFiles', () => {
    test('sets organized files', () => {
      const files = [{ path: '/organized/file.pdf' }];

      const result = filesReducer(initialState, setOrganizedFiles(files));

      expect(result.organizedFiles).toEqual(files);
    });
  });

  describe('setNamingConvention', () => {
    test('updates naming convention', () => {
      const result = filesReducer(
        initialState,
        setNamingConvention({
          convention: 'date-subject',
          separator: '_'
        })
      );

      expect(result.namingConvention.convention).toBe('date-subject');
      expect(result.namingConvention.separator).toBe('_');
      // Other values should be preserved
      expect(result.namingConvention.dateFormat).toBe('YYYY-MM-DD');
    });
  });

  describe('clearFiles', () => {
    test('clears selected files and states', () => {
      const state = {
        ...initialState,
        selectedFiles: [{ path: '/file.pdf' }],
        fileStates: { '/file.pdf': { state: 'ready' } }
      };

      const result = filesReducer(state, clearFiles());

      expect(result.selectedFiles).toEqual([]);
      expect(result.fileStates).toEqual({});
    });
  });

  describe('resetFilesState', () => {
    test('resets to initial state', () => {
      const state = {
        ...initialState,
        selectedFiles: [{ path: '/file.pdf' }],
        smartFolders: [{ id: '1' }]
      };

      const result = filesReducer(state, resetFilesState());

      expect(result).toEqual(initialState);
    });
  });

  describe('fetchSmartFolders', () => {
    test('sets loading state on pending', () => {
      const result = filesReducer(initialState, {
        type: fetchSmartFolders.pending.type
      });

      expect(result.smartFoldersLoading).toBe(true);
    });

    test('sets folders on fulfilled', () => {
      const folders = [{ id: '1', name: 'Docs' }];

      const result = filesReducer(initialState, {
        type: fetchSmartFolders.fulfilled.type,
        payload: folders
      });

      expect(result.smartFolders).toEqual(folders);
      expect(result.smartFoldersLoading).toBe(false);
    });

    test('clears loading on rejected', () => {
      const state = { ...initialState, smartFoldersLoading: true };

      const result = filesReducer(state, {
        type: fetchSmartFolders.rejected.type
      });

      expect(result.smartFoldersLoading).toBe(false);
    });
  });
});
