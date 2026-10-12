/**
 * The test evidence document: one step, one screenshot, nothing else.
 *
 *   npm run evidence                     most recent run
 *   npm run evidence -- <journal.jsonl>  a given run
 *   npm run evidence -- --layout stack   screenshot under each step instead of beside it
 *   npm run evidence -- --no-pdf         HTML only
 *
 * This is the format a manual tester produces by pasting a screenshot under every step of the
 * script, and the one a client reads. The summary next to it (tools/report.ts) is for whoever runs
 * the tests; this one is for whoever receives them.
 *
 * Built in three layers so that a change of format touches one of them only:
 *
 *   1. buildModel()   journal -> tests -> steps { text, status, screenshot }. The content.
 *   2. renderHtml()   the markup, the same for every layout.
 *   3. STYLE          the layout itself. `table` puts the step and its screenshot side by side,
 *                     `stack` puts the screenshot under the step. Both are CSS only, on the same
 *                     markup, so a third layout is a few CSS rules and a new entry in LAYOUTS.
 *
 * The HTML is a single self contained file (screenshots embedded), with a switch between the two
 * layouts on screen. The PDF is printed from that same file by the Chromium Playwright already
 * installs, so it looks exactly like the page. A Word or Excel export would be a fourth layer
 * reading the same model.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { browserLaunchOverrides, config, workspaceDir } from '../src/config';
import { blueprintFiles, loadBlueprint } from '../src/blueprint';
import { latestJournal, readJournal } from '../src/journal';
import type { JournalRecord } from '../src/types';
import { APP_ROOT } from '../src/workspace';

export const LAYOUTS = ['table', 'stack'] as const;
export type Layout = (typeof LAYOUTS)[number];

// ---------------------------------------------------------------------------- 1. the model

export type EvidenceStep = {
  number: number;
  text: string;
  note?: string;
  status: 'passed' | 'failed' | 'skipped';
  error?: string;
  /** A data: URI, so the document survives being emailed. Absent when no screenshot exists. */
  image?: string;
};

export type EvidenceTest = {
  scenario: string;
  ticket?: string;
  description?: string;
  status: 'PASSED' | 'FAILED';
  steps: EvidenceStep[];
};

export type EvidenceModel = {
  runId: string;
  generated: string;
  environment?: string;
  tests: EvidenceTest[];
};

/** "HR (option-click)" -> "HR": how the engine got there is not part of the evidence. */
function cleanValue(value: string | undefined): string {
  return (value ?? '').replace(/\s+\([a-z]+(-[a-z]+)+\)$/, '').trim();
}

/** The step as a person would write it in a manual script. */
export function stepText(r: JournalRecord): string {
  const label = r.label ? `"${r.label}"` : '';
  const value = cleanValue(r.value_used);
  switch (r.keyword) {
    case 'navigate':
      return value ? `Navigate to ${value}` : 'Navigate';
    case 'fill':
      return value ? `Enter "${value}" in ${label}` : `Clear ${label}`;
    case 'select':
      return value ? `Select "${value}" in ${label}` : `Select in ${label}`;
    case 'click':
      return `Click ${label}`;
    case 'press_key':
      return `Press ${value || 'a key'}`;
    case 'capture':
      return value ? `Read ${label}: ${value}` : `Read ${label}`;
    case 'verify':
      return label ? `Check ${label} shows "${value}"` : `Check the page shows "${value}"`;
    case 'wait_for':
      return `Wait for ${label || `"${value}"`}`;
    case 'switch_window':
      return 'Switch to the window that opened';
    case 'close_window':
      return 'Close the window';
    case 'refresh':
      return 'Refresh the page';
    default:
      return [r.keyword, label, value].filter(Boolean).join(' ');
  }
}

/** Screenshot paths in older journals are relative, to the application or to the workspace. */
function findScreenshot(file: string | undefined): string | undefined {
  if (!file) return undefined;
  const candidates = [
    path.resolve(file),
    path.resolve(APP_ROOT, file),
    path.resolve(workspaceDir(APP_ROOT), file),
  ];
  return candidates.find((c) => fs.existsSync(c));
}

function embed(file: string | undefined): string | undefined {
  const found = findScreenshot(file);
  return found ? `data:image/png;base64,${fs.readFileSync(found).toString('base64')}` : undefined;
}

