// Tests for src/lib/manage/reconcile.ts (mgr103). Pure-function tests only —
// no fs, no spawn. Eight fixtures + cap-enforcement test per AC.
//
// Fixtures (numbered to match spec ACs):
//   1. empty backlog                  — no dev rows; no spawn, no kill
//   2. one ready spec                 — spawn it
//   3. one ready + one running        — no spawn (cap full); no kill
//   4. INTERVIEW unblock              — status-log line emitted
//   5. MANUAL unblock                 — status-log line emitted
//   6. superseded entry               — kill if running; skip for spawn
//   7. blocked-by chain               — only spec with all-done deps spawnable
//   8. cap full + ready specs         — empty desiredSpawns (silent skip)
//
// Plus:
//   9. enforceHardCap exact-message   — AC #6 verbatim
//  10. completed worker               — kill (reason=done) + clears slot
//  11. opts.killAbsent                — covers the absent-from-DEV.md branch

import { describe, expect, it } from "vitest";

import {
  type BacklogSnapshot,
} from "../src/lib/backlog/parse.js";
import {
  HARD_CAP_PHASE_1,
  type DesiredSpawn,
  enforceHardCap,
  reconcile,
} from "../src/lib/manage/reconcile.js";
import {
  type ManagerState,
  type RosterEntry,
  emptyManagerState,
} from "../src/lib/manage/state.js";

// ─── Helpers ────────────────────────────────────────────────────────────

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
  opts: { struck?: boolean; type?: "dev" | "plan" | "test" } = {},
) {
  const type = opts.type ?? "dev";
  return {
    lineIndex: 0,
    raw: `- [${
      status === "ready"
        ? " "
        : status === "in-progress"
        ? "/"
        : status === "blocked"
        ? "-"
        : "x"
    }] \`${type}/${type}-${hash}-2026-04-28T19:30-x.md\``,
    type,
    hash,
    path: `${type}/${type}-${hash}-2026-04-28T19:30-x.md`,
    title: "x",
    status,
    blocked_by,
    struck: opts.struck ?? false,
  };
}

function rosterEntry(spec_hash: string, pid = 12345): RosterEntry {
  return {
    pid,
    spec_hash,
    started_at: "2026-05-07T10:00:00-06:00",
    crash_count: 0,
  };
}

function snapshot(partial: Partial<BacklogSnapshot> = {}): BacklogSnapshot {
  return {
    dev: partial.dev ?? [],
    interview: partial.interview ?? [],
    manual: partial.manual ?? [],
  };
}

function state(roster: RosterEntry[] = []): ManagerState {
  return { ...emptyManagerState(), roster };
}

// ─── Fixture 1: empty backlog ───────────────────────────────────────────

describe("reconcile (fixture 1: empty backlog)", () => {
  it("emits no spawn, no kill, no status-log", () => {
    const r = reconcile(state(), snapshot());
    expect(r.desiredSpawns).toEqual([]);
    expect(r.desiredKills).toEqual([]);
    expect(r.statusLogUpdates).toEqual([]);
  });
});

// ─── Fixture 2: one ready spec ──────────────────────────────────────────

describe("reconcile (fixture 2: one ready spec)", () => {
  it("emits a spawn for the ready spec", () => {
    const r = reconcile(
      state(),
      snapshot({ dev: [row("aaa01", "ready")] }),
    );
    expect(r.desiredSpawns).toHaveLength(1);
    expect(r.desiredSpawns[0]).toMatchObject({
      spec_hash: "aaa01",
      worker_class: "dev",
    });
    expect(r.desiredKills).toEqual([]);
  });

  it("uses opts.defaultModel when provided", () => {
    const r = reconcile(
      state(),
      snapshot({ dev: [row("aaa01", "ready")] }),
      { defaultModel: "claude-haiku-4-5" },
    );
    expect(r.desiredSpawns[0].model).toBe("claude-haiku-4-5");
  });

  it("uses state.model as fallback when opts.defaultModel absent", () => {
    const r = reconcile(
      { ...state(), model: "claude-opus-4-7" },
      snapshot({ dev: [row("aaa01", "ready")] }),
    );
    expect(r.desiredSpawns[0].model).toBe("claude-opus-4-7");
  });

  it("falls back past empty-string state.model to DEFAULT_MODEL (Blind Hunter BH#16 / EC#10)", () => {
    const r = reconcile(
      { ...state(), model: "" },
      snapshot({ dev: [row("aaa01", "ready")] }),
    );
    expect(r.desiredSpawns[0].model).toBe("claude-sonnet-4-6");
  });
});

