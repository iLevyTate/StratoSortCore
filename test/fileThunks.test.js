/**
 * Tests for file-related Redux thunks
 * Covers: removeFileWithCleanup, removeFilesWithCleanup,
 *         clearAllFilesWithCleanup, setEmbeddingPolicyForFile
 */

import { removeSelectedFile } from '../src/renderer/store/slices/filesSlice';
import {
  removeAnalysisResult,
  updateEmbeddingState
} from '../src/renderer/store/slices/analysisSlice';
import { atomicRemoveFilesWithCleanup } from '../src/renderer/store/slices/atomicActions';
import {
  removeFileWithCleanup,
  removeFilesWithCleanup,
  clearAllFilesWithCleanup,
  setEmbeddingPolicyForFile
} from '../src/renderer/store/thunks/fileThunks';

// Mock slice actions
jest.mock('../src/renderer/store/slices/filesSlice', () => ({
  removeSelectedFile: jest.fn((p) => ({ type: 'files/removeSelectedFile', payload: p }))
}));

jest.mock('../src/renderer/store/slices/analysisSlice', () => ({
  removeAnalysisResult: jest.fn((p) => ({ type: 'analysis/removeAnalysisResult', payload: p })),
  updateEmbeddingState: jest.fn((p) => ({ type: 'analysis/updateEmbeddingState', payload: p }))
}));

jest.mock('../src/renderer/store/slices/atomicActions', () => ({
  atomicRemoveFilesWithCleanup: jest.fn((paths) => ({
    type: 'atomic/removeFilesWithCleanup',
    payload: paths
  }))
}));

