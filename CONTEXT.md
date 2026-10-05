# CONTEXT: decision state

**Archived on 2026-09-24.** The project is closed as it stands: the engine, the converter, the
evidence document (`tools/evidence.ts`) and the local interface are complete and verified by 70
offline checks. The converted scenarios stay in the workspace. No further work is planned here; the legacy
converter is kept for the rare export still to convert.

Last updated: 2026-09-27 (archive). Distilled
from the sessions of 2026-08-24 (analysis, scope negotiation, build), 2026-08-29 (the v3 pivot) and
2026-09-09 (step 7) so that the reasoning survives without the conversation. If you are a new
agent, read this before `AGENTS.md`: it tells you which questions are already settled and must not
be reopened.

**Implementation status.** D11 to D20 are in the code. Build steps 1 to 6
are done and step 7, the first run against a real DEV pod, **began and stopped at the archive**: on 2026-09-09 a three
step scenario passed end to end against a live Oracle HCM DEV environment. Three defects that only
a real pod could reveal were fixed the same day (D17), and the local interface was built (D18).
Verified by 70 offline checks.

Operator: a single application maintenance consultant on Oracle Fusion Cloud HCM, working on the
functional side: runs commands, reads and edits YAML and Markdown. Explain code level choices
plainly and keep every proposal simple and explicit. Everything below exists to keep the build achievable by one person.

---

## Active decisions

### D1: Replace the execution engine of the legacy platform, not the whole platform
**2026-08-24. Confidence: certain (stated explicitly by the operator).**
Out of scope, permanently unless the operator reopens it: authoring UI, object repository
management, scheduling, run history, Jira integration, user management.
**Decision criterion:** the team's stated pain is one thing only, XPath maintenance after Oracle
quarterly patches. Anything not serving that is not this project.
**Consequence:** a nightly scheduled run is a "non issue" per the operator, a background task on an
open workstation is sufficient.

### D2: A failing test is a valid outcome, not an engine defect
**2026-08-24. Confidence: certain.**
When a label has changed and a step cannot resolve, the engine stops, names the step and the label,
and hands over to a human. It never retries, never repairs, never guesses its way forward.
**Decision criterion:** the operator's own framing, "c'est justement là qu'il faut une intervention
humaine de toute façon". This is the single largest simplification in the project: it removes all
robustness, retry and self healing work.
**Consequence:** the quality of a failure *message* is a deliverable. Treat it as product surface,
not as a stack trace. See `explainFailure` in `src/locate.ts`.

### D3: ~~Keep the legacy XPath as the last link of the resolution chain~~ SUPERSEDED by D11
**2026-08-24, reversed 2026-08-29.** Kept here because the reasoning explains why the
reversal was correct: the decision was sound given what was known, and one new fact killed it.

Chain: visible label, ARIA role and name, placeholder, adjacent text, hints, then `legacy_xpath`.
**Decision criterion:** it makes the floor mathematically equal to the legacy platform. In the worst case the engine
replays the legacy platform's own selector on a faster runtime, so the migration cannot regress. The XPaths are free,
they are already in the export.
**Consequence, and this is the non obvious part:** every fall through to `legacy_xpath` is written to
the run journal as `resolution_method: legacy_xpath` and surfaced in the report as technical debt.
That converts the legacy selectors from a liability into a *migration instrument*: the report is the
worklist of steps to re record. Do not remove that reporting.

### D4: YAML blueprints, not Gherkin
**2026-08-24. Confidence: medium-high. Cheap to revisit.**
**Decision criterion:** the corpus needs structured constructs (multi persona `sessions:`,
disambiguation `hints:`, data profiles) that are awkward as flat sentences, and parsing YAML is one
library call where Gherkin needs a dependency or a hand written parser.
**Rejected alternative:** keeping the legacy `.feature` format, which would have made the conversion
nearly an identity transform and been familiar to the team. Rejected because the whole value is
removing the object repository indirection, after which the file is no longer a legacy file anyway.
**Reversibility:** only the parser front end would change, not the engine. `src/blueprint.ts` is the
single point of contact.

### D5: Detect Oracle errors generically, after every step
**2026-08-24. Confidence: high.**
About twenty lines in `src/errors.ts`, driven by `config.errorIndicators`.
**Decision criterion:** without it, "passed" only means "the bot reached the last step". Oracle can
refuse an operation without blocking the click sequence, producing a green run in which nothing was
created. The legacy platform has this blind spot today (zero assertions across 439 steps).
**Not to be confused with self healing**, which is rejected under D2. This is detect and stop, never
repair and continue. The operator initially conflated the two; the distinction matters.

