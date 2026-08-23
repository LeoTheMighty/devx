// The retro queue store — the one piece of state the listener (writer) and the
// watcher (reader/drainer) share. Everything here is filesystem mechanics; no
// judgment, no process spawning, no config.
//
// Layout, all under the learn home (design/agent.md §Data):
//
//   <home>/learn-queue.jsonl        pending  {session_id, transcript_path, cwd, ts}
//   <home>/learn-queue.done.jsonl   processed  + {processed_ts, outcome}
//   <home>/markers/<sid>.ended      SessionEnd fast path (listener writes)
//   <home>/markers/<sid>.done       wrapper-written exit status (watcher reads)
//   <home>/repos.json               {"<repo-root>": "allow" | "deny"}
//   <home>/locks/learn-queue.lock   O_EXCL path lock guarding every mutation
//   <home>/locks/learn-watch.lock   watcher singleton
//
// Three contracts worth stating out loud, because breaking any of them is
// silent rather than loud:
//
//   1. **No config load on this path.** Home resolution is `DEVX_LEARN_HOME`
//      or the `~/.claude/devx` default and nothing else. The listener runs on
//      every Stop hook in every repo, and G-3 bounds that at p95 < 500ms —
//      reading and merging `devx.config.yaml` would put YAML parsing in a
//      per-turn hot path. The watcher, which *may* read config, resolves its
//      home and passes it in.
//   2. **Identity is a line index, valid only under the lock.** `readQueue`
//      hands back entries tagged with the line they came from, and
//      `removeFromQueue` takes that tag — so an entry with no `session_id`
//      (a hand-edited or half-written row) is still removable, which a
//      sid-keyed API could not do. The tag is only meaningful while the file
//      hasn't moved underneath it: read and remove belong in the *same*
//      {@link withQueueLock} section. `removeFromQueue` cross-checks the raw
//      line before cutting and re-finds it if the index went stale, so a
//      violation degrades to "removed the right row anyway" or "removed
//      nothing" — never "removed someone else's row".
//   3. **Readers are tolerant, writers are atomic.** A torn final line (the
//      append that lost a race with a kill -9) is skipped by the readers, per
//      the `readEvents` precedent; whole-file rewrites go through
//      `writeAtomic` (tmp+rename — the LEARN.md cross-epic pattern), so a
//      crash mid-rewrite leaves the old queue, never a truncated one.
//
// Spec: dev/dev-rtl101-2026-07-30T09:31-listener-nudge-pin.md (T1.2)
// Design: _devx/workstreams/retro-listener/design/agent.md §Architecture (Queue), §Data

import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  type BlockingAcquireOpts,
  type LockHandle,
  acquirePathLockBlocking,
} from "../manage/lock.js";
import { writeAtomic } from "../supervisor-internal.js";

export { PathLockHeldError } from "../manage/lock.js";

// ---------------------------------------------------------------------------
// Home + paths
// ---------------------------------------------------------------------------

/** Minimal env shape — the listener is handed a plain record, not `process.env`. */
export type LearnEnv = Record<string, string | undefined>;

export const LEARN_HOME_ENV = "DEVX_LEARN_HOME";

/**
 * Resolve the learn home: `DEVX_LEARN_HOME` when set and non-blank, else
 * `~/.claude/devx`. Deliberately config-free (see contract 1 above); the
 * env var is also what every test uses to keep its files in a tmpdir.
 */
export function learnHome(env: LearnEnv = process.env): string {
  const override = env[LEARN_HOME_ENV];
  if (typeof override === "string" && override.trim() !== "") return override;
  return join(homedir(), ".claude", "devx");
}

export function queuePath(home: string): string {
  return join(home, "learn-queue.jsonl");
}

export function donePath(home: string): string {
  return join(home, "learn-queue.done.jsonl");
}

export function markersDir(home: string): string {
  return join(home, "markers");
}

export function reposPath(home: string): string {
  return join(home, "repos.json");
}

export function queueLockPath(home: string): string {
  return join(home, "locks", "learn-queue.lock");
}

