/**
 * Tests for Suggestion Ranker
 * Tests ranking, deduplication, and scoring for organization suggestions
 */

describe('Suggestion Ranker', () => {
  let rankSuggestions;
  let applySourceWeight;
  let calculateConfidence;
  let generateExplanation;
  let combineSuggestions;
  let sourceWeights;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    const module = require('../src/main/services/organization/suggestionRanker');
    rankSuggestions = module.rankSuggestions;
    applySourceWeight = module.applySourceWeight;
    calculateConfidence = module.calculateConfidence;
    generateExplanation = module.generateExplanation;
    combineSuggestions = module.combineSuggestions;
    sourceWeights = module.sourceWeights;
  });

  describe('sourceWeights', () => {
    test('defines expected weights', () => {
      expect(sourceWeights.semantic).toBe(1.2);
      expect(sourceWeights.user_pattern).toBe(1.5);
      expect(sourceWeights.strategy).toBe(1.0);
      expect(sourceWeights.llm).toBe(0.8);
      expect(sourceWeights.pattern).toBe(1.1);
      expect(sourceWeights.llm_creative).toBe(0.7);
    });
  });

  describe('rankSuggestions', () => {
    test('deduplicates by folder name', () => {
      const suggestions = [
        { folder: 'Documents', score: 0.8, confidence: 0.7 },
        { folder: 'documents', score: 0.6, confidence: 0.5 }, // Duplicate (case-insensitive)
        { folder: 'Photos', score: 0.9, confidence: 0.8 }
      ];

      const result = rankSuggestions(suggestions);

      expect(result).toHaveLength(2);
      expect(result.map((s) => s.folder.toLowerCase())).toContain('documents');
      expect(result.map((s) => s.folder.toLowerCase())).toContain('photos');
    });

    test('merges scores for duplicates (takes max)', () => {
      const suggestions = [
        { folder: 'Documents', score: 0.6, confidence: 0.5 },
        { folder: 'documents', score: 0.8, confidence: 0.7 }
      ];

      const result = rankSuggestions(suggestions);

      expect(result).toHaveLength(1);
      expect(result[0].score).toBe(0.8);
      expect(result[0].confidence).toBe(0.7);
    });

    test('sorts by weighted score', () => {
      const suggestions = [
        { folder: 'Low', score: 0.5, confidence: 0.5, source: 'strategy' },
        { folder: 'High', score: 0.5, confidence: 0.5, source: 'user_pattern' }
      ];

      const result = rankSuggestions(suggestions);

      // user_pattern has weight 1.5, strategy has 1.0
      expect(result[0].folder).toBe('High');
    });

    test('skips suggestions without folder', () => {
      const suggestions = [
        { folder: 'Documents', score: 0.8 },
        { folder: null, score: 0.9 },
        { folder: '', score: 0.7 }
      ];

      const result = rankSuggestions(suggestions);

      expect(result).toHaveLength(1);
      expect(result[0].folder).toBe('Documents');
    });

    test('adds weightedScore property', () => {
      const suggestions = [{ folder: 'Test', score: 0.8, source: 'semantic' }];

      const result = rankSuggestions(suggestions);

      expect(result[0].weightedScore).toBeDefined();
      expect(result[0].weightedScore).toBe(0.8 * 1.2); // semantic weight
    });
  });

  describe('applySourceWeight', () => {
    test('applies semantic weight', () => {
      const score = applySourceWeight({ score: 1.0, source: 'semantic' });
      expect(score).toBe(1.2);
    });

    test('applies user_pattern weight', () => {
      const score = applySourceWeight({ score: 1.0, source: 'user_pattern' });
      expect(score).toBe(1.5);
    });

    test('applies llm weight', () => {
      const score = applySourceWeight({ score: 1.0, source: 'llm' });
      expect(score).toBe(0.8);
    });

    test('returns default weight for unknown source', () => {
      const score = applySourceWeight({ score: 1.0, source: 'unknown' });
      expect(score).toBe(1.0);
    });

    test('handles missing score', () => {
      const score = applySourceWeight({ source: 'semantic' });
      expect(score).toBe(0);
    });
  });

  describe('calculateConfidence', () => {
    test('returns 0 for null suggestion', () => {
      expect(calculateConfidence(null)).toBe(0);
    });

    test('returns existing confidence', () => {
      const confidence = calculateConfidence({ confidence: 0.75 });
      expect(confidence).toBe(0.75);
    });

    test('falls back to score if no confidence', () => {
      const confidence = calculateConfidence({ score: 0.6 });
      expect(confidence).toBe(0.6);
    });

    test('boosts confidence for multiple sources', () => {
      const confidence = calculateConfidence({
        confidence: 0.7,
        sources: ['semantic', 'pattern']
      });
      expect(confidence).toBe(0.84); // 0.7 * 1.2
    });

    test('boosts confidence for user_pattern source', () => {
      const confidence = calculateConfidence({
        confidence: 0.7,
        source: 'user_pattern'
      });
      expect(confidence).toBe(0.91); // 0.7 * 1.3
    });

    test('caps confidence at 1.0', () => {
      const confidence = calculateConfidence({
        confidence: 0.9,
        source: 'user_pattern'
      });
      expect(confidence).toBeLessThanOrEqual(1.0);
    });

    test('rounds to 2 decimal places', () => {
      const confidence = calculateConfidence({ confidence: 0.333 });
      expect(confidence).toBe(0.33);
    });
  });

  describe('generateExplanation', () => {
    test('returns default message for null suggestion', () => {
      const explanation = generateExplanation(null, {});
      expect(explanation).toContain('No clear match');
    });

    test('generates semantic explanation', () => {
      const explanation = generateExplanation(
        { source: 'semantic', folder: 'Documents' },
        { extension: '.pdf' }
      );
      expect(explanation).toContain('similar');
      expect(explanation).toContain('Documents');
    });

    test('generates user_pattern explanation', () => {
      const explanation = generateExplanation({ source: 'user_pattern' }, { extension: '.pdf' });
      expect(explanation).toContain('organized similar files');
    });

    test('generates strategy explanation', () => {
      const explanation = generateExplanation(
        { source: 'strategy', strategyName: 'Project-Based' },
        { extension: '.pdf' }
      );
      expect(explanation).toContain('Project-Based');
    });

    test('generates llm explanation', () => {
      const explanation = generateExplanation({ source: 'llm' }, { extension: '.pdf' });
      expect(explanation).toContain('content and purpose');
    });

    test('generates pattern explanation', () => {
      const explanation = generateExplanation({ source: 'pattern' }, { extension: 'pdf' });
      expect(explanation).toContain('PDF');
    });

    test('generates llm_creative explanation with reasoning', () => {
      const explanation = generateExplanation(
        { source: 'llm_creative', reasoning: 'Custom reasoning here' },
        { extension: '.pdf' }
      );
      expect(explanation).toBe('Custom reasoning here');
    });

    test('falls back to generic explanation for unknown source', () => {
      const explanation = generateExplanation({ source: 'unknown_source' }, { extension: '.pdf' });
      expect(explanation).toContain('file analysis');
    });
  });

  describe('combineSuggestions', () => {
    test('combines suggestions from multiple sources', () => {
      const sources = {
        semantic: [{ folder: 'Docs', score: 0.8 }],
        pattern: [{ folder: 'Files', score: 0.7 }]
      };

      const result = combineSuggestions(sources);

      expect(result).toHaveLength(2);
      expect(result[0].source).toBe('semantic');
      expect(result[1].source).toBe('pattern');
    });

    test('handles empty sources', () => {
      const sources = {
        semantic: [],
        pattern: []
      };

      const result = combineSuggestions(sources);

      expect(result).toHaveLength(0);
    });

    test('adds source tag to each suggestion', () => {
      const sources = {
        llm: [
          { folder: 'AI', score: 0.9 },
          { folder: 'ML', score: 0.8 }
        ]
      };

      const result = combineSuggestions(sources);

      expect(result.every((s) => s.source === 'llm')).toBe(true);
    });
  });
});
