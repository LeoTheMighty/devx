# 06 — Phased Buildout

Sequencing principles: (1) close v1 cleanly before mutating it; (2) each phase
ships value on its own even if we stop there; (3) the v1 loop carries the
migration until the v2 loop can carry itself (bootstrap discipline, same as
Phase 0); (4) skill-body/`.claude/` edits are **user-foreground** (harness
permission gate) — batch them into phase-boundary PRs Leo reviews live;
(5) everything else is normal `/devx` PRs.

Naming: v2 phases are `V2.0 … V2.6` to avoid colliding with v1's Phase 0–10
numbering. Each phase below is roughly one epic (some two); when a phase
starts, it gets a proper workstream (PRD-lite where noted, else straight to
plan) and emitted dev specs — **the v2 engine plans its own later phases as
soon as V2.1 lands** (dogfood, same as v1 bootstrapped BMAD).

---

## V2.0 — Close-out & scaffold (prep, ~2–3 PRs, v1 loop)

Goal: Phase 1 ends clean; the ground is ready; nothing orphaned.

- **v2.0-a**: Run `mgrret` as-is (final `bmad-retrospective`; Phase 1 closes
  5/5). Run `roc101` as-is (resume-owner check — prereq for any loop work).
- **v2.0-b**: Land this `v2/` directory. Mark `plan-c4f1a2` superseded with a
  pointer. Add PLAN.md entries for V2.1–V2.6. Record D-1…D-6 outcomes in
  `07-decisions.md` after Leo's pass.
- **v2.0-c**: Scaffold `_devx/workstreams/` + `_devx/templates/engine/`
  (prd, expectations, design, plan, decision, red-report, checkpoint,
  lessons-entry, results — all JIRA/Confluence-free from birth). Freeze
  `_bmad-output/` (docs note; no writes after mgrret).

Exit: v1 fully green; `v2/` merged; templates exist; no behavior changed.

## V2.1 — Engine core: stages + gates (the big one)

Goal: PRD → Design → Plan → RED runs natively end-to-end on a real
workstream. **Dogfood subject: the V2.2+ phases themselves.**

Epic A — CLI primitives (normal PRs, adversarially tested):
- `devx workstream new` scaffolder; frontmatter extensions (stage,
  gate_status, outcome) + parser updates.
