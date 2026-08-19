// mgr106 stale-PID + PID-recycling cross-check tests for
// src/lib/manage/lock.ts.
//
// mgr101 covered the basic O_EXCL acquire + release path; this file pins
// the new acquire-with-stale-cleanup behavior:
//
//   - lock file with a non-running PID → WARN, unlink, retry, succeed
//   - lock file with an alive but RECYCLED PID (process started after
//     acquired_at) → WARN, unlink, retry, succeed
//   - lock file with an alive non-recycled PID → ManagerLockHeldError
//   - bounded retry: persistent lock-recreation does NOT loop forever
//   - unparseable JSON in the lock file → treated as stale, reaped
//   - WARN messages cite the failing condition

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { classifyExistingLock } from "../src/lib/locks/classify.js";
import {
  ManagerLockHeldError,
  acquireManagerLock,
  managerLockPath,
} from "../src/lib/manage/lock.js";

let cacheDir: string;

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), "devx-mgr106-lock-"));
});
afterEach(() => {
  rmSync(cacheDir, { recursive: true, force: true });
});

function plantLock(body: unknown): string {
  const path = managerLockPath(cacheDir);
  mkdirSync(join(cacheDir, "locks"), { recursive: true });
  writeFileSync(path, typeof body === "string" ? body : JSON.stringify(body), "utf8");
  return path;
}

describe("acquireManagerLock — stale-PID detection (mgr106 AC #2)", () => {
  it("reaps a lock file whose PID is not alive", () => {
    const warnings: string[] = [];
    plantLock({ pid: 99999, acquired_at: new Date().toISOString() });
    const handle = acquireManagerLock(cacheDir, {
      pidAlive: () => false, // simulate dead PID
      pidStartedAt: () => null,
      warn: (m) => warnings.push(m),
    });
    expect(handle).toBeDefined();
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("not running");
    expect(warnings[0]).toContain("99999");
    handle.release();
  });

  it("reaps an unparseable lock file", () => {
    const warnings: string[] = [];
    plantLock("garbage{{{");
    const handle = acquireManagerLock(cacheDir, {
      pidAlive: () => true,
      pidStartedAt: () => null,
      warn: (m) => warnings.push(m),
    });
    expect(handle).toBeDefined();
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("unparseable");
    handle.release();
  });

  it("treats an alive non-recycled PID as genuinely held", () => {
    const warnings: string[] = [];
    const acquiredAt = new Date("2026-05-07T10:00:00Z");
    plantLock({ pid: 12345, acquired_at: acquiredAt.toISOString() });
    expect(() =>
      acquireManagerLock(cacheDir, {
        pidAlive: () => true,
        // process started BEFORE acquired_at → not recycled, genuinely held.
        pidStartedAt: () => new Date(acquiredAt.getTime() - 10_000),
        warn: (m) => warnings.push(m),
      }),
    ).toThrow(ManagerLockHeldError);
    expect(warnings).toHaveLength(0); // no WARN — held is not stale
  });
});

