# Clockwork

A Playwright test engine for Oracle Fusion Cloud that binds every step to a visible label instead of
a selector, and pauses and learns the fix when a label changes.

> **Complete:** verified by 70 offline checks, and passed a first end-to-end run on a real Oracle
> Fusion HCM DEV pod (2026-09-09). Its concepts now continue in an agent-driven successor.

> Coding agents: start with [AGENTS.md](AGENTS.md) and [CONTEXT.md](CONTEXT.md).
> This README is the operator facing manual for writing and running blueprints.

A two way translator between what a person does in a browser and a portable, readable test file,
plus an engine that replays that file against a web application and stops the moment reality
diverges. It screenshots every step and produces a pass or fail report.

When the application has renamed something, the run does not fail. It **pauses on that screen**,
tells you what it was looking for, lets you do the action yourself, and writes your correction back
into the test file. The test file is a draft; the run is the compiler.

The durable asset is the blueprint: the intent of a test, expressed as the labels a person sees on
screen. There is no selector in it, anywhere, ever.

Built for Oracle Fusion Cloud, and not tied to it: everything application specific sits in three
lists in [src/config.ts](src/config.ts).

## Where it stands

Read this before you judge anything else here.

The engine is verified **against a fake application built for the purpose**: 70 offline checks
covering the resolution chain, frames, the list of values, error detection, the legacy converter, the
report generator, the data profile editor and assisted mode end to end. `npm run check` runs them
with no credentials, no network and no configuration.

**On 2026-09-09 it ran against a real Oracle Fusion HCM DEV pod and passed**, a three step scenario
end to end. That first afternoon found three things no offline test could have: a bundled browser
that could not start in a window on a managed workstation, a resolution rule that preferred a menu
chevron to the menu itself, and an expired session that announced itself as a missing label. All
three are fixed and each one is now covered by a test.

So: the engine works, and the integration is real but young. Development stopped in that state on
2026-09-24. Anyone extending it should expect the application specific lists in `src/config.ts` to
need tuning as more of Oracle is walked over. Nothing in this repository pretends to be battle
tested.

## The name

A wind up toy. Not a robot, not an agent, not an assistant. The image came from the operator during
the design discussions and it turned out to describe every decision in this project, so it became
the name:

| The toy | The engine |
|---|---|
| **Stored energy.** Everything it will do is wound in beforehand. | A blueprint is written first, and the run only spends what is in it. |
| **A straight line.** It has no steering. | No conditional branching, ever. That is a permanent scope decision, not a missing feature. |
| **No autonomy.** It does not decide anything. | No self healing, no retries, no guessing which element you probably meant. |
| **A clean stop at the first obstacle.** It does not thrash, it does not fall over, it stops. | A step that cannot find its element halts the run and says exactly what it was looking for. A blocked test is a valid outcome, not a defect. |
| **You pick it up and put it back on course.** | Assisted mode: the browser waits for you on the failing screen, and you do the action yourself. |

And the one thing a real wind up toy cannot do, which is the whole point of this version: **it
remembers the correction.** What you did by hand is written back into the test file, so the next run
does not stop there.

Anything that would make it steer around an obstacle by itself is out of scope, permanently. That is
what the name is for: it makes the boundary easy to remember, and easy to say no with.

## Getting started

```bash
npm install
npm run install:browsers
```

Check that the engine itself works, with no Oracle environment and no credentials:

```bash
npm run selftest
```

That runs 70 checks: a fake Oracle exercises the engine end to end (navigation, a list of values
with an asynchronous suggestion list, a plain dropdown, a field inside an iframe, a read only field,
error detection, assisted mode), and a synthetic legacy export exercises the converter. If it is green,
anything that breaks later is Oracle specific, not engine specific.

Then point it at a real environment. Start Clockwork once with `Clockwork.cmd` on Windows, which
asks before creating its workspace, or create it yourself with `npm run init`: it goes next to this
folder, `../clockwork-workspace/`, with a commented `.env` inside. Fill in one thing there:

- `ORACLE_BASE_URL`, a DEV or TEST pod. The engine refuses to start against a production one.

