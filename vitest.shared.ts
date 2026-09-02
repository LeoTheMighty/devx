// Shared vitest wiring: the base `test` block and the sync-blocking test
// partition (debug-7c1e93).
//
// WHY THE PARTITION EXISTS
//
// `realExec` (src/lib/exec.ts) is `spawnSync`, so every real-git call a test
// makes blocks that test process's event loop for its full duration. Vitest
// runs one process per file (`pool: 'forks'`), so this produces two distinct
// faults — measured 2026-08-07 on a 12-core macOS box against the same suite
// CI runs green in 32s (ubuntu) / 98s (macOS):
//
//   1. Cross-process CPU starvation. ~11 concurrent sync-blocking file
//      processes saturate the cores, so genuinely-ASYNC tests elsewhere miss
//      their deadlines and fail exactly on their cap (5.0s / 15.0s / 30.0s).
//      Full suite: 4 files / 25 tests red, 947s. The same files pass 55/55 in
//      19s when run alone. Capping workers to CI's 4 did NOT help (12 still
//      red, 936s) — with every worker blocking, 4 blockers saturate as
//      effectively as 11.
//
//   2. Unenforceable timeouts inside a blocking file. A blocked loop cannot
//      run its own timeout callback, so `loop-driver`'s slowest test ran
//      233.8s under the 5,000ms default and REPORTED PASSED (12.5s even in
//      isolation). That is a false green, and no measured cap can fix it
//      while the loop is blocked.
//
// This file addresses (1) only: run the blockers in their own low-concurrency
// pass so they never compete with the async-sensitive majority. Fault (2) is
// the mechanism fix — making the exec seam async (debug-ecdcda / debug-620337)
// — after which measured caps (debug-5c8b21) become enforceable and therefore
// meaningful.
//
// STATUS OF FAULT (2), 2026-08-20 (debug-5e1a77). The async seam EXISTS —
// `realExecAsync` in src/lib/exec.ts — and it is now ADOPTED by the loop
// driver, which was the whole of the over-cap population. `git-tx.ts` takes
// an `ExecLike` (`Exec | ExecAsync`) and awaits internally, `driver.ts`
// defaults to `realExecAsync`, and `preflight.ts` follows. The migration cost
// no test fake anything: `await` on a non-promise is a no-op, so every
// synchronous fake injected through `opts.exec` still works verbatim.
//
// `test/loop-driver-timeout-enforcement.test.ts` is the proof, and it is
// negative-controlled — flipping that one default back to `realExec` turns
// the file red twice over: the tick counter reads exactly 0 (as it did before
// adoption) and the 150ms-cap case runs to a clean `merged`, which `it.fails`
// scores as the false PASS it is.
//
// TWO CALL SITES DELIBERATELY STAY SYNCHRONOUS, and they are not oversights:
//   * anything held under `withBacklogLock`. That lock acquires and releases
//     around a SYNCHRONOUS callback, so awaiting inside it would release the
//     lock while the child is still running — the lost-update race the lock
//     exists to prevent. The driver keeps an `execSync` seam for exactly
//     this main-worktree bookkeeping.
//   * `claimSpec` and the merge tail (`tail.ts`, and `withGhRetry` /
//     `checkHold` under it, which back off with a busy-wait sleep). Both are
//     once-per-item, not per-iteration; their cost is remote latency, not
//     spawn blocking. Moving them is follow-up work, not this fix.
//
// Membership below is unchanged and stays MECHANICAL: a file belongs here iff
// it references a synchronous child-process API. Several of these files no
// longer block for long, but they still block.
//
// FAULT (2), MEASURED DIRECTLY (debug-5e1a77 iteration 2). The mechanism was
// inferred until now; it is confirmed. `test/loop-driver.test.ts`'s LOW-11
// scenario, run alone under the 5,000ms default cap: 14.1s wall, PASSED, and
// a `setInterval(fn, 50)` armed inside the test body ticked **zero** times.
// The loop is not merely slow, it is held for 100% of the test. 13.7s of that
// 14.1s was inside the injected exec seam and 12.9s inside two `git push`
// calls. Vitest makes this strictly worse than it has to be: `withTimeout`
// (@vitest/runner) `unref()`s the timer in its `Promise.race`, so even a
// briefly-idle loop is not guaranteed to service it.
//
// FAULT (2)'S NEIGHBOUR, AND THE BIGGER NUMBER (debug-5e1a77 iteration 3).
// Most of this pass's wall-clock was never the blocking at all — it was PATH
// resolution. A bare `"git"` makes libuv hand the lookup to `execvp` in the
// child, and on macOS a FAILED `execve` attempt costs ~5.6ms, so a spawn costs
// ~5.6ms per PATH entry that misses. On a dev box with 26 entries ahead of
// `/usr/bin` that is ~150ms on EVERY git call, against ~11ms for the same
// command named absolutely — identical for sync and async spawns, so it is
// exec-attempt cost and not a `spawnSync` artifact. Invisible from a shell,
// whose hash table already holds the answer. `resolveCommandPath`
// (src/lib/exec.ts) now resolves once inside both seams, and
// `test/helpers/git-bin.ts` does the same for fixtures that drive git
// directly. Measured on loop-driver's `runLoop scenarios` block (19 tests,
// real git): 141-149s → 46s (seam) → 15.2-16.4s (fixtures too) — 9.2x, twice,
// same tests, no assertion touched.
//
// WHEN A NUMBER HERE LOOKS INSANE, SUSPECT THE MACHINE FIRST. Two consecutive
// runs of the unchanged loop-driver.test.ts at the same commit measured 674s
// and 172s, the difference being a single test that took 501s at ~0% CPU. That
// is macOS sleeping mid-run, not code (see the same trap in `devx loop`
// iteration accounting). Iteration 2's "severe and unexplained within-file
// amplification" was this. Re-measure before diagnosing.
//
// The other half of those numbers is not devx code at all: on macOS a `git`
// command that has to exec a hook FILE THE TEST WROTE pays a security
// assessment — 3.5s the first time in a worker, ~0.5s every time after,
// against 52ms for the same push with no hook. See test/helpers/git-hooks.ts
// for the measurements and for the cheap (symlinked system binary) form.
//
// Membership is MECHANICAL, not a timing snapshot: a file belongs here iff it
// references a synchronous child-process API. `test/vitest-split.test.ts`
// pins the list against the tree so a new sync-blocking file cannot silently
// join the parallel pass and reintroduce the starvation.
//
// Spec: debug/debug-7c1e93-2026-08-04T10:45-loop-concurrency-suite-load-timeout.md

