/**
 * Tests the legacy converter against the synthetic export in selftest/sample-legacy-export/.
 *
 * The converter's judgement calls are the part most likely to silently misfire on a new export:
 * dropping a sign in block and starting a new part, collapsing a navigation run, deciding that Tab
 * means a list of values and Enter means a search, and refusing to translate what it cannot.
 * They are asserted here rather than eyeballed.
 *
 * No client material is involved: the fixture is invented.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { loadBlueprint } from '../src/blueprint';
import type { Step } from '../src/types';

declare const __dirname: string;
const rootDir = path.resolve(__dirname, '..');
const fixture = path.join(rootDir, 'selftest', 'sample-legacy-export');

let out: string;

/**
 * Runs the converter as a real subprocess, the way a person would.
 *
 * `node` runs the TypeScript directly: the converter deliberately imports nothing but node builtins,
 * so it needs no loader. Note the absence of `shell: true`, which would break on a repository path
 * containing a space.
 */
function runConverter(dest: string): void {
  execFileSync(process.execPath, [path.join(rootDir, 'tools', 'convert-legacy.ts'), fixture, dest], {
    cwd: rootDir,
    stdio: 'pipe',
  });
}

test.beforeAll(() => {
  out = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-convert-'));
  runConverter(out);
});

test.afterAll(() => {
  if (out) fs.rmSync(out, { recursive: true, force: true });
});

const read = (rel: string) => fs.readFileSync(path.join(out, rel), 'utf8');
const steps = (rel: string): Step[] => loadBlueprint(path.join(out, rel)).steps!;
const labelOf = (s: Step): string | undefined => (s as { label?: string }).label;

test('produces one blueprint per part, and quarantines the disabled scenario', () => {
  const active = fs.readdirSync(path.join(out, 'blueprints')).filter((f) => f.endsWith('.yaml'));
  expect(active.sort()).toEqual([
    'create_a_course.yaml',
    // A second sign in that no navigate announced still splits the scenario.
    'reassign_after_a_window_switch_1.yaml',
    'reassign_after_a_window_switch_2.yaml',
    'run_depreciation.yaml',
    // One legacy scenario, two people, two tests.
    'search_and_approve_1.yaml',
    'search_and_approve_2.yaml',
  ]);

  // A scenario commented out in the legacy platform exports no locators, so it must not be runnable as is.
  const disabled = fs.readdirSync(path.join(out, 'blueprints', 'disabled'));
  expect(disabled).toEqual(['disabled_in_legacy.yaml']);
  expect(read('blueprints/disabled/disabled_in_legacy.yaml')).toContain('DISABLED in the legacy export');
});

test('every emitted blueprint is valid against the schema', () => {
  for (const f of fs.readdirSync(path.join(out, 'blueprints')).filter((f) => f.endsWith('.yaml'))) {
    expect(() => loadBlueprint(path.join(out, 'blueprints', f))).not.toThrow();
  }
});

/**
 * A sign in that no `navigate` announced.
 *
 * The original rule keyed on `navigate`, because that is how a scenario opens. It is not how a
 * scenario signs in a second time: the legacy platform switches window, or signs out onto the login page, and the
 * next thing is simply a user name and a password. Found in a real finance corpus on 2026-09-09,
 * where twelve blueprints came out carrying a sign in and a {{Password}} reference, in a design
 * where a blueprint never has a sign in (D13) and a data profile has nowhere to put a credential.
 */
test('a sign in with no navigate before it is still dropped, and still splits the scenario', () => {
  const first = read('blueprints/reassign_after_a_window_switch_1.yaml');
  const second = read('blueprints/reassign_after_a_window_switch_2.yaml');

  // The credential never reaches either file, in any form.
  for (const part of [first, second]) {
    expect(part).not.toContain('Password');
    expect(part).not.toContain('UserId');
    expect(part).not.toContain('Sign In');
  }

  // The split falls where the person changed: the specialist's work is in part one, the
  // approver's in part two, and neither part carries the other's.
  const one = steps('blueprints/reassign_after_a_window_switch_1.yaml').map(labelOf);
  const two = steps('blueprints/reassign_after_a_window_switch_2.yaml').map(labelOf);
  expect(one).toContain('Adjust Asset');
  expect(one).not.toContain('Approve Button');
  expect(two).toContain('Approve Button');
  expect(two).not.toContain('Adjust Asset');
});

