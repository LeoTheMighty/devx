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
  "test/eject-noop.test.ts",
  "test/engine-workstream.test.ts",
  "test/graph-cli.test.ts",
  "test/graph-regen.test.ts",
  "test/init-cli-scaffold.test.ts",
  "test/init-e2e.test.ts",
  "test/learn-watch.test.ts",
  "test/loop-chaos.test.ts",
  "test/loop-concurrency.test.ts",
  "test/loop-driver.test.ts",
  "test/loop-git-tx.test.ts",
  "test/loop-instances.test.ts",
  "test/loop-iteration.test.ts",
  "test/loop-preflight.test.ts",
  "test/manage-loop.test.ts",
  "test/manage-spawn-cli-e2e.test.ts",
  "test/postinstall.test.ts",
  "test/repo-root.test.ts",
  "test/skills-packaging.test.ts",
  "test/skills-sync.test.ts",
  "test/spec-lock.test.ts",
  "test/stub.test.ts",
  "test/worktree-refusal.test.ts",
] as const;

/** The `test` block every config shares. Coverage stays sourced from
 *  devx.config.yaml via the cfg203 validator (informational at YOLO). */
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
