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
const HOLISTIC_MIN_TOPK = 12;
const HOLISTIC_MIN_CHUNK_TOPK = 80;
const HOLISTIC_MIN_CHUNK_WEIGHT = 0.35;

const MAX_SESSIONS = 50;

// Minimum *raw* cosine similarity (from embeddings) for a source to be
// included in the chat prompt.  The fused score after min-max normalization
// is unreliable for quality gating because normalization stretches the best-
// of-a-bad-bunch to 1.0.  Raw cosine similarity is an absolute quality signal:
//   ≥ 0.55  strong semantic match
//   0.35–0.55  moderate match
//   < 0.25  effectively random for most embedding models
// 0.25 is intentionally higher than the global MIN_SIMILARITY_SCORE (0.15)
// because chat/RAG requires genuinely relevant context.
const CHAT_MIN_SEMANTIC_SCORE = 0.25;

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
  constructor({
    searchService,
    vectorDbService,
    embeddingService,
    llamaService,
    settingsService,
    chatHistoryStore
  }) {
    this.searchService = searchService;
    this.vectorDbService = vectorDbService;
    this.embeddingService = embeddingService;
    this.llamaService = llamaService;
    this.settingsService = settingsService;
    this.chatHistoryStore = chatHistoryStore;
    this.sessions = new Map(); // Keep for legacy/fallback or cache
    this.activeStreamControllers = new Map(); // request/session keyed AbortControllers
  }

  async resetSession(sessionId) {
    if (sessionId) {
      this.sessions.delete(sessionId);
      const key = String(sessionId);
      for (const [streamKey, streamState] of this.activeStreamControllers) {
        if (String(streamState?.sessionId || '') === key) {
          try {
            streamState.controller?.abort();
          } catch {
            // Ignore abort errors
          }
          this.activeStreamControllers.delete(streamKey);
        }
      }
    }
  }

  async cancelStreamingRequest({ requestId, sessionId } = {}) {
    if (requestId !== undefined && requestId !== null) {
      const key = `req:${String(requestId)}`;
      const streamState = this.activeStreamControllers.get(key);
      if (streamState?.controller) {
        streamState.controller.abort();
        this.activeStreamControllers.delete(key);
        return { canceled: true, by: 'requestId' };
      }
    }

    if (sessionId) {
      const sessionKey = String(sessionId);
      for (const [key, streamState] of this.activeStreamControllers) {
        if (String(streamState?.sessionId || '') === sessionKey) {
          try {
            streamState.controller?.abort();
          } catch {
            // Ignore abort errors
          }
          this.activeStreamControllers.delete(key);
          return { canceled: true, by: 'sessionId' };
        }
      }
    }

    return { canceled: false };
  }

  async query({
    sessionId,
    query,
    topK = DEFAULTS.topK,
    mode = DEFAULTS.mode,
    chunkTopK = DEFAULTS.chunkTopK,
    chunkWeight = DEFAULTS.chunkWeight,
    contextFileIds = [],
    strictScope = false,
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
You are StratoSort, a friendly local AI assistant that helps users explore, search, and understand the files on their machine. Everything runs 100% on-device.

The user said: "${cleanQuery}"
Conversation history:
${history || '(none)'}

Guidelines:
- Be warm, concise, and conversational — like a helpful colleague, not a research paper.
- If they greet you, greet them back naturally.
- If they ask what you can do or how to use you, explain your capabilities in plain language:
  you can search their indexed documents by meaning, answer questions about file contents,
  find related files, summarize documents, and help organize their workspace.
- Suggest 2-3 specific things they could try, phrased as natural questions.

Return ONLY valid JSON:
{
  "modelAnswer": [{ "text": "Your conversational response here." }],
  "documentAnswer": [],
  "followUps": ["A natural follow-up the user might ask"]
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

    const {
      retrieval,
      prompt,
      holisticIntent,
      correctionIntent,
      comparisonIntent,
      gapAnalysisIntent,
      contradictions,
      forcedResponseMode,
      memory
    } = await this._runRetrieval({
      sessionId,
      cleanQuery,
      topK,
      mode,
      chunkTopK,
      chunkWeight,
      contextFileIds,
      strictScope,
      responseMode
    });

    // FIX BUG-007: Abstain when strict scope is on and no sources found
    if (strictScope && (!retrieval.sources || retrieval.sources.length === 0)) {
      const abstention = {
        documentAnswer: [],
        modelAnswer: [
          {
            text: 'I cannot find this information in the selected documents. Try broadening your document scope or rephrasing your question.'
          }
        ],
        followUps: []
      };
      await this._saveMemoryTurn(memory, cleanQuery, {
        text: abstention.modelAnswer[0].text,
        documentAnswer: [],
        modelAnswer: abstention.modelAnswer,
        sources: [],
        followUps: []
      });
      return {
        success: true,
        response: abstention,
        sources: [],
        meta: { ...retrieval.meta, strictScopeAbstention: true }
      };
    }

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
    let assistantForMemory = {
      text: this._formatForMemory(parsed, retrieval.sources),
      documentAnswer: parsed.documentAnswer,
      modelAnswer: parsed.modelAnswer,
      sources: retrieval.sources,
      followUps: parsed.followUps || []
    };

    // Smart fallback if model returns nothing (improves UX)
    if (parsed.documentAnswer.length === 0 && parsed.modelAnswer.length === 0) {
      const dropped = retrieval.meta?.droppedLowRelevance || 0;
      if (retrieval.sources.length === 0 && dropped === 0) {
        parsed.modelAnswer.push({
          text: "I didn't find any documents matching your query. Try rephrasing with different keywords, or ask about a topic that's in your indexed files."
        });
      } else if (retrieval.sources.length === 0 && dropped > 0) {
        parsed.modelAnswer.push({
          text: `I found ${dropped} document${dropped > 1 ? 's' : ''} but none were relevant enough to your question. Try more specific keywords or a different angle.`
        });
      } else {
        parsed.modelAnswer.push({
          text: `I found ${retrieval.sources.length} related document${retrieval.sources.length > 1 ? 's' : ''} but couldn't extract a specific answer. You can explore the sources below directly.`
        });
      }
      // Re-format for memory since we added a fallback response
      assistantForMemory = {
        text: this._formatForMemory(parsed, retrieval.sources),
        documentAnswer: parsed.documentAnswer,
        modelAnswer: parsed.modelAnswer,
        sources: retrieval.sources,
        followUps: parsed.followUps || []
      };
      await this._saveMemoryTurn(memory, cleanQuery, assistantForMemory);
    } else {
      await this._saveMemoryTurn(memory, cleanQuery, assistantForMemory);
    }

    return {
      success: true,
      response: parsed,
      sources: retrieval.sources,
      meta: {
        ...retrieval.meta,
        responseMode: forcedResponseMode,
        holisticIntent,
        correctionIntent,
        comparisonIntent,
        gapAnalysisIntent,
        contradictions
      }
    };
  }

  async queryStreaming({
    sessionId,
    requestId,
    query,
    topK = DEFAULTS.topK,
    mode = DEFAULTS.mode,
    chunkTopK = DEFAULTS.chunkTopK,
    chunkWeight = DEFAULTS.chunkWeight,
    contextFileIds = [],
    strictScope = false,
    responseMode = 'fast',
    documentScopeItems = [],
    onEvent
  }) {
    const cleanQuery = typeof query === 'string' ? query.trim() : '';
    if (!cleanQuery || cleanQuery.length < 2) {
      if (onEvent) onEvent({ type: 'error', error: 'Query must be at least 2 characters' });
      return;
    }

    if (!this.llamaService) {
      if (onEvent) onEvent({ type: 'error', error: 'Chat service unavailable' });
      return;
    }

    const streamKey =
      requestId !== undefined && requestId !== null
        ? `req:${String(requestId)}`
        : `session:${String(sessionId || 'default')}`;
    const streamController = new AbortController();
    this.activeStreamControllers.set(streamKey, {
      controller: streamController,
      sessionId: sessionId || 'default'
    });

    // Short-circuit for pure chitchat
    try {
      if (this._isConversational(cleanQuery)) {
        if (onEvent) onEvent({ type: 'status', text: 'Thinking...' });
        const memory = await this._getSessionMemory(sessionId);
        memory._documentScope = documentScopeItems || [];
        const history = await this._getHistoryText(memory);

        const prompt = `
You are StratoSort, a friendly local AI assistant that helps users explore, search, and understand the files on their machine. Everything runs 100% on-device.

The user said: "${cleanQuery}"
Conversation history:
${history || '(none)'}

Guidelines:
- Be warm, concise, and conversational — like a helpful colleague, not a research paper.
- If they greet you, greet them back naturally.
- If they ask what you can do or how to use you, explain your capabilities in plain language:
  you can search their indexed documents by meaning, answer questions about file contents,
  find related files, summarize documents, and help organize their workspace.
- Suggest 2-3 specific things they could try, phrased as natural questions.

Return ONLY valid JSON:
{
  "modelAnswer": [{ "text": "Your conversational response here." }],
  "documentAnswer": [],
  "followUps": ["A natural follow-up the user might ask"]
}`;

        let fullResponse = '';
        try {
          // FIX BUG-002: Buffer tokens server-side — don't stream raw JSON to user
          let tokenCount = 0;
          await this.llamaService.generateTextStreaming({
            prompt,
            signal: streamController.signal,
            onToken: (token) => {
              fullResponse += token;
              tokenCount++;
              if (tokenCount % 20 === 0 && onEvent) {
                onEvent({ type: 'status', text: 'Generating response...' });
              }
            }
          });

          const parsed = this._parseResponse(fullResponse, []);
          await this._saveMemoryTurn(memory, cleanQuery, this._formatForMemory(parsed));

          // Emit final parsed prose as a single chunk, then structured done
          const proseText = [
            ...(parsed.modelAnswer || []).map((a) => a.text),
            ...(parsed.documentAnswer || []).map((a) => a.text)
          ]
            .filter(Boolean)
            .join('\n\n');
          if (proseText && onEvent) {
            onEvent({ type: 'chunk', text: proseText });
          }
          if (onEvent)
            onEvent({
              type: 'done',
              response: parsed,
              sources: [],
              meta: { retrievalSkipped: true }
            });
        } catch (err) {
          logger.warn('[ChatService] Conversational streaming failed:', err);
          try {
            const isAbort = err?.name === 'AbortError';
            if (onEvent)
              onEvent({
                type: 'error',
                error: isAbort ? 'Generation canceled' : 'Conversational response failed'
              });
          } catch (eventErr) {
            logger.warn('[ChatService] onEvent callback also failed:', eventErr?.message);
          }
        }
        return;
      }
      if (onEvent) onEvent({ type: 'status', text: 'Searching documents...' });

      const {
        retrieval,
        prompt,
        holisticIntent,
        correctionIntent,
        comparisonIntent,
        gapAnalysisIntent,
        contradictions,
        forcedResponseMode,
        memory
      } = await this._runRetrieval({
        sessionId,
        cleanQuery,
        topK,
        mode,
        chunkTopK,
        chunkWeight,
        contextFileIds,
        strictScope,
        responseMode
      });
      memory._documentScope = documentScopeItems || [];

      if (onEvent) {
        onEvent({
          type: 'status',
          text: `Found ${retrieval.sources.length} relevant sources...`
        });
      }

      // FIX BUG-007: Abstain in streaming when strict scope + no sources
      if (strictScope && (!retrieval.sources || retrieval.sources.length === 0)) {
        const abstentionText =
          'I cannot find this information in the selected documents. Try broadening your document scope or rephrasing your question.';
        const abstention = {
          documentAnswer: [],
          modelAnswer: [{ text: abstentionText }],
          followUps: []
        };
        if (onEvent) {
          onEvent({ type: 'chunk', text: abstentionText });
          onEvent({
            type: 'done',
            response: abstention,
            sources: [],
            meta: { ...retrieval.meta, strictScopeAbstention: true }
          });
        }
        return;
      }

      let fullResponse = '';
      // FIX BUG-002: Buffer tokens — don't stream raw JSON to the user
      let tokenCount = 0;
      await this.llamaService.generateTextStreaming({
        prompt,
        signal: streamController.signal,
        onToken: (token) => {
          fullResponse += token;
          tokenCount++;
          if (tokenCount % 20 === 0 && onEvent) {
            onEvent({ type: 'status', text: 'Analyzing documents...' });
          }
        }
      });

      const parsed = this._parseResponse(fullResponse, retrieval.sources);
      if (!retrieval?.sources?.length) {
        parsed.documentAnswer = [];
      }

      // Smart fallback logic (mirrors query())
      if (parsed.documentAnswer.length === 0 && parsed.modelAnswer.length === 0) {
        const dropped = retrieval.meta?.droppedLowRelevance || 0;
        let fallbackText = '';
        if (retrieval.sources.length === 0 && dropped === 0) {
          fallbackText =
            "I didn't find any documents matching your query. Try rephrasing with different keywords, or ask about a topic that's in your indexed files.";
        } else if (retrieval.sources.length === 0 && dropped > 0) {
          fallbackText = `I found ${dropped} document${dropped > 1 ? 's' : ''} but none were relevant enough to your question. Try more specific keywords or a different angle.`;
        } else {
          fallbackText = `I found ${retrieval.sources.length} related document${retrieval.sources.length > 1 ? 's' : ''} but couldn't extract a specific answer. You can explore the sources below directly.`;
        }
        parsed.modelAnswer.push({ text: fallbackText });
      }

      // Emit final parsed prose as a single chunk for UI display (after fallback)
      const proseText = [
        ...(parsed.documentAnswer || []).map((a) => a.text),
        ...(parsed.modelAnswer || []).map((a) => a.text)
      ]
        .filter(Boolean)
        .join('\n\n');
      if (proseText && onEvent) {
        onEvent({ type: 'chunk', text: proseText });
      }

      const assistantForMemory = {
        text: this._formatForMemory(parsed, retrieval.sources),
        documentAnswer: parsed.documentAnswer,
        modelAnswer: parsed.modelAnswer,
        sources: retrieval.sources,
        followUps: parsed.followUps || [],
        meta: {
          ...retrieval.meta,
          responseMode: forcedResponseMode,
          holisticIntent,
          comparisonIntent,
          gapAnalysisIntent,
          contradictions
        }
      };
      await this._saveMemoryTurn(memory, cleanQuery, assistantForMemory);

      if (onEvent) {
        onEvent({
          type: 'done',
          response: parsed,
          sources: retrieval.sources,
          meta: {
            ...retrieval.meta,
            responseMode: forcedResponseMode,
            holisticIntent,
            correctionIntent,
            comparisonIntent,
            gapAnalysisIntent,
            contradictions
          }
        });
      }
    } catch (error) {
      logger.error('[ChatService] Streaming query failed:', error);
      const isAbort = error?.name === 'AbortError';
      // FIX FAULT-003: Save the user's message even on failure so it's not lost
      if (!isAbort) {
        try {
          const memory = await this._getSessionMemory(sessionId);
          if (this.chatHistoryStore && memory?.sessionId) {
            let conv = this.chatHistoryStore.getConversation(memory.sessionId);
            if (!conv) {
              this.chatHistoryStore.createConversation(
                (typeof cleanQuery === 'string' ? cleanQuery.slice(0, 50) : '') ||
                  'New Conversation',
                memory._documentScope || [],
                memory.sessionId
              );
            }
            this.chatHistoryStore.addMessage(memory.sessionId, {
              role: 'user',
              text: cleanQuery
            });
            this.chatHistoryStore.addMessage(memory.sessionId, {
              role: 'assistant',
              text: '',
              modelAnswer: [
                { text: `Error: ${error.message || 'Response failed'}. Please try again.` }
              ]
            });
          }
        } catch (saveErr) {
          logger.warn('[ChatService] Failed to save error turn:', saveErr.message);
        }
      }
      if (onEvent)
        onEvent({
          type: 'error',
          error: isAbort ? 'Generation canceled' : error.message || 'Streaming failed'
        });
    } finally {
      this.activeStreamControllers.delete(streamKey);
    }
  }

  async _runRetrieval({
    sessionId,
    cleanQuery,
    topK,
    mode,
    chunkTopK,
    chunkWeight,
    contextFileIds,
    strictScope = false,
    responseMode
  }) {
    logger.info('[ChatService] Retrieval started', {
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
    const holisticIntent = this._isHolisticSynthesisQuery(cleanQuery);
    const correctionIntent = this._isCorrectionFeedback(cleanQuery);
    const comparisonIntent = this._isComparisonQuery(cleanQuery);
    const gapAnalysisIntent = this._isGapAnalysisQuery(cleanQuery);

    const forcedResponseMode =
      (holisticIntent || comparisonIntent || gapAnalysisIntent) && responseMode !== 'deep'
        ? 'deep'
        : responseMode;
    const modeConfig = RESPONSE_MODES[forcedResponseMode] || RESPONSE_MODES.fast;
    const needsBroadRetrieval = holisticIntent || comparisonIntent || gapAnalysisIntent;
    const effectiveTopK = needsBroadRetrieval ? Math.max(topK, HOLISTIC_MIN_TOPK) : topK;
    const effectiveChunkTopK = needsBroadRetrieval
      ? Math.max(
          Number.isInteger(chunkTopK) && chunkTopK > 0 ? chunkTopK : modeConfig.chunkTopK,
          HOLISTIC_MIN_CHUNK_TOPK
        )
      : Number.isInteger(chunkTopK) && chunkTopK > 0
        ? chunkTopK
        : modeConfig.chunkTopK;
    const effectiveChunkWeight = needsBroadRetrieval
      ? Math.max(
          typeof chunkWeight === 'number' ? chunkWeight : modeConfig.chunkWeight,
          HOLISTIC_MIN_CHUNK_WEIGHT
        )
      : typeof chunkWeight === 'number'
        ? chunkWeight
        : modeConfig.chunkWeight;
    const effectiveRerank = Boolean(modeConfig.rerank || needsBroadRetrieval);

    const retrieval = await this._retrieveSources(cleanQuery, {
      topK: effectiveTopK,
      mode,
      chunkTopK: effectiveChunkTopK,
      chunkWeight: effectiveChunkWeight,
      contextFileIds,
      expandSynonyms: modeConfig.expandSynonyms,
      correctSpelling: modeConfig.correctSpelling,
      rerank: effectiveRerank
    });

    logger.debug('[ChatService] Retrieval completed', {
      resultCount: retrieval?.sources?.length || 0,
      mode: retrieval?.meta?.mode || mode,
      contextBoosted: Boolean(retrieval?.meta?.contextBoosted),
      queryMeta: retrieval?.meta?.queryMeta ? Object.keys(retrieval.meta.queryMeta) : []
    });

    const contradictions = this._detectContradictions(retrieval.sources);

    const persona = await this._getPersona();
    const prompt = this._buildPrompt({
      query: cleanQuery,
      history,
      sources: retrieval.sources,
      persona,
      intent: {
        holisticIntent,
        correctionIntent,
        comparisonIntent,
        gapAnalysisIntent
      },
      strictScope,
      contradictions
    });

    return {
      history,
      retrieval,
      persona,
      prompt,
      holisticIntent,
      correctionIntent,
      comparisonIntent,
      gapAnalysisIntent,
      contradictions,
      forcedResponseMode,
      memory
    };
  }

  async _getSessionMemory(sessionId) {
    const key = sessionId || 'default';

    if (this.chatHistoryStore) {
      try {
        return { sessionId: key };
      } catch (error) {
        logger.warn('[ChatService] Failed to access history store:', error.message);
        // Fallback to in-memory
      }
    }

    if (this.sessions.has(key)) {
      const session = this.sessions.get(key);
      session._lastAccessedAt = Date.now();
      return session;
    }

    // FIX BUG-021: Evict stale sessions (>24h) before checking capacity
    const STALE_MS = 24 * 60 * 60 * 1000;
    const now = Date.now();
    for (const [sk, sv] of this.sessions) {
      if (now - (sv._lastAccessedAt || 0) > STALE_MS) {
        this.sessions.delete(sk);
      }
    }

    // Evict oldest session if still at capacity (Map maintains insertion order)
    if (this.sessions.size >= MAX_SESSIONS) {
      const oldestKey = this.sessions.keys().next().value;
      this.sessions.delete(oldestKey);
    }

    const memory = this._createMemory();
    memory._lastAccessedAt = Date.now();
    this.sessions.set(key, memory);
    return memory;
  }

  /**
   * Create a simple in-memory conversation buffer.
   * @returns {Object} Memory object with loadMemoryVariables and saveContext
   */
  _createMemory() {
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
    if (this.chatHistoryStore && memory?.sessionId) {
      try {
        const conv = this.chatHistoryStore.getConversation(memory.sessionId);
        if (!conv) return '';
        const messages = conv.messages.slice(-(DEFAULTS.memoryWindow * 2));
        return messages
          .map((m) => {
            const role = m.role === 'user' ? 'User' : 'Assistant';
            let text = m.text;
            if (m.role === 'assistant' && !text) {
              const docs =
                m.documentAnswer
                  ?.map((d) => d.text)
                  .filter(Boolean)
                  .join('\n') || '';
              const model =
                m.modelAnswer
                  ?.map((d) => d.text)
                  .filter(Boolean)
                  .join('\n') || '';
              text = [docs, model].filter(Boolean).join('\n');
            }
            if (
              m.role === 'assistant' &&
              text &&
              Array.isArray(m.sources) &&
              m.sources.length > 0
            ) {
              for (const source of m.sources) {
                const sourceId = source?.id;
                const sourceName = source?.name;
                if (!sourceId || !sourceName) continue;
                const escapedId = String(sourceId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                text = text.replace(new RegExp(`\\[${escapedId}\\]`, 'g'), `[${sourceName}]`);
              }
            }
            return `${role}: ${text}`;
          })
          .join('\n');
      } catch (error) {
        logger.warn('[ChatService] Failed to load history from store:', error.message);
      }
    }

    try {
      const vars = await memory.loadMemoryVariables({});
      return typeof vars?.history === 'string' ? vars.history : '';
    } catch (error) {
      logger.debug('[ChatService] Failed to load memory variables:', error.message);
      return '';
    }
  }

  async _saveMemoryTurn(memory, input, output) {
    if (this.chatHistoryStore && memory?.sessionId) {
      try {
        // Ensure conversation exists, passing sessionId so the store uses it
        let conv = this.chatHistoryStore.getConversation(memory.sessionId);
        if (!conv) {
          this.chatHistoryStore.createConversation(
            (typeof input === 'string' ? input.slice(0, 50) : '') || 'New Conversation',
            memory._documentScope || [],
            memory.sessionId
          );
        }

        // Persist user turn
        this.chatHistoryStore.addMessage(memory.sessionId, {
          role: 'user',
          text: typeof input === 'string' ? input : ''
        });

        // FIX BUG-003: Persist full structured response for citation preservation
        const assistantMessage = {
          role: 'assistant',
          text: typeof output === 'string' ? output : output?.text || ''
        };
        if (output && typeof output === 'object' && !Array.isArray(output)) {
          assistantMessage.text = output.text || '';
          assistantMessage.documentAnswer = output.documentAnswer || [];
          assistantMessage.modelAnswer = output.modelAnswer || [];
          assistantMessage.sources = output.sources || [];
          assistantMessage.followUps = output.followUps || [];
          assistantMessage.meta = output.meta || {};
        }
        this.chatHistoryStore.addMessage(memory.sessionId, assistantMessage);
        return;
      } catch (error) {
        logger.warn('[ChatService] Failed to persist turn:', error.message);
      }
    }

    // Fallback to in-memory saveContext for sessions without ChatHistoryStore
    if (typeof memory?.saveContext === 'function') {
      try {
        await memory.saveContext({ input }, { output });
      } catch (error) {
        logger.debug('[ChatService] Failed to save memory:', error.message);
      }
    }
  }

  _isConversational(query) {
    // Exact-match greetings / closers
    const exactPhrases = new Set([
      'hello',
      'hi',
      'hey',
      'thanks',
      'thank you',
      'good morning',
      'good afternoon',
      'good evening',
      'who are you',
      'what can you do',
      'what do you do',
      'help',
      'help me',
      'yo',
      'sup',
      'howdy',
      'bye',
      'goodbye',
      'see ya'
    ]);

    // Pattern-match capability / meta questions (safe, bounded patterns)
    const capabilityPatterns = [
      /^what can you\b/,
      /^what (?:do|does|will) you\b/,
      /^how (?:can|do) you help\b/,
      /^how does this work\b/,
      /^what (?:are|is) you(?:r)?\b/,
      /^(?:can|could) you help\b/,
      /^tell me (?:about yourself|what you do)\b/,
      /^what (?:kind|type) of\b.*\bhelp\b/,
      /^how do i use\b/
    ];

    // FIX: Truncate before regex to prevent ReDoS on very long untrusted input.
    // Chat queries shouldn't be conversational if they're over 100 chars.
    if (query.length > 100) return false;
    const clean = query
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .trim();
    if (exactPhrases.has(clean)) return true;
    return capabilityPatterns.some((rx) => rx.test(clean));
  }

  _isComparisonQuery(query) {
    const q = String(query || '').toLowerCase();
    if (!q || q.length > 300) return false;
    return (
      /\bcompar(?:e|ing|ison)\b/.test(q) ||
      /\bdifferences?\s+between\b/.test(q) ||
      /\bhow\s+(?:does|do)\s+.+\s+differ\b/.test(q) ||
      /\bvs\.?\b/.test(q) ||
      /\bside[\s-]by[\s-]side\b/.test(q) ||
      /\bcontrast\b/.test(q)
    );
  }

  _isGapAnalysisQuery(query) {
    const q = String(query || '').toLowerCase();
    if (!q || q.length > 300) return false;
    return (
      /\bgap(?:s)?\s+(?:in|analysis)\b/.test(q) ||
      /\bwhat(?:'s|\s+is)\s+missing\b/.test(q) ||
      /\bwhat\s+(?:questions?|topics?)\s+(?:can't|cannot|aren't|are\s+not)\b/.test(q) ||
      /\bnot\s+covered\b/.test(q) ||
      /\bonly\s+(?:one|1|single)\s+source\b/.test(q) ||
      /\bcoverage\b/.test(q) ||
      /\bblind\s+spots?\b/.test(q)
    );
  }

  _detectContradictions(sources) {
    if (!sources || sources.length < 2) return [];

    const contradictions = [];

    for (let i = 0; i < sources.length - 1; i++) {
      for (let j = i + 1; j < sources.length; j++) {
        const a = sources[i];
        const b = sources[j];

        // Check for shared entities/tags that might indicate topical overlap
        const aTags = new Set([
          ...(a.tags || []).map((t) => t.toLowerCase()),
          ...(a.entity ? [a.entity.toLowerCase()] : []),
          ...(a.category ? [a.category.toLowerCase()] : [])
        ]);
        const bTags = new Set([
          ...(b.tags || []).map((t) => t.toLowerCase()),
          ...(b.entity ? [b.entity.toLowerCase()] : []),
          ...(b.category ? [b.category.toLowerCase()] : [])
        ]);

        const sharedTopics = [...aTags].filter((t) => bTags.has(t));
        if (sharedTopics.length === 0) continue;

        // Check for date divergence (different dates suggest potential evolution/contradiction)
        const aDate = a.documentDate || '';
        const bDate = b.documentDate || '';
        const hasDifferentDates = aDate && bDate && aDate !== bDate;

        // Only flag as potential contradiction if there's topical overlap
        // AND some signal of divergence (different dates, different entities, etc.)
        if (hasDifferentDates || (a.entity && b.entity && a.entity !== b.entity)) {
          contradictions.push({
            docA: {
              id: a.id,
              name: a.name,
              date: aDate,
              snippet: (a.snippet || a.summary || '').slice(0, 200)
            },
            docB: {
              id: b.id,
              name: b.name,
              date: bDate,
              snippet: (b.snippet || b.summary || '').slice(0, 200)
            },
            sharedTopics,
            reason: hasDifferentDates ? 'different_dates' : 'different_entities'
          });
        }
      }
    }

    return contradictions.slice(0, 5);
  }

  _isHolisticSynthesisQuery(query) {
    const q = String(query || '').toLowerCase();
    if (!q) return false;
    return (
      /\ball\b.*\bdocs?\b/.test(q) ||
      /\bacross\b.*\bdocs?\b/.test(q) ||
      /\bholistic\b/.test(q) ||
      /\bbig picture\b/.test(q) ||
      /\bdig deeper\b/.test(q) ||
      /\bprofile\b/.test(q) ||
      /\bbased on\b.*\bdocuments?\b/.test(q)
    );
  }

  _isCorrectionFeedback(query) {
    const q = String(query || '').toLowerCase();
    if (!q) return false;
    return (
      /\bnot correct\b/.test(q) ||
      /\bwrong\b/.test(q) ||
      /\bregenerate\b/.test(q) ||
      /\bretry\b/.test(q) ||
      /\bdig deeper\b/.test(q) ||
      /\bholistic\b/.test(q)
    );
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

    // FIX Bug #28: Wrap chunkSearch in try/catch to prevent chat crash on index failure
    let chunkResults;
    try {
      chunkResults = await this.searchService.chunkSearch(
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
    } catch (chunkError) {
      chunkResults = [];
      logger.warn('[ChatService] Chunk search failed (non-fatal):', chunkError.message);
    }

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

    // Enrich ALL results (including context-boosted files that bypass the search
    // pipeline) with the full analysis metadata from the documentMap. This ensures
    // the LLM prompt gets summary, purpose, entity, extractedText, etc. — not just
    // the bare-bones fields stored in the vector DB.
    if (this.searchService && typeof this.searchService.enrichResults === 'function') {
      const enrichmentSafeResults = finalResults.map((result) => ({
        ...result,
        metadata:
          result && typeof result.metadata === 'object' && result.metadata !== null
            ? { ...result.metadata }
            : {}
      }));
      this.searchService.enrichResults(enrichmentSafeResults);
      finalResults = enrichmentSafeResults;
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

      // ── Raw semantic score ──
      // The fused score (result.score) is min-max normalized and can inflate
      // terrible matches to 1.0. The raw vector/chunk cosine similarity is
      // the actual measure of semantic relevance. Expose it as semanticScore
      // so the LLM prompt, relevance gate, and UI all use the real signal.
      const hybrid = result?.matchDetails?.hybrid || {};
      const rawSemantic =
        typeof hybrid.vectorRawScore === 'number'
          ? hybrid.vectorRawScore
          : typeof hybrid.chunkRawScore === 'number'
            ? hybrid.chunkRawScore
            : null;
      // If neither vector nor chunk search found this result (BM25-only),
      // rawSemantic is null → semanticScore falls back to 0, signaling
      // that there is no embedding-backed relevance.
      const semanticScore = rawSemantic !== null ? rawSemantic : 0;

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
        // Raw cosine similarity from embedding search (0-1, absolute quality)
        semanticScore,
        confidence: metadata.confidence || 0,
        matchDetails: result?.matchDetails || {},
        // Image-specific fields
        isImage,
        contentType: isImage ? metadata.content_type || '' : '',
        hasText: isImage ? Boolean(metadata.has_text) : false,
        colors: isImage ? (Array.isArray(colors) ? colors : []) : []
      };
    });

    // ── Relevance gate (semantic) ──
    // Gate on raw cosine similarity instead of the fused score. The fused
    // score is min-max normalized and can make garbage look like gold.
    // Raw cosine similarity is an absolute quality signal: < 0.25 is
    // effectively random for most embedding models.
    const relevantSources = sources.filter((s) => s.semanticScore >= CHAT_MIN_SEMANTIC_SCORE);
    const droppedCount = sources.length - relevantSources.length;
    if (droppedCount > 0) {
      logger.debug(
        `[ChatService] Dropped ${droppedCount} low-relevance sources (semantic < ${CHAT_MIN_SEMANTIC_SCORE})`,
        {
          kept: relevantSources.length,
          droppedScores: sources
            .filter((s) => s.semanticScore < CHAT_MIN_SEMANTIC_SCORE)
            .map((s) => ({ fused: s.score.toFixed(3), semantic: s.semanticScore.toFixed(3) }))
            .slice(0, 3)
        }
      );
    }

    const searchMeta = searchResults.meta || null;
    const fallbackReason = searchMeta?.fallbackReason;
    const isFallback = Boolean(searchMeta?.fallback || searchResults.mode === 'bm25-fallback');

    return {
      sources: relevantSources,
      meta: {
        ...meta,
        mode: searchResults.mode || mode,
        queryMeta: searchResults.queryMeta || null,
        searchMeta,
        resultCount: relevantSources.length,
        totalRetrieved: sources.length,
        droppedLowRelevance: droppedCount,
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
        const normalizedVec = this._padOrTruncateVector(vec, queryVector.length);
        if (!normalizedVec?.length) continue;

        const similarity = cosineSimilarity(queryVector, normalizedVec);
        scored.push({
          id: cleanIds[i],
          score: similarity,
          metadata: doc
            ? {
                path: doc.filePath,
                filePath: doc.filePath,
                name: doc.fileName,
                fileName: doc.fileName,
                fileType: doc.fileType,
                analyzedAt: doc.analyzedAt,
                suggestedName: doc.suggestedName,
                keywords: doc.keywords,
                tags: doc.tags,
                extractionMethod: doc.extractionMethod
              }
            : {},
          // Provide matchDetails so the source builder and relevance gate
          // can read the raw cosine similarity as vectorRawScore. Without
          // this, semanticScore falls back to 0 and the relevance gate
          // silently drops every context-boosted file.
          matchDetails: {
            hybrid: { vectorRawScore: similarity },
            sources: ['context']
          }
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

  _buildPrompt({
    query,
    history,
    sources,
    persona,
    intent = {},
    strictScope = false,
    contradictions = []
  }) {
    // Build source context using the raw semantic score (actual cosine
    // similarity) for all quality decisions. High-similarity sources get
    // full extracted text; marginal sources get metadata only.
    const sourcesText = sources
      .map((s) => {
        // Use semantic (raw cosine) score — not the inflated fused score —
        // so the LLM can accurately judge source quality.
        const semPct = Math.round((s.semanticScore ?? s.score ?? 0) * 100);
        const lines = [
          `[${s.id}] ${s.name} ${s.isImage ? '(Image)' : '(Document)'}  (semantic relevance: ${semPct}%)`
        ];
        if (s.path) lines.push(`Path: ${s.path}`);
        if (s.category) lines.push(`Category: ${s.category}`);
        if (s.documentType) lines.push(`Type: ${s.documentType}`);
        if (s.documentDate) lines.push(`Date: ${s.documentDate}`);
        if (s.entity) lines.push(`Entity: ${s.entity}`);
        if (s.project) lines.push(`Project: ${s.project}`);
        if (s.purpose) lines.push(`Purpose: ${s.purpose}`);
        if (s.snippet) lines.push(`Summary: ${s.snippet}`);
        if (s.tags?.length > 0) lines.push(`Tags: ${s.tags.join(', ')}`);
        // Image-specific context
        if (s.isImage) {
          if (s.contentType) lines.push(`Content type: ${s.contentType}`);
          if (s.hasText) lines.push(`Contains text: Yes`);
          if (s.colors?.length > 0) lines.push(`Color palette: ${s.colors.slice(0, 5).join(', ')}`);
        }
        // Only include extracted text for sources with meaningful semantic
        // similarity to avoid flooding the context window with irrelevant
        // content. Use semanticScore (raw cosine) for the threshold.
        const semScore = s.semanticScore ?? s.score ?? 0;
        if (s.extractedText && semScore >= 0.4) {
          const maxChars = semScore >= 0.6 ? 1200 : 600;
          lines.push(`Content excerpt: ${s.extractedText.substring(0, maxChars)}`);
        }
        return lines.join('\n');
      })
      .join('\n\n---\n\n');
    const personaText = persona?.guidance
      ? `${persona.label}\n${persona.guidance}`
      : '(no persona guidance)';
    const holisticIntent = Boolean(intent?.holisticIntent);
    const correctionIntent = Boolean(intent?.correctionIntent);
    const comparisonIntent = Boolean(intent?.comparisonIntent);
    const gapAnalysisIntent = Boolean(intent?.gapAnalysisIntent);

    const contradictionContext =
      contradictions.length > 0
        ? `\nPOTENTIAL CONFLICTS DETECTED:\n${contradictions
            .map(
              (c) =>
                `- ${c.docA.name}${c.docA.date ? ` (${c.docA.date})` : ''} vs ${c.docB.name}${c.docB.date ? ` (${c.docB.date})` : ''}: shared topics [${c.sharedTopics.join(', ')}]. Note these discrepancies in your answer with both citations [${c.docA.id}] and [${c.docB.id}].`
            )
            .join('\n')}\n`
        : '';

    const comparisonRules = comparisonIntent
      ? `
Comparison constraints:
- The user is asking for a comparison. Structure your documentAnswer as a comparison.
- For each topic or dimension, describe what each document says with inline citations.
- If a document does not address a topic, explicitly state that it is absent (gap signal).
- Use the JSON format, but make each documentAnswer item cover one comparison dimension.
`.trim()
      : '';

    const gapAnalysisRules = gapAnalysisIntent
      ? `
Gap analysis constraints:
- The user is asking about coverage gaps.
- Categorize topics into: well-covered (3+ sources), thin-covered (1 source), and gaps (not covered).
- For each category, list the specific topics with their source citations.
- Suggest search terms or document types that could fill identified gaps.
`.trim()
      : '';

    const synthesisRules = holisticIntent
      ? `
Holistic constraints:
- Synthesize across multiple sources instead of anchoring on one document.
- If 3+ sources are available, use evidence from at least 3 distinct sources.
- For profile-style requests, summarize observable patterns (work style, topics, preferences) and avoid medical/clinical diagnosis.
- If evidence is weak/conflicting, say that explicitly and lower certainty.
`.trim()
      : '';
    const correctionRules = correctionIntent
      ? `
Correction constraints:
- The user indicated prior answer quality issues. Re-evaluate from scratch against sources.
- Do not repeat previous assistant claims unless supported by the current document evidence.
`.trim()
      : '';

    const strictInstruction = strictScope
      ? `STRICT SCOPE ENFORCED: You must ONLY answer using the provided Document sources. If the answer is not in the documents, state "I cannot find this information in the selected documents." Do NOT use outside knowledge.`
      : `If no sources are provided, or they are clearly unrelated to the question, respond helpfully in 'modelAnswer': acknowledge you did not find matching documents and suggest what the user could try instead. Do NOT fabricate document-based claims.`;

    return `
You are StratoSort, a friendly local AI assistant that helps users explore and understand their documents. Everything runs 100% on-device.

Style: ${personaText}

Conversation history:
${history || '(none)'}

User question:
${query}

Document sources:
${sourcesText || '(no documents found)'}

Return ONLY valid JSON with this shape:
{
  "documentAnswer": [
    { "text": "Answer with [doc-1] inline citations [doc-2] after each claim.", "citations": ["doc-1", "doc-2"] }
  ],
  "modelAnswer": [
    { "text": "answer using model knowledge or conversational glue" }
  ],
  "followUps": ["Natural follow-up question 1?", "Natural follow-up question 2?"]
}

Rules:
1. Answer the user's question directly and naturally — like a knowledgeable colleague, not a research report.
2. Each source has a relevance percentage. Prioritize high-relevance sources; treat low-relevance ones (< 50%) as background context only.
3. Use 'documentAnswer' for claims directly backed by sources. Place [doc-N] markers inline in your text immediately after the specific claim they support. Every factual claim from a document MUST have an inline citation.
4. Write in flowing prose. NEVER start with "The provided documents do not..." or similar hedging.
5. ${strictInstruction}
6. Weave document metadata (Project, Entity, Date, Type) into your answer naturally when it adds value.
7. Be concise. One clear paragraph is better than multiple fragmented bullet sections.
8. Generate 1-3 natural follow-up questions grounded in what you know about the user's documents. Avoid generic questions like "Can you provide more context?" — instead suggest specific things they might search for.
9. If the query is casual or about your capabilities, respond warmly in 'modelAnswer' and leave 'documentAnswer' empty.
${synthesisRules}
${correctionRules}
${comparisonRules}
${gapAnalysisRules}
${contradictionContext}
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

  _formatForMemory(parsed, sources = []) {
    const docs = parsed.documentAnswer?.map((d) => d.text).filter(Boolean) || [];
    const model = parsed.modelAnswer?.map((d) => d.text).filter(Boolean) || [];
    const combined = [...docs, ...model].join('\n');
    if (!combined) return 'No answer produced.';

    // Include source names so follow-up questions like "tell me more about
    // the tax return" can be grounded. Without this, the flat history loses
    // all context about which documents were referenced.
    const sourceNames = (sources || [])
      .filter((s) => s?.name)
      .slice(0, 6)
      .map((s) => s.name);
    if (sourceNames.length > 0) {
      return `${combined}\n[Referenced: ${sourceNames.join(', ')}]`;
    }
    return combined;
  }
}

module.exports = ChatService;
