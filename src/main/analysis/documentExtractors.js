const fs = require('fs').promises;

// Lazy loaded modules
// const pdf = require('pdf-parse');
// const sharp = require('sharp');
// const tesseract = require('node-tesseract-ocr');
// const mammoth = require('mammoth');
// const officeParser = require('officeparser');
// const XLSX = require('xlsx-populate');
// const AdmZip = require('adm-zip');

const { FileProcessingError } = require('../errors/AnalysisError');
const { logger } = require('../../shared/logger');
logger.setContext('DocumentExtractors');

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
  const pdf = require('pdf-parse');
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
  const sharp = require('sharp');
  const tesseract = require('node-tesseract-ocr');
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
  const mammoth = require('mammoth');
  try {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value || '';
  } catch {
    return await fs.readFile(filePath, 'utf8');
  }
}

async function extractTextFromDocx(filePath) {
  const mammoth = require('mammoth');
  // Fixed: Check file size before reading
  await checkFileSize(filePath, filePath);

  const result = await mammoth.extractRawText({ path: filePath });
  if (!result.value || result.value.trim().length === 0)
    throw new Error('No text content in DOCX');

  // Fixed: Truncate result to prevent memory issues
  return truncateText(result.value);
}

async function extractTextFromXlsx(filePath) {
  const XLSX = require('xlsx-populate');
  const officeParser = require('officeparser');
  // Fixed: Check file size before loading workbook
  await checkFileSize(filePath, filePath);

  let workbook = null;
  try {
    workbook = await XLSX.fromFileAsync(filePath);

    // CRITICAL FIX: Validate workbook structure
    if (!workbook || typeof workbook.sheets !== 'function') {
      throw new Error(
        'Invalid workbook structure: sheets() method not available',
      );
    }

    const sheets = workbook.sheets();
    if (!Array.isArray(sheets) || sheets.length === 0) {
      throw new Error('No sheets found in XLSX file');
    }

    let allText = '';
    let totalRows = 0;

    for (const sheet of sheets) {
      try {
        // CRITICAL FIX: Add null checks and validate usedRange structure
        if (!sheet || typeof sheet.usedRange !== 'function') {
          logger.warn('[XLSX] Sheet missing usedRange method, skipping', {
            sheetName: sheet?.name() || 'unknown',
          });
          continue;
        }

        const usedRange = sheet.usedRange();
        if (!usedRange) {
          logger.debug('[XLSX] Sheet has no used range, skipping', {
            sheetName: sheet?.name() || 'unknown',
          });
          continue;
        }

        // CRITICAL FIX: Validate that value() method exists and returns valid data
        if (typeof usedRange.value !== 'function') {
          logger.warn(
            '[XLSX] usedRange missing value() method, trying alternative extraction',
            {
              sheetName: sheet?.name() || 'unknown',
            },
          );

          // Fallback: Try to extract cell values manually
          try {
            const startCell = usedRange.startCell();
            const endCell = usedRange.endCell();
            if (startCell && endCell) {
              const startRow = startCell.rowNumber();
              const endRow = endCell.rowNumber();
              const startCol = startCell.columnNumber();
              const endCol = endCell.columnNumber();

              for (
                let row = startRow;
                row <= endRow && totalRows < MAX_XLSX_ROWS;
                row++
              ) {
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
                  }
                }
                if (rowData.length > 0) {
                  allText += rowData.join(' ') + '\n';
                  totalRows++;
                }
              }
            }
          } catch (fallbackError) {
            logger.warn('[XLSX] Fallback extraction failed', {
              error: fallbackError.message,
              sheetName: sheet?.name() || 'unknown',
            });
          }
          continue;
        }

        const values = usedRange.value();
        if (!Array.isArray(values)) {
          logger.warn('[XLSX] usedRange.value() did not return array', {
            sheetName: sheet?.name() || 'unknown',
            valueType: typeof values,
          });
          continue;
        }

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
                .map((cell) => String(cell))
                .join(' ') + '\n';
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
              allText += objectValues.join(' ') + '\n';
              totalRows++;
            }
          } else if (row !== null && row !== undefined) {
            // Handle scalar rows (single value)
            allText += String(row) + '\n';
            totalRows++;
          }
        }

        if (allText.length > MAX_TEXT_LENGTH) break;
      } catch (sheetError) {
        // Log sheet-level errors but continue processing other sheets
        logger.warn('[XLSX] Error processing sheet', {
          error: sheetError.message,
          sheetName: sheet?.name() || 'unknown',
        });
        continue;
      }
    }

    allText = allText.trim();
    if (!allText) {
      // CRITICAL FIX: Try fallback extraction using officeParser before giving up
      try {
        logger.info(
          '[XLSX] Primary extraction failed, trying officeParser fallback',
        );
        const fallbackResult = await officeParser.parseOfficeAsync(filePath);
        const fallbackText =
          typeof fallbackResult === 'string'
            ? fallbackResult
            : (fallbackResult && fallbackResult.text) || '';
        if (fallbackText && fallbackText.trim()) {
          return truncateText(fallbackText);
        }
      } catch (fallbackError) {
        logger.warn('[XLSX] Fallback extraction also failed', {
          error: fallbackError.message,
        });
      }
      throw new Error('No text content in XLSX');
    }

    // Fixed: Truncate final result and clean up workbook
    const result = truncateText(allText);
    workbook = null;
    return result;
  } catch (error) {
    // CRITICAL FIX: Provide detailed error information
    const errorMessage = error.message || 'Unknown XLSX extraction error';
    logger.error('[XLSX] Extraction failed', {
      filePath,
      error: errorMessage,
      errorStack: error.stack,
    });
    throw new FileProcessingError('XLSX_EXTRACTION_FAILURE', filePath, {
      originalError: errorMessage,
      suggestion:
        'XLSX file may be corrupted, password-protected, or in an unsupported format',
    });
  } finally {
    // Explicit cleanup
    workbook = null;
  }
}

