const { logger } = require('../../shared/logger');
const path = require('path');
const fs = require('fs').promises;
const { app } = require('electron');
const os = require('os');
const { getOllama, getOllamaModel } = require('../ollamaUtils');
const { buildOllamaOptions } = require('./PerformanceService');
const {
  globalDeduplicator,
  globalBatchProcessor,
} = require('../utils/llmOptimization');

// Calculate optimal concurrency based on CPU cores
function calculateOptimalConcurrency() {
  const cpuCores = os.cpus().length;
  return Math.min(Math.max(2, Math.floor(cpuCores * 0.75)), 8);
}

class OrganizationSuggestionService {
  constructor({
    chromaDbService,
    folderMatchingService,
    settingsService,
    config = {},
  }) {
    this.chromaDb = chromaDbService;
    this.folderMatcher = folderMatchingService;
    this.settings = settingsService;

    // Configuration with defaults (Bug #5 fix)
    this.config = {
      semanticMatchThreshold: config.semanticMatchThreshold || 0.4,
      strategyMatchThreshold: config.strategyMatchThreshold || 0.3,
      patternSimilarityThreshold: config.patternSimilarityThreshold || 0.5,
      topKSemanticMatches: config.topKSemanticMatches || 8,
      maxFeedbackHistory: config.maxFeedbackHistory || 1000,
      llmTemperature: config.llmTemperature || 0.7,
      llmMaxTokens: config.llmMaxTokens || 500,
      ...config,
    };

    // Organization strategy templates
    this.strategies = {
      'project-based': {
        name: 'Project-Based',
        description: 'Organize files by project or client',
        pattern: 'Projects/{project_name}/{file_type}',
        priority: ['project', 'client', 'task'],
      },
      'date-based': {
        name: 'Date-Based',
        description: 'Organize files chronologically',
        pattern: 'Archive/{year}/{month}/{category}',
        priority: ['date', 'time_period', 'category'],
      },
      'type-based': {
        name: 'Type-Based',
        description: 'Organize by file type and purpose',
        pattern: '{file_type}/{subcategory}/{project}',
        priority: ['file_type', 'purpose', 'format'],
      },
      'workflow-based': {
        name: 'Workflow-Based',
        description: 'Organize by workflow stage',
        pattern: 'Workflow/{stage}/{project}/{file_type}',
        priority: ['stage', 'status', 'version'],
      },
      hierarchical: {
        name: 'Hierarchical',
        description: 'Multi-level categorization',
        pattern: '{main_category}/{subcategory}/{specific_folder}',
        priority: ['category', 'subcategory', 'tags'],
      },
    };

    // Track user preferences and patterns
    this.userPatterns = new Map();
    this.feedbackHistory = [];
    this.folderUsageStats = new Map();
    this.maxUserPatterns = config.maxUserPatterns || 5000; // Cap at 5000 patterns to prevent memory leak
    this.maxMemoryMB = config.maxMemoryMB || 50; // Maximum memory usage in MB
    this.memoryCheckInterval = 100; // Check memory every 100 patterns
    this.patternCount = 0;

    // Storage paths for persistence (Bug #1 fix)
    this.userDataPath = app.getPath('userData');
    this.patternsFilePath = path.join(this.userDataPath, 'user-patterns.json');
    this.lastSaveTime = Date.now();
    this.saveThrottleMs = 5000; // Throttle saves to max once per 5 seconds

    // Load persisted patterns on initialization
    (async () => {
      try {
        await this.loadUserPatterns();
      } catch (error) {
        logger.warn('Failed to load user patterns', {
          error: error.message,
          stack: error.stack,
        });
      }
    })();
  }

  /**
   * Load user patterns from persistent storage (Bug #1 fix)
   */
  async loadUserPatterns() {
    try {
      const data = await fs.readFile(this.patternsFilePath, 'utf-8');
      const stored = JSON.parse(data);

      if (stored.patterns && Array.isArray(stored.patterns)) {
        this.userPatterns = new Map(stored.patterns);
        logger.info(
          `[OrganizationSuggestionService] Loaded ${this.userPatterns.size} user patterns from storage`,
        );
      }

      if (stored.feedbackHistory && Array.isArray(stored.feedbackHistory)) {
        this.feedbackHistory = stored.feedbackHistory;
      }

      if (stored.folderUsageStats && Array.isArray(stored.folderUsageStats)) {
        this.folderUsageStats = new Map(stored.folderUsageStats);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.error(
          '[OrganizationSuggestionService] Error loading user patterns:',
          error,
        );
      }
      // If file doesn't exist, that's okay - we'll create it on first save
    }
  }

  /**
   * Save user patterns to persistent storage (Bug #1 fix)
   */
  async saveUserPatterns() {
    try {
      // Throttle saves to avoid excessive disk writes
      const now = Date.now();
      if (now - this.lastSaveTime < this.saveThrottleMs) {
        // Schedule a delayed save
        if (!this.pendingSave) {
          this.pendingSave = setTimeout(
            () => {
              this.pendingSave = null;
              this.saveUserPatterns();
            },
            this.saveThrottleMs - (now - this.lastSaveTime),
          );

          // Allow Node's event loop to exit without waiting for the timer.
          if (typeof this.pendingSave.unref === 'function') {
            this.pendingSave.unref();
          }
        }
        return;
      }

      this.lastSaveTime = now;

      const data = {
        patterns: Array.from(this.userPatterns.entries()),
        feedbackHistory: this.feedbackHistory.slice(
          -this.config.maxFeedbackHistory,
        ),
        folderUsageStats: Array.from(this.folderUsageStats.entries()),
        lastUpdated: new Date().toISOString(),
      };

      // Ensure directory exists
      await fs.mkdir(path.dirname(this.patternsFilePath), { recursive: true });

      // Write atomically with temp file
      const tempPath = `${this.patternsFilePath}.tmp`;
      await fs.writeFile(tempPath, JSON.stringify(data, null, 2));
      await fs.rename(tempPath, this.patternsFilePath);

      logger.debug(
        `[OrganizationSuggestionService] Saved ${this.userPatterns.size} user patterns to storage`,
      );
    } catch (error) {
      logger.error(
        '[OrganizationSuggestionService] Failed to save user patterns:',
        error,
      );
    }
  }

