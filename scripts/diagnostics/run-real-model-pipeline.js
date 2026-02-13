#!/usr/bin/env node
/**
 * Real Model Pipeline Diagnostics
 *
 * Runs end-to-end checks using actual GGUF models and real fixture files.
 * This is intentionally heavy and meant for local debugging.
 *
 * Usage:
 *   node scripts/diagnostics/run-real-model-pipeline.js
 *
 * Optional env:
 *   AI_OCR_TIMEOUT=60000
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const fsp = require('fs').promises;
const Module = require('module');
const { withAbortableTimeout } = require('../../src/shared/promiseUtils');

const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');

const REQUIRED_MODELS = [
  'nomic-embed-text-v1.5-Q8_0.gguf',
  'Mistral-7B-Instruct-v0.3-Q4_K_M.gguf',
  'llava-v1.6-mistral-7b-Q4_K_M.gguf',
  'mmproj-model-f16.gguf'
];

function countPresentModels(modelsDir) {
  return REQUIRED_MODELS.reduce(
    (count, name) => count + (fs.existsSync(path.join(modelsDir, name)) ? 1 : 0),
    0
  );
}

function resolveUserDataPath() {
  const candidates = [path.join(appData, 'stratosort-core'), path.join(appData, 'stratosort')];
  let bestPath = candidates[0];
  let bestCount = -1;

  for (const candidate of candidates) {
    const modelsDir = path.join(candidate, 'models');
    const count = countPresentModels(modelsDir);
    if (count > bestCount) {
      bestCount = count;
      bestPath = candidate;
    }
  }

  return bestPath;
}

const userDataPath = resolveUserDataPath();
const modelsPath = path.join(userDataPath, 'models');

const FIXTURE_DIR = path.resolve(__dirname, '../../test/test-files');
const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.tiff'
]);

const isImageFile = (fileName) =>
  SUPPORTED_IMAGE_EXTENSIONS.has(path.extname(fileName).toLowerCase());

const isPdfFile = (fileName) => path.extname(fileName).toLowerCase() === '.pdf';

const log = (msg) => process.stdout.write(`${msg}\n`);
const warn = (msg) => process.stderr.write(`${msg}\n`);

// Provide a minimal Electron stub so LlamaService can resolve userData path.
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return {
      app: {
        getPath: (name) => (name === 'userData' ? userDataPath : os.tmpdir())
      }
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

process.on('unhandledRejection', (err) => {
  warn(`[diagnostics] Unhandled rejection: ${err?.stack || err}`);
  process.exit(1);
});

function assertModelsPresent() {
  const missing = REQUIRED_MODELS.filter((name) => !fs.existsSync(path.join(modelsPath, name)));
  if (missing.length > 0) {
    throw new Error(`Missing models in ${modelsPath}:\n- ${missing.join('\n- ')}`);
  }
}

async function listFixtures() {
  const entries = await fsp.readdir(FIXTURE_DIR);
  return {
    pdfs: entries.filter(isPdfFile),
    images: entries.filter(isImageFile)
  };
}

async function runEmbeddingChecks(llama, errors) {
  log('## Embedding model checks');
  const textFiles = ['sample.txt', 'contract.txt', 'project-report.md'];
  for (const fileName of textFiles) {
    const filePath = path.join(FIXTURE_DIR, fileName);
    if (!fs.existsSync(filePath)) {
      warn(`- Skip ${fileName} (missing)`);
      continue;
    }
    try {
      const text = await fsp.readFile(filePath, 'utf8');
      const result = await llama.generateEmbedding(text);
      if (!Array.isArray(result.embedding) || result.embedding.length !== 768) {
        throw new Error(`${fileName}: invalid embedding length`);
      }
      if (!result.embedding.every((v) => Number.isFinite(v))) {
        throw new Error(`${fileName}: embedding contains non-finite values`);
      }
      log(`- ${fileName}: OK (${result.embedding.length} dims)`);
    } catch (error) {
      const message = `${fileName}: ${error.message || 'embedding failed'}`;
      errors.push(`Embedding - ${message}`);
      warn(`- ${message}`);
    }
  }
}

async function runPdfExtractionChecks(errors) {
  log('## PDF extraction checks');
  const { extractTextFromPdf } = require('../../src/main/analysis/documentExtractors');
  const { pdfs } = await listFixtures();
  if (pdfs.length === 0) {
    warn('- No PDF fixtures found');
    return;
  }
  const failures = [];
  for (const pdf of pdfs) {
    const filePath = path.join(FIXTURE_DIR, pdf);
    try {
      const text = await extractTextFromPdf(filePath, pdf);
      if (!text || text.trim().length < 20) {
        failures.push(`${pdf}: empty extraction`);
      } else {
        log(`- ${pdf}: OK (${text.trim().length} chars)`);
      }
    } catch (error) {
      failures.push(`${pdf}: ${error.message || 'unknown error'}`);
    }
  }
  if (failures.length > 0) {
    failures.forEach((failure) => errors.push(`PDF - ${failure}`));
  }
}

async function runDocumentAnalysisChecks(llama, errors) {
  log('## Text model analysis checks');
  const { analyzeDocumentFile } = require('../../src/main/analysis/documentAnalysis');
  const filePath = path.join(FIXTURE_DIR, 'sample.txt');
  if (!fs.existsSync(filePath)) {
    errors.push('Text analysis - sample.txt missing');
    return;
  }
  try {
    const result = await analyzeDocumentFile(filePath);
    if (!result || result.error) {
      throw new Error(result?.error || 'unknown error');
    }
    if (typeof result.category !== 'string' || typeof result.confidence !== 'number') {
      throw new Error('Text analysis returned invalid shape');
    }
    log(`- sample.txt: OK (category=${result.category}, confidence=${result.confidence})`);
  } catch (error) {
    const message = `sample.txt: ${error.message || 'analysis failed'}`;
    errors.push(`Text analysis - ${message}`);
    warn(`- ${message}`);
    warn('- Running minimal text model sanity check...');
    try {
      // CPU-only 7B models can take 60-120s for even short generations
      const sanityTimeoutMs = parseInt(process.env.AI_SANITY_TIMEOUT, 10) || 120000;
      const sanity = await withAbortableTimeout(
        (abortController) =>
          llama.generateText({
            prompt: 'Return JSON: {"category":"Financial","keywords":["invoice"],"confidence":0.9}',
            maxTokens: 64,
            temperature: 0.1,
            signal: abortController.signal
          }),
        sanityTimeoutMs,
        'Text model sanity check'
      );
      if (!sanity?.response) {
        throw new Error('no response', { cause: error });
      }
      log('- Text model sanity check: OK');
    } catch (sanityError) {
      const sanityMessage = `Text model sanity check failed: ${sanityError.message || 'unknown error'}`;
      errors.push(sanityMessage);
      warn(`- ${sanityMessage}`);
    }
  }
}

async function runImageAnalysisChecks(errors) {
  log('## Image model analysis checks');
  const { analyzeImageFile } = require('../../src/main/analysis/imageAnalysis');
  const { images } = await listFixtures();
  if (images.length === 0) {
    warn('- No image fixtures found');
    return;
  }
  const failures = [];
  for (const image of images) {
    const filePath = path.join(FIXTURE_DIR, image);
    try {
      const result = await analyzeImageFile(filePath, []);
      if (!result || result.error) {
        failures.push(`${image}: ${result?.error || 'unknown error'}`);
        continue;
      }
      if (!result.category || typeof result.category !== 'string') {
        failures.push(`${image}: missing category`);
        continue;
      }
      if (typeof result.confidence !== 'number' || result.confidence <= 0) {
        failures.push(`${image}: invalid confidence`);
        continue;
      }
      log(`- ${image}: OK (category=${result.category}, confidence=${result.confidence})`);
    } catch (error) {
      failures.push(`${image}: ${error.message || 'unknown error'}`);
    }
  }
  if (failures.length > 0) {
    failures.forEach((failure) => errors.push(`Image - ${failure}`));
  }
}

async function runVectorSearchChecks(llama, errors) {
  log('## Orama search checks (real embeddings)');
  const { OramaVectorService } = require('../../src/main/services/OramaVectorService');
  const vectorDb = new OramaVectorService();
  let restoredDb = null;
  const diagIds = ['file:diag-invoice', 'file:diag-contract'];
  await vectorDb.initialize();

  try {
    const invoicePath = path.join(FIXTURE_DIR, 'sample.txt');
    const contractPath = path.join(FIXTURE_DIR, 'contract.txt');
    if (!fs.existsSync(invoicePath) || !fs.existsSync(contractPath)) {
      throw new Error('Required fixture files missing (sample.txt, contract.txt)');
    }

    const invoiceText = await fsp.readFile(invoicePath, 'utf8');
    const contractText = await fsp.readFile(contractPath, 'utf8');

    const invoiceEmbedding = await llama.generateEmbedding(invoiceText);
    const contractEmbedding = await llama.generateEmbedding(contractText);

    const upsert1 = await vectorDb.upsertFile({
      id: diagIds[0],
      vector: invoiceEmbedding.embedding,
      meta: { path: invoicePath, fileName: 'sample.txt', fileType: 'text/plain' }
    });
    if (upsert1?.success === false) {
      throw new Error(`Upsert invoice failed: ${upsert1.error || 'unknown'}`);
    }

    const upsert2 = await vectorDb.upsertFile({
      id: diagIds[1],
      vector: contractEmbedding.embedding,
      meta: { path: contractPath, fileName: 'contract.txt', fileType: 'text/plain' }
    });
    if (upsert2?.success === false) {
      throw new Error(`Upsert contract failed: ${upsert2.error || 'unknown'}`);
    }

    // Primary-path validation: query with the exact same vector and expect a self-hit.
    const directResults = await vectorDb.querySimilarFiles(invoiceEmbedding.embedding, 5);
    if (!directResults || directResults.length === 0) {
      throw new Error('Primary vector query returned no results for identical embedding');
    }
    if (!directResults.some((r) => r.id === diagIds[0])) {
      throw new Error(
        `Primary vector query failed self-hit check; top result was ${directResults[0]?.id || 'none'}`
      );
    }
    log(`- vector primary: OK (self-hit=${diagIds[0]}, top=${directResults[0].id})`);

    // Restore-path validation: persist and re-open DB, then repeat self-hit check.
    await vectorDb.persistAll();
    restoredDb = new OramaVectorService();
    await restoredDb.initialize();
    const restoredResults = await restoredDb.querySimilarFiles(invoiceEmbedding.embedding, 5);
    if (!restoredResults || restoredResults.length === 0) {
      throw new Error('Restore-path vector query returned no results for identical embedding');
    }
    if (!restoredResults.some((r) => r.id === diagIds[0])) {
      throw new Error(
        `Restore-path vector query failed self-hit check; top result was ${restoredResults[0]?.id || 'none'}`
      );
    }
    log(`- vector restore: OK (self-hit=${diagIds[0]}, top=${restoredResults[0].id})`);

    // Secondary semantic sanity check (informational): not required for pass/fail.
    const queryEmbedding = await llama.generateEmbedding('invoice payment financial');
    const semanticResults = await restoredDb.querySimilarFiles(queryEmbedding.embedding, 5);
    if (semanticResults?.length > 0) {
      log(
        `- search semantic: OK (top=${semanticResults[0].id}, score=${semanticResults[0].score.toFixed(3)})`
      );
    } else {
      warn('- search semantic: no vector hits (informational)');
    }
  } catch (error) {
    const message = error.message || 'search failed';
    errors.push(`Search - ${message}`);
    warn(`- ${message}`);
  } finally {
    if (restoredDb) {
      try {
        for (const id of diagIds) {
          await restoredDb.deleteFileEmbedding(id);
        }
      } catch {
        // Best-effort cleanup.
      }
      await restoredDb.cleanup();
    }
    for (const id of diagIds) {
      try {
        await vectorDb.deleteFileEmbedding(id);
      } catch {
        // Non-fatal cleanup best effort.
      }
    }
    await vectorDb.cleanup();
  }
}

async function main() {
  log('=== Real Model Pipeline Diagnostics ===');
  log(`Models path: ${modelsPath}`);
  log(`Fixtures path: ${FIXTURE_DIR}`);

  assertModelsPresent();

  const { getInstance } = require('../../src/main/services/LlamaService');
  const llama = getInstance();
  await llama.initialize();
  const errors = [];

  try {
    await runEmbeddingChecks(llama, errors);
    await runPdfExtractionChecks(errors);
    await runDocumentAnalysisChecks(llama, errors);
    await runImageAnalysisChecks(errors);
    await runVectorSearchChecks(llama, errors);

    if (errors.length > 0) {
      warn('\n=== Diagnostics complete: FAIL ===');
      errors.forEach((err) => warn(`- ${err}`));
      process.exitCode = 1;
    } else {
      log('=== Diagnostics complete: OK ===');
    }
  } finally {
    await llama.shutdown();
    // The diagnostics script initializes SettingsService (via llama config load),
    // so ensure its file watcher is stopped to avoid hanging process exit.
    try {
      const SettingsService = require('../../src/main/services/SettingsService');
      const settings = SettingsService?.getInstance?.();
      if (settings?.shutdown) {
        await settings.shutdown();
      }
    } catch {
      // Best effort only.
    }
  }
}

main().catch((error) => {
  warn(`\n[diagnostics] FAILED: ${error.message || error}`);
  process.exit(1);
});
