// Coverage for the two mlc105 paths that shipped on observation (357d0c).
//
// mlc105's own review tour named both gaps explicitly rather than leaving
// them implicit: neither is a defect in the shipped code, both are real
// paths verified only by one manual run against the live repo. The registry
// is what stops a night of crashed runs from eating the capacity budget, and
// `devx status`'s live-loops block is how a human finds out a peer is
// running at all — "it worked when I tried it" is thin evidence for either.
//
// AC 1: a REAL crash-orphaned instance (a genuinely-exited pid, not a fake
//       one) driven through admission — admitted, uncounted, kept while
//       fresh, reaped past the TTL.
// AC 2: `devx status`'s live-loops block — the header, the per-run line, and
//       its fail-soft posture.
//
// Spec: test/test-357d0c-2026-07-28T17:15-loop-instance-orphan-and-status-render.md

import { spawnSync } from "node:child_process";
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
import { afterEach, describe, expect, it, vi } from "vitest";

import { runStatus } from "../src/commands/status.js";
import {
  LOOP_INSTANCE_SCHEMA,
  STOPPED_INSTANCE_TTL_MS,
  admitLoop,
  classifyInstance,
  instancePath,
  instancesDir,
  listLiveInstances,
  reapStoppedInstances,
  registerInstance,
  type LoopInstance,
} from "../src/lib/loop/instances.js";

const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
const tmps: string[] = [];
afterEach(() => {
  stderrSpy.mockClear();
  while (tmps.length > 0) rmSync(tmps.pop() as string, { recursive: true, force: true });
});

/**
 * A pid that provably belonged to a process which has already exited.
 *
 * `spawnSync` returns only after the child is reaped, so this is not a
 * guess or a large-number heuristic — the AC asks for a REAL crash orphan
 * and this is the difference between testing the registry and testing a
 * fixture's `pidAlive: () => false` stub.
 */
function deadPid(): number {
  const child = spawnSync("true");
  return child.pid ?? 999_999;
}

function mkCache(): string {
  const dir = mkdtempSync(join(tmpdir(), "devx-357d0c-"));
  tmps.push(dir);
  const cache = join(dir, ".devx-cache");
  mkdirSync(cache, { recursive: true });
  return cache;
}

const NOW = new Date("2026-07-28T12:00:00.000Z");

function seed(cacheDir: string, runId: string, patch: Partial<LoopInstance> = {}): void {
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
}

// ---------------------------------------------------------------------------
// AC 1 — a real crash orphan, through admission
// ---------------------------------------------------------------------------

describe("AC 1 — a REAL crash-orphaned instance does not eat a capacity slot", () => {
  /** Real pid, real registry file, only the clock is injected. */
  function orphanedRegistry(ageMs: number): { cache: string; pid: number } {
    const cache = mkCache();
    const pid = deadPid();
    seed(cache, "loop-crashed", {
      pid,
      // `status: "running"` is the whole point: the run never got to write
      // `stopped`, because it crashed. On disk it is indistinguishable from
      // a live run except by probing the pid.
      status: "running",
      ts: new Date(NOW.getTime() - ageMs).toISOString(),
    });
    return { cache, pid };
  }

  const probes = (ageMs = 0) => ({
    now: () => new Date(NOW.getTime() + ageMs),
    freshMs: 180_000,
  });

  it("classifies as a crash orphan on the REAL pid, with no pidAlive stub", () => {
    const { cache } = orphanedRegistry(60_000);
    const raw = JSON.parse(
      readFileSync(instancePath(cache, "loop-crashed"), "utf8"),
    ) as LoopInstance;
    const verdict = classifyInstance(raw, probes());
    expect(verdict.kind).not.toBe("live");
  });

  it("(a) a fresh run is ADMITTED past it, even at max_concurrent 1", () => {
    const { cache } = orphanedRegistry(60_000);
    // The failure this guards: an orphan counted as live at cap 1 refuses
    // every subsequent run, so one crash wedges the loop until a human
    // deletes a file nobody knows about.
    const verdict = admitLoop(cache, 1, probes());
    expect(verdict.admitted).toBe(true);
  });

  it("(b) the orphan is not in the live set", () => {
    const { cache } = orphanedRegistry(60_000);
    expect(listLiveInstances(cache, probes())).toEqual([]);
  });

  it("(c) it SURVIVES the reap while fresh — it is the morning report's evidence", () => {
    const { cache } = orphanedRegistry(60_000);
    expect(reapStoppedInstances(cache, probes())).toEqual([]);
    expect(existsSync(instancePath(cache, "loop-crashed"))).toBe(true);
  });

  it("(c) and IS reaped once past STOPPED_INSTANCE_TTL_MS", () => {
    const { cache } = orphanedRegistry(STOPPED_INSTANCE_TTL_MS + 60_000);
    expect(reapStoppedInstances(cache, probes())).toEqual(["loop-crashed.json"]);
    expect(existsSync(instancePath(cache, "loop-crashed"))).toBe(false);
  });

  it("end-to-end: crash → admit → register, and the new run is the only live one", () => {
    const { cache } = orphanedRegistry(60_000);
    const p = probes();
    expect(admitLoop(cache, 1, p).admitted).toBe(true);
    const handle = registerInstance(cache, {
      runId: "loop-fresh",
      startedAt: new Date(NOW.getTime()),
      scope: null,
      ...p,
    });
    expect(handle.runId).toBe("loop-fresh");
    const live = listLiveInstances(cache, p);
    expect(live.map((i) => i.run_id)).toEqual(["loop-fresh"]);
    // A SECOND run must now be refused — the orphan freed the slot, it did
    // not remove the cap.
    const second = admitLoop(cache, 1, p);
    expect(second.admitted).toBe(false);
    // And the refusal names the LIVE run, so an operator can act on it
    // without reading the registry by hand. (Asserting on a bare /1/ would
    // have matched almost any JSON — this checks the run-id specifically,
    // and that the orphan is NOT among the reasons.)
    const text = JSON.stringify(second);
    expect(text).toContain("loop-fresh");
    expect(text).not.toContain("loop-crashed");
  });
});

