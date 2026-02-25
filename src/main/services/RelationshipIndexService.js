const fs = require('fs').promises;
const path = require('path');
const { app } = require('electron');
const { createLogger } = require('../../shared/logger');
const { normalizePathForIndex } = require('../../shared/pathSanitization');
const { getSemanticFileId } = require('../../shared/fileIdUtils');
const { normalizeText } = require('../../shared/normalization');

const logger = createLogger('RelationshipIndexService');
const DEFAULTS = {
  maxEdges: 2000,
  minWeight: 2,
  maxConceptsPerDoc: 20,
  maxConceptsPerEdge: 5,
  maxEdgeCandidates: 50000
};

class RelationshipIndexService {
  constructor({ analysisHistoryService }) {
    this.analysisHistoryService = analysisHistoryService;
    this.userDataPath = app.getPath('userData');
    this.indexPath = path.join(this.userDataPath, 'knowledge-relationships.json');
    this.index = null;

    // Lock to prevent concurrent buildIndex calls from corrupting the index
    this._buildPromise = null;
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
    const tempPath = `${this.indexPath}.tmp.${require('crypto').randomUUID()}`;
    try {
      await fs.writeFile(tempPath, JSON.stringify(index, null, 2), 'utf8');
      await fs.rename(tempPath, this.indexPath);
    } catch (error) {
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      logger.error('[RelationshipIndexService] Failed to save index', {
        error: error.message
      });
      throw error;
    }
  }

