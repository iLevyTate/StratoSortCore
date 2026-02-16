// ═══════════════════════════════════════════════════════════════════════════════
// STRATOSORT CORE — COMPLETE BUG FIX PATCHES
// 22 patches covering every identified issue
// Apply in order using search-and-replace in your editor
// ═══════════════════════════════════════════════════════════════════════════════
//
// HOW TO USE:
// 1. Open the target file listed for each patch
// 2. Search for the exact FIND block (it appears once in the file)
// 3. Replace with the REPLACE block
// 4. Save and repeat for next patch
//
// Patches are ordered by severity: CRITICAL → HIGH → MEDIUM → LOW
// ═══════════════════════════════════════════════════════════════════════════════

// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ PATCH-001 — BUG-001 (CRITICAL)                                             │
// │ File: src/renderer/components/search/UnifiedSearchModal.jsx                 │
// │ Error events via STREAM_CHUNK silently dropped → infinite spinner           │
// └─────────────────────────────────────────────────────────────────────────────┘

// FIND:
//
//           } else if (data.type === 'done') {
//
// REPLACE WITH:
//
//           } else if (data.type === 'error') {
//             // FIX BUG-001: Handle error events relayed via STREAM_CHUNK
//             logger.warn('[KnowledgeOS] Chat error via stream', { error: data.error });
//             const { message } = mapErrorToNotification({ error: data.error || 'Chat failed' });
//             setChatError(message);
//             setChatWarning('');
//             setChatStatus('');
//             setChatMessages((prev) => {
//               const newMessages = [...prev];
//               const lastMsg = newMessages[newMessages.length - 1];
//               if (lastMsg && lastMsg.role === 'assistant' && lastMsg.isStreaming) {
//                 newMessages.pop();
//               }
//               return newMessages;
//             });
//             setIsChatting(false);
//             chatInFlightRef.current = false;
//           } else if (data.type === 'done') {

// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ PATCH-002a — BUG-002 (CRITICAL)                                            │
// │ File: src/main/services/ChatService.js                                     │
// │ Conversational streaming path — buffer tokens instead of streaming raw JSON │
// └─────────────────────────────────────────────────────────────────────────────┘

// FIND (in queryStreaming, inside the _isConversational block):
//
//       let fullResponse = '';
//       try {
//         await this.llamaService.generateTextStreaming({
//           prompt,
//           onToken: (token) => {
//             fullResponse += token;
//             if (onEvent) onEvent({ type: 'chunk', text: token });
//           }
//         });
//
//         const parsed = this._parseResponse(fullResponse, []);
//         await this._saveMemoryTurn(memory, cleanQuery, this._formatForMemory(parsed));
//         if (onEvent) onEvent({ type: 'done', response: parsed, sources: [], meta: { retrievalSkipped: true } });
//
// REPLACE WITH:
//
//       let fullResponse = '';
//       try {
//         // FIX BUG-002: Buffer tokens server-side — don't stream raw JSON to user
//         let tokenCount = 0;
//         await this.llamaService.generateTextStreaming({
//           prompt,
//           onToken: (token) => {
//             fullResponse += token;
//             tokenCount++;
//             if (tokenCount % 20 === 0 && onEvent) {
//               onEvent({ type: 'status', text: 'Generating response...' });
//             }
//           }
//         });
//
//         const parsed = this._parseResponse(fullResponse, []);
//         await this._saveMemoryTurn(memory, cleanQuery, this._formatForMemory(parsed));
//
//         // Emit final parsed prose as a single chunk, then structured done
//         const proseText = [
//           ...(parsed.modelAnswer || []).map(a => a.text),
//           ...(parsed.documentAnswer || []).map(a => a.text)
//         ].filter(Boolean).join('\n\n');
//         if (proseText && onEvent) {
//           onEvent({ type: 'chunk', text: proseText });
//         }
//         if (onEvent) onEvent({ type: 'done', response: parsed, sources: [], meta: { retrievalSkipped: true } });

// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ PATCH-002b — BUG-002 (CRITICAL)                                            │
// │ File: src/main/services/ChatService.js                                     │
// │ Main (document-backed) streaming path — same buffering fix                  │
// └─────────────────────────────────────────────────────────────────────────────┘

