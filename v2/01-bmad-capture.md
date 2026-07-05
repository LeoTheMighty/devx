# 01 — The BMAD Capture: what it gave us, what we keep, how we leave

This document is the permanent record of devx's BMAD era (Phase 0 through
Phase 1, 2026-04 → 2026-07), and the exact migration plan off it. It exists so
that (a) nothing load-bearing is lost in the switch, and (b) the decision is
auditable later.

## 1. The verdict, in numbers

From the 2026-07-05 inventory (see `_bmad-output/planning-artifacts/bmad-audit.md`
for the original Phase 0 audit this extends):

- **51 installed BMAD skills**: 14 invoke, 0 wrap, 19 escape-hatch, 4 shadow,
  14 orphan. 33/51 are touched by no devx command.
- **3 skills on the hot path**: `bmad-dev-story` (~28KB), `bmad-code-review`
  (~20KB), `bmad-retrospective` (~63KB).
- **`bmad-create-story`: skipped 43/43 stories across 9 epics.** The dvx102
  canary machinery exists solely to bury it gracefully. Zero `story-*.md`
  files exist. `architecture.md` was never produced either.
- **Token weight**: ~48KB of BMAD prose per `/devx` story (modest), but
  **~450–500KB per `/devx-plan` run** (research skills + create-prd 139KB +
  party-mode + readiness). Planning is where "too heavy" actually bites.
- **~11MB** of BMAD skill sources in `.claude/skills/bmad-*`, of which ~8.9MB
  is the entirely-orphaned `tea` module.
- **sprint-status.yaml**: 409 lines maintained across every story with a
  recurring drift-bug class (LEARN MP0.1/MP0.2) and **zero consumers**.
- Meanwhile: **everything that makes devx work is already BMAD-independent** —
  1,309 passing tests across claim, merge-gate, pr-body, await-remote-ci,
  coverage-touched, plan helpers, manager, supervisor, init. No `src/` code
  imports or shells to BMAD; the only couplings are string templates.

## 2. What BMAD genuinely provided (capture these as native disciplines)

These are the parts with retro-evidence of value. v2 re-homes each as a native
discipline — the *pattern* is the asset, not the skill file.

### 2.1 Adversarial self-review (`bmad-code-review`) — the crown jewel
Evidence: real bugs found on every one of 43 stories (cfg201: 5 findings,
cli301: HIGH `realpathSync`, ini503: 12 with 4 HIGH, dvx106: ~40 raw; dvxret:
"most load-bearing fixes were semantics issues, not lint").

**v2 re-home** (Phase V2.2): native review step inside the Execute stage:
- Non-skippable; explicit-zero when clean ("self-review found nothing
  actionable"), never omission.
- All findings (HIGH/MED/LOW) fixed without asking; re-review to verify.
- **3-agent parallel shape at threshold** (>500 lines / multi-regex /
  marker-bearing): Blind Hunter + Edge Case Hunter + Acceptance Auditor —
  promoted cross-epic pattern at plnret, keep verbatim.
- Status-log line format stays pinned by the dvx103-style discipline test.

### 2.2 Story-execution discipline (`bmad-dev-story`)
The story *file* is dead (43/43 skips), but the discipline is real:
red-green-refactor, execute all tasks/subtasks, no milestone stops, keep a
File List. **v2 re-home**: ~15 lines of rules in the Execute skill body,
working directly from spec ACs (which is what actually happened all along).
The RED gate (`02-engine.md` §Gate 4) strengthens this: failing checks are
authored and observed red *before* implementation.

### 2.3 Retrospectives (`bmad-retrospective`)
9/9 epic retros ran; LEARN.md is arguably the highest-value artifact in the
repo. The consumed format (confidence/blast-radius rows, ≥3-concordance
promotion) is devx's own; BMAD supplied only the walk-the-stories procedure.
**v2 re-home** (Phase V2.2): native `/devx retro` stage (~5KB): read shipped
spec status logs + PR history → emit retro file + LEARN.md rows + spawned
follow-up specs. Same interim-retro discipline as ROADMAP locks, re-worded.

### 2.4 Multi-lens epic critique (`bmad-party-mode` + personas)
Real refinement value at planning time (every Phase 1 epic carries a
`refined: party-mode` marker), with a known failure mode (personas confidently
inventing file paths). **v2 re-home** (Phase V2.1): a `critique` step in the
Plan stage — N parallel lens subagents (PM / architect / dev / QA lenses as
prompt stanzas, not persona files), thoroughness-gated exactly as today
(send-it: skip unless ≥2 surfaces). Grounding rule: every lens claim citing a
file must be grep-verified or dropped.

### 2.5 Research fan-out (`bmad-domain/technical/market-research`)
Used in `/devx-plan` Phase 2. Mostly redundant with the harness's own Explore
agents, which the skill already uses in parallel. **v2 re-home**: research
becomes plain Explore/general-purpose fan-out prompts inside the PRD stage;
delete the three ~60KB workflow files from the loop.

### 2.6 Artifact shapes worth keeping
- **epic-*.md shape** is devx's own invention (defined by `/devx-plan` Phase 5,
  pinned by pln103 `validate-emit`) — keep unchanged.
- **prd.md shape** (Goals / Non-goals / Users / FR-N blocks) — keep, upgraded
  with stable IDs (`02-engine.md`).