describe('fileThunks', () => {
  let dispatch;
  let getState;

  beforeEach(() => {
    jest.clearAllMocks();
    dispatch = jest.fn();
    getState = jest.fn();
  });

  describe('removeFileWithCleanup', () => {
    test('dispatches removeSelectedFile and removeAnalysisResult', () => {
      const filePath = '/path/to/file.pdf';
      removeFileWithCleanup(filePath)(dispatch);

      expect(dispatch).toHaveBeenCalledTimes(2);
      expect(removeSelectedFile).toHaveBeenCalledWith(filePath);
      expect(removeAnalysisResult).toHaveBeenCalledWith(filePath);
    });

    test('does nothing when filePath is empty string', () => {
      removeFileWithCleanup('')(dispatch);
      expect(dispatch).not.toHaveBeenCalled();
    });

    test('does nothing when filePath is null', () => {
      removeFileWithCleanup(null)(dispatch);
      expect(dispatch).not.toHaveBeenCalled();
    });

    test('does nothing when filePath is undefined', () => {
      removeFileWithCleanup(undefined)(dispatch);
      expect(dispatch).not.toHaveBeenCalled();
    });
  });

  describe('removeFilesWithCleanup', () => {
    test('delegates to atomicRemoveFilesWithCleanup', () => {
      const filePaths = ['/a.pdf', '/b.pdf'];
      const result = removeFilesWithCleanup(filePaths);

      expect(atomicRemoveFilesWithCleanup).toHaveBeenCalledWith(filePaths);
      expect(result).toEqual({
        type: 'atomic/removeFilesWithCleanup',
        payload: filePaths
      });
    });
  });

  describe('clearAllFilesWithCleanup', () => {
    test('removes all files when selectedFiles exist', () => {
      getState.mockReturnValue({
        files: {
          selectedFiles: [
            { path: '/a.pdf', name: 'a.pdf' },
            { path: '/b.pdf', name: 'b.pdf' }
          ]
        }
      });

      clearAllFilesWithCleanup()(dispatch, getState);

      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(atomicRemoveFilesWithCleanup).toHaveBeenCalledWith(['/a.pdf', '/b.pdf']);
    });

    test('does nothing when selectedFiles is empty', () => {
      getState.mockReturnValue({
        files: { selectedFiles: [] }
      });

      clearAllFilesWithCleanup()(dispatch, getState);
      expect(dispatch).not.toHaveBeenCalled();
    });

    test('handles missing files state gracefully', () => {
      getState.mockReturnValue({});

      clearAllFilesWithCleanup()(dispatch, getState);
      expect(dispatch).not.toHaveBeenCalled();
    });

    test('handles null files state gracefully', () => {
      getState.mockReturnValue({ files: null });

      clearAllFilesWithCleanup()(dispatch, getState);
      expect(dispatch).not.toHaveBeenCalled();
    });
  });

  describe('setEmbeddingPolicyForFile', () => {
    let mockSetEmbeddingPolicy;

    beforeEach(() => {
      mockSetEmbeddingPolicy = jest.fn();
      global.window = global.window || {};
      global.window.electronAPI = {
        analysisHistory: {
          setEmbeddingPolicy: mockSetEmbeddingPolicy
        }
      };
    });

    afterEach(() => {
      delete global.window.electronAPI;
    });

    test('does nothing when filePath is empty', async () => {
      await setEmbeddingPolicyForFile('', 'embed')(dispatch, getState);
      expect(mockSetEmbeddingPolicy).not.toHaveBeenCalled();
    });

    test('does nothing when policy is null', async () => {
      await setEmbeddingPolicyForFile('/file.pdf', null)(dispatch, getState);
      expect(mockSetEmbeddingPolicy).not.toHaveBeenCalled();
    });

    test('does nothing when electronAPI is missing', async () => {
      global.window.electronAPI = undefined;
      await setEmbeddingPolicyForFile('/file.pdf', 'embed')(dispatch, getState);
      expect(dispatch).not.toHaveBeenCalled();
    });

    test('does nothing when analysisHistory.setEmbeddingPolicy is missing', async () => {
      global.window.electronAPI = { analysisHistory: {} };
      await setEmbeddingPolicyForFile('/file.pdf', 'embed')(dispatch, getState);
      expect(dispatch).not.toHaveBeenCalled();
    });

    test('dispatches updateEmbeddingState on success with embed policy', async () => {
      mockSetEmbeddingPolicy.mockResolvedValue({ success: true });
      getState.mockReturnValue({
        analysis: {
          results: [{ path: '/file.pdf', embeddingStatus: 'pending' }]
        }
      });

      await setEmbeddingPolicyForFile('/file.pdf', 'embed')(dispatch, getState);

      expect(mockSetEmbeddingPolicy).toHaveBeenCalledWith('/file.pdf', 'embed');
      expect(updateEmbeddingState).toHaveBeenCalledWith({
        path: '/file.pdf',
        embeddingPolicy: 'embed',
        embeddingStatus: 'pending'
      });
    });

    test('sets status to done when embed policy and prev status is done', async () => {
      mockSetEmbeddingPolicy.mockResolvedValue({ success: true });
      getState.mockReturnValue({
        analysis: {
          results: [{ path: '/file.pdf', embeddingStatus: 'done' }]
        }
      });

      await setEmbeddingPolicyForFile('/file.pdf', 'embed')(dispatch, getState);

      expect(updateEmbeddingState).toHaveBeenCalledWith(
        expect.objectContaining({ embeddingStatus: 'done' })
      );
    });

    test('sets status to skipped when policy is skip', async () => {
      mockSetEmbeddingPolicy.mockResolvedValue({ success: true });
      getState.mockReturnValue({
        analysis: {
          results: [{ path: '/file.pdf', embeddingStatus: 'done' }]
        }
      });

      await setEmbeddingPolicyForFile('/file.pdf', 'skip')(dispatch, getState);

      expect(updateEmbeddingState).toHaveBeenCalledWith(
        expect.objectContaining({ embeddingStatus: 'skipped' })
      );
    });

    test('sets status to skipped when policy is web_only', async () => {
      mockSetEmbeddingPolicy.mockResolvedValue({ success: true });
      getState.mockReturnValue({
        analysis: {
          results: [{ path: '/file.pdf', embeddingStatus: 'done' }]
        }
      });

      await setEmbeddingPolicyForFile('/file.pdf', 'web_only')(dispatch, getState);

      expect(updateEmbeddingState).toHaveBeenCalledWith(
        expect.objectContaining({ embeddingStatus: 'skipped' })
      );
    });

    test('does not dispatch when API returns failure', async () => {
      mockSetEmbeddingPolicy.mockResolvedValue({ success: false });

      await setEmbeddingPolicyForFile('/file.pdf', 'embed')(dispatch, getState);

      expect(dispatch).not.toHaveBeenCalled();
    });

    test('handles null result from API', async () => {
      mockSetEmbeddingPolicy.mockResolvedValue(null);

      await setEmbeddingPolicyForFile('/file.pdf', 'embed')(dispatch, getState);

      expect(dispatch).not.toHaveBeenCalled();
    });

    test('handles missing analysis results in state', async () => {
      mockSetEmbeddingPolicy.mockResolvedValue({ success: true });
      getState.mockReturnValue({
        analysis: { results: [] }
      });

      await setEmbeddingPolicyForFile('/file.pdf', 'embed')(dispatch, getState);

      // Should still dispatch since result.success is true
      expect(updateEmbeddingState).toHaveBeenCalledWith(
        expect.objectContaining({
          path: '/file.pdf',
          embeddingPolicy: 'embed',
          embeddingStatus: 'pending'
        })
      );
    });

    test('reads prevStatus from nested analysis.embeddingStatus', async () => {
      mockSetEmbeddingPolicy.mockResolvedValue({ success: true });
      getState.mockReturnValue({
        analysis: {
          results: [{ path: '/file.pdf', analysis: { embeddingStatus: 'done' } }]
        }
      });

      await setEmbeddingPolicyForFile('/file.pdf', 'embed')(dispatch, getState);

      expect(updateEmbeddingState).toHaveBeenCalledWith(
        expect.objectContaining({ embeddingStatus: 'done' })
      );
    });
  });
});
