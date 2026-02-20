/**
 * QueryProcessor - Intelligent Query Processing for Semantic Search
 *
 * Handles real-world user input with:
 * - Spell correction using Levenshtein distance
 * - Phonetic matching (Soundex) for badly misspelled words
 * - Lightweight synonym expansion via lemmatization
 * - Domain vocabulary that extends from user's indexed content
 *
 * @module services/QueryProcessor
 */

const winkNLP = require('wink-nlp');
const model = require('wink-eng-lite-web-model');
const its = require('wink-nlp/src/its.js');
const { distance } = require('fastest-levenshtein');
const { createLogger } = require('../../shared/logger');
const { LRUCache } = require('../../shared/LRUCache');
const { getInstance: getCacheInvalidationBus } = require('../../shared/cacheInvalidation');

const logger = createLogger('QueryProcessor');
/**
 * QueryProcessor handles spell correction, synonym expansion, and query normalization
 */
class QueryProcessor {
  constructor(options = {}) {
    this._nlp = null; // Lazy loaded
    this._nlpUnavailable = false;

    // Common English stop words that should NEVER be spell-corrected
    // These are function words that provide grammatical structure
    // Based on standard NLP libraries (NLTK, spaCy, Lucene)
    this.stopWords = new Set([
      // Articles
      'the',
      'a',
      'an',
      // Conjunctions
      'and',
      'or',
      'but',
      'yet',
      'nor',
      // Prepositions (common)
      'in',
      'on',
      'at',
      'to',
      'for',
      'of',
      'with',
      'by',
      'from',
      'as',
      'into',
      'onto',
      'upon',
      'about',
      'after',
      'before',
      'during',
      'through',
      'between',
      'among',
      'within',
      'without',
      'against',
      'across',
      'behind',
      'below',
      'above',
      'under',
      'over',
      'up',
      'down',
      'out',
      // Be verbs
      'is',
      'are',
      'was',
      'were',
      'be',
      'been',
      'being',
      'am',
      // Have verbs
      'have',
      'has',
      'had',
      'having',
      // Do verbs
      'do',
      'does',
      'did',
      'doing',
      // Modal verbs
      'will',
      'would',
      'should',
      'could',
      'may',
      'might',
      'can',
      'must',
      'shall',
      // Pronouns (subject)
      'i',
      'you',
      'he',
      'she',
      'it',
      'we',
      'they',
      // Pronouns (object)
      'me',
      'him',
      'her',
      'us',
      'them',
      // Possessive pronouns
      'my',
      'your',
      'his',
      'her',
      'its',
      'our',
      'their',
      // Demonstratives
      'this',
      'that',
      'these',
      'those',
      'such',
      // Question words
      'who',
      'whom',
      'whose',
      'what',
      'which',
      'where',
      'when',
      'why',
      'how',
      // Relative/subordinating
      'if',
      'then',
      'than',
      'like',
      // Determiners/quantifiers
      'all',
      'some',
      'any',
      'no',
      'not',
      'both',
      'each',
      'every',
      'few',
      'more',
      'most',
      'many',
      'much',
      'other',
      'another',
      // Adverbs (common function words)
      'very',
      'just',
      'only',
      'also',
      'too',
      'so',
      'now',
      'then',
      'here',
      'there'
    ]);

    // Pre-built domain vocabulary for file organization
    // This serves as the base vocabulary for spell correction
    this.domainWords = new Set([
      // File types
      'photo',
      'picture',
      'image',
      'document',
      'file',
      'folder',
      'video',
      'audio',
      'music',
      'movie',
      'screenshot',
      'scan',
      // Common categories
      'vacation',
      'holiday',
      'travel',
      'trip',
      'meeting',
      'notes',
      'invoice',
      'receipt',
      'tax',
      'report',
      'presentation',
      'budget',
      'contract',
      'resume',
      'letter',
      'spreadsheet',
      'project',
      'work',
      'personal',
      'family',
      'school',
      'medical',
      // Actions/descriptors
      'important',
      'urgent',
      'archive',
      'backup',
      'draft',
      'final',
      'old',
      'new',
      'recent',
      'download',
      'upload',
      'shared'
    ]);

    // Phonetic codes for badly misspelled words
    this.phoneticIndex = this._buildPhoneticIndex();

    // The previous Map-based approach had check-then-delete race when cache was full
    this.synonymCache = new LRUCache({
      maxSize: options.synonymCacheMaxSize || 500,
      ttlMs: 30 * 60 * 1000, // 30 minutes
      name: 'SynonymCache'
    });

    // Statistics
    this.stats = {
      queriesProcessed: 0,
      correctionsApplied: 0,
      synonymsAdded: 0,
      cacheHits: 0
    };

    // Cache invalidation bus subscription
    this._unsubscribe = null;
    this._subscribeToInvalidationBus();

    logger.info(
      '[QueryProcessor] Initialized:',
      this.domainWords.size,
      'domain words,',
      this.stopWords.size,
      'stop words'
    );
  }

