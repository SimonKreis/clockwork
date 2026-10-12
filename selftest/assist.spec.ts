/**
 * Assisted mode, end to end, with nobody there.
 *
 * The tester is simulated: the test finds the paused browser page the way a person would find the
 * window, does the action in it, and clicks Resume. Everything else is the real thing, including
 * the banner, the click listener and the rewrite of the blueprint file.
 *
 * What is being proved:
 *   - a step whose label is wrong pauses the run instead of failing it
 *   - the browser stays open on the failing screen, and the banner lives in that page (C1, C2)
 *   - the engine learns from what the tester clicked
 *   - the blueprint file is updated, comments and all, so the next run does not pause again
 *   - Stop still exists, and produces an ordinary red test
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { runBlueprint } from '../src/interpreter';
import { loadBlueprint } from '../src/blueprint';
import { readJournal, journalPath } from '../src/journal';
import { repairBlueprintFile } from '../src/assist';
import type { Blueprint } from '../src/types';

declare const __dirname: string;
const rootDir = path.resolve(__dirname, '..');
const FIXTURE = path.join(__dirname, 'blueprints', 'selftest_create_course.yaml');

let workDir: string;

test.beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'assist-'));
});

test.afterAll(() => {
  if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
});

/**
 * A copy of the worked example with one label deliberately wrong, in its own file so the run can
 * rewrite it. The copy keeps the comments, which is the point of the surgical rewrite.
 */
function brokenCopy(name: string, from: string, to: string): Blueprint {
  const file = path.join(workDir, `${name}.yaml`);
  const text = fs.readFileSync(FIXTURE, 'utf8').replace(`label: "${from}"`, `label: "${to}"`);
  expect(text).toContain(`label: "${to}"`);
  fs.writeFileSync(file, text, 'utf8');
  const bp = loadBlueprint(file);
  bp.scenario = name;
  return bp;
}

/** Finds the paused window, the way a tester spots the one with a banner on it. */
async function waitForPausedPage(browser: Browser): Promise<Page> {
  const deadline = Date.now() + 30000;
  for (;;) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        const paused = await page
          .evaluate(() => Boolean(document.getElementById('__blueprint_banner')))
          .catch(() => false);
        if (paused) return page;
      }
    }
    if (Date.now() > deadline) throw new Error('No page ever showed the assisted mode banner.');
    await new Promise((r) => setTimeout(r, 200));
  }
}

test.describe('assisted mode', () => {
  test.beforeEach(() => {
    process.env.ASSIST = 'true';
  });

  test.afterEach(() => {
    process.env.ASSIST = 'false';
  });

  test('pauses on the failing screen, learns from the click, and repairs the file', async ({
    browser,
  }, testInfo) => {
    process.env.BLUEPRINT_RUN_ID = 'selftest-assist';
    const file = journalPath('selftest-assist');
    if (fs.existsSync(file)) fs.unlinkSync(file);

    const blueprint = brokenCopy('selftest_assist', 'Title', 'Course Title');
    const run = runBlueprint(blueprint, { browser, testInfo, rootDir });

    const paused = await waitForPausedPage(browser);

    // The banner is in the page, not in a terminal prompt and not in a separate interface (C2).
    const banner = paused.locator('#__blueprint_banner');
    await expect(banner).toContainText('Paused at step 3 of 13');
    await expect(banner).toContainText('Course Title');
    // It offers what is actually on the page, so a tester can often fix it by reading.
    await expect(banner.getByRole('button', { name: 'Title', exact: true })).toBeVisible();

    // The page is still the failing screen, and still usable: the banner must not cover the form.
    await expect(paused.locator('#title')).toBeVisible();

    // What the tester does: click the field they meant, and fill it in.
    await paused.locator('#title').click();
    await paused.locator('#title').fill('Repaired by hand');

    // The click alone is enough for the engine to know what the step should have said.
    await expect(banner).toContainText('You clicked: "Title"');

    await banner.getByRole('button', { name: 'Resume' }).click();
    await run;

    const records = readJournal(file);
    expect(records).toHaveLength(13);
    expect(records.every((r) => r.status === 'passed')).toBe(true);

    const repaired = records[2]!;
    expect(repaired.repaired_from).toBe('Course Title');
    expect(repaired.label).toBe('Title');
    expect(repaired.note).toContain('is now "Title"');

    // The correction is in the file, so the next run does not pause here again.
    const rewritten = fs.readFileSync(blueprint._file!, 'utf8');
    expect(rewritten).toContain('label: "Title"');
    expect(rewritten).not.toContain('Course Title');
    // And the comments that explain the file survived the rewrite.
    expect(rewritten).toContain('# The worked example of the blueprint format');
  });

  test('Stop produces an ordinary failed test', async ({ browser }, testInfo) => {
    process.env.BLUEPRINT_RUN_ID = 'selftest-assist-stop';

    const blueprint = brokenCopy('selftest_assist_stop', 'Syllabus', 'Course Syllabus');
    const run = runBlueprint(blueprint, { browser, testInfo, rootDir }).catch(
      (e: unknown) => e as Error,
    );

    const paused = await waitForPausedPage(browser);
    await paused
      .locator('#__blueprint_banner')
      .getByRole('button', { name: 'Stop this test' })
      .click();

    const error = await run;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('Course Syllabus');
    expect((error as Error).message).toContain('Step 4 of 13');
  });
});

test.describe('repairing the blueprint file', () => {
  test('rewrites the label of the right step and leaves everything else alone', () => {
    const file = path.join(workDir, 'unit.yaml');
    fs.writeFileSync(
      file,
      [
        'scenario: unit',
        'steps:',
        '  - action: navigate',
        '    path: ["Navigator", "Old Menu"]',
        '  # a comment that must survive',
        '  - action: click',
        '    label: "Old Button"',
        '  - action: click',
        '    label: "Old Button"',
        '',
      ].join('\n'),
      'utf8',
    );

    expect(repairBlueprintFile(file, 2, 'Old Button', 'New Button')).toBe(true);
    const after = fs.readFileSync(file, 'utf8');
    expect(after).toContain('    label: "New Button"');
    // The same label on another step is NOT touched: only the step that failed is repaired.
    expect(after.match(/Old Button/g)).toHaveLength(1);
    expect(after).toContain('# a comment that must survive');
  });

  test('repairs an entry inside a navigation path, which has no label of its own', () => {
    const file = path.join(workDir, 'unit-path.yaml');
    fs.writeFileSync(
      file,
      ['scenario: unit', 'steps:', '  - action: navigate', '    path: ["Navigator", "Old Menu"]', ''].join(
        '\n',
      ),
      'utf8',
    );

    expect(repairBlueprintFile(file, 1, 'Old Menu', 'New Menu')).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toContain('path: ["Navigator", "New Menu"]');
  });

  test('says so, rather than guessing, when the step cannot be found', () => {
    const file = path.join(workDir, 'unit-missing.yaml');
    fs.writeFileSync(file, 'scenario: unit\nsteps:\n  - action: refresh\n', 'utf8');
    expect(repairBlueprintFile(file, 9, 'Whatever', 'Something')).toBe(false);
  });
});
