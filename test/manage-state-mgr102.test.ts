// State IO tests for src/lib/manage/state.ts (mgr102) — focused on the
// surface mgr101 didn't cover: schedule.json schema, the combined
// readState/writeState API, crash-mid-write recovery, and concurrent-write
// protection. mgr101's manager-state suite (test/manage-state.test.ts) keeps
// covering the per-file manager.json semantics.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type ManagerState,
  type ScheduleState,
  type State,
  emptyManagerState,
  emptyScheduleState,
  emptyState,
  heartbeatPath,
  managerStatePath,
  nextGeneration,
  readManagerState,
  readScheduleState,
  readState,
  scheduleStatePath,
  writeHeartbeat,
  writeManagerState,
  writeScheduleState,
  writeState,
} from "../src/lib/manage/state.js";

let cacheDir: string;

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), "devx-mgr102-state-"));
});
afterEach(() => {
  rmSync(cacheDir, { recursive: true, force: true });
});

// ─── Schedule.json schema (AC #2) ───────────────────────────────────────

describe("readScheduleState", () => {
  it("returns empty default when schedule.json is absent", () => {
    const s = readScheduleState(cacheDir);
    expect(s).toEqual(emptyScheduleState());
    expect(s.hard_cap).toBe(1); // Phase 1 hard cap pinned
    expect(s.slots).toEqual([]);
  });

  it("returns empty default when JSON is corrupt", () => {
    mkdirSync(join(cacheDir, "state"), { recursive: true });
    writeFileSync(scheduleStatePath(cacheDir), "{not json", "utf8");
    expect(readScheduleState(cacheDir)).toEqual(emptyScheduleState());
  });

  it("returns empty default when shape is invalid (missing fields)", () => {
    mkdirSync(join(cacheDir, "state"), { recursive: true });
    for (const bad of [
      { generation: 1 }, // missing computed_at, slots, hard_cap
      { generation: -1, computed_at: "t", slots: [], hard_cap: 1 }, // negative gen
      { generation: 1.5, computed_at: "t", slots: [], hard_cap: 1 }, // non-integer
      { generation: 1, computed_at: "t", slots: [], hard_cap: -1 }, // negative cap
      { generation: 1, computed_at: "t", slots: "not-array", hard_cap: 1 }, // bad slots
    ]) {
      writeFileSync(scheduleStatePath(cacheDir), JSON.stringify(bad), "utf8");
      expect(readScheduleState(cacheDir)).toEqual(emptyScheduleState());
    }
  });

  it("filters bad-shape slot entries", () => {
    mkdirSync(join(cacheDir, "state"), { recursive: true });
    writeFileSync(
      scheduleStatePath(cacheDir),
      JSON.stringify({
        generation: 3,
        computed_at: "2026-05-07T10:00:00.000Z",
        slots: [
          {
            spec_hash: "a1b2c3",
            worker_class: "dev",
            priority: 1,
            since: "2026-05-07T09:00:00.000Z",
          },
          null, // bad
          { spec_hash: "x" }, // missing fields
          { spec_hash: 1, worker_class: "dev", priority: 1, since: "t" }, // wrong type
          {
            spec_hash: "ffffff",
            worker_class: "plan",
            priority: 2,
            since: "2026-05-07T09:30:00.000Z",
          },
        ],
        hard_cap: 1,
      }),
      "utf8",
    );
    const s = readScheduleState(cacheDir);
    expect(s.slots).toEqual([
      {
        spec_hash: "a1b2c3",
        worker_class: "dev",
        priority: 1,
        since: "2026-05-07T09:00:00.000Z",
      },
      {
        spec_hash: "ffffff",
        worker_class: "plan",
        priority: 2,
        since: "2026-05-07T09:30:00.000Z",
      },
    ]);
  });

  it("returns the persisted state when shape is valid", () => {
    const persisted: ScheduleState = {
      generation: 7,
      computed_at: "2026-05-07T10:00:00.000Z",
      slots: [
        {
          spec_hash: "a1b2c3",
          worker_class: "dev",
          priority: 1,
          since: "2026-05-07T09:00:00.000Z",
        },
      ],
      hard_cap: 1,
    };
    writeScheduleState(cacheDir, persisted);
    expect(readScheduleState(cacheDir)).toEqual(persisted);
  });
});

