// The async exec seam and the false-green it exists to kill (debug-5e1a77 —
// src/lib/exec.ts). AC 1: "src/lib/exec.ts grows an async seam ... such that a
// test in the blocking set can be interrupted by its own timeout. Prove it
// with a test that deliberately overruns a small cap and FAILS."
//
// HOW THE PROOF IS SPELLED. A test that must fail cannot sit green in the
// suite, so the overrunning test is written with `it.fails` — vitest inverts
// the verdict, so the file stays green exactly WHEN the cap fires. `it.fails`
// alone would also pass if the body threw instantly for some unrelated reason,
// so a second, ordinary test asserts the shape of the interruption: the body
// started, and it never reached its own last line. Together those two say "the
// cap fired, mid-flight" and not merely "something went wrong".
//
// The sync half is asserted too, deliberately. `spawnSync` under a 200ms cap
// runs to completion and reports PASSED — that is the live fault, and it is
// pinned here so that the day the seam finishes migrating and the sync case
// starts being interruptible, this file goes red and someone rewrites the
// comment rather than quietly inheriting a stale claim.

import { describe, expect, it } from "vitest";

import { realExec, realExecAsync, type ExecAsync } from "../src/lib/exec.js";

/** Cap for the enforcement pair. Small enough to be obviously exceeded by the
 *  2s child, large enough that a cold fork's first spawn cannot trip it. */
const CAP_MS = 200;
/** Child runtime for the overrun half — 15x the cap. The child is abandoned
 *  at the cap and runs on in the background, so it overlaps the rest of the
 *  file rather than adding to it; the length buys margin on the "was it the
 *  cap that stopped this, or the child finishing?" question under load. */
const OVERRUN_S = "3";
/** Child runtime for the sync half, which is WAITED for — 10x the cap, and
 *  every millisecond of it is wall-clock this file pays. */
const BLOCK_S = "2";

describe("realExecAsync — parity with the sync seam", () => {
  it("captures stdout, stderr and a non-zero exit code", async () => {
    const args = ["-c", "echo out; echo err >&2; exit 3"];
    const sync = realExec("/bin/sh", args);
    const async_ = await realExecAsync("/bin/sh", args);
    expect(async_).toEqual(sync);
    expect(async_).toEqual({ stdout: "out\n", stderr: "err\n", exitCode: 3 });
  });

  it("merges env over process.env rather than replacing it", async () => {
    // PATH comes from process.env; DEVX_SEAM_PROBE from the caller. If the
    // merge were a replacement, the `sh` lookup or the echo would come back
    // empty.
    const r = await realExecAsync("/bin/sh", ["-c", 'echo "$DEVX_SEAM_PROBE:${PATH:+has-path}"'], {
      env: { DEVX_SEAM_PROBE: "seam" },
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("seam:has-path");
  });

  it("honours cwd", async () => {
    const r = await realExecAsync("/bin/sh", ["-c", "pwd"], { cwd: "/" });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("/");
  });

  it("resolves 127 with the reason in stderr when the binary is missing", async () => {
    const r = await realExecAsync("devx-no-such-binary-5e1a77", ["--version"]);
    expect(r.exitCode).toBe(127);
    expect(r.stderr).not.toBe("");
    expect(realExec("devx-no-such-binary-5e1a77", ["--version"]).exitCode).toBe(127);
  });

  it("reports a signal kill as 127 rather than a success", async () => {
    const r = await realExecAsync("/bin/sh", ["-c", "kill -TERM $$"]);
    expect(r.exitCode).toBe(127);
    expect(r.stderr).toContain("SIGTERM");
  });

  it("does not hang on a child that reads stdin", async () => {
    // stdin is `ignore`, so `cat` sees EOF immediately. An open pipe here
    // would wait for a parent write that never comes.
    const r = await realExecAsync("cat", []);
    expect(r).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  });

  it("kills the child and reports 127 rather than truncating past maxBuffer", async () => {
    // 70MB against the 64MB ceiling. Silent truncation is the failure this
    // guards: `spawnSync`'s 1MB default once ate the tail of a large `gh` JSON
    // payload, which is why both seams carry a raised, explicit ceiling.
    const r = await realExecAsync("/bin/sh", ["-c", "yes 0123456789 | head -c 70000000"]);
    expect(r.exitCode).toBe(127);
    expect(r.stderr).toContain("exceeded maxBuffer");
  });

  it("satisfies the ExecAsync type", () => {
    const seam: ExecAsync = realExecAsync;
    expect(typeof seam).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// The enforcement proof
// ---------------------------------------------------------------------------

describe("a declared cap can actually fire (AC 1)", () => {
  let started = 0;
  let completed = 0;

  it.fails(
    `overruns its own ${CAP_MS}ms cap through the async seam and FAILS`,
    async () => {
      started = Date.now();
      await realExecAsync("sleep", [OVERRUN_S]);
      // Reached only if the cap never fired — which is the bug.
      completed = Date.now();
    },
    CAP_MS,
  );

  it("the overrun was interrupted mid-flight, not merely thrown", () => {
    // Tests in a file run in order, so this observes the state the previous
    // one was abandoned in.
    expect(started).toBeGreaterThan(0);
    expect(completed).toBe(0);
    // ...and the abandonment happened at the cap, not after the child's 2s.
    expect(Date.now() - started).toBeLessThan(Number(OVERRUN_S) * 1000);
  });
});

describe("the sync seam's cap cannot fire — the false green (debug-5e1a77)", () => {
  it(
    `runs ${BLOCK_S}s under a ${CAP_MS}ms cap and reports PASSED`,
    () => {
      const t0 = Date.now();
      realExec("sleep", [BLOCK_S]);
      const elapsed = Date.now() - t0;
      // This assertion running at all is the finding: the test is past its
      // cap by an order of magnitude and vitest has not stopped it, because a
      // spawnSync-blocked event loop never got a tick to run the timer that
      // vitest's timeout races against.
      expect(elapsed).toBeGreaterThan(CAP_MS * 5);
    },
    CAP_MS,
  );
});
