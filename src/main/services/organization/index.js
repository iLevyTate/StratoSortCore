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
  const { getInstance: getOramaService } = require('../OramaVectorService');
  const FolderMatchingService = require('../FolderMatchingService');
  const { getInstance: getSettingsService } = require('../SettingsService');
  const { ClusteringService } = require('../ClusteringService');
  const { getInstance: getLlamaInstance } = require('../LlamaService');

  const vectorDbService = getOramaService();
  const folderMatchingService = new FolderMatchingService(vectorDbService);
  const settingsService = getSettingsService();
  const llamaService = getLlamaInstance();
  const clusteringService = new ClusteringService({
    vectorDbService,
    llamaService
  });

  return new OrganizationSuggestionService({
    vectorDbService,
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
