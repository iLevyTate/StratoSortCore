const path = require('path');
const { processTemplate, makeUniqueFileName } = require('./autoOrganize/namingUtils');
const { createLogger } = require('../../shared/logger');
const logger = createLogger('SemanticRenameService');

/**
 * Service for semantic file renaming.
 * Orchestrates the generation of new filenames based on AI analysis and user templates.
 */
class SemanticRenameService {
  constructor() {
    this.usedNames = new Map(); // Cache for collision detection within a batch
  }

  /**
   * Reset the internal collision cache.
   * Call this before starting a new batch operation.
   */
  resetCache() {
    this.usedNames.clear();
  }

  /**
   * Generate a new filename for a given file based on analysis results and a template.
   *
   * @param {string} filePath - The full path to the original file.
   * @param {Object} analysisResult - The analysis result object (ExtendedAnalysisSchema).
   * @param {string} template - The naming template string (e.g., "{date}_{entity}_{type}").
   * @returns {string} The new full file path (or original if no change).
   */
  generateNewName(filePath, analysisResult, template) {
    try {
      const originalDir = path.dirname(filePath);
      const originalName = path.basename(filePath);
      const extension = path.extname(originalName);

      // 1. Process the template using the analysis result
      const context = {
        originalName,
        analysis: analysisResult,
        extension
      };

      const baseNewName = processTemplate(template, context);

      // 2. Ensure uniqueness (collision handling)
      // Note: This only handles collisions within the current batch session's memory.
      // Real file system checks should happen at the point of actual renaming (fs.access),
      // but this helps pre-calculate unique names for UI preview.
      const uniqueName = makeUniqueFileName(baseNewName, this.usedNames);
      const newPath = path.join(originalDir, uniqueName);

      // Log rename decision with before/after for full traceability
      const renamed = uniqueName !== originalName;
      if (renamed) {
        logger.info('[SemanticRename] Name generated', {
          originalName,
          newName: uniqueName,
          template,
          category: analysisResult?.category,
          entity: analysisResult?.entity,
          date: analysisResult?.date,
          project: analysisResult?.project
        });
      } else {
        logger.debug('[SemanticRename] Name unchanged (template produced same name)', {
          originalName,
          template
        });
      }

      return newPath;
    } catch (error) {
      logger.error('[SemanticRename] Failed to generate new name', {
        file: filePath,
        error: error.message
      });
      return filePath; // Fallback to original path on error
    }
  }
}

// Singleton instance
const semanticRenameService = new SemanticRenameService();

module.exports = {
  SemanticRenameService,
  semanticRenameService
};
