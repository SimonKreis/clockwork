---
name: verify-offline
description: Verify the engine, the converter and the repository without any Oracle environment, credentials or client data. Use before handing the project over, after changing src/locate.ts, src/config.ts or tools/convert-legacy.ts, before claiming anything works, or when a new agent needs to establish that the codebase is sound before blaming the environment.
---

# Verifying offline

Everything except contact with a real Oracle pod can be verified on a machine with no credentials
and no client data. Do this before blaming Oracle for anything, and before telling anyone the
project works.

## 1. The standard gate

```bash
npm install
npm run install:browsers
npm run check              # typecheck + 70 offline checks, about 90 seconds
```

Two fixtures carry the whole suite, and neither contains anything real:

- **`selftest/fake-oracle/`** drives the engine end to end. It deliberately reproduces the traps
  that matter: a session restored from a captured storageState (and a sign in page behind it, for
  the expired case), a list of values with an asynchronous suggestion list, a plain choice list that
  looks identical and behaves nothing alike, a field that lives inside an iframe, a read only field
  whose label and value are two separate elements, a control with no accessible name at all, and an
  Oracle that refuses a save while letting every click through.
- **`selftest/sample-legacy-export/`** is a synthetic legacy export with the identical three file
  structure. It drives the converter: dropping the sign in and sign out, splitting a persona switch
  into separate blueprints, navigation runs, Tab meaning a list of values and Enter meaning a
  search, inferred labels, the newer verbs and assertions, the refusal to translate what it cannot,
  password stripping, and the refusal to overwrite a reviewed blueprint.
- **`selftest/fake-session.json`** is a synthetic captured session, committed on purpose and holding
  nothing secret. Without it the suite cannot exercise the session path, which is the only way any
  run gets a session at all.

If this is red, the problem is in the code. Read the failing assertion before touching anything else.

Both fixtures have already earned their keep: the fake Oracle caught a read only field being
captured by its label instead of its value, and the synthetic export caught a real label
("Notifications", 13 characters) being rejected as if it were a generated id, and later caught the
converter turning steps their own author had commented out into real steps. Add to them rather than
replacing them.

Assisted mode is verified with nobody there: `selftest/assist.spec.ts` finds the paused page the way
a person finds the window, does the action in it, and clicks Resume. Everything in between is the
real thing, including the rewrite of the blueprint file.

## 2. The fresh clone test

Client material lives in the workspace outside the repository, so the repository itself is already
the shareable set. What a clone must prove is that it installs and passes with nothing else:

```bash
SRC=$(pwd); DEST=/tmp/fresh; rm -rf "$DEST"
git clone "$SRC" "$DEST" && cd "$DEST"
npm ci && npm run check && npx playwright test
```

Before 2026-09-07 there was no repository and this was a `tar` based copy instead. If you find
yourself in a working tree with no `.git`, that is what to fall back to, excluding `./node_modules`
and `./reports` with the `./` prefix: an unanchored `--exclude=blueprints/*` also matches
`selftest/blueprints/`, which is a fixture the suite needs.

Expected: `npm run check` gives 70 passed, and `npm test` gives **1 skipped**, not 1 failed. The skip
is correct: the copy's workspace is new and empty, so there are no blueprints to run.
`npm run check` must never need a workspace. If it does, something has leaked a dependency on client
data into the gate.

## 3. Check for anything client specific before sharing

The single most important check in this file. Everything in the repository is anonymised and must
stay that way.

```bash
grep -rniE "<client-code>|<ticket-prefix>|<pod-tenant>|<real-username>" \
  --include='*.md' --include='*.ts' --include='*.yaml' . \
  | grep -v node_modules | grep -v '^./reports/' | grep -v '^./legacy-data-extract/'
```

Substitute the real terms you are looking for. Categories that must never appear in a versioned
file: client or project names and ticket prefixes, the tenant code inside an Oracle pod hostname
(`fa-<tenant>-dev1-...`), usernames, personal names, passwords, and absolute paths containing a
home directory. Since D13 there is one more, and it is the most dangerous of the lot: a **captured
session file**. It is live credentials in JSON form. `storageState*.json` is gitignored at any
depth; the only such file in the repository is the synthetic `selftest/fake-session.json`, and if
you ever find a second one, check what is in it before anything else. Generated artefacts that quote a real export belong in the workspace `reports/`,
never in the repository.

## 4. If the project is ever pushed to GitHub

`.gitignore` is maintained for that day, and its patterns are anchored deliberately. Verify them
rather than reading them, because three silent bugs have been found this way:

```bash
SRC=$(pwd); cd /tmp && rm -rf gitcheck && mkdir gitcheck && cd gitcheck && git init -q .
cp "$SRC/.gitignore" .
mkdir -p data blueprints selftest/blueprints selftest/data src legacy-exports .auth
touch data/x.yaml blueprints/x.yaml legacy-exports/x.csv .auth/storageState.json \
      selftest/blueprints/selftest_create_course.yaml selftest/data/selftest.yaml \
      selftest/fake-session.json src/locate.ts
for f in data/x.yaml blueprints/x.yaml legacy-exports/x.csv .auth/storageState.json \
         selftest/blueprints/selftest_create_course.yaml selftest/data/selftest.yaml \
         selftest/fake-session.json src/locate.ts; do
  printf '%-50s %s\n' "$f" "$(git check-ignore -q "$f" && echo IGNORED || echo tracked)"
done
```

Required, and the split is the point:

| Path | Must be | Why |
|---|---|---|
| `data/x.yaml`, `blueprints/x.yaml`, `legacy-exports/x.csv` | IGNORED | Client derived. These directories should not exist at the repository root at all any more (D9); the rules are guards in case one is recreated by mistake. |
| `.auth/storageState.json` | IGNORED | Live session credentials. |
| `selftest/blueprints/...`, `selftest/data/selftest.yaml` | **tracked** | Synthetic fixtures. The suite fails without them, which is how the second bug below was caught. |
| `selftest/fake-session.json` | **tracked** | A synthetic captured session holding one local storage key. Nothing secret, and the only way the suite can exercise the session path. |
| `src/locate.ts` | tracked | Sanity check that the whole tree is not being excluded. |

The rules that make this work:

- A leading slash on every project level rule. `blueprints/` unanchored matches at **any depth** and
  would swallow `selftest/blueprints/`.
- `/data/*` not `/data/`. Git does not descend into an excluded directory, so a `!` exception inside
  one is silently ineffective. No `!` exception is needed today, because the fixtures moved under
  `selftest/`, but the form is kept so that adding one later actually works.
- `storageState*.json` deliberately **unanchored**, so it catches a session file wherever anyone
  saves it. `selftest/fake-session.json` is named so that it does not match, which is why it can be
  committed.

## 5. Before a handover

```bash
grep -rn "TODO\|FIXME\|HACK\|XXX" --include="*.ts" src tests tools selftest *.ts
```

No hit is expected. Any hit is real work.

There is no linter. `tsc` in strict mode with `noUncheckedIndexedAccess` is the quality gate, and
`npm run typecheck` runs it alone.
