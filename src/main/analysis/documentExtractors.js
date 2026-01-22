const fs = require('fs').promises;
const { createReadStream } = require('fs');

const { FileProcessingError } = require('../errors/AnalysisError');
const { logger } = require('../../shared/logger');
const { LIMITS } = require('../../shared/constants');
// FIX P3-2: Import withTimeout for extraction timeout handling
const { withTimeout } = require('../../shared/promiseUtils');

// FIX P3-2: Timeout constants for extraction operations to prevent indefinite hangs
const EXTRACTION_TIMEOUTS = {
  PDF: 120000, // 2 minutes for PDF (can be slow for large files)
  DOCX: 60000, // 1 minute for DOCX
  XLSX: 90000, // 1.5 minutes for XLSX (can be slow for large spreadsheets)
  PPTX: 90000, // 1.5 minutes for PPTX
  OCR: 180000, // 3 minutes for OCR (very slow operation)
  DEFAULT: 60000 // 1 minute default
};

let XMLParser;
try {
  // Prefer the full parser when available
  ({ XMLParser } = require('fast-xml-parser'));
} catch (error) {
  logger.debug('[EXTRACT] fast-xml-parser not found, using fallback', { error: error.message });
  // Fallback: lightweight internal parser to keep runtime alive when dependency is missing
  ({ XMLParser } = require('./xmlParserFallback'));
}
const { parse: parseCsv } = require('csv-parse/sync');

logger.setContext('DocumentExtractors');

// Streaming thresholds for large file handling
const STREAM_THRESHOLD = 50 * 1024 * 1024; // 50MB - use streaming for files larger than this
const MAX_CONTENT_LENGTH = 2 * 1024 * 1024; // 2MB of text max for LLM
const MAX_CSV_ROWS = 5000;
const MAX_CSV_COLS = 100;

// Pre-compiled regex patterns for performance (compiled once at module load)
const REGEX_PATTERNS = {
  // RTF patterns
  rtfHexEscape: /\\'([0-9a-fA-F]{2})/g,
  rtfBraces: /[{}]/g,
  rtfControlWords: /\\[a-zA-Z]+-?\d* ?/g,

  // HTML patterns
  scriptTags: /<script[\s\S]*?<\/script>/gi,
  styleTags: /<style[\s\S]*?<\/style>/gi,
  htmlTags: /<[^>]+>/g,

  // Entity patterns
  nbspEntity: /&nbsp;/g,
  ampEntity: /&amp;/g,
  ltEntity: /&lt;/g,
  gtEntity: /&gt;/g,
  quotEntity: /&quot;/g,
  aposEntity: /&#39;|&apos;/g,

  // Whitespace patterns
  whitespace: /\s+/g,
  doubleNewline: /\r?\n\r?\n/,

  // Email header patterns
  subjectHeader: /^Subject:\s*(.*)$/im,
  fromHeader: /^From:\s*(.*)$/im,
  toHeader: /^To:\s*(.*)$/im,

  // JSON cleanup for PPTX fallback
  // eslint-disable-next-line no-useless-escape
  jsonPunctuation: /[{}":,\[\]]/g
};

// Memory management constants
// Note: MAX_FILE_SIZE is imported from shared/constants.js as LIMITS.MAX_FILE_SIZE
const MAX_TEXT_LENGTH = 500000; // 500k characters max output
const MAX_XLSX_ROWS = 10000; // Limit spreadsheet rows to prevent memory issues
const xmlParser = new XMLParser({
  ignoreAttributes: true,
  attributeNamePrefix: '',
  trimValues: true,
  allowBooleanAttributes: true,
  ignoreDeclaration: true
});

/**
 * Check file size and enforce memory limits
 * @param {string} filePath - Path to file
 * @param {string} fileName - Name of file for error messages
 * @throws {FileProcessingError} If file exceeds size limit
 */
async function checkFileSize(filePath, fileName) {
  try {
    const stats = await fs.stat(filePath);
    if (stats.size > LIMITS.MAX_FILE_SIZE) {
      throw new FileProcessingError('FILE_TOO_LARGE', fileName, {
        suggestion: `File size ${(stats.size / 1024 / 1024).toFixed(1)}MB exceeds limit of ${LIMITS.MAX_FILE_SIZE / 1024 / 1024}MB`,
        fileSize: stats.size,
        maxSize: LIMITS.MAX_FILE_SIZE
      });
    }
    return stats.size;
  } catch (error) {
    if (error.code === 'FILE_TOO_LARGE') throw error;
    throw new FileProcessingError('FILE_READ_ERROR', fileName, {
      suggestion: error.message,
      cause: error
    });
  }
}

/**
 * Truncate text to prevent memory issues
 * @param {string} text - Text to truncate
 * @returns {string} Truncated text
 */
function truncateText(text) {
  if (!text) return '';
  if (text.length <= MAX_TEXT_LENGTH) return text;
  return `${text.substring(0, MAX_TEXT_LENGTH)}\n\n[Text truncated due to length]`;
}

async function parseOfficeFile(officeParser, filePath) {
  if (!officeParser) {
    throw new Error('officeParser unavailable');
  }
  if (typeof officeParser.parseOfficeAsync === 'function') {
    return officeParser.parseOfficeAsync(filePath);
  }
  if (typeof officeParser.parseOffice === 'function') {
    return officeParser.parseOffice(filePath);
  }
  throw new Error('officeParser.parseOfficeAsync is not a function');
}

const DOC_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

async function readFileSignature(filePath, length = 8) {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, 0);
    return buffer;
  } finally {
    await handle.close();
  }
}

