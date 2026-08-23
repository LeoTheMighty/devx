// The detection core: one hook payload in, at most one filesystem effect out.
// Invoked by `devx learn-helper listen` (the Stop + SessionEnd hooks registered
// in `.claude/settings.json`), which means this runs at *every turn end in
// every hooked repo* — so the shape of the code is dictated by three
// non-negotiables:
//
//   1. **Total.** {@link handleHookPayload} never throws. A hook that fails a
//      turn is worse than a missed detection (design/agent.md §Constraints), so every
//      path — garbage payload, unwritable home, wedged lock — returns a result
//      instead of raising. The CLI's try/catch is the second belt, not the
//      first.
//   2. **Cheap.** No config load, no repo scan, no `stat` (G-3 bounds the hook
//      at p95 < 500ms, measured by E-7). The miss path — which is ~every turn —
//      does one whitespace-collapsed substring test and returns without
//      touching the disk at all: it must not even *create* the queue file
//      (E-1 case f).
//   3. **Never delaying.** The queue lock is shared with the watcher's
//      whole-file rewrite. The listener takes it with a short deadline and
//      treats `PathLockHeldError` as "drop this detection" — one lost nudge
//      costs one retro, a stalled Stop hook costs the human's attention every
//      turn.
//
// The `DEVX_RETRO` guard is the bound on the retro-of-retro loop, and it is
// mechanical rather than editorial: `/devx-learn`'s job is to mine and quote
// framework prose — the nudge sentence included — so a retro that ends by
// quoting it would queue *itself*, and its fork carries a fresh session id, so
// the dedupe below can never cap the depth. The wrapper exports the variable
// (E-9); this file returns before any read when it is set (E-2).
//
// TWO ARMS, DIFFERENT JOBS (amended 2026-08-21). `Stop` is the cheap per-turn
// nudge detector; `SessionEnd` is the once-per-session backstop that captures
// a finished session whether or not the agent said the magic words. The
// original design had only the first, so capture was hostage to an agent
// remembering one sentence — and the queue recorded 2 sessions in its
// lifetime, none in the 19 days before this amendment. Constraint 2 (cheap)
// binds `Stop` only: SessionEnd fires once per session, so it can afford the
// done-log read that keeps a retired session from being re-queued.
//
// Ported semantics: `_devx/workstreams/retro-listener/reference/learn-listener.py`
// (its docstrings are the trap inventory).
//
// Spec: dev/dev-rtl101-2026-07-30T09:31-listener-nudge-pin.md (T1.3)
// Design: _devx/workstreams/retro-listener/design/agent.md §Architecture (Detect)

import type { BlockingAcquireOpts } from "../manage/lock.js";
import { containsNudge } from "./nudge.js";
import {
  LISTENER_LOCK_TIMEOUT_MS,
  type LearnEnv,
  PathLockHeldError,
  appendPending,
  isSafeSessionId,
  learnHome,
  pendingSessionIds,
  readDone,
  touchEndedMarker,
  withQueueLock,
} from "./queue.js";

/** Set by the spawn wrapper inside a forked retro (E-9); guards this file (E-2). */
export const RETRO_ENV = "DEVX_RETRO";

/**
 * SessionEnd reasons that must NOT take the `.ended` fast path, for two
 * distinct causes:
 *
 *   - **the human isn't done** — `/clear`, `/resume` and
 *     `bypass_permissions_disabled` end the session *object* while the user
 *     keeps working in that same terminal. Marking it over would spawn a retro
 *     that steals focus mid-work.
 *   - **the spawn couldn't work** — after `logout`, `claude --resume` runs
 *     against an unauthenticated CLI and can only fail.
 *
 * Either way the entry drops through to the watcher's idle-mtime fallback,
 * which re-checks later (by which time a logged-out user may well be back).
 *
 * Denylist rather than allowlist on purpose: an unrecognised or absent reason
 * still marks the session ended, so an upstream rename degrades to the idle
 * window, never to silence (E-10).
 */
export const NO_FAST_PATH_REASONS: ReadonlySet<string> = new Set([
  "clear",
  "resume",
  "bypass_permissions_disabled",
  "logout",
]);

/**
 * What the call did. Returned rather than logged: the hook writes nothing to
 * stdout (Claude Code would surface it), so this is the only observable the
 * tests — and a future `--verbose` arm — have.
 */
