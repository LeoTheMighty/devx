// Tests for mgr105 on-exit handler + applyExitToState helper:
//   - on success (code === 0): clears any prior crash record for the spec.
//   - on failure: increments crash_count, sets last_exit_at + last_exit_code.
//   - synthetic "manager-restart-detected" string code path.
//   - signal-terminated child path: last_exit_code = `signal:<NAME>`.
//
// Tests use applyExitToState directly (pure-of-spawn) so we don't need a
// real child process. The integration test in
// manage-crash-restart-loop.test.ts exercises the full child.on('exit') wire.

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyExitToState } from "../src/lib/manage/spawn.js";
import {
  type CrashRecord,
  readManagerState,
  writeManagerState,
} from "../src/lib/manage/state.js";

let tmpRoot: string;
let cacheDir: string;

const T0 = new Date("2026-05-07T12:00:00.000Z");

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "devx-mgr105-spawn-"));
  cacheDir = join(tmpRoot, ".devx-cache");
  mkdirSync(cacheDir, { recursive: true });
});
afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("applyExitToState (mgr105 — success path)", () => {
  it("clears the roster slot AND any prior crash record on code===0", () => {
    writeManagerState(cacheDir, {
      generation: 1,
      roster: [
        {
          pid: 9001,
          spec_hash: "h1",
          started_at: T0.toISOString(),
          crash_count: 0,
          worker_class: "dev",
        },
      ],
      crashes: [
        {
          spec_hash: "h1",
          crash_count: 3,
          last_exit_at: T0.toISOString(),
          last_exit_code: 42,
        },
      ],
    });
    applyExitToState(cacheDir, "h1", 0, null, () => T0);
    const s = readManagerState(cacheDir);
    expect(s.roster).toEqual([]);
    expect(s.crashes).toBeUndefined();
  });

  it("only clears the matching spec's crash record; leaves other specs alone", () => {
    writeManagerState(cacheDir, {
      generation: 1,
      roster: [
        {
          pid: 9001,
          spec_hash: "h1",
          started_at: T0.toISOString(),
          crash_count: 0,
          worker_class: "dev",
        },
      ],
      crashes: [
        {
          spec_hash: "h1",
          crash_count: 3,
          last_exit_at: T0.toISOString(),
          last_exit_code: 42,
        },
        {
          spec_hash: "h2",
          crash_count: 1,
          last_exit_at: T0.toISOString(),
          last_exit_code: 7,
        },
      ],
    });
    applyExitToState(cacheDir, "h1", 0, null, () => T0);
    const s = readManagerState(cacheDir);
    expect(s.crashes).toHaveLength(1);
    expect(s.crashes![0].spec_hash).toBe("h2");
  });
});

