/**
 * Listing and editing data profiles, as text.
 *
 * `data.ts` reads a profile in order to run a blueprint. This module is the other direction: it
 * lists what profiles exist, shows their fields with the comments that explain them, and writes a
 * value back. It exists so the local interface can fill in a profile without the operator opening
 * a YAML file, which was the second half of what the interface is for.
 *
 * Editing happens **as text**, never by parsing and re serialising, for the same reason
 * `repairBlueprintFile` does (trap 11 in AGENTS.md): a data profile is mostly comments. The
 * comments are where "which business unit, and why that one" is recorded, and every YAML library
 * throws them away on the way out. Re serialise once and the first save silently deletes the
 * reasoning behind every value in the file.
 *
 * There are no passwords in a data profile and no field to put one in. See data.ts.
 */

import fs from 'node:fs';
import path from 'node:path';
import { workspaceDir } from './config';

/** The data profile directory, inside the workspace. */
export function dataDir(rootDir: string): string {
  return path.join(workspaceDir(rootDir), 'data');
}

/** Profile names, without the extension, as a blueprint's `data_profile` spells them. */
export function dataProfileNames(rootDir: string): string[] {
  const dir = dataDir(rootDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map((f) => f.replace(/\.ya?ml$/, ''))
    .sort();
}

/**
 * Absolute path of one profile, refusing anything that is not a plain name.
 *
 * The name arrives from an HTTP request, so "../../.env" has to be impossible rather than
 * unlikely. Nothing but letters, digits, underscore and hyphen is a profile name.
 */
export function dataProfileFile(rootDir: string, name: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new Error(`"${name}" is not a data profile name.`);
  }
  const dir = dataDir(rootDir);
  const yaml = path.join(dir, `${name}.yaml`);
  return fs.existsSync(yaml) ? yaml : path.join(dir, `${name}.yml`);
}

export type ProfileField = {
  key: string;
  value: string;
  /** Zero based index of the line the value sits on, which is what a save rewrites. */
  line: number;
  /**
   * The comment block immediately above the field, verbatim and without the leading hashes.
   * This is what tells the operator which value to pick, so the interface shows it beside it.
   */
  comment: string;
  /** True when the value is still a placeholder rather than a real one. */
  needsFilling: boolean;
};

/**
 * A top level `key: value` line, and nothing else.
 *
 * Nested structures are out of scope on purpose: every data profile the converter produces, and
 * every one written by hand so far, is a flat map of scalars, because that is what a `{{name}}`
 * reference can address. A profile that grows a nested block is a signal to look at it by hand,
 * not a case for this editor to guess at.
 */
const FIELD = /^([A-Za-z0-9_][A-Za-z0-9_.-]*):[ \t]*(.*)$/;

/** Text that means "somebody still has to choose this value". */
const PLACEHOLDER = /^(fill\b|todo\b|xxx+$|<.*>$)/i;

export function readProfile(file: string): { fields: ProfileField[]; text: string } {
  if (!fs.existsSync(file)) {
    throw new Error(`Data profile not found: ${file}`);
  }
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  const fields: ProfileField[] = [];

  lines.forEach((line, i) => {
    const m = FIELD.exec(line);
    if (!m) return;
    const key = m[1] as string;
    const value = unquote((m[2] as string).trim());

    // Walk back over the comment block sitting directly above, stopping at the first blank line
    // or field. A separator line of dashes is decoration, not explanation, so it is dropped.
    const comment: string[] = [];
    for (let j = i - 1; j >= 0; j--) {
      const above = (lines[j] ?? '').trim();
      if (!above.startsWith('#')) break;
      const stripped = above.replace(/^#+\s?/, '').replace(/[─\-=_]{4,}/g, '').trim();
      if (stripped) comment.unshift(stripped);
    }

    fields.push({
      key,
      value,
      line: i,
      comment: comment.join(' '),
      needsFilling: PLACEHOLDER.test(value),
    });
  });

  return { fields, text };
}

/**
 * Write new values into a profile, one line each, leaving every other byte alone.
 *
 * Only keys that already exist are written: a data profile's keys are the contract between it and
 * the blueprints that reference it, so inventing one here would produce a value nothing reads.
 * Returns the keys actually changed, which is what the interface reports back.
 */
export function writeProfileValues(file: string, values: Record<string, string>): string[] {
  const { fields } = readProfile(file);
  const original = fs.readFileSync(file, 'utf8');
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  const lines = original.split(/\r?\n/);
  const changed: string[] = [];

  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(values, field.key)) continue;
    const next = values[field.key] ?? '';
    if (next === field.value) continue;
    lines[field.line] = `${field.key}: ${quote(next)}`;
    changed.push(field.key);
  }

  if (changed.length > 0) fs.writeFileSync(file, lines.join(newline), 'utf8');
  return changed;
}

/**
 * Always double quote on the way out.
 *
 * A value chosen in Oracle can contain a colon, a leading digit, the word "yes", or a `{{...}}`
 * reference that YAML reads as a flow mapping. Quoting unconditionally makes every one of those
 * survive, and costs nothing but a pair of characters in a file nobody diffs for style.
 */
function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Undo that quoting for display, so a field shows what the run will use. */
function unquote(value: string): string {
  const m = /^"(.*)"$/.exec(value) ?? /^'(.*)'$/.exec(value);
  if (!m) return value;
  const inner = m[1] as string;
  return value.startsWith('"')
    ? inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    : inner.replace(/''/g, "'");
}
