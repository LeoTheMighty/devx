---
hash: dlr103
type: dev
created: 2026-09-02T09:14:00-06:00
title: "Workstream resolution and the flat-era guard"
status: done
from: plan/plan-a494be-2026-09-01T14:31-docs-layout-resolution.md
plan: _devx/workstreams/docs-layout-resolution
phase: 3
blocked_by: [dlr101]
branch: feat/dev-dlr103
owner: /devx-2026-09-02T1023-57395
---
## Goal

Makes a hash resolve to the repo root under `project-level`, and
discriminates the one flat-era guard that genuinely misfires. Ships NO new
user-reachable state — that is what keeps R-2 closed. Plan phase 3 of
workstream docs-layout-resolution.

## Acceptance criteria

- [ ] AC 1: All 3 frontmatter states resolve to the repo root under
      `project-level` — `workstream: .`, the key ABSENT, and a stale
      `workstream: <root>/<slug>` from a partial migration. The absent-key
      case produces `.` and never a `<root>/<slug>` string.
- [ ] AC 2: `resolveWorkstream()` and `resolveSpecWorkstream()` branch on layout
      (`workstreamRel: "."` / `workstreamAbs: repoRoot`).
      `planFilenameWorkstreamRel()` takes the whole `EngineConfig` and returns
      `"."` under `project-level`; its 4 call sites across 3 files are
      updated. Changing the signature beats guarding four call sites — that is
      the same class of bug as the hand-joins. No signature churn at the
      twelve resolver call sites: every one threads `ctx.engine` whole.
- [ ] AC 3: `createWorkstream`'s flat-era refusal (`workstream.ts:323-331`) gains
      the layout discriminator and derives its stage list from `STAGE_DIRS`
      instead of the inline `["prd","design","plan"]`. It no longer refuses a
      `project-level` repo carrying a root `prd.md`, and still refuses a
      `workstream`-layout workstream carrying a flat-era `<stage>.md`.
- [ ] AC 4: `detectFlatWorkstreams` (`doctor/detect.ts:374-388`) honors
      `engine.workstreams_root` instead of the hardcoded
      `join(repoRoot, "_devx", "workstreams")`, and early-returns under
      `project-level`. NO layout discriminator on the scan itself — it never
      reads a repo-root file, so it cannot misfire.
- [ ] AC 5: `devx doctor` reports a `layout-tree-mismatch` finding
      (`fixable: false`) on a repo whose config and tree disagree, and does
      not offer to fix it.
- [ ] AC 6: `evals/E-4_resolve-workstream.ts` flips GREEN and
      `test/engine-layout-resolve-workstream.test.ts` exists and passes.
      devx's own `devx doctor` and `devx status` output are unchanged;
      `npm test` green.

## Technical notes

Plan: `plan/agent.md` section "3. Phase".

The filename-derived fallback is the part that must not run:
`planFilenameWorkstreamRel()` turns `plan-b7e38f-...-scene-engine.md` into a
folder path in a repo with no folders.

Honest consequence to RECORD, not repair: `resolveSpecWorkstream()`'s
membership regex cannot match any path under `project-level`, so the
`path-in-from-or-plan` arm is DEAD under the flat layout and membership
degrades to the `workstream-frontmatter` and `plan-hash` arms. That is
correct — under `project-level` there is exactly one workstream.

New refusals live in their command, never inside `resolveWorkstream`:
`WorkstreamRefusal` is distinguished by exactly one caller
(`commands/outline.ts`), so a refusal added inside the resolver silently
becomes exit 2 everywhere.

R-10: the `layout-tree-mismatch` advice names `devx layout migrate`, which
does not exist until phase 6. Inert text; caught by phase 7's doc-truth test.

Parallel-safe with phase 2.

## Status log

- 2026-09-02T09:14 — emitted by /devx-plan (RED gate PASS; workstream
  docs-layout-resolution, plan phase 3).
