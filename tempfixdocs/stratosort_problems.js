// ═══════════════════════════════════════════════════════════════════════════════
// STRATOSORT CORE — STRUCTURAL PROBLEMS CATALOG
// Things that aren't crashes (bugs) or wrong output (faults), but structural
// issues, miswiring, incomplete implementations, logic gaps, missing propagation,
// dead code, incorrect assumptions, and anything else that prevents features from
// working as the codebase intends.
// ═══════════════════════════════════════════════════════════════════════════════
//
// Audit source: repomix-output.txt (compiled codebase)
// Scope: Every integration seam, wiring path, data flow, and lifecycle traced
// ═══════════════════════════════════════════════════════════════════════════════

// ╔═════════════════════════════════════════════════════════════════════════════╗
// ║ PROB-001 — SANDBOX BLOCKS DRAG-AND-DROP FILE RESOLUTION                   ║
// ║ Severity: HIGH — Feature silently fails                                   ║
// ╚═════════════════════════════════════════════════════════════════════════════╝
//
// createWindow.js sets sandbox: true (line 118659).
// In Electron sandbox mode, File.path returns empty string "".
//
// extractDroppedFiles() (src/renderer/utils/dragDropUtils.js):
//   collectedPaths = [
//     ...fileList.map(file => normalizeFileUri(file.path || file.name)),
//     ...
//   ];
//
// When file.path is "" (falsy), the fallback is file.name → just the filename
// like "report.pdf" with NO directory path.
//
// handleAddToScope then calls findFilesByPaths(allPaths) which matches against
// full indexed paths like "/Users/ben/Documents/report.pdf".
// A bare filename "report.pdf" will NEVER match.
//
// Result: User drags files onto the document scope panel → nothing happens.
// No error, no warning, no feedback. The scope panel stays empty.
//
// FIX:
// File: src/renderer/utils/dragDropUtils.js — extractDroppedFiles
// After collecting paths, resolve bare filenames by searching the index:
//
//   // If path looks like a bare filename (no separator), flag for name-based lookup
//   const needsResolution = collectedPaths.filter(p => !p.includes('/') && !p.includes('\\'));
//   const resolved = collectedPaths.filter(p => p.includes('/') || p.includes('\\'));
//   return { paths: resolved, unresolvedNames: needsResolution, fileList, itemFiles };
//
// Then in handleAddToScope, after findFilesByPaths for resolved paths, do a
// second lookup for unresolved names using a name-based search or filter.
//
// Alternative: Use Electron's webUtils.getPathForFile() in the preload to get
// the real file system path when sandbox is enabled.

// ╔═════════════════════════════════════════════════════════════════════════════╗
// ║ PROB-002 — QUERY_STREAM FALLBACK RETURNS SILENTLY, STREAM HANGS FOREVER   ║
// ║ Severity: HIGH — Infinite loading when LLM not ready                      ║
// ╚═════════════════════════════════════════════════════════════════════════════╝
//
// When ChatService is null (LlamaService hasn't loaded yet):
//
// 1. IPC handler: _createServiceCheckHandler returns fallbackResponse:
//      { success: false, error: 'Chat service unavailable' }
//
// 2. This is a RESOLVED promise (not rejected). ipcRenderer.invoke() resolves
//    with this object successfully.
//
// 3. ChatStream.start() only has .catch() on the promise:
//      electronAPI.chat.queryStream(payload).catch(err => this.emit('error', err))
//    Since the promise resolved (not rejected), .catch() never fires.
//
// 4. No STREAM_CHUNK or STREAM_END events are ever sent (service never ran).
//
// 5. The renderer waits forever: isChatting=true, spinner spins indefinitely.
//
// FIX:
// File: src/renderer/services/ipc/chatIpc.js — ChatStream.start()
//
// FIND:
//     electronAPI.chat.queryStream(payload).catch((err) => {
//       this.emit('error', err);
//       this.cleanup();
//     });
//
// REPLACE WITH:
//     electronAPI.chat.queryStream(payload).then((result) => {
//       // If service returned a failure object instead of streaming,
//       // the stream will never get data. Emit error + cleanup.
//       if (result && result.success === false) {
//         this.emit('error', new Error(result.error || 'Chat service unavailable'));
//         this.cleanup();
//       }
//     }).catch((err) => {
//       this.emit('error', err);
//       this.cleanup();
//     });

