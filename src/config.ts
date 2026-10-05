/**
 * Runtime configuration, the production guard and the session file.
 *
 * Everything in this file is meant to be edited without touching the engine. The Oracle specific
 * lists (error indicators, list of values markup) are first drafts written before any contact with
 * a live environment; expect to refine them during the first real run. That is why they live here
 * and not scattered through the keyword modules.
 *
 * The values come from <workspace>/.env (D20), loaded below before anything reads a setting. There
 * are no credentials here and no login settings: a run signs in in its own window (D19), or, with
 * SESSION=saved, reuses a session captured once by `npm run auth` (D13).
 */

import path from 'node:path';
import { detectBrowser } from './browser';
import { APP_ROOT, loadWorkspaceEnv, workspacePaths, workspaceRoot } from './workspace';

// Before `config` below reads a single variable. The workspace is found without configuration, so
// this can happen first; see src/workspace.ts for why it has to.
loadWorkspaceEnv();

function env(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v ? Number.parseInt(v, 10) : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  /** Target environment. Never a production pod. Checked by assertNotProduction below. */
  baseUrl: env('ORACLE_BASE_URL', '') as string,

  /**
   * Which browser binary to drive. Both empty, the default, means the user's own default browser
   * when it is Chromium based, then any installed Chromium browser, and Playwright's bundled one
   * only as a last resort. The order and the reasons for it are in src/browser.ts.
   *
   * Two ways to point somewhere else, and only one of them may be set at a time:
   *
   *   BROWSER_CHANNEL    a channel Playwright knows by name: msedge, chrome, chrome-beta.
   *   BROWSER_EXECUTABLE an absolute path to any Chromium based browser, which is what Brave,
   *                      Vivaldi or a portable Chromium need since Playwright has no channel
   *                      name for them. Forward slashes, or doubled backslashes, in .env.
   *
   * This is not a preference. On a managed Windows workstation the bundled Chromium can refuse to
   * start headed with "spawn UNKNOWN" and a side by side configuration error while its headless
   * shell runs fine. Assisted mode needs a window, so on such a machine the bundled binary is
   * unusable. Verified on 2026-09-09: bundled Chromium headless yes, headed no; Brave and Edge
   * both yes. Any Chromium build the operating system already trusts will do.
   *
   * The executable wins when both are set, since a path is the more explicit of the two.
   */
  browserChannel: env('BROWSER_CHANNEL', '') as string,
  browserExecutable: env('BROWSER_EXECUTABLE', '') as string,

  /** Total budget for resolving one element across all strategies and all frames. */
  resolveTimeoutMs: envInt('RESOLVE_TIMEOUT_MS', 15000),

  /**
   * A pause after every step, so a person watching can follow what the engine does. Zero, the
   * default, runs at full speed; the local interface sets it with "slow down so I can follow".
   * Per step rather than Playwright's slowMo, on purpose: a pause between steps is what a person
   * follows, and it leaves the resolution chain's own timing untouched. Only when shown.
   */
  watchDelayMs: envInt('WATCH_DELAY_MS', 0),

  /**
   * How long the window stays up after the last step before it closes, so the final screen is seen
   * rather than vanishing mid glance. Only applied when the browser is shown.
   */
  endHoldMs: envInt('END_HOLD_MS', 3000),

  /** Poll interval while waiting for an element to appear. */
  resolvePollMs: 300,

  /** Screenshot every step. Turning this off defeats the purpose of the tool. */
  screenshotEveryStep: env('SCREENSHOT_EVERY_STEP', 'true') !== 'false',

  /**
   * Where run journals, screenshots and summaries go: <workspace>/reports, always an absolute path
   * (D20). REPORTS_DIR moves it, relative to the application folder; the self test uses that to
   * keep its synthetic output in selftest/.output, away from every workspace.
   */
  reportsDir: process.env.REPORTS_DIR
    ? path.resolve(APP_ROOT, process.env.REPORTS_DIR)
    : workspacePaths().reports,

  /**
   * How the engine notices that the captured session has expired, which it will, silently, every
   * few days. Without this check the first step fails with a confusing "label not found" against
   * a sign in page. Checked once, right after the opening navigation, never again.
   */
  session: {
    /** Anything matching these on the landing page means we are signed out, not signed in. */
    signedOutIndicators: [
      'input[type="password"]',
      '#userid',
      '[name="userid"]',
      '[name="pswd"]',
      // Identity first sign in, where the password field does not exist yet. Oracle IDCS asks for
      // the user name alone and only then shows a password, so every password based indicator
      // above misses it and the run fails on step 1 with "label not found" instead.
      '[name="username"]',
      'input[autocomplete="username"]',
    ],

    /**
     * Being somewhere other than the application at all, read from the address bar.
     *
     * This is the reliable half of the check, and it is not an element binding: when the pod
     * redirects to an identity provider, the top level URL leaves the pod entirely. The markup of
     * a sign in page is the provider's and changes with their releases; the fact that we are on
     * their host instead of Oracle's does not. Seen on 2026-09-09, where an expired session sent
     * the run to an IDCS signin URL whose only field was a user name.
     */
    signedOutUrlPatterns: [
      '/ui/v1/signin',
      '/oam/server/obrareq.cgi',
      '/adfauthentication',
      'identity.oraclecloud.com',
      'login.microsoftonline.com',
    ],
    /**
     * How long to keep looking for a sign in page after the document has finished loading.
     *
     * Every run pays this, once, and finds nothing in the normal case, so it is deliberately short:
     * a sign in form is present the moment its page loads, unlike an application shell that renders
     * progressively. Being wrong here is cheap in one direction only. Too short and an expired
     * session shows up as a paused step with a confusing message, which is recoverable; too long
     * and every scenario is slower for no benefit at all.
     */
    checkTimeoutMs: envInt('SESSION_CHECK_TIMEOUT_MS', 1500),
  },

  /**
   * List of values behaviour. This is the number one breakage point on Fusion and the main tuning
   * point after the first live run. The option containers below are a first draft covering Oracle
   * JET (Redwood) and classic ADF autosuggest markup.
   */
  lov: {
    optionContainers: [
      '[role="listbox"] [role="option"]',
      '[role="option"]',
      '.oj-listbox-result-label',
      '.oj-listbox-results li',
      '.oj-combobox-results li',
      'ul[role="listbox"] li',
      '.af_autoSuggest tr',
      'table.af_selectManyChoice td',
    ],
    /** How long to wait for the suggestion list to render before falling back to a key press. */
    optionTimeoutMs: envInt('LOV_OPTION_TIMEOUT_MS', 8000),
    /** How long to wait for the field to settle on the selected value. */
    confirmTimeoutMs: envInt('LOV_CONFIRM_TIMEOUT_MS', 5000),
    /** Per character typing delay. Fusion type ahead needs real key events, not a bulk fill. */
    typeDelayMs: envInt('LOV_TYPE_DELAY_MS', 40),
    pollMs: 250,
  },

  /**
   * Oracle error indicators, checked after every step. Detection only: the engine stops and
   * reports, it never tries to recover. Seeded with the common Fusion patterns, both Redwood
   * (Oracle JET messages) and classic ADF. Refine on first contact with the DEV environment.
   */
  errorIndicators: [
    '[role="alertdialog"]',
    '[role="alert"]',
    '.oj-messages .oj-message-summary',
    '.oj-message-summary',
    '.oj-form-control-message-error',
    '.AFErrorText',
    '.af_messages_error',
    '.p_AFError',
    'div[id$="::msgDlg"] .af_messages',
  ],

  /**
   * Text that appears inside an error container but does not mean an error. Matched case
   * insensitively as a substring. Keeps informational and confirmation banners from failing a run.
   */
  errorIgnorePatterns: [
    'confirmation',
    'information',
    'successfully',
    'saved',
    'warning',
    'your changes were saved',
  ],

  /**
   * Production guard. Oracle Fusion pod hostnames are a trap: a DEV pod is legitimately named
   * something like `fa-xxxx-dev1-saasfaprod1.fa.ocs.oraclecloud.com`. A naive search for the
   * substring "prod" blocks the DEV environment. The guard therefore reads the environment token
   * from the first hostname label, where Oracle puts it, and requires it to be an approved one.
   */
  prodGuard: {
    /** The first hostname label must contain one of these tokens. */
    allowedEnvTokens: (env('ALLOWED_ENV_TOKENS', 'dev,test,uat,stage,stg,qa,sandbox') as string)
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    /** Any of these in the first hostname label blocks the run outright. */
    deniedEnvTokens: ['prod', 'prd', 'production', 'live'],
    /** Escape hatch for an unusual hostname. Requires a deliberate, documented decision. */
    allowUnrecognised: env('ALLOW_UNRECOGNISED_HOST', 'false') === 'true',
  },
} as const;