  /**
   * Get organization suggestions for a single file
   */
  async getSuggestionsForFile(file, smartFolders = [], options = {}) {
    const { includeStructureAnalysis = true, includeAlternatives = true } =
      options;

    // Validate inputs (Bug #4 fix - Enhanced)
    if (!file || typeof file !== 'object') {
      throw new Error('Invalid file object: file must be an object');
    }
    if (!file.name || typeof file.name !== 'string') {
      throw new Error('Invalid file object: file.name is required');
    }
    if (!file.extension || typeof file.extension !== 'string') {
      throw new Error('Invalid file object: file.extension is required');
    }
    if (!Array.isArray(smartFolders)) {
      throw new Error('smartFolders must be an array');
    }

    // Additional validation: Check for reasonable string lengths
    if (file.name.length > 255) {
      throw new Error('Invalid file object: file.name exceeds maximum length');
    }
    if (file.extension.length > 50) {
      throw new Error(
        'Invalid file object: file.extension exceeds maximum length',
      );
    }

    try {
      // Bug #2 fix: Removed dead code (const suggestions = [])

      // Ensure smart folders have embeddings for semantic matching
      if (smartFolders && smartFolders.length > 0) {
        await this.ensureSmartFolderEmbeddings(smartFolders);
      }

      // 1. Get semantic folder matches from existing smart folders
      const semanticMatches = await this.getSemanticFolderMatches(
        file,
        smartFolders,
      );

      // 2. Get strategy-based suggestions
      const strategyMatches = await this.getStrategyBasedSuggestions(
        file,
        smartFolders,
      );

      // 3. Get pattern-based suggestions from user history
      const patternMatches = this.getPatternBasedSuggestions(file);

      // 4. Get LLM-powered alternative suggestions
      const llmSuggestions = await this.getLLMAlternativeSuggestions(
        file,
        smartFolders,
      );

      // 5. Get improvement suggestions for existing folders
      const improvementSuggestions = await this.getImprovementSuggestions(
        file,
        smartFolders,
      );

      // Combine and rank all suggestions
      // Optimization: Single pass to combine and tag suggestions
      const allSuggestions = [];

      // Combine all arrays in a single pass, adding source property
      for (const match of semanticMatches) {
        match.source = 'semantic';
        allSuggestions.push(match);
      }
      for (const match of strategyMatches) {
        match.source = 'strategy';
        allSuggestions.push(match);
      }
      for (const match of patternMatches) {
        match.source = 'pattern';
        allSuggestions.push(match);
      }
      for (const suggestion of llmSuggestions) {
        suggestion.source = 'llm';
        allSuggestions.push(suggestion);
      }
      for (const suggestion of improvementSuggestions) {
        suggestion.source = 'improvement';
        allSuggestions.push(suggestion);
      }

      // Deduplicate and rank
      const rankedSuggestions = this.rankSuggestions(allSuggestions);

      // Validation: Ensure files ALWAYS get assigned to a folder
      // If no matches found, use default "Uncategorized" folder
      if (rankedSuggestions.length === 0) {
        let defaultFolder = smartFolders.find(
          (f) => f.isDefault || f.name.toLowerCase() === 'uncategorized',
        );

        // Emergency fallback: Create default folder if none exists
        if (!defaultFolder) {
          logger.warn(
            '[OrganizationSuggestionService] No default folder exists, creating emergency fallback for:',
            file.name,
          );

          try {
            const documentsDir = app.getPath('documents');
            const defaultFolderPath = path.join(
              documentsDir,
              'StratoSort',
              'Uncategorized',
            );

            // Ensure directory exists
            await fs.mkdir(defaultFolderPath, { recursive: true });

            defaultFolder = {
              id: 'emergency-default-' + Date.now(),
              name: 'Uncategorized',
              path: defaultFolderPath,
              description:
                'Emergency fallback folder created for unmatched files',
              keywords: [],
              isDefault: true,
              createdAt: new Date().toISOString(),
            };

            // Add to smartFolders for this session
            smartFolders.push(defaultFolder);

            logger.info(
              '[OrganizationSuggestionService] Emergency default folder created at:',
              defaultFolderPath,
            );
          } catch (error) {
            logger.error(
              '[OrganizationSuggestionService] Failed to create emergency default folder:',
              error,
            );
            // Continue with in-memory folder object as last resort
            const documentsDir = app.getPath('documents');
            defaultFolder = {
              name: 'Uncategorized',
              path: path.join(documentsDir, 'StratoSort', 'Uncategorized'),
              description: 'Default folder for unmatched files',
              isDefault: true,
            };
          }
        }

        if (defaultFolder) {
          logger.info(
            '[OrganizationSuggestionService] No matches found, using default folder for:',
            file.name,
          );

          rankedSuggestions.push({
            folder: defaultFolder.name,
            path: defaultFolder.path,
            score: 0.1,
            confidence: 0.1,
            method: 'default_fallback',
            description:
              defaultFolder.description || 'Default folder for unmatched files',
            source: 'default',
            isSmartFolder: true,
          });
        }
      }

      // Get folder improvement recommendations (optional)
      let folderImprovements = [];
      if (includeStructureAnalysis) {
        folderImprovements = await this.analyzeFolderStructure(smartFolders, [
          file,
        ]);
      }

      return {
        success: true,
        primary: rankedSuggestions[0] || null,
        alternatives: includeAlternatives ? rankedSuggestions.slice(1, 5) : [],
        strategies: this.getApplicableStrategies(file),
        confidence: this.calculateConfidence(rankedSuggestions[0]),
        explanation: this.generateExplanation(rankedSuggestions[0], file),
        folderImprovements,
      };
    } catch (error) {
      logger.error(
        '[OrganizationSuggestionService] Failed to get suggestions:',
        error,
      );
      return {
        success: false,
        error: error.message,
        fallback: this.getFallbackSuggestion(file, smartFolders),
      };
    }
  }

  /**
   * Get suggestions for batch organization (Optimized with parallel processing)
   */
  async getBatchSuggestions(files, smartFolders = [], options = {}) {
    try {
      // Analyze files for common patterns
      const patterns = this.analyzeFilePatterns(files);

      // Group files by suggested organization
      const groups = new Map();

      // Process files in parallel using batch processor with dynamic concurrency
      const optimalConcurrency = calculateOptimalConcurrency();
      logger.info(
        '[OrganizationSuggestionService] Processing batch suggestions in parallel',
        {
          fileCount: files.length,
          concurrency: optimalConcurrency,
          cpuCores: os.cpus().length,
        },
      );

      const batchResult = await globalBatchProcessor.processBatch(
        files,
        async (file) => {
          const suggestion = await this.getSuggestionsForFile(
            file,
            smartFolders,
            options,
          );
          return { file, suggestion };
        },
        {
          concurrency: optimalConcurrency, // Dynamic based on CPU cores
          stopOnError: false,
        },
      );

      // Group results
      for (const result of batchResult.results) {
        if (result.error) {
          logger.warn(
            '[OrganizationSuggestionService] File suggestion failed',
            {
              file: result.file?.name,
              error: result.error,
            },
          );
          continue;
        }

        const { file, suggestion } = result;
        const key = suggestion.primary?.folder || 'Uncategorized';

        if (!groups.has(key)) {
          groups.set(key, {
            folder: suggestion.primary?.folder || key,
            files: [],
            confidence: 0,
            strategy: suggestion.primary?.strategy,
          });
        }

        const group = groups.get(key);
        group.files.push({
          ...file,
          suggestion: suggestion.primary,
          alternatives: suggestion.alternatives,
        });

        // Fix: Proper running average calculation
        const currentTotal = group.confidence * (group.files.length - 1);
        const newTotal = currentTotal + (suggestion.confidence || 0);
        group.confidence = newTotal / group.files.length;
      }

      // Generate batch recommendations
      const recommendations = await this.generateBatchRecommendations(
        groups,
        patterns,
      );

      logger.info(
        '[OrganizationSuggestionService] Batch suggestions complete',
        {
          groupCount: groups.size,
          fileCount: files.length,
        },
      );

      return {
        success: true,
        groups: Array.from(groups.values()),
        patterns,
        recommendations,
        suggestedStrategy: this.selectBestStrategy(patterns, files),
      };
    } catch (error) {
      logger.error(
        '[OrganizationSuggestionService] Batch suggestions failed:',
        error,
      );
      return {
        success: false,
        error: error.message,
        groups: [],
      };
    }
  }