// ╔═════════════════════════════════════════════════════════════════════════════╗
// ║ PROB-003 — CONVERSATION SEARCH WILL BREAK AFTER FAULT-001 FIX             ║
// ║ Severity: HIGH — Feature regression on the critical fix path              ║
// ╚═════════════════════════════════════════════════════════════════════════════╝
//
// searchConversations SQL:
//   WHERE m.text LIKE '%query%' OR c.title LIKE '%query%'
//
// After FAULT-001 fix, assistant messages save text='' with structured data in
// document_answer and model_answer JSON columns.
//
// So searching for any word that appeared in an assistant response will match
// NOTHING — the text column is empty, and the SQL never searches the JSON columns.
//
// Result: ConversationSidebar search appears broken. User searches for a topic
// they discussed → "No conversations found" even though the conversation exists.
//
// FIX:
// File: src/main/services/ChatHistoryStore.js — searchConversations()
//
// FIND:
//       WHERE m.text LIKE ? ESCAPE '\\' OR c.title LIKE ? ESCAPE '\\'
//
// REPLACE WITH:
//       WHERE m.text LIKE ? ESCAPE '\\'
//          OR m.document_answer LIKE ? ESCAPE '\\'
//          OR m.model_answer LIKE ? ESCAPE '\\'
//          OR c.title LIKE ? ESCAPE '\\'
//
// And update the .all() call to pass pattern 4 times:
//   .all(pattern, pattern, pattern, pattern)
//
// NOTE: LIKE on JSON columns works because SQLite treats them as text.
// The match is substring-based, so "revenue" will match inside
// [{"text":"The revenue grew 15%..."}] which is correct behavior.

// ╔═════════════════════════════════════════════════════════════════════════════╗
// ║ PROB-004 — resetSession NEVER CALLED → SERVER MEMORY GROWS WITHOUT BOUND  ║
// ║ Severity: MEDIUM — Slow resource leak                                     ║
// ╚═════════════════════════════════════════════════════════════════════════════╝
//
// Preload exposes electronAPI.chat.resetSession() (line 159841).
// ChatService.resetSession() deletes the session from the sessions Map.
//
// But handleNewConversation only does:
//   chatSessionRef.current = crypto.randomUUID();
//   setChatMessages([]);
//
// It NEVER calls resetSession(). The old session stays in ChatService.sessions
// until MAX_SESSIONS eviction kicks in. But if ChatHistoryStore is active,
// _getSessionMemory doesn't use the sessions Map at all — it uses the DB.
// So the Map entries for DB-backed sessions are created but never cleaned up.
//
// FIX:
// File: src/renderer/components/search/UnifiedSearchModal.jsx — handleNewConversation
//
// Add before generating new UUID:
//   // Clean up the server-side session for the old conversation
//   if (chatSessionRef.current) {
//     window.electronAPI?.chat?.resetSession?.(chatSessionRef.current).catch(() => {});
//   }

// ╔═════════════════════════════════════════════════════════════════════════════╗
// ║ PROB-005 — RAW JSON VISIBLE TO USER DURING STREAMING                      ║
// ║ Severity: MEDIUM — Poor UX, confusing output                              ║
// ╚═════════════════════════════════════════════════════════════════════════════╝
//
// The LLM is instructed to return JSON: {"documentAnswer":[...],...}
// During streaming, onToken fires with each token fragment.
// ChatService emits {type:'chunk', text: token} for EVERY token.
//
// The renderer appends each token to the streaming message's text field:
//   lastMsg.text = (lastMsg.text || '') + data.text;
//
// ChatPanel renders this text via CitationRenderer.
//
// So during generation, the user sees:
//   {"documentAnswer":[{"text":"The report shows revenue grew 15% [doc-1]
//
// Only when the 'done' event fires does the display switch to structured rendering.
//
// This was identified as BUG-002 in the previous audit. The fix (buffer tokens
// server-side, emit status heartbeats, then emit final parsed prose) is in
// PATCH-002a/002b of stratosort_all_patches.js.
//
// Listing here because it's a structural design problem, not just a bug:
// the architecture routes raw LLM tokens to the UI without any transformation.

