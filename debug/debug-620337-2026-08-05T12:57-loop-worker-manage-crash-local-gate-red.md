---
hash: 620337
type: debug
created: 2026-08-05T12:57:00-06:00
title: "loop-worker + manage-crash-restart-loop fail reproducibly in a linked worktree — every /devx Phase 5 gate is red before it starts"
from: sgr105
status: ready
---

## Goal

`npm test` run from an agent worktree reds on ~16-24 tests in
`test/loop-worker.test.ts` + `test/manage-crash-restart-loop.test.ts`,
independent of the branch's changes. Phase 5's "local CI must pass" gate
therefore cannot be satisfied by any story, and the standing red trains
agents to wave failures through — which is how a real regression eventually
ships unnoticed.

## Repro (run, confirmed)

Measured 2026-08-05 from `.worktrees/dev-sgr105` (sgr105's branch) and from
`.worktrees/sgr105-baseline` (a detached worktree at `70151a7`, the commit
sgr105 branched from — `src/lib/devx/mark-done.ts` does not exist there):

```
npx vitest run test/loop-worker.test.ts test/manage-crash-restart-loop.test.ts
```

| tree | result |
|---|---|
| sgr105 branch | 18 failed / 10 passed (28) |
| baseline `70151a7` | 16 failed / 12 passed (28) |

Same files, same signatures, with and without the story's code — so this is
NOT sgr105. The 16-vs-18 spread is run-to-run variance in the same
timing-sensitive set, not a delta attributable to a diff.

Also seen in the full `npm test` on the sgr105 branch: 24 failed / 3119
passed (135 files), duration 1772s wall / 3387s test-time.

## Signatures

- `AssertionError: expected 0 to be greater than or equal to 100`
  (`loop-worker.test.ts:358`) — the spawned child ran
  `process.stdout.write("x".repeat(400))` and the harness captured nothing.
- `WorkerTimeoutError: worker session exceeded the 0min awake-time iteration
  ceiling and was killed (120min of machine sleep detected and excluded)` —
  a ceiling that computed to zero minutes.
- `Error: Test timed out in 30000ms` — `mgr105` plain-crash respawn cycle.

Both files spawn real subprocesses (`process.execPath` with inline `-e`
scripts in loop-worker; a stub `claude` in manage-crash-restart-loop), so
the failures are about process/timing, not module resolution — the
node_modules-walk hypothesis is ruled out (a linked worktree under this repo
resolves fine via the parent checkout; a worktree under `/tmp` does not, and
that is a separate trap worth knowing).

## Acceptance criteria

- [ ] AC 1: Root-cause why the captured stdout is empty and why the awake-time
      ceiling computes to 0min — with evidence, not a timeout bump.
- [ ] AC 2: Both files pass reproducibly from an agent worktree at whatever
      load a normal multi-session day produces.
- [ ] AC 3: `npm test` from a worktree is green on an unmodified checkout —
      the precondition for Phase 5's gate meaning anything.
- [ ] AC 4: If the cause is genuinely environmental (host timing, concurrent
      sessions), the tests declare that themselves — skip with a named reason
      rather than fail — so a red gate stays a real signal.

## Technical notes

- CI on `main` is green over the same period (`gh run list --branch main`),
  so this is local/worktree-specific; that gap is itself the risk, because
  Phase 5 exists precisely to catch things before CI.
- Related but distinct: `debug-5c8b21` (loop-concurrency within 2x of its
  timeout, marginal under load), `debug-b7f2c1` (loop-driver ENOTEMPTY
  teardown flake). This one is worse than either — it reproduces at baseline
  with the files run alone.
- `LEARN.md § Cross-epic patterns` "attended-era contracts break on first
  unattended contact" is the neighbourhood: these suites model the
  unattended loop, and they are the ones that don't survive an ordinary
  developer machine.

## Status log

- 2026-08-05T12:57 — filed from sgr105 Phase 5 (local gate red; bisected to
  baseline and confirmed pre-existing).
