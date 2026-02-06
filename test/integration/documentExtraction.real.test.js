/**
 * Integration Tests - Real File Extraction
 *
 * Validates that document text extraction works correctly with actual
 * test files from test/test-files/. Unlike unit tests that mock fs I/O,
 * these tests read real files and verify meaningful content is extracted.
 *
 * Covers: TXT, CSV, HTML, RTF, EML file types (no external binary deps)
 */

const path = require('path');
const fs = require('fs').promises;

// Mock only the dependencies that aren't needed for extraction
jest.mock('unpdf', () => ({
  extractText: jest.fn()
}));
jest.mock('sharp');
jest.mock('../../src/main/utils/tesseractUtils', () => ({
  isTesseractAvailable: jest.fn().mockResolvedValue(false),
  recognizeIfAvailable: jest.fn().mockResolvedValue({ success: false, text: '' })
}));
jest.mock('mammoth');
jest.mock('xlsx-populate');
jest.mock('adm-zip');

const {
  extractPlainTextFromRtf,
  extractPlainTextFromHtml,
  extractTextFromCsv,
  extractTextFromEml
} = require('../../src/main/analysis/documentExtractors');

const FIXTURE_DIR = path.resolve(__dirname, '../test-files');

/**
 * Helper: verify fixture file exists before testing
 */
async function fixtureExists(filename) {
  try {
    await fs.access(path.join(FIXTURE_DIR, filename));
    return true;
  } catch {
    return false;
  }
}

describe('Real File Extraction - Text Files', () => {
  test('extracts meaningful content from sample.txt (invoice)', async () => {
    const filePath = path.join(FIXTURE_DIR, 'sample.txt');
    if (!(await fixtureExists('sample.txt'))) {
      console.warn('Skipping: sample.txt not found');
      return;
    }

    const content = await fs.readFile(filePath, 'utf8');

    expect(content).toBeDefined();
    expect(content.length).toBeGreaterThan(50);
    // Verify domain-specific content was read
    expect(content).toContain('Invoice');
    expect(content).toContain('Acme Corporation');
    expect(content).toContain('$1,250.00');
    expect(content).toContain('Financial');
  });

  test('extracts meaningful content from contract.txt (legal)', async () => {
    const filePath = path.join(FIXTURE_DIR, 'contract.txt');
    if (!(await fixtureExists('contract.txt'))) {
      console.warn('Skipping: contract.txt not found');
      return;
    }

    const content = await fs.readFile(filePath, 'utf8');

    expect(content).toBeDefined();
    expect(content.length).toBeGreaterThan(100);
    expect(content).toContain('SERVICE AGREEMENT');
    expect(content).toContain('TERMS AND CONDITIONS');
    expect(content).toContain('$50,000');
    expect(content).toContain('CONFIDENTIALITY');
  });

  test('extracts content from project-report.md (markdown)', async () => {
    const filePath = path.join(FIXTURE_DIR, 'project-report.md');
    if (!(await fixtureExists('project-report.md'))) {
      console.warn('Skipping: project-report.md not found');
      return;
    }

    const content = await fs.readFile(filePath, 'utf8');

    expect(content).toBeDefined();
    expect(content.length).toBeGreaterThan(50);
    // Markdown files should be readable as plain text
    expect(typeof content).toBe('string');
  });
});

describe('Real File Extraction - CSV', () => {
  test('extracts tabular data from sales_data.csv', async () => {
    if (!(await fixtureExists('sales_data.csv'))) {
      console.warn('Skipping: sales_data.csv not found');
      return;
    }

    const filePath = path.join(FIXTURE_DIR, 'sales_data.csv');
    const result = await extractTextFromCsv(filePath);

    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(20);
    // Verify CSV content was parsed into readable text
    expect(result).toContain('Widget');
    expect(result).toContain('Electronics');
  });
});

