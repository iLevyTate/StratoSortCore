/**
 * Utility functions for highlighting search matches in text
 */

// Constants for ReDoS protection
const MAX_QUERY_WORDS = 10;
const MAX_TEXT_LENGTH = 10000;

/**
 * Split text into segments with highlight information based on query matches
 * @param {string} text - Text to highlight
 * @param {string} query - Search query
 * @returns {Array<{text: string, highlight: boolean}>} Array of text segments
 */
export function highlightMatches(text, query) {
  if (!text || typeof text !== 'string') {
    return [{ text: text || '', highlight: false }];
  }

  if (!query || typeof query !== 'string' || query.length < 2) {
    return [{ text, highlight: false }];
  }

  // Truncate very long text to prevent performance issues
  const processText = text.length > MAX_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH) : text;

  // Split query into words, filter short words, limit count for ReDoS protection
  const words = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 2)
    .slice(0, MAX_QUERY_WORDS);

  if (words.length === 0) {
    return [{ text, highlight: false }];
  }

  // Escape regex special characters and create pattern
  const escapedWords = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const limitedWords = escapedWords.length > 50 ? escapedWords.slice(0, 50) : escapedWords;
  const patternStr = limitedWords.join('|');
  if (patternStr.length > 2000) return [{ text, highlight: false }];
  const pattern = new RegExp(`(${patternStr})`, 'gi');

  const segments = [];
  let lastIndex = 0;
  let match = pattern.exec(processText);

  while (match !== null) {
    // Add non-matching text before this match
    if (match.index > lastIndex) {
      segments.push({
        text: processText.slice(lastIndex, match.index),
        highlight: false
      });
    }
    // Add the matching text
    segments.push({
      text: match[0],
      highlight: true
    });
    lastIndex = pattern.lastIndex;
    // Safety guard: avoid infinite loops if a zero-length match ever occurs.
    if (match[0].length === 0) {
      pattern.lastIndex += 1;
    }
    match = pattern.exec(processText);
  }

  // Add remaining text after last match (use processText for consistency with truncation)
  if (lastIndex < processText.length) {
    segments.push({
      text: processText.slice(lastIndex),
      highlight: false
    });
  }

  return segments.length > 0 ? segments : [{ text: processText, highlight: false }];
}

/**
 * Check if text contains any matches for the query
 * @param {string} text - Text to check
 * @param {string} query - Search query
 * @returns {boolean} True if text contains matches
 */
export function hasMatches(text, query) {
  if (!text || !query || query.length < 2) return false;

  const words = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 2);

  if (words.length === 0) return false;

  const textLower = text.toLowerCase();
  return words.some((word) => textLower.includes(word));
}