// ─── Combined readState / writeState (AC #1) ────────────────────────────

describe("readState / writeState (combined surface)", () => {
  it("returns combined empty defaults when nothing is on disk", () => {
    expect(readState(cacheDir)).toEqual({
      schedule: emptyScheduleState(),
      manager: emptyManagerState(),
    });
  });

  it("round-trips a fully-populated combined state", () => {
    const s: State = {
      schedule: {
        generation: 12,
        computed_at: "2026-05-07T10:00:00.000Z",
        slots: [
          {
            spec_hash: "a1b2c3",
            worker_class: "dev",
            priority: 1,
            since: "2026-05-07T09:00:00.000Z",
          },
        ],
        hard_cap: 1,
      },
      manager: {
        generation: 12,
        started_at: "2026-05-07T09:00:00.000Z",
        last_tick_at: "2026-05-07T10:00:00.000Z",
        model: "claude-haiku-4-5",
        ticks: [
          { generation: 12, ts: "2026-05-07T10:00:00.000Z", outcome: "spawned" },
        ],
        roster: [
          {
            pid: 4242,
            spec_hash: "a1b2c3",
            worker_class: "dev",
            started_at: "2026-05-07T10:00:00.000Z",
            crash_count: 0,
          },
        ],
        lock: { pid: process.pid, acquired_at: "2026-05-07T09:00:00.000Z" },
      },
    };
    writeState(cacheDir, s);
    expect(readState(cacheDir)).toEqual(s);
    // AC #2: schedule.json and manager.json both exist; heartbeat is separate.
    expect(existsSync(scheduleStatePath(cacheDir))).toBe(true);
    expect(existsSync(managerStatePath(cacheDir))).toBe(true);
    expect(existsSync(heartbeatPath(cacheDir))).toBe(false);
  });

  it("emptyState() builds a valid combined default that round-trips", () => {
    const def = emptyState();
    writeState(cacheDir, def);
    expect(readState(cacheDir)).toEqual(def);
  });
});

// ─── Crash-mid-write recovery (AC #3 + AC #4) ───────────────────────────

