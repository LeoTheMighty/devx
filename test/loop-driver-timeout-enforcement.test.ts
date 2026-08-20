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
// A word on the 100ms, and on why the number is small rather than close: an
// `it.fails` case inverts the usual flake direction — it goes red if the body
// SUCCEEDS, so headroom means a SHORTER cap, not a longer one. The item's
// claim alone does `git worktree add` plus a push against a real bare origin,
// which no machine finishes in 100ms; the body measures ~1.2s here and CI is
// not 12x this box. The margin is structural, not a race with the clock.

import { rmSync } from "node:fs";
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

function mergedItemOpts(fx: Fixture, signal: AbortSignal) {
  const { worker } = scriptedWorker([
    {
      kind: "report",
      files: { "a.txt": "a" },
      report: { summary: "did the thing", key_changes_made: ["a"], acs_met: true },
    },
  ]);
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
      const r = await runLoop(mergedItemOpts(fixture, stop.signal));
      expect(r.summary!.items[0].outcome).toBe("merged");
    } finally {
      clearInterval(timer);
    }
    // Pre-adoption this was exactly 0 across a 14.1s run. Any positive count
    // is the whole claim; asserting a big number would just be asserting the
    // machine's speed.
    expect(ticks).toBeGreaterThan(0);
  });

  // The cap FIRES: without it, this body runs ~1.2s to a clean `merged` and
  // `it.fails` turns that success into a red test. Flip the seam back to
  // `realExec` in driver.ts and this is the row that goes red.
  it.fails(
    "a runLoop that overruns a 100ms cap is INTERRUPTED, not silently passed",
    async () => {
      fixture = makeFixture([{ hash: "cap001" }]);
      stop = new AbortController();
      await runLoop(mergedItemOpts(fixture, stop.signal));
    },
    100,
  );

  it("the same scenario passes comfortably under a cap that fits it", async () => {
    fixture = makeFixture([{ hash: "cap002" }]);
    stop = new AbortController();
    const r = await runLoop(mergedItemOpts(fixture, stop.signal));
    expect(r.summary!.items[0].outcome).toBe("merged");
  }, 30_000);
});
