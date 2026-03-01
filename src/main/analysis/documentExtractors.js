const fs = require('fs').promises;
const { createReadStream } = require('fs');

const { FileProcessingError } = require('../errors/AnalysisError');
const { createLogger } = require('../../shared/logger');
const { LIMITS } = require('../../shared/constants');
const { getAnalysisLimits } = require('./analysisLimits');
const { withTimeout } = require('../../shared/promiseUtils');

const EXTRACTION_TIMEOUTS = {
  PDF: 120000, // 2 minutes for PDF (can be slow for large files)
  DOCX: 60000, // 1 minute for DOCX
  XLSX: 90000, // 1.5 minutes for XLSX (can be slow for large spreadsheets)
  PPTX: 90000, // 1.5 minutes for PPTX
  OCR: 180000, // 3 minutes for OCR (very slow operation)
  DEFAULT: 60000 // 1 minute default
};

// Previously, logger was referenced at line 25 but declared at line 32, causing a
// ReferenceError (Temporal Dead Zone) when fast-xml-parser was missing.
const logger = createLogger('DocumentExtractors');

let unpdfRenderer = null;
let unpdfRendererInit = null;
let sharpModule = null;
let sharpLoadAttempted = false;

function getSharp() {
  if (sharpLoadAttempted) return sharpModule;
  sharpLoadAttempted = true;
  try {
    sharpModule = require('sharp');
  } catch (error) {
    logger.warn('[OCR] sharp unavailable, image preprocessing disabled', {
      error: error.message
    });
    sharpModule = null;
  }
  return sharpModule;
}

