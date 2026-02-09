/**
 * Smart Content Selection for Document Analysis
 *
 * Replaces naive linear truncation with intelligent sampling that covers
 * the entire document within a fixed character budget.
 *
 * Strategy for documents exceeding the budget:
 *   1. Extract a structural outline from headings  (~5% of budget)
 *   2. Take the beginning of the document           (~37% of body)
 *   3. Sample evenly-spaced passages from the middle (~47% of body)
 *   4. Take the end of the document                  (~16% of body)
 *
 * This ensures the LLM sees representative content from every part of
 * the document, dramatically improving classification accuracy for long
 * documents with zero additional LLM inference cost.
 *
 * @module analysis/contentSelector
 */

const { CONTENT_SELECTION } = require('../../shared/performanceConstants');
const { createLogger } = require('../../shared/logger');

const logger = createLogger('ContentSelector');

// ---------------------------------------------------------------------------
// Heading patterns for outline extraction (ordered by reliability)
// ---------------------------------------------------------------------------

const HEADING_PATTERNS = [
  // Markdown headings: # Heading, ## Subheading, etc.
  /^#{1,6}\s+.+$/gm,
  // HTML headings: <h1>Heading</h1>
  /<h[1-6][^>]*>(.*?)<\/h[1-6]>/gim,
  // Chapter / Section / Part labels: CHAPTER 1, SECTION IV, PART THREE
  /^(?:CHAPTER|SECTION|PART)\s+[\dIVXLCDM]+.{0,80}$/gim,
  // Numbered headings: 1.2.3 Some Heading
  /^\d+(?:\.\d+)*\s+[A-Z].{2,80}$/gm,
  // ALL CAPS lines (likely headings in PDFs / legal docs, min 4 chars)
  /^[A-Z][A-Z0-9 :.\x2D]{3,60}$/gm
];

// Maximum headings to extract (prevents runaway on heavily-structured docs)
const MAX_HEADINGS = 25;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Lightweight text cleaning that preserves paragraph structure.
 *
 * Unlike `cleanTextContent` (from textNormalization.js) which collapses
 * all whitespace to single spaces, this keeps double-newlines intact
 * so paragraph boundaries can be detected for strategic sampling.
 *
 * @param {string} text - Raw extracted text
 * @returns {string} Cleaned text with paragraph boundaries preserved
 */
function lightClean(text) {
  if (!text) return '';
  let result = String(text);

  // Remove null bytes (cause issues with JSON / DB storage)
  // eslint-disable-next-line no-control-regex
  result = result.replace(/\u0000/g, '');

  // Normalize line endings to \n
  result = result.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Collapse horizontal whitespace (tabs, form-feeds, vertical tabs) to space
  // eslint-disable-next-line no-control-regex
  result = result.replace(/[\t\x0B\f]+/g, ' ');

  // Collapse 3+ consecutive newlines to double-newline (preserve paragraph breaks)
  result = result.replace(/\n{3,}/g, '\n\n');

  // Collapse runs of multiple spaces to single space
  result = result.replace(/ {2,}/g, ' ');

  // Trim trailing whitespace per line
  result = result.replace(/ +$/gm, '');

  return result.trim();
}

/**
 * Find the nearest paragraph or line boundary to a position.
 *
 * Searches within a radius for the closest `\n\n` (paragraph break).
 * Falls back to `\n` (line break), then to the exact position.
 *
 * @param {string} text - Full document text
 * @param {number} position - Target position to snap
 * @param {number} [radius=300] - Search radius in characters
 * @returns {number} Snapped position (start of next paragraph/line)
 */
function snapToParagraphBoundary(text, position, radius = 300) {
  const searchStart = Math.max(0, position - radius);
  const searchEnd = Math.min(text.length, position + radius);
  const region = text.slice(searchStart, searchEnd);
  const center = position - searchStart;

  let bestOffset = -1;
  let bestDistance = Infinity;

  // Prefer paragraph boundary (\n\n) — start reading after the break
  let idx = -1;
  while ((idx = region.indexOf('\n\n', idx + 1)) !== -1) {
    const candidateOffset = idx + 2;
    const distance = Math.abs(candidateOffset - center);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestOffset = candidateOffset;
    }
  }

  // Fallback: line boundary (\n)
  if (bestOffset === -1) {
    idx = -1;
    while ((idx = region.indexOf('\n', idx + 1)) !== -1) {
      const candidateOffset = idx + 1;
      const distance = Math.abs(candidateOffset - center);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestOffset = candidateOffset;
      }
    }
  }

  // Fallback: exact position
  if (bestOffset === -1) {
    bestOffset = center;
  }

  return searchStart + bestOffset;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract a structural outline from document headings.
 *
 * Scans the full text for heading patterns (Markdown, HTML, numbered,
 * ALL-CAPS) and returns a compact outline within the given budget.
 *
 * @param {string} text - Full document text
 * @param {number} maxLength - Maximum characters for the outline
 * @returns {string} Compact outline string, or empty if no headings found
 */
function extractDocumentOutline(text, maxLength) {
  if (!text || maxLength <= 0) return '';

  const seen = new Set();
  const headings = [];

  for (const pattern of HEADING_PATTERNS) {
    // Clone the regex to avoid mutating the shared pattern's lastIndex
    const re = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = re.exec(text)) !== null) {
      // Use capture group 1 if present (HTML patterns), else full match
      let heading = (match[1] || match[0]).trim();

      // Strip residual HTML tags and Markdown #
      heading = heading
        .replace(/<[^>]+>/g, '')
        .replace(/^#+\s*/, '')
        .trim();

      if (heading.length < 3 || heading.length > 80) continue;

      // Deduplicate (case-insensitive)
      const key = heading.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      headings.push(heading);

      if (headings.length >= MAX_HEADINGS) break;
    }
    if (headings.length >= MAX_HEADINGS) break;
  }

  if (headings.length === 0) return '';

  // Assemble outline within budget
  const lines = [];
  let remaining = maxLength;
  for (const heading of headings) {
    const line = `- ${heading}`;
    if (remaining - line.length - 1 < 0) break; // -1 for newline separator
    lines.push(line);
    remaining -= line.length + 1;
  }

  return lines.join('\n');
}

