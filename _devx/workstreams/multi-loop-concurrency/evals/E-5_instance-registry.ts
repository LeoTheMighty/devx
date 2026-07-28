// E-5 (P1): instance registry, capacity admission, aggregated visibility
// (FR-5, CAP-5, G-2). RED until Phase 5 merges. Runnable standalone:
// `npx tsx <this file>`.
// Seeds `.devx-cache/loop/instances/` with two fresh live-PID instance files
// and asserts (a) `devx next --no-gh` row 1 reports BOTH instances (today:
// gather reads only the singleton loop/state.json — race R6), (b) the
// instances module exists with an admission surface honoring
// `capacity.max_concurrent`, and (c) a stale (dead-PID) instance file is NOT
// counted as live.

import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mkRepoFixture, runCli } from "./_fixture.js";

const failures: string[] = [];

const fx = mkRepoFixture({
  prefix: "e5-registry",
  items: [["de78ab", "fixture-one"]],
});

function writeInstance(runId: string, pid: number, scope: string): void {
  const dir = join(fx.root, ".devx-cache", "loop", "instances");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${runId}.json`),
    JSON.stringify({
      schema: 1,
      run_id: runId,
      pid,
      started_at: new Date().toISOString(),
      scope,
      status: "running",
      current_item: null,
      iteration: 0,
      ts: new Date().toISOString(),
    }),
  );
}

function deadPid(): number {
  const child = spawnSync("true");
  return child.pid ?? 999999;
}

try {
  writeInstance("loop-fixture-a", process.pid, "epic:alpha");
  writeInstance("loop-fixture-b", process.pid, "epic:beta");
  writeInstance("loop-fixture-dead", deadPid(), "epic:gone");

  // (a) aggregation in devx next.
  const res = runCli(["next", "--no-gh"], fx.root);
  let loops: Array<{ run_id?: string }> | null = null;
  try {
    const payload = JSON.parse(res.stdout.trim().split("\n").pop() ?? "{}") as {
      loops?: Array<{ run_id?: string }>;
      detail?: { loops?: Array<{ run_id?: string }> };
    };
    loops = payload.loops ?? payload.detail?.loops ?? null;
  } catch {
    loops = null;
  }
  if (!loops) {
    failures.push(
      "devx next JSON carries no loops[] field for live instances — instance aggregation not implemented (T5.3)",
    );
  } else {
    const ids = loops.map((l) => l.run_id);
    if (!ids.includes("loop-fixture-a") || !ids.includes("loop-fixture-b")) {
      failures.push(
        `devx next loops[] lists ${JSON.stringify(ids)}; expected both fresh live instances`,
      );
    }
    // (c) dead-PID instance excluded.
    if (ids.includes("loop-fixture-dead")) {
      failures.push(
        "devx next loops[] counts a dead-PID instance as live — liveness classification missing",
      );
    }
  }

  // (b) admission surface.
  try {
    const mod = await import("../../../../src/lib/loop/instances.js");
    const m = mod as Record<string, unknown>;
    if (typeof m.admitLoop !== "function" || typeof m.listLiveInstances !== "function") {
      failures.push(
        "src/lib/loop/instances.ts exists but lacks admitLoop/listLiveInstances — feature incomplete (T5.1)",
      );
    }
  } catch {
    failures.push(
      "src/lib/loop/instances.ts missing — instance registry module not implemented (T5.1)",
    );
  }
} finally {
  rmSync(fx.root, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error("E-5 RED — loop instances are not registered/aggregated yet:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  "E-5 GREEN — fresh live instances aggregate in devx next; dead instances excluded; admission surface present.",
);
