const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { app } = require('electron');
const { createLogger } = require('../../shared/logger');
const { createSingletonHelpers } = require('../../shared/singletonFactory');

const logger = createLogger('ChatHistoryStore');

class ChatHistoryStore {
  constructor() {
    this._db = null;
    this._initialized = false;
    this._hasMetaColumn = false;
    this._hasSortOrderColumn = false;
  }

  async initialize() {
    if (this._initialized) return;

    try {
      const userDataPath = app.getPath('userData');
      const dbPath = path.join(userDataPath, 'chat_history.db');

      // Ensure directory exists
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      this._db = new Database(dbPath);
      this._db.pragma('journal_mode = WAL'); // Better concurrency

      this._migrate();
      this._initialized = true;
      logger.info('Chat history database initialized', { path: dbPath });
    } catch (error) {
      logger.error('Failed to initialize chat history database', error);
      throw error;
    }
  }

  _migrate() {
    const db = this._db;

    // Create tables
    db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        document_scope TEXT DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
        text TEXT NOT NULL DEFAULT '',
        document_answer TEXT DEFAULT '[]',
        model_answer TEXT DEFAULT '[]',
        sources TEXT DEFAULT '[]',
        follow_ups TEXT DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);
    `);

    try {
      const columns = db.pragma('table_info(messages)');
      this._hasMetaColumn = columns.some((col) => col.name === 'meta');
      if (!this._hasMetaColumn) {
        db.exec(`ALTER TABLE messages ADD COLUMN meta TEXT DEFAULT '{}'`);
        this._hasMetaColumn = true;
      }
      this._hasSortOrderColumn = columns.some((col) => col.name === 'sort_order');
      if (!this._hasSortOrderColumn) {
        db.exec(`ALTER TABLE messages ADD COLUMN sort_order INTEGER DEFAULT 0`);
        this._hasSortOrderColumn = true;
      }
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_messages_conv_sort ON messages(conversation_id, sort_order)`
      );
    } catch (migrateErr) {
      logger.warn('[ChatHistoryStore] Column migration skipped:', migrateErr?.message);
      this._hasMetaColumn = false;
      this._hasSortOrderColumn = false;
    }
  }

  createConversation(title = 'New Conversation', documentScope = [], id = null) {
    this._checkInit();
    const finalId = id || crypto.randomUUID();
    const stmt = this._db.prepare(`
      INSERT INTO conversations (id, title, document_scope)
      VALUES (?, ?, ?)
    `);
    stmt.run(finalId, title, JSON.stringify(documentScope));
    return { id: finalId, title, documentScope, createdAt: new Date().toISOString() };
  }

  getConversation(id) {
    this._checkInit();
    const conv = this._db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
    if (!conv) return null;

    const messages = this._hasSortOrderColumn
      ? this._db
          .prepare(
            `SELECT * FROM messages WHERE conversation_id = ? ORDER BY sort_order ASC, created_at ASC`
          )
          .all(id)
      : this._db
          .prepare(`SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`)
          .all(id);

    return {
      id: conv.id,
      title: conv.title,
      documentScope: JSON.parse(conv.document_scope || '[]'),
      createdAt: conv.created_at,
      updatedAt: conv.updated_at,
      messages: messages.map(this._parseMessage)
    };
  }

  listConversations(limit = 50, offset = 0) {
    this._checkInit();
    const rows = this._db
      .prepare(
        `
      SELECT * FROM conversations ORDER BY updated_at DESC LIMIT ? OFFSET ?
    `
      )
      .all(limit, offset);

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      documentScope: JSON.parse(row.document_scope || '[]'),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  addMessage(conversationId, message) {
    this._checkInit();
    const id = message.id || crypto.randomUUID();
    const nextSortOrder = this._hasSortOrderColumn
      ? (this._db
          .prepare(
            'SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM messages WHERE conversation_id = ?'
          )
          .get(conversationId)?.max_order || 0) + 1
      : null;

    if (this._hasMetaColumn && this._hasSortOrderColumn) {
      const stmt = this._db.prepare(`
        INSERT INTO messages (
          id, conversation_id, role, text,
          document_answer, model_answer, sources, follow_ups, sort_order, meta
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        id,
        conversationId,
        message.role,
        message.text || '',
        JSON.stringify(message.documentAnswer || []),
        JSON.stringify(message.modelAnswer || []),
        JSON.stringify(message.sources || []),
        JSON.stringify(message.followUps || []),
        nextSortOrder,
        JSON.stringify(message.meta || {})
      );
    } else if (this._hasMetaColumn) {
      const stmt = this._db.prepare(`
        INSERT INTO messages (
          id, conversation_id, role, text,
          document_answer, model_answer, sources, follow_ups, meta
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        id,
        conversationId,
        message.role,
        message.text || '',
        JSON.stringify(message.documentAnswer || []),
        JSON.stringify(message.modelAnswer || []),
        JSON.stringify(message.sources || []),
        JSON.stringify(message.followUps || []),
        JSON.stringify(message.meta || {})
      );
    } else if (this._hasSortOrderColumn) {
      const stmt = this._db.prepare(`
        INSERT INTO messages (
          id, conversation_id, role, text,
          document_answer, model_answer, sources, follow_ups, sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        id,
        conversationId,
        message.role,
        message.text || '',
        JSON.stringify(message.documentAnswer || []),
        JSON.stringify(message.modelAnswer || []),
        JSON.stringify(message.sources || []),
        JSON.stringify(message.followUps || []),
        nextSortOrder
      );
    } else {
      const stmt = this._db.prepare(`
        INSERT INTO messages (
          id, conversation_id, role, text,
          document_answer, model_answer, sources, follow_ups
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        id,
        conversationId,
        message.role,
        message.text || '',
        JSON.stringify(message.documentAnswer || []),
        JSON.stringify(message.modelAnswer || []),
        JSON.stringify(message.sources || []),
        JSON.stringify(message.followUps || [])
      );
    }

    // Update conversation timestamp
    this._db
      .prepare(
        `
      UPDATE conversations SET updated_at = datetime('now') WHERE id = ?
    `
      )
      .run(conversationId);

    return { id, ...message };
  }

  deleteConversation(id) {
    this._checkInit();
    this._db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
  }

  searchConversations(query) {
    this._checkInit();
    // Escape LIKE special characters to prevent unintended wildcard matching
    const escapedQuery = query.replace(/[%_]/g, '\\$&');
    const pattern = `%${escapedQuery}%`;
    const rows = this._db
      .prepare(
        `
      SELECT DISTINCT c.* 
      FROM conversations c
      JOIN messages m ON c.id = m.conversation_id
      WHERE m.text LIKE ? ESCAPE '\\'
         OR m.document_answer LIKE ? ESCAPE '\\'
         OR m.model_answer LIKE ? ESCAPE '\\'
         OR c.title LIKE ? ESCAPE '\\'
      ORDER BY c.updated_at DESC
      LIMIT 20
    `
      )
      .all(pattern, pattern, pattern, pattern);

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      documentScope: JSON.parse(row.document_scope || '[]'),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  _parseMessage(row) {
    const meta = (() => {
      try {
        return JSON.parse(row.meta || '{}');
      } catch {
        return {};
      }
    })();
    return {
      id: row.id,
      role: row.role,
      text: row.text,
      documentAnswer: JSON.parse(row.document_answer || '[]'),
      modelAnswer: JSON.parse(row.model_answer || '[]'),
      sources: JSON.parse(row.sources || '[]'),
      followUps: JSON.parse(row.follow_ups || '[]'),
      meta,
      createdAt: row.created_at
    };
  }

  _checkInit() {
    if (!this._initialized) throw new Error('ChatHistoryStore not initialized');
  }

  /**
   * Update the title of an existing conversation.
   * Used to replace the default "New Chat" title with a more descriptive one
   * derived from the first query/response exchange.
   * @param {string} conversationId
   * @param {string} title
   */
  updateTitle(conversationId, title) {
    this._checkInit();
    this._db
      .prepare("UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ?")
      .run(title, conversationId);
  }

  exportAsMarkdown(conversationId) {
    this._checkInit();
    const conv = this.getConversation(conversationId);
    if (!conv) return null;

    const lines = [`# ${conv.title || 'Conversation'}\n`];
    lines.push(`*Exported: ${new Date().toISOString()}*\n`);

    for (const msg of conv.messages || []) {
      const role = msg.role === 'user' ? '**You**' : '**StratoSort**';
      lines.push(`\n## ${role}\n`);

      if (msg.documentAnswer?.length > 0) {
        for (const doc of msg.documentAnswer) {
          if (doc.text) lines.push(doc.text + '\n');
        }
      }
      if (msg.modelAnswer?.length > 0) {
        for (const model of msg.modelAnswer) {
          if (model.text) lines.push(model.text + '\n');
        }
      }
      if (!msg.documentAnswer?.length && !msg.modelAnswer?.length && msg.text) {
        lines.push(msg.text + '\n');
      }
      if (msg.sources?.length > 0) {
        lines.push('\n**Sources:**\n');
        for (const src of msg.sources) {
          lines.push(
            `- [${src.id}] ${src.name || src.fileId}${src.path ? ` (${src.path})` : ''}\n`
          );
        }
      }
    }
    return lines.join('');
  }

  shutdown() {
    if (this._db) {
      this._db.close();
      this._db = null;
      this._initialized = false;
      this._hasMetaColumn = false;
      this._hasSortOrderColumn = false;
    }
  }
}

// Singleton export
const { getInstance, createInstance, registerWithContainer, resetInstance } =
  createSingletonHelpers({
    ServiceClass: ChatHistoryStore,
    serviceId: 'CHAT_HISTORY_STORE',
    serviceName: 'ChatHistoryStore',
    containerPath: './ServiceContainer',
    shutdownMethod: 'shutdown'
  });

module.exports = {
  ChatHistoryStore,
  getInstance,
  createInstance,
  registerWithContainer,
  resetInstance
};
