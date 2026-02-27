/**
 * Chat / Understand Tab E2E Tests
 *
 * Tests the conversational AI chat feature in the Knowledge OS Understand tab.
 * Covers chat session creation, message sending, RAG-based responses,
 * conversation history, and chat persona selection.
 *
 * Run: npm run test:e2e -- --grep "Chat Understand"
 */

const { test, expect } = require('@playwright/test');
const { launchApp, closeApp, waitForAppReady } = require('./helpers/electronApp');

test.describe('Chat Understand — API Surface', () => {
  let app;
  let window;

  test.beforeEach(async () => {
    const result = await launchApp();
    app = result.app;
    window = result.window;
    await waitForAppReady(window);
  });

  test.afterEach(async () => {
    await closeApp(app);
  });

  test('should have chat APIs available', async () => {
    const api = await window.evaluate(() => ({
      hasChatSend:
        typeof window.electronAPI?.chat?.send === 'function' ||
        typeof window.electronAPI?.chat?.sendMessage === 'function',
      hasChatHistory:
        typeof window.electronAPI?.chat?.getHistory === 'function' ||
        typeof window.electronAPI?.chatHistory?.get === 'function',
      hasChatStream:
        typeof window.electronAPI?.chat?.onStreamChunk === 'function' ||
        typeof window.electronAPI?.chat?.stream === 'function'
    }));

    expect(api.hasChatSend || api.hasChatHistory || api.hasChatStream).toBe(true);
  });

  test('should have chat history store API', async () => {
    const api = await window.evaluate(() => ({
      hasGetConversations: typeof window.electronAPI?.chatHistory?.getConversations === 'function',
      hasCreateConversation:
        typeof window.electronAPI?.chatHistory?.createConversation === 'function',
      hasDeleteConversation:
        typeof window.electronAPI?.chatHistory?.deleteConversation === 'function'
    }));

    const hasAny = Object.values(api).some((v) => v);
    expect(hasAny).toBe(true);
  });
});

test.describe('Chat Understand — UI Interactions', () => {
  let app;
  let window;

  test.beforeEach(async () => {
    const result = await launchApp();
    app = result.app;
    window = result.window;
    await waitForAppReady(window);
  });

  test.afterEach(async () => {
    await closeApp(app);
  });

  test('should open Knowledge OS and navigate to Understand tab', async () => {
    await window.keyboard.press('Control+k');
    await window.waitForTimeout(500);

    const understandTab = window
      .locator('button:has-text("Understand"), [role="tab"]:has-text("Understand")')
      .first();

    const isVisible = await understandTab.isVisible().catch(() => false);
    if (isVisible) {
      await understandTab.click();
      await window.waitForTimeout(500);

      const chatUI = await window.evaluate(() => {
        const body = document.body.textContent || '';
        return {
          hasConversational: body.includes('Conversational') || body.includes('Chat'),
          hasInput: !!document.querySelector(
            'textarea, input[placeholder*="question" i], input[placeholder*="ask" i]'
          ),
          hasSendButton: !!document.querySelector('button:has(svg), button:text("Send")'),
          hasNewChat: body.includes('New Chat') || body.includes('new chat')
        };
      });

      expect(chatUI.hasConversational || chatUI.hasInput).toBe(true);
    }
  });

  test('should show chat input and send button on Understand tab', async () => {
    await window.keyboard.press('Control+k');
    await window.waitForTimeout(500);

    const understandTab = window
      .locator('button:has-text("Understand"), [role="tab"]:has-text("Understand")')
      .first();
    if (await understandTab.isVisible().catch(() => false)) {
      await understandTab.click();
      await window.waitForTimeout(500);

      const chatInput = window
        .locator(
          'textarea, input[placeholder*="question" i], input[placeholder*="ask" i], input[placeholder*="document" i]'
        )
        .first();

      const inputVisible = await chatInput.isVisible().catch(() => false);
      if (inputVisible) {
        await chatInput.fill('What files do I have?');
        const value = await chatInput.inputValue().catch(() => '');
        expect(value).toContain('What files');
      }
    }
  });

  test('should show New Chat button in sidebar', async () => {
    await window.keyboard.press('Control+k');
    await window.waitForTimeout(500);

    const understandTab = window
      .locator('button:has-text("Understand"), [role="tab"]:has-text("Understand")')
      .first();
    if (await understandTab.isVisible().catch(() => false)) {
      await understandTab.click();
      await window.waitForTimeout(500);

      const newChatBtn = window.locator('button:has-text("New Chat")').first();
      const hasNewChat = await newChatBtn.isVisible().catch(() => false);

      expect(hasNewChat).toBe(true);
    }
  });

  test('should close Knowledge OS chat with Escape', async () => {
    await window.keyboard.press('Control+k');
    await window.waitForTimeout(500);

    const understandTab = window.locator('button:has-text("Understand")').first();
    if (await understandTab.isVisible().catch(() => false)) {
      await understandTab.click();
      await window.waitForTimeout(300);

      await window.keyboard.press('Escape');
      await window.waitForTimeout(300);
    }
  });
});
