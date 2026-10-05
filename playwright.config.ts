import path from 'node:path';
import { defineConfig } from '@playwright/test';
// Importing the configuration also loads <workspace>/.env (D20), so HEADLESS and WORKERS below see
// the workspace settings exactly as the engine does.
import { browserLaunchOverrides, config } from './src/config';

/**
 * Which browser binary a run drives, resolved once from BROWSER_CHANNEL or BROWSER_EXECUTABLE.
 *
 * Playwright takes the two through different doors: a channel is a top level `use` option, while
 * an executable path belongs to `launchOptions`. Splitting them here keeps the single decision in
 * src/config.ts, where the reason it exists is written down.
 */
const { channel, executablePath } = browserLaunchOverrides();

// The client report is not a Playwright reporter: `npm run evidence` generates it from the run
// journal (<workspace>/reports/journal-*.jsonl), so the engine never changes for a format.

/**
 * How many scenarios run at once. One by default, which is the safe answer.
 *
 * Raising it is a decision about the test data, not about the machine: two scenarios creating the
 * same object in the same Oracle environment at the same time collide, whatever the engine does.
 * Compose a batch of independent scenarios first, then raise this. Three to five is the realistic
 * ceiling for one person supervising, not twelve.
 */
const workers = Number.parseInt(process.env.WORKERS ?? '1', 10) || 1;

export default defineConfig({
  testDir: './tests',
  workers,
  fullyParallel: workers > 1,
  retries: 0, // A failure is a signal for a human, not something to paper over with a retry.

  /**
   * No per test timeout (C3).
   *
   * A test that pauses for a human will always exceed any limit worth setting, and Playwright's
   * default would kill it after ten minutes. The failure looks like a random flake rather than a
   * missing setting, which is the worst possible way for this to break. Individual actions still
   * have their own timeouts below, so nothing hangs silently.
   */
  timeout: 0,
  expect: { timeout: 15 * 1000 },

  // Playwright's own report and results are run output like any other, so they live in the
  // workspace with the journals and screenshots (D20), never in the application folder.
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(config.reportsDir, 'playwright-html'), open: 'never' }],
  ],

  use: {
    screenshot: 'on',
    trace: 'on',
    video: 'retain-on-failure',
    actionTimeout: 30 * 1000,
    navigationTimeout: 60 * 1000,
    // Assisted mode needs a window the tester can act in, so a run is headed unless told not to.
    headless: process.env.HEADLESS === 'true',

    /**
     * The browser binary, when it is not Playwright's bundled Chromium. Set BROWSER_CHANNEL for a
     * browser Playwright names (msedge, chrome) or BROWSER_EXECUTABLE for one it does not (Brave,
     * Vivaldi, a portable Chromium). Needed on a managed Windows workstation, where the bundled
     * Chromium fails to start headed with "spawn UNKNOWN" while its headless shell runs fine.
     * See src/config.ts for the recorded diagnosis.
     */
    ...(channel ? { channel } : {}),
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },

  outputDir: path.join(config.reportsDir, 'test-results'),
});
