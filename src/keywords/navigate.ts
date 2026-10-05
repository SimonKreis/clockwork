/**
 * navigate: walks an in application path by clicking visible labels in order.
 *
 * The legacy platform encodes this as a run of click and wait pairs, typically eight steps for
 * Navigator, My Client Groups, Learning, Learning Assignments. Here it is one step, which is both
 * shorter to read and shorter to fix when Oracle renames a menu entry.
 */

import { config, assertNotProduction } from '../config';
import { resolve } from '../locate';
import type { ResolutionMethod } from '../locate';
import type { StepContext, KeywordResult } from '../context';
import type { NavigateStep } from '../types';

export async function navigate(ctx: StepContext, step: NavigateStep): Promise<KeywordResult> {
  if (step.url) {
    const target = step.url.startsWith('http') ? step.url : new URL(step.url, config.baseUrl).toString();
    assertNotProduction(target);
    await ctx.page.goto(target, { waitUntil: 'domcontentloaded' });
    return { valueUsed: target };
  }

  const path = step.path ?? [];
  if (path.length === 0) {
    throw new Error('A navigate step needs either "path" (a list of labels) or "url".');
  }

  let lastMethod: ResolutionMethod | undefined;
  let lastFrame: string | undefined;
  let ambiguous = false;

  for (const label of path) {
    const found = await resolve(ctx.page, {
      label,
      kind: 'control',
      timeoutMs: step.timeout_ms,
    });
    lastMethod = found.method;
    lastFrame = found.frame;
    ambiguous = ambiguous || found.ambiguous;

    await found.locator.click();
    // Fusion menus animate. Playwright's auto waiting covers the next resolve, so no sleep here;
    // this only lets the click settle before the next label is looked for.
    await ctx.page.waitForLoadState('domcontentloaded').catch(() => undefined);
  }

  return {
    valueUsed: path.join(' > '),
    resolutionMethod: lastMethod,
    resolutionFrame: lastFrame,
    ambiguous,
  };
}
