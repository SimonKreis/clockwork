/**
 * Element resolution chain. This is the core of the project.
 *
 *   1. getByLabel(label)                exact visible form label
 *   2. getByRole(role, { name })        accessible name, role inferred from the action
 *   3. getByTitle(label)                the title attribute, which Fusion uses as a name
 *   4. getByPlaceholder(label)          Fusion search boxes are often placeholder only
 *   5. text adjacent                    the label text, then the nearest control after it
 *   6. hints                            a section name and an ordinal, applied to all of the above
 *
 * Then failure. There is no seventh strategy and no stored selector: since D11 resolution is 100
 * percent semantic, and a step whose label is wrong fails immediately instead of quietly working
 * against a selector that will rot at the next Oracle patch.
 *
 * The whole chain is run against the main document first, then against every embedded document in
 * turn (see searchRoots). An iframe is a page inside a page: a label living in the inner document
 * is invisible to a search of the outer one, whatever the search method. This is why frames are
 * handled here, in the engine, and never mentioned in a blueprint.
 */

import type { Frame, Locator, Page } from '@playwright/test';
import { config } from './config';
import type { Hints } from './types';

export type ResolutionMethod = 'label' | 'role' | 'title' | 'placeholder' | 'adjacent';

/**
 * What kind of element the action implies. Drives which strategies and ARIA roles are tried.
 *
 * `value` deserves a note. Reading a read only field is not the same as finding the text of its
 * label: in Fusion the label and the value are two separate elements, so looking for the label
 * text returns the label, not the value. The `value` kind therefore looks for the labelled control
 * first, then for the element that follows the label, and only falls back to the label itself.
 */
export type ElementKind = 'control' | 'input' | 'text' | 'value';

export type Resolution = {
  locator: Locator;
  method: ResolutionMethod;
  /** How many elements the winning strategy matched. Greater than 1 means the label is ambiguous. */
  matchCount: number;
  /** True when several elements matched and no index hint was given, so the first was assumed. */
  ambiguous: boolean;
  /** Set only when the element was found inside an embedded document, for the run journal. */
  frame?: string;
};

export type ResolveOptions = {
  label: string;
  kind: ElementKind;
  hints?: Hints;
  timeoutMs?: number;
};

export class ResolutionError extends Error {
  /** The label that could not be found. Assisted mode needs it to repair the step. */
  readonly label: string;
  readonly kind: ElementKind;

  constructor(message: string, label = '', kind: ElementKind = 'control') {
    super(message);
    this.name = 'ResolutionError';
    this.label = label;
    this.kind = kind;
  }
}

const ROLES: Record<ElementKind, string[]> = {
  // Clickable things, most specific first.
  control: ['button', 'link', 'menuitem', 'tab', 'option', 'checkbox', 'radio', 'treeitem', 'cell'],
  // Things you type into.
  input: ['textbox', 'combobox', 'searchbox', 'spinbutton'],
  // Things you only read.
  text: [],
  value: [],
};

/** Escape a string for embedding in an XPath literal, including strings containing quotes. */
export function xpathLiteral(value: string): string {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  return `concat('${value.split("'").join(`', "'", '`)}')`;
}

/**
 * Every document the chain is run against: the main one first, then each embedded one.
 *
 * Order matters. Searching the main document exhaustively before looking inside any frame keeps
 * the common case fast, and means a label that exists in both wins where the tester can see it.
 */
function searchRoots(page: Page): Frame[] {
  const main = page.mainFrame();
  try {
    return [main, ...page.frames().filter((f) => f !== main)];
  } catch {
    return [main];
  }
}

/** How a frame is named in the journal and in a failure message. Never a path, always readable. */
function describeFrame(page: Page, frame: Frame): string | undefined {
  if (frame === page.mainFrame()) return undefined;
  const name = frame.name();
  if (name) return `frame "${name}"`;
  const url = frame.url();
  return url ? `frame at ${url}` : 'embedded frame';
}

/**
 * Narrow the search to a named section when a hint asks for it. Tries the accessible containers
 * first, then a plain structural fallback. Returns the document itself when nothing matches, so a
 * wrong or stale section hint degrades into a full page search rather than a hard failure.
 */
async function scopeRoot(frame: Frame, hints?: Hints): Promise<Frame | Locator> {
  const section = hints?.section;
  if (!section) return frame;

  const candidates: Locator[] = [
    frame.getByRole('region', { name: section }),
    frame.getByRole('group', { name: section }),
    frame.getByRole('dialog', { name: section }),
    frame.getByRole('tabpanel', { name: section }),
    frame.locator(
      `xpath=//*[self::section or self::div or self::fieldset]` +
        `[.//*[normalize-space(text())=${xpathLiteral(section)}]]`,
    ),
  ];

  for (const candidate of candidates) {
    const n = await candidate.count().catch(() => 0);
    if (n > 0) return candidate.first();
  }
  return frame;
}

type Strategy = { method: ResolutionMethod; build: () => Locator };

/**
 * Build the ordered strategy list for one step. Exact matches come before loose ones so that a
 * label that is a prefix of another label ("Title" vs "Title Code") does not win by accident.
 */
