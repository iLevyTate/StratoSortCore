const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const DEFAULTS = {
  maxCandidates: 200,
  maxDirEntries: 2000
};

/**
 * Compute SHA-256 checksum of a file using streaming.
 * @param {string} filePath
 * @returns {Promise<string>}
 */
async function computeFileChecksum(filePath) {
  const fsModule = require('fs');
  if (typeof fsModule.createReadStream === 'function') {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fsModule.createReadStream(filePath);

      const cleanup = () => {
        if (typeof stream.removeAllListeners === 'function') {
          stream.removeAllListeners();
        }
        if (typeof stream.destroy === 'function') {
          stream.destroy();
        }
      };

      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => {
        cleanup();
        resolve(hash.digest('hex'));
      });
      stream.on('error', (err) => {
        cleanup();
        reject(err);
      });
    });
  }

  if (typeof fs?.readFile === 'function') {
    const data = await fs.readFile(filePath);
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  throw new Error('Checksum not supported: no readable file API available');
}

async function statSafe(filePath) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

function isFileStat(stat) {
  if (!stat) return false;
  if (typeof stat.isFile === 'function') return stat.isFile();
  if (typeof stat.isFile === 'boolean') return stat.isFile;
  return false;
}

function isDirectoryStat(stat) {
  if (!stat) return false;
  if (typeof stat.isDirectory === 'function') return stat.isDirectory();
  if (typeof stat.isDirectory === 'boolean') return stat.isDirectory;
  return false;
}

/**
 * Search a destination directory for an identical file by size+checksum.
 * @param {Object} params
 * @param {string} params.sourcePath
 * @param {string} params.destinationDir
 * @param {Function} [params.checksumFn]
 * @param {number} [params.maxCandidates]
 * @param {number} [params.maxDirEntries]
 * @param {Object} [params.logger]
 * @returns {Promise<string|null>} Path to duplicate if found.
 */
async function findDuplicateInDirectory({
  sourcePath,
  destinationDir,
  checksumFn = computeFileChecksum,
  maxCandidates = DEFAULTS.maxCandidates,
  maxDirEntries = DEFAULTS.maxDirEntries,
  logger,
  returnSourceHash = false
}) {
  if (!sourcePath || !destinationDir) return null;
  const sourceStat = await statSafe(sourcePath);
  if (!isFileStat(sourceStat)) return null;
  if (typeof sourceStat.size !== 'number') return null;

  let entries;
  try {
    entries = await fs.readdir(destinationDir, { withFileTypes: true });
  } catch {
    return null;
  }

  if (entries.length > maxDirEntries && logger?.debug) {
    logger.debug('[DEDUP] Large directory, limiting duplicate scan', {
      destinationDir,
      entries: entries.length,
      maxDirEntries
    });
  }

  const candidates = [];
  for (const entry of entries) {
    if (candidates.length >= maxCandidates) break;
    if (!entry.isFile()) continue;
    const fullPath = path.join(destinationDir, entry.name);
    if (fullPath === sourcePath) continue;

    const stat = await statSafe(fullPath);
    if (!isFileStat(stat)) continue;
    if (typeof stat.size !== 'number' || stat.size !== sourceStat.size) continue;
    candidates.push(fullPath);

    if (candidates.length >= maxCandidates) break;
  }

  if (candidates.length === 0) return null;

  let sourceHash;
  try {
    sourceHash = await checksumFn(sourcePath);
  } catch (error) {
    if (logger?.debug) {
      logger.debug('[DEDUP] Failed to compute source checksum', {
        sourcePath,
        error: error?.message
      });
    }
    return null;
  }
  for (const candidate of candidates) {
    let candidateHash;
    try {
      candidateHash = await checksumFn(candidate);
    } catch (error) {
      if (logger?.debug) {
        logger.debug('[DEDUP] Failed to compute candidate checksum', {
          candidate,
          error: error?.message
        });
      }
      continue;
    }
    if (candidateHash === sourceHash) {
      return returnSourceHash ? { path: candidate, sourceHash } : candidate;
    }
  }

  return null;
}

/**
 * Find a duplicate at the exact destination or within its directory.
 * @param {Object} params
 * @param {string} params.sourcePath
 * @param {string} params.destinationPath
 * @param {Function} [params.checksumFn]
 * @param {Object} [params.logger]
 * @param {number} [params.maxCandidates]
 * @param {number} [params.maxDirEntries]
 * @returns {Promise<string|null>}
 */
