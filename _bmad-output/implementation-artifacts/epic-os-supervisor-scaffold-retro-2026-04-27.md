# Retrospective — epic-os-supervisor-scaffold

**Epic:** `_bmad-output/planning-artifacts/epic-os-supervisor-scaffold.md`
**Plan:** `plan/plan-a01000-2026-04-26T19:30-foundation.md`
**Stories:** sup401 (supervisor stub script + idempotent install) · sup402 (macOS launchd plist generator + bootstrap) · sup403 (Linux systemd-user .service generator + enable) · sup404 (Windows/WSL Task Scheduler XML generator) · sup405 (platform auto-detect dispatch + post-install verification)
**Run by:** /devx supret (interim retro discipline — `LEARN.md § epic-os-supervisor-scaffold` is the source of truth for action items; this file is a BMAD-shaped sibling for traceability)
**Run date:** 2026-04-27
**Mode at execution:** YOLO · empty-dream · send-it (single-branch on `main`)

---

## 1. Epic summary

| Metric | Value |
|---|---|
| Stories planned | 5 |
| Stories shipped | 5 (sup401, sup402, sup403, sup404, sup405) |
| Completion % | 100% |
| PRs | #13 (sup401 → b6bb9dd), #14 (sup402 → c2c7044), #15 (sup403 → c51bd91), #16 (sup404 → 1c260ad), #17 (sup405 → 322bbb4) |
| Production incidents | 0 |
| Rollbacks | 0 |
| Self-review findings (auto-fixed) | Not enumerated in any sup story status log — "implemented + self-reviewed" without per-story finding counts (see §3.5). Surfaced findings are visible only in source diffs. |
| Tests at end of epic | sup401 116 → sup402 133 (+17) → sup403 153 (+20) → sup404 172 (+19) → sup405 199 (+27). **+83 net tests across 5 stories** — the largest test-count growth of any Phase 0 epic. No flakes. |
| Acceptance criteria met | All sup401 AC1–8, sup402 AC1–9, sup403 AC1–7, sup404 AC1–7, sup405 AC1–7 |
| Final artifacts | `_devx/templates/supervisor-stub.sh`, `_devx/templates/launchd/dev.devx.<role>.plist`, `_devx/templates/systemd/devx-<role>.service`, `_devx/templates/task-scheduler/devx-<role>.xml`, `src/lib/supervisor.ts` (top-level dispatch), `src/lib/supervisor-internal.ts` (shared helpers), per-platform installer modules with injectable exec, `~/.devx/state/supervisor.installed.json` idempotency state, `docs/SUPERVISOR-TESTING.md` (manual host-test recipe), `MANUAL.md MS.1` (on-host kill-and-watch-restart) |

Status check at retro time: epic ships every promised deliverable, with two
notable surplus pieces — `docs/SUPERVISOR-TESTING.md` (a per-feature
TESTING.md convention, not pre-specified) and the `manager.linger`
config-knob added to the schema (sup403, systemd-only).

This is the project's **first epic with a fan-out + fan-in dependency
shape** — sup401 (no deps) → {sup402, sup403, sup404} parallel-eligible →
sup405 (after all three platforms). Different from aud (3-story sequential)
and cfg/cli (4 / 5-story sequential). The `blocked_by:` semantics held
cleanly across the fan-out.

---

## 2. What worked