### D6: Build the interpreter before the converter
**2026-08-24. Confidence: high. Already executed.**
**Decision criterion:** the schema was expected to move on contact with real Redwood pages, so a
converter written first would have been rewritten. It did move, from v0 to v0.1, on the first pilot.

### D7: A structured run journal is the durable reporting artifact
**2026-08-24. Confidence: high.**
`reports/journal-<run>.jsonl`, one record per step. Every human readable report is generated from it
by `tools/report.ts`.
**Decision criterion:** the client facing report format is not known yet. When it arrives, a new
generator is written against the journal and the engine is not touched.
**Consequence:** never make the engine emit a report format directly.

### D8: ~~Solo project, no git history~~ SUPERSEDED by D16
**2026-08-29, reversed 2026-09-07.** Kept because it explains why there is no history before that
date, and why `CONTEXT.md` carries the weight a git log would normally carry.
The repository was moved into a thematic folder structure and its git history deliberately deleted.
`.gitignore` was maintained throughout anyway, on the stated grounds that it defined what counted as
client material and would make an eventual push safe. That turned out to be the right call: it is
what made D16 a one command decision rather than an audit.

### D16: The project is under git, and destined for GitHub
**2026-09-07. Confidence: certain (the operator supplied the repository URL).**
`git init` on 2026-09-07, default branch `main`, initial commit containing the engine as it stood
after step 6 of the build order.
**Decision criterion:** the operator decided to publish. That reverses D8, which was never a
principle, only a preference for a project nobody else was going to read.
**Consequences and limits:**
- The history begins at the initial commit. Nothing before it is recoverable, so
  `CONTEXT.md` remains the archive of the reasoning, not the git log.
- Development stays solo: commit to the current branch, no branch or pull request ceremony.
- **The repository is on GitHub, published without history** (2026-09-25): one version, anonymised,
  pushed in place of the earlier commits. The full history stays with the operator, outside the
  repository.
- The repository is licensed MIT as of the same date, which is what makes publication meaningful.

### D9: Client material lives in a workspace outside the repository. MADE SYSTEMATIC by D20
**2026-08-29. Confidence: certain (chosen explicitly by the operator).**
Legacy exports, converted blueprints and data profiles moved out of the repository into a sibling
`clockwork-workspace/`, found through the `BLUEPRINT_WORKSPACE` environment variable
(`workspaceDir()` in `src/config.ts`, one indirection, nothing else).
**Decision criterion:** the operator organises work by theme, and this repository is a *tool* inside
that theme rather than one engagement's artefacts. Excluding client data by `.gitignore` alone was
not enough: with no git in play, an ignore rule separates nothing physically.
**Consequences:**
- The repository contains no client or project name, ticket prefix, Oracle pod tenant code,
  username, personal name, password or home directory path. Verified by the sweep in
  `.claude/skills/verify-offline/` section 3. Keep it that way.
- Everything needed to verify the project is synthetic and lives in `selftest/`:
  `fake-oracle/` for the engine, `sample-legacy-export/` for the converter, plus the worked example
  blueprint and its data profile.
- Generated artefacts that quote a real export go to the workspace or to `reports/`, never to the
  repository. That is why `tools/convert-legacy.ts` writes its conversion
  report to `<workspace>/reports/conversion-report.md`.
- `npm run check` must keep working with no workspace configured at all. It is the gate, and it must
  never require client data.
**Made systematic 2026-09-10 by D20.** D9 moved the scenarios out and left the configuration and the
run output behind, protected by `.gitignore` alone. D20 moves those out too.

### D10: `.gitignore` patterns are anchored, and verified rather than read
**2026-08-29. Confidence: certain, verified empirically. Only relevant if the project is pushed.**
Two real bugs were found and fixed, both silent:
1. `data/` excludes the directory, so git never descends into it and the `!data/selftest.yaml`
   exception was **ineffective**. The `/data/*` form is required for a `!` exception to work.
2. `blueprints/` without a leading slash matches at **any depth**, so it also swallowed
   `selftest/blueprints/`, which must be kept.
**Consequence:** if you touch `.gitignore`, re-verify with `git check-ignore -q <path>` in a throwaway
repository. Do not trust reading the patterns.

