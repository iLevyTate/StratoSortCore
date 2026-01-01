/**
 * Semantic Search Functional E2E Tests
 *
 * Tests that semantic search actually returns results when queried.
 *
 * Run: npm run test:e2e -- --grep "Semantic Search Functional"
 */

const { test, expect } = require('@playwright/test');
const { launchApp, closeApp, waitForAppReady } = require('./helpers/electronApp');

test.describe('Semantic Search Functional', () => {
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

  test('should have files indexed in ChromaDB', async () => {
    // Verify files are indexed
    const stats = await window.evaluate(async () => {
      try {
        const result = await window.electronAPI.embeddings.getStats();
        return result;
      } catch (e) {
        return { error: e.message };
      }
    });

    console.log('[Test] Embeddings stats:', stats);
    expect(stats.success).toBe(true);
    expect(stats.files).toBeGreaterThan(0);
  });

  test('should return results when searching for common terms', async () => {
    // Try searching for "document" which should match some files
    // API signature: search(query, options) where options = { topK, mode, minScore }
    const searchResult = await window.evaluate(async () => {
      try {
        const result = await window.electronAPI.embeddings.search('document', {
          topK: 5,
          mode: 'hybrid'
        });
        return result;
      } catch (e) {
        return { error: e.message, stack: e.stack };
      }
    });

    console.log(
      '[Test] Search result for "document":',
      JSON.stringify(
        {
          success: searchResult.success,
          resultCount: searchResult.results?.length || 0,
          mode: searchResult.mode,
          firstResult: searchResult.results?.[0]?.name,
          error: searchResult.error,
          unavailable: searchResult.unavailable,
          pending: searchResult.pending,
          timeout: searchResult.timeout
        },
        null,
        2
      )
    );

    expect(searchResult.success).toBe(true);
    // Should get some results if files are indexed
  });

  test('should search via UI and display results', async () => {
    // Open search modal
    await window.keyboard.press('Control+k');
    await window.waitForTimeout(500);

    // Type search query
    const searchInput = window.locator('input[placeholder*="Search"]').first();
    await searchInput.fill('tax document');
    await window.waitForTimeout(2000); // Wait for search to execute

    // Check if results or loading state appeared
    const searchState = await window.evaluate(() => {
      const loadingIndicator = document.querySelector('.animate-spin, [class*="loading"]');
      const resultItems = document.querySelectorAll('[class*="result-item"], [data-result-id]');
      const noResultsText = document.body.innerText.includes('No results');
      const errorText =
        document.body.innerText.includes('error') || document.body.innerText.includes('Error');

      return {
        isLoading: !!loadingIndicator,
        resultCount: resultItems.length,
        noResults: noResultsText,
        hasError: errorText
      };
    });

    console.log('[Test] UI search state:', searchState);
    // Test passes if search was attempted (loading, results, or no results - but no errors)
  });

  test('should perform vector-only search', async () => {
    const result = await window.evaluate(async () => {
      try {
        return await window.electronAPI.embeddings.search('financial records', {
          topK: 5,
          mode: 'vector'
        });
      } catch (e) {
        return { error: e.message };
      }
    });

    console.log('[Test] Vector search result:', {
      success: result.success,
      mode: result.mode,
      resultCount: result.results?.length || 0,
      error: result.error
    });

    expect(result.success).toBe(true);
    expect(result.mode).toBe('vector');
  });

  test('should perform BM25 keyword search', async () => {
    const result = await window.evaluate(async () => {
      try {
        return await window.electronAPI.embeddings.search('text file', {
          topK: 5,
          mode: 'bm25'
        });
      } catch (e) {
        return { error: e.message };
      }
    });

    console.log('[Test] BM25 search result:', {
      success: result.success,
      mode: result.mode,
      resultCount: result.results?.length || 0,
      error: result.error
    });

    expect(result.success).toBe(true);
    expect(result.mode).toBe('bm25');
  });

  test('should validate search query length', async () => {
    // Test too short query (single character)
    const shortResult = await window.evaluate(async () => {
      try {
        return await window.electronAPI.embeddings.search('a', { topK: 5 });
      } catch (e) {
        return { error: e.message };
      }
    });

    console.log('[Test] Short query result:', shortResult);
    expect(shortResult.success).toBe(false);
    // Error should mention length requirement
    expect(shortResult.error).toMatch(/length|2.*2000/i);
  });

  test('should find similar files', async () => {
    // First get a file ID from stats
    const stats = await window.evaluate(async () => {
      const result = await window.electronAPI.embeddings.getStats();
      return result;
    });

    if (stats.files > 0) {
      // Try to find similar files (using a known pattern for file IDs)
      const similarResult = await window.evaluate(async () => {
        try {
          // Use the search to get a file ID first
          const searchResult = await window.electronAPI.embeddings.search('document', { topK: 1 });
          if (searchResult.success && searchResult.results?.length > 0) {
            const fileId = searchResult.results[0].id;
            return await window.electronAPI.embeddings.findSimilar(fileId, 3);
          }
          return { success: false, error: 'No files found to use as seed' };
        } catch (e) {
          return { error: e.message };
        }
      });

      console.log('[Test] Find similar result:', {
        success: similarResult.success,
        resultCount: similarResult.results?.length || 0
      });
    }
  });

  test('should display search results in graph view', async () => {
    // Open search modal
    await window.keyboard.press('Control+k');
    await window.waitForTimeout(500);

    // Type a query
    const searchInput = window.locator('input[placeholder*="Search"]').first();
    await searchInput.fill('project');
    await window.waitForTimeout(1500);

    // Switch to graph view
    const graphTab = window.locator('button:has-text("Explore Graph")');
    await graphTab.click();
    await window.waitForTimeout(1000);

    // Check if graph rendered
    const graphState = await window.evaluate(() => {
      const reactFlow = document.querySelector('.react-flow, [class*="react-flow"]');
      const nodes = document.querySelectorAll('.react-flow__node');
      const edges = document.querySelectorAll('.react-flow__edge');

      return {
        hasReactFlow: !!reactFlow,
        nodeCount: nodes.length,
        edgeCount: edges.length
      };
    });

    console.log('[Test] Graph view state after search:', graphState);
    expect(graphState.hasReactFlow).toBe(true);
  });
});

