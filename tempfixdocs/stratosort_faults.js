// ═══════════════════════════════════════════════════════════════════════════════
// STRATOSORT CORE — SILENT FAULTS (Not Crashes, But Broken Behavior)
// These are features that appear to work but produce wrong results
// ═══════════════════════════════════════════════════════════════════════════════
//
// These are DISTINCT from the 22 bugs identified previously.
// Bugs = things that crash, hang, or throw errors.
// Faults = things that run without error but silently do the wrong thing.
// ═══════════════════════════════════════════════════════════════════════════════

// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ FAULT-001 (CRITICAL) — Reloaded Conversations Lose All Structured Rendering│
// │                                                                             │
// │ Symptom: User reloads or switches to a previous conversation.               │
// │ Citations appear as dead [doc-1] text. No hover previews. No source cards.  │
// │ ComparisonTable, ContradictionCard, GapAnalysisCard never appear.           │
// │ Follow-up suggestion buttons disappear.                                     │
// │                                                                             │
// │ This is the #1 most visible fault in the entire app.                        │
// └─────────────────────────────────────────────────────────────────────────────┘
//
// ROOT CAUSE (3 linked sub-faults):
//
// FAULT-001a: _saveMemoryTurn saves flat text, not structured data
//   File: src/main/services/ChatService.js — _saveMemoryTurn()
//   Line: this.chatHistoryStore.addMessage(memory.sessionId, { role: 'assistant', text: ... })
//
//   _formatForMemory() returns a flat string like:
//     "The report shows revenue grew 15% [doc-1].\n[Referenced: Q4 Report.pdf]"
//
//   addMessage saves: text = flat_string, documentAnswer = [], modelAnswer = [], sources = []
//   (The last three are empty because the message object only has {role, text})
//
// FAULT-001b: ChatPanel rendering branching makes this unfixable without text=''
//   File: src/renderer/components/search/ChatPanel.jsx — message rendering
//   Line 64209: {message.text ? ( <CitationRenderer text={message.text} ... /> ) : ( ... structured fields ... )}
//
//   During LIVE streaming:
//     'done' handler sets text='' → falls to ELSE branch → renders structured documentAnswer/modelAnswer ✓
//
//   On RELOAD:
//     DB returns text="The report shows..." → takes IF branch → renders flat text only ✗
//     CitationRenderer sees [doc-1] markers in text but sources=[] → badges render but can't resolve
//     → Clicking/hovering citation badges does NOTHING
//
// FAULT-001c: meta field has no database column
//   File: src/main/services/ChatHistoryStore.js — messages table schema
//   Schema has: text, document_answer, model_answer, sources, follow_ups
//   MISSING: meta (comparison_intent, gap_analysis_intent, contradictions, holistic_intent)
//
//   On reload: message.meta = undefined
//   → ComparisonTable check: message.meta?.comparisonIntent → false → never renders
//   → ContradictionCard check: message.meta?.contradictions → undefined → never renders
//   → GapAnalysisCard check: message.meta?.gapAnalysisIntent → false → never renders
//
// ─── COMPLETE FIX FOR FAULT-001 ─────────────────────────────────────────────
//
// STEP 1: Add 'meta' column to messages table
// File: src/main/services/ChatHistoryStore.js

// In _migrate(), add after the CREATE TABLE:

//   db.exec(`
//     -- Add meta column if not exists (safe for existing databases)
//     ALTER TABLE messages ADD COLUMN meta TEXT DEFAULT '{}';
//   `);
//   // Wrap in try-catch since ALTER TABLE will fail if column already exists
//   // Alternative: check pragma table_info first

// Better approach using SQLite PRAGMA:

/*
  _migrate() {
    const db = this._db;

    db.exec(`
      CREATE TABLE IF NOT EXISTS conversations ( ... existing ... );
      CREATE TABLE IF NOT EXISTS messages ( ... existing ... );
      CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);
    `);

    // Schema migration: add meta column
    const columns = db.pragma('table_info(messages)');
    const hasMetaColumn = columns.some(col => col.name === 'meta');
    if (!hasMetaColumn) {
      db.exec(`ALTER TABLE messages ADD COLUMN meta TEXT DEFAULT '{}'`);
    }
  }
*/

