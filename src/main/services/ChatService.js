const { createLogger } = require('../../shared/logger');
const { cosineSimilarity, padOrTruncateVector } = require('../../shared/vectorMath');
const { extractAndParseJSON } = require('../utils/jsonRepair');
const { getChatPersonaOrDefault } = require('../../shared/chatPersonas');

const logger = createLogger('ChatService');
const DEFAULTS = {
  topK: 6,
  mode: 'hybrid',
  chunkTopK: 10,
  chunkWeight: 0.2,
  contextFileLimit: 200,
  memoryWindow: 6
};

const MAX_SESSIONS = 50;

const RESPONSE_MODES = {
  fast: {
    chunkTopK: 10,
    chunkWeight: 0.2,
    expandSynonyms: true,
    correctSpelling: true,
    rerank: false
  },
  deep: {
    chunkTopK: 60,
    chunkWeight: 0.4,
    expandSynonyms: true,
    correctSpelling: true,
    rerank: true
  }
};

class ChatService {
  constructor({ searchService, vectorDbService, embeddingService, llamaService, settingsService }) {
    this.searchService = searchService;
    this.vectorDbService = vectorDbService;
    this.embeddingService = embeddingService;
    this.llamaService = llamaService;
    this.settingsService = settingsService;
    this.sessions = new Map();
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

    if (!this.llamaService) {
      logger.error('[ChatService] Service unavailable', {
        hasSearch: Boolean(this.searchService),
        hasLlama: Boolean(this.llamaService)
      });
      return { success: false, error: 'Chat service unavailable' };
    }

    // Short-circuit for pure chitchat to save resources
    if (this._isConversational(cleanQuery)) {
      logger.info('[ChatService] Detected conversational query, skipping retrieval', {
        query: cleanQuery
      });
      const memory = await this._getSessionMemory(sessionId);
      const history = await this._getHistoryText(memory);

      const prompt = `
You are StratoSort, a helpful document assistant.
The user said: "${cleanQuery}"
Conversation history:
${history || '(none)'}

Respond naturally and friendly. If they are greeting you, greet them back and offer to help find documents.
Return ONLY valid JSON:
{
  "modelAnswer": [{ "text": "Your conversational response here." }],
  "documentAnswer": [],
  "followUps": ["What projects are active?", "Find my tax returns", "Show me recent images"]
}`;

      try {
        const result = await this.llamaService.analyzeText(prompt, { format: 'json' });
        if (result?.success) {
          const parsed = this._parseResponse(result.response, []);
          await this._saveMemoryTurn(memory, cleanQuery, this._formatForMemory(parsed));
          return { success: true, response: parsed, sources: [], meta: { retrievalSkipped: true } };
        }
      } catch (err) {
        logger.warn('[ChatService] Conversational response failed:', err);
      }
      // Fall through to normal flow if something fails
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

    const llamaResult = await this.llamaService.analyzeText(prompt, {
      format: 'json'
    });

    if (!llamaResult?.success) {
      logger.warn('[ChatService] LLM response failed', {
        error: llamaResult?.error || 'Unknown error'
      });
      return {
        success: false,
        error: llamaResult?.error || 'LLM response failed',
        sources: retrieval.sources
      };
    }

    const parsed = this._parseResponse(llamaResult.response, retrieval.sources);
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

    // Evict oldest session if at capacity (Map maintains insertion order)
    if (this.sessions.size >= MAX_SESSIONS) {
      const oldestKey = this.sessions.keys().next().value;
      this.sessions.delete(oldestKey);
    }

    const memory = await this._createMemory();
    this.sessions.set(key, memory);
    return memory;
  }

  async _createMemory() {
    return this._createFallbackMemory();
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

  _isConversational(query) {
    const conversational = new Set([
      'hello',
      'hi',
      'hey',
      'thanks',
      'thank you',
      'good morning',
      'good afternoon',
      'good evening',
      'who are you',
      'what can you do'
    ]);
    const clean = query
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .trim();
    return conversational.has(clean);
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

    let settingsSnapshot = null;

    let searchResults;
    try {
      let retrievalSettings = {};
      try {
        if (this.settingsService?.load) {
          const settings = await this.settingsService.load();
          settingsSnapshot = settings;
          retrievalSettings = {
            ...(typeof settings?.graphExpansionEnabled === 'boolean' && {
              graphExpansion: settings.graphExpansionEnabled
            }),
            ...(Number.isFinite(settings?.graphExpansionWeight) && {
              graphExpansionWeight: settings.graphExpansionWeight
            }),
            ...(Number.isInteger(settings?.graphExpansionMaxNeighbors) && {
              graphExpansionMaxNeighbors: settings.graphExpansionMaxNeighbors
            }),
            ...(typeof settings?.chunkContextEnabled === 'boolean' && {
              chunkContext: settings.chunkContextEnabled
            }),
            ...(Number.isInteger(settings?.chunkContextMaxNeighbors) && {
              chunkContextMaxNeighbors: settings.chunkContextMaxNeighbors
            })
          };
        }
      } catch (settingsError) {
        logger.debug('[ChatService] Failed to load retrieval settings:', settingsError?.message);
      }

      searchResults = await this.searchService.hybridSearch(query, {
        topK,
        mode,
        chunkWeight,
        chunkTopK,
        expandSynonyms,
        correctSpelling,
        rerank,
        ...retrievalSettings
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
      Number.isInteger(chunkTopK) ? chunkTopK : DEFAULTS.chunkTopK,
      {
        chunkContext:
          typeof settingsSnapshot?.chunkContextEnabled === 'boolean'
            ? settingsSnapshot.chunkContextEnabled
            : undefined,
        chunkContextMaxNeighbors: Number.isInteger(settingsSnapshot?.chunkContextMaxNeighbors)
          ? settingsSnapshot.chunkContextMaxNeighbors
          : undefined
      }
    );
    const chunkMap = new Map();
    chunkResults.forEach((r) => {
      const snippet = r?.matchDetails?.contextSnippet || r?.matchDetails?.bestSnippet;
      if (r?.id && snippet) {
        chunkMap.set(r.id, snippet);
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
      if (!this.embeddingService || !this.vectorDbService) return [];
      const cleanIds = fileIds
        .filter((id) => typeof id === 'string' && id.length > 0)
        .slice(0, DEFAULTS.contextFileLimit);

      if (cleanIds.length === 0) return [];

      const embedResult = await this.embeddingService.embedText(query);
      if (!embedResult?.vector?.length) return [];

      await this.vectorDbService.initialize();
      const expectedDim =
        typeof this.vectorDbService.getCollectionDimension === 'function'
          ? await this.vectorDbService.getCollectionDimension('files')
          : null;
      const queryVector = this._padOrTruncateVector(embedResult.vector, expectedDim);
      if (!queryVector?.length) return [];

      const fileDocs = await Promise.all(
        cleanIds.map(async (id) => {
          try {
            return await this.vectorDbService.getFile(id);
          } catch {
            return null;
          }
        })
      );

      const scored = [];
      for (let i = 0; i < cleanIds.length; i += 1) {
        const doc = fileDocs[i];
        const vec = doc?.embedding;
        if (!Array.isArray(vec) || vec.length === 0) continue;
        if (vec.length !== queryVector.length) continue;

        scored.push({
          id: cleanIds[i],
          score: cosineSimilarity(queryVector, vec),
          metadata: doc
            ? {
                path: doc.filePath,
                filePath: doc.filePath,
                fileName: doc.fileName,
                fileType: doc.fileType,
                analyzedAt: doc.analyzedAt,
                suggestedName: doc.suggestedName,
                keywords: doc.keywords,
                tags: doc.tags,
                extractionMethod: doc.extractionMethod
              }
            : {}
        });
      }

      return scored;
    } catch (error) {
      logger.debug('[ChatService] Context scoring failed (non-fatal):', error.message);
      return [];
    }
  }

  // FIX: Use shared padOrTruncateVector from vectorMath.js to eliminate duplication
  _padOrTruncateVector(vector, expectedDim) {
    return padOrTruncateVector(vector, expectedDim);
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
Your goal is to help the user understand their documents and find information quickly.

Persona guidance:
${personaText}

Conversation history:
${history || '(none)'}

User question:
${query}

Document sources:
${sourcesText || '(no documents found)'}

Return ONLY valid JSON with this shape:
{
  "documentAnswer": [
    { "text": "answer grounded in documents", "citations": ["doc-1", "doc-2"] }
  ],
  "modelAnswer": [
    { "text": "answer using model knowledge or conversational glue" }
  ],
  "followUps": ["Natural follow-up question 1?", "Natural follow-up question 2?"]
}

Rules:
1. Synthesize information from the provided documents to answer the user's question directly.
2. Use 'documentAnswer' for any statements backed by the sources, and include the relevant citations.
3. Use 'modelAnswer' for:
   - General knowledge or explanations not found in the docs.
   - Conversational transitions or friendly closing remarks.
   - Responses to greetings or off-topic chitchat.
4. Use document metadata (Project, Entity, Date, Type) to add useful context to your answer.
5. Be concise but helpful. Avoid robotic repetition.
6. If the documents don't answer the question, say so clearly in 'modelAnswer' and offer general advice if applicable.
7. Generate 1-3 natural follow-up questions that help the user explore their data further.
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