async function findDuplicateForDestination({
  sourcePath,
  destinationPath,
  checksumFn = computeFileChecksum,
  logger,
  maxCandidates,
  maxDirEntries,
  returnSourceHash = false
}) {
  if (!sourcePath || !destinationPath) return null;

  const destStat = await statSafe(destinationPath);
  if (isFileStat(destStat)) {
    try {
      const [sourceHash, destHash] = await Promise.all([
        checksumFn(sourcePath),
        checksumFn(destinationPath)
      ]);
      if (sourceHash === destHash) {
        return returnSourceHash ? { path: destinationPath, sourceHash } : destinationPath;
      }
    } catch (error) {
      if (logger?.debug) {
        logger.debug('[DEDUP] Failed to compute destination checksum', {
          destinationPath,
          error: error?.message
        });
      }
      return null;
    }
  }

  const destinationDir = path.dirname(destinationPath);
  const dirStat = await statSafe(destinationDir);
  if (!isDirectoryStat(dirStat)) return null;

  return findDuplicateInDirectory({
    sourcePath,
    destinationDir,
    checksumFn,
    maxCandidates,
    maxDirEntries,
    logger,
    returnSourceHash
  });
}

async function handleDuplicateMove({
  sourcePath,
  destinationPath,
  checksumFn = computeFileChecksum,
  logger,
  logPrefix = '[DEDUP]',
  dedupContext = 'unknown',
  removeEmbeddings,
  unlinkFn
}) {
  const duplicateMatch = await findDuplicateForDestination({
    sourcePath,
    destinationPath,
    checksumFn,
    logger,
    returnSourceHash: true
  });
  const duplicatePath = duplicateMatch?.path;
  if (!duplicatePath) return null;

  const sourceHash = duplicateMatch?.sourceHash;
  logger?.info?.(`${logPrefix} Skipping move - duplicate already exists`, {
    source: sourcePath,
    destination: duplicatePath,
    checksum: sourceHash ? `${sourceHash.substring(0, 16)}...` : 'unknown'
  });
  logger?.info?.('[DEDUP] Move skipped', {
    source: sourcePath,
    destination: duplicatePath,
    context: dedupContext,
    reason: 'duplicate'
  });

  if (typeof removeEmbeddings === 'function') {
    try {
      await removeEmbeddings(sourcePath, logger);
    } catch {
      // Non-fatal
    }
  }

  const unlink = typeof unlinkFn === 'function' ? unlinkFn : fs.unlink;
  await unlink(sourcePath);

  return { skipped: true, destination: duplicatePath, reason: 'duplicate' };
}

/**
 * Check if a file has semantic (embedding-based) duplicates at a destination directory.
 * Uses the vector DB to find files with similar content, complementing the checksum-based
 * exact-match detection. Requires the OramaVectorService to be available and the source
 * file to have been analyzed/embedded.
 *
 * @param {Object} params
 * @param {string} params.sourceFileId - Semantic file ID (e.g., "file:/path/to/source")
 * @param {string} params.destinationDir - Directory to check for similar files
 * @param {number} [params.threshold=0.9] - Cosine similarity threshold (0..1). Default 0.9.
 * @param {number} [params.topK=5] - Max similar files to return
 * @param {Object} [params.vectorDbService] - OramaVectorService instance (resolved lazily if omitted)
 * @param {Object} [params.logger] - Logger instance
 * @returns {Promise<{hasDuplicates: boolean, matches: Array<{id: string, score: number, metadata: Object}>}>}
 */
async function findSemanticDuplicates({
  sourceFileId,
  destinationDir,
  threshold = 0.9,
  topK = 5,
  vectorDbService,
  logger
}) {
  const emptyResult = { hasDuplicates: false, matches: [] };

  if (!sourceFileId || !destinationDir) return emptyResult;

  // Resolve vector DB service lazily if not provided
  let vdb = vectorDbService;
  if (!vdb) {
    try {
      const { container, ServiceIds } = require('../services/ServiceContainer');
      vdb =
        typeof container.tryResolve === 'function'
          ? container.tryResolve(ServiceIds.ORAMA_VECTOR)
          : container.resolve(ServiceIds.ORAMA_VECTOR);
    } catch {
      if (logger?.debug) {
        logger.debug('[DEDUP] Vector DB service unavailable for semantic duplicate check');
      }
      return emptyResult;
    }
  }

  if (!vdb || typeof vdb.findSimilarInDirectory !== 'function') {
    return emptyResult;
  }

  try {
    const matches = await vdb.findSimilarInDirectory(sourceFileId, destinationDir, {
      threshold,
      topK
    });

    return {
      hasDuplicates: matches.length > 0,
      matches
    };
  } catch (error) {
    if (logger?.debug) {
      logger.debug('[DEDUP] Semantic duplicate check failed (non-fatal)', {
        sourceFileId,
        destinationDir,
        error: error?.message
      });
    }
    return emptyResult;
  }
}

module.exports = {
  computeFileChecksum,
  findDuplicateForDestination,
  handleDuplicateMove,
  findSemanticDuplicates
};