function matchesSignature(buffer, signature) {
  if (!buffer || buffer.length < signature.length) return false;
  for (let i = 0; i < signature.length; i += 1) {
    if (buffer[i] !== signature[i]) return false;
  }
  return true;
}

function isOleCompoundFile(buffer) {
  return matchesSignature(buffer, DOC_SIGNATURE);
}

function isZipFile(buffer) {
  return matchesSignature(buffer, ZIP_SIGNATURE);
}

function flattenXmlText(value, chunks) {
  if (value === null || value === undefined) return;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    chunks.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => flattenXmlText(item, chunks));
    return;
  }
  if (typeof value === 'object') {
    Object.values(value).forEach((item) => flattenXmlText(item, chunks));
  }
}

function extractPlainTextFromXml(xmlString) {
  if (!xmlString) return '';
  try {
    const parsed = xmlParser.parse(xmlString);
    const chunks = [];
    flattenXmlText(parsed, chunks);
    const text = chunks.join(' ').replace(REGEX_PATTERNS.whitespace, ' ').trim();
    if (text) return truncateText(text);
  } catch (error) {
    logger.warn('[XML] Failed to parse XML safely, falling back to tag stripping', {
      error: error.message
    });
  }
  return extractPlainTextFromHtml(xmlString);
}

async function extractTextFromCsv(filePath) {
  // Treat CSV as structured text; enforce file size to avoid memory blowups
  await checkFileSize(filePath, filePath);
  const raw = await fs.readFile(filePath, 'utf8');
  try {
    const records = parseCsv(raw, {
      bom: true,
      skipEmptyLines: true,
      relaxColumnCount: true,
      relaxQuotes: true
    });

    if (!Array.isArray(records) || records.length === 0) {
      return truncateText(raw);
    }

    const rows = records.slice(0, MAX_CSV_ROWS).map((row) => {
      if (Array.isArray(row)) {
        return row
          .slice(0, MAX_CSV_COLS)
          .filter((cell) => cell !== null && cell !== undefined)
          .map((cell) => String(cell))
          .join(' ');
      }
      if (row && typeof row === 'object') {
        return Object.values(row)
          .slice(0, MAX_CSV_COLS)
          .filter((cell) => cell !== null && cell !== undefined)
          .map((cell) => String(cell))
          .join(' ');
      }
      return String(row);
    });

    return truncateText(rows.join('\n'));
  } catch (error) {
    logger.warn('[CSV] Structured parse failed, returning raw text', {
      error: error.message
    });
    return truncateText(raw);
  }
}

/**
 * Extract content with streaming for large files
 * Uses streaming for files over STREAM_THRESHOLD to prevent memory issues
 * @param {string} filePath - Path to file
 * @returns {Promise<string>} Extracted text content
 */
async function extractContentWithSizeCheck(filePath) {
  const stats = await fs.stat(filePath);

  if (stats.size > STREAM_THRESHOLD) {
    logger.info(
      `[EXTRACT] Using streaming for large file (${Math.round(stats.size / 1024 / 1024)}MB)`,
      { filePath }
    );
    return extractContentStreaming(filePath);
  }

  return extractContentBuffered(filePath);
}

/**
 * Read file content into buffer (for smaller files)
 * @param {string} filePath - Path to file
 * @returns {Promise<string>} File content
 */
async function extractContentBuffered(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  return truncateText(content);
}

/**
 * Stream large file content with early termination
 * Stops reading once MAX_CONTENT_LENGTH is reached to prevent memory overflow
 * @param {string} filePath - Path to file
 * @returns {Promise<string>} Streamed and truncated content
 */
async function extractContentStreaming(filePath) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalLength = 0;
    let resolved = false;

    const safeResolve = (value) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    const safeReject = (error) => {
      if (resolved) return;
      resolved = true;
      reject(error);
    };

    const stream = createReadStream(filePath, {
      encoding: 'utf8',
      highWaterMark: 64 * 1024 // 64KB chunks
    });

    stream.on('data', (chunk) => {
      if (totalLength >= MAX_CONTENT_LENGTH) {
        stream.destroy(); // Stop reading
        return;
      }

      const remaining = MAX_CONTENT_LENGTH - totalLength;
      const toAdd = chunk.slice(0, remaining);
      chunks.push(toAdd);
      totalLength += toAdd.length;
    });

    stream.on('end', () => {
      safeResolve(chunks.join(''));
    });

    stream.on('error', safeReject);

    stream.on('close', () => {
      // Handle early termination
      if (totalLength >= MAX_CONTENT_LENGTH) {
        logger.debug('[EXTRACT] Truncated large file content', {
          filePath,
          maxLength: MAX_CONTENT_LENGTH
        });
      }
      safeResolve(chunks.join(''));
    });
  });
}

