// Pure-function tests for mgr105 reconcile additions:
//   - backoffDecision({crash, now, backoffSeconds}) → "spawn" | "wait"
//   - reconcile.desiredBlocking emission when crash_count >= maxRestarts
//   - reconcile filters spawn candidates inside their backoff window
//
// Murat-lens AC: "backoff respect is unit-tested via reconcile.ts's pure
// decision (given {last_exit_at, crash_count, now} → 'spawn' or 'wait')."
//
// Tests are pure: no fs, no spawn, no clock — `now` is injected.

import { describe, expect, it } from "vitest";

import { type BacklogSnapshot } from "../src/lib/backlog/parse.js";
import {
  backoffDecision,
  reconcile,
} from "../src/lib/manage/reconcile.js";
import {
  type CrashRecord,
  type ManagerState,
  emptyManagerState,
} from "../src/lib/manage/state.js";

function row(
  hash: string,
  status:
    | "ready"
    | "in-progress"
    | "blocked"
    | "done"
    | "deleted"
    | "superseded",
  blocked_by: string[] = [],
  opts: { struck?: boolean; type?: "dev" } = {},
) {
  const type = opts.type ?? "dev";
  return {
    lineIndex: 0,
    raw: "",
    type,
    hash,
    path: `${type}/${type}-${hash}-2026-04-28T19:30-x.md`,
    title: "x",
    status,
    blocked_by,
    struck: opts.struck ?? false,
  };
}

function snapshot(partial: Partial<BacklogSnapshot> = {}): BacklogSnapshot {
  return {
    dev: partial.dev ?? [],
    interview: partial.interview ?? [],
    manual: partial.manual ?? [],
  };
}

function state(
  crashes: CrashRecord[] = [],
  rosterEntries: ManagerState["roster"] = [],
): ManagerState {
  return { ...emptyManagerState(), roster: rosterEntries, crashes };
}

const T0 = "2026-05-07T12:00:00.000Z";
const T0_MS = Date.parse(T0);

// ─── backoffDecision ────────────────────────────────────────────────────