  /**
   * Ensure smart folders have embeddings (optimized with batching)
   */
  async ensureSmartFolderEmbeddings(smartFolders) {
    try {
      if (!smartFolders || smartFolders.length === 0) {
        return 0;
      }

      // Optimization: Batch process folder embeddings to reduce overhead
      // Generate embeddings in parallel, then batch upsert to ChromaDB
      const embeddingPromises = smartFolders.map(async (folder) => {
        try {
          const folderText = [folder.name, folder.description]
            .filter(Boolean)
            .join(' - ');

          const { vector, model } =
            await this.folderMatcher.embedText(folderText);
          const folderId =
            folder.id || this.folderMatcher.generateFolderId(folder);

          return {
            id: folderId,
            name: folder.name,
            description: folder.description || '',
            path: folder.path || '',
            vector,
            model,
            updatedAt: new Date().toISOString(),
          };
        } catch (error) {
          logger.warn(
            '[OrganizationSuggestionService] Failed to generate embedding for folder:',
            folder.name,
            error.message,
          );
          return null;
        }
      });

      const folderPayloads = (await Promise.allSettled(embeddingPromises))
        .filter((r) => r.status === 'fulfilled' && r.value !== null)
        .map((r) => r.value);

      if (folderPayloads.length === 0) {
        logger.warn(
          '[OrganizationSuggestionService] No valid folder embeddings generated',
        );
        return 0;
      }

      // Optimization: Use batch upsert to reduce database round trips
      const successful = await this.chromaDb.batchUpsertFolders(folderPayloads);

      logger.debug(
        `[OrganizationSuggestionService] Batch upserted ${successful}/${smartFolders.length} folder embeddings`,
      );

      return successful;
    } catch (error) {
      logger.warn(
        '[OrganizationSuggestionService] Failed to ensure folder embeddings:',
        error,
      );
      return 0;
    }
  }

  /**
   * Get semantic folder matches using embeddings (optimized to reduce redundant operations)
   */
  async getSemanticFolderMatches(file, smartFolders) {
    try {
      const fileId = `file:${file.path}`;
      const summary = this.generateFileSummary(file);

      // Optimization: Only upsert file embedding if it doesn't exist or is stale
      // This reduces redundant embedding generation and database writes
      await this.folderMatcher.upsertFileEmbedding(fileId, summary, {
        path: file.path,
        name: file.name,
        analysis: file.analysis,
      });

      // Optimization: Query uses caching and deduplication in ChromaDBService
      // Multiple concurrent requests for the same file will be deduplicated
      const matches = await this.folderMatcher.matchFileToFolders(
        fileId,
        this.config.topKSemanticMatches,
      );

      // Map matches to smart folders
      const suggestions = [];
      for (const match of matches) {
        // Find corresponding smart folder
        const smartFolder = smartFolders.find(
          (f) =>
            f.id === match.folderId ||
            f.name === match.name ||
            f.path === match.path,
        );

        if (smartFolder || match.score > this.config.semanticMatchThreshold) {
          suggestions.push({
            folder: smartFolder?.name || match.name,
            path: smartFolder?.path || match.path,
            score: match.score,
            confidence: match.score,
            description: smartFolder?.description || match.description,
            method: 'semantic_embedding',
            isSmartFolder: !!smartFolder,
          });
        }
      }

      return suggestions;
    } catch (error) {
      logger.warn(
        '[OrganizationSuggestionService] Semantic matching failed:',
        error,
      );
      return [];
    }
  }

  /**
   * Get strategy-based organization suggestions
   */
  async getStrategyBasedSuggestions(file, smartFolders) {
    const suggestions = [];

    for (const [strategyId, strategy] of Object.entries(this.strategies)) {
      const score = this.scoreFileForStrategy(file, strategy);

      if (score > this.config.strategyMatchThreshold) {
        const folder = this.mapFileToStrategy(file, strategy, smartFolders);
        suggestions.push({
          folder: folder.name,
          path: folder.path,
          score,
          confidence: score,
          strategy: strategyId,
          strategyName: strategy.name,
          pattern: strategy.pattern,
          method: 'strategy_based',
        });
      }
    }

    return suggestions.sort((a, b) => b.score - a.score);
  }

  /**
   * Get pattern-based suggestions from user history
   */
  getPatternBasedSuggestions(file) {
    const suggestions = [];

    // Look for similar files in user patterns
    for (const [pattern, data] of this.userPatterns) {
      const similarity = this.calculatePatternSimilarity(file, pattern);

      if (similarity > this.config.patternSimilarityThreshold) {
        suggestions.push({
          folder: data.folder,
          path: data.path,
          score: similarity * data.confidence,
          confidence: similarity * data.confidence,
          pattern: pattern,
          method: 'user_pattern',
          usageCount: data.count,
        });
      }
    }

    return suggestions.sort((a, b) => b.score - a.score).slice(0, 3);
  }

  /**
   * Get LLM-powered alternative suggestions
   */
  async getLLMAlternativeSuggestions(file, smartFolders) {
    try {
      const ollama = getOllama();
      const model = getOllamaModel();

      if (!ollama || !model) {
        return [];
      }

      const prompt = `Given this file analysis, suggest 3 alternative organization approaches:

File: ${file.name}
Type: ${file.extension}
Analysis: ${JSON.stringify(file.analysis || {}, null, 2).slice(0, 500)}

Available folders: ${smartFolders.map((f) => `${f.name}: ${f.description}`).join(', ')}

Suggest creative but practical organization alternatives that might not be obvious.
Consider: workflow stages, temporal organization, project grouping, or functional categorization.

Return JSON: {
  "suggestions": [
    {
      "folder": "folder name",
      "reasoning": "why this makes sense",
      "confidence": 0.0-1.0,
      "strategy": "organization principle used"
    }
  ]
}`;

      const perfOptions = await buildOllamaOptions('text');

      // Use deduplication to prevent duplicate LLM calls for the same file
      const deduplicationKey = globalDeduplicator.generateKey({
        fileName: file.name,
        analysis: JSON.stringify(file.analysis || {}),
        folders: smartFolders.map((f) => f.name).join(','),
        type: 'organization-suggestions',
      });

      const response = await globalDeduplicator.deduplicate(
        deduplicationKey,
        () =>
          ollama.generate({
            model,
            prompt,
            format: 'json',
            options: {
              ...perfOptions,
              temperature: this.config.llmTemperature,
              num_predict: this.config.llmMaxTokens,
            },
          }),
      );

      // SECURITY FIX #9: Validate response size before parsing to prevent DoS
      // Maximum 1MB (1,048,576 bytes) to prevent memory exhaustion attacks
      const MAX_RESPONSE_SIZE = 1024 * 1024; // 1MB
      const responseText = response.response || '';
      const responseSize = Buffer.byteLength(responseText, 'utf8');

      if (responseSize > MAX_RESPONSE_SIZE) {
        logger.warn(
          '[OrganizationSuggestionService] LLM response exceeds maximum size limit',
          {
            size: responseSize,
            maxSize: MAX_RESPONSE_SIZE,
            file: file.name,
          },
        );
        return [];
      }

      // Bug #3 fix: Wrap JSON.parse in try/catch to handle malformed JSON
      let parsed;
      try {
        parsed = JSON.parse(responseText);
      } catch (parseError) {
        logger.warn(
          '[OrganizationSuggestionService] Failed to parse LLM JSON response:',
          parseError.message,
          'Raw response:',
          responseText.slice(0, 500),
        );
        return [];
      }

      // Validate parsed response has the expected structure
      if (!parsed || !Array.isArray(parsed.suggestions)) {
        logger.warn(
          '[OrganizationSuggestionService] LLM response missing suggestions array:',
          typeof parsed,
        );
        return [];
      }

      return parsed.suggestions.map((s) => ({
        folder: s.folder,
        score: s.confidence || 0.5,
        confidence: s.confidence || 0.5,
        reasoning: s.reasoning,
        strategy: s.strategy,
        method: 'llm_creative',
      }));
    } catch (error) {
      logger.warn(
        '[OrganizationSuggestionService] LLM suggestions failed:',
        error,
      );
      return [];
    }
  }

