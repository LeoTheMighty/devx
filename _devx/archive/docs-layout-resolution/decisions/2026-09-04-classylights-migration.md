---
verdict: PASS
status_reason: 'Migration ran clean on the real repo; 8/8 moved, zero refusals, passed gates preserved.'
reviewer: 'MV-a494be.1 (attended, human-run)'
updated: 2026-09-04
subject: 'ClassyLights b7e38f — devx layout migrate --to project-level'
---

# ClassyLights migration — G-3 evidence — 2026-09-04

The fixture could not be this record: `test/engine-layout-migrate.test.ts` and
E-6 prove the mechanism on a reproduction of `b7e38f`. This is the run against
a tree devx does not own.

## Result

`devx layout migrate --to project-level` — exit 0, **8 of 8 files moved**, no
refusal fired. ClassyLights commit `0742ae8`.

| From (`_devx/workstreams/scene-engine/`) | To | Kind |
|---|---|---|
| `prd/agent.md` | `prd.md` | `agent:prd` |
| `design/agent.md` | `design.md` | `agent:design` |
| `prd/human.md` | `prd-human.md` | `human:prd` |
| `design/human.md` | `design-human.md` | `human:design` |
| `expectations.md` | `expectations.md` | `expectations` |
| `todo.md` | `todo.md` | `todo` |
| `decisions/2026-08-24-design-verify.md` | `decisions/…` | `decisions-dir` |
| `decisions/2026-08-24-outline-critique-delta.md` | `decisions/…` | `decisions-dir` |

Every move landed at its docs/CONFIG.md §15 counterpart. All eight recorded by
git as renames (`R`), so each artifact keeps its own history. Plan spec
`workstream:` → `.`; `engine.docs_layout: project-level` written last; the six
now-empty workstream directories pruned.

## The three likely refusals, and why none fired

- **`destination-clash`** — did not apply. ClassyLights never authored a plan
  stage, so no artifact mapped to `plan.md` and the `PLAN.md`-on-macOS
  collision (debug-135dc9) had nothing to collide with. **This run is
  therefore not evidence that debug-135dc9 is fixed** — it is evidence that a
  repo without a plan-stage subject dodges it. A repo that has authored
  `plan/agent.md` will still hit it.
- **`unmapped-doc-set-files`** — the workstream held only mapped artifacts; no
  `RETRO-<date>.md`, no `research/`, no loose notes.
- **`multiple-doc-sets`** — `scene-engine` was the only workstream directory.

`dirty-tree` fired twice before the real run, both times correctly (uncommitted
harness files, then an unlanded root outline). It named the paths and exited
having moved nothing.

## dlr106 AC 3 — passed gates survive

Confirmed on the real spec. Before and after are identical:

```
gate_status:  prd_validated: true   design_verified: true
gate_verdicts: prd: PASS            design: PASS
```

**MANUAL.md MV-a494be.1 step 5 is wrong and should be corrected.** It tells the
operator to confirm `gate_status`/`gate_verdicts` are "EMPTY". They are not, and
must not be — gate state lives in the spec, not the tree, and layout is not a
gate input, so only `workstream:` is rewritten. An operator following step 5
literally would read a correct migration as a failed one. The design's own G-3
row carries the same phrasing ("gate_status/gate_verdicts diff empty"); it
means "the diff shows no change to them", which is the opposite of what the
MANUAL wording says.

## Step 6 — `devx gate coverage b7e38f`

Ran on the migrated tree and **resolved its subject through the flat layout**:
it read `expectations.md` at the repo root and enumerated the real E-1…E-8. The
old tree is gone (`_devx/workstreams/` is empty), so no other path could have
served that read.

It did not reach PASS/FAIL. The command is state-aware and the spec is at
`stage: plan`, so it selected Gate 3 (plan coverage) and rejected the supplied
design-stage table: `table is incomplete — no row for: E-1…E-8` (exit 2). A
genuine Gate 3 verdict is unavailable because the plan stage is unauthored —
there is no `plan.md` and no plan-stage judgment table. **That predates the
migration and is not caused by it.** No table was fabricated to manufacture a
verdict.

If step 6 is meant to yield a PASS, it needs a repo whose current stage has an
authored subject and a real coverage table; on `b7e38f` the reachable evidence
is subject resolution, which is what layout actually governs.

## Not revert-safe

Reverting `0742ae8` does not un-migrate the tree. Rollback is
`devx layout migrate --to workstream`.

## Incidental

Landing the root outline required `devx outline commit`, which refused in every
shell of a Xirp session because L3 keyed on the env marker alone. Fixed in #160
(`f53f2bc`): L3 now requires the marker **and** a non-TTY stdin, so an agent is
still refused and the human's terminal is not.