async function extractTextFromPdf(filePath, fileName) {
  // Fixed: Check file size before loading into memory
  await checkFileSize(filePath, fileName);

  let dataBuffer = null;
  let parser = null;

  try {
    dataBuffer = await fs.readFile(filePath);
    let pdfText = '';

    // pdf-parse 2.x is an ESM module - need to handle both require and dynamic import
    // The CJS bundle exports PDFParse as a named export
    try {
      const pdfModule = require('pdf-parse');

      // pdf-parse 2.x: Check for PDFParse class (named export in CJS bundle)
      const PDFParseClass = pdfModule.PDFParse || pdfModule.default?.PDFParse;

      if (PDFParseClass && typeof PDFParseClass === 'function') {
        logger.debug('[PDF] Using pdf-parse 2.x API');
        try {
          parser = new PDFParseClass({ data: dataBuffer });
          await parser.load();
          const textResult = await parser.getText();

          // getText() returns object with 'text' property (combined text from all pages)
          if (textResult && textResult.text) {
            pdfText = textResult.text.trim();
            logger.debug('[PDF] Extracted text length:', pdfText.length);
          }
        } catch (v2Error) {
          logger.warn('[PDF] pdf-parse 2.x extraction failed:', {
            error: v2Error.message,
            stack: v2Error.stack
          });
          throw v2Error;
        }
      } else if (typeof pdfModule === 'function') {
        // pdf-parse 1.x uses direct function call
        logger.debug('[PDF] Using pdf-parse 1.x API (function)');
        const pdfData = await pdfModule(dataBuffer);
        pdfText = pdfData.text || '';
      } else if (pdfModule.default && typeof pdfModule.default === 'function') {
        // ESM default export fallback
        logger.debug('[PDF] Using pdf-parse ESM default export');
        const pdfData = await pdfModule.default(dataBuffer);
        pdfText = pdfData.text || '';
      } else {
        // Log what we got from require to help debug
        logger.error('[PDF] Unable to determine pdf-parse API version', {
          moduleType: typeof pdfModule,
          hasDefault: !!pdfModule.default,
          hasPDFParse: !!pdfModule.PDFParse,
          keys: Object.keys(pdfModule).slice(0, 10)
        });
        throw new Error(
          `Unable to determine pdf-parse API version. Got module type: ${typeof pdfModule}, keys: ${Object.keys(pdfModule).slice(0, 5).join(', ')}`
        );
      }
    } catch (requireError) {
      // If CommonJS require fails, try dynamic import for ESM
      logger.warn('[PDF] CommonJS require failed, trying dynamic import:', requireError.message);
      try {
        const pdfModule = await import('pdf-parse');
        const PDFParseClass = pdfModule.PDFParse || pdfModule.default?.PDFParse;

        if (PDFParseClass) {
          parser = new PDFParseClass({ data: dataBuffer });
          await parser.load();
          const textResult = await parser.getText();
          if (textResult && textResult.text) {
            pdfText = textResult.text.trim();
          }
        } else {
          throw new Error('PDFParse class not found in dynamic import');
        }
      } catch (importError) {
        logger.error('[PDF] Both require and import failed:', {
          requireError: requireError.message,
          importError: importError.message
        });
        throw requireError;
      }
    }

    if (!pdfText || pdfText.trim().length === 0) {
      throw new FileProcessingError('PDF_NO_TEXT_CONTENT', fileName, {
        suggestion: 'PDF may be image-based or corrupted'
      });
    }

    // Fixed: Truncate text to prevent memory issues and clean up buffer
    const result = truncateText(pdfText);
    dataBuffer = null; // Explicit cleanup to help GC
    return result;
  } finally {
    // Always destroy parser to free memory (required by v2 API)
    if (parser && typeof parser.destroy === 'function') {
      try {
        await parser.destroy();
      } catch (destroyError) {
        logger.debug('[PDF] Parser destroy error:', destroyError.message);
      }
    }
    // FIX P1-7: Clear parser reference after destruction to allow GC
    parser = null;
    // Ensure buffer is dereferenced even on error
    dataBuffer = null;
  }
}

