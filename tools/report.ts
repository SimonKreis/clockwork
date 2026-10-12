/**
 * Generates the standardised summary from a run journal.
 *
 *   npm run report                       most recent run
 *   npm run report -- <workspace>/reports/journal-20260824-140000.jsonl
 *
 * Produces a Markdown summary and a self contained HTML page with the screenshots inline.
 * The engine is never touched to change a report: everything here reads the journal only.
 * It also writes the client facing evidence document, one screenshot per step, which lives in
 * tools/evidence.ts: this summary is for whoever runs the tests, that one for whoever receives them.
 */

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config';
import { latestJournal, readJournal } from '../src/journal';
import type { JournalRecord } from '../src/types';
import { writeEvidence } from './evidence';

type ScenarioSummary = {
  scenario: string;
  source?: string;
  status: 'PASSED' | 'FAILED';
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  failingStep?: JournalRecord;
  ambiguous: JournalRecord[];
  /** Steps the tester repaired in the paused browser, which updated the blueprint. */
  repaired: JournalRecord[];
  records: JournalRecord[];
};

function summarise(records: JournalRecord[]): ScenarioSummary[] {
  const byScenario = new Map<string, JournalRecord[]>();
  for (const r of records) {
    const list = byScenario.get(r.scenario) ?? [];
    list.push(r);
    byScenario.set(r.scenario, list);
  }

  return [...byScenario.entries()].map(([scenario, rs]) => {
    const failed = rs.filter((r) => r.status === 'failed');
    return {
      scenario,
      source: rs.find((r) => r.source_ticket)?.source_ticket,
      status: failed.length > 0 ? 'FAILED' : 'PASSED',
      total: rs.length,
      passed: rs.filter((r) => r.status === 'passed').length,
      failed: failed.length,
      skipped: rs.filter((r) => r.status === 'skipped').length,
      durationMs: rs.reduce((sum, r) => sum + (r.duration_ms || 0), 0),
      failingStep: failed[0],
      ambiguous: rs.filter((r) => r.ambiguous),
      repaired: rs.filter((r) => r.repaired_from),
      records: rs,
    };
  });
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function markdown(summaries: ScenarioSummary[], journalFile: string, outDir: string): string {
  const total = summaries.length;
  const failed = summaries.filter((s) => s.status === 'FAILED').length;
  const shotsFolder = runScreenshotFolder(summaries.flatMap((s) => s.records), outDir);

  const lines: string[] = [
    `# Test run summary`,
    ``,
    `Journal: \`${journalFile}\``,
    ...(shotsFolder ? [`Screenshots: \`${shotsFolder}\``] : []),
    `Generated: ${new Date().toISOString()}`,
    ``,
    `**${total - failed} of ${total} scenarios passed.**`,
    ``,
    `| Scenario | Ticket | Result | Steps | Failed at | Duration |`,
    `|---|---|---|---:|---|---:|`,
  ];

  for (const s of summaries) {
    const failedAt = s.failingStep ? `step ${s.failingStep.step_index}, ${s.failingStep.keyword}` : '';
    lines.push(
      `| ${s.scenario} | ${s.source ?? ''} | ${s.status === 'PASSED' ? 'PASSED' : 'FAILED'} | ` +
        `${s.passed}/${s.total} | ${failedAt} | ${seconds(s.durationMs)} |`,
    );
  }

  for (const s of summaries.filter((x) => x.status === 'FAILED')) {
    lines.push(``, `## Failure: ${s.scenario}`, ``);
    const f = s.failingStep!;
    lines.push(
      `- Step ${f.step_index}: \`${f.keyword}\`${f.label ? ` on "${f.label}"` : ''}`,
      `- Page: ${f.url ?? 'unknown'}`,
      f.oracle_error_text ? `- Oracle said: ${f.oracle_error_text}` : '',
      f.screenshot_path ? `- Screenshot: \`${f.screenshot_path}\`` : '',
      ``,
      '```',
      (f.error_message ?? '').trim(),
      '```',
      ``,
      `${s.skipped} step(s) after this one were skipped.`,
    );
  }

  const ambiguous = summaries.flatMap((s) => s.ambiguous.map((r) => ({ s, r })));
  if (ambiguous.length > 0) {
    lines.push(
      ``,
      `## Ambiguous labels`,
      ``,
      `The label matched several elements and the first visible one was assumed. Add a`,
      `\`hints:\` block (section or index) to make these steps deterministic.`,
      ``,
      `| Scenario | Step | Label |`,
      `|---|---:|---|`,
      ...ambiguous.map(({ s, r }) => `| ${s.scenario} | ${r.step_index} | ${r.label ?? ''} |`),
    );
  }

  const repaired = summaries.flatMap((s) => s.repaired.map((r) => ({ s, r })));
  if (repaired.length > 0) {
    lines.push(
      ``,
      `## Steps repaired during the run`,
      ``,
      `The run paused on these, the tester performed the action, and the blueprint was updated`,
      `from what they did. Read them as a list of what Oracle has renamed since the test was`,
      `written, and check the new labels are the ones you would have chosen.`,
      ``,
      `| Scenario | Step | Was looking for | Now |`,
      `|---|---:|---|---|`,
      ...repaired.map(
        ({ s, r }) => `| ${s.scenario} | ${r.step_index} | ${r.repaired_from ?? ''} | ${r.label ?? ''} |`,
      ),
    );
  }

  return lines.filter((l) => l !== undefined).join('\n');
}

/**
 * Screenshots are embedded as data URIs so the HTML report is a SINGLE self contained file.
 *
 * Relative links look fine locally and break the moment the report is emailed, moved or opened
 * from anywhere else, which is exactly what happens to a report meant for a client. A cap keeps a
 * long run from producing an unopenable file; beyond it, the remaining shots stay as links.
 */
const MAX_EMBEDDED_BYTES = 40 * 1024 * 1024;

function embedScreenshots(records: JournalRecord[]): Map<string, string> {
  const embedded = new Map<string, string>();
  let used = 0;

  for (const r of records) {
    const file = r.screenshot_path;
    if (!file || embedded.has(file) || !fs.existsSync(file)) continue;
    const size = fs.statSync(file).size;
    if (used + size > MAX_EMBEDDED_BYTES) continue;
    embedded.set(file, `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`);
    used += size;
  }
  return embedded;
}

/**
 * The folder holding this run's screenshots, relative to the report, or empty when there are none.
 *
 * Derived from the paths the journal already recorded rather than rebuilt from the configuration,
 * so a run whose screenshots were redirected elsewhere still points at the right place.
 */
function runScreenshotFolder(records: JournalRecord[], outDir: string): string {
  const first = records.find((r) => r.screenshot_path)?.screenshot_path;
  if (!first) return '';
  // .../screenshots/<run id>/<scenario>/<step>.png, and the run id is the useful level.
  const scenarioDir = path.dirname(first);
  const runDir = path.dirname(scenarioDir);
  return path.relative(outDir, runDir).split(path.sep).join('/');
}

function html(summaries: ScenarioSummary[], journalFile: string, outDir: string): string {
  const all = summaries.flatMap((s) => s.records);
  const embedded = embedScreenshots(all);

  /**
   * Where the untouched PNG files are, said out loud in the report.
   *
   * The run always writes them, one folder per run and one file per step, but nothing told the
   * reader so. A report is evidence: when its rendering is not good enough, or a detail needs to
   * be cropped and put in a ticket, the reader has to know that a full resolution original exists
   * and where. The run id is in the path, so the folder is unambiguous even after several runs.
   */
  const runFolder = runScreenshotFolder(all, outDir);
  const shotsNote = runFolder
    ? `Untouched originals, one PNG per step: <a href="${escapeHtml(runFolder)}">` +
      `<code>${escapeHtml(runFolder)}</code></a>`
    : '';

  const rows = summaries
    .map((s) => {
      const steps = s.records
        .map((r) => {
          const inline = r.screenshot_path ? embedded.get(r.screenshot_path) : undefined;
          const original = r.screenshot_path
            ? escapeHtml(path.relative(outDir, r.screenshot_path).split(path.sep).join('/'))
            : '';

          /**
           * The thumbnail opens in an overlay, not in a new tab.
           *
           * Its predecessor was an anchor pointing at the data: URL, which silently does nothing:
           * browsers have refused top level navigation to data: URLs since 2020, and a click on a
           * blocked link produces no error a reader could act on. The evidence looked broken while
           * the file was perfectly fine.
           *
           * Under it, a link to the PNG on disk. The embedded copy is what survives an email; the
           * file on disk is the one to reach for when the rendering is not good enough, which is
           * the whole reason the run keeps both.
           */
          const shot = inline
            ? `<button type="button" class="thumb" data-full="${inline}" ` +
              `title="click to enlarge"><img class="shot" src="${inline}" ` +
              `alt="step ${r.step_index}"></button>` +
              (original ? `<a class="orig" href="${original}" target="_blank">original</a>` : '')
            : original
              ? `<a class="orig" href="${original}" target="_blank">screenshot</a>`
              : '';
          const badge =
            r.status === 'passed' ? 'ok' : r.status === 'failed' ? 'ko' : 'skip';
          const detail = [
            r.value_used ? escapeHtml(r.value_used) : '',
            r.resolution_method
              ? `<span class="meth">${escapeHtml(r.resolution_method)}</span>`
              : '',
            r.resolution_frame ? `<span class="meth">${escapeHtml(r.resolution_frame)}</span>` : '',
            r.ambiguous ? '<span class="warn">ambiguous</span>' : '',
            r.repaired_from
              ? `<span class="fix">repaired, was "${escapeHtml(r.repaired_from)}"</span>`
              : '',
            r.oracle_error_text ? `<div class="err">${escapeHtml(r.oracle_error_text)}</div>` : '',
            r.error_message ? `<pre>${escapeHtml(r.error_message)}</pre>` : '',
          ]
            .filter(Boolean)
            .join(' ');

          return `<tr class="${badge}"><td>${r.step_index}</td><td>${escapeHtml(r.keyword)}</td>
            <td>${escapeHtml(r.label ?? '')}</td><td>${detail}</td><td>${shot}</td></tr>`;
        })
        .join('\n');

      return `<section>
        <h2>${escapeHtml(s.scenario)} <span class="${s.status === 'PASSED' ? 'ok' : 'ko'}-badge">${s.status}</span></h2>
        <p class="meta">${s.source ? `Ticket ${escapeHtml(s.source)} &middot; ` : ''}${s.passed}/${s.total} steps &middot; ${seconds(s.durationMs)}</p>
        <table><thead><tr><th>#</th><th>Action</th><th>Label</th><th>Detail</th><th>Evidence</th></tr></thead>
        <tbody>${steps}</tbody></table>
      </section>`;
    })
    .join('\n');

  const failed = summaries.filter((s) => s.status === 'FAILED').length;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Test run summary</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; color: #1a1a1a; background: #fff; }
  h1 { margin-bottom: .25rem; }
  .meta { color: #666; font-size: .9rem; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0 2rem; font-size: .9rem; }
  th, td { border: 1px solid #ddd; padding: .4rem .6rem; text-align: left; vertical-align: top; }
  th { background: #f5f5f5; }
  tr.ok td:first-child { border-left: 4px solid #2e7d32; }
  tr.ko { background: #fdecea; }
  tr.ko td:first-child { border-left: 4px solid #c62828; }
  tr.skip { color: #999; }
  .ok-badge { background: #2e7d32; color: #fff; padding: .1rem .5rem; border-radius: 4px; font-size: .8rem; }
  .ko-badge { background: #c62828; color: #fff; padding: .1rem .5rem; border-radius: 4px; font-size: .8rem; }
  .fix { background: #fff3cd; padding: 0 .3rem; border-radius: 3px; font-size: .8rem; }
  .warn { background: #ffe0b2; padding: 0 .3rem; border-radius: 3px; font-size: .8rem; }
  .meth { color: #666; font-size: .8rem; }
  .err { color: #c62828; font-weight: 600; margin-top: .3rem; }
  pre { white-space: pre-wrap; background: #f8f8f8; padding: .5rem; font-size: .8rem; margin: .3rem 0 0; }
  img.shot { width: 200px; border: 1px solid #ccc; border-radius: 3px; display: block; }
  button.thumb { padding: 0; border: 0; background: none; cursor: zoom-in; display: block; }
  button.thumb:hover img.shot, button.thumb:focus img.shot { outline: 2px solid #2e7d32; }
  a.orig { font-size: .75rem; color: #666; display: inline-block; margin-top: .2rem; }
  td:last-child { width: 210px; }

  /* The overlay a thumbnail opens into. Hidden until a click, and never printed. */
  #zoom { display: none; position: fixed; inset: 0; z-index: 10;
          background: rgba(0,0,0,.85); cursor: zoom-out; }
  #zoom.open { display: flex; align-items: center; justify-content: center; }
  #zoom img { max-width: 96vw; max-height: 96vh; box-shadow: 0 0 40px rgba(0,0,0,.6); }
  #zoom p { position: absolute; top: .6rem; left: .8rem; margin: 0;
            color: #fff; font-size: .8rem; opacity: .75; }
  @media print { #zoom { display: none !important; } button.thumb { cursor: default; } }
</style></head><body>
<h1>Test run summary</h1>
<p class="meta">${summaries.length - failed} of ${summaries.length} scenarios passed &middot;
journal <code>${escapeHtml(journalFile)}</code> &middot; generated ${new Date().toISOString()}<br>
Screenshots are embedded in this file: it can be moved, emailed or archived on its own.<br>
${shotsNote}</p>
${rows}
<div id="zoom"><p>Click anywhere, or press Escape, to close.</p><img alt="enlarged screenshot"></div>
<script>
  /* Click to enlarge. Absent (email, a stripped viewer) the thumbnails simply stay thumbnails. */
  (function () {
    var zoom = document.getElementById('zoom');
    var big = zoom.querySelector('img');
    document.querySelectorAll('button.thumb').forEach(function (b) {
      b.addEventListener('click', function () {
        big.src = b.getAttribute('data-full');
        zoom.classList.add('open');
      });
    });
    zoom.addEventListener('click', function () { zoom.classList.remove('open'); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') zoom.classList.remove('open');
    });
  })();
</script>
</body></html>`;
}

async function main(): Promise<void> {
  const arg = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const file = arg ?? latestJournal();

  if (!file || !fs.existsSync(file)) {
    console.error(
      `No run journal found. Run the tests first with: npm test\n` +
        `(looked in ${path.resolve(config.reportsDir)})`,
    );
    process.exit(1);
  }

  const records = readJournal(file);
  if (records.length === 0) {
    console.error(`The journal ${file} is empty.`);
    process.exit(1);
  }

  const summaries = summarise(records);
  const outDir = config.reportsDir;
  fs.mkdirSync(outDir, { recursive: true });

  const base = path.basename(file, '.jsonl').replace(/^journal-/, 'summary-');
  const mdFile = path.join(outDir, `${base}.md`);
  const htmlFile = path.join(outDir, `${base}.html`);

  fs.writeFileSync(mdFile, markdown(summaries, file, outDir), 'utf8');
  fs.writeFileSync(htmlFile, html(summaries, file, outDir), 'utf8');

  const failed = summaries.filter((s) => s.status === 'FAILED').length;
  console.log(`${summaries.length - failed} of ${summaries.length} scenarios passed.`);
  console.log(`  ${mdFile}`);
  console.log(`  ${htmlFile}`);

  const evidence = await writeEvidence(file, outDir, { pdf: !process.argv.includes('--no-pdf') });
  console.log(`  ${evidence.html}`);
  if (evidence.pdf) console.log(`  ${evidence.pdf}`);

  const repaired = summaries.reduce((n, s) => n + s.repaired.length, 0);
  if (repaired > 0) {
    console.log(`  ${repaired} step(s) were repaired during the run. See the summary.`);
  }
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exit(1);
});
