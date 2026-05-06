---
hash: dvx105
type: dev
created: 2026-04-28T19:30:00-07:00
title: Three-state remote-CI probe + ScheduleWakeup polling
from: _bmad-output/planning-artifacts/epic-devx-skill.md
plan: plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md
status: done
owner: /devx-2026-05-06T1355-56602
blocked_by: [dvx101]
branch: feat/dev-dvx105
---

## Goal

Ship `src/lib/devx/await-remote-ci.ts → awaitRemoteCi(branch)` as a three-state probe: no-workflow / workflow-no-run / completed. Use `ScheduleWakeup` 120s delays for cache-warm polling.

## Acceptance criteria

- [ ] `src/lib/devx/await-remote-ci.ts` exports `awaitRemoteCi(branch)` returning one of:
  - `{state:"no-workflow"}` — `.github/workflows/` missing or empty.
  - `{state:"workflow-no-run"}` — workflows present but `gh run list --branch <branch>` returns nothing within 60s + one ScheduleWakeup retry.
  - `{state:"completed", conclusion:"success" | "failure" | "cancelled" | ...}` — runs returned + completed.
- [ ] Polling implemented via `ScheduleWakeup` 120s delay (cache-warm window per harness rules).
- [ ] `headSha` verified against `git rev-parse HEAD` — mismatch returns `{state:"workflow-no-run"}`.
- [ ] `.claude/commands/devx.md` Phase 7 invokes the helper; on `"workflow-no-run"`, files INTERVIEW.md entry + marks PR `awaiting-approval` + stops.
- [ ] Tests cover all 3 states with mocked `gh run list` outputs.

## Technical notes

- Cache-warm polling at 120s is critical for cost — see harness rules on prompt cache TTL (5 min).

## Status log

- 2026-04-28T19:30 — created by /devx-plan
- 2026-05-06T13:55:20-06:00 — claimed by /devx in session /devx-2026-05-06T1355-56602
- 2026-05-06 — phase 2: canary=off, shouldCreateStory=project_shape=empty-dream + 5 ACs + no story file → bmad-create-story INVOKED (canary=off; helper decision logged not honored)
- 2026-05-06 — phase 2: bmad-create-story SKIPPED in practice per CLAUDE.md "Working agreements" empirical pattern (spec ACs are the working artifact; cross-epic LEARN-tracked drift remains user-review-required for skills)
- 2026-05-06 — phase 3: implemented src/lib/devx/await-remote-ci.ts (probeRemoteCi single-shot + awaitRemoteCi multi-probe driver; ProbeState 5-state union + AwaitState 3-terminal-state union per AC #1; 60s emptyRetry + 120s pollMs defaults per AC #2; headSha verification via `git rev-parse <branch>` per AC #3 — pinned once at driver start to handle fix-forward correctly) + devx devx-helper await-remote-ci CLI passthrough with --once mode (skill-body invokes --once and drives ScheduleWakeup 120s loop externally for cache-warm polling; multi-probe blocking mode for non-harness consumers) + .claude/commands/devx.md Phase 7 prose updated to invoke the helper and route ProbeState branches to INTERVIEW/awaiting-approval per AC #4 + 68 tests covering all 3 terminal states with mocked gh run list outputs per AC #5. AC1+AC2+AC3+AC4+AC5 satisfied.
- 2026-05-06 — phase 4: 3-agent parallel adversarial review (Blind Hunter + Edge Case Hunter + Acceptance Auditor — surface ~700 LoC across lib + CLI + tests + skill prose; above the LEARN.md 290-LoC single-pass threshold) + 1 follow-up re-review of the fixes; pass 1 = ~12 findings (5 HIGH / 6 MED / 6 LOW collapsed across reviewers), pass 2 = 6 findings (2 MED / 4 LOW); ALL fixed in-place — most load-bearing: pinned headSha once at awaitRemoteCi start via `git rev-parse <branch>` (not `HEAD`) so fix-forward pushes during polling don't silently mis-classify the run as workflow-no-run AND so cwd-from-main-worktree invocations resolve the feature branch's tip correctly; secondary fixes: stricter coerceGhRun (databaseId positive integer + headSha 40-hex regex + conclusion string|null only), caller-supplied opts.headSha validated at probeRemoteCi/awaitRemoteCi boundary, maxPolls/pollMs/emptyRetryMs production-safety guards (rate-limit hammer protection when no sleep seam supplied), unknown-stage exit-2 documented in both CLI header and skill prose, hasWorkflowFiles non-workflow-yml limitation documented honestly; re-review clean.
- 2026-05-06 — phase 5: local CI green — npm test → 983/983 passing in 25.0s (+68 net tests for dvx105: 56 lib + 12 CLI passthrough; cartesian over 5 ProbeStates × happy/error paths + headSha pinning + boundary validation); cli lint placeholder echoes through; YOLO coverage informational only (no coverage runner wired for cli project per devx.config.yaml).
- 2026-05-06 — phase 7: PR https://github.com/LeoTheMighty/devx/pull/49 opened (head 8632961); body rendered via `devx pr-body` (no unresolved placeholders); awaiting remote CI.
- 2026-05-06 — phase 8: remote devx-ci green on head 8632961 (run 25458886184 — first dogfood: the awaitRemoteCi helper gated its own PR's merge, mirroring the prt102 pattern from PR #36); `devx merge-gate dvx105` returned `{"merge":true}` (exit 0); merged via PR #49 (squash → 7a802e0). Worktree force-removed; feat/dev-dvx105 deleted locally + remotely (`gh pr merge --delete-branch`). main fast-forwarded 2d0cb1c → 7a802e0.
