const { logger } = require('../../shared/logger');
const { cosineSimilarity } = require('../../shared/vectorMath');
const { extractAndParseJSON } = require('../utils/jsonRepair');
const { getChatPersonaOrDefault } = require('../../shared/chatPersonas');

logger.setContext('ChatService');

const DEFAULTS = {
  topK: 6,
  mode: 'hybrid',
  chunkTopK: 10,
  chunkWeight: 0.2,
  contextFileLimit: 200,
  memoryWindow: 6
};

const RESPONSE_MODES = {
  fast: {
    chunkTopK: 10,
    chunkWeight: 0.2,
    expandSynonyms: false,
    correctSpelling: false,
    rerank: false
  },
  deep: {
    chunkTopK: 60,
    chunkWeight: 0.4,
    expandSynonyms: true,
    correctSpelling: false,
    rerank: true
  }
};

class ChatService {
  constructor({
    searchService,
    chromaDbService,
    embeddingService,
    ollamaService,
    settingsService
  }) {
    this.searchService = searchService;
    this.chromaDbService = chromaDbService;
    this.embeddingService = embeddingService;
    this.ollamaService = ollamaService;
    this.settingsService = settingsService;
    this.sessions = new Map();
    this._langchainMemoryModule = null;
  }

  async resetSession(sessionId) {
    if (sessionId) {
      this.sessions.delete(sessionId);
    }
  }

  async query({
    sessionId,
    query,
    topK = DEFAULTS.topK,
    mode = DEFAULTS.mode,
    chunkTopK = DEFAULTS.chunkTopK,
    chunkWeight = DEFAULTS.chunkWeight,
    contextFileIds = [],
    responseMode = 'fast'
  }) {
    const cleanQuery = typeof query === 'string' ? query.trim() : '';
    if (!cleanQuery || cleanQuery.length < 2) {
      logger.warn('[ChatService] Query rejected (too short)', {
        sessionId: sessionId || 'default',
        queryLength: cleanQuery.length
      });
      return { success: false, error: 'Query must be at least 2 characters' };
    }
    if (!this.ollamaService) {
      logger.error('[ChatService] Service unavailable', {
        hasSearch: Boolean(this.searchService),
        hasOllama: Boolean(this.ollamaService)
      });
      return { success: false, error: 'Chat service unavailable' };
    }

    logger.info('[ChatService] Query received', {
      sessionId: sessionId || 'default',
      queryLength: cleanQuery.length,
      topK,
      mode,
      chunkTopK,
      chunkWeight,
      contextFileCount: Array.isArray(contextFileIds) ? contextFileIds.length : 0
    });

    const memory = await this._getSessionMemory(sessionId);
    const history = await this._getHistoryText(memory);

    const modeConfig = RESPONSE_MODES[responseMode] || RESPONSE_MODES.fast;
    const effectiveChunkTopK =
      Number.isInteger(chunkTopK) && chunkTopK > 0 ? chunkTopK : modeConfig.chunkTopK;
    const effectiveChunkWeight =
      typeof chunkWeight === 'number' ? chunkWeight : modeConfig.chunkWeight;

    const retrieval = await this._retrieveSources(cleanQuery, {
      topK,
      mode,
      chunkTopK: effectiveChunkTopK,
      chunkWeight: effectiveChunkWeight,
      contextFileIds,
      expandSynonyms: modeConfig.expandSynonyms,
      correctSpelling: modeConfig.correctSpelling,
      rerank: modeConfig.rerank
    });

    logger.debug('[ChatService] Retrieval completed', {
      resultCount: retrieval?.sources?.length || 0,
      mode: retrieval?.meta?.mode || mode,
      contextBoosted: Boolean(retrieval?.meta?.contextBoosted),
      queryMeta: retrieval?.meta?.queryMeta ? Object.keys(retrieval.meta.queryMeta) : []
    });

    const persona = await this._getPersona();
    const prompt = this._buildPrompt({
      query: cleanQuery,
      history,
      sources: retrieval.sources,
      persona
    });

    const ollamaResult = await this.ollamaService.analyzeText(prompt, {
      format: 'json'
    });

    if (!ollamaResult?.success) {
      logger.warn('[ChatService] LLM response failed', {
        error: ollamaResult?.error || 'Unknown error'
      });
      return {
        success: false,
        error: ollamaResult?.error || 'LLM response failed',
        sources: retrieval.sources
      };
    }

    const parsed = this._parseResponse(ollamaResult.response, retrieval.sources);
    if (!retrieval?.sources?.length) {
      parsed.documentAnswer = [];
    }
    let assistantForMemory = this._formatForMemory(parsed);

    // FIX: Smart fallback if model returns nothing (improves UX)
    if (parsed.documentAnswer.length === 0 && parsed.modelAnswer.length === 0) {
      if (retrieval.sources.length === 0) {
        parsed.modelAnswer.push({
          text: "I couldn't find any documents matching your query. You might try:\n• Checking for typos\n• Using broader keywords\n• Asking about a topic present in your indexed files"
        });
      } else {
        parsed.modelAnswer.push({
          text: `I found ${retrieval.sources.length} potentially relevant documents, but I couldn't find a specific answer to your question in them. You can check the sources list below to explore them directly.`
        });
      }
      // Re-format for memory since we added a fallback response
      assistantForMemory = this._formatForMemory(parsed);
      await this._saveMemoryTurn(memory, cleanQuery, assistantForMemory);
    } else {
      await this._saveMemoryTurn(memory, cleanQuery, assistantForMemory);
    }

    return {
      success: true,
      response: parsed,
      sources: retrieval.sources,
      meta: retrieval.meta
    };
  }