  /**
   * Rank and deduplicate suggestions
   */
  rankSuggestions(suggestions) {
    // Deduplicate by folder name
    const uniqueSuggestions = new Map();

    for (const suggestion of suggestions) {
      const key = suggestion.folder?.toLowerCase();
      if (!key) continue;

      if (!uniqueSuggestions.has(key)) {
        uniqueSuggestions.set(key, suggestion);
      } else {
        // Merge scores if duplicate
        const existing = uniqueSuggestions.get(key);
        existing.score = Math.max(existing.score, suggestion.score);
        existing.confidence = Math.max(
          existing.confidence,
          suggestion.confidence,
        );

        // Keep the source that provided higher confidence
        if (suggestion.confidence > existing.confidence) {
          existing.source = suggestion.source;
          existing.method = suggestion.method;
        }
      }
    }

    // Apply weighting based on source
    const weighted = Array.from(uniqueSuggestions.values()).map((s) => ({
      ...s,
      weightedScore: this.applySourceWeight(s),
    }));

    // Sort by weighted score
    return weighted.sort((a, b) => b.weightedScore - a.weightedScore);
  }

  /**
   * Apply source-based weighting to scores
   */
  applySourceWeight(suggestion) {
    const weights = {
      semantic: 1.2, // Semantic matches are usually good
      user_pattern: 1.5, // User patterns are highly relevant
      strategy: 1.0, // Strategy-based are standard
      llm: 0.8, // LLM suggestions need validation
      pattern: 1.1, // Pattern matches are reliable
      llm_creative: 0.7, // Creative suggestions are experimental
    };

    const weight = weights[suggestion.source] || 1.0;
    return (suggestion.score || 0) * weight;
  }

  /**
   * Calculate confidence for a suggestion
   */
  calculateConfidence(suggestion) {
    if (!suggestion) return 0;

    let confidence = suggestion.confidence || suggestion.score || 0;

    // Boost confidence if multiple sources agree
    if (suggestion.sources && suggestion.sources.length > 1) {
      confidence = Math.min(1.0, confidence * 1.2);
    }

    // Boost if matches user pattern
    if (suggestion.source === 'user_pattern') {
      confidence = Math.min(1.0, confidence * 1.3);
    }

    return Math.round(confidence * 100) / 100;
  }

  /**
   * Generate human-readable explanation for suggestion
   */
  generateExplanation(suggestion, file) {
    if (!suggestion) {
      return 'No clear match found. Consider creating a new folder.';
    }

    // User-friendly explanations without technical jargon
    const explanations = {
      semantic: `This file's content is similar to other files in "${suggestion.folder}"`,
      user_pattern: `You've organized similar files this way before`,
      strategy: `Using ${suggestion.strategyName || 'your preferred'} organization method`,
      llm: `Based on the file's content and purpose`,
      pattern: `This is where ${file.extension.toUpperCase()} files usually go`,
      llm_creative:
        suggestion.reasoning || 'Alternative way to organize this file',
      folder_improvement: `"${suggestion.folder}" could be enhanced for this type of file`,
      improvement:
        suggestion.improvement ||
        `Suggested improvement for better organization`,
      new_folder_suggestion: 'A new folder would be perfect for this file type',
    };

    // Add confidence-based prefix for clarity
    let prefix = '';
    if (suggestion.confidence >= 0.8) {
      prefix = '✅ ';
    } else if (suggestion.confidence >= 0.5) {
      prefix = '👍 ';
    } else {
      prefix = '💡 ';
    }

    return (
      prefix +
      (explanations[suggestion.source] ||
        explanations[suggestion.method] ||
        'Based on file analysis')
    );
  }

  /**
   * Analyze patterns in a batch of files
   */
  analyzeFilePatterns(files) {
    const patterns = {
      projects: new Set(),
      dates: new Set(),
      types: new Set(),
      categories: new Set(),
      commonWords: {},
    };

    for (const file of files) {
      if (file.analysis) {
        if (file.analysis.project) patterns.projects.add(file.analysis.project);
        if (file.analysis.category)
          patterns.categories.add(file.analysis.category);
        if (file.analysis.documentDate)
          patterns.dates.add(file.analysis.documentDate);
      }

      // Extract common words from filenames
      const words = file.name.toLowerCase().split(/[^a-z0-9]+/);
      for (const word of words) {
        if (word.length > 3) {
          patterns.commonWords[word] = (patterns.commonWords[word] || 0) + 1;
        }
      }

      patterns.types.add(file.extension);
    }

    // Find most common patterns
    return {
      hasCommonProject: patterns.projects.size === 1,
      project:
        patterns.projects.size === 1 ? Array.from(patterns.projects)[0] : null,
      hasDatePattern: patterns.dates.size > 0,
      dateRange:
        patterns.dates.size > 0 ? this.getDateRange(patterns.dates) : null,
      fileTypes: Array.from(patterns.types),
      dominantCategory: this.findDominantCategory(patterns.categories),
      commonTerms: Object.entries(patterns.commonWords)
        .filter(([, count]) => count > files.length * 0.3)
        .map(([word]) => word),
    };
  }

