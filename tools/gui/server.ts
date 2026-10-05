/**
 * npm run gui
 *
 * A local page that does what the commands do, for the person who does not want a terminal.
 *
 * Why this exists, and why it is not a dashboard. D15 and C4 settled that supervision stays in
 * `playwright test --ui` and in the banner assisted mode injects into the Oracle page itself, and
 * that remains true: nothing here watches a run over somebody's shoulder or notifies anyone. What
 * D15 never examined is **starting** one. Every entry point to this engine is a terminal command,
 * and the person this tool is built for maintains Oracle configurations, not software. That is the
 * demonstrated gap D15 asks to be named before anything custom is built, and this is scoped to it:
 * choose scenarios, fill the data they need, run them, read the report.
 *
 * The design rule that keeps it honest: **this server runs the existing entry points and reads the
 * journal.** It contains no second copy of the engine, no alternative code path, and nothing a run
 * from the command line would not also do. If it disappeared tomorrow, nothing would be lost but
 * the convenience.
 *
 * There is no password field, here or anywhere. A run signs in in its own window (D19); the Sign in
 * button, which spawns `npm run auth`, exists only for SESSION=saved.
 *
 * It creates the workspace on first start (D20) and says where it is. It listens on the loopback
 * address only. It is a local tool, not a service.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  config,
  storageStateFile,
  browserLaunchOverrides,
  workspaceDir,
  sessionMode,
} from '../../src/config';
import { blueprintFiles, blueprintsDir, loadBlueprint } from '../../src/blueprint';
import { readJournal } from '../../src/journal';
import { dataProfileFile, dataProfileNames, readProfile, writeProfileValues } from '../../src/profile';
import type { JournalRecord } from '../../src/types';
import { chromium, type Browser } from '@playwright/test';
import { isSignedOutUrl } from '../../src/interpreter';
import { detectBrowser } from '../../src/browser';
import {
  describeEnsure,
  ensureWorkspace,
  legacyInApp,
  workspacePaths,
  WorkspaceMissingError,
} from '../../src/workspace';

const rootDir = path.resolve(__dirname, '..', '..');
const port = Number.parseInt(process.env.GUI_PORT ?? '4400', 10) || 4400;
const host = '127.0.0.1';

// Before anything is listed or run: the workspace is completed if it exists, and a missing one
// stops the server rather than being created next to wherever the real one went (D21).
const prepared = (() => {
  try {
    return ensureWorkspace(workspaceDir(rootDir), rootDir);
  } catch (error) {
    if (!(error instanceof WorkspaceMissingError)) throw error;
    console.error(`\n${error.message}\n`);
    process.exit(1);
  }
})();

// ---------------------------------------------------------------------------- run state

type RunKind = 'auth' | 'test';
type RunStatus = 'running' | 'passed' | 'failed' | 'stopped';

type Run = {
  id: string;
  kind: RunKind;
  /** The scenarios of a test run, in the order they were chosen. */
  scenarios: string[];
  status: RunStatus;
  startedAt: string;
  /** Everything the child wrote, kept so a page opened late still sees the whole run. */
  output: string[];
  /** Journal records as they are appended by the engine, in order. */
  records: JournalRecord[];
  journalFile?: string;
  exitCode?: number;
};

let current: Run | null = null;
let child: ChildProcess | null = null;
let journalOffset = 0;
let journalTimer: NodeJS.Timeout | null = null;

/** Open server sent event streams. A run pushes to all of them and forgets about them. */
const listeners = new Set<http.ServerResponse>();

function broadcast(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of listeners) res.write(payload);
}

function say(line: string): void {
  if (!current) return;
  current.output.push(line);
  broadcast('output', { line });
}

/**
 * Read whatever the engine has appended to the journal since the last look.
 *
 * Polling a file rather than instrumenting the engine is deliberate: the journal is already the
 * durable record every report is generated from, so following it costs the engine nothing and
 * cannot change how a run behaves. A run started from a terminal writes exactly the same file.
 */
