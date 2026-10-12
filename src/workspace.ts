/**
 * The workspace: everything that belongs to one user and one round of tests, kept outside the
 * application folder (D9, made systematic by D20).
 *
 *   clockwork/              the application: code, synthetic self test, documentation. Nothing else.
 *   clockwork-workspace/    everything specific to a user and their runs:
 *     .env                  the configuration: the pod, the browser, the switches
 *     blueprints/           the scenarios, converted or written by hand
 *     blueprints/disabled/  scenarios that are kept but never run
 *     data/                 data profiles
 *     legacy-exports/          raw legacy exports, read only
 *     templates/            starting points for writing a scenario by hand, never run
 *     reports/              journals, screenshots, summaries, Playwright's own output
 *     .auth/                a captured session, with SESSION=saved only
 *
 * Finding it needs no configuration, on purpose, because the configuration lives inside it. It is
 * the folder next to the application called clockwork-workspace, unless BLUEPRINT_WORKSPACE is set
 * in the environment the application is started from. It cannot be set from the workspace's own
 * .env: a workspace that moves itself would load one folder's settings and run another's tests.
 *
 * It is created on purpose, never by accident (D21). `npm run init`, or the question Clockwork.cmd
 * asks on a first start, builds the whole layout, with a commented .env copied from .env.example
 * and a blueprint template, so a user who writes scenarios by hand starts from a working folder.
 * Every other entry point only completes a workspace that exists, and stops when the folder itself
 * is missing: a missing workspace is far more often one that was moved or renamed than a first
 * start, and creating an empty one next to it would split the scenarios and reports in two.
 *
 * This module imports nothing from the rest of the engine. config.ts depends on it to load the
 * configuration before anything reads a setting, so it cannot depend on config.ts in return.
 */

import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

/** The application folder. This file lives in <app>/src. */
export const APP_ROOT = path.resolve(__dirname, '..');

export const DEFAULT_WORKSPACE_NAME = 'clockwork-workspace';

/** Where the workspace is: BLUEPRINT_WORKSPACE from the environment, or the folder next door. */
export function workspaceRoot(appRoot: string = APP_ROOT): string {
  const configured = process.env.BLUEPRINT_WORKSPACE;
  return configured
    ? path.resolve(appRoot, configured)
    : path.resolve(appRoot, '..', DEFAULT_WORKSPACE_NAME);
}

export type WorkspacePaths = {
  root: string;
  env: string;
  readme: string;
  blueprints: string;
  disabled: string;
  data: string;
  exports: string;
  templates: string;
  reports: string;
  auth: string;
};

export function workspacePaths(root: string = workspaceRoot()): WorkspacePaths {
  return {
    root,
    env: path.join(root, '.env'),
    readme: path.join(root, 'README.md'),
    blueprints: path.join(root, 'blueprints'),
    disabled: path.join(root, 'blueprints', 'disabled'),
    data: path.join(root, 'data'),
    exports: path.join(root, 'legacy-exports'),
    templates: path.join(root, 'templates'),
    reports: path.join(root, 'reports'),
    auth: path.join(root, '.auth'),
  };
}

/**
 * Load <workspace>/.env into the environment, overriding nothing that is already set.
 *
 * Already set wins, so the self test and anybody setting a variable for one command keep control.
 * The one variable the file may not set is BLUEPRINT_WORKSPACE itself: it would point every later
 * lookup somewhere other than the folder whose configuration was just loaded.
 */
export function loadWorkspaceEnv(root: string = workspaceRoot()): void {
  const file = path.join(root, '.env');
  if (!fs.existsSync(file)) return;
  const before = process.env.BLUEPRINT_WORKSPACE;
  dotenv.config({ path: file });
  if (before === undefined) delete process.env.BLUEPRINT_WORKSPACE;
}

export type EnsureResult = {
  root: string;
  /** Everything this call had to create, in the order it did so. Empty on every later start. */
  created: string[];
  /** User material still sitting in the application folder, from before D20. */
  legacy: string[];
};

/** The workspace folder itself is missing and the caller did not ask for it to be created. */
export class WorkspaceMissingError extends Error {
  constructor(readonly root: string) {
    super(
      [
        `No workspace at ${root}.`,
        '  If it was moved or renamed, move it back next to the application, or set',
        '  BLUEPRINT_WORKSPACE to its new place in the environment Clockwork starts in.',
        '  If this is the first start, create it on purpose with: npm run init',
        '  Nothing was created.',
      ].join('\n'),
    );
    this.name = 'WorkspaceMissingError';
  }
}

/**
 * Make sure the workspace has its full layout. Idempotent, and it never overwrites a file that is
 * already there: a filled in .env or a hand written README is worth more than anything this
 * function could write in its place.
 *
 * The workspace folder itself is only created with `create: true`, which only `npm run init` passes.
 * Otherwise a missing folder throws WorkspaceMissingError and nothing is written (D21).
 */