describe("applyExitToState (mgr105 — crash path)", () => {
  it("increments crash_count + records last_exit_at + last_exit_code on non-zero", () => {
    writeManagerState(cacheDir, {
      generation: 1,
      roster: [
        {
          pid: 9001,
          spec_hash: "h1",
          started_at: T0.toISOString(),
          crash_count: 0,
          worker_class: "dev",
        },
      ],
    });
    const exitAt = new Date("2026-05-07T12:01:30.000Z");
    applyExitToState(cacheDir, "h1", 42, null, () => exitAt);
    const s = readManagerState(cacheDir);
    expect(s.roster).toEqual([]);
    expect(s.crashes).toEqual<CrashRecord[]>([
      {
        spec_hash: "h1",
        crash_count: 1,
        last_exit_at: exitAt.toISOString(),
        last_exit_code: 42,
      },
    ]);
  });

  it("increments crash_count cumulatively across multiple crashes", () => {
    // Crash 1.
    writeManagerState(cacheDir, {
      generation: 1,
      roster: [
        {
          pid: 1,
          spec_hash: "h1",
          started_at: T0.toISOString(),
          crash_count: 0,
        },
      ],
    });
    applyExitToState(cacheDir, "h1", 1, null, () => T0);
    // Crash 2.
    writeManagerState(cacheDir, {
      ...readManagerState(cacheDir),
      roster: [
        {
          pid: 2,
          spec_hash: "h1",
          started_at: T0.toISOString(),
          crash_count: 0,
        },
      ],
    });
    applyExitToState(cacheDir, "h1", 2, null, () => T0);
    // Crash 3.
    writeManagerState(cacheDir, {
      ...readManagerState(cacheDir),
      roster: [
        {
          pid: 3,
          spec_hash: "h1",
          started_at: T0.toISOString(),
          crash_count: 0,
        },
      ],
    });
    applyExitToState(cacheDir, "h1", 3, null, () => T0);

    const s = readManagerState(cacheDir);
    expect(s.crashes).toHaveLength(1);
    expect(s.crashes![0].crash_count).toBe(3);
    expect(s.crashes![0].last_exit_code).toBe(3); // most recent
  });

  it("renders signal-terminated child as `signal:<NAME>` string", () => {
    writeManagerState(cacheDir, {
      generation: 1,
      roster: [
        {
          pid: 9001,
          spec_hash: "h1",
          started_at: T0.toISOString(),
          crash_count: 0,
        },
      ],
    });
    applyExitToState(cacheDir, "h1", null, "SIGKILL", () => T0);
    const s = readManagerState(cacheDir);
    expect(s.crashes![0].last_exit_code).toBe("signal:SIGKILL");
  });

  it("preserves a string `manager-restart-detected` synthetic code verbatim", () => {
    writeManagerState(cacheDir, {
      generation: 1,
      roster: [
        {
          pid: 9001,
          spec_hash: "h1",
          started_at: T0.toISOString(),
          crash_count: 2,
        },
      ],
      crashes: [
        {
          spec_hash: "h1",
          crash_count: 2,
          last_exit_at: T0.toISOString(),
          last_exit_code: 1,
        },
      ],
    });
    applyExitToState(
      cacheDir,
      "h1",
      "manager-restart-detected",
      null,
      () => T0,
    );
    const s = readManagerState(cacheDir);
    expect(s.crashes![0].crash_count).toBe(3);
    expect(s.crashes![0].last_exit_code).toBe("manager-restart-detected");
  });

  it("writes crashes record for a brand-new spec_hash (no prior record)", () => {
    writeManagerState(cacheDir, {
      generation: 1,
      roster: [
        {
          pid: 9001,
          spec_hash: "newone",
          started_at: T0.toISOString(),
          crash_count: 0,
        },
      ],
    });
    applyExitToState(cacheDir, "newone", 99, null, () => T0);
    const s = readManagerState(cacheDir);
    expect(s.crashes![0]).toEqual({
      spec_hash: "newone",
      crash_count: 1,
      last_exit_at: T0.toISOString(),
      last_exit_code: 99,
    });
  });

  it("never resurrects a crashes-cleared spec just because crash arrived after success", () => {
    // After a successful run + then a fresh crash, the new record should
    // start at count=1 (counter reset on success). Defends against a
    // subtle bug class where success path doesn't actually clear.
    writeManagerState(cacheDir, {
      generation: 1,
      roster: [
        {
          pid: 1,
          spec_hash: "h1",
          started_at: T0.toISOString(),
          crash_count: 0,
        },
      ],
      crashes: [
        {
          spec_hash: "h1",
          crash_count: 4,
          last_exit_at: T0.toISOString(),
          last_exit_code: 42,
        },
      ],
    });
    applyExitToState(cacheDir, "h1", 0, null, () => T0); // success
    expect(readManagerState(cacheDir).crashes).toBeUndefined();

    // Fresh re-run, then crashes again.
    writeManagerState(cacheDir, {
      ...readManagerState(cacheDir),
      roster: [
        {
          pid: 2,
          spec_hash: "h1",
          started_at: T0.toISOString(),
          crash_count: 0,
        },
      ],
    });
    applyExitToState(cacheDir, "h1", 7, null, () => T0);
    const s = readManagerState(cacheDir);
    expect(s.crashes).toHaveLength(1);
    expect(s.crashes![0].crash_count).toBe(1); // RESET on the prior success
    expect(s.crashes![0].last_exit_code).toBe(7);
  });

  it("filters all roster entries matching spec_hash (defensive — no PID assumption)", () => {
    // If two roster entries somehow share spec_hash (hard cap normally
    // prevents this, but a programmatic bug shouldn't leave a stale slot),
    // applyExitToState clears all of them.
    writeManagerState(cacheDir, {
      generation: 1,
      roster: [
        {
          pid: 1,
          spec_hash: "h1",
          started_at: T0.toISOString(),
          crash_count: 0,
        },
        {
          pid: 2,
          spec_hash: "h1",
          started_at: T0.toISOString(),
          crash_count: 0,
        },
        {
          pid: 3,
          spec_hash: "h2",
          started_at: T0.toISOString(),
          crash_count: 0,
        },
      ],
    });
    applyExitToState(cacheDir, "h1", 1, null, () => T0);
    const s = readManagerState(cacheDir);
    expect(s.roster).toHaveLength(1);
    expect(s.roster[0].spec_hash).toBe("h2");
  });
});

describe("applyExitToState (mgr105 — degenerate inputs)", () => {
  it("treats `null` code with no signal as a crash with code -1 (defensive default)", () => {
    writeManagerState(cacheDir, {
      generation: 1,
      roster: [
        {
          pid: 1,
          spec_hash: "h1",
          started_at: T0.toISOString(),
          crash_count: 0,
        },
      ],
    });
    applyExitToState(cacheDir, "h1", null, null, () => T0);
    const s = readManagerState(cacheDir);
    expect(s.crashes![0].last_exit_code).toBe(-1);
  });
});
