---
hash: 3ca108
type: test
created: 2026-09-02T09:57:00-06:00
title: "QA walkthrough — the artifact map and the single layout reader (dlr101)"
from: dev/dev-dlr101-2026-09-02T09:14-artifact-map-single-reader.md
status: ready
owner: null
branch: null
---
# QA walkthrough — Story `dlr101`

> dlr101 is additive in production: it adds the artifact map (`stageSubject`,
> `pathToArtifactKind`) and collapses layout reading to one resolver. It moves
> exactly ONE user-visible surface — the `devx next` unset-layout advisory —
> and that surface is what this walkthrough covers. It deliberately does NOT
> cover gate subject resolution, workstream resolution, or scaffolding: no
> production caller consumes the map yet (phases 2–4), so there is nothing
> user-facing to exercise there.

## Pre-flight

```bash
cd /Users/leonidbelyi/personal/devx/.worktrees/dev-dlr101
npm run build
```

## Manual checks

### 1. A repo that never chose a layout still gets the advisory

- [x] `machine` — the nag survives the move from `docsLayoutUnset(merged)` to `engine.layoutSource === "default"`

```bash
cd "$(mktemp -d)" && git init -q .
printf 'mode: YOLO\nproject:\n  shape: empty-dream\n' > devx.config.yaml
printf -- '- [ ] `dev/dev-aaa111-2026-01-01T00:00-x.md` — x. Status: ready.\n' > DEV.md
node <worktree>/dist/cli.js next | head -1 \
  | python3 -c "import json,sys; print('\n'.join(w for w in json.load(sys.stdin)['warnings'] if 'docs_layout' in w) or '(silent)')"
```

Expected:

```
engine.docs_layout is unset or not one of `workstream` / `project-level` — artifacts resolve through the `workstream` default nobody chose. Set it in devx.config.yaml (docs/CONFIG.md §15).
```

Invariant: the advisory is a WARNING on a read-only surface, never a blocker.
`devx next` still resolves a row (here row 12) and exits 0. A change that
turns this into a failure would give every pre-existing repo an unclearable
red check, which is how a true signal gets trained away.

### 2. A set-but-invalid layout nags, and the message does not lie

- [x] `machine` — the one deliberate behavior change dlr101 makes to a live caller

```bash
printf 'mode: YOLO\nproject:\n  shape: empty-dream\nengine:\n  docs_layout: workstrem\n' > devx.config.yaml
node <worktree>/dist/cli.js next | head -1 \
  | python3 -c "import json,sys; print('\n'.join(w for w in json.load(sys.stdin)['warnings'] if 'docs_layout' in w) or '(silent)')"
```

Expected:

```
engine.docs_layout is unset or not one of `workstream` / `project-level` — artifacts resolve through the `workstream` default nobody chose. Set it in devx.config.yaml (docs/CONFIG.md §15).
```

Invariant: the retired predicate asked whether the key was PRESENT, so a typo
counted as chosen and stayed silent while artifacts silently resolved through
the default. `layoutSource` asks whether a layout RESOLVED, so a typo now
nags. `loadMerged` runs no schema validation, so this is reachable in a real
repo. The wording must keep covering BOTH cases — a message telling someone
their key is unset while it sits in their config is a message that lies.

### 3. A chosen layout stays silent — in either shape, and via the legacy key

- [x] `machine` — no new noise for a repo that answered

```bash
printf 'mode: YOLO\nproject:\n  shape: empty-dream\nengine:\n  docs_layout: project-level\n' > devx.config.yaml
node <worktree>/dist/cli.js next | head -1 \
  | python3 -c "import json,sys; print('\n'.join(w for w in json.load(sys.stdin)['warnings'] if 'docs_layout' in w) or '(silent)')"
```

Expected:

```
(silent)
```

Invariant: a repo that answered the LEGACY bank key
(`personalization: {"docs.layout": …}`) must stay silent too — it HAS chosen a
layout, and `resolveDocsLayout` still honors it. Pinned in
`test/next-dispatch.test.ts` §"resolves the source from the real config".

### 4. devx's own runtime behavior is unchanged (AC 8)

- [x] `machine` — no production caller moved; this repo stays on `workstream`

```bash
cd <worktree> && node dist/cli.js next --help >/dev/null && echo "CLI loads"
node -e "const {engineConfigFrom}=require('./dist/lib/engine/config.js');
const y=require('yaml'), fs=require('fs');
const m=y.parse(fs.readFileSync('devx.config.yaml','utf8'));
const c=engineConfigFrom(m);
console.log(JSON.stringify({docsLayout:c.docsLayout, layoutSource:c.layoutSource}));"
```

Expected:

```
CLI loads
{"docsLayout":"workstream","layoutSource":"engine"}
```

Invariant: devx itself resolves `workstream` from `engine.docs_layout`, so
every phase of this workstream is a runtime no-op for this repo. If
`layoutSource` ever reads `default` here, `devx.config.yaml` lost its
`engine.docs_layout` key and every later phase's behavior changes silently.

### 5. The advisory reads well to a human seeing it cold

- [ ] `human` — the message tells someone what to actually do · how to verify: run check 1 or 2 above and read the warning as if you had never seen this codebase. It should name the key, both valid values, the consequence (artifacts resolve through a default nobody chose), and where to fix it (`devx.config.yaml`, docs/CONFIG.md §15). Flag it if "unset or not one of" reads as awkward enough to be worth rewording — the wording is deliberate (it must cover the typo case truthfully), but the phrasing is a judgment call.

## Out of scope

- Gate subject resolution (phase 2, `dlr102`), workstream resolution under
  `project-level` (phase 3, `dlr103`), the consumer sweep and scaffolding
  (phase 4, `dlr104`). `stageSubject` / `pathToArtifactKind` have no
  production caller in this phase by design — they are exercised only by
  `test/engine-layout-map.test.ts`.
- `devx layout migrate` (phase 6) — does not exist yet.
