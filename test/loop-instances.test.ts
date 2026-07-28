// Loop instance registry tests (mlc105) — the per-run replacement for the
// singleton `loop/state.json`. Companion to the E-5 eval
// (_devx/workstreams/multi-loop-concurrency/evals/E-5_instance-registry.ts):
// the eval proves the CLI end-to-end (devx next aggregates two live
// instances, excludes a dead one, the admission surface exists); this suite
// pins the module semantics the eval can't isolate —
//   - liveness is freshness AND pid, never one of the two;
//   - future-dated heartbeats are stale in BOTH directions;
//   - admission counts LIVE instances only, and its refusal names the knob,
//     the count and the run-ids;
//   - finalize marks stopped AND drops the lock, so a finished run stops
//     eating a capacity slot immediately;
//   - the reapers only ever delete inert files.

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  LOOP_INSTANCE_SCHEMA,
  SCRATCH_TTL_MS,
  STOPPED_INSTANCE_TTL_MS,
  admitLoop,
  classifyInstance,
  finalizeInstance,
  heartbeatInstance,
  instanceLockPath,
  instancePath,
  instancesDir,
  listInstances,
  listLiveInstances,
  parseInstance,
  reapScratch,
  reapStoppedInstances,
  registerInstance,
  scratchDir,
  type LoopInstance,
} from "../src/lib/loop/instances.js";
import { MAX_CONCURRENT_DEFAULT, maxConcurrentFrom } from "../src/lib/loop/config.js";

/** A PID that provably belonged to an already-exited process. */
function deadPid(): number {
  const child = spawnSync("true");
  return child.pid ?? 999_999;
}

const tmps: string[] = [];
function mkCache(): string {
  const dir = mkdtempSync(join(tmpdir(), "devx-instances-"));
  tmps.push(dir);
  return join(dir, ".devx-cache");
}
afterEach(() => {
  while (tmps.length > 0) {
    rmSync(tmps.pop()!, { recursive: true, force: true });
  }
});

const NOW = new Date("2026-07-28T12:00:00.000Z");
const ALIVE = () => true;

function seed(
  cacheDir: string,
  runId: string,
  patch: Partial<LoopInstance> = {},
): LoopInstance {
  const inst: LoopInstance = {
    schema: LOOP_INSTANCE_SCHEMA,
    run_id: runId,
    pid: process.pid,
    pid_started_at: null,
    started_at: NOW.toISOString(),
    scope: null,
    status: "running",
    current_item: null,
    iteration: 0,
    ts: NOW.toISOString(),
    ...patch,
  };
  mkdirSync(instancesDir(cacheDir), { recursive: true });
  writeFileSync(instancePath(cacheDir, runId), JSON.stringify(inst), "utf8");
  return inst;
}

const probes = {
  now: () => NOW,
  freshMs: 180_000,
  pidAlive: ALIVE,
  pidStartedAt: () => null,
};

// ---------------------------------------------------------------------------

describe("parseInstance", () => {
  it("round-trips a v1 record", () => {
    const inst = seed(mkCache(), "loop-a");
    expect(parseInstance(JSON.stringify(inst))).toEqual(inst);
  });

  it("rejects an unknown future schema rather than judging it by v1 rules", () => {
    const raw = JSON.stringify({
      schema: 99,
      run_id: "loop-future",
      pid: 1,
      ts: NOW.toISOString(),
      status: "running",
    });
    expect(parseInstance(raw)).toBeNull();
  });

  it.each([
    ["garbage", "not json"],
    ["array", "[]"],
    ["missing run_id", JSON.stringify({ schema: 1, pid: 1, ts: "x", status: "running" })],
    [
      "invalid pid",
      JSON.stringify({
        schema: 1,
        run_id: "r",
        pid: 0,
        ts: NOW.toISOString(),
        status: "running",
      }),
    ],
    [
      "unknown status",
      JSON.stringify({
        schema: 1,
        run_id: "r",
        pid: 1,
        ts: NOW.toISOString(),
        status: "zombie",
      }),
    ],
  ])("rejects %s", (_label, raw) => {
    expect(parseInstance(raw)).toBeNull();
  });
});

