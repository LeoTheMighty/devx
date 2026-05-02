---
hash: pln101
type: dev
created: 2026-04-28T19:30:00-07:00
title: deriveBranch() helper + devx plan-helper derive-branch CLI
from: _bmad-output/planning-artifacts/epic-devx-plan-skill.md
plan: plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md
status: in-progress
owner: /devx-pln101-2026-05-02T17:43
branch: feat/dev-pln101
---

## Goal

Ship `src/lib/plan/derive-branch.ts → deriveBranch(config, type, hash): string` as a pure function consumed by `/devx-plan` Phase 5 spec writes. Exposes via `devx plan-helper derive-branch <type> <hash>`. Closes the LEARN.md cross-epic `branch:` hardcoding regression class.

## Acceptance criteria

- [ ] `src/lib/plan/derive-branch.ts` exports `deriveBranch(config, type, hash): string`. Pure function; no I/O.
- [ ] Truth table covers 4 config shapes:
  - `{integration_branch:null, branch_prefix:"feat/"}` + `dev` + `aud101` → `feat/dev-aud101`.
  - `{integration_branch:null, branch_prefix:"work/"}` + `dev` + `aud101` → `work/dev-aud101`.
  - `{integration_branch:"develop", branch_prefix:"develop/"}` + `dev` + `aud101` → `develop/dev-aud101`.
  - `{integration_branch:"develop", branch_prefix:"feat/"}` + `dev` + `aud101` → `develop/feat/dev-aud101`.
- [ ] Empty/whitespace `git.integration_branch` treated as `null` (single-branch path).
- [ ] `src/commands/plan-helper.ts` registers `devx plan-helper derive-branch <type> <hash>`. Prints derived branch from current cwd `devx.config.yaml`. Exit 0 success / exit 1 invalid config.
- [ ] `.claude/commands/devx-plan.md` Phase 5 spec-emit step invokes `devx plan-helper derive-branch dev <hash>` for each spec; result is the `branch:` frontmatter value.
- [ ] **Closes LEARN.md cross-epic pattern**: regression test asserts a fresh dev spec for fixture plan-spec under single-branch config has frontmatter `branch: feat/dev-<hash>` (not `develop/dev-<hash>`).

## Technical notes

- Skill body invokes helper via Bash CLI (mirrors mrg102 pattern).
- `_internal` config support not yet needed; plan-helper reads existing `git.*` keys only.

## Status log

- 2026-04-28T19:30 — created by /devx-plan
- 2026-05-02T17:43 — claimed by /devx in session pln101-2026-05-02T17:43
