/**
 * Generic Oracle error detection.
 *
 * Detection only. The engine notices that Oracle refused the operation, stops, and reports the
 * error verbatim. It never tries to recover: that is a human's job, by design.
 *
 * Why this exists: without it, "passed" only means "the bot reached the last step". Oracle can
 * refuse an operation without blocking the click sequence, producing a green run in which nothing
 * was created. The legacy platform has that blind spot today. Roughly twenty lines close it.
 */

import type { Page } from '@playwright/test';
import { config } from './config';

export type OracleError = {
  text: string;
  /** Which configured indicator matched, useful when tuning the list. */
  indicator: string;
};

function isIgnorable(text: string): boolean {
  const lower = text.toLowerCase();
  return config.errorIgnorePatterns.some((p) => lower.includes(p.toLowerCase()));
}

/**
 * Returns the first genuine Oracle error visible on the page, or null.
 * Deliberately cheap: it runs after every single step, so it must not add noticeable time.
 */
export async function detectOracleError(page: Page): Promise<OracleError | null> {
  for (const indicator of config.errorIndicators) {
    let count = 0;
    try {
      count = await page.locator(indicator).count();
    } catch {
      continue;
    }
    if (count === 0) continue;

    const max = Math.min(count, 5);
    for (let i = 0; i < max; i++) {
      const node = page.locator(indicator).nth(i);
      const visible = await node.isVisible().catch(() => false);
      if (!visible) continue;

      const text = ((await node.innerText().catch(() => '')) || '').trim().replace(/\s+/g, ' ');
      if (!text) continue;
      if (isIgnorable(text)) continue;

      return { text: text.slice(0, 500), indicator };
    }
  }
  return null;
}

export class OracleErrorDetected extends Error {
  readonly oracleText: string;

  constructor(error: OracleError, afterStep: string) {
    super(
      [
        `Oracle refused the operation after the step: ${afterStep}`,
        ``,
        `  Oracle said: ${error.text}`,
        ``,
        `  The run stopped here on purpose. Nothing was retried and nothing was repaired.`,
        `  Check the screenshot attached to this step, fix the data or the environment, and run again.`,
        `  (matched indicator: ${error.indicator})`,
      ].join('\n'),
    );
    this.name = 'OracleErrorDetected';
    this.oracleText = error.text;
  }
}
