const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const {
  loadConfig,
  saveConfig,
  closeSqliteStore,
  atomicWriteFile
} = require('../../src/main/services/analysisHistory/persistence');
const { createKeyValueStore } = require('../../src/main/utils/sqliteStore');

// Mock logger
const persistencePath = '../../src/main/services/analysisHistory/persistence';
const persistence = require(persistencePath);
// We can't easily mock internal requires in Node without a loader,
// so we'll just rely on the real logger (which writes to file/console).
// Since this is a manual repro script, that's fine.

async function runTests() {
  console.log('Running SQLite Persistence Robustness Tests...');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratosort-test-'));
  const configPath = path.join(tempDir, 'analysis-config.json');

  // Force SQLite backend
  process.env.STRATOSORT_ANALYSISHISTORY_BACKEND = 'sqlite';
  process.env.STRATOSORT_SQLITE_COMPRESS = 'false';
  process.env.NODE_ENV = 'production'; // bypass test check

  try {
    // --- Test 1: Migrate Legacy JSON ---
    console.log('Test 1: Migrate Legacy JSON');
    const legacyConfig = { theme: 'dark', version: 1 };
    await atomicWriteFile(configPath, JSON.stringify(legacyConfig));

    const loaded1 = await loadConfig(
      configPath,
      () => ({ theme: 'light' }),
      async () => {}
    );

    assert.deepStrictEqual(loaded1, legacyConfig, 'Should load legacy config');

    const dbPath = path.join(tempDir, 'analysis-history.db');
    assert.ok(fs.existsSync(dbPath), 'SQLite DB should be created');

    const files = fs.readdirSync(tempDir);
    const legacyFile = files.find((f) => f.startsWith('analysis-config.json.legacy.'));
    assert.ok(legacyFile, 'Legacy JSON should be renamed');
    console.log('  PASS');

    // --- Test 2: Concurrent Access ---
    console.log('Test 2: Concurrent Access');
    const dbPathShared = path.join(tempDir, 'shared.db');
    const store1 = createKeyValueStore({ dbPath: dbPathShared, tableName: 't1' });
    const store2 = createKeyValueStore({ dbPath: dbPathShared, tableName: 't2' });

    store1.set('key1', { data: 1 });
    store2.set('key2', { data: 2 });

    assert.deepStrictEqual(store1.get('key1'), { data: 1 });
    assert.deepStrictEqual(store2.get('key2'), { data: 2 });

    store1.close();
    assert.throws(() => store1.get('key1'), /Store is closed/);

    // store2 should still work
    assert.deepStrictEqual(store2.get('key2'), { data: 2 });
    store2.close();
    console.log('  PASS');

    // --- Test 3: Corruption Recovery ---
    console.log('Test 3: Corruption Recovery');
    // Ensure DB is closed from previous tests if we reused it (we didn't reuse analysis-history.db yet for corruption)
    // Close the global store from persistence
    closeSqliteStore();

    const dbPathCorrupt = path.join(tempDir, 'analysis-history.db');
    // Write junk to it
    fs.writeFileSync(dbPathCorrupt, 'JUNK JUNK JUNK');

    const loaded2 = await loadConfig(
      configPath,
      () => ({ theme: 'default' }),
      async () => {}
    );

    // Should return default
    assert.strictEqual(loaded2.theme, 'default', 'Should fall back to default on corruption');

    const files2 = fs.readdirSync(tempDir);
    const backup = files2.find((f) => f.includes('.corrupt.'));
    assert.ok(backup, 'Should create backup of corrupt DB');
    console.log('  PASS');
  } catch (err) {
    console.error('FAILED:', err);
    process.exit(1);
  } finally {
    closeSqliteStore();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_e) {
      /* ignore cleanup errors */
    }
  }
}

runTests();
