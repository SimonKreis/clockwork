/**
 * switch_window and close_window.
 *
 * Oracle BPM approval notifications open in a second window. The legacy platform handles this with Selenium window
 * handles (switch to new window, close new window, switch to main window). Playwright models the
 * same thing as a popup page on the browser context, which is both simpler and more reliable
 * because the popup can be awaited rather than polled for.
 */

import type { StepContext, KeywordResult } from '../context';
import type { WindowStep } from '../types';

export async function switchWindow(ctx: StepContext, step: WindowStep): Promise<KeywordResult> {
  const timeout = step.timeout_ms ?? 30000;
  const to = step.to ?? 'new';

  if (to === 'main') {
    ctx.page = ctx.mainPage;
    await ctx.page.bringToFront().catch(() => undefined);
    return { valueUsed: 'main window' };
  }

  // A popup opened by the click of a previous step is already on the context by now.
  const existing = ctx.browserContext.pages().filter((p) => p !== ctx.mainPage && !p.isClosed());
  const popup = existing[existing.length - 1];

  if (popup) {
    ctx.page = popup;
  } else {
    // Nothing yet: wait for one to appear.
    const appeared = await ctx.browserContext
      .waitForEvent('page', { timeout })
      .catch(() => null);
    if (!appeared) {
      throw new Error(
        [
          `Expected a new window to open, but none did within ${timeout} ms.`,
          ``,
          `  Open windows: ${ctx.browserContext.pages().length}`,
          `  The previous step was supposed to open a popup, typically an approval notification.`,
          `  Check the screenshot of the previous step.`,
        ].join('\n'),
      );
    }
    ctx.page = appeared;
  }

  await ctx.page.waitForLoadState('domcontentloaded').catch(() => undefined);
  await ctx.page.bringToFront().catch(() => undefined);
  return { valueUsed: ctx.page.url() };
}

export async function closeWindow(ctx: StepContext): Promise<KeywordResult> {
  if (ctx.page === ctx.mainPage) {
    throw new Error('close_window was asked to close the main window. Use switch_window first.');
  }
  const closed = ctx.page.url();
  await ctx.page.close().catch(() => undefined);
  ctx.page = ctx.mainPage;
  await ctx.page.bringToFront().catch(() => undefined);
  return { valueUsed: `closed ${closed}` };
}
