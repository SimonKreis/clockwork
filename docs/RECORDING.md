# Repairing and writing a test in the browser

Two ways in, and the first one covers almost everything.

## 1. Assisted mode, which is where a repair belongs

When a step cannot find its element, the run does not fail. It pauses on that screen and puts a
banner at the top of the page:

```
Paused at step 7 of 14 - create_a_course
fill "Course Title" with "{{title}}". I could not find "Course Title" on this page.
Do the action yourself in this window, then click Resume.

Nothing captured yet. Do the action in this page, or pick a label below.
[ Resume ]  [ Stop this test ]

Everything on this page right now. Click one to use it as the label:
[Title] [Syllabus] [Publish Start Date] [Category] [Save and Close] ...
```

What to do:

1. **Do the action yourself**, in that window. Click the control, type the value.
2. The banner shows what it captured: *You clicked: "Title"*. If you would rather name it
   differently, click one of the labels in the list instead.
3. Press **Resume**. The blueprint file is rewritten with that label, comments and all, and the run
   continues at the **next** step. It does not repeat what you just did by hand.

Press **Stop this test** if the right answer is not a renamed label. You get an ordinary red test
and a report, which is sometimes exactly what you want to hand back.

Nothing is written back if you resume without clicking anything: the run continues, and the report
says the step was resumed but not repaired.

### Why the repair happens here and not in a tool

The correction you were going to make anyway becomes the fix, at no extra cost. And because the run
is repaired as it goes, a blueprint does not have to be right when it is written: ten lines of
approximate plain language, run once and corrected on the way, is a legitimate way to author a
test. The test file is a draft. The run is the compiler.

### When several tests are paused at once

Each one waits in its own window, and is resumed there. There is no central screen to check and no
prompt asking which test you mean: you are already in the window that matters. Use `npm run ui` to
see which tests are running and which are waiting.

## 2. The recorder, for a scenario that does not exist yet

Assisted mode repairs an existing test. When there is no test at all, Playwright's own recorder is
still the fastest way to learn what Oracle calls things:

```bash
npm run record -- https://your-dev-pod.oraclecloud.com/
```

A browser opens next to a window that writes code as you click. What you are looking for in the
generated code is the **label**, not the code:

```ts
await page.getByLabel('Publish Start Date').fill('2026-08-10');
await page.getByRole('button', { name: 'Save and Close' }).click();
```

Those become:

```yaml
  - action: fill
    label: "Publish Start Date"
    value: "{{StartDate}}"

  - action: click
    label: "Save and Close"
```

Close the recorder when you have what you need. The generated file is a draft to read, not
something to keep.

## When there is no label at all

Sometimes the recorder writes this instead:

```ts
await page.locator('#pt1\\:r1\\:0\\:sdDt\\:\\:content').fill('2026-08-10');
```

That means the control has no accessible name: no label, no aria-label, no placeholder. Two
options, in this order:

1. **Look at the screen.** There is usually a visible label next to the field that the recorder did
   not associate with it. Use it. The engine's adjacent text strategy finds the control that
   follows a label even when the HTML does not link them.
2. **Use a hint.** `hints: { section: "Assignment Info", index: 1 }`. A panel name and an ordinal,
   both of which a human can read and check.

**Never put a selector in `label`, or anywhere else.** There is no field for one, and the loader
refuses a blueprint that carries one. If no person can describe a control by something visible, no
person can read that test step either, and a positional hint is the honest answer.

## Reading a failure

Whether it pauses or fails, the message is the same, and it is written to be acted on without
reading any code:

```
Could not find the element for label "Category Course".

  What the step wanted : a field to type into
  Label looked for     : "Category Course"
  Page                 : https://.../learning/courses
  Searched             : the page and its 2 embedded frame(s),
                         by visible label, ARIA role and name, title, placeholder and adjacent text

  Labels currently visible on this page that look similar:
    - "Category"

  Everything actionable on this page right now:
    - "Title"
    - "Category"
    - "Save and Close"
    ...
```

Most of the time the answer is in the list. Record only when it is not.

## After a run

`npm run report` produces a summary listing, among other things:

- **Steps repaired during the run**: what Oracle renamed, old label next to new. Read it as a
  change log, and check the new labels are the ones you would have chosen.
- **Ambiguous labels**: the label matched several elements and the first visible one was assumed.
  Add a `hints:` block to make those steps deterministic.
