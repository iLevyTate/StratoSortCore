/**
 * Structured Error System for AI-First Document Analysis
 * Provides operational error handling with actionable user guidance
 */

class AnalysisError extends Error {
  constructor(code, metadata = {}) {
    // Extract cause from metadata if provided (for error cause chaining)
    const { cause, ...restMetadata } = metadata;

    // Call super with cause option for proper error chain (ES2022+)
    super(undefined, cause ? { cause } : undefined);

    this.name = 'AnalysisError';
    this.code = code;
    this.metadata = restMetadata;
    this.isOperational = true;
    this.timestamp = new Date().toISOString();

    // Store cause reference for environments that don't support Error cause option
    if (cause && !this.cause) {
      this.cause = cause;
    }

    // Set error message based on code
    this.message = this.generateMessage();
  }

  generateMessage() {
    const messages = {
      PDF_PROCESSING_FAILURE: 'Failed to extract text from PDF document',
      IMAGE_ANALYSIS_FAILURE: 'Failed to analyze image content',
      MODEL_NOT_INSTALLED: `AI model not found: ${this.metadata.requiredModel}`,
      AI_ENGINE_CONNECTION_FAILURE: 'AI engine unavailable or failed to initialize',
      DOCUMENT_ANALYSIS_FAILURE: 'Document analysis failed',
      PDF_NO_TEXT_CONTENT: 'PDF contains no extractable text',
      MODEL_VERIFICATION_FAILED: 'Failed to verify AI model availability',
      DEPENDENCY_MISSING: `Required dependency missing: ${this.metadata.dependency}`,
      FILE_TYPE_UNSUPPORTED: `Unsupported file type: ${this.metadata.fileType}`,
      FILE_TOO_LARGE: 'File size exceeds processing limits'
    };

    return messages[this.code] || 'Unknown analysis error';
  }

  getUserFriendlyMessage() {
    const userMessages = {
      PDF_PROCESSING_FAILURE:
        "This PDF file couldn't be processed. It may be corrupted or password-protected.",
      IMAGE_ANALYSIS_FAILURE:
        "This image couldn't be analyzed. Please check the file format and try again.",
      MODEL_NOT_INSTALLED: `Missing AI model: ${this.metadata.requiredModel}. Please install it to continue.`,
      AI_ENGINE_CONNECTION_FAILURE: 'AI engine unavailable. Check Settings > Models and try again.',
      DOCUMENT_ANALYSIS_FAILURE: 'Failed to analyze this document. Please check the file format.',
      PDF_NO_TEXT_CONTENT: 'This PDF appears to be image-based. Try using image analysis instead.',
      MODEL_VERIFICATION_FAILED: 'AI model verification failed. Please check your model downloads.',
      DEPENDENCY_MISSING: `System component missing: ${this.metadata.dependency}. Please reinstall the application.`,
      FILE_TYPE_UNSUPPORTED: `File type "${this.metadata.fileType}" is not supported for AI analysis.`,
      FILE_TOO_LARGE: 'File is too large for processing. Please use a smaller file.'
    };

    return userMessages[this.code] || 'An unexpected error occurred during analysis.';
  }

  getActionableSteps() {
    const actions = {
      MODEL_NOT_INSTALLED: ['Open Settings > Models and download the missing model'],
      AI_ENGINE_CONNECTION_FAILURE: ['Check Settings > Models', 'Restart the app'],
      DEPENDENCY_MISSING: [
        `Check that ${this.metadata.dependency} is installed correctly`,
        'Restart the application',
        'Reinstall the application if the issue persists'
      ],
      PDF_NO_TEXT_CONTENT: ['Try image analysis instead', 'Convert PDF to text format'],
      FILE_TYPE_UNSUPPORTED: [
        'Convert file to supported format',
        'Check supported file types in documentation'
      ],
      FILE_TOO_LARGE: ['Use smaller files', 'Increase file size limit in settings']
    };

    return actions[this.code] || [];
  }
}

class ModelMissingError extends AnalysisError {
  constructor(modelName) {
    super('MODEL_NOT_INSTALLED', {
      requiredModel: modelName,
      installCommand: `Download model in Settings > Models: ${modelName}`,
      category: 'model'
    });
  }
}

class DependencyMissingError extends AnalysisError {
  constructor(dependencyName) {
    super('DEPENDENCY_MISSING', {
      dependency: dependencyName,
      installCommand: `Install via Settings or check documentation for: ${dependencyName}`,
      category: 'dependency'
    });
  }
}

/**
 * Thrown when the in-process AI engine fails to initialize or run inference.
 * Named for backward compatibility (was HTTP-based, now in-process).
 */
class AiEngineConnectionError extends AnalysisError {
  constructor(details = {}) {
    super('AI_ENGINE_CONNECTION_FAILURE', {
      category: 'ai_engine',
      ...details
    });
  }
}

class FileProcessingError extends AnalysisError {
  constructor(code, fileName, additionalMetadata = {}) {
    const safeFileName = typeof fileName === 'string' ? fileName : String(fileName || '');
    super(code, {
      fileName: safeFileName,
      fileExtension: require('path').extname(safeFileName),
      ...additionalMetadata
    });
  }
}

module.exports = {
  AnalysisError,
  ModelMissingError,
  DependencyMissingError,
  AiEngineConnectionError,
  FileProcessingError
};
