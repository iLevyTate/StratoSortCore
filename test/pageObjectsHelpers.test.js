const { NavigationPage, DiscoverPage } = require('./e2e/helpers/pageObjects');
const { SELECTORS, PHASES } = require('./e2e/helpers/testFixtures');

function createLocator(config = {}) {
  const childLocators = config.childLocators || {};
  const locator = {
    locator: jest.fn((selector) => childLocators[selector] || createLocator({ count: 0 })),
    first: jest.fn(() => locator),
    count: jest.fn(async () => config.count ?? 1),
    getAttribute: jest.fn(async (name) =>
      config.attributes ? (config.attributes[name] ?? null) : null
    ),
    innerText: jest.fn(async () => config.text ?? ''),
    isDisabled: jest.fn(async () => Boolean(config.disabled)),
    click: jest.fn(async () => {}),
    waitFor: jest.fn(async () => {})
  };
  return locator;
}

describe('e2e pageObjects helpers', () => {
  test('NavigationPage.getCurrentPhase resolves active phase from aria-label', async () => {
    const activeButton = createLocator({
      count: 1,
      attributes: { 'aria-label': 'Discover' },
      text: 'Discover'
    });
    const navRoot = createLocator({
      childLocators: { 'button[aria-current="page"]': activeButton }
    });
    const page = {
      locator: jest.fn((selector) => {
        if (selector === SELECTORS.navBar) return navRoot;
        return createLocator({ count: 0 });
      }),
      waitForTimeout: jest.fn(async () => {})
    };

    const nav = new NavigationPage(page);
    await expect(nav.getCurrentPhase()).resolves.toBe(PHASES.DISCOVER);
  });

  test('NavigationPage.goToPhase returns false when target button is disabled', async () => {
    const activeButton = createLocator({
      count: 1,
      attributes: { 'aria-label': 'Welcome' },
      text: 'Welcome'
    });
    const disabledTarget = createLocator({ count: 1, disabled: true });
    const navRoot = createLocator({
      childLocators: {
        'button[aria-current="page"]': activeButton,
        'button[aria-label="Setup"]': disabledTarget
      }
    });
    const page = {
      locator: jest.fn((selector) => {
        if (selector === SELECTORS.navBar) return navRoot;
        return createLocator({ count: 0 });
      }),
      waitForTimeout: jest.fn(async () => {})
    };

    const nav = new NavigationPage(page);
    await expect(nav.goToPhase(PHASES.SETUP)).resolves.toBe(false);
    expect(disabledTarget.click).not.toHaveBeenCalled();
  });

  test('NavigationPage.openSettings returns false when settings button is absent', async () => {
    const missingButton = createLocator({ count: 0 });
    const page = {
      locator: jest.fn((selector) => {
        if (selector === SELECTORS.settingsButton) return missingButton;
        return createLocator({ count: 0 });
      }),
      waitForTimeout: jest.fn(async () => {})
    };

    const nav = new NavigationPage(page);
    await expect(nav.openSettings()).resolves.toBe(false);
  });

  test('DiscoverPage.getFileCount uses fallback row selectors when needed', async () => {
    const primaryItems = createLocator({ count: 0 });
    const fallbackRows = createLocator({ count: 4 });
    const page = {
      locator: jest.fn((selector) => {
        if (selector === '[data-testid="file-item"], [data-testid="file-list"] [role="listitem"]') {
          return primaryItems;
        }
        if (selector === '[data-testid="analysis-results"] [role="row"], .file-list [role="row"]') {
          return fallbackRows;
        }
        return createLocator({ count: 0 });
      }),
      waitForTimeout: jest.fn(async () => {})
    };

    const discoverPage = new DiscoverPage(page);
    await expect(discoverPage.getFileCount()).resolves.toBe(4);
  });
});