// ╔═════════════════════════════════════════════════════════════════════════════╗
// ║ PROB-006 — STRICT SCOPE + EMPTY DOCUMENT SCOPE = CONTRADICTORY STATE      ║
// ║ Severity: MEDIUM — Confusing behavior                                     ║
// ╚═════════════════════════════════════════════════════════════════════════════╝
//
// User can enable "Strict" toggle (strictScope=true) without adding any files
// to the document scope AND with useSearchContext=false.
//
// In this state:
//   contextFileIds = []  (no scope, no search context)
//   strictScope = true
//
// ChatService._runRetrieval runs a GLOBAL search (no context file filtering).
// The LLM prompt says: "STRICT SCOPE ENFORCED: You must ONLY answer using
// the provided Document sources."
//
// So the system searches globally, finds documents, but the prompt says
// "only answer from selected documents" — which is everything it found.
// This defeats the purpose of strict scope.
//
// FIX:
// File: src/renderer/components/search/UnifiedSearchModal.jsx — handleChatSend
//
// Add a guard before dispatching the query:
//
//   if (strictScope && contextFileIds.length === 0) {
//     setChatWarning('Strict scope is enabled but no documents are selected. ' +
//       'Add files to the scope or enable Search Context.');
//     setIsChatting(false);
//     chatInFlightRef.current = false;
//     return;
//   }

// ╔═════════════════════════════════════════════════════════════════════════════╗
// ║ PROB-007 — NO ABORT/CANCEL FOR IN-FLIGHT LLM GENERATION                  ║
// ║ Severity: MEDIUM — User stuck waiting for slow responses                  ║
// ╚═════════════════════════════════════════════════════════════════════════════╝
//
// LlamaService.generateTextStreaming accepts an AbortSignal parameter.
// But ChatService.queryStreaming never creates or passes one.
// The renderer has no "Stop" button or cancel mechanism.
//
// If the LLM takes 30+ seconds on a complex query, the user must wait.
// The chatInFlightRef prevents sending a new message during this time.
//
// FIX:
// 1. Create AbortController in handleChatSend, store ref
// 2. Pass signal through queryStream payload → ChatService → LlamaService
// 3. Add a "Stop generating" button in ChatPanel when isSending=true
// 4. On click, call controller.abort() and reset UI state
//
// File changes needed:
//   - UnifiedSearchModal.jsx: create AbortController, add to payload
//   - chatIpc.js schema / preload: allow signal passing (or use a separate IPC channel)
//   - ChatService.queryStreaming: extract signal, pass to generateTextStreaming
//   - ChatPanel.jsx: add stop button UI

// ╔═════════════════════════════════════════════════════════════════════════════╗
// ║ PROB-008 — NON-STREAMING query() IS DEAD CODE THAT WILL DRIFT             ║
// ║ Severity: MEDIUM — Maintenance hazard                                     ║
// ╚═════════════════════════════════════════════════════════════════════════════╝
//
// ChatService.query() (non-streaming path):
//   - Registered as IPC handler for 'chat:query'
//   - Exposed in preload as electronAPI.chat.query()
//   - But chatIpc.js NEVER exports a query() function
//   - UnifiedSearchModal ONLY calls queryStream()
//
// The non-streaming query() has its own duplicated logic for:
//   - Conversational detection
//   - Retrieval + prompt building
//   - Response parsing
//   - Memory saving
//   - Fallback logic
//
// As fixes are applied to queryStreaming(), query() will become increasingly
// out of sync. Any future feature that uses query() will hit unfixed issues.
//
// FIX:
// Extract shared logic into private methods used by both paths:
//   - _executeConversational(query, memory, history) → parsed
//   - _executeDocumentQuery(query, memory, retrieval, ...) → parsed
//   - _postProcess(parsed, retrieval, memory, query) → saves + returns
//
// Or: remove query() and its IPC handler entirely if never needed.