export function watchLockPath(home: string): string {
  return join(home, "locks", "learn-watch.lock");
}

/**
 * Session ids reach us from hook payload JSON, and they are used as filename
 * components. Anything outside this charset — a slash, a `..`, a NUL — could
 * write a marker outside `markers/`, so it is refused rather than sanitized:
 * a mangled id would silently fail to match the watcher's lookup anyway.
 */
const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function isSafeSessionId(sid: unknown): sid is string {
  return typeof sid === "string" && SAFE_SESSION_ID.test(sid) && !sid.includes("..");
}

function assertSafeSessionId(sid: string): void {
  if (!isSafeSessionId(sid)) {
    throw new Error(`unsafe session id for a marker path: ${JSON.stringify(sid)}`);
  }
}

/** `<home>/markers/<sid>.ended` — the SessionEnd fast path. */
export function endedMarkerPath(home: string, sid: string): string {
  assertSafeSessionId(sid);
  return join(markersDir(home), `${sid}.ended`);
}

/** `<home>/markers/<sid>.done` — written by the spawned retro's wrapper. */
export function doneMarkerPath(home: string, sid: string): string {
  assertSafeSessionId(sid);
  return join(markersDir(home), `${sid}.done`);
}

/**
 * Create `<sid>.ended` if it doesn't exist, leaving an existing one untouched.
 * `wx` rather than a write: two hooks racing on the same session must not
 * produce a partial file, and the marker's *content* is meaningless — only
 * its existence is read.
 */