async function ocrPdfIfNeeded(filePath) {
  const sharp = require('sharp');
  const tesseract = require('node-tesseract-ocr');
  let pdfBuffer = null;
  let rasterPng = null;

  // FIX P1-8: OCR memory constraints to prevent memory exhaustion
  // Cap density to 150 DPI (was 200) - still good for OCR, but reduces memory 44%
  // Add max dimensions to prevent huge images from 200+ page PDFs
  const OCR_DENSITY = 150; // DPI for rasterization
  const OCR_MAX_WIDTH = 2480; // ~A4 at 150 DPI
  const OCR_MAX_HEIGHT = 3508; // ~A4 at 150 DPI
  const OCR_MAX_FILE_SIZE = 30 * 1024 * 1024; // 30MB limit (reduced from 50MB)

  try {
    // Fixed: Check file size before OCR processing (OCR is very memory intensive)
    const stats = await fs.stat(filePath);
    // OCR has stricter limits due to image processing overhead
    if (stats.size > OCR_MAX_FILE_SIZE) {
      // FIX: Log the skip reason instead of silently returning
      logger.info('[OCR] Skipping OCR - file exceeds size limit', {
        filePath,
        fileSize: stats.size,
        maxSize: OCR_MAX_FILE_SIZE
      });
      return '';
    }

    pdfBuffer = await fs.readFile(filePath);

    // FIX P1-8: Use lower density and resize to constrain memory usage
    // A 40MB PDF at 200 DPI could become 150MB+ PNG, causing OOM
    let sharpPipeline = sharp(pdfBuffer, { density: OCR_DENSITY });

    // Get metadata to check if resize is needed
    const metadata = await sharpPipeline.metadata();
    if (metadata.width > OCR_MAX_WIDTH || metadata.height > OCR_MAX_HEIGHT) {
      logger.debug('[OCR] Resizing large image for OCR', {
        originalWidth: metadata.width,
        originalHeight: metadata.height,
        maxWidth: OCR_MAX_WIDTH,
        maxHeight: OCR_MAX_HEIGHT
      });
      sharpPipeline = sharpPipeline.resize(OCR_MAX_WIDTH, OCR_MAX_HEIGHT, {
        fit: 'inside',
        withoutEnlargement: true
      });
    }

    rasterPng = await sharpPipeline.png({ compressionLevel: 6 }).toBuffer();

    // Clear PDF buffer before OCR to reduce peak memory
    pdfBuffer = null;

    const ocrText = await tesseract.recognize(rasterPng, {
      lang: 'eng',
      oem: 1,
      psm: 3
    });

    // Fixed: Truncate OCR results and clean up
    const result = ocrText && ocrText.trim().length > 0 ? truncateText(ocrText) : '';
    rasterPng = null;
    return result;
  } catch (error) {
    // FIX: Log error details instead of silently returning empty string
    logger.warn('[OCR] OCR processing failed', {
      filePath,
      error: error.message,
      errorCode: error.code
    });
    return '';
  } finally {
    // Explicit cleanup
    pdfBuffer = null;
    rasterPng = null;
  }
}

async function extractTextFromDoc(filePath) {
  try {
    const signature = await readFileSignature(filePath, 8);
    if (isZipFile(signature)) {
      logger.warn('[DOC] File appears to be DOCX container, routing to DOCX extractor');
      return await extractTextFromDocx(filePath);
    }
    if (!isOleCompoundFile(signature)) {
      logger.warn('[DOC] Unsupported/binary DOC file detected, skipping parse', {
        filePath
      });
      return '';
    }
    const officeParser = require('officeparser');
    const result = await parseOfficeFile(officeParser, filePath);
    return result || '';
  } catch (error) {
    logger.warn('[DOC] Office parser failed, returning empty result', {
      error: error.message
    });
    return '';
  }
}

async function extractTextFromDocx(filePath) {
  const mammoth = require('mammoth');
  // Fixed: Check file size before reading
  await checkFileSize(filePath, filePath);

  const signature = await readFileSignature(filePath, 8);
  if (isOleCompoundFile(signature)) {
    logger.warn('[DOCX] File appears to be legacy DOC, routing to DOC extractor');
    return await extractTextFromDoc(filePath);
  }
  if (!isZipFile(signature)) {
    const invalidDocx = new Error('Invalid DOCX container signature');
    invalidDocx.code = 'INVALID_DOCX';
    throw invalidDocx;
  }

  try {
    try {
      const result = await mammoth.extractRawText({ path: filePath });
      if (!result.value || result.value.trim().length === 0)
        throw new Error('No text content in DOCX');

      // Fixed: Truncate result to prevent memory issues
      return truncateText(result.value);
    } catch (error) {
      logger.warn('[DOCX] Mammoth extraction failed, trying officeparser fallback', {
        error: error.message,
        filePath
      });

      try {
        // Fallback: officeparser
        const officeParser = require('officeparser');
        const result = await parseOfficeFile(officeParser, filePath);
        const text = typeof result === 'string' ? result : (result && result.text) || '';

        if (!text || text.trim().length === 0) {
          throw new Error('No text content in DOCX (fallback)');
        }
        return truncateText(text);
      } catch (fallbackError) {
        logger.error('[DOCX] All extraction methods failed', {
          mammothError: error.message,
          fallbackError: fallbackError.message
        });
        // Throw the original error to preserve context
        throw error;
      }
    }
  } catch (error) {
    logger.warn('[DOCX] Mammoth extraction failed, trying officeparser fallback', {
      error: error.message,
      filePath
    });

    try {
      // Fallback: officeparser
      const officeParser = require('officeparser');
      const result = await parseOfficeFile(officeParser, filePath);
      const text = typeof result === 'string' ? result : (result && result.text) || '';

      if (!text || text.trim().length === 0) {
        throw new Error('No text content in DOCX (fallback)');
      }
      return truncateText(text);
    } catch (fallbackError) {
      logger.error('[DOCX] All extraction methods failed', {
        mammothError: error.message,
        fallbackError: fallbackError.message
      });
      // Throw the original error to preserve context
      throw error;
    }
  }
}