/**
 * The launch options that select the browser binary, or nothing at all for the bundled Chromium.
 *
 * Kept in one place so `npm run auth`, a test run and the interface's session check always drive
 * the same browser. That keeps the browser that captured a session and the one replaying it
 * identical, which removes one variable the day Oracle refuses a session nobody expected it to.
 *
 * An explicit choice in .env wins; otherwise src/browser.ts picks the user's default browser.
 * Never returns both keys. Playwright rejects a channel and an executable path together.
 */
export function browserLaunchOverrides(): { channel?: string; executablePath?: string } {
  if (config.browserExecutable) return { executablePath: config.browserExecutable };
  if (config.browserChannel) return { channel: config.browserChannel };
  const found = detectBrowser();
  return found ? { executablePath: found.executablePath } : {};
}

/**
 * The workspace: blueprints, data, exports, reports and the configuration itself (D20).
 *
 * The folder next to the application called clockwork-workspace, unless BLUEPRINT_WORKSPACE is set
 * in the environment, absolute or relative to the application folder. The offline self test points
 * it at `selftest/`, which makes the whole suite self contained. See src/workspace.ts.
 */
export function workspaceDir(rootDir: string): string {
  return workspaceRoot(rootDir);
}

/**
 * Absolute path of the captured session file, used with SESSION=saved only.
 *
 * <workspace>/.auth/storageState.json by default. Read from the environment on every call rather
 * than frozen into `config` at import time, which is what lets the self test point at a session
 * that does not exist and check that the engine says "run npm run auth" instead of failing on
 * step 1 against a sign in page.
 */
