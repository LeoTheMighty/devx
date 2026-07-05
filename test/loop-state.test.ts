// Loop run-state persistence + crash recovery + JSONL log (v2l101 —
// src/lib/loop/state.ts).

import { existsSync, mkdirSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  appendEvent,
  errorChainText,
  eventsPath,
  loopStatePath,
  newRunId,
  readEvents,
  readLoopState,
  recoverStaleLoopState,
  reportsCopyPath,
  serializeError,
  writeLoopState,
  type LoopState,
} from "../src/lib/loop/state.js";

let cacheDir: string;
beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), "devx-loop-state-"));
});
afterEach(() => rmSync(cacheDir, { recursive: true, force: true }));

function running(overrides: Partial<LoopState> = {}): LoopState {
  return {
    status: "running",
    pid: process.pid,
    ts: new Date().toISOString(),
    run_id: "loop-test-1",
    started_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("state.json round-trip", () => {
  it("writes the dispatcher-probed shape ({status, pid, ts}) at .devx-cache/loop/state.json", () => {
    writeLoopState(cacheDir, running());
    const raw = JSON.parse(readFileSync(loopStatePath(cacheDir), "utf8"));
    // gather.ts row 1 reads exactly these keys — pin them.
    expect(raw.status).toBe("running");
    expect(raw.pid).toBe(process.pid);
    expect(typeof raw.ts).toBe("string");
    expect(loopStatePath(cacheDir)).toBe(join(cacheDir, "loop", "state.json"));
  });

  it("round-trips through readLoopState", () => {
    const state = running({ abort_reason: undefined });
    writeLoopState(cacheDir, state);
    expect(readLoopState(cacheDir)).toEqual(state);
  });

  it("returns null on missing / corrupt / wrong-shape files", () => {
    expect(readLoopState(cacheDir)).toBeNull();
    mkdirSync(dirname(loopStatePath(cacheDir)), { recursive: true });
    writeFileSync(loopStatePath(cacheDir), "{ torn json", "utf8");
    expect(readLoopState(cacheDir)).toBeNull();
    writeFileSync(loopStatePath(cacheDir), JSON.stringify({ status: "running" }), "utf8");
    expect(readLoopState(cacheDir)).toBeNull();
  });

  it("writes atomically — no partial state.json even with tmp residue around", () => {
    writeLoopState(cacheDir, running());
    // Plant a leftover tmp (as a crash mid-write would).
    writeFileSync(loopStatePath(cacheDir) + ".tmp.999.dead", "{ half writ", "utf8");
    const read = readLoopState(cacheDir);
    expect(read?.status).toBe("running");
  });
});

describe("recoverStaleLoopState (crash orphan → aborted)", () => {
  it("rewrites a running state whose PID is dead", () => {
    writeLoopState(cacheDir, running({ pid: 999_999_999 }));
    const recovered = recoverStaleLoopState(cacheDir, () => false, () => new Date("2026-07-06T07:00:00Z"));
    expect(recovered?.status).toBe("aborted");
    expect(recovered?.abort_reason).toMatch(/crash-orphaned/);
    expect(readLoopState(cacheDir)?.status).toBe("aborted");
  });

  it("leaves a live running state alone", () => {
    writeLoopState(cacheDir, running());
    expect(recoverStaleLoopState(cacheDir, () => true)).toBeNull();
    expect(readLoopState(cacheDir)?.status).toBe("running");
  });

  it("no-ops on stopped/aborted/missing state", () => {
    expect(recoverStaleLoopState(cacheDir, () => false)).toBeNull();
    writeLoopState(cacheDir, running({ status: "stopped" }));
    expect(recoverStaleLoopState(cacheDir, () => false)).toBeNull();
  });
});

describe("JSONL lifecycle log", () => {
  it("appends one JSON line per event and reads them back", () => {
    const runId = "loop-test-run";
    appendEvent(cacheDir, runId, "loop:start", { pid: 1 }, () => new Date("2026-07-05T22:00:00Z"));
    appendEvent(cacheDir, runId, "iteration:start", {
      iteration: 1,
      git: { head: "abc", branch: "feat/dev-x", commitCount: 0, dirty: false },
    });
    const events = readEvents(cacheDir, runId);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ event: "loop:start", pid: 1, ts: "2026-07-05T22:00:00.000Z" });
    expect(events[1]).toMatchObject({
      event: "iteration:start",
      git: { head: "abc", branch: "feat/dev-x" },
    });
  });

  it("skips torn lines instead of throwing (kill -9 mid-append)", () => {
    const runId = "loop-torn";
    appendEvent(cacheDir, runId, "a");
    writeFileSync(eventsPath(cacheDir, runId), readFileSync(eventsPath(cacheDir, runId), "utf8") + '{"event":"torn', "utf8");
    appendEvent(cacheDir, runId, "b"); // appended AFTER the torn line
    const events = readEvents(cacheDir, runId);
    expect(events.map((e) => e.event)).toContain("a");
    // The torn line is skipped; the log stays readable.
    expect(events.every((e) => e.event !== "torn")).toBe(true);
  });

  it("logging failures return false, never throw", () => {
    // A file planted where the run dir should be forces mkdir to fail.
    writeFileSync(join(cacheDir, "blocked"), "", "utf8");
    const ok = appendEvent(join(cacheDir, "blocked"), "x", "evt");
    expect(ok).toBe(false);
  });
});

