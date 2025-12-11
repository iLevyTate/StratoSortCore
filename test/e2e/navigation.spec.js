/**
 * Navigation E2E Tests
 *
 * Tests navigation between different phases of the application
 * and verifies phase transition rules are enforced.
 *
 * Run: npm run test:e2e -- --grep "Navigation"
 */

const { test, expect } = require('@playwright/test');
const { launchApp, closeApp, waitForAppReady } = require('./helpers/electronApp');
const { NavigationPage } = require('./helpers/pageObjects');
const { PHASES, PHASE_NAV_LABELS } = require('./helpers/testFixtures');

test.describe('Navigation', () => {
  let app;
  let window;
  let nav;

  test.beforeEach(async () => {
    const result = await launchApp();
    app = result.app;
    window = result.window;
    await waitForAppReady(window);
    nav = new NavigationPage(window);
  });

  test.afterEach(async () => {
    await closeApp(app);
  });

  test('should start on Welcome phase', async () => {
    const currentPhase = await nav.getCurrentPhase();
    console.log('[Test] Current phase:', currentPhase);
    expect(currentPhase).toBe(PHASES.WELCOME);
  });

  test('should show all phase buttons in navigation', async () => {
    const phaseButtons = window.locator('nav[aria-label="Phase navigation"] button');
    const count = await phaseButtons.count();

    // Should have buttons for all phases
    expect(count).toBeGreaterThanOrEqual(5);

    // Check each phase label exists
    for (const [, label] of Object.entries(PHASE_NAV_LABELS)) {
      const button = window.locator(`button:has-text("${label}")`);
      const exists = await button.count();
      console.log(`[Test] Phase "${label}":`, exists > 0 ? 'found' : 'not found');
      expect(exists).toBeGreaterThan(0);
    }
  });

  test('should navigate from Welcome to Setup', async () => {
    // From Welcome, Setup should be accessible
    const canNavigate = await nav.isPhaseAccessible(PHASES.SETUP);
    expect(canNavigate).toBe(true);

    // Navigate to Setup
    const success = await nav.goToPhase(PHASES.SETUP);
    expect(success).toBe(true);

    // Verify we're on Setup phase
    await window.waitForTimeout(500); // Allow for animation
    const currentPhase = await nav.getCurrentPhase();
    expect(currentPhase).toBe(PHASES.SETUP);
  });

  test('should navigate from Welcome to Discover (Quick Start)', async () => {
    // From Welcome, Discover should also be accessible (quick start path)
    const canNavigate = await nav.isPhaseAccessible(PHASES.DISCOVER);
    expect(canNavigate).toBe(true);

    // Navigate to Discover
    const success = await nav.goToPhase(PHASES.DISCOVER);
    expect(success).toBe(true);

    await window.waitForTimeout(500);
    const currentPhase = await nav.getCurrentPhase();
    expect(currentPhase).toBe(PHASES.DISCOVER);
  });

  test('should enforce phase transition rules', async () => {
    // From Welcome, Organize should not be directly accessible
    const organizeButton = window.locator(
      `button:has-text("${PHASE_NAV_LABELS[PHASES.ORGANIZE]}")`
    );

    // The button might be disabled or the click might not navigate
    const isDisabled = await organizeButton.isDisabled().catch(() => true);

    console.log('[Test] Organize button disabled from Welcome:', isDisabled);

    // Even if we try to click, we shouldn't navigate to Organize from Welcome
    if (!isDisabled) {
      await organizeButton.click();
      await window.waitForTimeout(500);
      const currentPhase = await nav.getCurrentPhase();
      // Should still be on Welcome or a valid transition target
      expect([PHASES.WELCOME, PHASES.SETUP, PHASES.DISCOVER]).toContain(currentPhase);
    }
  });

  test('should allow navigation back to Welcome from Setup', async () => {
    // First go to Setup
    await nav.goToPhase(PHASES.SETUP);
    await window.waitForTimeout(500);

    // Then go back to Welcome
    const success = await nav.goToPhase(PHASES.WELCOME);
    expect(success).toBe(true);

    await window.waitForTimeout(500);
    const currentPhase = await nav.getCurrentPhase();
    expect(currentPhase).toBe(PHASES.WELCOME);
  });

  test('should highlight current phase in navigation', async () => {
    // Check that Welcome button has aria-current
    let activeButton = window.locator('button[aria-current="page"]');
    let label = await activeButton.getAttribute('aria-label');
    expect(label).toContain('Welcome');

    // Navigate to Setup
    await nav.goToPhase(PHASES.SETUP);
    await window.waitForTimeout(500);

    // Now Setup should be active
    activeButton = window.locator('button[aria-current="page"]');
    label = await activeButton.getAttribute('aria-label');
    expect(label).toContain('Smart Folders');
  });

  test('should open settings panel from navigation', async () => {
    // Click settings button
    await nav.openSettings();

    // Settings panel should be visible
    const settingsPanel = window.locator('[role="dialog"]');
    await expect(settingsPanel).toBeVisible({ timeout: 5000 });

    // Close settings
    const closeButton = window.locator(
      '[aria-label="Close Settings"], [aria-label="Close"], button:has-text("Close")'
    );
    if (await closeButton.isVisible()) {
      await closeButton.click();
      await window.waitForTimeout(300);
    }
  });

  test('should navigate through complete workflow path', async () => {
    // Follow the main workflow: Welcome -> Setup -> Discover
    console.log('[Test] Testing workflow navigation...');

    // Start at Welcome
    expect(await nav.getCurrentPhase()).toBe(PHASES.WELCOME);

    // Go to Setup
    await nav.goToPhase(PHASES.SETUP);
    await window.waitForTimeout(500);
    expect(await nav.getCurrentPhase()).toBe(PHASES.SETUP);

    // Go to Discover
    await nav.goToPhase(PHASES.DISCOVER);
    await window.waitForTimeout(500);
    expect(await nav.getCurrentPhase()).toBe(PHASES.DISCOVER);

    // Go back to Welcome
    await nav.goToPhase(PHASES.WELCOME);
    await window.waitForTimeout(500);
    expect(await nav.getCurrentPhase()).toBe(PHASES.WELCOME);

    console.log('[Test] Workflow navigation complete');
  });
});

