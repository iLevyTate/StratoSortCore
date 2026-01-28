function normalizeAnalysisResult(raw, fallback = {}) {
  const result = raw && typeof raw === 'object' ? { ...raw } : {};
  const rawType = typeof result.type === 'string' ? result.type.trim() : '';
  const isGenericType = ['image', 'document', 'file', 'unknown'].includes(rawType.toLowerCase());
  const normalized = {
    category:
      typeof result.category === 'string' && result.category.trim()
        ? result.category
        : fallback.category || 'document',
    keywords: Array.isArray(result.keywords) ? result.keywords : fallback.keywords || [],
    confidence:
      typeof result.confidence === 'number' ? result.confidence : fallback.confidence || 0,
    suggestedName:
      typeof result.suggestedName === 'string'
        ? result.suggestedName
        : fallback.suggestedName || null,
    extractionMethod: result.extractionMethod || fallback.extractionMethod || null,
    contentLength:
      typeof result.contentLength === 'number'
        ? result.contentLength
        : fallback.contentLength || null,
    documentType:
      typeof result.documentType === 'string' && result.documentType.trim()
        ? result.documentType
        : rawType && !isGenericType
          ? rawType
          : fallback.documentType || null,
    documentDate:
      typeof result.documentDate === 'string' && result.documentDate.trim()
        ? result.documentDate
        : typeof result.date === 'string' && result.date.trim()
          ? result.date
          : fallback.documentDate || null
  };
  return { ...result, ...normalized };
}

module.exports = { normalizeAnalysisResult };