Then start it again. Everything specific to you lives in that workspace: the configuration, your
scenarios, their data, and every run's journal, screenshots and report. This folder holds the
application and nothing else, so it can be copied, shared or published as it is. There is no
password to fill in. See the next section.

## If you would rather not use a terminal

On Windows, double click `Clockwork.cmd` in this folder. Or, from a terminal:

```bash
npm run gui
```

A page opens at `http://127.0.0.1:4400/`, in your default browser. It does what the rest of this
manual describes: choose a scenario, fill in the data it needs, run it, watch the steps go by, open
the report. It listens on your own machine only. `Clockwork.cmd` installs what is needed the first
time; after that, the window it opens is the server: keep it open while you work, close it to stop
Clockwork.

It is a way in, not a different tool: it runs the same commands documented below and reads the same
run journal, so a run started there and a run started in a terminal are the same run. Supervision of
a running test is unchanged, and deliberately so: when a step cannot find its element the browser
stays open on that screen with a banner, and that is where you work, not here.

There is no password field on that page. You sign in in the run's own browser window, as the next
section describes.

Three switches are worth knowing. **Pause and let me help** is on by default and is the product.
**Slow down so I can follow** pauses briefly after every step, so you can see what the engine does.
**Hide the browser** is for a run nobody is watching; since a hidden run cannot sign in, it is only
available with `SESSION=saved`.

## Signing in

Every run starts on your pod's sign in page, in a browser window of its own. **You** sign in there,
by hand, including any second factor. The run notices by itself when you are in, and the scenario
starts in that same window: you see it from the sign in to the last step. When the window closes,
nothing about the session is kept.

The window is your default browser when it is Chromium based: Chrome, Edge, Brave, Vivaldi or
Opera. Firefox and Safari cannot be driven, so another installed Chromium browser is used instead,
and a browser that cannot be started says so and lists the supported ones. Either way the run uses
a fresh temporary profile: not your tabs, not your saved passwords, not your extensions.

Why it works this way:

- no password ever touches this repository, a config file or a test
- multi factor authentication stops being a problem, because a person answers it
- a blueprint starts at its first real action, with no sign in steps to maintain
- there is no saved session to expire, to leak, or to be confused about: each run begins with you

A run with the browser hidden cannot ask you to sign in, and stops at once saying so. For those
runs only, capture a session to a file once and set `SESSION=saved` in the workspace `.env`:

```bash
npm run auth
```

That file holds live session cookies: it is exactly as sensitive as the password. It is gitignored,
and it never leaves your machine.

## Running tests

```bash
npm test                              # every blueprint in blueprints/
npm run test:one -- "create_a_course" # one of them
npm run ui                            # Playwright's UI mode: the supervision screen
npm run report                        # summary and evidence document of the last run
npm run evidence -- --layout stack    # the evidence document alone, one column
```

Runs are **headed** by default: assisted mode needs a window you can act in. Set `HEADLESS=true` in
`.env` for a run nobody is watching, and `ASSIST=false` with it, so a wrong label fails the run
instead of waiting forever for a person who is not there.

To run several scenarios at once, set `WORKERS` in `.env`. Three to five is realistic for one
person supervising. The limit is not the machine: two scenarios creating the same object in the
same environment collide, so a parallel batch has to be composed of independent scenarios.

Reports land in the workspace, `../clockwork-workspace/reports/`:

| File | What it is |
|---|---|
| `journal-<run>.jsonl` | One record per step. The durable artifact: every other report is generated from it. |
| `summary-<run>.md` and `.html` | The pass or fail summary for whoever runs the tests: resolution details, repairs, failures. |
| `evidence-<run>.html` and `.pdf` | The document for whoever receives the tests: one step, one screenshot, grouped by ticket. Side by side by default, one column with `--layout stack`, and switchable in the HTML. Screenshots embedded, safe to email. |
| `screenshots/<run>/` | One image per step. |
| `playwright-html/` | Playwright's own report, with a replayable trace of the whole run. |

## When a step cannot find its element

This is the normal way a test ends its first life, not an accident.

1. The run stops at that step and **leaves the browser open on the failing screen**.
2. A banner appears at the top of that page: which step, which label it wanted, and every label
   that is actually on the page right now.
