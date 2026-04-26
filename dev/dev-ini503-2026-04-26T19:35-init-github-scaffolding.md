---
hash: ini503
type: dev
created: 2026-04-26T19:35:00-07:00
title: GitHub-side scaffolding (workflows + PR template + develop + protection)
from: _bmad-output/planning-artifacts/epic-init-skill.md
plan: plan/plan-a01000-2026-04-26T19:30-foundation.md
status: ready
blocked_by: [ini502]
branch: develop/dev-ini503
---

## Goal

Implement `src/lib/init-gh.ts` — writes `.github/workflows/*` + `pull_request_template.md`, creates `develop` branch, applies branch protection on `main`. Degrades gracefully on free-tier private repo and no-remote.

## Acceptance criteria

- [ ] Writes `.github/workflows/devx-ci.yml` (stack-conditional per PRD FR-I); detects stack via `init-state.ts`
- [ ] Stack-conditional bodies for: python, ts/js, rust, go, flutter, empty (echo-only no-op gates)
- [ ] Writes `devx-promotion.yml` placeholder + `devx-deploy.yml` empty stub
- [ ] Writes `.github/pull_request_template.md` with `<!-- devx:mode -->` marker (template at `_devx/templates/init/pull_request_template.md`)
- [ ] Creates `develop` branch off `main` HEAD via `gh api -X POST repos/:owner/:repo/git/refs`; sets as default via `gh api -X PATCH repos/:owner/:repo -f default_branch=develop`
- [ ] Applies branch protection PUT to `main` per PRD FR-J: required contexts `[lint, test, coverage]`, `enforce_admins: true`, `required_pull_request_reviews` non-null with `required_approving_review_count: 0`, `required_linear_history: true`, `allow_force_pushes: false`, `allow_deletions: false`
- [ ] Free-tier private repo detection: `gh api repos/:owner/:repo -q .private,.plan.name`; if private + free → install `pre-push` git hook + write 1 MANUAL.md warning
- [ ] No-remote detection: `git remote -v` empty → skip all `gh` ops + queue to `.devx-cache/pending-gh-ops.json` + write 1 MANUAL.md entry
- [ ] Idempotency: existing workflow files diff-and-skip; existing branch protection union (never replace); existing develop branch kept
- [ ] Vitest covers: green-path + private-free-tier + no-remote + idempotent-rerun + existing-non-`main`-default

## Technical notes

- `gh auth status` checked first; missing scope (`repo`, `workflow`) detected via 403 probe and surfaced via INTERVIEW.md.
- PR template uses `Co-Authored-By: devx-agent <noreply@devx.local>` (placeholder address; updated when telemetry is wired).

## Status log

- 2026-04-26T19:35 — created by /devx-plan