describe("backoffDecision (Murat-lens pure decision)", () => {
  it("returns spawn when crash record is null", () => {
    expect(backoffDecision({ crash: null, now: T0_MS })).toBe("spawn");
  });

  it("returns spawn when crash_count is zero", () => {
    expect(
      backoffDecision({
        crash: {
          spec_hash: "h",
          crash_count: 0,
          last_exit_at: T0,
          last_exit_code: 0,
        },
        now: T0_MS,
      }),
    ).toBe("spawn");
  });

  it("returns wait when count=1 and elapsed < 10s (backoff[0])", () => {
    const elapsed = 9 * 1000;
    expect(
      backoffDecision({
        crash: {
          spec_hash: "h",
          crash_count: 1,
          last_exit_at: T0,
          last_exit_code: 42,
        },
        now: T0_MS + elapsed,
      }),
    ).toBe("wait");
  });

  it("returns spawn when count=1 and elapsed == 10s (boundary)", () => {
    const elapsed = 10 * 1000;
    expect(
      backoffDecision({
        crash: {
          spec_hash: "h",
          crash_count: 1,
          last_exit_at: T0,
          last_exit_code: 42,
        },
        now: T0_MS + elapsed,
      }),
    ).toBe("spawn");
  });

  it("respects backoff[1]=30s for crash_count=2", () => {
    expect(
      backoffDecision({
        crash: {
          spec_hash: "h",
          crash_count: 2,
          last_exit_at: T0,
          last_exit_code: 42,
        },
        now: T0_MS + 29 * 1000,
      }),
    ).toBe("wait");
    expect(
      backoffDecision({
        crash: {
          spec_hash: "h",
          crash_count: 2,
          last_exit_at: T0,
          last_exit_code: 42,
        },
        now: T0_MS + 30 * 1000,
      }),
    ).toBe("spawn");
  });

  it("clamps crash_count above backoff length to the last entry", () => {
    // count=10 with default [10,30,90,300] → use 300s (last).
    expect(
      backoffDecision({
        crash: {
          spec_hash: "h",
          crash_count: 10,
          last_exit_at: T0,
          last_exit_code: 42,
        },
        now: T0_MS + 299 * 1000,
      }),
    ).toBe("wait");
    expect(
      backoffDecision({
        crash: {
          spec_hash: "h",
          crash_count: 10,
          last_exit_at: T0,
          last_exit_code: 42,
        },
        now: T0_MS + 300 * 1000,
      }),
    ).toBe("spawn");
  });

  it("treats malformed last_exit_at as fail-open (spawn)", () => {
    expect(
      backoffDecision({
        crash: {
          spec_hash: "h",
          crash_count: 1,
          last_exit_at: "not-a-date",
          last_exit_code: 42,
        },
        now: T0_MS,
      }),
    ).toBe("spawn");
  });

  it("respects custom backoffSeconds", () => {
    expect(
      backoffDecision({
        crash: {
          spec_hash: "h",
          crash_count: 1,
          last_exit_at: T0,
          last_exit_code: 42,
        },
        now: T0_MS + 4 * 1000,
        backoffSeconds: [5, 25],
      }),
    ).toBe("wait");
    expect(
      backoffDecision({
        crash: {
          spec_hash: "h",
          crash_count: 1,
          last_exit_at: T0,
          last_exit_code: 42,
        },
        now: T0_MS + 5 * 1000,
        backoffSeconds: [5, 25],
      }),
    ).toBe("spawn");
  });

  it("falls back to defaults when backoffSeconds is empty / negative", () => {
    expect(
      backoffDecision({
        crash: {
          spec_hash: "h",
          crash_count: 1,
          last_exit_at: T0,
          last_exit_code: 42,
        },
        now: T0_MS + 9 * 1000,
        backoffSeconds: [],
      }),
    ).toBe("wait");
    expect(
      backoffDecision({
        crash: {
          spec_hash: "h",
          crash_count: 1,
          last_exit_at: T0,
          last_exit_code: 42,
        },
        now: T0_MS + 9 * 1000,
        backoffSeconds: [-5, -10],
      }),
    ).toBe("wait");
  });
});

// ─── reconcile + crashes ────────────────────────────────────────────────

describe("reconcile (mgr105 — backoff window respected)", () => {
  it("skips a ready spec inside its backoff window", () => {
    const r = reconcile(
      state([
        {
          spec_hash: "h1",
          crash_count: 1,
          last_exit_at: T0,
          last_exit_code: 42,
        },
      ]),
      snapshot({ dev: [row("h1", "ready")] }),
      { now: () => new Date(T0_MS + 5 * 1000) }, // 5s elapsed; need 10s
    );
    expect(r.desiredSpawns).toEqual([]);
    expect(r.desiredBlocking).toEqual([]);
  });

  it("spawns the spec once the backoff window has elapsed", () => {
    const r = reconcile(
      state([
        {
          spec_hash: "h1",
          crash_count: 1,
          last_exit_at: T0,
          last_exit_code: 42,
        },
      ]),
      snapshot({ dev: [row("h1", "ready")] }),
      { now: () => new Date(T0_MS + 11 * 1000) },
    );
    expect(r.desiredSpawns).toHaveLength(1);
    expect(r.desiredSpawns[0].spec_hash).toBe("h1");
  });

  it("picks the next backlog-ready spec when first is in backoff", () => {
    const r = reconcile(
      state([
        {
          spec_hash: "h1",
          crash_count: 1,
          last_exit_at: T0,
          last_exit_code: 42,
        },
      ]),
      snapshot({
        dev: [row("h1", "ready"), row("h2", "ready")],
      }),
      { now: () => new Date(T0_MS + 5 * 1000) },
    );
    // h1 in backoff → skip; h2 has no crash record → spawn h2.
    expect(r.desiredSpawns).toHaveLength(1);
    expect(r.desiredSpawns[0].spec_hash).toBe("h2");
  });
});