describe("classifyInstance", () => {
  it("fresh heartbeat + live pid ⇒ live", () => {
    const cache = mkCache();
    const inst = seed(cache, "loop-a");
    expect(classifyInstance(inst, probes).kind).toBe("live");
  });

  it("fresh heartbeat + DEAD pid ⇒ dead (freshness alone never means live)", () => {
    const cache = mkCache();
    const inst = seed(cache, "loop-dead", { pid: deadPid() });
    expect(
      classifyInstance(inst, { ...probes, pidAlive: undefined }).kind,
    ).toBe("dead");
  });

  it("live pid + STALE heartbeat ⇒ stale (pid alone never means live)", () => {
    const cache = mkCache();
    const inst = seed(cache, "loop-stale", {
      ts: new Date(NOW.getTime() - 600_000).toISOString(),
    });
    expect(classifyInstance(inst, probes).kind).toBe("stale");
  });

  it("FUTURE-dated heartbeat is stale too (clock skew must not pin a run live)", () => {
    const cache = mkCache();
    const inst = seed(cache, "loop-future", {
      ts: new Date(NOW.getTime() + 600_000).toISOString(),
    });
    expect(classifyInstance(inst, probes).kind).toBe("stale");
  });

  it("recycled pid ⇒ dead (probe start-time after the record + grace)", () => {
    const cache = mkCache();
    const inst = seed(cache, "loop-recycled", {
      pid_started_at: new Date(NOW.getTime() - 60_000).toISOString(),
    });
    expect(
      classifyInstance(inst, {
        ...probes,
        pidStartedAt: () => new Date(NOW.getTime() - 1_000),
      }).kind,
    ).toBe("dead");
  });

  it("null recorded start time skips the recycling cross-check", () => {
    const cache = mkCache();
    const inst = seed(cache, "loop-norecord", { pid_started_at: null });
    expect(
      classifyInstance(inst, {
        ...probes,
        pidStartedAt: () => new Date(NOW.getTime() + 3_600_000),
      }).kind,
    ).toBe("live");
  });

  it("stopped/aborted records classify finished regardless of freshness", () => {
    const cache = mkCache();
    for (const status of ["stopped", "aborted"] as const) {
      const inst = seed(cache, `loop-${status}`, { status });
      expect(classifyInstance(inst, probes).kind).toBe("finished");
    }
  });

  it("unparseable ts ⇒ stale, never live", () => {
    const cache = mkCache();
    const inst = seed(cache, "loop-badts", { ts: "not-a-date" });
    expect(classifyInstance(inst, probes).kind).toBe("stale");
  });
});

describe("listInstances / listLiveInstances", () => {
  it("returns only live instances, freshest first", () => {
    const cache = mkCache();
    seed(cache, "loop-old", { ts: new Date(NOW.getTime() - 60_000).toISOString() });
    seed(cache, "loop-new");
    seed(cache, "loop-dead", { pid: deadPid() });
    seed(cache, "loop-done", { status: "stopped" });

    const live = listLiveInstances(cache, { ...probes, pidAlive: (p) => p === process.pid });
    expect(live.map((i) => i.run_id)).toEqual(["loop-new", "loop-old"]);
  });

  it("an absent registry dir is empty, not an error", () => {
    expect(listInstances(mkCache(), probes)).toEqual([]);
    expect(listLiveInstances(mkCache(), probes)).toEqual([]);
  });

  it("a corrupt instance file is skipped, not fatal", () => {
    const cache = mkCache();
    seed(cache, "loop-good");
    writeFileSync(instancePath(cache, "loop-bad"), "{{{", "utf8");
    expect(listInstances(cache, probes).map((i) => i.run_id)).toEqual(["loop-good"]);
  });

  it("non-.json entries are ignored", () => {
    const cache = mkCache();
    seed(cache, "loop-good");
    writeFileSync(join(instancesDir(cache), "README.txt"), "hi", "utf8");
    expect(listInstances(cache, probes)).toHaveLength(1);
  });
});

describe("admitLoop", () => {
  it("admits below the cap", () => {
    const cache = mkCache();
    seed(cache, "loop-a");
    const v = admitLoop(cache, 2, probes);
    expect(v.admitted).toBe(true);
    expect(v.live).toHaveLength(1);
    expect(v.message).toBeNull();
  });

  it("refuses at the cap, naming the knob, the count and the run-ids", () => {
    const cache = mkCache();
    seed(cache, "loop-a");
    seed(cache, "loop-b");
    const v = admitLoop(cache, 2, probes);
    expect(v.admitted).toBe(false);
    expect(v.message).toContain("capacity.max_concurrent is 2");
    expect(v.message).toContain("loop-a");
    expect(v.message).toContain("loop-b");
  });

  it("dead and finished instances never consume a capacity slot", () => {
    const cache = mkCache();
    seed(cache, "loop-dead", { pid: deadPid() });
    seed(cache, "loop-done", { status: "stopped" });
    seed(cache, "loop-stale", {
      ts: new Date(NOW.getTime() - 600_000).toISOString(),
    });
    const v = admitLoop(cache, 1, { ...probes, pidAlive: (p) => p === process.pid });
    expect(v.admitted).toBe(true);
    expect(v.live).toEqual([]);
  });
});