### D11: Resolution is 100% semantic. Stored selectors are gone.
**2026-08-29. Confidence: high. Reverses D3.**
No `legacy_xpath`, no fallback to a legacy selector. Visible label, ARIA role and name, placeholder,
adjacent text, then `hints`. Nothing else.
**Decision criterion, and note that it is a fact and not a preference:** D3 assumed a complete legacy
export including its object repository. The operator now has access to the legacy platform and reports that objects
must be extracted one at a time; the four exports reviewed on 2026-08-29 contain **302 referenced
objects and zero XPath**. The safety net would be empty in nearly every case while still costing a
schema field, a code path, tests and a concept to explain. That is the definition of technical debt.
**Consequences:** a wrong label now fails immediately instead of quietly working, which is desirable
under D2. The debt reporting built for D3 (`resolution_method: legacy_xpath`) becomes moot and goes.
Removing this also makes the engine usable by someone who has never heard of the legacy platform.
**Implemented 2026-09-02.** `src/blueprint.ts` now refuses a step carrying `legacy_xpath`, `xpath`
or `selector` by name, so an old blueprint explains itself rather than failing obscurely.

### D12: One test is one user session. No login, logout or persona switching.
**2026-08-29. Confidence: certain (operator's own framing, paraphrased from French: signing in and
signing out are mere convention, not what a test is about).**
A test covers what one person can do from A to Z inside one active Oracle session. A legacy scenario
with four personas becomes four separate tests, chained by a human.
**Decision criterion:** the cost of multi persona (session blocks, UI sign out, business process
waits of up to 260 seconds while an approval propagates) buys only automatic chaining. Coverage is
preserved by splitting. That is a very good trade for a solo build.
**Implemented 2026-09-02.** The converter splits a scenario at every sign in block into `_1`, `_2`,
`_3`, drops the sign out and the user menu click that opens it, and writes into each file that the
parts run in order and depend on each other.

### D13: Authentication is infrastructure, not test content. REFINED by D19
**2026-08-29. Confidence: high.**
One manual sign in captured into a gitignored `storageState.json` and reused. A blueprint starts at
the first functional action.
**Decision criterion:** it removes passwords, `password_var` and per persona credentials from the
schema, makes the test purely functional, and **neutralises the MFA risk** that was open question Q1
and the single thing that could have stopped the project.
**Implemented 2026-09-02** as `npm run auth` (`tools/capture-session.ts`). Two details that are not
obvious and are load bearing:
- The production guard runs there too. Capturing a production session would be worse than one test
  against production, because the file is then reused by every run afterwards.
- The interpreter checks, once, right after the opening navigation, whether the sign in page is
  showing, and says so by name. Without that check an expired session appears as a resolution
  failure on step 1 against a login form, which reads as "Oracle renamed something" and sends the
  tester looking in exactly the wrong place. A session expires silently every few days, so this is
  the most common failure the engine will ever produce.
**Refined 2026-09-10 by D19.** The principle stands and the mechanism changed: the captured file is
no longer the default. A run signs in in its own window and keeps nothing; `SESSION=saved` keeps
this model alive for hidden runs.

### D14: Assisted mode is the product, not a convenience
**2026-08-29. Confidence: high. This is the defining decision of v3.**
A test that blocks is the expected outcome. The engine keeps the browser paused on the failing
screen, injects a banner naming what it was looking for and listing every actionable label on the
page, lets the tester act in that window, captures the accessible name of what they clicked, and
proposes updating the blueprint before resuming.
**Decision criterion:** the operator is repairing converted scenarios, not authoring from nothing.
A standalone recorder solves "I have nothing", which is not the situation. Assisted mode fixes only
the gaps, at the moment they appear, and turns a correction the tester was making anyway into
reusable knowledge.
**Three hard constraints, non negotiable for the mode to work at all.** They are C1, C2
and C3, stated here so a reader of the decision record cannot miss them:
1. **C1** The browser must stay open and paused. Web state cannot be saved and restored, so resuming
   at step 8 is only possible in the browser that reached step 7.
2. **C2** The resume control lives in the paused page, not in a central interface. With several tests
   paused at once a single terminal prompt cannot ask which one, and the tester is already in that
   window.
3. **C3** The per test timeout must be disabled while paused, or Playwright kills a test waiting for
   a human after ten minutes, in a way that looks like a random flake rather than a missing setting.
**Consequence worth remembering:** a blueprint no longer has to be correct when written. The file is
a draft and the run is the compiler.
**Implemented 2026-09-02** in `src/assist.ts`, verified by `selftest/assist.spec.ts` with nobody
there. Three decisions taken during the build that are not in the spec:
- **The run resumes at the NEXT step, never by repeating the failed one.** The tester has just
  performed the action by hand; clicking Save a second time is worse than not clicking it at all.