function buildStrategies(root: Frame | Locator, label: string, kind: ElementKind): Strategy[] {
  const s: Strategy[] = [];
  const roles = ROLES[kind];

  if (kind === 'value') {
    // A labelled control that holds the value, read later with inputValue().
    s.push({ method: 'label', build: () => root.getByLabel(label, { exact: true }) });
    // The value sits next to its label. Sibling first, then anywhere after it.
    s.push({
      method: 'adjacent',
      build: () =>
        root.locator(
          `xpath=//*[normalize-space(text())=${xpathLiteral(label)}]` +
            `/following-sibling::*[normalize-space(.)!=''][1]`,
        ),
    });
    s.push({
      method: 'adjacent',
      build: () =>
        root.locator(
          `xpath=(//*[normalize-space(text())=${xpathLiteral(label)}]` +
            `/following::*[normalize-space(text())!=''][1])`,
        ),
    });
    s.push({ method: 'label', build: () => root.getByLabel(label, { exact: false }) });
    // Last resort: the label element itself, for the case where the label is the value.
    s.push({ method: 'adjacent', build: () => root.getByText(label, { exact: true }) });
    return s;
  }

  if (kind !== 'text') {
    s.push({ method: 'label', build: () => root.getByLabel(label, { exact: true }) });
    for (const role of roles) {
      s.push({ method: 'role', build: () => root.getByRole(role as never, { name: label, exact: true }) });
    }
    /**
     * The title attribute, exact, and it has to sit here: after every exact strategy and before
     * every loose one.
     *
     * Fusion leans on `title` where ARIA would be the modern choice. A Navigator group is a plain
     * div carrying title="My Team", with no role at all, while the little expand chevron beside it
     * is a real link whose accessible name is "Expand My Team". Run the loose role pass first and
     * that chevron wins on a substring, which is both the wrong element and an unclickable one,
     * since its own wrapper covers it. Exact before loose, the rule this list already follows,
     * puts the group back in front.
     */
    s.push({ method: 'title', build: () => root.getByTitle(label, { exact: true }) });
  }

  if (kind === 'input') {
    s.push({ method: 'placeholder', build: () => root.getByPlaceholder(label, { exact: true }) });
  }

  if (kind === 'text') {
    s.push({ method: 'adjacent', build: () => root.getByText(label, { exact: true }) });
  }

  // Loose pass. Fusion labels frequently carry a trailing colon, a required marker or padding.
  if (kind !== 'text') {
    s.push({ method: 'label', build: () => root.getByLabel(label, { exact: false }) });
    for (const role of roles) {
      s.push({ method: 'role', build: () => root.getByRole(role as never, { name: label, exact: false }) });
    }
    s.push({ method: 'title', build: () => root.getByTitle(label, { exact: false }) });
  }
  if (kind === 'input') {
    s.push({ method: 'placeholder', build: () => root.getByPlaceholder(label, { exact: false }) });
    // Find the label text, take the next input. Works where the label is not tied to the field.
    s.push({
      method: 'adjacent',
      build: () =>
        root.locator(
          `xpath=(//*[normalize-space(text())=${xpathLiteral(label)}]` +
            `/following::*[self::input or self::textarea][1])`,
        ),
    });
  }
  if (kind === 'control') {
    // A clickable element whose own text is the label, whatever tag Redwood chose for it.
    s.push({
      method: 'adjacent',
      build: () =>
        root.locator(
          `xpath=//*[self::a or self::button or self::td or self::div or self::span]` +
            `[normalize-space(text())=${xpathLiteral(label)}]`,
        ),
    });
  }
  if (kind === 'text') {
    s.push({ method: 'adjacent', build: () => root.getByText(label, { exact: false }) });
  }

  return s;
}

/** First visible element among the matches, honouring an index hint when the label is ambiguous. */
async function pick(
  locator: Locator,
  count: number,
  hints?: Hints,
): Promise<{ chosen: Locator; ambiguous: boolean } | null> {
  if (count === 1) {
    const only = locator.first();
    return (await only.isVisible().catch(() => false)) ? { chosen: only, ambiguous: false } : null;
  }

  if (hints?.index !== undefined) {
    const at = locator.nth(hints.index);
    return (await at.isVisible().catch(() => false)) ? { chosen: at, ambiguous: false } : null;
  }

  // No index given: take the first one that is actually visible, and flag the ambiguity so the
  // report tells the author to add a hint.
  const max = Math.min(count, 10);
  for (let i = 0; i < max; i++) {
    const at = locator.nth(i);
    if (await at.isVisible().catch(() => false)) return { chosen: at, ambiguous: true };
  }
  return null;
}