  /**
   * Generate batch organization recommendations
   */
  async generateBatchRecommendations(groups, patterns) {
    const recommendations = [];
    const normalizedGroups =
      groups instanceof Map
        ? Array.from(groups.values())
        : Array.isArray(groups)
          ? groups
          : [];

    // Check if files belong to same project
    if (patterns.hasCommonProject) {
      recommendations.push({
        type: 'project_grouping',
        description: `All files appear to be related to "${patterns.project}"`,
        suggestion: `Consider creating a dedicated project folder: Projects/${patterns.project}`,
        confidence: 0.9,
      });
    }

    // Check for temporal patterns
    if (patterns.hasDatePattern) {
      recommendations.push({
        type: 'temporal_organization',
        description: `Files span ${patterns.dateRange.description}`,
        suggestion:
          'Consider organizing by date for better chronological tracking',
        confidence: 0.7,
      });
    }

    // Check for workflow patterns
    const workflowIndicators = [
      'draft',
      'final',
      'review',
      'approved',
      'v1',
      'v2',
    ];
    const hasWorkflow = patterns.commonTerms.some((term) =>
      workflowIndicators.includes(term.toLowerCase()),
    );

    if (hasWorkflow) {
      recommendations.push({
        type: 'workflow_organization',
        description: 'Files show versioning or workflow stages',
        suggestion:
          'Consider organizing by workflow stage for better process management',
        confidence: 0.8,
      });
    }

    if (normalizedGroups.length > 5) {
      recommendations.push({
        type: 'batch_cleanup',
        description: 'Large number of destination folders detected',
        suggestion:
          'Consider consolidating folders or batching approvals to reduce fragmentation',
        confidence: 0.6,
      });
    }

    return recommendations;
  }

  /**
   * Record user feedback for learning
   * BUG FIX #10: Add time-based expiration and feedback history pruning
   */
  recordFeedback(file, suggestion, accepted) {
    const now = Date.now();

    // BUG FIX #10: Add time-based expiration to feedback history
    // Remove feedback entries older than 90 days to prevent unbounded growth
    const FEEDBACK_RETENTION_DAYS = 90;
    const FEEDBACK_RETENTION_MS = FEEDBACK_RETENTION_DAYS * 24 * 60 * 60 * 1000;

    // Prune old feedback before adding new entry
    if (this.feedbackHistory.length > 0) {
      const cutoffTime = now - FEEDBACK_RETENTION_MS;
      const originalLength = this.feedbackHistory.length;

      this.feedbackHistory = this.feedbackHistory.filter(
        (entry) => entry.timestamp > cutoffTime,
      );

      const pruned = originalLength - this.feedbackHistory.length;
      if (pruned > 0) {
        logger.debug(
          `[OrganizationSuggestionService] Pruned ${pruned} feedback entries older than ${FEEDBACK_RETENTION_DAYS} days`,
        );
      }
    }

    this.feedbackHistory.push({
      timestamp: now,
      file: { name: file.name, type: file.extension },
      suggestion,
      accepted,
    });

    // Update user patterns
    if (accepted && suggestion) {
      const pattern = this.extractPattern(file, suggestion);

      if (!this.userPatterns.has(pattern)) {
        // Check memory usage periodically
        this.patternCount++;
        if (this.patternCount % this.memoryCheckInterval === 0) {
          this.checkMemoryUsage();
        }

        // Check if we've hit the limit
        if (this.userPatterns.size >= this.maxUserPatterns) {
          // BUG FIX #10: Enhanced pruning strategy with time-based expiration
          // Remove patterns that are both old AND low-value
          const patternsArray = Array.from(this.userPatterns.entries());

          // Define pattern age thresholds
          const PATTERN_STALE_DAYS = 180; // 6 months
          const PATTERN_STALE_MS = PATTERN_STALE_DAYS * 24 * 60 * 60 * 1000;
          const staleThreshold = now - PATTERN_STALE_MS;

          // First, remove stale patterns (not used in 6 months)
          const stalePatterns = patternsArray.filter(
            ([, data]) => data.lastUsed < staleThreshold,
          );

          if (stalePatterns.length > 0) {
            for (const [key] of stalePatterns) {
              this.userPatterns.delete(key);
            }
            logger.debug(
              `[OrganizationSuggestionService] Pruned ${stalePatterns.length} stale patterns (unused for ${PATTERN_STALE_DAYS} days)`,
            );
          }

          // If still at capacity after removing stale patterns, use LRU strategy
          if (this.userPatterns.size >= this.maxUserPatterns) {
            const remainingPatterns = Array.from(this.userPatterns.entries());

            // Sort by composite score: count * confidence * recency_factor
            // Recency factor gives preference to recently used patterns
            remainingPatterns.sort((a, b) => {
              const ageA = now - a[1].lastUsed;
              const ageB = now - b[1].lastUsed;
              const recencyFactorA =
                1 / (1 + ageA / (30 * 24 * 60 * 60 * 1000)); // Decay over 30 days
              const recencyFactorB =
                1 / (1 + ageB / (30 * 24 * 60 * 60 * 1000));

              const scoreA = a[1].count * a[1].confidence * recencyFactorA;
              const scoreB = b[1].count * b[1].confidence * recencyFactorB;
              return scoreA - scoreB; // Ascending: lowest scores first
            });

            // Remove bottom 10% of patterns
            const removeCount = Math.floor(this.maxUserPatterns * 0.1);
            for (let i = 0; i < removeCount; i++) {
              this.userPatterns.delete(remainingPatterns[i][0]);
            }

            logger.debug(
              `[OrganizationSuggestionService] Pruned ${removeCount} low-value patterns using LRU strategy`,
            );
          }
        }

        this.userPatterns.set(pattern, {
          folder: suggestion.folder,
          path: suggestion.path,
          count: 0,
          confidence: 0.5,
          lastUsed: now, // Track last usage
          createdAt: now, // BUG FIX #10: Track creation time
        });
      }

      const data = this.userPatterns.get(pattern);
      data.count++;
      data.confidence = Math.min(1.0, data.confidence + 0.1);
      data.lastUsed = now; // Update last usage
    }

    // BUG FIX #10: Trim history if too large (use time-based pruning first)
    // This is a secondary check in case time-based pruning wasn't enough
    if (this.feedbackHistory.length > this.config.maxFeedbackHistory) {
      const excess =
        this.feedbackHistory.length - this.config.maxFeedbackHistory;
      logger.warn(
        `[OrganizationSuggestionService] Feedback history exceeds limit (${this.feedbackHistory.length} > ${this.config.maxFeedbackHistory}), removing ${excess} oldest entries`,
      );
      this.feedbackHistory = this.feedbackHistory.slice(
        -this.config.maxFeedbackHistory,
      );
    }

    // Save patterns to persistent storage after feedback (Bug #1 fix)
    this.saveUserPatterns().catch((error) => {
      logger.error(
        '[OrganizationSuggestionService] Failed to save patterns after feedback:',
        error,
      );
    });
  }

  /**
   * Helper methods
   */

  generateFileSummary(file) {
    const parts = [
      file.name,
      file.extension,
      file.analysis?.project,
      file.analysis?.purpose,
      file.analysis?.category,
      (file.analysis?.keywords || []).join(' '),
    ].filter(Boolean);

    return parts.join(' ');
  }

  scoreFileForStrategy(file, strategy) {
    let score = 0;
    const analysis = file.analysis || {};

    for (const priority of strategy.priority) {
      if (analysis[priority]) {
        score += 0.3;
      }
    }

    // Check if filename matches strategy pattern
    const patternMatch = this.matchesStrategyPattern(
      file.name,
      strategy.pattern,
    );
    if (patternMatch) {
      score += 0.4;
    }

    return Math.min(1.0, score);
  }

