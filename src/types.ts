/**
 * Blueprint schema v0.2.
 *
 * A blueprint describes a test the way a functional consultant would describe it: the visible
 * labels on screen, in order. It carries no selector at all, and never has. Since D11 there is not
 * even a field for one: resolution is 100 percent semantic, and the only permitted disambiguation
 * is `hints`, which is a panel name and an ordinal.
 *
 * Gone since v0.1, and deliberately: `login`, `sessions`, `legacy_xpath`, `needs_verification`,
 * `password_var`. One test is one user session (D12) and the session is infrastructure (D13).
 */

/** Disambiguation when the same label appears more than once on a page. Human readable only. */
export type Hints = {
  /** Restrict the search to a named section, panel, region or dialog. */
  section?: string;
  /** Zero based. Which of the several matches to take. Only meaningful when the label is ambiguous. */
  index?: number;
};

/** Fields every element bearing step shares. */
type ElementStep = {
  /** The exact on screen label. This is the durable anchor, and the only one. */
  label: string;
  hints?: Hints;
  /** Free text carried into the report. Used by the converter to explain an inference. */
  note?: string;
  /** Per step override of the resolution budget. */
  timeout_ms?: number;
};

export type NavigateStep = {
  action: 'navigate';
  /**
   * An in application navigation path, each entry a visible label clicked in order.
   * Example: ["Navigator", "My Client Groups", "Learning", "Courses"].
   */
  path?: string[];
  /** Absolute or relative URL. Use sparingly: deep links are less durable than a navigation path. */
  url?: string;
  note?: string;
  timeout_ms?: number;
};

export type FillStep = ElementStep & {
  action: 'fill';
  /** Literal, or a data reference such as "{{title}}", or a generator such as "{{random_string(6)}}". */
  value: string;
  /** Press Enter after filling. Some Fusion search boxes need it. */
  press_enter?: boolean;
};

export type SelectStep = ElementStep & {
  action: 'select';
  /** The value to type, and the visible option text to pick from the list. */
  value: string;
  /**
   * How the control behaves.
   *
   * `lov` (the default) is a type ahead list of values: type, wait for the asynchronous list,
   * click the option. `dropdown` is a plain choice list that is opened rather than typed into,
   * which is the legacy platform's `select from dropdown`. They look alike on screen and behave nothing alike.
   */
  mode?: 'lov' | 'dropdown';
  /** How the option text is matched in the list. Defaults to exact. */
  match?: 'exact' | 'contains';
  /**
   * How the selection is confirmed when no option list appears. Fusion is inconsistent:
   * some list of values commit on Tab, some on Enter, some need the option clicked.
   * Defaults to 'auto', which tries the option list first and falls back to a key press.
   * Ignored in `dropdown` mode, where there is always a list to click.
   */
  commit?: 'auto' | 'tab' | 'enter' | 'click';
  /** Skip the post selection check that the field really holds the value. Default false. */
  skip_confirm?: boolean;
};

export type ClickStep = ElementStep & {
  action: 'click';
  /** Double click instead of a single one. The legacy platform's `double click on`. */
  double?: boolean;
};

/**
 * A key press that is not bound to a field, replacing the legacy platform's `click on single key`. With a `label`
 * the field is focused first, which is the legacy platform's `press tab key on`.
 */
export type PressKeyStep = {
  action: 'press_key';
  /** A Playwright key name: Tab, Enter, Escape, ArrowDown, PageDown, Control+A. */
  key: string;
  /** Optional. Focus this field first, then press. */
  label?: string;
  hints?: Hints;
  /** Press it more than once. Defaults to 1. */
  times?: number;
  note?: string;
  timeout_ms?: number;
};

export type RefreshStep = {
  action: 'refresh';
  note?: string;
  timeout_ms?: number;
};

export type CaptureStep = ElementStep & {
  action: 'capture';
  /** Variable name. Later steps reference it as "{{name}}", exactly like a data profile entry. */
  as: string;
};

export type VerifyStep = {
  action: 'verify';
  /** Check the value of a named field. */
  label?: string;
  equals?: string;
  contains?: string;
  /** Check that some text is present anywhere on the page. */
  text_contains?: string;
  hints?: Hints;
  note?: string;
  timeout_ms?: number;
};

export type WaitForStep = {
  action: 'wait_for';
  /** Wait for this text to appear or disappear. */
  text?: string;
  /** Wait for this labelled element to appear or disappear. */
  label?: string;
  state?: 'visible' | 'hidden';
  timeout_ms?: number;
  note?: string;
};

export type WindowStep = {
  action: 'switch_window' | 'close_window';
  /** switch_window only. 'new' waits for and switches to a popup, 'main' returns to the first page. */
  to?: 'new' | 'main';
  note?: string;
  timeout_ms?: number;
};

export type Step =
  | NavigateStep
  | FillStep
  | SelectStep
  | ClickStep
  | PressKeyStep
  | RefreshStep
  | CaptureStep
  | VerifyStep
  | WaitForStep
  | WindowStep;

export type StepAction = Step['action'];

export type Blueprint = {
  /** snake_case identifier. Also the test name in the report. */
  scenario: string;
  /** Traceability back to the legacy scenario or the ticket, for example "PROJ-1234". */
  source?: string;
  app?: string;
  area?: string;
  ui?: 'redwood' | 'adf' | 'mixed';
  description?: string;
  /** File name (without extension) in data/. */
  data_profile?: string;
  /**
   * The steps, in order, all performed by one person inside one already open session.
   * A legacy scenario that switched persona becomes several blueprints, chained by a human (D12).
   */
  steps?: Step[];
  /** Set by the loader, not by the author. */
  _file?: string;
};

/** One line of the run journal. This is the durable reporting artifact. */
export type JournalRecord = {
  run_id: string;
  scenario: string;
  source_ticket?: string;
  step_index: number;
  keyword: StepAction;
  label?: string;
  value_used?: string;
  status: 'passed' | 'failed' | 'skipped';
  /** How the element was found: label, role, placeholder, adjacent. */
  resolution_method?: string;
  /** Set when the element was found inside an embedded document rather than the main one. */
  resolution_frame?: string;
  /** True when the label matched several elements and an index had to be assumed. */
  ambiguous?: boolean;
  /** Set when a paused step was repaired by the tester and the blueprint updated (D14). */
  repaired_from?: string;
  screenshot_path?: string;
  duration_ms: number;
  url?: string;
  error_message?: string;
  /** Verbatim text of the Oracle error banner, when one was displayed. */
  oracle_error_text?: string;
  note?: string;
  timestamp: string;
};