  _normalizeList(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return [];
      // Try JSON array first, otherwise fall back to comma-split.
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        // Ignore JSON parse errors.
      }
      return trimmed.split(',').map((item) => item.trim());
    }
    return [];
  }

  _normalizeConcept(value) {
    const cleaned = normalizeText(value, {
      maxLength: 80,
      collapseWhitespace: true,
      trim: true
    });
    return cleaned ? cleaned.toLowerCase() : '';
  }

  _normalizeConcepts(analysis) {
    const tags = this._normalizeList(analysis?.tags);
    const keywords = this._normalizeList(analysis?.keywords);
    const entities = this._normalizeList(analysis?.keyEntities);
    const entity = analysis?.entity ? [analysis.entity] : [];
    const project = analysis?.project ? [analysis.project] : [];

    const seen = new Set();
    const concepts = [];
    const addConcept = (value) => {
      const normalized = this._normalizeConcept(value);
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      concepts.push(normalized);
    };

    [...tags, ...keywords, ...entities, ...entity, ...project].forEach(addConcept);

    if (concepts.length > DEFAULTS.maxConceptsPerDoc) {
      return concepts.slice(0, DEFAULTS.maxConceptsPerDoc);
    }

    return concepts;
  }

  async buildIndex() {
    if (this._buildPromise) {
      return this._buildPromise;
    }
    this._buildPromise = this._doBuildIndex();
    try {
      return await this._buildPromise;
    } finally {
      this._buildPromise = null;
    }
  }

  async _doBuildIndex() {
    if (!this.analysisHistoryService) {
      logger.warn('[RelationshipIndexService] AnalysisHistoryService unavailable');
      return { success: false, error: 'AnalysisHistoryService unavailable' };
    }

    logger.info('[RelationshipIndexService] Building relationship index');

    await this.analysisHistoryService.initialize();
    const history = this.analysisHistoryService.analysisHistory;
    const entries = history?.entries || {};
    const conceptToFiles = new Map();
    let docCount = 0;

    Object.values(entries).forEach((doc) => {
      const analysis = doc?.analysis || {};
      const normalizedPath = normalizePathForIndex(doc?.organization?.actual || doc?.originalPath);
      if (!normalizedPath) return;
      const fileId = getSemanticFileId(normalizedPath);
      const concepts = this._normalizeConcepts(analysis);
      if (!concepts.length) return;
      docCount += 1;

      concepts.forEach((concept) => {
        if (!conceptToFiles.has(concept)) {
          conceptToFiles.set(concept, new Set());
        }
        conceptToFiles.get(concept).add(fileId);
      });
    });

    const edgeCounts = new Map();
    const edgeConcepts = new Map();
    // A concept shared by 1000 files would generate ~500K pairs without this cap
    const MAX_FILES_PER_CONCEPT = 100;
    conceptToFiles.forEach((fileSet, concept) => {
      const files = Array.from(fileSet);
      if (files.length > MAX_FILES_PER_CONCEPT) {
        // Concept is too generic — take the first N files to bound computation
        files.length = MAX_FILES_PER_CONCEPT;
      }
      for (let i = 0; i < files.length; i += 1) {
        for (let j = i + 1; j < files.length; j += 1) {
          const source = files[i];
          const target = files[j];
          const key = source < target ? `${source}|${target}` : `${target}|${source}`;
          // Cap edge candidates to prevent unbounded memory growth
          if (edgeCounts.size >= DEFAULTS.maxEdgeCandidates && !edgeCounts.has(key)) continue;
          edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);

          if (!edgeConcepts.has(key)) {
            edgeConcepts.set(key, []);
          }
          const conceptsForEdge = edgeConcepts.get(key);
          if (
            conceptsForEdge.length < DEFAULTS.maxConceptsPerEdge &&
            !conceptsForEdge.includes(concept)
          ) {
            conceptsForEdge.push(concept);
          }
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
          weight,
          concepts: edgeConcepts.get(key) || []
        };
      });

    const maxWeight = edges.length > 0 ? Math.max(...edges.map((edge) => edge.weight || 0)) : 0;
    const index = {
      updatedAt: new Date().toISOString(),
      sourceUpdatedAt: history?.updatedAt || null,
      edges,
      edgeCount: edges.length,
      conceptCount: conceptToFiles.size,
      docCount,
      maxWeight,
      minWeight: DEFAULTS.minWeight
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

  async getNeighborEdges(seedIds, options = {}) {
    const {
      minWeight = DEFAULTS.minWeight,
      maxEdges = DEFAULTS.maxEdges,
      maxNeighbors = 200
    } = options;
    const validIds = Array.isArray(seedIds)
      ? seedIds.filter((id) => typeof id === 'string' && id.length > 0)
      : [];

    if (validIds.length === 0) {
      return { success: true, edges: [], neighbors: [] };
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

    const seedSet = new Set(validIds);
    const neighbors = new Set();
    const edges = [];
    const sorted = (this.index?.edges || [])
      .filter((edge) => edge.weight >= minWeight)
      .filter((edge) => seedSet.has(edge.source) || seedSet.has(edge.target))
      .sort((a, b) => (b.weight || 0) - (a.weight || 0));

    for (const edge of sorted) {
      if (edges.length >= maxEdges) break;
      const sourceIsSeed = seedSet.has(edge.source);
      const targetIsSeed = seedSet.has(edge.target);
      if (!sourceIsSeed && !targetIsSeed) continue;

      const neighborId = sourceIsSeed ? edge.target : edge.source;
      const isNewNeighbor = !seedSet.has(neighborId) && !neighbors.has(neighborId);
      if (isNewNeighbor && neighbors.size >= maxNeighbors) continue;
      if (isNewNeighbor) {
        neighbors.add(neighborId);
      }
      edges.push(edge);
    }

    return { success: true, edges, neighbors: Array.from(neighbors) };
  }

  async getStats() {
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

    return {
      success: true,
      updatedAt: this.index?.updatedAt || null,
      sourceUpdatedAt: this.index?.sourceUpdatedAt || null,
      edgeCount: this.index?.edgeCount ?? this.index?.edges?.length ?? 0,
      conceptCount: this.index?.conceptCount ?? null,
      docCount: this.index?.docCount ?? null,
      maxWeight: this.index?.maxWeight ?? null,
      minWeight: this.index?.minWeight ?? DEFAULTS.minWeight
    };
  }
}

module.exports = RelationshipIndexService;
