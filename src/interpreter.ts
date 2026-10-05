/**
 * The interpreter: loads a blueprint, opens a session, walks its steps, dispatches each to a
 * keyword handler, screenshots every step, checks for an Oracle error, and writes a journal record.
 *
 * One run is one user session (D12), and since D19 the session belongs to that run alone. There is
 * no login step in any blueprint: the run opens the application, and when the application answers
 * with its sign in page a person signs in, in that same window, and the scenario starts from
 * there. Nothing about the session outlives the window. SESSION=saved restores the earlier model
 * (D13), a session captured once by `npm run auth` and reused, for runs with the browser hidden.
 *
 * Failure policy: a step that cannot resolve never guesses and never retries. What it does is
 * stop and hand over. In assisted mode (the default) it pauses on the failing screen and waits for
 * a human, then continues from what that human did; with ASSIST=false it fails the run there and
 * then. Either way the engine repairs nothing by itself, which is the whole discipline: the value
 * of a failure is the message, so the message gets the care.
 */

import path from 'node:path';
import fs from 'node:fs';
import type { Browser, Page, TestInfo } from '@playwright/test';
import {
  config,
  assertNotProduction,
  assistEnabled,
  sessionMode,
  storageStateFile,
  type SessionMode,
} from './config';
import { describeStep } from './blueprint';
import { ResolutionError } from './locate';
import { pauseForHuman, repairBlueprintFile } from './assist';
import { loadDataProfile } from './data';
import { detectOracleError, OracleErrorDetected } from './errors';
import * as journal from './journal';
import type { StepContext, KeywordResult } from './context';
import type { Blueprint, JournalRecord, Step } from './types';

import { navigate } from './keywords/navigate';
import { fill, click, pressKey, refresh, capture, verify, waitFor } from './keywords/basic';
import { select } from './keywords/select';
import { switchWindow, closeWindow } from './keywords/window';

export type RunOptions = {
  browser: Browser;
  testInfo: TestInfo;
  rootDir: string;
};

/**
 * Raised when a run cannot get inside the application: a hidden window that nobody can sign into,
 * a window closed before the sign in finished, or a saved session that has expired. Recoverable,
 * and the message says how.
 */
export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionError';
  }
}

async function dispatch(ctx: StepContext, step: Step): Promise<KeywordResult | void> {
  switch (step.action) {
    case 'navigate':
      return navigate(ctx, step);
    case 'fill':
      return fill(ctx, step);
    case 'select':
      return select(ctx, step);
    case 'click':
      return click(ctx, step);
    case 'press_key':
      return pressKey(ctx, step);
    case 'refresh':
      return refresh(ctx, step);
    case 'capture':
      return capture(ctx, step);
    case 'verify':
      return verify(ctx, step);
    case 'wait_for':
      return waitFor(ctx, step);
    case 'switch_window':
      return switchWindow(ctx, step);
    case 'close_window':
      return closeWindow(ctx);
    default: {
      const unknown = step as { action: string };
      throw new Error(`No handler for action "${unknown.action}".`);
    }
  }
}

