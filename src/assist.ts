/**
 * Assisted mode: what happens when a step cannot resolve.
 *
 * This is the heart of the engine. A blocked test is the expected outcome, not
 * the exception, so blocking is designed for:
 *
 *   1. the browser stays open, paused on the exact screen where the step failed (C1)
 *   2. a banner is injected into that page, carrying the explanation, every actionable label on
 *      screen, and the Resume button (C2)
 *   3. the tester performs the action themselves, in that window
 *   4. whatever they click is captured by its accessible name
 *   5. they press Resume, the blueprint file is updated from what they clicked, and the run
 *      continues at the next step
 *
 * Step 4 is the whole point: the correction the tester was going to make anyway becomes reusable
 * knowledge, at no extra cost. The test file is a draft; the run is the compiler.
 *
 * Two things are deliberately absent. There is no central interface: with several tests paused at
 * once a single terminal prompt cannot ask which one, and the tester is already in the window that
 * matters (C2). And there is no attempt to repeat the action after the repair: the tester has just
 * performed it by hand, and clicking Save twice is worse than not clicking it at all.
 */

import fs from 'node:fs';
import type { Frame, Page } from '@playwright/test';
import { visibleLabels } from './locate';

/** Set on the paused page by the banner, read back by the engine. Kept flat on purpose. */
type PageState = {
  resumed: boolean;
  stopped: boolean;
  picked: string | null;
};

export type PauseRequest = {
  page: Page;
  scenario: string;
  stepIndex: number;
  stepCount: number;
  /** Human description of the step, as it appears in the report. */
  stepDescription: string;
  /** The label that could not be found. */
  wantedLabel: string;
  /** The full explanation from the resolution chain, shown in the terminal. */
  explanation: string;
  pollMs?: number;
};

export type PauseOutcome =
  | { action: 'resume'; picked?: string }
  | { action: 'stop' };

const BANNER_ID = '__blueprint_banner';

/**
 * Pause on the failing screen and wait for a human.
 *
 * There is no timeout here, and that is not an oversight: a test waiting for a person can wait for
 * as long as the person needs. The per test timeout is disabled in playwright.config.ts for the
 * same reason (C3). Forgetting that makes assisted mode fail after ten minutes in a way that looks
 * like a random flake rather than a missing setting.
 */
export async function pauseForHuman(request: PauseRequest): Promise<PauseOutcome> {
  const { page } = request;
  const pollMs = request.pollMs ?? 300;

  const labels = await visibleLabels(page).catch(() => [] as string[]);

  // The terminal copy matters for `playwright test --ui`, where several tests are visible at once
  // and this is how the tester learns which window to go to.
  console.log('');
  console.log(`PAUSED  ${request.scenario}  step ${request.stepIndex} of ${request.stepCount}`);
  console.log(`        ${request.stepDescription}`);
  console.log(request.explanation);
  console.log('        The browser window is open on the failing screen. Do the action there,');
  console.log('        then click Resume in the banner at the top of the page.');
  console.log('');

  await install(page, request, labels);

  for (;;) {
    const state = await readState(page).catch(() => null);

    if (state?.stopped) {
      await removeBanner(page);
      return { action: 'stop' };
    }
    if (state?.resumed) {
      const picked = state.picked && state.picked !== request.wantedLabel ? state.picked : undefined;
      await removeBanner(page);
      return picked ? { action: 'resume', picked } : { action: 'resume' };
    }

    // A click of the tester's may have navigated the page out from under the banner. Put it back
    // rather than leaving them with no way to resume.
    if (!(await hasBanner(page))) {
      await install(page, request, await visibleLabels(page).catch(() => labels)).catch(
        () => undefined,
      );
    }

    await page.waitForTimeout(pollMs).catch(() => undefined);
  }
}

