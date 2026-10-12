/**
 * The run journal: one JSON record per step, appended to a .jsonl file.
 *
 * This is the durable reporting artifact. Playwright's HTML report is for humans looking at a run
 * right now; the journal is what any other report format is generated from later, including the
 * client facing legacy format once it is supplied. The engine never needs to change for a new report.
 */

import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';
import type { JournalRecord } from './types';

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/** One run id per `npm test` invocation, so parallel test files append to the same journal. */
export function currentRunId(): string {
  if (!process.env.BLUEPRINT_RUN_ID) {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    process.env.BLUEPRINT_RUN_ID =
      `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
      `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  }
  return process.env.BLUEPRINT_RUN_ID;
}

export function journalPath(runId: string = currentRunId()): string {
  return path.join(config.reportsDir, `journal-${runId}.jsonl`);
}

export function append(record: JournalRecord): void {
  const file = journalPath(record.run_id);
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8');
}

export function readJournal(file: string): JournalRecord[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as JournalRecord);
}

/** Most recent journal file in the reports directory, for the report generator. */
export function latestJournal(): string | null {
  if (!fs.existsSync(config.reportsDir)) return null;
  const files = fs
    .readdirSync(config.reportsDir)
    .filter((f) => f.startsWith('journal-') && f.endsWith('.jsonl'))
    .sort();
  const last = files[files.length - 1];
  return last ? path.join(config.reportsDir, last) : null;
}