export function ensureWorkspace(
  root: string = workspaceRoot(),
  appRoot: string = APP_ROOT,
  options: { create?: boolean } = {},
): EnsureResult {
  if (!options.create && !fs.existsSync(root)) throw new WorkspaceMissingError(root);
  const p = workspacePaths(root);
  const created: string[] = [];

  for (const dir of [p.root, p.blueprints, p.disabled, p.data, p.exports, p.templates, p.reports]) {
    if (fs.existsSync(dir)) continue;
    fs.mkdirSync(dir, { recursive: true });
    created.push(dir);
  }

  // The configuration is the application's own template, copied, so every setting arrives with
  // the explanation of what it does.
  if (!fs.existsSync(p.env)) {
    const template = path.join(appRoot, '.env.example');
    fs.writeFileSync(p.env, fs.existsSync(template) ? fs.readFileSync(template, 'utf8') : '', 'utf8');
    created.push(p.env);
  }

  if (!fs.existsSync(p.readme)) {
    fs.writeFileSync(p.readme, WORKSPACE_README, 'utf8');
    created.push(p.readme);
  }

  const blueprintTemplate = path.join(p.templates, 'blueprint-template.yaml');
  if (!fs.existsSync(blueprintTemplate)) {
    fs.writeFileSync(blueprintTemplate, BLUEPRINT_TEMPLATE, 'utf8');
    created.push(blueprintTemplate);
  }

  return { root, created, legacy: legacyInApp(appRoot) };
}

/**
 * User material still sitting in the application folder.
 *
 * Named, never moved automatically. These are somebody's files, a filled in configuration and a
 * history of runs among them, and moving them is a decision for that person. Where they are, they
 * are ignored: nothing reads a .env there any more, and nothing writes reports there.
 */
export function legacyInApp(appRoot: string = APP_ROOT): string[] {
  return ['.env', '.auth', 'reports', 'blueprints', 'data', 'legacy-exports']
    .map((name) => path.join(appRoot, name))
    .filter((file) => fs.existsSync(file));
}

/** What ensureWorkspace did and found, as lines for a console. Empty when there is nothing to say. */
export function describeEnsure(result: EnsureResult): string[] {
  const lines: string[] = [];
  if (result.created.length > 0) {
    lines.push(`Workspace prepared at ${result.root}`);
    for (const item of result.created) lines.push(`  created ${path.relative(result.root, item) || '.'}`);
    if (result.created.some((item) => item.endsWith('.env'))) {
      lines.push('  Fill ORACLE_BASE_URL in its .env, then start Clockwork again.');
    }
  }
  if (result.legacy.length > 0) {
    lines.push('Found in the application folder, where it no longer belongs and is ignored:');
    for (const item of result.legacy) lines.push(`  ${item}`);
    lines.push(`  Move it into ${result.root}.`);
  }
  return lines;
}

const WORKSPACE_README = [
  "# Clockwork workspace",
  "",
  "Everything specific to you and your test runs, for the Clockwork application in the folder next",
  "to this one. Clockwork finds this folder by itself. It was created on purpose, by `npm run init`,",
  "and Clockwork never creates it again: if you move it, move it back or set BLUEPRINT_WORKSPACE.",
  "",
  "**Nothing in this folder is shareable.** It holds real scenarios, environment URLs, usernames and",
  "screenshots of client screens. It is kept outside the application on purpose, so the application",
  "can be copied, shared or published without any of it.",
  "",
  "| Path | Contents |",
  "|---|---|",
  "| `.env` | Your configuration: the pod, the browser, the switches. Copied from the application's `.env.example` when the workspace was created, every setting explained. |",
  "| `blueprints/` | The scenarios Clockwork runs, converted by `npm run convert` or written by hand. A run in assisted mode writes its corrections straight back into these files. |",
  "| `blueprints/disabled/` | Scenarios kept but never run. Move a file up one folder to run it. |",
  "| `data/` | Data profiles: the business values a scenario uses. No passwords, and nowhere to put one. |",
  "| `legacy-exports/` | Raw legacy exports, read only: the input of `npm run convert`. |",
  "| `templates/` | Starting points for writing a scenario by hand. Copy one into `blueprints/`. Never run. |",
  "| `reports/` | Every run's journal, screenshots and report, and the conversion report. |",
  "| `.auth/` | A captured session, only with `SESSION=saved`. As sensitive as a password. |",
  "",
  "A scenario that signed in as several people becomes several blueprints, named `_1`, `_2`, `_3`.",
  "Run them in order: each one expects what the previous one created, and any approval it triggered.",
  "",
  "This folder has no version history. Back it up the way you back up any client material.",
  "",
].join('\n');

const BLUEPRINT_TEMPLATE = [
  '# A starting point for writing a scenario by hand. Copy this file into ../blueprints/ under a new',
  '# name, change the scenario name, and replace the steps. Files in templates/ are never run.',
  '#',
  '# Every step names what a person sees on screen, never a selector: the engine finds the element by',
  '# its visible label when the run gets there, and pauses for you when it cannot. The full list of',
  '# actions and their options is in README.md of the application, under "Writing a test".',
  '',
  'scenario: my_scenario_name          # snake_case, unique across the workspace',
  'source: PROJ-1234                   # the ticket this scenario proves, optional',
  'description: >',
  '  One sentence on what this scenario proves.',
  'data_profile: my_scenario_default   # a file in ../data/, without .yaml; delete the line if unused',
  '',
  'steps:',
  '  - action: navigate',
  '    path: ["Navigator", "My Client Groups", "Show More"]',
  '',
  '  - action: click',
  '    label: "Create"',
  '',
  '  - action: fill',
  '    label: "Title"',
  '    value: "{{title}}"               # read from the data profile',
  '',
  '  - action: select',
  '    label: "Category"',
  '    value: "{{category}}"',
  '',
  '  - action: click',
  '    label: "Save and Close"',
  '',
  '  - action: verify',
  '    text_contains: "saved"',
  '',
].join('\n');
