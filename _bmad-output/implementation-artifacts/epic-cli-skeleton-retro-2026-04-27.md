# Retrospective — epic-cli-skeleton

**Epic:** `_bmad-output/planning-artifacts/epic-cli-skeleton.md`
**Plan:** `plan/plan-a01000-2026-04-26T19:30-foundation.md`
**Stories:** cli301 (npm package scaffold + commander dispatch) · cli302 (stub helper + 10 stub commands) · cli303 (`devx --help` listing) · cli304 (`devx --version` + postinstall PATH verification) · cli305 (cross-platform install + WSL PATH detection)
**Run by:** /devx cliret (interim retro discipline — `LEARN.md § epic-cli-skeleton` is the source of truth for action items; this file is a BMAD-shaped sibling for traceability)
**Run date:** 2026-04-27
**Mode at execution:** YOLO · empty-dream · send-it (single-branch on `main`)

---

## 1. Epic summary

| Metric | Value |
|---|---|
| Stories planned | 5 |
| Stories shipped | 5 (cli301, cli302, cli303, cli304, cli305) |
| Completion % | 100% |
| PRs | #7 (cli301 → 3641bd6), #9 (cli302 → 379a79e), #10 (cli303 → fa48586), #11 (cli304 → 17428b9), #12 (cli305 → 1a58274) |
| Production incidents | 0 |
| Rollbacks | 0 |
| Self-review findings (auto-fixed) | cli301 2 (1 HIGH `realpathSync`, 1 MED build-before-test) + cli302 0 + cli303 0 + cli304 8 (1 real: tests must use `process.execPath` since they override PATH; remainder cosmetic) + cli305 not enumerated in status log. Across the epic: ~3–4 load-bearing fixes + ~7 cosmetic, 0 lint-class. |
| Tests at end of epic | cli302 70 (first explicit count) → cli303 75 → cli304 81 → cli305 106 (compounding; no flakes). cli301's exact count is not in its status log; cli302's "70 tests pass" is the first explicit number. |
| Acceptance criteria met | All cli301 AC1–7, cli302 AC1–6, cli303 AC1–5, cli304 AC1–6, cli305 AC1–4 |
| Final artifacts | `package.json`, `tsconfig.build.json`, `vitest.config.ts`, `src/cli.ts` (commander + static array + PhaseSortedHelp), `src/lib/stub.ts`, 10 stub command files, `scripts/postinstall.js` + `scripts/postinstall-lib.mjs`, `INSTALL.md`, `.github/workflows/devx-ci.yml`, test files |

Status check at retro time: epic ships every promised deliverable, with one
pleasant surplus — `.github/workflows/devx-ci.yml` (added by cli305) is the
project's first remote CI workflow. Every PR after cli305 has had a real
remote-CI run gating it.

This is the project's **first multi-story chain of length 5** — larger than aud
(3) and cfg (4). Sequential dependency-explicit blocking held end-to-end.

---

## 2. What worked

1. **5-story sequential dep chain held cleanly.** cli301 (no deps) → cli302
   (cli301) → cli303 (cli302+cfg204) → cli304 (cli301) → cli305 (cli304). Same
   `blocked_by:` pattern as aud (3) and cfg (4); scaled cleanly to 5. Two of
   the dependencies were cross-epic (cli303 ← cfg204; later cfg204 also
   ← cli301), and the cross-epic blocks resolved in DEV.md ordering without
   manual reshuffling.
2. **Self-review caught real defects on every story that had implementation
   nontriviality.** cli301: HIGH `isMainEntry()` failed for symlinked bin
   (npm i -g path) — fixed with `realpathSync` on both sides + regression test;
   MED `npm test` skipped subprocess smoke when `dist/` absent — fixed by
   chaining `npm run build` before `vitest run`. cli304: 8 findings, 1 real
   (tests must use `process.execPath` not bare `node` since they override
   PATH). cli302 and cli303 were genuinely clean (party-mode-flagged
   considerations were already covered by spec ACs and pinned property tests).
   None were lint-class. The cross-epic pattern continues: every epic produces
   ≥1 load-bearing self-review hit.
3. **Source-of-truth precedence applied in real time (cli302 example).**
   cli302 status log: "party-mode minutes proposed appending a `preview:`
   follow-up line to the stub message; spec ACs say stderr must 'match
   exactly' — followed the spec, pinned the single-line property in tests so
   any future preview-line bolt-on must update both the spec and the
   regression test." This is the second canonical example after cfg202
   (XDG-vs-`~/.devx/`) and was the second epic that needed the rule, hence
   the cross-epic-patterns promotion in cfgret PR #20. cli302 is independently
   reconfirming, not original.
