# Retrospective — epic-bmad-audit

**Epic:** `_bmad-output/planning-artifacts/epic-bmad-audit.md`
**Plan:** `plan/plan-a01000-2026-04-26T19:30-foundation.md`
**Stories:** aud101 (inventory) · aud102 (classification) · aud103 (risks + finalize)
**Run by:** /devx audret (interim retro discipline — `LEARN.md § epic-bmad-audit` is the source of truth for action items; this file is a BMAD-shaped sibling for traceability)
**Run date:** 2026-04-27
**Mode at execution:** YOLO · empty-dream · send-it (single-branch on `main`)

---

## 1. Epic summary

| Metric | Value |
|---|---|
| Stories planned | 3 |
| Stories shipped | 3 (aud101, aud102, aud103) |
| Completion % | 100% |
| PRs | #1 (aud101 → 70872e4), #2 (aud102 → 2697f54), #3 (aud103 → 82ed445) |
| Production incidents | 0 |
| Rollbacks | 0 |
| Self-review findings (auto-fixed) | aud101 ≈1 + aud102 4+1 + aud103 4 = ~10 |
| Acceptance criteria met | All `aud101.AC1–4`, all `aud102.AC1–6`, all `aud103.AC1–7` |
| Final artifact | `_bmad-output/planning-artifacts/bmad-audit.md` (5 sections, 51 skills classified, 5 risks, 11 §4.1 wirings + 4 §4.2 one-liners) |

Status check at retro time: epic ships every promised deliverable plus the
party-mode-flagged extras (manifest path correction in §5; QA completeness via
counts reconciliation; re-run trigger in §5).

---

## 2. What worked

1. **Sequential 3-story handoff via forward-pointing notes.** aud101 left a
   "SKILL.md not vendored" note for aud103. aud102 left three named
   forward-pointing notes (`bmad-agent-qa` ghost reference, `shadow → wrap`
   evaluation for `bmad-create-epics-and-stories`, TEA-orphan ranking). aud103
   resolved every one with explicit `**Resolved: §X.Y**` markers in the
   surviving artifact. Zero dropped baton; zero re-research between stories.
2. **Self-review caught real defects in every story.**
   - aud102 (4+1): methodology block didn't define the wrap-vs-orchestration
     boundary; §2.6 intro contradicted with `bmad-teach-me-testing`'s
     classification; §2.7 phase column ambiguous for `bmad-tea`; backtick
     consistency.
   - aud103 (4): stale forward-pointing-note language; §3.5 cross-ref to a
     non-existent §4.2 row; §4.3 misclassification of `bmad-retrospective`;
     "single conditional" overstatement in §3.4.
   None were lint-class. All caught semantics issues that would have shipped.
3. **Risk severities calibrated, not uniform.** §3 ranks risks by blast
   radius — TEA orphan (High, whole module unused) → sprint-planning shadow
   (Medium, conflict on user-direct-invoke) → retrospective gap (Medium,
   absent material learning surface) → UX timing (Low at YOLO, Medium at
   thoroughness=`thorough`) → manifest drift (Medium, silent staleness). The
   gradient lets downstream phases sequence work meaningfully instead of
   treating "all risks equal".
4. **Audit doc embeds its own re-run trigger.** §5 names the precise inputs
   whose change should re-trigger the audit (`_bmad/_config/manifest.yaml →
   modules[].version`, module-set changes, skill-manifest changes,
   `~/.claude/skills/` divergence). Long-lived doc artifacts that name their
   own staleness predicate are easier to maintain than ones that don't.
5. **Tight cross-references inside the artifact.** §3 risks each cite the §4
   row that resolves them; §4 rows each cite the §3 risk they answer; §2.7
   wiring map is reused verbatim by §4.1. Nothing dangles. Self-review
   specifically caught two cross-ref breakages and fixed them.
6. **Audit-driven pipeline-shape claims are repo-resident.** §4.2 is a
   four-row table of one-line fixes that don't need new epics — the audit
   already pointed at the exact files to edit (`.claude/commands/devx-plan.md`,
   `.claude/commands/dev-plan.md`, `/devx-init` ini504, `/devx-manage`
   future). This converts research into actionable backlog without a planning
   round-trip.
