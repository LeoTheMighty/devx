// Loop run-state persistence (v2l101) — gnhf's run-dir idea grafted onto
// devx's `.devx-cache/` conventions.
//
// Layout:
//
//   .devx-cache/loop/state.json          ← the ONE liveness probe the
//                                          dispatcher already reads
//                                          (src/lib/next/gather.ts row 1:
//                                          `{status:"running", pid, ts}` +
//                                          freshness window). The loop
//                                          heartbeats `ts` here.
//   .devx-cache/loop/<run-id>/events.jsonl  ← JSONL lifecycle log: one line
//                                          per event, per-iteration git
//                                          snapshots, error.cause chains
//                                          (depth-bounded).
//   .devx-cache/loop/<run-id>/report.md  ← the morning report (report.ts).
//   .devx-cache/reports/<run-id>.md      ← a copy where gather.ts's
//                                          overnight-report probe looks.
//
// Atomicity: state.json goes through writeAtomic (tmp+rename — the mgr102 /
// LEARN.md cross-epic pattern), so a kill -9 mid-write leaves either the old
// state or a recoverable orphan tmp, never a half-file. events.jsonl is
// append-only (a torn final line is tolerated by readers — JSONL parsers
// skip unparseable lines).
//
// Crash recovery: recoverStaleLoopState() runs at driver start. A state.json
// claiming status:"running" whose PID is dead is a crash orphan — it gets
// rewritten to status:"aborted" so `devx next` row 1 never wedges on a ghost
// loop (gather.ts also defends via ts-freshness; this is the write-side fix).
//
// Spec: dev/dev-v2l101-2026-07-05T13:06-overnight-loop.md
// Design: v2/04-overnight-loop.md §2 (run dir), §4 (JSONL snapshots)

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeAtomic } from "../supervisor-internal.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export function loopDir(cacheDir: string): string {
  return join(cacheDir, "loop");
}

/** The dispatcher-probed liveness file (gather.ts row 1). */
export function loopStatePath(cacheDir: string): string {
  return join(loopDir(cacheDir), "state.json");
}

export function runDir(cacheDir: string, runId: string): string {
  return join(loopDir(cacheDir), runId);
}

export function eventsPath(cacheDir: string, runId: string): string {
  return join(runDir(cacheDir, runId), "events.jsonl");
}

export function reportPath(cacheDir: string, runId: string): string {
  return join(runDir(cacheDir, runId), "report.md");
}

/** Where gather.ts's overnight-report probe looks (`.devx-cache/reports/`). */
export function reportsCopyPath(cacheDir: string, runId: string): string {
  return join(cacheDir, "reports", `${runId}.md`);
}

/** `loop-<iso-compact>-<pid>` — sortable, unique enough for one machine. */
export function newRunId(now: Date, pid: number): string {
  const iso = now.toISOString().replace(/[:.]/g, "-").replace(/Z$/, "");
  return `loop-${iso}-${pid}`;
}

// ---------------------------------------------------------------------------
// state.json
// ---------------------------------------------------------------------------

export type LoopStatus = "running" | "stopped" | "aborted";

export interface LoopState {
  status: LoopStatus;
  pid: number;
  /** Heartbeat timestamp — refreshed on an interval while running; gather.ts
   *  treats a stale ts as dead regardless of status. */
  ts: string;
  run_id: string;
  started_at: string;
  /** Populated on abnormal exit. */
  abort_reason?: string;
}

export function writeLoopState(cacheDir: string, state: LoopState): void {
  writeAtomic(loopStatePath(cacheDir), JSON.stringify(state, null, 2) + "\n");
}