/**
 * Rewrite one step's label in the blueprint file, in place, as text.
 *
 * Deliberately a surgical text edit rather than a parse and re serialise. A converted blueprint is
 * full of comments (`# INFERRED label ...`, `# NOT CONVERTED ...`) that carry most of what a human
 * needs to review it, and every YAML library in existence throws them away on the way out.
 *
 * Returns false when the label could not be located in the file, which is not a failure: the run
 * continues, the repair simply is not persisted, and the report says so.
 */
export function repairBlueprintFile(
  file: string,
  stepIndex: number,
  oldLabel: string,
  newLabel: string,
): boolean {
  if (!fs.existsSync(file)) return false;

  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);

  // Find the line that opens the step. Steps are the sequence entries under `steps:`, so the
  // n-th line matching "- action:" is the n-th step, comments and blank lines notwithstanding.
  const starts: number[] = [];
  lines.forEach((line, i) => {
    if (/^\s*-\s+action:/.test(line)) starts.push(i);
  });

  const start = starts[stepIndex - 1];
  if (start === undefined) return false;
  const end = starts[stepIndex] ?? lines.length;

  const quoted = quote(newLabel);

  // The ordinary case: a step with its own `label:`.
  for (let i = start; i < end; i++) {
    const line = lines[i] ?? '';
    const m = /^(\s*)label:\s*(.*)$/.exec(line);
    if (m) {
      lines[i] = `${m[1]}label: ${quoted}`;
      fs.writeFileSync(file, lines.join('\n'), 'utf8');
      return true;
    }
  }

  // A navigate path has no `label:`, it has a list. Replace the entry that failed, wherever it is
  // in that list, so a renamed menu entry is repaired like anything else.
  for (let i = start; i < end; i++) {
    const line = lines[i] ?? '';
    if (line.includes(quote(oldLabel))) {
      lines[i] = line.replace(quote(oldLabel), quoted);
      fs.writeFileSync(file, lines.join('\n'), 'utf8');
      return true;
    }
  }

  return false;
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// ---------------------------------------------------------------------------- the page side

async function hasBanner(page: Page): Promise<boolean> {
  return page
    .evaluate((id) => Boolean(document.getElementById(id)), BANNER_ID)
    .catch(() => false);
}

async function removeBanner(page: Page): Promise<void> {
  await page
    .evaluate((id) => {
      document.getElementById(id)?.remove();
      const w = window as unknown as { __blueprintPad?: string };
      if (w.__blueprintPad !== undefined) {
        document.body.style.paddingTop = w.__blueprintPad;
        delete w.__blueprintPad;
      }
    }, BANNER_ID)
    .catch(() => undefined);
}

async function readState(page: Page): Promise<PageState | null> {
  const main = await page
    .evaluate(() => (window as unknown as { __blueprint?: PageStateLike }).__blueprint ?? null)
    .catch(() => null);
  if (!main) return null;

  // A click inside an iframe never reaches the outer document, so each frame keeps its own
  // record and the first one holding a pick wins.
  if (!main.picked) {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      const picked = await frame
        .evaluate(() => (window as unknown as { __blueprint?: PageStateLike }).__blueprint?.picked ?? null)
        .catch(() => null);
      if (picked) return { ...main, picked };
    }
  }

  return main;
}

type PageStateLike = { resumed: boolean; stopped: boolean; picked: string | null };

async function install(page: Page, request: PauseRequest, labels: string[]): Promise<void> {
  const payload = {
    bannerId: BANNER_ID,
    title: `Paused at step ${request.stepIndex} of ${request.stepCount}`,
    step: request.stepDescription,
    wanted: request.wantedLabel,
    scenario: request.scenario,
    labels: labels.slice(0, 60),
  };

  await page.evaluate(installInPage, payload).catch(() => undefined);

  // The listener goes into every document, because the control the tester clicks may well be
  // inside an embedded one. The banner itself stays in the main document, where they can see it.
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    await installListenerInFrame(frame).catch(() => undefined);
  }
}