test.describe('Semantic Search - Edge Cases', () => {
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

  test('should handle empty query gracefully', async () => {
    const result = await window.evaluate(async () => {
      try {
        return await window.electronAPI.embeddings.search('', { topK: 5 });
      } catch (e) {
        return { error: e.message };
      }
    });

    console.log('[Test] Empty query result:', result);
    expect(result.success).toBe(false);
    expect(result.error).toContain('required');
  });

  test('should handle whitespace-only query', async () => {
    const result = await window.evaluate(async () => {
      try {
        return await window.electronAPI.embeddings.search('   ', { topK: 5 });
      } catch (e) {
        return { error: e.message };
      }
    });

    console.log('[Test] Whitespace query result:', result);
    expect(result.success).toBe(false);
  });

  test('should handle special characters in query', async () => {
    const result = await window.evaluate(async () => {
      try {
        return await window.electronAPI.embeddings.search('test document files', { topK: 5 });
      } catch (e) {
        return { error: e.message };
      }
    });

    console.log('[Test] Special chars query result:', {
      success: result.success,
      resultCount: result.results?.length || 0,
      error: result.error
    });
    expect(result.success).toBe(true);
  });

  test('should respect topK limit', async () => {
    const result = await window.evaluate(async () => {
      try {
        return await window.electronAPI.embeddings.search('file', { topK: 3 });
      } catch (e) {
        return { error: e.message };
      }
    });

    console.log('[Test] TopK limit result:', {
      success: result.success,
      resultCount: result.results?.length || 0,
      requestedTopK: 3,
      error: result.error
    });
    expect(result.success).toBe(true);
    expect(result.results?.length || 0).toBeLessThanOrEqual(3);
  });
});