7. **Zero CI volatility.** All three stories merged with `mergeStateStatus
   == CLEAN`; no required checks because `.github/workflows/devx-ci.yml`
   didn't exist yet (its writer is ini503). The local `npm test` placeholder
   gate held; no flakes.
8. **YOLO single-branch auto-merge held end-to-end across 3 PRs.** No human
   merge intervention; trust-gradient threshold = 0 / count = 0 keeps the
   ladder open from commit 1.

---

## 3. What didn't

1. **Planner emitted `branch: develop/dev-<hash>` despite single-branch config.**
   3/3 stories' status logs include "branch corrected to feat/dev-aud10X". The
   bug is in `/devx-plan` and `/dev-plan` — they hard-coded the BMAD-style
   `develop/...` prefix instead of deriving from `devx.config.yaml →
   git.branch_prefix`. **Already mitigated** in commit `1b8edb3` (planner
   skills + `docs/DESIGN.md` updated). Listed here for completeness.
2. **`/devx-plan` Phase 6 references a non-existent BMAD skill.** Both
   `.claude/commands/devx-plan.md:171` and `.claude/commands/dev-plan.md:162`
   name `bmad-agent-qa` as the QA lens. There is no such skill in
   `_bmad/_config/skill-manifest.csv`; the closest is `bmad-tea` (Murat).
   §3.1 mitigation + §4.2 row 1 of `bmad-audit.md` prescribe replacing it.
   **Still unfixed at retro time** — applied in this PR (see §5 below).
