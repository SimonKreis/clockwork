/**
 * fill, click, press_key, refresh, capture, verify, wait_for.
 *
 * These are the straightforward keywords. The delicate one, `select`, lives in its own file.
 */

import { expect } from '@playwright/test';
import { resolve, ResolutionError } from '../locate';
import { resolveValue } from '../data';
import type { StepContext, KeywordResult } from '../context';
import type {
  CaptureStep,
  ClickStep,
  FillStep,
  PressKeyStep,
  RefreshStep,
  VerifyStep,
  WaitForStep,
} from '../types';

export async function fill(ctx: StepContext, step: FillStep): Promise<KeywordResult> {
  const value = resolveValue(step.value, ctx.profile, ctx.variables);

  const found = await resolve(ctx.page, {
    label: step.label,
    kind: 'input',
    hints: step.hints,
    timeoutMs: step.timeout_ms,
  });

  // Playwright's fill() clears the field first, which is why the legacy platform's separate
  // "clear the content of input field" step has no equivalent here.
  await found.locator.fill(value);

  if (step.press_enter) {
    await found.locator.press('Enter');
  }

  return {
    valueUsed: value,
    resolutionMethod: found.method,
    resolutionFrame: found.frame,
    ambiguous: found.ambiguous,
  };
}

export async function click(ctx: StepContext, step: ClickStep): Promise<KeywordResult> {
  const found = await resolve(ctx.page, {
    label: step.label,
    kind: 'control',
    hints: step.hints,
    timeoutMs: step.timeout_ms,
  });

  if (step.double) await found.locator.dblclick();
  else await found.locator.click();

  return {
    valueUsed: step.label,
    resolutionMethod: found.method,
    resolutionFrame: found.frame,
    ambiguous: found.ambiguous,
  };
}

/**
 * press_key: a key press that no other step implies. Replaces the legacy platform's `click on single key` and
 * `press tab key on`, which are two spellings of the same thing.
 *
 * With a label the field is focused first. Without one the key goes to whatever has focus, which
 * is what a bare Escape or PageDown means.
 */
export async function pressKey(ctx: StepContext, step: PressKeyStep): Promise<KeywordResult> {
  const times = Math.max(1, step.times ?? 1);

  if (!step.label) {
    for (let i = 0; i < times; i++) await ctx.page.keyboard.press(step.key);
    return { valueUsed: `${step.key} x${times}` };
  }

  // A key press is aimed at a field far more often than at a button, but "press Enter on Search"
  // is legitimate too, so fall through to the clickable kinds rather than failing.
  let found;
  try {
    found = await resolve(ctx.page, {
      label: step.label,
      kind: 'input',
      hints: step.hints,
      timeoutMs: step.timeout_ms,
    });
  } catch (error) {
    if (!(error instanceof ResolutionError)) throw error;
    found = await resolve(ctx.page, {
      label: step.label,
      kind: 'control',
      hints: step.hints,
      timeoutMs: step.timeout_ms,
    });
  }

  for (let i = 0; i < times; i++) await found.locator.press(step.key);

  return {
    valueUsed: `${step.key} x${times} on "${step.label}"`,
    resolutionMethod: found.method,
    resolutionFrame: found.frame,
    ambiguous: found.ambiguous,
  };
}

/** refresh: reload the page. Present in the legacy corpus, and occasionally the only way forward. */
export async function refresh(ctx: StepContext, step: RefreshStep): Promise<KeywordResult> {
  await ctx.page.reload({
    waitUntil: 'domcontentloaded',
    timeout: step.timeout_ms ?? 60000,
  });
  return { valueUsed: ctx.page.url() };
}