// ╔═════════════════════════════════════════════════════════════════════════════╗
// ║ PROB-009 — _getSessionMemory CREATES CONVERSATION ON FIRST ACCESS         ║
// ║ Severity: MEDIUM — Ghost conversations in sidebar                         ║
// ╚═════════════════════════════════════════════════════════════════════════════╝
//
// _getSessionMemory (line 102457):
//   const conv = this.chatHistoryStore.getConversation(key);
//   if (!conv) {
//     this.chatHistoryStore.createConversation('New Chat', [], key);
//   }
//   return { sessionId: key };
//
// This runs BEFORE the query even starts. So the moment the user sends a
// message, a conversation titled "New Chat" appears in the sidebar, even
// before the LLM responds. If the query later fails, this ghost conversation
// persists with zero messages (or only an error message if FAULT-003 is fixed).
//
// _saveMemoryTurn also has createConversation logic but with the user's query
// as the title. This SECOND create call is a no-op because the conversation
// already exists from _getSessionMemory. So the title is always "New Chat"
// instead of the user's first message.
//
// Wait — let me re-check. _saveMemoryTurn does:
//   let conv = this.chatHistoryStore.getConversation(memory.sessionId);
//   if (!conv) { createConversation(input.slice(0,50), ...); }
//
// Since _getSessionMemory already created it, conv IS found, so the
// createConversation with the good title NEVER runs.
//
// Result: ALL conversations are titled "New Chat" in the sidebar.
//
// FIX:
// Option A: Remove createConversation from _getSessionMemory. Let _saveMemoryTurn
//   be the sole creator (with the user's query as title).
//
// Option B: Keep _getSessionMemory creation but UPDATE the title in _saveMemoryTurn:
//   if (conv && conv.title === 'New Chat') {
//     this.chatHistoryStore.updateTitle(memory.sessionId, input.slice(0, 50) || 'Conversation');
//   }
//
// Option A is cleaner. _getSessionMemory should return { sessionId: key } without
// touching the database. Let the first successful _saveMemoryTurn create it.

// ╔═════════════════════════════════════════════════════════════════════════════╗
// ║ PROB-010 — _scoreContextFiles DROPS FILES WITH WRONG EMBEDDING DIMENSION  ║
// ║ Severity: MEDIUM — Silent document exclusion from scope                   ║
// ╚═════════════════════════════════════════════════════════════════════════════╝
//
// _scoreContextFiles (line 103036):
//   if (vec.length !== queryVector.length) continue;
//
// If a file was indexed with a different embedding model (e.g., after model
// switch), its vector dimension won't match the current query vector.
// The file is silently skipped. The user added it to the scope explicitly,
// but it never appears in retrieval results.
//
// No warning or indication that the file was dropped.
//
// FIX:
// Use _padOrTruncateVector on the document vector too:
//   const normalizedVec = this._padOrTruncateVector(vec, queryVector.length);
//   if (!normalizedVec?.length) continue;
//   const similarity = cosineSimilarity(queryVector, normalizedVec);
//
// Or: Log a user-visible warning when dimension mismatch occurs:
//   meta.droppedDimensionMismatch = (meta.droppedDimensionMismatch || 0) + 1;

// ╔═════════════════════════════════════════════════════════════════════════════╗
// ║ PROB-011 — SEARCH CONTEXT IDs SORTED BY RECOMMENDATION, NOT RELEVANCE     ║
// ║ Severity: LOW — Suboptimal retrieval ordering                             ║
// ╚═════════════════════════════════════════════════════════════════════════════╝
//
// handleChatSend builds contextFileIds from search results:
//
//   contextFileIds = Array.from(new Set(
//     searchResults.map(result => result?.id).filter(Boolean)
//   ))
//   .sort((aId, bId) => {
//     const aRec = recommendationMap[aPath] ? 1 : 0;
//     const bRec = recommendationMap[bPath] ? 1 : 0;
//     return bRec - aRec;
//   })
//   .slice(0, 200);
//
// Files with recommendations are sorted first. But _scoreContextFiles computes
// cosine similarity for ALL context files and re-ranks them. So the sort here
// has NO effect on final retrieval order — it only affects which 200 files
// are included when there are more than 200 search results.
//
// In the edge case of >200 results, recommended files are kept while potentially
// more relevant non-recommended files are dropped.
//
// FIX: Sort by search result score instead:
//   .sort((aId, bId) => {
//     const aScore = searchResults.find(r => r?.id === aId)?.score || 0;
//     const bScore = searchResults.find(r => r?.id === bId)?.score || 0;
//     return bScore - aScore;
//   })

// ╔═════════════════════════════════════════════════════════════════════════════╗
// ║ PROB-012 — FOLDER SCOPE DETECTION USES EXTENSION HEURISTIC, NOT FS CHECK  ║
// ║ Severity: LOW — Wrong scope for extensionless files                       ║
// ╚═════════════════════════════════════════════════════════════════════════════╝
//
// handleAddToScope (line 139087):
//   const isFolder = item?.type === 'folder' ||
//     (item?.path && !itemName.includes('.'));
//
// Files without extensions (e.g., "Makefile", "LICENSE", "Dockerfile") are
// misidentified as folders. The code then calls getDirectoryContents on
// a file path, which will fail or return empty results.
//
// The file itself is never added to the scope.
//
// FIX: Remove the extension heuristic. Only trust item.type:
//   const isFolder = item?.type === 'folder';
//
// If item.type isn't set, default to file (not folder).

