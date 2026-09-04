---
gate: PASS
status_reason: 'All 24 source IDs fully covered in design mode.'
reviewer: 'devx gate coverage (design mode)'
updated: 2026-07-28
waiver: { active: false, approver: null, reason: null }
---

# Verify — _devx/workstreams/multi-loop-concurrency — 2026-07-28

## Subject

`design.md` reviewed against `prd.md` (design mode; workstream `20eb6f`).

## Coverage

| ID | Status | Where covered | Note |
|---|---|---|---|
| G-1 | ✅ | Design §Test architecture (the G-1 harness) | Two in-process runLoop calls via RunLoopOpts seams (driver.ts:154-183) over one tmpdir fixture, seeded interleavings (>=3), serial-baseline comparison, vitest-run — CI-runnable is literal. |
| G-2 | ✅ | Design §Architecture 5 (instance registry) + Risks (next/status drift, first-real-run rule) + Wrap (report.ts scope header) | Registry, next/status aggregation, per-instance report header, and a pre-merge live-run check are all named; E-7 remains a human eval as PRD intended. |
| G-3 | ✅ | Design §Architecture 4 (spec-lock lifecycle) | Dead-PID/recycled-PID reap at claim time is designed, legacy bodies classified via pid= line, and the stale spec-494590.lock case is called out explicitly. |
| UC-1 | ✅ | Design §Architecture 2, 5, 6 | Backlog lock guarantees exactly-once flips, registry surfaces both runs in devx next, --epic scoping designed end-to-end. |
| UC-2 | ✅ | Design §Architecture 6 (scope model) | --items restricts to listed hashes, overrides pick order to list order, and out-of-list blockers are reported via event + morning-report line with the blocking hash named. |
| UC-3 | ✅ | Design §Architecture 6 + §Interfaces | --focus appended verbatim to buildIterationPrompt (iteration.ts:327-358) as a Specialty directive; flags compose with existing --only. |
| UC-4 | ✅ | Design §Architecture 3 + Risks (mutual-starvation bullet) | Lock-aware picking, O_EXCL winner-takes-item, loser masks-and-advances without touching consecutiveClaimFailures; starvation risk explicitly analyzed. |
| UC-5 | ✅ | Design §Architecture 4 + 5 | Dead-owner spec locks reaped at next claim; crash-orphaned instances age out via freshness + PID classify and are reaped at next loop start, mirroring recoverStaleLoopState. |
| UC-6 | ✅ | Design §Risks (attended-sessions bullet) + §Architecture 5 | Interactive /devx inherits the discipline because claim/release/backlog writes live in the shared CLI primitives; row-1 loops array lists every live instance with scope. |
| CAP-1 | ✅ | Design §Architecture 1 (canonical root) | resolveRepoRoot via git-common-dir, worktree refusal at loop/manage entry points (loop.ts:57, manage.ts:100,126), explicit cacheDir plumbed down. |
| CAP-2 | ✅ | Design §Architecture 2 (backlog mutation lock) | withBacklogLock enumerates every mutator with code anchors (claim.ts, driver.ts, manage/loop.ts, gate) including paired main-checkout git ops. |
| CAP-3 | ✅ | Design §Architecture 3 (claim contention) | Rebase-retry, ClaimContendedError distinct from failure budget, pickNextItem masks live-held locks up front. |
| CAP-4 | ✅ | Design §Architecture 4 + Resolved design questions | JSON lock body with liveness metadata, mgr106 classifier extracted to src/lib/locks/classify.ts, release re-verifies session under backlog lock; dead-owner reap fully designed. |
| CAP-5 | ✅ | Design §Architecture 5 + §Data | Per-run lock + instance JSON with heartbeats, capacity.max_concurrent admission with live-count check, next/status aggregation, session-keyed scratch with mirror-pair skill edit. |
| CAP-6 | ✅ | Design §Architecture 6 (scope model) | buildScopeMask over the existing mask-to-blocked mechanism, epic stamping in parseDevMd, scope recorded in instance file + report header + next row 1. |
| CAP-7 | ✅ | Overview §Objective + Trade-offs (runtime arbitration bullet) | Scope only masks; the spec lock is the sole authority on ownership, so all safety mechanisms hold with zero or fully overlapping scopes — a structural property, not an aspiration. |
| FR-1 | ✅ | Design §Architecture 1 | Common-dir resolution, refusal naming the main checkout root, --allow-worktree-root test override, manage's explicit cacheDir — all four FR clauses land with code anchors. |
| FR-2 | ✅ | Design §Architecture 2 | All named call sites moved inside the lock; writeFileSync-to-writeAtomic conversions and the 30s timeout with holder-pid diagnostic all present. |
| FR-3 | ✅ | Design §Architecture 3 | Bounded rebase retries (<=2), claim-contended event path split from claim-failed (driver.ts:566-591), pick-time masking, finalize pull --ff-only fetch+retry — every FR clause has a mechanism. |
| FR-4 | ✅ | Design §Architecture 4 + Resolved design questions; prd.md FR-4 (updated) | Pair aligned: FR-4 specifies WARN + doctor --fix for live-PID owners with auto-reap strictly PID-liveness-based (supersession recorded); design implements exactly that. No remaining deviation. |
| FR-5 | ✅ | Design §Architecture 5 + §Data + Resolved design questions | Registry, admission, aggregation, scratch namespacing designed; the FR's legacy dual-write sketch replaced by read-fallback — explicit, reasoned refinement preserving the no-external-breakage intent. |
| FR-6 | ✅ | Design §Architecture 6 + §Interfaces | All five flags, epic-heading stamping (additive DevRow fields), mask-to-blocked preserving cross-scope Blocked-by edges, out-of-list blocker reporting, scope surfacing; composition with --only stated. |
| FR-7 | ✅ | Constraints (N=1 back-compat bullet) + Migration plan | Hard constraint plus migration section enumerating the only permitted (mechanical) test churn; all mechanisms additive so bare devx loop needs no flag. |
| FR-8 | ✅ | Migration plan + §Data | Legacy lock bodies classified via pid= line, state.json read-fallback, fixed-name scratch removed by 7-day reap, db36af doctor coordination named; old-binary-races-new-binary documented as unsupported. |

## Extras requiring product approval

- Exit code 4 with fail-fast scope-flag validation against the parsed backlog (unknown epic slug, bad hash shape) — PRD never specifies scope-flag validation or a distinct exit code — §Interfaces (CLI bullet)
- Retention/reap policies invented at design time: stopped instance files kept 24h then reaped at next run start; scratch directories reaped after 7 days — §Data (loop/instances and scratch bullets)
- Live-PID spec locks older than 2h surface as a WARN row in devx next drift (a new next-surface behavior) — §Architecture 4

## Verdict detail

PASS — every source ID is ✅ covered.
