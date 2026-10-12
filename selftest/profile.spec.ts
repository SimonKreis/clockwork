/**
 * Reading and writing a data profile as text.
 *
 * This is what the local interface saves when somebody fills in a value without opening the YAML,
 * and the property that matters is not that the value round trips. It is that **nothing else in
 * the file changes.** A data profile is mostly comments, and those comments are where "which
 * business unit, and why that one" is written down. Parse and re serialise the file once and the
 * first save deletes every one of them, silently, in a file nobody diffs. That is trap 11 in
 * AGENTS.md, arrived at here from the other direction.
 *
 * No Oracle and no browser: these are pure functions over a temporary file.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { readProfile, writeProfileValues } from '../src/profile';

const ORIGINAL = [
  '# A data profile, which is mostly explanation.',
  '#',
  '# The reasoning below is the reason this file is edited as text.',
  '',
  '# ── To fill once, from the environment ───────────────────────',
  '# Ask the functional lead. It has to be the unit that owns the position.',
  'business_unit: "FILL, the business unit"',
  'position: "FILL, a position with the right legal employer"',
  '',
  '# ── Stable ───────────────────────────────────────────────────',
  'worker_type: "Regular"',
  '',
  '# Carries a random suffix so two runs never collide.',
  'requisition_title: "TEST {{random_string(6)}}"',
  '',
].join('\n');

let file: string;

test.beforeEach(() => {
  file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cw-profile-')), 'a_profile.yaml');
  fs.writeFileSync(file, ORIGINAL, 'utf8');
});

test('reads every field with the comment that explains it', () => {
  const { fields } = readProfile(file);
  expect(fields.map((f) => f.key)).toEqual([
    'business_unit',
    'position',
    'worker_type',
    'requisition_title',
  ]);

  const bu = fields[0]!;
  expect(bu.value).toBe('FILL, the business unit');
  // The comment block above the field, which is what the interface shows beside it. The row of
  // box drawing characters is decoration and is dropped; the sentence is not.
  expect(bu.comment).toContain('Ask the functional lead');
  expect(bu.comment).not.toContain('────');
});

test('flags the values somebody still has to choose', () => {
  const { fields } = readProfile(file);
  const todo = fields.filter((f) => f.needsFilling).map((f) => f.key);
  expect(todo).toEqual(['business_unit', 'position']);
});

test('a save rewrites the value line and nothing else', () => {
  const changed = writeProfileValues(file, { business_unit: 'North Operations' });
  expect(changed).toEqual(['business_unit']);

  const after = fs.readFileSync(file, 'utf8');
  expect(after).toContain('business_unit: "North Operations"');

  // Every comment survives, including the one that belonged to the field that changed.
  expect(after).toContain('# A data profile, which is mostly explanation.');
  expect(after).toContain('# Ask the functional lead');
  expect(after).toContain('# ── Stable ');
  expect(after).toContain('# Carries a random suffix');

  // And so does every line that was not asked about, byte for byte.
  const untouched = ORIGINAL.split('\n').filter((l) => !l.startsWith('business_unit:'));
  for (const line of untouched) expect(after.split('\n')).toContain(line);
});

test('a value containing a colon, a quote or a reference survives the round trip', () => {
  const awkward = 'Sales: "EMEA", {{not_a_reference}}';
  writeProfileValues(file, { business_unit: awkward });
  expect(readProfile(file).fields[0]!.value).toBe(awkward);
});

test('an unknown key is ignored rather than invented', () => {
  const changed = writeProfileValues(file, { not_a_field: 'x' });
  expect(changed).toEqual([]);
  // A key nothing references would produce a value no blueprint could ever read, so the file is
  // left exactly as it was rather than growing a line that looks meaningful and is not.
  expect(fs.readFileSync(file, 'utf8')).toBe(ORIGINAL);
});

test('writing the same value again changes nothing', () => {
  expect(writeProfileValues(file, { worker_type: 'Regular' })).toEqual([]);
  expect(fs.readFileSync(file, 'utf8')).toBe(ORIGINAL);
});