- **The blueprint file is rewritten as text, not parsed and re serialised.** A converted blueprint
  is mostly comments (`# INFERRED`, `# NOT CONVERTED`) and every YAML library discards them, so the
  first repair would silently delete the review notes.
- **The banner pushes the page down by its own height.** A fixed overlay across the top hides the
  very control the tester was asked to click, which is an effective way to make a helpful message
  useless.

### D15: Supervision uses Playwright UI mode. Do not build a dashboard. REFINED by D18
**2026-08-29. Confidence: high. Raised as a reservation and accepted. Stated as C4.**
`playwright test --ui` already provides a live test list, status, pause and inspection.
**Decision criterion:** a custom dashboard with live bot status and notifications is 3 to 5 days and
reopens the "engine, not platform" door that D1 deliberately closed. Build custom only against a
specific demonstrated gap.
**Related:** parallelism moves from `workers: 1` to configurable, on two conditions: scenarios in a
batch must be independent (Oracle data collides otherwise), and realistically 3 to 5 at once, since
beyond that nobody supervises anything.
**Still in force, and refined rather than reversed by D18.** No dashboard was built. What D18 adds
is a way to **start** a run without a terminal, which is a gap this decision never examined:
supervision of a running test stays in the injected banner and in Playwright UI.

### D17: What the first real pod taught, 2026-09-09
**2026-09-09. Confidence: certain, all three verified against a live environment.**
The engine had never touched Oracle. Everything below was invisible to the 50 offline tests of the time and cost an
afternoon each, so they are recorded as symptoms, not as fixes.

- **The bundled Chromium could not start headed on a managed Windows workstation.** `spawn UNKNOWN`
  from Playwright, "side by side configuration incorrect" from Windows, while its headless shell
  ran fine. Assisted mode needs a window, so the only broken path was the one the operator needed.
  `BROWSER_CHANNEL` and `BROWSER_EXECUTABLE` in `src/config.ts` now point the engine at a browser
  the machine already trusts. Since 2026-09-10 neither needs setting: with both empty the engine
  drives the user's default browser when it is Chromium based, else any installed one
  (`src/browser.ts`). A note written here the day before said that a browser already open
  swallows the launch. It was tested the next morning with Brave and Edge both open, both launched
  headed without trouble, because each run gets a fresh profile. The note was wrong, and the cause
  of that first windowless failure was never identified.
- **An exact `title` beats a loose accessible name.** Resolving "My Team" in the Fusion Navigator
  found the expand chevron, whose accessible name is "Expand My Team", on the loose pass. Wrong
  element, and an unclickable one. The group itself is a div carrying `title="My Team"` and no role
  at all. `getByTitle` was added to the chain **after every exact strategy and before every loose
  one**, which is the ordering rule `src/locate.ts` already stated and did not follow.
- **An expired session was not recognised as one.** Oracle IDCS asks for a user name alone and
  shows a password field only afterwards, so every password shaped indicator missed it and step 1
  failed with "label Navigator not found" against a sign in screen. The address bar is the half
  that cannot be missed: `config.session.signedOutUrlPatterns`. A dead session now stops the run in
  two seconds and names `npm run auth`, instead of thirty five seconds of misdirection.
- **A window that opens and closes in two seconds is an expired session, not a crash.** The run
  stops on SessionError and Playwright closes the browser with the test, which from outside is
  indistinguishable from the browser dying. Seen 2026-09-10 on two scenarios in a row. The local
  interface now asks Oracle whether the session is alive before a run, refuses to start one it
  knows would fail, and names the problem in plain words when a run meets one anyway.
**Decision criterion:** each of these turns a five minute problem into an afternoon, because the
symptom points at the wrong layer. That is exactly what D2 says a failure message exists to prevent.

### D18: A local web interface, for starting a run. Not the dashboard D15 refused.
**2026-09-09. Confidence: high. Raised by the operator, scope negotiated before any code.**
`npm run gui` serves a page on 127.0.0.1 with six sections: session, scenario, data, run, progress,
report. It signs in, lists the blueprints, fills a data profile, starts a run, follows it step by
step and opens the report.
**Decision criterion:** D15 forbids a supervision dashboard and asks that anything custom be built
only against a specific demonstrated gap. The gap is not supervision, which stays where it is: in
the banner assisted mode injects into the Oracle page (C2) and in `playwright test --ui`. The gap
is **starting a run at all**, since every entry point was a terminal command and the operator
maintains Oracle configurations rather than software. D15 never examined that.
**The rule that keeps it honest:** the server runs the existing entry points and reads the journal.
No second copy of the engine, no alternative code path, nothing a command line run would not also
do. Delete it and only convenience is lost.
**Consequences and boundaries:**
- **No password field, here or anywhere.** Since D19 a run opens on the sign in page and the
  person signs in there; the Sign in button, which spawns `npm run auth`, only appears with
  `SESSION=saved`. No credential store on a consultant laptop is created either way.
