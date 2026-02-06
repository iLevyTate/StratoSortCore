/**
 * Tests for AnalysisError
 */

describe('AnalysisError', () => {
  let AnalysisError;
  let ModelMissingError;
  let DependencyMissingError;
  let AiEngineConnectionError;
  let FileProcessingError;

  beforeEach(() => {
    jest.resetModules();
    const module = require('../src/main/errors/AnalysisError');
    AnalysisError = module.AnalysisError;
    ModelMissingError = module.ModelMissingError;
    DependencyMissingError = module.DependencyMissingError;
    AiEngineConnectionError = module.AiEngineConnectionError;
    FileProcessingError = module.FileProcessingError;
  });

  test('creates error with code and metadata', () => {
    const error = new AnalysisError('PDF_PROCESSING_FAILURE', { fileName: 'test.pdf' });
    expect(error.name).toBe('AnalysisError');
    expect(error.code).toBe('PDF_PROCESSING_FAILURE');
    expect(error.metadata.fileName).toBe('test.pdf');
  });

  test('provides AI engine connection guidance', () => {
    const error = new AiEngineConnectionError();
    const message = error.getUserFriendlyMessage();
    const steps = error.getActionableSteps();
    expect(message).toContain('AI engine');
    expect(steps).toContain('Check Settings > Models');
  });

  test('model missing error formats message', () => {
    const error = new ModelMissingError('llama3.2');
    expect(error.getUserFriendlyMessage()).toContain('Missing AI model');
  });

  test('file processing error includes file name', () => {
    const error = new FileProcessingError('FILE_TOO_LARGE', 'big.pdf');
    expect(error.metadata.fileName).toBe('big.pdf');
  });

  test('dependency missing error includes dependency', () => {
    const error = new DependencyMissingError('sharp');
    expect(error.metadata.dependency).toBe('sharp');
  });
});