4. **Test-count compounding continues.** cli302 70 (first explicit count) →
   cli303 75 → cli304 81 → cli305 106. Same green-check pattern as sup epic
   (sup401 116 → sup405 199). Adding tests is consistently easier than
   adding non-test code, and no flakes recurred. (cli301's count not in its
   status log; cli302's `npm test = 70 tests pass` is the first concrete
   number, which already includes cli301's contribution.)
5. **Phase-0 stub policy is internally consistent across 10 stubs.** Every
   stub command shares the `makeStub(phase, epic)` body; per-command file
   is just `export default makeStub(N, "epic-slug")`. The `devx eject`
   no-destructive test (`test/eject-noop.test.ts`) is non-negotiable — Leonid's
   "destructive surprise" red flag is captured as a test, not a comment. The
   property test on stderr-exact-match (cli302) means any future preview-line
   bolt-on must touch the spec AND the regression test, raising the cost of
   silent drift.
6. **First remote CI workflow shipped (cli305) — `.github/workflows/devx-ci.yml`.**
   Before cli305 every prior cli/aud/cfg/sup PR ran under "no remote CI
   workflow detected → local gates authoritative" per /devx Phase 7. cli305
   added the macOS+Ubuntu Node 20 matrix; the workflow triggers on
   `pull_request → main` and `push → main`. **Every PR after cli305 has had a
   real remote-CI run gating it** (ini501 PR #18, audret PR #19, cfgret PR #20
   all have a `pull_request` workflow run; merge-commits to main also fire
   `push` runs). This is the moment the project transitioned from
   local-only to local+remote gating.
7. **WSL host-crossover detection (cli305) is a clean second example of
   per-platform deviation with rationale.** sup404 was the first (`${HOME}`
   substitution because `wsl.exe --exec` doesn't spawn a shell). cli305's WSL
   detection (`uname -r` containing `microsoft` AND `npm config get prefix`
   matching `/mnt/c/`) short-circuits cleanly when not WSL — zero overhead
   when not applicable. The convention "deviate where the platform demands;
   call it out explicitly in the status log; test the deviation" recurs.
   Two epics now confirms; pending-concordance moves toward cross-epic
   promotion at the next retro that observes it (potentially `iniret`).
8. **YOLO single-branch auto-merge held across 5 PRs.** No human merge
   intervention; trust-gradient threshold = 0 / count = 0 keeps the ladder
   open from commit 1. Same as aud/cfg/sup. Live memorialized in
   `feedback_yolo_auto_merge.md`. Already cross-epic-promoted.

---

## 3. What didn't

1. **Planner emitted `branch: develop/dev-<hash>` despite single-branch
   config — recurring (5/5 stories).** Same as aud and cfg. Already mitigated
   in commit `1b8edb3` (planner skills + `docs/DESIGN.md` updated as part of
   audret PR #19). Listed here for completeness; no new action. cliret's own
   spec frontmatter ALSO carried the stale `develop/dev-cliret` and was
   corrected at claim time — the planner-skill fix has effect for *future*
   spec generation, not for already-emitted retro stubs.
2. **`bmad-create-story` step in `/devx` Phase 2 was silently skipped on
   every cli story (5/5).** Same drift as aud and cfg. Spec ACs were the
   de-facto source of truth — the cli ACs were genuinely sufficient (file
   list, exact stderr format, exit-code matrix, snapshot test, eject-no-op
   contract). 5/5 here brings the cumulative count to **17/17 across all 4
   shipped Phase 0 epics** (aud × 3, cfg × 4, cli × 5, sup × 5). Already
   acknowledged in `CLAUDE.md` "How /devx runs" Phase 2 (added by cfgret PR).
   Skill-prompt change still pending-user-review per
   `self_healing.user_review_required_for: [skills]`.
3. **`debug-flow01` referenced in cli301 status log was never filed.**
   cli301 status log: "Filed debug-flow01 to fix the claim-not-pushed flow."
   But `debug/` directory does not exist; `DEBUG.md` is empty (zero rows).
   The lesson was instead captured as `feedback_devx_push_claim_before_pr.md`
   (auto-memory) plus the CLAUDE.md "How /devx runs" Phase 1 explicit rule:
   *"Push the claim commit to `origin/main` before opening the PR."* So the
   corrective behavior IS in effect (cfgret, audret, this run all pushed
   their claim commits before PR open) — but the original spec-file mechanism
   was bypassed. Reconciliation: mark `debug-flow01` as **superseded by
   memory + CLAUDE.md** in the formal retro; do NOT file a phantom debug
   spec. Lesson: when a retro-extracted finding references a downstream
   tracking artifact ("filed as X"), the formal pass should verify X exists
   and explicitly resolve "filed-then-superseded" cases so the audit trail
   isn't silently broken.
4. **Retro stories (`*ret`) absent from `sprint-status.yaml` — 3rd
   confirmation.** audret (PR #19), cfgret (PR #20), cliret (this PR) — none
   have rows in `_bmad-output/implementation-artifacts/sprint-status.yaml`.
   cfgret filed this as E2 (`pending-concordance: 2/2 retros observed; promote
   to skill-edit when a third retro confirms (cliret next)`). **cliret IS the
   third confirmation — promote to LEARN.md cross-epic patterns in this PR.**
   The mechanical backfill (3 single-line yaml additions for audret + cfgret +
   cliret rows under their respective epics) is low-blast and applied here.
   The skill-prompt change to make `/devx-plan` and `/dev-plan` emit retro
   rows alongside `*ret` story rows in DEV.md is `skill` blast-radius =
   user-review-required; filed as MANUAL.md row.
5. **Retro-row schema in `sprint-status.yaml` is undefined.** Adding cliret
   to the yaml needs an answer to: does a `*ret` story go under the epic it
   retroes, or under a separate "retros" sub-section? Both are reasonable;
   neither is documented. cfgret didn't have to answer this because it
   didn't add its own row. **Decision applied in this PR**: place `*ret`
   rows under the epic they retroe, ordered after the parent stories. This
   keeps DEV.md ordering and sprint-status ordering parallel and makes
   "epic complete" a single-section check. If LearnAgent or `/devx-manage`
   wants to filter retros they can match on the `ret`-suffix key. Worth a
   one-line note in `docs/CONFIG.md` or `docs/DESIGN.md` if a future
   refactor touches this — not in cliret's scope.
6. **`epic-cli-skeleton.md` "Locked decisions fed forward" — verify "fix
   the loser" coverage.** cfgret found that cfg202's spec-AC win (XDG-on-
   Linux) had not been backported to `epic-config-schema.md`'s locked
   decision; cfgret applied the loser-side fix. For cli302's analogous case
   (party-mode preview-line vs spec stderr-exact), the resolution lives in a
   regression test, not in a divergent locked-decision in the epic file.
   Verified during this retro: `epic-cli-skeleton.md` does not carry a
   "preview line OK in stub stderr" decision that needs reverting. **No
   loser to fix.** Pattern: not every spec-AC-wins case has a losing-side
   epic-file decision to backport; the precedence rule is "fix the loser if
   one exists," not "edit the epic file unconditionally." Worth recording
   as a refinement to the rule.
7. **CLAUDE.md "How /devx runs" Phase 2 inline note (added in cfgret PR) is
   carrying a fixed claim that needs follow-up wording.** Current text:
   *"Empirically across all 4 Phase 0 epics this step has been skipped …
   tracked in `LEARN.md § epic-config-schema` E1 and pending a /devx skill
   update once concordance is sufficient."* After cliret merges, the
   concordance count is **5/5 cli stories + 4/4 cfg stories + 3/3 aud
   stories + 5/5 sup stories = 17/17 ALL Phase 0 stories** — concordance is
   quite sufficient. The skill-prompt change is now overdue but remains
   user-review-required. **Apply in this PR**: bump the inline note to
   read "Empirically across all 4 Phase 0 epics (17/17 stories) this step
   has been skipped … cliret retro reaffirms; cross-epic LEARN.md row is
   `applied` for the docs side, the actual /devx skill change remains
   user-review-required."

---

## 4. Cross-references with the existing hand-extracted entries in LEARN.md

This formal pass reconciles with the hand-extracted entries in `LEARN.md §
epic-cli-skeleton` (extracted 2026-04-27, ahead of cliret running formally).

| Hand-extracted finding | Formal-pass status |
|---|---|
| Same precedence issue as cfg202 (cli302 party-mode preview-line) | Confirmed; reaffirmed in §2.3 above. cli302 was the second canonical example that triggered the cross-epic-patterns row in cfgret PR. No new action — the loser-side fix doesn't apply here (see §3.6). |
| Symlinked `bin` (npm i -g) breaks `isMainEntry` checks — cli301 fix uses `realpathSync` | Confirmed; lives in source. Note for future scaffolds (and `/devx-init` work) reaffirmed. |
| `npm test` must `npm run build` first if subprocess smoke depends on `dist/` | Confirmed; lives in source. Same nature as the realpathSync hit — both surfaced by the **first time the harness ran on a globally-installed shape**. Together they form a "subprocess smoke tests catch packaging realities the in-process tests miss" pattern; revisit at next retro that exercises packaging. |
| Claim commit not pushed before PR open — filed as `debug-flow01` | **Superseded by memory + CLAUDE.md.** §3.3 above explains. The corrective rule is now the project's recorded behavior; no debug spec filed because `feedback_devx_push_claim_before_pr.md` + CLAUDE.md "Push the claim commit to `origin/main` before opening the PR" cover the same surface. |
| Trust-gradient threshold = 0 in YOLO single-branch makes auto-merge the steady-state | Confirmed; record-only. Already cross-epic-promoted via `feedback_yolo_auto_merge.md`. |

This pass adds the following NEW findings (not previously hand-extracted):

- **E1** (high, docs+config) — Retro-row schema in `sprint-status.yaml` was undefined; resolved by placing `*ret` rows under their parent epic, ordered after parent stories. Cliret applies this and backfills audret + cfgret rows. (§3.5)
- **E2** (high, docs) — `*ret` stories absent from `sprint-status.yaml` is now the **third confirmation** (audret + cfgret + cliret = 3/3 retros). Promote to LEARN.md cross-epic patterns. Mechanical 3-row backfill applied in this PR. Skill-prompt change to `/devx-plan` and `/dev-plan` (so future retro rows auto-emit) remains user-review-required and is filed as MANUAL row. (§3.4)
- **E3** (med, docs) — `debug-flow01` referenced in cli301 status log was never actually filed; the lesson lives in `feedback_devx_push_claim_before_pr.md` + CLAUDE.md. Reconcile by marking it "superseded" in this retro. Lesson generalized: formal-pass retros should verify that "filed-as X" references resolve to a real X, not a phantom. (§3.3)
- **E4** (med, docs) — "First remote CI workflow shipped at cli305" is a project-state inflection point worth recording. Pre-cli305 PRs (#1–11) ran under "no remote CI workflow detected"; post-cli305 PRs (#12, #13–17, #18, #19, #20, this PR onward) run under remote CI authoritative. Important context for future LearnAgent timeline analysis. (§2.6)
- **E5** (med, docs) — WSL host-crossover detection (cli305) is a clean second example of the "per-platform deviation with explicit rationale + dedicated test" pattern after sup404's `${HOME}` substitution. 2/2 epics; pending-concordance toward cross-epic promotion at next retro that observes it. (§2.7)
- **E6** (low, docs) — "Subprocess smoke tests catch packaging realities the in-process tests miss" — cli301's two self-review hits (realpathSync + npm-build-before-test) both surfaced because the smoke tests exercised the globally-installed shape. Pattern worth memorializing as a /devx-init or `/devx-plan` epic-shape default for any CLI-shaped epic. (§4 row 3)
- **E7** (med, docs) — CLAUDE.md "How /devx runs" Phase 2 inline note about `bmad-create-story` skip needs an update to reflect the cumulative concordance (17/17 Phase 0 stories) so the wording matches the evidence. **Apply in this PR.** (§3.7)

---

## 5. Items applied in this PR (low blast radius)

1. **Backfill 3 retro rows in `sprint-status.yaml`**: `audret` under
   `epic-bmad-audit`, `cfgret` under `epic-config-schema`, `cliret` under
   `epic-cli-skeleton`. Each ordered after the parent stories; status
   `done` for audret + cfgret (already merged), `in-progress` for cliret
   (this PR is in flight; the `chore: mark cliret done after PR #N merge`
   commit will flip it). Resolves E1 + E2 mechanical surface.
2. **Append the seven NEW findings (E1–E7) to `LEARN.md §
   epic-cli-skeleton`.** Existing five hand-extracted entries kept verbatim;
   new entries appended with formal-pass attribution. Mirror the prelude
   pattern from cfgret + audret formal passes.
3. **Promote E2 to `LEARN.md § Cross-epic patterns`.** "Retro stories
   missing from `sprint-status.yaml`" with confirmation across all 3
   shipped retros (audret, cfgret, cliret). Mechanical backfill applied;
   skill-prompt edit deferred (user-review-required).
4. **Record E5 (cross-platform deviation pattern) as 2/3 in the
   epic-cli-skeleton section** — sup404 (1) + cli305 (2). NOT yet promoted
   to cross-epic patterns (threshold is ≥3 epics). Will move when a third
   epic observes the same pattern (likely iniret).
5. **Update CLAUDE.md "How /devx runs" Phase 2 inline note** to reflect
   cumulative concordance count (17/17 across all 4 shipped Phase 0
   epics). Resolves E7. Multi-line wording bump kept tight; redirects the
   tracker pointer from `LEARN.md § epic-config-schema E1` to
   `LEARN.md § Cross-epic patterns` since the row is now promoted.
6. **Resolve `debug-flow01` reference in LEARN.md** — change "filed-as
   debug-flow01 (verify it's tracked …)" to "superseded by
   `feedback_devx_push_claim_before_pr.md` + CLAUDE.md Phase 1 rule." E3.

---

## 6. Items NOT applied (filed instead)

| Finding | Why not applied here | Filed as |
|---|---|---|
| Skill-prompt change to `/devx-plan` + `/dev-plan` so retro rows auto-emit into `sprint-status.yaml` (E2 root-cause fix) | Blast radius = `skill`; `self_healing.user_review_required_for: [skills]`. Not auto-applicable in YOLO. | `MANUAL.md MP0.2` — asks the user to approve a one-line addition to `/devx-plan` Phase 7 emission template + `/dev-plan` mirror. Until then, mechanical backfills cover the surface. |
| `bmad-create-story` skip enforcement decision (E2 from cfgret retro, now 17/17 Phase 0 stories) | Same — `skill` blast-radius. Decision is "enforce / make conditional / drop"; product call. | Carried forward in `LEARN.md § epic-config-schema E1` (already filed in cfgret PR). cliret reaffirms via the §3.2 17/17 count; cross-references the existing entry rather than filing a duplicate. |
| Stub-policy carve-out (E6 from cfgret retro) — no-args = exit 0 | Single-instance, low confidence. cliret didn't add a second instance; revisit at next real Phase 1+ command landing. | Carried forward in `LEARN.md § epic-config-schema E6`. |

---

## 7. Readiness check for next epic in dependency order

epic-cli-skeleton is closed. The remaining ready retros in `DEV.md` (in
order) are `supret`, `iniret` (last one blocked-by ini502+). Forward-progress
items: `ini502` (Local file writes) is unblocked next (blocked-by ini501 +
cfg204, both done).

Phase 0 closure-readiness:
- aud + cfg + cli + sup retros: aud done (PR #19), cfg done (PR #20), cli
  in flight (this PR), sup pending.
- ini partial: ini501 done; ini502 is the next forward-progress story
  (unblocked because both blockers — ini501 + cfg204 — are done); the
  ini503–508 chain is downstream of ini502 and waits for it.
- Phase 0 has no surprise dependencies surfacing in this retro.

The next item `/devx` will pick up after cliret merges is — in DEV.md
ordering — **supret** (Epic 4 retro, blocked-by all-done sup401–405).

---

## 8. Closure

cliret is the third application of the interim retro discipline. The
deliverable is:

- this BMAD-shaped retro file (sibling to LEARN.md for traceability),
- `LEARN.md § epic-cli-skeleton` updated with E1–E7 alongside the five
  hand-extracted entries, plus cross-epic-patterns promotion of E2,
- two low-blast doc edits applied (CLAUDE.md /devx Phase 2 wording bump;
  `debug-flow01` superseded-marker resolution),
- one mechanical config edit applied (3-row sprint-status.yaml backfill
  for audret + cfgret + cliret),
- one MANUAL.md row filed (MP0.2: skill-prompt change for retro-row
  auto-emission).

Source of truth for action items going forward: `LEARN.md`. This file is a
parallel artifact for downstream BMAD-shaped consumers (RetroAgent +
LearnAgent in Phase 5) to ingest when those land.

After this PR merges, 3 of the 4 shipped Phase 0 epics (aud, cfg, cli)
have a formal retro on file; `supret` is the last shipped epic awaiting
its retro, and `iniret` is gated on the rest of the ini stories shipping.
Concordance threshold for cross-epic promotion (≥3 epics) is now
empirically met across multiple findings; the next pending-concordance
candidates will tip after `supret` and `iniret`.