describe("acquireManagerLock — PID-recycling cross-check (mgr106 AC #7)", () => {
  it("reaps a lock when the holder PID's process started AFTER acquired_at", () => {
    const warnings: string[] = [];
    const acquiredAt = new Date("2026-05-07T10:00:00Z");
    plantLock({ pid: 4242, acquired_at: acquiredAt.toISOString() });
    const handle = acquireManagerLock(cacheDir, {
      pidAlive: () => true,
      // Probe says PID 4242's process started 1 hour AFTER acquired_at →
      // PID was recycled.
      pidStartedAt: () => new Date(acquiredAt.getTime() + 3_600_000),
      warn: (m) => warnings.push(m),
    });
    expect(handle).toBeDefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("pid recycled");
    expect(warnings[0]).toContain("4242");
    handle.release();
  });

  it("treats null pidStartedAt as 'cannot determine' → conservative held", () => {
    plantLock({ pid: 4242, acquired_at: new Date().toISOString() });
    expect(() =>
      acquireManagerLock(cacheDir, {
        pidAlive: () => true,
        pidStartedAt: () => null, // probe failed (e.g. native Windows)
        warn: () => {},
      }),
    ).toThrow(ManagerLockHeldError);
  });

  it("treats unparseable acquired_at as conservative held (PID alive, no recycling check possible)", () => {
    plantLock({ pid: 4242, acquired_at: "not-a-date" });
    expect(() =>
      acquireManagerLock(cacheDir, {
        pidAlive: () => true,
        pidStartedAt: () => new Date(),
        warn: () => {},
      }),
    ).toThrow(ManagerLockHeldError);
  });

  it("does NOT false-positive recycle when startedAt is within 2s grace of acquired_at", () => {
    // CI regression: ps -o etime= has 1-second resolution. A process that
    // started < 1s ago reports elapsed=0 → probePidStartedAt returns
    // now() — slightly later than acquired_at written milliseconds prior.
    // Without a grace window, every same-process re-acquire would
    // false-positive as recycled. Pin the grace at 2s.
    const acquiredAt = new Date("2026-05-07T10:00:00.000Z");
    plantLock({ pid: 4242, acquired_at: acquiredAt.toISOString() });
    expect(() =>
      acquireManagerLock(cacheDir, {
        pidAlive: () => true,
        // startedAt 1.5s AFTER acquired_at — within grace, must be held.
        pidStartedAt: () => new Date(acquiredAt.getTime() + 1_500),
        warn: () => {},
      }),
    ).toThrow(ManagerLockHeldError);
  });

  it("DOES reap when startedAt is more than 2s after acquired_at", () => {
    // Confirm the grace window's upper bound: a 3s delta still triggers
    // recycling reap. (Real PID recycling involves seconds-to-minutes.)
    const acquiredAt = new Date("2026-05-07T10:00:00.000Z");
    plantLock({ pid: 4242, acquired_at: acquiredAt.toISOString() });
    const handle = acquireManagerLock(cacheDir, {
      pidAlive: () => true,
      pidStartedAt: () => new Date(acquiredAt.getTime() + 3_000),
      warn: () => {},
    });
    expect(handle).toBeDefined();
    handle.release();
  });
});

describe("acquireManagerLock — bounded retry (mgr106 AC #2)", () => {
  it("succeeds on first cleanup retry when stale-PID is reaped cleanly", () => {
    // Sanity: cleanup-and-retry path returns a working handle. This is the
    // happy-path of the bounded-retry mechanism — no actual bound exercised.
    plantLock({ pid: 99999, acquired_at: new Date().toISOString() });
    let warnCount = 0;
    const handle = acquireManagerLock(cacheDir, {
      pidAlive: () => false,
      pidStartedAt: () => null,
      warn: () => warnCount++,
    });
    expect(warnCount).toBe(1); // exactly one cleanup before success
    handle.release();
  });

  it("surfaces ManagerLockHeldError when unlink fails (no infinite loop)", () => {
    // True bound exercise: cleanup unlink throws non-ENOENT → caller
    // raises ManagerLockHeldError immediately rather than retrying forever.
    // Simulated by chmod'ing the locks/ dir so unlinkSync fails with EACCES
    // on POSIX. Skip on platforms where chmod isn't honored.
    plantLock({ pid: 11111, acquired_at: new Date().toISOString() });
    const fs = require("node:fs") as typeof import("node:fs");
    const locksDir = join(cacheDir, "locks");
    try {
      fs.chmodSync(locksDir, 0o555); // r-xr-xr-x — unlinks fail with EACCES
    } catch {
      return; // chmod not supported on this platform — skip
    }
    try {
      // Sanity: confirm chmod actually blocks the unlink before asserting.
      let unlinkBlocked = false;
      try {
        fs.unlinkSync(managerLockPath(cacheDir));
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code === "EACCES" || code === "EPERM") unlinkBlocked = true;
      }
      if (!unlinkBlocked) return; // root, or filesystem ignores chmod (e.g. fakeowner mounts)
      // Re-plant since the sanity check may or may not have removed it.
      try {
        fs.chmodSync(locksDir, 0o755);
      } catch {
        return;
      }
      plantLock({ pid: 11111, acquired_at: new Date().toISOString() });
      try {
        fs.chmodSync(locksDir, 0o555);
      } catch {
        return;
      }

      expect(() =>
        acquireManagerLock(cacheDir, {
          pidAlive: () => false,
          pidStartedAt: () => null,
          warn: () => {},
        }),
      ).toThrow(ManagerLockHeldError);
    } finally {
      try {
        fs.chmodSync(locksDir, 0o755);
      } catch {
        // best-effort
      }
    }
  });

});

