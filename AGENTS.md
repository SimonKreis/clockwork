# AGENTS.md: Clockwork

Read this first. It is the entry point for any coding agent working on this repository.

Companion documents, in the order you will need them:

| File | What it holds |
|---|---|
| `CONTEXT.md` | **Decision state.** What is settled and must not be reopened, what was rejected and why, open questions with confidence. Read it before proposing anything. |
| `README.md` | The operator facing manual: how to write and run a blueprint. |
| `docs/RECORDING.md` | How a step is repaired in the browser, and how a new one is written. |
| `.claude/skills/` | Three validated procedures: first live run, converting a legacy export, verifying offline. |

## What this is

A replacement for the execution engine of **the legacy platform**, the incumbent Selenium based test automation
platform for Oracle Fusion Cloud HCM. The legacy platform's structural weakness is that Oracle's quarterly patches
break its stored XPath selectors, and maintaining them consumes most of the automation effort.

This engine reads a test expressed as the **visible labels a person sees on screen**, resolves each
element at run time, performs the action, screenshots every step, and produces a pass or fail report.
When Oracle has renamed something it pauses on that screen, hands over to a human, and writes their
correction back into the test file.

**Governing principle: store the intent, regenerate the binding.** There is no selector anywhere,
and no field to put one in.

**The governing image, and the name.** A wind up toy: stored energy, a straight line, no autonomy,
a clean stop at the first obstacle. What v3 adds is that when someone picks the toy up and puts it
back on course, the engine remembers the correction. The metaphor is not decoration, it is the scope
boundary: anything that would make the toy steer around an obstacle by itself is out. `README.md`
maps each property onto the decision it stands for; use it when you are tempted to add cleverness.

## State, as of 2026-09-24: complete

**Complete; development stopped there.** The engine is
verified offline: 70 checks green (a fake Oracle for the engine and for assisted mode, a synthetic
legacy export for the converter, a temporary file for the profile editor), typecheck clean.

**Step 7 began and stopped at the archive. The engine has run against a real Oracle HCM DEV pod and passed**, a three step
scenario end to end on 2026-09-09. Three defects that only a live pod could reveal were found and
fixed that day, and they are the most useful thing in this file for anyone arriving now: read D17 in
`CONTEXT.md` before debugging anything that looks like a browser, a label or a session
problem. A local interface for starting a run was built the same day (D18). Since 2026-09-10 a run signs in in its own window and keeps nothing (D19), and `Clockwork.cmd` starts the interface with a double click. The same day the application folder stopped holding any user material: configuration, scenarios, data and every run's output live in the workspace (D20).

What v3 changed, and where it now lives in the code:

| Decision | Where it is |
|---|---|
| Resolution is 100% semantic (D11) | `src/locate.ts`. No `legacy_xpath` in the schema, no fallback, no debt reporting. `src/blueprint.ts` refuses a blueprint carrying a selector. |
| One test is one session (D12) | `src/interpreter.ts` walks one list of steps. No `sessions:`, no `login`, no personas. The converter splits a multi persona scenario into `_1`, `_2`. |
| Auth is infrastructure (D13, refined by D19) | A run signs in in its own window: `openSession` in `src/interpreter.ts` waits on the sign in page for a person, the scenario continues there, and nothing is kept. `SESSION=saved` plus `npm run auth` restores a captured session, for hidden runs only. |
| Assisted mode (D14) | `src/assist.ts`. Pause on the failing screen, in page banner, click capture, surgical rewrite of the blueprint file, resume. |
| Supervision is Playwright UI (D15) | `npm run ui`. No dashboard was built and none should be. |
| Starting a run without a terminal (D18) | `npm run gui`. A launcher, not a dashboard: it runs the existing entry points and reads the journal. Supervision is untouched. |
| The application folder holds no user material (D20) | `src/workspace.ts` finds the workspace without configuration, loads its `.env`, and completes the layout. It never creates the folder itself: `npm run init` does, on purpose (D21). Run output goes to `<workspace>/reports`. |
| Frames searched automatically | `searchRoots` in `src/locate.ts`. No keyword, never mentioned in a blueprint. |

Step 7 was under way against a real DEV pod when the project was archived. Each run opens on the
sign in page and the operator signs in there, second factor included, so the MFA risk that used to
gate everything stays closed (D13, D19). The client facing report format arrived late and became the
evidence document, `tools/evidence.ts`: one step, one screenshot, HTML and PDF.

## The workspace: where client material lives

