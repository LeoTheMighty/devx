---
hash: ac0751
type: test
created: 2026-09-02T15:45:00-06:00
title: "QA walkthrough — docs-layout doc truth (dlr107)"
from: dev/dev-dlr107-2026-09-02T09:14-doc-truth.md
status: ready
owner: null
branch: null
---
# QA walkthrough — Story `dlr107`

> `docs/CONFIG.md` §15's artifact table is restructured to one row per
> `ArtifactKind` (13 rows), gains the `devx layout migrate` invocation, and
> records `RETRO-<date>.md` as deliberately layout-independent; the
> `docs_layout` description in `_devx/config-schema.json` is rewritten to
> restate §15 rule 5 verbatim. User-visible surfaces: the CONFIG.md page a
> reader consults before choosing a layout, and the editor tooltip over
> `engine.docs_layout`. It does NOT cover runtime behavior — no resolver, gate,
> or command changed (`ARTIFACT_KINDS` is an additive export with no
> production caller).

## Pre-flight

```bash
cd .worktrees/dev-dlr107      # or the merged main checkout
npm ci                        # only if node_modules is stale
```

## Manual checks

### 1. Every artifact kind the resolver handles has a §15 row, and every row spells the path the resolver produces

- [x] `machine` — the table is a projection of `ArtifactKind`, not a hand-kept list

```bash
npx vitest run test/engine-layout-docs-truth.test.ts
```

Expected:

```
 ✓ test/engine-layout-docs-truth.test.ts (15 tests) 56ms
 Test Files  1 passed (1)
      Tests  15 passed (15)
```

Invariant: adding a variant to `ArtifactKind` fails this file until
`ARTIFACT_KINDS` lists it AND §15 documents it. A row that exists but names a
path `artifactRel()` does not produce fails too — that is the half a row-count
check cannot see.

### 2. The RED-gate eval for G-4 is GREEN

- [x] `machine` — E-8's own three properties hold against the shipped docs

```bash
npx tsx _devx/workstreams/docs-layout-resolution/evals/E-8_docs-truth.ts
```

Expected:

```
E-8 GREEN — §15 has a row per ArtifactKind, makes no unimplemented claim, and both enums match DOCS_LAYOUTS.
```

Invariant: E-8 is a locked RED artifact — its step bodies are stamped by Gate
4 and must not be edited to make this pass. The 13-row set-equality is what
carried its RED.

### 3. The schema description restates rule 5 verbatim, and the enum is untouched

- [x] `machine` — the autocomplete claim and the doc claim are the same claim

```bash
node -e 'const n=JSON.parse(require("fs").readFileSync("_devx/config-schema.json","utf8")).properties.engine.properties.docs_layout;
console.log("enum:",JSON.stringify(n.enum));
console.log("rule-5 verbatim:",n.description.includes("a gate resolves its subject through the layout"));'
```

Expected:

```
enum: ["workstream","project-level"]
rule-5 verbatim: true
```

Invariant: the enum stays `["workstream","project-level"]` and there is no
schema version bump — dlr107 changed the description, never the value space.

### 4. §15 reads correctly as a rendered page

- [ ] `human` — the restructured table and the two new paragraphs render and
  scan · how to verify: open `docs/CONFIG.md` on the PR's Files-changed tab,
  jump to "### `docs_layout` — the two shapes", and confirm the 13-row table
  renders as three columns (no cell wrapping into a fourth), the `<stage>`
  rows read as templates rather than as real filenames, and the
  "**What switching costs.**" paragraph sits after rule 5.

Invariant: the first column leads with a backticked kind on every row — that
is what makes the table machine-checkable, and a hand-edit that fronts prose
instead breaks the parse.

### 5. The editor tooltip is the thing a reader actually hits

- [ ] `human` — the rewritten description is legible where it is consumed ·
  how to verify: open `devx.config.yaml` in an editor with JSON-schema
  support, hover `docs_layout` under `engine:`, and confirm the tooltip names
  both layouts, carries the "NOT mechanically enforced today" caveat, and
  points at `docs/CONFIG.md section 15`.

Invariant: this string is the claim a reader meets before they ever open the
docs. It stating the one-doc-set rule without the caveat is the trap in
miniature — devx does not enforce it (dev-lay101).

## Regressions to watch

- **The E-8 eval's table parser.** It slices §15 from the `| Artifact |`
  header and overshoots the table's end by roughly the header's own offset,
  so a markdown TABLE added within a few hundred characters after the artifact
  table would be counted as extra rows and turn E-8 red for the wrong reason.
  Prose after the table is safe; another table is not. The companion test does
  not share this flaw — it stops at the first non-table line.
- **`ARTIFACT_KINDS` has no production caller.** It is a documentation row
  index, deliberately written out rather than derived (E-8 reads the file as
  TEXT). `test/engine-layout-single-reader.test.ts`'s zero-orphan rule covers
  exported CALLABLES only, so a const is legal there — but if that rule is
  ever widened to constants, this export is the first thing it will flag, and
  deleting it silently drops the 13-row assertion to a 5-row one.
- **`test/helpers/code-only.ts`.** Newly extracted from two byte-identical
  copies in dlr101's and dlr105's tests. A change to it now moves three
  scanners at once; a scanner that quietly over-blanks reports zero findings
  and a false GREEN.

## Post-merge follow-ups

- `dev-a57f22` — the nine skill-body path references that hardcode the folder
  shape (`.claude/commands/devx-plan.md` ×6, `.claude/commands/devx.md` ×3).
  Filed by this story (AC 6); the S-1 budget has 6,102 bytes of headroom, so
  it is not budget-blocked.
- `dev-lay101` — the `project-level` one-doc-set rule is documented in both
  surfaces and enforced in neither.