describe("maxConcurrentFrom", () => {
  it("reads capacity.max_concurrent", () => {
    expect(maxConcurrentFrom({ capacity: { max_concurrent: 7 } })).toBe(7);
  });

  it.each([
    ["absent", {}],
    ["non-object capacity", { capacity: 5 }],
    ["zero", { capacity: { max_concurrent: 0 } }],
    ["negative", { capacity: { max_concurrent: -3 } }],
    ["float", { capacity: { max_concurrent: 2.5 } }],
    ["string", { capacity: { max_concurrent: "3" } }],
  ])("falls back to the default for %s rather than refusing every loop", (_l, merged) => {
    expect(maxConcurrentFrom(merged)).toBe(MAX_CONCURRENT_DEFAULT);
  });
});

describe("register / heartbeat / finalize", () => {
  it("registers a running record and takes the per-run lock", () => {
    const cache = mkCache();
    const h = registerInstance(cache, {
      runId: "loop-x",
      startedAt: NOW,
      scope: "only:dev",
      ...probes,
    });
    expect(existsSync(instancePath(cache, "loop-x"))).toBe(true);
    expect(existsSync(instanceLockPath(cache, "loop-x"))).toBe(true);
    const [read] = listInstances(cache, probes);
    expect(read.status).toBe("running");
    expect(read.scope).toBe("only:dev");
    finalizeInstance(cache, h, "stopped", undefined, () => NOW);
  });

  it("heartbeat refreshes ts and carries progress", () => {
    const cache = mkCache();
    const later = new Date(NOW.getTime() + 30_000);
    const h = registerInstance(cache, { runId: "loop-x", startedAt: NOW, ...probes });
    heartbeatInstance(cache, h, { currentItem: "abc123", iteration: 3 }, () => later);
    const [read] = listInstances(cache, probes);
    expect(read.current_item).toBe("abc123");
    expect(read.iteration).toBe(3);
    expect(read.ts).toBe(later.toISOString());
    finalizeInstance(cache, h, "stopped", undefined, () => NOW);
  });

  it("finalize marks stopped AND releases the lock in one call", () => {
    const cache = mkCache();
    const h = registerInstance(cache, { runId: "loop-x", startedAt: NOW, ...probes });
    finalizeInstance(cache, h, "aborted", "boom", () => NOW);
    const [read] = listInstances(cache, probes);
    expect(read.status).toBe("aborted");
    expect(read.abort_reason).toBe("boom");
    expect(read.current_item).toBeNull();
    expect(existsSync(instanceLockPath(cache, "loop-x"))).toBe(false);
    // …and the slot is free immediately, not one freshness window later.
    expect(admitLoop(cache, 1, probes).admitted).toBe(true);
  });

  it("a second live run does NOT collide with the first (no singleton)", () => {
    const cache = mkCache();
    const a = registerInstance(cache, { runId: "loop-a", startedAt: NOW, ...probes });
    const b = registerInstance(cache, { runId: "loop-b", startedAt: NOW, ...probes });
    expect(listLiveInstances(cache, probes).map((i) => i.run_id).sort()).toEqual([
      "loop-a",
      "loop-b",
    ]);
    finalizeInstance(cache, a, "stopped", undefined, () => NOW);
    finalizeInstance(cache, b, "stopped", undefined, () => NOW);
  });

  it("the lock seam lets a caller run without touching the filesystem lock", () => {
    const cache = mkCache();
    let released = false;
    const h = registerInstance(cache, {
      runId: "loop-x",
      startedAt: NOW,
      acquireLock: () => ({ release: () => (released = true) }),
      ...probes,
    });
    expect(existsSync(instanceLockPath(cache, "loop-x"))).toBe(false);
    finalizeInstance(cache, h, "stopped", undefined, () => NOW);
    expect(released).toBe(true);
  });
});

