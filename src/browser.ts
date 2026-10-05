/**
 * Which browser to drive, when nobody said.
 *
 * The rule, in order:
 *
 *   1. BROWSER_EXECUTABLE or BROWSER_CHANNEL in .env, when set. An explicit choice always wins,
 *      and config.ts settles that before this module is asked anything.
 *   2. The user's own default browser, when it is Chromium based.
 *   3. Any Chromium based browser installed in the usual places.
 *   4. Nothing, which leaves Playwright's bundled Chromium.
 *
 * Why the user's own browser first. It is already installed, already trusted by the machine and
 * already allowed by whoever manages it, which is exactly what the bundled Chromium was not on the
 * first managed workstation this ran on: it could not open a window at all.
 *
 * Why only Chromium. Playwright can drive any Chromium build through its executable, but it cannot
 * drive an installed Firefox or Safari: those need Playwright's own patched builds. A default
 * browser that is one of those is skipped, and rule 3 applies.
 *
 * A run in the user's browser does not touch their browsing. Every run gets a fresh temporary
 * profile: no tabs, no history, no saved passwords, no extensions, and the window closes with the
 * test. Verified 2026-09-10 with Brave and with Edge, each launched headed while the same browser
 * was open with the user's own windows.
 *
 * The default browser is read from the registry on Windows only. On macOS and Linux rule 2 is
 * skipped and the scan in rule 3 does the work, which is less personal and still correct.
 *
 * BROWSER_AUTODETECT=false turns all of this off and goes straight to the bundled Chromium.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export type DetectedBrowser = {
  executablePath: string;
  /** For people: "Microsoft Edge", not "msedge.exe". */
  name: string;
  /** Why this one, shown by the interface and in error messages. */
  reason: string;
};

/**
 * Executable names of the Chromium builds Playwright can drive when installed, and what to call
 * them. Anything absent from this list, Firefox first of all, is not attempted.
 */
const CHROMIUM_BUILDS: Record<string, string> = {
  'chrome.exe': 'Google Chrome',
  'msedge.exe': 'Microsoft Edge',
  'brave.exe': 'Brave',
  'vivaldi.exe': 'Vivaldi',
  'opera.exe': 'Opera',
  'chromium.exe': 'Chromium',
  // macOS and Linux name them without an extension.
  'google chrome': 'Google Chrome',
  'microsoft edge': 'Microsoft Edge',
  'brave browser': 'Brave',
  vivaldi: 'Vivaldi',
  chromium: 'Chromium',
  'google-chrome': 'Google Chrome',
  'google-chrome-stable': 'Google Chrome',
  'microsoft-edge': 'Microsoft Edge',
  'brave-browser': 'Brave',
  'chromium-browser': 'Chromium',
};

/**
 * The display name of a drivable Chromium build, or null for anything Playwright cannot drive.
 *
 * Splits on both separators rather than using path.basename, so a Windows path is read correctly
 * whatever platform the check runs on.
 */
export function chromiumName(executablePath: string): string | null {
  const base = (executablePath.split(/[\\/]/).pop() ?? '').toLowerCase();
  return CHROMIUM_BUILDS[base] ?? null;
}

/** The ProgId in the output of `reg query ...\UserChoice /v ProgId`, in any display language. */
export function parseProgId(regOutput: string): string | null {
  const m = /ProgId\s+REG_SZ\s+(\S+)/i.exec(regOutput);
  return m?.[1] ?? null;
}

/**
 * The executable in the output of `reg query HKCR\<ProgId>\shell\open\command /ve`.
 *
 * Only the path matters, so the parse ignores the value name. That name is "(Default)" in English,
 * "(par défaut)" in French, and arrives with a mangled accent when reg.exe and Node disagree about
 * the code page, which they do.
 */
export function parseCommandExecutable(regOutput: string): string | null {
  const quoted = /"([^"]+?\.exe)"/i.exec(regOutput);
  if (quoted?.[1]) return quoted[1];
  const bare = /REG_SZ\s+(\S+?\.exe)/i.exec(regOutput);
  return bare?.[1] ?? null;
}

/** One registry query, or an empty string when it fails. No shell is involved. */
function reg(args: string[]): string {
  try {
    return execFileSync('reg', ['query', ...args], {
      encoding: 'latin1',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
      windowsHide: true,
    });
  } catch {
    return '';
  }
}

/** The executable of the browser Windows opens links with, if it can be found. */
function windowsDefault(): string | null {
  const choice =
    'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice';
  const progId =
    parseProgId(reg([choice, '/v', 'ProgId'])) ??
    parseProgId(reg([choice.replace('\\https\\', '\\http\\'), '/v', 'ProgId']));
  if (!progId) return null;
  const exe = parseCommandExecutable(reg([`HKCR\\${progId}\\shell\\open\\command`, '/ve']));
  return exe && fs.existsSync(exe) ? exe : null;
}

/** Where Chromium browsers usually live, per platform, in a rough order of popularity. */
function candidates(): string[] {
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
    const pf = process.env.ProgramFiles ?? 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    return [
      path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(pf, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      path.join(local, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      path.join(local, 'Vivaldi', 'Application', 'vivaldi.exe'),
      path.join(local, 'Programs', 'Opera', 'opera.exe'),
    ];
  }
  if (process.platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Vivaldi.app/Contents/MacOS/Vivaldi',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];
  }
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/microsoft-edge',
    '/usr/bin/brave-browser',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
}

function detect(): DetectedBrowser | null {
  if (process.env.BROWSER_AUTODETECT === 'false') return null;

  let skipped = '';
  if (process.platform === 'win32') {
    const exe = windowsDefault();
    if (exe) {
      const name = chromiumName(exe);
      if (name) return { executablePath: exe, name, reason: 'your default browser' };
      // Firefox, most likely. Say so, so the reader knows their choice was seen and why it lost.
      skipped = exe.split(/[\\/]/).pop() ?? exe;
    }
  }

  for (const file of candidates()) {
    if (!fs.existsSync(file)) continue;
    return {
      executablePath: file,
      name: chromiumName(file) ?? path.basename(file),
      reason: skipped
        ? `installed; your default browser (${skipped}) cannot be driven by Playwright`
        : 'installed',
    };
  }
  return null;
}

let cached: DetectedBrowser | null | undefined;

/** The browser to drive when .env names none, decided once per process. Null means bundled. */
export function detectBrowser(): DetectedBrowser | null {
  if (cached === undefined) cached = detect();
  return cached;
}
