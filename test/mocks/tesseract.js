/**
 * Mock for tesseract.js package
 * Provides test-friendly mocks for OCR functionality
 */

const mockWorker = {
  recognize: jest.fn().mockResolvedValue({
    data: { text: 'Mock OCR extracted text from image' }
  }),
  terminate: jest.fn().mockResolvedValue(),
  loadLanguage: jest.fn().mockResolvedValue(),
  initialize: jest.fn().mockResolvedValue(),
  reinitialize: jest.fn().mockResolvedValue(),
  setParameters: jest.fn().mockResolvedValue()
};

const createWorker = jest.fn().mockResolvedValue(mockWorker);

module.exports = { createWorker, __mockWorker: mockWorker };
