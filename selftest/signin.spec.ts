/**
 * Signing in inside the run's own window (D19), with nobody there.
 *
 * The person is simulated the way assist.spec.ts simulates one: the test does, in the page, what a
 * tester would do. What is proved:
 *   - a run that meets the sign in page waits there instead of failing, however long it takes
 *   - it does not mistake the sign in page for the application while the form is still up
 *   - it notices the sign in finishing by itself, and carries on in the same window
 *   - a hidden run, which nobody could sign into, stops at once and says why, instead of waiting
 *     forever for a person who cannot see the window
 */

import path from 'node:path';
import { expect, test } from '@playwright/test';
import { runBlueprint, SessionError, waitForSignIn } from '../src/interpreter';
import { loadBlueprint } from '../src/blueprint';

declare const __dirname: string;
const rootDir = path.resolve(__dirname, '..');
const FIXTURE = path.join(__dirname, 'blueprints', 'selftest_create_course.yaml');

test('waits on the sign in page, and carries on once the person has signed in', async ({ page }) => {
  // No session at all: the fake Oracle shows its sign in form, as a real pod does in window mode.
  await page.goto(process.env.ORACLE_BASE_URL as string);
  await expect(page.locator('#u')).toBeVisible();

  let finished = false;
  const waiting = waitForSignIn(page, { pollMs: 100, settleChecks: 3 }).then(() => {
    finished = true;
  });

  // Nobody has signed in yet, so the wait must still be going, however long this takes.
  await page.waitForTimeout(800);
  expect(finished).toBe(false);

  // The tester signs in, in that window.
  await page.fill('#u', 'tester');
  await page.fill('#p', 'not-a-real-password');
  await page.getByRole('button', { name: 'Next' }).click();

  await waiting;
  expect(finished).toBe(true);
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
});

test('a hidden run in window mode stops at once and says why, rather than waiting forever', async ({
  browser,
}, testInfo) => {
  const previous = process.env.SESSION;
  process.env.SESSION = 'window';
  try {
    const started = Date.now();
    const error = await runBlueprint(loadBlueprint(FIXTURE), { browser, testInfo, rootDir }).catch(
      (e: unknown) => e as Error,
    );
    expect(error).toBeInstanceOf(SessionError);
    expect((error as Error).message).toContain('the browser is hidden');
    // Well inside any timeout: the point is that it does not wait for a person who cannot see it.
    expect(Date.now() - started).toBeLessThan(30000);
  } finally {
    if (previous === undefined) delete process.env.SESSION;
    else process.env.SESSION = previous;
  }
});