import { loadValidatedConfig } from "./src/lib/config-validate.js";

const config = loadValidatedConfig() as {
  coverage?: { threshold?: number; enabled?: boolean };
};
const thresholdFraction = config.coverage?.threshold ?? 0;
const thresholdPct = Math.round(thresholdFraction * 100);

/**
 * A SYNCHRONOUS child-process call site. Anchored on the punctuation that
 * follows a real use (`(`, `,`, `)`, `}`) so a prose mention in a comment —
 * or an `import { spawn } from "node:child_process"` for ASYNC spawning,
 * which does not block — is not mistaken for one. Async spawners are the
 * VICTIMS of this fault, not its cause; they belong in the parallel pass.
 */
export const SYNC_EXEC_MARKER =
  /\b(spawnSync|execSync|execFileSync|realExec)\b\s*[(,)}]/;

/**
 * Shared test-module directories. A module here is a purpose-built fixture
 * that DOES run its sync paths, so importing one counts as blocking.
 *
 * Resolution is ONE hop and these directories only. Following arbitrary local
 * imports transitively selected 86 of ~110 files — importing a module is not
 * executing its sync branch. `test/fixtures/` carries no sync exec today, but
 * it is scanned anyway: the pin has to fail when someone adds one, not after
 * the starvation it causes is diagnosed a second time.
 */
export const HELPER_DIRS = ["test/helpers", "test/fixtures"] as const;

/**
 * Test files that drive synchronous child processes (directly or through a
 * helper that does). They run in their own low-concurrency pass.
 *
 * Keep sorted; `test/vitest-split.test.ts` asserts this equals the set of
 * `test/**\/*.test.ts` files matching SYNC_EXEC_MARKER, transitively through
 * local helper imports.
 */
