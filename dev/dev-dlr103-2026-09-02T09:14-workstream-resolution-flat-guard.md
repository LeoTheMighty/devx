---
hash: dlr103
type: dev
created: 2026-09-02T09:14:00-06:00
title: "Workstream resolution and the flat-era guard"
status: in-progress
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
