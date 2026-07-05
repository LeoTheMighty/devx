# Retro — v2 migration (V2.0 → V2.6) — 2026-07-05

First **native** retro (`/devx` Stage: Retro, D-3): no BMAD workflow loaded;
evidence reconstructed from spec status logs, `gh pr view` metadata, and diff
stats — disk, not memory. Companion LEARN section:
`LEARN.md § v2-migration (2026-07-05)`.

Scope: the nine merged v2-migration items (V2.0 close-out through V2.5), plus
the S-1 measurement and the first real outcome verdict, recorded from inside
the final item (v2o101, V2.6).

## Shipped items

| PR | Item | Phase | Merged (UTC) | Diff | What it delivered |
|---|---|---|---|---|---|
| [#59](https://github.com/LeoTheMighty/devx/pull/59) | v2s101 | V2.0 | 17:02 | +453/−0 | 9 engine templates, `_devx/workstreams/` root, `_bmad-output/` freeze note, D-10 grep test |
| [#60](https://github.com/LeoTheMighty/devx/pull/60) | roc101 | V2.0 prereq | 17:10 | +1,255/−3 | `devx devx-helper verify-claim` + Phase 1 resume-detection (closes LEARN dvx E13) |
| [#61](https://github.com/LeoTheMighty/devx/pull/61) | mgrret | V2.0 close-out | 17:16 | +211/−37 | Final BMAD-era retrospective; Phase 1 closes 5/5; sprint-status.yaml's last touch |
| [#62](https://github.com/LeoTheMighty/devx/pull/62) | v2e101 | V2.1-A | 17:42 | +6,735/−11 | 10 engine lib modules + 4 CLI commands (workstream/gate×3/revise/next), ~200 tests, prose canary |
| [#63](https://github.com/LeoTheMighty/devx/pull/63) | v2e102 | V2.1-B | 18:05 | +1,049/−791 | `/devx-plan` rewritten as the four engine stages (36KB → ~14KB); first real PRD→RED run (dogfood subject: v2x101) |
| [#64](https://github.com/LeoTheMighty/devx/pull/64) | v2x101 | V2.2 | 18:55 | +1,620/−276,853 | BMAD ejection: 927-file deletion, native Phases 2–4 + Stage: Retro, `engine:`/`loop:` config, de-BMAD'd init |
| [#65](https://github.com/LeoTheMighty/devx/pull/65) | v2t101 | V2.3 | 19:47 | +5,896/−6 | `devx tour gather/build/publish/prune`, single-file field-journal tour UI, `check-hold` (D-5), S-2 proof on its own PR |
| [#66](https://github.com/LeoTheMighty/devx/pull/66) | v2d101 | V2.4 | 20:48 | +4,487/−113 | `devx next` repo-level 12-row table (S-4: 79 tests), debug-type claims, universal dispatcher skill body, S-5 init e2e |
| [#67](https://github.com/LeoTheMighty/devx/pull/67) | v2l101 | V2.5 | 23:27 | +8,363/−15 | Overnight loop: 11 `src/lib/loop/` modules, failure ladder, hang immunity, chaos kill-9 pair, morning report |

V2.6 (outcome loop + this retro) ships as v2o101 — the PR carrying this file.

## Outcome

- **Wall-clock: the entire migration ran in ONE day.** v2s101 claimed
  2026-07-05T09:58 local; v2l101 merged 17:27 local — V2.0 through V2.5,
  nine PRs, ~7.5 hours. For comparison, the fastest BMAD-era epic (mgr, 6
  stories) took ~7h45m for a *single* phase-sized epic. Each v2 phase here
  is roughly epic-sized. The v1 loop carried the migration exactly as the
  bootstrap-discipline sequencing principle prescribed (`v2/06-phases.md`).
- **Tests: 1,309 → 1,974 (+665, +51%)** across the nine PRs (mgrret
  baseline → v2l101 close), all green throughout; v2o101 adds the outcome
  suite on top. Largest single contributor: v2l101 (~+214 incl. review
  regression tests), then v2e101 (~+200), v2d101 (~+107 in-worker).
- **Net diff: ~+30,069 / −277,829.** The −276,853 in PR #64 is the BMAD
  ejection (927 files: `_bmad/`, 51 `.claude/skills/bmad-*` dirs, legacy
  commands). The system got net *smaller* by a quarter-million lines while
  gaining six subsystems.
- **Review-pattern stats:** ~111 unique actionable self-review findings
  across the 9 items, all fixed in-place, every re-review clean. 3-agent
  parallel adversarial shape on every substantial surface: v2x101 (11 raw →
  5 unique + 2 coordinator), v2t101 (BH 12 / EC 12 / AA 6 → ~19 unique,
  incl. 1 HIGH data-island escape), v2d101 (BH 10 / EC 14 / AA 7 → ~19
  unique, 2 HIGH), v2l101 (two full 3-agent passes: ~23 unique + 22
  findings incl. 1 HIGH). Below-threshold single-pass held for v2s101 (2)
  and roc101 (1 HIGH). v2e101 (5) and v2e102 (13, incl. the 4-lens critique
  step's first live run: 8 accepted + 2 rejected-with-rationale) sat
  between. The threshold heuristic (CLAUDE.md working agreement) needed no
  amendment.
- **First real outcome verdict (dogfood, this PR):** `devx outcome arm
  v2x101 --measure-by 2026-08-02` then scored early (deterministic evals):
  **keep — 3/3 goals hit** (G-1: 0 live BMAD refs, E-1 eval exit 0; G-2:
  `engine:` block validates, E-2 eval exit 0; G-3: 1,974 tests ≥ the 1,571
  floor). Artifact: `_devx/workstreams/execute-rehome-bmad-eject/RESULTS.md`.

## S-1 verification (prose budget) — measured 2026-07-05

Prose actually loadable for one full PRD→merge run under the native engine
(`wc -c`, this commit):

| Surface | Bytes |
|---|---|
| `_devx/templates/engine/*.md` (9 templates) | 10,262 |
| `.claude/commands/devx-plan.md` (PRD/Design/Plan/RED stages) | 14,164 |
| **Planning surface subtotal** | **24,426 (~23.9 KB)** |
| `.claude/commands/devx.md` (dispatcher + execute/debug/address/retro/loop arms) | 41,341 |
| **Full run total** | **65,767 (~64.2 KB)** |

Honest read against the `v2/02-engine.md §6` targets:

- **Planning surface: 23.9 KB — well inside the 60 KB budget** and ~94%
  under the BMAD-era planning load (139 KB create-prd + 86 KB architecture
  + ~34 KB epics + ~48 KB party-mode + 30 KB readiness ≈ 337 KB before
  research docs).
- **Full run: 64.2 KB — ~7% OVER the 60 KB end-to-end target**, while still
  ~88% under the ~550 KB BMAD-era end-to-end baseline. The overshoot is
  entirely `devx.md`, which now carries six arms (dispatch, execute, debug,
  address, retro, loop) where the BMAD era's per-story execute load
  (~48 KB dev-story + code-review) covered one. Per-stage §6 targets are
  individually met; the aggregate misses narrowly because one file serves
  every arm.
- **Disposition:** recorded, not silently re-decided. The CI canary keeps
  gating the planning surface at 60 KB; a 2×-budget drift tripwire on the
  full surface was added in `test/engine-prose-budget.test.ts` (v2o101).
  Whether to split `devx.md`'s arms or raise `engine.prose_budget_kb` is a
  product call — flagged in the LEARN section below, not decided here.

## Findings

Full rows with confidence/blast-radius tags live in
`LEARN.md § v2-migration (2026-07-05)`; headline findings:

1. **First real run of a new gate/primitive finds real bugs — every time
   it was tried** (v2e102 parser bug, v2d101's 13 drift defects, v2t101's
   own-diff substitution bug; mgr103 precedent). Promoted to Cross-epic
   patterns (≥3 concordant).
2. **Latent-until-unattended defects surface when a reviewer asks "what if
   nobody is watching?"** — v2l101's review found dvx101's claim-rollback
   `reset --hard` (shipped ~2 months, harmless attended, catastrophic
   unattended) + the staged-sweep sibling in the same primitive.
3. **The critique step's grounding rule paid for itself on its first run**
   (E-2 wrong-schema-path HIGH caught at plan time, pre-RED).
4. **Version-skewed argv semantics are a hang-immunity blind spot**
   (v2l101 CI fix-forward: node 20 vs 24 `node -p … -e …` divergence hung
   grace-kill tests 15 s — exactly the class the loop must survive).
5. **Suite duration is now a real constraint** (~26 s e2e-harness era →
   391–679 s full suite across two same-day v2o101 runs, ~6.5–11 min
   load-dependent, dominated by loop timing tests — the ~10 min tier-split
   line is already crossed under load), and two vitest runs racing in one
   worktree produced a flake — test-isolation + duration are filed as a
   watch item, debug spec on recurrence.