async function extractTextFromXlsx(filePath) {
  const XLSX = require('xlsx-populate');
  const officeParser = require('officeparser');
  // Fixed: Check file size before loading workbook
  await checkFileSize(filePath, filePath);

  let workbook = null;
  let allText = '';
  let primaryMethodFailed = false;

  try {
    workbook = await XLSX.fromFileAsync(filePath);

    // CRITICAL FIX: Validate workbook structure
    if (!workbook || typeof workbook.sheets !== 'function') {
      throw new Error('Invalid workbook structure: sheets() method not available');
    }

    const sheets = workbook.sheets();
    if (!Array.isArray(sheets) || sheets.length === 0) {
      throw new Error('No sheets found in XLSX file');
    }

    let totalRows = 0;

    for (const sheet of sheets) {
      try {
        // CRITICAL FIX: Add null checks and validate usedRange structure
        if (!sheet || typeof sheet.usedRange !== 'function') {
          logger.warn('[XLSX] Sheet missing usedRange method, skipping', {
            sheetName: sheet?.name() || 'unknown'
          });
          continue;
        }

        const usedRange = sheet.usedRange();
        if (!usedRange) {
          logger.debug('[XLSX] Sheet has no used range, skipping', {
            sheetName: sheet?.name() || 'unknown'
          });
          continue;
        }

        // CRITICAL FIX: Validate that value() method exists and returns valid data
        if (typeof usedRange.value !== 'function') {
          logger.warn('[XLSX] usedRange missing value() method, trying alternative extraction', {
            sheetName: sheet?.name() || 'unknown'
          });

          // Fallback: Try to extract cell values manually
          try {
            const startCell = usedRange.startCell();
            const endCell = usedRange.endCell();
            if (startCell && endCell) {
              const startRow = startCell.rowNumber();
              const endRow = endCell.rowNumber();
              const startCol = startCell.columnNumber();
              const endCol = endCell.columnNumber();

              for (let row = startRow; row <= endRow && totalRows < MAX_XLSX_ROWS; row++) {
                const rowData = [];
                for (let col = startCol; col <= endCol; col++) {
                  try {
                    const cell = sheet.cell(row, col);
                    if (cell) {
                      const cellValue = cell.value();
                      if (cellValue !== null && cellValue !== undefined) {
                        rowData.push(String(cellValue));
                      }
                    }
                  } catch (cellError) {
                    // Skip individual cell errors
                    logger.debug('[XLSX] Cell read error', { error: cellError.message, row, col });
                  }
                }
                if (rowData.length > 0) {
                  allText += `${rowData.join(' ')}\n`;
                  totalRows++;
                }
              }
            }
          } catch (fallbackError) {
            logger.warn('[XLSX] Fallback extraction failed', {
              error: fallbackError.message,
              sheetName: sheet?.name() || 'unknown'
            });
          }
          continue;
        }

        const values = usedRange.value();
        if (!Array.isArray(values)) {
          logger.warn('[XLSX] usedRange.value() did not return array', {
            sheetName: sheet?.name() || 'unknown',
            valueType: typeof values
          });
          continue;
        }

        // Fixed: Limit rows to prevent memory exhaustion
        const rowsToProcess = Math.min(values.length, MAX_XLSX_ROWS);
        if (values.length > MAX_XLSX_ROWS) {
          logger.warn('[XLSX] Sheet row limit applied', {
            totalRows: values.length,
            limit: MAX_XLSX_ROWS
          });
        }

        for (let i = 0; i < rowsToProcess; i++) {
          const row = values[i];
          if (Array.isArray(row)) {
            allText += `${row
              .filter((cell) => cell !== null && cell !== undefined)
              .map((cell) => String(cell))
              .join(' ')}\n`;
            totalRows++;

            // Fixed: Check text length periodically to prevent runaway memory
            if (totalRows % 1000 === 0 && allText.length > MAX_TEXT_LENGTH) {
              allText = truncateText(allText);
              break;
            }
          } else if (row && typeof row === 'object' && !Array.isArray(row)) {
            // Handle object rows (e.g., { columnA: 'value1', columnB: 'value2' })
            const objectValues = Object.values(row)
              .filter((cell) => cell !== null && cell !== undefined)
              .map((cell) => String(cell));
            if (objectValues.length > 0) {
              allText += `${objectValues.join(' ')}\n`;
              totalRows++;
            }
          } else if (row !== null && row !== undefined) {
            // Handle scalar rows (single value)
            allText += `${String(row)}\n`;
            totalRows++;
          }
        }

        if (allText.length > MAX_TEXT_LENGTH) break;
      } catch (sheetError) {
        // Log sheet-level errors but continue processing other sheets
        logger.warn('[XLSX] Error processing sheet', {
          error: sheetError.message,
          sheetName: sheet?.name() || 'unknown'
        });
        continue;
      }
    }
  } catch (primaryError) {
    logger.warn('[XLSX] Primary extraction failed', { error: primaryError.message });
    primaryMethodFailed = true;
  } finally {
    // Explicit cleanup
    workbook = null;
  }

  allText = allText.trim();
  if (!allText) {
    // CRITICAL FIX: Try fallback extraction using officeParser before giving up
    try {
      logger.info(
        primaryMethodFailed
          ? '[XLSX] Trying fallback after primary failure'
          : '[XLSX] Primary extraction returned no text, trying officeParser fallback'
      );
      const fallbackResult = await parseOfficeFile(officeParser, filePath);
      const fallbackText =
        typeof fallbackResult === 'string'
          ? fallbackResult
          : (fallbackResult && fallbackResult.text) || '';
      if (fallbackText && fallbackText.trim()) {
        return truncateText(fallbackText);
      }
    } catch (fallbackError) {
      logger.warn('[XLSX] Fallback extraction also failed', {
        error: fallbackError.message
      });
    }

    const errorMsg = primaryMethodFailed ? 'XLSX extraction failed' : 'No text content in XLSX';
    if (primaryMethodFailed) {
      logger.error('[XLSX] Extraction failed', { filePath, error: errorMsg });
    }

    throw new FileProcessingError('XLSX_EXTRACTION_FAILURE', filePath, {
      originalError: errorMsg,
      suggestion: 'XLSX file may be corrupted, password-protected, or in an unsupported format'
    });
  }

  // Fixed: Truncate final result
  return truncateText(allText);
}

