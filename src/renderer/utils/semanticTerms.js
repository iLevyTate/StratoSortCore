const SEMANTIC_STOPWORDS = new Set(
  [
    'a',
    'an',
    'and',
    'are',
    'as',
    'at',
    'be',
    'but',
    'by',
    'for',
    'from',
    'has',
    'have',
    'he',
    'her',
    'hers',
    'him',
    'his',
    'i',
    'if',
    'in',
    'into',
    'is',
    'it',
    'its',
    'me',
    'my',
    'no',
    'not',
    'of',
    'on',
    'or',
    'our',
    'ours',
    'she',
    'so',
    'that',
    'the',
    'their',
    'theirs',
    'them',
    'then',
    'there',
    'these',
    'they',
    'this',
    'those',
    'to',
    'too',
    'up',
    'us',
    'was',
    'we',
    'were',
    'what',
    'when',
    'where',
    'which',
    'who',
    'why',
    'with',
    'you',
    'your',
    'yours',
    'file',
    'files',
    'document',
    'documents',
    'image',
    'images',
    'photo',
    'photos',
    'report',
    'reports',
    'note',
    'notes',
    'draft',
    'final'
  ].map((term) => String(term).toLowerCase())
);

export const normalizeSemanticTerm = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');

export const isMeaningfulSemanticTerm = (term, { minLength = 2 } = {}) => {
  const normalized = normalizeSemanticTerm(term);
  if (!normalized || normalized.length < minLength) return false;
  if (/^\d+$/.test(normalized)) return false;
  if (SEMANTIC_STOPWORDS.has(normalized)) return false;
  return true;
};

export const sanitizeSemanticTerms = (terms, { maxTerms = Infinity, minLength = 2 } = {}) => {
  if (!Array.isArray(terms) || terms.length === 0) return [];

  const seen = new Set();
  const cleaned = [];
  for (const term of terms) {
    const normalized = normalizeSemanticTerm(term);
    if (!isMeaningfulSemanticTerm(normalized, { minLength })) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    cleaned.push(normalized);
    if (cleaned.length >= maxTerms) break;
  }

  return cleaned;
};

export default sanitizeSemanticTerms;