// ─── Fixture 3: one ready + one running ─────────────────────────────────

describe("reconcile (fixture 3: ready + running, cap full)", () => {
  it("emits no spawn (cap=1 full); no kill", () => {
    const r = reconcile(
      state([rosterEntry("aaa01")]),
      snapshot({
        dev: [row("aaa01", "in-progress"), row("bbb02", "ready")],
      }),
    );
    expect(r.desiredSpawns).toEqual([]);
    expect(r.desiredKills).toEqual([]);
  });
});

// ─── Fixture 4: INTERVIEW unblock ───────────────────────────────────────

describe("reconcile (fixture 4: INTERVIEW unblock)", () => {
  it("emits status-log line for blocked spec when answering Q lists it in blocks", () => {
    const r = reconcile(
      state(),
      snapshot({
        dev: [row("a10003", "blocked")],
        interview: [{ qNum: "8", answered: true, blocks: ["a10003"] }],
      }),
    );
    expect(r.statusLogUpdates).toHaveLength(1);
    expect(r.statusLogUpdates[0]).toEqual({
      spec_hash: "a10003",
      line: "manager: detected INTERVIEW Q#8 answered → spec dev-a10003 unblocked",
    });
  });

  it("does NOT emit when the spec is no longer blocked (already transitioned)", () => {
    const r = reconcile(
      state(),
      snapshot({
        dev: [row("a10003", "ready")],
        interview: [{ qNum: "8", answered: true, blocks: ["a10003"] }],
      }),
    );
    expect(r.statusLogUpdates).toEqual([]);
  });

  it("does NOT emit when the Q is unanswered", () => {
    const r = reconcile(
      state(),
      snapshot({
        dev: [row("a10003", "blocked")],
        interview: [{ qNum: "8", answered: false, blocks: ["a10003"] }],
      }),
    );
    expect(r.statusLogUpdates).toEqual([]);
  });
});

// ─── Fixture 5: MANUAL unblock ──────────────────────────────────────────

describe("reconcile (fixture 5: MANUAL unblock)", () => {
  it("emits status-log line for blocked spec when MANUAL item checked", () => {
    const r = reconcile(
      state(),
      snapshot({
        dev: [row("a10004", "blocked")],
        manual: [{ id: "M1.2", checked: true, blocks: ["a10004"] }],
      }),
    );
    expect(r.statusLogUpdates).toHaveLength(1);
    expect(r.statusLogUpdates[0]).toEqual({
      spec_hash: "a10004",
      line: "manager: detected MANUAL M1.2 checked → spec dev-a10004 unblocked",
    });
  });

  it("emits one line per (M, blocked-spec) pair", () => {
    const r = reconcile(
      state(),
      snapshot({
        dev: [row("x01", "blocked"), row("x02", "blocked")],
        manual: [{ id: "M9.9", checked: true, blocks: ["x01", "x02"] }],
      }),
    );
    expect(r.statusLogUpdates.map((u) => u.spec_hash)).toEqual(["x01", "x02"]);
  });
});

// ─── Fixture 6: superseded entry ────────────────────────────────────────

describe("reconcile (fixture 6: superseded entry)", () => {
  it("kills a running worker whose spec is now superseded", () => {
    const r = reconcile(
      state([rosterEntry("old001", 99001)]),
      snapshot({ dev: [row("old001", "superseded", [], { struck: true })] }),
    );
    expect(r.desiredKills).toHaveLength(1);
    expect(r.desiredKills[0]).toMatchObject({
      pid: 99001,
      spec_hash: "old001",
      reason: "superseded",
    });
  });

  it("skips superseded specs when picking a candidate to spawn", () => {
    const r = reconcile(
      state(),
      snapshot({
        dev: [
          row("old001", "ready", [], { struck: true }),
          row("good01", "ready"),
        ],
      }),
    );
    expect(r.desiredSpawns).toHaveLength(1);
    expect(r.desiredSpawns[0].spec_hash).toBe("good01");
  });
});