export function touchEndedMarker(home: string, sid: string): void {
  const path = endedMarkerPath(home, sid);
  mkdirSync(markersDir(home), { recursive: true });
  try {
    closeSync(openSync(path, "wx"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

export interface QueueEntry {
  session_id?: unknown;
  transcript_path?: unknown;
  cwd?: unknown;
  /** ISO-8601 with milliseconds — `new Date().toISOString()`, always. */
  ts?: unknown;
  /** Present after a requeue; readiness still keys off the original `ts`. */
  requeued_ts?: unknown;
  [key: string]: unknown;
}

export interface DoneEntry extends QueueEntry {
  processed_ts?: unknown;
  outcome?: unknown;
}

/**
 * The identity tag {@link readQueue} attaches and {@link removeFromQueue}
 * accepts. Non-enumerable on purpose: it must not survive `JSON.stringify`
 * (it would end up in the done log) and must not show up in a `toEqual`
 * comparison against a plain expected entry.
 */
const LINE_INDEX = "lineIndex";
const RAW_LINE = "rawLine";

export interface TaggedEntry extends QueueEntry {
  /** 0-based index of the source line in the file, as read. */
  readonly lineIndex?: number;
  /** The exact source line, used to detect a stale index. */
  readonly rawLine?: string;
}

function tag<T extends object>(entry: T, index: number, raw: string): T & TaggedEntry {
  Object.defineProperty(entry, LINE_INDEX, { value: index, enumerable: false });
  Object.defineProperty(entry, RAW_LINE, { value: raw, enumerable: false });
  return entry as T & TaggedEntry;
}

/** Tolerant JSONL read: torn/garbage/non-object lines are skipped, not fatal. */
function readJsonl(path: string): TaggedEntry[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    // Missing file is the common case (nothing queued yet), not an error.
    return [];
  }
  const out: TaggedEntry[] = [];
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // torn or hand-mangled line
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    out.push(tag(parsed as QueueEntry, i, line));
  }
  return out;
}

function appendJsonl(path: string, entry: object): void {
  appendFileSync(path, JSON.stringify(entry) + "\n", "utf8");
}

export function readQueue(home: string): TaggedEntry[] {
  return readJsonl(queuePath(home));
}

export function readDone(home: string): Array<TaggedEntry & DoneEntry> {
  return readJsonl(donePath(home)) as Array<TaggedEntry & DoneEntry>;
}

/** Session ids the queue is currently waiting on — the dedupe + fast-path set. */
export function pendingSessionIds(home: string): Set<string> {
  const ids = new Set<string>();
  for (const entry of readQueue(home)) {
    if (typeof entry.session_id === "string" && entry.session_id !== "") {
      ids.add(entry.session_id);
    }
  }
  return ids;
}

/**
 * Append one pending entry. `ts` is filled with `new Date().toISOString()`
 * when the caller didn't supply one — millisecond ISO-8601 is the contract
 * the watcher's strict readiness regex parses (a lenient `Date.parse` would
 * accept a hand-edited date-only string and then treat the entry as fresh
 * forever; failing the regex instead makes it *undatable*, which serves
 * immediately).
 *
 * Not locked here — callers append inside {@link withQueueLock} together with
 * their dedupe read, so the check and the append are one critical section.
 */
export function appendPending(
  home: string,
  entry: QueueEntry,
  now: () => Date = () => new Date(),
): void {
  mkdirSync(home, { recursive: true });
  const ts = typeof entry.ts === "string" && entry.ts !== "" ? entry.ts : now().toISOString();
  appendJsonl(queuePath(home), { ...entry, ts });
}

/**
 * Append one processed entry to the done log. The done log is the phase-2
 * evidence dataset, so it is append-only and never rewritten — `processed_ts`
 * and `outcome` are stamped here rather than trusted from the caller's object.
 */
export function appendDone(
  home: string,
  entry: QueueEntry,
  outcome: string,
  now: () => Date = () => new Date(),
): void {
  mkdirSync(home, { recursive: true });
  appendJsonl(donePath(home), {
    ...entry,
    processed_ts: now().toISOString(),
    outcome,
  });
}

/**
 * Remove one row from the pending queue by identity — an entry handed back by
 * {@link readQueue}, or a bare line index.
 *
 * Returns false when there is nothing to remove (no file, unknown identity,
 * index past the end), so a caller can tell "already drained" from "cut one".
 *
 * Stale-index defense: when the identity carries its source line, that line
 * must still sit at the recorded index; otherwise the file moved (someone
 * mutated outside the lock) and we re-find the exact line instead of cutting
 * blind. If it's gone entirely, we cut nothing.
 */
export function removeFromQueue(home: string, target: TaggedEntry | number): boolean {
  const path = queuePath(home);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return false;
  }
  const lines = raw.split("\n");

  const wantIndex = typeof target === "number" ? target : target.lineIndex;
  const wantLine = typeof target === "number" ? undefined : target.rawLine;
  if (typeof wantIndex !== "number" || !Number.isInteger(wantIndex) || wantIndex < 0) {
    return false;
  }

  let cutAt = wantIndex;
  if (wantLine !== undefined && lines[wantIndex] !== wantLine) {
    const found = lines.indexOf(wantLine);
    if (found === -1) return false; // already gone — nothing to cut
    cutAt = found;
  }
  if (cutAt >= lines.length || (lines[cutAt] ?? "").trim() === "") return false;

  const kept = lines.filter((line, i) => i !== cutAt && line.trim() !== "");
  writeAtomic(path, kept.length === 0 ? "" : kept.join("\n") + "\n");
  return true;
}

// ---------------------------------------------------------------------------
// Locking
// ---------------------------------------------------------------------------

/** Listener default: a turn must never wait on a wedged holder. */
export const LISTENER_LOCK_TIMEOUT_MS = 500;

/**
 * Run `fn` holding the queue lock, releasing it on every path.
 *
 * On deadline `acquirePathLockBlocking` rethrows `PathLockHeldError` — there
 * is no separate timeout type in the path-lock family — and that is the type
 * the listener catches to mean "drop this detection, exit 0". Dropping is the
 * right trade at the Stop hook: a missed retro costs one nudge, a delayed
 * turn costs the human's attention every time.
 */
export function withQueueLock<T>(home: string, fn: () => T, opts: BlockingAcquireOpts = {}): T {
  mkdirSync(home, { recursive: true });
  const handle: LockHandle = acquirePathLockBlocking(queueLockPath(home), opts);
  try {
    return fn();
  } finally {
    handle.release();
  }
}
