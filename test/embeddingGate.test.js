// Mock logger
jest.mock('../src/shared/logger', () => {
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  };
  return { logger, createLogger: jest.fn(() => logger) };
});

describe('embeddingGate.shouldEmbed', () => {
  test('disables analysis-stage embedding when timing=after_organize', async () => {
    jest.resetModules();

    jest.doMock('../src/main/services/ServiceContainer', () => ({
      container: {
        tryResolve: () => ({
          load: async () => ({ embeddingTiming: 'after_organize', defaultEmbeddingPolicy: 'embed' })
        })
      },
      ServiceIds: { SETTINGS: 'SETTINGS' }
    }));

    const { shouldEmbed } = require('../src/main/services/embedding/embeddingGate');

    await expect(shouldEmbed({ stage: 'analysis' })).resolves.toMatchObject({ shouldEmbed: false });
    await expect(shouldEmbed({ stage: 'final' })).resolves.toMatchObject({ shouldEmbed: true });
  });

  test('policy override skip/web_only disables embedding regardless of timing', async () => {
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

    await expect(shouldEmbed({ stage: 'analysis', policyOverride: 'skip' })).resolves.toMatchObject(
      {
        shouldEmbed: false,
        policy: 'skip'
      }
    );
    await expect(
      shouldEmbed({ stage: 'final', policyOverride: 'web_only' })
    ).resolves.toMatchObject({ shouldEmbed: false, policy: 'web_only' });
  });

  test('manual timing disables embedding for all stages', async () => {
    jest.resetModules();

    jest.doMock('../src/main/services/ServiceContainer', () => ({
      container: {
        tryResolve: () => ({
          load: async () => ({ embeddingTiming: 'manual', defaultEmbeddingPolicy: 'embed' })
        })
      },
      ServiceIds: { SETTINGS: 'SETTINGS' }
    }));

    const { shouldEmbed } = require('../src/main/services/embedding/embeddingGate');

    await expect(shouldEmbed({ stage: 'analysis' })).resolves.toMatchObject({ shouldEmbed: false });
    await expect(shouldEmbed({ stage: 'final' })).resolves.toMatchObject({ shouldEmbed: false });
  });
});
