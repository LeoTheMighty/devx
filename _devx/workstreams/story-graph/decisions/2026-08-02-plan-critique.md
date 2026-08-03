# Plan critique — 2026-08-02 (lenses: pm, architect, dev, qa)

Thoroughness is send-it, but the plan touches ≥2 surfaces (cli project,
workstream-evals project, skill prose) so the critique ran per
`engine.critique.min_surfaces: 2`. Four parallel lens subagents, grounding
rule enforced (every file claim grep-verified by the lens before being
stated). ~24 deduped findings (2 HIGH, ~12 MED, ~10 LOW); all accepted
findings applied to plan.md in one pass. Highlights:

## HIGH (both fixed)

- **Phase 1 cited a nonexistent surface** (`devx next --format json`;
  flagged independently by qa, architect, dev). `devx next` has no
  `--format` flag and emits a single decision, never per-row verdicts.
  → T1.5 restated: scratchpad tsx script drives `parseDevMd` +
  gather-side blocker resolution before/after, diffs per-row verdicts.
- **E-7's "0 reads outside fixture root" had no mechanism** (qa) — no
  verbose/trace facility exists and Phase 7 is no-new-features.
  → Eval spawns the packaged CLI with a `NODE_OPTIONS --require` fs-audit
  preload recording opened paths.

## MED (all fixed)

- `parseFrontmatterValue` is a single-line scalar reader — cannot read
  `spawned:` block-lists (architect + dev). → Phase 2 uses a YAML-aware
  read (`parseDocument` approach) for `from:`/`spawned:`/`title:`/hyphen
  keys.
- Claim-hook wording "joins the tmp+rename plan" not implementable as
  written — renamePlan composes in-memory pre-flip strings (dev).
  → Prescribed: regen AFTER the rename batch, own writeAtomic,
  `revertWorkingTree` restore-or-unlink branch, pathspec append.
- `runEmitRetroStory` stdout is key=value, not JSON (dev). → `graph=<path>`
  key added to the existing line format; `src/commands/plan-helper.ts`
  added to the phase's Files.
- `test/help.test.ts` pins the command list + full --help snapshot;
  registering `graphCommand` breaks it (architect). → Added to Phase 3
  Files with the `attachPhase` slot note.
- `EnginePatch` has no `blocked_by` field (architect). → Phase 6 extends
  `applyEnginePatch`; `src/lib/engine/frontmatter.ts` added to Files.
- **Old Phase 4 was past single-PR size** (dev: claim-sized new primitive
  + two delicate transactional integrations + prose rewrites + E-5).
  → Split: Phase 4 = regen hooks (claim + emission), Phase 5 = mark-done
  + Phase-8 rewrite (E-5 goes green there). Plan is now 7 phases.
  Sizing call per D-12; consistent with the user's 6-over-4 granularity
  choice at the phase-breakdown interview.
- Parallel-safety overstated — GRAPH.md/DEV.md/MANUAL.md are shared
  surfaces across late phases (pm + architect). → Dependencies note
  rewritten: parallel-safe modulo shared surfaces; regenerate, never
  hand-merge GRAPH.md.
- Attended steps unmarked — `devx loop` could claim Phases 3/6 and wedge
  (pm; the harness-fold-in lesson). → Both specs flagged attended-only at
  emission.
- G-2 delivery path incomplete — MANUAL rows never said "run `devx graph`
  + commit" downstream, and backfill writes edges, not GRAPH.md (pm).
  → T7.3 rows include the render+commit step, dated 2026-08-23.
- Regen failure posture tested on only one of three hooks; worktree-cwd
  resolution and the `--format json` contract untested (qa). → Named test
  cases added (T4.5, T3.7).
- E-1's live-repo leg made durable: built-CLI (`dist/cli.js` with build
  precondition) in `--stdout` mode asserting state-independent thresholds;
  GitHub-render check stays attended (qa + architect).
- Phase-3→5 interregnum ships transient GRAPH.md drift (architect).
  → Recorded as accepted, with manual-regen mitigation in after-merge
  commits.

## LOW (all fixed)

Fence wording (backfill is the sanctioned FR-5 exception to render-time
warn-only); todo-pointer narrowing recorded in Phase 2 Context;
`mark-done` severability cut line recorded; G-3 measurement procedure
recorded in Phase 7 Context; `parseTodo()` named instead of private
`POINTER_RE`; `readBacklogRows` privacy + TEST.md novelty recorded (direct
`parseDevMd` composition); JSON-stdout precedent corrected to
`devx merge-gate --json`; dry-run/exit-2/scoping/heading-fallback test
cases named; fat-lib home `src/lib/devx/mark-done.ts` + in-process
`runTodoSync` named; `flipDevMdRow` `[ ]→[/]`-only limitation recorded.

## Explicitly not applied

- PM's suggestion to add a `devx: hold` on the Phase 3/6 PRs themselves —
  the attended-only spec marker covers the loop-claim risk at the right
  layer (claim time, not merge time); the attended steps happen before
  merge in both phases anyway.
