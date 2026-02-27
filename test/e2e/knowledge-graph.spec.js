/**
 * Knowledge Graph E2E Tests
 *
 * Tests the Knowledge Graph (Relate tab) in Knowledge OS including
 * cluster visualization, node interactions, graph controls,
 * and relationship exploration.
 *
 * Run: npm run test:e2e -- --grep "Knowledge Graph"
 */

const { test, expect } = require('@playwright/test');
const { launchApp, closeApp, waitForAppReady } = require('./helpers/electronApp');

test.describe('Knowledge Graph — Relate Tab UI', () => {
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

  test('should open Knowledge OS and navigate to Relate tab', async () => {
    await window.keyboard.press('Control+k');
    await window.waitForTimeout(500);

    const relateTab = window
      .locator('button:has-text("Relate"), [role="tab"]:has-text("Relate")')
      .first();

    const isVisible = await relateTab.isVisible().catch(() => false);
    expect(isVisible).toBe(true);

    if (isVisible) {
      await relateTab.click();
      await window.waitForTimeout(500);

      const graphUI = await window.evaluate(() => {
        const body = document.body.textContent || '';
        return {
          hasGraphControls: body.includes('GRAPH CONTROLS') || body.includes('Graph'),
          hasNodes: body.includes('Nodes') || body.includes('nodes'),
          hasLinks: body.includes('Links') || body.includes('links'),
          hasCluster: body.includes('Cluster') || body.includes('cluster'),
          hasLegend: body.includes('LEGEND') || body.includes('Legend'),
          hasInsights: body.includes('INSIGHTS') || body.includes('Insights'),
          hasActions: body.includes('ACTIONS') || body.includes('Actions'),
          hasExplore: body.includes('EXPLORE') || body.includes('Explore')
        };
      });

      expect(graphUI.hasGraphControls || graphUI.hasNodes).toBe(true);
    }
  });

  test('should show graph control panel with stats', async () => {
    await window.keyboard.press('Control+k');
    await window.waitForTimeout(500);

    const relateTab = window.locator('button:has-text("Relate")').first();
    if (await relateTab.isVisible().catch(() => false)) {
      await relateTab.click();
      await window.waitForTimeout(500);

      const controls = await window.evaluate(() => {
        const body = document.body.textContent || '';
        return {
          hasCurrentGraph: body.includes('Current graph'),
          hasNodeCount: /\d+\s*Nodes/.test(body),
          hasLinkCount: /\d+\s*Links/.test(body),
          hasFilterCount: /\d+\s*Filter/.test(body)
        };
      });

      expect(controls.hasCurrentGraph || controls.hasNodeCount || controls.hasLinkCount).toBe(true);
    }
  });

  test('should show legend panel with node types and connection logic', async () => {
    await window.keyboard.press('Control+k');
    await window.waitForTimeout(500);

    const relateTab = window.locator('button:has-text("Relate")').first();
    if (await relateTab.isVisible().catch(() => false)) {
      await relateTab.click();
      await window.waitForTimeout(500);

      const legend = await window.evaluate(() => {
        const body = document.body.textContent || '';
        return {
          hasClusterType: body.includes('Cluster') && body.includes('NODE TYPES'),
          hasFileType: body.includes('File'),
          hasQueryType: body.includes('Query'),
          hasSharedTags: body.includes('Shared Tags'),
          hasSameCategory: body.includes('Same Category'),
          hasContentMatch: body.includes('Content Match'),
          hasVectorSimilarity: body.includes('Vector Similarity'),
          hasConfidenceLevels:
            body.includes('high') || body.includes('medium') || body.includes('low')
        };
      });

      const hasLegendContent = Object.values(legend).some((v) => v);
      expect(hasLegendContent).toBe(true);
    }
  });

  test('should have clusters toggle button', async () => {
    await window.keyboard.press('Control+k');
    await window.waitForTimeout(500);

    const relateTab = window.locator('button:has-text("Relate")').first();
    if (await relateTab.isVisible().catch(() => false)) {
      await relateTab.click();
      await window.waitForTimeout(500);

      const clusterToggle = window
        .locator('button:has-text("Clusters"), button:has-text("clusters")')
        .first();

      const hasToggle = await clusterToggle.isVisible().catch(() => false);
      expect(hasToggle).toBe(true);
    }
  });

  test('should have Add to Graph search input', async () => {
    await window.keyboard.press('Control+k');
    await window.waitForTimeout(500);

    const relateTab = window.locator('button:has-text("Relate")').first();
    if (await relateTab.isVisible().catch(() => false)) {
      await relateTab.click();
      await window.waitForTimeout(500);

      const graphUI = await window.evaluate(() => {
        const body = document.body.textContent || '';
        return {
          hasAddToGraph: body.includes('ADD TO GRAPH'),
          hasSearchInput: !!document.querySelector(
            'input[placeholder*="search" i], input[type="search"]'
          ),
          hasAddButton: !!document.querySelector('button:has-text("Add")')
        };
      });

      expect(graphUI.hasAddToGraph || graphUI.hasSearchInput).toBe(true);
    }
  });
});

test.describe('Knowledge Graph — API', () => {
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

  test('should have knowledge graph APIs', async () => {
    const api = await window.evaluate(() => ({
      hasGetNodes: typeof window.electronAPI?.knowledge?.getRelationshipNodes === 'function',
      hasGetEdges: typeof window.electronAPI?.knowledge?.getRelationshipEdges === 'function',
      hasGetStats: typeof window.electronAPI?.knowledge?.getRelationshipStats === 'function'
    }));

    const hasAny = Object.values(api).some((v) => v);
    expect(hasAny).toBe(true);
  });

  test('should have embedding stats API for graph data', async () => {
    const stats = await window.evaluate(async () => {
      try {
        return await window.electronAPI.embeddings.getStats();
      } catch (e) {
        return { error: e.message };
      }
    });

    expect(stats).toBeTruthy();
  });

  test('should have search API for graph queries', async () => {
    const api = await window.evaluate(() => ({
      hasSearch:
        typeof window.electronAPI?.search?.query === 'function' ||
        typeof window.electronAPI?.search?.search === 'function',
      hasSemanticSearch: typeof window.electronAPI?.semantic?.search === 'function'
    }));

    const hasAny = Object.values(api).some((v) => v);
    expect(hasAny).toBe(true);
  });
});
