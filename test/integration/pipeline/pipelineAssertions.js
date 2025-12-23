/**
 * Custom Jest Matchers for Pipeline Testing
 *
 * Provides custom assertions for validating pipeline stages
 * and analysis results.
 *
 * @module test/integration/pipeline/pipelineAssertions
 */

const { EMBEDDING_DIMENSION } = require('./pipelineMocks');

/**
 * Custom matchers for pipeline testing
 */
const pipelineMatchers = {
  /**
   * Assert that an analysis result has all required fields
   */
  toBeValidAnalysisResult(received) {
    const requiredFields = ['purpose', 'category', 'keywords', 'confidence', 'suggestedName'];
    const missingFields = requiredFields.filter((field) => !(field in received));

    if (missingFields.length > 0) {
      return {
        pass: false,
        message: () => `Expected analysis result to have fields: ${missingFields.join(', ')}`
      };
    }

    // Validate types
    const typeErrors = [];
    if (typeof received.purpose !== 'string') typeErrors.push('purpose should be string');
    if (typeof received.category !== 'string') typeErrors.push('category should be string');
    if (!Array.isArray(received.keywords)) typeErrors.push('keywords should be array');
    if (typeof received.confidence !== 'number') typeErrors.push('confidence should be number');
    if (typeof received.suggestedName !== 'string')
      typeErrors.push('suggestedName should be string');

    if (typeErrors.length > 0) {
      return {
        pass: false,
        message: () => `Analysis result type errors: ${typeErrors.join(', ')}`
      };
    }

    // Validate confidence range
    if (received.confidence < 0 || received.confidence > 100) {
      return {
        pass: false,
        message: () => `Confidence should be 0-100, got ${received.confidence}`
      };
    }

    return {
      pass: true,
      message: () => 'Analysis result is valid'
    };
  },

  /**
   * Assert that an embedding vector has correct dimensions
   */
  toBeValidEmbeddingVector(received, expectedDimension = EMBEDDING_DIMENSION) {
    if (!Array.isArray(received)) {
      return {
        pass: false,
        message: () => `Expected embedding to be an array, got ${typeof received}`
      };
    }

    if (received.length !== expectedDimension) {
      return {
        pass: false,
        message: () => `Expected embedding dimension ${expectedDimension}, got ${received.length}`
      };
    }

    const hasNonNumbers = received.some((v) => typeof v !== 'number' || isNaN(v));
    if (hasNonNumbers) {
      return {
        pass: false,
        message: () => 'Embedding contains non-numeric values'
      };
    }

    return {
      pass: true,
      message: () => `Embedding vector is valid with dimension ${expectedDimension}`
    };
  },

  /**
   * Assert that folder matches are properly structured
   */
  toBeValidFolderMatches(received) {
    if (!Array.isArray(received)) {
      return {
        pass: false,
        message: () => `Expected folder matches to be an array, got ${typeof received}`
      };
    }

    for (let i = 0; i < received.length; i++) {
      const match = received[i];

      if (!match.name || typeof match.name !== 'string') {
        return {
          pass: false,
          message: () => `Folder match ${i} missing valid 'name' field`
        };
      }

      if (typeof match.score !== 'number' || match.score < 0 || match.score > 1) {
        return {
          pass: false,
          message: () => `Folder match ${i} has invalid score: ${match.score}`
        };
      }
    }

    // Check descending score order
    for (let i = 1; i < received.length; i++) {
      if (received[i].score > received[i - 1].score) {
        return {
          pass: false,
          message: () => 'Folder matches should be sorted by score descending'
        };
      }
    }

    return {
      pass: true,
      message: () => 'Folder matches are valid'
    };
  },

  /**
   * Assert that a service was called with expected parameters
   */
  toHaveBeenCalledWithFileContext(received, fixture) {
    if (!jest.isMockFunction(received)) {
      return {
        pass: false,
        message: () => 'Expected a mock function'
      };
    }

    if (received.mock.calls.length === 0) {
      return {
        pass: false,
        message: () => 'Expected mock to have been called'
      };
    }

    // Check if any call contains file-related context
    const hasFileContext = received.mock.calls.some((call) => {
      const args = call.join(' ');
      return args.includes(fixture.name) || args.includes(fixture.extension);
    });

    if (!hasFileContext) {
      return {
        pass: false,
        message: () => `Expected call to include file context for ${fixture.name}`
      };
    }

    return {
      pass: true,
      message: () => 'Mock was called with file context'
    };
  },

  /**
   * Assert that pipeline stages were called in order
   */
  toHaveCalledPipelineInOrder(received, expectedOrder) {
    const callOrder = received.map((mock) => {
      if (!jest.isMockFunction(mock.fn)) {
        throw new Error(`Expected mock function for stage: ${mock.name}`);
      }
      return {
        name: mock.name,
        called: mock.fn.mock.calls.length > 0,
        timestamp: mock.fn.mock.invocationCallOrder[0] || Infinity
      };
    });

    // Check all were called
    const uncalled = callOrder.filter((stage) => !stage.called);
    if (uncalled.length > 0) {
      return {
        pass: false,
        message: () => `Pipeline stages not called: ${uncalled.map((s) => s.name).join(', ')}`
      };
    }

    // Check order
    const sorted = [...callOrder].sort((a, b) => a.timestamp - b.timestamp);
    const actualOrder = sorted.map((s) => s.name);

    const orderMatches = expectedOrder.every((name, i) => actualOrder[i] === name);

    if (!orderMatches) {
      return {
        pass: false,
        message: () =>
          `Expected order: ${expectedOrder.join(' -> ')}\nActual order: ${actualOrder.join(' -> ')}`
      };
    }

    return {
      pass: true,
      message: () => 'Pipeline stages called in correct order'
    };
  },

  /**
   * Assert that an image analysis result has image-specific fields
   */
  toBeValidImageAnalysisResult(received) {
    // First check base analysis fields
    const baseResult = pipelineMatchers.toBeValidAnalysisResult(received);
    if (!baseResult.pass) {
      return baseResult;
    }

    // Check image-specific fields
    const imageFields = ['content_type', 'has_text', 'colors'];
    const missingFields = imageFields.filter((field) => !(field in received));

    if (missingFields.length > 0) {
      return {
        pass: false,
        message: () => `Expected image analysis to have fields: ${missingFields.join(', ')}`
      };
    }

    if (typeof received.has_text !== 'boolean') {
      return {
        pass: false,
        message: () => 'has_text should be boolean'
      };
    }

    if (!Array.isArray(received.colors)) {
      return {
        pass: false,
        message: () => 'colors should be array'
      };
    }

    return {
      pass: true,
      message: () => 'Image analysis result is valid'
    };
  },

  /**
   * Assert that embedding queue received correct item structure
   */
  toHaveQueuedValidEmbedding(received) {
    if (!jest.isMockFunction(received)) {
      return {
        pass: false,
        message: () => 'Expected enqueue to be a mock function'
      };
    }

    if (received.mock.calls.length === 0) {
      return {
        pass: false,
        message: () => 'Expected enqueue to have been called'
      };
    }

    const lastCall = received.mock.calls[received.mock.calls.length - 1][0];

    const requiredFields = ['id', 'vector', 'model'];
    const missingFields = requiredFields.filter((field) => !(field in lastCall));

    if (missingFields.length > 0) {
      return {
        pass: false,
        message: () => `Queued item missing fields: ${missingFields.join(', ')}`
      };
    }

    if (!lastCall.id.startsWith('file:')) {
      return {
        pass: false,
        message: () => `Expected id to start with 'file:', got: ${lastCall.id}`
      };
    }

    if (!Array.isArray(lastCall.vector)) {
      return {
        pass: false,
        message: () => 'vector should be an array'
      };
    }

    return {
      pass: true,
      message: () => 'Queued embedding is valid'
    };
  }
};