// ╔═════════════════════════════════════════════════════════════════════════════╗
// ║ PROB-013 — handleChatSend MISSING FROM useCallback DEPENDENCY ARRAY       ║
// ║ Severity: LOW — Stale closure risk                                        ║
// ╚═════════════════════════════════════════════════════════════════════════════╝
//
// handleChatSend dependencies (line 139058):
//   [defaultTopK, documentScope, ensureChatSession, recommendationMap,
//    responseMode, searchResults, strictScope, useSearchContext]
//
// Missing: chatMessages (used by the streaming 'data' handler to find
// the last message). The 'data' handler is inside the callback closure
// and does setChatMessages(prev => ...) which uses the functional updater
// pattern — so chatMessages isn't actually read from the closure.
//
// HOWEVER: The 'done' handler reads from data.response (not from closure state),
// so this is actually fine. The functional updater pattern avoids stale closures.
//
// ACTUAL CONCERN: currentConversationId is NOT in the dependency array.
// If the user switches conversations while a query is in flight (shouldn't
// happen due to chatInFlightRef, but...), the isCurrentRequest check would
// catch the stale request. So this is safe in practice.
//
// STATUS: Not a bug today, but fragile. Document as tech debt.

// ╔═════════════════════════════════════════════════════════════════════════════╗
// ║ PROB-014 — ConversationSidebar SEARCH IS INSTANT (NO DEBOUNCE)            ║
// ║ Severity: LOW — Performance on large conversation lists                   ║
// ╚═════════════════════════════════════════════════════════════════════════════╝
//
// ConversationSidebar searchQuery state change triggers loadConversations
// via useEffect dependency. Each keystroke fires a full SQL query.
//
// For 100+ conversations, this can cause UI jank.
//
// FIX: Debounce the searchQuery before passing to the SQL:
//   const debouncedQuery = useDebouncedValue(searchQuery, 300);
//   useEffect(() => { loadConversations(); }, [debouncedQuery, ...]);

// ╔═════════════════════════════════════════════════════════════════════════════╗
// ║ PROB-015 — _getHistoryText RETURNS FLAT TEXT, LOSES STRUCTURED CONTEXT    ║
// ║ Severity: LOW — Reduced multi-turn quality                                ║
// ╚═════════════════════════════════════════════════════════════════════════════╝
//
// _getHistoryText formats conversation history for the LLM prompt as:
//   "User: What is revenue?\nAssistant: The report shows revenue grew [doc-1]..."
//
// The [doc-1] markers reference source IDs from the PREVIOUS turn's retrieval.
// But the current turn has DIFFERENT sources with DIFFERENT IDs.
// So the LLM sees "[doc-1]" in history but [doc-1] now points to a different file.
//
// This can cause the LLM to confuse which document is which across turns.
//
// FIX: Replace [doc-N] with actual source names in history text:
//   if (m.role === 'assistant') {
//     let text = reconstructedText;
//     const sources = m.sources || [];
//     for (const s of sources) {
//       text = text.replace(new RegExp(`\\[${s.id}\\]`, 'g'), `[${s.name}]`);
//     }
//   }

// ╔═════════════════════════════════════════════════════════════════════════════╗
// ║ PROB-016 — PERSONA NOT SELECTABLE FROM CHAT PANEL                         ║
// ║ Severity: LOW — UX gap                                                    ║
// ╚═════════════════════════════════════════════════════════════════════════════╝
//
// The persona selection UI only exists in Settings → Chat Persona section.
// It applies globally via settingsService.
//
// The ChatPanel header has Fast/Deep toggle, Strict toggle, Context toggle —
// but no persona selector. Users must leave the chat to change persona.
//
// This is a design gap, not a code error. Including here for completeness
// since it affects how the feature works in practice.