- **Loopback only**, cross origin writes refused, scenario and profile names validated as names,
  report files served only from under the reports directory.
- **Hiding the browser and pausing for help are refused together.** Assisted mode waits without a
  timeout (C3) for somebody to act in a window that would not exist. The command line lets you make
  that mistake; the page does not.
- A data profile is edited **as text**, one value line at a time, for the reason `repairBlueprintFile`
  is (trap 11): the comments are where the reason for each value is recorded, and a YAML round trip
  deletes them. Six tests in `selftest/profile.spec.ts` hold that line.
**One piece of ornament, and it is the argument.** Clicking the title opens a pixel animation: a
hand sets a wind up car down, it runs in a straight line, hits a wall, stops, and a hand picks it
up. That is the governing image from `README.md` and `AGENTS.md`, and every scope decision in this
repository is that sentence applied to something. It is self contained at the bottom of
`tools/gui/index.html`, nothing imports it, and it stops its own animation frame when closed. Do
not delete it as cruft; delete it deliberately, in one cut, if it ever stops being true.

**Rejected inside this decision:** a packaged executable, because Playwright plus a browser plus
Node is hundreds of megabytes and an unsigned binary on a managed workstation is an IT conversation,
not a build step. And a natural language prompt as the input to a run, because a run that improvises
its steps is not a regression test. Natural language belongs to authoring, which produces a
blueprint a human reviews before it is ever executed.

### D19: A run signs in in its own window, and keeps nothing
**2026-09-10. Confidence: high. Raised by the operator, details agreed before any code.**
Each run opens the application in a fresh, temporary profile. When the application answers with
its sign in page, the run waits there for a person, second factor included, notices the sign in
finishing by itself, and carries on in that same window. Nothing about the session is written
anywhere, and it ends with the window. `SESSION=saved` restores D13's captured file for the one
case the window cannot serve: a run with the browser hidden, where nobody is there to sign in.
**Decision criterion:** three things at once. The session file was as sensitive as a password and
lived on a consultant laptop; it is gone. An expired session was the most common failure and
looked like a browser crash; there is nothing left to expire. And the person running the test now
sees it begin, from the sign in to the last step, in one window, which is the clearest signal of
who is in control that the tool can give.
**Principle unchanged:** no password in the tool, a human for the second factor, no sign in step
in any blueprint. D13 is refined, not reversed.
**Consequences and details:**
- **One sign in per scenario, not per batch.** A batch sharing one session would run every
  scenario as whoever signed in first, and the converter splits scenarios precisely where the
  person changes: part two of an approval, run as the requester, could go green as the wrong
  person. Signing in per scenario is correct by construction. Reusing a session across scenarios
  of the same person stays possible later, and would need a blueprint to say who it runs as.
- **The wait has no timeout**, like an assisted pause (C3). A run left alone at the sign in page
  waits for a person. A run whose browser is hidden cannot be signed into and stops at once,
  saying so, instead of waiting for someone who cannot see the window.
- **Two conveniences agreed at the same time.** A pause after every step when asked
  (`WATCH_DELAY_MS`, "slow down so I can follow" in the interface, 700 ms), per step rather than
  Playwright's slowMo so the resolution chain keeps its own timing. And the window stays up a few
  seconds after the last step (`END_HOLD_MS`, 3000 by default), so the final screen is seen
  rather than vanishing. Both apply only when the browser is shown.
- **A double click launcher**, `Clockwork.cmd`, for Windows. A script rather than a packaged
  program, for the reason D18 rejected a packaged executable: a new unsigned binary is what a
  managed workstation blocks, while the npm scripts it wraps already run there.
- **Only Chromium browsers can be driven**, installed ones included, and the user's default browser
  is preferred when it is one (D17). Firefox and Safari need Playwright's own builds. A browser
  that cannot be started produces a message naming it and listing the supported ones.