export type ListenerAction =
  /** `DEVX_RETRO` was set: returned before reading anything. */
  | "retro-guard"
  /** Not a payload this listener acts on (wrong/absent event, no session id). */
  | "ignored"
  /** Stop without the canonical nudge — the common case, zero disk effects. */
  | "no-nudge"
  /** Stop with a nudge for a session already queued: one retro per session. */
  | "duplicate"
  /** Stop with a nudge: one pending entry appended. */
  | "queued"
  /** Queue lock held past the deadline — detection dropped on purpose. */
  | "lock-contended"
  /** SessionEnd with a denylisted reason: no marker. */
  | "reason-denied"
  /** SessionEnd for a session with nothing to mine (no transcript), or one
   *  the watcher already processed: nothing to do. */
  | "not-pending"
  /** SessionEnd for a pending session: `.ended` marker written. */
  | "marked"
  /** SessionEnd for an un-nudged session: captured by the backstop. */
  | "queued-on-end"
  /** Something threw. Swallowed here; reported for tests. */
  | "error";

export interface ListenerResult {
  action: ListenerAction;
  /** The payload's session id, when it had a usable one. */
  sessionId?: string;
  /** Message of the swallowed error, for `action: "error"` only. */
  error?: string;
}

export interface ListenerDeps {
  /** Test seam for the entry `ts`. */
  now?: () => Date;
  /** Queue-lock acquire options; defaults to the short listener deadline. */
  lockOpts?: BlockingAcquireOpts;
}

/**
 * Truthiness of an env var, Python-`os.environ.get`-style: present and
 * non-empty. `DEVX_RETRO=0` therefore *guards* — the wrapper only ever sets it
 * to `1`, and a guard that fails closed is the safe direction for a loop bound.
 */
function isSet(value: string | undefined): boolean {
  return typeof value === "string" && value !== "";
}

/**
 * True inside a spawned retro. Exported because the CLI must answer it
 * *before* it reads stdin — E-2's contract is "exit 0 without reading the
 * payload", and a fork that blocks on a pipe it will never use is exactly the
 * kind of per-turn cost the guard exists to avoid.
 */
export function isRetroGuarded(env: LearnEnv = process.env): boolean {
  return isSet(env[RETRO_ENV]);
}

function asRecord(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  return payload as Record<string, unknown>;
}

