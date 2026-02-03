const path = require('path');
const { logger: baseLogger, createLogger } = require('../../../shared/logger');
const { getSemanticFileId, isImagePath } = require('../../../shared/fileIdUtils');
const { buildEmbeddingSummary } = require('../../analysis/embeddingSummary');
const { findContainingSmartFolder } = require('../../../shared/folderUtils');
const { getPathVariants } = require('../../utils/fileIdUtils');
const { organizeQueue } = require('../../analysis/embeddingQueue/stageQueues');
const embeddingQueueManager = require('../../analysis/embeddingQueue/queueManager');
const { shouldEmbed } = require('../../services/embedding/embeddingGate');

const logger =
  typeof createLogger === 'function' ? createLogger('IPC:Files:EmbeddingSync') : baseLogger;
if (typeof createLogger !== 'function' && logger?.setContext) {
  logger.setContext('IPC:Files:EmbeddingSync');
}

function resolveServices() {
  try {
    const { container, ServiceIds } = require('../../services/ServiceContainer');
    const safeResolve = (serviceId) => {
      if (typeof container.tryResolve === 'function') {
        return container.tryResolve(serviceId);
      }
      if (typeof container.resolve === 'function') {
        if (typeof container.has === 'function' && !container.has(serviceId)) {
          return null;
        }
        try {
          return container.resolve(serviceId);
        } catch {
          return null;
        }
      }
      return null;
    };

    return {
      chromaDbService: safeResolve(ServiceIds.CHROMA_DB),
      analysisHistoryService: safeResolve(ServiceIds.ANALYSIS_HISTORY),
      folderMatchingService: safeResolve(ServiceIds.FOLDER_MATCHING),
      learningFeedbackService: safeResolve(ServiceIds.LEARNING_FEEDBACK)
    };
  } catch (error) {
    logger.debug('[EmbeddingSync] Failed to resolve services:', error?.message);
    return {
      chromaDbService: null,
      analysisHistoryService: null,
      folderMatchingService: null,
      learningFeedbackService: null
    };
  }
}

function getSmartFolderForPath(destPath, services, smartFoldersOverride) {
  const folders = Array.isArray(smartFoldersOverride)
    ? smartFoldersOverride
    : services.learningFeedbackService?.getSmartFolders?.() || [];
  return findContainingSmartFolder(destPath, folders);
}

function normalizeConfidence(confidence) {
  if (typeof confidence !== 'number') return 0;
  return confidence > 1 ? Math.round(confidence) : Math.round(confidence * 100);
}

function buildEmbeddingMeta({
  analysis,
  entry,
  destPath,
  fileExtension,
  type,
  summary,
  smartFolder
}) {
  const extractedText = analysis.extractedText || '';
  const fileName = path.basename(destPath);
  const documentType =
    analysis.documentType || (analysis.type && analysis.type !== type ? analysis.type : '');

  const meta = {
    path: destPath,
    name: fileName,
    fileExtension,
    fileSize: entry?.fileSize || null,
    category: smartFolder?.name || analysis.category || 'Uncategorized',
    confidence: normalizeConfidence(analysis.confidence ?? 0),
    type,
    extractionMethod: analysis.extractionMethod || (extractedText ? 'content' : 'analysis'),
    summary: (summary || analysis.summary || analysis.purpose || '').substring(0, 2000),
    tags: Array.isArray(analysis.keywords) ? analysis.keywords : [],
    keywords: Array.isArray(analysis.keywords) ? analysis.keywords : [],
    date: analysis.documentDate || analysis.date || null,
    suggestedName: analysis.suggestedName || null,
    entity: analysis.entity || '',
    project: analysis.project || '',
    purpose: (analysis.purpose || '').substring(0, 1000),
    reasoning: (analysis.reasoning || '').substring(0, 500),
    documentType,
    keyEntities: Array.isArray(analysis.keyEntities) ? analysis.keyEntities.slice(0, 20) : [],
    extractedText: extractedText.substring(0, 5000),
    smartFolder: smartFolder?.name || null,
    smartFolderPath: smartFolder?.path || null
  };

  if (type === 'image') {
    meta.content_type = analysis.content_type || 'unknown';
    meta.colors = Array.isArray(analysis.colors) ? analysis.colors : [];
    meta.has_text = analysis.has_text === true;
  }

  return meta;
}