  mapFileToStrategy(file, strategy, smartFolders) {
    const analysis = file.analysis || {};
    const pattern = strategy.pattern;

    // Replace pattern variables with actual values
    const folderPath = pattern
      .replace('{project_name}', analysis.project || 'General')
      .replace('{file_type}', this.getFileTypeCategory(file.extension))
      .replace('{year}', new Date().getFullYear())
      .replace('{month}', String(new Date().getMonth() + 1).padStart(2, '0'))
      .replace('{category}', analysis.category || 'Uncategorized')
      .replace('{stage}', analysis.stage || 'Working')
      .replace('{main_category}', analysis.category || 'Documents')
      .replace('{subcategory}', analysis.subcategory || 'General')
      .replace('{specific_folder}', analysis.purpose || 'Misc');

    // Find matching smart folder or create suggestion
    const matchingFolder = smartFolders.find(
      (f) => f.name.toLowerCase() === path.basename(folderPath).toLowerCase(),
    );

    return {
      name: matchingFolder?.name || path.basename(folderPath),
      path: matchingFolder?.path || folderPath,
    };
  }

  getFileTypeCategory(extension) {
    const categories = {
      documents: ['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt'],
      spreadsheets: ['xls', 'xlsx', 'csv', 'ods'],
      presentations: ['ppt', 'pptx', 'odp'],
      images: ['jpg', 'jpeg', 'png', 'gif', 'svg', 'bmp'],
      videos: ['mp4', 'avi', 'mov', 'wmv', 'flv'],
      audio: ['mp3', 'wav', 'flac', 'aac', 'm4a'],
      code: ['js', 'py', 'java', 'cpp', 'html', 'css'],
      archives: ['zip', 'rar', '7z', 'tar', 'gz'],
    };

    for (const [category, extensions] of Object.entries(categories)) {
      if (extensions.includes(extension.toLowerCase())) {
        return category.charAt(0).toUpperCase() + category.slice(1);
      }
    }

    return 'Files';
  }

  matchesStrategyPattern(filename, pattern) {
    // Simple pattern matching - could be enhanced
    const patternParts = pattern.toLowerCase().split('/');
    const nameParts = filename.toLowerCase().split(/[_\-\s.]/);

    return patternParts.some((part) =>
      nameParts.some(
        (namePart) => namePart.includes(part) || part.includes(namePart),
      ),
    );
  }

  calculatePatternSimilarity(file, pattern) {
    // Simple similarity calculation - could use more sophisticated methods
    const filePattern = this.extractPattern(file);

    if (filePattern === pattern) return 1.0;

    const fileParts = filePattern.split(':');
    const patternParts = pattern.split(':');

    let matches = 0;
    for (let i = 0; i < Math.min(fileParts.length, patternParts.length); i++) {
      if (fileParts[i] === patternParts[i]) {
        matches++;
      }
    }

    return matches / Math.max(fileParts.length, patternParts.length);
  }

  extractPattern(file, suggestion = null) {
    const parts = [
      file.extension,
      file.analysis?.category || 'unknown',
      suggestion?.folder || 'unknown',
    ];

    return parts.join(':').toLowerCase();
  }

  /**
   * Check memory usage and trigger eviction if needed
   */
  checkMemoryUsage() {
    try {
      // Estimate memory usage (rough approximation)
      const patternSize = JSON.stringify(
        Array.from(this.userPatterns.entries()),
      ).length;
      const estimatedMemoryMB = patternSize / (1024 * 1024);

      if (estimatedMemoryMB > this.maxMemoryMB) {
        logger.warn(
          `[OrganizationSuggestionService] Memory limit exceeded: ${estimatedMemoryMB.toFixed(2)}MB / ${this.maxMemoryMB}MB`,
        );

        // Force aggressive eviction - remove 20% of patterns
        const patternsArray = Array.from(this.userPatterns.entries());
        const removeCount = Math.floor(this.userPatterns.size * 0.2);

        // Sort by composite score (same as LRU logic)
        const now = Date.now();
        patternsArray.sort((a, b) => {
          const ageA = now - (a[1].lastUsed || 0);
          const ageB = now - (b[1].lastUsed || 0);
          const recencyFactorA = 1 / (1 + ageA / (30 * 24 * 60 * 60 * 1000));
          const recencyFactorB = 1 / (1 + ageB / (30 * 24 * 60 * 60 * 1000));

          const scoreA =
            (a[1].count || 0) * (a[1].confidence || 0.5) * recencyFactorA;
          const scoreB =
            (b[1].count || 0) * (b[1].confidence || 0.5) * recencyFactorB;
          return scoreA - scoreB;
        });

        // Remove lowest scoring patterns
        for (let i = 0; i < removeCount; i++) {
          this.userPatterns.delete(patternsArray[i][0]);
        }

        logger.info(
          `[OrganizationSuggestionService] Evicted ${removeCount} patterns to free memory`,
        );
      }
    } catch (error) {
      logger.error(
        '[OrganizationSuggestionService] Error checking memory usage:',
        error,
      );
    }
  }

  getDateRange(dates) {
    const dateArray = Array.from(dates).sort();

    if (dateArray.length === 0) return null;
    if (dateArray.length === 1) {
      return {
        start: dateArray[0],
        end: dateArray[0],
        description: `Single date: ${dateArray[0]}`,
      };
    }

    return {
      start: dateArray[0],
      end: dateArray[dateArray.length - 1],
      description: `${dateArray[0]} to ${dateArray[dateArray.length - 1]}`,
    };
  }

  findDominantCategory(categories) {
    const categoryArray = Array.from(categories);

    if (categoryArray.length === 0) return null;
    if (categoryArray.length === 1) return categoryArray[0];

    // Find most common category
    const counts = {};
    for (const cat of categoryArray) {
      counts[cat] = (counts[cat] || 0) + 1;
    }

    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }

  selectBestStrategy(patterns, files = []) {
    let bestStrategy = null;
    let bestScore = 0;

    for (const [strategyId, strategy] of Object.entries(this.strategies)) {
      let score = 0;

      // Score based on pattern match
      if (patterns.hasCommonProject && strategy.priority.includes('project')) {
        score += 0.4;
      }
      if (patterns.hasDatePattern && strategy.priority.includes('date')) {
        score += 0.3;
      }
      if (
        patterns.commonTerms.length > 0 &&
        strategy.priority.includes('category')
      ) {
        score += 0.2;
      }

      // Score based on file diversity
      const typeCount = patterns.fileTypes.length;
      if (typeCount > 3 && strategyId === 'type-based') {
        score += 0.3;
      }

      if (score > bestScore) {
        bestScore = score;
        bestStrategy = { id: strategyId, ...strategy, score };
      }
    }

    if (bestStrategy) {
      return bestStrategy;
    }

    const fileBoost = Math.min(0.15, (files.length || 0) * 0.005);
    return {
      id: 'adaptive',
      name: 'Adaptive Categorization',
      description: 'AI-assisted categorization based on detected patterns',
      pattern: 'Adaptive/{category}/{file_type}',
      score: 0.75 + fileBoost,
    };
  }