export async function capture(ctx: StepContext, step: CaptureStep): Promise<KeywordResult> {
  const found = await resolve(ctx.page, {
    label: step.label,
    // 'value', not 'text': in Fusion the label and the value are two separate elements, so
    // looking for the label text would capture the label itself.
    kind: 'value',
    hints: step.hints,
    timeoutMs: step.timeout_ms,
  });

  // Read only fields in Fusion are sometimes a span, sometimes a disabled input.
  const asInput = await found.locator.inputValue().catch(() => null);
  const text = asInput ?? (await found.locator.innerText().catch(() => ''));
  const value = (text ?? '').trim();

  if (!value) {
    throw new Error(
      `Captured nothing from "${step.label}". The element was found but it is empty, ` +
        `so "{{${step.as}}}" would be blank in later steps.`,
    );
  }

  ctx.variables[step.as] = value;
  return {
    valueUsed: `${step.as} = "${value}"`,
    resolutionMethod: found.method,
    resolutionFrame: found.frame,
    ambiguous: found.ambiguous,
  };
}

export async function verify(ctx: StepContext, step: VerifyStep): Promise<KeywordResult> {
  // Page level check: is this text anywhere on screen.
  if (step.text_contains) {
    const expected = resolveValue(step.text_contains, ctx.profile, ctx.variables);
    await expect(
      ctx.page.getByText(expected, { exact: false }).first(),
      `Expected the page to show "${expected}".`,
    ).toBeVisible({ timeout: step.timeout_ms ?? 15000 });
    return { valueUsed: expected };
  }

  if (!step.label) {
    throw new Error('A verify step needs either "text_contains" or a "label" with "equals" or "contains".');
  }

  const found = await resolve(ctx.page, {
    label: step.label,
    kind: 'value',
    hints: step.hints,
    timeoutMs: step.timeout_ms,
  });

  const asInput = await found.locator.inputValue().catch(() => null);
  const actual = ((asInput ?? (await found.locator.innerText().catch(() => ''))) ?? '').trim();

  if (step.equals !== undefined) {
    const expected = resolveValue(step.equals, ctx.profile, ctx.variables);
    if (actual !== expected) {
      throw new Error(
        `"${step.label}" should be "${expected}" but it is "${actual}".`,
      );
    }
    return {
      valueUsed: expected,
      resolutionMethod: found.method,
      resolutionFrame: found.frame,
      ambiguous: found.ambiguous,
    };
  }

  if (step.contains !== undefined) {
    const expected = resolveValue(step.contains, ctx.profile, ctx.variables);
    if (!actual.includes(expected)) {
      throw new Error(
        `"${step.label}" should contain "${expected}" but it is "${actual}".`,
      );
    }
    return {
      valueUsed: expected,
      resolutionMethod: found.method,
      resolutionFrame: found.frame,
      ambiguous: found.ambiguous,
    };
  }

  throw new Error(`The verify step on "${step.label}" has no "equals" and no "contains".`);
}

/**
 * wait_for: a semantic wait, for a named state change. This is not the legacy platform's "add wait seconds".
 * Sleeps are gone; Playwright waits for elements automatically. Use this only where the test has
 * to wait for something to appear or disappear that no later step would otherwise wait for,
 * typically after a submit that triggers a background process.
 */
export async function waitFor(ctx: StepContext, step: WaitForStep): Promise<KeywordResult> {
  const timeout = step.timeout_ms ?? 30000;
  const state = step.state ?? 'visible';

  if (step.text) {
    const expected = resolveValue(step.text, ctx.profile, ctx.variables);
    const locator = ctx.page.getByText(expected, { exact: false }).first();
    if (state === 'visible') await locator.waitFor({ state: 'visible', timeout });
    else await locator.waitFor({ state: 'hidden', timeout });
    return { valueUsed: `${state}: "${expected}"` };
  }

  if (step.label) {
    if (state === 'hidden') {
      // Absence cannot use the resolution chain, since there is nothing to resolve.
      const locator = ctx.page.getByText(step.label, { exact: false }).first();
      await locator.waitFor({ state: 'hidden', timeout });
      return { valueUsed: `hidden: "${step.label}"` };
    }
    const found = await resolve(ctx.page, { label: step.label, kind: 'text', timeoutMs: timeout });
    return {
      valueUsed: `visible: "${step.label}"`,
      resolutionMethod: found.method,
      resolutionFrame: found.frame,
    };
  }

  throw new Error('A wait_for step needs either "text" or "label".');
}
