/**
 * Extended Analysis Schema
 *
 * Defines the standard data structure for document analysis results.
 * This schema is used by the LLM prompt, the renaming service, and the indexing service
 * to ensure consistent data flow across the pipeline.
 *
 * @module shared/analysisSchema
 */

/**
 * @typedef {Object} ExtendedAnalysisResult
 * @property {string} [date] - The document's primary date (ISO YYYY-MM-DD)
 * @property {string} [entity] - The primary entity/sender/provider (e.g. "Amazon", "IRS", "John Doe")
 * @property {string} [type] - The specific document type (e.g. "Invoice", "Contract", "Bank Statement")
 * @property {string} [category] - The broader category (e.g. "Finance", "Legal", "Personal")
 * @property {string} [project] - The project or subject this relates to
 * @property {string} [summary] - A brief summary of the content (1-2 sentences)
 * @property {string[]} [keywords] - Key terms for search and filtering
 * @property {number} confidence - Confidence score (0-100)
 * @property {string} [suggestedName] - A suggested filename based on the content
 */

/**
 * The JSON schema definition used to guide the LLM's output.
 * We use a descriptive object structure that can be injected into prompts.
 */
const ANALYSIS_SCHEMA_PROMPT = {
  date: 'YYYY-MM-DD format. The primary date explicitly found in the document (invoice date, statement date, etc.). If NONE found, leave null.',
  entity:
    "The primary organization, person, or company responsible for the document (e.g., 'Amazon', 'Chase Bank', 'City of Seattle').",
  type: "The specific type of document (e.g., 'Invoice', 'Receipt', 'Contract', 'Meeting Notes', 'Tax Form').",
  category:
    'The high-level category (must match one of the provided Smart Folder names if applicable).',
  project: 'The specific project, case, or subject matter (2-5 words).',
  summary: "A concise 1-2 sentence summary of the document's content.",
  keywords: ['keyword1', 'keyword2', 'keyword3', 'keyword4', 'keyword5'],
  confidence: 'Number 0-100 indicating confidence in the extraction.',
  suggestedName:
    "A short, concise topic-based filename (max 3 words) using underscores (e.g., 'budget_report', 'sunset_beach', 'meeting_notes'). Do NOT include the extension."
};

/**
 * Default empty/fallback analysis result
 */
const DEFAULT_ANALYSIS_RESULT = {
  date: null,
  entity: null,
  type: 'Document',
  category: 'Uncategorized',
  project: null,
  summary: '',
  keywords: [],
  confidence: 0,
  suggestedName: null
};

module.exports = {
  ANALYSIS_SCHEMA_PROMPT,
  DEFAULT_ANALYSIS_RESULT
};