// STEP 2: Save meta in addMessage
// File: src/main/services/ChatHistoryStore.js

// FIND:
//   const stmt = this._db.prepare(`
//     INSERT INTO messages (
//       id, conversation_id, role, text,
//       document_answer, model_answer, sources, follow_ups
//     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
//   `);
//
//   stmt.run(
//     id,
//     conversationId,
//     message.role,
//     message.text || '',
//     JSON.stringify(message.documentAnswer || []),
//     JSON.stringify(message.modelAnswer || []),
//     JSON.stringify(message.sources || []),
//     JSON.stringify(message.followUps || [])
//   );

// REPLACE WITH:
//   const stmt = this._db.prepare(`
//     INSERT INTO messages (
//       id, conversation_id, role, text,
//       document_answer, model_answer, sources, follow_ups, meta
//     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
//   `);
//
//   stmt.run(
//     id,
//     conversationId,
//     message.role,
//     message.text || '',
//     JSON.stringify(message.documentAnswer || []),
//     JSON.stringify(message.modelAnswer || []),
//     JSON.stringify(message.sources || []),
//     JSON.stringify(message.followUps || []),
//     JSON.stringify(message.meta || {})
//   );

// STEP 3: Restore meta in _parseMessage
// File: src/main/services/ChatHistoryStore.js

// FIND:
//   _parseMessage(row) {
//     return {
//       id: row.id,
//       role: row.role,
//       text: row.text,
//       documentAnswer: JSON.parse(row.document_answer || '[]'),
//       modelAnswer: JSON.parse(row.model_answer || '[]'),
//       sources: JSON.parse(row.sources || '[]'),
//       followUps: JSON.parse(row.follow_ups || '[]'),
//       createdAt: row.created_at
//     };
//   }

// REPLACE WITH:
//   _parseMessage(row) {
//     const meta = (() => {
//       try { return JSON.parse(row.meta || '{}'); } catch { return {}; }
//     })();
//     return {
//       id: row.id,
//       role: row.role,
//       text: row.text,
//       documentAnswer: JSON.parse(row.document_answer || '[]'),
//       modelAnswer: JSON.parse(row.model_answer || '[]'),
//       sources: JSON.parse(row.sources || '[]'),
//       followUps: JSON.parse(row.follow_ups || '[]'),
//       meta,
//       createdAt: row.created_at
//     };
//   }

// STEP 4: Pass structured data + meta to _saveMemoryTurn
// File: src/main/services/ChatService.js

// FIND (in _saveMemoryTurn):
//         this.chatHistoryStore.addMessage(memory.sessionId, {
//           role: 'assistant',
//           text: typeof output === 'string' ? output : ''
//         });

// REPLACE WITH:
//         const assistantMsg = {
//           role: 'assistant',
//           text: ''  // Empty so ChatPanel renders structured fields
//         };
//         if (output && typeof output === 'object') {
//           assistantMsg.documentAnswer = output.documentAnswer || [];
//           assistantMsg.modelAnswer = output.modelAnswer || [];
//           assistantMsg.sources = output.sources || [];
//           assistantMsg.followUps = output.followUps || [];
//           assistantMsg.meta = output.meta || {};
//         } else if (typeof output === 'string') {
//           // Legacy fallback: if only a string was passed, put it in modelAnswer
//           assistantMsg.modelAnswer = [{ text: output }];
//         }
//         this.chatHistoryStore.addMessage(memory.sessionId, assistantMsg);

// STEP 5: Change ALL callers of _saveMemoryTurn to pass structured objects
// File: src/main/services/ChatService.js

// --- In queryStreaming(), main path (after smart fallback, before 'done' event): ---
// FIND:
//       const assistantForMemory = this._formatForMemory(parsed, retrieval.sources);
//       await this._saveMemoryTurn(memory, cleanQuery, assistantForMemory);

