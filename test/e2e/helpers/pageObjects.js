/**
 * E2E Page Objects
 *
 * Lightweight page objects used by the Playwright E2E specs.
 * This restores the shared API expected by legacy tests while
 * keeping selectors aligned with the current renderer UI.
 */

const { SELECTORS, PHASES } = require('./testFixtures');
const PHASE_POLL_INTERVAL_MS = 100;
const SETTINGS_PANEL_WAIT_MS = 2000;

const PHASE_ARIA_LABEL = {
  [PHASES.WELCOME]: 'Welcome',
  [PHASES.SETUP]: 'Setup',
  [PHASES.DISCOVER]: 'Discover',
  [PHASES.ORGANIZE]: 'Organize',
  [PHASES.COMPLETE]: 'Complete'
};

function normalizePhaseLabel(value) {
  const label = String(value || '')
    .trim()
    .toLowerCase();
  if (!label) return null;
  if (label.includes('welcome')) return PHASES.WELCOME;
  if (label.includes('setup') || label.includes('smart folders') || label.includes('configure')) {
    return PHASES.SETUP;
  }
  if (label.includes('discover')) return PHASES.DISCOVER;
  if (label.includes('organize')) return PHASES.ORGANIZE;
  if (label.includes('complete')) return PHASES.COMPLETE;
  return null;
}

class NavigationPage {
  constructor(page) {
    this.page = page;
  }

  getNavRoot() {
    return this.page.locator(SELECTORS.navBar);
  }

  getPhaseButton(phase) {
    const label = PHASE_ARIA_LABEL[phase] || String(phase || '');
    if (phase === PHASES.SETUP) {
      return this.getNavRoot()
        .locator(
          `${SELECTORS.phaseButton('Setup')}, ${SELECTORS.phaseButton('Smart Folders')}, ${SELECTORS.phaseButton('Configure')}`
        )
        .first();
    }
    return this.getNavRoot().locator(SELECTORS.phaseButton(label)).first();
  }

  async getCurrentPhase() {
    const activeButton = this.getNavRoot().locator('button[aria-current="page"]').first();
    if ((await activeButton.count()) === 0) return null;

    const [ariaLabel, text] = await Promise.all([
      activeButton.getAttribute('aria-label'),
      activeButton.innerText().catch(() => '')
    ]);

    return normalizePhaseLabel(ariaLabel) || normalizePhaseLabel(text);
  }

  async isPhaseAccessible(phase) {
    const button = this.getPhaseButton(phase);
    if ((await button.count()) === 0) return false;
    return !(await button.isDisabled());
  }

  async goToPhase(phase, options = {}) {
    const { timeoutMs = 3000 } = options;
    const current = await this.getCurrentPhase();
    if (current === phase) return true;

    const button = this.getPhaseButton(phase);
    if ((await button.count()) === 0) return false;
    if (await button.isDisabled()) return false;

    await button.click();

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const active = await this.getCurrentPhase();
      if (active === phase) return true;
      await this.page.waitForTimeout(PHASE_POLL_INTERVAL_MS);
    }

    return false;
  }

  async openSettings() {
    const settingsButton = this.page.locator(SELECTORS.settingsButton).first();
    if ((await settingsButton.count()) === 0) return false;
    await settingsButton.click();
    // Prefer deterministic wait for panel visibility, fallback to short settle delay.
    const settingsPanel = this.page.locator(SELECTORS.settingsPanel).first();
    try {
      await settingsPanel.waitFor({ state: 'visible', timeout: SETTINGS_PANEL_WAIT_MS });
    } catch {
      await this.page.waitForTimeout(200);
    }
    return true;
  }

  async isConnected() {
    const indicator = this.page
      .locator(`${SELECTORS.connectionStatus}, [aria-label="AI Engine Ready"]`)
      .first();
    return (await indicator.count()) > 0 && (await indicator.isVisible().catch(() => false));
  }
}

class DiscoverPage {
  constructor(page) {
    this.page = page;
  }

  async getFileCount() {
    const primaryListItems = this.page.locator(
      '[data-testid="file-item"], [data-testid="file-list"] [role="listitem"]'
    );
    const primaryCount = await primaryListItems.count();
    if (primaryCount > 0) return primaryCount;

    const fallbackRows = this.page.locator(
      '[data-testid="analysis-results"] [role="row"], .file-list [role="row"]'
    );
    return fallbackRows.count();
  }
}

module.exports = {
  NavigationPage,
  DiscoverPage
};
