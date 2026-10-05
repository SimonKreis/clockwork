---
name: convert-legacy-export
description: Convert a legacy export (a .feature file plus two CSVs) into YAML blueprints, then review the result. Covers the export completeness check that must happen before anything else, the conversion rules that involve judgement, and what a human must correct by hand afterwards. Use when a new legacy export arrives, when asked to migrate more scenarios, or when estimating conversion effort for a corpus.
---

# Converting a legacy export

A legacy export is three files: `<Suite>.feature` (Gherkin, symbolic steps), `<Suite>.csv` (object
repository, one XPath per object) and `<Suite> (1).csv` (data profile). A synthetic example is in
`selftest/sample-legacy-export/`.

## 1. Check the export is complete before touching anything

**This is the step people skip and it invalidates everything downstream.** A scenario that was
commented out in the legacy platform exports its steps but **none of its locators**, so the export looks complete
and is unusable. In the reference sample, 60 of the 66 objects used by commented scenarios had no
locator row.

```bash
grep -o '\[[^]]*\]' *.feature | sed 's/.*\[//;s/\]//' | sort -u > /tmp/referenced.txt
cut -d, -f3 *.csv | tail -n +2 | sort -u > /tmp/haslocator.txt
comm -23 /tmp/referenced.txt /tmp/haslocator.txt
```

Anything the last command prints has no locator. If that list is long, go back to whoever produced
the export and ask for the scenarios to be **activated in the legacy platform before exporting**. Do not quote a
conversion effort from a file listing.

## 2. Run the converter

```bash
npm run convert                                   # <workspace>/legacy-exports -> <workspace>/
npm run convert -- <exportDir> <outDir>
npm run convert -- <exportDir> <outDir> --force
```

Both the input and the output live in the workspace outside this repository, the folder next to it
(D20). Never convert a client export into the repository itself.

To see the converter work without any client data:

```bash
npm run convert -- selftest/sample-legacy-export /tmp/convert-demo
```

It never overwrites an existing blueprint without `--force`. Reviewed blueprints carry hand
corrected labels the converter cannot reproduce.

Output, all under the output directory: `blueprints/*.yaml`, scenarios commented out in the legacy platform go to
`blueprints/disabled/` (not picked up by the runner), the data profile goes to
`data/<suite>_default.yaml` with every password column stripped, and everything the converter was
unsure about is listed in `reports/conversion-report.md`.

The converter's judgement calls are covered by `selftest/converter.spec.ts`, which runs it against
the synthetic export. If you change a conversion rule, assert it there.

## 3. Review, in this order

Read the conversion report first, then the blueprints. Four things need a human.

**Every `# INFERRED` comment.** The label was guessed from the legacy object name, because the export
carried no usable XPath for that object. In the four exports reviewed during the design that is nearly
every object: 302 references, zero XPath. There is no safety net behind a wrong guess and there is
not meant to be, so a wrong one pauses the run in front of somebody who can fix it in ten seconds.
Improve the ones you can see are wrong; let the run find the rest. Corrections actually made on the
pilot: a misspelt object name to the label on screen, `Category Course` to
`Category`.

About 90% of object names map straight onto something readable on screen, so this is far less
frightening than the raw number suggests.

**Fields that should be `select` but were converted to `fill`.** The converter only produces
`select` when the legacy platform typed then pressed Tab. A list of values that the legacy platform merely typed into becomes a
`fill`, which preserves the legacy platform's behaviour exactly but misses the confirmation. The report flags labels
matching category, business unit, person, manager, location, department. Convert those by hand.

**Navigation paths that swallowed an action.** A run of clicks starting at Navigator collapses into
one `navigate` path, ending at the next screenshot. Sometimes it takes one click too many, for
instance a "Create" button. Behaviour is identical, semantics are not. The report warns on any path
longer than four entries.

**Everything marked `# NOT CONVERTED`.** Custom code, image recognition, file downloads,
conditional blocks, and any verb the converter has never seen. These are left in the file as
comments rather than dropped, so the blueprint is never quietly short of an action. Decide what
each one should be, or delete it deliberately.

**Thin assertions.** Legacy assertions do exist and are translated, but they are rare: 26 in 1852 steps
across the corpus. An earlier report claimed there were none at all, which was true of the Learning
module and false in general. Add at least one `verify` step per scenario before treating a green run
as proof of anything. The ticket id in the scenario title tells you what the expected result was.

**The parts of a split scenario.** A scenario that signed in as several people becomes `_1`, `_2`,
`_3`. They run in order, and each one assumes what the previous one created (and any approval it
triggered) already exists. Check that the split fell where the persona actually changed.

## 4. Conversion rules that involve judgement

All conservative, all behaviour preserving. Know them so you can spot when one misfired.

| The legacy platform | Becomes | Rationale |
|---|---|---|
| `add wait seconds`, `take screenshot`, `scroll` | dropped | Playwright auto waits and screenshots every step. 54% of the sample corpus was this. |
| navigate + user + password + sign in | **dropped**, and starts a new part | Signing in is infrastructure: the tester does it when the run opens (D19), not test content. |
| a sign out, and the user menu click that opens it | **dropped** | Same reason. It ends a part; it is not an action a test performs. |
| a run of clicks from Navigator or Home | one `navigate` path | A screenshot ends the run: legacy authors put them at logical checkpoints. |
| `fill` then Enter | `fill` with `press_enter` | Enter submits a search box. |
| `fill` then Tab | `select` | Tab commits a list of values. |
| `clear` then `fill` on the same field | one `fill` | Playwright's `fill()` clears first. |
| `close browser`, or a second sign in | a new blueprint file, `_1`, `_2` | One test is one session. A human runs the parts in order. |
| `select from list` / `select from dropdown` | `select` / `select` with `mode: dropdown` | They look alike on screen and behave nothing alike. |
| `double click on` | `click` with `double: true` | |
| `click on single key "VK_ENTER"` | `press_key` | The legacy platform borrows the key names from Java AWT. |
| `switch to frame having xpath/index` | **dropped** | Frames are searched automatically. Naming one is redundant at best and wrong the day Oracle adds another. |
| `should be present` | `wait_for` with `state: visible` | An assertion that fails the run when it never arrives. |
| `should have text as` / `partial text as` | `verify` with `equals` / `contains` | |
| `check if` ... `end conditional check` | the whole block, commented out | Branching is out of scope (2 occurrences in 1852 steps). Emitting the enclosed steps unconditionally would fail every run where the element is absent. |
| a step commented out inside a live scenario | **dropped** | Its author switched it off. Converting it would put back something a human removed. |
| `run visual button click`, `download file` | a comment, not translated | Out of scope for the MVP. |
| a verb with no rule at all | a comment, and an entry in the report | It used to vanish silently, which is the worst outcome: a blueprint that looks complete and is short by one action. |
| custom code call | a comment, not translated | Only the call signature is in the export. Replace with a `{{random_string(n)}}` style generator. |

## 5. Effort

About 10 minutes of review per scenario, plus one live run per scenario to confirm the inferred
labels. Budget the live run as the real review: assisted mode turns each wrong label into a ten
second correction that writes itself back into the file, so reading the YAML line by line beforehand
is mostly wasted effort. Read the report, fix what is obviously wrong, then run it.