describe("crash-mid-write recovery — leftover *.tmp", () => {
  // The two recovery branches the AC pins:
  //   (1) main file exists → tmp ignored + cleaned up
  //   (2) main file missing → newest valid-JSON tmp promoted (rename → main)

  it("(1) ignores leftover tmp when main file exists, and cleans the tmp up", () => {
    mkdirSync(join(cacheDir, "state"), { recursive: true });
    const main: ManagerState = {
      generation: 5,
      roster: [],
      ticks: [{ generation: 5, ts: "2026-05-07T10:00:00.000Z", outcome: "no-work" }],
    };
    writeManagerState(cacheDir, main);
    // Plant an orphan tmp from a hypothetical prior crash. Use the writeAtomic
    // suffix shape (`<file>.tmp.<pid>.<rand>`) so the recovery scanner sees it.
    const orphanPath = managerStatePath(cacheDir) + ".tmp.99999.deadbeef";
    writeFileSync(
      orphanPath,
      JSON.stringify({ generation: 999, roster: [] }),
      "utf8",
    );
    expect(existsSync(orphanPath)).toBe(true);

    expect(readManagerState(cacheDir)).toEqual(main);
    // Tmp swept on read so it doesn't accumulate forever.
    expect(existsSync(orphanPath)).toBe(false);
  });

  it("(2) promotes the newest valid-JSON tmp when main is missing", async () => {
    mkdirSync(join(cacheDir, "state"), { recursive: true });
    const stalePayload = { generation: 3, roster: [] };
    const fresh: ManagerState = {
      generation: 8,
      roster: [],
      ticks: [{ generation: 8, ts: "2026-05-07T11:00:00.000Z", outcome: "spawned" }],
    };
    const stalePath = managerStatePath(cacheDir) + ".tmp.11111.aaaaaaaa";
    const freshPath = managerStatePath(cacheDir) + ".tmp.22222.bbbbbbbb";

    writeFileSync(stalePath, JSON.stringify(stalePayload), "utf8");
    // Force a measurable mtime gap — some filesystems (HFS+, FAT32) have
    // 1–2s mtime resolution; sleep is the only portable way to guarantee
    // strict ordering here.
    await new Promise((r) => setTimeout(r, 50));
    writeFileSync(freshPath, JSON.stringify(fresh), "utf8");

    expect(existsSync(managerStatePath(cacheDir))).toBe(false);

    const recovered = readManagerState(cacheDir);
    expect(recovered.generation).toBe(8);
    expect(recovered.ticks).toEqual(fresh.ticks);

    // Newest tmp got promoted → main now exists.
    expect(existsSync(managerStatePath(cacheDir))).toBe(true);
    // Stale tmp was cleaned up.
    expect(existsSync(stalePath)).toBe(false);
    expect(existsSync(freshPath)).toBe(false);
  });

  it("(2) skips corrupt tmps and falls back to the empty default", () => {
    mkdirSync(join(cacheDir, "state"), { recursive: true });
    const corruptPath = managerStatePath(cacheDir) + ".tmp.33333.cccccccc";
    writeFileSync(corruptPath, "{not parseable", "utf8");

    const recovered = readManagerState(cacheDir);
    expect(recovered).toEqual(emptyManagerState());

    // Corrupt tmp cleaned up so it doesn't keep getting reconsidered.
    expect(existsSync(corruptPath)).toBe(false);
  });

  it("(2) prefers the newest tmp even when an older one is also valid", async () => {
    mkdirSync(join(cacheDir, "state"), { recursive: true });
    const olderPath = managerStatePath(cacheDir) + ".tmp.44444.dddddddd";
    const newerPath = managerStatePath(cacheDir) + ".tmp.55555.eeeeeeee";

    writeFileSync(olderPath, JSON.stringify({ generation: 1, roster: [] }), "utf8");
    await new Promise((r) => setTimeout(r, 50));
    writeFileSync(newerPath, JSON.stringify({ generation: 99, roster: [] }), "utf8");

    expect(readManagerState(cacheDir).generation).toBe(99);
    expect(existsSync(olderPath)).toBe(false);
    expect(existsSync(newerPath)).toBe(false);
  });

  it("recovery applies symmetrically to schedule.json", () => {
    mkdirSync(join(cacheDir, "state"), { recursive: true });
    const fresh: ScheduleState = {
      generation: 4,
      computed_at: "2026-05-07T10:00:00.000Z",
      slots: [],
      hard_cap: 1,
    };
    const tmpPath = scheduleStatePath(cacheDir) + ".tmp.66666.ffffffff";
    writeFileSync(tmpPath, JSON.stringify(fresh), "utf8");

    expect(existsSync(scheduleStatePath(cacheDir))).toBe(false);

    const recovered = readScheduleState(cacheDir);
    expect(recovered).toEqual(fresh);
    expect(existsSync(scheduleStatePath(cacheDir))).toBe(true);
    expect(existsSync(tmpPath)).toBe(false);
  });

  it("returns null-equivalent empty default when neither main nor tmp exists", () => {
    // Dir doesn't even exist — no prior state at all.
    expect(readManagerState(cacheDir)).toEqual(emptyManagerState());
    expect(readScheduleState(cacheDir)).toEqual(emptyScheduleState());
  });
});

// ─── Concurrent-write protection (AC #4) ────────────────────────────────

