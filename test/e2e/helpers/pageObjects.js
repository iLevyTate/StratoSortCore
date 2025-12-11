/**
 * Page Object Models for E2E Testing
 *
 * Encapsulates UI interaction patterns for different pages/phases of the app.
 * This abstraction makes tests more readable and maintainable.
 *
 * Usage:
 *   const { NavigationPage, DiscoverPage } = require('./helpers/pageObjects');
 *   const nav = new NavigationPage(window);
 *   await nav.goToPhase('discover');
 */

const { SELECTORS, PHASES, PHASE_NAV_LABELS, TIMEOUTS } = require('./testFixtures');

/**
 * Base Page Object with common functionality
 */
class BasePage {
  /**
   * @param {Page} window - Playwright Page object
   */
  constructor(window) {
    this.window = window;
  }

  /**
   * Wait for an element to be visible
   * @param {string} selector - CSS selector
   * @param {number} timeout - Timeout in ms
   */
  async waitForVisible(selector, timeout = TIMEOUTS.MEDIUM) {
    await this.window.waitForSelector(selector, { state: 'visible', timeout });
  }

  /**
   * Wait for an element to be hidden
   * @param {string} selector - CSS selector
   * @param {number} timeout - Timeout in ms
   */
  async waitForHidden(selector, timeout = TIMEOUTS.MEDIUM) {
    await this.window.waitForSelector(selector, { state: 'hidden', timeout }).catch(() => {
      // Element may not exist, which is fine
    });
  }

  /**
   * Click an element
   * @param {string} selector - CSS selector
   */
  async click(selector) {
    await this.window.click(selector);
  }

  /**
   * Type text into an input
   * @param {string} selector - CSS selector
   * @param {string} text - Text to type
   */
  async type(selector, text) {
    await this.window.fill(selector, text);
  }

  /**
   * Get text content of an element
   * @param {string} selector - CSS selector
   * @returns {Promise<string>}
   */
  async getText(selector) {
    return this.window.textContent(selector);
  }

  /**
   * Check if element is visible
   * @param {string} selector - CSS selector
   * @returns {Promise<boolean>}
   */
  async isVisible(selector) {
    const element = this.window.locator(selector);
    return element.isVisible();
  }

  /**
   * Wait for loading spinners to disappear
   */
  async waitForLoading() {
    await this.waitForHidden(SELECTORS.loadingSpinner, TIMEOUTS.LONG);
  }

  /**
   * Take a screenshot
   * @param {string} name - Screenshot name
   */
  async screenshot(name) {
    await this.window.screenshot({
      path: `test-results/e2e/screenshots/${name}_${Date.now()}.png`
    });
  }
}

/**
 * Navigation Page Object
 * Handles navigation bar interactions
 */
class NavigationPage extends BasePage {
  /**
   * Get current phase from navigation
   * @returns {Promise<string>} Current phase identifier
   */
  async getCurrentPhase() {
    const activeButton = this.window.locator('button[aria-current="page"]');
    const label = await activeButton.getAttribute('aria-label');
    // Map label back to phase
    for (const [phase, navLabel] of Object.entries(PHASE_NAV_LABELS)) {
      if (label && label.includes(navLabel)) {
        return phase;
      }
    }
    return PHASES.WELCOME;
  }

  /**
   * Navigate to a specific phase
   * @param {string} phase - Phase identifier from PHASES
   */
  async goToPhase(phase) {
    const navLabel = PHASE_NAV_LABELS[phase];
    if (!navLabel) {
      throw new Error(`Unknown phase: ${phase}`);
    }

    const button = this.window.locator(`button:has-text("${navLabel}")`);
    const isDisabled = await button.isDisabled();

    if (isDisabled) {
      console.log(`[E2E] Phase button "${navLabel}" is disabled, may need prerequisites`);
      return false;
    }

    await button.click();
    await this.window.waitForTimeout(500); // Allow animation
    return true;
  }

  /**
   * Check if a phase is accessible
   * @param {string} phase - Phase identifier
   * @returns {Promise<boolean>}
   */
  async isPhaseAccessible(phase) {
    const navLabel = PHASE_NAV_LABELS[phase];
    const button = this.window.locator(`button:has-text("${navLabel}")`);
    return !(await button.isDisabled());
  }

