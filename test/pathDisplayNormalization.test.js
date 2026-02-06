import { formatDisplayPath } from '../src/renderer/utils/pathDisplay';
import {
  normalizePathValue,
  normalizeFileUri,
  isAbsolutePath,
  extractFileName
} from '../src/renderer/utils/pathNormalization';
import { safeBasename } from '../src/renderer/utils/pathUtils';

describe('path utilities (renderer)', () => {
  test('safeBasename extracts filename across separators', () => {
    expect(safeBasename('C:\\\\foo\\\\bar.txt')).toBe('bar.txt');
    expect(safeBasename('/usr/local/bin')).toBe('bin');
    expect(safeBasename('file.txt')).toBe('file.txt');
    expect(safeBasename(null)).toBe('');
  });

  test('normalizePathValue handles quotes, objects, and file URLs', () => {
    expect(normalizePathValue('"C:\\\\Users\\\\Test\\\\file.txt"')).toBe(
      'C:\\\\Users\\\\Test\\\\file.txt'
    );
    expect(normalizePathValue({ path: '/tmp/file.txt' })).toBe('/tmp/file.txt');
    expect(normalizePathValue('file:///C:/Users/Test/file.txt')).toBe('C:/Users/Test/file.txt');
  });

  test('normalizeFileUri preserves default whitespace behavior', () => {
    expect(normalizeFileUri('  /tmp/file.txt  ')).toBe('/tmp/file.txt');
  });

  test('isAbsolutePath detects common absolute path forms', () => {
    expect(isAbsolutePath('C:\\\\temp\\\\file.txt')).toBe(true);
    expect(isAbsolutePath('\\\\\\\\server\\\\share\\\\file.txt')).toBe(true);
    expect(isAbsolutePath('/usr/local/bin')).toBe(true);
    expect(isAbsolutePath('relative/path')).toBe(false);
  });

  test('extractFileName uses safe basename', () => {
    expect(extractFileName({ path: 'C:\\\\foo\\\\bar.txt' })).toBe('bar.txt');
  });

  test('formatDisplayPath returns raw when redaction is disabled', () => {
    expect(formatDisplayPath('  /tmp/file.txt  ', { redact: false })).toBe('/tmp/file.txt');
  });

  test('formatDisplayPath redacts with ellipsis and tail segments', () => {
    expect(
      formatDisplayPath('C:\\\\Users\\\\Alice\\\\Downloads\\\\file.pdf', { redact: true })
    ).toBe('…\\Downloads\\file.pdf');
    expect(formatDisplayPath('/Users/alice/Downloads/file.pdf', { redact: true })).toBe(
      '…/Downloads/file.pdf'
    );
  });

  test('formatDisplayPath defaults to two segments for invalid segment count', () => {
    expect(formatDisplayPath('/a/b/c/d.txt', { redact: true, segments: 0 })).toBe('…/c/d.txt');
  });
});
