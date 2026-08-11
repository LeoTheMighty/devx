// Pass 2 of `npm test` — only the sync-blocking files, at low concurrency.
//
// Capping forks is the point of this file. Each of these processes holds its
// core for the whole of every spawnSync git call, so running all of them at
// once is what saturates the box and starves pass 1's timers.
//
// The number is 2, chosen by measurement rather than by matching CI's core
// count. On a 12-core macOS box, 2026-08-11, over this same 26-file set:
//
//   maxForks: 2 → 1,024s, 2 failures
//   maxForks: 4 → 1,053s, 3 failures
//
// Raising it buys no wall-clock and costs correctness, because this pass's
// duration is intrinsic to the files (loop-driver.test.ts alone is 561s in
// isolation) rather than scheduling-bound. The residual failures are all in
// manage-spawn-integration.test.ts, which is BOTH a blocker and an
// async-waiting victim — it starves itself, so no partition can rescue it.
// That one needs the exec-seam fix.
//
// Honest cost: `npm test` is now ~23s (pass 1) + ~1,024s (pass 2) ≈ 1,048s
// against 947s for the old undivided run — a ~10% wall-clock regression
// bought in exchange for restoring the gate's signal across 110 of 136 files.
// The regression goes away with the exec-seam fix, which is what makes these
// files stop blocking in the first place.
//
// It is NOT a timeout widening: no cap changes here. Fault (2) from
// vitest.shared.ts — a blocked loop cannot fire its own timeout, so these
// files still contain unenforceable caps — is the exec-seam mechanism fix
// (debug-ecdcda / debug-620337), not this partition.
//
// Spec: debug/debug-7c1e93-2026-08-04T10:45-loop-concurrency-suite-load-timeout.md

import { defineConfig } from "vitest/config";

import { SYNC_BLOCKING_TESTS, baseTest } from "./vitest.shared.js";

export default defineConfig({
  test: {
    ...baseTest,
    include: [...SYNC_BLOCKING_TESTS],
    exclude: ["**/node_modules/**"],
    pool: "forks",
    poolOptions: { forks: { minForks: 1, maxForks: 2 } },
  },
});