- **Retro file shape** — keep; it feeds LEARN.md.
- **sprint-status.yaml** — retire (see §4). The spec graph is the tracker.

## 3. What we explicitly abandon

- `bmad-create-story` + the dvx102 canary: the migration deletes the skill
  invocation and simplifies `should-create-story` to a tombstone (or removes
  it) — spec ACs are the working artifact, now by contract instead of by
  silent skip.
- `bmad-create-prd` / `bmad-create-architecture` / `bmad-create-epics-and-stories`
  / `bmad-sprint-planning` / `bmad-sprint-status` / readiness checker: replaced
  by the v2 stages + gates.
- The entire `tea` module (8.9MB, 9/10 orphaned): v2 designs its test loop
  natively when Phase 5 (test agents) arrives.
- All 14 orphans + 19 escape-hatch skills.
- Legacy `.claude/commands/dev.md` + `dev-plan.md` (superseded pre-v2): delete.

## 4. Migration mechanics (executed as Phase V2.0/V2.2 stories)

Ordered, smallest-blast-radius first. Every step is a normal PR through the
existing v1 loop until the v2 loop can carry its own migration.

1. **Close Phase 1 under BMAD**: run `mgrret` (the last v1 item) with
   `bmad-retrospective` as its ACs prescribe. Phase 1 ends 5/5 clean; the
   final BMAD invocation in history is a retro — fitting.
2. **Freeze artifacts**: `_bmad-output/` becomes read-only history. New engine
   artifacts live in `_devx/workstreams/` (see `02-engine.md` §3). Do NOT move
   or rewrite old artifacts; links in shipped specs must keep resolving.
3. **De-BMAD the source templates** (2 string literals):
   `src/lib/plan/emit-retro-story.ts` (retro AC text names `bmad-retrospective`
   → names `/devx retro`) and `src/lib/devx/should-create-story.ts` (retire per
   §3). Plus the `Story: _bmad-output/...` commit-template line in
   `.claude/commands/devx.md`.
4. **Retire sprint-status.yaml**: remove writer steps from the plan/dev skills
   and `emit-retro-story`; leave the file frozen in `_bmad-output/` as history.
5. **Config §15 (`bmad:`)**: replace with `engine:` block (`02-engine.md` §7).
   Schema change + migration shim in `config-io` (unknown `bmad:` key tolerated
   with a deprecation warning, so existing user configs don't hard-fail).
6. **Rewrite the skill bodies**: `.claude/commands/devx.md` + `devx-plan.md`
   become the v2 dispatcher + stage bodies; delete `dev.md`, `dev-plan.md`.
   ⚠️ **Harness constraint** (memory: `project_skill_perms_block_subagents.md`):
   skill/command edits prompt for user confirmation even on bypass-perms.
   These land as **user-foreground PRs** — plan them where Leo is present, not
   in overnight loops.
7. **Delete `.claude/skills/bmad-*`** (11MB) and `_bmad/` manifests; drop the
   `npx bmad-method install` path from `devx init` (ini506's "BMAD-fail"
   failure mode becomes dead code → remove). Same user-foreground constraint.
8. **Update the eject contract**: `devx eject` no longer needs
   `preserve_on_eject` for BMAD; it guarantees: backlogs + specs + workstream
   artifacts + git history remain readable standalone.
9. **Docs sweep**: CLAUDE.md, docs/DESIGN.md, docs/ROADMAP.md (re-decide the
   "BMAD remains a library" locked decision — see `07-decisions.md` D-2),
   docs/SETUP.md (ghost `workflow.xml` path), LEARN.md header line about
   `bmad-retrospective`, FOCUS_GROUP.md attribution note.

## 5. Absorption of in-flight work (nothing orphaned)

| In-flight | Disposition |
|---|---|
| `mgrret` (last Phase 1 item, ready) | Runs FIRST, pre-migration, under BMAD (§4.1). |
| `roc101` resume-owner-check (ready) | Unchanged in scope; lands under the v1 loop early in V2.0 — it's load-bearing for the overnight loop's worker-spawn discipline regardless of engine. |
| Mobile companion v0.1 (24 ready items, 4 epics) | **Migration-safe by design**: consumes the spec/backlog contract, not BMAD. Continues in parallel on the v1→v2 loop as stages land. Push-payload / ROADMAP locked decisions untouched. |
| `plan-c4f1a2` Phase 2 control plane (PLAN.md, ready) | Superseded-and-absorbed: its scope (events, rot detection, restart-from-status-log, Concierge, watchdogs) is re-cut across `04-overnight-loop.md` and `05-dispatcher.md`. Mark the old plan spec `~~deleted~~` with a pointer to `v2/` when V2.0 lands. |
| LEARN.md + interim retro discipline | Contract preserved verbatim; only the invoked skill name changes. |

## 6. What "eject" means after BMAD

v1's locked decision said "BMAD remains a library, not a fork; `devx eject`
must always work." The *principle* under that decision survives BMAD's removal:

> Nothing proprietary in the loop; markdown + git are ground truth; deleting
> devx's tooling leaves a repo whose history, backlogs, specs, and planning
> artifacts are plain files any human or agent can read.

The v2 engine is shipped *inside* the devx npm package (templates + CLI + skill
bodies), so there is no third-party framework left to eject *from* — eject
reduces to "remove the CLI + skills, keep the markdown." Formal re-decision
recorded as D-2 in `07-decisions.md`.
