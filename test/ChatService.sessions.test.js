/**
 * Tests for ChatService session management and edge cases.
 *
 * Verifies:
 * - Session eviction when MAX_SESSIONS is reached
 * - _isConversational short-circuits on long input (ReDoS prevention)
 * - _isConversational correctly identifies known conversational phrases
 * - _formatForMemory handles empty/null parsed responses
 */

jest.mock('../src/shared/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

jest.mock('../src/main/utils/jsonRepair', () => ({
  extractAndParseJSON: jest.fn()
}));

const ChatService = require('../src/main/services/ChatService');

function createMinimalService() {
  return new ChatService({
    llamaService: {
      analyzeText: jest.fn().mockResolvedValue({ success: true, response: '{}' })
    }
  });
}

describe('ChatService session management', () => {
  test('evicts oldest session when MAX_SESSIONS is reached', async () => {
    const service = createMinimalService();

    // MAX_SESSIONS is 50; create 50 sessions
    for (let i = 0; i < 50; i++) {
      await service._getSessionMemory(`session-${i}`);
    }
    expect(service.sessions.size).toBe(50);

    // Creating session 51 should evict session-0 (oldest)
    await service._getSessionMemory('session-50');
    expect(service.sessions.size).toBe(50);
    expect(service.sessions.has('session-0')).toBe(false);
    expect(service.sessions.has('session-50')).toBe(true);
  });

  test('reuses existing session instead of creating new', async () => {
    const service = createMinimalService();
    const mem1 = await service._getSessionMemory('test-session');
    const mem2 = await service._getSessionMemory('test-session');
    expect(mem1).toBe(mem2);
  });

  test('uses "default" key when sessionId is null/undefined', async () => {
    const service = createMinimalService();
    const mem1 = await service._getSessionMemory(null);
    const mem2 = await service._getSessionMemory(undefined);
    expect(mem1).toBe(mem2);
    expect(service.sessions.has('default')).toBe(true);
  });

  test('resetSession removes the session', async () => {
    const service = createMinimalService();
    await service._getSessionMemory('to-delete');
    expect(service.sessions.has('to-delete')).toBe(true);

    await service.resetSession('to-delete');
    expect(service.sessions.has('to-delete')).toBe(false);
  });
});

describe('ChatService _isConversational', () => {
  let service;

  beforeEach(() => {
    service = createMinimalService();
  });

  test('returns true for known greetings', () => {
    expect(service._isConversational('hello')).toBe(true);
    expect(service._isConversational('Hi')).toBe(true);
    expect(service._isConversational('HEY')).toBe(true);
    expect(service._isConversational('good morning')).toBe(true);
    expect(service._isConversational('thanks')).toBe(true);
    expect(service._isConversational('thank you')).toBe(true);
    expect(service._isConversational('who are you')).toBe(true);
    expect(service._isConversational('what can you do')).toBe(true);
  });

  test('returns false for non-conversational queries', () => {
    expect(service._isConversational('find my tax returns')).toBe(false);
    expect(service._isConversational('search for documents about AI')).toBe(false);
  });

  test('strips punctuation before matching', () => {
    expect(service._isConversational('hello!')).toBe(true);
    expect(service._isConversational('thanks!!!')).toBe(true);
    expect(service._isConversational('hi...')).toBe(true);
  });

  test('short-circuits on long input to prevent ReDoS', () => {
    // A string > 100 chars should return false immediately
    const longString = 'a'.repeat(200);
    const start = Date.now();
    const result = service._isConversational(longString);
    const elapsed = Date.now() - start;

    expect(result).toBe(false);
    expect(elapsed).toBeLessThan(10); // Should be near-instant
  });

  test('handles edge cases gracefully', () => {
    expect(service._isConversational('')).toBe(false);
    expect(service._isConversational('   ')).toBe(false);
  });
});

describe('ChatService _formatForMemory', () => {
  let service;

  beforeEach(() => {
    service = createMinimalService();
  });

  test('combines document and model answers', () => {
    const parsed = {
      documentAnswer: [{ text: 'Doc info' }],
      modelAnswer: [{ text: 'Model response' }],
      followUps: []
    };
    expect(service._formatForMemory(parsed)).toBe('Doc info\nModel response');
  });

  test('returns fallback when both answer arrays are empty', () => {
    const parsed = {
      documentAnswer: [],
      modelAnswer: [],
      followUps: []
    };
    expect(service._formatForMemory(parsed)).toBe('No answer produced.');
  });

  test('handles null/undefined answer arrays', () => {
    const parsed = {};
    expect(service._formatForMemory(parsed)).toBe('No answer produced.');
  });
});

describe('ChatService fallback memory', () => {
  test('memory window limits stored turns', async () => {
    const service = createMinimalService();
    const memory = await service._getSessionMemory('test');

    // DEFAULTS.memoryWindow is 6, so we can store 6 turns (12 lines)
    for (let i = 0; i < 10; i++) {
      await memory.saveContext({ input: `Question ${i}` }, { output: `Answer ${i}` });
    }

    const { history } = await memory.loadMemoryVariables({});
    // Should only contain the last 6 turns
    expect(history).not.toContain('Question 0');
    expect(history).not.toContain('Question 3');
    expect(history).toContain('Question 4');
    expect(history).toContain('Answer 9');
  });
});
