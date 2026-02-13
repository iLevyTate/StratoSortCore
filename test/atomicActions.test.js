/**
 * Tests for atomicActions - cross-slice Redux thunks
 */

const mockUpdateFilePaths = jest.fn((p) => ({
  type: 'files/updateFilePathsAfterMove',
  payload: p
}));
const mockRemoveSelectedFiles = jest.fn((p) => ({ type: 'files/removeSelectedFiles', payload: p }));
const mockUpdateResultPaths = jest.fn((p) => ({
  type: 'analysis/updateResultPathsAfterMove',
  payload: p
}));
const mockRemoveAnalysisByPaths = jest.fn((p) => ({
  type: 'analysis/removeAnalysisResultsByPaths',
  payload: p
}));

jest.mock('../src/renderer/store/slices/filesSlice', () => ({
  updateFilePathsAfterMove: (...args) => mockUpdateFilePaths(...args),
  removeSelectedFiles: (...args) => mockRemoveSelectedFiles(...args)
}));

jest.mock('../src/renderer/store/slices/analysisSlice', () => ({
  updateResultPathsAfterMove: (...args) => mockUpdateResultPaths(...args),
  removeAnalysisResultsByPaths: (...args) => mockRemoveAnalysisByPaths(...args)
}));

import {
  atomicUpdateFilePathsAfterMove,
  atomicRemoveFilesWithCleanup
} from '../src/renderer/store/slices/atomicActions';

describe('atomicActions', () => {
  let dispatch;

  beforeEach(() => {
    jest.clearAllMocks();
    dispatch = jest.fn((action) => action);
  });

  describe('atomicUpdateFilePathsAfterMove', () => {
    test('dispatches both updateFilePathsAfterMove and updateResultPathsAfterMove', () => {
      const payload = { oldPaths: ['/old/a.pdf'], newPaths: ['/new/a.pdf'] };
      const thunk = atomicUpdateFilePathsAfterMove(payload);

      thunk(dispatch);

      expect(mockUpdateFilePaths).toHaveBeenCalledWith(payload);
      expect(mockUpdateResultPaths).toHaveBeenCalledWith(payload);
      expect(dispatch).toHaveBeenCalledTimes(2);
    });
  });

  describe('atomicRemoveFilesWithCleanup', () => {
    test('dispatches removeSelectedFiles then removeAnalysisResultsByPaths', () => {
      const paths = ['/file1.pdf', '/file2.pdf'];
      const thunk = atomicRemoveFilesWithCleanup(paths);

      thunk(dispatch);

      expect(mockRemoveSelectedFiles).toHaveBeenCalledWith(paths);
      expect(mockRemoveAnalysisByPaths).toHaveBeenCalledWith(paths);
      expect(dispatch).toHaveBeenCalledTimes(2);
    });
  });
});
