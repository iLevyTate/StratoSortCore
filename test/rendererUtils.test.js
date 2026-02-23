import {
  formatScore,
  clamp01,
  scoreToOpacity,
  normalizeConfidence
} from '../src/renderer/utils/scoreUtils';
import { formatBytes, formatDuration } from '../src/renderer/utils/format';
import { isFileDragEvent, extractDroppedFiles } from '../src/renderer/utils/dragAndDrop';

describe('renderer utils (score/format/drag)', () => {
  test('formatScore and clamp01 handle invalid inputs', () => {
    expect(formatScore('bad')).toBe('');
    expect(clamp01('bad')).toBe(0);
  });

  test('scoreToOpacity maps score to 0.25-1 range', () => {
    expect(scoreToOpacity(0)).toBe(0.25);
    expect(scoreToOpacity(1)).toBe(1);
  });

  test('normalizeConfidence handles both 0-1 and 0-100 scales', () => {
    expect(normalizeConfidence(0.52)).toBe(52);
    expect(normalizeConfidence(87)).toBe(87);
    expect(normalizeConfidence(120)).toBe(100);
  });

  test('formatBytes formats human readable values', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1.00 KB');
    expect(formatBytes(10 * 1024 * 1024)).toBe('10.0 MB');
  });

  test('formatDuration formats times', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(4000)).toBe('4s');
    expect(formatDuration(65000)).toBe('1m 5s');
  });

  test('isFileDragEvent detects file drag types', () => {
    const event = {
      dataTransfer: { types: ['Files'] }
    };
    expect(isFileDragEvent(event)).toBe(true);
  });

  test('extractDroppedFiles collects unique paths', () => {
    const dataTransfer = {
      files: [{ path: 'C:\\\\a.txt' }],
      items: [{ kind: 'file', getAsFile: () => ({ name: 'b.txt' }) }],
      getData: (type) => (type === 'text/uri-list' ? 'file:///C:/c.txt' : '')
    };

    const result = extractDroppedFiles(dataTransfer);
    expect(result.paths).toEqual(['C:\\\\a.txt', 'C:/c.txt']);
    expect(result.unresolvedNames).toEqual(['b.txt']);
    expect(result.fileList).toHaveLength(1);
    expect(result.itemFiles).toHaveLength(1);
  });

  test('extractDroppedFiles resolves renderer-missing file paths via preload helper', () => {
    const originalElectronApi = window.electronAPI;
    window.electronAPI = {
      files: {
        getPathForDroppedFile: (file) => (file?.name === 'b.txt' ? 'C:\\\\resolved\\\\b.txt' : '')
      }
    };

    try {
      const dataTransfer = {
        files: [{ name: 'a.txt' }],
        items: [{ kind: 'file', getAsFile: () => ({ name: 'b.txt' }) }],
        getData: () => ''
      };

      const result = extractDroppedFiles(dataTransfer);
      expect(result.paths).toEqual(['C:\\\\resolved\\\\b.txt']);
      expect(result.unresolvedNames).toEqual(['a.txt']);
    } finally {
      window.electronAPI = originalElectronApi;
    }
  });
});