function pollJournal(): void {
  const run = current;
  if (!run?.journalFile || !fs.existsSync(run.journalFile)) return;

  const size = fs.statSync(run.journalFile).size;
  if (size <= journalOffset) return;

  const fd = fs.openSync(run.journalFile, 'r');
  const buffer = Buffer.alloc(size - journalOffset);
  fs.readSync(fd, buffer, 0, buffer.length, journalOffset);
  fs.closeSync(fd);
  journalOffset = size;

  for (const line of buffer.toString('utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line) as JournalRecord;
      run.records.push(record);
      broadcast('step', record);
    } catch {
      // A half written last line. The next poll reads it whole.
      journalOffset -= Buffer.byteLength(line, 'utf8');
      return;
    }
  }
}

function finish(status: RunStatus, code: number | null): void {
  if (!current) return;
  pollJournal();
  if (journalTimer) clearInterval(journalTimer);
  journalTimer = null;
  current.status = status;
  current.exitCode = code ?? undefined;
  broadcast('done', { status, exitCode: code, runId: current.id });
  child = null;
}

/** A run id in the shape the engine uses, so the journal file is named the same way. */
function newRunId(): string {
  const n = new Date();
  const p = (v: number) => String(v).padStart(2, '0');
  return (
    `${n.getFullYear()}${p(n.getMonth() + 1)}${p(n.getDate())}` +
    `-${p(n.getHours())}${p(n.getMinutes())}${p(n.getSeconds())}`
  );
}

/**
 * Start a child process, without a shell.
 *
 * Node is invoked directly on the package entry points rather than through npm or npx: on Windows
 * those are .cmd files, which Node refuses to spawn without a shell, and a shell would put a
 * scenario name typed in a browser on a command line. Nothing here is ever interpolated into a
 * string that a shell will parse.
 */