async function extractTextFromPptx(filePath) {
  const officeParser = require('officeparser');
  const AdmZip = require('adm-zip');
  // Fixed: Check file size before reading
  await checkFileSize(filePath, filePath);

  try {
    // CRITICAL FIX: Add better error handling for officeParser
    const result = await officeParser.parseOfficeAsync(filePath);

    // CRITICAL FIX: Validate result structure
    if (!result) {
      throw new Error('officeParser returned null or undefined');
    }

    // Extract text from various possible result structures
    let text = '';
    if (typeof result === 'string') {
      text = result;
    } else if (result && typeof result === 'object') {
      // Try common property names
      text = result.text || result.content || result.body || '';

      // If still empty, try to stringify the object (might contain structured data)
      if (!text && Object.keys(result).length > 0) {
        try {
          text = JSON.stringify(result)
            // eslint-disable-next-line no-useless-escape
            .replace(/[{}":,\[\]]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        } catch {
          // If stringification fails, try extracting values
          text = Object.values(result)
            .filter((v) => typeof v === 'string' && v.trim())
            .join(' ');
        }
      }
    }

    if (!text || text.trim().length === 0) {
      // CRITICAL FIX: Try alternative extraction method before giving up
      logger.warn(
        '[PPTX] Primary extraction returned no text, trying ZIP-based extraction',
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
                extractedText += slideText + '\n';
              }

              // Limit processing to prevent memory issues
              if (extractedText.length > MAX_TEXT_LENGTH) {
                break;
              }
            } catch (entryError) {
              // Skip individual entry errors
              logger.debug('[PPTX] Error processing slide entry', {
                entry: name,
                error: entryError.message,
              });
            }
          }
        }

        if (extractedText && extractedText.trim()) {
          return truncateText(extractedText);
        }
      } catch (zipError) {
        logger.warn('[PPTX] ZIP-based extraction failed', {
          error: zipError.message,
        });
      }

      throw new Error('No text content in PPTX');
    }

    // Fixed: Truncate result to prevent memory issues
    return truncateText(text);
  } catch (error) {
    // CRITICAL FIX: Provide detailed error information
    const errorMessage = error.message || 'Unknown PPTX extraction error';
    logger.error('[PPTX] Extraction failed', {
      filePath,
      error: errorMessage,
      errorStack: error.stack,
    });

    // Re-throw as FileProcessingError for consistent error handling
    throw new FileProcessingError('PPTX_EXTRACTION_FAILURE', filePath, {
      originalError: errorMessage,
      suggestion:
        'PPTX file may be corrupted, password-protected, or in an unsupported format',
    });
  }
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
    // Fixed: RTF control words start with backslash, not bracket
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
  const officeParser = require('officeparser');
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
  const officeParser = require('officeparser');
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