3. Do the action yourself, in that window. The engine watches what you click.
4. Press **Resume**. It tells you what it captured, writes that label into the blueprint file, and
   carries on at the next step.

You can also click one of the labels in the banner to choose it directly, or press **Stop this
test** to end the run and get an ordinary red result.

Two consequences worth knowing:

- The run continues at the **next** step. It does not repeat the action you just performed by hand,
  because doing so would click Save twice.
- A blueprint therefore does not have to be right when it is written. Ten lines of approximate
  plain language, run and repaired as it goes, is a legitimate way to author a test.

With several tests running at once, each pauses in its own window and is resumed there. That is why
there is no dashboard: use `npm run ui` to see the list, and the paused window itself to fix it.

## Writing a test

Start from `templates/blueprint-template.yaml` in your workspace: copy it into `blueprints/`
under a new name. Anything in `templates/` is never run.

A blueprint is a YAML file in `<workspace>/blueprints/`. Drop a file in, it runs. There is no code
to write.

```yaml
scenario: create_a_course
source: PROJ-1234          # the ticket, for traceability
data_profile: learning_sample_default

steps:
  - action: navigate
    path: ["Navigator", "My Client Groups", "Learning", "Courses"]

  - action: click
    label: "Create"

  - action: fill
    label: "Title"
    value: "{{title}}"

  - action: select               # a list of values: types, picks the option, checks the field
    label: "Category"
    value: "HR"

  - action: click
    label: "Save and Close"

  - action: verify
    text_contains: "was created"
```

No sign in, no sign out, no persona. **One test is one person, in one session, from A to Z.** A
legacy scenario with four people becomes four blueprints, run in order by a human.

### The ten keywords

| Keyword | What it does |
|---|---|
| `navigate` | Walks a menu path: `path: ["Navigator", "My Team", "Learning"]`. Or jumps to a `url:`. |
| `click` | Clicks a button, link or menu entry by its visible label. `double: true` for a double click. |
| `fill` | Types into a field. Add `press_enter: true` for a search box. |
| `select` | A list of values: types, waits for the list, picks the option, then checks the field really holds it. `mode: dropdown` for a plain choice list you open rather than type into. |
| `press_key` | A key press: `key: "Tab"`. Add a `label:` to aim it at a field first. |
| `capture` | Reads a read only field into a variable: `as: course_number`, reused later as `{{course_number}}`. |
| `verify` | Checks a field value (`label` plus `equals` or `contains`) or the page (`text_contains`). |
| `wait_for` | Waits for something to appear or disappear. Rarely needed: waiting is automatic. |
| `switch_window` / `close_window` | For approval notifications that open a popup. |
| `refresh` | Reloads the page. |

The worked example that is also a test fixture, so it can never go stale, is
[selftest/blueprints/selftest_create_course.yaml](selftest/blueprints/selftest_create_course.yaml).

### Data

Values come from a profile in `data/`, referenced as `{{name}}`. There are no passwords in a
blueprint or a profile, and nowhere to put one.

Generators are available for values that must be unique on each run, replacing the legacy platform's custom code:
`{{random_string(6)}}`, `{{random_number(4)}}`, `{{today()}}`, `{{today(1)}}`, `{{today_us()}}`,
`{{timestamp}}`.

### When the same label appears twice

Add a hint. Nothing else, and never a selector.

```yaml
  - action: click
    label: "Next"
    hints:
      section: "Add a Person"    # restrict to a named panel or dialog
      index: 1                   # or take the second match, counting from zero
```

The report flags every step where a label matched several elements, so you find these without
hunting for them.

### Frames

There is nothing to write. A page embedded in a page (BI Publisher, classic ADF regions) is
searched automatically, after the main document. The legacy platform switches frame by index and breaks the day
Oracle adds one; here the blueprint never mentions frames at all.

## Converting from a legacy export

```bash
npm run convert                       # reads <workspace>/legacy-exports
npm run convert -- <exportDir> <outDir>
```

It joins the three legacy files and writes blueprints. Where the original XPath contains a visible
label, that label is used. Where it does not, which is most of the time, the label is guessed from
the legacy object name and marked with an `# INFERRED` comment: the first run will tell you whether
the guess was right, and let you correct it on the spot.