async function installListenerInFrame(frame: Frame): Promise<void> {
  await frame.evaluate(installListenerSource);
}

/**
 * Runs in the browser. Written as one self contained function with no imports and no optional
 * chaining beyond what every supported browser has, because it is serialised and evaluated in a
 * page this code knows nothing about.
 */
function installInPage(data: {
  bannerId: string;
  title: string;
  step: string;
  wanted: string;
  scenario: string;
  labels: string[];
}): void {
  const w = window as unknown as {
    __blueprint?: { resumed: boolean; stopped: boolean; picked: string | null };
    __blueprintListener?: boolean;
  };
  if (!w.__blueprint) w.__blueprint = { resumed: false, stopped: false, picked: null };
  const state = w.__blueprint;

  const existing = document.getElementById(data.bannerId);
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.id = data.bannerId;
  banner.setAttribute(
    'style',
    [
      'position:fixed',
      'top:0',
      'left:0',
      'right:0',
      'z-index:2147483647',
      'background:#1f2933',
      'color:#fff',
      'font:13px/1.45 system-ui, sans-serif',
      'padding:10px 14px',
      'box-shadow:0 2px 10px rgba(0,0,0,.4)',
      'max-height:45vh',
      'overflow:auto',
    ].join(';'),
  );

  const picked = document.createElement('div');
  const refreshPicked = (): void => {
    picked.textContent = state.picked
      ? `You clicked: "${state.picked}". Resume will write that into the blueprint.`
      : 'Nothing captured yet. Do the action in this page, or pick a label below.';
    picked.setAttribute(
      'style',
      `margin:6px 0;padding:5px 8px;border-radius:3px;background:${
        state.picked ? '#2e7d32' : '#3b4652'
      }`,
    );
  };

  const head = document.createElement('div');
  head.setAttribute('style', 'font-weight:700;font-size:14px');
  head.textContent = `${data.title} - ${data.scenario}`;

  const detail = document.createElement('div');
  detail.setAttribute('style', 'margin:4px 0;opacity:.9');
  detail.textContent = `${data.step}. I could not find "${data.wanted}" on this page.`;

  const hint = document.createElement('div');
  hint.setAttribute('style', 'margin:4px 0;opacity:.75');
  hint.textContent =
    'Do the action yourself in this window, then click Resume. The run carries on at the next step.';

  const buttons = document.createElement('div');
  buttons.setAttribute('style', 'margin:8px 0');

  const resume = document.createElement('button');
  resume.textContent = 'Resume';
  resume.setAttribute(
    'style',
    'font:inherit;font-weight:700;padding:6px 16px;margin-right:8px;cursor:pointer;' +
      'background:#2e7d32;color:#fff;border:0;border-radius:3px',
  );
  resume.addEventListener('click', () => {
    state.resumed = true;
    banner.remove();
  });

  const stop = document.createElement('button');
  stop.textContent = 'Stop this test';
  stop.setAttribute(
    'style',
    'font:inherit;padding:6px 16px;cursor:pointer;background:#7d2e2e;color:#fff;' +
      'border:0;border-radius:3px',
  );
  stop.addEventListener('click', () => {
    state.stopped = true;
    banner.remove();
  });

  buttons.appendChild(resume);
  buttons.appendChild(stop);

  const list = document.createElement('div');
  list.setAttribute('style', 'margin-top:6px;opacity:.9');
  const listTitle = document.createElement('div');
  listTitle.textContent = 'Everything on this page right now. Click one to use it as the label:';
  listTitle.setAttribute('style', 'margin-bottom:4px;opacity:.75');
  list.appendChild(listTitle);

  data.labels.forEach((label) => {
    const chip = document.createElement('button');
    chip.textContent = label;
    chip.setAttribute(
      'style',
      'font:inherit;margin:2px 4px 2px 0;padding:3px 8px;cursor:pointer;background:#3b4652;' +
        'color:#fff;border:1px solid #55606c;border-radius:10px',
    );
    chip.addEventListener('click', () => {
      state.picked = label;
      refreshPicked();
    });
    list.appendChild(chip);
  });

  banner.appendChild(head);
  banner.appendChild(detail);
  banner.appendChild(hint);
  refreshPicked();
  banner.appendChild(picked);
  banner.appendChild(buttons);
  banner.appendChild(list);
  document.body.appendChild(banner);

  // Push the page down by exactly the height of the banner. A fixed overlay that covers the top
  // of the screen would hide the very control the tester has been asked to click, which is a
  // remarkably effective way to make a helpful message useless.
  const pad = window as unknown as { __blueprintPad?: string };
  if (pad.__blueprintPad === undefined) pad.__blueprintPad = document.body.style.paddingTop;
  document.body.style.paddingTop = `${banner.offsetHeight + 8}px`;

  // The listener that turns the tester's own click into the correction.
  if (!w.__blueprintListener) {
    w.__blueprintListener = true;
    document.addEventListener(
      'click',
      (event) => {
        const target = event.target as HTMLElement | null;
        if (!target) return;
        if (target.closest && target.closest(`#${data.bannerId}`)) return; // our own controls
        const name = accessibleName(target);
        if (name) {
          state.picked = name;
          refreshPicked();
        }
      },
      true,
    );
  }

  /** Best effort accessible name, walking up from what was actually clicked. */
  function accessibleName(element: HTMLElement): string | null {
    let node: HTMLElement | null = element;
    for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
      const el = node as HTMLElement & { placeholder?: string };

      const direct =
        el.getAttribute('aria-label') ||
        el.getAttribute('alt') ||
        el.getAttribute('title') ||
        el.placeholder ||
        '';
      if (direct.trim()) return direct.trim();

      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) {
        const text = labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id))
          .filter(Boolean)
          .map((n) => ((n as HTMLElement).innerText || '').trim())
          .join(' ')
          .trim();
        if (text) return text;
      }

      if (el.id) {
        const labels = document.querySelectorAll('label');
        for (let i = 0; i < labels.length; i++) {
          const label = labels[i] as HTMLLabelElement;
          if (label.htmlFor === el.id && label.innerText.trim()) return label.innerText.trim();
        }
      }

      const own = (el.innerText || '').trim().replace(/\s+/g, ' ');
      if (own && own.length < 60) return own;
    }
    return null;
  }
}