- `devx gate prd` (ID/EARS/threshold/coverage mechanical validator).
- `devx gate coverage` (two-mode, verdict blocks, extras section).
- `devx gate evals` (RED runner + report writer, wired to `projects:` runners).
- `devx revise` (cascade-reset table + replay-path printer).
- `devx next` v1 (workstream-stage rows of the decision table).
- Prose-budget canary test (S-1's `wc -c` gate).

Epic B — Stage skill bodies (user-foreground PR):
- `/devx prd`, `/devx design`, `/devx plan` (+ critique step), `/devx red`
  sections; each ends with commit + next-command print.
- Dev-spec emission from plan phases reusing pln101–103 primitives.

Exit (AC): one real workstream (V2.2's) driven PRD→RED with zero BMAD skills
loaded and gates refusing correctly on seeded-defect fixtures.

## V2.2 — Execute re-home & BMAD eject

Goal: `/devx` execution runs BMAD-free; BMAD is removed.

- Execute skill body: replace Phase 2/3 with native discipline (spec-ACs
  direct, tests-first re-runs the RED artifact); re-home adversarial
  self-review incl. 3-agent threshold shape; keep dvx103 status-log pinning.
  (user-foreground PR)
- Native `/devx retro` + retarget `emit-retro-story` AC template; retire
  `should-create-story` + canary; drop the `Story:` commit-template line.
- Retire sprint-status.yaml writer steps everywhere.
- Config: `engine:` + `loop:` blocks replace `bmad:` (schema + deprecation
  shim).
- Delete `.claude/skills/bmad-*`, `_bmad/`, legacy `dev.md`/`dev-plan.md`;
  de-BMAD `devx init` (ini506 dead path); eject-contract update.
  (user-foreground PR)
- Docs sweep: CLAUDE.md, DESIGN.md, ROADMAP.md (D-2 re-decision), SETUP.md,
  LEARN.md header.

Exit (AC): a dev item ships end-to-end with `grep -ri bmad src/ .claude/`
clean (excluding frozen history); first native retro produces LEARN.md rows.

## V2.3 — Review tour

Goal: every `/devx` PR carries a working static tour; Leo reviews one for real.

- `devx tour build` (gather CLI + narrate agent-step schema + render CLI);
  vendored single-file template (diff2html + marked inline, no Mermaid,
  system fonts); template/schema drift-pin test.
- `devx tour publish` (orphan `devx-tours` branch, race-safe) + `tour prune`.
- `pr-body` template: tour link + orientation `<details>` fallback;
  fail-soft on tour errors.
- `/devx address <pr>` (comment→anchor mapping, fix/reply/file loop) +
  `devx: hold` check in the merge tail. (skill parts user-foreground)

Exit (AC): S-2 — a real PR reviewed via tour + PR comments only;
`/devx address` closes every comment with a response.

## V2.4 — Dispatcher

Goal: `/devx` is the only command you need, on this repo and a fresh one.

- `devx next` v2: full 12-row table + test matrix (S-4).
- Dispatcher skill body: entry forms, intent classification, stage-skip
  recording, morning-review-on-first-run. `/devx-plan` becomes an alias into
  the stages. (user-foreground PR)
- Debug loop: DEBUG.md consumer, repro-first discipline, debug spec shape.
- `devx init` v2: engine scaffold in the package, S-5 fresh-repo test
  (e2e fixture harness from ini508 extends naturally).

Exit (AC): S-4 matrix green; S-5 timed run on a scratch repo; one bug taken
symptom→merged-fix through `/devx "<symptom>"` alone.

## V2.5 — Overnight loop

Goal: S-3 — a real unattended night with a trustworthy morning.

- Inner iteration contract: prompt frame, structured report schema,
  commit-or-reset, no-op detection, commit-repair path.
- Failure ladder + budgets (config `loop:` block, mode-aware); abandon-item
  and stop-loop rules; worktree preservation on failure.
- Hang immunity: `GIT_TERMINAL_PROMPT=0` everywhere, gpgsign-off, argv-exec
  injection test, push safety, worker grace-kill.
- `devx loop` entry on the manager (mgr primitives) + sleep-inhibit in the
  supervisor entrypoint; JSONL lifecycle log with git snapshots + cause
  chains.
- Morning report + morning-review skill discipline.
- First supervised night (Leo awake), then first real night.

Exit (AC): S-3, plus a chaos test: kill -9 mid-iteration ⇒ clean resume with
zero residue on the worktree.

## V2.6 — Outcome loop & polish

Goal: the loop closes past merge.

- `/devx outcome`: measure_by arming at workstream close, RESULTS.md verdicts,
  tune-cascade reopen, restart lineage fields.
- v2 retro-of-the-migration: run the engine's own retro across V2.1–V2.5;
  promote lessons; delete dead v1 prose from docs.
- Backlog hygiene: DEV/PLAN/DEBUG entries all machine-reconciled with spec
  frontmatter by `devx next` (drift becomes a reported defect).

---

## Parallel track: mobile companion (unchanged)

The 24-item mobile backlog (a/b/c/d epics) consumes the spec/backlog contract,
not BMAD — **it keeps running throughout**, on whichever loop is current.
Two v2 touchpoints, both additive: the morning report joins the push-payload
sources (V2.5+), and tour URLs ride the `deep_link` field (V2.3+). ROADMAP's
locked mobile decisions are untouched.

## Dependency graph

```
V2.0 ──▶ V2.1 ──▶ V2.2 ──▶ V2.3 ──▶ V2.4 ──▶ V2.5 ──▶ V2.6
 (mgrret, roc101 first)      └────────────┬────────────┘
mobile a→b→c→d epics ────────── parallel ─┘  (tour link V2.3+, report push V2.5+)
```

Strictly, V2.3 (tour) and V2.4 (dispatcher) could swap or interleave — both
depend only on V2.2. Default order puts the tour first because it upgrades
*every* subsequent PR's reviewability, including the dispatcher's own PRs.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Skill-body rewrites regress the 43-story-proven loop | Bootstrap discipline: v1 loop ships v2 code; each rewritten phase keeps its discipline tests (dvx103/dvx107 pattern); rewrite lands stage-by-stage, not big-bang |
| User-foreground bottleneck (harness gate on `.claude/` edits) | Batch skill edits into one reviewed PR per phase boundary; everything else stays autonomous |
| Tour narrative quality drifts (plausible-but-wrong trails) | grep-verified-edges hard rule + schema validation + drift-pin test; tour is fail-soft so a bad tour never blocks a PR |
| Overnight loop meets a novel failure class | Ladder converges on stop; worktrees preserved; first nights supervised; LOCKDOWN mode disables `devx loop` entirely |
| Prose budget creeps back up | S-1 canary test fails CI on regression |
| Losing BMAD's planning depth for genuinely big projects | Gates are mode/thoroughness-scaled like everything else; PRFAQ/brainstorm-style depth can return later as optional pre-PRD stages — deliberately out of v2 scope |
