/**
 * Targeted coverage for pdf-parse 2.x/unknown API branches in extractTextFromPdf
 */

jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

// Other deps used by documentExtractors; keep them mocked to avoid requiring native modules.
jest.mock('sharp');
jest.mock('node-tesseract-ocr');
jest.mock('mammoth');
jest.mock('officeparser');
jest.mock('xlsx-populate');
jest.mock('adm-zip');

describe('documentExtractors extractTextFromPdf (pdf-parse variant coverage)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  test('uses pdf-parse 2.x PDFParse class API', async () => {
    jest.doMock('pdf-parse', () => {
      return {
        PDFParse: class {
          constructor() {}
          async load() {}
          async getText() {
            return { text: 'hello from v2' };
          }
          destroy() {}
        }
      };
    });

    const fs = require('fs').promises;
    jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('pdf'));
    jest.spyOn(fs, 'stat').mockResolvedValue({ size: 1024 });

    const { extractTextFromPdf } = require('../src/main/analysis/documentExtractors');
    const res = await extractTextFromPdf('/tmp/a.pdf', 'a.pdf');
    expect(res).toContain('hello from v2');
  });

  test('throws helpful error when pdf-parse API is not recognizable', async () => {
    jest.doMock('pdf-parse', () => ({}));

    const fs = require('fs').promises;
    jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('pdf'));
    jest.spyOn(fs, 'stat').mockResolvedValue({ size: 1024 });

    const { extractTextFromPdf } = require('../src/main/analysis/documentExtractors');
    await expect(extractTextFromPdf('/tmp/a.pdf', 'a.pdf')).rejects.toThrow(
      'Unable to determine pdf-parse API version'
    );
  });

  test('v2 API: throws PDF_NO_TEXT_CONTENT when getText returns empty text', async () => {
    const destroySpy = jest.fn();
    jest.doMock('pdf-parse', () => ({
      PDFParse: class {
        constructor() {
          this.destroy = destroySpy;
        }
        async load() {}
        async getText() {
          return { text: '' };
        }
      }
    }));

    const fs = require('fs').promises;
    jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('pdf'));
    jest.spyOn(fs, 'stat').mockResolvedValue({ size: 1024 });

    const { extractTextFromPdf } = require('../src/main/analysis/documentExtractors');
    await expect(extractTextFromPdf('/tmp/a.pdf', 'a.pdf')).rejects.toThrow(
      'PDF contains no extractable text'
    );
    expect(destroySpy).toHaveBeenCalled();
  });

  test('v2 API: logs warning and destroys parser when extraction throws', async () => {
    const { logger } = require('../src/shared/logger');
    const destroySpy = jest.fn();
    jest.doMock('pdf-parse', () => ({
      PDFParse: class {
        constructor() {
          this.destroy = destroySpy;
        }
        async load() {}
        async getText() {
          throw new Error('boom');
        }
      }
    }));

    const fs = require('fs').promises;
    jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('pdf'));
    jest.spyOn(fs, 'stat').mockResolvedValue({ size: 1024 });

    const { extractTextFromPdf } = require('../src/main/analysis/documentExtractors');
    await expect(extractTextFromPdf('/tmp/a.pdf', 'a.pdf')).rejects.toThrow('boom');
    expect(logger.warn).toHaveBeenCalledWith(
      '[PDF] pdf-parse 2.x extraction failed:',
      expect.any(Object)
    );
    expect(destroySpy).toHaveBeenCalled();
  });
});