async function extractTextFromPptx(filePath) {
  const officeParser = require('officeparser');
  const AdmZip = require('adm-zip');
  // Fixed: Check file size before reading
  await checkFileSize(filePath, filePath);

  let text = '';
  let primaryMethodFailed = false;

  try {
    // CRITICAL FIX: Add better error handling for officeParser
    const result = await parseOfficeFile(officeParser, filePath);

    // CRITICAL FIX: Validate result structure
    if (result === null || result === undefined) {
      throw new Error('officeParser returned null or undefined');
    }

    // Extract text from various possible result structures
    if (typeof result === 'string') {
      text = result;
    } else if (result && typeof result === 'object') {
      // Try common property names
      const rawVal = result.text || result.content || result.body;
      text = rawVal !== null && rawVal !== undefined ? String(rawVal) : '';

      // If still empty, try to stringify the object (might contain structured data)
      if (!text && Object.keys(result).length > 0) {
        try {
          text = JSON.stringify(result)
            .replace(REGEX_PATTERNS.jsonPunctuation, ' ')
            .replace(REGEX_PATTERNS.whitespace, ' ')
            .trim();
        } catch (stringifyError) {
          logger.debug('[PPTX] JSON stringify failed', { error: stringifyError.message });
          // If stringification fails, try extracting values
          text = Object.values(result)
            .filter((v) => typeof v === 'string' && v.trim())
            .join(' ');
        }
      }
    }
  } catch (primaryError) {
    logger.warn('[PPTX] Primary extraction failed, trying fallback', {
      error: primaryError.message,
      filePath
    });
    primaryMethodFailed = true;
  }

  if (!text || text.trim().length === 0) {
    // CRITICAL FIX: Try alternative extraction method before giving up
    logger.warn(
      primaryMethodFailed
        ? '[PPTX] Trying ZIP-based extraction after primary failure'
        : '[PPTX] Primary extraction returned no text, trying ZIP-based extraction'
    );
    try {
      const zip = new AdmZip(filePath);
      const entries = zip.getEntries();
      let extractedText = '';

      // Extract text from slide XML files
      for (const entry of entries) {
        const name = entry.entryName.toLowerCase();
        if (name.startsWith('ppt/slides/slide') && name.endsWith('.xml')) {
          try {
            const xmlContent = entry.getData().toString('utf8');
            // Extract text from XML (simple tag stripping)
            const slideText = extractPlainTextFromHtml(xmlContent);
            if (slideText && slideText.trim()) {
              extractedText += `${slideText}\n`;
            }

            // Limit processing to prevent memory issues
            if (extractedText.length > MAX_TEXT_LENGTH) {
              break;
            }
          } catch (entryError) {
            // Skip individual entry errors
            logger.debug('[PPTX] Error processing slide entry', {
              entry: name,
              error: entryError.message
            });
          }
        }
      }

      if (extractedText && extractedText.trim()) {
        return truncateText(extractedText);
      }
    } catch (zipError) {
      logger.warn('[PPTX] ZIP-based extraction failed', {
        error: zipError.message
      });
    }

    // If we reach here, both methods failed or returned empty
    const errorMsg = primaryMethodFailed ? 'PPTX extraction failed' : 'No text content in PPTX';

    // Only log error if primary failed too, otherwise it's just empty content
    if (primaryMethodFailed) {
      logger.error('[PPTX] Extraction failed', { filePath, error: errorMsg });
    }

    // Re-throw as FileProcessingError for consistent error handling
    throw new FileProcessingError('PPTX_EXTRACTION_FAILURE', filePath, {
      originalError: errorMsg,
      suggestion: 'PPTX file may be corrupted, password-protected, or in an unsupported format'
    });
  }

  // Fixed: Truncate result to prevent memory issues
  return truncateText(text);
}

function extractPlainTextFromRtf(rtf) {
  try {
    const decoded = rtf.replace(REGEX_PATTERNS.rtfHexEscape, (_, hex) => {
      try {
        return String.fromCharCode(parseInt(hex, 16));
      } catch (hexError) {
        logger.debug('[RTF] Hex decode error', { hex, error: hexError.message });
        return '';
      }
    });
    const noGroups = decoded.replace(REGEX_PATTERNS.rtfBraces, '');
    // Fixed: RTF control words start with backslash, not bracket
    const noControls = noGroups.replace(REGEX_PATTERNS.rtfControlWords, '');
    return noControls.replace(REGEX_PATTERNS.whitespace, ' ').trim();
  } catch (error) {
    logger.debug('[RTF] Extraction failed', { error: error.message });
    return rtf;
  }
}

