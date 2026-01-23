const fs = require('fs').promises;
const { createReadStream } = require('fs');
const documentExtractors = require('../src/main/analysis/documentExtractors');
const { LIMITS } = require('../src/shared/constants');

// Mock external dependencies
jest.mock('fs', () => {
  const originalFs = jest.requireActual('fs');
  return {
    ...originalFs,
    promises: {
      readFile: jest.fn(),
      stat: jest.fn(),
      access: jest.fn(),
      open: jest.fn()
    },
    createReadStream: jest.fn()
  };
});

jest.mock('fast-xml-parser', () => ({
  XMLParser: jest.fn().mockImplementation(() => ({
    parse: jest.fn((xml) => {
      if (xml.includes('error')) throw new Error('Parse error');
      return { root: { text: 'parsed content' } };
    })
  }))
}));

jest.mock('csv-parse/sync', () => ({
  parse: jest.fn()
}));

jest.mock('xlsx-populate', () => ({
  fromFileAsync: jest.fn()
}));

jest.mock('mammoth', () => ({
  extractRawText: jest.fn()
}));

jest.mock('node-tesseract-ocr', () => ({
  recognize: jest.fn()
}));

jest.mock('sharp', () => {
  const sharpMock = jest.fn(() => ({
    metadata: jest.fn().mockResolvedValue({ width: 1200, height: 800 }),
    resize: jest.fn().mockReturnThis(),
    png: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('png data'))
  }));
  return sharpMock;
});

jest.mock('officeparser', () => ({
  parseOfficeAsync: jest.fn()
}));

jest.mock('adm-zip', () => {
  return jest.fn().mockImplementation(() => ({
    getEntries: jest.fn().mockReturnValue([]),
    getEntry: jest.fn().mockReturnValue(null)
  }));
});

jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

