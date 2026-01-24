/**
 * Organization Suggestion Service Module
 *
 * Composed module that provides the OrganizationSuggestionService.
 * Maintains backward compatibility with the original module.
 *
 * Structure:
 * - index.js - Main export with factory function
 * - OrganizationSuggestionServiceCore.js - Core service class (~350 lines)
 * - strategies.js - Strategy definitions and matching (~200 lines)
 * - patternMatcher.js - User pattern learning (~250 lines)
 * - suggestionRanker.js - Ranking and scoring (~120 lines)
 * - folderAnalyzer.js - Folder structure analysis (~320 lines)
 * - llmSuggester.js - LLM-powered suggestions (~100 lines)
 * - persistence.js - Pattern persistence (~100 lines)
 * - filePatternAnalyzer.js - Batch file analysis (~150 lines)
 *
 * @module services/organization
 */

const { OrganizationSuggestionServiceCore } = require('./OrganizationSuggestionServiceCore');
const { PatternMatcher } = require('./patternMatcher');
const { PatternPersistence } = require('./persistence');
const strategies = require('./strategies');
const suggestionRanker = require('./suggestionRanker');
const folderAnalyzer = require('./folderAnalyzer');
const llmSuggester = require('./llmSuggester');
const filePatternAnalyzer = require('./filePatternAnalyzer');
const learningFeedback = require('./learningFeedback');

// Export core class as OrganizationSuggestionService for backward compatibility
const OrganizationSuggestionService = OrganizationSuggestionServiceCore;

/**
 * Create an OrganizationSuggestionService instance with default dependencies
 *
 * @param {Object} config - Configuration options
 * @returns {OrganizationSuggestionService} A new service instance
 */
function createWithDefaults(config = {}) {
  const { getInstance: getChromaDB } = require('../chromadb');
  const FolderMatchingService = require('../FolderMatchingService');
  const { getService: getSettingsService } = require('../SettingsService');
  const { ClusteringService } = require('../ClusteringService');
  const { getInstance: getOllamaInstance } = require('../OllamaService');

  const chromaDbService = getChromaDB();
  const folderMatchingService = new FolderMatchingService(chromaDbService);
  const settingsService = getSettingsService();
  const ollamaService = getOllamaInstance();
  const clusteringService = new ClusteringService({
    chromaDbService,
    ollamaService
  });

  return new OrganizationSuggestionService({
    chromaDbService,
    folderMatchingService,
    settingsService,
    clusteringService,
    config
  });
}

module.exports = OrganizationSuggestionService;
module.exports.createWithDefaults = createWithDefaults;

// Export sub-modules for direct access if needed
module.exports.PatternMatcher = PatternMatcher;
module.exports.PatternPersistence = PatternPersistence;
module.exports.strategies = strategies;
module.exports.suggestionRanker = suggestionRanker;
module.exports.folderAnalyzer = folderAnalyzer;
module.exports.llmSuggester = llmSuggester;
module.exports.filePatternAnalyzer = filePatternAnalyzer;
module.exports.learningFeedback = learningFeedback;