function extractPlainTextFromHtml(html) {
  try {
    const withoutScripts = html.replace(REGEX_PATTERNS.scriptTags, '');
    const withoutStyles = withoutScripts.replace(REGEX_PATTERNS.styleTags, '');
    const withoutTags = withoutStyles.replace(REGEX_PATTERNS.htmlTags, ' ');
    const entitiesDecoded = withoutTags
      .replace(REGEX_PATTERNS.nbspEntity, ' ')
      .replace(REGEX_PATTERNS.ampEntity, '&')
      .replace(REGEX_PATTERNS.ltEntity, '<')
      .replace(REGEX_PATTERNS.gtEntity, '>')
      .replace(REGEX_PATTERNS.quotEntity, '"')
      .replace(REGEX_PATTERNS.aposEntity, "'");
    return entitiesDecoded.replace(REGEX_PATTERNS.whitespace, ' ').trim();
  } catch (error) {
    logger.debug('[HTML] Plain text extraction failed', { error: error.message });
    return html;
  }
}

// Generic ODF extractor: reads content.xml from ZIP and strips tags
async function extractTextFromOdfZip(filePath) {
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(filePath);
  const entry = zip.getEntry('content.xml');
  if (!entry) return '';
  const xml = entry.getData().toString('utf8');
  return extractPlainTextFromHtml(xml);
}

async function extractTextFromEpub(filePath) {
  const AdmZip = require('adm-zip');
  // Fixed: Check file size before processing
  await checkFileSize(filePath, filePath);

  let zip = null;
  try {
    zip = new AdmZip(filePath);
    const entries = zip.getEntries();
    let text = '';
    let processedEntries = 0;

    for (const e of entries) {
      const name = e.entryName.toLowerCase();
      if (name.endsWith('.xhtml') || name.endsWith('.html') || name.endsWith('.htm')) {
        try {
          const html = e.getData().toString('utf8');
          text += `${extractPlainTextFromHtml(html)}\n`;
          processedEntries++;

          // Fixed: Limit number of entries and text length
          if (processedEntries >= 100 || text.length > MAX_TEXT_LENGTH) {
            text = truncateText(text);
            break;
          }
        } catch (error) {
          // Expected: Skip corrupt entries in archive
          logger.debug('Skipping corrupt archive entry', {
            error: error.message
          });
        }
      }
    }

    const result = text.trim();
    zip = null; // Explicit cleanup
    return truncateText(result);
  } finally {
    zip = null;
  }
}

async function extractTextFromEml(filePath) {
  // Fixed: Check file size before reading
  await checkFileSize(filePath, filePath);

  const raw = await fs.readFile(filePath, 'utf8');
  const parts = raw.split(REGEX_PATTERNS.doubleNewline);
  const headers = parts[0] || '';
  const body = parts.slice(1).join('\n\n');
  const subject = (headers.match(REGEX_PATTERNS.subjectHeader) || [])[1] || '';
  const from = (headers.match(REGEX_PATTERNS.fromHeader) || [])[1] || '';
  const to = (headers.match(REGEX_PATTERNS.toHeader) || [])[1] || '';

  // Fixed: Truncate result to prevent memory issues
  return truncateText([subject, from, to, body].filter(Boolean).join('\n'));
}

async function extractTextFromMsg(filePath) {
  const officeParser = require('officeparser');
  // Best-effort using officeparser; if unavailable, return empty string
  try {
    const result = await parseOfficeFile(officeParser, filePath);
    const text = typeof result === 'string' ? result : (result && result.text) || '';
    return text || '';
  } catch (error) {
    logger.debug('[MSG] Extraction failed', { error: error.message });
    return '';
  }
}

async function extractTextFromKml(filePath) {
  const xml = await fs.readFile(filePath, 'utf8');
  return extractPlainTextFromHtml(xml);
}

async function extractTextFromKmz(filePath) {
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(filePath);
  const kmlEntry =
    zip.getEntry('doc.kml') ||
    zip.getEntries().find((e) => e.entryName.toLowerCase().endsWith('.kml'));
  if (!kmlEntry) return '';
  const xml = kmlEntry.getData().toString('utf8');
  return extractPlainTextFromHtml(xml);
}

async function extractTextFromXls(filePath) {
  const officeParser = require('officeparser');
  try {
    const result = await parseOfficeFile(officeParser, filePath);
    const text = typeof result === 'string' ? result : (result && result.text) || '';
    if (text && text.trim()) return text;
  } catch (error) {
    logger.debug('[XLS] Extraction failed', { error: error.message });
    // Fallback to empty string on parse failure
  }
  return '';
}

async function extractTextFromPpt(filePath) {
  const officeParser = require('officeparser');
  try {
    const result = await parseOfficeFile(officeParser, filePath);
    const text = typeof result === 'string' ? result : (result && result.text) || '';
    return text || '';
  } catch (error) {
    logger.debug('[PPT] Extraction failed', { error: error.message });
    return '';
  }
}

