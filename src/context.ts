/**
 * The state a keyword handler gets to work with. Deliberately small.
 */

import type { BrowserContext, Page } from '@playwright/test';
import type { ResolutionMethod } from './locate';
import type { DataProfile, Variables } from './data';

export type StepContext = {
  /** The page the next action applies to. `switch_window` reassigns it. */
  page: Page;
  browserContext: BrowserContext;
  /** The page the run started on, so `switch_window: main` can come back to it. */
  mainPage: Page;
  profile: DataProfile;
  /** Values produced by `capture` steps. Shared with the data profile namespace. */
  variables: Variables;
  /** Repository root, used to find data profiles. */
  rootDir: string;
};

/** What a handler tells the interpreter so it can be written into the run journal. */
export type KeywordResult = {
  resolutionMethod?: ResolutionMethod;
  /** Set when the element was found inside an embedded document rather than the main one. */
  resolutionFrame?: string;
  ambiguous?: boolean;
  /** The value actually typed or asserted, after data and generator resolution. */
  valueUsed?: string;
};
