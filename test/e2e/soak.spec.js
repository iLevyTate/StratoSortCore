/**
 * Soak Test (10–15 minutes)
 *
 * Opt-in long-running Playwright test that repeatedly exercises:
 * - Settings open/close
 * - Search modal open/type/graph tab/close
 * - Phase navigation
 * - SmartFolderWatcher start/stop/status
 * - Basic API calls (analysisHistory, embeddings stats) to touch IPC surfaces
 *
 * It also samples memory periodically and writes a JSON report to:
 *   test-results/e2e/soak/soak-metrics-*.json
 *
 * Run:
 *   npm run test:soak
 *
 * Notes:
 * - This is intentionally tolerant of missing models/vector DB. It’s focused on stability,
 *   responsiveness, and detecting obvious leak-shaped growth trends.
 */

const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs').promises;

const { launchApp, closeApp, waitForAppReady, dismissModals } = require('./helpers/electronApp');
const { NavigationPage } = require('./helpers/pageObjects');
const { createTempDir, cleanupTempDir, PHASES } = require('./helpers/testFixtures');

function clampNumber(n, fallback = 0) {
  return Number.isFinite(n) ? n : fallback;
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function collectMetrics(app, window) {
  const ts = Date.now();

  const main = await app.evaluate(async () => {
    // process.getProcessMemoryInfo is available in Electron main (Chromium-backed).
    const info = process.getProcessMemoryInfo ? await process.getProcessMemoryInfo() : null;
    const mu = process.memoryUsage ? process.memoryUsage() : null;
    return {
      processMemoryInfo: info,
      memoryUsage: mu
    };
  });

  const renderer = await window.evaluate(() => {
    const perfMem = performance && performance.memory ? performance.memory : null;
    const domNodes = document.getElementsByTagName('*').length;
    const activeElementTag = document.activeElement?.tagName || null;
    return {
      performanceMemory: perfMem
        ? {
            usedJSHeapSize: perfMem.usedJSHeapSize,
            totalJSHeapSize: perfMem.totalJSHeapSize,
            jsHeapSizeLimit: perfMem.jsHeapSizeLimit
          }
        : null,
      domNodes,
      activeElementTag
    };
  });

  return { ts, main, renderer };
}

function summarizeMainPrivateMB(sample) {
  const privKB = sample?.main?.processMemoryInfo?.private;
  // Electron returns KB for process.getProcessMemoryInfo.
  if (!Number.isFinite(privKB)) return null;
  return Math.round((privKB / 1024) * 10) / 10;
}

test.describe('Soak (opt-in)', () => {
  test('should remain responsive and avoid runaway memory growth', async () => {
    test.skip(!process.env.SOAK, 'Set SOAK=1 (use `npm run test:soak`)');

    const soakMinutes = clampNumber(Number(process.env.SOAK_MINUTES ?? 12), 12);
    const durationMs = Math.max(10, soakMinutes) * 60 * 1000;
    const sampleEveryMs = Math.max(
      5000,
      clampNumber(Number(process.env.SOAK_SAMPLE_MS ?? 15000), 15000)
    );
    const warmupMs = Math.max(0, clampNumber(Number(process.env.SOAK_WARMUP_MS ?? 30000), 30000));

    // Soft leak threshold: allow some growth due to caches/JIT, but flag big drift.
    const maxAllowedPrivateGrowthMB = clampNumber(
      Number(process.env.SOAK_MAX_PRIVATE_GROWTH_MB ?? 200),
      200
    );

    test.setTimeout(durationMs + 3 * 60 * 1000); // duration + buffer

    let app;
    let window;
    let nav;
    let tempDir;

    const reportDir = path.join(process.cwd(), 'test-results', 'e2e', 'soak');
    await ensureDir(reportDir);

    const metrics = [];

    try {
      ({ app, window } = await launchApp());
      await waitForAppReady(window);
      await dismissModals(window);
      nav = new NavigationPage(window);

      // Create a dedicated test folder so SmartFolderWatcher can start safely.
      tempDir = await createTempDir('stratosort-e2e-soak-');

      const folderName = `Soak Folder ${Date.now()}`;
      const addFolderResult = await window.evaluate(
        async ({ name, folderPath }) => {
          await window.electronAPI?.smartFolders?.resetToDefaults?.();
          return window.electronAPI?.smartFolders?.add?.({
            name,
            path: folderPath,
            description: 'E2E soak test folder',
            keywords: ['soak', 'e2e']
          });
        },
        { name: folderName, folderPath: tempDir }
      );

      // Not all environments allow writing folders (permissions), so be tolerant.
      // We still want the soak to run UI loops even if watcher start is not possible.
      if (addFolderResult?.success === false) {
        console.warn('[Soak] Could not add smart folder (continuing):', addFolderResult);
      }

      // Warmup to let React settle and any background services initialize.
      if (warmupMs > 0) {
        await window.waitForTimeout(warmupMs);
      }

      const startTs = Date.now();
      let lastSampleAt = 0;
      let iteration = 0;

      while (Date.now() - startTs < durationMs) {
        iteration += 1;

        // Always dismiss any unexpected modal that might appear (dependency prompts, etc).
        await dismissModals(window);

        // 1) Settings open/close
        try {
          await nav.openSettings();
          await window.waitForTimeout(250);
          await window.keyboard.press('Escape');
        } catch {
          // Non-fatal: settings might be blocked by another overlay in some states.
          await window.keyboard.press('Escape').catch(() => {});
        }

        // 2) Search modal (Ctrl+K), type, switch graph tab, close
        try {
          await window.keyboard.press('Control+k');
          await window.waitForTimeout(300);
          const searchInput = window
            .locator(
              'input[type="search"], input[placeholder*="Search"], input[placeholder*="search"]'
            )
            .first();
          if (await searchInput.isVisible().catch(() => false)) {
            await searchInput.fill(iteration % 2 === 0 ? 'document' : 'project');
          }
          const graphTab = window.locator('button:has-text("Explore Graph")').first();
          if (await graphTab.isVisible().catch(() => false)) {
            await graphTab.click({ timeout: 5000 }).catch(() => {});
            // Nudge the graph a bit (zoom/pan) without relying on data being present.
            await window.mouse.wheel(0, 400).catch(() => {});
            await window.mouse.wheel(0, -200).catch(() => {});
          }
          await window.keyboard.press('Escape');
          await window.waitForTimeout(200);
        } catch {
          await window.keyboard.press('Escape').catch(() => {});
        }

        // 3) Phase navigation bounce (keeps React trees mounting/unmounting)
        await nav.goToPhase(PHASES.SETUP).catch(() => false);
        await window.waitForTimeout(250);
        await nav.goToPhase(PHASES.DISCOVER).catch(() => false);
        await window.waitForTimeout(250);

        // 4) Exercise watcher start/stop/status (IPC + main service timers)
        const watcherState = await window
          .evaluate(async () => {
            const api = window.electronAPI?.smartFolders;
            if (!api?.watcherStart || !api?.watcherStop || !api?.watcherStatus) {
              return { available: false };
            }
            try {
              const start = await api.watcherStart();
              const status1 = await api.watcherStatus();
              const stop = await api.watcherStop();
              const status2 = await api.watcherStatus();
              return { available: true, start, status1, stop, status2 };
            } catch (e) {
              return { available: true, error: e?.message || String(e) };
            }
          })
          .catch((e) => ({ available: false, error: e?.message || String(e) }));

        // 5) Touch a couple more IPC surfaces (cheap)
        await window
          .evaluate(async () => {
            const ah = window.electronAPI?.analysisHistory;
            const emb = window.electronAPI?.embeddings;
            const results = {};
            try {
              if (ah?.getStatistics) results.historyStats = await ah.getStatistics();
            } catch (e) {
              results.historyStatsError = e?.message || String(e);
            }
            try {
              if (emb?.getStats) results.embeddingStats = await emb.getStats();
            } catch (e) {
              results.embeddingStatsError = e?.message || String(e);
            }
            return results;
          })
          .catch(() => ({}));

        // Periodic sample
        if (Date.now() - lastSampleAt >= sampleEveryMs) {
          const sample = await collectMetrics(app, window);
          sample.iteration = iteration;
          sample.watcher = watcherState;
          metrics.push(sample);
          lastSampleAt = Date.now();
        }
      }

      // Always capture a final sample
      metrics.push({ ...(await collectMetrics(app, window)), iteration, final: true });

      // Basic assertions: we should have collected enough data to judge trends.
      expect(metrics.length).toBeGreaterThanOrEqual(3);

      // Leak-ish heuristic: compare main-process private memory from first and last usable samples.
      const first = metrics.find((m) => summarizeMainPrivateMB(m) !== null);
      const last = [...metrics].reverse().find((m) => summarizeMainPrivateMB(m) !== null);

      if (first && last) {
        const firstMB = summarizeMainPrivateMB(first);
        const lastMB = summarizeMainPrivateMB(last);
        const growthMB = Math.round((lastMB - firstMB) * 10) / 10;

        console.log('[Soak] Main private memory (MB):', { firstMB, lastMB, growthMB });

        expect(growthMB).toBeLessThanOrEqual(maxAllowedPrivateGrowthMB);
      } else {
        console.warn(
          '[Soak] process.getProcessMemoryInfo.private not available; skipping growth assertion'
        );
      }
    } finally {
      // Write report (best-effort) even if assertions fail.
      try {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const reportPath = path.join(reportDir, `soak-metrics-${stamp}.json`);
        await fs.writeFile(reportPath, JSON.stringify({ metrics }, null, 2), 'utf8');
        console.log('[Soak] Wrote report:', reportPath);
      } catch (e) {
        console.warn('[Soak] Failed to write report:', e?.message || String(e));
      }

      if (app) {
        await closeApp(app);
      }
      if (tempDir) {
        await cleanupTempDir(tempDir);
      }
    }
  });
});