  async _getSessionMemory(sessionId) {
    const key = sessionId || 'default';
    if (this.sessions.has(key)) {
      return this.sessions.get(key);
    }

    const memory = await this._createMemory();
    this.sessions.set(key, memory);
    return memory;
  }

  async _createMemory() {
    try {
      if (!this._langchainMemoryModule) {
        this._langchainMemoryModule = await this._loadMemoryModule();
      }

      const MemoryClass = this._resolveMemoryClass(this._langchainMemoryModule);
      if (!MemoryClass) {
        logger.warn(
          '[ChatService] LangChain memory module loaded but no constructable memory class found'
        );
        return this._createFallbackMemory();
      }

      return new MemoryClass({
        memoryKey: 'history',
        inputKey: 'input',
        outputKey: 'output',
        k: DEFAULTS.memoryWindow,
        returnMessages: false
      });
    } catch (error) {
      logger.warn('[ChatService] Falling back to simple memory:', error.message);
      return this._createFallbackMemory();
    }
  }

  async _loadMemoryModule() {
    return await import('@langchain/core/memory');
  }

  _resolveMemoryClass(moduleRef) {
    const candidates = [
      moduleRef?.BufferWindowMemory,
      moduleRef?.BufferMemory,
      moduleRef?.default?.BufferWindowMemory,
      moduleRef?.default?.BufferMemory
    ];

    return candidates.find((candidate) => typeof candidate === 'function') || null;
  }

  _createFallbackMemory() {
    const maxTurns = Math.max(1, DEFAULTS.memoryWindow);
    const lines = [];

    return {
      loadMemoryVariables: async () => ({
        history: lines.join('\n')
      }),
      saveContext: async ({ input }, { output }) => {
        if (typeof input === 'string' && input.trim()) {
          lines.push(`User: ${input.trim()}`);
        }
        if (typeof output === 'string' && output.trim()) {
          lines.push(`Assistant: ${output.trim()}`);
        }

        const maxLines = maxTurns * 2;
        if (lines.length > maxLines) {
          lines.splice(0, lines.length - maxLines);
        }
      }
    };
  }

  async _getHistoryText(memory) {
    try {
      const vars = await memory.loadMemoryVariables({});
      return typeof vars?.history === 'string' ? vars.history : '';
    } catch (error) {
      logger.debug('[ChatService] Failed to load memory variables:', error.message);
      return '';
    }
  }

