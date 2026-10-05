/**
 * One Playwright test per blueprint found in <workspace>/blueprints/.
 *
 * There is no per scenario test file to write. Drop a YAML file in blueprints/ and it runs.
 * To run a single one:  npm run test:one -- "create_a_course"
 */

import path from 'node:path';
import { test } from '@playwright/test';
import { blueprintFiles, blueprintsDir, loadBlueprint } from '../src/blueprint';
import { workspaceDir } from '../src/config';
import { runBlueprint } from '../src/interpreter';
import { describeEnsure, ensureWorkspace, workspacePaths } from '../src/workspace';

// Playwright compiles test files to CommonJS, so __dirname is available and import.meta is not.
declare const __dirname: string;
const rootDir = path.resolve(__dirname, '..');

// An existing workspace is completed. A missing one stops the run with a message saying how to find
// it or create it (`npm run init`), and nothing is created (D21).
const workspace = workspaceDir(rootDir);
for (const line of describeEnsure(ensureWorkspace(workspace, rootDir))) console.log(line);

const files = blueprintFiles(rootDir);

if (files.length === 0) {
  // Not an error. A new workspace has no scenarios yet, and the engine is verified without any by
  // "npm run check".
  test('no blueprints to run', () => {
    test.skip(
      true,
      [
        `No blueprints found in ${blueprintsDir(rootDir)}.`,
        'Scenarios live in the workspace next to this application, because they contain client',
        'material. Write one by hand from',
        `${path.join(workspacePaths(workspace).templates, 'blueprint-template.yaml')},`,
        'or put a legacy export in legacy-exports/ and run "npm run convert".',
        'The engine itself needs neither: "npm run check" verifies it offline.',
      ].join(' '),
    );
  });
}

for (const file of files) {
  // Loading happens at collection time so a malformed blueprint fails fast and names itself,
  // before any browser opens.
  const blueprint = loadBlueprint(file);
  const title = blueprint.source
    ? `${blueprint.scenario} (${blueprint.source})`
    : blueprint.scenario;

  test(title, async ({ browser }, testInfo) => {
    testInfo.annotations.push({ type: 'blueprint', description: path.basename(file) });
    if (blueprint.description) {
      testInfo.annotations.push({ type: 'description', description: blueprint.description.trim() });
    }
    await runBlueprint(blueprint, { browser, testInfo, rootDir });
  });
}