describe('Document Extractors Extended', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default stat size to be small
    fs.stat.mockResolvedValue({ size: 1000 });
  });

  describe('extractTextFromDocx - OCR fallback', () => {
    const ZIP_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);

    const mockSignature = async () => {
      const handle = {
        read: jest.fn().mockImplementation(async (buffer, offset, length) => {
          ZIP_SIGNATURE.copy(buffer, offset, 0, length);
          return { bytesRead: length, buffer };
        }),
        close: jest.fn().mockResolvedValue()
      };
      fs.open.mockResolvedValue(handle);
      return handle;
    };

    test('extracts text from embedded images when text is empty', async () => {
      const mammoth = require('mammoth');
      const officeParser = require('officeparser');
      const tesseract = require('node-tesseract-ocr');
      const AdmZip = require('adm-zip');

      mammoth.extractRawText.mockResolvedValue({ value: '' });
      officeParser.parseOfficeAsync.mockResolvedValue('');
      tesseract.recognize.mockResolvedValue('OCR text from image');
      await mockSignature();

      AdmZip.mockImplementation(() => ({
        getEntries: () => [
          { entryName: 'word/media/image1.png', getData: () => Buffer.from('image') }
        ]
      }));

      const result = await documentExtractors.extractTextFromDocx('doc.docx');
      expect(result).toContain('OCR text from image');
      expect(tesseract.recognize).toHaveBeenCalled();
    });
  });

  describe('extractTextFromPptx - OCR fallback', () => {
    test('extracts text from embedded images when slides are empty', async () => {
      const officeParser = require('officeparser');
      const tesseract = require('node-tesseract-ocr');
      const AdmZip = require('adm-zip');

      officeParser.parseOfficeAsync.mockResolvedValue('');
      tesseract.recognize.mockResolvedValue('Slide OCR text');

      AdmZip.mockImplementation(() => ({
        getEntries: () => [
          { entryName: 'ppt/media/slide1.png', getData: () => Buffer.from('image') }
        ]
      }));

      const result = await documentExtractors.extractTextFromPptx('slides.pptx');
      expect(result).toContain('Slide OCR text');
      expect(tesseract.recognize).toHaveBeenCalled();
    });
  });

  describe('extractContentStreaming', () => {
    test('streams content until max length', async () => {
      const mockStream = {
        on: jest.fn(),
        destroy: jest.fn()
      };
      createReadStream.mockReturnValue(mockStream);

      // Simulate stream events
      const resultPromise = documentExtractors.extractContentStreaming('large.txt');

      // Get event handlers
      const dataHandler = mockStream.on.mock.calls.find((c) => c[0] === 'data')[1];
      const endHandler = mockStream.on.mock.calls.find((c) => c[0] === 'end')[1];

      // Simulate data chunks
      dataHandler('chunk1');
      dataHandler('chunk2');
      endHandler();

      const result = await resultPromise;
      expect(result).toBe('chunk1chunk2');
    });

    test('truncates stream if over limit', async () => {
      const mockStream = {
        on: jest.fn(),
        destroy: jest.fn()
      };
      createReadStream.mockReturnValue(mockStream);

      const resultPromise = documentExtractors.extractContentStreaming('huge.txt');
      const dataHandler = mockStream.on.mock.calls.find((c) => c[0] === 'data')[1];

      // Send chunk 1 - fills buffer
      const chunk1 = 'x'.repeat(2 * 1024 * 1024);
      dataHandler(chunk1);

      // Send chunk 2 - triggers limit check
      dataHandler('overflow');

      // Stream should be destroyed
      expect(mockStream.destroy).toHaveBeenCalled();

      // Simulate close
      const closeHandler = mockStream.on.mock.calls.find((c) => c[0] === 'close')[1];
      closeHandler();

      const result = await resultPromise;
      expect(result.length).toBe(2 * 1024 * 1024);
    });
  });

  describe('extractTextFromCsv', () => {
    const { parse } = require('csv-parse/sync');

    test('parses structured CSV content', async () => {
      fs.readFile.mockResolvedValue('col1,col2\nval1,val2');
      parse.mockReturnValue([
        ['col1', 'col2'],
        ['val1', 'val2']
      ]);

      const result = await documentExtractors.extractTextFromCsv('data.csv');

      expect(result).toContain('col1 col2');
      expect(result).toContain('val1 val2');
    });

    test('handles empty CSV', async () => {
      fs.readFile.mockResolvedValue('');
      parse.mockReturnValue([]);

      const result = await documentExtractors.extractTextFromCsv('empty.csv');
      expect(result).toBe('');
    });

    test('falls back to raw text on parse error', async () => {
      fs.readFile.mockResolvedValue('raw content');
      parse.mockImplementation(() => {
        throw new Error('Parse error');
      });

      const result = await documentExtractors.extractTextFromCsv('bad.csv');
      expect(result).toBe('raw content');
    });
  });

  describe('extractTextFromXlsx', () => {
    const XLSX = require('xlsx-populate');
    const officeParser = require('officeparser');

    test('extracts text from valid workbook', async () => {
      const mockSheet = {
        name: () => 'Sheet1',
        usedRange: () => ({
          value: () => [
            ['Head1', 'Head2'],
            ['Val1', 'Val2']
          ]
        })
      };

      XLSX.fromFileAsync.mockResolvedValue({
        sheets: () => [mockSheet]
      });

      const result = await documentExtractors.extractTextFromXlsx('test.xlsx');
      expect(result).toContain('Head1 Head2');
      expect(result).toContain('Val1 Val2');
    });

    test('uses officeParser fallback when primary method fails', async () => {
      // Mock successful load but empty content to trigger fallback
      XLSX.fromFileAsync.mockResolvedValue({
        sheets: () => [{ usedRange: () => ({ value: () => [] }) }]
      });
      officeParser.parseOfficeAsync.mockResolvedValue('Fallback content');

      const result = await documentExtractors.extractTextFromXlsx('encrypted.xlsx');
      expect(result).toBe('Fallback content');
    });

    test('handles sheets with no used range', async () => {
      const mockSheet = {
        name: () => 'Empty',
        usedRange: () => null // No range
      };
      XLSX.fromFileAsync.mockResolvedValue({
        sheets: () => [mockSheet]
      });

      // Should fall back to officeParser since no content found
      officeParser.parseOfficeAsync.mockResolvedValue('Fallback');

      const result = await documentExtractors.extractTextFromXlsx('empty.xlsx');
      expect(result).toBe('Fallback');
    });
  });

  describe('extractTextFromPptx', () => {
    const officeParser = require('officeparser');
    const AdmZip = require('adm-zip');

    test('extracts text using officeParser', async () => {
      officeParser.parseOfficeAsync.mockResolvedValue('Slide content');

      const result = await documentExtractors.extractTextFromPptx('pres.pptx');
      expect(result).toBe('Slide content');
    });

    test('falls back to ZIP extraction if officeParser returns empty', async () => {
      officeParser.parseOfficeAsync.mockResolvedValue('');

      // Mock ZIP behavior
      const mockZip = {
        getEntries: jest
          .fn()
          .mockReturnValue([
            { entryName: 'ppt/slides/slide1.xml', getData: () => Buffer.from('<p>Slide 1</p>') }
          ])
      };
      AdmZip.mockImplementation(() => mockZip);

      const result = await documentExtractors.extractTextFromPptx('pres.pptx');
      expect(result).toContain('Slide 1');
    });

    test('handles JSON result from officeParser', async () => {
      officeParser.parseOfficeAsync.mockResolvedValue({ text: 'Structured content' });

      const result = await documentExtractors.extractTextFromPptx('pres.pptx');
      expect(result).toBe('Structured content');
    });
  });

  describe('Regex Cleaning Utilities', () => {
    test('extractPlainTextFromRtf cleans RTF', () => {
      const rtf = '{\\rtf1\\ansi Hello \\b World\\b0}';
      const result = documentExtractors.extractPlainTextFromRtf(rtf);
      // Regex is simple, might leave some artifacts but should remove control words
      // Based on implementation: replaces rtfControlWords (/\\[a-zA-Z]+-?\d* ?/g)
      expect(result).not.toContain('\\rtf1');
      expect(result).not.toContain('\\b');
    });

    test('extractPlainTextFromHtml removes tags and scripts', () => {
      const html = '<html><script>alert(1)</script><body><p>Hello</p></body></html>';
      const result = documentExtractors.extractPlainTextFromHtml(html);
      expect(result).not.toContain('alert(1)');
      expect(result).not.toContain('<p>');
      expect(result).toContain('Hello');
    });
  });

  describe('checkFileSize', () => {
    test('throws if file too large', async () => {
      fs.stat.mockResolvedValue({ size: LIMITS.MAX_FILE_SIZE + 1 });

      try {
        await documentExtractors.extractTextFromPdf('huge.pdf', 'huge.pdf');
        fail('Should have thrown');
      } catch (error) {
        expect(error.code).toBe('FILE_TOO_LARGE');
      }
    });
  });
});