// FIND (in queryStreaming, after the status event "Found N relevant sources"):
//
//       let fullResponse = '';
//       await this.llamaService.generateTextStreaming({
//         prompt,
//         onToken: (token) => {
//           fullResponse += token;
//           if (onEvent) onEvent({ type: 'chunk', text: token });
//         }
//       });
//
//       const parsed = this._parseResponse(fullResponse, retrieval.sources);
//
// REPLACE WITH:
//
//       let fullResponse = '';
//       // FIX BUG-002: Buffer tokens — don't stream raw JSON to the user
//       let tokenCount = 0;
//       await this.llamaService.generateTextStreaming({
//         prompt,
//         onToken: (token) => {
//           fullResponse += token;
//           tokenCount++;
//           if (tokenCount % 20 === 0 && onEvent) {
//             onEvent({ type: 'status', text: 'Analyzing documents...' });
//           }
//         }
//       });
//
//       const parsed = this._parseResponse(fullResponse, retrieval.sources);
//
//       // Emit final parsed prose as a single chunk for UI display
//       const proseText = [
//         ...(parsed.documentAnswer || []).map(a => a.text),
//         ...(parsed.modelAnswer || []).map(a => a.text)
//       ].filter(Boolean).join('\n\n');
//       if (proseText && onEvent) {
//         onEvent({ type: 'chunk', text: proseText });
//       }

// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ PATCH-003a — BUG-003 (HIGH)                                                │
// │ File: src/main/services/ChatService.js — _saveMemoryTurn()                 │
// │ Pass structured data to addMessage instead of flat string                   │
// └─────────────────────────────────────────────────────────────────────────────┘

// FIND:
//
//         // Persist assistant turn
//         this.chatHistoryStore.addMessage(memory.sessionId, {
//           role: 'assistant',
//           text: typeof output === 'string' ? output : ''
//         });
//
// REPLACE WITH:
//
//         // FIX BUG-003: Persist full structured response for citation preservation
//         const assistantMessage = {
//           role: 'assistant',
//           text: typeof output === 'string' ? output : (output?.text || '')
//         };
//         if (output && typeof output === 'object' && !Array.isArray(output)) {
//           assistantMessage.text = output.text || '';
//           assistantMessage.documentAnswer = output.documentAnswer || [];
//           assistantMessage.modelAnswer = output.modelAnswer || [];
//           assistantMessage.sources = output.sources || [];
//           assistantMessage.followUps = output.followUps || [];
//         }
//         this.chatHistoryStore.addMessage(memory.sessionId, assistantMessage);

// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ PATCH-003b — BUG-003 (HIGH)                                                │
// │ File: src/main/services/ChatService.js — query() non-streaming             │
// │ Build structured memory object instead of flat string                       │
// └─────────────────────────────────────────────────────────────────────────────┘

// FIND:
//
//     let assistantForMemory = this._formatForMemory(parsed, retrieval.sources);
//
//     // Smart fallback if model returns nothing (improves UX)
//
// REPLACE WITH:
//
//     let assistantForMemory = {
//       text: this._formatForMemory(parsed, retrieval.sources),
//       documentAnswer: parsed.documentAnswer,
//       modelAnswer: parsed.modelAnswer,
//       sources: retrieval.sources,
//       followUps: parsed.followUps || []
//     };
//
//     // Smart fallback if model returns nothing (improves UX)

// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ PATCH-003c — BUG-003 (HIGH)                                                │
// │ File: src/main/services/ChatService.js — query() after fallback injection   │
// │ Re-format after fallback must also be structured                            │
// └─────────────────────────────────────────────────────────────────────────────┘

// FIND:
//
//       // Re-format for memory since we added a fallback response
//       assistantForMemory = this._formatForMemory(parsed, retrieval.sources);
//       await this._saveMemoryTurn(memory, cleanQuery, assistantForMemory);
//
// REPLACE WITH:
//
//       // Re-format for memory since we added a fallback response
//       assistantForMemory = {
//         text: this._formatForMemory(parsed, retrieval.sources),
//         documentAnswer: parsed.documentAnswer,
//         modelAnswer: parsed.modelAnswer,
//         sources: retrieval.sources,
//         followUps: parsed.followUps || []
//       };
//       await this._saveMemoryTurn(memory, cleanQuery, assistantForMemory);

// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ PATCH-003d — BUG-003 (HIGH)                                                │
// │ File: src/main/services/ChatService.js — queryStreaming() memory save       │
// │ Same structured memory for streaming path                                   │
// └─────────────────────────────────────────────────────────────────────────────┘

// FIND (in queryStreaming, after smart fallback and before the onEvent 'done'):
//
//       const assistantForMemory = this._formatForMemory(parsed, retrieval.sources);
//       await this._saveMemoryTurn(memory, cleanQuery, assistantForMemory);
//
// REPLACE WITH:
//
//       const assistantForMemory = {
//         text: this._formatForMemory(parsed, retrieval.sources),
//         documentAnswer: parsed.documentAnswer,
//         modelAnswer: parsed.modelAnswer,
//         sources: retrieval.sources,
//         followUps: parsed.followUps || []
//       };
//       await this._saveMemoryTurn(memory, cleanQuery, assistantForMemory);

// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ PATCH-004 — BUG-004 (HIGH)                                                 │
// │ File: src/renderer/components/search/UnifiedSearchModal.jsx                 │
// │ Add stream 'end' listener + cleanup on unmount                              │
// └─────────────────────────────────────────────────────────────────────────────┘

// FIND:
//
//         stream.on('error', (err) => {
//           if (!isCurrentRequest(chatRequestCounterRef, requestId)) return;
//
//           logger.warn('[KnowledgeOS] Chat query failed', { error: err?.message || err });
//
// REPLACE WITH:
//
//         // FIX BUG-004: Listen for 'end' to ensure IPC listeners are cleaned up
//         stream.on('end', () => {
//           if (chatInFlightRef.current) {
//             setIsChatting(false);
//             chatInFlightRef.current = false;
//           }
//         });
//
//         stream.on('error', (err) => {
//           if (!isCurrentRequest(chatRequestCounterRef, requestId)) return;
//
//           logger.warn('[KnowledgeOS] Chat query failed', { error: err?.message || err });

// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ PATCH-005 — BUG-005 (HIGH)                                                 │
// │ File: src/renderer/components/search/CitationRenderer.jsx                   │
// │ Remove scrollY/scrollX from position calc — portal uses position:fixed      │
// └─────────────────────────────────────────────────────────────────────────────┘

// FIND:
//
//     const rect = e.currentTarget.getBoundingClientRect();
//     // Position the preview above the citation badge
//     setPreviewPos({
//       top: rect.top + window.scrollY - 10, // 10px gap
//       left: rect.left + window.scrollX
//     });
//
// REPLACE WITH:
//
//     const rect = e.currentTarget.getBoundingClientRect();
//     // FIX BUG-005: Portal uses position:fixed (viewport-relative), don't add scroll offsets
//     setPreviewPos({
//       top: rect.top - 10,
//       left: rect.left
//     });

// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ PATCH-006 — BUG-006 (HIGH)                                                 │
// │ File: src/renderer/components/search/ComparisonTable.jsx                    │
// │ Extract per-document text instead of rendering same text in every column    │
// └─────────────────────────────────────────────────────────────────────────────┘

// STEP 1: Add helper function after the imports, before parseComparisonData

// FIND:
//
// /**
//  * Extracts a simple comparison structure from documentAnswer items.
//  * Each item represents one comparison dimension/topic.
//  * The LLM is prompted to structure comparison answers per-topic.
//  */
// function parseComparisonData(documentAnswer, sources) {
//
// REPLACE WITH:
//
// /**
//  * FIX BUG-006: Extract only the sentences that cite a specific document.
//  */
// function extractSegmentsForDoc(text, docId) {
//   if (!text || !docId) return text || '';
//   const sentences = text.split(/(?<=[.!?])\s+/);
//   const marker = `[${docId}]`;
//   const matching = sentences.filter(s => s.includes(marker));
//   return matching.length > 0 ? matching.join(' ') : text;
// }
//
// /**
//  * Extracts a simple comparison structure from documentAnswer items.
//  * Each item represents one comparison dimension/topic.
//  * The LLM is prompted to structure comparison answers per-topic.
//  */
// function parseComparisonData(documentAnswer, sources) {

// STEP 2: Change the CitationRenderer text prop