describe("acquireManagerLock — race-with-peer hardening (BH-H3)", () => {
  it("treats an empty lock file as conservatively held (peer mid-write race)", () => {
    // Between the peer's openSync(O_EXCL|O_CREAT) and writeSync, the lock
    // file exists but is empty. Reaping it would clobber the peer's lock
    // → two-manager scenario. Conservative posture: empty = held.
    plantLock("");
    expect(() =>
      acquireManagerLock(cacheDir, {
        pidAlive: () => false, // would normally be reaped; emptiness wins
        pidStartedAt: () => null,
        warn: () => {},
      }),
    ).toThrow(ManagerLockHeldError);
  });

  it("treats a whitespace-only lock file as conservatively held", () => {
    plantLock("   \n\t  \n");
    expect(() =>
      acquireManagerLock(cacheDir, {
        pidAlive: () => false,
        pidStartedAt: () => null,
        warn: () => {},
      }),
    ).toThrow(ManagerLockHeldError);
  });

  it("rejects a lock body with whitespace-only acquired_at as unparseable", () => {
    // Different from empty-content above: the JSON parses but the field
    // value is non-load-bearing. Tightened parseLockBody returns null →
    // classify says "unparseable, stale" → reaped. Without the trim()
    // tightening this would fall through to conservative-held forever.
    plantLock({ pid: 12345, acquired_at: "   " });
    const handle = acquireManagerLock(cacheDir, {
      pidAlive: () => false,
      pidStartedAt: () => null,
      warn: () => {},
    });
    expect(handle).toBeDefined();
    handle.release();
  });
});

