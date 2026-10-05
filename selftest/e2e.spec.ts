/**
 * End to end self test of the interpreter, against the fake Oracle in selftest/fake-oracle.
 *
 * These are the acceptance criteria of the engine, exercised without needing an
 * Oracle environment:
 *   - a blueprint runs green from the first functional action to a closing verify, one screenshot
 *     per step, inside a session restored from a captured storageState
 *   - a deliberately wrong label produces a readable failure naming the label
 *   - an operation Oracle refuses fails the run instead of going green
 *   - an expired session says so, by name, instead of failing as a missing label
 *
 *   npx playwright test --config playwright.selftest.config.ts
 */

import path from 'node:path';
import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { runBlueprint } from '../src/interpreter';
import { loadBlueprint } from '../src/blueprint';
import { readJournal, journalPath } from '../src/journal';
import type { Blueprint } from '../src/types';

declare const __dirname: string;
const rootDir = path.resolve(__dirname, '..');

/**
 * The fixture is a real blueprint file, not an object literal, so the worked example in
 * selftest/blueprints/ is guaranteed to stay valid: if it stops parsing or stops running,
 * this suite goes red.
 */
const FIXTURE = path.join(__dirname, 'blueprints', 'selftest_create_course.yaml');

/** Loads the worked example from disk. A fresh object each time, so tests can mutate it. */
function goodBlueprint(): Blueprint {
  return loadBlueprint(FIXTURE);
}

test.describe('interpreter, end to end', () => {
  test('a blueprint runs green and writes a full journal', async ({ browser }, testInfo) => {
    process.env.BLUEPRINT_RUN_ID = 'selftest-green';
    const file = journalPath('selftest-green');
    if (fs.existsSync(file)) fs.unlinkSync(file);

    await runBlueprint(goodBlueprint(), { browser, testInfo, rootDir });

    const records = readJournal(file);
    expect(records).toHaveLength(13);
    expect(records.every((r) => r.status === 'passed')).toBe(true);

    // Every step carries its evidence.
    expect(records.every((r) => Boolean(r.screenshot_path))).toBe(true);
    expect(records.every((r) => fs.existsSync(r.screenshot_path!))).toBe(true);

    // The capture step really read the value off the page and made it reusable.
    const capture = records.find((r) => r.keyword === 'capture');
    expect(capture?.value_used).toContain('CRS-00042');

    // Two controls that look alike on screen, resolved by two different mechanisms.
    const selects = records.filter((r) => r.keyword === 'select');
    expect(selects[0]?.value_used).toContain('option-click');
    expect(selects[1]?.value_used).toContain('dropdown-click');

    // The step whose element lives in an iframe found it, and the blueprint never said so.
    const inFrame = records.find((r) => r.label === 'Approval Note');
    expect(inFrame?.resolution_frame).toBeTruthy();

    // Nothing was resolved by anything other than a semantic strategy, because nothing else exists.
    const methods = new Set(records.map((r) => r.resolution_method).filter(Boolean));
    expect([...methods].every((m) => ['label', 'role', 'title', 'placeholder', 'adjacent'].includes(m!)))
      .toBe(true);
  });

  test('a wrong label fails with a message naming the label', async ({ browser }, testInfo) => {
    process.env.BLUEPRINT_RUN_ID = 'selftest-wronglabel';
    const blueprint = goodBlueprint();
    blueprint.scenario = 'selftest_wrong_label';
    blueprint.steps![2] = { action: 'fill', label: 'Course Title', value: 'x', timeout_ms: 2500 };

    const error = await runBlueprint(blueprint, { browser, testInfo, rootDir }).catch(
      (e: unknown) => e as Error,
    );

    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain('Course Title');
    expect(message).toContain('Step 3 of 13');
    expect(message).toContain('Labels currently visible on this page that look similar');
    expect(message).toContain('"Title"');
  });

  test('an operation Oracle refuses fails the run instead of going green', async ({
    browser,
  }, testInfo) => {
    process.env.BLUEPRINT_RUN_ID = 'selftest-oracleerror';
    const file = journalPath('selftest-oracleerror');
    if (fs.existsSync(file)) fs.unlinkSync(file);

    // Same scenario, but the mandatory Title is never filled. The fake Oracle lets every click
    // through and only shows an error banner, exactly like the real thing.
    const blueprint = goodBlueprint();
    blueprint.scenario = 'selftest_oracle_error';
    blueprint.steps = blueprint.steps!.filter((s) => (s as { label?: string }).label !== 'Title');

    const error = await runBlueprint(blueprint, { browser, testInfo, rootDir }).catch(
      (e: unknown) => e as Error,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('You must enter a value for Title');
    expect((error as Error).message).toContain('Oracle refused the operation');

    const records = readJournal(file);
    const failed = records.find((r) => r.status === 'failed');
    expect(failed?.oracle_error_text).toContain('You must enter a value for Title');
    expect(failed?.keyword).toBe('click');
    // The steps after the failure are recorded as skipped, not silently missing.
    expect(records.some((r) => r.status === 'skipped')).toBe(true);
  });

  test('an expired session says so, rather than failing as a missing label', async ({
    browser,
  }, testInfo) => {
    process.env.BLUEPRINT_RUN_ID = 'selftest-nosession';
    const previous = process.env.STORAGE_STATE;
    // No captured session at all: the fake Oracle then shows its sign in page, exactly as the
    // real one does the morning after a session quietly expires.
    process.env.STORAGE_STATE = 'selftest/no-such-session.json';

    try {
      const blueprint = goodBlueprint();
      blueprint.scenario = 'selftest_no_session';

      const error = await runBlueprint(blueprint, { browser, testInfo, rootDir }).catch(
        (e: unknown) => e as Error,
      );

      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toContain('Not signed in');
      expect(message).toContain('npm run auth');
      // It must not look like a broken test step: no step ran at all.
      expect(message).not.toContain('Step 1 of');
    } finally {
      if (previous === undefined) delete process.env.STORAGE_STATE;
      else process.env.STORAGE_STATE = previous;
    }
  });
});
