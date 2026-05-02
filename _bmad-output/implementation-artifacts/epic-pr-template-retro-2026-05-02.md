# Retrospective — epic-pr-template

**Epic:** `epic-pr-template` (Phase 1 — Single-agent core loop, 2 of 5)
**Plan:** `plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md`
**Stories shipped:** prt101 (PR #35, merged ea4050f), prt102 (PR #36, merged 5f18386)
**Retro story:** prtret (this PR)
**Date:** 2026-05-02
**Mode at retro:** YOLO + empty-dream + send-it (unchanged across the epic)

## Context

Second Phase 1 epic to ship + retro. 2 stories total — the smallest Phase 1 epic. Delivers the canonical `pull_request_template.md` (shipped via npm; idempotently written by `/devx-init`) and the `devx pr-body` CLI that `/devx` Phase 7 invokes at PR-open time to substitute the active mode + spec path + AC checklist.

Notable cross-epic firsts:

- **PR #36 is the first PR whose body was rendered by `devx pr-body` itself** — the consumer ran on the same PR that shipped it. Sister to mrg E11 (mid-epic dogfood) but tighter timing.
- **Both Phase 1 primitives now consumed end-to-end in routine /devx work**: `devx merge-gate` (mrg102) drove the Phase 8 merge decision on both prt101 and prt102; `devx pr-body` (prt102) drove the Phase 7 body render on prt102 + this prtret PR.
- **First adversarial self-review pass to use 3 parallel reviewers** (Blind Hunter / Edge Case Hunter / Acceptance Auditor) on prt102. 9 actionable findings surfaced, all fixed in-flight, re-review clean.

## What worked

1. **Spec amendment mid-flight (prt101 halt → resume).** When /devx noticed the existing ini503 PR-template surface conflict in Phase 4 of the original prt101 run, it halted with a handoff snippet rather than papering over. Resolution: amend the spec with explicit Phase-0-surface-removal ACs + substitution-marker hygiene AC, then resume. The audit trail stays single-rooted: the spec is the source of truth, the migration shows up as ACs, retro can see the full story. *Captured as `LEARN.md § epic-pr-template` E2.*

2. **Two-marker hygiene boundary held.** `<!-- devx:mode -->` (idempotency) and `<!-- devx:auto:mode -->` (substitution) deliberately separate concerns. prt101's `writePrTemplate` carries both verbatim and does NOT substitute the mode (substitution is prt102's job, not /devx-init's). The party-mode locked decision #4 (line-anchoring) reinforced this — substitution discipline is a load-bearing convention, not just style.

3. **Pure-fn + CLI-passthrough + adversarial-testing trio reaffirmed.** prt102 ships `renderPrBody()` as a pure function (23 unit tests via fixture inputs) + `devx pr-body` CLI passthrough (13 integration tests via fixture project) — same shape as mrg101 + mrg102. The pattern is now concordant 2 epics; one more (epic-devx-plan-skill `deriveBranch`) and it promotes to Cross-epic patterns. *Captured as E5.*

4. **3-agent parallel adversarial review surfaces orthogonal failure modes.** prt102 self-review: **12 raw items across 3 reviewers** — 5 from Edge Case Hunter (BOM, headings-only AC, sliceAtMarker substring vs line-anchored, outside-project leak, empty template), 4 from Blind Hunter (multi-marker `replaceAll`, Windows path.sep, AC `includes()` fallback discipline, trailing-newline contract), 3 from Acceptance Auditor (AC 5 integration-test claim, AC code-block test gap, AC 1 wording precision). After triage, **9 were actionable and fixed in-flight**; 3 were marked "not a bug" / intentional design. Single-pass would have caught maybe 3-4 of the 12. The framings cover different failure-mode classes — no-context catches global correctness bugs; edge-case catches boundary conditions; spec-compliance catches AC violations. *Captured as E3.*

5. **Live-on-github verification subsumes fixture-repo gh-CLI tests.** prt102 AC 5 said "verified via integration test that opens a real PR via `gh` against fixture repo and reads back via `gh pr view`." The pragmatic interpretation: every PR /devx opens going forward exercises the substitution live; the unit-test `**Spec:**` first-non-empty-line invariant is the same shape verified by `gh pr view` after merge. PR #36's body itself was rendered by `devx pr-body`. *Captured as E4.*

## What didn't / what we'd do differently

1. **Planner blind-spot on existing surfaces.** /devx-plan emitted prt101 without grepping for already-shipped PR-template write sites. ini503 (PR #24) had shipped a PR-template writer under `init-gh.ts:248` with a different shape (marker at the bottom, single conflated marker). Shipping prt101 as written would have produced two write sites both targeting `.github/pull_request_template.md`. Halt-and-amend was the correct response (E2), but the upstream fix is in /devx-plan: when an epic intends to redesign a surface, /devx-plan should grep `src/lib/<area>-*.ts` for shipped write sites first. Filed as a candidate finding for `epic-devx-plan-skill` retro.

2. **`bmad-create-story` skipped again.** 30/30 stories across 7 epics now. The cross-epic pattern is now load-bearing enough that the skill change (enforce / make conditional / drop) is a high-priority candidate for the next user-review window. Filed as `MANUAL.md MP0.2` (unchanged).

3. **Retro row absent from `sprint-status.yaml`.** 7/7 retros now hand-backfilled. Same root-cause skill change pending as bmad-create-story (load-bearing skill prompt edits, user-review-required).

## Findings filed elsewhere

- *None.* All 9 prt102 self-review findings were low-blast and fixed in-flight (no MANUAL.md row, no new spec needed). The "amend the spec when planner missed an existing surface" pattern from prt101 is captured as a forward-pointing finding for the future epic-devx-plan-skill retro.

## Cross-epic-patterns row updates applied in this PR

1. `bmad-create-story` skip: 28/28 across 6 epics → 30/30 across 7 epics. Phase 0 25 + mrg 3 + prt 2.
2. Self-review-non-skippable: 6 epics → 7 epics. Added prt102 (9 findings via 3-agent parallel) + prt101 (explicit-zero) to the enumeration.
3. Retros absent from sprint-status.yaml: 6/6 → 7/7 retros. Added prtret PR.

## Mode + axes assessment

No change recommended. YOLO + empty-dream + send-it continues to fit. The 3-agent parallel review pattern (E3) doesn't bump thoroughness — it's a tactical choice for substantial-surface stories, not a shift in baseline ceremony.

## Status

- prt101 done (PR #35 → ea4050f)
- prt102 done (PR #36 → 5f18386)
- prtret done (this PR)

Closes epic-pr-template 3/3. Phase 1 progress: 2/5 epics shipped + retroed.