describe("acquirePathLock — reap only the classified lock (debug-c81f04)", () => {
  // The mgr106 reap was classify → WARN → unconditional unlink. Between the
  // classify read and the unlink, the holder can release and a THIRD process
  // acquire; the unlink then deletes a LIVE peer's brand-new lock and both
  // processes enter the critical section — the R3 lost update the backlog
  // lock exists to prevent. Reproduced on macOS by
  // test/backlog-mutate.test.ts's cross-process R3 case, which reddened main
  // intermittently; the WARN that always accompanied a lost flip was
  // "vanished between EEXIST and read", i.e. the verdict every CONTENDED
  // RELEASE produces, so the window was hit in normal operation.
  //
  // `warn` is the deterministic interleave point: acquirePathLock calls it
  // after classify and before the unlink, exactly where the peer lands.

  it("does not delete a lock that changed between classify and reap", () => {
    plantLock({ pid: 99999, acquired_at: new Date().toISOString() });
    const peerBody =
      JSON.stringify({ pid: process.pid, acquired_at: new Date().toISOString() }) + "\n";
    let swapped = 0;
    expect(() =>
      acquireManagerLock(cacheDir, {
        pidAlive: (pid) => pid !== 99999, // the planted holder is dead → stale
        pidStartedAt: () => null,
        warn: () => {
          // The dead holder's file is released and a LIVE peer acquires,
          // right in the classify→unlink window.
          if (swapped++ === 0) writeFileSync(managerLockPath(cacheDir), peerBody, "utf8");
        },
      }),
    ).toThrow(ManagerLockHeldError);
    // The load-bearing assertion: the peer still holds its lock. Before the
    // fix this file was unlinked and the acquire SUCCEEDED — two holders.
    expect(readFileSync(managerLockPath(cacheDir), "utf8")).toBe(peerBody);
  });

  it("still reaps when the stale lock is untouched (no regression)", () => {
    // Same shape as above minus the peer — the reap must still happen, so
    // the identity check narrows the reap rather than disabling it.
    plantLock({ pid: 99999, acquired_at: new Date().toISOString() });
    const handle = acquireManagerLock(cacheDir, {
      pidAlive: (pid) => pid !== 99999,
      pidStartedAt: () => null,
      warn: () => {},
    });
    expect(existsSync(managerLockPath(cacheDir))).toBe(true);
    expect(JSON.parse(readFileSync(managerLockPath(cacheDir), "utf8")).pid).toBe(process.pid);
    handle.release();
  });

  it("a vanished lock authorizes no deletion at all (raw === null)", () => {
    // The verdict behind the observed flake. It carries no bytes, so there
    // is nothing the caller may unlink — it must simply retry the open.
    const missing = join(cacheDir, "locks", "nope.lock");
    const verdict = classifyExistingLock(
      missing,
      () => true,
      () => null,
    );
    expect(verdict.kind).toBe("stale");
    expect(verdict.kind === "stale" && verdict.raw).toBeNull();
  });

  it("a reapable verdict echoes the exact bytes it was computed from", () => {
    const body = JSON.stringify({ pid: 99999, acquired_at: new Date().toISOString() });
    const path = plantLock(body);
    const verdict = classifyExistingLock(
      path,
      () => false,
      () => null,
    );
    expect(verdict.kind === "stale" && verdict.raw).toBe(body);
  });
});

describe("acquireManagerLock — message content (mgr106 AC #2)", () => {
  it("WARN message includes acquired_at when reporting recycling", () => {
    const acquiredAt = "2026-05-07T10:00:00.000Z";
    plantLock({ pid: 7777, acquired_at: acquiredAt });
    const warnings: string[] = [];
    const handle = acquireManagerLock(cacheDir, {
      pidAlive: () => true,
      pidStartedAt: () => new Date("2026-05-07T11:00:00Z"),
      warn: (m) => warnings.push(m),
    });
    expect(warnings[0]).toContain(acquiredAt);
    expect(warnings[0]).toContain("2026-05-07T11:00:00.000Z");
    handle.release();
  });
});

describe("acquireManagerLock — live probe integration (mgr106 AC #1 + #7)", () => {
  it("works end-to-end with no test seams against process.pid", () => {
    // Plant a lock claiming `process.pid` but with a far-future acquired_at
    // → the recycling check sees process started BEFORE acquired_at →
    // genuinely held → throws.
    plantLock({
      pid: process.pid,
      acquired_at: new Date(Date.now() + 86_400_000).toISOString(), // +1 day
    });
    expect(() => acquireManagerLock(cacheDir)).toThrow(ManagerLockHeldError);
    rmSync(managerLockPath(cacheDir), { force: true });

    // Now plant a lock claiming `process.pid` with acquired_at in the
    // distant past → process must have started BEFORE that
    // (acquired_at is in the future relative to process-start) → so
    // process started AFTER acquired_at → recycled → reaped.
    //
    // Wait, we want to test the RECYCLING reap. Plant acquired_at LONG
    // before this process was born:
    plantLock({
      pid: process.pid,
      acquired_at: "1970-01-02T00:00:00.000Z", // way before this process started
    });
    // process.pid's actual start is well after 1970 → recycled → reaped.
    const handle = acquireManagerLock(cacheDir);
    expect(handle).toBeDefined();
    handle.release();
  });
});
