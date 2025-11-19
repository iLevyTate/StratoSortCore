const path = require('path');
const { logger } = require('../../shared/logger');

logger.setContext('FileAnalysisService');

class FileAnalysisService {
  constructor(ollamaService = null) {
    this.ollamaService = ollamaService;
    this.fileAnalysisCache = new Map();
    this.MAX_FILE_CACHE = 500;
  }

  setFileCache(signature, value) {
    if (!signature) return;
    this.fileAnalysisCache.set(signature, value);
    if (this.fileAnalysisCache.size > this.MAX_FILE_CACHE) {
      const firstKey = this.fileAnalysisCache.keys().next().value;
      this.fileAnalysisCache.delete(firstKey);
    }
  }

  async analyze(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    const imageExtensions = [
      '.jpg',
      '.jpeg',
      '.png',
      '.gif',
      '.bmp',
      '.webp',
      '.svg',
      '.tiff',
    ];
    if (imageExtensions.includes(extension)) {
      return this.analyzeImage(filePath);
    } else {
      return this.analyzeDocument(filePath);
    }
  }

  async analyzeDocument(filePath, smartFolders = []) {
    const {
      analyzeDocumentFile,
    } = require('../analysis/ollamaDocumentAnalysis');
    return await analyzeDocumentFile(filePath, smartFolders);
  }

  async analyzeImage(filePath, smartFolders = []) {
    const { analyzeImageFile } = require('../analysis/ollamaImageAnalysis');
    return await analyzeImageFile(filePath, smartFolders);
  }
}

module.exports = { FileAnalysisService };