// ─── Fixture 7: blocked-by chain ────────────────────────────────────────

describe("reconcile (fixture 7: blocked-by chain)", () => {
  it("only the spec with all-done deps is eligible to spawn", () => {
    const r = reconcile(
      state(),
      snapshot({
        dev: [
          row("up001", "done"), // upstream finished
          row("mid01", "ready", ["up001"]), // dep done → eligible
          row("late1", "ready", ["mid01"]), // dep ready (not done) → ineligible
        ],
      }),
    );
    expect(r.desiredSpawns).toHaveLength(1);
    expect(r.desiredSpawns[0].spec_hash).toBe("mid01");
  });

  it("treats unknown blocker hash as unresolved (conservative skip)", () => {
    const r = reconcile(
      state(),
      snapshot({
        dev: [row("ghost1", "ready", ["nosuch"])],
      }),
    );
    expect(r.desiredSpawns).toEqual([]);
  });

  it("treats deleted/superseded blockers as settled (not blocking)", () => {
    const r = reconcile(
      state(),
      snapshot({
        dev: [
          row("dead1", "deleted", [], { struck: true }),
          row("rdy01", "ready", ["dead1"]),
        ],
      }),
    );
    expect(r.desiredSpawns).toHaveLength(1);
    expect(r.desiredSpawns[0].spec_hash).toBe("rdy01");
  });
});

// ─── Fixture 8: cap full + multiple ready ───────────────────────────────

describe("reconcile (fixture 8: cap full + multiple ready)", () => {
  it("emits empty desiredSpawns silently (no error from reconcile itself)", () => {
    const r = reconcile(
      state([rosterEntry("running1")]),
      snapshot({
        dev: [
          row("running1", "in-progress"),
          row("ready01", "ready"),
          row("ready02", "ready"),
          row("ready03", "ready"),
        ],
      }),
    );
    expect(r.desiredSpawns).toEqual([]);
    expect(HARD_CAP_PHASE_1).toBe(1);
  });
});

// ─── Cap enforcement (AC #6) ────────────────────────────────────────────

describe("enforceHardCap (AC #6 — exact error message)", () => {
  it("throws the exact pinned message when spawn-2 attempted", () => {
    const roster = [rosterEntry("hash1")];
    const candidate: DesiredSpawn = {
      spec_hash: "hash2",
      worker_class: "dev",
      model: "claude-sonnet-4-6",
    };
    expect(() => enforceHardCap(roster, [candidate])).toThrow(
      "Phase 1 hard cap: cannot spawn second worker (running: hash1)",
    );
  });

  it("does NOT throw when total stays at or below cap", () => {
    expect(() => enforceHardCap([], [])).not.toThrow();
    expect(() =>
      enforceHardCap(
        [],
        [{ spec_hash: "h", worker_class: "dev", model: "m" }],
      ),
    ).not.toThrow();
    expect(() => enforceHardCap([rosterEntry("h1")], [])).not.toThrow();
  });

  it("falls back to 'unknown' running hash when roster is unexpectedly empty (defensive)", () => {
    // If a programmatic caller passes desiredSpawns.length > HARD_CAP without
    // a roster entry, the message should still render (no crash on
    // roster[0]?.spec_hash undefined).
    const a: DesiredSpawn = { spec_hash: "h2", worker_class: "dev", model: "m" };
    const b: DesiredSpawn = { spec_hash: "h3", worker_class: "dev", model: "m" };
    expect(() => enforceHardCap([], [a, b])).toThrow(
      "Phase 1 hard cap: cannot spawn second worker (running: unknown)",
    );
  });
});

// ─── Worker completion → kill ───────────────────────────────────────────

describe("reconcile (worker completion → kill, slot released)", () => {
  it("kills a worker whose spec is now done; spawns next ready spec same tick", () => {
    const r = reconcile(
      state([rosterEntry("done01", 71001)]),
      snapshot({
        dev: [row("done01", "done"), row("next01", "ready")],
      }),
    );
    expect(r.desiredKills).toHaveLength(1);
    expect(r.desiredKills[0]).toMatchObject({
      pid: 71001,
      spec_hash: "done01",
      reason: "done",
    });
    // Slot released → cap free → spawn the next ready spec.
    expect(r.desiredSpawns).toHaveLength(1);
    expect(r.desiredSpawns[0].spec_hash).toBe("next01");
  });
});

