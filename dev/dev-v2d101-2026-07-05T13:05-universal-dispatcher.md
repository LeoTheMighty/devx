---
hash: v2d101
type: dev
created: 2026-07-05T13:05:00-06:00
title: V2.4 — universal /devx dispatcher + debug loop + init v2
from: v2/06-phases.md
plan: v2/
status: in-progress
owner: /devx-2026-07-05T1247-2860
blocked_by: [v2x101]
branch: feat/dev-v2d101
---

## Goal

`/devx` becomes the only command: state-driven next-action routing + free-text
intent classification + first-class debug loop + any-repo init. Per
`v2/05-dispatcher.md`.

## Acceptance criteria

- [ ] `devx next` v2: full 12-row first-match decision table (§2) over
      backlogs, spec frontmatter, open PRs + CI, `.devx-cache` state;
      `--prefer plan` flag; unit-test matrix covering every row + ordering
      (S-4).
- [ ] Dispatcher skill body (user-foreground): entry forms (§1), intent
      classification (§3: bug/small-feature/large-feature/question/review),
      stage-skip recording (`entered_at:`, D-8), morning-review-on-first-run
      hook, `/devx-plan` aliased into the stages.
- [ ] Debug loop (§4): DEBUG.md consumer; debug spec shape (repro-first =
      RED for bugs; root-cause evidence in status log); fix via execute tail;
      learnings → LEARN candidates.
- [ ] `devx init` v2: engine templates + `engine:`/`loop:` config in
      scaffold; no BMAD anywhere; fresh-repo e2e test (ini508 harness
      extension) proving S-5: init → `devx next` → correct first action on
      an empty repo.
- [ ] Backlog↔frontmatter reconcile drift is a reported defect in `devx next`
      output (not silently fixed).
- [ ] Full suite green.

## Technical notes

- Decision table lives in the CLI (pure fn); skill renders its output — the
  8am-harness `next_command()` move. Rows 1–8 need the manager/loop state
  shapes from mgr102; loop-row (#1) degrades gracefully until v2l101 lands.

- Inherited from v2x101: `devx plan-helper validate-emit` still resolves
  epics only under `_bmad-output/planning-artifacts/` (frozen); for v2
  workstream slugs it soft-exits 2 (route-to-user, no abort). Retarget it
  to `_devx/workstreams/<slug>/plan.md` (or fold into `devx next`
  emission checks) as part of the dispatcher work.

## Status log

- 2026-07-05T13:05 — created from v2/06-phases.md § V2.4.
- 2026-07-05T12:47:47-06:00 — claimed by /devx in session /devx-2026-07-05T1247-2860
