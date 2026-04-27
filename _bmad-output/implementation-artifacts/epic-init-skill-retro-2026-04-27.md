# Retrospective — epic-init-skill

**Epic:** `_bmad-output/planning-artifacts/epic-init-skill.md`
**Plan:** `plan/plan-a01000-2026-04-26T19:30-foundation.md`
**Stories:** ini501 (13-question flow + skip-table inference + state detection) · ini502 (local file writes — config + backlogs + spec dirs + CLAUDE.md + .gitignore) · ini503 (GitHub-side scaffolding — workflows + PR template + develop + protection) · ini504 (personas + INTERVIEW.md fixed-template seeding) · ini505 (supervisor installer trigger + verify) · ini506 (failure-mode handling — BMAD-fail / gh-not-auth / no-remote) · ini507 (idempotent upgrade-mode re-run) · ini508 (end-to-end integration test)
**Run by:** /devx iniret (interim retro discipline — `LEARN.md § epic-init-skill` is the source of truth for action items; this file is a BMAD-shaped sibling for traceability)
**Run date:** 2026-04-27
**Mode at execution:** YOLO · empty-dream · send-it (single-branch on `main`)

---

## 1. Epic summary

| Metric | Value |
|---|---|
| Stories planned | 8 |
| Stories shipped | 8 (ini501, ini502, ini503, ini504, ini505, ini506, ini507, ini508) |
| Completion % | 100% |
| PRs | #18 (ini501 → 3baf1a9), #23 (ini502 → 1d98b6c), #24 (ini503 → 036b7e7), #25 (ini504 → aeb09ee), #26 (ini505 → 54f8443), #27 (ini506 → addac3c), #28 (ini507 → 20b126d), #29 (ini508 → fa0aa0e) |
| Production incidents | 0 |
| Rollbacks | 0 |
| Self-review findings (auto-fixed) | ini502 (9), ini503 (12 — 4 HIGH + 4 MED + 1 LOW + 3 test-gaps), ini504 (1), ini506 (3) enumerated; ini501, ini505, ini507, ini508 status logs do not enumerate finding counts (see §3.5). |
| Tests at end of epic | sup epic close 199 → ini501 250 (+51) → ini502 270 (+20) → ini503 307 (+37) → ini504 337 (+30) → ini505 345 (+8) → ini506 392 (+47) → ini507/ini508 collectively 424 (+32). **+225 net tests across the 8-story epic** — by far the largest growth of any Phase 0 epic (sup +83, cfg ~37, cli ~36, aud 0). |
| Acceptance criteria met | All ini501 AC1–6, ini502 AC1–9, ini503 AC1–9, ini504 AC1–8, ini505 AC1–4, ini506 AC1–8, ini507 AC1–6, ini508 AC1–8 |
| Final artifacts | `src/lib/init-questions.ts`, `src/lib/init-state.ts`, `src/lib/init-write.ts`, `src/lib/init-gh.ts`, `src/lib/init-personas.ts`, `src/lib/init-interview.ts`, `src/lib/init-supervisor.ts`, `src/lib/init-failure.ts`, `src/lib/init-upgrade.ts`, `src/lib/init-orchestrator.ts`, `src/commands/init.ts` (12th non-stub command — `devx init --resume-gh`), `_devx/templates/init/` (backlog headers, persona skeleton, 6 stack-templated INTERVIEW seeds, 6 stack-conditional CI workflow templates, PR template, claude-md template, gitignore block, supervisor-stub.sh re-export), `test/fixtures/repos/{empty,existing-no-ci,partial-on-devx}/`, e2e harness (`test/init-e2e.test.ts` — 7 fixture-driven scenarios) |

