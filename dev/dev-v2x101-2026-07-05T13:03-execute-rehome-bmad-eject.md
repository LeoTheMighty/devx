---
hash: v2x101
type: dev
created: 2026-07-05T13:03:00-06:00
title: V2.2 — execute re-home + BMAD ejection
from: v2/06-phases.md
plan: v2/
status: done
owner: /devx-2026-07-05T1105-3281
blocked_by: [v2e102, mgrret]
branch: feat/dev-v2x101
---

## Goal

`/devx` execution runs BMAD-free; BMAD is removed from the repo. Per
`v2/01-bmad-capture.md` §4 and `v2/06-phases.md § V2.2`.

## Acceptance criteria

- [ ] `.claude/commands/devx.md` Phases 2–4 replaced: native execute
      discipline (spec-ACs direct; red-green-refactor; tests-first re-runs
      the RED artifact and watches it fail before coding; File List);
      adversarial self-review re-homed natively incl. 3-agent parallel shape
      at the >500-line threshold + explicit-zero rule; dvx103 status-log
      pinning updated + green.
- [ ] Native `/devx retro` stage section (walk shipped specs + PRs → retro
      file + LEARN.md rows, same row contract) replaces `bmad-retrospective`;
      `emit-retro-story` AC template retargeted (D-3).
- [ ] `should-create-story` + canary retired; `Story:` commit-template line
      dropped; sprint-status.yaml writer steps removed everywhere (D-7).
- [ ] `devx.config.yaml`: `engine:` + `loop:` blocks per `v2/02-engine.md` §7
      + `v2/04-overnight-loop.md` §3 replace `bmad:` (§15); schema updated;
      deprecation shim tolerates a leftover `bmad:` key with a warning.
- [ ] `.claude/skills/bmad-*` (all), `_bmad/`, `.claude/commands/dev.md`,
      `.claude/commands/dev-plan.md` deleted (user-foreground).
- [ ] `devx init` de-BMAD'd: no `npx bmad-method install` path; ini506
      BMAD-fail failure mode removed; engine templates included in scaffold.
- [ ] Docs sweep: CLAUDE.md, docs/DESIGN.md, docs/ROADMAP.md (D-2 re-wording),
      docs/SETUP.md ghost path, LEARN.md header line, docs/MODES.md refs.
- [ ] Eject contract updated per `v2/01-bmad-capture.md` §6.
- [ ] `grep -ri bmad src/ .claude/ _devx/` clean (frozen `_bmad-output/`
      history + docs' historical-capture mentions exempt; the exemption list
      is explicit in the test).
- [ ] A dev item ships end-to-end under the rewritten skill with zero BMAD
      loads (the next item in DEV.md serves as the proof run).
- [ ] Full suite green.

## Technical notes

- This workstream is v2e102's dogfood subject: drive it PRD→RED with the new
  stages before executing.
- Batch all `.claude/` edits/deletes into this single user-foreground PR.

## Status log

- 2026-07-05T13:03 — created from v2/06-phases.md § V2.2.
- 2026-07-05T11:05:36-06:00 — claimed by /devx in session /devx-2026-07-05T1105-3281
- 2026-07-05T11:55 — phase 2: spec ACs direct (v2 native); 11 ACs; workstream=execute-rehome-bmad-eject; red-artifacts=E-1_bmad-free.ts,E-2_engine-config.ts (both re-run RED before implementation).
- 2026-07-05T11:55 — implemented: config engine:/loop: + shim (coordinator); devx.md native Phases 2–4 + Stage: Retro (coordinator); 927-file BMAD deletion (coordinator); src de-BMAD + sprint-status retirement + init engine scaffold (agent A, 5 review findings fixed); docs sweep 11 files (agent B). E-1/E-2 flipped RED→GREEN; checkpoint: _devx/workstreams/execute-rehome-bmad-eject/checkpoints/phase-1.md.
- 2026-07-05T11:55 — phase 4: 3-agent parallel adversarial review (agent A scope: 11 raw → 5 unique findings, 1 HIGH validate-emit abort-regression, all fixed) + coordinator review of own surfaces (2 findings: E-1 shim-detector paradox, stale devx-plan sprint-status line — both fixed); re-review clean.
- 2026-07-05T12:10 — PR https://github.com/LeoTheMighty/devx/pull/64 merged (3bbf14d); worktree removed; lock released. V2.2 closed; BMAD era ends in code as well as history.
