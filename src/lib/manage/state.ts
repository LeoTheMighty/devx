// Manager state file IO — mgr102 hardened layer.
//
// Public surface (pinned by mgr102 ACs):
//   readState(cacheDir?)        — combined { schedule, manager } read with
//                                  leftover-`*.tmp` recovery semantics.
//   writeState(cacheDir, s)     — atomic write of schedule.json + manager.json
//                                  (each via tmp+rename).
//   writeHeartbeat(cacheDir, h) — single-line atomic replace of heartbeat.json.
//
// Per-file helpers stay exposed because mgr101's loop.ts + future mgr103/104
// readers want manager state in isolation without paying the cost of a
// schedule.json read on every tick:
//   readManagerState, writeManagerState
//   readScheduleState, writeScheduleState
//
// Crash-mid-write recovery (AC #3): on read, if a leftover `<file>.tmp.*` is
// present, behavior depends on the main file:
//   - <file> exists → tmp is from a prior crash; main is authoritative; the
//     tmp gets cleaned up so it doesn't accumulate forever.
//   - <file> missing → the rename half-completed; if the newest tmp parses
//     as valid JSON we promote it (rename → <file>) and use it. Corrupt
//     tmps get cleaned up, then we fall back to the empty default.
//
// Atomic-write primitive: writeAtomic from supervisor-internal.ts (shared
// with sup401 + ini502; LEARN.md cross-epic "atomic state writes via
// tmp+rename"). Each writer uses a unique `<file>.tmp.<pid>.<rand>` suffix,
// so concurrent writers never collide on tmp paths; renames serialize at
// the FS layer → last writer wins, files are never half-written.
//
// On-disk shapes are pinned here (AC #2). mgr103+ may add fields without
// migration; removing fields requires a story bump.

import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

import { writeAtomic } from "../supervisor-internal.js";

// ─── Manager-state types ────────────────────────────────────────────────

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
  /** mgr103+: "dev" | "plan" | "test" | … */
  worker_class?: string;
  /** mgr105+: populated on child exit, used to decide backoff index. */
  last_exit_code?: number;
}

export interface LockRecord {
  pid: number;
  acquired_at: string;
}

export interface ManagerState {
  generation: number;
  started_at?: string;
  last_tick_at?: string;
  /** mgr104+: model used when spawning workers (per devx.config.yaml). */
  model?: string;
  ticks?: TickEntry[];
  roster: RosterEntry[];
  lock?: LockRecord;
}

// ─── Schedule-state types ───────────────────────────────────────────────

export interface ScheduleSlot {
  spec_hash: string;
  worker_class: string;
  priority: number;
  since: string;
}

export interface ScheduleState {
  generation: number;
  computed_at: string;
  slots: ScheduleSlot[];
  hard_cap: number;
}

// ─── Combined state ─────────────────────────────────────────────────────

export interface State {
  schedule: ScheduleState;
  manager: ManagerState;
}

// ─── Heartbeat ──────────────────────────────────────────────────────────

export interface Heartbeat {
  ts: string;
  pid: number;
  generation: number;
}

// ─── Constants & paths ──────────────────────────────────────────────────

const DEFAULT_CACHE_DIR = ".devx-cache";

// Phase 1 hard cap on parallel workers. mgr103 enforces in reconcile.ts; this
// is the on-disk default for fresh schedule.json files. Phase 3
// epic-capacity-management lifts this to capacity.max_concurrent.
const HARD_CAP_PHASE_1 = 1;

const TICKS_LOG_BOUND = 100;

export function stateDir(cacheDir: string = DEFAULT_CACHE_DIR): string {
  return join(cacheDir, "state");
}

export function managerStatePath(cacheDir: string = DEFAULT_CACHE_DIR): string {
  return join(stateDir(cacheDir), "manager.json");
}

export function scheduleStatePath(cacheDir: string = DEFAULT_CACHE_DIR): string {
  return join(stateDir(cacheDir), "schedule.json");
}

export function heartbeatPath(cacheDir: string = DEFAULT_CACHE_DIR): string {
  return join(stateDir(cacheDir), "heartbeat.json");
}

// ─── Defaults ───────────────────────────────────────────────────────────

export function emptyManagerState(): ManagerState {
  return { generation: 0, roster: [] };
}

export function emptyScheduleState(): ScheduleState {
  return {
    generation: 0,
    computed_at: new Date(0).toISOString(),
    slots: [],
    hard_cap: HARD_CAP_PHASE_1,
  };
}

export function emptyState(): State {
  return { schedule: emptyScheduleState(), manager: emptyManagerState() };
}

// ─── Validators ─────────────────────────────────────────────────────────

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isNonNegativeInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

