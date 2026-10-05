/**
 * select: the list keyword. The most delicate one on Oracle Fusion.
 *
 * Two things that look identical on screen behave nothing alike, so they are two modes:
 *
 *   mode: lov       (default) a type ahead list of values. Type, wait for the asynchronous
 *                   suggestion list, click the option whose visible text matches.
 *   mode: dropdown  a plain choice list. Open it, click the option. Nothing is typed.
 *                   This is the legacy platform's `select from dropdown`.
 *
 * The legacy platform encodes a list of values as a multi step idiom with no dedicated keyword: type into the
 * field, sleep, then press Enter or Tab, and sometimes click the suggestion afterwards. That idiom
 * is exactly where an automated Fusion test breaks most often, because the suggestion list is
 * asynchronous and the commit behaviour is inconsistent between components.
 *
 * Both modes end with the same check: the field really holds the value afterwards. That check is
 * the part the legacy platform does not do, and it is the reason a converted test is more trustworthy than its
 * original.
 *
 * WARNING: this file is the main tuning point after the first run against a live environment.
 * The option container selectors are a first draft written without seeing a live Redwood page.
 * Expect to adjust config.lov.optionContainers.
 */

import { config } from '../config';
import { resolve } from '../locate';
import { resolveValue } from '../data';
import { xpathLiteral } from '../locate';
import type { StepContext, KeywordResult } from '../context';
import type { SelectStep } from '../types';
import type { Locator } from '@playwright/test';

/** Find the option whose visible text matches, inside any of the known list containers. */
async function findOption(
  ctx: StepContext,
  value: string,
  match: 'exact' | 'contains',
): Promise<Locator | null> {
  for (const container of config.lov.optionContainers) {
    const options = ctx.page.locator(container);
    const count = await options.count().catch(() => 0);
    if (count === 0) continue;

    const max = Math.min(count, 50);
    for (let i = 0; i < max; i++) {
      const option = options.nth(i);
      if (!(await option.isVisible().catch(() => false))) continue;
      const text = ((await option.innerText().catch(() => '')) || '').trim();
      if (!text) continue;

      const hit =
        match === 'exact'
          ? text === value || text.split('\n')[0]?.trim() === value
          : text.toLowerCase().includes(value.toLowerCase());
      if (hit) return option;
    }
  }

  // Last resort inside the list: any visible element that is exactly this text and sits in a popup.
  const byText = ctx.page.locator(
    `xpath=//*[@role="option" or @role="listitem" or self::li or self::td]` +
      `[normalize-space(.)=${xpathLiteral(value)}]`,
  );
  const n = await byText.count().catch(() => 0);
  for (let i = 0; i < Math.min(n, 10); i++) {
    const candidate = byText.nth(i);
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }

  return null;
}

async function waitForOption(
  ctx: StepContext,
  value: string,
  match: 'exact' | 'contains',
  timeoutMs: number,
): Promise<Locator | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const option = await findOption(ctx, value, match);
    if (option) return option;
    if (Date.now() >= deadline) return null;
    await ctx.page.waitForTimeout(config.lov.pollMs);
  }
}

export async function select(ctx: StepContext, step: SelectStep): Promise<KeywordResult> {
  const value = resolveValue(step.value, ctx.profile, ctx.variables);
  const match = step.match ?? 'exact';
  const mode = step.mode ?? 'lov';

  const found = await resolve(ctx.page, {
    label: step.label,
    kind: 'input',
    hints: step.hints,
    timeoutMs: step.timeout_ms,
  });

  const field = found.locator;
  const howCommitted =
    mode === 'dropdown'
      ? await pickFromDropdown(ctx, field, step, value, match)
      : await pickFromLov(ctx, field, step, value, match);

  const result: KeywordResult = {
    valueUsed: `${value} (${howCommitted})`,
    resolutionMethod: found.method,
    resolutionFrame: found.frame,
    ambiguous: found.ambiguous,
  };

  if (step.skip_confirm) {
    result.valueUsed = `${value} (${howCommitted}, unconfirmed)`;
    return result;
  }

  // Confirm the field really holds the value. This is what turns a click through into a test.
  const settled = await confirmFieldValue(field, value, match, config.lov.confirmTimeoutMs);
  if (!settled.ok) {
    throw new Error(
      [
        `Selected "${value}" in "${step.label}", but the field holds "${settled.actual}" afterwards.`,
        ``,
        `  Commit method used: ${howCommitted}`,
        `  This usually means the list had not resolved yet, or the value does not exist in this`,
        `  environment. If this control is a plain choice list rather than a type ahead, add`,
        `  mode: dropdown to the step. Otherwise try commit: click, or check the data profile.`,
        `  Add skip_confirm: true only if the field is genuinely expected to differ.`,
      ].join('\n'),
    );
  }

  return result;
}