/** The blueprint descriptions, which carry the expected result of each test. Best effort. */
function descriptions(): Map<string, string> {
  const out = new Map<string, string>();
  for (const file of blueprintFiles(APP_ROOT)) {
    try {
      const bp = loadBlueprint(file);
      if (bp.description) out.set(bp.scenario, bp.description.trim());
    } catch {
      // A blueprint that does not load has no business stopping a report of a run that happened.
    }
  }
  return out;
}

/** 2026-09-24 22:55, in the time zone of whoever runs the report, which is the tester's. */
function localTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

export function buildModel(records: JournalRecord[]): EvidenceModel {
  const byScenario = new Map<string, JournalRecord[]>();
  for (const r of records) {
    const list = byScenario.get(r.scenario) ?? [];
    list.push(r);
    byScenario.set(r.scenario, list);
  }
  const described = descriptions();

  const tests: EvidenceTest[] = [...byScenario.entries()].map(([scenario, rs]) => ({
    scenario,
    ticket: rs.find((r) => r.source_ticket)?.source_ticket,
    description: described.get(scenario),
    status: rs.some((r) => r.status === 'failed') ? 'FAILED' : 'PASSED',
    steps: rs
      .sort((a, b) => a.step_index - b.step_index)
      .map((r) => ({
        number: r.step_index,
        text: stepText(r),
        note: r.note,
        status: r.status,
        error: r.status === 'failed' ? (r.oracle_error_text ?? r.error_message ?? '').trim() : undefined,
        image: embed(r.screenshot_path),
      })),
  }));

  // Tests of one ticket side by side, parts in order: the ticket is what the client knows.
  tests.sort(
    (a, b) => (a.ticket ?? '').localeCompare(b.ticket ?? '') || a.scenario.localeCompare(b.scenario),
  );

  const firstUrl = records.find((r) => r.url?.startsWith('http'))?.url;
  return {
    runId: records[0]?.run_id ?? '',
    generated: localTime(new Date()),
    environment: firstUrl ? new URL(firstUrl).host : undefined,
    tests,
  };
}

// ---------------------------------------------------------------------------- 2. the markup

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderStep(s: EvidenceStep): string {
  const shot = s.image
    ? `<img src="${s.image}" alt="Screenshot of step ${s.number}">`
    : `<p class="noshot">${s.status === 'skipped' ? 'Not run' : 'No screenshot'}</p>`;
  return `<div class="step ${s.status}">
  <div class="text">
    <p class="num">Step ${s.number}${s.status === 'failed' ? ' <span class="ko">FAILED</span>' : ''}</p>
    <p>${esc(s.text)}</p>
    ${s.note ? `<p class="note">${esc(s.note)}</p>` : ''}
    ${s.error ? `<pre class="err">${esc(s.error)}</pre>` : ''}
  </div>
  <div class="shot">${shot}</div>
</div>`;
}

function renderTest(t: EvidenceTest): string {
  return `<section class="test">
  <h2>${t.ticket ? `${esc(t.ticket)} &middot; ` : ''}${esc(t.scenario)}
    <span class="${t.status === 'PASSED' ? 'ok' : 'ko'}">${t.status}</span></h2>
  ${t.description ? `<p class="desc">${esc(t.description)}</p>` : ''}
  <div class="steps">
    <div class="head"><div>Step</div><div>Screenshot</div></div>
    ${t.steps.map(renderStep).join('\n')}
  </div>
</section>`;
}

