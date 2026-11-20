// Does a loop-driver test's declared timeout actually FIRE? (debug-5e1a77)
//
// This file is the adoption half of the spec. `test/exec-async-seam.test.ts`
// proves the SEAM can be interrupted; nothing there says the driver uses it.
// The measurement that opened this spec was taken here, in the driver: a
// `setInterval` armed inside a runLoop scenario ticked ZERO times across
// 14.1 seconds, because every git call underneath was `spawnSync` and a
// blocked event loop cannot run the timer that @vitest/runner races the test
// against. Sixteen tests ran past their own cap — one by 44x — and every one
// of them reported PASSED.
//
// Two independent proofs, because either alone is weak:
//
//   1. TICKS. Arm a 20ms interval, run a real merged item end to end, count
//      the ticks. Counting (not gap-measuring) is deliberate: a probe that
//      records only gaps > 250ms makes "never ran at all" look identical to
//      "no stalls" — that shape fooled iteration 2 first.
//   2. THE CAP ITSELF. An `it.fails` case that gives a real runLoop 100ms.
//      It passes only if vitest's timeout wins the race and the test is
//      interrupted; before adoption it would have run to completion in ~1s
//      and reported a false PASS, which `it.fails` scores as a FAILURE.
//
// WHY THE OVERRUN IS CAUSED, NOT HOPED FOR (2026-11-20 CI flake). This
// file used to rest the cap case on "no machine finishes this in 100ms". That
// was wrong twice over, and it.fails went red on ubuntu CI about half the time:
//
//   * vitest 2.1.9's withTimeout races `fn()` against a timer it arms only
//     after `fn()` RETURNS — i.e. at the body's first `await`. The fixture
//     build is not inside the cap at all.
//   * A timer can only fire in a timers phase, and a timers phase only runs
//     while runLoop is parked on an async child. On node 20 / Linux, measured
//     after the cap is armed: last timers phase at 70-92ms, runLoop resolved
//     at 91-131ms. The remainder is the post-merge bookkeeping on the sync
//     seam (`worktree remove`, then `pull --ff-only` and the backlog flips
//     under the lock), which runs to `merged` without yielding. So a 100ms cap fired only when the runner
//     happened to be slow enough. (The ~1.2s this file quoted was a macOS
//     wall-clock with the fixture included.)
//
// The fix makes the deadline pass BY CONSTRUCTION: the body yields once so the
// cap is armed first, and the scripted worker then HOLDS THE THREAD past the
// cap. It must block, not sleep — an awaited sleep would hand vitest the
// timers phase itself and the row would pass with the sync seam too. After the
// worker, the remaining per-iteration git traffic either yields (async seam:
// the overdue timer fires on its first child, every time) or it does not
// (`realExec`: zero timers phases, measured, so runLoop reaches `merged` and
// it.fails scores the false PASS). The clock no longer decides which.

import { rmSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { afterEach, describe, expect, it } from "vitest";

import { runLoop } from "../src/lib/loop/driver.js";
import {
  MERGED,
  makeFixture,
  mergedTail,
  scriptedWorker,
  type Fixture,
} from "./helpers/loop-git-fixture.js";

let fixture: Fixture | null = null;
/** Aborted in teardown: when the cap fires, the runLoop promise is abandoned
 *  mid-flight and its git children keep writing into the fixture. Removing
 *  the tree under a live writer is the ENOTEMPTY teardown race debug-74632d
 *  chased; signalling the loop to stop and letting it unwind first is the
 *  fix, and `maxRetries` is the belt-and-braces behind it. */
let stop: AbortController | null = null;

afterEach(async () => {
  stop?.abort();
  stop = null;
  await new Promise((r) => setTimeout(r, 300));
  if (fixture) {
    rmSync(fixture.base, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
  fixture = null;
});

/** Holds the thread for `ms` WITHOUT giving the event loop a turn — no timer
 *  can fire inside it, whatever the seam. Atomics.wait rather than a spin so
 *  it costs no CPU on a shared runner; looped because only the deadline, not
 *  one wait's return, is the contract. */
function blockThreadFor(ms: number): void {
  const cell = new Int32Array(new SharedArrayBuffer(4));
  const until = performance.now() + ms;
  for (let left = ms; left > 0; left = until - performance.now()) {
    Atomics.wait(cell, 0, 0, left);
  }
}

/** `workerBlocksMs` > 0 makes the worker step block for that long: every
 *  timer armed before it is overdue when the post-worker git traffic starts. */
function mergedItemOpts(fx: Fixture, signal: AbortSignal, workerBlocksMs = 0) {
  const { worker: scripted } = scriptedWorker([
    {
      kind: "report",
      files: { "a.txt": "a" },
      report: { summary: "did the thing", key_changes_made: ["a"], acs_met: true },
    },
  ]);
  const worker: typeof scripted =
    workerBlocksMs > 0
      ? (prompt, opts) => {
          blockThreadFor(workerBlocksMs);
          return scripted(prompt, opts);
        }
      : scripted;
  return {
    repoRoot: fx.repoRoot,
    merged: MERGED,
    out: () => {},
    heartbeatIntervalMs: 3_600_000,
    worker,
    tail: mergedTail().tail,
    signal,
  };
}

describe("a loop-driver test's declared timeout is enforceable (debug-5e1a77 AC 1/AC 2)", () => {
  it("the event loop gets ticks while runLoop drives real git", async () => {
    fixture = makeFixture([{ hash: "tik001" }]);
    stop = new AbortController();
    let ticks = 0;
    const timer = setInterval(() => {
      ticks++;
    }, 20);
    try {
      // Same construction as the cap case: the interval is overdue before the
      // post-worker git starts, so one yield there is one tick, guaranteed.
      const r = await runLoop(mergedItemOpts(fixture, stop.signal, 60));
      expect(r.summary!.items[0].outcome).toBe("merged");
    } finally {
      clearInterval(timer);
    }
    // Pre-adoption this was exactly 0 across a 14.1s run. Any positive count
    // is the whole claim; asserting a big number would just be asserting the
    // machine's speed.
    expect(ticks).toBeGreaterThan(0);
  });

  // The cap FIRES: without it, this body runs to a clean `merged` and
  // `it.fails` turns that success into a red test. Flip the seam back to
  // `realExec` in driver.ts and this is the row that goes red.
  const CAP_MS = 100;
  it.fails(
    "a runLoop that overruns a 100ms cap is INTERRUPTED, not silently passed",
    async () => {
      // Return to withTimeout now, so the cap is armed before the worker.
      await Promise.resolve();
      fixture = makeFixture([{ hash: "cap001" }]);
      stop = new AbortController();
      // `.catch`: a runLoop that THROWS must not read as "interrupted" — it.fails
      // would score any error green. Swallowed, it completes the body and goes
      // red; only the cap can pass this row.
      await runLoop(mergedItemOpts(fixture, stop.signal, 3 * CAP_MS)).catch(() => {});
    },
    CAP_MS,
  );

  it("the same scenario passes comfortably under a cap that fits it", async () => {
    fixture = makeFixture([{ hash: "cap002" }]);
    stop = new AbortController();
    const r = await runLoop(mergedItemOpts(fixture, stop.signal));
    expect(r.summary!.items[0].outcome).toBe("merged");
  }, 30_000);
});