describe("concurrent-write protection (atomic-rename guarantees)", () => {
  // Honest framing: writeManagerState is synchronous, so within ONE Node
  // process Promise.all-wrapped writes serialize on the event loop — they
  // demonstrate "rapid back-to-back writes never tear" but not genuine
  // multi-process concurrency. The genuine atomicity guarantee comes from
  // writeAtomic's tmp+rename primitive (renames are FS-atomic). In
  // production, the manager singleton lock (mgr106) serializes writers
  // anyway, so the real concurrent-write window is "crashed prior process
  // left a tmp behind, new process recovers" — covered by the leftover-tmp
  // suite above. These tests assert the in-process rapid-write contract.
  it("rapid back-to-back writes never produce a torn file — final read parses to one of the inputs", async () => {
    const inputs: ManagerState[] = Array.from({ length: 20 }, (_, i) => ({
      generation: i + 1,
      roster: [],
      ticks: [{ generation: i + 1, ts: `2026-05-07T10:00:0${i % 10}.000Z`, outcome: "no-work" }],
    }));

    await Promise.all(inputs.map((s) => Promise.resolve(writeManagerState(cacheDir, s))));

    const final = readManagerState(cacheDir);
    expect(final).not.toEqual(emptyManagerState()); // file was definitely written

    const candidateGenerations = inputs.map((s) => s.generation);
    expect(candidateGenerations).toContain(final.generation);

    // No leftover tmps after a clean run — every tmp got rename-consumed.
    const stateFiles = readdirSync(join(cacheDir, "state"));
    expect(stateFiles.filter((f) => f.startsWith("manager.json.tmp."))).toEqual([]);
  });

  it("sequential writes overwrite cleanly with no tmp accumulation", () => {
    for (let i = 1; i <= 50; i++) {
      writeManagerState(cacheDir, { generation: i, roster: [] });
    }
    expect(readManagerState(cacheDir).generation).toBe(50);
    const stateFiles = readdirSync(join(cacheDir, "state"));
    expect(stateFiles.filter((f) => f.includes(".tmp."))).toEqual([]);
  });

  it("writeHeartbeat is atomic too — rapid heartbeat writes don't leave torn JSON", async () => {
    const beats = Array.from({ length: 10 }, (_, i) => ({
      ts: `2026-05-07T10:00:0${i}.000Z`,
      pid: 1000 + i,
      generation: i + 1,
    }));
    await Promise.all(
      beats.map((b) => Promise.resolve(writeHeartbeat(cacheDir, b))),
    );
    const raw = readFileSync(heartbeatPath(cacheDir), "utf8").trim();
    const parsed = JSON.parse(raw);
    expect(beats.map((b) => b.generation)).toContain(parsed.generation);
  });
});

// ─── Defense-in-depth: write-time ticks bound ───────────────────────────

describe("writeManagerState bounds the ticks log defensively", () => {
  it("trims ticks to last 100 even when a programmatic caller passes more", () => {
    const big: ManagerState = {
      generation: 200,
      roster: [],
      ticks: Array.from({ length: 250 }, (_, i) => ({
        generation: i + 1,
        ts: `2026-05-07T10:00:${String(i % 60).padStart(2, "0")}.000Z`,
        outcome: "no-work" as const,
      })),
    };
    writeManagerState(cacheDir, big);
    const persisted = readManagerState(cacheDir);
    expect(persisted.ticks?.length).toBe(100);
    expect(persisted.ticks?.[0]?.generation).toBe(151);
    expect(persisted.ticks?.[99]?.generation).toBe(250);
  });
});

// ─── Self-review fixes (Phase 4 hardening) ──────────────────────────────

