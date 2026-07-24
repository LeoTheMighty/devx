---
hash: hfi103
type: dev
created: 2026-07-24T10:41:50-06:00
title: Todo sync + focus/drift renderers + real devx status
from: plan/plan-eac479-2026-07-24T09:57-harness-fold-in.md
plan: _devx/workstreams/harness-fold-in
status: ready
blocked_by: [hfi101, hfi102]
branch: feat/dev-hfi103
---

## Goal

Make the todo layer mechanical and visible: the `devx todo sync <hash>`
truing primitive (FR-2's "reconcile before writing" made structural + the
FR-1 grandfathering path), focus-line and drift-row rendering in
`devx next`, and the minimal real `devx status`. Phase 3 of workstream
`harness-fold-in` (plan.md § Phase 3). Depends on hfi101 (todo module) and
hfi102 (`render.ts` + `WorkstreamSignal` plumbing + gate summary).

## Acceptance criteria

- [ ] `src/commands/todo.ts` (new) + `src/cli.ts` registration:
      `devx todo sync <hash>` — resolve via `resolveWorkstream`; absent
      todo.md → create from template trued to ground truth; present →
      `trueDerivedLines`. Stdout JSON `{hash, created, trued: [...]}`;
      exit 0 on success (incl. no-op), 2 on resolution/parse errors. Never
      called from gate code (E-2's static scan keeps gate modules
      todo-free).
- [ ] `src/lib/engine/render.ts`: `renderFocusLine(doc, stage)` — `focus:
      <text>` from the focus walk; null (line omitted) when todo.md absent.
- [ ] `src/lib/next/gather.ts` + `decide.ts`: `{focus, todoDrift}` attached
      to each workstream signal inside `gatherRepoSnapshot`;
      `TodoGroundTruth` built from frontmatter state + linked dev-spec
      `status: done` map for phase pointers.
- [ ] `src/commands/next.ts`: focus line rendered under workstream rows
      (both forms) + advisory todo-drift rows; exit code unchanged vs
      no-drift; 0 file writes.
- [ ] `src/commands/status.ts`: 11-line stub replaced — scan `plan/` for
      specs whose `workstream:` resolves and stage ∉ {done, retired} (plus
      done-with-outcome-pending); per workstream render
      `<slug> (<hash>)  stage: <stage>` + gate summary + focus line.
      Read-only; exit 0.
- [ ] `test/next-todo-drift.test.ts` (E-4 permanent suite): both drift
      classes detected (2/2 fixtures); exit code unchanged vs no-drift
      fixture; 0 file writes.
- [ ] `test/next-current-focus.test.ts` (E-5 permanent suite): focus line
      correct on 3 fixtures (mid-intake, mid-execute, stale hand-checked
      stage parent — focus head must not move); absent-file fixture exits 0
      with no focus line.
- [ ] `devx todo sync` on a todo-less mid-pipeline workstream creates a
      skeleton born consistent with current frontmatter (FR-1
      grandfathering).
- [ ] Workstream evals E-4 + E-5 flip GREEN:
      `npx tsx harness-fold-in/evals/E-4_next-todo-drift.ts` and
      `…/E-5_next-current-focus.ts` (cwd `_devx/workstreams`) exit 0.
- [ ] Full suite green (`npm test`, typecheck included).

## Technical notes

- Drift is advisory only: never blocking, never mutating (CAP-2).
- Phase-pointer ground truth: linked dev spec `status: done` (design
  §Assumptions — done ⇒ verified because merge happens after the /devx
  verification tail).
- `devx status` stays a thin renderer over engine reads so Concierge
  (roadmap Phase 2) extends rather than replaces it.
- RED evidence: `_devx/workstreams/harness-fold-in/evals/RED-report.md`
  (E-4, E-5 right-reason).

## Status log

- 2026-07-24 — emitted by /devx-plan RED stage (eac479, phase 3/5).
