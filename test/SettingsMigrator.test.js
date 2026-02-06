jest.mock('../src/shared/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

jest.mock('../src/shared/constants', () => ({
  AI_DEFAULTS: {
    TEXT: { MODEL: 'text.gguf' },
    IMAGE: { MODEL: 'vision.gguf' },
    EMBEDDING: { MODEL: 'embed.gguf' }
  },
  SETTINGS_SCHEMA_VERSION: 3
}));

const { SettingsMigrator } = require('../src/main/services/migration/SettingsMigrator');

describe('SettingsMigrator', () => {
  test('needsMigration returns true for old version', async () => {
    const settingsService = {
      _loadRaw: jest.fn().mockResolvedValue({ settingsSchemaVersion: 1 })
    };
    const migrator = new SettingsMigrator(settingsService);
    await expect(migrator.needsMigration()).resolves.toBe(true);
  });

  test('needsMigration returns true when old keys present', async () => {
    const settingsService = {
      _loadRaw: jest
        .fn()
        .mockResolvedValue({ llamaTextModel: 'old.gguf', settingsSchemaVersion: 3 })
    };
    const migrator = new SettingsMigrator(settingsService);
    await expect(migrator.needsMigration()).resolves.toBe(true);
  });

  test('migrate updates keys and writes defaults', async () => {
    const settingsService = {
      _loadRaw: jest.fn().mockResolvedValue({
        settingsSchemaVersion: 1,
        llamaTextModel: 'old.gguf'
      }),
      save: jest.fn().mockResolvedValue()
    };
    const migrator = new SettingsMigrator(settingsService);

    const result = await migrator.migrate();

    expect(result.success).toBe(true);
    expect(settingsService.save).toHaveBeenCalledWith(
      expect.objectContaining({
        textModel: 'old.gguf',
        embeddingModel: 'embed.gguf',
        settingsSchemaVersion: 3
      })
    );
  });

  test('validateSettings reports missing required keys', async () => {
    const settingsService = {
      _loadRaw: jest.fn().mockResolvedValue({ settingsSchemaVersion: 3 })
    };
    const migrator = new SettingsMigrator(settingsService);

    const result = await migrator.validateSettings();
    expect(result.valid).toBe(false);
    expect(result.issues.join(' ')).toMatch(/textModel/);
  });
});