export function readLoopState(cacheDir: string): LoopState | null {
  let raw: string;
  try {
    raw = readFileSync(loopStatePath(cacheDir), "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  if (
    (o.status !== "running" && o.status !== "stopped" && o.status !== "aborted") ||
    typeof o.pid !== "number" ||
    !Number.isFinite(o.pid) ||
    typeof o.ts !== "string" ||
    typeof o.run_id !== "string" ||
    typeof o.started_at !== "string"
  ) {
    return null;
  }
  const out: LoopState = {
    status: o.status,
    pid: o.pid,
    ts: o.ts,
    run_id: o.run_id,
    started_at: o.started_at,
  };
  if (typeof o.abort_reason === "string") out.abort_reason = o.abort_reason;
  return out;
}

/**
 * Crash recovery, run at driver start (and safe to run any time): a
 * state.json claiming "running" whose PID is no longer alive is a crash
 * orphan — rewrite it to "aborted" so the dispatcher's row 1 never reports
 * a ghost loop as live. Returns the recovered state (or null when nothing
 * needed recovery). Never throws — recovery must not block a fresh run.
 */
export function recoverStaleLoopState(
  cacheDir: string,
  pidAlive: (pid: number) => boolean = defaultPidAlive,
  now: () => Date = () => new Date(),
): LoopState | null {
  const cur = readLoopState(cacheDir);
  if (cur === null || cur.status !== "running") return null;
  if (pidAlive(cur.pid)) return null;
  const recovered: LoopState = {
    ...cur,
    status: "aborted",
    ts: now().toISOString(),
    abort_reason:
      cur.abort_reason ??
      `crash-orphaned: pid ${cur.pid} is no longer alive (recovered by a later run)`,
  };
  try {
    writeLoopState(cacheDir, recovered);
  } catch {
    return null;
  }
  return recovered;
}

function defaultPidAlive(pid: number): boolean {
  if (typeof pid !== "number" || !Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    return true; // EPERM et al — conservative: alive
  }
}

// ---------------------------------------------------------------------------
// JSONL lifecycle log
// ---------------------------------------------------------------------------

export interface LoopEvent {
  ts: string;
  event: string;
  [key: string]: unknown;
}

/**
 * Append one event line. Best-effort: a logging failure must never abort
 * the loop (returns false instead). The run dir is created lazily on first
 * append.
 */
export function appendEvent(
  cacheDir: string,
  runId: string,
  event: string,
  fields: Record<string, unknown> = {},
  now: () => Date = () => new Date(),
): boolean {
  try {
    const dir = runDir(cacheDir, runId);
    mkdirSync(dir, { recursive: true });
    const line: LoopEvent = { ts: now().toISOString(), event, ...fields };
    appendFileSync(eventsPath(cacheDir, runId), JSON.stringify(line) + "\n", "utf8");
    return true;
  } catch {
    return false;
  }
}

/** Read all parseable events back (tests + morning reconstruction). Torn or
 *  garbage lines are skipped, per JSONL convention. */
export function readEvents(cacheDir: string, runId: string): LoopEvent[] {
  let raw: string;
  try {
    raw = readFileSync(eventsPath(cacheDir, runId), "utf8");
  } catch {
    return [];
  }
  const out: LoopEvent[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        out.push(parsed as LoopEvent);
      }
    } catch {
      // torn line — skip
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Error serialization (depth-bounded cause chains)
// ---------------------------------------------------------------------------

const MAX_CAUSE_DEPTH = 5;

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  cause?: SerializedError | string;
}

/**
 * Serialize an error with its full `.cause` chain, bounded at depth 5 so a
 * cyclic or pathological chain can't blow up the JSONL line. The undici
 * "TypeError: fetch failed" class is the motivating case — the surface
 * message is useless without the cause chain (gnhf debug-log lesson).
 */
export function serializeError(err: unknown, depth = 0): SerializedError | string {
  if (depth >= MAX_CAUSE_DEPTH) return "(cause chain truncated)";
  if (err instanceof Error) {
    // Every property access is guarded: a hostile error object with a
    // throwing getter (`stack`, `cause`, `message`) must never convert a
    // LOG call into a loop abort (EC-LOW-8).
    const out: SerializedError = {
      name: safeGet(() => err.name, "Error"),
      message: safeGet(() => err.message, "(message unreadable)"),
    };
    const stack = safeGet<string | undefined>(() => err.stack, undefined);
    if (typeof stack === "string") {
      // First 3 stack lines are enough to locate; full stacks bloat JSONL.
      out.stack = stack.split("\n").slice(0, 4).join("\n");
    }
    const cause = safeGet<unknown>(() => (err as { cause?: unknown }).cause, undefined);
    if (cause !== undefined && cause !== null) {
      out.cause = serializeError(cause, depth + 1);
    }
    return out;
  }
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err) ?? String(err);
  } catch {
    try {
      return String(err);
    } catch {
      return "(unserializable throwable)";
    }
  }
}

function safeGet<T>(get: () => T, fallback: T): T {
  try {
    return get();
  } catch {
    return fallback;
  }
}

/** Flatten an error + cause chain to one searchable string (permanent-error
 *  marker matching wants the whole chain, not just the surface message). */
export function errorChainText(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  for (let i = 0; i < MAX_CAUSE_DEPTH && cur !== undefined && cur !== null; i++) {
    if (cur instanceof Error) {
      const e = cur;
      parts.push(safeGet(() => e.message, "(message unreadable)"));
      cur = safeGet<unknown>(() => (e as { cause?: unknown }).cause, undefined);
    } else {
      const c = cur;
      parts.push(safeGet(() => String(c), "(unstringifiable)"));
      break;
    }
  }
  return parts.join(" <- ");
}
