const path = require('path');
const { logger: baseLogger, createLogger } = require('../../../shared/logger');
const { getSemanticFileId, isImagePath } = require('../../../shared/fileIdUtils');
const { buildEmbeddingSummary } = require('../../analysis/embeddingSummary');
const { findContainingSmartFolder } = require('../../../shared/folderUtils');
const { getPathVariants } = require('../../utils/fileIdUtils');
const embeddingQueue = require('../../analysis/embeddingQueue');

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

  const embeddingQueueRemoved = embeddingQueue?.removeByFilePath
    ? embeddingQueue.removeByFilePath(filePath)
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
      if (result && (result.success || result.queued)) {
        dbRemovedCount = ids.length;
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

    if (typeof chromaDbService.deleteFileChunks === 'function') {
      for (const variant of pathVariants) {
        await chromaDbService.deleteFileChunks(`file:${variant}`);
        await chromaDbService.deleteFileChunks(`image:${variant}`);
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

async function syncEmbeddingForMove({ sourcePath, destPath, smartFolders, log = logger }) {
  if (!destPath) return { action: 'skipped', reason: 'missing-dest' };

  const services = resolveServices();
  const smartFolder = getSmartFolderForPath(destPath, services, smartFolders);

  if (!smartFolder) {
    await removeEmbeddingsForPath(destPath, services, log);
    if (sourcePath && sourcePath !== destPath) {
      await removeEmbeddingsForPath(sourcePath, services, log);
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

  const folderMatchingService = services.folderMatchingService;
  if (!folderMatchingService?.embedText) {
    return { action: 'skipped', reason: 'matcher-unavailable' };
  }

  const embedding = await folderMatchingService.embedText(embeddingSummary.text);
  if (!embedding?.vector || !Array.isArray(embedding.vector) || embedding.vector.length === 0) {
    return { action: 'skipped', reason: 'no-vector' };
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

  await embeddingQueue.enqueue({
    id: getSemanticFileId(destPath),
    vector: embedding.vector,
    model: embedding.model,
    meta,
    updatedAt: new Date().toISOString()
  });

  return { action: 'enqueued', smartFolder: smartFolder.name };
}

module.exports = {
  syncEmbeddingForMove,
  removeEmbeddingsForPath
};
