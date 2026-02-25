import {
  formatScore,
  clamp01,
  scoreToOpacity,
  normalizeConfidence
} from '../src/renderer/utils/scoreUtils';
import { formatBytes, formatDuration } from '../src/renderer/utils/format';
import { isFileDragEvent, extractDroppedFiles } from '../src/renderer/utils/dragAndDrop';
import { sanitizeSemanticTerms } from '../src/renderer/utils/semanticTerms';
import {
  mergeReadyQueueIntoState,
  normalizeReadyQueuePayload
} from '../src/renderer/utils/readyQueueHydration';

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

  test('sanitizeSemanticTerms removes stopwords and duplicates', () => {
    const terms = sanitizeSemanticTerms(['if', 'it', 'alpha', 'Alpha', 'roadmap', 'the']);
    expect(terms).toEqual(['alpha', 'roadmap']);
  });

  test('sanitizeSemanticTerms keeps meaningful short terms but removes numeric tokens', () => {
    const terms = sanitizeSemanticTerms(['Q4', '2024', 'AI', 'it'], { minLength: 2, maxTerms: 3 });
    expect(terms).toEqual(['q4', 'ai']);
  });

  test('normalizeReadyQueuePayload extracts array from IPC response', () => {
    const ready = [{ path: 'C:\\\\docs\\\\a.pdf' }];
    expect(normalizeReadyQueuePayload({ success: true, readyFiles: ready })).toEqual(ready);
    expect(normalizeReadyQueuePayload(ready)).toEqual(ready);
    expect(normalizeReadyQueuePayload({ success: true })).toEqual([]);
  });

  test('mergeReadyQueueIntoState appends missing ready entries without clobbering', () => {
    const merged = mergeReadyQueueIntoState(
      {
        selectedFiles: [{ path: 'C:\\\\docs\\\\existing.pdf', name: 'existing.pdf', size: 10 }],
        analysisResults: [],
        fileStates: {}
      },
      [
        {
          path: 'C:\\\\docs\\\\new.pdf',
          name: 'new.pdf',
          size: 20,
          analyzedAt: '2026-02-01T00:00:00.000Z',
          analysis: { suggestedName: 'new.pdf', category: 'documents', keywords: ['plan'] }
        }
      ]
    );

    expect(merged.hydratedCount).toBe(1);
    expect(merged.selectedFiles.map((f) => f.path)).toContain('C:\\\\docs\\\\new.pdf');
    expect(merged.analysisResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'C:\\\\docs\\\\new.pdf',
          analysis: expect.objectContaining({ suggestedName: 'new.pdf' })
        })
      ])
    );
    expect(merged.fileStates['C:\\\\docs\\\\new.pdf']).toEqual(
      expect.objectContaining({ state: 'ready' })
    );
  });
});
