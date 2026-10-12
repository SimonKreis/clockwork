/**
 * npm run auth
 *
 * Opens a browser, lets a human sign in by hand, and saves the resulting session to a gitignored
 * file that later runs reuse. Only used with SESSION=saved since D19: by default a run signs in in
 * its own window and keeps nothing, and this command is needed only for runs whose browser is
 * hidden, where nobody could sign in.
 *
 * Why it works this way:
 *
 *   - No password ever reaches this tool, this repository or a configuration file. The human types
 *     it into Oracle's own page, exactly as they would any other day.
 *   - Multi factor authentication stops being a risk. Whatever the identity provider asks for,
 *     a person answers it. That was open question Q1, and this closes it.
 *   - A blueprint therefore starts at its first functional action, with no sign in steps to
 *     maintain and no persona credentials to store.
 *
 * The file it writes contains live session cookies. It is exactly as sensitive as the password:
 * gitignored, never copied, never shared. Refreshing it is one command, and the engine tells you
 * when it is time.
 */

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import {
  config,
  assertNotProduction,
  browserLaunchOverrides,
  sessionMode,
  storageStateFile,
  workspaceDir,
} from '../src/config';
import { describeEnsure, ensureWorkspace, WorkspaceMissingError } from '../src/workspace';

const rootDir = path.resolve(__dirname, '..');

/** True while the sign in page is still on screen. Same indicators the interpreter checks. */
async function looksSignedOut(page: import('@playwright/test').Page): Promise<boolean> {
  const url = page.url().toLowerCase();
  if (config.session.signedOutUrlPatterns.some((p) => url.includes(p))) return true;

  for (const selector of config.session.signedOutIndicators) {
    const visible = await page
      .locator(selector)
      .first()
      .isVisible()
      .catch(() => false);
    if (visible) return true;
  }
  return false;
}

async function main(): Promise<void> {
  // The session file belongs in the workspace (D20), so the workspace has to exist first. A missing
  // one stops here rather than being created (D21).
  for (const line of describeEnsure(ensureWorkspace(workspaceDir(rootDir), rootDir))) console.log(line);

  // The guard applies here too. Capturing a production session would be worse than running one
  // test against production, because the file would then be reused by every run afterwards.
  assertNotProduction(config.baseUrl);

  if (sessionMode() !== 'saved') {
    console.log('');
    console.log('  Note: SESSION is not "saved", so runs sign in in their own window and will not');
    console.log('  read the file this command writes. Set SESSION=saved in .env to use it, which is');
    console.log('  only needed for runs with the browser hidden.');
  }

  const target = storageStateFile(rootDir);
  fs.mkdirSync(path.dirname(target), { recursive: true });

  console.log('');
  console.log(`Opening ${config.baseUrl}`);
  console.log('');
  console.log('  Sign in by hand in the window that opens, including any second factor.');
  console.log('  When the application home page is up, come back here and press Enter.');
  console.log('  (If you get there and forget, the session is saved automatically.)');
  console.log('');

  const browser = await chromium.launch({
    headless: false,
    ...browserLaunchOverrides(),
  });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  await page.goto(config.baseUrl, { waitUntil: 'domcontentloaded' });

  await Promise.race([waitForEnter(), waitUntilSignedIn(page)]);

  // Read the state before anything is closed, so a browser the user shut themselves still counts.
  const state = await context.storageState().catch(() => null);
  if (!state || (state.cookies.length === 0 && state.origins.length === 0)) {
    console.error('');
    console.error('Nothing to save: the browser held no cookies and no local storage.');
    console.error('That normally means the sign in never completed. Try again.');
    await browser.close().catch(() => undefined);
    process.exitCode = 1;
    return;
  }

  fs.writeFileSync(target, JSON.stringify(state, null, 2), 'utf8');
  await browser.close().catch(() => undefined);

  console.log('');
  console.log(`Session saved to ${target}`);
  console.log(`  ${state.cookies.length} cookie(s), ${state.origins.length} origin(s).`);
  console.log('');
  console.log('  Every run reuses it from now on. When it expires, the engine says so by name');
  console.log('  and tells you to run this command again. Never copy this file anywhere.');
  console.log('');
}

/** Resolves when the operator presses Enter. */
function waitForEnter(): Promise<void> {
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once('data', () => {
      process.stdin.pause();
      resolve();
    });
  });
}

/**
 * Resolves when the sign in page has been gone for a few consecutive checks.
 *
 * Consecutive, not one, on purpose: an identity provider bounces through several pages and there
 * are moments in between when no password field exists yet the user is not signed in either.
 */
async function waitUntilSignedIn(page: import('@playwright/test').Page): Promise<void> {
  let clean = 0;
  for (;;) {
    if (page.isClosed()) return;
    const out = await looksSignedOut(page).catch(() => true);
    clean = out ? 0 : clean + 1;
    if (clean >= 4) return;
    await page.waitForTimeout(1000).catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  console.error('');
  console.error((error as Error).message);
  // Not a browser problem: the hints below would only mislead.
  if (error instanceof WorkspaceMissingError) {
    process.exitCode = 1;
    return;
  }

  /**
   * Name the browser, because the choice is automatic now and a failure that does not say which
   * one it tried leaves the reader guessing. Having that browser open already is not the cause:
   * each run gets a fresh profile, verified with Brave and Edge on 2026-09-10. An earlier version
   * of this message said otherwise and sent people to close their browser for nothing.
   */
  const chosen = browserLaunchOverrides();
  const which = chosen.executablePath ?? chosen.channel ?? "Playwright's bundled Chromium";
  console.error('');
  console.error(`  Browser: ${which}`);
  console.error('  Clockwork drives Chromium based browsers only: Chrome, Edge, Brave, Vivaldi, Opera.');
  console.error('  To use another one, set BROWSER_EXECUTABLE in .env to its full path, or set');
  console.error("  BROWSER_AUTODETECT=false to fall back to Playwright's bundled Chromium.");

  process.exitCode = 1;
});