/** One pass of the whole chain over one document. Null when nothing matched. */
async function tryFrame(
  page: Page,
  frame: Frame,
  opts: ResolveOptions,
): Promise<Resolution | null> {
  const root = await scopeRoot(frame, opts.hints);
  const strategies = buildStrategies(root, opts.label, opts.kind);

  for (const strategy of strategies) {
    let locator: Locator;
    let count = 0;
    try {
      locator = strategy.build();
      count = await locator.count();
    } catch {
      // A detached frame, or a strategy this document cannot express. Try the next one.
      continue;
    }
    if (count === 0) continue;

    const picked = await pick(locator, count, opts.hints);
    if (!picked) continue;

    return {
      locator: picked.chosen,
      method: strategy.method,
      matchCount: count,
      ambiguous: picked.ambiguous,
      frame: describeFrame(page, frame),
    };
  }

  return null;
}

/**
 * Resolve one element. Polls the whole strategy chain, across every document, until something
 * matches or the budget runs out. That gives the chain the same "wait for the page to be ready"
 * behaviour Playwright's own locators have, without needing a wait step in the blueprint.
 */
export async function resolve(page: Page, opts: ResolveOptions): Promise<Resolution> {
  const budget = opts.timeoutMs ?? config.resolveTimeoutMs;
  const deadline = Date.now() + budget;

  for (;;) {
    for (const frame of searchRoots(page)) {
      const found = await tryFrame(page, frame, opts).catch(() => null);
      if (found) return found;
    }

    if (Date.now() >= deadline) break;
    await page.waitForTimeout(config.resolvePollMs);
  }

  throw new ResolutionError(await explainFailure(page, opts), opts.label, opts.kind);
}

/**
 * The failure message is a deliverable, not a stack trace. A functional consultant has to be able
 * to fix the blueprint from it without reading any code. Assisted mode shows the same information
 * in the paused page itself.
 */
export async function explainFailure(page: Page, opts: ResolveOptions): Promise<string> {
  const url = page.url();
  const wanted =
    opts.kind === 'input'
      ? 'a field to type into'
      : opts.kind === 'control'
        ? 'something to click'
        : 'some text to read';

  const lines = [
    `Could not find the element for label "${opts.label}".`,
    ``,
    `  What the step wanted : ${wanted}`,
    `  Label looked for     : "${opts.label}"`,
    `  Page                 : ${url}`,
    `  Searched             : the page and its ${Math.max(page.frames().length - 1, 0)} embedded frame(s),`,
    `                         by visible label, ARIA role and name, title, placeholder and adjacent text`,
  ];

  if (opts.hints?.section) lines.push(`  Restricted to section: "${opts.hints.section}"`);
  if (opts.hints?.index !== undefined) lines.push(`  Index hint           : ${opts.hints.index}`);

  const labels = await visibleLabels(page);

  // A short list of near misses turns "it broke" into "it is now called this".
  const similar = filterSimilar(labels, opts.label);
  if (similar.length > 0) {
    lines.push(
      ``,
      `  Labels currently visible on this page that look similar:`,
      ...similar.map((s) => `    - "${s}"`),
    );
  }

  if (labels.length > 0) {
    const shown = labels.slice(0, 30);
    lines.push(
      ``,
      `  Everything actionable on this page right now:`,
      ...shown.map((s) => `    - "${s}"`),
    );
    if (labels.length > shown.length) {
      lines.push(`    ... and ${labels.length - shown.length} more`);
    }
  }

  lines.push(
    ``,
    `  What to do: look at what this control is called now and update the "label" of this step`,
    `  in the blueprint. In assisted mode you can instead do the action in the paused browser`,
    `  window and click Resume: the engine will write the correction into the blueprint for you.`,
  );

  return lines.join('\n');
}

/**
 * Every label a person could act on right now, across the page and all of its frames.
 *
 * This is the raw material of both the failure message and the assisted mode banner. It is
 * deliberately generous: a name that looks useless to the engine may be exactly the one the
 * tester recognises.
 */
export async function visibleLabels(page: Page): Promise<string[]> {
  const collected: string[] = [];

  for (const frame of searchRoots(page)) {
    try {
      const texts = await frame.evaluate(() => {
        const out: string[] = [];
        const nodes = document.querySelectorAll(
          'label, button, a, summary, [role="button"], [role="link"], [role="menuitem"],' +
            ' [role="tab"], [role="option"], [role="checkbox"], [role="radio"],' +
            ' [aria-label], input[placeholder], select, textarea',
        );
        nodes.forEach((n) => {
          const el = n as HTMLElement & { placeholder?: string };
          // An element with no box is not on screen, whatever the DOM says.
          if (!el.getClientRects || el.getClientRects().length === 0) return;
          const t = (el.getAttribute('aria-label') || el.placeholder || el.innerText || '').trim();
          if (t && t.length < 60) out.push(t.replace(/\s+/g, ' '));
        });
        return out;
      });
      collected.push(...texts);
    } catch {
      // A frame that navigated away mid evaluation contributes nothing. Not a failure.
    }
  }

  return Array.from(new Set(collected));
}

/** Labels sharing a significant word with the one that was not found. */
function filterSimilar(labels: string[], label: string): string[] {
  const words = label
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((w) => w.length > 3);
  if (words.length === 0) return [];

  return labels
    .filter((t) => {
      const lower = t.toLowerCase();
      return lower !== label.toLowerCase() && words.some((w) => lower.includes(w));
    })
    .slice(0, 8);
}