test('drops the sign in block and collapses the navigation run', () => {
  const course = steps('blueprints/create_a_course.yaml');

  // navigate + 2 fills + click SignIn produce nothing at all: signing in is infrastructure.
  expect(course.map((s) => s.action)).not.toContain('login');
  expect(read('blueprints/create_a_course.yaml')).not.toContain('Password');

  // Four clicks and their sleeps become one path. The screenshot in the source ends the run,
  // which is why the "Create" click that follows is NOT swallowed into it.
  expect(course[0]).toMatchObject({
    action: 'navigate',
    path: ['Navigator', 'My Client Groups', 'Learning', 'Courses'],
  });
  expect(course[1]).toMatchObject({ action: 'click', label: 'Create' });

  // 34 source steps, most of them sleeps and screenshots, become 7.
  expect(course).toHaveLength(7);
});

test('a step commented out in the export does not become a step', () => {
  // Its author switched it off. Converting it would put back something a human removed.
  expect(read('blueprints/create_a_course.yaml')).not.toContain('switched off by its author');
  expect(read('reports/conversion-report.md')).toContain('commented out in the export');
});

test('Tab becomes a list of values, Enter becomes a search', () => {
  const course = steps('blueprints/create_a_course.yaml');
  expect(course.find((s) => labelOf(s) === 'Category')).toMatchObject({
    action: 'select',
    match: 'exact',
  });

  const search = steps('blueprints/search_and_approve_1.yaml').find((s) => s.action === 'fill');
  expect(search).toMatchObject({ action: 'fill', press_enter: true });
});

test('a label read off the XPath is used as is, a missing one is guessed and marked', () => {
  const raw = read('blueprints/create_a_course.yaml');
  const course = steps('blueprints/create_a_course.yaml');

  // Label present verbatim in the source XPath.
  expect(course.some((s) => labelOf(s) === 'Save and Close')).toBe(true);

  // Bound to a generated Oracle id: the label is guessed from the object name and flagged in a
  // comment. No selector is carried over, because there is no field to carry one in.
  expect(course.some((s) => labelOf(s) === 'Title')).toBe(true);
  expect(raw).toContain('# INFERRED label');
  expect(raw).not.toContain('ttlInp');
  expect(raw).not.toContain('xpath');
});

test('a long single word label is not mistaken for a generated id', () => {
  // Regression: "Notifications" is 13 characters with no space, and was being rejected as if it
  // were an id fragment. Length is not a valid signal; id separators are.
  const raw = read('blueprints/search_and_approve_2.yaml');
  const notif = raw.slice(0, raw.indexOf('label: "Notifications"'));
  expect(notif.trimEnd().endsWith('- action: click')).toBe(true);
});

test('a persona switch becomes separate tests, and popup handling survives it', () => {
  const first = steps('blueprints/search_and_approve_1.yaml');
  const second = steps('blueprints/search_and_approve_2.yaml');

  // Nothing signs in, nothing signs out: the boundary is the file boundary.
  const all = [...first, ...second].map((s) => s.action);
  expect(all).not.toContain('login');
  expect([...first, ...second].map(labelOf)).not.toContain('Sign_out');

  expect(second.map((s) => s.action)).toContain('switch_window');
  expect(second.map((s) => s.action)).toContain('close_window');

  expect(read('blueprints/search_and_approve_1.yaml')).toContain('Part 1 of 2');
  expect(read('reports/conversion-report.md')).toContain('Run them in order');
});