async function removeEmbeddingsForPath(filePath, services, log = logger) {
  if (!filePath) return { removed: 0 };

  const embeddingQueueRemoved = embeddingQueueManager?.removeByFilePath
    ? embeddingQueueManager.removeByFilePath(filePath)
    : 0;

  const chromaDbService = services.chromaDbService;
  if (!chromaDbService) {
    log.warn(
      '[EmbeddingSync] ChromaDB service unavailable for embedding removal - potential orphaned embeddings',
      { filePath }
    );
    return { removed: embeddingQueueRemoved, error: 'service_unavailable' };
  }

  try {
    const pathVariants = getPathVariants(filePath);
    const idsToDelete = new Set();
    for (const variant of pathVariants) {
      idsToDelete.add(`file:${variant}`);
      idsToDelete.add(`image:${variant}`);
    }

    const ids = Array.from(idsToDelete);
    let dbRemovedCount = 0;

    if (typeof chromaDbService.batchDeleteFileEmbeddings === 'function') {
      const result = await chromaDbService.batchDeleteFileEmbeddings(ids);
      // FIX: Check return value for success/queued status
      if (result && result.success) {
        dbRemovedCount = ids.length;
      } else if (result && result.queued) {
        dbRemovedCount = 0; // Queued for later, not yet removed
        logger.debug('[EmbeddingSync] Embedding deletions queued, not yet confirmed');
      } else if (result && result.error) {
        log.warn('[EmbeddingSync] Batch delete failed', { error: result.error });
      }
    } else if (typeof chromaDbService.deleteFileEmbedding === 'function') {
      for (const id of ids) {
        const result = await chromaDbService.deleteFileEmbedding(id);
        // FIX: Check return value
        if (result === true || (result && (result.success || result.queued))) {
          dbRemovedCount++;
        }
      }
    }

    // PERF: Batch deleteFileChunks calls in parallel instead of sequential
    if (typeof chromaDbService.deleteFileChunks === 'function') {
      const chunkDeletePromises = pathVariants.flatMap((variant) => [
        chromaDbService.deleteFileChunks(`file:${variant}`),
        chromaDbService.deleteFileChunks(`image:${variant}`)
      ]);
      const chunkResults = await Promise.allSettled(chunkDeletePromises);
      const failures = chunkResults.filter((result) => result.status === 'rejected');
      if (failures.length > 0) {
        log.warn('[EmbeddingSync] Failed to delete some chunks', {
          failures: failures.length,
          errors: failures.map((result) => result.reason?.message || 'Unknown error')
        });
      }
    }

    return { removed: dbRemovedCount + embeddingQueueRemoved };
  } catch (error) {
    log.warn('[EmbeddingSync] Failed to remove embeddings', {
      filePath,
      error: error.message
    });
    return { removed: embeddingQueueRemoved, error: error.message };
  }
}

async function removeEmbeddingsForPathBestEffort(filePath, log = logger) {
  if (!filePath) return { removed: 0 };
  const services = resolveServices();
  return removeEmbeddingsForPath(filePath, services, log);
}