/** A type ahead list of values: type, wait for the list, click the option. */
async function pickFromLov(
  ctx: StepContext,
  field: Locator,
  step: SelectStep,
  value: string,
  match: 'exact' | 'contains',
): Promise<string> {
  const commit = step.commit ?? 'auto';

  await field.click();
  await field.fill('');
  // Type rather than fill: Fusion type ahead listens to key events, and fill() sets the value in
  // one go, which often leaves the suggestion list closed.
  await field.pressSequentially(value, { delay: config.lov.typeDelayMs });

  if (commit === 'tab' || commit === 'enter') {
    await field.press(commit === 'tab' ? 'Tab' : 'Enter');
    return commit;
  }

  const option = await waitForOption(ctx, value, match, config.lov.optionTimeoutMs);
  if (option) {
    await option.click();
    return 'option-click';
  }

  if (commit === 'click') {
    throw new Error(
      [
        `The list of values for "${step.label}" never showed an option matching "${value}".`,
        ``,
        `  The step asked for commit: click, so no key press fallback was attempted.`,
        `  Either the value does not exist in this environment, or the option list markup is not`,
        `  covered by config.lov.optionContainers.`,
      ].join('\n'),
    );
  }

  // What the legacy platform does. Kept as a fallback so behaviour is never worse than the original.
  await field.press('Tab');
  return 'tab-fallback';
}

/**
 * A plain choice list: open it and click the option. Nothing is typed, because typing into a
 * choice list either does nothing or jumps to a different entry by first letter.
 *
 * A native <select> is handled by the browser rather than by clicking, which is both faster and
 * immune to the option list rendering somewhere unexpected.
 */
async function pickFromDropdown(
  ctx: StepContext,
  field: Locator,
  step: SelectStep,
  value: string,
  match: 'exact' | 'contains',
): Promise<string> {
  const tag = ((await field.evaluate((el) => el.tagName).catch(() => '')) || '').toLowerCase();

  if (tag === 'select') {
    await field.selectOption({ label: value });
    return 'native-select';
  }

  await field.click();

  const option = await waitForOption(ctx, value, match, config.lov.optionTimeoutMs);
  if (!option) {
    throw new Error(
      [
        `Opened the dropdown "${step.label}" but no option matching "${value}" appeared.`,
        ``,
        `  Either the value does not exist in this environment, or the list markup is not covered`,
        `  by config.lov.optionContainers. If this control is really a type ahead field that has`,
        `  to be typed into, remove mode: dropdown from the step.`,
      ].join('\n'),
    );
  }

  await option.click();
  return 'dropdown-click';
}

async function confirmFieldValue(
  field: Locator,
  value: string,
  match: 'exact' | 'contains',
  timeoutMs: number,
): Promise<{ ok: boolean; actual: string }> {
  const deadline = Date.now() + timeoutMs;
  let actual = '';
  for (;;) {
    const asInput = await field.inputValue().catch(() => null);
    actual = ((asInput ?? (await field.innerText().catch(() => ''))) ?? '').trim();

    const ok =
      match === 'exact'
        ? actual === value
        : actual.toLowerCase().includes(value.toLowerCase());
    // Fusion often normalises what it displays (adds a code, trims a suffix), so a containment
    // check in either direction counts as success even in exact mode.
    const lenient =
      actual.length > 0 &&
      (actual.toLowerCase().includes(value.toLowerCase()) ||
        value.toLowerCase().includes(actual.toLowerCase()));

    if (ok || lenient) return { ok: true, actual };
    if (Date.now() >= deadline) return { ok: false, actual };
    await new Promise((r) => setTimeout(r, 200));
  }
}