  async _saveMemoryTurn(memory, input, output) {
    try {
      await memory.saveContext({ input }, { output });
    } catch (error) {
      logger.debug('[ChatService] Failed to save memory:', error.message);
    }
  }

  async _retrieveSources(
    query,
    { topK, mode, chunkTopK, chunkWeight, contextFileIds, expandSynonyms, correctSpelling, rerank }
  ) {
    const meta = {
      retrievalAvailable: true
    };

    if (!this.searchService || typeof this.searchService.hybridSearch !== 'function') {
      return {
        sources: [],
        meta: {
          ...meta,
          retrievalAvailable: false,
          warning: 'Document retrieval unavailable (search service not ready)'
        }
      };
    }

    let searchResults;
    try {
      searchResults = await this.searchService.hybridSearch(query, {
        topK,
        mode,
        chunkWeight,
        chunkTopK,
        expandSynonyms,
        correctSpelling,
        rerank
      });
    } catch (error) {
      logger.warn('[ChatService] Search failed:', error?.message || error);
      return {
        sources: [],
        meta: {
          ...meta,
          retrievalAvailable: false,
          error: error?.message || 'Search failed',
          warning: `Document retrieval failed: ${error?.message || 'Search failed'}`
        }
      };
    }

    if (!searchResults?.success) {
      const errorMessage = searchResults?.error || 'Search failed';
      return {
        sources: [],
        meta: {
          ...meta,
          retrievalAvailable: false,
          error: errorMessage,
          warning: `Document retrieval failed: ${errorMessage}`
        }
      };
    }

    const baseResults = Array.isArray(searchResults.results) ? searchResults.results : [];
    const chunkResults = await this.searchService.chunkSearch(
      query,
      topK,
      Number.isInteger(chunkTopK) ? chunkTopK : DEFAULTS.chunkTopK
    );
    const chunkMap = new Map();
    chunkResults.forEach((r) => {
      if (r?.id && r?.matchDetails?.bestSnippet) {
        chunkMap.set(r.id, r.matchDetails.bestSnippet);
      }
    });

    let finalResults = baseResults.slice(0, topK);
    if (Array.isArray(contextFileIds) && contextFileIds.length > 0) {
      const contextScores = await this._scoreContextFiles(query, contextFileIds);
      const contextRanked = contextScores
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, topK);

      const contextIds = new Set(contextRanked.map((r) => r.id));
      const fallback = baseResults.filter((r) => r?.id && !contextIds.has(r.id));
      finalResults = [...contextRanked, ...fallback].slice(0, topK);
      meta.contextBoosted = true;
    }

    const sources = finalResults.map((result, index) => {
      const fileId = result?.id;
      const metadata = result?.metadata || {};
      // Build comprehensive snippet with fallbacks for richer context
      const snippet =
        chunkMap.get(fileId) || metadata.summary || metadata.purpose || metadata.subject || '';
      // Parse tags if stored as JSON string
      let tags = metadata.tags || metadata.keywords || [];
      if (typeof tags === 'string') {
        try {
          tags = JSON.parse(tags);
        } catch {
          tags = [];
        }
      }

      // Parse colors if stored as JSON string
      let colors = metadata.colors || [];
      if (typeof colors === 'string') {
        try {
          colors = JSON.parse(colors);
        } catch {
          colors = [];
        }
      }

      const isImage = metadata.type === 'image';

      return {
        id: `doc-${index + 1}`,
        fileId,
        name: metadata.name || fileId,
        path: metadata.path || '',
        snippet,
        // Extended context for richer conversations
        summary: metadata.summary || '',
        purpose: metadata.purpose || '',
        subject: metadata.subject || '',
        entity: metadata.entity || '',
        project: metadata.project || '',
        documentType: metadata.documentType || metadata.type || '',
        category: metadata.category || '',
        reasoning: metadata.reasoning || '',
        // Document's primary date (from analysis)
        documentDate: metadata.date || metadata.documentDate || '',
        // Include truncated extracted text for deep context
        extractedText: metadata.extractedText ? metadata.extractedText.substring(0, 2000) : '',
        tags: Array.isArray(tags) ? tags : [],
        entities: metadata.keyEntities || [],
        dates: metadata.dates || [],
        score: result?.score || 0,
        confidence: metadata.confidence || 0,
        matchDetails: result?.matchDetails || {},
        // Image-specific fields
        isImage,
        contentType: isImage ? metadata.content_type || '' : '',
        hasText: isImage ? Boolean(metadata.has_text) : false,
        colors: isImage ? (Array.isArray(colors) ? colors : []) : []
      };
    });