// REPLACE WITH:
//       await this._saveMemoryTurn(memory, cleanQuery, {
//         documentAnswer: parsed.documentAnswer,
//         modelAnswer: parsed.modelAnswer,
//         sources: retrieval.sources,
//         followUps: parsed.followUps || [],
//         meta: {
//           ...retrieval.meta,
//           responseMode: forcedResponseMode,
//           holisticIntent,
//           correctionIntent,
//           comparisonIntent,
//           gapAnalysisIntent,
//           contradictions
//         }
//       });

// --- In queryStreaming(), conversational path: ---
// FIND:
//         await this._saveMemoryTurn(memory, cleanQuery, this._formatForMemory(parsed));

// REPLACE WITH:
//         await this._saveMemoryTurn(memory, cleanQuery, {
//           documentAnswer: parsed.documentAnswer,
//           modelAnswer: parsed.modelAnswer,
//           sources: [],
//           followUps: parsed.followUps || [],
//           meta: { retrievalSkipped: true }
//         });

// --- In query(), non-streaming path (two locations — before and after fallback): ---
// Change both `assistantForMemory = this._formatForMemory(parsed, retrieval.sources);`
// to the same structured object pattern as the streaming path above.
// (Also apply to the re-format after fallback injection.)

// STEP 6: Update _getHistoryText to work with new text='' pattern
// File: src/main/services/ChatService.js
// This already has the fallback logic for empty text:
//   if (m.role === 'assistant' && !text) {
//     const docs = m.documentAnswer?.map(...) ...
// So this will work correctly with text='' ✓ (no change needed)

// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ FAULT-002 (HIGH) — Document Scope Never Saved or Restored                   │
// │                                                                             │
// │ Symptom: User sets document scope (e.g., "only search my tax docs"),         │
// │ sends several messages, closes the conversation, reopens it later.           │
// │ The scope panel is empty. New messages in that conversation search ALL docs. │
// │ Also: starting a new conversation retains the OLD scope from the previous.  │
// └─────────────────────────────────────────────────────────────────────────────┘
//
// ROOT CAUSE:
// 1. _saveMemoryTurn creates conversation with empty scope:
//      createConversation(title, [], sessionId)  ← always []
//    The renderer has the scope in documentScope state, but never passes it to main process.
//
// 2. handleSelectConversation loads conversation.documentScope from DB
//    but NEVER calls setDocumentScope():
//      setCurrentConversationId(id);
//      setChatMessages(conversation.messages || []);
//      // ... no setDocumentScope(conversation.documentScope) !
//
// 3. handleNewConversation clears messages but NEVER clears scope:
//      setChatMessages([]);
//      // ... no setDocumentScope([]) !
//    So scope from the previous conversation bleeds into the new one.
//
// ─── COMPLETE FIX ─────────────────────────────────────────────────────────────
//
// FIX 2a: Pass document scope to queryStream payload so ChatService can persist it
// File: src/renderer/components/search/UnifiedSearchModal.jsx
//
// FIND (in handleChatSend, the queryStream call):
//         const stream = queryStream({
//           sessionId,
//           query: trimmed,
//           topK: Math.min(8, defaultTopK),
//           mode: 'hybrid',
//           contextFileIds,
//           strictScope,
//           responseMode
//         });
//
// REPLACE WITH:
//         const stream = queryStream({
//           sessionId,
//           query: trimmed,
//           topK: Math.min(8, defaultTopK),
//           mode: 'hybrid',
//           contextFileIds,
//           strictScope,
//           responseMode,
//           documentScopeItems: documentScope  // Pass scope for persistence
//         });

// FIX 2b: Save scope when creating conversation
// File: src/main/services/ChatService.js — _saveMemoryTurn
//
// FIND:
//           this.chatHistoryStore.createConversation(
//             (typeof input === 'string' ? input.slice(0, 50) : '') || 'New Conversation',
//             [],
//             memory.sessionId
//           );
//
// REPLACE WITH:
//           this.chatHistoryStore.createConversation(
//             (typeof input === 'string' ? input.slice(0, 50) : '') || 'New Conversation',
//             memory._documentScope || [],
//             memory.sessionId
//           );
//
// And in queryStreaming, set the scope on the memory object:
//   const memory = await this._getSessionMemory(sessionId);
//   memory._documentScope = documentScopeItems || [];
// (documentScopeItems comes from the payload, which now includes it from FIX 2a)