3. **Party-mode artifact in `epic-bmad-audit.md` referenced an abbreviated
   manifest path that doesn't exist.** The "Locked decisions fed forward"
   bullet says `_bmad/_cfg/manifest.yaml`; the actual path is
   `_bmad/_config/manifest.yaml`. aud103 caught it and added a §5 footnote
   ("note: the path is `_config/`, not `_cfg/` — the abbreviated form used
   in `epic-bmad-audit.md`'s party-mode notes does not exist on disk").
   The fix in the planning artifact is non-trivial (party-mode minutes are
   append-only history); the audit-doc footnote is sufficient. The
   underlying lesson is for `/devx-plan` Phase 6 lens prompts: verify any
   filesystem path a persona names before locking it as a decision.
4. **No remote CI workflow during this epic — required-checks log lines
   were noisy.** Each story's status log carries "no required checks
   (.github/workflows/ doesn't exist yet — that's ini503's job)". This
   resolves itself when ini503 ships; until then, `/devx` Phase 7 needs to
   distinguish "no CI configured" from "CI configured but pending" cleanly
   so the PR-merge step doesn't loop. **The /devx skill v0 has been
   updated** to handle this (Phase 7 now probes `.github/workflows/`
   emptiness vs. CI-pending) — verified during this audret run, which
   itself is the first PR after the workflow lands and exercises the
   "CI configured + pending" path.
5. **Retrospective discipline was an emergent discovery, not a plan
   output.** `epic-bmad-audit.md`'s "Locked decisions fed forward" already
   names "Devx assumes manual `LESSONS.md` updates instead of
   `bmad-retrospective` — explicit known gap to wire in Phase 5
   (`epic-retro-agent`)". But the *interim* discipline (this LEARN.md +
   `*ret` story per epic) had to be invented mid-flight when the user
   noticed the gap on 2026-04-27 — the original Phase 0 plan didn't
   carry it. The fix (interim retro discipline rollout in `1b8edb3`)
   landed at start-of-audret; the lesson is that "known gaps to wire
   later" should produce *interim discipline* rows in the parent plan,
   not just deferred-epic placeholders.

---

## 4. Cross-references with the existing hand-extracted entries in LEARN.md

This formal pass reconciles with the hand-extracted entries in `LEARN.md §
epic-bmad-audit` (extracted 2026-04-27, ahead of audret running formally).

| Hand-extracted finding | Formal-pass status |
|---|---|
| Stale `branch:` frontmatter on every spec | Confirmed; promoted to cross-epic patterns (17/17 across 4 epics). No new info. |
| Forward-pointing notes between sibling stories work well | Confirmed; expanded with concrete aud101/aud102/aud103 examples (see §2.1 above). Promotion threshold pending a third epic. |
| No remote CI workflow yet → noisy "no required checks" log lines | Confirmed; pending ini503. The audret run is the first to exercise CI-configured-and-running. |
| `bmad-audit.md` Risk 3 → trigger for the entire interim retro discipline | Confirmed; this retro is the first instance. |

This pass adds the following NEW findings (not previously hand-extracted):

- E1 (high, code+docs) — `bmad-agent-qa` ghost reference still unfixed; apply §4.2 row 1 in this PR.
- E2 (med, docs) — Audit doc embeds its own re-run trigger. Recommend the pattern for future audits/research/long-lived planning artifacts.
- E3 (med, skill) — Party-mode personas can name filesystem paths that don't exist; `/devx-plan` Phase 6 should verify path existence before locking.
- E4 (low, docs) — Risk-severity calibration (gradient, not uniform) is a quality marker; codify as a §3 expectation in `/devx-plan` epic-shape prompts.
- E5 (med, docs) — "Known gap to wire in Phase N" markers in plan locked-decisions should produce *interim discipline* rows in the parent plan, not just deferred-epic placeholders.

---

## 5. Items applied in this PR (low blast radius)

1. **Replace `bmad-agent-qa` with `bmad-tea` in both planner skills.** Edits
   `.claude/commands/devx-plan.md:171` and `.claude/commands/dev-plan.md:162`.
   Resolves E1 / `bmad-audit.md` §4.2 row 1. Single-line text edit each;
   adjacent context preserved. Verified via grep that no other references
   exist.
2. **Append the four NEW findings (E1–E5) to `LEARN.md § epic-bmad-audit`.**
   Existing hand-extracted entries kept verbatim; new entries appended with
   formal-pass attribution.

---

## 6. Items NOT applied (filed instead)

| Finding | Why not applied here | Filed as |
|---|---|---|
| E2 (re-run-trigger pattern) | Promotion to a `/devx-plan` epic-shape default needs cross-epic concordance (≥3 epics observe the same pattern). Currently 1/4. | `LEARN.md § epic-bmad-audit` row, with promotion-pending note. Re-evaluate at next retro. |
| E3 (path-existence check in party-mode) | Skill-prompt change with cross-epic blast radius; needs LearnAgent (Phase 5) judgment before auto-applying. Single-instance evidence. | `LEARN.md § epic-bmad-audit` row, marked `pending-concordance`. |
| E4 (severity-gradient codification) | Same — single-epic evidence, low-confidence promotion. | `LEARN.md § epic-bmad-audit` row, `pending-concordance`. |
| E5 (interim-discipline markers in plan locked-decisions) | Higher blast radius (touches `/devx-plan` Phase 4 + `docs/DESIGN.md` "Locked decisions" convention). User-review-required by `self_healing.user_review_required_for: [skills, prompts]`. | `LEARN.md § epic-bmad-audit` row + recommend filing as a dev spec under the appropriate Phase 5 epic when LearnAgent lands. |

No `MANUAL.md` rows filed — every finding is either applied or has a clean
home in `LEARN.md` + a deferred Phase 5 hand-off.

---

## 7. Readiness check for next epic in dependency order

Phase 0's other four epics have already shipped (`epic-config-schema` →
cfg201–204; `epic-cli-skeleton` → cli301–305; `epic-os-supervisor-scaffold` →
sup401–405; `epic-init-skill` → ini501 done, ini502+ ready). The retro
discipline applies to each in turn (`cfgret`, `cliret`, `supret`, `iniret`)
once their dependencies clear.

The next item `/devx` will pick up after audret merges is whichever ready
retro is at the top of `DEV.md` — likely `cfgret` (epic-2 retro) — or
`ini502` if the user explicitly wants to move forward on the init skill.
Both are unblocked.

No epic update is required — every §3 risk has a concrete §4 wiring already
slotted into the existing roadmap (no new phases needed).

---

## 8. Closure

audret is the inaugural application of the interim retro discipline. The
deliverable is:
- this BMAD-shaped retro file (sibling to LEARN.md for traceability),
- `LEARN.md § epic-bmad-audit` updated with E1–E5 alongside the four
  hand-extracted entries,
- two one-line skill edits applied (E1 mitigation),
- no MANUAL.md rows or new dev specs filed.

Source of truth for action items going forward: `LEARN.md`. This file is a
parallel artifact for downstream BMAD-shaped consumers (RetroAgent +
LearnAgent in Phase 5) to ingest when those land.
