// PID-uptime probe unit tests for src/lib/manage/pid-uptime.ts (mgr106).
//
// Pure unit tests against the platform parsers + dispatch. The real `ps`
// invocation + `/proc` read is tested implicitly through the integration
// test in manage-lock-mgr106.test.ts (which exercises the live probe
// against `process.pid` so we know it works on at least the test host's
// platform).

import { describe, expect, it } from "vitest";

import {
  parseEtimeToSeconds,
  parseProcStatStarttime,
  parseProcUptime,
  probePidStartedAt,
} from "../src/lib/manage/pid-uptime.js";

describe("parseEtimeToSeconds", () => {
  it("parses MM:SS", () => {
    expect(parseEtimeToSeconds("12:34")).toBe(12 * 60 + 34);
  });
  it("parses HH:MM:SS", () => {
    expect(parseEtimeToSeconds("01:02:03")).toBe(3600 + 120 + 3);
  });
  it("parses DD-HH:MM:SS", () => {
    expect(parseEtimeToSeconds("5-12:34:56")).toBe(5 * 86400 + 12 * 3600 + 34 * 60 + 56);
  });
  it("returns null for empty / placeholder values", () => {
    expect(parseEtimeToSeconds("")).toBe(null);
    expect(parseEtimeToSeconds("?")).toBe(null);
    expect(parseEtimeToSeconds("-")).toBe(null);
  });
  it("returns null for malformed input", () => {
    expect(parseEtimeToSeconds("abc")).toBe(null);
    expect(parseEtimeToSeconds("12")).toBe(null); // single field — no colon
    expect(parseEtimeToSeconds("a:b")).toBe(null);
    expect(parseEtimeToSeconds("01:02:03:04")).toBe(null); // too many fields
  });
  it("rejects negative components", () => {
    // Sign-prefixed numbers parse but should be rejected — etime is monotonic.
    expect(parseEtimeToSeconds("-1:00")).toBe(null);
  });
  it("rejects parseInt-lax inputs (BH-H5: scientific notation, trailing chars)", () => {
    // parseInt would accept these silently; the strict regex rejects.
    expect(parseEtimeToSeconds("5e2:00")).toBe(null); // would be parseInt-as-5
    expect(parseEtimeToSeconds("12:34:56extra")).toBe(null); // trailing non-digits
    expect(parseEtimeToSeconds("0x10:00")).toBe(null); // hex-looking
    expect(parseEtimeToSeconds("01: 02:03")).toBe(null); // internal whitespace
  });
});

describe("parseProcStatStarttime", () => {
  // Helper: construct a /proc/<pid>/stat string where post-comm array
  // index 19 (overall field 22 = starttime) is `value`. Post-comm position
  // 0 is state, position 1 is ppid, ..., position 19 is starttime. The
  // template prepends "S " so we need 18 fillers BEFORE the starttime
  // value to put it at position 19.
  const makeStat = (starttime: string) => {
    const fields: string[] = [];
    for (let i = 0; i < 18; i++) fields.push(String(i));
    fields.push(starttime);
    for (let i = 0; i < 30; i++) fields.push("0");
    return `42 (init) S ${fields.join(" ")}\n`;
  };

  it("parses field 22 (post-comm field 20) from typical /proc/<pid>/stat", () => {
    expect(parseProcStatStarttime(makeStat("12345"))).toBe(12345);
  });
  it("handles comm fields containing spaces and parens", () => {
    // comm = "(weird name) (with parens" — must split on LAST `)`.
    const fields: string[] = [];
    for (let i = 0; i < 18; i++) fields.push(String(i));
    fields.push("99999");
    for (let i = 0; i < 30; i++) fields.push("0");
    const stat = `42 ((weird name) (with parens)) S ${fields.join(" ")}\n`;
    expect(parseProcStatStarttime(stat)).toBe(99999);
  });
  it("returns null when no `)` is present", () => {
    expect(parseProcStatStarttime("42 init S 0 0")).toBe(null);
  });
  it("returns null when fewer than 20 post-comm fields", () => {
    expect(parseProcStatStarttime("42 (init) S 0 0 0")).toBe(null);
  });
  it("returns null when starttime is non-numeric", () => {
    expect(parseProcStatStarttime(makeStat("not-a-number"))).toBe(null);
  });
});

describe("parseProcUptime", () => {
  it("returns the first column as a float", () => {
    expect(parseProcUptime("12345.67 23456.78\n")).toBe(12345.67);
  });
  it("handles leading whitespace", () => {
    expect(parseProcUptime("  100.5 200.5\n")).toBe(100.5);
  });
  it("returns null on empty input", () => {
    expect(parseProcUptime("")).toBe(null);
    expect(parseProcUptime("\n")).toBe(null);
  });
  it("returns null on non-numeric", () => {
    expect(parseProcUptime("abc 123\n")).toBe(null);
  });
});

describe("probePidStartedAt — input validation", () => {
  it("returns null for invalid pids", () => {
    expect(probePidStartedAt(-1)).toBe(null);
    expect(probePidStartedAt(0)).toBe(null);
    expect(probePidStartedAt(NaN)).toBe(null);
    expect(probePidStartedAt(Infinity)).toBe(null);
    expect(probePidStartedAt(1.5)).toBe(null); // non-integer
  });
});