    const searchMeta = searchResults.meta || null;
    const fallbackReason = searchMeta?.fallbackReason;
    const isFallback = Boolean(searchMeta?.fallback || searchResults.mode === 'bm25-fallback');

    return {
      sources,
      meta: {
        ...meta,
        mode: searchResults.mode || mode,
        queryMeta: searchResults.queryMeta || null,
        searchMeta,
        resultCount: sources.length,
        ...(isFallback
          ? {
              fallback: true,
              fallbackReason: fallbackReason || 'embedding model unavailable',
              warning: `Limited document retrieval: ${
                fallbackReason || 'embedding model unavailable'
              }`
            }
          : {})
      }
    };
  }

  async _scoreContextFiles(query, fileIds) {
    try {
      if (!this.embeddingService || !this.chromaDbService) return [];
      const cleanIds = fileIds
        .filter((id) => typeof id === 'string' && id.length > 0)
        .slice(0, DEFAULTS.contextFileLimit);

      if (cleanIds.length === 0) return [];

      const embedResult = await this.embeddingService.embedText(query);
      if (!embedResult?.vector?.length) return [];

      await this.chromaDbService.initialize();
      const expectedDim =
        typeof this.chromaDbService.getCollectionDimension === 'function'
          ? await this.chromaDbService.getCollectionDimension('files')
          : null;
      const queryVector = this._padOrTruncateVector(embedResult.vector, expectedDim);
      if (!queryVector?.length) return [];

      const fileResult = await this.chromaDbService.fileCollection.get({ ids: cleanIds });
      const ids = Array.isArray(fileResult?.ids) ? fileResult.ids : [];
      const embeddings = Array.isArray(fileResult?.embeddings) ? fileResult.embeddings : [];
      const metadatas = Array.isArray(fileResult?.metadatas) ? fileResult.metadatas : [];

      const scored = [];
      for (let i = 0; i < ids.length; i += 1) {
        const vec = embeddings[i];
        if (!Array.isArray(vec) || vec.length === 0) continue;
        if (vec.length !== queryVector.length) continue;

        scored.push({
          id: ids[i],
          score: cosineSimilarity(queryVector, vec),
          metadata: metadatas[i] || {}
        });
      }

      return scored;
    } catch (error) {
      logger.debug('[ChatService] Context scoring failed (non-fatal):', error.message);
      return [];
    }
  }

  _padOrTruncateVector(vector, expectedDim) {
    if (!Array.isArray(vector) || vector.length === 0) return null;
    if (!Number.isInteger(expectedDim) || expectedDim <= 0) return vector;
    if (vector.length === expectedDim) return vector;
    if (vector.length < expectedDim) {
      return vector.concat(new Array(expectedDim - vector.length).fill(0));
    }
    return vector.slice(0, expectedDim);
  }

  async _getPersona() {
    try {
      if (this.settingsService?.load) {
        const settings = await this.settingsService.load();
        return getChatPersonaOrDefault(settings?.chatPersona);
      }
    } catch (error) {
      logger.debug('[ChatService] Failed to load persona setting:', error.message);
    }
    return getChatPersonaOrDefault();
  }

  _buildPrompt({ query, history, sources, persona }) {
    // Build comprehensive source context for richer conversations
    const sourcesText = sources
      .map((s) => {
        const lines = [`[${s.id}] ${s.name} ${s.isImage ? '(Image)' : '(Document)'}`];
        if (s.path) lines.push(`Path: ${s.path}`);
        if (s.category) lines.push(`Category: ${s.category}`);
        if (s.documentType) lines.push(`Type: ${s.documentType}`);
        if (s.documentDate) lines.push(`Date: ${s.documentDate}`);
        if (s.entity) lines.push(`Entity: ${s.entity}`);
        if (s.project) lines.push(`Project: ${s.project}`);
        if (s.purpose) lines.push(`Purpose: ${s.purpose}`);
        if (s.reasoning) lines.push(`Classification reason: ${s.reasoning}`);
        if (s.snippet) lines.push(`Summary: ${s.snippet}`);
        if (s.tags?.length > 0) lines.push(`Tags: ${s.tags.join(', ')}`);
        // Image-specific context
        if (s.isImage) {
          if (s.contentType) lines.push(`Content type: ${s.contentType}`);
          if (s.hasText) lines.push(`Contains text: Yes`);
          if (s.colors?.length > 0) lines.push(`Color palette: ${s.colors.slice(0, 5).join(', ')}`);
        }
        // Include extracted text for deeper context if available
        if (s.extractedText)
          lines.push(`Content excerpt: ${s.extractedText.substring(0, 1000)}...`);
        return lines.join('\n');
      })
      .join('\n\n---\n\n');
    const personaText = persona?.guidance
      ? `${persona.label}\n${persona.guidance}`
      : '(no persona guidance)';

    return `
You are StratoSort, an intelligent and helpful local document assistant.
You have access to the user's documents and can answer questions about them.
You may use your general training knowledge, but you must clearly distinguish it from document-sourced information.

Persona guidance:
${personaText}

Conversation history:
${history || '(none)'}

User question:
${query}

Document sources (for citations):
${sourcesText || '(no documents found)'}

Return ONLY valid JSON with this shape:
{
  "documentAnswer": [
    { "text": "answer grounded in documents", "citations": ["doc-1", "doc-2"] }
  ],
  "modelAnswer": [
    { "text": "answer using model knowledge (no citations)" }
  ],
  "followUps": ["short question 1", "short question 2"]
}

Rules:
- Use the document metadata (category, type, entity, project, purpose, tags) to provide rich context.
- Put document-grounded statements only in documentAnswer, with citations to the source ids above.
- Put training-knowledge statements only in modelAnswer, with no citations.
- If no document support exists, documentAnswer should be empty.
- If the question is conversational (e.g., "hello", "who are you"), respond in modelAnswer.
- When discussing documents, mention relevant details like entity, project, and purpose when helpful.
- Keep responses concise and conversational.
`.trim();
  }

  _parseResponse(rawResponse, sources) {
    const fallback = {
      documentAnswer: [],
      modelAnswer: rawResponse ? [{ text: String(rawResponse) }] : [],
      followUps: []
    };

    const parsed = extractAndParseJSON(rawResponse, fallback) || fallback;
    const sourceIds = new Set((sources || []).map((s) => s.id));

    const documentAnswer = Array.isArray(parsed.documentAnswer) ? parsed.documentAnswer : [];
    const modelAnswer = Array.isArray(parsed.modelAnswer) ? parsed.modelAnswer : [];
    const followUps = Array.isArray(parsed.followUps) ? parsed.followUps : [];

    const normalizedDocs = documentAnswer
      .map((item) => ({
        text: typeof item?.text === 'string' ? item.text.trim() : '',
        citations: Array.isArray(item?.citations)
          ? item.citations.filter((id) => sourceIds.has(id))
          : []
      }))
      .filter((item) => item.text.length > 0);

    const normalizedModel = modelAnswer
      .map((item) => ({
        text: typeof item?.text === 'string' ? item.text.trim() : ''
      }))
      .filter((item) => item.text.length > 0);

    return {
      documentAnswer: normalizedDocs,
      modelAnswer: normalizedModel,
      followUps: followUps.filter((q) => typeof q === 'string' && q.trim().length > 0)
    };
  }

  _formatForMemory(parsed) {
    const docs = parsed.documentAnswer?.map((d) => d.text).filter(Boolean) || [];
    const model = parsed.modelAnswer?.map((d) => d.text).filter(Boolean) || [];
    const combined = [...docs, ...model].join('\n');
    return combined || 'No answer produced.';
  }
}

module.exports = ChatService;