function stringField(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Handle one Claude Code hook payload (Stop or SessionEnd, discriminated by
 * `hook_event_name`).
 *
 * Total by construction — see contract 1 in the file header. Callers get a
 * {@link ListenerResult} rather than an exception on every path, including a
 * `null` payload.
 */
export function handleHookPayload(
  payload: unknown,
  env: LearnEnv = process.env,
  deps: ListenerDeps = {},
): ListenerResult {
  try {
    // Guard first, before any read of the payload or the disk (E-2).
    if (isRetroGuarded(env)) return { action: "retro-guard" };

    const record = asRecord(payload);
    if (!record) return { action: "ignored" };

    const sid = stringField(record, "session_id");
    if (!sid) return { action: "ignored" };
    // A session id becomes a marker filename downstream. Refuse anything that
    // couldn't be one *here*, at the queue's entrance, rather than letting the
    // entry in and having the watcher trip over it later.
    if (!isSafeSessionId(sid)) return { action: "ignored" };

    // Home resolution is deferred into the arms: the Stop miss path — ~every
    // turn — should not even compute a path it will never use.
    const event = stringField(record, "hook_event_name");
    if (event === "Stop") return handleStop(record, sid, env, deps);
    if (event === "SessionEnd") return handleSessionEnd(record, sid, env, deps);
    return { action: "ignored", sessionId: sid };
  } catch (err) {
    // Deliberately swallowed: this function is called from a hook.
    return { action: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

function handleStop(
  payload: Record<string, unknown>,
  sid: string,
  env: LearnEnv,
  deps: ListenerDeps,
): ListenerResult {
  // The miss path, taken at ~every turn end: one substring test, no disk.
  if (!containsNudge(stringField(payload, "last_assistant_message"))) {
    return { action: "no-nudge", sessionId: sid };
  }

  const home = learnHome(env);
  const lockOpts: BlockingAcquireOpts = { timeoutMs: LISTENER_LOCK_TIMEOUT_MS, ...deps.lockOpts };
  try {
    return withQueueLock(
      home,
      () => {
        // Dedupe and append are one critical section: a nudge landing while the
        // watcher rewrites the queue is neither lost nor doubled.
        if (pendingSessionIds(home).has(sid)) return { action: "duplicate", sessionId: sid };
        appendPending(
          home,
          {
            session_id: sid,
            transcript_path: payload.transcript_path ?? null,
            cwd: payload.cwd ?? null,
          },
          deps.now,
        );
        return { action: "queued", sessionId: sid };
      },
      lockOpts,
    );
  } catch (err) {
    // The one error worth naming: the watcher (or a wedged peer hook) held the
    // lock past our short deadline. Drop the detection — never delay the turn.
    if (err instanceof PathLockHeldError) return { action: "lock-contended", sessionId: sid };
    throw err;
  }
}

function handleSessionEnd(
  payload: Record<string, unknown>,
  sid: string,
  env: LearnEnv,
  deps: ListenerDeps,
): ListenerResult {
  const reason = stringField(payload, "reason");
  const noFastPath = reason !== undefined && NO_FAST_PATH_REASONS.has(reason);
  const home = learnHome(env);

  // Already queued (a nudge fired earlier this session): the only job left is
  // the `.ended` marker, which lets the watcher skip the idle window. Read is
  // lock-free on purpose — it is tolerant by construction, and taking the lock
  // at every SessionEnd would put the hook behind the watcher's rewrites for
  // no gain.
  if (pendingSessionIds(home).has(sid)) {
    if (noFastPath) return { action: "reason-denied", sessionId: sid };
    touchEndedMarker(home, sid);
    return { action: "marked", sessionId: sid };
  }

  // THE BACKSTOP. Before this existed, an un-nudged session died here as
  // `not-pending` and no retro was ever possible: `handleStop` only enqueues
  // when the assistant's last message carries the canonical nudge sentence,
  // and this arm only marked sessions that were ALREADY pending. Nothing
  // enqueued anything else, so a session whose agent simply never said the
  // words was unreachable. Measured cost of that gap: 2 sessions captured in
  // the queue's lifetime, none in the 19 days before this change — while the
  // repo shipped an entire 10-item overnight loop.
  //
  // Capture is now wording-independent: the nudge remains the cheap per-turn
  // fast path on Stop, and this is the reliable end-of-session sweep. Cost is
  // paid once per session, not per turn, which is why the extra reads here are
  // affordable where they would not be in `handleStop`.
  const transcript = stringField(payload, "transcript_path");
  // No transcript = nothing to mine. Also keeps trivial/aborted sessions out.
  if (transcript === undefined) return { action: "not-pending", sessionId: sid };
  // Never re-queue a session the watcher already retired, or a `requeue` is
  // undone and a processed retro runs a second time. This is the one unbounded
  // read on the hook path: the done log is append-only and grows one row per
  // processed retro. Affordable because it is once per SESSION (not per turn,
  // where G-3's p95 < 500ms bound bites) and the log gains rows no faster than
  // you open sessions — but it is the thing to bound first if the hook ever
  // gets slow.
  if (readDone(home).some((entry) => entry.session_id === sid)) {
    return { action: "not-pending", sessionId: sid };
  }

  const lockOpts: BlockingAcquireOpts = { timeoutMs: LISTENER_LOCK_TIMEOUT_MS, ...deps.lockOpts };
  try {
    return withQueueLock(
      home,
      () => {
        // Re-check under the lock: a nudge landing on the final turn races us.
        if (pendingSessionIds(home).has(sid)) {
          if (!noFastPath) touchEndedMarker(home, sid);
          return { action: "duplicate", sessionId: sid };
        }
        appendPending(
          home,
          { session_id: sid, transcript_path: transcript, cwd: stringField(payload, "cwd") ?? null },
          deps.now,
        );
        // A denylisted reason means the human is probably still working in that
        // terminal (`/clear`, `/resume`) or the spawn cannot authenticate
        // (`logout`). Queue it either way, but withhold the marker so it drops
        // to the watcher's idle-mtime fallback instead of spawning a retro that
        // steals focus mid-work.
        if (!noFastPath) touchEndedMarker(home, sid);
        return { action: "queued-on-end", sessionId: sid };
      },
      lockOpts,
    );
  } catch (err) {
    // Same posture as handleStop: never delay the turn over a held lock.
    if (err instanceof PathLockHeldError) return { action: "lock-contended", sessionId: sid };
    throw err;
  }
}