1. **Fan-out + fan-in dep shape held cleanly.** sup401 (no deps) →
   {sup402, sup403, sup404} (each blocked_by sup401, mutually independent)
   → sup405 (blocked_by all three platform installers). First time the
   project exercised parallel-eligible blocking — the `blocked_by:` rule
   permitted any two of the platform installers to run simultaneously
   under a multi-agent ManageAgent (Phase 2). In Phase 0 single-agent
   /devx the chain ran serially, but the dep semantics scaled correctly.
   PR ordering (#13 → #14 → #15 → #16 → #17) confirms /devx picked them
   in DEV.md order without manual reshuffling.
2. **Test-count compounding biggest of any Phase 0 epic.** sup401 116 →
   sup402 133 → sup403 153 → sup404 172 → sup405 199. **+83 net new
   tests across 5 stories** — larger than cli (~36 across 5), cfg (~37
   across 4), aud (no test deltas; documentation epic). Disciplined
   test-first across every installer surface; no flakes; injectable
   exec (see §2.4) lets all 199 tests run on a single platform's CI.
3. **`exec sleep infinity` design discipline held.** Every platform
   installer's unit body invokes the shared `~/.devx/bin/devx-supervisor-stub.sh
   <role>` placeholder which prints one line then `exec sleep infinity`.
   The footgun the epic explicitly called out (exit-0-with-KeepAlive →
   hot-restart-loop on launchd) was caught at design time and prevented
   uniformly across launchd / systemd / task-scheduler. Phase 1's daemon
   bodies will swap the script body without touching unit files.
4. **Injectable-exec pattern recurred at every platform installer (3/3).**
   sup402: "render/install/uninstall via injectable launchctl exec".
   sup403: "via injectable systemctl/loginctl exec". sup404: "via
   injectable schtasks exec". The pattern lets unit tests mock the
   platform binary so launchd / systemd / task-scheduler tests all run
   on the project's macOS+Ubuntu CI matrix without per-platform CI
   fan-out. **3/3 internal observations within sup is enough to
   memorialize as a pattern, but cross-epic concordance is still 1/N
   (only the sup epic is installer-style so far).** ini505 (Phase 0,
   `/devx-init` supervisor trigger) and any Phase 1+ installer work
   become the natural concordance opportunities. `supervisor.ts` was
   refactored mid-epic at sup402 to share helpers via
   `supervisor-internal.ts`, which captured the pattern as project
   structure rather than convention; further work can adopt by
   importing the helpers.
5. **Idempotency state file pattern recurred across 4 install surfaces.**
   `~/.devx/state/supervisor.installed.json` carries a SHA-256 of the
   installed artifact for: (a) stub script (sup401), (b) launchd plist
   (sup402), (c) systemd .service (sup403), (d) task-scheduler XML
   (sup404). Re-install paths are: matching hash → no-op + return "kept";
   differing hash → `bootout`/`disable`/`/Delete` then re-install +
   return "rewritten". 4/4 surfaces use the same primitive. Already in
   the hand-extracted entries as `med template`; with 4 internal
   observations the pattern is solid; promotion candidate when ini505
   re-uses it across a second installer-style epic.
6. **MANUAL.md as a designed signal, not just an escape hatch.**
   sup402 deliberately filed `MANUAL.md MS.1` (on-host
   kill-and-watch-restart proof) at story-implementation time — not as
   an afterthought, but because the kill-and-restart check requires real
   launchd and can't be a CI step. sup405's verification-failure path
   is similarly designed: a failed `verifySupervisor()` files a MANUAL
   row and lets `/devx-init` complete rather than aborting. **The
   convention "verification failure files MANUAL but never aborts the
   install/init flow"** is reusable and worth memorializing — graceful
   degradation > hard-fail for "I can't verify this from CI" cases.
   Pending-concordance: 2 internal observations in sup; cross-epic
   confirmation likely at ini506 (failure-mode handling) which will
   exercise the same pattern.
7. **Per-platform deviation with explicit rationale + dedicated test.**
   sup404's status log: "Substitutes `__ROLE__/__DISTRO__/__USER__/__WSL_HOME__`
   at install (deviation from AC: `${HOME}` baked in too because
   `wsl.exe --exec` doesn't spawn a shell)." The deviation is called
   out, justified, and tested. cli305 had the same shape (WSL host-
   crossover detection: `uname -r` containing `microsoft` AND
   `npm config get prefix` matching `/mnt/c/`). Two epics now confirm
   the convention "deviate where the platform demands; record it in
   the status log; pin the deviation in tests." Pending-concordance:
   2/3 epics; promotion candidate at next retro that observes a third
   instance (iniret if ini503/ini505 hit a similar platform reality).
8. **YOLO single-branch auto-merge held across 5 PRs (#13–17).** No
   human merge intervention; trust-gradient threshold = 0 / count = 0
   keeps the ladder open from commit 1. Same as aud/cfg/cli. Live
   memorialized in `feedback_yolo_auto_merge.md`; cross-epic-promoted.
9. **`docs/SUPERVISOR-TESTING.md` as a per-feature manual-test recipe.**
   sup405 added a top-level `docs/SUPERVISOR-TESTING.md` for hands-on
   host-level test cases (install, verify, kill-and-watch-restart,
   uninstall). Pattern: when a story needs hands-on verification, file
   a per-feature `docs/<FEATURE>-TESTING.md` rather than burying steps
   in MANUAL.md. Already in the hand-extracted entries as `med docs`;
   reaffirmed here. Promotion to a `docs/TESTING/` convention candidate
   when a second case shows up (likely ini505 or any Phase 1+
   integration work that can't fit in CI).

---

## 3. What didn't

1. **Planner emitted `branch: develop/dev-<hash>` despite single-branch
   config — recurring (5/5 stories).** Same as aud, cfg, cli. Already
   mitigated in commit `1b8edb3` (planner skills + `docs/DESIGN.md`
   updated as part of audret PR #19). Listed here for completeness;
   no new action. supret's own spec frontmatter ALSO carried the stale
   `develop/dev-supret` and was corrected at claim time — the planner-
   skill fix has effect for *future* spec generation, not for already-
   emitted retro stubs. Identical to cliret's note.
2. **`bmad-create-story` step in `/devx` Phase 2 was silently skipped
   on every sup story (5/5).** Same drift as aud, cfg, cli. Spec ACs
   were the de-facto source of truth. Cumulative parent-story count
   unchanged: **17/17 across all 4 shipped Phase 0 epics** (aud × 3,
   cfg × 4, cli × 5, sup × 5). Already acknowledged in CLAUDE.md "How
   /devx runs" Phase 2 (added by cfgret PR; updated by cliret PR with
   the 17/17 count). Skill-prompt change still pending-user-review per
   `self_healing.user_review_required_for: [skills]`. supret reaffirms
   without changing the count.
3. **Retro stories (`*ret`) absent from `sprint-status.yaml` — 4th
   confirmation.** audret + cfgret + cliret + supret = 4/4 retros to
   date. Already cross-epic-promoted in cliret PR (`LEARN.md §
   Cross-epic patterns`) with the mechanical 3-row backfill for
   audret + cfgret + cliret. **cliret's planner-skill fix to make
   `/devx-plan` and `/dev-plan` auto-emit retro rows lives in MANUAL.md
   MP0.2 (user-review-required, `skill` blast-radius).** Until that
   skill change lands, every retro PR has to add its own row by hand.
   **Apply in this PR**: add the supret row under
   epic-os-supervisor-scaffold, ordered after sup405 (parent-stories-
   then-retro convention picked by cliret PR §3.5).
4. **sup405's `sprint-status.yaml` row still `backlog` despite PR #17
   merging.** Same drift as cfg201, aud101–103 — `/devx` Phase 8.6
   "flip the matching `<hash>` story's status" silently no-ops on
   pre-existing backlog rows (root cause not yet identified — possibly
   yaml-edit logic checks for the row at claim time and proceeds, but
   doesn't write back). cfgret precedent: in-scope (same epic) flips
   are applied in the retro; cross-epic stale rows go in MANUAL.md
   MP0.1 for /devx-manage to handle. **Apply in this PR**: flip
   sup405 from `status: backlog` to `status: done`. aud101–103 remain
   in MP0.1 (different epics — out of scope for supret).
5. **Status-log terseness — sup epic uniformly omits per-story self-
   review finding counts.** Every sup story status log says
   "implemented + self-reviewed" without enumerating findings. cli /
   cfg / aud all explicitly count: cli301 "1 HIGH realpathSync + 1
   MED build-before-test", cfg204 "5 of 12 surfaced", aud102 "4
   findings". sup401–405: zero finding counts in any of 5 status
   logs. This is the first epic where this pattern is observable.
   **Pending-concordance: 1/N (only sup epic to date).** Could indicate
   a different /devx run profile, a status-log writing rush, or
   genuinely cleaner stories — the implementation diffs in source
   are the only audit trail. Worth surfacing because:
   - It's a regression in the project's status-log signal-to-LearnAgent.
   - Recovery is cheap if caught early (a /devx skill prompt-card line:
     "status log MUST enumerate self-review finding counts").
   Lean: record here as a low-blast docs finding; revisit at iniret
   to see if it persists or was sup-specific.
6. **sup405 status-log timestamp ordering anomaly.** sup405's status
   log claims it was claimed at `2026-04-26T20:30` — earlier than
   sup402's `20:46` implementation timestamp and well before sup404's
   `21:55` merge. PR # ordering (sup401 #13 → sup402 #14 → sup403 #15
   → sup404 #16 → sup405 #17, all chronological per `gh pr list`)
   contradicts sup405's claimed 20:30 start. Most likely: status-log
   timestamps are imprecise/manual rather than wall-clock, and
   sup405's 20:30 is approximate. Low-blast docs/process finding —
   record only; will tighten when /devx auto-writes status-log lines
   from real wall-clock at claim/implementation/merge boundaries
   (not yet implemented; today the agent writes them by hand).
7. **`supret` retro story itself shipped without a pre-existing
   `sprint-status.yaml` row.** Identical mechanism to E1 of cfgret /
   cliret. The mechanical backfill in §5 below addresses it; the
   skill-prompt fix is MANUAL.md MP0.2 (already filed). No new MANUAL
   row needed.

---

## 4. Cross-references with the existing hand-extracted entries in LEARN.md

This formal pass reconciles with the four hand-extracted entries in
`LEARN.md § epic-os-supervisor-scaffold` (extracted 2026-04-27, ahead
of supret running formally).

| Hand-extracted finding | Formal-pass status |
|---|---|
| WSL Task Scheduler intentionally deviates from the AC (sup404 `${HOME}` substitution) — `high` `code` | Confirmed; reaffirmed in §2.7. The *pattern* (AC-deviation-with-explicit-rationale-in-status-log) is healthy and recurred across sup404 + cli305 = 2 epics. Pending-concordance toward cross-epic promotion at next retro that observes a third instance (likely iniret). |
| Idempotency state file pattern (`~/.devx/state/<thing>.installed.json` SHA-256) — `med` `template` | Confirmed and **expanded**: pattern recurred across 4 install surfaces within this epic alone (sup401 stub + sup402 launchd + sup403 systemd + sup404 task-scheduler). 4 internal observations is solid; cross-epic concordance still requires a second installer-style epic (ini505 is the natural candidate). Promotion deferred to ini retro. |
| Test-count compounding (sup401 116 → sup405 199) — `low` `code` | Confirmed and **expanded**: +83 net tests is the **largest growth of any Phase 0 epic** (cli ~36, cfg ~37, aud no test deltas). Reaffirms the cross-epic pattern; no new action. §2.2. |
| `docs/SUPERVISOR-TESTING.md` per-feature manual-test recipe — `med` `docs` | Confirmed; reaffirmed in §2.9. The convention "when a story needs hands-on verification, file a per-feature `docs/<FEATURE>-TESTING.md`" stands; second case will trigger promotion to a `docs/TESTING/` convention. Pending-concordance: 1/N. |

This pass adds the following NEW findings (not previously hand-extracted):

- **E1** (high, docs+config) — Retro stories absent from `sprint-status.yaml` is now the **fourth confirmation** (audret + cfgret + cliret + supret = 4/4 retros). Already cross-epic-promoted in cliret PR with mechanical 3-row backfill; supret applies the 4th-row backfill (its own row) here. Skill-prompt change for auto-emission remains user-review-required (MANUAL.md MP0.2). (§3.3)
- **E2** (high, docs) — sup405's `sprint-status.yaml` row still `backlog` despite merge. In-scope same-epic flip applied in this PR (cfg201 / cfgret precedent). aud101–103 stay in MP0.1. (§3.4)
- **E3** (med, docs+template) — Injectable-exec pattern recurred at every platform installer (sup402 launchctl, sup403 systemctl+loginctl, sup404 schtasks = 3/3). Lets unit tests mock the platform binary so all 199 tests run on the project's macOS+Ubuntu Node 20 CI matrix without per-platform fan-out. Captured as project structure (`supervisor-internal.ts`); promotion to a `/devx-plan` epic-shape default for installer-style epics is a candidate when ini505 confirms cross-epic. (§2.4)
- **E4** (med, docs) — MANUAL.md as a designed signal, not an escape hatch (sup402 MS.1 + sup405 verify-fail-but-don't-abort). Convention: "verification failure files MANUAL but never aborts the install/init flow." Pending-concordance: 1 epic (sup); ini506 (failure-mode handling) is the natural cross-epic confirmation. (§2.6)
- **E5** (med, docs) — Status-log terseness: sup epic uniformly omits per-story self-review finding counts (5/5 stories). cli/cfg/aud all enumerate. Worth surfacing as a regression in LearnAgent signal density. Pending-concordance: 1/N (only sup epic to date); revisit at iniret. (§3.5)
- **E6** (low, docs) — sup405 status-log timestamp ordering anomaly. Status-log timestamps are imprecise/manual today; will tighten when /devx auto-writes them from wall-clock. Record only. (§3.6)
- **E7** (med, docs) — CLAUDE.md "How /devx runs" Phase 2 inline note carries the cliret-applied wording "reaffirmed in cliret retro." After supret merges, the cumulative reaffirmation count is 4/4 retros — the wording needs a small bump to keep evidence aligned with reality. **Apply in this PR.** (§3.2)

---

## 5. Items applied in this PR (low blast radius)

1. **Backfill the `supret` row in `sprint-status.yaml`** under
   `epic-os-supervisor-scaffold`, ordered after sup405 (parent-stories-
   then-retro convention picked by cliret PR §3.5). Status: `in-progress`
   while this PR is in flight; flipped to `done` by the
   `chore: mark supret done after PR #N merge` commit (per /devx Phase
   8.6). Resolves E1.