function isTickEntry(v: unknown): v is TickEntry {
  if (!v || typeof v !== "object") return false;
  const t = v as Record<string, unknown>;
  // outcome is intentionally `typeof === "string"` (not a closed-set check)
  // so mgr103+ can extend the TickOutcome union without invalidating older
  // on-disk state. The TS union remains advisory; runtime trusts string-ness.
  return (
    isNonNegativeInt(t.generation) &&
    typeof t.ts === "string" &&
    typeof t.outcome === "string" &&
    (t.outcome as string).length > 0
  );
}

function isRosterEntry(v: unknown): v is RosterEntry {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  if (
    !isFiniteNumber(r.pid) ||
    typeof r.spec_hash !== "string" ||
    typeof r.started_at !== "string" ||
    !isFiniteNumber(r.crash_count) ||
    !Number.isInteger(r.crash_count) ||
    (r.crash_count as number) < 0
  ) {
    return false;
  }
  // Optional fields validated when present; absent = OK.
  if (r.worker_class !== undefined && typeof r.worker_class !== "string") return false;
  if (r.last_exit_code !== undefined && !isFiniteNumber(r.last_exit_code)) return false;
  return true;
}

function isScheduleSlot(v: unknown): v is ScheduleSlot {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.spec_hash === "string" &&
    typeof s.worker_class === "string" &&
    isFiniteNumber(s.priority) &&
    typeof s.since === "string"
  );
}

function isLockRecord(v: unknown): v is LockRecord {
  if (!v || typeof v !== "object") return false;
  const l = v as Record<string, unknown>;
  return isFiniteNumber(l.pid) && typeof l.acquired_at === "string";
}

// ─── Crash-mid-write recovery (AC #3) ───────────────────────────────────

/**
 * Read JSON-as-text from `targetPath` with leftover-`*.tmp.*` recovery.
 * Returns file contents (string) or null if neither the main file nor a
 * recoverable tmp exists. Caller is still responsible for JSON.parse +
 * shape validation. Returning the raw string lets callers distinguish "no
 * file" (null) from "file with content that fails downstream validation"
 * (string).
 *
 * **Concurrency model.** mgr102 ships under the manager singleton lock
 * (mgr101 + mgr106), so at most one writer per state-file family runs at a
 * time in production. The leftover-tmp sweep is therefore guaranteed to
 * see only crashed-prior-process orphans, never an in-flight peer. The
 * sweep is best-effort regardless: unlinkSync ENOENT is swallowed (a
 * crash-restarted twin process racing the same recovery is a benign tie).
 *
 * Side effects:
 *   - main exists → return main; orphan tmps are unlinked best-effort.
 *   - main missing → newest valid-JSON+object tmp is shape-checked then
 *     promoted via rename (with copyFile+unlink fallback for EXDEV);
 *     corrupt tmps are deleted (or, if delete fails, renamed `.corrupt`
 *     so the recovery loop doesn't hammer the same blob every read).
 *   - On any read-side error other than ENOENT, the function falls
 *     through to a `null` return — callers downgrade to the empty default
 *     rather than crash the manager.
 */