### D20: The application folder holds nothing but the application
**2026-09-10. Confidence: certain (stated by the operator: "radical et systématique").**
Everything specific to a user or to a round of tests lives in the workspace: the `.env`, the
scenarios, the data profiles, the legacy exports, a captured session, and every run's output
(journals, screenshots, summaries, Playwright's own report and results). The application folder
keeps only what works without configuration or data: code, the synthetic self test,
documentation, and `.env.example`, which is now a template.
**Decision criterion:** D9 moved the scenarios out and left the run output and the configuration
behind, protected by `.gitignore` alone. Once the repository was public on GitHub that was the wrong
way round: screenshots of client screens sat in the folder of a public repository, one rule away
from being published, and zipping or copying the folder carried them along. Physical separation
makes the mistake impossible instead of merely forbidden.
**How it works:**
- `src/workspace.ts` finds the workspace **without configuration**, because the configuration now
  lives inside it: the folder next to the application called `clockwork-workspace`, unless
  `BLUEPRINT_WORKSPACE` is set in the environment Clockwork is started from. It loads
  `<workspace>/.env` before anything reads a setting, and refuses to let that file move the
  workspace. It imports nothing from the engine, since `config.ts` depends on it.
- **The workspace is created, not assumed.** Superseded in part by D21: only `npm run init` creates
  the folder. It builds the layout: `blueprints/`, `blueprints/disabled/`, `data/`,
  `legacy-exports/`, `templates/` with a blueprint template for writing scenarios by hand (verified to
  load), `reports/`, a README, and a `.env` copied from `.env.example`. Nothing that exists is ever
  overwritten.
- **Material found in the application folder is named, never moved.** A `.env`, `.auth/` or
  `reports/` left there from before is listed on start as ignored, with where it should go. Moving a
  user's files is the user's decision.
- **The self test stays outside every workspace.** Its synthetic output goes to `selftest/.output/`,
  so `npm run check` still needs no workspace and no client data (D9).
- The converter finds the workspace the same way without importing `src/workspace.ts`: it is also
  run by plain Node in the self test, which cannot load the engine's TypeScript modules.
- **The interface was reworked in the same change.** Scenarios in a right hand column as a compact,
  filterable mosaic, and several of them can be selected and run at once. A selection is one
  Playwright run, one journal and one report, scenario after scenario (WORKERS stays 1): no more
  load on the machine than one at a time, and no two scenarios colliding on the same Oracle data.
  Each one still signs in in its own window (D19).

### D21: A missing workspace stops Clockwork, it is never recreated by accident
**2026-09-28. Confidence: high (asked for by the operator, after a near loss).**
The operator keeps both folders in a synced drive and moves them by hand. On 2026-09-27 a move left
two identical workspaces side by side, and the next day a clean-up sent a whole workspace to the
recycle bin, restored intact. D20 created the workspace on any start that found it missing, so a
workspace moved without the application would have been replaced, silently, by an empty one in the
old place, splitting scenarios and reports across two folders.
**Decision criterion:** a missing workspace is far more often a moved one than a first start, and
the two cannot be told apart from inside the application. Asking once costs a keystroke; guessing
wrong costs the user's scenarios.
- `ensureWorkspace` completes a workspace that exists and throws `WorkspaceMissingError` when the
  folder itself is missing, writing nothing. Only `create: true` creates it.
- `npm run init` is the one entry point that passes it. `Clockwork.cmd` asks Y or N on a first start
  and runs it on Y. `npm run gui`, `npm test` and `npm run auth` stop with a message that says how
  to find the workspace again or create it.
- The self test proves both sides: a missing folder throws and stays missing, an empty existing one
  is completed.

---

## Rejected options, and why

| Option | Rejected because |
|---|---|
| Self healing (auto repair of broken selectors) | Where 90% of the complexity would sit, for a problem the operator does not have. Human intervention on failure is the intended workflow, not a fallback. |
| Retries on failure | Same reason. `retries: 0` in `playwright.config.ts` is deliberate, not an oversight. |
| Translating the legacy platform's 184 hardcoded sleeps into waits | Playwright auto waits. A one for one translation would import the slowness and none of the value. `wait_for` exists only for a named state change and is expected to be rare. |
| A custom reporter now | The client facing report format had not been supplied. It arrived later and became `tools/evidence.ts`, a generator reading the journal (D7), not a Playwright reporter. |
| Sharing `blueprints/` and `data/` | Client derived material. A shared copy gets the synthetic `selftest/blueprints/selftest_create_course.yaml` instead, which is executed by the test suite. |
| Keeping a real legacy export as the converter's test fixture | It would have put client material into a versioned file. `selftest/sample-legacy-export/` reproduces the structure exactly with invented content, and it found a converter bug the real export never would have surfaced. |
| Any git based workflow (history, branches, commits) | The operator develops solo and deleted the history deliberately. See D8 (superseded by D16). |
| A standalone recorder (GUI to blueprint from nothing) for the MVP | Solves "I have nothing", which is not the situation: the operator is repairing conversions. Assisted mode (D14) is the exact tool and costs the same. Deferred to phase 2, not rejected outright. |
| A custom supervision dashboard | See D15, still in force. Playwright UI mode is free and maintained by someone else. D18 builds a launcher, which is a different thing and says so. |
| Conditional branching | 2 occurrences in 1852 steps, 0.1%. Adding branching to a declarative format is the first step towards a programming language, which is what this project exists to avoid. |
| Image recognition (`run visual button click`) | Present once in the corpus. Out of scope permanently. |
| Building an authoring UI | `playwright codegen` already exists, is free, and natively prefers `getByLabel` and `getByRole`, which is exactly the anchor style this engine wants. See `docs/RECORDING.md`. |
| A packaged executable of the local interface | Playwright plus a browser plus Node is hundreds of megabytes, and an unsigned binary on a managed workstation is an IT conversation, not a build step. A local server needs no packaging and no signature. See D18. |
| A natural language prompt as the input to a run | A run that improvises its steps each time is the opposite of a regression test. Natural language belongs to authoring, which produces a blueprint a human reviews before it is ever executed. See D18. |
| A linter | `tsc` in strict mode with `noUncheckedIndexedAccess` serves the purpose. Ceremony for a one person project. |
| Parallel test execution as a default | Oracle test data does not tolerate it: two scenarios creating the same course collide. `WORKERS` defaults to 1 for that reason, and raising it is a decision about the composition of the batch, not about the machine. |
| Re running the failed step after a repair | The tester has already performed it by hand. See D14. |
| Parsing and re serialising a blueprint to repair it | It would discard the comments, which is where most of the review value of a converted blueprint lives. See D14. |

---

## Open questions

Ordered by how much they block. Each names who can answer it. Since the archive none of them blocks
anything: they are what a person resuming the project should read first, not pending work.

### Q1: ~~Can Playwright authenticate against the DEV pod?~~ CLOSED by D13
**Closed 2026-08-29.** Authentication left the test files entirely: one manual sign in, captured
into `storageState.json`, reused. The MFA question, which was the single risk that could have
stopped the project, no longer arises. The operator will do that first manual sign in when the
engine is ready for the first real run.

### Q1b: Does anything else break on first contact with a real pod? **Partly answered, parked by the archive.**
First contact happened on 2026-09-09 and found three defects, all fixed (D17). Only more live runs
can say what else breaks. See `.claude/skills/first-live-run/`.

### Q2: Are the Oracle specific selectors right? **Confidence: low, by construction.**
Three config lists were written without ever seeing a live Redwood page:
`config.lov.optionContainers`, `config.errorIndicators`, and `config.session.signedOutIndicators`.
They are isolated in `src/config.ts` precisely so the tuning session touches one file.
Answered by: the first live run.

### Q3: Are the inferred labels correct? **Confidence: medium, and it no longer matters much.**
Steps marked `# INFERRED` have a label guessed from the legacy object name. There is no safety net
behind a wrong guess and there is not meant to be: it pauses the run in front of somebody who can
fix it in ten seconds, and the correction writes itself back into the file. About 90% of object
names map straight onto something on screen, so most will simply be right.
Answered by: the first live run, per scenario. The report's "Steps repaired during the run" section
is the answer in written form.

### Q4: How large is the real legacy corpus? **Confidence: unknown. Affects the converter's value.**
The sample is one module, 7 scenarios, one author, Redwood only. All percentages measured on it
describe that sample and are not extrapolations.
Break even for the converter was estimated at about 15 scenarios; the converter was built anyway
because the operator expects a full export.
Cheap de-risking, still not done: obtain one more export from a different module and ideally a
different author, ideally ADF heavy, and re-run the classification. Roughly 30 minutes.

### Q5: How many legacy custom code functions exist in total? **Confidence: unknown.**
Only one was observed, `GenerateRandomString`, and its implementation is not in the export, only the
call signature. It was reimplemented as the `{{random_string(n)}}` generator. If the wider corpus
uses many custom functions, each is untranslatable from the export alone.
Answered by: the legacy platform team.

### Q6: ~~What does the client expect a test report to look like?~~ CLOSED 2026-09-24
One screenshot per step, the step beside it or above it, as a manual tester pastes them under each
row of a script. It became `tools/evidence.ts`, generated from the journal as D7 intended, HTML and
PDF, with the format isolated in its CSS so that a change of requirement touches one layer.

### Q7: Can the legacy platform export execution artifacts (run reports, failure screenshots, failing selectors)?
**Confidence: unknown. Not blocking anything today.**
The sample export contained none. This only matters if a self healing initiative is ever revived,
which is out of scope here.

---

## Corrections to earlier findings

Keep these visible: the first analysis was written from a single module, and one of its headline
conclusions turned out to be wrong.

**"Zero assertions across the corpus" is false.** The first analysis said the
legacy corpus contains no verification of any kind. That was true of the Learning module and false in
general. Four exports reviewed on 2026-08-29 contain 26 assertions:
`should be present`, `should have text as`, `should have partial text as`, and
`Link having text "X" should be present`. Consequence: `verify` has real source material, and risk 3
of the phase 2 report ("converted tests assert nothing and pass anyway") is downgraded, not removed.

**Iframes are confirmed, and were marked UNKNOWN.** The ADF heavy FixedAssets suite uses
`switch to frame having xpath` and `having index`. Handled automatically by the resolution chain in
v3 (search the main document, then each embedded one), never mentioned in a blueprint. Note that an
iframe problem is unrelated to selectors: a label inside an embedded document is invisible to a
search of the outer one, whatever the search method.

**"All sleeps can be dropped" was too broad.** Of 758 sleeps in the new corpus, 660 are under 10
seconds and are replaced by auto waiting, but 5 are 60 seconds or more and wait for an approval
workflow to propagate to another user. Most of those disappear with D12; any that survive inside a
single session become an explicit `wait_for`.

**The vocabulary is larger than measured.** 35 distinct verbs across the wider corpus, not 13. Still
closed and self describing, so the property that makes conversion mechanical still holds.

## Non obvious invariants

Things a new agent is likely to break without noticing.

1. **Never put a selector in a blueprint.** Not in `label`, not anywhere. Since D11 there is no
   field for one. The only permitted disambiguation is `hints` (a panel name and an ordinal), which
   is human readable by construction.
2. **The browser must stay open while a test is paused** (D14). Web state cannot be saved and
   restored, so resuming is only possible in the browser that reached the failing step. And the
   per test timeout must be disabled while paused, or Playwright kills the test after ten minutes.
   `timeout: 0` in `playwright.config.ts` is that setting, and `selftest/engine.spec.ts` asserts it,
   because getting it wrong looks exactly like a random flake and would cost a day to diagnose.
3. **The engine must never emit a report format directly** (D7).
4. **`tools/convert-legacy.ts` must not overwrite an existing blueprint without `--force`.** Reviewed
   blueprints carry hand corrected labels the converter cannot reproduce. This guard exists because
   losing them silently would be the most expensive possible bug in that tool.
5. **The production guard reads the environment token from the first hostname label, not a substring
   search.** Oracle DEV pods are legitimately named `fa-xxxx-dev1-saasfaprod1...`, so a naive search
   for "prod" blocks DEV. Four cases are covered by tests in `selftest/engine.spec.ts`.
6. **`selftest/blueprints/selftest_create_course.yaml` is both the worked example and the test
   fixture.** That coupling is deliberate: an example that is executed cannot drift. Do not replace
   it with an inline object literal.
7. **Before exporting anything new from the legacy platform, the scenarios must be active (not commented out).**
   A commented scenario exports its steps but none of its locators, so the export looks complete and
   is unusable. In the sample, 60 of the 66 objects used by commented scenarios had no locator row.
8. **`data/*` and `/blueprints/*` in `.gitignore` are load bearing** (D10).
9. **Nothing client specific may enter this repository** (D9). The converter writes its report into
   the workspace for this reason; never move it into the repository.
10. **A label is not an id because it is long.** `labelFromXPath` in `tools/convert-legacy.ts` once
   rejected any word over 12 characters, which threw away real labels like "Notifications".
   Generated ids are recognised by their separators (`:` and `_`), never by length.
11. **A step commented out inside a live legacy scenario must not become a step.** Its author switched
   it off; converting it puts back something a human deliberately removed. The exception is a
   scenario commented out in its entirety, where the comments are all there is.
12. **The captured session file is live credentials in JSON.** `storageState*.json` is gitignored at
   any depth. The one exception is `selftest/fake-session.json`, which is synthetic, holds a single
   local storage key and is committed on purpose: without it the self test cannot exercise the
   session path at all.
13. **A repaired step is not re checked for an Oracle error.** A person has just been looking at
   that screen, and their judgement beats the banner detector's.
