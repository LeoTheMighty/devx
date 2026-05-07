// State IO unit tests for src/lib/manage/state.ts (mgr101).

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type ManagerState,
  heartbeatPath,
  managerStatePath,
  nextGeneration,
  readManagerState,
  writeHeartbeat,
  writeManagerState,
} from "../src/lib/manage/state.js";

let cacheDir: string;

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), "devx-mgr-state-"));
});
afterEach(() => {
  rmSync(cacheDir, { recursive: true, force: true });
});

describe("readManagerState", () => {
  it("returns empty default when manager.json is absent", () => {
    const state = readManagerState(cacheDir);
    expect(state).toEqual({ generation: 0, roster: [] });
  });

  it("returns empty default when JSON is corrupt", () => {
    const path = managerStatePath(cacheDir);
    mkdirSync(join(cacheDir, "state"), { recursive: true });
    writeFileSync(path, "{not json", "utf8");
    expect(readManagerState(cacheDir)).toEqual({ generation: 0, roster: [] });
  });

  it("returns empty default when shape is invalid (no roster array)", () => {
    const path = managerStatePath(cacheDir);
    mkdirSync(join(cacheDir, "state"), { recursive: true });
    writeFileSync(path, JSON.stringify({ generation: 5 }), "utf8");
    expect(readManagerState(cacheDir)).toEqual({ generation: 0, roster: [] });
  });

  it("returns empty default when generation is negative or non-integer", () => {
    const path = managerStatePath(cacheDir);
    mkdirSync(join(cacheDir, "state"), { recursive: true });
    for (const bad of [-1, 1.5, NaN]) {
      writeFileSync(path, JSON.stringify({ generation: bad, roster: [] }), "utf8");
      expect(readManagerState(cacheDir)).toEqual({ generation: 0, roster: [] });
    }
  });

  it("filters bad-shape ticks entries — outcome accepts any non-empty string (mgr102 forward-compat)", () => {
    // mgr102 loosened the closed-set outcome check to a non-empty-string
    // check so future mgr103/104/Phase-2 outcomes ("crashed", "respawned",
    // …) round-trip cleanly through older readers. Bad-shape rejections
    // (null, primitive, missing fields, non-string outcome) still apply.
    const path = managerStatePath(cacheDir);
    mkdirSync(join(cacheDir, "state"), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        generation: 3,
        roster: [],
        ticks: [
          { generation: 1, ts: "2026-05-07T10:00:00.000Z", outcome: "no-work" },
          null, // bad shape
          "garbage", // bad shape
          { generation: 2, ts: "2026-05-07T10:01:00.000Z", outcome: "spawned" },
          { generation: 3, ts: "x", outcome: "future-outcome" }, // accepted (mgr102+)
          { generation: 4, ts: "x", outcome: "" }, // rejected (empty string)
          { generation: 5, ts: "x", outcome: 42 }, // rejected (non-string)
        ],
      }),
      "utf8",
    );
    const state = readManagerState(cacheDir);
    expect(state.ticks).toEqual([
      { generation: 1, ts: "2026-05-07T10:00:00.000Z", outcome: "no-work" },
      { generation: 2, ts: "2026-05-07T10:01:00.000Z", outcome: "spawned" },
      { generation: 3, ts: "x", outcome: "future-outcome" },
    ]);
  });

  it("filters bad-shape roster entries", () => {
    const path = managerStatePath(cacheDir);
    mkdirSync(join(cacheDir, "state"), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        generation: 1,
        roster: [
          { pid: 1, spec_hash: "a1b2c3", started_at: "2026-05-07T10:00:00.000Z", crash_count: 0 },
          { pid: "not-a-number", spec_hash: "x", started_at: "x", crash_count: 0 },
          {}, // missing all fields
        ],
      }),
      "utf8",
    );
    expect(readManagerState(cacheDir).roster).toEqual([
      { pid: 1, spec_hash: "a1b2c3", started_at: "2026-05-07T10:00:00.000Z", crash_count: 0 },
    ]);
  });

  it("returns the persisted state when shape is valid", () => {
    const persisted: ManagerState = {
      generation: 7,
      started_at: "2026-05-07T09:00:00.000Z",
      last_tick_at: "2026-05-07T09:01:00.000Z",
      ticks: [{ generation: 7, ts: "2026-05-07T09:01:00.000Z", outcome: "no-work" }],
      roster: [],
    };
    writeManagerState(cacheDir, persisted);
    expect(readManagerState(cacheDir)).toEqual(persisted);
  });
});

describe("writeManagerState / writeHeartbeat", () => {
  it("writes manager.json under .devx-cache/state/", () => {
    writeManagerState(cacheDir, { generation: 1, roster: [] });
    const raw = readFileSync(managerStatePath(cacheDir), "utf8");
    expect(JSON.parse(raw)).toMatchObject({ generation: 1, roster: [] });
  });

  it("writes heartbeat.json with {ts, pid, generation}", () => {
    writeHeartbeat(cacheDir, { ts: "2026-05-07T10:00:00.000Z", pid: 4242, generation: 12 });
    const raw = readFileSync(heartbeatPath(cacheDir), "utf8").trim();
    expect(JSON.parse(raw)).toEqual({
      ts: "2026-05-07T10:00:00.000Z",
      pid: 4242,
      generation: 12,
    });
  });

  it("writes are durable across multiple sequential calls (atomic primitive)", () => {
    for (let i = 1; i <= 5; i++) {
      writeManagerState(cacheDir, { generation: i, roster: [] });
    }
    expect(readManagerState(cacheDir).generation).toBe(5);
  });
});

describe("nextGeneration", () => {
  it("returns 1 for empty state", () => {
    expect(nextGeneration({ generation: 0, roster: [] })).toBe(1);
  });
  it("increments by 1", () => {
    expect(nextGeneration({ generation: 42, roster: [] })).toBe(43);
  });
});