  /**
   * Subscribe to the cache invalidation bus for coordinated cache clearing
   * @private
   */
  _subscribeToInvalidationBus() {
    try {
      const bus = getCacheInvalidationBus();
      this._unsubscribe = bus.subscribe('QueryProcessor', {
        onInvalidate: (event) => {
          // Clear synonym cache on full invalidation
          if (event.type === 'full-invalidate') {
            this.clearCache();
          }
        },
        // Note: QueryProcessor's synonym cache is not path-specific,
        // but we clear on batch changes to ensure consistency after major operations
        onBatch: () => {
          this.clearCache();
        }
      });
      logger.debug('[QueryProcessor] Subscribed to cache invalidation bus');
    } catch (error) {
      logger.warn('[QueryProcessor] Failed to subscribe to cache invalidation bus:', error.message);
    }
  }

  _getNlp() {
    if (this._nlp) return this._nlp;
    if (this._nlpUnavailable) return null;

    try {
      this._nlp = winkNLP(model);
      return this._nlp;
    } catch (error) {
      this._nlpUnavailable = true;
      logger.warn(
        '[QueryProcessor] wink-nlp unavailable; synonym expansion limited:',
        error.message
      );
      return null;
    }
  }

  /**
   * Extract potential filters from query (e.g. years)
   *
   * @param {string} query - Search query
   * @returns {Object} Extracted filters
   */
  extractFilters(query) {
    const filters = {};
    if (!query) return filters;

    // Extract years (1900-2099)
    // Matches 4 digits bounded by word boundaries
    const yearMatch = query.match(/\b(19|20)\d{2}\b/g);
    if (yearMatch) {
      // Use the last mentioned year as the primary filter intent
      filters.year = yearMatch[yearMatch.length - 1];
    }

    return filters;
  }

  /**
   * Process a search query with spell correction and synonym expansion
   *
   * @param {string} query - Raw user query
   * @param {Object} options - Processing options
   * @param {boolean} options.expandSynonyms - Whether to add synonyms (default: true)
   * @param {boolean} options.correctSpelling - Whether to correct typos (default: FALSE - disabled)
   * @param {number} options.maxSynonymsPerWord - Max synonyms per word (default: 3)
   * @returns {Promise<{original: string, expanded: string, corrections: Array, synonymsAdded: Array}>}
   */
  async processQuery(query, options = {}) {
    const { expandSynonyms = true, correctSpelling = false, maxSynonymsPerWord = 3 } = options;

    if (!query || typeof query !== 'string') {
      return {
        original: '',
        expanded: '',
        corrections: [],
        synonymsAdded: []
      };
    }

    this.stats.queriesProcessed++;
    const startTime = Date.now();

    // Tokenize query into words (preserve original for comparison)
    const words = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 1);
    const processed = [];
    const corrections = [];
    const synonymsAdded = [];

    for (const word of words) {
      let currentWord = word;

      // Step 1: Spell correction (typos)
      if (correctSpelling) {
        const corrected = this._correctSpelling(word);
        if (corrected !== word) {
          corrections.push({ original: word, corrected });
          this.stats.correctionsApplied++;
        }
        currentWord = corrected;
      }

      processed.push(currentWord);

      // Step 2: Add lemma variants (lightweight synonym expansion)
      if (expandSynonyms) {
        const synonyms = await this._getSynonyms(currentWord);
        const limitedSynonyms = synonyms.slice(0, maxSynonymsPerWord);
        for (const syn of limitedSynonyms) {
          if (!processed.includes(syn) && syn !== currentWord) {
            processed.push(syn);
            synonymsAdded.push({ word: currentWord, synonym: syn });
            this.stats.synonymsAdded++;
          }
        }
      }
    }

    const expanded = [...new Set(processed)].join(' ');

    logger.debug('[QueryProcessor] Query transformation:', {
      original: query,
      expanded,
      corrections,
      synonymsAdded: synonymsAdded.length,
      processingTimeMs: Date.now() - startTime
    });