/**
 * The listener alone, for embedded documents. They get no banner: the tester reads and resumes in
 * the outer page, but the control they click may well live in here.
 */
function installListenerSource(): void {
  const w = window as unknown as {
    __blueprint?: { resumed: boolean; stopped: boolean; picked: string | null };
    __blueprintListener?: boolean;
  };
  if (!w.__blueprint) w.__blueprint = { resumed: false, stopped: false, picked: null };
  if (w.__blueprintListener) return;
  w.__blueprintListener = true;

  document.addEventListener(
    'click',
    (event) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      let node: HTMLElement | null = target;
      for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
        const el = node as HTMLElement & { placeholder?: string };
        const direct =
          el.getAttribute('aria-label') ||
          el.getAttribute('alt') ||
          el.getAttribute('title') ||
          el.placeholder ||
          '';
        if (direct.trim()) {
          w.__blueprint!.picked = direct.trim();
          return;
        }
        if (el.id) {
          const labels = document.querySelectorAll('label');
          for (let i = 0; i < labels.length; i++) {
            const label = labels[i] as HTMLLabelElement;
            if (label.htmlFor === el.id && label.innerText.trim()) {
              w.__blueprint!.picked = label.innerText.trim();
              return;
            }
          }
        }
        const own = (el.innerText || '').trim().replace(/\s+/g, ' ');
        if (own && own.length < 60) {
          w.__blueprint!.picked = own;
          return;
        }
      }
    },
    true,
  );
}