export function renderHtml(model: EvidenceModel, layout: Layout): string {
  const passed = model.tests.filter((t) => t.status === 'PASSED').length;
  const switcher = LAYOUTS.map(
    (l) => `<button type="button" data-layout="${l}">${l === 'table' ? 'Side by side' : 'One column'}</button>`,
  ).join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Test evidence ${esc(model.runId)}</title>
<style>${STYLE}</style></head>
<body class="layout-${layout}">
<header>
  <h1>Test evidence</h1>
  <p class="meta">Run ${esc(model.runId)} &middot; ${esc(model.generated)}${
    model.environment ? ` &middot; ${esc(model.environment)}` : ''
  } &middot; ${passed} of ${model.tests.length} tests passed</p>
  <p class="switch">${switcher}</p>
</header>
${model.tests.map(renderTest).join('\n')}
<script>
  document.querySelectorAll('.switch button').forEach(function (b) {
    b.addEventListener('click', function () {
      document.body.className = 'layout-' + b.getAttribute('data-layout');
    });
  });
</script>
</body></html>`;
}

// ---------------------------------------------------------------------------- 3. the layout

const STYLE = `
  body { font-family: Calibri, "Segoe UI", system-ui, sans-serif; color: #1a1a1a; background: #fff;
         margin: 2rem; font-size: 11pt; }
  h1 { margin: 0 0 .2rem; }
  h2 { font-size: 13pt; margin: 2rem 0 .4rem; border-bottom: 2px solid #1a1a1a; padding-bottom: .2rem; }
  .meta, .desc { color: #555; }
  .desc { white-space: pre-line; margin: 0 0 .8rem; }
  .ok, .ko { color: #fff; font-size: 9pt; padding: .05rem .45rem; border-radius: 3px; vertical-align: middle; }
  .ok { background: #2e7d32; }
  .ko { background: #c62828; }
  .num { font-weight: 700; margin: 0 0 .2rem; }
  .text p { margin: 0 0 .3rem; }
  .note { color: #666; font-style: italic; }
  .err { color: #c62828; white-space: pre-wrap; font-size: 9pt; margin: .3rem 0 0; }
  .shot img { display: block; width: 100%; border: 1px solid #ccc; }
  .noshot { color: #999; font-style: italic; margin: 0; }
  .step.skipped { color: #999; }
  .switch button { font: inherit; margin-right: .4rem; cursor: pointer; }

  /* table: the step and its screenshot side by side, like the manual script. */
  .layout-table .steps { border: 1px solid #bbb; }
  .layout-table .head, .layout-table .step { display: grid; grid-template-columns: 30% 70%; }
  .layout-table .head { background: #f0f0f0; font-weight: 700; }
  .layout-table .head > div, .layout-table .step > div { padding: .5rem .6rem; }
  .layout-table .step { border-top: 1px solid #bbb; }
  .layout-table .step > .text { border-right: 1px solid #bbb; }
  .layout-table .step.failed > .text { background: #fdecea; }

  /* stack: the step, then its screenshot underneath, one after the other. */
  .layout-stack .head { display: none; }
  .layout-stack .step { margin: 0 0 1.4rem; }
  .layout-stack .step.failed .num { color: #c62828; }
  .layout-stack .shot img { max-width: 100%; }

  @media print {
    body { margin: 0; }
    .switch { display: none; }
    .step { break-inside: avoid; }
    h2 { break-after: avoid; }
    .test + .test { break-before: page; }
  }
`;

// ---------------------------------------------------------------------------- output

export type EvidenceFiles = { html: string; pdf?: string };

export async function writeEvidence(
  journalFile: string,
  outDir: string,
  opts: { layout?: Layout; pdf?: boolean } = {},
): Promise<EvidenceFiles> {
  const layout = opts.layout ?? 'table';
  const model = buildModel(readJournal(journalFile));
  const base = path.basename(journalFile, '.jsonl').replace(/^journal-/, 'evidence-');
  const html = path.join(outDir, `${base}.html`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(html, renderHtml(model, layout), 'utf8');

  if (opts.pdf === false) return { html };

  const pdf = path.join(outDir, `${base}.pdf`);
  const browser = await chromium.launch(browserLaunchOverrides());
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(html).href, { waitUntil: 'load' });
    await page.pdf({
      path: pdf,
      format: 'A4',
      landscape: layout === 'table',
      printBackground: true,
      margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' },
    });
  } finally {
    await browser.close();
  }
  return { html, pdf };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const layoutAt = args.indexOf('--layout');
  const layout = (layoutAt >= 0 ? args[layoutAt + 1] : 'table') as Layout;
  if (!LAYOUTS.includes(layout)) {
    console.error(`Unknown layout "${layout}". Use one of: ${LAYOUTS.join(', ')}.`);
    process.exit(1);
  }
  const file =
    args.find((a, i) => !a.startsWith('--') && (layoutAt < 0 || i !== layoutAt + 1)) ?? latestJournal();

  if (!file || !fs.existsSync(file) || readJournal(file).length === 0) {
    console.error(`No run journal with steps found. Run the tests first with: npm test`);
    process.exit(1);
  }

  const out = await writeEvidence(file, config.reportsDir, { layout, pdf: !args.includes('--no-pdf') });
  console.log(`  ${out.html}`);
  if (out.pdf) console.log(`  ${out.pdf}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error((error as Error).message);
    process.exit(1);
  });
}