// FIND:
//
//                             <CitationRenderer
//                               text={row.text}
//                               sources={sources}
//
// REPLACE WITH:
//
//                             <CitationRenderer
//                               text={extractSegmentsForDoc(row.text, col.id)}
//                               sources={sources}

// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ PATCH-007 — BUG-007 (HIGH)                                                 │
// │ File: src/main/services/ChatService.js — query() + queryStreaming()         │
// │ Abstain when strictScope + zero sources instead of calling LLM              │
// └─────────────────────────────────────────────────────────────────────────────┘

// --- In query(), before the llamaService.analyzeText call ---

// FIND:
//
//     const llamaResult = await this.llamaService.analyzeText(prompt, {
//       format: 'json'
//     });
//
//     if (!llamaResult?.success) {
//
// REPLACE WITH:
//
//     // FIX BUG-007: Abstain when strict scope is on and no sources found
//     if (strictScope && (!retrieval.sources || retrieval.sources.length === 0)) {
//       const abstention = {
//         documentAnswer: [],
//         modelAnswer: [{ text: 'I cannot find this information in the selected documents. Try broadening your document scope or rephrasing your question.' }],
//         followUps: []
//       };
//       await this._saveMemoryTurn(memory, cleanQuery, this._formatForMemory(abstention, []));
//       return {
//         success: true,
//         response: abstention,
//         sources: [],
//         meta: { ...retrieval.meta, strictScopeAbstention: true }
//       };
//     }
//
//     const llamaResult = await this.llamaService.analyzeText(prompt, {
//       format: 'json'
//     });
//
//     if (!llamaResult?.success) {

// --- In queryStreaming(), before the fullResponse buffering ---

// FIND:
//
//       if (onEvent) {
//         onEvent({
//           type: 'status',
//           text: `Found ${retrieval.sources.length} relevant sources...`
//         });
//       }
//
//       let fullResponse = '';
//
// REPLACE WITH:
//
//       if (onEvent) {
//         onEvent({
//           type: 'status',
//           text: `Found ${retrieval.sources.length} relevant sources...`
//         });
//       }
//
//       // FIX BUG-007: Abstain in streaming when strict scope + no sources
//       if (strictScope && (!retrieval.sources || retrieval.sources.length === 0)) {
//         const abstentionText = 'I cannot find this information in the selected documents. Try broadening your document scope or rephrasing your question.';
//         const abstention = { documentAnswer: [], modelAnswer: [{ text: abstentionText }], followUps: [] };
//         if (onEvent) {
//           onEvent({ type: 'chunk', text: abstentionText });
//           onEvent({ type: 'done', response: abstention, sources: [], meta: { ...retrieval.meta, strictScopeAbstention: true } });
//         }
//         return;
//       }
//
//       let fullResponse = '';

// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ PATCH-008 — BUG-008 (HIGH)                                                 │
// │ File: src/shared/chatPersonas.js                                            │
// │ Add missing Auditor persona                                                 │
// └─────────────────────────────────────────────────────────────────────────────┘

// FIND:
//
//   {
//     id: 'discoverer',
//     label: 'Discoverer',
//     description: 'Exploratory, curious responses that surface alternatives and next steps.',
//     guidance:
//       'Use an exploratory, curious tone. Highlight alternatives, note uncertainties, and suggest engaging next questions or angles to investigate.'
//   }
// ];
//
// REPLACE WITH:
//
//   {
//     id: 'discoverer',
//     label: 'Discoverer',
//     description: 'Exploratory, curious responses that surface alternatives and next steps.',
//     guidance:
//       'Use an exploratory, curious tone. Highlight alternatives, note uncertainties, and suggest engaging next questions or angles to investigate.'
//   },
//   {
//     id: 'auditor',
//     label: 'Auditor',
//     description: 'Strict citation-only responses that flag uncertainty explicitly.',
//     guidance:
//       'Never state anything not directly supported by the provided documents. Every claim must have an inline [doc-N] citation. Flag any uncertainty explicitly. If evidence is insufficient, say so rather than speculate. Prioritize accuracy over completeness.'
//   }
// ];

// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ PATCH-009a — BUG-009 (HIGH)                                                │
// │ File: src/shared/constants.js                                               │
// │ Add EXPORT_CONVERSATION channel                                             │
// └─────────────────────────────────────────────────────────────────────────────┘

// FIND:
//
//     SEARCH_CONVERSATIONS: 'chat:search-conversations'
//   },
//   KNOWLEDGE: {
//
// REPLACE WITH:
//
//     SEARCH_CONVERSATIONS: 'chat:search-conversations',
//     EXPORT_CONVERSATION: 'chat:export-conversation'
//   },
//   KNOWLEDGE: {

// NOTE: Also add the same line in the SECURITY_RECEIVE_CHANNELS section
// (search for the second occurrence of SEARCH_CONVERSATIONS: 'chat:search-conversations')

// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ PATCH-009b — BUG-009 (HIGH)                                                │
// │ File: src/main/services/ChatHistoryStore.js                                 │
// │ Add exportAsMarkdown(id) method                                             │
// └─────────────────────────────────────────────────────────────────────────────┘

// FIND:
//
//   shutdown() {
//     if (this._db) {
//
// REPLACE WITH:
//
//   exportAsMarkdown(conversationId) {
//     this._checkInit();
//     const conv = this.getConversation(conversationId);
//     if (!conv) return null;
//
//     const lines = [`# ${conv.title || 'Conversation'}\n`];
//     lines.push(`*Exported: ${new Date().toISOString()}*\n`);
//
//     for (const msg of conv.messages || []) {
//       const role = msg.role === 'user' ? '**You**' : '**StratoSort**';
//       lines.push(`\n## ${role}\n`);
//
//       if (msg.documentAnswer?.length > 0) {
//         for (const doc of msg.documentAnswer) {
//           if (doc.text) lines.push(doc.text + '\n');
//         }
//       }
//       if (msg.modelAnswer?.length > 0) {
//         for (const model of msg.modelAnswer) {
//           if (model.text) lines.push(model.text + '\n');
//         }
//       }
//       if (!msg.documentAnswer?.length && !msg.modelAnswer?.length && msg.text) {
//         lines.push(msg.text + '\n');
//       }
//       if (msg.sources?.length > 0) {
//         lines.push('\n**Sources:**\n');
//         for (const src of msg.sources) {
//           lines.push(`- [${src.id}] ${src.name || src.fileId}${src.path ? ` (${src.path})` : ''}\n`);
//         }
//       }
//     }
//     return lines.join('');
//   }
//
//   shutdown() {
//     if (this._db) {

// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ PATCH-009c — BUG-009 (HIGH)                                                │
// │ File: src/main/ipc/chat.js                                                  │
// │ Add EXPORT_CONVERSATION handler                                             │
// └─────────────────────────────────────────────────────────────────────────────┘

// FIND:
//
//       [IPC_CHANNELS.CHAT.SEARCH_CONVERSATIONS]: {
//         serviceName: 'chat',
//         getService: getChatServiceSafe,
//         fallbackResponse: { success: false, error: 'Chat service unavailable' },
//         handler: async (event, { query } = {}, service) => {
//           if (!service.chatHistoryStore) return { success: false, error: 'History not available' };
//           return { success: true, results: service.chatHistoryStore.searchConversations(query) };
//         }
//       }
//     }
//
// REPLACE WITH:
//
//       [IPC_CHANNELS.CHAT.SEARCH_CONVERSATIONS]: {
//         serviceName: 'chat',
//         getService: getChatServiceSafe,
//         fallbackResponse: { success: false, error: 'Chat service unavailable' },
//         handler: async (event, { query } = {}, service) => {
//           if (!service.chatHistoryStore) return { success: false, error: 'History not available' };
//           return { success: true, results: service.chatHistoryStore.searchConversations(query) };
//         }
//       },
//       [IPC_CHANNELS.CHAT.EXPORT_CONVERSATION]: {
//         serviceName: 'chat',
//         getService: getChatServiceSafe,
//         fallbackResponse: { success: false, error: 'Chat service unavailable' },
//         handler: async (event, { id } = {}, service) => {
//           if (!service.chatHistoryStore) return { success: false, error: 'History not available' };
//           if (!service.chatHistoryStore.exportAsMarkdown) return { success: false, error: 'Export not supported' };
//           const markdown = service.chatHistoryStore.exportAsMarkdown(id);
//           if (!markdown) return { success: false, error: 'Conversation not found' };
//           return { success: true, markdown };
//         }
//       }
//     }

// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ PATCH-009d — BUG-009 (HIGH)                                                │
// │ File: src/renderer/services/ipc/chatIpc.js                                  │
// │ Add exportConversation client function                                      │
// └─────────────────────────────────────────────────────────────────────────────┘

// FIND (last function in the file):
//
// export async function searchConversations(query) {
//   if (!electronAPI.chat.searchConversations) return [];
//   const result = await electronAPI.chat.searchConversations(query);
//   if (!result.success) throw new Error(result.error);
//   return result.results;
// }
//
// REPLACE WITH:
//
// export async function searchConversations(query) {
//   if (!electronAPI.chat.searchConversations) return [];
//   const result = await electronAPI.chat.searchConversations(query);
//   if (!result.success) throw new Error(result.error);
//   return result.results;
// }
//
// export async function exportConversation(id) {
//   if (!electronAPI.chat.exportConversation) return null;
//   const result = await electronAPI.chat.exportConversation(id);
//   if (!result.success) throw new Error(result.error);
//   return result.markdown;
// }

// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ PATCH-010 — BUG-010 (HIGH)                                                 │
// │ File: src/renderer/components/search/UnifiedSearchModal.jsx                 │
// │ Warn user when scope files aren't in index                                  │
// └─────────────────────────────────────────────────────────────────────────────┘

// FIND:
//
//         const result = await window.electronAPI.embeddings.findFilesByPaths(allPaths);
//         if (result.success && result.results) {
//              const newItems = result.results.map(r => ({
//                  id: r.id,
//                  path: r.path,
//                  name: r.name,
//                  type: r.type
//              }));
//
//              setDocumentScope(prev => {
//
// REPLACE WITH:
//
//         const result = await window.electronAPI.embeddings.findFilesByPaths(allPaths);
//         if (result.success && result.results) {
//              const newItems = result.results.map(r => ({
//                  id: r.id,
//                  path: r.path,
//                  name: r.name,
//                  type: r.type
//              }));
//
//              // FIX BUG-010: Warn about files not in index
//              const resolvedPaths = new Set(newItems.map(i => i.path));
//              const droppedPaths = allPaths.filter(p => !resolvedPaths.has(p));
//              if (droppedPaths.length > 0) {
//                const droppedNames = droppedPaths.map(p => p.split(/[/\\]/).pop()).slice(0, 5);
//                const suffix = droppedPaths.length > 5 ? ` and ${droppedPaths.length - 5} more` : '';
//                setChatWarning(`${droppedPaths.length} file(s) not in index: ${droppedNames.join(', ')}${suffix}. Index these files first.`);
//              }
//
//              setDocumentScope(prev => {

// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ PATCH-018 — BUG-021 (LOW)                                                  │
// │ File: src/main/services/ChatService.js — _getSessionMemory()               │
// │ Add TTL expiry to in-memory session cache                                   │
// └─────────────────────────────────────────────────────────────────────────────┘

// FIND:
//
//     if (this.sessions.has(key)) {
//       return this.sessions.get(key);
//     }
//
//     // Evict oldest session if at capacity (Map maintains insertion order)
//     if (this.sessions.size >= MAX_SESSIONS) {
//       const oldestKey = this.sessions.keys().next().value;
//       this.sessions.delete(oldestKey);
//     }
//
// REPLACE WITH:
//
//     if (this.sessions.has(key)) {
//       const session = this.sessions.get(key);
//       session._lastAccessedAt = Date.now();
//       return session;
//     }
//
//     // FIX BUG-021: Evict stale sessions (>24h) before checking capacity
//     const STALE_MS = 24 * 60 * 60 * 1000;
//     const now = Date.now();
//     for (const [sk, sv] of this.sessions) {
//       if (now - (sv._lastAccessedAt || 0) > STALE_MS) {
//         this.sessions.delete(sk);
//       }
//     }
//
//     // Evict oldest session if still at capacity (Map maintains insertion order)
//     if (this.sessions.size >= MAX_SESSIONS) {
//       const oldestKey = this.sessions.keys().next().value;
//       this.sessions.delete(oldestKey);
//     }

// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ PATCH-019 — BUG-022 (LOW)                                                  │
// │ File: src/preload/preload.js                                                │
// │ Clear listener audit interval on window unload                              │
// └─────────────────────────────────────────────────────────────────────────────┘

// FIND:
//
// const listenerAuditIntervalId = setInterval(() => {
//   try {
//     secureIPC.auditStaleListeners();
//   } catch (e) {
//     log.debug('[Preload] Listener audit error:', e?.message);
//   }
// }, LISTENER_AUDIT_INTERVAL_MS);
//
// REPLACE WITH:
//
// const listenerAuditIntervalId = setInterval(() => {
//   try {
//     secureIPC.auditStaleListeners();
//   } catch (e) {
//     log.debug('[Preload] Listener audit error:', e?.message);
//   }
// }, LISTENER_AUDIT_INTERVAL_MS);
//
// // FIX BUG-022: Clean up interval and listeners on window close
// window.addEventListener('beforeunload', () => {
//   clearInterval(listenerAuditIntervalId);
//   secureIPC.cleanup();
// });

// ═══════════════════════════════════════════════════════════════════════════════
// REMAINING PATCHES (BUG-011, 012, 014, 015, 016, 017, 019, 020)
// These require locating code patterns that may vary — instructions below
// ═══════════════════════════════════════════════════════════════════════════════

// PATCH-011 (BUG-011 MEDIUM) — src/main/services/analysisHistory/cacheManager.js
// Find the class that creates setInterval for cache cleanup.
// Add a destroy() method:
//   destroy() {
//     if (this._cleanupInterval) {
//       clearInterval(this._cleanupInterval);
//       this._cleanupInterval = null;
//     }
//   }
// Register destroy() in ServiceContainer shutdown sequence.

// PATCH-012 (BUG-012 MEDIUM) — src/shared/atomicFileOperations.js
// Find the constructor that creates this._cleanupInterval.
// Add a dispose() method:
//   dispose() {
//     if (this._cleanupInterval) {
//       clearInterval(this._cleanupInterval);
//       this._cleanupInterval = null;
//     }
//   }

// PATCH-013 (BUG-013 MEDIUM) — src/shared/singletonFactory.js
// Find: instance.shutdown();
// Replace: await instance.shutdown?.();
// (Make resetInstance async if not already)

// PATCH-014 (BUG-014 MEDIUM) — src/shared/config/index.js
// No code change needed. Add documentation comment above synchronous load().

// PATCH-015 (BUG-015 MEDIUM) — src/renderer/components/search/UnifiedSearchModal.jsx
// Search for require() calls. Convert any to top-level ES imports.

// PATCH-016 (BUG-016 MEDIUM) — src/renderer/utils/highlightUtils.js
// Before: new RegExp(`(${escapedWords.join('|')})`, 'gi')
// Add: if (escapedWords.length > 50) escapedWords = escapedWords.slice(0, 50);
//      const pattern = escapedWords.join('|');
//      if (pattern.length > 2000) return text;

// PATCH-017 (BUG-017 MEDIUM) — src/shared/atomicFile.js
// After fs.copyFileSync fallback, add hash verification:
//   const crypto = require('crypto');
//   const srcH = crypto.createHash('md5').update(fs.readFileSync(tempPath)).digest('hex');
//   const dstH = crypto.createHash('md5').update(fs.readFileSync(targetPath)).digest('hex');
//   if (srcH !== dstH) throw new Error('Atomic copy verification failed');

// PATCH-018 (BUG-018 MEDIUM) — src/shared/securityConfig.js
// In _getWindowsDriveLetters(), after wmic try/catch, add fallback:
//   if (!drives || drives.length === 0) {
//     drives = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter(l => {
//       try { return require('fs').existsSync(l + ':\\'); } catch { return false; }
//     });
//   }

// PATCH-019 (BUG-019 MEDIUM) — Multiple files
// Global search: replace array[0].prop with array?.[0]?.prop
// Key files: analysisHistory/statistics.js, organize/ReadyFileItem.jsx

// PATCH-020 (BUG-020 LOW) — scripts/*.js
// Add .catch(err => { console.error(err); process.exit(1); }) to all
// top-level .then() chains in build scripts.