function readWithTmpRecovery(targetPath: string): string | null {
  const dir = dirname(targetPath);
  const base = basename(targetPath);
  const tmpPrefix = `${base}.tmp.`;

  // readdirSync surfaces three classes of error: ENOENT (dir absent —
  // fresh project, expected), ENOTDIR (someone planted a regular file
  // where the state dir should be — corrupt project layout), and EACCES
  // (permission denied — operator misconfigured perms). Only ENOENT is
  // "expected" and silently mapped to "no tmps." The other two propagate
  // so the manager can surface a clear failure rather than silently
  // pretending state is fine.
  let siblings: string[] = [];
  try {
    siblings = readdirSync(dir).filter((e) => e.startsWith(tmpPrefix));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw err;
  }

  if (existsSync(targetPath)) {
    for (const s of siblings) {
      try {
        unlinkSync(join(dir, s));
      } catch {
        // best-effort — see "Concurrency model" above.
      }
    }
    try {
      return readFileSync(targetPath, "utf8");
    } catch (err) {
      // ENOENT here = the file disappeared between existsSync and read
      // (shouldn't happen under the singleton lock, but a TOCTOU window
      // exists). Return null so the caller falls back to the empty
      // default; non-ENOENT errors (EACCES, EIO) propagate.
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return null;
      throw err;
    }
  }

  if (siblings.length === 0) return null;

  const candidates = siblings
    .map((s) => {
      const p = join(dir, s);
      try {
        return { path: p, mtime: statSync(p).mtimeMs, name: s };
      } catch {
        return null;
      }
    })
    .filter((c): c is { path: string; mtime: number; name: string } => c !== null)
    // Newest first, with filename as a stable tiebreaker. Coarse-resolution
    // filesystems (HFS+, FAT) can collapse two writes to the same mtime;
    // sorting by `name` descending picks the lexicographically-greater tmp,
    // which gives deterministic behavior across platforms even if it isn't
    // strictly "newest." Production loses no correctness — both tmps are
    // crashed-prior-process orphans by definition under the singleton lock.
    .sort((a, b) => (b.mtime - a.mtime) || (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));

  for (const c of candidates) {
    let content: string;
    try {
      content = readFileSync(c.path, "utf8");
    } catch {
      // Tmp disappeared (a concurrent reader already promoted it). Move on.
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      cleanupCorruptTmp(c.path);
      continue;
    }
    // Shape pre-check: a JSON-valid-but-non-object tmp (e.g. `null`, `"x"`,
    // `5`, `[]`) would be promoted then immediately fall to the empty
    // default at validator time. Skipping early avoids a wasted rename.
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      cleanupCorruptTmp(c.path);
      continue;
    }
    if (!promoteTmp(c.path, targetPath)) {
      // Promotion ultimately failed (rare: EACCES on rename + copy, EROFS).
      // Caller still gets the content this read; we don't promote, so the
      // tmp stays around and the next read tries again. Better than
      // returning null and losing the recovered data.
      return content;
    }
    for (const other of candidates) {
      if (other.path === c.path) continue;
      try {
        unlinkSync(other.path);
      } catch {
        // best-effort
      }
    }
    return content;
  }

  return null;
}

/**
 * Promote a tmp to the main path. Tries renameSync first; falls back to
 * copyFile+unlink on EXDEV (cross-device, common when /tmp and project
 * dir are different mounts). Returns true on success, false if both
 * paths failed.
 */
function promoteTmp(tmpPath: string, targetPath: string): boolean {
  try {
    renameSync(tmpPath, targetPath);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EXDEV") {
      // Non-EXDEV rename failure → let the read return content without
      // promoting; tmp persists but caller still gets data this read.
      return false;
    }
  }
  // EXDEV fallback: copy then unlink.
  try {
    const buf = readFileSync(tmpPath);
    writeAtomic(targetPath, buf);
    unlinkSync(tmpPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Best-effort cleanup of a corrupt tmp. unlinkSync first; if that fails
 * (EACCES, EBUSY), rename the file to a `.corrupt` suffix so the recovery
 * loop's `tmpPrefix` filter no longer matches it — without this, every
 * subsequent read keeps re-parsing the same garbage and burning CPU.
 */
function cleanupCorruptTmp(tmpPath: string): void {
  try {
    unlinkSync(tmpPath);
    return;
  } catch {
    // fall through to rename
  }
  try {
    renameSync(tmpPath, `${tmpPath}.corrupt`);
  } catch {
    // last resort — log nothing (we're inside a read path), accept the
    // per-tick re-parse cost. Diagnosable via `ls .devx-cache/state/`.
  }
}

// ─── Manager-state read/write ───────────────────────────────────────────

export function readManagerState(cacheDir: string = DEFAULT_CACHE_DIR): ManagerState {
  const path = managerStatePath(cacheDir);
  const raw = readWithTmpRecovery(path);
  if (raw === null) return emptyManagerState();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyManagerState();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return emptyManagerState();
  }
  const obj = parsed as Record<string, unknown>;
  if (!isNonNegativeInt(obj.generation) || !Array.isArray(obj.roster)) {
    return emptyManagerState();
  }
  // Explicit per-field projection — never spread the raw parsed object.
  // Spreading would tunnel arbitrary attacker- or hand-edit-injected fields
  // (e.g. `lock: "stringified"`, `model: 42`, garbage `__future_field__`)
  // through the read+writeback cycle forever. mgr103/104/mobile-mirror
  // consumers downstream then have to defend against shapes the on-disk
  // schema doesn't sanction. Project only known fields, validate each.
  const out: ManagerState = {
    generation: obj.generation,
    roster: (obj.roster as unknown[]).filter(isRosterEntry),
  };
  if (typeof obj.started_at === "string") out.started_at = obj.started_at;
  if (typeof obj.last_tick_at === "string") out.last_tick_at = obj.last_tick_at;
  if (typeof obj.model === "string") out.model = obj.model;
  if (Array.isArray(obj.ticks)) out.ticks = obj.ticks.filter(isTickEntry);
  if (isLockRecord(obj.lock)) out.lock = obj.lock;
  return out;
}

export function writeManagerState(cacheDir: string, state: ManagerState): void {
  // Trim ticks at write time too — defense-in-depth against a programmatic
  // caller passing an unbounded ticks array. loop.ts already trims; mgr103+
  // workflows that build state from scratch may not.
  const out: ManagerState =
    state.ticks && state.ticks.length > TICKS_LOG_BOUND
      ? { ...state, ticks: state.ticks.slice(-TICKS_LOG_BOUND) }
      : state;
  writeAtomic(managerStatePath(cacheDir), JSON.stringify(out, null, 2) + "\n");
}

// ─── Schedule-state read/write ──────────────────────────────────────────

export function readScheduleState(cacheDir: string = DEFAULT_CACHE_DIR): ScheduleState {
  const path = scheduleStatePath(cacheDir);
  const raw = readWithTmpRecovery(path);
  if (raw === null) return emptyScheduleState();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyScheduleState();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return emptyScheduleState();
  }
  const obj = parsed as Record<string, unknown>;
  if (
    !isNonNegativeInt(obj.generation) ||
    typeof obj.computed_at !== "string" ||
    !Array.isArray(obj.slots) ||
    !isNonNegativeInt(obj.hard_cap)
  ) {
    return emptyScheduleState();
  }
  const slots = (obj.slots as unknown[]).filter(isScheduleSlot);
  return {
    generation: obj.generation,
    computed_at: obj.computed_at,
    slots,
    hard_cap: obj.hard_cap,
  };
}