export const SYNC_BLOCKING_TESTS = [
  "test/claim-contention.test.ts",
  "test/cli.test.ts",
  "test/devx-claim.test.ts",
  "test/devx-finalize-real-git.test.ts",
  "test/eject-noop.test.ts",
  "test/engine-layout-migrate-refusals.test.ts",
  "test/engine-layout-migrate.test.ts",
  "test/engine-layout-no-hand-joins.test.ts",
  "test/engine-layout-scaffold.test.ts",
  "test/engine-workstream.test.ts",
  "test/exec-async-seam.test.ts",
  "test/graph-cli.test.ts",
  "test/graph-regen.test.ts",
  "test/init-cli-scaffold.test.ts",
  "test/init-e2e.test.ts",
  "test/learn-watch.test.ts",
  "test/loop-chaos.test.ts",
  "test/loop-instance-orphan-and-status.test.ts",
  "test/loop-concurrency.test.ts",
  "test/loop-driver-timeout-enforcement.test.ts",
  "test/loop-driver.test.ts",
  "test/loop-git-tx.test.ts",
  "test/loop-graph-freshness.test.ts",
  "test/loop-instances.test.ts",
  "test/loop-iteration.test.ts",
  "test/loop-preflight.test.ts",
  "test/manage-loop.test.ts",
  "test/manage-spawn-cli-e2e.test.ts",
  "test/manage-tick-canonical-state.test.ts",
  "test/outline-check-git.test.ts",
  "test/postinstall.test.ts",
  "test/repo-root.test.ts",
  "test/skills-packaging.test.ts",
  "test/skills-sync.test.ts",
  "test/spec-lock.test.ts",
  "test/stub.test.ts",
  "test/test-results-capture.test.ts",
  "test/worktree-refusal.test.ts",
] as const;

/** The `test` block every config shares. Coverage stays sourced from
 *  devx.config.yaml via the cfg203 validator (informational at YOLO). */
/**
 * Where each pass writes its machine-readable result (b7f2c1 AC 3).
 *
 * A ~50-minute gate could lose its own failure evidence. Vitest's default
 * reporter prints failure DETAIL above the summary, so any capture that
 * retains a tail keeps the summary and drops the diagnosis: on 2026-07-29
 * the only surviving record of a red run was four lines saying
 * `1 failed | 2664 passed` with no test name, and disproving it cost a
 * 52-minute re-run. The name was eventually recovered from CI, not from the
 * local capture.
 *
 * The json reporter runs ALONGSIDE the human one and writes a file, so the
 * failing test's name and error survive regardless of how the caller
 * captured stdout — `| tail`, a truncated buffer, a dropped connection.
 * Under `.devx-cache/` because it is gitignored and is already where every
 * other durable run artifact lives.
 */
export function resultsPath(pass: string): string {
  return `.devx-cache/test-results/${pass}.json`;
}

export const baseTest = {
  include: ["test/**/*.test.ts"],
  // Source-line tags on every task. `scripts/timeout-headroom.mjs`
  // (debug-5c8b21 AC 3) joins a runtime test to its source-DECLARED timeout on
  // (file, line) — vitest 2.x bakes a per-test cap into the wrapped handler
  // and never stores it on the task, so there is nothing for a reporter to
  // read. There is no CLI flag for this and it costs a stack capture per
  // test, so it turns on only for a sweep run.
  includeTaskLocation: process.env.DEVX_HEADROOM_OUT != null,
  // cfg202/cfg203 ship their own zero-dep tsx-runner test files; vitest
  // would discover them but find no `describe`/`it` and fail. Skip them
  // here — they're invoked directly by the `test:config-*` npm scripts.
  exclude: [
    "**/node_modules/**",
    "test/config-io.test.ts",
    "test/config-validate.test.ts",
  ],
  coverage: {
    provider: "v8" as const,
    reporter: ["text", "lcov"] as string[],
    thresholds: {
      lines: thresholdPct,
      functions: thresholdPct,
      branches: thresholdPct,
      statements: thresholdPct,
    },
  },
};