// ─── Absent-from-DEV.md branch ──────────────────────────────────────────

describe("reconcile (opts.killAbsent)", () => {
  it("default leaves an absent-spec roster entry alone", () => {
    const r = reconcile(
      state([rosterEntry("ghost1")]),
      snapshot({ dev: [row("other1", "ready")] }),
    );
    expect(r.desiredKills).toEqual([]);
    // Cap still considers ghost1 as occupying the slot.
    expect(r.desiredSpawns).toEqual([]);
  });

  it("opt-in killAbsent emits a kill with reason=absent", () => {
    const r = reconcile(
      state([rosterEntry("ghost1", 88002)]),
      snapshot({ dev: [row("other1", "ready")] }),
      { killAbsent: true },
    );
    expect(r.desiredKills).toEqual([
      { pid: 88002, spec_hash: "ghost1", reason: "absent" },
    ]);
    // Slot released → can spawn next ready.
    expect(r.desiredSpawns[0].spec_hash).toBe("other1");
  });
});

// ─── Skip rosterized specs when picking spawn ───────────────────────────

describe("reconcile (running spec not re-spawned)", () => {
  it("does not spawn a spec whose hash is already in the living roster", () => {
    // Pathological hand-edit: spec has status: ready in DEV.md but a worker
    // is running it. Reconcile must skip — never spawn a duplicate worker.
    const r = reconcile(
      state([rosterEntry("dupe01")]),
      snapshot({ dev: [row("dupe01", "ready")] }),
    );
    expect(r.desiredSpawns).toEqual([]);
  });
});

// ─── Non-dev spec stem in status-log line ───────────────────────────────

describe("reconcile (status-log stem for non-dev specs)", () => {
  it("renders correct stem prefix for plan-* rows (BH#11)", () => {
    const planRow = row("p01001", "blocked", [], { type: "plan" });
    const r = reconcile(
      state(),
      snapshot({
        dev: [planRow],
        manual: [{ id: "MP0.1", checked: true, blocks: ["p01001"] }],
      }),
    );
    expect(r.statusLogUpdates[0].line).toBe(
      "manager: detected MANUAL MP0.1 checked → spec plan-p01001 unblocked",
    );
  });
});

// ─── Stale Q (blocks list refers to spec absent from DEV.md) ────────────

describe("reconcile (stale Q referencing absent spec)", () => {
  it("silently drops the unblock line when target spec is not in DEV.md (EC#11)", () => {
    const r = reconcile(
      state(),
      snapshot({
        dev: [],
        interview: [{ qNum: "99", answered: true, blocks: ["ghost1"] }],
      }),
    );
    expect(r.statusLogUpdates).toEqual([]);
  });
});

// ─── Multi-Q blocks-same-spec emits multi-line audit ────────────────────

describe("reconcile (multiple Qs blocking the same spec)", () => {
  it("emits one line per (Q, spec) pair for audit-trail completeness (EC#8)", () => {
    const r = reconcile(
      state(),
      snapshot({
        dev: [row("multi1", "blocked")],
        interview: [
          { qNum: "7", answered: true, blocks: ["multi1"] },
          { qNum: "8", answered: true, blocks: ["multi1"] },
        ],
      }),
    );
    expect(r.statusLogUpdates).toHaveLength(2);
    expect(r.statusLogUpdates[0].line).toContain("Q#7");
    expect(r.statusLogUpdates[1].line).toContain("Q#8");
  });
});

// ─── First-write-wins on duplicate hashes ───────────────────────────────

describe("reconcile (duplicate hash in DEV.md)", () => {
  it("uses the first-occurring row when DEV.md has a duplicate hash", () => {
    const r = reconcile(
      state(),
      snapshot({
        dev: [
          row("dup001", "blocked"), // first → wins
          row("dup001", "ready"), // ignored
        ],
      }),
    );
    // First row is blocked → no spawn.
    expect(r.desiredSpawns).toEqual([]);
  });
});