// FIX 2c: Restore scope when selecting a conversation
// File: src/renderer/components/search/UnifiedSearchModal.jsx — handleSelectConversation
//
// FIND:
//         setIsChatting(false);
//         chatSessionRef.current = id;
//
// REPLACE WITH:
//         setIsChatting(false);
//         chatSessionRef.current = id;
//         // FIX FAULT-002: Restore document scope from saved conversation
//         setDocumentScope(conversation.documentScope || []);

// FIX 2d: Clear scope on new conversation
// File: src/renderer/components/search/UnifiedSearchModal.jsx — handleNewConversation
//
// FIND:
//     chatSessionRef.current = crypto.randomUUID();
//   }, []);
//
// REPLACE WITH:
//     chatSessionRef.current = crypto.randomUUID();
//     setDocumentScope([]);  // FIX FAULT-002: Don't carry scope to new conversation
//   }, []);

// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ FAULT-003 (HIGH) — User Message Lost on Error, Ghost Session Created        │
// │                                                                             │
// │ Symptom: User sends a message, LLM or search fails, error shows.            │
// │ User sends another message. It works. But the first message is gone.        │
// │ The conversation sidebar shows nothing (conversation was never created).     │
// │ OR: sidebar shows the conversation but it only has messages from retry       │
// │ onward — the original failed message is lost forever.                        │
// └─────────────────────────────────────────────────────────────────────────────┘
//
// ROOT CAUSE:
// 1. handleChatSend adds user message to state: setChatMessages(prev => [...prev, {role:'user', text}])
// 2. queryStream fires → ChatService.queryStreaming() runs
// 3. If error occurs in _runRetrieval or LLM, catch block emits {type:'error'}
// 4. _saveMemoryTurn NEVER runs → conversation not created in DB, user message not saved
// 5. State shows the user message (visible), but DB doesn't have it
// 6. If user then retries, _saveMemoryTurn creates conversation and saves the SECOND message
//    as the first user turn — the original failed message is permanently lost
//
// ─── FIX ───
// File: src/main/services/ChatService.js — queryStreaming() catch block
//
// FIND:
//     } catch (error) {
//       logger.error('[ChatService] Streaming query failed:', error);
//       if (onEvent) onEvent({ type: 'error', error: error.message || 'Streaming failed' });
//     }
//
// REPLACE WITH:
//     } catch (error) {
//       logger.error('[ChatService] Streaming query failed:', error);
//       // FIX FAULT-003: Save the user's message even on failure so it's not lost
//       try {
//         const memory = await this._getSessionMemory(sessionId);
//         // Ensure conversation exists even if we failed
//         if (this.chatHistoryStore && memory?.sessionId) {
//           let conv = this.chatHistoryStore.getConversation(memory.sessionId);
//           if (!conv) {
//             this.chatHistoryStore.createConversation(
//               (typeof cleanQuery === 'string' ? cleanQuery.slice(0, 50) : '') || 'New Conversation',
//               [],
//               memory.sessionId
//             );
//           }
//           this.chatHistoryStore.addMessage(memory.sessionId, {
//             role: 'user',
//             text: cleanQuery
//           });
//           this.chatHistoryStore.addMessage(memory.sessionId, {
//             role: 'assistant',
//             modelAnswer: [{ text: `Error: ${error.message || 'Response failed'}. Please try again.` }]
//           });
//         }
//       } catch (saveErr) {
//         logger.warn('[ChatService] Failed to save error turn:', saveErr.message);
//       }
//       if (onEvent) onEvent({ type: 'error', error: error.message || 'Streaming failed' });
//     }

// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ FAULT-004 (HIGH) — ComparisonTable Shows Same Text in Every Column          │
// │                                                                             │
// │ This was identified as BUG-006 in the previous audit, but it's more          │
// │ accurately a FAULT — the table renders, but the content is wrong.           │
// │                                                                             │
// │ Symptom: User asks "compare doc A with doc B". ComparisonTable shows         │
// │ 2 columns (doc-1 and doc-2). But EVERY cell in EVERY row shows the          │
// │ full row.text instead of only the portion relevant to that column.           │
// └─────────────────────────────────────────────────────────────────────────────┘
//
// ROOT CAUSE: Already documented in PATCH-006 from previous audit.
// The fix (extractSegmentsForDoc helper) is in the previous patch file.
// Listing here for completeness since it's a "works but produces wrong output" fault.

// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ FAULT-005 (MEDIUM) — require() Inside ESM Component Causes Stale Import     │
// │                                                                             │
// │ Symptom: handleSelectConversation uses require() inside a useCallback.       │
// │ In development with hot-reload, the require() may return a cached module     │
// │ with stale code. In production this works but is fragile.                    │
// │ In strict ESM mode (future Electron), this will throw at runtime.            │
// └─────────────────────────────────────────────────────────────────────────────┘
//
// ROOT CAUSE:
// File: src/renderer/components/search/UnifiedSearchModal.jsx — handleSelectConversation
//   const { getConversation } = require('../../services/ipc/chatIpc');
//
// The file already imports queryStream from the same module at the top:
//   import { queryStream } from '../../services/ipc/chatIpc';
//
// But getConversation is imported via require() inside the callback.
//
// ─── FIX ───
// FIND (at top of file):
//   import { queryStream } from '../../services/ipc/chatIpc';
//
// REPLACE WITH:
//   import { queryStream, getConversation } from '../../services/ipc/chatIpc';
//
// FIND (in handleSelectConversation):
//       const { getConversation } = require('../../services/ipc/chatIpc');
//       const conversation = await getConversation(id);
//
// REPLACE WITH:
//       const conversation = await getConversation(id);

// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ FAULT-006 (MEDIUM) — Message Ordering Can Swap on Rapid Send                │
// │                                                                             │
// │ Symptom: User sends two messages in quick succession. After reloading the    │
// │ conversation, messages may appear in wrong order.                            │
// └─────────────────────────────────────────────────────────────────────────────┘
//
// ROOT CAUSE:
// File: src/main/services/ChatHistoryStore.js — messages table
//   created_at TEXT NOT NULL DEFAULT (datetime('now'))
//
// SQLite's datetime('now') has SECOND precision. If two messages are inserted
// within the same second, their created_at is identical. The ORDER BY created_at ASC
// query returns them in arbitrary (insertion/rowid) order.
//
// This happens when: user sends message → response comes back fast → _saveMemoryTurn
// saves user+assistant → user sends second message within 1 second → second
// _saveMemoryTurn saves user+assistant with same timestamp.
//
// Actually, within a single _saveMemoryTurn call, both user and assistant messages
// get the SAME created_at. So the pair order is: user, assistant, user, assistant
// based on insertion order (rowid). This is correct since SQLite rowids are
// auto-incrementing. But if the second message's _saveMemoryTurn races with the
// first (unlikely but possible with async), the order could be wrong.
//
// ─── FIX ───
// File: src/main/services/ChatHistoryStore.js
//
// Add a sort_order column to guarantee ordering:
//
//   ALTER TABLE messages ADD COLUMN sort_order INTEGER DEFAULT 0;
//
// In addMessage, compute sort_order as the next sequence number:
//   const maxOrder = this._db.prepare(
//     'SELECT COALESCE(MAX(sort_order), 0) as max_order FROM messages WHERE conversation_id = ?'
//   ).get(conversationId);
//   const nextOrder = (maxOrder?.max_order || 0) + 1;
//
// In getConversation, order by sort_order:
//   SELECT * FROM messages WHERE conversation_id = ? ORDER BY sort_order ASC

// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ FAULT-007 (MEDIUM) — Non-Streaming query() Path is Dead Code                │
// │                                                                             │
// │ Symptom: No direct symptom. But the non-streaming query() method in          │
// │ ChatService has its own set of bug fixes, fallback logic, and persistence    │
// │ that will drift out of sync with queryStreaming() over time.                 │
// └─────────────────────────────────────────────────────────────────────────────┘
//
// ROOT CAUSE:
// - The preload exposes electronAPI.chat.query (mapped to CHAT.QUERY)
// - The IPC handler exists for CHAT.QUERY → service.query(payload)
// - But chatIpc.js (renderer) never exports a query() function
// - UnifiedSearchModal only calls queryStream()
// - The non-streaming query() path is unreachable from the UI
//
// This isn't broken today, but it means:
// 1. Any fixes applied to queryStreaming() must also be applied to query()
// 2. Any tests against query() don't reflect real behavior
// 3. If someone adds a "non-streaming" mode, they'll hit unfixed bugs
//
// ─── RECOMMENDATION ───
// Either: (a) Remove query() entirely and its IPC handler
// Or: (b) Extract shared logic into _executeQuery() used by both paths
// Option (b) is better for future flexibility.

// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ FAULT-008 (MEDIUM) — Conversation Title Never Improves After Creation       │
// │                                                                             │
// │ Symptom: Sidebar shows "What are the key findings" as the conversation       │
// │ title forever. The user has a 30-message conversation about quarterly        │
// │ revenue, but the title is still the truncated first query.                   │
// └─────────────────────────────────────────────────────────────────────────────┘
//
// ROOT CAUSE:
// File: src/main/services/ChatService.js — _saveMemoryTurn
//   createConversation((typeof input === 'string' ? input.slice(0, 50) : '') || 'New Conversation', ...)
//
// The title is set ONCE from the first 50 chars of the first user message.
// There is no updateTitle method in ChatHistoryStore.
// There is no LLM-based title generation.
// There is no UI to rename conversations.
//
// ─── FIX ───
// File: src/main/services/ChatHistoryStore.js — add updateTitle method:
//
//   updateTitle(conversationId, title) {
//     this._checkInit();
//     this._db.prepare('UPDATE conversations SET title = ? WHERE id = ?')
//       .run(title, conversationId);
//   }
//
// File: src/main/services/ChatService.js — after first successful response:
// After _saveMemoryTurn succeeds on the FIRST turn of a conversation,
// generate a better title from the query + first few words of the response:
//
//   // After saving the first turn, generate a smarter title
//   if (isFirstTurn) {
//     const shortAnswer = (parsed.modelAnswer?.[0]?.text || parsed.documentAnswer?.[0]?.text || '').slice(0, 100);
//     const betterTitle = cleanQuery.length > 50
//       ? cleanQuery.slice(0, 47) + '...'
//       : cleanQuery;
//     this.chatHistoryStore.updateTitle(memory.sessionId, betterTitle);
//   }
//
// (For an even better UX, use the LLM to generate a 5-word title, but that adds latency.)

// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ FAULT-009 (LOW) — "Use Sources in Graph" Button Broken on Reloaded Convs    │
// │                                                                             │
// │ Symptom: On a reloaded conversation, clicking "Use Sources in Graph" either  │
// │ does nothing or creates nodes with missing metadata.                         │
// └─────────────────────────────────────────────────────────────────────────────┘
//
// ROOT CAUSE:
// ChatPanel computes latestSources from the last assistant message:
//   const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
//   return lastAssistant?.sources || [];
//
// On reload: if FAULT-001 is NOT fixed, sources = [] → button has nothing to use.
// If FAULT-001 IS fixed, sources contain the basic shape from DB, BUT the source
// objects saved via addMessage only have: {id, fileId, name, path, snippet, score, ...}
// (whatever was in the structured save). The graph node builder expects:
//   tags, entities, dates, suggestedFolder, category — these are present in the
//   original source objects but may or may not survive JSON serialization.
//
// This is mostly fixed by FAULT-001's fix (saving full source objects).
// But verify that the JSON.stringify/parse round-trip preserves all fields.
//
// No additional fix needed if FAULT-001 is applied correctly.

// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ FAULT-010 (LOW) — Regenerate Button Sends Duplicate User Message             │
// │                                                                             │
// │ Symptom: User clicks "regenerate". A duplicate user message appears in chat. │
// └─────────────────────────────────────────────────────────────────────────────┘
//
// ROOT CAUSE:
// File: src/renderer/components/search/ChatPanel.jsx — Regenerate button
//   onClick={() => {
//     const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
//     if (lastUserMsg?.text) { onSend(lastUserMsg.text); }
//   }}
//
// onSend = handleChatSend which does:
//   setChatMessages(prev => [...prev, { role: 'user', text: trimmed }]);
//
// So regenerate: finds "What is the revenue?" → calls onSend("What is the revenue?")
// → adds ANOTHER "What is the revenue?" user message → sends to ChatService
// → ChatService saves ANOTHER user+assistant pair
//
// Result: conversation shows:
//   User: What is the revenue?
//   Assistant: (original response)
//   User: What is the revenue?    ← duplicate
//   Assistant: (regenerated response)
//
// ─── FIX ───
// Option A: Add a separate onRegenerate prop that skips adding the user message
// Option B: Check if the last user message text matches and skip the push
//
// File: src/renderer/components/search/UnifiedSearchModal.jsx
// Add a handleRegenerate callback:
//
//   const handleRegenerate = useCallback(async () => {
//     const lastUserMsg = [...chatMessages].reverse().find(m => m.role === 'user');
//     if (!lastUserMsg?.text) return;
//
//     // Remove the last assistant message (the one being regenerated)
//     setChatMessages(prev => {
//       const newMsgs = [...prev];
//       if (newMsgs.length > 0 && newMsgs[newMsgs.length - 1].role === 'assistant') {
//         newMsgs.pop();
//       }
//       return newMsgs;
//     });
//
//     // Re-send without adding a duplicate user message
//     // ... (reuse handleChatSend logic but skip the user message push)
//   }, [chatMessages]);
//
// Then pass onRegenerate to ChatPanel instead of using onSend for regeneration.

// ═══════════════════════════════════════════════════════════════════════════════
// SUMMARY — PRIORITIZED FIX ORDER
// ═══════════════════════════════════════════════════════════════════════════════
//
// FAULT-001 (CRITICAL) — Fix first. Without this, reloaded conversations are useless.
//   Files: ChatHistoryStore.js (_migrate, addMessage, _parseMessage)
//          ChatService.js (_saveMemoryTurn, all callers)
//   Effort: ~45 minutes
//
// FAULT-002 (HIGH) — Fix second. Document scope is core to the product.
//   Files: UnifiedSearchModal.jsx (handleSelectConversation, handleNewConversation, queryStream call)
//          ChatService.js (_saveMemoryTurn, queryStreaming)
//   Effort: ~20 minutes
//
// FAULT-003 (HIGH) — Fix third. User messages should never be silently lost.
//   Files: ChatService.js (queryStreaming catch block)
//   Effort: ~10 minutes
//
// FAULT-005 (MEDIUM) — Quick fix. Replace require() with import.
//   Files: UnifiedSearchModal.jsx
//   Effort: ~2 minutes
//
// FAULT-008 (MEDIUM) — Add updateTitle + title improvement.
//   Files: ChatHistoryStore.js, ChatService.js
//   Effort: ~15 minutes
//
// FAULT-006 (MEDIUM) — Add sort_order column for message ordering.
//   Files: ChatHistoryStore.js
//   Effort: ~15 minutes
//
// FAULT-010 (LOW) — Regenerate sends duplicate message.
//   Files: UnifiedSearchModal.jsx, ChatPanel.jsx
//   Effort: ~20 minutes
//
// FAULT-004, FAULT-009 — Already covered by previous patches and FAULT-001 fix.
// FAULT-007 — Architectural recommendation, not a code fix.
//
// TOTAL EFFORT: ~2.5 hours for all fixes
// ═══════════════════════════════════════════════════════════════════════════════