function start(kind: RunKind, args: string[], env: NodeJS.ProcessEnv, scenarios: string[] = []): Run {
  const run: Run = {
    id: (env.BLUEPRINT_RUN_ID as string | undefined) ?? newRunId(),
    kind,
    scenarios,
    status: 'running',
    startedAt: new Date().toISOString(),
    output: [],
    records: [],
  };
  current = run;
  journalOffset = 0;

  if (kind === 'test') {
    run.journalFile = path.resolve(rootDir, config.reportsDir, `journal-${run.id}.jsonl`);
    journalTimer = setInterval(pollJournal, 400);
  }

  child = spawn(process.execPath, args, {
    cwd: rootDir,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const onData = (buf: Buffer) => {
    for (const line of buf.toString('utf8').split(/\r?\n/)) {
      if (line.trim()) say(line);
    }
  };
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);

  child.on('error', (error) => {
    say(`Could not start the process: ${error.message}`);
    finish('failed', null);
  });
  child.on('close', (code) => {
    finish(code === 0 ? 'passed' : run.status === 'stopped' ? 'stopped' : 'failed', code);
  });

  broadcast('started', publicRun(run));
  return run;
}

function publicRun(run: Run | null): unknown {
  if (!run) return null;
  return {
    id: run.id,
    kind: run.kind,
    scenarios: run.scenarios,
    status: run.status,
    startedAt: run.startedAt,
    exitCode: run.exitCode,
    output: run.output,
    records: run.records,
  };
}

// ---------------------------------------------------------------------------- what the page shows

function describeBrowser(): string {
  if (config.browserExecutable) return `${path.basename(config.browserExecutable)}, set in .env`;
  if (config.browserChannel) return `${config.browserChannel}, set in .env`;
  const found = detectBrowser();
  return found ? `${found.name}, ${found.reason}` : "Playwright's bundled Chromium";
}

// ---------------------------------------------------------------------------- is the session alive

type SessionCheck = { valid: boolean | null; detail: string };
let pendingCheck: Promise<SessionCheck> | null = null;

/**
 * Ask Oracle whether the saved session still works, rather than guessing from the file's age.
 * Only meaningful with SESSION=saved; in the default window model there is no saved session.
 *
 * Read only: it opens the application with the saved cookies and looks at where it landed. It
 * never writes the session file, so it cannot make a good session worse.
 */
function checkSession(): Promise<SessionCheck> {
  if (pendingCheck) return pendingCheck;
  pendingCheck = (async (): Promise<SessionCheck> => {
    const file = storageStateFile(rootDir);
    if (!fs.existsSync(file)) return { valid: false, detail: 'No session has been captured yet.' };
    if (!config.baseUrl) return { valid: null, detail: 'ORACLE_BASE_URL is not set in .env.' };
    let browser: Browser | null = null;
    try {
      browser = await chromium.launch({ headless: true, ...browserLaunchOverrides() });
      const context = await browser.newContext({ storageState: file, ignoreHTTPSErrors: true });
      const page = await context.newPage();
      await page.goto(config.baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForLoadState('load', { timeout: 30000 }).catch(() => undefined);
      if (isSignedOutUrl(page.url())) {
        return { valid: false, detail: 'Oracle sent the browser to its sign in page.' };
      }
      for (const selector of config.session.signedOutIndicators) {
        if (await page.locator(selector).first().isVisible().catch(() => false)) {
          return { valid: false, detail: 'Oracle is showing its sign in form.' };
        }
      }
      return { valid: true, detail: 'Oracle accepted the saved session just now.' };
    } catch (error) {
      const first = (error as Error).message.split(String.fromCharCode(10))[0];
      return { valid: null, detail: `Could not reach the environment: ${first}` };
    } finally {
      await browser?.close().catch(() => undefined);
    }
  })().finally(() => {
    pendingCheck = null;
  });
  return pendingCheck;
}

function listBlueprints(): unknown[] {
  return blueprintFiles(rootDir).map((file) => {
    try {
      const bp = loadBlueprint(file);
      return {
        scenario: bp.scenario,
        file: path.basename(file),
        source: bp.source ?? '',
        description: (bp.description ?? '').trim(),
        dataProfile: bp.data_profile ?? '',
        steps: bp.steps?.length ?? 0,
        error: '',
      };
    } catch (error) {
      // A blueprint that will not load is shown as itself, not hidden. Playwright loads every
      // blueprint at collection time, so one broken file blocks every run until it is fixed, and
      // the page has to say which file rather than leaving the operator to guess.
      return {
        scenario: path.basename(file),
        file: path.basename(file),
        source: '',
        description: '',
        dataProfile: '',
        steps: 0,
        error: (error as Error).message,
      };
    }
  });
}

function state(): unknown {
  const sessionFile = storageStateFile(rootDir);
  const exists = fs.existsSync(sessionFile);
  const ws = workspacePaths(workspaceDir(rootDir));
  return {
    baseUrl: config.baseUrl,
    workspace: {
      root: ws.root,
      env: ws.env,
      // Anything of the user's still in the application folder, ignored there and worth moving.
      legacy: legacyInApp(rootDir),
    },
    blueprintsDir: blueprintsDir(rootDir),
    templatesDir: ws.templates,
    browser: describeBrowser(),
    assist: process.env.ASSIST !== 'false',
    sessionMode: sessionMode(),
    session: {
      present: exists,
      file: sessionFile,
      capturedAt: exists ? fs.statSync(sessionFile).mtime.toISOString() : null,
    },
    blueprints: listBlueprints(),
    profiles: dataProfileNames(rootDir),
    reports: recentReports(),
    run: publicRun(current),
  };
}

function recentReports(): unknown[] {
  const dir = path.resolve(rootDir, config.reportsDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^(summary|evidence)-.*\.(html|pdf)$/.test(f))
    .sort()
    .reverse()
    .slice(0, 15)
    .map((f) => ({ file: f, url: `/reports/${f}` }));
}

// ---------------------------------------------------------------------------- http

function send(res: http.ServerResponse, code: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(text);
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      // Nothing this page posts is large. A body that grows past this is not one of ours.
      if (raw.length > 1_000_000) reject(new Error('Request body too large.'));
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Body is not JSON.'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Refuse anything that did not come from this page.
 *
 * A server on localhost is reachable by any page the operator has open in the same browser, and a
 * request from one of those would arrive with an Origin header naming that site. Ours arrives with
 * our own origin, or with none at all when the page uses a same origin fetch. Cross origin writes
 * are the only thing this blocks, and they are the only thing worth blocking here.
 */
function sameOrigin(req: http.IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  return origin === `http://${host}:${port}` || origin === `http://localhost:${port}`;
}

/**
 * The Playwright grep for a selection: each name as a whole name, never as part of a longer one.
 *
 * Choosing `approve_invoice` must not also run `approve_invoice_2`, which a plain substring would.
 * Names are already restricted to letters, digits, underscore and hyphen, so none of them can carry
 * a regular expression of its own into the pattern.
 */
function grepFor(scenarios: string[]): string {
  return `(?<![A-Za-z0-9_-])(?:${scenarios.join('|')})(?![A-Za-z0-9_-])`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${host}:${port}`);
  const route = url.pathname;

  try {
    if (req.method === 'GET' && (route === '/' || route === '/index.html')) {
      const page = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(page);
      return;
    }

    if (req.method === 'GET' && route === '/api/state') {
      send(res, 200, state());
      return;
    }

    if (req.method === 'GET' && route === '/api/session') {
      send(res, 200, await checkSession());
      return;
    }

    if (req.method === 'GET' && route === '/api/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.write(`event: hello\ndata: ${JSON.stringify(publicRun(current))}\n\n`);
      listeners.add(res);
      req.on('close', () => listeners.delete(res));
      return;
    }

    if (req.method === 'GET' && route === '/api/profile') {
      const name = url.searchParams.get('name') ?? '';
      const file = dataProfileFile(rootDir, name);
      const { fields } = readProfile(file);
      send(res, 200, { name, file, fields });
      return;
    }

    if (req.method === 'GET' && route.startsWith('/reports/')) {
      serveReportAsset(res, route.slice('/reports/'.length));
      return;
    }

    if (req.method === 'POST') {
      if (!sameOrigin(req)) {
        send(res, 403, { error: 'Cross origin requests are refused.' });
        return;
      }
      const body = (await readBody(req)) as Record<string, unknown>;

      if (route === '/api/profile') {
        const name = String(body.name ?? '');
        const values = (body.values ?? {}) as Record<string, string>;
        const file = dataProfileFile(rootDir, name);
        const changed = writeProfileValues(file, values);
        send(res, 200, { changed, fields: readProfile(file).fields });
        return;
      }

      if (route === '/api/auth') {
        if (child) {
          send(res, 409, { error: 'Something is already running.' });
          return;
        }
        const run = start('auth', [tsxCli, path.join(rootDir, 'tools', 'capture-session.ts')], {});
        send(res, 200, publicRun(run));
        return;
      }

      if (route === '/api/run') {
        if (child) {
          send(res, 409, { error: 'Something is already running.' });
          return;
        }
        // One scenario or several; a lone "scenario" is still accepted from an older page.
        const requested = Array.isArray(body.scenarios) ? (body.scenarios as unknown[]) : [body.scenario];
        const scenarios = [...new Set(requested.map((s) => String(s ?? '')))];
        const bad = scenarios.find((s) => !/^[A-Za-z0-9_-]+$/.test(s));
        if (scenarios.length === 0 || bad !== undefined) {
          send(res, 400, { error: `"${bad ?? ''}" is not a scenario name.` });
          return;
        }
        /**
         * Hiding the browser and asking to be paused are mutually exclusive, and the combination
         * hangs rather than failing: assisted mode waits, with no timeout by design (C3), for a
         * person to act in a window that does not exist. The command line lets you make this
         * mistake. Here it is refused, since choosing both is two clicks away.
         */
        if (body.headless === true && body.assist !== false) {
          send(res, 400, {
            error:
              'Hiding the browser and pausing for help cannot both be on: a paused run waits ' +
              'for you to act in a window that would not exist. Turn one of the two off.',
          });
          return;
        }

        // In window mode each run signs in in its own window, so a hidden one can never start.
        if (sessionMode() === 'window' && body.headless === true) {
          send(res, 400, {
            error:
              'A hidden run cannot sign in: each run signs in in its own window. Show the browser, ' +
              'or set SESSION=saved in .env for hidden runs.',
          });
          return;
        }

        /**
         * The whole selection is one Playwright run, one journal and one report, and the scenarios
         * go one after the other: WORKERS stays at its default of 1. That costs the machine nothing
         * more than one scenario at a time does, and it keeps two scenarios from colliding on the
         * same Oracle data, which running them side by side would risk.
         */
        const runId = newRunId();
        const run = start(
          'test',
          [playwrightCli, 'test', '-g', grepFor(scenarios)],
          {
            BLUEPRINT_RUN_ID: runId,
            // Assisted and headed, the defaults, unless the page asked otherwise. A run nobody is
            // watching has to be asked for explicitly, here as on the command line.
            ASSIST: body.assist === false ? 'false' : 'true',
            HEADLESS: body.headless === true ? 'true' : 'false',
            // "Slow down so I can follow": a pause after every step, long enough to see it.
            WATCH_DELAY_MS: body.watch === true ? '700' : '0',
          },
          scenarios,
        );
        send(res, 200, publicRun(run));
        return;
      }

      if (route === '/api/stop') {
        if (!child || !current) {
          send(res, 200, { stopped: false });
          return;
        }
        current.status = 'stopped';
        child.kill();
        send(res, 200, { stopped: true });
        return;
      }

      if (route === '/api/report') {
        const runId = String(body.runId ?? '');
        if (!/^[0-9-]+$/.test(runId)) {
          send(res, 400, { error: 'Not a run id.' });
          return;
        }
        const journal = path.resolve(rootDir, config.reportsDir, `journal-${runId}.jsonl`);
        if (!fs.existsSync(journal) || readJournal(journal).length === 0) {
          send(res, 404, { error: 'That run wrote no journal, so there is nothing to report.' });
          return;
        }
        await generateReport(journal);
        send(res, 200, { url: `/reports/summary-${runId}.html` });
        return;
      }
    }

    send(res, 404, { error: `No route ${req.method} ${route}` });
  } catch (error) {
    send(res, 400, { error: (error as Error).message });
  }
});

/**
 * Serve a file from the reports directory, and only from there.
 *
 * The report links to its screenshots by relative path, so this has to serve subdirectories, which
 * is exactly where a "../../.env" would be aimed. Resolving the path and checking it still starts
 * inside the reports directory is the check, done on the resolved path rather than on the text.
 */
function serveReportAsset(res: http.ServerResponse, relative: string): void {
  const dir = path.resolve(rootDir, config.reportsDir);
  const file = path.resolve(dir, decodeURIComponent(relative));
  if (!file.startsWith(dir + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    send(res, 404, { error: 'No such report file.' });
    return;
  }
  const type = file.endsWith('.html')
    ? 'text/html; charset=utf-8'
    : file.endsWith('.png')
      ? 'image/png'
      : file.endsWith('.pdf')
        ? 'application/pdf'
        : file.endsWith('.md')
          ? 'text/markdown; charset=utf-8'
          : 'application/octet-stream';
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

/** Run the existing report generator, rather than growing a second one in here. */
function generateReport(journal: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [tsxCli, path.join(rootDir, 'tools', 'report.ts'), journal], {
      cwd: rootDir,
      env: process.env,
      stdio: 'ignore',
    });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('The report failed.'))));
  });
}

// ---------------------------------------------------------------------------- entry points

const tsxCli = require.resolve('tsx/cli');
const playwrightCli = require.resolve('@playwright/test/cli');

/** Open the page in whatever the operating system uses, and shrug if it cannot. */
function openInBrowser(target: string): void {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', target]]
      : process.platform === 'darwin'
        ? ['open', [target]]
        : ['xdg-open', [target]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    // The URL is printed below either way.
  }
}

/**
 * Starting it twice is the normal mistake, not an error worth a stack trace.
 *
 * The operator forgets it is already open, runs the command again, and Node's default answer is an
 * unhandled EADDRINUSE dump. Failure messages are product surface here, so say the useful thing:
 * it is already running, here is where, and here is how to move it if that is not what you meant.
 */
server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code !== 'EADDRINUSE') throw error;
  console.log('');
  console.log(`  Clockwork is already running at http://${host}:${port}/`);
  console.log('');
  console.log('  Nothing was started. Open that address, or stop the other one first.');
  console.log(`  To run a second copy alongside it: GUI_PORT=4401 npm run gui`);
  console.log('');
  if (process.env.GUI_OPEN !== 'false') openInBrowser(`http://${host}:${port}/`);
  process.exitCode = 0;
});

server.listen(port, host, () => {
  const target = `http://${host}:${port}/`;
  const ws = workspacePaths(prepared.root);
  console.log('');
  console.log(`  Clockwork is at ${target}`);
  console.log('');
  console.log(`  Workspace   : ${ws.root}`);
  console.log(`  Config      : ${ws.env}`);
  console.log(`  Environment : ${config.baseUrl || 'not set, fill ORACLE_BASE_URL in the file above'}`);
  console.log(`  Browser     : ${describeBrowser()}`);
  for (const line of describeEnsure(prepared)) console.log(`  ${line}`);
  console.log('');
  console.log('  Loopback only. Ctrl+C to stop.');
  console.log('');
  if (process.env.GUI_OPEN !== 'false') openInBrowser(target);
});