describe("reconcile (mgr105 — desiredBlocking when crash_count >= maxRestarts)", () => {
  it("emits desiredBlocking for a maxed-out spec; suppresses its spawn", () => {
    const r = reconcile(
      state([
        {
          spec_hash: "h1",
          crash_count: 5,
          last_exit_at: T0,
          last_exit_code: 42,
        },
      ]),
      snapshot({ dev: [row("h1", "ready"), row("h2", "ready")] }),
      {
        maxRestarts: 5,
        now: () => new Date(T0_MS + 999 * 1000),
      },
    );
    expect(r.desiredBlocking).toEqual([
      { spec_hash: "h1", crash_count: 5, last_exit_code: 42 },
    ]);
    // h1 about to be blocked → skip; h2 has no crashes → spawn h2.
    expect(r.desiredSpawns).toHaveLength(1);
    expect(r.desiredSpawns[0].spec_hash).toBe("h2");
  });

  it("respects custom maxRestarts (3)", () => {
    const r = reconcile(
      state([
        {
          spec_hash: "h1",
          crash_count: 3,
          last_exit_at: T0,
          last_exit_code: 7,
        },
      ]),
      snapshot({ dev: [row("h1", "ready")] }),
      {
        maxRestarts: 3,
        now: () => new Date(T0_MS + 999 * 1000),
      },
    );
    expect(r.desiredBlocking).toHaveLength(1);
    expect(r.desiredBlocking[0].spec_hash).toBe("h1");
  });

  it("does NOT emit desiredBlocking when crash_count is below maxRestarts", () => {
    const r = reconcile(
      state([
        {
          spec_hash: "h1",
          crash_count: 4,
          last_exit_at: T0,
          last_exit_code: 42,
        },
      ]),
      snapshot({ dev: [row("h1", "ready")] }),
      {
        maxRestarts: 5,
        now: () => new Date(T0_MS + 999 * 1000),
      },
    );
    expect(r.desiredBlocking).toEqual([]);
  });

  it("emits desiredBlocking for multiple maxed-out specs in DEV.md order", () => {
    const r = reconcile(
      state([
        {
          spec_hash: "h2",
          crash_count: 5,
          last_exit_at: T0,
          last_exit_code: 1,
        },
        {
          spec_hash: "h1",
          crash_count: 5,
          last_exit_at: T0,
          last_exit_code: 2,
        },
      ]),
      snapshot({ dev: [row("h1", "ready"), row("h2", "ready")] }),
      {
        maxRestarts: 5,
        now: () => new Date(T0_MS + 999 * 1000),
      },
    );
    // Order matches DEV.md row order, not crashes-array order.
    expect(r.desiredBlocking.map((b) => b.spec_hash)).toEqual(["h1", "h2"]);
  });

  it("preserves last_exit_code as a string for synthetic exits", () => {
    const r = reconcile(
      state([
        {
          spec_hash: "h1",
          crash_count: 5,
          last_exit_at: T0,
          last_exit_code: "manager-restart-detected",
        },
      ]),
      snapshot({ dev: [row("h1", "ready")] }),
      { maxRestarts: 5, now: () => new Date(T0_MS + 999 * 1000) },
    );
    expect(r.desiredBlocking[0].last_exit_code).toBe("manager-restart-detected");
  });

  it("does NOT emit desiredBlocking for non-ready specs (already done/blocked)", () => {
    const r = reconcile(
      state([
        {
          spec_hash: "h1",
          crash_count: 5,
          last_exit_at: T0,
          last_exit_code: 42,
        },
      ]),
      snapshot({ dev: [row("h1", "blocked")] }),
      { maxRestarts: 5, now: () => new Date(T0_MS + 999 * 1000) },
    );
    // Already blocked — no point re-emitting.
    expect(r.desiredBlocking).toEqual([]);
  });
});
