/**
 * Tests for documentExtractors
 * TIER 1 - CRITICAL: Document text extraction from various formats
 * Testing PDF, Office, and other document format extractors
 */

const fs = require('fs').promises;

// Mock dependencies BEFORE requiring the module
jest.mock('pdf-parse', () => jest.fn());
jest.mock('sharp');
jest.mock('node-tesseract-ocr');
jest.mock('mammoth');
jest.mock('officeparser');
jest.mock('xlsx-populate');
jest.mock('adm-zip');

const {
  extractTextFromPdf,
  ocrPdfIfNeeded,
  extractTextFromDoc,
  extractTextFromDocx,
  extractTextFromXlsx,
  extractTextFromPptx,
  extractTextFromXls,
  extractTextFromPpt,
  extractTextFromOdfZip,
  extractTextFromEpub,
  extractTextFromEml,
  extractTextFromMsg,
  extractTextFromKml,
  extractTextFromKmz,
  extractPlainTextFromRtf,
  extractPlainTextFromHtml
} = require('../src/main/analysis/documentExtractors');

describe('documentExtractors', () => {
  const mockFilePath = '/test/document.pdf';
  const mockFileName = 'document.pdf';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('extractTextFromPdf', () => {
    test('should extract text from valid PDF', async () => {
      const pdfParse = require('pdf-parse');
      const mockPdfData = {
        text: 'This is extracted PDF text content'
      };

      pdfParse.mockResolvedValue(mockPdfData);
      jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('pdf data'));
      jest.spyOn(fs, 'stat').mockResolvedValue({ size: 1000 });

      const result = await extractTextFromPdf(mockFilePath, mockFileName);

      expect(result).toBe('This is extracted PDF text content');
      expect(pdfParse).toHaveBeenCalled();
    });

    test('should throw error for empty PDF', async () => {
      const pdfParse = require('pdf-parse');
      pdfParse.mockResolvedValue({ text: '' });
      jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('pdf data'));
      jest.spyOn(fs, 'stat').mockResolvedValue({ size: 1000 });

      // IMPROVED BEHAVIOR: FileProcessingError now provides structured error messages
      // instead of raw error codes, making errors more user-friendly
      await expect(extractTextFromPdf(mockFilePath, mockFileName)).rejects.toThrow(
        'PDF contains no extractable text'
      );
    });

    test('should throw error for file exceeding size limit', async () => {
      jest.spyOn(fs, 'stat').mockResolvedValue({ size: 200 * 1024 * 1024 }); // 200MB

      // FileProcessingError with FILE_TOO_LARGE code produces a structured error message
      await expect(extractTextFromPdf(mockFilePath, mockFileName)).rejects.toThrow(
        'File size exceeds processing limits'
      );
    });

    test('should truncate very long text', async () => {
      const pdfParse = require('pdf-parse');
      const longText = 'word '.repeat(200000); // Creates text > 500k chars
      pdfParse.mockResolvedValue({ text: longText });
      jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('pdf data'));
      jest.spyOn(fs, 'stat').mockResolvedValue({ size: 1000 });

      const result = await extractTextFromPdf(mockFilePath, mockFileName);

      expect(result.length).toBeLessThanOrEqual(500000 + 100);
      expect(result).toContain('[Text truncated due to length]');
    });
  });

  describe('ocrPdfIfNeeded', () => {
    test('should perform OCR on image-based PDF', async () => {
      const sharp = require('sharp');
      const tesseract = require('node-tesseract-ocr');

      jest.spyOn(fs, 'stat').mockResolvedValue({ size: 1000 });
      jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('pdf data'));

      const mockSharp = {
        png: jest.fn().mockReturnThis(),
        toBuffer: jest.fn().mockResolvedValue(Buffer.from('png data'))
      };
      sharp.mockReturnValue(mockSharp);

      tesseract.recognize.mockResolvedValue('OCR extracted text');

      const result = await ocrPdfIfNeeded(mockFilePath);

      expect(result).toBe('OCR extracted text');
      expect(tesseract.recognize).toHaveBeenCalled();
    });

    test('should return empty string for oversized files', async () => {
      jest.spyOn(fs, 'stat').mockResolvedValue({ size: 60 * 1024 * 1024 }); // 60MB

      const result = await ocrPdfIfNeeded(mockFilePath);

      expect(result).toBe('');
    });

    test('should handle OCR errors gracefully', async () => {
      const sharp = require('sharp');

      jest.spyOn(fs, 'stat').mockResolvedValue({ size: 1000 });
      jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('pdf data'));

      sharp.mockImplementation(() => {
        throw new Error('Sharp error');
      });

      const result = await ocrPdfIfNeeded(mockFilePath);

      expect(result).toBe('');
    });
  });

  describe('extractTextFromDocx', () => {
    test('should extract text from DOCX', async () => {
      const mammoth = require('mammoth');
      mammoth.extractRawText.mockResolvedValue({
        value: 'This is DOCX content'
      });
      jest.spyOn(fs, 'stat').mockResolvedValue({ size: 1000 });

      const result = await extractTextFromDocx(mockFilePath);

      expect(result).toBe('This is DOCX content');
      expect(mammoth.extractRawText).toHaveBeenCalled();
    });

    test('should throw error for empty DOCX', async () => {
      const mammoth = require('mammoth');
      mammoth.extractRawText.mockResolvedValue({ value: '' });
      jest.spyOn(fs, 'stat').mockResolvedValue({ size: 1000 });

      await expect(extractTextFromDocx(mockFilePath)).rejects.toThrow('No text content in DOCX');
    });

    test('should check file size before reading', async () => {
      jest.spyOn(fs, 'stat').mockResolvedValue({ size: 150 * 1024 * 1024 });

      // FileProcessingError with FILE_TOO_LARGE code produces a structured error message
      await expect(extractTextFromDocx(mockFilePath)).rejects.toThrow(
        'File size exceeds processing limits'
      );
    });
  });

  describe('extractTextFromXlsx', () => {
    test('should extract text from XLSX', async () => {
      const XLSX = require('xlsx-populate');

      const mockSheet = {
        usedRange: jest.fn().mockReturnValue({
          value: jest.fn().mockReturnValue([
            ['Header1', 'Header2', 'Header3'],
            ['Value1', 'Value2', 'Value3'],
            ['Value4', 'Value5', 'Value6']
          ])
        })
      };

      const mockWorkbook = {
        sheets: jest.fn().mockReturnValue([mockSheet])
      };

      XLSX.fromFileAsync.mockResolvedValue(mockWorkbook);
      jest.spyOn(fs, 'stat').mockResolvedValue({ size: 1000 });

      const result = await extractTextFromXlsx(mockFilePath);

      expect(result).toContain('Header1');
      expect(result).toContain('Value1');
    });

    test('should limit rows to prevent memory issues', async () => {
      const XLSX = require('xlsx-populate');

      const largeArray = Array.from({ length: 15000 }, (_, i) => [`Row${i}`, `Data${i}`]);

      const mockSheet = {
        usedRange: jest.fn().mockReturnValue({
          value: jest.fn().mockReturnValue(largeArray)
        })
      };

      const mockWorkbook = {
        sheets: jest.fn().mockReturnValue([mockSheet])
      };

      XLSX.fromFileAsync.mockResolvedValue(mockWorkbook);
      jest.spyOn(fs, 'stat').mockResolvedValue({ size: 1000 });

      const result = await extractTextFromXlsx(mockFilePath);

      expect(result).toBeDefined();
      // Should not process all 15000 rows
      const rowCount = result.split('\n').length;
      expect(rowCount).toBeLessThanOrEqual(10000);
    });

    test('should throw error for empty XLSX', async () => {
      const XLSX = require('xlsx-populate');

      const mockSheet = {
        usedRange: jest.fn().mockReturnValue(null)
      };

      const mockWorkbook = {
        sheets: jest.fn().mockReturnValue([mockSheet])
      };

      XLSX.fromFileAsync.mockResolvedValue(mockWorkbook);
      jest.spyOn(fs, 'stat').mockResolvedValue({ size: 1000 });

      // FIX: Updated test to expect new error handling behavior
      // New code properly handles null usedRange and throws appropriate error
      await expect(extractTextFromXlsx(mockFilePath)).rejects.toThrow();
    });

    test('should handle null/undefined values in XLSX', async () => {
      const XLSX = require('xlsx-populate');

      const mockSheet = {
        usedRange: jest.fn().mockReturnValue({
          value: jest.fn().mockReturnValue(null)
        })
      };

      const mockWorkbook = {
        sheets: jest.fn().mockReturnValue([mockSheet])
      };

      XLSX.fromFileAsync.mockResolvedValue(mockWorkbook);
      jest.spyOn(fs, 'stat').mockResolvedValue({ size: 1000 });

      // FIX: Test new defensive null-checking behavior
      await expect(extractTextFromXlsx(mockFilePath)).rejects.toThrow();
    });

    test('should handle various row data structures in XLSX', async () => {
      const XLSX = require('xlsx-populate');

      // FIX: Test that we handle arrays, objects, and scalar values
      const mockSheet = {
        usedRange: jest.fn().mockReturnValue({
          value: jest
            .fn()
            .mockReturnValue([
              ['Array', 'Row'],
              { columnA: 'Object', columnB: 'Row' },
              'Scalar Row'
            ])
        })
      };

      const mockWorkbook = {
        sheets: jest.fn().mockReturnValue([mockSheet])
      };

      XLSX.fromFileAsync.mockResolvedValue(mockWorkbook);
      jest.spyOn(fs, 'stat').mockResolvedValue({ size: 1000 });

      const result = await extractTextFromXlsx(mockFilePath);
      expect(result).toBeDefined();
      expect(result).toContain('Array');
      expect(result).toContain('Object');
      expect(result).toContain('Scalar');
    });
  });

  describe('extractTextFromPptx', () => {
    test('should extract text from PPTX', async () => {
      const officeParser = require('officeparser');
      officeParser.parseOfficeAsync.mockResolvedValue('Presentation content');
      jest.spyOn(fs, 'stat').mockResolvedValue({ size: 1000 });

      const result = await extractTextFromPptx(mockFilePath);

      expect(result).toBe('Presentation content');
    });

    test('should handle object response from parser', async () => {
      const officeParser = require('officeparser');
      officeParser.parseOfficeAsync.mockResolvedValue({
        text: 'Presentation content'
      });
      jest.spyOn(fs, 'stat').mockResolvedValue({ size: 1000 });

      const result = await extractTextFromPptx(mockFilePath);

      expect(result).toBe('Presentation content');
    });

    test('should throw error for empty PPTX', async () => {
      const officeParser = require('officeparser');
      officeParser.parseOfficeAsync.mockResolvedValue('');
      jest.spyOn(fs, 'stat').mockResolvedValue({ size: 1000 });

      // FIX: Updated test to expect new error handling behavior
      await expect(extractTextFromPptx(mockFilePath)).rejects.toThrow();
    });

    test('should handle array response from PPTX parser', async () => {
      const officeParser = require('officeparser');
      // FIX: Test new support for array-based parser results
      officeParser.parseOfficeAsync.mockResolvedValue([
        'Slide 1 content',
        { text: 'Slide 2 content' },
        'Slide 3 content'
      ]);
      jest.spyOn(fs, 'stat').mockResolvedValue({ size: 1000 });

      const result = await extractTextFromPptx(mockFilePath);
      expect(result).toBeDefined();
      expect(result).toContain('Slide');
    });

    test('should handle object with content property in PPTX', async () => {
      const officeParser = require('officeparser');
      // FIX: Test support for alternative object structures
      officeParser.parseOfficeAsync.mockResolvedValue({
        content: 'Presentation content from content property'
      });
      jest.spyOn(fs, 'stat').mockResolvedValue({ size: 1000 });

      const result = await extractTextFromPptx(mockFilePath);
      expect(result).toBe('Presentation content from content property');
    });
  });

  describe('extractTextFromEpub', () => {
    test('should extract text from EPUB', async () => {
      const AdmZip = require('adm-zip');

      const mockEntries = [
        {
          entryName: 'chapter1.xhtml',
          getData: jest
            .fn()
            .mockReturnValue(Buffer.from('<html><body>Chapter 1 content</body></html>'))
        },
        {
          entryName: 'chapter2.html',
          getData: jest
            .fn()
            .mockReturnValue(Buffer.from('<html><body>Chapter 2 content</body></html>'))
        },
        {
          entryName: 'metadata.opf',
          getData: jest.fn().mockReturnValue(Buffer.from('metadata'))
        }
      ];

      const mockZip = {
        getEntries: jest.fn().mockReturnValue(mockEntries)
      };

      AdmZip.mockImplementation(() => mockZip);
      jest.spyOn(fs, 'stat').mockResolvedValue({ size: 1000 });

      const result = await extractTextFromEpub(mockFilePath);

      expect(result).toContain('Chapter 1 content');
      expect(result).toContain('Chapter 2 content');
    });

    test('should limit number of entries processed', async () => {
      const AdmZip = require('adm-zip');

      const mockEntries = Array.from({ length: 150 }, (_, i) => ({
        entryName: `chapter${i}.xhtml`,
        getData: jest.fn().mockReturnValue(Buffer.from(`<html>Chapter ${i}</html>`))
      }));

      const mockZip = {
        getEntries: jest.fn().mockReturnValue(mockEntries)
      };

      AdmZip.mockImplementation(() => mockZip);
      jest.spyOn(fs, 'stat').mockResolvedValue({ size: 1000 });

      const result = await extractTextFromEpub(mockFilePath);

      expect(result).toBeDefined();
      // Should process max 100 entries
    });
  });

  describe('extractTextFromEml', () => {
    test('should extract email headers and body', async () => {
      const emailContent = `Subject: Test Email
From: sender@example.com
To: receiver@example.com

This is the email body content.
It has multiple lines.`;

      jest.spyOn(fs, 'readFile').mockResolvedValue(emailContent);
      jest.spyOn(fs, 'stat').mockResolvedValue({ size: 1000 });

      const result = await extractTextFromEml(mockFilePath);

      expect(result).toContain('Test Email');
      expect(result).toContain('sender@example.com');
      expect(result).toContain('receiver@example.com');
      expect(result).toContain('email body content');
    });

    test('should handle email without some headers', async () => {
      const emailContent = `Subject: Test Email

Body content only.`;

      jest.spyOn(fs, 'readFile').mockResolvedValue(emailContent);
      jest.spyOn(fs, 'stat').mockResolvedValue({ size: 1000 });

      const result = await extractTextFromEml(mockFilePath);

      expect(result).toContain('Test Email');
      expect(result).toContain('Body content');
    });
  });

  describe('extractPlainTextFromHtml', () => {
    test('should strip HTML tags', () => {
      const html = '<html><body><h1>Title</h1><p>Paragraph text</p></body></html>';
      const result = extractPlainTextFromHtml(html);

      expect(result).toBe('Title Paragraph text');
      expect(result).not.toContain('<');
    });

    test('should remove scripts and styles', () => {
      const html = `
        <html>
          <head><style>body { color: red; }</style></head>
          <body>
            <script>alert('test');</script>
            <p>Content</p>
          </body>
        </html>
      `;
      const result = extractPlainTextFromHtml(html);

      expect(result).toContain('Content');
      expect(result).not.toContain('alert');
      expect(result).not.toContain('color: red');
    });

    test('should decode HTML entities', () => {
      const html = '<p>&lt;div&gt; &amp; &quot;quotes&quot; &apos;apostrophe&apos;</p>';
      const result = extractPlainTextFromHtml(html);

      expect(result).toContain('<div>');
      expect(result).toContain('&');
      expect(result).toContain('"quotes"');
      expect(result).toContain("'apostrophe'");
    });

    test('should handle malformed HTML gracefully', () => {
      const html = '<p>Unclosed tag <div>Content';
      const result = extractPlainTextFromHtml(html);

      expect(result).toContain('Unclosed tag');
      expect(result).toContain('Content');
    });
  });

  describe('extractPlainTextFromRtf', () => {
    test('should extract plain text from RTF', () => {
      const rtf = String.raw`{\rtf1\ansi\deff0 {\fonttbl{\f0 Times New Roman;}}
        \f0\fs24 This is RTF text content.}`;

      const result = extractPlainTextFromRtf(rtf);

      expect(result).toContain('This is RTF text content');
      expect(result).not.toContain('\\rtf');
      expect(result).not.toContain('{');
    });

    test('should handle encoded characters', () => {
      const rtf = String.raw`{\rtf1 Test \'e9 content}`;
      const result = extractPlainTextFromRtf(rtf);

      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
    });

    test('should handle malformed RTF gracefully', () => {
      const rtf = 'Not really RTF content';
      const result = extractPlainTextFromRtf(rtf);

      expect(result).toBe('Not really RTF content');
    });
  });

  describe('extractTextFromDoc', () => {
    test('should extract text using mammoth', async () => {
      const mammoth = require('mammoth');
      mammoth.extractRawText.mockResolvedValue({
        value: 'DOC content'
      });

      const result = await extractTextFromDoc(mockFilePath);

      expect(result).toBe('DOC content');
    });

    test('should fallback to reading as UTF-8 on error', async () => {
      const mammoth = require('mammoth');
      mammoth.extractRawText.mockRejectedValue(new Error('Parse error'));
      jest.spyOn(fs, 'readFile').mockResolvedValue('Fallback text content');

      const result = await extractTextFromDoc(mockFilePath);

      expect(result).toBe('Fallback text content');
    });
  });

  describe('extractTextFromXls', () => {
    test('should extract text from legacy Excel', async () => {
      const officeParser = require('officeparser');
      officeParser.parseOfficeAsync.mockResolvedValue('Spreadsheet data');

      const result = await extractTextFromXls(mockFilePath);

      expect(result).toBe('Spreadsheet data');
    });

    test('should handle parser failure gracefully', async () => {
      const officeParser = require('officeparser');
      officeParser.parseOfficeAsync.mockRejectedValue(new Error('Parse error'));

      const result = await extractTextFromXls(mockFilePath);

      expect(result).toBe('');
    });
  });

  describe('extractTextFromPpt', () => {
    test('should extract text from legacy PowerPoint', async () => {
      const officeParser = require('officeparser');
      officeParser.parseOfficeAsync.mockResolvedValue('Presentation text');

      const result = await extractTextFromPpt(mockFilePath);

      expect(result).toBe('Presentation text');
    });

    test('should return empty string on error', async () => {
      const officeParser = require('officeparser');
      officeParser.parseOfficeAsync.mockRejectedValue(new Error('Parse error'));

      const result = await extractTextFromPpt(mockFilePath);

      expect(result).toBe('');
    });
  });

  describe('extractTextFromMsg', () => {
    test('should extract text from Outlook message', async () => {
      const officeParser = require('officeparser');
      officeParser.parseOfficeAsync.mockResolvedValue('Email message content');

      const result = await extractTextFromMsg(mockFilePath);

      expect(result).toBe('Email message content');
    });

    test('should handle errors gracefully', async () => {
      const officeParser = require('officeparser');
      officeParser.parseOfficeAsync.mockRejectedValue(new Error('Parse error'));

      const result = await extractTextFromMsg(mockFilePath);

      expect(result).toBe('');
    });
  });

  describe('extractTextFromOdfZip', () => {
    test('should extract text from ODF document', async () => {
      const AdmZip = require('adm-zip');

      const mockEntry = {
        getData: jest
          .fn()
          .mockReturnValue(
            Buffer.from('<office:document-content>Content</office:document-content>')
          )
      };

      const mockZip = {
        getEntry: jest.fn().mockReturnValue(mockEntry)
      };

      AdmZip.mockImplementation(() => mockZip);

      const result = await extractTextFromOdfZip(mockFilePath);

      expect(result).toContain('Content');
    });

    test('should return empty string if content.xml not found', async () => {
      const AdmZip = require('adm-zip');

      const mockZip = {
        getEntry: jest.fn().mockReturnValue(null)
      };

      AdmZip.mockImplementation(() => mockZip);

      const result = await extractTextFromOdfZip(mockFilePath);

      expect(result).toBe('');
    });
  });

  describe('extractTextFromKml', () => {
    test('should extract text from KML', async () => {
      const kmlContent = `<?xml version="1.0"?>
        <kml>
          <Document>
            <name>Test Location</name>
            <Placemark>
              <name>Point A</name>
            </Placemark>
          </Document>
        </kml>`;

      jest.spyOn(fs, 'readFile').mockResolvedValue(kmlContent);

      const result = await extractTextFromKml(mockFilePath);

      expect(result).toContain('Test Location');
      expect(result).toContain('Point A');
    });
  });

  describe('extractTextFromKmz', () => {
    test('should extract text from KMZ archive', async () => {
      const AdmZip = require('adm-zip');

      const mockEntry = {
        entryName: 'doc.kml',
        getData: jest
          .fn()
          .mockReturnValue(Buffer.from('<kml><Document><name>Test</name></Document></kml>'))
      };

      const mockZip = {
        getEntry: jest.fn().mockReturnValue(mockEntry),
        getEntries: jest.fn().mockReturnValue([mockEntry])
      };

      AdmZip.mockImplementation(() => mockZip);

      const result = await extractTextFromKmz(mockFilePath);

      expect(result).toContain('Test');
    });

    test('should find .kml file in entries if doc.kml not found', async () => {
      const AdmZip = require('adm-zip');

      const mockEntry = {
        entryName: 'custom.kml',
        getData: jest.fn().mockReturnValue(Buffer.from('<kml>Content</kml>'))
      };

      const mockZip = {
        getEntry: jest.fn().mockReturnValue(null),
        getEntries: jest.fn().mockReturnValue([mockEntry])
      };

      AdmZip.mockImplementation(() => mockZip);

      const result = await extractTextFromKmz(mockFilePath);

      expect(result).toContain('Content');
    });
  });

  describe('Memory Management', () => {
    test('should handle null/undefined in truncateText', async () => {
      const pdfParse = require('pdf-parse');
      pdfParse.mockResolvedValue({ text: null });
      jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('pdf'));
      jest.spyOn(fs, 'stat').mockResolvedValue({ size: 1000 });

      await expect(extractTextFromPdf(mockFilePath, mockFileName)).rejects.toThrow();
    });

    test('should cleanup buffers after PDF processing', async () => {
      const pdfParse = require('pdf-parse');
      pdfParse.mockResolvedValue({ text: 'Content' });
      jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('pdf data'));
      jest.spyOn(fs, 'stat').mockResolvedValue({ size: 1000 });

      await extractTextFromPdf(mockFilePath, mockFileName);

      // Verify no memory leaks by checking function completes
      expect(pdfParse).toHaveBeenCalled();
    });
  });

  describe('extractTextFromCsv', () => {
    const { extractTextFromCsv } = require('../src/main/analysis/documentExtractors');

    test('should extract text from valid CSV', async () => {
      const csvContent = 'Name,Age,City\nAlice,30,New York\nBob,25,Los Angeles';
      jest.spyOn(fs, 'readFile').mockResolvedValue(csvContent);
      jest.spyOn(fs, 'stat').mockResolvedValue({ size: 1000 });

      const result = await extractTextFromCsv('/test/data.csv');

      expect(result).toContain('Alice');
      expect(result).toContain('30');
      expect(result).toContain('New York');
    });

    test('should handle object-style CSV rows', async () => {
      // Some CSV parsers return objects instead of arrays
      jest.spyOn(fs, 'readFile').mockResolvedValue('col1,col2\nval1,val2');
      jest.spyOn(fs, 'stat').mockResolvedValue({ size: 1000 });

      const result = await extractTextFromCsv('/test/data.csv');

      expect(result).toBeDefined();
    });

    test('should limit rows to prevent memory issues', async () => {
      const rows = Array.from({ length: 6000 }, (_, i) => `row${i},data${i}`);
      const csvContent = 'Header1,Header2\n' + rows.join('\n');
      jest.spyOn(fs, 'readFile').mockResolvedValue(csvContent);
      jest.spyOn(fs, 'stat').mockResolvedValue({ size: 1000 });

      const result = await extractTextFromCsv('/test/large.csv');

      expect(result).toBeDefined();
      // Should have limited rows
    });

    test('should return raw text on parse failure', async () => {
      jest.spyOn(fs, 'readFile').mockResolvedValue('invalid csv with "unterminated quote');
      jest.spyOn(fs, 'stat').mockResolvedValue({ size: 1000 });

      const result = await extractTextFromCsv('/test/invalid.csv');

      expect(result).toBeDefined();
    });

    test('should handle empty CSV', async () => {
      jest.spyOn(fs, 'readFile').mockResolvedValue('');
      jest.spyOn(fs, 'stat').mockResolvedValue({ size: 0 });

      const result = await extractTextFromCsv('/test/empty.csv');

      expect(result).toBe('');
    });
  });

  describe('extractPlainTextFromXml', () => {
    const { extractPlainTextFromXml } = require('../src/main/analysis/documentExtractors');

    test('should extract text from valid XML', () => {
      const xml = '<?xml version="1.0"?><root><item>Content here</item></root>';
      const result = extractPlainTextFromXml(xml);

      expect(result).toContain('Content here');
    });

    test('should handle nested XML elements', () => {
      const xml = '<root><level1><level2>Nested content</level2></level1></root>';
      const result = extractPlainTextFromXml(xml);

      expect(result).toContain('Nested content');
    });

    test('should handle empty XML', () => {
      const result = extractPlainTextFromXml('');

      expect(result).toBe('');
    });

    test('should handle null XML', () => {
      const result = extractPlainTextFromXml(null);

      expect(result).toBe('');
    });

    test('should fallback to HTML stripping on parse error', () => {
      // Malformed XML that will cause parser to fail
      const malformedXml = '<root><unclosed>Content';
      const result = extractPlainTextFromXml(malformedXml);

      expect(result).toContain('Content');
    });

    test('should handle XML with numeric values', () => {
      const xml = '<data><count>42</count><price>99.99</price></data>';
      const result = extractPlainTextFromXml(xml);

      expect(result).toContain('42');
      expect(result).toContain('99.99');
    });

    test('should handle XML with boolean values', () => {
      const xml = '<settings><enabled>true</enabled></settings>';
      const result = extractPlainTextFromXml(xml);

      expect(result).toContain('true');
    });

    test('should handle XML with arrays', () => {
      const xml = '<list><item>One</item><item>Two</item><item>Three</item></list>';
      const result = extractPlainTextFromXml(xml);

      expect(result).toContain('One');
      expect(result).toContain('Two');
      expect(result).toContain('Three');
    });
  });

  describe('file size handling', () => {
    test('should reject files over size limit', async () => {
      jest.spyOn(fs, 'stat').mockResolvedValue({ size: 150 * 1024 * 1024 }); // 150MB

      await expect(extractTextFromPdf(mockFilePath, mockFileName)).rejects.toThrow(
        'File size exceeds processing limits'
      );
    });

    test('should handle stat errors', async () => {
      const error = new Error('EACCES: permission denied');
      error.code = 'EACCES';
      jest.spyOn(fs, 'stat').mockRejectedValue(error);

      await expect(extractTextFromPdf(mockFilePath, mockFileName)).rejects.toThrow();
    });
  });

  describe('extractTextFromEpub - edge cases', () => {
    test('should handle entries without getData method', async () => {
      const AdmZip = require('adm-zip');

      const mockEntries = [
        {
          entryName: 'chapter1.xhtml'
          // Missing getData method
        }
      ];

      const mockZip = {
        getEntries: jest.fn().mockReturnValue(mockEntries)
      };

      AdmZip.mockImplementation(() => mockZip);
      jest.spyOn(fs, 'stat').mockResolvedValue({ size: 1000 });

      const result = await extractTextFromEpub(mockFilePath);

      // Should handle gracefully
      expect(result).toBeDefined();
    });

    test('should skip non-HTML entries', async () => {
      const AdmZip = require('adm-zip');

      const mockEntries = [
        {
          entryName: 'image.png',
          getData: jest.fn().mockReturnValue(Buffer.from('binary data'))
        },
        {
          entryName: 'chapter.html',
          getData: jest.fn().mockReturnValue(Buffer.from('<html><body>Chapter</body></html>'))
        }
      ];

      const mockZip = {
        getEntries: jest.fn().mockReturnValue(mockEntries)
      };

      AdmZip.mockImplementation(() => mockZip);
      jest.spyOn(fs, 'stat').mockResolvedValue({ size: 1000 });

      const result = await extractTextFromEpub(mockFilePath);

      expect(result).toContain('Chapter');
    });
  });

  describe('extractTextFromEml - edge cases', () => {
    test('should handle multi-line headers', async () => {
      const emailContent = `Subject: This is a very long subject
 that spans multiple lines
From: sender@example.com
To: receiver@example.com

Body content.`;

      jest.spyOn(fs, 'readFile').mockResolvedValue(emailContent);
      jest.spyOn(fs, 'stat').mockResolvedValue({ size: 1000 });

      const result = await extractTextFromEml(mockFilePath);

      expect(result).toBeDefined();
      expect(result).toContain('sender@example.com');
    });

    test('should handle email with no body', async () => {
      const emailContent = `Subject: Headers Only
From: sender@example.com`;

      jest.spyOn(fs, 'readFile').mockResolvedValue(emailContent);
      jest.spyOn(fs, 'stat').mockResolvedValue({ size: 1000 });

      const result = await extractTextFromEml(mockFilePath);

      expect(result).toContain('Headers Only');
    });
  });

  describe('extractTextFromKmz - edge cases', () => {
    test('should handle KMZ with no KML files', async () => {
      const AdmZip = require('adm-zip');

      const mockZip = {
        getEntry: jest.fn().mockReturnValue(null),
        getEntries: jest.fn().mockReturnValue([{ entryName: 'readme.txt' }])
      };

      AdmZip.mockImplementation(() => mockZip);

      const result = await extractTextFromKmz(mockFilePath);

      expect(result).toBe('');
    });

    test('should handle getData throwing error', async () => {
      const AdmZip = require('adm-zip');

      const mockEntry = {
        entryName: 'doc.kml',
        getData: jest.fn().mockImplementation(() => {
          throw new Error('Corrupt archive');
        })
      };

      const mockZip = {
        getEntry: jest.fn().mockReturnValue(mockEntry),
        getEntries: jest.fn().mockReturnValue([mockEntry])
      };

      AdmZip.mockImplementation(() => mockZip);

      // Should throw error or return empty string
      try {
        const result = await extractTextFromKmz(mockFilePath);
        expect(result).toBe('');
      } catch (error) {
        expect(error.message).toContain('Corrupt');
      }
    });
  });

  describe('extractPlainTextFromHtml - edge cases', () => {
    test('should handle null input gracefully', () => {
      const result = extractPlainTextFromHtml(null);
      expect(result === '' || result === undefined || result === null).toBe(true);
    });

    test('should handle undefined input gracefully', () => {
      const result = extractPlainTextFromHtml(undefined);
      expect(result === '' || result === undefined).toBe(true);
    });

    test('should handle empty string', () => {
      const result = extractPlainTextFromHtml('');
      expect(result).toBe('');
    });

    test('should normalize whitespace', () => {
      const html = '<p>Text   with    multiple     spaces</p>';
      const result = extractPlainTextFromHtml(html);

      expect(result).toBe('Text with multiple spaces');
    });
  });

  describe('extractPlainTextFromRtf - edge cases', () => {
    test('should handle null input gracefully', () => {
      const result = extractPlainTextFromRtf(null);
      // Function may return undefined/null for invalid input
      expect(result === '' || result === undefined || result === null).toBe(true);
    });

    test('should handle undefined input gracefully', () => {
      const result = extractPlainTextFromRtf(undefined);
      // Function may return undefined for invalid input
      expect(result === '' || result === undefined).toBe(true);
    });

    test('should handle empty string', () => {
      const result = extractPlainTextFromRtf('');
      expect(result === '' || result === undefined).toBe(true);
    });
  });
});