// ╔═════════════════════════════════════════════════════════════════════════════╗
// ║ PROB-017 — DUPLICATE EVENT LISTENERS ON RAPID TAB SWITCHING               ║
// ║ Severity: LOW — Memory growth over long sessions                          ║
// ╚═════════════════════════════════════════════════════════════════════════════╝
//
// ChatStream registers onStreamChunk and onStreamEnd listeners via safeOn().
// safeOn returns a cleanup function stored in cleanupFns.
//
// If the user switches away from the chat tab (unmount) while streaming,
// the component's useEffect cleanup should call stream.cleanup().
// But the stream reference is inside handleChatSend's closure — it's not
// stored in a ref that the cleanup effect can access.
//
// The 'end' listener (PATCH-004 from previous audit) helps, but if the
// component unmounts before 'end' fires, the listener persists.
//
// FIX: Store stream reference in a ref:
//   const chatStreamRef = useRef(null);
//   // In handleChatSend: chatStreamRef.current = stream;
//   // In useEffect cleanup: chatStreamRef.current?.cleanup();

// ╔═════════════════════════════════════════════════════════════════════════════╗
// ║ PROB-018 — ENRICHMENT MUTATES SEARCH RESULTS IN-PLACE                     ║
// ║ Severity: LOW — Subtle data corruption risk                               ║
// ╚═════════════════════════════════════════════════════════════════════════════╝
//
// In _retrieveSources (line ~102875):
//   this.searchService.enrichResults(finalResults);
//
// enrichResults modifies the result objects in-place, adding metadata fields.
// Since these objects originated from the search cache, the cache entries
// are now mutated with chat-specific data.
//
// This could cause stale metadata to appear in subsequent searches if the
// cache hasn't been invalidated.
//
// FIX: Deep clone results before enrichment:
//   const enriched = finalResults.map(r => ({ ...r, metadata: { ...r.metadata } }));
//   this.searchService.enrichResults(enriched);

// ═══════════════════════════════════════════════════════════════════════════════
// SUMMARY — ALL PROBLEMS BY PRIORITY
// ═══════════════════════════════════════════════════════════════════════════════
//
// HIGH (3) — Features silently broken or infinite-hang states:
//   PROB-001: Sandbox blocks drag-and-drop file resolution
//   PROB-002: queryStream fallback returns silently, stream hangs forever
//   PROB-003: Conversation search breaks after FAULT-001 fix (regression)
//
// MEDIUM (5) — Missing functionality or significant logic gaps:
//   PROB-004: resetSession never called, server memory grows
//   PROB-005: Raw JSON visible during streaming (design-level issue)
//   PROB-006: Strict scope + empty scope = contradictory state
//   PROB-007: No abort/cancel for in-flight LLM generation
//   PROB-008: Non-streaming query() is dead code that will drift
//   PROB-009: _getSessionMemory creates "New Chat" ghost conversations
//   PROB-010: Context files with wrong embedding dimension silently dropped
//
// LOW (5) — Edge cases, performance, UX gaps:
//   PROB-011: Search context IDs sorted by recommendation, not relevance
//   PROB-012: Folder detection uses extension heuristic, not FS check
//   PROB-013: handleChatSend dependency array — fragile but functional
//   PROB-014: Conversation search not debounced
//   PROB-015: _getHistoryText loses structured source context across turns
//   PROB-016: Persona not selectable from chat panel
//   PROB-017: Duplicate event listeners on rapid tab switching
//   PROB-018: Enrichment mutates search results in-place
//
//
// ═══════════════════════════════════════════════════════════════════════════════
// INTERACTION WITH PREVIOUS AUDITS
// ═══════════════════════════════════════════════════════════════════════════════
//
// These problems are DISTINCT from:
//   - 22 bugs in stratosort_all_patches.js (crashes, errors, exceptions)
//   - 10 faults in stratosort_faults.js (wrong output, missing data)
//
// PROB-003 is a REGRESSION that only appears after applying FAULT-001.
// It must be fixed simultaneously with FAULT-001.
//
// PROB-009 explains why ALL conversations appear as "New Chat" —
// previously attributed to FAULT-008 (no updateTitle). The root cause
// is actually _getSessionMemory creating the conversation before
// _saveMemoryTurn can set the proper title.
//
// PROB-005 overlaps with BUG-002 (raw JSON streaming). The patch for
// BUG-002 (buffer tokens server-side) resolves this structural problem.
//
// COMBINED CRITICAL PATH for a working Chat/RAG feature:
//   1. FAULT-001 fix (structured persistence) + PROB-003 fix (search SQL)
//   2. PROB-009 fix (conversation title creation flow)
//   3. BUG-002 patch (streaming display)
//   4. BUG-001 patch (error handling)
//   5. PROB-002 fix (stream hang on service unavailable)
//   6. PROB-001 fix (drag-and-drop in sandbox mode)
// ═══════════════════════════════════════════════════════════════════════════════