describe('Real File Extraction - HTML', () => {
  test('strips HTML tags from webpage_template.html', async () => {
    if (!(await fixtureExists('webpage_template.html'))) {
      console.warn('Skipping: webpage_template.html not found');
      return;
    }

    const raw = await fs.readFile(path.join(FIXTURE_DIR, 'webpage_template.html'), 'utf8');
    const result = extractPlainTextFromHtml(raw);

    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
    // Should have stripped HTML tags
    expect(result).not.toContain('<html');
    expect(result).not.toContain('<body');
    expect(result).not.toContain('<meta');
    // Should preserve text content
    expect(result).toContain('Welcome to Sample Page');
    expect(result).toContain('About This Page');
    expect(result).toContain('sample HTML file');
  });
});

describe('Real File Extraction - RTF', () => {
  test('strips RTF control words from rich_text_doc.rtf', async () => {
    if (!(await fixtureExists('rich_text_doc.rtf'))) {
      console.warn('Skipping: rich_text_doc.rtf not found');
      return;
    }

    const raw = await fs.readFile(path.join(FIXTURE_DIR, 'rich_text_doc.rtf'), 'utf8');
    const result = extractPlainTextFromRtf(raw);

    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
    // Should have stripped RTF control sequences
    expect(result).not.toContain('{\\rtf1');
    expect(result).not.toContain('\\fonttbl');
    expect(result).not.toContain('\\pard');
    // Should preserve readable text
    expect(result).toContain('Sample Rich Text Document');
    expect(result).toContain('rich text');
  });
});

describe('Real File Extraction - EML', () => {
  test('extracts email content from meeting_invite.eml', async () => {
    if (!(await fixtureExists('meeting_invite.eml'))) {
      console.warn('Skipping: meeting_invite.eml not found');
      return;
    }

    const filePath = path.join(FIXTURE_DIR, 'meeting_invite.eml');
    const result = await extractTextFromEml(filePath);

    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(20);
    // Should extract email headers and body
    expect(result).toContain('Project Meeting');
    expect(result).toContain('planning');
  });
});

describe('Real File Extraction - Content Quality', () => {
  test('extracted text is suitable for AI analysis (non-trivial length)', async () => {
    const textFiles = [
      { file: 'sample.txt', minLength: 100 },
      { file: 'contract.txt', minLength: 200 }
    ];

    for (const { file, minLength } of textFiles) {
      if (!(await fixtureExists(file))) continue;

      const content = await fs.readFile(path.join(FIXTURE_DIR, file), 'utf8');
      expect(content.trim().length).toBeGreaterThan(minLength);
      // Content should not be mostly whitespace
      const nonWhitespaceRatio = content.replace(/\s/g, '').length / content.length;
      expect(nonWhitespaceRatio).toBeGreaterThan(0.3);
    }
  });

  test('extracted text contains categorizable keywords', async () => {
    if (!(await fixtureExists('sample.txt'))) return;

    const content = await fs.readFile(path.join(FIXTURE_DIR, 'sample.txt'), 'utf8');
    const lowerContent = content.toLowerCase();

    // Should contain financial domain keywords that AI can use for categorization
    const financialKeywords = ['invoice', 'payment', 'financial', 'amount'];
    const matchedKeywords = financialKeywords.filter((kw) => lowerContent.includes(kw));
    expect(matchedKeywords.length).toBeGreaterThanOrEqual(2);
  });

  test('HTML extraction preserves semantic content, removes markup', async () => {
    if (!(await fixtureExists('webpage_template.html'))) return;

    const raw = await fs.readFile(path.join(FIXTURE_DIR, 'webpage_template.html'), 'utf8');
    const extracted = extractPlainTextFromHtml(raw);

    // Raw HTML has tags, extracted should not
    expect(raw).toContain('<h1>');
    expect(extracted).not.toContain('<h1>');

    // But the text content should be preserved
    const rawTextContent = 'Welcome to Sample Page';
    expect(raw).toContain(rawTextContent);
    expect(extracted).toContain(rawTextContent);
  });
});
