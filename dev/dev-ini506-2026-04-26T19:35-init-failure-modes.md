---
hash: ini506
type: dev
created: 2026-04-26T19:35:00-07:00
title: Failure-mode handling (BMAD-fail / gh-not-auth / no-remote)
from: _bmad-output/planning-artifacts/epic-init-skill.md
plan: plan/plan-a01000-2026-04-26T19:30-foundation.md
status: done
owner: /devx-2026-04-27T20:00
blocked_by: [ini503, ini505]
branch: feat/dev-ini506
---

## Goal

Implement `src/lib/init-failure.ts` covering the three Phase 0 failure modes. Adds the `init.partial:true` flag, the pending-gh-ops queue, MANUAL.md entries, and the `devx init --resume-gh` subcommand for replaying deferred work.

## Acceptance criteria

- [ ] `init-failure.ts` writes `init.partial: true` flag to `devx.config.yaml` whenever any deferred work exists
- [ ] **BMAD-install failure:** capture exit code + stderr; offer `[r]etry / [s]kip / [a]bort`; skip writes `bmad.modules: []` + 1 MANUAL.md entry
- [ ] **`gh` not authenticated:** detected via `gh auth status` exit 1; queue branch-protection + develop-push + workflow-push to `.devx-cache/pending-gh-ops.json`; 1 MANUAL.md entry
- [ ] **No remote:** skip all `gh` ops; promotion gate forced to `manual-only` regardless of mode; 1 MANUAL.md entry
- [ ] `devx init --resume-gh` (registered as `src/commands/init.ts` — the 12th non-stubbed command): reads `.devx-cache/pending-gh-ops.json`, replays each op, clears `init.partial` if all succeed
- [ ] `init.partial:true` blocks `/devx-plan`, `/devx`, etc. in modes ≥ BETA via a refuse-to-spawn check
- [ ] Vitest covers all three failure modes against fixture repos
- [ ] `devx init --resume-gh` test: corrupt pending-gh-ops.json → abort with clear error; partial replay (one op fails) → keep flag, log which ops succeeded

## Technical notes

- Flag-blocking check is a one-liner all dev commands import: `assertNotPartial()` reads `init.partial` and throws if true + mode ≥ BETA.
- Pending-gh-ops queue is YAML, not JSON, for hand-edit visibility (per Leonid voice).

## Status log

- 2026-04-26T19:35 — created by /devx-plan
- 2026-04-27T20:00 — claimed by /devx (single-branch YOLO; branch resolved to feat/dev-ini506 from devx.config.yaml git.branch_prefix; spec frontmatter `branch:` corrected from develop/* to feat/*)
- 2026-04-27T21:20 — implemented src/lib/init-failure.ts (3 failure handlers + flag round-trip + assertNotPartial guard + replayPendingGhOps) + src/commands/init.ts (devx init --resume-gh as 12th non-stub command); 47 vitest cases pass; full suite 392/392
- 2026-04-27T21:21 — self-review pass found and fixed 3 issues with regression tests added: (a) per-segment URL encoding for push-workflows content probe (encodeURIComponent on full path 404s every directoried path), (b) backtick-fence escalation in MANUAL.md so captured stderr containing literal ``` doesn't break markdown rendering, (c) `created:` timestamp preservation across queue rewrites (was overwriting the original first-queued time with each replay's now())
- 2026-04-27T21:21 — JSON queue format kept (matches init-gh.ts ship + AC #3/#5 explicit `pending-gh-ops.json` mention; spec technical-note about YAML noted as superseded); the assertNotPartial gate is exported for Phase-1 /devx-plan + /devx wiring (Phase 0 has no slash-skill-side hook to wire into yet)
- 2026-04-27T21:25 — merged via PR #27 (squash → addac3c)