  getFallbackSuggestion(file, smartFolders) {
    // Simple fallback based on file type
    const category = this.getFileTypeCategory(file.extension);
    const matchingFolder = smartFolders.find((f) =>
      f.name.toLowerCase().includes(category.toLowerCase()),
    );

    return {
      folder: matchingFolder?.name || category,
      path: matchingFolder?.path || `Documents/${category}`,
      confidence: 0.3,
      method: 'fallback',
    };
  }

  /**
   * Get applicable organization strategies for a file
   */
  getApplicableStrategies(file) {
    return Object.entries(this.strategies)
      .map(([id, strategy]) => ({
        id,
        ...strategy,
        applicability: this.scoreFileForStrategy(file, strategy),
      }))
      .filter((s) => s.applicability > 0.2)
      .sort((a, b) => b.applicability - a.applicability);
  }

  /**
   * Get improvement suggestions for existing organization
   */
  async getImprovementSuggestions(file, smartFolders) {
    const suggestions = [];

    // Analyze if file fits better in a different existing folder
    for (const folder of smartFolders) {
      // Check if folder could be improved for this type of file
      const fitScore = this.calculateFolderFitScore(file, folder);

      if (fitScore > 0.3 && fitScore < 0.7) {
        // Folder is somewhat relevant but could be better
        suggestions.push({
          folder: folder.name,
          path: folder.path,
          score: fitScore + 0.2, // Boost score for improvement
          confidence: fitScore,
          description: folder.description,
          improvement: this.suggestFolderImprovement(file, folder),
          method: 'folder_improvement',
        });
      }
    }

    // Suggest new smart folders if no good matches
    if (suggestions.length === 0) {
      const newFolderSuggestion = await this.suggestNewSmartFolder(
        file,
        smartFolders,
      );
      if (newFolderSuggestion) {
        suggestions.push(newFolderSuggestion);
      }
    }

    return suggestions;
  }

  /**
   * Analyze folder structure and suggest improvements
   */
  async analyzeFolderStructure(smartFolders, files = []) {
    const improvements = [];

    // Check for missing common categories
    const missingCategories = this.identifyMissingCategories(
      smartFolders,
      files,
    );
    if (missingCategories.length > 0) {
      improvements.push({
        type: 'missing_categories',
        description: 'Suggested new folders for better organization',
        suggestions: missingCategories,
        priority: 'high',
      });
    }

    // Check for overlapping folders
    const overlaps = this.findOverlappingFolders(smartFolders);
    if (overlaps.length > 0) {
      improvements.push({
        type: 'folder_overlaps',
        description: 'Folders with similar purposes that could be merged',
        suggestions: overlaps,
        priority: 'medium',
      });
    }

    // Check for underutilized folders
    const underutilized = this.findUnderutilizedFolders(smartFolders);
    if (underutilized.length > 0) {
      improvements.push({
        type: 'underutilized_folders',
        description: 'Folders that might be too specific or rarely used',
        suggestions: underutilized,
        priority: 'low',
      });
    }

    // Suggest hierarchy improvements
    const hierarchySuggestions =
      this.suggestHierarchyImprovements(smartFolders);
    if (hierarchySuggestions.length > 0) {
      improvements.push({
        type: 'hierarchy_improvements',
        description: 'Suggestions for better folder hierarchy',
        suggestions: hierarchySuggestions,
        priority: 'medium',
      });
    }

    return improvements;
  }

  /**
   * Calculate how well a file fits in a folder
   */
  calculateFolderFitScore(file, folder) {
    let score = 0;
    const analysis = file.analysis || {};

    // Check name similarity
    const nameSimilarity = this.calculateStringSimilarity(
      file.name.toLowerCase(),
      folder.name.toLowerCase(),
    );
    score += nameSimilarity * 0.3;

    // Check description relevance
    if (folder.description && analysis.purpose) {
      const descSimilarity = this.calculateStringSimilarity(
        analysis.purpose.toLowerCase(),
        folder.description.toLowerCase(),
      );
      score += descSimilarity * 0.3;
    }

    // Check category match
    if (
      analysis.category &&
      folder.name.toLowerCase().includes(analysis.category.toLowerCase())
    ) {
      score += 0.2;
    }

    // Check keywords
    if (folder.keywords && analysis.keywords) {
      const keywordMatch = this.calculateKeywordOverlap(
        folder.keywords,
        analysis.keywords,
      );
      score += keywordMatch * 0.2;
    }

    return Math.min(1.0, score);
  }

  /**
   * Suggest improvement for a folder based on a file
   */
  suggestFolderImprovement(file, folder) {
    const improvements = [];
    const analysis = file.analysis || {};

    // Suggest adding keywords
    if (analysis.keywords && folder.keywords) {
      const newKeywords = analysis.keywords.filter(
        (k) =>
          !folder.keywords.some((fk) => fk.toLowerCase() === k.toLowerCase()),
      );
      if (newKeywords.length > 0) {
        improvements.push(
          `Add keywords: ${newKeywords.slice(0, 3).join(', ')}`,
        );
      }
    }

    // Suggest description enhancement
    if (analysis.purpose && folder.description) {
      if (folder.description.length < 50) {
        improvements.push('Enhance folder description for better matching');
      }
    }

    // Suggest subfolder creation
    if (analysis.subcategory) {
      improvements.push(`Consider subfolder: ${analysis.subcategory}`);
    }

    return (
      improvements.join('; ') || 'Folder is well-suited for this file type'
    );
  }

  /**
   * Suggest a new smart folder based on file patterns
   */
  async suggestNewSmartFolder(file, existingFolders) {
    const analysis = file.analysis || {};

    // Generate a folder name based on file analysis
    let folderName =
      analysis.category || this.getFileTypeCategory(file.extension);

    // Check if similar folder already exists
    const exists = existingFolders.some(
      (f) => f.name.toLowerCase() === folderName.toLowerCase(),
    );

    if (exists) {
      // Modify name to be more specific
      if (analysis.project) {
        folderName = `${analysis.project} - ${folderName}`;
      } else if (analysis.subcategory) {
        folderName = `${folderName} - ${analysis.subcategory}`;
      }
    }

    return {
      folder: folderName,
      path: `Documents/${folderName}`,
      score: 0.6,
      confidence: 0.6,
      description: `Suggested new folder for ${analysis.purpose || file.extension + ' files'}`,
      isNew: true,
      method: 'new_folder_suggestion',
      reasoning: 'No existing folder matches this file type well',
    };
  }

