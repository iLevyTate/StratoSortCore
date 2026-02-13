/**
 * Tests for Redux state migrations
 */

jest.mock('../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn()
  }
}));

import { migrateState, CURRENT_STATE_VERSION } from '../src/renderer/store/migrations';

describe('migrations', () => {
  test('CURRENT_STATE_VERSION is defined', () => {
    expect(CURRENT_STATE_VERSION).toBe(2);
  });

  test('returns state unchanged when null or undefined', () => {
    expect(migrateState(null)).toBe(null);
    expect(migrateState(undefined)).toBe(undefined);
  });

  test('returns state unchanged when already at current version', () => {
    const state = { _version: 2, files: {}, analysis: {}, ui: {} };
    expect(migrateState(state)).toEqual(state);
  });

  test('migrates v0 to v1 - ensures slices and arrays exist', () => {
    const state = { _version: 0 };
    const migrated = migrateState(state);

    expect(migrated._version).toBe(2);
    expect(migrated.ui).toEqual({});
    expect(migrated.files).toBeDefined();
    expect(migrated.analysis).toBeDefined();
    expect(Array.isArray(migrated.files.selectedFiles)).toBe(true);
    expect(Array.isArray(migrated.files.smartFolders)).toBe(true);
    expect(Array.isArray(migrated.files.organizedFiles)).toBe(true);
    expect(Array.isArray(migrated.analysis.results)).toBe(true);
  });

  test('migrates v1 to v2 - removes deprecated isAnalyzing from ui', () => {
    const state = {
      _version: 1,
      ui: { isAnalyzing: true, otherKey: 'keep' },
      files: {},
      analysis: {}
    };
    const migrated = migrateState(state);

    expect(migrated._version).toBe(2);
    expect(migrated.ui.isAnalyzing).toBeUndefined();
    expect(migrated.ui.otherKey).toBe('keep');
  });

  test('handles legacy state without version tag (assumes v0)', () => {
    const state = { files: { selectedFiles: null } };
    const migrated = migrateState(state);

    expect(migrated._version).toBe(2);
    expect(Array.isArray(migrated.files.selectedFiles)).toBe(true);
  });

  test('returns null on migration error to force state reset', () => {
    const state = {
      _version: 0,
      files: {
        get selectedFiles() {
          throw new Error('cannot read');
        }
      }
    };
    const migrated = migrateState(state);

    expect(migrated).toBeNull();
  });
});