A scenario that signs in as several people in a row becomes several blueprints, `_1`, `_2`, `_3`,
to be run in order. What the converter refuses to translate (custom code, image recognition,
conditional branching, a verb it has never seen) is written into the file as a comment rather than
dropped, so a blueprint is never quietly short of an action. Everything worth a second look is
listed in `reports/conversion-report.md`.

**Before exporting from the legacy platform, make sure the scenarios are active.** A scenario commented out in the legacy platform
exports its steps but none of its locators, so the export looks complete and is not.

## Why there is no selector anywhere

The resolution chain is:

```
visible label -> ARIA role and name -> title -> placeholder -> adjacent text -> hints
```

and then it stops and asks you. Earlier versions kept the legacy XPath as a last resort, so the engine
"could never do worse than the legacy platform". That rested on getting a complete object repository out of the legacy platform,
and that turned out to be impossible: the exports carry 302 object references and no XPath at all.
A safety net that is always empty still costs a schema field, a code path and a concept, so it is
gone.

The consequence is deliberate. A step whose label is wrong now fails immediately instead of quietly
working against a selector that will rot at the next Oracle patch. Under assisted mode that is a
feature: the work surfaces at once, in front of somebody who can fix it in ten seconds.

## What this engine deliberately does not do

No self healing, no retries, no scheduling, no run history, no conditional branching, no dashboard.
It cannot test a four person approval chain in one run, and it cannot run unattended overnight: a
blocked test waits for a person. Each of those is a trade for an engine one person can build,
understand and maintain. See [CONTEXT.md](CONTEXT.md) for the reasoning.

## Layout

Nothing specific to a user or an engagement is here. It all lives in the workspace next to this
folder, `../clockwork-workspace/`, which Clockwork finds without any configuration, and which `npm run init`
creates once, on purpose: `.env`, `blueprints/`, `data/`, `legacy-exports/`, `templates/` and `reports/`. See its own
README. That separation is what keeps this folder anonymous, reusable and publishable.

```
src/
  locate.ts        the resolution chain. The heart of the project.
  assist.ts        the pause, the banner, the click capture, the file repair
  interpreter.ts   walks the steps, screenshots, journals
  keywords/        one module per action
  blueprint.ts     loading and strict validation of a blueprint
  types.ts         the blueprint schema, v0.2
  data.ts          data profiles, references and generators
  journal.ts       the run journal, one JSON record per step
  context.ts       the state a keyword handler works with
  errors.ts        Oracle error detection
  config.ts        every tuning point, including the production guard
  browser.ts       which browser to drive when nobody said
  profile.ts       reading and editing a data profile as text, comments intact
  workspace.ts     finds, loads and creates the workspace
tests/
  blueprints.spec.ts  one Playwright test per blueprint of the workspace
tools/
  capture-session.ts  npm run auth, for SESSION=saved (hidden runs) only
  convert-legacy.ts   legacy export to blueprints
  report.ts           journal to summary, then calls evidence.ts
  evidence.ts         journal to evidence document, HTML and PDF: content, markup, layout
  split-legacy-paste.ts  a page copied out of the legacy interface, back into .feature files
  gui/                npm run gui: a loopback server and one page, over the tools above
selftest/          the fake Oracle, a synthetic legacy export, and the offline suite
docs/RECORDING.md  repairing a step in the browser, and writing a new one
CONTEXT.md         the decision record: what is settled, and why
.claude/skills/    first live run, converting a legacy export, verifying offline (mirrored in .agents/)
Clockwork.cmd      double click launcher for the local interface, on Windows
```

## Licence

MIT. See [LICENSE](LICENSE). Copyright 2026 Simon Kreis. Contact: Simon Kreis, M. Sc., [simon@kreisconsulting.ca](mailto:simon@kreisconsulting.ca).

Nothing client derived is in this repository, by construction: scenarios, data profiles and raw
exports live in a workspace directory outside it. Everything here that looks like a real system is
synthetic, including the fake Oracle under `selftest/` and the sample export next to it.