    return {
      original: query,
      expanded,
      corrections,
      synonymsAdded
    };
  }

  /**
   * Correct spelling using Levenshtein distance and phonetic matching
   *
   * Strategy:
   * 1. NEVER correct stop words (common English function words)
   * 2. NEVER correct very short words (< 6 chars) - too risky
   * 3. Only correct if edit distance is 1 (single typo) to avoid false matches
   * 4. Only match against longer domain words (>= 5 chars) to avoid short word confusion
   * 5. Use phonetic matching only for longer words (8+ chars)
   *
   * @param {string} word - Word to correct
   * @returns {string} Corrected word or original if no correction found
   */
  _correctSpelling(word) {
    // Rule 1: NEVER correct stop words (they're valid English)
    // This check MUST happen first before any other logic
    if (this.stopWords.has(word.toLowerCase())) {
      return word;
    }

    // Rule 2: Already a known domain word? Return as-is
    if (this.domainWords.has(word.toLowerCase())) {
      return word;
    }

    // Rule 3: Short words (< 5 chars) are too risky to correct
    // They're usually valid abbreviations, acronyms, or common words
    // This prevents "are" -> "api", "that" -> "tax", "like" -> "file"
    if (word.length < 5) {
      return word;
    }

    // Find closest match using edit distance (Levenshtein)
    // ONLY consider corrections with 1 character difference (single typo)
    // ONLY match against longer domain words (>= 5 chars) to avoid contamination
    let bestMatch = word;

    for (const known of this.domainWords) {
      // Skip short domain words - they cause false matches
      if (known.length < 5) continue;

      // Quick length check to avoid unnecessary distance calculations
      // Only consider words within 1 character of length difference
      if (Math.abs(known.length - word.length) > 1) continue;

      const d = distance(word.toLowerCase(), known.toLowerCase());
      if (d === 1) {
        // Only accept single-character typos
        bestMatch = known;
        break; // Take first match to avoid over-correction
      }
    }

    // Rule 4: Only use phonetic matching for longer words where
    // the user might have made more severe spelling mistakes
    if (bestMatch === word && word.length >= 8) {
      const phoneticMatch = this._phoneticMatch(word);
      if (phoneticMatch) {
        bestMatch = phoneticMatch;
      }
    }

    return bestMatch;
  }

  /**
   * Get lightweight "synonyms" using wink-nlp lemmas
   *
   * @param {string} word - Word to find normalized variants for
   * @returns {Promise<string[]>} Array of variants
   */
  async _getSynonyms(word) {
    // This prevents race conditions in concurrent async lookups
    const cached = this.synonymCache.get(word);
    if (cached !== null) {
      this.stats.cacheHits++;
      return cached;
    }

    // Simple cache helper using LRUCache.set (handles size limits internally)
    const cacheSynonyms = (synonymArray) => {
      this.synonymCache.set(word, synonymArray);
    };

    try {
      const nlp = this._getNlp();
      if (!nlp) {
        const emptySynonyms = [];
        cacheSynonyms(emptySynonyms);
        return emptySynonyms;
      }

      const doc = nlp.readDoc(word);
      const lemma = doc.tokens().out(its.lemma)[0];
      const pos = doc.tokens().out(its.pos)[0];
      const synonyms = new Set();

      if (lemma && lemma !== word) {
        // Keep expansions conservative: only add lemma for content words
        if (['NOUN', 'VERB', 'ADJ', 'PROPN'].includes(pos)) {
          synonyms.add(lemma.toLowerCase());
        }
      }

      const synonymArray = Array.from(synonyms);

      // Cache the result (with size limit)
      cacheSynonyms(synonymArray);

      return synonymArray;
    } catch (error) {
      logger.debug('[QueryProcessor] Synonym lookup failed for:', word, error.message);
      const emptySynonyms = [];
      cacheSynonyms(emptySynonyms);
      return [];
    }
  }

  /**
   * Generate Soundex phonetic code for a word
   * Used for matching badly misspelled words by sound
   *
   * @param {string} word - Word to encode
   * @returns {string} Soundex code (e.g., "V250" for "vacation")
   */
  _soundex(word) {
    if (!word || word.length === 0) return '';

    const a = word.toLowerCase().split('');
    const codes = {
      b: 1,
      f: 1,
      p: 1,
      v: 1,
      c: 2,
      g: 2,
      j: 2,
      k: 2,
      q: 2,
      s: 2,
      x: 2,
      z: 2,
      d: 3,
      t: 3,
      l: 4,
      m: 5,
      n: 5,
      r: 6
    };

    // Keep first letter, encode remaining
    const firstLetter = a[0].toUpperCase();
    const encoded = a
      .slice(1)
      .map((c) => codes[c])
      .filter((v, i, arr) => v !== undefined && v !== arr[i - 1])
      .join('')
      .slice(0, 3)
      .padEnd(3, '0');

    return firstLetter + encoded;
  }

  /**
   * Build phonetic index from domain vocabulary
   * @returns {Map<string, string[]>}
   */
  _buildPhoneticIndex() {
    const index = new Map();
    for (const word of this.domainWords) {
      const code = this._soundex(word);
      if (!index.has(code)) index.set(code, []);
      index.get(code).push(word);
    }
    return index;
  }

  /**
   * Find phonetic match for a word
   *
   * @param {string} word - Word to match
   * @returns {string|null} Matched word or null
   */
  _phoneticMatch(word) {
    const code = this._soundex(word);
    const matches = this.phoneticIndex.get(code) || [];

    // If multiple matches, prefer the one with closest length
    if (matches.length > 1) {
      return matches.reduce((best, current) => {
        const bestDiff = Math.abs(best.length - word.length);
        const currentDiff = Math.abs(current.length - word.length);
        return currentDiff < bestDiff ? current : best;
      });
    }

    return matches[0] || null;
  }

  /**
   * Extend domain vocabulary from user's indexed content
   * This improves spell correction for domain-specific terms
   *
   * @param {Object} analysisHistory - Analysis history service
   * @param {number} maxEntries - Max entries to process (default: 1000)
   */
  async extendVocabulary(analysisHistory, maxEntries = 1000) {
    try {
      if (!analysisHistory?.getRecentAnalysis) {
        logger.debug('[QueryProcessor] No analysis history available for vocabulary extension');
        return;
      }

      const entries = await analysisHistory.getRecentAnalysis(maxEntries);
      if (!Array.isArray(entries)) return;

      const initialSize = this.domainWords.size;

      for (const entry of entries) {
        // Add tags (minimum 5 chars to avoid contaminating spell correction with short words)
        const tags = entry.analysis?.tags || [];
        for (const tag of tags) {
          if (typeof tag === 'string' && tag.length >= 5) {
            this.domainWords.add(tag.toLowerCase());
          }
        }

        // Add category (minimum 5 chars)
        const category = entry.analysis?.category;
        if (typeof category === 'string' && category.length >= 5) {
          this.domainWords.add(category.toLowerCase());
        }

        // Add subject words (split into individual words, minimum 5 chars)
        const subject = entry.analysis?.subject;
        if (typeof subject === 'string') {
          const subjectWords = subject.toLowerCase().split(/\s+/);
          for (const word of subjectWords) {
            if (word.length >= 5 && word.length < 20) {
              this.domainWords.add(word);
            }
          }
        }
      }

      // Rebuild phonetic index with new words
      this.phoneticIndex = this._buildPhoneticIndex();

      const addedWords = this.domainWords.size - initialSize;
      if (addedWords > 0) {
        logger.info(
          `[QueryProcessor] Vocabulary extended by ${addedWords} words from ${entries.length} entries`
        );
      }
    } catch (error) {
      logger.warn('[QueryProcessor] Failed to extend vocabulary:', error.message);
    }
  }

  /**
   * Get processing statistics
   * @returns {Object} Statistics object
   */
  getStats() {
    return {
      ...this.stats,
      vocabularySize: this.domainWords.size,
      synonymCacheSize: this.synonymCache.size
    };
  }

  /**
   * Clear synonym cache
   */
  clearCache() {
    this.synonymCache.clear();
    logger.debug('[QueryProcessor] Synonym cache cleared');
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    // Unsubscribe from cache invalidation bus
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
    this.synonymCache.clear();
    this._nlp = null;
    this._nlpUnavailable = false;
    logger.info('[QueryProcessor] Cleanup complete');
  }
}

// Use singleton factory to prevent race conditions in getInstance()
const { createSingletonHelpers } = require('../../shared/singletonFactory');

const { getInstance, resetInstance, registerWithContainer } = createSingletonHelpers({
  ServiceClass: QueryProcessor,
  serviceId: 'QUERY_PROCESSOR',
  serviceName: 'QueryProcessor',
  containerPath: './ServiceContainer',
  shutdownMethod: 'cleanup'
});

module.exports = {
  QueryProcessor,
  getInstance,
  resetInstance,
  registerWithContainer
};
