---
hash: pln101
type: dev
created: 2026-04-28T19:30:00-07:00
title: deriveBranch() helper + devx plan-helper derive-branch CLI
from: _bmad-output/planning-artifacts/epic-devx-plan-skill.md
plan: plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md
status: done
owner: /devx-pln101-2026-05-02T17:43
branch: feat/dev-pln101
pr: 38
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
- 2026-05-02T18:13 — implemented in feat/dev-pln101: src/lib/plan/derive-branch.ts (pure fn) + src/commands/plan-helper.ts (CLI passthrough w/ derive-branch subcommand) + cli.ts registration; tests at test/plan-derive-branch.test.ts (13-row truth table + LEARN.md regression closure) + test/plan-helper-cli.test.ts (CLI happy/invalid/config-error coverage); .claude/commands/devx-plan.md Phase 5 step now invokes `devx plan-helper derive-branch dev <hash>` for the branch frontmatter (replaces hand-composed derivation)
- 2026-05-02T18:13 — phase 4: self-review found 1 HIGH finding (unconditional branch_prefix default re-introduced regression class for split-branch projects; CLAUDE.md "Branching model" docs require conditional default). Fixed in same diff: `feat/` for single-branch, `<integration>/` for split. Re-review clean — explicit-zero per LEARN.md § epic-merge-gate-modes E7
- 2026-05-02T18:13 — phase 5: npm test green — 587/587 tests pass (27 new for pln101: 15 truth-table + 12 CLI integration; help.test.ts snapshot updated for new plan-helper command)
- 2026-05-02T18:18 — phase 7: PR https://github.com/LeoTheMighty/devx/pull/38 opened (head 754d0a4); body rendered via `devx pr-body` (no unresolved placeholders); awaiting remote CI
- 2026-05-02T18:22 — phase 8: remote devx-ci green on head 754d0a4; `devx merge-gate pln101` returned `{"merge":true}` (exit 0); merged via PR #38 (squash → 6538bf0). Worktree removed; feat/dev-pln101 deleted locally and remotely (`gh pr merge --delete-branch`). main fast-forwarded 6a9d05e → 6538bf0.
