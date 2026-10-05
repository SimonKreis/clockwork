/**
 * The workspace: found without configuration, created only on purpose, never overwritten (D20, D21).
 *
 * What is proved, against temporary folders so no real workspace is ever touched:
 *   - with nothing configured, the workspace is the folder next to the application
 *   - a missing workspace is never created by accident: it stops, and nothing is written (D21)
 *   - creating it on purpose builds the whole layout, with a .env copied from the application's template
 *   - the blueprint template it writes is a blueprint the engine actually accepts
 *   - a second start creates nothing, and above all does not overwrite a filled in .env
 *   - user material left in the application folder is named rather than silently used
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { loadBlueprint } from '../src/blueprint';
import {
  DEFAULT_WORKSPACE_NAME,
  ensureWorkspace,
  legacyInApp,
  workspacePaths,
  workspaceRoot,
  WorkspaceMissingError,
} from '../src/workspace';

declare const __dirname: string;
const appRoot = path.resolve(__dirname, '..');

let root: string;

test.beforeEach(() => {
  root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cw-ws-')), DEFAULT_WORKSPACE_NAME);
});

test('with nothing configured, the workspace is the folder next to the application', () => {
  const previous = process.env.BLUEPRINT_WORKSPACE;
  delete process.env.BLUEPRINT_WORKSPACE;
  try {
    expect(workspaceRoot(path.resolve('/somewhere', 'clockwork'))).toBe(
      path.resolve('/somewhere', DEFAULT_WORKSPACE_NAME),
    );
  } finally {
    if (previous !== undefined) process.env.BLUEPRINT_WORKSPACE = previous;
  }
});

test('a missing workspace stops every start that did not ask for it, and nothing is written', () => {
  // The usual cause is a folder that was moved or renamed. Creating an empty one in its old place
  // would split the scenarios and reports between two folders (D21).
  expect(() => ensureWorkspace(root, appRoot)).toThrow(WorkspaceMissingError);
  expect(fs.existsSync(root)).toBe(false);
});

test('an existing but empty workspace is completed without being asked', () => {
  fs.mkdirSync(root);
  const result = ensureWorkspace(root, appRoot);
  expect(result.created).toContain(workspacePaths(root).env);
});

test('creating it on purpose builds the whole layout, with a configuration to fill in', () => {
  const result = ensureWorkspace(root, appRoot, { create: true });
  const p = workspacePaths(root);

  for (const dir of [p.blueprints, p.disabled, p.data, p.exports, p.templates, p.reports]) {
    expect(fs.statSync(dir).isDirectory()).toBe(true);
  }
  // The configuration is the application's own template, copied, so every setting arrives with
  // the explanation of what it does.
  expect(fs.readFileSync(p.env, 'utf8')).toBe(
    fs.readFileSync(path.join(appRoot, '.env.example'), 'utf8'),
  );
  expect(fs.existsSync(p.readme)).toBe(true);
  expect(result.created).toContain(p.env);
});

test('the blueprint template is a blueprint the engine accepts', () => {
  ensureWorkspace(root, appRoot, { create: true });
  // A template that fails to load would teach the first hand written scenario a mistake.
  const bp = loadBlueprint(path.join(workspacePaths(root).templates, 'blueprint-template.yaml'));
  expect(bp.scenario).toBe('my_scenario_name');
  expect((bp.steps ?? []).length).toBeGreaterThan(0);
});

test('a second start creates nothing, least of all over a configuration somebody filled in', () => {
  ensureWorkspace(root, appRoot, { create: true });
  const p = workspacePaths(root);
  fs.writeFileSync(p.env, 'ORACLE_BASE_URL=https://example.invalid/\n', 'utf8');

  const again = ensureWorkspace(root, appRoot);
  expect(again.created).toEqual([]);
  expect(fs.readFileSync(p.env, 'utf8')).toBe('ORACLE_BASE_URL=https://example.invalid/\n');
});

test('user material left in the application folder is named, not silently used', () => {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-app-'));
  fs.writeFileSync(path.join(app, '.env'), 'X=1\n', 'utf8');
  fs.mkdirSync(path.join(app, 'reports'));
  expect(legacyInApp(app).map((f) => path.basename(f)).sort()).toEqual(['.env', 'reports']);
});