**Nothing specific to a user or an engagement is in this folder (D20).** The configuration, the
scenarios, the data, the legacy exports and every run's output sit in a **workspace next to it**:

```
<theme-folder>/
  clockwork/                    this repository: the application. Anonymous, reusable, public.
  clockwork-workspace/          everything specific to a user and their runs. Never shared.
    .env                        the configuration, copied from .env.example on first start
    blueprints/                 the YAML scenarios, converted or written by hand
    blueprints/disabled/        scenarios kept but never run
    data/                       data profiles
    legacy-exports/             raw legacy exports, read only
    templates/                  a blueprint template for writing scenarios by hand, never run
    reports/                    journals, screenshots, summaries, Playwright's own output
    .auth/                      a captured session, SESSION=saved only
```

`src/workspace.ts` finds it **without configuration**, because the configuration lives inside it:
the folder next to this one called `clockwork-workspace`, unless `BLUEPRINT_WORKSPACE` is set in the
environment Clockwork is started from (never in the workspace's own `.env`). It loads that `.env`
before anything reads a setting. `npm run init` creates it on purpose, with its whole layout, and
`Clockwork.cmd` offers to on a first start. `npm run gui`, `npm test` and `npm run auth` only
complete a workspace that exists, and stop when the folder is missing: it was far more likely moved
than never created (D21). Anything of a user's still found in this folder is named on start, as
ignored, and never moved automatically.

**Nothing client specific may enter this repository.** No client or project name, ticket prefix,
Oracle pod tenant code, username, personal name, password or home directory path. Verified by the
sweep in `.claude/skills/verify-offline/` section 3. If you produce something derived from a real
export, write it into the workspace, never into the repository. That is why `tools/convert-legacy.ts` writes its report to `<workspace>/reports/`.

Everything the project needs in order to be verified is synthetic and lives in `selftest/`:

| Fixture | Replaces |
|---|---|
| `selftest/fake-oracle/` | A real Oracle pod. Reproduces the traps that matter. |
| `selftest/sample-legacy-export/` | A real legacy export. Identical three file structure, invented content. |
| `selftest/blueprints/` and `selftest/data/` | Real blueprints and data profiles. Also the worked example. |

**Git, as of 2026-09-07, and the history starts there.** The project spent its first weeks with no
repository at all and its earlier history deliberately discarded, so the initial commit is the whole
engine arriving at once rather than a record of how it was built. That record lives in
`CONTEXT.md` instead, which is why that file is long: it is the archive the history is not.

Development is still solo. Branches, pull requests and release processes are not wanted; commit to
the current branch. Do not design any workflow that depends on a rich history, because there is
none to depend on.

## Setup

No MCP server, no external service, no API key. Node and a browser, nothing else.

```bash
npm install
npm run install:browsers     # Chromium only
npm run check                # must be green before you touch anything: typecheck + 70 offline checks
```

Node 20 or later. Verified on 24.16.0.

To run against a real environment, start Clockwork once (`npm run gui`, or `Clockwork.cmd` on
Windows). It creates the workspace next to this folder, `../clockwork-workspace/`, with a commented
`.env` copied from `.env.example`. Fill `ORACLE_BASE_URL` in that `.env` (a DEV or TEST pod, never
production) and start again. There is no password to set: every run opens a browser on the sign in
page, a human signs in there, and nothing is kept once the window closes (D19).

## Commands

| Command | What it does |
|---|---|
| `npm run check` | **The gate.** Typecheck plus the 70 offline checks. No credentials needed, about 90 s. |
| `npm run typecheck` | `tsc --noEmit`, strict. There is no linter; this is the quality gate. |
| `npm run selftest` | The offline suite alone, against the fake Oracle in `selftest/`. |
| `npm run auth` | Capture a session to a file, for `SESSION=saved` only, which only hidden runs need. By default nothing depends on it: each run signs in in its own window (D19). |
| `npm run gui` | **The local interface (D18).** A page on 127.0.0.1 that signs in, lists the scenarios, fills a data profile, starts a run, follows it and opens the report. Runs the commands below; it is not a second engine. |
| `Clockwork.cmd` | Double click, on Windows, to start `npm run gui` without a terminal. Installs the dependencies on first start. |
| `npm test` | Every blueprint in `<workspace>/blueprints/` against the real environment. Headed by default. |
| `npm run test:one -- "<name>"` | One scenario. |
| `npm run ui` | Playwright UI mode. This is the supervision screen, and the reason no dashboard exists (D15). |
| `npm run report` | Generate the standardised summary and the evidence document from the last run journal. |
| `npm run evidence` | The evidence document alone: one step, one screenshot, HTML and PDF. `--layout stack` for one column, `--no-pdf` for HTML only. |
| `npm run convert` | Turn a legacy export in `<workspace>/legacy-exports/` into blueprints. |
| `npm run split` | Turn a page copied out of the legacy interface back into one `.feature` per suite, for `npm run convert`. |
| `npm run record` | `playwright codegen`. Superseded for repairs by assisted mode (D14); kept for authoring from nothing. |

Runs are **headed** by default and assisted mode is **on** by default, because a blocked test
waiting for a person is the product, not a bug. An unattended run needs `HEADLESS=true` and
`ASSIST=false` together, and then a wrong label simply fails the test.

With an empty workspace, `npm test` creates the layout and reports **1 skipped**, not a failure. That is
correct: blueprints live outside the repository because they hold client derived material.

## Architecture

```
src/
  locate.ts        THE CORE. The resolution chain, over the page and every frame. Read this first.
  assist.ts        The pause: banner, click capture, blueprint repair. Read this second.
  interpreter.ts   Walks steps, dispatches, screenshots, journals, pauses or stops on failure.
  blueprint.ts     YAML loading and validation. The only Gherkin/YAML contact point.
  config.ts        Every tuning point, plus the production guard.
  workspace.ts     Finds, loads and creates the workspace. Imports nothing from the engine.
  errors.ts        Oracle error detection. Detection only, never repair.
  data.ts          {{references}}, data profiles, generators.
  profile.ts       Listing and editing a data profile AS TEXT, so its comments survive a save.
  browser.ts       Which browser to drive: the user's default when Chromium based, else installed.
  journal.ts       The run journal, one JSON record per step.
  keywords/        One module per action. select.ts is the delicate one.
tools/
  capture-session.ts  npm run auth, for SESSION=saved only. By default a run signs in in its own window.
  convert-legacy.ts   legacy export to blueprints.
  report.ts        Journal to summary. All reporting is generated from the journal.
  evidence.ts      Journal to the client facing evidence document. Three layers: the model, the
                   markup, the layout in CSS. A format change touches one of them.
  split-legacy-paste.ts  A copied legacy page back into .feature files.
  gui/             npm run gui. A loopback server plus one page (D18). Spawns the entry points
                   above and follows the journal file. Contains no engine logic, and must not.
selftest/          Everything needed to verify the project with no Oracle and no client data:
  fake-oracle/       A miniature Oracle reproducing the traps that matter.
  sample-legacy-export/ A synthetic legacy export, identical in structure to a real one.
  blueprints/, data/ The worked example, which is also a test fixture.
tests/             Discovers <workspace>/blueprints/*.yaml, one Playwright test per file.
```

### The resolution chain, which is the whole point

```
visible label -> ARIA role and name -> title -> placeholder -> adjacent text -> hints
```

Then the pause: the browser stays open on the failing screen, a banner in that page says what was
being looked for and lists every actionable label, a click listener captures what the tester does,
and Resume writes that label back into the blueprint file. Nothing is ever stored as a selector;
`hints` (a panel name and an ordinal) is the only disambiguation.

Frames are searched automatically, main document first then each embedded one, so a blueprint never
mentions an iframe. An iframe is a page inside a page: a label in the inner document is invisible to
a search of the outer one, whatever the search method. This is unrelated to selectors.

### The ten keywords

`navigate`, `click`, `fill`, `select`, `press_key`, `capture`, `verify`, `wait_for`,
`switch_window` / `close_window`, `refresh`. Derived from the measured vocabulary of the legacy platform, not invented.
Adding an eleventh requires a real blueprint that needs it.

`click` takes `double: true`; `select` takes `mode: dropdown` for a plain choice list, which looks
like a type ahead on screen and behaves nothing like it.

## Conventions

- **English** for all code, comments, schemas and reports. The operator writes French; conversation
  can be French, artefacts are English.
- **No em dashes** anywhere in generated text. Commas, colons, parentheses, periods. This is a
  standing instruction from the original spec.
- Comments explain **why**, especially where a choice looks odd. Several non obvious decisions in
  this codebase are load bearing and are documented at their site.
- Failure messages are product surface, not stack traces. A functional consultant who does not read
  code must be able to act on them. See `explainFailure` in `src/locate.ts` for the standard.

## Known traps

Ordered by how likely you are to hit them.

1. **A window that opens and closes at once is almost never a crash.** A run whose Oracle session
   has expired stops in about two seconds on `SessionError`, and Playwright closes the browser with
   the test, which from outside looks exactly like the browser dying. Read the output, or the
   session state in `npm run gui`, before debugging any browser. The one browser defect that is
   real: Playwright's bundled Chromium cannot start **headed** on a managed Windows workstation
   (`spawn UNKNOWN`), which is why the engine prefers an installed Chromium browser, the user's
   default first (`src/browser.ts`). A browser that is already open is not a problem: each run gets
   a fresh profile. See D17 in `CONTEXT.md`. Since D19 every run begins by waiting on the
   sign in page for a person, without a timeout; with the browser hidden it cannot, and stops at
   once saying so. The self test runs with `SESSION=saved` for exactly that reason.
2. **Never put a selector in a blueprint.** Not in `label`, not anywhere. Since D11 there is no
   field for one, and `validateStep` rejects `legacy_xpath`, `xpath` and `selector` by name. The
   only permitted disambiguation is `hints` (a panel name and an ordinal).
3. **`.gitignore` rules are anchored on purpose.** `/data/*` not `/data/`, because git does not
   descend into an excluded directory and a `!` exception inside one is silently ineffective. And a
   leading slash everywhere, because `blueprints/` unanchored also matches `selftest/blueprints/`.
   If you touch it, verify with `git check-ignore`, do not read the patterns. Procedure in
   `.claude/skills/verify-offline/`.
4. **The production guard reads the environment token from the first hostname label**, not a
   substring search. Oracle DEV pods are legitimately named `fa-xxxx-dev1-saasfaprod1...`; a naive
   search for "prod" blocks DEV. Four cases are covered by tests.
5. **`selftest/blueprints/selftest_create_course.yaml` is both the worked example and the test
   fixture.** Deliberate: an example that is executed cannot drift. Do not inline it.
6. **`tools/convert-legacy.ts` must not overwrite a blueprint without `--force`.** Reviewed blueprints
   carry hand corrected labels the converter cannot reproduce.
7. **A read only field's label and its value are two different elements.** Reading the label text
   captures the label, not the value. That is why `capture` and `verify` use the internal `value`
   element kind. This was a real bug, caught by the self test before any environment existed.
8. **Playwright compiles test files to CommonJS here.** `import.meta` fails; use `__dirname` with a
   `declare const`. There is no `"type": "module"` in `package.json` and adding one will break test
   collection.
9. **Before exporting anything new from the legacy platform, the scenarios must be active.** A commented out
   scenario exports its steps but none of its locators, so the export looks complete and is unusable.
10. **`retries: 0` is deliberate**, and so is `timeout: 0`. A retry would paper over exactly the
   signal this engine exists to produce. The timeout is disabled because a test paused for a human
   will always exceed any limit worth setting (C3): put one back and assisted mode dies after ten
   minutes, looking like a random flake rather than a missing setting. `WORKERS` defaults to 1
   because Oracle test data collides under parallelism, not because the engine cannot take it.
11. **`repairBlueprintFile` edits YAML as text, on purpose.** A converted blueprint is mostly
   comments (`# INFERRED`, `# NOT CONVERTED`), and every YAML library throws those away on the way
   out. Parse and re serialise here and the first repair silently deletes the review notes.
12. **`selftest/fake-session.json` is committed and must stay that way.** It is a synthetic
   storageState holding one local storage key, with nothing secret in it. Without it the self test
   cannot exercise the session path at all, which is now the only way any run gets a session.

13. **Configuration lives in the workspace `.env`, not in this folder.** A `.env`, `.auth/` or
   `reports/` left here from before D20 is ignored, and named as such on start. And
   `BLUEPRINT_WORKSPACE` is read from the environment Clockwork starts in, never from the workspace's
   own `.env`: a workspace that moved itself would load one folder's settings and run another's
   scenarios. The self test points it at `selftest/` and writes to `selftest/.output/`, so
   `npm run check` never touches a real workspace.

## Working with the operator

A single application maintenance consultant on Oracle Fusion Cloud HCM, working on the functional
side. Runs commands, reads and edits YAML and Markdown: explain code level choices plainly. Keep
proposals simple and explicit, recommend
rather than enumerate, and say plainly when something is unverified. The scope decisions in
`CONTEXT.md` exist to keep this achievable by one person: do not quietly widen them.