  /**
   * Open settings panel
   */
  async openSettings() {
    await this.click(SELECTORS.settingsButton);
    await this.waitForVisible('[role="dialog"]', TIMEOUTS.SHORT);
  }

  /**
   * Check connection status
   * @returns {Promise<boolean>}
   */
  async isConnected() {
    const status = this.window.locator('.text-stratosort-success:has-text("Connected")');
    return status.isVisible();
  }
}

/**
 * Welcome Page Object
 * Handles Welcome phase interactions
 */
class WelcomePage extends BasePage {
  /**
   * Wait for welcome page to load
   */
  async waitForLoad() {
    // Welcome page should show the StratoSort branding
    await this.waitForVisible('.app-surface', TIMEOUTS.MEDIUM);
  }

  /**
   * Click Get Started to go to Setup
   */
  async clickGetStarted() {
    // Look for any primary action button on welcome
    const getStarted = this.window.locator('button:has-text("Get Started")');
    if (await getStarted.isVisible()) {
      await getStarted.click();
      await this.waitForLoading();
    }
  }

  /**
   * Click Quick Start to skip setup
   */
  async clickQuickStart() {
    const quickStart = this.window.locator('button:has-text("Quick Start")');
    if (await quickStart.isVisible()) {
      await quickStart.click();
      await this.waitForLoading();
    }
  }
}

/**
 * Setup Page Object
 * Handles Smart Folders setup phase
 */
class SetupPage extends BasePage {
  /**
   * Wait for setup page to load
   */
  async waitForLoad() {
    await this.waitForVisible('.app-surface', TIMEOUTS.MEDIUM);
  }

  /**
   * Get count of configured folders
   * @returns {Promise<number>}
   */
  async getFolderCount() {
    const folders = this.window.locator('[data-testid="folder-item"]');
    return folders.count();
  }

  /**
   * Add a new folder
   * @param {Object} folder - Folder configuration
   */
  async addFolder(folder) {
    const addButton = this.window.locator('button:has-text("Add")');
    if (await addButton.isVisible()) {
      await addButton.click();
      await this.waitForVisible('[role="dialog"]', TIMEOUTS.SHORT);

      // Fill folder details if dialog is open
      const nameInput = this.window.locator('input[placeholder*="name"]');
      if (await nameInput.isVisible()) {
        await nameInput.fill(folder.name);
      }

      const saveButton = this.window.locator('button:has-text("Save")');
      if (await saveButton.isVisible()) {
        await saveButton.click();
      }
    }
  }

  /**
   * Continue to next phase
   */
  async continue() {
    const continueButton = this.window.locator('button:has-text("Continue")');
    if ((await continueButton.isVisible()) && !(await continueButton.isDisabled())) {
      await continueButton.click();
      await this.waitForLoading();
    }
  }
}

/**
 * Discover Page Object
 * Handles file discovery and analysis phase
 */
class DiscoverPage extends BasePage {
  /**
   * Wait for discover page to load
   */
  async waitForLoad() {
    await this.waitForVisible('.app-surface', TIMEOUTS.MEDIUM);
  }

  /**
   * Check if drag and drop zone is visible
   * @returns {Promise<boolean>}
   */
  async isDragDropVisible() {
    const zone = this.window.locator('[data-testid="drag-drop-zone"]');
    return zone.isVisible();
  }

  /**
   * Get count of files in the list
   * @returns {Promise<number>}
   */
  async getFileCount() {
    const files = this.window.locator('[data-testid="file-item"]');
    return files.count();
  }

  /**
   * Simulate file selection (since drag-drop is complex in E2E)
   * This triggers the file selection dialog
   */
  async selectFiles() {
    const selectButton = this.window.locator('button:has-text("Select")');
    if (await selectButton.isVisible()) {
      await selectButton.click();
    }
  }

  /**
   * Start analysis of selected files
   */
  async startAnalysis() {
    const analyzeButton = this.window.locator('button:has-text("Analyze")');
    if ((await analyzeButton.isVisible()) && !(await analyzeButton.isDisabled())) {
      await analyzeButton.click();
      await this.waitForLoading();
    }
  }

