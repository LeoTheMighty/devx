---
hash: hfi103
type: dev
created: 2026-07-24T10:41:50-06:00
title: Todo sync + focus/drift renderers + real devx status
from: plan/plan-eac479-2026-07-24T09:57-harness-fold-in.md
plan: _devx/workstreams/harness-fold-in
status: done
owner: /devx-2026-07-25T1341-12398
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
- 2026-07-24T15:19:34-06:00 — claimed by /devx in session /devx-loop-2026-07-24T21-19-34-321-15697
- 2026-07-25T12:01:14.560Z — [FAIL] loop abandoned hfi103: 3 consecutive failures on this item; worktree preserved at .worktrees/dev-hfi103
- 2026-07-25T09:20-06:00 — state reconciled: all 3 loop iterations were hung worker sessions (~32 output tokens each, killed past the 60-min ceiling; iterations stretched 2–5.5h wall-clock — consistent with overnight machine sleep, not a task failure). Preserved worktree held only iteration-record bookkeeping, no implementation — discarded. Reset to ready; blockers hfi101 + hfi102 are both done.
- 2026-07-25T13:41:11-06:00 — claimed by /devx in session /devx-2026-07-25T1341-12398
- 2026-07-25T09:05-06:00 — phase 2: spec ACs direct (v2 native); 10 ACs; workstream=harness-fold-in; red-artifacts=E-4_next-todo-drift.ts,E-5_next-current-focus.ts (both re-run RED in worktree: pure module green, permanent suites missing — right reason).
- 2026-07-25T14:05-06:00 — phase 3: implemented — devx todo sync (src/commands/todo.ts + todo-truth.ts IO seam), renderFocusLine (render.ts), focus+todoDrift on WorkstreamSignal (gather/decide), both devx next forms render focus+drift, real devx status (stub replaced), titleFromSlug+TEMPLATES_DIR exported; suites test/next-todo-drift + next-current-focus + todo-sync (17 tests); help/stub tests updated for the de-stubbed status + new todo command; E-4+E-5 GREEN; full suite 2302 green; live smoke created harness-fold-in/todo.md born-consistent + hand-added phase pointers trued (1/2/4 checked).
- 2026-07-25T14:25-06:00 — phase 4: 3-agent parallel adversarial review (Blind Hunter + Edge Case Hunter + Acceptance Auditor); 7 unique findings (2 MED, 5 LOW) + AA 10/10 ACs PASS; ALL fixed in-place — most load-bearing: todo-drift promoted to a snapshot-level advisory aggregate surfaced on EVERY devx next decision (executing-stage workstreams sit outside midPipeline, so the repo form was blind exactly where phase-pointer drift is most likely), and devx status now derives workstream identity from the scanned file instead of a hash round-trip through the by-filename resolver (the two surfaces could disagree on hash/filename mismatches). Also: status honors its exit-0 contract on unreadable plan/, parseTodo skips HTML-comment blocks (sync can no longer corrupt the header), $-pattern-safe template substitution, trailing-slash slug guard, split warnings so dev/-scan failures aren't blamed on todo.md. Re-review clean; full suite 2304 green (+2 pins); E-4+E-5 re-GREEN.
- 2026-07-25T14:25-06:00 — phase 5: local CI — cli project: npm test (build + typecheck + vitest 2304/2304) green; workstream-evals project: E-4/E-5 via npx tsx green; lint is the cli301 placeholder; coverage not configured (YOLO informational).
- 2026-07-25T14:30-06:00 — phase 7: pushed feat/dev-hfi103; PR #85 open (https://github.com/LeoTheMighty/devx/pull/85), body via devx pr-body, no unresolved placeholders.
- 2026-07-25T14:40-06:00 — phase 7.5: review tour built + published (7 stops, 5 decisions, 3 grep-verified trails) — https://htmlpreview.github.io/?https://raw.githubusercontent.com/LeoTheMighty/devx/devx-tours/tours/hfi103/tour.html; PR body re-rendered with tour link.
- 2026-07-25T14:45-06:00 — merged via PR #85 (squash → bf94928); remote CI devx-ci success (run 30173499313); worktree removed, branch deleted, lock released; harness-fold-in todo.md Phase 3 pointer trued by devx todo sync post-merge.