  /**
   * Identify missing categories in folder structure
   */
  identifyMissingCategories(smartFolders, files) {
    const commonCategories = [
      'Projects',
      'Archive',
      'Templates',
      'Reports',
      'Presentations',
      'Research',
      'Personal',
      'Work',
      'Financial',
      'Legal',
      'Media',
      'Downloads',
    ];

    const existingNames = smartFolders.map((f) => f.name.toLowerCase());
    const missing = [];

    for (const category of commonCategories) {
      const exists = existingNames.some((name) =>
        name.includes(category.toLowerCase()),
      );

      if (!exists) {
        // Check if files would benefit from this category
        const wouldBenefit = files.some((f) => {
          const analysis = f.analysis || {};
          return (
            (analysis.category &&
              analysis.category
                .toLowerCase()
                .includes(category.toLowerCase())) ||
            (f.name && f.name.toLowerCase().includes(category.toLowerCase()))
          );
        });

        if (wouldBenefit) {
          missing.push({
            name: category,
            reason: `Files detected that would fit in ${category} folder`,
            priority: 'high',
          });
        }
      }
    }

    return missing;
  }

  /**
   * Find overlapping folders with similar purposes
   * HIGH PRIORITY FIX #2: Add maximum iteration limit to prevent infinite loops
   * Optimized to reduce O(n²) complexity with early termination and quick rejection tests
   */
  findOverlappingFolders(smartFolders) {
    const overlaps = [];

    // HIGH PRIORITY FIX #2: Set maximum iteration limit to prevent runaway loops
    const MAX_ITERATIONS = 10000;
    const MAX_OVERLAPS = 100; // Also limit maximum number of overlaps to report
    let iterationCount = 0;

    // Optimization: Pre-compute folder signatures for quick rejection tests
    // This allows us to skip expensive similarity calculations for obviously different folders
    const folderSignatures = new Map();
    for (const folder of smartFolders) {
      const signature = {
        nameWords: new Set(folder.name.toLowerCase().split(/\s+/)),
        descWords: folder.description
          ? new Set(folder.description.toLowerCase().split(/\s+/))
          : new Set(),
        keywordSet: folder.keywords
          ? new Set(folder.keywords.map((k) => k.toLowerCase()))
          : new Set(),
      };
      folderSignatures.set(folder, signature);
    }

    for (let i = 0; i < smartFolders.length; i++) {
      const folder1 = smartFolders[i];
      const sig1 = folderSignatures.get(folder1);

      for (let j = i + 1; j < smartFolders.length; j++) {
        // HIGH PRIORITY FIX #2: Check iteration limit
        iterationCount++;
        if (iterationCount > MAX_ITERATIONS) {
          logger.warn(
            'findOverlappingFolders exceeded max iterations, stopping early',
            {
              maxIterations: MAX_ITERATIONS,
              processed: i,
              totalFolders: smartFolders.length,
            },
          );
          return overlaps;
        }

        // Also check if we've found too many overlaps
        if (overlaps.length >= MAX_OVERLAPS) {
          logger.warn(
            'Found max overlaps, stopping early to prevent memory issues',
            {
              maxOverlaps: MAX_OVERLAPS,
            },
          );
          return overlaps;
        }

        const folder2 = smartFolders[j];
        const sig2 = folderSignatures.get(folder2);

        // Optimization: Quick rejection test - if names have no common words, skip
        const hasCommonNameWords = [...sig1.nameWords].some((w) =>
          sig2.nameWords.has(w),
        );
        if (
          !hasCommonNameWords &&
          sig1.descWords.size === 0 &&
          sig2.descWords.size === 0
        ) {
          continue; // Skip expensive similarity calculation
        }

        // Optimization: Quick rejection for keywords - if no keyword overlap, likely different
        if (sig1.keywordSet.size > 0 && sig2.keywordSet.size > 0) {
          const hasCommonKeywords = [...sig1.keywordSet].some((k) =>
            sig2.keywordSet.has(k),
          );
          if (!hasCommonKeywords && !hasCommonNameWords) {
            continue; // Skip expensive similarity calculation
          }
        }

        // Only calculate full similarity if quick tests suggest potential overlap
        const similarity = this.calculateFolderSimilarity(folder1, folder2);

        if (similarity > 0.7) {
          overlaps.push({
            folders: [folder1.name, folder2.name],
            similarity,
            suggestion: `Consider merging '${folder1.name}' and '${folder2.name}'`,
          });
        }
      }
    }

    return overlaps;
  }

  /**
   * Find underutilized folders
   */
  findUnderutilizedFolders(smartFolders) {
    const underutilized = [];

    for (const folder of smartFolders) {
      const usageCount =
        this.folderUsageStats.get(folder.id || folder.name) || 0;

      if (usageCount < 3) {
        underutilized.push({
          name: folder.name,
          usageCount,
          suggestion:
            usageCount === 0
              ? `'${folder.name}' has never been used - consider removing or broadening its scope`
              : `'${folder.name}' is rarely used - consider merging with related folders`,
        });
      }
    }

    return underutilized;
  }

  /**
   * Suggest hierarchy improvements
   */
  suggestHierarchyImprovements(smartFolders) {
    const suggestions = [];

    // Group folders by potential parent categories
    const groups = {};

    for (const folder of smartFolders) {
      const parts = folder.name.split(/[\s\-_]/);
      const potentialParent = parts[0];

      if (!groups[potentialParent]) {
        groups[potentialParent] = [];
      }
      groups[potentialParent].push(folder);
    }

    // Suggest creating parent folders for groups
    for (const [parent, folders] of Object.entries(groups)) {
      if (folders.length > 2) {
        const parentExists = smartFolders.some(
          (f) => f.name.toLowerCase() === parent.toLowerCase(),
        );

        if (!parentExists) {
          suggestions.push({
            type: 'create_parent',
            parent,
            children: folders.map((f) => f.name),
            suggestion: `Create parent folder '${parent}' for related folders`,
          });
        }
      }
    }

    return suggestions;
  }

  /**
   * Calculate similarity between two folders
   */
  calculateFolderSimilarity(folder1, folder2) {
    let similarity = 0;

    // Name similarity
    similarity +=
      this.calculateStringSimilarity(
        folder1.name.toLowerCase(),
        folder2.name.toLowerCase(),
      ) * 0.4;

    // Description similarity
    if (folder1.description && folder2.description) {
      similarity +=
        this.calculateStringSimilarity(
          folder1.description.toLowerCase(),
          folder2.description.toLowerCase(),
        ) * 0.3;
    }

    // Keyword overlap
    if (folder1.keywords && folder2.keywords) {
      similarity +=
        this.calculateKeywordOverlap(folder1.keywords, folder2.keywords) * 0.3;
    }

    return similarity;
  }

  /**
   * Calculate string similarity (simple implementation)
   */
  calculateStringSimilarity(str1, str2) {
    const words1 = str1.split(/\s+/);
    const words2 = str2.split(/\s+/);

    const commonWords = words1.filter((w) => words2.includes(w)).length;
    const totalWords = Math.max(words1.length, words2.length);

    return totalWords > 0 ? commonWords / totalWords : 0;
  }

  /**
   * Calculate keyword overlap
   */
  calculateKeywordOverlap(keywords1, keywords2) {
    const set1 = new Set(keywords1.map((k) => k.toLowerCase()));
    const set2 = new Set(keywords2.map((k) => k.toLowerCase()));

    const intersection = new Set([...set1].filter((x) => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }
}

module.exports = OrganizationSuggestionService;