function ensurePromiseResolversPolyfill() {
  if (typeof Promise.withResolvers === 'function') return;
  Promise.withResolvers = () => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

async function getUnpdfRenderer() {
  if (unpdfRenderer) return unpdfRenderer;
  if (unpdfRendererInit) return unpdfRendererInit;
  unpdfRendererInit = (async () => {
    let definePDFJSModule;
    let renderPageAsImage;
    let getDocumentProxy;
    try {
      ({ definePDFJSModule, renderPageAsImage, getDocumentProxy } = require('unpdf'));
    } catch (requireError) {
      try {
        const mod = await import('unpdf');
        definePDFJSModule = mod.definePDFJSModule || mod.default?.definePDFJSModule;
        renderPageAsImage = mod.renderPageAsImage || mod.default?.renderPageAsImage;
        getDocumentProxy = mod.getDocumentProxy || mod.default?.getDocumentProxy;
      } catch (importError) {
        logger.warn('[OCR] unpdf renderer unavailable', {
          error: importError.message || requireError.message
        });
        return null;
      }
    }

    if (typeof definePDFJSModule !== 'function' || typeof renderPageAsImage !== 'function') {
      logger.warn('[OCR] unpdf renderer APIs missing');
      return null;
    }

    // IMPORTANT:
    // Unpdf ships with a serverless PDF.js bundle where API and worker versions are aligned.
    // Forcing a custom pdfjs-dist build here can cause mismatches such as:
    // "API version X does not match Worker version Y" and break scanned-PDF OCR.
    // Default behavior uses unpdf's bundled PDF.js unless explicitly overridden.
    const useOfficialPdfjs = String(process.env.STRATOSORT_USE_OFFICIAL_PDFJS || '').toLowerCase();
    if (useOfficialPdfjs === 'true') {
      ensurePromiseResolversPolyfill();
      try {
        await definePDFJSModule(() => import('pdfjs-dist/legacy/build/pdf.mjs'));
      } catch (error) {
        logger.warn('[OCR] Failed to load official pdfjs-dist renderer', { error: error.message });
        return null;
      }
    }

    unpdfRenderer = { renderPageAsImage, getDocumentProxy };
    return unpdfRenderer;
  })();
  return unpdfRendererInit;
}

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
const { isTesseractAvailable, recognizeIfAvailable } = require('../utils/tesseractUtils');
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
 * Clean and normalize whitespace in extracted text
 * Preserves paragraph structure but removes excessive whitespace
 * @param {string} text - Text to clean
 * @returns {string} Cleaned text
 */
function cleanWhitespace(text) {
  if (!text) return '';
  // 1. Normalize line endings
  let cleaned = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // 2. Remove trailing whitespace on lines
  cleaned = cleaned.replace(/[ \t]+$/gm, '');
  // 3. Collapse multiple empty lines (3 or more newlines) into 2 newlines (one empty line)
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  // 4. Trim start/end
  return cleaned.trim();
}

/**
 * Check file size and enforce memory limits
 * Uses maxDocumentFileSize from settings when available
 * @param {string} filePath - Path to file
 * @param {string} fileName - Name of file for error messages
 * @param {number} [maxSizeOverride] - Optional override; when omitted, loads from settings
 * @throws {FileProcessingError} If file exceeds size limit
 */
async function checkFileSize(filePath, fileName, maxSizeOverride) {
  try {
    const stats = await fs.stat(filePath);
    let maxSize = maxSizeOverride;
    if (maxSize == null || !Number.isFinite(maxSize)) {
      const limits = await getAnalysisLimits();
      maxSize = limits.maxDocumentFileSize ?? LIMITS.MAX_FILE_SIZE;
    }
    if (stats.size > maxSize) {
      throw new FileProcessingError('FILE_TOO_LARGE', fileName, {
        suggestion: `File size ${(stats.size / 1024 / 1024).toFixed(1)}MB exceeds limit of ${(maxSize / 1024 / 1024).toFixed(1)}MB`,
        fileSize: stats.size,
        maxSize
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

    stream.on('error', (error) => {
      if (error.code === 'ERR_STREAM_PREMATURE_CLOSE' && totalLength >= MAX_CONTENT_LENGTH) {
        safeResolve(chunks.join(''));
      } else {
        safeReject(error);
      }
    });

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

  let dataBuffer;
  try {
    const rawBuffer = await fs.readFile(filePath);
    // Buffer is a Uint8Array subclass but pdf.js does a strict instanceof check.
    dataBuffer = new Uint8Array(rawBuffer.buffer, rawBuffer.byteOffset, rawBuffer.byteLength);
    let extractText;
    try {
      ({ extractText } = require('unpdf'));
    } catch {
      const mod = await import('unpdf');
      extractText = mod.extractText || mod.default?.extractText;
    }
    if (typeof extractText !== 'function') {
      throw new Error('unpdf extractText is unavailable');
    }
    const result = await extractText(dataBuffer);

    // unpdf may return text as a string or, in edge cases, as an array of page
    // strings.  Normalise to a single string so downstream .trim() never fails.
    let pdfText;
    const rawText = result?.text;
    if (typeof rawText === 'string') {
      pdfText = rawText;
    } else if (Array.isArray(rawText)) {
      pdfText = rawText.filter((p) => typeof p === 'string').join('\n');
    } else {
      pdfText = rawText != null ? String(rawText) : '';
    }

    if (!pdfText || pdfText.trim().length === 0) {
      throw new FileProcessingError('PDF_NO_TEXT_CONTENT', fileName, {
        suggestion: 'PDF may be image-based or corrupted'
      });
    }

    // Fixed: Truncate text to prevent memory issues and clean up buffer
    return truncateText(cleanWhitespace(pdfText));
  } catch (error) {
    if (error?.code === 'PDF_NO_TEXT_CONTENT') {
      logger.info('[PDF] No extractable text from PDF parser', { fileName });
    } else {
      logger.warn('[PDF] Extraction failed:', {
        fileName,
        error: error?.message
      });
    }
    throw error;
  } finally {
    // Ensure buffer is dereferenced even on error (intentional cleanup for GC)
    // eslint-disable-next-line no-useless-assignment -- cleanup before scope exit
    dataBuffer = null;
  }
}

async function ocrPdfIfNeeded(filePath) {
  let pdfBuffer;
  let rasterPng;

  // Cap density to 150 DPI (was 200) - still good for OCR, but reduces memory 44%
  // Add max dimensions to prevent huge images from 200+ page PDFs
  const OCR_DENSITY = 150; // DPI for rasterization
  const OCR_MAX_WIDTH = 2480; // ~A4 at 150 DPI
  const OCR_MAX_HEIGHT = 3508; // ~A4 at 150 DPI
  const OCR_MAX_FILE_SIZE = 30 * 1024 * 1024; // 30MB limit (reduced from 50MB)

  try {
    if (!(await isTesseractAvailable())) {
      logger.debug('[OCR] Skipping PDF OCR - tesseract unavailable');
      return '';
    }
    const sharp = getSharp();
    if (!sharp) {
      logger.debug('[OCR] Skipping PDF OCR preprocessing - sharp unavailable');
      return '';
    }

    // Fixed: Check file size before OCR processing (OCR is very memory intensive)
    const stats = await fs.stat(filePath);
    // OCR has stricter limits due to image processing overhead
    if (stats.size > OCR_MAX_FILE_SIZE) {
      logger.info('[OCR] Skipping OCR - file exceeds size limit', {
        filePath,
        fileSize: stats.size,
        maxSize: OCR_MAX_FILE_SIZE
      });
      return '';
    }

    pdfBuffer = await fs.readFile(filePath);

    // A 40MB PDF at 200 DPI could become 150MB+ PNG, causing OOM
    let sharpPipeline = sharp(pdfBuffer, { density: OCR_DENSITY });

    // Verify sharp can actually process this PDF (requires libvips PDF support).
    // Without poppler/pdfium compiled into libvips, sharp throws
    // "Input buffer contains unsupported image format".
    let metadata;
    try {
      metadata = await sharpPipeline.metadata();
    } catch (metaError) {
      logger.debug('[OCR] sharp cannot rasterise this PDF (libvips PDF support may be missing)', {
        filePath,
        error: metaError.message
      });
      const fallbackText = await ocrPdfWithCanvasRenderer(pdfBuffer, {
        lang: 'eng',
        oem: 1,
        psm: 3
      });
      if (fallbackText) {
        return fallbackText;
      }
      return '';
    }
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

    try {
      rasterPng = await sharpPipeline.png({ compressionLevel: 6 }).toBuffer();
    } catch (renderError) {
      logger.debug('[OCR] sharp rasterization failed, attempting canvas renderer fallback', {
        filePath,
        error: renderError.message
      });
      const fallbackText = await ocrPdfWithCanvasRenderer(pdfBuffer, {
        lang: 'eng',
        oem: 1,
        psm: 3
      });
      if (fallbackText) {
        return fallbackText;
      }
      return '';
    }

    // Clear PDF buffer before OCR to reduce peak memory
    pdfBuffer = null;

    const ocrResult = await recognizeIfAvailable(null, rasterPng, {
      lang: 'eng',
      oem: 1,
      psm: 3
    });
    if (!ocrResult.success) {
      return '';
    }
    const ocrText = ocrResult.text;

    // Fixed: Truncate OCR results and clean up
    const result = ocrText && ocrText.trim().length > 0 ? truncateText(ocrText) : '';
    rasterPng = null;
    return result;
  } catch (error) {
    logger.warn('[OCR] OCR processing failed', {
      filePath,
      error: error.message,
      errorCode: error.code
    });
    return '';
  } finally {
    // Explicit cleanup (intentional for GC)
    // eslint-disable-next-line no-useless-assignment -- cleanup before scope exit
    pdfBuffer = null;
    // eslint-disable-next-line no-useless-assignment -- cleanup before scope exit
    rasterPng = null;
  }
}

async function ocrPdfWithCanvasRenderer(pdfBuffer, options = {}) {
  if (!pdfBuffer || pdfBuffer.length === 0) return '';

  const renderer = await getUnpdfRenderer();
  if (!renderer) return '';

  let canvasModule;
  try {
    canvasModule = require('@napi-rs/canvas');
  } catch (error) {
    logger.warn('[OCR] @napi-rs/canvas unavailable, cannot render PDF pages for OCR', {
      error: error.message
    });
    return '';
  }

  const canvasImport = () => Promise.resolve(canvasModule);
  // Important: create a standalone copy (not a view over Node Buffer memory),
  // then reuse a PDFDocumentProxy where available so transfer/detach behavior
  // in PDF.js workers does not break page 2+ renders.
  const sourceData = Uint8Array.from(pdfBuffer);
  let pdfDoc = null;
  if (typeof renderer.getDocumentProxy === 'function') {
    try {
      pdfDoc = await renderer.getDocumentProxy(sourceData);
    } catch (error) {
      logger.debug(
        '[OCR] Failed to create shared PDF document proxy; using per-page data fallback',
        {
          error: error.message
        }
      );
      pdfDoc = null;
    }
  }
  const MAX_PAGES = 3;
  const SCALE = 1.5;

  let combinedText = '';
  try {
    for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber += 1) {
      try {
        const renderTarget = pdfDoc || Uint8Array.from(sourceData);
        const rendered = await renderer.renderPageAsImage(renderTarget, pageNumber, {
          canvasImport,
          scale: SCALE
        });
        const imageBuffer = Buffer.from(rendered);
        const ocrResult = await recognizeIfAvailable(null, imageBuffer, options);
        if (ocrResult.success && ocrResult.text && ocrResult.text.trim()) {
          combinedText += `${ocrResult.text.trim()}\n\n`;
        }
      } catch (error) {
        logger.debug('[OCR] PDF page render failed', {
          pageNumber,
          error: error.message
        });
      }
    }
  } finally {
    try {
      await pdfDoc?.destroy?.();
    } catch {
      // Ignore cleanup errors from PDF.js proxy teardown.
    }
  }

  const trimmed = combinedText.trim();
  if (!trimmed) return '';
  logger.info('[OCR] Successfully extracted text via PDF page renderer fallback');
  return truncateText(trimmed);
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
    logger.warn('[DOC] Office parser failed', { error: error.message });
    throw new FileProcessingError('DOC_EXTRACTION_FAILURE', filePath, {
      suggestion: 'DOC file may be corrupted or in an unsupported format',
      originalError: error.message
    });
  }
}

async function extractImagesFromOfficeArchiveAndOcr(filePath, mediaPathPrefix) {
  const AdmZip = require('adm-zip');
  const OCR_MAX_WIDTH = 2480; // ~A4 at 150 DPI
  const OCR_MAX_HEIGHT = 3508; // ~A4 at 150 DPI
  const OCR_MAX_BYTES = 20 * 1024 * 1024; // 20MB limit per image

  try {
    if (!(await isTesseractAvailable())) {
      logger.debug('[OFFICE-OCR] Skipping OCR - tesseract unavailable');
      return '';
    }
    const sharp = getSharp();
    if (!sharp) {
      logger.debug('[OFFICE-OCR] Skipping image preprocessing - sharp unavailable');
      return '';
    }

    const zip = new AdmZip(filePath);
    const zipEntries = zip.getEntries();
    let ocrText = '';
    let processedImages = 0;

    // Filter for image files in the specified media folder (e.g. 'word/media/' or 'ppt/media/')
    const imageEntries = zipEntries.filter(
      (entry) =>
        entry.entryName.startsWith(mediaPathPrefix) &&
        /\.(png|jpg|jpeg|tiff|bmp|gif|webp)$/i.test(entry.entryName)
    );

    if (imageEntries.length === 0) return '';

    logger.info(
      `[OFFICE-OCR] Found ${imageEntries.length} images in ${mediaPathPrefix}, attempting OCR`
    );

    for (const entry of imageEntries) {
      // Limit to first 10 images to prevent timeouts/memory issues
      if (processedImages >= 10) break;

      const buffer = entry.getData();
      if (!buffer || buffer.length === 0) {
        continue;
      }
      if (buffer.length > OCR_MAX_BYTES) {
        logger.debug('[OFFICE-OCR] Skipping large image', {
          entry: entry.entryName,
          size: buffer.length,
          maxBytes: OCR_MAX_BYTES
        });
        continue;
      }

      let ocrBuffer = buffer;
      try {
        let pipeline = sharp(buffer);
        const meta = await pipeline.metadata();
        if (meta.width > OCR_MAX_WIDTH || meta.height > OCR_MAX_HEIGHT) {
          pipeline = pipeline.resize(OCR_MAX_WIDTH, OCR_MAX_HEIGHT, {
            fit: 'inside',
            withoutEnlargement: true
          });
        }
        ocrBuffer = await pipeline.png({ compressionLevel: 6 }).toBuffer();
      } catch (prepError) {
        logger.debug('[OFFICE-OCR] Image preprocessing failed, using original buffer', {
          entry: entry.entryName,
          error: prepError.message
        });
      }
      const ocrResult = await recognizeIfAvailable(null, ocrBuffer, {
        lang: 'eng',
        oem: 1,
        psm: 3
      });
      if (!ocrResult.success) {
        logger.debug('[OFFICE-OCR] OCR failed for image', {
          entry: entry.entryName,
          error: ocrResult.error
        });
        continue;
      }
      if (ocrResult.success && ocrResult.text && ocrResult.text.trim()) {
        ocrText += `${ocrResult.text.trim()}\n\n`;
        processedImages++;
      }
    }

    return ocrText.trim();
  } catch (error) {
    logger.warn('[OFFICE-OCR] Failed to extract/OCR images from office archive', {
      error: error.message
    });
    return '';
  }
}

async function extractTextFromDocxXml(filePath) {
  try {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(filePath);
    if (!zip || typeof zip.getEntries !== 'function') {
      logger.debug('[DOCX] Zip reader unavailable, skipping XML extraction');
      return '';
    }
    const entries = zip.getEntries();
    if (!entries || entries.length === 0) return '';

    const xmlEntries = entries.filter((entry) => {
      const name = entry.entryName.toLowerCase();
      return (
        name === 'word/document.xml' ||
        name.startsWith('word/header') ||
        name.startsWith('word/footer')
      );
    });

    if (xmlEntries.length === 0) return '';

    const chunks = [];
    for (const entry of xmlEntries) {
      try {
        const xml = entry.getData()?.toString('utf8') || '';
        if (!xml) continue;
        const text = extractPlainTextFromXml(xml);
        if (text) {
          chunks.push(text);
        }
      } catch (error) {
        logger.debug('[DOCX] XML extraction failed for entry', {
          entry: entry.entryName,
          error: error.message
        });
      }
    }

    return truncateText(chunks.join('\n\n'));
  } catch (error) {
    logger.debug('[DOCX] XML extraction failed for archive', { error: error.message });
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
      return truncateText(cleanWhitespace(result.value));
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
          // Fallback 2: XML extraction from docx archive
          const xmlText = await extractTextFromDocxXml(filePath);
          if (xmlText && xmlText.length > 0) {
            return truncateText(cleanWhitespace(xmlText));
          }

          // Fallback 3: OCR for image-heavy documents
          logger.info('[DOCX] Text extraction failed, attempting OCR for embedded images');
          const ocrText = await extractImagesFromOfficeArchiveAndOcr(filePath, 'word/media/');
          if (ocrText && ocrText.length > 0) {
            return truncateText(cleanWhitespace(ocrText));
          }
          throw new Error('No text content in DOCX (fallback)', { cause: error });
        }
        return truncateText(cleanWhitespace(text));
      } catch (fallbackError) {
        // If we haven't tried OCR yet (because officeparser threw before checking text length), try it now
        if (fallbackError.message !== 'No text content in DOCX (fallback)') {
          const xmlText = await extractTextFromDocxXml(filePath);
          if (xmlText && xmlText.length > 0) {
            return truncateText(cleanWhitespace(xmlText));
          }

          logger.info('[DOCX] Officeparser failed, attempting OCR for embedded images');
          const ocrText = await extractImagesFromOfficeArchiveAndOcr(filePath, 'word/media/');
          if (ocrText && ocrText.length > 0) {
            return truncateText(cleanWhitespace(ocrText));
          }
        }

        logger.error('[DOCX] All extraction methods failed', {
          mammothError: error.message,
          fallbackError: fallbackError.message
        });
        // Throw the original error to preserve context
        throw error;
      }
    }
  } catch (error) {
    // This outer catch block seems redundant given the structure, but we'll keep it for safety
    // and add OCR check here too just in case
    try {
      const xmlText = await extractTextFromDocxXml(filePath);
      if (xmlText && xmlText.length > 0) {
        return truncateText(cleanWhitespace(xmlText));
      }

      const ocrText = await extractImagesFromOfficeArchiveAndOcr(filePath, 'word/media/');
      if (ocrText && ocrText.length > 0) {
        return truncateText(cleanWhitespace(ocrText));
      }
    } catch {
      // Ignore OCR error and throw original
    }

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
        // Fallback 2: OCR
        const ocrText = await extractImagesFromOfficeArchiveAndOcr(filePath, 'word/media/');
        if (ocrText && ocrText.length > 0) {
          return truncateText(cleanWhitespace(ocrText));
        }
        throw new Error('No text content in DOCX (fallback)', { cause: error });
      }
      return truncateText(cleanWhitespace(text));
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

  let workbook;
  let allText = '';
  let primaryMethodFailed = false;

  try {
    workbook = await XLSX.fromFileAsync(filePath);

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
    // Explicit cleanup (intentional for GC)
    // eslint-disable-next-line no-useless-assignment -- cleanup before scope exit
    workbook = null;
  }

  allText = allText.trim();
  if (!allText) {
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
  return truncateText(cleanWhitespace(allText));
}

async function extractTextFromPptx(filePath) {
  const officeParser = require('officeparser');
  const AdmZip = require('adm-zip');
  // Fixed: Check file size before reading
  await checkFileSize(filePath, filePath);

  let text = '';
  let primaryMethodFailed = false;

  try {
    const result = await parseOfficeFile(officeParser, filePath);

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
            const entryData = entry.getData();
            if (!entryData) {
              logger.debug('[PPTX] Entry getData() returned null', { entry: name });
              continue;
            }
            const xmlContent = entryData.toString('utf8');
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

    // Fallback 3: OCR for image-heavy presentations
    try {
      logger.info('[PPTX] Text extraction failed, attempting OCR for embedded images');
      const ocrText = await extractImagesFromOfficeArchiveAndOcr(filePath, 'ppt/media/');
      if (ocrText && ocrText.length > 0) {
        return truncateText(ocrText);
      }
    } catch (ocrError) {
      logger.warn('[PPTX] OCR fallback failed', { error: ocrError.message });
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
  return truncateText(cleanWhitespace(text));
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
  await checkFileSize(filePath, filePath);
  try {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(filePath);
    const entry = zip.getEntry('content.xml');
    if (!entry) return '';
    const data = entry.getData();
    if (!data) return '';
    const xml = data.toString('utf8');
    return extractPlainTextFromHtml(xml);
  } catch (error) {
    logger.error('Failed to extract ODF content:', { filePath, error: error.message });
    throw new FileProcessingError('ODF_EXTRACTION_FAILURE', filePath, {
      suggestion: 'ODF file may be corrupted or in an unsupported format',
      originalError: error.message
    });
  }
}

async function extractTextFromEpub(filePath) {
  const AdmZip = require('adm-zip');
  // Fixed: Check file size before processing
  await checkFileSize(filePath, filePath);

  let zip;
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
    return truncateText(result);
  } finally {
    // Explicit cleanup (intentional for GC)
    // eslint-disable-next-line no-useless-assignment -- cleanup before scope exit
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
  await checkFileSize(filePath, filePath);
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
  await checkFileSize(filePath, filePath);
  const xml = await fs.readFile(filePath, 'utf8');
  return extractPlainTextFromHtml(xml);
}

async function extractTextFromKmz(filePath) {
  await checkFileSize(filePath, filePath);
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
  // Streaming support for large files
  extractContentWithSizeCheck,
  extractContentStreaming,
  extractContentBuffered,
  chunkTextForAnalysis,
  cleanWhitespace,
  // Export timeout constants for callers who need custom timeouts
  EXTRACTION_TIMEOUTS
};
