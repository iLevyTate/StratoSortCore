/**
 * Tests for log redaction utility (troubleshooting export)
 */

const {
  redactString,
  redactValue,
  redactLogLine,
  redactLogContent
} = require('../src/shared/logRedaction');

describe('logRedaction', () => {
  describe('redactString', () => {
    test('redacts Windows absolute paths, keeps filename', () => {
      const input = 'Processing C:\\Users\\jane\\Documents\\report.pdf';
      expect(redactString(input)).toContain('[REDACTED_PATH]');
      expect(redactString(input)).toContain('report.pdf');
      expect(redactString(input)).not.toContain('C:\\Users\\jane');
    });

    test('redacts Unix paths, keeps filename', () => {
      const input = 'File at /home/john/projects/secret.txt';
      expect(redactString(input)).toContain('[REDACTED_PATH]');
      expect(redactString(input)).toContain('secret.txt');
      expect(redactString(input)).not.toContain('/home/john');
    });

    test('can fully redact when keepFilename is false', () => {
      const input = 'Path: C:\\Users\\x\\file.txt';
      expect(redactString(input, { keepFilename: false })).not.toContain('file.txt');
      expect(redactString(input, { keepFilename: false })).toContain('[REDACTED_PATH]');
    });
  });

  describe('redactValue', () => {
    test('redacts path keys', () => {
      const obj = { filePath: 'C:\\Users\\x\\doc.pdf', count: 5 };
      const out = redactValue(obj);
      expect(out.filePath).toContain('[REDACTED_PATH]');
      expect(out.filePath).toContain('doc.pdf');
      expect(out.count).toBe(5);
    });

    test('redacts analysis keys entirely', () => {
      const obj = { subject: 'Tax return 2024', summary: 'Annual review' };
      const out = redactValue(obj);
      expect(out.subject).toBe('[REDACTED_ANALYSIS]');
      expect(out.summary).toBe('[REDACTED_ANALYSIS]');
    });

    test('redacts paths in nested objects', () => {
      const obj = { error: { path: 'D:\\data\\file.log' } };
      const out = redactValue(obj);
      expect(out.error.path).toContain('[REDACTED_PATH]');
    });
  });

  describe('redactLogLine', () => {
    test('redacts JSONL line', () => {
      const line = '{"level":30,"msg":"Analyzing","filePath":"C:\\\\Users\\\\x\\\\doc.pdf"}';
      const result = redactLogLine(line);
      const parsed = JSON.parse(result.trim());
      expect(parsed.filePath).toContain('[REDACTED_PATH]');
      expect(parsed.filePath).toContain('doc.pdf');
      expect(parsed.msg).toBe('Analyzing');
    });

    test('handles plain text by redacting paths', () => {
      const line = 'Error: file not found C:\\temp\\x.txt';
      const result = redactLogLine(line);
      expect(result).toContain('[REDACTED_PATH]');
      expect(result).toContain('x.txt');
    });

    test('returns original for non-JSON when no paths', () => {
      const line = 'Simple log message';
      const result = redactLogLine(line);
      expect(result.trim()).toBe('Simple log message');
    });
  });

  describe('redactLogContent', () => {
    test('redacts multiple JSONL lines', () => {
      const content = [
        '{"msg":"Start","path":"/home/u/file.a"}',
        '{"msg":"Done","filePath":"/home/u/file.b"}'
      ].join('\n');
      const result = redactLogContent(content);
      expect(result).toContain('[REDACTED_PATH]');
      expect(result).toContain('file.a');
      expect(result).toContain('file.b');
      expect(result).not.toContain('/home/u');
    });
  });
});