describe("readManagerState explicitly projects allowed fields", () => {
  // Without explicit projection, a hand-edited or version-skewed manager.json
  // would tunnel arbitrary fields through every read+writeback cycle. The
  // projection MUST drop unknown fields and validate-or-skip optional ones.

  it("drops unknown extra fields", () => {
    mkdirSync(join(cacheDir, "state"), { recursive: true });
    writeFileSync(
      managerStatePath(cacheDir),
      JSON.stringify({
        generation: 3,
        roster: [],
        evil_field: "should-not-survive",
        __maybe__: { nested: true },
      }),
      "utf8",
    );
    const s = readManagerState(cacheDir) as Record<string, unknown>;
    expect(s.evil_field).toBeUndefined();
    expect(s.__maybe__).toBeUndefined();
    expect(s.generation).toBe(3);
  });

  it("drops malformed lock instead of tunneling it", () => {
    mkdirSync(join(cacheDir, "state"), { recursive: true });
    writeFileSync(
      managerStatePath(cacheDir),
      JSON.stringify({
        generation: 5,
        roster: [],
        lock: "not-an-object",
      }),
      "utf8",
    );
    expect(readManagerState(cacheDir).lock).toBeUndefined();
  });

  it("drops malformed model field instead of tunneling it", () => {
    mkdirSync(join(cacheDir, "state"), { recursive: true });
    writeFileSync(
      managerStatePath(cacheDir),
      JSON.stringify({
        generation: 5,
        roster: [],
        model: 42, // wrong type
      }),
      "utf8",
    );
    const s = readManagerState(cacheDir);
    expect(s.model).toBeUndefined();
  });

  it("preserves valid optional roster fields (worker_class, last_exit_code)", () => {
    const s: ManagerState = {
      generation: 5,
      roster: [
        {
          pid: 4242,
          spec_hash: "a1b2c3",
          worker_class: "dev",
          started_at: "2026-05-07T10:00:00.000Z",
          crash_count: 2,
          last_exit_code: 42,
        },
      ],
    };
    writeManagerState(cacheDir, s);
    const back = readManagerState(cacheDir);
    expect(back.roster[0]).toMatchObject({
      worker_class: "dev",
      last_exit_code: 42,
    });
  });

  it("rejects roster entries with malformed optional fields", () => {
    mkdirSync(join(cacheDir, "state"), { recursive: true });
    writeFileSync(
      managerStatePath(cacheDir),
      JSON.stringify({
        generation: 1,
        roster: [
          // valid baseline
          { pid: 1, spec_hash: "x", started_at: "t", crash_count: 0 },
          // malformed worker_class
          { pid: 2, spec_hash: "y", started_at: "t", crash_count: 0, worker_class: 42 },
          // malformed last_exit_code
          {
            pid: 3,
            spec_hash: "z",
            started_at: "t",
            crash_count: 0,
            last_exit_code: "exit",
          },
          // negative crash_count
          { pid: 4, spec_hash: "w", started_at: "t", crash_count: -1 },
        ],
      }),
      "utf8",
    );
    const s = readManagerState(cacheDir);
    expect(s.roster.map((r) => r.pid)).toEqual([1]);
  });
});

describe("nextGeneration safety guards", () => {
  it("rejects Infinity → returns 1", () => {
    expect(nextGeneration({ generation: Infinity, roster: [] })).toBe(1);
  });

  it("rejects NaN → returns 1", () => {
    expect(nextGeneration({ generation: NaN, roster: [] })).toBe(1);
  });

  it("rejects negative integers → returns 1", () => {
    expect(nextGeneration({ generation: -5, roster: [] })).toBe(1);
  });

  it("rejects non-integers → returns 1", () => {
    expect(nextGeneration({ generation: 1.5, roster: [] })).toBe(1);
  });

  it("rejects beyond MAX_SAFE_INTEGER → returns 1", () => {
    expect(
      nextGeneration({ generation: Number.MAX_SAFE_INTEGER + 1, roster: [] }),
    ).toBe(1);
  });

  it("happy path: increments by 1", () => {
    expect(nextGeneration({ generation: 42, roster: [] })).toBe(43);
  });
});

describe("isTickEntry accepts string outcomes for forward-compat", () => {
  // mgr103+ may add new TickOutcome variants; the read-side validator
  // accepts any non-empty string so older readers don't drop newer
  // outcomes. The TS union is advisory, not load-bearing at runtime.
  it("preserves a 'crashed' outcome through round-trip even though TS union excludes it", () => {
    mkdirSync(join(cacheDir, "state"), { recursive: true });
    writeFileSync(
      managerStatePath(cacheDir),
      JSON.stringify({
        generation: 1,
        roster: [],
        ticks: [
          { generation: 1, ts: "t1", outcome: "no-work" },
          { generation: 2, ts: "t2", outcome: "crashed" }, // future variant
          { generation: 3, ts: "t3", outcome: "respawned" },
        ],
      }),
      "utf8",
    );
    const s = readManagerState(cacheDir);
    expect(s.ticks?.map((t) => t.outcome)).toEqual([
      "no-work",
      "crashed",
      "respawned",
    ]);
  });

  it("rejects empty-string and non-string outcomes", () => {
    mkdirSync(join(cacheDir, "state"), { recursive: true });
    writeFileSync(
      managerStatePath(cacheDir),
      JSON.stringify({
        generation: 1,
        roster: [],
        ticks: [
          { generation: 1, ts: "t1", outcome: "" },
          { generation: 2, ts: "t2", outcome: 42 },
          { generation: 3, ts: "t3", outcome: null },
          { generation: 4, ts: "t4", outcome: "valid" },
        ],
      }),
      "utf8",
    );
    expect(readManagerState(cacheDir).ticks?.length).toBe(1);
  });
});