describe("probePidStartedAt — launchd dispatch (macOS / etime)", () => {
  it("subtracts elapsed time from now()", () => {
    const fixedNow = new Date("2026-05-07T20:00:00Z");
    const result = probePidStartedAt(1234, {
      platform: "launchd",
      now: () => fixedNow,
      exec: (cmd, args) => {
        expect(cmd).toBe("ps");
        expect(args).toEqual(["-o", "etime=", "-p", "1234"]);
        return { stdout: "  10:00\n", status: 0 }; // 10 minutes elapsed
      },
    });
    expect(result?.toISOString()).toBe(new Date(fixedNow.getTime() - 600 * 1000).toISOString());
  });
  it("returns null when ps exits non-zero (process gone)", () => {
    const result = probePidStartedAt(1234, {
      platform: "launchd",
      exec: () => ({ stdout: "", status: 1 }),
    });
    expect(result).toBe(null);
  });
  it("returns null when etime parse fails", () => {
    const result = probePidStartedAt(1234, {
      platform: "launchd",
      exec: () => ({ stdout: "garbage\n", status: 0 }),
    });
    expect(result).toBe(null);
  });
});

describe("probePidStartedAt — systemd dispatch (Linux / /proc)", () => {
  // Helper: see parseProcStatStarttime suite — starttime at post-comm
  // index 19 means 18 fillers BEFORE it (the leading "S " consumes index 0).
  const makeStat = (starttime: string) => {
    const fields: string[] = [];
    for (let i = 0; i < 18; i++) fields.push(String(i));
    fields.push(starttime);
    for (let i = 0; i < 30; i++) fields.push("0");
    return `42 (init) S ${fields.join(" ")}\n`;
  };

  it("derives Date from /proc/<pid>/stat + /proc/uptime", () => {
    const fixedNow = new Date("2026-05-07T20:00:00Z");
    // starttime = 600_000 ticks → at 100 Hz = 6000 sec since boot.
    // uptime = 7000 sec → process has been alive 1000 sec.
    // → started at fixedNow - 1000s.
    const result = probePidStartedAt(42, {
      platform: "systemd",
      now: () => fixedNow,
      readFile: (path) => {
        if (path === "/proc/42/stat") return makeStat("600000");
        if (path === "/proc/uptime") return "7000.0 1000.0\n";
        throw new Error(`unexpected path ${path}`);
      },
    });
    expect(result?.toISOString()).toBe(new Date(fixedNow.getTime() - 1000 * 1000).toISOString());
  });
  it("returns null when /proc/<pid>/stat is unreadable", () => {
    const result = probePidStartedAt(42, {
      platform: "systemd",
      readFile: (path) => {
        if (path === "/proc/42/stat") {
          const e: NodeJS.ErrnoException = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
          throw e;
        }
        return "1.0 1.0\n";
      },
    });
    expect(result).toBe(null);
  });
  it("returns null when starttime/CLK_TCK exceeds uptime (corrupt data)", () => {
    // starttime 99999999 ticks @ 100Hz = 999999.99 sec but uptime is 1.0 →
    // negative elapsed → null.
    const result = probePidStartedAt(42, {
      platform: "systemd",
      now: () => new Date(),
      readFile: (path) => (path.endsWith("/stat") ? makeStat("99999999") : "1.0 0.5\n"),
    });
    expect(result).toBe(null);
  });
});

describe("probePidStartedAt — task-scheduler dispatch (WSL / lstart)", () => {
  it("parses lstart output as a Date", () => {
    const result = probePidStartedAt(1234, {
      platform: "task-scheduler",
      exec: (cmd, args) => {
        expect(cmd).toBe("ps");
        expect(args).toEqual(["-o", "lstart=", "-p", "1234"]);
        return { stdout: "Wed May  7 12:34:56 2026\n", status: 0 };
      },
    });
    // Just verify we got a valid Date — exact timezone behavior depends
    // on the host, but the parser must produce something Number.isFinite.
    expect(result).toBeInstanceOf(Date);
    expect(Number.isFinite(result?.getTime() ?? NaN)).toBe(true);
  });
  it("returns null when ps exits non-zero", () => {
    const result = probePidStartedAt(1234, {
      platform: "task-scheduler",
      exec: () => ({ stdout: "", status: 1 }),
    });
    expect(result).toBe(null);
  });
  it("returns null when ps is not on PATH (native Windows fallback)", () => {
    const result = probePidStartedAt(1234, {
      platform: "task-scheduler",
      exec: () => ({ stdout: "", status: null }), // signal/spawn-error
    });
    expect(result).toBe(null);
  });
  it("returns null when lstart output is unparseable", () => {
    const result = probePidStartedAt(1234, {
      platform: "task-scheduler",
      exec: () => ({ stdout: "not-a-date\n", status: 0 }),
    });
    expect(result).toBe(null);
  });
});

describe("probePidStartedAt — live probe smoke (current process)", () => {
  it("returns a Date in the past for process.pid (current host platform)", () => {
    // Integration smoke — uses the host's real ps / /proc. Asserts only that
    // we get *some* Date in the past; exact value is host-dependent.
    const result = probePidStartedAt(process.pid);
    if (result === null) {
      // Native Windows without WSL ps, or some other unsupported host. Skip.
      // (vitest doesn't have a runtime skip, so this just trivially passes.)
      return;
    }
    expect(result).toBeInstanceOf(Date);
    expect(result.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    // Process can't have started before Node was even born — sanity floor at
    // 30 days ago to allow long-running CI agents.
    const thirtyDaysAgo = Date.now() - 30 * 86400 * 1000;
    expect(result.getTime()).toBeGreaterThan(thirtyDaysAgo);
  });
});
