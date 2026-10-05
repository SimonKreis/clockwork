/**
 * Blueprint loading and validation.
 *
 * Validation is deliberately strict and its messages are written for a functional consultant, not
 * for a developer. A blueprint that is wrong should say so before the browser opens, not halfway
 * through a run against Oracle.
 *
 * Two constructs from schema v0.1 are refused by name rather than by a generic "unknown key", so
 * that an old blueprint explains itself instead of failing obscurely.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { workspaceDir } from './config';
import type { Blueprint, Step, StepAction } from './types';

const KNOWN_ACTIONS: StepAction[] = [
  'navigate',
  'fill',
  'select',
  'click',
  'press_key',
  'capture',
  'verify',
  'wait_for',
  'switch_window',
  'close_window',
  'refresh',
];

/** The blueprints directory, inside the workspace. See workspaceDir in config.ts. */
export function blueprintsDir(rootDir: string): string {
  return path.join(workspaceDir(rootDir), 'blueprints');
}

export function blueprintFiles(rootDir: string): string[] {
  const dir = blueprintsDir(rootDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .sort()
    .map((f) => path.join(dir, f));
}

export function loadBlueprint(file: string): Blueprint {
  let parsed: unknown;
  try {
    parsed = parseYaml(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${path.basename(file)} is not valid YAML: ${(error as Error).message}`);
  }

  const bp = parsed as Blueprint | null;
  if (!bp || typeof bp !== 'object') {
    throw new Error(`${path.basename(file)} is empty.`);
  }
  if (!bp.scenario) {
    throw new Error(`${path.basename(file)} has no "scenario" name at the top.`);
  }

  // A v0.1 blueprint, written when a scenario could switch persona. Name the construct and say
  // what replaced it, rather than letting it fail as "no steps".
  if ((bp as { sessions?: unknown }).sessions !== undefined) {
    throw new Error(
      `${path.basename(file)} uses "sessions", which no longer exists.\n` +
        `  One test is now one user session, from the first functional action to the last.\n` +
        `  Split this file into one blueprint per persona and run them in order.`,
    );
  }

  if (!Array.isArray(bp.steps) || bp.steps.length === 0) {
    throw new Error(`${path.basename(file)} has no "steps", so there is nothing to run.`);
  }

  bp.steps.forEach((step, i) => validateStep(step, `${path.basename(file)} step ${i + 1}`));

  bp._file = file;
  return bp;
}

function validateStep(step: Step, where: string): void {
  if (!step || typeof step !== 'object' || !('action' in step)) {
    throw new Error(`${where}: every step needs an "action".`);
  }
  const action = step.action as StepAction;

  if ((action as string) === 'login') {
    throw new Error(
      `${where}: "login" is no longer a step.\n` +
        `  Signing in is infrastructure, not test content: run "npm run auth" once, and every\n` +
        `  blueprint then starts from the first functional action inside a live session.`,
    );
  }

  if (!KNOWN_ACTIONS.includes(action)) {
    throw new Error(
      `${where}: unknown action "${action}".\n  Known actions: ${KNOWN_ACTIONS.join(', ')}`,
    );
  }

  const s = step as Record<string, unknown>;

  // A selector in a blueprint is the one thing this project exists to remove. Refuse it loudly.
  if (s.legacy_xpath !== undefined || s.xpath !== undefined || s.selector !== undefined) {
    throw new Error(
      `${where}: a step cannot carry a selector.\n` +
        `  Resolution is entirely semantic. Use the visible label, and "hints" (a section name\n` +
        `  and an index) when the same label appears more than once.`,
    );
  }

  switch (action) {
    case 'navigate':
      if (!s.path && !s.url) {
        throw new Error(`${where}: a navigate step needs "path" (a list of labels) or "url".`);
      }
      if (s.path && !Array.isArray(s.path)) {
        throw new Error(`${where}: "path" must be a list of labels, for example ["Navigator", "Learning"].`);
      }
      break;
    case 'fill':
    case 'select':
      if (!s.label) throw new Error(`${where}: a ${action} step needs a "label".`);
      if (s.value === undefined) throw new Error(`${where}: a ${action} step needs a "value".`);
      if (action === 'select' && s.mode !== undefined && s.mode !== 'lov' && s.mode !== 'dropdown') {
        throw new Error(
          `${where}: "mode" must be "lov" (a type ahead list of values, the default) or ` +
            `"dropdown" (a plain choice list you open and pick from).`,
        );
      }
      break;
    case 'click':
      if (!s.label) throw new Error(`${where}: a click step needs a "label".`);
      break;
    case 'press_key':
      if (!s.key) {
        throw new Error(
          `${where}: a press_key step needs "key", for example Tab, Enter, Escape or ArrowDown.`,
        );
      }
      break;
    case 'capture':
      if (!s.label) throw new Error(`${where}: a capture step needs a "label".`);
      if (!s.as) throw new Error(`${where}: a capture step needs "as" (the variable name to store).`);
      break;
    case 'verify':
      if (!s.text_contains && !s.label) {
        throw new Error(`${where}: a verify step needs "text_contains", or a "label" with "equals" or "contains".`);
      }
      if (s.label && s.equals === undefined && s.contains === undefined) {
        throw new Error(`${where}: verify on "${String(s.label)}" needs "equals" or "contains".`);
      }
      break;
    case 'wait_for':
      if (!s.text && !s.label) throw new Error(`${where}: a wait_for step needs "text" or "label".`);
      break;
    case 'switch_window':
    case 'close_window':
    case 'refresh':
      break;
  }
}

/** Short human description of a step, used in reports and error messages. */
export function describeStep(step: Step): string {
  const s = step as Record<string, unknown>;
  switch (step.action) {
    case 'navigate':
      return s.url ? `navigate to ${String(s.url)}` : `navigate ${(s.path as string[]).join(' > ')}`;
    case 'fill':
      return `fill "${String(s.label)}" with "${String(s.value)}"`;
    case 'select':
      return `select "${String(s.value)}" in "${String(s.label)}"`;
    case 'click':
      return `${s.double ? 'double click' : 'click'} "${String(s.label)}"`;
    case 'press_key':
      return s.label
        ? `press ${String(s.key)} on "${String(s.label)}"`
        : `press ${String(s.key)}`;
    case 'refresh':
      return 'refresh the page';
    case 'capture':
      return `capture "${String(s.label)}" as ${String(s.as)}`;
    case 'verify':
      if (s.text_contains) return `verify page contains "${String(s.text_contains)}"`;
      return `verify "${String(s.label)}" ${s.equals !== undefined ? `equals "${String(s.equals)}"` : `contains "${String(s.contains)}"`}`;
    case 'wait_for':
      return `wait for ${String(s.text ?? s.label)} to be ${String(s.state ?? 'visible')}`;
    case 'switch_window':
      return `switch to ${String(s.to ?? 'new')} window`;
    case 'close_window':
      return 'close window';
    default:
      return String((step as { action: string }).action);
  }
}