export async function runBlueprint(blueprint: Blueprint, opts: RunOptions): Promise<void> {
  const runId = journal.currentRunId();
  const profile = loadDataProfile(blueprint.data_profile, opts.rootDir);
  const steps: Step[] = blueprint.steps ?? [];
  const mode = sessionMode();

  // Whether a person can see this run. Playwright's own default is hidden, so only an explicit
  // false counts as shown: a window nobody can see must never be waited on.
  const headless = (opts.testInfo.project.use as { headless?: boolean }).headless !== false;

  const variables: Record<string, string> = {};

  const shotDir = path.join(config.reportsDir, 'screenshots', runId, blueprint.scenario);
  fs.mkdirSync(shotDir, { recursive: true });

  const browserContext = await opts.browser.newContext({
    viewport: { width: 1600, height: 1000 },
    ignoreHTTPSErrors: true,
    // Window mode starts from nothing on purpose: no cookies, no storage, a sign in page (D19).
    storageState: mode === 'saved' ? sessionFile(opts.rootDir) : undefined,
  });
  const page = await browserContext.newPage();

  const ctx: StepContext = {
    page,
    mainPage: page,
    browserContext,
    profile,
    variables,
    rootDir: opts.rootDir,
  };

  try {
    await openSession(ctx, opts.rootDir, { mode, headless, scenario: blueprint.scenario });

    for (const [stepIndex, step] of steps.entries()) {
      const label = (step as { label?: string }).label;
      const started = Date.now();

      const record: JournalRecord = {
        run_id: runId,
        scenario: blueprint.scenario,
        source_ticket: blueprint.source,
        step_index: stepIndex + 1,
        keyword: step.action,
        label,
        status: 'passed',
        note: (step as { note?: string }).note,
        duration_ms: 0,
        timestamp: new Date().toISOString(),
      };

      try {
        const result = await dispatch(ctx, step);

        if (result) {
          record.resolution_method = result.resolutionMethod;
          record.resolution_frame = result.resolutionFrame;
          record.ambiguous = result.ambiguous;
          record.value_used = result.valueUsed;
        }

        record.url = ctx.page.url();
        await snap(ctx, opts, shotDir, stepIndex + 1, step, record);

        // Oracle can refuse an operation without blocking the click sequence. Without this check
        // the run would go green while nothing was created.
        const oracleError = await detectOracleError(ctx.page);
        if (oracleError) {
          throw new OracleErrorDetected(oracleError, describeStep(step));
        }

        record.duration_ms = Date.now() - started;
        journal.append(record);
        await watchPause(ctx, headless);
      } catch (error) {
        const err = error as Error;

        // A label that no longer matches anything is the failure this project exists to handle.
        // Everything else (Oracle refusing an operation, a value that did not stick, a popup that
        // never opened) is a real test result and must stay red.
        if (err instanceof ResolutionError && assistEnabled()) {
          const outcome = await pauseForHuman({
            page: ctx.page,
            scenario: blueprint.scenario,
            stepIndex: stepIndex + 1,
            stepCount: steps.length,
            stepDescription: describeStep(step),
            wantedLabel: err.label,
            explanation: err.message,
          });

          if (outcome.action === 'resume') {
            record.status = 'passed';
            record.repaired_from = err.label;
            record.duration_ms = Date.now() - started;
            record.url = ctx.page.url();

            if (outcome.picked) {
              // The blueprint is updated in place, and so is the step object this run is walking,
              // so a label used twice in one scenario is only corrected once.
              (step as { label?: string }).label = outcome.picked;
              record.label = outcome.picked;
              const persisted = blueprint._file
                ? repairBlueprintFile(blueprint._file, stepIndex + 1, err.label, outcome.picked)
                : false;
              record.note = persisted
                ? `repaired: "${err.label}" is now "${outcome.picked}"`
                : `repaired for this run only: "${outcome.picked}" could not be written back into ` +
                  `the blueprint file, so the next run will pause here again`;
              console.log(`RESUMED ${record.note}`);
            } else {
              record.note = 'resumed by hand, no label captured, so nothing was written back';
              console.log(`RESUMED ${record.note}`);
            }

            await snap(ctx, opts, shotDir, stepIndex + 1, step, record);
            journal.append(record);

            // No Oracle error check on a repaired step: a person has just been looking at this
            // screen, and their judgement is better than the banner detector's.
            continue;
          }
        }

        record.status = 'failed';
        record.duration_ms = Date.now() - started;
        record.url = ctx.page.url();
        record.error_message = err.message;
        if (err instanceof OracleErrorDetected) record.oracle_error_text = err.oracleText;

        await snap(ctx, opts, shotDir, stepIndex + 1, step, record, true);
        journal.append(record);

        // Everything after this step in this scenario is skipped, and said to be skipped.
        recordSkipped(runId, blueprint, steps, stepIndex);

        throw new Error(
          [
            `Step ${stepIndex + 1} of ${steps.length} failed: ${describeStep(step)}`,
            '',
            err.message,
          ].join('\n'),
        );
      }
    }
  } finally {
    // Leave the last screen up for a moment, whatever the outcome, so it is seen rather than
    // vanishing mid glance. Nobody is looking at a hidden window, so that one closes at once.
    if (!headless && config.endHoldMs > 0 && !ctx.page.isClosed()) {
      await ctx.page.waitForTimeout(config.endHoldMs).catch(() => undefined);
    }
    await browserContext.close().catch(() => undefined);
  }
}

/** A pause after a step, when a person asked to follow along. See config.watchDelayMs. */
async function watchPause(ctx: StepContext, headless: boolean): Promise<void> {
  if (headless || config.watchDelayMs <= 0) return;
  await ctx.page.waitForTimeout(config.watchDelayMs).catch(() => undefined);
}

/**
 * The captured session, or undefined when there is none. Only read with SESSION=saved.
 *
 * Undefined is legitimate: an environment with no authentication at all, or a first run where the
 * point is to see the sign in page. Playwright treats undefined as "start with an empty context".
 */
function sessionFile(rootDir: string): string | undefined {
  const file = storageStateFile(rootDir);
  return fs.existsSync(file) ? file : undefined;
}

/**
 * Open the application and get inside it.
 *
 * In window mode, the default since D19, meeting the sign in page is the normal case: the run
 * waits there for a person, in the window they are already looking at, and carries on once they
 * are in. A hidden window cannot be signed into, so that case stops at once and says why, rather
 * than waiting for somebody who cannot see it.
 *
 * In saved mode the sign in page means the captured session has expired. Without saying so by
 * name, that shows up as a resolution failure on step 1 against a login form, which reads as
 * "Oracle renamed something" and sends the tester looking in exactly the wrong place.
 */
