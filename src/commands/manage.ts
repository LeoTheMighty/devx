// `devx manage` — Manager loop / single-tick CLI (mgr101 + mgr102/103/104).
//
//   devx manage --once   acquires the manager lock, runs one tick, releases
//                        the lock, exits 0.
//   devx manage          (no flags) runs the loop until SIGTERM/SIGINT;
//                        AbortSignal drains the current tick and exits 0.
//
// mgr105/106 fill in crash-restart, max-restarts gate, and stale-PID lock
// detection. The launchd / systemd / Task-Scheduler units from sup402/3/4
// already point at `devx manage`, so this command running closes the
// single-agent loop end-to-end.
//
// Spec: dev/dev-mgr101-2026-04-28T19:30-manage-scaffold.md
//       dev/dev-mgr104-2026-04-28T19:30-manage-spawn-worker.md (model wiring)
// Epic: _bmad-output/planning-artifacts/epic-devx-manage-minimal.md

import type { Command } from "commander";

import { loadMerged } from "../lib/config-io.js";
import { attachPhase } from "../lib/help.js";
import { runManagerLoop, runManagerOnce } from "../lib/manage/loop.js";
import { ManagerLockHeldError, acquireManagerLock } from "../lib/manage/lock.js";

const DEFAULT_TICK_INTERVAL_S = 60;
const DEFAULT_DEV_MODEL = "claude-sonnet-4-6";

function readTickIntervalS(): number {
  let merged: unknown;
  try {
    merged = loadMerged();
  } catch {
    return DEFAULT_TICK_INTERVAL_S;
  }
  if (!merged || typeof merged !== "object") return DEFAULT_TICK_INTERVAL_S;
  const manager = (merged as Record<string, unknown>).manager;
  if (!manager || typeof manager !== "object") return DEFAULT_TICK_INTERVAL_S;
  const v = (manager as Record<string, unknown>).heartbeat_interval_s;
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  return DEFAULT_TICK_INTERVAL_S;
}

function readDevModel(): string {
  let merged: unknown;
  try {
    merged = loadMerged();
  } catch {
    return DEFAULT_DEV_MODEL;
  }
  if (!merged || typeof merged !== "object") return DEFAULT_DEV_MODEL;
  const capacity = (merged as Record<string, unknown>).capacity;
  if (!capacity || typeof capacity !== "object") return DEFAULT_DEV_MODEL;
  const models = (capacity as Record<string, unknown>).models;
  if (!models || typeof models !== "object") return DEFAULT_DEV_MODEL;
  const v = (models as Record<string, unknown>).dev;
  if (typeof v === "string" && v.length > 0) return v;
  return DEFAULT_DEV_MODEL;
}

interface ManageOpts {
  once?: boolean;
}

export async function runManageCommand(opts: ManageOpts): Promise<number> {
  if (opts.once) {
    let handle;
    try {
      handle = acquireManagerLock();
    } catch (err) {
      if (err instanceof ManagerLockHeldError) {
        // console.error flushes synchronously on process.exit (Node
        // guarantee); process.stderr.write doesn't, so the message can be
        // truncated when stderr is a pipe (CI tee'ing logs).
        console.error(err.message);
        return 1;
      }
      throw err;
    }
    try {
      await runManagerOnce({ model: readDevModel() });
    } finally {
      handle.release();
    }
    return 0;
  }

  // Default: loop until SIGTERM/SIGINT.
  let handle;
  try {
    handle = acquireManagerLock();
  } catch (err) {
    if (err instanceof ManagerLockHeldError) {
      console.error(err.message);
      return 1;
    }
    throw err;
  }
  const ac = new AbortController();
  const onSignal = (sig: NodeJS.Signals) => {
    process.stderr.write(`manage: received ${sig}; draining\n`);
    ac.abort();
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
  try {
    await runManagerLoop({
      tickIntervalS: readTickIntervalS(),
      signal: ac.signal,
      model: readDevModel(),
    });
  } finally {
    process.off("SIGTERM", onSignal);
    process.off("SIGINT", onSignal);
    handle.release();
  }
  return 0;
}

export function register(program: Command): void {
  const cmd = program
    .command("manage")
    .description(
      "Run the /devx-manage scheduler loop (Phase 1 minimal: hard cap N=1; reconcile + spawn wired)",
    )
    .option("--once", "Run a single tick and exit", false)
    .action(async (opts: ManageOpts) => {
      const code = await runManageCommand(opts);
      if (code !== 0) process.exit(code);
    });

  attachPhase(cmd, 1);
}

export const name = "manage";
export const phase = 1;