2. **Flip sup405's `sprint-status.yaml` row from `backlog` to `done`**
   — in-scope (same epic as the retro). Resolves E2; closes the
   in-scope half of MANUAL MP0.1 for sup405 specifically. aud101–103
   remain in MP0.1 for /devx-manage (cross-epic backfill).
3. **Append the seven NEW findings (E1–E7) to `LEARN.md §
   epic-os-supervisor-scaffold`.** Existing four hand-extracted
   entries kept verbatim; new entries appended with formal-pass
   attribution. Mirror the prelude pattern from cfgret + cliret formal
   passes ("formal pass reconciled rather than duplicated the hand-
   extracted entries").
4. **Bump the cross-epic-patterns row "Retro stories (`*ret`) absent
   from `sprint-status.yaml`" from "3/3 retros" to "4/4 retros"** to
   reflect supret's confirmation. Mechanical wording bump; the
   skill-prompt edit remains user-review-required (MP0.2 unchanged).
5. **Update CLAUDE.md "How /devx runs" Phase 2 inline note** to
   reflect cumulative concordance: "reaffirmed in cliret retro" →
   "reaffirmed in every retro to date." Resolves E7. The 17/17 parent-
   story count is unchanged (supret is a retro, not a parent).

---

## 6. Items NOT applied (filed instead)

| Finding | Why not applied here | Filed as |
|---|---|---|
| Skill-prompt change to `/devx-plan` + `/dev-plan` so retro rows auto-emit into `sprint-status.yaml` | Already filed by cliret PR. supret reaffirms (4/4 retros) but adds no new MANUAL row. | `MANUAL.md MP0.2` (carried forward; user-review-required). |
| `bmad-create-story` skip enforcement decision | Already cross-epic-promoted; `skill` blast-radius (`self_healing.user_review_required_for: [skills]`). supret adds no new datum (parent-story count unchanged at 17/17). | `LEARN.md § Cross-epic patterns` row "bmad-create-story step in /devx Phase 2 silently skipped" — supret reaffirms by adding 5/5 sup confirmations to the existing 17/17 count. |
| aud101–103 stale sprint-status flips | Cross-epic; out of scope for supret. | `MANUAL.md MP0.1` (carried forward). |
| Injectable-exec pattern (E3) — promote to `/devx-plan` epic-shape default for installer epics | Single-epic concordance so far (3 internal observations within sup). Cross-epic concordance requires ini505 to confirm. | `LEARN.md § epic-os-supervisor-scaffold` row (E3) `pending-concordance`. |
| MANUAL-as-designed-signal pattern (E4) | Same — single-epic concordance. ini506 is the natural cross-epic confirmation. | `LEARN.md § epic-os-supervisor-scaffold` row (E4) `pending-concordance`. |
| Status-log terseness (E5) | Single-epic observation. Could be sup-specific. | `LEARN.md § epic-os-supervisor-scaffold` row (E5) `pending-concordance`. |
| Status-log timestamp anomaly (E6) | Low-priority; tightens automatically when /devx auto-writes status-log lines from wall-clock (not yet implemented; no spec). | `LEARN.md § epic-os-supervisor-scaffold` row (E6) record-only. |

---

## 7. Readiness check for next epic in dependency order

epic-os-supervisor-scaffold is closed. After supret merges:

- Phase 0 retro completion: aud done (PR #19), cfg done (PR #20), cli
  done (PR #21), **sup done (this PR)**, ini pending (gated on
  ini502–508 shipping).
- ini partial: ini501 done; ini502 is the next forward-progress story
  (unblocked because both blockers — ini501 + cfg204 — are done); the
  ini503–508 chain is downstream of ini502 and waits for it.
- Phase 0 has no surprise dependencies surfacing in this retro.

The next item `/devx` will pick up after supret merges is — in DEV.md
ordering — **ini502** (Local file writes, blocked-by ini501 + cfg204,
both done). After ini502–508 ship, `iniret` runs as the final Phase 0
retro and Phase 0 closes.

---

## 8. Closure

supret is the **fourth application** of the interim retro discipline
and the **last shipped-epic retro of Phase 0** (iniret blocked on
ini502–508). The deliverable is:

- this BMAD-shaped retro file (sibling to LEARN.md for traceability),
- `LEARN.md § epic-os-supervisor-scaffold` updated with E1–E7 alongside
  the four hand-extracted entries,
- one cross-epic-patterns row count bump (3/3 → 4/4 retros for
  retro-rows-absent-from-sprint-status),
- one CLAUDE.md "How /devx runs" Phase 2 wording bump (E7),
- two mechanical config edits applied (supret row added to
  `sprint-status.yaml`; sup405 row flipped from `backlog` to `done`),
- zero new MANUAL.md rows (MP0.1 + MP0.2 carry forward; supret reaffirms
  but adds no new user-actionable surface).

After this PR merges, **all 4 shipped Phase 0 epics** (aud, cfg, cli,
sup) have a formal retro on file. Concordance threshold for cross-epic
promotion (≥3 epics) is now empirically met across multiple findings;
the next pending-concordance candidates that will tip after iniret are:

- AC-deviation-with-explicit-rationale (sup404 + cli305 → 2/3, iniret
  candidate),
- Idempotency state file pattern (4 internal in sup; ini505 is
  cross-epic candidate),
- MANUAL-as-designed-signal (1 epic; ini506 cross-epic candidate),
- Per-feature TESTING.md (1 epic; cross-epic candidate at any Phase 1+
  integration epic),
- Status-log terseness (1 epic; iniret will confirm or refute).

Source of truth for action items going forward: `LEARN.md`. This file
is a parallel artifact for downstream BMAD-shaped consumers (RetroAgent
+ LearnAgent in Phase 5) to ingest when those land.
