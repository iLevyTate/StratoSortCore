import { EventEmitter } from 'events';

const { electronAPI } = window;

class ChatStream extends EventEmitter {
  constructor() {
    super();
    this.handleChunk = this.handleChunk.bind(this);
    this.handleEnd = this.handleEnd.bind(this);
    this.cleanupFns = [];
    this.payload = null;
  }

  start(payload) {
    this.payload = payload;
    // Register listeners
    if (electronAPI.chat.onStreamChunk) {
      this.cleanupFns.push(electronAPI.chat.onStreamChunk(this.handleChunk));
    }
    if (electronAPI.chat.onStreamEnd) {
      this.cleanupFns.push(electronAPI.chat.onStreamEnd(this.handleEnd));
    }

    // Invoke the main process handler
    electronAPI.chat
      .queryStream(payload)
      .then((result) => {
        // If the service returns a fallback failure object, no stream events
        // will arrive. Surface this immediately to avoid indefinite loading.
        if (result && result.success === false) {
          this.emit('error', new Error(result.error || 'Chat service unavailable'));
          this.cleanup();
        }
      })
      .catch((err) => {
        this.emit('error', err);
        this.cleanup();
      });
  }

  handleChunk(data) {
    this.emit('data', data);
  }

  handleEnd() {
    this.emit('end');
    this.cleanup();
  }

  cleanup() {
    this.cleanupFns.forEach((fn) => {
      if (typeof fn === 'function') fn();
    });
    this.cleanupFns = [];
  }

  cancel() {
    if (electronAPI.chat.cancelStream) {
      electronAPI.chat
        .cancelStream({
          requestId: this.payload?.requestId,
          sessionId: this.payload?.sessionId
        })
        .catch(() => {});
    }
    this.cleanup();
    this.emit('end');
  }
}

export function queryStream(payload) {
  const stream = new ChatStream();
  // Defer start to allow caller to register listeners
  setTimeout(() => stream.start(payload), 0);
  return stream;
}

export async function listConversations(limit = 50, offset = 0) {
  if (!electronAPI.chat.listConversations) return { conversations: [] };
  const result = await electronAPI.chat.listConversations(limit, offset);
  if (!result.success) throw new Error(result.error);
  return result.conversations;
}

export async function getConversation(id) {
  if (!electronAPI.chat.getConversation) return null;
  const result = await electronAPI.chat.getConversation(id);
  if (!result.success) throw new Error(result.error);
  return result.conversation;
}

export async function deleteConversation(id) {
  if (!electronAPI.chat.deleteConversation) return;
  const result = await electronAPI.chat.deleteConversation(id);
  if (!result.success) throw new Error(result.error);
}

export async function searchConversations(query) {
  if (!electronAPI.chat.searchConversations) return [];
  const result = await electronAPI.chat.searchConversations(query);
  if (!result.success) throw new Error(result.error);
  return result.results;
}

export async function exportConversation(id) {
  if (!electronAPI.chat.exportConversation) return null;
  const result = await electronAPI.chat.exportConversation(id);
  if (!result.success) throw new Error(result.error);
  return result.markdown;
}
