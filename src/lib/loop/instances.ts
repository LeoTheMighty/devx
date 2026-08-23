// Loop instance registry (mlc105) — the singleton `loop/state.json` becomes
// one file per RUN, so N `devx loop` processes coexist on one repo instead
// of excluding each other through `manager.lock`. Kills races R6 (two loops
// stomping one state slot / the second loop refused outright) and R11
// (fixed-name scratch files colliding across sessions).
//
// Layout:
//
//   .devx-cache/loop/instances/<run-id>.json   ← JSON v1, writeAtomic,
//                                                heartbeat-refreshed
//   .devx-cache/locks/loop-<run-id>.lock       ← fail-fast O_EXCL guard
//   .devx-cache/scratch/<session>/             ← session-keyed scratch
//
// Liveness is TWO predicates ANDed, never one:
//   - freshness: |now − ts| ≤ window (the same `isFresh` shape gather.ts
//     row 1 uses — 3 × manager.heartbeat_interval_s), and
//   - PID: the recorded pid is running AND (JSON v1) did not start after
//     the instance registered (the mgr106 recycling cross-check, reused
//     from src/lib/locks/classify.ts — never re-implemented here).
// Freshness alone would count a SIGKILLed loop live for a whole window;
// PID alone would count a wedged-but-alive loop live forever. E-5 pins
// both directions (a dead-PID instance with a fresh ts must not aggregate).
//
// Admission: `admitLoop` counts live instances and refuses at
// `capacity.max_concurrent` (the knob's first consumer — devx.config.yaml
// declared it since Phase 0 and nothing read it). Callers MUST run the
// admit→register pair inside `withBacklogLock` so two simultaneous
// startups can't both observe N−1 and both admit; the module exposes the
// two halves separately rather than hiding the critical section, because
// the driver already owns that lock's lifetime.
//
// Nothing in this module ever throws at the caller for a registry-hygiene
// failure (unreadable dir, corrupt instance file, reap failure): a loop
// must never fail to start because a peer left debris. Errors degrade to
// "not live" / "nothing reaped".
//
// Spec: dev/dev-mlc105-2026-07-28T09:02-instance-registry-admission.md
// Design: _devx/workstreams/multi-loop-concurrency/design/agent.md §Architecture 5

