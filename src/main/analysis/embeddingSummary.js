const { capEmbeddingInput } = require('../utils/embeddingInput');
const { enrichFileTextForEmbedding } = require('./semanticExtensionMap');

function buildEmbeddingSummary(analysis, extractedText = '', fileExtension, type = 'document') {
  const safeAnalysis = analysis && typeof analysis === 'object' ? analysis : {};
  const rawType = typeof safeAnalysis.type === 'string' ? safeAnalysis.type.trim() : '';
  const isGenericType = ['image', 'document', 'file', 'unknown'].includes(rawType.toLowerCase());
  const documentType = safeAnalysis.documentType || (!isGenericType && rawType ? rawType : '');
  const documentDate = safeAnalysis.documentDate || safeAnalysis.date || '';
  const keywords = Array.isArray(safeAnalysis.keywords) ? safeAnalysis.keywords.join(' ') : '';

  const baseParts = [
    safeAnalysis.summary,
    safeAnalysis.purpose,
    safeAnalysis.project,
    safeAnalysis.entity,
    documentType,
    documentDate,
    safeAnalysis.reasoning,
    safeAnalysis.subject,
    safeAnalysis.suggestedName,
    keywords
  ];

  if (type === 'image') {
    baseParts.push(safeAnalysis.content_type || safeAnalysis.contentType || '');
  }

  const baseText = baseParts.filter(Boolean).join('\n');
  const safeExtension = typeof fileExtension === 'string' ? fileExtension : '';
  const enrichedBase = enrichFileTextForEmbedding(baseText, safeExtension);

  // Add extracted text snippet to improve recall for short summaries.
  const textSnippet = extractedText ? extractedText.slice(0, 2000) : '';
  const combined = [enrichedBase, textSnippet].filter(Boolean).join('\n');

  return capEmbeddingInput(combined);
}

module.exports = {
  buildEmbeddingSummary
};
