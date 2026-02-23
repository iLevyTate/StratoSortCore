#!/usr/bin/env node

/**
 * Verifies that native/runtime-critical modules load correctly.
 * Intended for CI to catch sharp-like regressions before packaging.
 */

const checks = [
  {
    name: 'sharp',
    verify: async () => {
      const sharp = require('sharp');
      const out = await sharp({
        create: {
          width: 1,
          height: 1,
          channels: 3,
          background: { r: 0, g: 0, b: 0 }
        }
      })
        .png()
        .toBuffer();
      if (!Buffer.isBuffer(out) || out.length === 0) {
        throw new Error('sharp pipeline produced empty output');
      }
    }
  },
  {
    name: 'better-sqlite3',
    verify: async () => {
      const BetterSqlite3 = require('better-sqlite3');
      const db = new BetterSqlite3(':memory:');
      try {
        db.exec('CREATE TABLE smoke_test (id INTEGER PRIMARY KEY, name TEXT)');
        db.prepare('INSERT INTO smoke_test (name) VALUES (?)').run('ok');
        const row = db.prepare('SELECT name FROM smoke_test WHERE id = 1').get();
        if (row?.name !== 'ok') {
          throw new Error('better-sqlite3 query returned unexpected result');
        }
      } finally {
        db.close();
      }
    }
  },
  {
    name: '@napi-rs/canvas',
    verify: async () => {
      const canvas = require('@napi-rs/canvas');
      const c = canvas.createCanvas(2, 2);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#00ff00';
      ctx.fillRect(0, 0, 2, 2);
      const pngBuffer = c.toBuffer('image/png');
      if (!Buffer.isBuffer(pngBuffer) || pngBuffer.length === 0) {
        throw new Error('@napi-rs/canvas produced empty PNG');
      }
    }
  },
  {
    name: 'lz4-napi',
    verify: async () => {
      const lz4 = require('lz4-napi');
      const source = Buffer.from('stratosort-smoke-test', 'utf8');
      const compressed = lz4.compressSync(source);
      const restored = lz4.uncompressSync(compressed);
      if (!restored.equals(source)) {
        throw new Error('lz4-napi decompressed output mismatch');
      }
    }
  },
  {
    name: 'node-llama-cpp',
    verify: async () => {
      const llama = await import('node-llama-cpp');
      if (!llama || typeof llama.getLlama !== 'function') {
        throw new Error('node-llama-cpp missing getLlama() export');
      }
    }
  }
];

async function run() {
  const failures = [];

  for (const check of checks) {
    try {
      await check.verify();

      console.log(`OK: ${check.name}`);
    } catch (error) {
      failures.push({ name: check.name, error: error?.message || String(error) });

      console.error(`FAIL: ${check.name} -> ${error?.message || error}`);
    }
  }

  if (failures.length > 0) {
    console.error(`Native module verification failed (${failures.length} issue(s)).`);
    process.exit(1);
  }

  console.log(`Native module verification passed (${checks.length} checks).`);
}

run().catch((error) => {
  console.error(`Native module verification crashed: ${error?.message || error}`);
  process.exit(1);
});