// ---------------------------------------------------------------------------
// AC 2 — `devx status`'s live-loops block
// ---------------------------------------------------------------------------

describe("AC 2 — devx status renders the live-loops block", () => {
  /** A repo `runStatus` will load: config + an (empty) plan dir. */
  function repo(): string {
    const dir = mkdtempSync(join(tmpdir(), "devx-357d0c-status-"));
    tmps.push(dir);
    writeFileSync(join(dir, "devx.config.yaml"), "mode: yolo\n");
    mkdirSync(join(dir, "plan"), { recursive: true });
    mkdirSync(join(dir, ".devx-cache"), { recursive: true });
    return dir;
  }

  function run(root: string): { code: number; stdout: string } {
    let stdout = "";
    const code = runStatus({
      out: (s) => {
        stdout += s;
      },
      err: () => {},
      projectPath: join(root, "devx.config.yaml"),
      now: () => new Date(NOW.getTime() + 45_000),
    });
    return { code, stdout };
  }

  it("renders the header and one line per run, with scope / item+iteration / heartbeat age", () => {
    const root = repo();
    const cache = join(root, ".devx-cache");
    seed(cache, "loop-a", { scope: "only:dev", current_item: "abc123", iteration: 3 });
    seed(cache, "loop-b", { scope: null, current_item: null, iteration: 0 });

    const r = run(root);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("live loops: 2");
    // Scope, the item + iteration, and the heartbeat age — the three facts a
    // human needs to decide whether to start another run.
    expect(r.stdout).toMatch(/loop-a \(pid \d+\)\s+scope: only:dev/);
    expect(r.stdout).toMatch(/item abc123, iteration 3/);
    expect(r.stdout).toMatch(/heartbeat 45s ago/);
    // A run between items renders `idle` and `all`, not blanks.
    expect(r.stdout).toMatch(/loop-b \(pid \d+\)\s+scope: all/);
    expect(r.stdout).toMatch(/idle/);
  });

  it("omits the block entirely when nothing is live", () => {
    const root = repo();
    seed(join(root, ".devx-cache"), "loop-dead", { pid: deadPid() });
    const r = run(root);
    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain("live loops:");
  });

  it("FAIL-SOFT: an unreadable registry omits the section and still exits 0", () => {
    // Status is a read-only human surface. A corrupt cache file must not
    // take it down — the workstream blocks below the loop block are the
    // reason someone ran the command.
    const root = repo();
    let stdout = "";
    const code = runStatus({
      out: (s) => {
        stdout += s;
      },
      err: () => {},
      projectPath: join(root, "devx.config.yaml"),
      now: () => NOW,
      fs: {
        readdir: (p: string) => {
          if (p.includes("instances")) throw new Error("EIO: unreadable");
          return [];
        },
      },
    });
    expect(code).toBe(0);
    expect(stdout).not.toContain("live loops:");
  });

  it("FAIL-SOFT: a corrupt instance file is skipped, live peers still render", () => {
    const root = repo();
    const cache = join(root, ".devx-cache");
    seed(cache, "loop-good", { current_item: "def456", iteration: 1 });
    writeFileSync(join(instancesDir(cache), "loop-torn.json"), "{{{ not json", "utf8");
    const r = run(root);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("live loops: 1");
    expect(r.stdout).toMatch(/loop-good/);
  });
});
