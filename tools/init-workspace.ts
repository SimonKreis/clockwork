/**
 * npm run init
 *
 * Creates the workspace on purpose (D21): the folder next to the application called
 * clockwork-workspace, or BLUEPRINT_WORKSPACE when it is set, with its whole layout, a .env copied
 * from .env.example and a blueprint template. The only entry point allowed to create the folder
 * itself. Every other one stops when it is missing, because a missing workspace is more often a
 * moved one than a new one. Running it on a workspace that exists completes the layout and
 * overwrites nothing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describeEnsure, ensureWorkspace, workspaceRoot } from '../src/workspace';

const rootDir = path.resolve(__dirname, '..');
const root = workspaceRoot(rootDir);
const existed = fs.existsSync(root);

const lines = describeEnsure(ensureWorkspace(root, rootDir, { create: true }));
if (lines.length === 0) console.log(`The workspace at ${root} is complete. Nothing to do.`);
for (const line of lines) console.log(line);
if (!existed) console.log('Clockwork will never create it again: if you move it, move it back or set BLUEPRINT_WORKSPACE.');