- 2026-09-02T10:23:14-06:00 — claimed by /devx in session /devx-2026-09-02T1023-57395
- 2026-09-02T10:31 — phase 2: spec ACs direct (v2 native); 6 ACs; workstream=docs-layout-resolution; red-artifacts=evals/E-4_resolve-workstream.ts (watched failing: `resolveWorkstream` threw `workstream dir '_devx/workstreams/scene-engine' not found` for the absent-key and stale-pointer states, plus the missing companion test — the STATED reason, not harness breakage; the `workstream: .` state and the `workstream`-layout control already pass).
- 2026-09-02T10:44 — phase 3: implemented T3.1–T3.6. `resolveWorkstream()` + `resolveSpecWorkstream()` branch on layout; `planFilenameWorkstreamRel()` re-signatured onto `EngineConfig`; two new shared resolvers (`planSpecWorkstreamRel`, `workstreamSlugFor`) so the `??` fallback and the slug tail stop being re-rolled per call site; flat-era refusal layout-discriminated and derived from `SUBJECT_STAGES`; `detectFlatWorkstreams` honors `engine.workstreams_root` + early-returns under project-level; new `layout-tree-mismatch` finding (`fixable: false`) wired through `collectFindings` with `engine` threaded from `devx doctor` and the loop preflight. E-4 flipped GREEN; `test/engine-layout-resolve-workstream.test.ts` added (43 tests).

- 2026-09-02T10:52 — phase 4: sequential multi-lens adversarial review (3 lenses, one pass each, context reset between) + an empirical real-repo leg. **The parallel 3-agent shape was unavailable**: this session's harness policy forbids spawning subagents (`Do not call the AgentTool unless the user requested it`), so per `/devx` Phase 4 step 2b the above-threshold surface (~420 changed src lines + a ~490-line test file) took the two sanctioned compensations rather than collapsing to a plain single pass. 6 findings, ALL fixed in-place (2 HIGH, 2 MED, 2 LOW). Most load-bearing: `state.workstream ?? planFilenameWorkstreamRel(...)` was spelled at each call site, so a spec that HAS a pointer never reached the re-signatured helper — under `project-level` a stale pointer then made `devx status` drop the workstream entirely and `devx next` read every artifact as missing; proven empirically against `main` on a real fixture repo (main: `no active workstreams`; branch: resolves). Also: the root-level mismatch probe would have fired on any repo keeping a hand-written `plan.md`/`design.md` (now gated on the repo actually running an engine workstream); the arm-1 claim walk would have handed back an arbitrary long-done plan spec under project-level (now two-pass, explicit pointer first); and two further hand-rolled slug tails rendered `. (<hash>)` in `devx status` and titled a scaffolded `todo.md` "`.`" (both routed through `workstreamSlugFor`; diffed against main on a real repo). Re-review clean.
- 2026-09-02T10:58 — phase 5 (incident, recorded): an unquoted `cd <main-worktree>` in a status-log step moved the persistent shell CWD out of `.worktrees/dev-dlr103`, and the next eight calls ran on `main` — including the `outline.ts` fix, the QA-walkthrough emission, and a FULL `npm test` that reported green while testing `main` rather than the branch (135 files / 3205 tests, my 43-test file absent from the durable `parallel.json`). Nothing was lost: the branch worktree was intact throughout, `outline.ts` was moved back with `git diff | git apply`, `main` was restored clean, and the walkthrough was moved into the branch. Two process notes worth the retro: (1) `/devx` Phase 5's stated habit — `cd <worktree-abs-path> && <gate command>` as ONE command, and check the runner's echo of its root — is exactly what would have caught this at the first gate rather than the second; (2) a heredoc ending `PY\necho ok` prints `ok` whether or not the Python succeeded, which is how the as-built `plan/agent.md` sync silently wrote nothing on its first attempt (same family as `feedback_background_exit_masking`). Both re-run correctly in the branch.
- 2026-09-02T11:02 — phase 5-7: local gate GREEN in the worktree (pass 1 136 files / 3248 passed + 6 todo; pass 2 34 files / 825 passed; REAL_EXIT=0; both `RUN` roots name `.worktrees/dev-dlr103` and `parallel.json` carries the new file). E-4 GREEN. QA walkthrough emitted at `test/test-7b39ad-2026-09-02T10:55-dlr103-qa-walkthrough.md` (5 machine checks executed inline with real output; 1 human check outstanding) + TEST.md row. Committed f1f7aca; PR https://github.com/LeoTheMighty/devx/pull/153.
- 2026-09-02T11:10:48-06:00 — merged via PR #153 (squash → aa35a60)