// Defensive cap on slots count at write time. Phase 1 hard_cap is 1, so
// any state with thousands of slots is a programmatic caller bug, not a
// real schedule. Cap is generous (`max(1000, hard_cap * 8)`) so legitimate
// future schedules with elevated hard_cap aren't truncated unexpectedly.
const SCHEDULE_SLOTS_BOUND_FLOOR = 1000;

export function writeScheduleState(cacheDir: string, schedule: ScheduleState): void {
  const bound = Math.max(SCHEDULE_SLOTS_BOUND_FLOOR, schedule.hard_cap * 8);
  const out: ScheduleState =
    schedule.slots.length > bound
      ? { ...schedule, slots: schedule.slots.slice(0, bound) }
      : schedule;
  writeAtomic(scheduleStatePath(cacheDir), JSON.stringify(out, null, 2) + "\n");
}

// ─── Combined read/write (AC #1) ────────────────────────────────────────

/**
 * Read combined `{ schedule, manager }`. Reads are independent
 * (`readScheduleState` + `readManagerState`); each handles its own crash
 * recovery. If `writeState` was interrupted between the two file renames,
 * the on-disk pair can be inconsistent for one tick — schedule.generation
 * != manager.generation. mgr103+ reconcile-time logic compares generations
 * and re-derives the schedule when they drift; downstream consumers should
 * not assume the pair is locked-step. The mismatch window is at most one
 * tick under the singleton manager lock.
 */
export function readState(cacheDir: string = DEFAULT_CACHE_DIR): State {
  return {
    schedule: readScheduleState(cacheDir),
    manager: readManagerState(cacheDir),
  };
}

/**
 * Write schedule.json + manager.json. Each file is atomic individually
 * (writeAtomic = tmp + rename). The pair-write is **not** transactional:
 * if the second rename fails after the first succeeded, the on-disk pair
 * is inconsistent for one tick. Generation is the canonical reconciliation
 * key — `readState`'s docstring covers the recovery model.
 *
 * Schedule is written first so that, on partial-failure, the older (more
 * conservative) manager state is the one that lags — workers don't get
 * spawned against a roster that hasn't been published yet.
 */
export function writeState(cacheDir: string, state: State): void {
  writeScheduleState(cacheDir, state.schedule);
  writeManagerState(cacheDir, state.manager);
}

// ─── Heartbeat ──────────────────────────────────────────────────────────

export function writeHeartbeat(cacheDir: string, heartbeat: Heartbeat): void {
  writeAtomic(heartbeatPath(cacheDir), JSON.stringify(heartbeat) + "\n");
}

// ─── Generation helper ──────────────────────────────────────────────────

export function nextGeneration(state: ManagerState): number {
  // Reject non-finite / non-integer / out-of-safe-range generations from
  // programmatic callers that bypass readManagerState's validator. Without
  // this guard, `generation: Infinity` propagates as Infinity forever
  // (every successive nextGeneration is still Infinity), and `generation:
  // Number.MAX_SAFE_INTEGER` returns a value that loses precision on
  // every subsequent increment. Defensive `?? 0` for missing fields.
  const g = state.generation ?? 0;
  if (!Number.isSafeInteger(g) || g < 0) return 1;
  return g + 1;
}
