# 07 — Decision Ledger

Format: **D-n** — decision, status (`locked` = decided here and binding for
v2; `[user]` = needs Leo's explicit sign-off before the consuming phase;
`open` = tracked, not blocking). Statuses flip via normal PR edits to this
file; supersessions are appended, never rewritten.

## Re-decisions of v1 locked decisions

- **D-1 (locked)** — *BMAD is removed from the loop.* Supersedes the standing
  practice; the capture lives in `01-bmad-capture.md`. Final BMAD invocation
  is mgrret's retro. `_bmad-output/` is frozen history, never rewritten.
- **D-2 [user]** — *Re-word ROADMAP's "BMAD remains a library, not a fork;
  eject must always work" →* "The engine is native and ships in the devx
  package; markdown + git are ground truth; `devx eject` leaves a working
  repo with readable history, backlogs, specs, and workstream artifacts."
  The ejectability principle survives; the BMAD clause does not. Consumed by
  V2.2's docs sweep.
- **D-3 (locked)** — *Interim retro discipline re-targets from
  `bmad-retrospective` to `/devx retro`,* keeping the LEARN.md row contract
  (confidence/blast-radius tags, ≥3-concordance promotion) byte-compatible.

## New v2 decisions

- **D-4 [user]** — *Tour hosting: orphan `devx-tours` branch + htmlpreview
  link, raw-file fallback for private repos.* Alternatives considered: CI
  artifact upload (no stable URL, expires), GitHub Pages (extra repo setting,
  better render — the designated upgrade path), committing tours on the
  feature branch (pollutes the PR diff — rejected). Consumed by V2.3.
- **D-5 [user]** — *YOLO auto-merge stays the default; review becomes
  possible, not mandatory:* a `devx: hold` comment or a requested-changes
  review before CI-green blocks the merge tail; silence merges as today.
  Rationale: preserves the YOLO memory-rule ("never stop at PR awaiting human
  merge") while making the tour actionable. Consumed by V2.3.
- **D-6 (locked)** — *gnhf's permission-bypass model is NOT adopted.* The
  loop's containment is transactional git + worktrees + merge-gate + harness
  permissions. `devx loop` is disabled entirely in LOCKDOWN mode.
- **D-7 (locked)** — *sprint-status.yaml is retired* (zero consumers, chronic
  drift class MP0.1/MP0.2). The spec graph + backlogs are the only tracking
  state. Frozen copy remains in `_bmad-output/`.
- **D-8 (locked)** — *Stage skipping is legal and recorded* (`entered_at:`),
  never silent — small work must not be forced through four gates
  (send-it thoroughness would die of ceremony otherwise).
- **D-9 (locked)** — *Verdict vocabulary is fixed:* `PASS | CONCERNS | FAIL |
  WAIVED`, WAIVED requires named approver + reason. Applies to every gate and
  checkpoint artifact.
- **D-10 (locked)** — *No JIRA/Confluence/external-tracker surface anywhere in
  v2* — templates, skills, config, docs. GitHub (PRs, comments, CI) is the
  only external surface. Enforced by a grep test in the engine's CI.
- **D-11 (locked)** — *Loop completion is not acceptance.* `acs_met` from a
  worker routes to the PR/CI/merge tail; merge-gate remains the only path to
  main; morning reports present claims, not verdicts.
- **D-12 (locked)** — *One plan phase ≙ one dev spec ≙ one PR ≙ one tour.*
  Keeps v1's atomic-story rhythm as the engine's sizing invariant.

## Open questions (non-blocking, tracked)

- **O-1** — Mermaid in tours: re-add via inlined mermaid (~1MB) once tour
  size budget is measured on real PRs, or keep tables-only permanently?
  (Revisit end of V2.3.)
- **O-2** — Planning-PR tours (stops over prd/design/plan text diffs):
  worth building at V2.3 or wait for demand? (Default: wait.)
- **O-3** — Focus-group / persona panel integration with the critique step:
  the `focus-group/` panel predates v2 — fold personas in as critique lenses,
  or keep as a separate FOCUS.md-driven surface? (Decide at V2.1 planning.)
- **O-4** — `/devx-test` (Layer-2 exploratory QA, v1 Phase 5): design natively
  post-V2.4; the RED gate + coverage rows may shrink its scope. The orphaned
  BMAD tea module is *not* the template for it.
- **O-5** — Multi-repo workstreams (one PRD spanning app + worker repos):
  out of v2; single-repo invariant holds until mobile's Worker repo forces
  the question.
- **O-6** — Token accounting source for loop budgets (harness usage events vs
  estimated-from-transcript): pick during V2.5 implementation once the worker
  spawn path exposes usage.