async function openSession(
  ctx: StepContext,
  rootDir: string,
  run: { mode: SessionMode; headless: boolean; scenario: string },
): Promise<void> {
  assertNotProduction(config.baseUrl);
  await ctx.page.goto(config.baseUrl, { waitUntil: 'domcontentloaded' });

  const signedOut = await looksSignedOut(ctx.page);
  if (!signedOut) return;

  if (run.mode === 'window' && !run.headless) {
    console.log(`WAITING FOR SIGN IN  ${run.scenario}`);
    console.log('        Sign in in the browser window, second factor included. The scenario');
    console.log('        starts by itself once you are in, and nothing about the session is kept.');
    await waitForSignIn(ctx.page);
    console.log(`SIGNED IN  starting ${run.scenario}`);
    // Every scenario starts from the same place, whatever page the identity provider landed on.
    await ctx.page.goto(config.baseUrl, { waitUntil: 'domcontentloaded' });
    return;
  }

  if (run.mode === 'window') {
    throw new SessionError(
      [
        `Not signed in, and this run cannot ask you to: the browser is hidden.`,
        ``,
        `  Page : ${ctx.page.url()}`,
        ``,
        `  Each run signs in at its start, in its own window, and keeps nothing afterwards. A`,
        `  hidden window has nobody to type into it. Two ways out:`,
        ``,
        `    show the browser: leave HEADLESS unset, or untick "hide the browser" in the interface`,
        `    or set SESSION=saved in .env and capture a session once with: npm run auth`,
      ].join('\n'),
    );
  }

  const file = storageStateFile(rootDir);
  throw new SessionError(
    [
      `Not signed in: the application is showing its sign in page.`,
      ``,
      `  Page          : ${ctx.page.url()}`,
      `  Session file  : ${fs.existsSync(file) ? `${file} (present, and no longer valid)` : `${file} (missing)`}`,
      ``,
      `  SESSION=saved reuses a session captured to that file. Run this once, sign in by hand in`,
      `  the window that opens, and every blueprint will reuse that session until it expires:`,
      ``,
      `    npm run auth`,
    ].join('\n'),
  );
}

/**
 * Wait, in the run's own window, for a person to finish signing in (D19).
 *
 * No timeout, like an assisted pause (C3): a person answering a second factor takes as long as
 * it takes. It returns once the window has shown the application, rather than a sign in page, for
 * several checks in a row. Several, not one: an identity provider bounces through pages, and there
 * are moments between two of them when no sign in form exists yet nobody is signed in. The
 * address bar settles most of those, since every bounce passes through the provider's own host.
 */
export async function waitForSignIn(
  page: Page,
  opts: { pollMs?: number; settleChecks?: number } = {},
): Promise<void> {
  const pollMs = opts.pollMs ?? 1000;
  const settleChecks = opts.settleChecks ?? 3;
  let clean = 0;
  for (;;) {
    if (page.isClosed()) {
      throw new SessionError(
        'The browser window was closed before the sign in finished, so the scenario did not start.',
      );
    }
    clean = (await signedOutNow(page)) ? 0 : clean + 1;
    if (clean >= settleChecks) return;
    await page.waitForTimeout(pollMs).catch(() => undefined);
  }
}

/** True when this URL belongs to a sign in flow rather than to the application. */
export function isSignedOutUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return config.session.signedOutUrlPatterns.some((p) => lower.includes(p));
}

/** Whether the page is showing a sign in flow right now, without waiting for anything. */
async function signedOutNow(page: Page): Promise<boolean> {
  // The address bar answers first, and answers better. A redirect to an identity provider is the
  // whole event, and no markup has to be recognised for it to be certain.
  if (isSignedOutUrl(page.url())) return true;
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

async function looksSignedOut(page: Page): Promise<boolean> {
  // The document first, then a short look. A sign in form exists as soon as its page loads.
  await page.waitForLoadState('load', { timeout: 30000 }).catch(() => undefined);

  const deadline = Date.now() + config.session.checkTimeoutMs;
  for (;;) {
    if (await signedOutNow(page)) return true;
    if (Date.now() >= deadline) return false;
    await page.waitForTimeout(250);
  }
}

/** Screenshot the current page and attach it to the Playwright report. */
async function snap(
  ctx: StepContext,
  opts: RunOptions,
  shotDir: string,
  index: number,
  step: Step,
  record: JournalRecord,
  isFailure = false,
): Promise<void> {
  if (!config.screenshotEveryStep && !isFailure) return;

  const name = `${String(index).padStart(3, '0')}-${step.action}${isFailure ? '-FAILED' : ''}.png`;
  const file = path.join(shotDir, name);

  try {
    await ctx.page.screenshot({ path: file, fullPage: false });
    record.screenshot_path = file;
    await opts.testInfo.attach(`${index}. ${describeStep(step)}`, {
      path: file,
      contentType: 'image/png',
    });
  } catch {
    // A screenshot failure must never be the reason a test fails.
  }
}

/** Write skipped records for the remainder of the scenario, so the report shows what never ran. */
function recordSkipped(
  runId: string,
  blueprint: Blueprint,
  steps: Step[],
  fromStep: number,
): void {
  for (let i = fromStep + 1; i < steps.length; i++) {
    const step = steps[i];
    if (!step) continue;
    journal.append({
      run_id: runId,
      scenario: blueprint.scenario,
      source_ticket: blueprint.source,
      step_index: i + 1,
      keyword: step.action,
      label: (step as { label?: string }).label,
      status: 'skipped',
      duration_ms: 0,
      timestamp: new Date().toISOString(),
    });
  }
}