test('translates the verbs the newer exports revealed', () => {
  const dep = steps('blueprints/run_depreciation.yaml');

  // Two list keywords that look alike on screen and behave nothing alike.
  expect(dep.find((s) => labelOf(s) === 'Book Type')).toMatchObject({
    action: 'select',
    mode: 'dropdown',
  });
  expect(dep.find((s) => labelOf(s) === 'Asset Category')).toMatchObject({ action: 'select' });
  expect(dep.find((s) => labelOf(s) === 'Asset Category')).not.toMatchObject({ mode: 'dropdown' });

  expect(dep.find((s) => labelOf(s) === 'Asset Row')).toMatchObject({
    action: 'click',
    double: true,
  });
  expect(dep).toContainEqual({ action: 'press_key', key: 'Enter' });
  expect(dep).toContainEqual({ action: 'refresh' });
});

test('translates the assertions, which the first corpus wrongly suggested did not exist', () => {
  const dep = steps('blueprints/run_depreciation.yaml');

  expect(dep.find((s) => labelOf(s) === 'Process Row Status')).toMatchObject({
    action: 'verify',
    contains: 'Succeeded',
  });
  expect(dep.find((s) => labelOf(s) === 'Period Accrual')).toMatchObject({
    action: 'verify',
    equals: '{{periodAccrual}}',
  });
  // "should be present" is a wait for a named state, which fails the run when it never arrives.
  expect(dep.find((s) => labelOf(s) === 'Depreciation Success')).toMatchObject({
    action: 'wait_for',
    state: 'visible',
  });
});

test('drops the frame switch, because frames are searched automatically', () => {
  const raw = read('blueprints/run_depreciation.yaml');
  expect(raw).not.toContain('iframe');
  expect(read('reports/conversion-report.md')).toContain('Frames are searched automatically');
});

test('refuses to invent a translation, and leaves the evidence in the file', () => {
  const raw = read('blueprints/run_depreciation.yaml');

  // A conditional block: the whole block is commented out, not just the condition. Emitting the
  // enclosed steps unconditionally would fail every run where the element is absent.
  expect(raw).toContain('NOT CONVERTED, conditional block');
  expect(raw).toContain('And I click on "[ClearFilter]" link');
  expect(steps('blueprints/run_depreciation.yaml').map(labelOf)).not.toContain('Clear Filter');

  // Image recognition and file download are out of scope, and say so where a reader will look.
  expect(raw).toContain('clicking by image recognition is not supported');
  expect(raw).toContain('downloading a file is not supported');

  // A verb with no rule at all used to vanish silently, which is the worst outcome: a blueprint
  // that looks complete and is short by one action.
  expect(raw).toContain('NOT CONVERTED, unrecognised step: And I hover over');
  expect(read('reports/conversion-report.md')).toContain('no conversion rule for');
});

test('does not translate custom code, and says so in the file', () => {
  const raw = read('blueprints/search_and_approve_1.yaml');
  expect(raw).toContain('# NOT CONVERTED');
  expect(raw).toContain('GenerateRandomString');
  expect(raw).toContain('{{random_string(6)}}');
});

test('strips every password column out of the data profile', () => {
  const profile = read('data/demo_suite_default.yaml');
  expect(profile).toContain('UserIdSpecialist: "demo.specialist"');
  expect(profile).not.toContain('NotARealPassword');
  expect(profile).toContain('# Password: removed');
  expect(profile).toContain('sign in by hand');
});

test('writes its report outside the documentation tree', () => {
  // reports/ is in the workspace, outside the repository. The report quotes the source export, so
  // running the converter on client material must never dirty a versioned file.
  expect(fs.existsSync(path.join(out, 'reports', 'conversion-report.md'))).toBe(true);
  expect(read('reports/conversion-report.md')).toContain('Things a human should look at');
});

test('refuses to overwrite a reviewed blueprint without --force', () => {
  const target = path.join(out, 'blueprints', 'create_a_course.yaml');
  fs.writeFileSync(target, '# hand reviewed, must survive a re-run\nscenario: x\nsteps: []\n');

  runConverter(out);

  expect(fs.readFileSync(target, 'utf8')).toContain('hand reviewed, must survive');
});
