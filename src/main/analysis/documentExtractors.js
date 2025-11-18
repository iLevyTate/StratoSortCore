const fs = require('fs').promises;
const pdf = require('pdf-parse');
const sharp = require('sharp');
const tesseract = require('node-tesseract-ocr');
const mammoth = require('mammoth');
const officeParser = require('officeparser');
const XLSX = require('xlsx-populate');
const AdmZip = require('adm-zip');

const { FileProcessingError } = require('../errors/AnalysisError');
const { logger } = require('../../shared/logger');

// Memory management constants
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB max file size
const MAX_TEXT_LENGTH = 500000; // 500k characters max output
const MAX_XLSX_ROWS = 10000; // Limit spreadsheet rows to prevent memory issues

/**
 * Check file size and enforce memory limits
 * @param {string} filePath - Path to file
 * @param {string} fileName - Name of file for error messages
 * @throws {FileProcessingError} If file exceeds size limit
 */
async function checkFileSize(filePath, fileName) {
  try {
    const stats = await fs.stat(filePath);
    if (stats.size > MAX_FILE_SIZE) {
      throw new FileProcessingError('FILE_TOO_LARGE', fileName, {
        suggestion: `File size ${(stats.size / 1024 / 1024).toFixed(1)}MB exceeds limit of ${MAX_FILE_SIZE / 1024 / 1024}MB`,
        fileSize: stats.size,
        maxSize: MAX_FILE_SIZE,
      });
    }
    return stats.size;
  } catch (error) {
    if (error.code === 'FILE_TOO_LARGE') throw error;
    throw new FileProcessingError('FILE_READ_ERROR', fileName, {
      suggestion: error.message,
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
  return (
    text.substring(0, MAX_TEXT_LENGTH) + '\n\n[Text truncated due to length]'
  );
}

async function extractTextFromPdf(filePath, fileName) {
  // Fixed: Check file size before loading into memory
  await checkFileSize(filePath, fileName);

  let dataBuffer = null;
  try {
    dataBuffer = await fs.readFile(filePath);
    const pdfData = await pdf(dataBuffer);

    if (!pdfData.text || pdfData.text.trim().length === 0) {
      throw new FileProcessingError('PDF_NO_TEXT_CONTENT', fileName, {
        suggestion: 'PDF may be image-based or corrupted',
      });
    }

    // Fixed: Truncate text to prevent memory issues and clean up buffer
    const result = truncateText(pdfData.text);
    dataBuffer = null; // Explicit cleanup to help GC
    return result;
  } finally {
    // Ensure buffer is dereferenced even on error
    dataBuffer = null;
  }
}

async function ocrPdfIfNeeded(filePath) {
  let pdfBuffer = null;
  let rasterPng = null;
  try {
    // Fixed: Check file size before OCR processing (OCR is very memory intensive)
    const stats = await fs.stat(filePath);
    // OCR has stricter limits due to image processing overhead
    if (stats.size > 50 * 1024 * 1024) {
      // 50MB limit for OCR
      return '';
    }

    pdfBuffer = await fs.readFile(filePath);
    rasterPng = await sharp(pdfBuffer, { density: 200 }).png().toBuffer();

    // Clear PDF buffer before OCR to reduce peak memory
    pdfBuffer = null;

    const ocrText = await tesseract.recognize(rasterPng, {
      lang: 'eng',
      oem: 1,
      psm: 3,
    });

    // Fixed: Truncate OCR results and clean up
    const result =
      ocrText && ocrText.trim().length > 0 ? truncateText(ocrText) : '';
    rasterPng = null;
    return result;
  } catch {
    return '';
  } finally {
    // Explicit cleanup
    pdfBuffer = null;
    rasterPng = null;
  }
}

async function extractTextFromDoc(filePath) {
  try {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value || '';
  } catch {
    return await fs.readFile(filePath, 'utf8');
  }
}

async function extractTextFromDocx(filePath) {
  // Fixed: Check file size before reading
  await checkFileSize(filePath, filePath);

  const result = await mammoth.extractRawText({ path: filePath });
  if (!result.value || result.value.trim().length === 0)
    throw new Error('No text content in DOCX');

  // Fixed: Truncate result to prevent memory issues
  return truncateText(result.value);
}

async function extractTextFromXlsx(filePath) {
  // Fixed: Check file size before loading workbook
  await checkFileSize(filePath, filePath);

  let workbook = null;
  try {
    workbook = await XLSX.fromFileAsync(filePath);
    const sheets = workbook.sheets();
    let allText = '';
    let totalRows = 0;

    for (const sheet of sheets) {
      const usedRange = sheet.usedRange();
      if (usedRange) {
        const values = usedRange.value();
        if (Array.isArray(values)) {
          // Fixed: Limit rows to prevent memory exhaustion
          const rowsToProcess = Math.min(values.length, MAX_XLSX_ROWS);
          if (values.length > MAX_XLSX_ROWS) {
            logger.warn('[XLSX] Sheet row limit applied', {
              totalRows: values.length,
              limit: MAX_XLSX_ROWS,
            });
          }

          for (let i = 0; i < rowsToProcess; i++) {
            const row = values[i];
            if (Array.isArray(row)) {
              allText +=
                row
                  .filter((cell) => cell !== null && cell !== undefined)
                  .join(' ') + '\n';
              totalRows++;

              // Fixed: Check text length periodically to prevent runaway memory
              if (totalRows % 1000 === 0 && allText.length > MAX_TEXT_LENGTH) {
                allText = truncateText(allText);
                break;
              }
            }
          }

          if (allText.length > MAX_TEXT_LENGTH) break;
        }
      }
    }

    allText = allText.trim();
    if (!allText) throw new Error('No text content in XLSX');

    // Fixed: Truncate final result and clean up workbook
    const result = truncateText(allText);
    workbook = null;
    return result;
  } finally {
    // Explicit cleanup
    workbook = null;
  }
}

async function extractTextFromPptx(filePath) {
  // Fixed: Check file size before reading
  await checkFileSize(filePath, filePath);

  const result = await officeParser.parseOfficeAsync(filePath);
  const text =
    typeof result === 'string' ? result : (result && result.text) || '';
  if (!text || text.trim().length === 0)
    throw new Error('No text content in PPTX');

  // Fixed: Truncate result to prevent memory issues
  return truncateText(text);
}

function extractPlainTextFromRtf(rtf) {
  try {
    const decoded = rtf.replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => {
      try {
        return String.fromCharCode(parseInt(hex, 16));
      } catch {
        return '';
      }
    });
    const noGroups = decoded.replace(/[{}]/g, '');
    const noControls = noGroups.replace(/\\[a-zA-Z]+-?\d* ?/g, '');
    return noControls.replace(/\s+/g, ' ').trim();
  } catch {
    return rtf;
  }
}

function extractPlainTextFromHtml(html) {
  try {
    const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gi, '');
    const withoutStyles = withoutScripts.replace(
      /<style[\s\S]*?<\/style>/gi,
      '',
    );
    const withoutTags = withoutStyles.replace(/<[^>]+>/g, ' ');
    const entitiesDecoded = withoutTags
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'");
    return entitiesDecoded.replace(/\s+/g, ' ').trim();
  } catch {
    return html;
  }
}

// Generic ODF extractor: reads content.xml from ZIP and strips tags
async function extractTextFromOdfZip(filePath) {
  const zip = new AdmZip(filePath);
  const entry = zip.getEntry('content.xml');
  if (!entry) return '';
  const xml = entry.getData().toString('utf8');
  return extractPlainTextFromHtml(xml);
}

async function extractTextFromEpub(filePath) {
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
      if (
        name.endsWith('.xhtml') ||
        name.endsWith('.html') ||
        name.endsWith('.htm')
      ) {
        try {
          const html = e.getData().toString('utf8');
          text += extractPlainTextFromHtml(html) + '\n';
          processedEntries++;

          // Fixed: Limit number of entries and text length
          if (processedEntries >= 100 || text.length > MAX_TEXT_LENGTH) {
            text = truncateText(text);
            break;
          }
        } catch {
          // Silently ignore corrupt entries in archive
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
  const parts = raw.split(/\r?\n\r?\n/);
  const headers = parts[0] || '';
  const body = parts.slice(1).join('\n\n');
  const subject = (headers.match(/^Subject:\s*(.*)$/im) || [])[1] || '';
  const from = (headers.match(/^From:\s*(.*)$/im) || [])[1] || '';
  const to = (headers.match(/^To:\s*(.*)$/im) || [])[1] || '';

  // Fixed: Truncate result to prevent memory issues
  return truncateText([subject, from, to, body].filter(Boolean).join('\n'));
}

async function extractTextFromMsg(filePath) {
  // Best-effort using officeparser; if unavailable, return empty string
  try {
    const result = await officeParser.parseOfficeAsync(filePath);
    const text =
      typeof result === 'string' ? result : (result && result.text) || '';
    return text || '';
  } catch {
    return '';
  }
}

async function extractTextFromKml(filePath) {
  const xml = await fs.readFile(filePath, 'utf8');
  return extractPlainTextFromHtml(xml);
}

async function extractTextFromKmz(filePath) {
  const zip = new AdmZip(filePath);
  const kmlEntry =
    zip.getEntry('doc.kml') ||
    zip.getEntries().find((e) => e.entryName.toLowerCase().endsWith('.kml'));
  if (!kmlEntry) return '';
  const xml = kmlEntry.getData().toString('utf8');
  return extractPlainTextFromHtml(xml);
}

async function extractTextFromXls(filePath) {
  try {
    const result = await officeParser.parseOfficeAsync(filePath);
    const text =
      typeof result === 'string' ? result : (result && result.text) || '';
    if (text && text.trim()) return text;
  } catch {
    // Fallback to empty string on parse failure
  }
  return '';
}

async function extractTextFromPpt(filePath) {
  try {
    const result = await officeParser.parseOfficeAsync(filePath);
    const text =
      typeof result === 'string' ? result : (result && result.text) || '';
    return text || '';
  } catch {
    return '';
  }
}

module.exports = {
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
  extractPlainTextFromHtml,
};