  /**
   * Wait for analysis to complete
   * @param {number} timeout - Max wait time
   */
  async waitForAnalysisComplete(timeout = TIMEOUTS.LONG) {
    // Wait for progress indicators to disappear
    const progress = this.window.locator('[data-testid="analysis-progress"]');
    await progress.waitFor({ state: 'hidden', timeout }).catch(() => {
      // Progress may already be hidden
    });
  }

  /**
   * Get analysis results count
   * @returns {Promise<number>}
   */
  async getAnalyzedCount() {
    const analyzed = this.window.locator('[data-testid="analyzed-file"]');
    return analyzed.count();
  }
}

/**
 * Organize Page Object
 * Handles file organization phase
 */
class OrganizePage extends BasePage {
  /**
   * Wait for organize page to load
   */
  async waitForLoad() {
    await this.waitForVisible('.app-surface', TIMEOUTS.MEDIUM);
  }

  /**
   * Get count of files ready to organize
   * @returns {Promise<number>}
   */
  async getReadyFileCount() {
    const files = this.window.locator('[data-testid="ready-file"]');
    return files.count();
  }

  /**
   * Approve all organization suggestions
   */
  async approveAll() {
    const approveAllButton = this.window.locator('button:has-text("Approve All")');
    if ((await approveAllButton.isVisible()) && !(await approveAllButton.isDisabled())) {
      await approveAllButton.click();
    }
  }

  /**
   * Start organization
   */
  async organize() {
    const organizeButton = this.window.locator('button:has-text("Organize")');
    if ((await organizeButton.isVisible()) && !(await organizeButton.isDisabled())) {
      await organizeButton.click();
      await this.waitForLoading();
    }
  }

  /**
   * Wait for organization to complete
   * @param {number} timeout - Max wait time
   */
  async waitForOrganizeComplete(timeout = TIMEOUTS.LONG) {
    const progress = this.window.locator('[data-testid="organize-progress"]');
    await progress.waitFor({ state: 'hidden', timeout }).catch(() => {
      // Progress may already be hidden
    });
  }
}

/**
 * Complete Page Object
 * Handles completion phase
 */
class CompletePage extends BasePage {
  /**
   * Wait for complete page to load
   */
  async waitForLoad() {
    await this.waitForVisible('.app-surface', TIMEOUTS.MEDIUM);
  }

  /**
   * Get completion stats
   * @returns {Promise<{organized: number, errors: number}>}
   */
  async getStats() {
    const summary = this.window.locator('[data-testid="completion-summary"]');
    if (await summary.isVisible()) {
      const text = await summary.textContent();
      // Parse stats from summary text
      const organized = parseInt(text.match(/(\d+)\s*organized/i)?.[1] || '0');
      const errors = parseInt(text.match(/(\d+)\s*error/i)?.[1] || '0');
      return { organized, errors };
    }
    return { organized: 0, errors: 0 };
  }

  /**
   * Start over (go back to welcome)
   */
  async startOver() {
    const startOverButton = this.window.locator('button:has-text("Start Over")');
    if (await startOverButton.isVisible()) {
      await startOverButton.click();
      await this.waitForLoading();
    }
  }
}

/**
 * Settings Page Object
 * Handles settings panel interactions
 */
class SettingsPage extends BasePage {
  /**
   * Wait for settings to load
   */
  async waitForLoad() {
    await this.waitForVisible('[role="dialog"]', TIMEOUTS.SHORT);
  }

  /**
   * Close settings panel
   */
  async close() {
    const closeButton = this.window.locator('[aria-label="Close Settings"], [aria-label="Close"]');
    if (await closeButton.isVisible()) {
      await closeButton.click();
    }
    await this.waitForHidden('[role="dialog"]', TIMEOUTS.SHORT);
  }

  /**
   * Get current theme
   * @returns {Promise<string>}
   */
  async getTheme() {
    const themeSelect = this.window.locator('[data-testid="theme-select"]');
    if (await themeSelect.isVisible()) {
      return themeSelect.inputValue();
    }
    return 'light';
  }

  /**
   * Check if Ollama is connected
   * @returns {Promise<boolean>}
   */
  async isOllamaConnected() {
    const status = this.window.locator('.text-stratosort-success:has-text("Connected")');
    return status.isVisible();
  }
}

module.exports = {
  BasePage,
  NavigationPage,
  WelcomePage,
  SetupPage,
  DiscoverPage,
  OrganizePage,
  CompletePage,
  SettingsPage
};
