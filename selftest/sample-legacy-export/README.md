# Synthetic legacy export

Invented data with the exact structure of a real legacy export, so the converter can be exercised and
demonstrated without any client material. Nothing here comes from a real system: the scenarios, the
usernames, the pod URL and the ticket ids are all made up.

Three files, which is what the legacy platform produces:

| File | Role |
|---|---|
| `Demo_Suite.feature` | Gherkin test definitions. Steps carry `[ObjectName]` and `(DataParam)` references, never a selector and never a value. |
| `Demo_Suite.csv` | Object repository. One XPath per object, per scenario. |
| `Demo_Suite (1).csv` | Data profile. One header row of parameter names, one value row. |

It deliberately reproduces every construct the converter has to handle:

- a sign in block, which is dropped, and a sign out, which is dropped with it
- a scenario that switches persona, which becomes two blueprints to be run in order
- a navigation run, ended by a screenshot the way legacy authors mark a checkpoint
- a list of values committed with Tab, and a search box committed with Enter
- both list verbs: `select from list` (type ahead) and `select from dropdown` (a plain choice list)
- a double click, a bare key press, a page refresh, and a frame switch that is dropped because
  frames are searched automatically
- the three assertion forms: `should be present`, `should have text as`, `should have partial text as`
- a read only field capture, and a custom code call, which is not translated
- XPaths that carry a visible label, XPaths that carry only a generated Oracle id, and a whole
  scenario with **no object repository entries at all**, which is the normal case in the real
  exports: 302 object references and zero XPath
- a step commented out inside a live scenario, which must not become a step
- things the converter refuses to translate: a conditional block, image recognition, a file
  download, and a verb it has never seen
- a scenario commented out in the legacy platform in its entirety, which therefore has no locators: the trap
  described in `.claude/skills/convert-legacy-export/`

Used by `selftest/converter.spec.ts`. To try it by hand:

```bash
npm run convert -- selftest/sample-legacy-export ../convert-demo
```