describe("serializeError (depth-bounded cause chains)", () => {
  it("serializes name/message/stack + nested causes", () => {
    const inner = new Error("connect ECONNREFUSED");
    const outer = new TypeError("fetch failed", { cause: inner });
    const s = serializeError(outer);
    expect(typeof s).not.toBe("string");
    if (typeof s !== "string") {
      expect(s.name).toBe("TypeError");
      expect(s.message).toBe("fetch failed");
      expect(typeof s.cause).not.toBe("string");
      if (typeof s.cause === "object") expect(s.cause?.message).toBe("connect ECONNREFUSED");
    }
  });

  it("bounds the chain depth (cyclic causes can't blow up the log)", () => {
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    (a as { cause?: unknown }).cause = b; // cycle
    const s = serializeError(b);
    expect(JSON.stringify(s)).toContain("cause chain truncated");
  });

  it("errorChainText flattens the chain for marker matching", () => {
    const chain = new Error("fetch failed", {
      cause: new Error("credit balance is too low"),
    });
    expect(errorChainText(chain)).toBe("fetch failed <- credit balance is too low");
  });
});

describe("run ids + report copy path", () => {
  it("run ids are sortable and pid-suffixed", () => {
    const id = newRunId(new Date("2026-07-05T22:15:30.123Z"), 4242);
    expect(id).toBe("loop-2026-07-05T22-15-30-123-4242");
  });

  it("the report copy lands where gather.ts probes (.devx-cache/reports/*.md)", () => {
    expect(reportsCopyPath(cacheDir, "loop-x")).toBe(join(cacheDir, "reports", "loop-x.md"));
    expect(existsSync(join(cacheDir, "reports"))).toBe(false); // lazy
  });
});

describe("hostile error objects (EC-LOW-8)", () => {
  it("serializeError survives throwing getters on stack/cause", () => {
    const hostile = new Error("surface");
    Object.defineProperty(hostile, "stack", { get() { throw new Error("gotcha"); } });
    Object.defineProperty(hostile, "cause", { get() { throw new Error("gotcha"); } });
    const s = serializeError(hostile);
    expect(typeof s).not.toBe("string");
    if (typeof s !== "string") expect(s.message).toBe("surface");
  });

  it("errorChainText survives a throwing cause getter", () => {
    const hostile = new Error("surface");
    Object.defineProperty(hostile, "cause", { get() { throw new Error("gotcha"); } });
    expect(errorChainText(hostile)).toBe("surface");
  });
});
