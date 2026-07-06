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
  *Evidence (2026-07-05): exercised in PR #64 (v2x101) — the docs sweep
  shipped the re-wording across CLAUDE.md/ROADMAP.md/DESIGN.md and the PR
  merged; the [user] marker stays until Leo flips it explicitly.*
- **D-3 (locked)** — *Interim retro discipline re-targets from
  `bmad-retrospective` to `/devx retro`,* keeping the LEARN.md row contract
  (confidence/blast-radius tags, ≥3-concordance promotion) byte-compatible.

## New v2 decisions

- **D-4 [user]** — *Tour hosting: orphan `devx-tours` branch + htmlpreview
  link, raw-file fallback for private repos.* Alternatives considered: CI
  artifact upload (no stable URL, expires), GitHub Pages (extra repo setting,
  better render — the designated upgrade path), committing tours on the
  feature branch (pollutes the PR diff — rejected). Consumed by V2.3.
  *Evidence (2026-07-05): exercised in PR #65 (v2t101) and every PR since —
  tours published to the orphan `devx-tours` branch (v2t101/v2d101/v2l101
  tours live there); [user] marker stays pending Leo's explicit flip.*
- **D-5 [user]** — *YOLO auto-merge stays the default; review becomes
  possible, not mandatory:* a `devx: hold` comment or a requested-changes
  review before CI-green blocks the merge tail; silence merges as today.
  Rationale: preserves the YOLO memory-rule ("never stop at PR awaiting human
  merge") while making the tour actionable. Consumed by V2.3.
  *Evidence (2026-07-05): exercised in PR #65 (v2t101) — `devx devx-helper
  check-hold` ran live in its own merge tail (`{hold:false}` → silence
  merged); [user] marker stays pending Leo's explicit flip.*
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
  *Measured (2026-07-05, v2o101 retro): real published single-file tours on
  `devx-tours` came in at 1.41MB (v2d101), 1.49MB (v2t101), 1.65MB (v2l101)
  — template itself is 42KB; the bulk is the inlined PR diff data island.
  Adding ~1MB of mermaid would push large-PR tours past ~2.5MB. Still open;
  the measured data leans tables-only until a GitHub-Pages render path
  (D-4's designated upgrade) changes the arithmetic.*
- **O-2** — Planning-PR tours (stops over prd/design/plan text diffs):
  worth building at V2.3 or wait for demand? (Default: wait.)
- **O-3** — Focus-group / persona panel integration with the critique step:
  the `focus-group/` panel predates v2 — fold personas in as critique lenses,
  or keep as a separate FOCUS.md-driven surface? (Decide at V2.1 planning.)
  *Status (2026-07-05): V2.1 shipped the critique step with the four engine
  lenses only (pm/architect/dev/qa — first live run at v2e102: 8 accepted +
  2 rejected-with-rationale findings); the persona panel was NOT folded in
  and remains a separate FOCUS.md-driven surface. De-facto status quo held;
  still open as a deliberate future fold-in.*
- **O-4** — `/devx-test` (Layer-2 exploratory QA, v1 Phase 5): design natively
  post-V2.4; the RED gate + coverage rows may shrink its scope. The orphaned
  BMAD tea module is *not* the template for it.
  *Status (2026-07-05): still open, nothing built. The precondition is now
  real — the RED gate + expectation-coverage rows shipped (v2e101/v2e102)
  and the BMAD tea module was deleted with the ejection (PR #64), so the
  native design starts from the engine's coverage surface, as intended.*
- **O-5** — Multi-repo workstreams (one PRD spanning app + worker repos):
  out of v2; single-repo invariant holds until mobile's Worker repo forces
  the question.
- **O-6** — Token accounting source for loop budgets (harness usage events vs
  estimated-from-transcript): pick during V2.5 implementation once the worker
  spawn path exposes usage.
  *Resolved-in-practice (2026-07-05): v2l101 shipped estimates-from-output —
  worker token spend is derived from output length (~chars/4) and flagged
  `estimated: true` end-to-end (`src/lib/loop/worker.ts` → driver accounting
  → morning report renders estimated totals with a `~` prefix). Harness
  usage events remain the upgrade path if/when the spawn path exposes them;
  the flag keeps the two sources distinguishable without a migration.*
