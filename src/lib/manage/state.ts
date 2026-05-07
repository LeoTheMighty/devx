// Manager state file IO — mgr101 minimal scaffold.
//
// Reads / writes `.devx-cache/state/manager.json` + `heartbeat.json`. Atomic
// writes via supervisor-internal's writeAtomic (tmp + rename) so a partial
// write is impossible — same primitive shipped by sup401 + reused by ini502
// (LEARN.md cross-epic: "atomic state writes via tmp+rename"). mgr102 will
// extend this with: explicit schemas, bounded ticks log, leftover-`*.tmp`
// detection on read for crash-mid-write recovery. The on-disk layout is
// pinned here so mgr102 only adds fields, never migrates.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeAtomic } from "../supervisor-internal.js";

export type TickOutcome = "no-work" | "spawned" | "maintained";

export interface TickEntry {
  generation: number;
  ts: string;
  outcome: TickOutcome;
}

export interface RosterEntry {
  pid: number;
  spec_hash: string;
  started_at: string;
  crash_count: number;
}

export interface LockRecord {
  pid: number;
  acquired_at: string;
}

export interface ManagerState {
  generation: number;
  started_at?: string;
  last_tick_at?: string;
  ticks?: TickEntry[];
  roster: RosterEntry[];
  lock?: LockRecord;
}

export interface Heartbeat {
  ts: string;
  pid: number;
  generation: number;
}

const DEFAULT_CACHE_DIR = ".devx-cache";

export function stateDir(cacheDir: string = DEFAULT_CACHE_DIR): string {
  return join(cacheDir, "state");
}

export function managerStatePath(cacheDir: string = DEFAULT_CACHE_DIR): string {
  return join(stateDir(cacheDir), "manager.json");
}

export function heartbeatPath(cacheDir: string = DEFAULT_CACHE_DIR): string {
  return join(stateDir(cacheDir), "heartbeat.json");
}

function emptyState(): ManagerState {
  return { generation: 0, roster: [] };
}

function isTickEntry(v: unknown): v is TickEntry {
  if (!v || typeof v !== "object") return false;
  const t = v as Record<string, unknown>;
  return (
    typeof t.generation === "number" &&
    typeof t.ts === "string" &&
    (t.outcome === "no-work" || t.outcome === "spawned" || t.outcome === "maintained")
  );
}

function isRosterEntry(v: unknown): v is RosterEntry {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.pid === "number" &&
    typeof r.spec_hash === "string" &&
    typeof r.started_at === "string" &&
    typeof r.crash_count === "number"
  );
}

export function readManagerState(cacheDir: string = DEFAULT_CACHE_DIR): ManagerState {
  const path = managerStatePath(cacheDir);
  if (!existsSync(path)) return emptyState();
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return emptyState();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyState();
  }
  if (!parsed || typeof parsed !== "object") return emptyState();
  const obj = parsed as Record<string, unknown>;
  // Generation must be a non-negative integer. Negative or non-integer values
  // are treated as corruption and reset (mgr102 will harden with explicit
  // crash-recovery semantics; mgr101 fails-safe).
  if (
    typeof obj.generation !== "number" ||
    !Number.isInteger(obj.generation) ||
    obj.generation < 0 ||
    !Array.isArray(obj.roster)
  ) {
    return emptyState();
  }
  // Sanitize entry shapes. Bad-shape ticks/roster from older versions or
  // hand-edits would otherwise propagate forever (every tick read+writeback
  // re-persists them). mgr102 will replace this with explicit zod-style
  // schemas; the v0 sanitization keeps the on-disk format clean.
  const ticks = Array.isArray(obj.ticks) ? obj.ticks.filter(isTickEntry) : undefined;
  const roster = (obj.roster as unknown[]).filter(isRosterEntry);
  return {
    ...(obj as unknown as ManagerState),
    ticks,
    roster,
  };
}

export function writeManagerState(
  cacheDir: string,
  state: ManagerState,
): void {
  writeAtomic(managerStatePath(cacheDir), JSON.stringify(state, null, 2) + "\n");
}

export function writeHeartbeat(cacheDir: string, heartbeat: Heartbeat): void {
  writeAtomic(heartbeatPath(cacheDir), JSON.stringify(heartbeat) + "\n");
}

export function nextGeneration(state: ManagerState): number {
  // Defensive `?? 0` guards against bad-shape state that bypassed the
  // `readManagerState` validator (e.g. a programmatic caller passing a
  // hand-built object). The validator is the gate; this is belt-and-suspenders.
  return (state.generation ?? 0) + 1;
}
