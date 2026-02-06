/**
 * Targeted coverage for unpdf branches in extractTextFromPdf
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

// Other deps used by documentExtractors; keep them mocked to avoid requiring native modules.
jest.mock('sharp');
jest.mock('../src/main/utils/tesseractUtils', () => ({
  isTesseractAvailable: jest.fn().mockResolvedValue(true),
  recognizeIfAvailable: jest.fn().mockResolvedValue({ success: true, text: 'OCR text' })
}));
jest.mock('mammoth');
jest.mock('officeparser');
jest.mock('xlsx-populate');
jest.mock('adm-zip');
jest.mock('unpdf', () => ({
  extractText: jest.fn()
}));

describe('documentExtractors extractTextFromPdf (unpdf coverage)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  test('extracts text with unpdf', async () => {
    const { extractText } = require('unpdf');
    extractText.mockResolvedValue({ text: 'hello from unpdf' });

    const fs = require('fs').promises;
    jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('pdf'));
    jest.spyOn(fs, 'stat').mockResolvedValue({ size: 1024 });

    const { extractTextFromPdf } = require('../src/main/analysis/documentExtractors');
    const res = await extractTextFromPdf('/tmp/a.pdf', 'a.pdf');
    expect(res).toContain('hello from unpdf');
  });

  test('throws PDF_NO_TEXT_CONTENT when unpdf returns empty text', async () => {
    const { extractText } = require('unpdf');
    extractText.mockResolvedValue({ text: '' });

    const fs = require('fs').promises;
    jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('pdf'));
    jest.spyOn(fs, 'stat').mockResolvedValue({ size: 1024 });

    const { extractTextFromPdf } = require('../src/main/analysis/documentExtractors');
    await expect(extractTextFromPdf('/tmp/a.pdf', 'a.pdf')).rejects.toThrow(
      'PDF contains no extractable text'
    );
  });

  test('propagates unpdf errors', async () => {
    const { extractText } = require('unpdf');
    extractText.mockRejectedValue(new Error('boom'));

    const fs = require('fs').promises;
    jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('pdf'));
    jest.spyOn(fs, 'stat').mockResolvedValue({ size: 1024 });

    const { extractTextFromPdf } = require('../src/main/analysis/documentExtractors');
    await expect(extractTextFromPdf('/tmp/a.pdf', 'a.pdf')).rejects.toThrow('boom');
  });
});