/**
 * Assertion helpers for pipeline testing
 */
const pipelineAssertions = {
  /**
   * Assert all pipeline stages were called for a document
   */
  assertDocumentPipelineComplete(mocks, fixture) {
    // Stage 1: Content extraction (if applicable)
    if (fixture.supportsContentAnalysis) {
      const extractor = getExtractorForExtension(fixture.extension, mocks.documentExtractors);
      if (extractor) {
        expect(extractor).toHaveBeenCalled();
      }
    }

    // Stage 2: Ollama analysis
    expect(mocks.ollamaService.analyzeText).toHaveBeenCalled();

    // Stage 3: Embedding generation
    expect(mocks.folderMatching.embedText).toHaveBeenCalled();

    // Stage 4: Folder matching
    expect(mocks.folderMatching.matchVectorToFolders).toHaveBeenCalled();

    // Stage 5: Queue for persistence
    expect(mocks.embeddingQueue.enqueue).toHaveBeenCalled();
  },

  /**
   * Assert all pipeline stages were called for an image
   */
  assertImagePipelineComplete(mocks) {
    // Stage 1: Image analysis with vision model
    expect(mocks.ollamaService.analyzeImage).toHaveBeenCalled();

    // Stage 2: Embedding generation
    expect(mocks.folderMatching.embedText).toHaveBeenCalled();

    // Stage 3: Folder matching
    expect(mocks.folderMatching.matchVectorToFolders).toHaveBeenCalled();

    // Stage 4: Queue for persistence
    expect(mocks.embeddingQueue.enqueue).toHaveBeenCalled();
  },

  /**
   * Assert fallback was used when Ollama is offline
   */
  assertFallbackUsed(result) {
    expect(result.extractionMethod).toMatch(/fallback|filename/i);
    expect(result.confidence).toBeLessThan(70);
    expect(result.category).toBeDefined();
    expect(result.keywords).toBeDefined();
  },

  /**
   * Assert analysis result matches expected category
   */
  assertCategoryMatches(result, expectedCategory) {
    const normalizedResult = result.category.toLowerCase();
    const normalizedExpected = expectedCategory.toLowerCase();

    expect(normalizedResult).toBe(normalizedExpected);
  },

  /**
   * Assert result contains expected keywords
   */
  assertContainsKeywords(result, expectedKeywords) {
    const resultKeywords = result.keywords.map((k) => k.toLowerCase());

    for (const keyword of expectedKeywords) {
      expect(resultKeywords).toContain(keyword.toLowerCase());
    }
  }
};

/**
 * Get the appropriate extractor for a file extension
 */
function getExtractorForExtension(extension, extractors) {
  const extensionMap = {
    '.pdf': extractors.extractTextFromPdf,
    '.docx': extractors.extractTextFromDocx,
    '.xlsx': extractors.extractTextFromXlsx,
    '.pptx': extractors.extractTextFromPptx,
    '.txt': extractors.extractTextFromTxt,
    '.html': extractors.extractTextFromHtml,
    '.xml': extractors.extractTextFromXml,
    '.csv': extractors.extractTextFromCsv,
    '.json': extractors.extractTextFromJson,
    '.eml': extractors.extractTextFromEml,
    '.rtf': extractors.extractTextFromRtf
  };

  return extensionMap[extension.toLowerCase()];
}

/**
 * Setup custom matchers in Jest
 */
function setupPipelineMatchers() {
  expect.extend(pipelineMatchers);
}

module.exports = {
  pipelineMatchers,
  pipelineAssertions,
  setupPipelineMatchers,
  getExtractorForExtension
};