/**
 * Chunk text for downstream analysis with optional overlap.
 * Keeps total output under a configurable limit to avoid LLM truncation.
 * @param {string} text - Normalized text to chunk
 * @param {Object} options
 * @param {number} [options.chunkSize=4000] - Target chunk size in characters
 * @param {number} [options.overlap=400] - Overlap between chunks in characters
 * @param {number} [options.maxTotalLength=16000] - Max combined length to return
 * @returns {{chunks: string[], combined: string}}
 */
function chunkTextForAnalysis(
  text,
  { chunkSize = 4000, overlap = 400, maxTotalLength = 16000 } = {}
) {
  if (!text || typeof text !== 'string') {
    return { chunks: [], combined: '' };
  }

  const safeChunkSize = Math.max(500, chunkSize);
  const safeOverlap = Math.min(Math.max(0, overlap), Math.floor(safeChunkSize / 2));

  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + safeChunkSize, text.length);
    chunks.push(text.slice(start, end));
    if (end === text.length) break;
    start = end - safeOverlap;
  }

  // Combine chunks until reaching the maxTotalLength budget
  const combined = [];
  let remaining = Math.max(1000, maxTotalLength);
  for (const chunk of chunks) {
    if (remaining <= 0) break;
    const slice = chunk.slice(0, remaining);
    combined.push(slice);
    remaining -= slice.length;
  }

  return {
    chunks,
    combined: combined.join('\n\n---\n\n')
  };
}

// FIX P3-2: Timeout-wrapped extraction functions to prevent indefinite hangs
// These wrappers ensure extraction operations don't block the pipeline forever

/**
 * Extract text from PDF with timeout protection
 * @param {string} filePath - Path to PDF file
 * @param {string} fileName - Name of file for error messages
 * @returns {Promise<string>} Extracted text
 */
async function extractTextFromPdfWithTimeout(filePath, fileName) {
  return withTimeout(
    extractTextFromPdf(filePath, fileName),
    EXTRACTION_TIMEOUTS.PDF,
    `PDF extraction: ${fileName || filePath}`
  );
}

/**
 * OCR PDF with timeout protection
 * @param {string} filePath - Path to PDF file
 * @returns {Promise<string>} OCR text
 */
async function ocrPdfWithTimeout(filePath) {
  return withTimeout(ocrPdfIfNeeded(filePath), EXTRACTION_TIMEOUTS.OCR, `OCR: ${filePath}`);
}

/**
 * Extract text from DOCX with timeout protection
 * @param {string} filePath - Path to DOCX file
 * @returns {Promise<string>} Extracted text
 */
async function extractTextFromDocxWithTimeout(filePath) {
  return withTimeout(
    extractTextFromDocx(filePath),
    EXTRACTION_TIMEOUTS.DOCX,
    `DOCX extraction: ${filePath}`
  );
}

/**
 * Extract text from XLSX with timeout protection
 * @param {string} filePath - Path to XLSX file
 * @returns {Promise<string>} Extracted text
 */
async function extractTextFromXlsxWithTimeout(filePath) {
  return withTimeout(
    extractTextFromXlsx(filePath),
    EXTRACTION_TIMEOUTS.XLSX,
    `XLSX extraction: ${filePath}`
  );
}

/**
 * Extract text from PPTX with timeout protection
 * @param {string} filePath - Path to PPTX file
 * @returns {Promise<string>} Extracted text
 */
async function extractTextFromPptxWithTimeout(filePath) {
  return withTimeout(
    extractTextFromPptx(filePath),
    EXTRACTION_TIMEOUTS.PPTX,
    `PPTX extraction: ${filePath}`
  );
}

module.exports = {
  // FIX P3-2: Export timeout-wrapped versions as primary exports
  // These prevent extraction operations from hanging indefinitely
  extractTextFromPdf: extractTextFromPdfWithTimeout,
  ocrPdfIfNeeded: ocrPdfWithTimeout,
  extractTextFromDocx: extractTextFromDocxWithTimeout,
  extractTextFromXlsx: extractTextFromXlsxWithTimeout,
  extractTextFromPptx: extractTextFromPptxWithTimeout,
  // Also export original versions for cases where caller manages timeout
  extractTextFromPdfRaw: extractTextFromPdf,
  ocrPdfIfNeededRaw: ocrPdfIfNeeded,
  extractTextFromDocxRaw: extractTextFromDocx,
  extractTextFromXlsxRaw: extractTextFromXlsx,
  extractTextFromPptxRaw: extractTextFromPptx,
  // Other extractors (typically faster, less prone to hanging)
  extractTextFromDoc,
  extractTextFromXls,
  extractTextFromPpt,
  extractTextFromOdfZip,
  extractTextFromEpub,
  extractTextFromEml,
  extractTextFromMsg,
  extractTextFromKml,
  extractTextFromKmz,
  extractTextFromCsv,
  extractPlainTextFromXml,
  extractPlainTextFromRtf,
  extractPlainTextFromHtml,
  // MED-4: Streaming support for large files
  extractContentWithSizeCheck,
  extractContentStreaming,
  extractContentBuffered,
  chunkTextForAnalysis,
  // Export timeout constants for callers who need custom timeouts
  EXTRACTION_TIMEOUTS
};
