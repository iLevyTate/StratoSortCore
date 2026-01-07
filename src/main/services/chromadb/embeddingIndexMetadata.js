/**
 * Embedding Index Metadata
 *
 * Tracks which embedding model/dimensions were last used to build the ChromaDB embedding index.
 * This allows the UI to warn users when they change embedding models (dimension mismatch) and
 * to clear that warning after a rebuild completes.
 */

const path = require('path');
const { app } = require('electron');
const { loadJsonFile, atomicWriteFile } = require('../../../shared/atomicFile');

const DEFAULT_FILENAME = 'embedding-index-metadata.json';

function getEmbeddingIndexMetadataPath() {
  // Store in userData (same root as other persisted app state).
  // Avoid coupling to ChromaDB internal directory structure.
  return path.join(app.getPath('userData'), DEFAULT_FILENAME);
}

/**
 * Read the last known embedding index metadata.
 * @returns {Promise<{model: string, dims: number, updatedAt: string, source?: string}|null>}
 */
async function readEmbeddingIndexMetadata() {
  const filePath = getEmbeddingIndexMetadataPath();
  const data = await loadJsonFile(filePath, {
    description: 'embedding index metadata',
    backupCorrupt: true
  });

  if (!data || typeof data !== 'object') return null;
  if (typeof data.model !== 'string' || !data.model.trim()) return null;
  if (!Number.isFinite(data.dims) || data.dims <= 0) return null;
  if (typeof data.updatedAt !== 'string' || !data.updatedAt.trim()) return null;

  return {
    model: data.model,
    dims: data.dims,
    updatedAt: data.updatedAt,
    ...(typeof data.source === 'string' ? { source: data.source } : {})
  };
}

/**
 * Write embedding index metadata.
 * @param {{model: string, dims: number, source?: string}} meta
 */
async function writeEmbeddingIndexMetadata(meta) {
  if (!meta || typeof meta !== 'object') return;
  const model = typeof meta.model === 'string' ? meta.model.trim() : '';
  const dims = Number(meta.dims);
  if (!model || !Number.isFinite(dims) || dims <= 0) return;

  const filePath = getEmbeddingIndexMetadataPath();
  await atomicWriteFile(
    filePath,
    {
      model,
      dims,
      updatedAt: new Date().toISOString(),
      ...(typeof meta.source === 'string' ? { source: meta.source } : {})
    },
    { pretty: true }
  );
}

module.exports = {
  getEmbeddingIndexMetadataPath,
  readEmbeddingIndexMetadata,
  writeEmbeddingIndexMetadata
};