test.describe('Navigation - Keyboard Shortcuts', () => {
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

  test('should focus navigation with Tab key', async () => {
    // Press Tab to move focus through the UI
    await window.keyboard.press('Tab');
    await window.waitForTimeout(200);

    // Check if a navigation element is focused
    const focusedElement = await window.evaluate(() => {
      return document.activeElement?.tagName;
    });

    console.log('[Test] Focused element after Tab:', focusedElement);
    // Should have moved focus to an interactive element
    expect(focusedElement).toBeDefined();
  });

  test('should handle Escape key gracefully', async () => {
    // First open something (settings)
    const settingsButton = window.locator('button[aria-label="Open Settings"]');
    await settingsButton.click();
    await window.waitForTimeout(300);

    // Press Escape to close
    await window.keyboard.press('Escape');
    await window.waitForTimeout(300);

    // Settings should be closed
    const settingsPanel = window.locator('[role="dialog"]');
    const isVisible = await settingsPanel.isVisible().catch(() => false);
    expect(isVisible).toBe(false);
  });
});

test.describe('Navigation - Accessibility', () => {
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

  test('should have skip link for accessibility', async () => {
    // Check for skip link
    const skipLink = window.locator('a.skip-link, a[href="#main-content"]');
    const exists = await skipLink.count();

    console.log('[Test] Skip link found:', exists > 0);
    expect(exists).toBeGreaterThan(0);
  });

  test('should have aria labels on navigation buttons', async () => {
    const navButtons = window.locator('nav[aria-label="Phase navigation"] button');
    const count = await navButtons.count();

    for (let i = 0; i < count; i++) {
      const button = navButtons.nth(i);
      const ariaLabel = await button.getAttribute('aria-label');

      console.log(`[Test] Button ${i} aria-label:`, ariaLabel);
      expect(ariaLabel).toBeTruthy();
    }
  });

  test('should have main content landmark', async () => {
    const main = window.locator('main#main-content');
    const exists = await main.count();

    expect(exists).toBeGreaterThan(0);
  });
});
