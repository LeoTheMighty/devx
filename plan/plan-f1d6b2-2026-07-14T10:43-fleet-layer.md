---
hash: f1d6b2
type: plan
created: 2026-07-14T10:43:00-07:00
title: "Vision-gap Track 4 — Fleet layer: thin multi-repo portfolio (registry, serial fleet loop, aggregated report, one front door)"
status: blocked
from: PLAN.md#vision-gap-tracks (drift audit 2026-07-14; supersedes ROADMAP:16 'multi-project switcher deferred to v1.5' — see INTERVIEW Q#10)
spawned: []
mode: YOLO
project_shape: empty-dream
thoroughness: send-it
stack_layers: [backend]
blocked_by: [b3f7a1, c8e2d4]
---

## Goal

One machine, one shared Claude usage pool, several repos (devx + palateful +
a new website project): `devx fleet loop` works them all overnight in
rotation, one aggregated morning report, and one conversational front door
(`/devx-fleet`) that routes intents to each repo's own backlog — while every
repo stays a fully standalone single-repo devx instance.

## Why now / decision provenance

Drift audit 2026-07-14: everything anchors to one repo root; ROADMAP:16
locked "single-repo MVP; multi-project switcher deferred to v1.5" and ledger
O-5 keeps the single-repo invariant. The owner explicitly superseded that
scope on 2026-07-14 (INTERVIEW Q#10): build a **thin outer layer** now.
Cross-repo *workstreams* (one PRD spanning repos) remain out per O-5 —
fleet = portfolio *scheduling*, not cross-repo planning. The ledger
amendment ships inside this track, not silently.

## Scope (seeded design)

- **Registry `~/.devx/projects.yaml`** (comment-preserving yaml lib;
  `fleetRegistryPath()` beside `userConfigPath()` in
  `src/lib/config-io.ts`): `version`, `projects[]` (`name`, absolute `path`,
  `enabled`, `priority`, `slice: {max_items (default 2), max_tokens?}`,
  `quiet`), `fleet:` defaults (`until`, `rotation: round_robin`). UX:
  `devx fleet add [path]` (cwd default; refuses without devx.config.yaml →
  points at `devx init`), `list`, `remove`, `enable|disable`. New
  `src/commands/fleet.ts`, `src/lib/fleet/`.
- **`devx fleet loop`** — serial round-robin, **child process per repo**
  (`devx loop --max-items <slice> --summary-json <f>` with cwd = project
  path). Child-process preserves the single-repo invariant literally: each
  repo's config discovery, `.devx-cache/`, locks, CI/merge flow run
  untouched. Fleet holds its own singleton lock
  `~/.devx/fleet/locks/fleet.lock` (reuse the O_EXCL + stale-PID pattern
  from `src/lib/manage/lock.ts`). Rotation: priority order, per-project
  slice so one fat backlog can't starve the website repo; loop until fleet
  `--until`, a full all-exhausted/blocked pass, or usage-window exhaustion —
  a child's usage pause (Track 2) suspends the **whole fleet** (one shared
  pool); rotation position persisted in `~/.devx/fleet/state/<run-id>.json`.
- **Prereq seams**: `devx loop --summary-json` (serialize the `RunSummary`
  the morning report already computes, `src/lib/loop/report.ts`) and
  `devx next --json` (from `src/lib/next/gather.ts`).
- **Aggregated report** `~/.devx/reports/<fleet-run-id>.md`: fleet totals +
  stop reason + rotation trace; per-repo sections from child summary JSON,
  blocker counts (unanswered INTERVIEW / unchecked MANUAL via
  `devx next --json`), links to each repo's own report + blockers issue
  (Track 3).
- **Front door**: globally installed **`/devx-fleet`** skill +
  `devx fleet next` — aggregates every registered repo's `devx next --json`
  into one portfolio table from any cwd. Free-text intents route to the
  **target repo's own** DEV.md/DEBUG.md by absolute path, committed/pushed
  there — fleet owns no backlog. Optional `~/.devx/fleet/NOTES.md` for
  unassigned ideas, never loop-consumed.
- **Edge cases** (in scope): dirty repo at fleet start → preflight porcelain
  check, skip-with-reason, continue; repo's manager lock held → child exits
  nonzero, record "skipped: lock held", retry next rotation; second fleet
  run → fail fast on fleet.lock; moved/missing registry path → skip +
  report; child hang → child `--until` + fleet SIGTERM at deadline+grace;
  `devx_version` skew across repos → warn in report.
- **Ledger + docs**: new `v2/07-decisions.md` entry superseding ROADMAP:16's
  deferral + O-5 annotation (workstreams still out); amend
  `docs/ROADMAP.md:16` with a supersession pointer (same style as the D-2
  reword); new `v2/08-fleet.md`; pointers in `docs/DESIGN.md`; registry
  schema in `docs/CONFIG.md`; SETUP.md gains the fleet section.

## Sub-specs to spawn

To be elicited by `/devx-plan`. Sketch: flt101 registry + fleet add/list →
flt102 JSON seams (`loop --summary-json`, `next --json`) → flt103 fleet
loop driver (lock, slices, edge cases, governor composition) → flt104
aggregated report → flt105 `/devx-fleet` skill + `fleet next` + ledger/docs
(skill install user-foreground in THIS repo; global install path from Track
1) → fltret.

## Acceptance criteria

- [ ] Registry round-trips; `devx fleet add` refuses an un-initialized repo
      with a pointer to `devx init`.
- [ ] `devx fleet loop --until <t>` over 3 registered repos (devx, palateful,
      scratch website) rotates serially, honors per-project slices, writes
      one aggregated report linking each repo's own report.
- [ ] A child's usage-window pause suspends the whole fleet and resumes
      rotation after reset (composes with c8e2d4).
- [ ] Killing a child mid-run → skip-with-reason in the report; the repo is
      retried next rotation; fleet exits clean.
- [ ] Second concurrent `devx fleet loop` fails fast on the fleet lock.
- [ ] `devx fleet next` (and `/devx-fleet`) renders the portfolio table from
      an arbitrary cwd; a free-text intent lands in the target repo's own
      backlog with a commit there.
- [ ] Decision ledger + ROADMAP + DESIGN/CONFIG/SETUP updated; O-5 annotation
      keeps cross-repo workstreams out.
- [ ] The real thing: one full overnight fleet night across palateful + the
      website project, morning report reviewed.

## Status log

- 2026-07-14T10:43 — filed from the vision-gap drift audit (plan
  sparkling-bubbling-pie, approved 2026-07-14). Track 4 of 4; blocked-by
  b3f7a1 (portability — needs ≥2 initialized repos + global skill install)
  and c8e2d4 (governor — fleet-wide usage pause composition).

## Links

- Approved drift-audit plan: `~/.claude/plans/sparkling-bubbling-pie.md`
- Decision provenance: INTERVIEW.md Q#10; supersedes `docs/ROADMAP.md:16`
  scope; annotates `v2/07-decisions.md` O-5
- Lock pattern to reuse: `src/lib/manage/lock.ts` (O_EXCL + stale-PID)
- Seams: `src/lib/loop/report.ts` (RunSummary), `src/lib/next/gather.ts`