export function storageStateFile(rootDir: string): string {
  const configured = env('STORAGE_STATE');
  return configured
    ? path.resolve(rootDir, configured)
    : path.join(workspacePaths(workspaceDir(rootDir)).auth, 'storageState.json');
}

/**
 * Whether a step that cannot resolve pauses for a human instead of failing (D14).
 *
 * On by default, because that is the product: a blocked test waits for the tester, keeps its
 * browser open on the failing screen, and learns from the correction. Set ASSIST=false for a run
 * nobody is watching, where the honest outcome is a red test and a report.
 *
 * Read from the environment on every call so a single test can turn it on or off around itself.
 */
export function assistEnabled(): boolean {
  return env('ASSIST', 'true') !== 'false';
}

export type SessionMode = 'window' | 'saved';

/**
 * How a run gets inside the application (D19).
 *
 * `window`, the default: the run opens on the sign in page, a person signs in in that window, the
 * scenario continues there, and nothing about the session outlives the window. No file, nothing
 * to expire, nothing to leak.
 *
 * `saved`: the earlier model (D13). `npm run auth` captures a session to a gitignored file and
 * every run reuses it. It exists for the one case the window cannot serve, a hidden run, where
 * nobody is there to sign in. Read on every call, like assistEnabled.
 */
export function sessionMode(): SessionMode {
  return env('SESSION', 'window') === 'saved' ? 'saved' : 'window';
}

export class ProductionGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductionGuardError';
  }
}

/**
 * Refuses to run against anything that is not recognisably a non production Oracle pod.
 * Called before the first navigation of every run.
 */
export function assertNotProduction(rawUrl: string): void {
  if (!rawUrl) {
    throw new ProductionGuardError(
      `ORACLE_BASE_URL is not set. Fill in the DEV pod URL in ${path.join(workspaceRoot(), '.env')}.`,
    );
  }

  let host: string;
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    throw new ProductionGuardError(`ORACLE_BASE_URL is not a valid URL: ${rawUrl}`);
  }

  // Oracle encodes the environment in the first label, for example: fa-xxxx-dev1-saasfaprod1
  const firstLabel = host.split('.')[0] ?? '';
  const { allowedEnvTokens, deniedEnvTokens, allowUnrecognised } = config.prodGuard;

  for (const denied of deniedEnvTokens) {
    // Match the token as its own dash separated segment, so `saasfaprod1` in the pod suffix does
    // not trip the guard while a real `-prod-` segment does.
    const segments = firstLabel.split('-');
    if (segments.some((s) => s === denied || s.replace(/\d+$/, '') === denied)) {
      throw new ProductionGuardError(
        `Refusing to run: host "${host}" looks like a production environment ` +
          `(segment "${denied}" in "${firstLabel}"). This engine never runs against production.`,
      );
    }
  }

  const looksAllowed = allowedEnvTokens.some((tok) =>
    firstLabel.split('-').some((s) => s === tok || s.replace(/\d+$/, '') === tok),
  );

  if (!looksAllowed && !allowUnrecognised) {
    throw new ProductionGuardError(
      `Refusing to run: host "${host}" does not carry a recognised non production token ` +
        `(${allowedEnvTokens.join(', ')}) in its first label "${firstLabel}". ` +
        `If this really is a test environment, either add its token to ALLOWED_ENV_TOKENS ` +
        `or set ALLOW_UNRECOGNISED_HOST=true in .env, deliberately.`,
    );
  }
}
