/**
 * Tests for AnalysisError
 * Tests analysis-specific error handling and user guidance
 */

describe('AnalysisError', () => {
  let AnalysisError;
  let ModelMissingError;
  let DependencyMissingError;
  let OllamaConnectionError;
  let FileProcessingError;

  beforeEach(() => {
    jest.resetModules();
    const module = require('../src/main/errors/AnalysisError');
    AnalysisError = module.AnalysisError;
    ModelMissingError = module.ModelMissingError;
    DependencyMissingError = module.DependencyMissingError;
    OllamaConnectionError = module.OllamaConnectionError;
    FileProcessingError = module.FileProcessingError;
  });

  describe('AnalysisError base class', () => {
    test('creates error with code and metadata', () => {
      const error = new AnalysisError('PDF_PROCESSING_FAILURE', {
        fileName: 'test.pdf'
      });

      expect(error.name).toBe('AnalysisError');
      expect(error.code).toBe('PDF_PROCESSING_FAILURE');
      expect(error.metadata.fileName).toBe('test.pdf');
      expect(error.isOperational).toBe(true);
    });

    test('includes timestamp', () => {
      const error = new AnalysisError('PDF_PROCESSING_FAILURE', {});

      expect(error.timestamp).toBeDefined();
      expect(new Date(error.timestamp)).toBeInstanceOf(Date);
    });

    test('generates message for PDF processing failure', () => {
      const error = new AnalysisError('PDF_PROCESSING_FAILURE', {});

      expect(error.message).toContain('PDF');
    });

    test('generates message for image analysis failure', () => {
      const error = new AnalysisError('IMAGE_ANALYSIS_FAILURE', {});

      expect(error.message).toContain('image');
    });

    test('generates message for model not installed', () => {
      const error = new AnalysisError('MODEL_NOT_INSTALLED', {
        requiredModel: 'llama3.2'
      });

      expect(error.message).toContain('llama3.2');
    });

    test('generates default message for unknown code', () => {
      const error = new AnalysisError('UNKNOWN_CODE', {});

      expect(error.message).toBe('Unknown analysis error');
    });
  });

  describe('getUserFriendlyMessage', () => {
    test('returns user-friendly message for PDF failure', () => {
      const error = new AnalysisError('PDF_PROCESSING_FAILURE', {});

      const message = error.getUserFriendlyMessage();

      expect(message).toContain('PDF');
      expect(message).toContain('corrupted');
    });

    test('returns user-friendly message for Ollama connection failure', () => {
      const error = new AnalysisError('OLLAMA_CONNECTION_FAILURE', {});

      const message = error.getUserFriendlyMessage();

      expect(message).toContain('AI service');
      expect(message).toContain('Ollama');
    });

    test('returns user-friendly message for file too large', () => {
      const error = new AnalysisError('FILE_TOO_LARGE', {});

      const message = error.getUserFriendlyMessage();

      expect(message).toContain('too large');
    });

    test('returns default message for unknown code', () => {
      const error = new AnalysisError('UNKNOWN_CODE', {});

      const message = error.getUserFriendlyMessage();

      expect(message).toContain('unexpected error');
    });
  });

  describe('getActionableSteps', () => {
    test('returns install command for model not installed', () => {
      const error = new AnalysisError('MODEL_NOT_INSTALLED', {
        requiredModel: 'llama3.2'
      });

      const steps = error.getActionableSteps();

      expect(steps).toContain('ollama pull llama3.2');
    });

    test('returns start command for Ollama connection failure', () => {
      const error = new AnalysisError('OLLAMA_CONNECTION_FAILURE', {});

      const steps = error.getActionableSteps();

      expect(steps).toContain('ollama serve');
    });

    test('returns npm install for dependency missing', () => {
      const error = new AnalysisError('DEPENDENCY_MISSING', {
        dependency: 'pdf-parse'
      });

      const steps = error.getActionableSteps();

      expect(steps.some((s) => s.includes('npm install'))).toBe(true);
    });

    test('returns empty array for unknown code', () => {
      const error = new AnalysisError('UNKNOWN_CODE', {});

      const steps = error.getActionableSteps();

      expect(steps).toEqual([]);
    });
  });

  describe('ModelMissingError', () => {
    test('creates error with model name', () => {
      const error = new ModelMissingError('llama3.2');

      expect(error.code).toBe('MODEL_NOT_INSTALLED');
      expect(error.metadata.requiredModel).toBe('llama3.2');
      expect(error.metadata.installCommand).toBe('ollama pull llama3.2');
      expect(error.metadata.category).toBe('model');
    });

    test('message includes model name', () => {
      const error = new ModelMissingError('mistral');

      expect(error.message).toContain('mistral');
    });

    test('user message includes model name', () => {
      const error = new ModelMissingError('codellama');

      expect(error.getUserFriendlyMessage()).toContain('codellama');
    });
  });

  describe('DependencyMissingError', () => {
    test('creates error with dependency name', () => {
      const error = new DependencyMissingError('pdf-parse');

      expect(error.code).toBe('DEPENDENCY_MISSING');
      expect(error.metadata.dependency).toBe('pdf-parse');
      expect(error.metadata.installCommand).toBe('npm install pdf-parse');
      expect(error.metadata.category).toBe('dependency');
    });

    test('message includes dependency name', () => {
      const error = new DependencyMissingError('sharp');

      expect(error.message).toContain('sharp');
    });
  });

  describe('OllamaConnectionError', () => {
    test('creates error with default host', () => {
      const error = new OllamaConnectionError();

      expect(error.code).toBe('OLLAMA_CONNECTION_FAILURE');
      expect(error.metadata.host).toBe('http://127.0.0.1:11434');
      expect(error.metadata.category).toBe('connection');
    });

    test('creates error with custom host', () => {
      const error = new OllamaConnectionError('http://localhost:8080');

      expect(error.metadata.host).toBe('http://localhost:8080');
    });
  });

  describe('FileProcessingError', () => {
    test('creates error with file info', () => {
      const error = new FileProcessingError('PDF_PROCESSING_FAILURE', 'document.pdf');

      expect(error.code).toBe('PDF_PROCESSING_FAILURE');
      expect(error.metadata.fileName).toBe('document.pdf');
      expect(error.metadata.fileExtension).toBe('.pdf');
    });

    test('creates error with additional metadata', () => {
      const error = new FileProcessingError('IMAGE_ANALYSIS_FAILURE', 'photo.jpg', {
        dimensions: '1920x1080'
      });

      expect(error.metadata.dimensions).toBe('1920x1080');
    });

    test('extracts file extension', () => {
      const error = new FileProcessingError('FILE_TYPE_UNSUPPORTED', 'archive.tar.gz');

      expect(error.metadata.fileExtension).toBe('.gz');
    });
  });

  describe('error inheritance', () => {
    test('ModelMissingError extends AnalysisError', () => {
      const error = new ModelMissingError('llama3.2');

      expect(error).toBeInstanceOf(AnalysisError);
      expect(error).toBeInstanceOf(Error);
    });

    test('DependencyMissingError extends AnalysisError', () => {
      const error = new DependencyMissingError('pdf-parse');

      expect(error).toBeInstanceOf(AnalysisError);
    });

    test('OllamaConnectionError extends AnalysisError', () => {
      const error = new OllamaConnectionError();

      expect(error).toBeInstanceOf(AnalysisError);
    });

    test('FileProcessingError extends AnalysisError', () => {
      const error = new FileProcessingError('PDF_PROCESSING_FAILURE', 'test.pdf');

      expect(error).toBeInstanceOf(AnalysisError);
    });
  });
});