describe("reapStoppedInstances", () => {
  const past = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

  it("removes finished records past the TTL", () => {
    const cache = mkCache();
    seed(cache, "loop-old", {
      status: "stopped",
      ts: past(STOPPED_INSTANCE_TTL_MS + 60_000),
    });
    expect(reapStoppedInstances(cache, probes)).toEqual(["loop-old.json"]);
    expect(existsSync(instancePath(cache, "loop-old"))).toBe(false);
  });

  it("keeps a RECENT finished record (the morning-report window)", () => {
    const cache = mkCache();
    seed(cache, "loop-recent", { status: "stopped", ts: past(60_000) });
    expect(reapStoppedInstances(cache, probes)).toEqual([]);
    expect(existsSync(instancePath(cache, "loop-recent"))).toBe(true);
  });

  it("never removes a LIVE record", () => {
    const cache = mkCache();
    seed(cache, "loop-live");
    expect(reapStoppedInstances(cache, probes)).toEqual([]);
    expect(existsSync(instancePath(cache, "loop-live"))).toBe(true);
  });

  it("keeps a FRESH crash orphan (evidence for the morning report)", () => {
    const cache = mkCache();
    seed(cache, "loop-orphan", { pid: deadPid(), ts: past(60_000) });
    expect(
      reapStoppedInstances(cache, { ...probes, pidAlive: (p) => p === process.pid }),
    ).toEqual([]);
    expect(existsSync(instancePath(cache, "loop-orphan"))).toBe(true);
  });

  it("never removes a stale-heartbeat record whose owner is still ALIVE", () => {
    // A starved process can miss beats for a long time. classifyInstance
    // short-circuits on staleness without probing the pid, so reaping on
    // that verdict alone would free a capacity slot out from under a run
    // that is still going (and still holding its per-run lock).
    const cache = mkCache();
    const wedged = seed(cache, "loop-wedged", {
      pid: process.pid,
      ts: past(STOPPED_INSTANCE_TTL_MS + 60_000),
    });
    expect(classifyInstance(wedged, probes).kind).toBe("stale");
    expect(
      reapStoppedInstances(cache, { ...probes, pidAlive: (p) => p === process.pid }),
    ).toEqual([]);
    expect(existsSync(instancePath(cache, "loop-wedged"))).toBe(true);
  });

  it("an absent registry dir reaps nothing and never throws", () => {
    expect(reapStoppedInstances(mkCache(), probes)).toEqual([]);
  });

  it("ages an unparseable file by mtime instead of deleting it blind", () => {
    const cache = mkCache();
    mkdirSync(instancesDir(cache), { recursive: true });
    const fresh = join(instancesDir(cache), "fresh.json");
    const old = join(instancesDir(cache), "old.json");
    writeFileSync(fresh, "{{{", "utf8");
    writeFileSync(old, "{{{", "utf8");
    const oldSecs = (NOW.getTime() - STOPPED_INSTANCE_TTL_MS - 60_000) / 1000;
    utimesSync(old, oldSecs, oldSecs);
    const freshSecs = NOW.getTime() / 1000;
    utimesSync(fresh, freshSecs, freshSecs);
    expect(reapStoppedInstances(cache, probes)).toEqual(["old.json"]);
    expect(existsSync(fresh)).toBe(true);
  });
});

describe("reapScratch", () => {
  it("removes session dirs untouched past the TTL and keeps recent ones", () => {
    const cache = mkCache();
    const stale = scratchDir(cache, "/devx-old-session");
    const recent = scratchDir(cache, "/devx-recent-session");
    mkdirSync(stale, { recursive: true });
    mkdirSync(recent, { recursive: true });
    writeFileSync(join(stale, "pr-body.stderr"), "x", "utf8");
    const oldSecs = (NOW.getTime() - SCRATCH_TTL_MS - 60_000) / 1000;
    utimesSync(stale, oldSecs, oldSecs);
    const nowSecs = NOW.getTime() / 1000;
    utimesSync(recent, nowSecs, nowSecs);

    const removed = reapScratch(cache, probes);
    expect(removed).toHaveLength(1);
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(recent)).toBe(true);
  });

  it.each([
    ["slashes", "../../etc/passwd"],
    ["dot-only (would rmSync the scratch root)", ".."],
    ["single dot", "."],
    ["empty", ""],
    ["separators only", "///"],
  ])("a %s session token stays strictly inside scratch/", (_label, token) => {
    const cache = mkCache();
    const root = join(cache, "scratch");
    const dir = scratchDir(cache, token);
    // Strictly INSIDE: the root itself is not an acceptable answer, since
    // reapScratch recursively removes whatever this resolves to.
    expect(dir.startsWith(root + "/")).toBe(true);
    expect(dir.slice(root.length + 1)).not.toContain("/");
    expect(/^\.+$/.test(dir.slice(root.length + 1))).toBe(false);
  });

  it("an absent scratch root reaps nothing and never throws", () => {
    expect(reapScratch(mkCache(), probes)).toEqual([]);
  });
});
