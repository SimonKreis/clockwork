/**
 * Data profiles and value resolution.
 *
 * A blueprint value can be a literal, a data profile reference "{{name}}", or a generator call
 * such as "{{random_string(6)}}". Generators replace the legacy platform's external custom code hook: the one
 * function observed in the export, GenerateRandomString, becomes a built in.
 *
 * There are no passwords here and no credential handling at all: the session is captured once,
 * out of band, by npm run auth.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { workspaceDir } from './config';

export type DataProfile = Record<string, string>;

const REFERENCE = /\{\{\s*([^}]+?)\s*\}\}/g;

export function loadDataProfile(name: string | undefined, rootDir: string): DataProfile {
  if (!name) return {};
  const file = path.join(workspaceDir(rootDir), 'data', `${name}.yaml`);
  if (!fs.existsSync(file)) {
    throw new Error(
      `Data profile "${name}" not found at ${file}.\n` +
        `  Data profiles live in the workspace, outside this repository, because they contain\n` +
        `  usernames and environment specific values. Create it in the data/ folder shown\n` +
        `  above, or remove "data_profile" from the blueprint.`,
    );
  }
  const raw = parseYaml(fs.readFileSync(file, 'utf8')) as Record<string, unknown> | null;
  const out: DataProfile = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    out[k] = v === null || v === undefined ? '' : String(v);
  }
  return out;
}

/** Values captured during the run, by a `capture` step. Same namespace as the data profile. */
export type Variables = Record<string, string>;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Built in generators. Keep this list short: every generator is a small piece of hidden behaviour
 * that makes a blueprint less literal, which is the opposite of the point.
 */
function callGenerator(name: string, args: string[]): string | null {
  const now = new Date();

  switch (name) {
    case 'random_string': {
      const length = Number.parseInt(args[0] ?? '6', 10) || 6;
      const alphabet = 'abcdefghijklmnopqrstuvwxyz';
      let s = '';
      for (let i = 0; i < length; i++) {
        s += alphabet[Math.floor(Math.random() * alphabet.length)];
      }
      return s;
    }
    case 'random_number': {
      const digits = Number.parseInt(args[0] ?? '4', 10) || 4;
      const max = 10 ** digits;
      return String(Math.floor(Math.random() * max)).padStart(digits, '0');
    }
    case 'today': {
      const offset = Number.parseInt(args[0] ?? '0', 10) || 0;
      const d = new Date(now);
      d.setDate(d.getDate() + offset);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }
    case 'today_us': {
      const offset = Number.parseInt(args[0] ?? '0', 10) || 0;
      const d = new Date(now);
      d.setDate(d.getDate() + offset);
      return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${String(d.getFullYear()).slice(-2)}`;
    }
    case 'timestamp':
      return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    default:
      return null;
  }
}

/**
 * Replace every {{...}} in a value. Resolution order: captured variables, then data profile,
 * then generators. An unresolvable reference is a hard error, never a silent empty string:
 * a test that types "undefined" into Oracle is worse than a test that refuses to start.
 */
export function resolveValue(
  raw: string | undefined,
  profile: DataProfile,
  variables: Variables,
): string {
  if (raw === undefined || raw === null) return '';
  const input = String(raw);

  return input.replace(REFERENCE, (_match, expression: string) => {
    const expr = expression.trim();

    const call = /^([a-z_]+)\s*\(\s*(.*?)\s*\)$/i.exec(expr);
    if (call) {
      const fn = (call[1] ?? '').toLowerCase();
      const argsRaw = call[2] ?? '';
      const args = argsRaw ? argsRaw.split(',').map((a) => a.trim().replace(/^["']|["']$/g, '')) : [];
      const generated = callGenerator(fn, args);
      if (generated !== null) return generated;
      throw new Error(`Unknown generator "${fn}" in value "${input}".`);
    }

    if (expr in variables) return variables[expr] as string;
    if (expr in profile) return profile[expr] as string;

    const known = [...Object.keys(variables), ...Object.keys(profile)].sort();
    throw new Error(
      `Unknown data reference "{{${expr}}}" in value "${input}".\n` +
        `  Known names: ${known.length ? known.join(', ') : '(none: is data_profile set on the blueprint?)'}`,
    );
  });
}