import { readFileSync, readdirSync, rmSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { RECYCLING_GRACE_MS, defaultPidAlive } from "../locks/classify.js";
import { type LockHandle, acquirePathLock } from "../manage/lock.js";
import { probePidStartedAt } from "../manage/pid-uptime.js";
import { writeAtomic } from "../supervisor-internal.js";

export const LOOP_INSTANCE_SCHEMA = 1;

/** Stopped/aborted instance files linger this long so the morning report
 *  window can still see the night's runs, then the next loop start reaps
 *  them. Constant, not a knob (plan §What we're NOT doing). */
export const STOPPED_INSTANCE_TTL_MS = 24 * 60 * 60 * 1000;

/** Session scratch dirs are disposable; anything untouched this long is
 *  swept at the next loop start. Constant, not a knob. */
export const SCRATCH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Fallback freshness window (ms) when the caller passes none — mirrors
 *  gather.ts's 3 × 60s default so writer and reader can't disagree. */
export const DEFAULT_INSTANCE_FRESH_MS = 3 * 60 * 1000;

export type LoopInstanceStatus = "running" | "stopped" | "aborted";

export interface LoopInstance {
  schema: number;
  run_id: string;
  pid: number;
  /** Holder start time recorded at register time; null when the probe
   *  failed (then the recycling cross-check is skipped, not guessed). */
  pid_started_at: string | null;
  started_at: string;
  /** Scope descriptor for this run (mlc106 fills the rich forms; today
   *  `only:<type>` or null for "everything"). */
  scope: string | null;
  status: LoopInstanceStatus;
  current_item: string | null;
  iteration: number;
  /** Heartbeat timestamp. */
  ts: string;
  abort_reason?: string;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export function instancesDir(cacheDir: string): string {
  return join(cacheDir, "loop", "instances");
}

export function instancePath(cacheDir: string, runId: string): string {
  return join(instancesDir(cacheDir), `${runId}.json`);
}

export function instanceLockPath(cacheDir: string, runId: string): string {
  return join(cacheDir, "locks", `loop-${runId}.lock`);
}

export function scratchDir(cacheDir: string, session: string): string {
  return join(cacheDir, "scratch", sanitizeSegment(session));
}

/** Path segments come from run ids and session tokens, both of which can
 *  carry `/` (the `/devx-<id>` token shape) — collapse anything that could
 *  escape the cache dir. Not a security boundary; a footgun guard, and a
 *  load-bearing one: reapScratch calls `rmSync(..., {recursive: true})` on
 *  whatever this returns, so a segment that resolved to `.` or `..` would
 *  delete the scratch root or the whole `.devx-cache`. Dot-only results are
 *  therefore rejected outright, not merely collapsed. */
function sanitizeSegment(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (cleaned === "" || /^\.+$/.test(cleaned)) return "session";
  return cleaned;
}

// ---------------------------------------------------------------------------
// Seams
// ---------------------------------------------------------------------------

export interface InstanceProbes {
  now?: () => Date;
  pidAlive?: (pid: number) => boolean;
  pidStartedAt?: (pid: number) => Date | null;
  /** Freshness window in ms. Default DEFAULT_INSTANCE_FRESH_MS. */
  freshMs?: number;
  /** Test/fake-fs seams. */
  readdir?: (path: string) => string[];
  readFile?: (path: string) => string;
}

function probeSet(p: InstanceProbes) {
  return {
    now: p.now ?? (() => new Date()),
    pidAlive: p.pidAlive ?? defaultPidAlive,
    pidStartedAt: p.pidStartedAt ?? ((pid: number) => probePidStartedAt(pid)),
    freshMs: p.freshMs ?? DEFAULT_INSTANCE_FRESH_MS,
    readdir: p.readdir ?? ((path: string) => readdirSync(path)),
    readFile: p.readFile ?? ((path: string) => readFileSync(path, "utf8")),
  };
}

// ---------------------------------------------------------------------------
// Parse / read / write
// ---------------------------------------------------------------------------

/** Parse an instance body. Returns null for anything that isn't a
 *  well-formed v1 record — an unknown future `schema` included: its field
 *  semantics may have changed, so judging its liveness by v1 rules would
 *  be a guess (the same posture parseSpecLockBody takes). */
export function parseInstance(raw: string): LoopInstance | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  if (o.schema !== LOOP_INSTANCE_SCHEMA) return null;
  if (typeof o.run_id !== "string" || o.run_id.trim() === "") return null;
  if (typeof o.pid !== "number" || !Number.isInteger(o.pid) || o.pid <= 0) return null;
  if (typeof o.ts !== "string" || o.ts.trim() === "") return null;
  if (o.status !== "running" && o.status !== "stopped" && o.status !== "aborted") return null;
  const out: LoopInstance = {
    schema: LOOP_INSTANCE_SCHEMA,
    run_id: o.run_id,
    pid: o.pid,
    pid_started_at:
      typeof o.pid_started_at === "string" && o.pid_started_at.trim() !== ""
        ? o.pid_started_at
        : null,
    started_at: typeof o.started_at === "string" ? o.started_at : o.ts,
    scope: typeof o.scope === "string" && o.scope.trim() !== "" ? o.scope : null,
    status: o.status,
    current_item:
      typeof o.current_item === "string" && o.current_item.trim() !== ""
        ? o.current_item
        : null,
    iteration:
      typeof o.iteration === "number" && Number.isFinite(o.iteration) ? o.iteration : 0,
    ts: o.ts,
  };
  if (typeof o.abort_reason === "string") out.abort_reason = o.abort_reason;
  return out;
}

export function writeInstance(cacheDir: string, inst: LoopInstance): void {
  writeAtomic(instancePath(cacheDir, inst.run_id), JSON.stringify(inst, null, 2) + "\n");
}

export function readInstance(
  cacheDir: string,
  runId: string,
  probes: InstanceProbes = {},
): LoopInstance | null {
  const { readFile } = probeSet(probes);
  try {
    return parseInstance(readFile(instancePath(cacheDir, runId)));
  } catch {
    return null;
  }
}

/** Every parseable instance file, newest heartbeat first. Unparseable or
 *  unreadable entries are skipped silently — registry hygiene never blocks
 *  a caller. */
export function listInstances(
  cacheDir: string,
  probes: InstanceProbes = {},
): LoopInstance[] {
  const { readdir, readFile } = probeSet(probes);
  const dir = instancesDir(cacheDir);
  let names: string[];
  try {
    names = readdir(dir);
  } catch {
    return [];
  }
  const out: LoopInstance[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    let inst: LoopInstance | null = null;
    try {
      inst = parseInstance(readFile(join(dir, name)));
    } catch {
      continue;
    }
    if (inst !== null) out.push(inst);
  }
  // Deterministic order: freshest heartbeat first, run_id as the tiebreak
  // (two instances written in the same millisecond must not reorder
  // between two `devx next` runs).
  out.sort((a, b) => {
    const at = Date.parse(a.ts);
    const bt = Date.parse(b.ts);
    const av = Number.isFinite(at) ? at : 0;
    const bv = Number.isFinite(bt) ? bt : 0;
    if (av !== bv) return bv - av;
    return a.run_id.localeCompare(b.run_id);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Liveness
// ---------------------------------------------------------------------------

export type InstanceLiveness =
  /** status:"running", heartbeat fresh, PID alive and not recycled. */
  | { kind: "live" }
  /** status is stopped/aborted — a finished run's record. */
  | { kind: "finished" }
  /** Heartbeat older (or further in the future) than the window. */
  | { kind: "stale" }
  /** Heartbeat fresh but the owning process is gone or was recycled. */
  | { kind: "dead" };

/**
 * Classify one instance. Future-dated heartbeats are stale in BOTH
 * directions (|now − ts|, the gather.ts BH#2/EC#1 lesson): a TZ-mangled
 * hand edit or a clock skew must not pin an instance live forever.
 */
export function classifyInstance(
  inst: LoopInstance,
  probes: InstanceProbes = {},
): InstanceLiveness {
  const { now, pidAlive, pidStartedAt, freshMs } = probeSet(probes);
  if (inst.status !== "running") return { kind: "finished" };
  const tsMs = Date.parse(inst.ts);
  if (!Number.isFinite(tsMs)) return { kind: "stale" };
  if (Math.abs(now().getTime() - tsMs) > freshMs) return { kind: "stale" };
  if (!pidAlive(inst.pid)) return { kind: "dead" };
  // Recycling cross-check against the RECORDED start time — same rule and
  // same 2s grace as the lock classifier. A null record (probe failed at
  // register time) or a null probe now skips the check: never clobber on
  // "can't determine".
  if (inst.pid_started_at !== null) {
    const recorded = Date.parse(inst.pid_started_at);
    const startedAt = pidStartedAt(inst.pid);
    if (
      startedAt !== null &&
      Number.isFinite(recorded) &&
      startedAt.getTime() > recorded + RECYCLING_GRACE_MS
    ) {
      return { kind: "dead" };
    }
  }
  return { kind: "live" };
}

/** The instances a peer should treat as running right now. */
export function listLiveInstances(
  cacheDir: string,
  probes: InstanceProbes = {},
): LoopInstance[] {
  return listInstances(cacheDir, probes).filter(
    (i) => classifyInstance(i, probes).kind === "live",
  );
}

// ---------------------------------------------------------------------------
// Admission
// ---------------------------------------------------------------------------

export interface AdmissionVerdict {
  admitted: boolean;
  /** Effective `capacity.max_concurrent`. */
  cap: number;
  /** Instances counted as live at admission time. */
  live: LoopInstance[];
  /** Operator-facing refusal text (names the knob, the count, the ids). */
  message: string | null;
}

/**
 * Decide whether one more loop may start. MUST be called inside
 * `withBacklogLock` together with the register that follows it — see the
 * module header.
 */
export function admitLoop(
  cacheDir: string,
  cap: number,
  probes: InstanceProbes = {},
): AdmissionVerdict {
  const live = listLiveInstances(cacheDir, probes);
  if (live.length < cap) {
    return { admitted: true, cap, live, message: null };
  }
  const ids = live.map((i) => i.run_id).join(", ");
  return {
    admitted: false,
    cap,
    live,
    message:
      `capacity.max_concurrent is ${cap} and ${live.length} loop ` +
      `run${live.length === 1 ? " is" : "s are"} already live ` +
      `(${ids || "none listed"}) — raise capacity.max_concurrent in ` +
      `devx.config.yaml or wait for one to finish`,
  };
}

// ---------------------------------------------------------------------------
// Registration lifecycle
// ---------------------------------------------------------------------------

export interface RegisterInstanceOpts extends InstanceProbes {
  runId: string;
  startedAt: Date;
  scope?: string | null;
  pid?: number;
  /** Per-run lock seam (tests run many fixtures in one process and don't
   *  want real lock files). Default: acquirePathLock on the run's lock. */
  acquireLock?: () => LockHandle;
}

export interface InstanceHandle {
  runId: string;
  /** Current record — mutated in place by heartbeat/finalize. */
  instance: LoopInstance;
  lock: LockHandle;
}

/**
 * Take the per-run lock and write the initial instance file. The lock is
 * fail-fast (`acquirePathLock`, mgr106 stale posture) — a live duplicate
 * run-id is a programming error, not something to wait on; a stale one is
 * reaped by the acquire itself.
 */
export function registerInstance(
  cacheDir: string,
  opts: RegisterInstanceOpts,
): InstanceHandle {
  const { pidStartedAt } = probeSet(opts);
  const pid = opts.pid ?? process.pid;
  const lock = (opts.acquireLock ??
    (() =>
      acquirePathLock(instanceLockPath(cacheDir, opts.runId), {
        ...(opts.pidAlive !== undefined ? { pidAlive: opts.pidAlive } : {}),
        ...(opts.pidStartedAt !== undefined ? { pidStartedAt: opts.pidStartedAt } : {}),
        warn: () => {
          // A reaped stale loop lock is expected debris after a kill -9;
          // the registry's own reaper reports what matters (the instance
          // file).
        },
      })))();
  const instance: LoopInstance = {
    schema: LOOP_INSTANCE_SCHEMA,
    run_id: opts.runId,
    pid,
    pid_started_at: pidStartedAt(pid)?.toISOString() ?? null,
    started_at: opts.startedAt.toISOString(),
    scope: opts.scope ?? null,
    status: "running",
    current_item: null,
    iteration: 0,
    ts: opts.startedAt.toISOString(),
  };
  try {
    writeInstance(cacheDir, instance);
  } catch (e) {
    // Registering IS the admission record — a run that can't write it
    // would be invisible to every peer's capacity count. Release the lock
    // and let the caller fail loudly.
    try {
      lock.release();
    } catch {
      // best effort
    }
    throw e;
  }
  return { runId: opts.runId, instance, lock };
}

export interface HeartbeatPatch {
  currentItem?: string | null;
  iteration?: number;
  scope?: string | null;
}

/** Refresh `ts` (and optionally the progress fields). Best-effort: a failed
 *  heartbeat write must never kill a run — the peer-visible cost is one
 *  window of staleness, and the next beat repairs it. */
export function heartbeatInstance(
  cacheDir: string,
  handle: InstanceHandle,
  patch: HeartbeatPatch = {},
  now: () => Date = () => new Date(),
): void {
  if (patch.currentItem !== undefined) handle.instance.current_item = patch.currentItem;
  if (patch.iteration !== undefined) handle.instance.iteration = patch.iteration;
  if (patch.scope !== undefined) handle.instance.scope = patch.scope;
  handle.instance.ts = now().toISOString();
  try {
    writeInstance(cacheDir, handle.instance);
  } catch {
    // best effort — see doc comment
  }
}

/**
 * Mark the run finished and drop the per-run lock. The instance FILE stays
 * (status stopped/aborted) for the morning-report window — matching
 * today's state.json semantics — and is reaped by a later run start.
 */
export function finalizeInstance(
  cacheDir: string,
  handle: InstanceHandle,
  status: Exclude<LoopInstanceStatus, "running">,
  abortReason?: string,
  now: () => Date = () => new Date(),
): void {
  handle.instance.status = status;
  handle.instance.current_item = null;
  handle.instance.ts = now().toISOString();
  if (abortReason !== undefined) handle.instance.abort_reason = abortReason;
  try {
    writeInstance(cacheDir, handle.instance);
  } catch {
    // The reaper's dead-PID path covers us once this process exits.
  }
  try {
    handle.lock.release();
  } catch {
    // A leftover loop-<run-id>.lock holds our pid; the next acquire's
    // stale sweep reaps it.
  }
}

// ---------------------------------------------------------------------------
// Reaping (run at loop start)
// ---------------------------------------------------------------------------

/**
 * Sweep registry debris at loop start:
 *   - finished instances whose `ts` is older than STOPPED_INSTANCE_TTL_MS,
 *   - crash-orphaned instances (status "running", but dead/recycled PID)
 *     that are ALSO past the stopped TTL — a fresh crash orphan stays on
 *     disk so the morning report and `devx doctor` can still see it; only
 *     `classifyInstance` decides who counts as live, so keeping the file
 *     costs nothing and deleting it early loses evidence,
 *   - unparseable files past the TTL by mtime (nothing else can judge
 *     them).
 * Never throws; returns what it removed.
 */
export function reapStoppedInstances(
  cacheDir: string,
  probes: InstanceProbes & { statMtimeMs?: (path: string) => number } = {},
): string[] {
  const { now, readdir, readFile, pidAlive } = probeSet(probes);
  const statMtimeMs = probes.statMtimeMs ?? ((p: string) => statSync(p).mtimeMs);
  const dir = instancesDir(cacheDir);
  let names: string[];
  try {
    names = readdir(dir);
  } catch {
    return [];
  }
  const nowMs = now().getTime();
  const removed: string[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const abs = join(dir, name);
    let inst: LoopInstance | null = null;
    try {
      inst = parseInstance(readFile(abs));
    } catch {
      inst = null;
    }
    let expired: boolean;
    if (inst === null) {
      // Unparseable: fall back to mtime. An unreadable mtime means we
      // can't age it — leave it alone rather than delete blind.
      try {
        expired = nowMs - statMtimeMs(abs) > STOPPED_INSTANCE_TTL_MS;
      } catch {
        expired = false;
      }
    } else {
      const cls = classifyInstance(inst, probes);
      if (cls.kind === "live") continue;
      // A "running" record whose heartbeat went stale is NOT proof the run
      // died — a starved process can miss beats. classifyInstance short-
      // circuits on staleness without probing the pid, so reaping on that
      // verdict alone would free a capacity slot out from under a process
      // that is still alive and still holding its per-run lock. Deleting a
      // record is the one irreversible act here, so it takes the stronger
      // predicate: the owner must actually be gone.
      if (inst.status === "running" && pidAlive(inst.pid)) continue;
      const tsMs = Date.parse(inst.ts);
      // An instance whose ts is unparseable can't be live (classify said
      // so) and can't be aged — reap it, it is inert either way.
      expired = !Number.isFinite(tsMs) || nowMs - tsMs > STOPPED_INSTANCE_TTL_MS;
    }
    if (!expired) continue;
    try {
      unlinkSync(abs);
      removed.push(name);
    } catch {
      // A peer removed it first, or the dir is read-only — either way,
      // not our problem to escalate.
    }
  }
  return removed;
}

/** Sweep session scratch dirs untouched for SCRATCH_TTL_MS (R11's
 *  disposable side). Never throws. */
export function reapScratch(
  cacheDir: string,
  probes: InstanceProbes & { statMtimeMs?: (path: string) => number } = {},
): string[] {
  const { now, readdir } = probeSet(probes);
  const statMtimeMs = probes.statMtimeMs ?? ((p: string) => statSync(p).mtimeMs);
  const root = join(cacheDir, "scratch");
  let names: string[];
  try {
    names = readdir(root);
  } catch {
    return [];
  }
  const nowMs = now().getTime();
  const removed: string[] = [];
  for (const name of names) {
    const abs = join(root, name);
    let mtime: number;
    try {
      mtime = statMtimeMs(abs);
    } catch {
      continue;
    }
    if (nowMs - mtime <= SCRATCH_TTL_MS) continue;
    try {
      rmSync(abs, { recursive: true, force: true });
      removed.push(name);
    } catch {
      // best effort
    }
  }
  return removed;
}
