/**
 * Edge-case tests for embeddingGate.shouldEmbed
 *
 * Covers:
 *  - Unknown stage fails closed (returns shouldEmbed: false)
 *  - Null/undefined params handled gracefully
 *  - normalizeTiming and normalizePolicy return defaults for invalid values
 *  - Default timing (during_analysis) enables analysis-stage embedding
 */

jest.mock('../src/shared/logger', () => {
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  };
  return { logger, createLogger: jest.fn(() => logger) };
});

describe('embeddingGate edge cases', () => {
  test('unknown stage fails closed', async () => {
    jest.resetModules();

    jest.doMock('../src/main/services/ServiceContainer', () => ({
      container: {
        tryResolve: () => ({
          load: async () => ({
            embeddingTiming: 'during_analysis',
            defaultEmbeddingPolicy: 'embed'
          })
        })
      },
      ServiceIds: { SETTINGS: 'SETTINGS' }
    }));

    const { shouldEmbed } = require('../src/main/services/embedding/embeddingGate');

    const result = await shouldEmbed({ stage: 'unknown_stage' });
    expect(result.shouldEmbed).toBe(false);
    expect(result.timing).toBe('during_analysis');
    expect(result.policy).toBe('embed');
  });

  test('null params handled gracefully (fail closed)', async () => {
    jest.resetModules();

    jest.doMock('../src/main/services/ServiceContainer', () => ({
      container: {
        tryResolve: () => ({
          load: async () => ({
            embeddingTiming: 'during_analysis',
            defaultEmbeddingPolicy: 'embed'
          })
        })
      },
      ServiceIds: { SETTINGS: 'SETTINGS' }
    }));

    const { shouldEmbed } = require('../src/main/services/embedding/embeddingGate');

    // null params
    const result = await shouldEmbed(null);
    expect(result.shouldEmbed).toBe(false);

    // undefined params
    const result2 = await shouldEmbed(undefined);
    expect(result2.shouldEmbed).toBe(false);

    // empty object (no stage)
    const result3 = await shouldEmbed({});
    expect(result3.shouldEmbed).toBe(false);
  });

  test('default timing (during_analysis) enables analysis-stage embedding', async () => {
    jest.resetModules();

    jest.doMock('../src/main/services/ServiceContainer', () => ({
      container: {
        tryResolve: () => ({
          load: async () => ({
            embeddingTiming: 'during_analysis',
            defaultEmbeddingPolicy: 'embed'
          })
        })
      },
      ServiceIds: { SETTINGS: 'SETTINGS' }
    }));

    const { shouldEmbed } = require('../src/main/services/embedding/embeddingGate');

    const result = await shouldEmbed({ stage: 'analysis' });
    expect(result.shouldEmbed).toBe(true);
    expect(result.timing).toBe('during_analysis');
  });

  test('during_analysis timing disables final-stage embedding', async () => {
    jest.resetModules();

    jest.doMock('../src/main/services/ServiceContainer', () => ({
      container: {
        tryResolve: () => ({
          load: async () => ({
            embeddingTiming: 'during_analysis',
            defaultEmbeddingPolicy: 'embed'
          })
        })
      },
      ServiceIds: { SETTINGS: 'SETTINGS' }
    }));

    const { shouldEmbed } = require('../src/main/services/embedding/embeddingGate');

    const result = await shouldEmbed({ stage: 'final' });
    expect(result.shouldEmbed).toBe(false);
  });
});

describe('embeddingGate normalizers', () => {
  test('normalizeTiming returns default for invalid values', () => {
    jest.resetModules();

    jest.doMock('../src/main/services/ServiceContainer', () => ({
      container: { tryResolve: () => null },
      ServiceIds: { SETTINGS: 'SETTINGS' }
    }));

    const {
      normalizeTiming,
      normalizePolicy
    } = require('../src/main/services/embedding/embeddingGate');

    expect(normalizeTiming('invalid')).toBe('during_analysis');
    expect(normalizeTiming(null)).toBe('during_analysis');
    expect(normalizeTiming(undefined)).toBe('during_analysis');
    expect(normalizeTiming('')).toBe('during_analysis');
    expect(normalizeTiming(42)).toBe('during_analysis');

    // Valid values pass through
    expect(normalizeTiming('during_analysis')).toBe('during_analysis');
    expect(normalizeTiming('after_organize')).toBe('after_organize');
    expect(normalizeTiming('manual')).toBe('manual');
  });

  test('normalizePolicy returns default for invalid values', () => {
    jest.resetModules();

    jest.doMock('../src/main/services/ServiceContainer', () => ({
      container: { tryResolve: () => null },
      ServiceIds: { SETTINGS: 'SETTINGS' }
    }));

    const { normalizePolicy } = require('../src/main/services/embedding/embeddingGate');

    expect(normalizePolicy('invalid')).toBe('embed');
    expect(normalizePolicy(null)).toBe('embed');
    expect(normalizePolicy(undefined)).toBe('embed');

    // Valid values pass through
    expect(normalizePolicy('embed')).toBe('embed');
    expect(normalizePolicy('skip')).toBe('skip');
    expect(normalizePolicy('web_only')).toBe('web_only');
  });

  test('shouldEmbed gracefully handles settings service failure', async () => {
    jest.resetModules();

    jest.doMock('../src/main/services/ServiceContainer', () => ({
      container: {
        tryResolve: () => ({
          load: async () => {
            throw new Error('Settings DB corrupted');
          }
        })
      },
      ServiceIds: { SETTINGS: 'SETTINGS' }
    }));

    const { shouldEmbed } = require('../src/main/services/embedding/embeddingGate');

    // Should fall back to defaults (during_analysis + embed) and not throw
    const result = await shouldEmbed({ stage: 'analysis' });
    expect(result.shouldEmbed).toBe(true);
    expect(result.timing).toBe('during_analysis');
    expect(result.policy).toBe('embed');
  });
});
