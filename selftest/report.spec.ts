/**
 * The report generator, driven from a synthetic run journal.
 *
 * The journal is the durable artifact (D7) and every report is generated from it, so this suite
 * writes a journal by hand rather than running anything: it is a test of the generator, not of the
 * engine. It exists because the two things a report has to get right are both invisible until
 * somebody opens the file in anger:
 *   - the summary must name what was repaired, which is the change log of what Oracle renamed
 *   - the HTML must be self contained, because a report with linked screenshots loses them the
 *     moment it is emailed, which is exactly what happens to a report meant for a client
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import type { JournalRecord } from '../src/types';

declare const __dirname: string;
const rootDir = path.resolve(__dirname, '..');

let out: string;
let shot: string;

function record(overrides: Partial<JournalRecord>): JournalRecord {
  return {
    run_id: 'unit',
    scenario: 'a_scenario',
    source_ticket: 'PROJ-1',
    step_index: 1,
    keyword: 'click',
    status: 'passed',
    duration_ms: 100,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

test.beforeAll(() => {
  out = fs.mkdtempSync(path.join(os.tmpdir(), 'report-'));

  // A one pixel PNG, so the embedding path has something real to embed.
  shot = path.join(out, 'step.png');
  fs.writeFileSync(
    shot,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    ),
  );

  const records: JournalRecord[] = [
    record({ step_index: 1, keyword: 'navigate', value_used: 'Navigator > Learning' }),
    record({
      step_index: 2,
      keyword: 'fill',
      label: 'Title',
      repaired_from: 'Course Title',
      note: 'repaired: "Course Title" is now "Title"',
      screenshot_path: shot,
    }),
    record({ step_index: 3, keyword: 'click', label: 'Next', ambiguous: true }),
    record({
      step_index: 4,
      keyword: 'fill',
      label: 'Approval Note',
      resolution_frame: 'frame "Approval"',
    }),
    record({
      scenario: 'another_scenario',
      step_index: 1,
      keyword: 'click',
      label: 'Save and Close',
      status: 'failed',
      error_message: 'Oracle refused the operation.',
      oracle_error_text: 'You must enter a value for Title.',
    }),
    record({ scenario: 'another_scenario', step_index: 2, keyword: 'verify', status: 'skipped' }),
  ];

  fs.writeFileSync(
    path.join(out, 'journal-unit.jsonl'),
    `${records.map((r) => JSON.stringify(r)).join('\n')}\n`,
    'utf8',
  );

  execFileSync(
    process.execPath,
    [path.join(rootDir, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(rootDir, 'tools', 'report.ts'), path.join(out, 'journal-unit.jsonl')],
    { cwd: rootDir, stdio: 'pipe', env: { ...process.env, REPORTS_DIR: out } },
  );
});

test.afterAll(() => {
  if (out) fs.rmSync(out, { recursive: true, force: true });
});

const read = (name: string) => fs.readFileSync(path.join(out, name), 'utf8');

test('the summary names what was repaired, and what Oracle refused', () => {
  const md = read('summary-unit.md');

  expect(md).toContain('1 of 2 scenarios passed');

  // The change log of what Oracle renamed, which is the point of running at all.
  expect(md).toContain('Steps repaired during the run');
  expect(md).toContain('| a_scenario | 2 | Course Title | Title |');

  // A label that matched several elements, so the author knows to add a hint.
  expect(md).toContain('Ambiguous labels');
  expect(md).toContain('| a_scenario | 3 | Next |');

  // Oracle's own words, verbatim, because paraphrasing them helps nobody.
  expect(md).toContain('You must enter a value for Title.');
  expect(md).toContain('1 step(s) after this one were skipped');
});

test('the HTML embeds its screenshots, so it survives being emailed', () => {
  const html = read('summary-unit.html');

  expect(html).toContain('data:image/png;base64,');
  // No relative link to a file that would not travel with it.
  expect(html).not.toContain('src="step.png"');
  expect(html).toContain('repaired, was "Course Title"');
  // The frame name arrives already carrying quotes, so this one proves the escaping works.
  expect(html).toContain('frame &quot;Approval&quot;');
});