async function syncEmbeddingForMove({
  sourcePath,
  destPath,
  smartFolders,
  operation = 'move',
  log = logger
}) {
  if (!destPath) return { action: 'skipped', reason: 'missing-dest' };

  const services = resolveServices();
  const smartFolder = getSmartFolderForPath(destPath, services, smartFolders);

  if (!smartFolder) {
    await removeEmbeddingsForPath(destPath, services, log);
    // IMPORTANT: For copies, never remove the source file's embeddings.
    if (operation !== 'copy' && sourcePath && sourcePath !== destPath) {
      await removeEmbeddingsForPath(sourcePath, services, log);
    }
    // Persist embedding state: file is not eligible for local embeddings outside smart folders.
    try {
      const hs = services.analysisHistoryService;
      if (hs?.updateEmbeddingStateByPath) {
        await hs.updateEmbeddingStateByPath(destPath, { status: 'skipped' });
      }
    } catch {
      // Non-fatal
    }
    return { action: 'removed', reason: 'not-smart-folder' };
  }

  const analysisHistoryService = services.analysisHistoryService;
  if (!analysisHistoryService?.getAnalysisByPath) {
    return { action: 'skipped', reason: 'analysis-history-unavailable' };
  }

  let entry = await analysisHistoryService.getAnalysisByPath(destPath);
  if (!entry && sourcePath) {
    entry = await analysisHistoryService.getAnalysisByPath(sourcePath);
  }

  if (!entry?.analysis) {
    return { action: 'skipped', reason: 'no-analysis' };
  }

  // Respect global embedding timing/policy. This is the "final" stage (post-move).
  // We intentionally keep this enabled for both 'during_analysis' and 'after_organize'
  // to ensure files that only become eligible after the move still get embedded.
  const policyOverride = entry?.embedding?.policy || null;
  const gate = await shouldEmbed({ stage: 'final', policyOverride });
  if (!gate.shouldEmbed) {
    // Persist skipped state for observability.
    try {
      if (analysisHistoryService?.updateEmbeddingStateByPath) {
        await analysisHistoryService.updateEmbeddingStateByPath(destPath, { status: 'skipped' });
      }
    } catch {
      // Non-fatal
    }
    return { action: 'skipped', reason: `disabled:${gate.timing}:${gate.policy}` };
  }

  const analysis = entry.analysis || {};
  const fileExtension = path.extname(destPath).toLowerCase();
  const type = isImagePath(destPath) || analysis.type === 'image' ? 'image' : 'document';
  const embeddingSummary = buildEmbeddingSummary(
    analysis,
    analysis.extractedText || '',
    fileExtension,
    type
  );

  if (!embeddingSummary.text || !embeddingSummary.text.trim()) {
    return { action: 'skipped', reason: 'empty-summary' };
  }

  const meta = buildEmbeddingMeta({
    analysis,
    entry,
    destPath,
    fileExtension,
    type,
    summary: embeddingSummary.text,
    smartFolder
  });

  const destId = getSemanticFileId(destPath);
  const sourceId = sourcePath ? getSemanticFileId(sourcePath) : null;

  // Optimization: if an embedding already exists for this destination ID, update metadata
  // in-place via ChromaDB (avoids recomputing vectors during moves).
  const chromaDbService = services.chromaDbService;
  if (chromaDbService?.updateFilePaths) {
    try {
      await chromaDbService.initialize?.();
      if (chromaDbService.isOnline) {
        const oldId = operation === 'copy' || !sourceId ? destId : sourceId;
        const updated = await chromaDbService.updateFilePaths([
          { oldId, newId: destId, newMeta: meta }
        ]);
        if (updated > 0) {
          try {
            await analysisHistoryService?.updateEmbeddingStateByPath?.(destPath, {
              status: 'done'
            });
          } catch {
            // Non-fatal
          }
          // For moves/renames, ensure we don't leave behind stale embeddings for the old path.
          // For copies, the source should remain indexed.
          if (operation !== 'copy' && sourcePath && sourcePath !== destPath) {
            try {
              await removeEmbeddingsForPath(sourcePath, services, log);
            } catch {
              // Non-fatal
            }
          }
          return { action: 'updated_meta', smartFolder: smartFolder.name };
        }
      }
    } catch (metaUpdateErr) {
      log.debug('[EmbeddingSync] Metadata-only update failed (will re-embed)', {
        error: metaUpdateErr?.message
      });
    }
  }

  const folderMatchingService = services.folderMatchingService;
  if (!folderMatchingService?.embedText) {
    return { action: 'skipped', reason: 'matcher-unavailable' };
  }

  const embedding = await folderMatchingService.embedText(embeddingSummary.text);
  if (!embedding?.vector || !Array.isArray(embedding.vector) || embedding.vector.length === 0) {
    return { action: 'skipped', reason: 'no-vector' };
  }

  await organizeQueue.enqueue({
    id: destId,
    vector: embedding.vector,
    model: embedding.model,
    meta,
    updatedAt: new Date().toISOString()
  });

  // Persist pending state (queue-backed embedding).
  try {
    if (analysisHistoryService?.updateEmbeddingStateByPath) {
      await analysisHistoryService.updateEmbeddingStateByPath(destPath, {
        status: 'pending',
        model: embedding.model || null
      });
    }
  } catch {
    // Non-fatal
  }

  // For moves/renames, ensure we don't leave behind stale embeddings for the old path.
  // For copies, the source should remain indexed.
  if (operation !== 'copy' && sourcePath && sourcePath !== destPath) {
    try {
      await removeEmbeddingsForPath(sourcePath, services, log);
    } catch {
      // Non-fatal
    }
  }

  return { action: 'enqueued', smartFolder: smartFolder.name };
}

module.exports = {
  syncEmbeddingForMove,
  removeEmbeddingsForPath,
  removeEmbeddingsForPathBestEffort
};