describe("readState pair-write inconsistency window", () => {
  // writeState is not transactional. Document the window explicitly via
  // a regression test: schedule.gen and manager.gen can drift for one
  // tick. mgr103+ reconcile compares generations to detect this.
  it("returns a pair that may have mismatched generations after a partial write", () => {
    // Simulate mid-pair-write crash: schedule wrote gen=10, manager wrote gen=9.
    writeScheduleState(cacheDir, {
      generation: 10,
      computed_at: "2026-05-07T10:00:00.000Z",
      slots: [],
      hard_cap: 1,
    });
    writeManagerState(cacheDir, { generation: 9, roster: [] });
    const pair = readState(cacheDir);
    expect(pair.schedule.generation).toBe(10);
    expect(pair.manager.generation).toBe(9);
    // The mismatch is observable; mgr103 will detect & repair.
    expect(pair.schedule.generation).not.toBe(pair.manager.generation);
  });
});

describe("writeScheduleState defensive slots cap", () => {
  it("trims slots when count exceeds the defensive bound", () => {
    const huge: ScheduleState = {
      generation: 1,
      computed_at: "2026-05-07T10:00:00.000Z",
      hard_cap: 1,
      slots: Array.from({ length: 1500 }, (_, i) => ({
        spec_hash: `hash${i}`,
        worker_class: "dev",
        priority: i,
        since: "2026-05-07T10:00:00.000Z",
      })),
    };
    writeScheduleState(cacheDir, huge);
    const back = readScheduleState(cacheDir);
    expect(back.slots.length).toBe(1000); // floor when hard_cap*8 < floor
  });

  it("does not trim slots when count is under the bound", () => {
    const small: ScheduleState = {
      generation: 1,
      computed_at: "2026-05-07T10:00:00.000Z",
      hard_cap: 1,
      slots: Array.from({ length: 5 }, (_, i) => ({
        spec_hash: `hash${i}`,
        worker_class: "dev",
        priority: i,
        since: "2026-05-07T10:00:00.000Z",
      })),
    };
    writeScheduleState(cacheDir, small);
    expect(readScheduleState(cacheDir).slots.length).toBe(5);
  });
});

describe("readWithTmpRecovery skips parseable-but-non-object tmps", () => {
  // Pre-fix: a tmp containing literal `5` or `null` would be promoted to
  // main, then readManagerState's validator would fall back to empty.
  // Net behavior was OK but wasted a rename and the tmp persisted as the
  // new (garbage) main file. Post-fix: skip non-object tmps before the
  // promote.

  it("skips a tmp containing a JSON number literal", () => {
    mkdirSync(join(cacheDir, "state"), { recursive: true });
    const tmpPath = managerStatePath(cacheDir) + ".tmp.77777.aaaaaaaa";
    writeFileSync(tmpPath, "5", "utf8");
    expect(readManagerState(cacheDir)).toEqual(emptyManagerState());
    expect(existsSync(tmpPath)).toBe(false); // cleaned up
    expect(existsSync(managerStatePath(cacheDir))).toBe(false); // not promoted
  });

  it("skips a tmp containing a JSON array (not an object)", () => {
    mkdirSync(join(cacheDir, "state"), { recursive: true });
    const tmpPath = managerStatePath(cacheDir) + ".tmp.88888.bbbbbbbb";
    writeFileSync(tmpPath, "[]", "utf8");
    expect(readManagerState(cacheDir)).toEqual(emptyManagerState());
    expect(existsSync(managerStatePath(cacheDir))).toBe(false);
  });
});

describe("readWithTmpRecovery surfaces non-ENOENT directory errors", () => {
  it("throws when the state dir is actually a regular file (ENOTDIR)", () => {
    // Plant a file where the state dir should be — corrupt project layout
    // that should NOT silently look like "no state" (the prior catch-all
    // mapped this to empty default and proceeded; the manager would then
    // crash at write time).
    writeFileSync(join(cacheDir, "state"), "not-a-dir", "utf8");
    expect(() => readManagerState(cacheDir)).toThrow();
  });
});
