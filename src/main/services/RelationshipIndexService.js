const fs = require('fs').promises;
const path = require('path');
const { app } = require('electron');
const { logger } = require('../../shared/logger');
const { normalizePathForIndex } = require('../../shared/pathSanitization');
const { getSemanticFileId } = require('../../shared/fileIdUtils');

logger.setContext('RelationshipIndexService');

const DEFAULTS = {
  maxEdges: 2000,
  minWeight: 2
};

class RelationshipIndexService {
  constructor({ analysisHistoryService }) {
    this.analysisHistoryService = analysisHistoryService;
    this.userDataPath = app.getPath('userData');
    this.indexPath = path.join(this.userDataPath, 'knowledge-relationships.json');
    this.index = null;
  }

  async _loadIndex() {
    try {
      const raw = await fs.readFile(this.indexPath, 'utf8');
      this.index = JSON.parse(raw);
      return this.index;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.warn('[RelationshipIndexService] Failed to load index', {
          error: error.message
        });
      }
      this.index = null;
      return null;
    }
  }

  async _saveIndex(index) {
    try {
      await fs.writeFile(this.indexPath, JSON.stringify(index, null, 2), 'utf8');
    } catch (error) {
      logger.error('[RelationshipIndexService] Failed to save index', {
        error: error.message
      });
      throw error;
    }
  }

  _normalizeConcepts(analysis) {
    const tags = Array.isArray(analysis?.tags) ? analysis.tags : [];
    const entities = Array.isArray(analysis?.keyEntities) ? analysis.keyEntities : [];
    return Array.from(
      new Set(
        [...tags, ...entities]
          .filter((item) => typeof item === 'string' && item.trim().length > 0)
          .map((item) => item.trim().toLowerCase())
      )
    );
  }

  async buildIndex() {
    if (!this.analysisHistoryService) {
      logger.warn('[RelationshipIndexService] AnalysisHistoryService unavailable');
      return { success: false, error: 'AnalysisHistoryService unavailable' };
    }

    logger.info('[RelationshipIndexService] Building relationship index');

    await this.analysisHistoryService.initialize();
    const history = this.analysisHistoryService.analysisHistory;
    const entries = history?.entries || {};
    const conceptToFiles = new Map();

    Object.values(entries).forEach((doc) => {
      const analysis = doc?.analysis || {};
      const normalizedPath = normalizePathForIndex(doc?.organization?.actual || doc?.originalPath);
      if (!normalizedPath) return;
      const fileId = getSemanticFileId(normalizedPath);
      const concepts = this._normalizeConcepts(analysis);
      if (!concepts.length) return;

      concepts.forEach((concept) => {
        if (!conceptToFiles.has(concept)) {
          conceptToFiles.set(concept, new Set());
        }
        conceptToFiles.get(concept).add(fileId);
      });
    });

    const edgeCounts = new Map();
    conceptToFiles.forEach((fileSet) => {
      const files = Array.from(fileSet);
      for (let i = 0; i < files.length; i += 1) {
        for (let j = i + 1; j < files.length; j += 1) {
          const source = files[i];
          const target = files[j];
          const key = source < target ? `${source}|${target}` : `${target}|${source}`;
          edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
        }
      }
    });

    const edges = Array.from(edgeCounts.entries())
      .filter(([, weight]) => weight >= DEFAULTS.minWeight)
      .sort((a, b) => b[1] - a[1])
      .slice(0, DEFAULTS.maxEdges)
      .map(([key, weight]) => {
        const [source, target] = key.split('|');
        return {
          id: `rel:${source}->${target}`,
          source,
          target,
          weight
        };
      });

    const index = {
      updatedAt: new Date().toISOString(),
      sourceUpdatedAt: history?.updatedAt || null,
      edges
    };

    this.index = index;
    await this._saveIndex(index);

    logger.info('[RelationshipIndexService] Index built', {
      edgeCount: edges.length,
      sourceUpdatedAt: history?.updatedAt || null
    });

    return { success: true, edges };
  }

  async getEdges(fileIds, options = {}) {
    const { minWeight = DEFAULTS.minWeight, maxEdges = DEFAULTS.maxEdges } = options;
    const validIds = Array.isArray(fileIds)
      ? fileIds.filter((id) => typeof id === 'string' && id.length > 0)
      : [];

    if (validIds.length < 2) {
      return { success: true, edges: [] };
    }

    const history = this.analysisHistoryService?.analysisHistory;
    const historyUpdatedAt = history?.updatedAt || null;

    if (!this.index) {
      await this._loadIndex();
    }

    if (!this.index || (historyUpdatedAt && this.index.sourceUpdatedAt !== historyUpdatedAt)) {
      logger.debug('[RelationshipIndexService] Index stale or missing, rebuilding', {
        hasIndex: Boolean(this.index),
        sourceUpdatedAt: historyUpdatedAt || null
      });
      await this.buildIndex();
    }

    const idSet = new Set(validIds);
    const edges = (this.index?.edges || [])
      .filter((edge) => idSet.has(edge.source) && idSet.has(edge.target))
      .filter((edge) => edge.weight >= minWeight)
      .slice(0, maxEdges);

    return { success: true, edges };
  }
}

module.exports = RelationshipIndexService;