/**
 * Sample evenly-spaced passages from the middle of a document.
 *
 * Snaps sample start positions to paragraph boundaries for coherence,
 * ensuring the LLM receives complete paragraphs rather than mid-sentence
 * fragments.
 *
 * @param {string} text - Full document text
 * @param {number} startOffset - Start of the middle region (after head)
 * @param {number} endOffset - End of the middle region (before tail)
 * @param {number} budget - Total character budget for all middle samples
 * @param {number} [sampleCount] - Number of samples (defaults to CONTENT_SELECTION.MIDDLE_SAMPLE_COUNT)
 * @returns {string[]} Array of text samples
 */
function sampleMiddleContent(text, startOffset, endOffset, budget, sampleCount) {
  const count = sampleCount ?? CONTENT_SELECTION.MIDDLE_SAMPLE_COUNT;
  const regionLength = endOffset - startOffset;

  if (regionLength <= 0 || budget <= 0 || count <= 0) return [];

  // If the middle region fits in the budget, return it all
  if (regionLength <= budget) {
    return [text.slice(startOffset, endOffset)];
  }

  const sampleSize = Math.floor(budget / count);
  if (sampleSize < 50) return []; // Not enough budget per sample to be useful

  const step = Math.floor(regionLength / (count + 1));
  const samples = [];

  for (let i = 1; i <= count; i++) {
    const rawPosition = startOffset + step * i;
    const snapped = snapToParagraphBoundary(text, rawPosition);

    // Clamp to the middle region
    const sampleStart = Math.max(startOffset, Math.min(snapped, endOffset - sampleSize));
    const sampleEnd = Math.min(sampleStart + sampleSize, endOffset);
    const sample = text.slice(sampleStart, sampleEnd).trim();

    if (sample.length > 0) {
      samples.push(sample);
    }
  }

  return samples;
}

/**
 * Select representative content from a document to maximize information
 * density within a fixed character budget.
 *
 * For documents that fit within the budget, returns the full cleaned text.
 * For larger documents, strategically samples beginning, middle, and end
 * with a structural outline prepended.
 *
 * @param {string} text - Full extracted document text
 * @param {number} budget - Maximum character budget for the output
 * @returns {{ content: string, strategy: string, coveragePercent: number, totalLength: number }}
 */
function selectRepresentativeContent(text, budget) {
  if (!text) {
    return { content: '', strategy: 'empty', coveragePercent: 0, totalLength: 0 };
  }

  // Lightweight cleaning that preserves paragraph structure
  const cleaned = lightClean(text);
  const totalLength = cleaned.length;

  // If text fits within budget, return it all — no selection needed
  if (totalLength <= budget) {
    return {
      content: cleaned,
      strategy: 'full',
      coveragePercent: 100,
      totalLength
    };
  }

  // --- Smart Content Selection ---
  const { OUTLINE_RATIO, HEAD_RATIO, TAIL_RATIO, MIDDLE_SAMPLE_COUNT, MARKER_OVERHEAD } =
    CONTENT_SELECTION;

  // Step 1: Extract outline from the FULL text (before any truncation)
  const outlineBudget = Math.floor(budget * OUTLINE_RATIO);
  const outline = extractDocumentOutline(cleaned, outlineBudget);

  // Compute body budget (total minus outline and section markers)
  const outlineOverhead = outline.length > 0 ? outline.length + 20 : 0; // +20 for marker
  const bodyBudget = budget - outlineOverhead - MARKER_OVERHEAD;
  const headBudget = Math.floor(bodyBudget * HEAD_RATIO);
  const tailBudget = Math.floor(bodyBudget * TAIL_RATIO);
  const middleBudget = bodyBudget - headBudget - tailBudget;

  // Step 2: Head section (beginning of document)
  const head = cleaned.slice(0, headBudget);

  // Step 3: Tail section (end of document)
  const tail = cleaned.slice(-tailBudget);

  // Step 4: Middle samples (evenly spaced between head and tail regions)
  const middleStart = headBudget;
  const middleEnd = totalLength - tailBudget;
  const middleSamples = sampleMiddleContent(
    cleaned,
    middleStart,
    middleEnd,
    middleBudget,
    MIDDLE_SAMPLE_COUNT
  );

  // Step 5: Assemble with section markers
  const parts = [];
  if (outline) {
    parts.push(`[DOCUMENT OUTLINE]\n${outline}`);
  }
  parts.push(`[BEGINNING]\n${head}`);
  if (middleSamples.length > 0) {
    parts.push(`[MIDDLE SECTIONS]\n${middleSamples.join('\n---\n')}`);
  }
  parts.push(`[END]\n${tail}`);

  let content = parts.join('\n\n');

  // Hard cap — section markers may push slightly over budget
  if (content.length > budget) {
    content = content.slice(0, budget);
  }

  const coveragePercent = Math.min(100, Math.round((budget / totalLength) * 100));

  logger.debug('[ContentSelector] Smart selection applied', {
    totalLength,
    budget,
    coveragePercent,
    headChars: head.length,
    middleSamples: middleSamples.length,
    tailChars: tail.length,
    outlineChars: outline.length
  });

  return { content, strategy: 'representative', coveragePercent, totalLength };
}

module.exports = {
  selectRepresentativeContent,
  extractDocumentOutline,
  sampleMiddleContent
};
