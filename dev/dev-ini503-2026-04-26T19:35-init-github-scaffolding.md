---
hash: ini503
type: dev
created: 2026-04-26T19:35:00-07:00
title: GitHub-side scaffolding (workflows + PR template + develop + protection)
from: _bmad-output/planning-artifacts/epic-init-skill.md
plan: plan/plan-a01000-2026-04-26T19:30-foundation.md
status: done
blocked_by: [ini502]
branch: feat/dev-ini503
owner: /devx
---

## Goal

Implement `src/lib/init-gh.ts` — writes `.github/workflows/*` + `pull_request_template.md`, creates `develop` branch, applies branch protection on `main`. Degrades gracefully on free-tier private repo and no-remote.

## Acceptance criteria

- [x] Writes `.github/workflows/devx-ci.yml` (stack-conditional per PRD FR-I); detects stack via `init-state.ts`
- [x] Stack-conditional bodies for: python, ts/js, rust, go, flutter, empty (echo-only no-op gates)
- [x] Writes `devx-promotion.yml` placeholder + `devx-deploy.yml` empty stub
- [x] Writes `.github/pull_request_template.md` with `<!-- devx:mode -->` marker (template at `_devx/templates/init/pull_request_template.md`)
- [x] Creates `develop` branch off `main` HEAD via `gh api -X POST repos/:owner/:repo/git/refs`; sets as default via `gh api -X PATCH repos/:owner/:repo -f default_branch=develop` (gated on `config.git.integration_branch === "develop"`; this project opted out of the split, but the library implements both paths for target projects)
- [x] Applies branch protection PUT to `main` per PRD FR-J: required contexts `[lint, test, coverage]`, `enforce_admins: true`, `required_pull_request_reviews` non-null with `required_approving_review_count: 0`, `required_linear_history: true`, `allow_force_pushes: false`, `allow_deletions: false` (gated on `config.git.protect_main !== false`)
- [x] Free-tier private repo detection: `gh api repos/:owner/:repo -q .private,.plan.name`; if private + free → install `pre-push` git hook + write 1 MANUAL.md warning
- [x] No-remote detection: `git remote -v` empty → skip all `gh` ops + queue to `.devx-cache/pending-gh-ops.json` + write 1 MANUAL.md entry
- [x] Idempotency: existing workflow files diff-and-skip; existing branch protection union (never replace; preserves existing restrictions); existing develop branch kept
- [x] Vitest covers: green-path + private-free-tier + no-remote + idempotent-rerun + existing-non-`main`-default + protection-PUT-failure + restrictions-preservation + look-alike-URL-rejection + queue-config-gating (37 tests)

## Technical notes

- `gh auth status` checked first; missing scope (`repo`, `workflow`) detected via 403 probe and surfaced via INTERVIEW.md.
- PR template uses `Co-Authored-By: devx-agent <noreply@devx.local>` (placeholder address; updated when telemetry is wired).

## Status log

- 2026-04-26T19:35 — created by /devx-plan
- 2026-04-27T11:30 — claimed by /devx; branch `feat/dev-ini503` (single-branch per project config — `git.integration_branch: null`, `git.protect_main: false`); library still implements full develop/main + protection path for target projects whose config opts in
- 2026-04-27T13:55 — implemented `src/lib/init-gh.ts` + 8 new templates (`_devx/templates/init/github-workflows/devx-ci-{typescript,python,rust,go,flutter,empty}.yml`, `devx-promotion.yml`, `devx-deploy.yml`, `pull_request_template.md`); 37 vitest tests; full local CI (307 tests) green
- 2026-04-27T13:55 — self-review surfaced 12 issues; all fixed in same item: HIGH = unionProtection stripped existing restrictions; create/flip/protect swallowed real errors as misleading skip kinds; queue ignored single-branch + no-protect config (would reapply ops user opted out of); parseRepoSlug regex matched look-alike URLs (https://malicious.com/github.com/x/y). MED = HTTP-status regex too loose (`/HTTP 403/` matched `4031`); queue paths absolute (broke if repo moved); test gaps for PUT-post-probe failure / mixed stack / PR template idempotency. LOW = pre-push hook install error swallowed silently
- 2026-04-27T14:05 — merged via PR #24 (squash → 036b7e7) after both CI checks (macos + ubuntu) passed