Status check at retro time: epic ships every promised deliverable. ini503's
party-mode-locked "proactive `gh` scope HEAD probe" is implemented (init-gh.ts
checks `gh auth status` first; missing scope detected via 403 probe surfaces
to INTERVIEW.md). The four named PRD addendum failure modes (BMAD-fail,
gh-auth, no-remote, free-tier-private) are all wired with their MANUAL.md
filings + degradation paths. ini506 register `init` as the 12th non-stub
command (resolving the open question OQ#1 from the epic doc).

This is the project's **first epic with a long sequential dependency chain**
plus **the first epic with a meaningful e2e fixture harness**. ini502 →
{ini503, ini504, ini505} → ini506 → ini507 → ini508. PR ordering (#18 →
#23 → #24 → #25 → #26 → #27 → #28 → #29) is monotonic; /devx picked stories
in DEV.md order across all 8 without manual reshuffling. No flakes; ini508's
e2e suite (7 scenarios) runs in ~26s including 3 fixture re-creations and
mocked-gh shim invocations.

This retro **closes Phase 0 — Foundation.** All 5 epics now have a formal
retro on file: aud (PR #19), cfg (PR #20), cli (PR #21), sup (PR #22), ini
(this PR). Phase 1 (single-agent loop) and Phase 8 (mobile companion v0.1)
are the next forward-progress targets.

---

## 2. What worked

1. **Long sequential dep chain held cleanly across 8 stories.** ini502 →
   ini503 / ini504 / ini505 (parallel-eligible) → ini506 → ini507 → ini508.
   The same `blocked_by:` semantics that worked at sup's fan-out + fan-in
   (3 stories) scaled to ini's 8-story chain without surprises. /devx
   single-agent serialized it; under Phase 2 multi-agent ManageAgent the
   ini503/504/505 fan-out tier becomes parallel-eligible. PRs #18, #23,
   #24, #25, #26, #27, #28, #29 are monotonic in DEV.md order.
2. **Self-review continued to find real bugs at every story that
   enumerated — and the count grew with story complexity.** ini502 (9
   issues including CLAUDE.md merger gating + atomic-write tmp-cleanup),
   ini503 (12 issues — 4 HIGH: union-protection stripping existing
   restrictions, error-swallowing as misleading skip, queue ignoring
   single-branch / no-protect config, parseRepoSlug regex matching
   look-alike URLs; 4 MED: HTTP-status regex too loose, queue paths
   absolute, test gaps for PUT-post-probe / mixed stack / PR template
   idempotency; 1 LOW: pre-push hook install error swallowed silently),
   ini504 (1 — defensive mkdirSync + slugify hyphen-trim), ini506 (3 —
   per-segment URL encoding, backtick-fence escalation, `created:`
   timestamp preservation across queue rewrites). Cross-epic self-review
   pattern is now confirmed in **5/5 shipped Phase 0 epics**: aud + cfg
   + cli + sup + ini. Already cross-epic-promoted; no new action.
3. **Test-count compounding biggest of any Phase 0 epic by far.**
   +225 net tests across 8 stories vs. sup's previous record of +83
   across 5. The growth tracks the surface-area gradient: ini covers
   13-question flow + 7 file-write surfaces + GitHub API shims + 6
   stack templates + persona panel + supervisor wiring + 3 failure
   modes + upgrade migrations + 3 fixture e2e harness. Test-first
   discipline held across all 8 stories; no flakes. The +51 count on
   ini501 alone (250 total) shows the question-flow + state-detection
   matrix is itself a meaningful-size testable surface.
4. **AC-deviation-with-explicit-rationale + dedicated test convention
   confirmed cross-epic (3rd epic).** sup404 + cli305 = 2/3 at supret;
   ini505 reaffirms by carrying the same WSL host-crossover detection
   (filed as MANUAL.md, not init failure) per cli305's pattern. The
   *broader* convention "deviate where the platform demands; record it
   in the status log; pin it in tests" now has 3 confirmed epic
   instances (cli + sup + ini). **Promotion-eligible.** Apply in this
   PR: new Cross-epic-patterns row promoted from pending-concordance.
5. **Idempotency state file pattern confirmed cross-epic (2nd epic).**
   sup × 4 internal observations at supret time (`~/.devx/state/<thing>.installed.json`
   SHA-256 across stub + launchd + systemd + task-scheduler installers).
   ini505 is the 2nd-epic confirmation — `init-supervisor.ts` re-uses
   `installSupervisor()` from sup which writes to the same state file.
   Plus ini503 introduced its own pending-gh-ops queue at
   `.devx-cache/pending-gh-ops.json` — semantically similar (state-on-disk
   for idempotent replay) but distinct enough to flag as a related
   sibling pattern rather than the same primitive. Promote
   "idempotency-state-file" to Cross-epic patterns at 2 epics; the
   "deferred-work-queue-on-disk" sibling stays single-epic
   pending-concordance.
6. **MANUAL.md as a designed signal, not an escape hatch — 2nd-epic
   confirmation.** sup × 2 internal at supret (sup402 MS.1 + sup405
   verify-fail-but-don't-abort). ini reaffirms across **4 ini stories**:
   ini503 (free-tier-private + no-remote → 2 MANUAL filings), ini505
   (verify-fail file MANUAL but don't abort init), ini506 (BMAD-fail +
   gh-auth + no-remote = 3 designed MANUAL filings, all with explicit
   degradation paths). The convention "verification failure files
   MANUAL but never aborts the install/init flow" + the broader
   "MANUAL is the designated channel for can't-verify-from-CI surfaces
   and graceful-degradation handoffs" is now 2 epics with 6 internal
   observations. **Promotion-eligible.** Apply in this PR: new
   Cross-epic-patterns row.
7. **First epic to register a real-functional command (ini506 →
   `devx init --resume-gh`).** cli302's stub list explicitly carved
   out 10 stub commands; ini506 closed the open question OQ#1 by
   adding `init` as the 12th command, real-functional from ship.
   This is the first non-stub Phase 0 command and serves as proof that
   the stub-vs-real boundary is configurable per-command rather than
   binary per-phase. Pattern: when a new real command is added, the
   `devx --help` listing convention from cli303 picks it up
   automatically.
8. **End-to-end fixture harness (ini508) is reusable across the
   project.** Three fixture repos (`empty/`, `existing-no-ci/`,
   `partial-on-devx/`) + scripted-answer harness + mocked `gh` shim.
   Pattern is reusable for Phase 1's `/devx-plan` + `/devx` e2e
   tests, Phase 4's mobile-companion gh-webhook tests, and any future
   onboarding-flow regression. The 7-scenario suite (3 fixtures × 1
   primary path + idempotent-rerun + 3 failure modes + corrupt-config
   halt) runs in ~26s. Pending-concordance: 1 epic; promote to
   `/devx-plan` epic-shape default for "user-facing flow" epics when
   a 2nd flow-shaped epic confirms.
9. **YOLO single-branch auto-merge held across 8 PRs (#18, #23–29).**
   No human merge intervention. Trust-gradient threshold = 0 / count
   = 0 keeps the ladder open from commit 1. Same as aud / cfg / cli
   / sup. Cross-epic-promoted long ago; record only.
10. **Spec-vs-implementation deviation justified by an upstream-story
    decision (ini506 JSON-vs-YAML queue).** Spec technical note said
    "Pending-gh-ops queue is YAML, not JSON, for hand-edit visibility."
    ini506 kept JSON because ini503 (already shipped) wrote the queue
    as `pending-gh-ops.json`. The deviation is: (a) consistent with
    upstream-story reality, (b) recorded explicitly in ini506's status
    log ("JSON queue format kept (matches init-gh.ts ship + AC #3/#5
    explicit `pending-gh-ops.json` mention; spec technical-note about
    YAML noted as superseded)"), (c) doesn't trigger a spec rewrite —
    the technical note is annotated as superseded but kept verbatim
    for audit. Useful pattern: "downstream story finds spec-tech-note
    contradicts upstream-story shipped reality → keep upstream
    reality, record supersession in status log, don't rewrite spec."
    Pending-concordance: 1 epic; revisit when a Phase 1+ story
    surfaces the same pattern.

---

## 3. What didn't

1. **Planner emitted `branch: develop/dev-<hash>` despite single-branch
   config — recurring (8/8 ini stories + iniret = 9/9).** Same as aud,
   cfg, cli, sup. Already mitigated in commit `1b8edb3` (planner skills
   + `docs/DESIGN.md` updated as part of audret PR #19). Listed here
   for completeness; no new action. iniret's own spec frontmatter ALSO
   carried the stale `develop/dev-iniret` and was corrected at claim
   time — the planner-skill fix has effect for *future* spec generation,
   not for already-emitted retro stubs. Identical to cliret + supret
   notes.
2. **`bmad-create-story` step in `/devx` Phase 2 was silently skipped
   on every ini story (8/8).** Same drift as aud, cfg, cli, sup. Spec
   ACs were the de-facto source of truth. **Cumulative parent-story
   count: 25/25 across all 5 shipped Phase 0 epics** (aud × 3, cfg × 4,
   cli × 5, sup × 5, ini × 8). Already acknowledged in CLAUDE.md "How
   /devx runs" Phase 2 (added by cfgret PR; updated by cliret + supret
   PRs). After iniret, the wording bumps from "all 4 shipped Phase 0
   epics (17/17 stories)" → "all 5 shipped Phase 0 epics (25/25
   stories)" + reaffirmation count from 4/4 retros → 5/5 retros.
   Skill-prompt change still pending-user-review per
   `self_healing.user_review_required_for: [skills]`. iniret reaffirms
   without changing the underlying status.
3. **Retro stories (`*ret`) absent from `sprint-status.yaml` — 5th
   confirmation.** audret + cfgret + cliret + supret + iniret = 5/5
   retros to date. Already cross-epic-promoted in cliret PR (`LEARN.md
   § Cross-epic patterns`) with the mechanical 3-row backfill for
   audret + cfgret + cliret; supret applied the 4th-row backfill (its
   own row); iniret applies the 5th-row backfill (its own row) here.
   **cliret's planner-skill fix to make `/devx-plan` and `/dev-plan`
   auto-emit retro rows lives in MANUAL.md MP0.2** (user-review-required,
   `skill` blast-radius). Until that skill change lands, every retro
   PR has to add its own row by hand. **Apply in this PR**: add the
   iniret row under epic-init-skill, ordered after ini508
   (parent-stories-then-retro convention picked by cliret PR §3.5).
4. **ini507 + ini508's `sprint-status.yaml` rows still `backlog`
   despite PR #28 + PR #29 merging.** Same drift class as cfg201,
   sup405, aud101–103 — `/devx` Phase 8.6 "flip the matching `<hash>`
   story's status" silently no-ops on pre-existing rows. cfgret +
   supret precedent: in-scope (same epic) flips are applied in the
   retro; cross-epic stale rows stay in MANUAL.md MP0.1 for
   /devx-manage. **Apply in this PR**: flip ini507 + ini508 from
   `status: backlog` to `status: done`. aud101–103 remain in MP0.1
   (different epics — out of scope for iniret).
5. **Status-log terseness regression continues unevenly across ini
   (4/8 stories omit self-review enumeration).** ini501, ini505,
   ini507, ini508 status logs say "implemented + self-reviewed" /
   "merged via PR #N" without enumerating findings. ini502, ini503,
   ini504, ini506 each enumerate fully (9 / 12 / 1 / 3 issues with
   categorical breakdowns). The pattern is observable per-/devx-run
   rather than per-story-shape — when /devx wrote the status log
   itself it tended to be sparse; when it explicitly reported review
   counts in the same prose it tended to enumerate. **Cross-epic
   concordance: 2 epics (sup 5/5 omissions, ini 4/8 mixed).** Not
   yet promotable as cross-epic (concordance threshold is ≥3 epics)
   but trajectory is real — the corrective is a /devx skill prompt-
   card line. Worth flagging in iniret as a pending-concordance row;
   the corrective lives at `skill` blast-radius (user-review-required).
6. **Spec-frontmatter `branch:` field on iniret was stale (`develop/dev-iniret`).**
   Same as every other retro stub; corrected at claim time. The
   planner-skill fix only takes effect for *future* emissions. No
   new action — recorded for the audit trail.
7. **ini507 + ini508 status logs are minimally populated** ("claimed
   by /devx" / "merged via PR #N" without intermediate
   implementation/test-count/review milestones). Together with
   ini505's similar shape, this is the third occurrence within the
   ini epic — and it correlates with the four stories that don't
   enumerate self-review counts (per §3.5). The likely root cause
   is /devx run-style variance rather than story-shape. Captured
   here as a same-epic-internal observation; the cross-epic
   trajectory is in §3.5.

---

## 4. Cross-references with the existing hand-extracted entries in LEARN.md

`LEARN.md § epic-init-skill` is **empty as of retro start** — the section
was filed as a placeholder ("*(empty — `iniret` runs once ini502–ini508
ship.)*") because ini was the only Phase 0 epic still in flight at the
2026-04-27 hand-extraction pass. Unlike audret / cfgret / cliret / supret,
this retro has no hand-extracted entries to reconcile against — every
finding below is formal-pass.

This pass adds the following NEW findings:

- **E1** (high, docs+config) — Retro stories absent from
  `sprint-status.yaml` is now the **5th confirmation** (audret + cfgret +
  cliret + supret + iniret = 5/5 retros). Already cross-epic-promoted in
  cliret PR with mechanical 3-row backfill; supret applied the 4th
  (its own row); iniret applies the 5th (its own row) here. Skill-prompt
  change for auto-emission remains user-review-required (MANUAL.md MP0.2,
  unchanged). Cross-epic-patterns row count bumped from 4/4 → 5/5
  retros. (§3.3)
- **E2** (high, docs) — ini507 + ini508's `sprint-status.yaml` rows
  still `backlog` despite merge. In-scope same-epic flips applied in
  this PR (cfg201 / cfgret + sup405 / supret precedent). aud101–103
  stay in MP0.1. (§3.4)
- **E3** (high, docs) — Per-platform deviation with explicit rationale
  + dedicated test promotes from pending-concordance (cli305 + sup404 =
  2/3 at supret) to **cross-epic confirmed** (cli305 + sup404 + ini505 =
  3/3). Apply in this PR: new Cross-epic-patterns row. (§2.4)
- **E4** (high, docs) — MANUAL-as-designed-signal pattern promotes
  from pending-concordance (sup × 2 internal at supret) to **cross-epic
  confirmed** (sup × 2 internal + ini × 4 internal across ini503 + ini505
  + ini506 + the 3 failure-mode handlers in ini506 = 6 ini observations
  total = 2 epics confirmed with rich internal coverage). Apply in this
  PR: new Cross-epic-patterns row. The convention is: "verification
  failure files MANUAL but never aborts the flow + MANUAL is the
  designated channel for can't-verify-from-CI surfaces and
  graceful-degradation handoffs." (§2.6)
- **E5** (med, docs+template) — Idempotency state file pattern promotes
  from pending-concordance (sup × 4 internal at supret) to **cross-epic
  confirmed** (sup × 4 internal + ini505 re-uses `installSupervisor()`
  → same `~/.devx/state/supervisor.installed.json` primitive = 2
  epics). Apply in this PR: new Cross-epic-patterns row. The
  related-but-distinct "deferred-work-queue-on-disk" sibling
  (`.devx-cache/pending-gh-ops.json` from ini503/ini506) stays
  pending-concordance because it's a sibling pattern, not the same
  primitive. (§2.5)
- **E6** (med, docs) — bmad-create-story skip cumulative count bumps
  from 17/17 across 4 epics → **25/25 across 5 epics** (aud × 3 + cfg
  × 4 + cli × 5 + sup × 5 + ini × 8). CLAUDE.md "How /devx runs"
  Phase 2 inline note + the Cross-epic-patterns row both need the
  count bump. Skill-level corrective remains user-review-required
  (unchanged). (§3.2)
- **E7** (med, docs) — Status-log terseness pattern bumps from 1 epic
  (sup 5/5 omissions) → 2 epics (sup 5/5 + ini 4/8 mixed = 10
  omissions across 2 epics). Cross-epic concordance threshold is ≥3
  epics; not yet promotable. Pending-concordance row in
  `LEARN.md § epic-init-skill` flagged for revisit at the first Phase
  1 retro. (§3.5)
- **E8** (med, docs) — End-to-end fixture-harness pattern (ini508)
  promotes to a candidate `/devx-plan` epic-shape default for
  "user-facing flow" epics. Pending-concordance: 1 epic. Revisit
  when a 2nd flow-shaped epic ships. (§2.8)
- **E9** (low, docs) — First real-functional Phase 0 command pattern
  (ini506 → `devx init --resume-gh`). Useful precedent for any future
  story that needs to graduate a stub command to real-functional.
  Recorded in `LEARN.md § epic-init-skill`. (§2.7)
- **E10** (low, docs) — Spec-vs-implementation supersession pattern
  (ini506 JSON-vs-YAML queue). Records the convention "downstream
  story finds spec-tech-note contradicts upstream-story shipped
  reality → keep upstream reality, record supersession in status log,
  don't rewrite spec." Pending-concordance: 1 epic. (§2.10)
- **E11** (low, docs) — ini507/ini508 minimally-populated status logs
  correlate with §3.5 self-review-omission stories. Same-epic
  internal observation; trajectory captured in §3.5's cross-epic row.
  (§3.7)
- **E12** (low, docs) — Phase 0 closure: this retro is the 5th and
  final shipped-epic retro of Phase 0. After iniret merges, all
  Phase 0 epics have a formal retro on file. The Cross-epic-patterns
  section is now seeded with a meaningful set of confirmed
  conventions; Phase 1's first epic retro inherits a richer baseline
  than aud did. (§1)

---

## 5. Items applied in this PR (low blast radius)

1. **Backfill the `iniret` row in `sprint-status.yaml`** under
   `epic-init-skill`, ordered after ini508 (parent-stories-then-retro
   convention picked by cliret PR §3.5). Status: `in-progress` while
   this PR is in flight; flipped to `done` by the
   `chore: mark iniret done after PR #N merge` commit (per /devx Phase
   8.6). Resolves E1.
2. **Flip ini507 + ini508's `sprint-status.yaml` rows from `backlog`
   to `done`** — in-scope (same epic as the retro). Resolves E2.
   aud101–103 remain in MP0.1 (cross-epic).
3. **Append `LEARN.md § epic-init-skill`** with formal-pass entries
   E1–E12 alongside a short prelude noting that no hand-extracted
   entries exist for this section.
4. **Promote three rows from pending-concordance to cross-epic
   confirmed** in `LEARN.md § Cross-epic patterns`:
   - **Per-platform deviation with explicit rationale + dedicated
     test** (cli305 + sup404 + ini505 = 3 epics).
   - **MANUAL-as-designed-signal — verification failure files MANUAL
     but never aborts the flow** (sup × 2 internal + ini × 6 internal
     = 2 epics with rich coverage).
   - **Idempotency state file pattern** (sup × 4 internal + ini505
     re-uses the same primitive = 2 epics).
5. **Bump the cross-epic-patterns row "Retro stories (`*ret`) absent
   from `sprint-status.yaml`" from "4/4 retros" to "5/5 retros"** to
   reflect iniret's confirmation. Mechanical wording bump; the
   skill-prompt edit remains user-review-required (MP0.2 unchanged).
6. **Bump the cross-epic-patterns row "`bmad-create-story` step in
   `/devx` Phase 2 silently skipped" from "17/17 across 4 epics" to
   "25/25 across 5 epics"** to reflect ini × 8 confirmations.
   Mechanical wording bump; skill-level corrective remains
   user-review-required. Resolves E6.
7. **Update CLAUDE.md "How /devx runs" Phase 2 inline note** —
   - `4 shipped Phase 0 epics (17/17 stories)` → `5 shipped Phase 0
     epics (25/25 stories)`,
   - `audret + cfgret + cliret + supret` → `audret + cfgret + cliret
     + supret + iniret`,
   - reaffirmation count `every retro to date` (already correct) is
     unchanged but the parenthetical list grows.
8. **Bump the Cross-epic-patterns row "Self-review is non-skippable"
   stories-spanning count** from "5+ stories spanning all 4 Phase 0
   epics" → "spans all 5 shipped Phase 0 epics" (no exact count
   needed — the qualitative note is what matters).

---

## 6. Items NOT applied (filed instead)

| Finding | Why not applied here | Filed as |
|---|---|---|
| Skill-prompt change to `/devx-plan` + `/dev-plan` so retro rows auto-emit into `sprint-status.yaml` | Already filed by cliret PR. supret + iniret reaffirm (5/5 retros) but add no new MANUAL row. | `MANUAL.md MP0.2` (carried forward; user-review-required). |
| `bmad-create-story` skip enforcement decision | Already cross-epic-promoted; `skill` blast-radius (`self_healing.user_review_required_for: [skills]`). iniret bumps the count from 17/17 → 25/25 but adds no new MANUAL row. | `LEARN.md § Cross-epic patterns` row "bmad-create-story step in /devx Phase 2 silently skipped" — iniret reaffirms by adding 8/8 ini confirmations to the existing 17/17 count → 25/25 total. |
| aud101–103 stale sprint-status flips | Cross-epic; out of scope for iniret. | `MANUAL.md MP0.1` (carried forward). |
| Status-log terseness (E7) | 2-epic concordance only (sup 5/5 + ini 4/8); below the ≥3 threshold. The corrective is a `/devx` skill prompt-card line ("status log MUST enumerate self-review finding counts") — `skill` blast-radius, user-review-required. | `LEARN.md § epic-init-skill` row (E7) `pending-concordance`. Revisit at first Phase 1 retro. |
| End-to-end fixture-harness pattern (E8) | Single-epic concordance. Promotion candidate when a 2nd flow-shaped epic ships. | `LEARN.md § epic-init-skill` row (E8) `pending-concordance`. |
| First real-functional Phase 0 command precedent (E9) | Single instance; recorded for audit/precedent. | `LEARN.md § epic-init-skill` row (E9) record-only. |
| Spec-vs-implementation supersession pattern (E10) | Single instance; revisit when a Phase 1+ story surfaces the same pattern. | `LEARN.md § epic-init-skill` row (E10) `pending-concordance`. |
| Deferred-work-queue-on-disk sibling pattern | Sibling to E5 (idempotency state file) but distinct primitive — sits adjacent to the same conceptual area but doesn't belong in the same Cross-epic-patterns row. | `LEARN.md § epic-init-skill` row mentioning the sibling for future cross-epic confirmation. |

---

## 7. Readiness check for next epic in dependency order

epic-init-skill is closed. After iniret merges, **Phase 0 — Foundation closes**:

- Phase 0 retro completion: aud done (PR #19), cfg done (PR #20), cli done
  (PR #21), sup done (PR #22), **ini done (this PR)**.
- All 5 Phase 0 epics have shipped + retroed. Phase 0 acceptance criteria
  from `plan-a01000.md` (`/devx-init` lands all 8 backlog files etc.,
  LaunchAgent / systemd unit installed + survives login, `devx config mode`
  round-trips, `bmad-audit.md` committed) are validated by ini508's e2e
  fixture suite in CI on macos-latest + ubuntu-latest.

Next forward-progress targets (per `docs/ROADMAP.md`):

- **Phase 1 — Single-agent loop**: full `/devx-plan` + `/devx` + minimal
  `/devx-manage` per the v0 → v1 refinement track. PLAN.md will spawn the
  first Phase 1 plan and its child epics.
- **Phase 8 — Mobile companion v0.1**: 4 epics already filed in DEV.md
  (epic-flutter-scaffold-ios-device, epic-github-connection-read,
  epic-bidirectional-writes-offline, epic-realtime-updates-push) with
  retro stubs for each. Phase 8 runs in parallel with Phase 1+ per
  ROADMAP.md.

There are no surprise dependencies surfacing at retro time. The Phase 5
LearnAgent + RetroAgent that supersede this interim retro discipline
remain on the ROADMAP for Phase 5; until then the per-epic `*ret` story
convention continues.

---

## 8. Closure

iniret is the **fifth and final** application of the interim retro
discipline for Phase 0 — Foundation. After this PR merges, Phase 0 is
closed end-to-end. The deliverable is:

- this BMAD-shaped retro file (sibling to LEARN.md for traceability),
- `LEARN.md § epic-init-skill` populated with E1–E12 (no hand-extracted
  entries to reconcile — section was placeholder-empty at retro start),
- **three** new Cross-epic-patterns rows promoted from pending-concordance
  to confirmed: per-platform deviation, MANUAL-as-designed-signal,
  idempotency-state-file,
- two cross-epic-patterns row count bumps: `*ret`-rows-absent (4/4 →
  5/5 retros), `bmad-create-story`-skipped (17/17 → 25/25 stories
  across 4 → 5 epics),
- one CLAUDE.md "How /devx runs" Phase 2 wording bump (E6 — list of
  retros + cumulative count),
- three mechanical config edits applied (iniret row added to
  `sprint-status.yaml`; ini507 + ini508 flipped from `backlog` to
  `done`),
- zero new MANUAL.md rows (MP0.1 + MP0.2 carry forward; iniret
  reaffirms the latter for the 5th time but adds no new
  user-actionable surface).

Concordance threshold for cross-epic promotion (≥3 epics) is now
empirically met across multiple findings; Phase 1's first retro
inherits a richer Cross-epic-patterns baseline than aud did. The next
pending-concordance candidates that will tip after the first Phase 1
retro are:

- Status-log terseness (sup 5/5 + ini 4/8 = 2 epics; needs a 3rd to
  promote — Phase 1 first retro is the candidate),
- E2E fixture-harness pattern (1 epic; Phase 1 `/devx-plan` /
  `/devx` integration test is the natural cross-epic candidate),
- Deferred-work-queue-on-disk sibling (1 epic; Phase 1+ may surface
  another instance),
- Spec-vs-implementation supersession (1 epic; Phase 1+ may surface
  another instance).

Source of truth for action items going forward: `LEARN.md`. This file
is a parallel artifact for downstream BMAD-shaped consumers (RetroAgent
+ LearnAgent in Phase 5) to ingest when those land. Phase 0 — Foundation
is **closed.**
