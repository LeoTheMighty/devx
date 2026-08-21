// Spec-lock lifecycle (mlc103) — liveness metadata, classification, reap at
// claim time, guarded release. Kills races R7 (release-unlink TOCTOU), R8
// (claim contention against an abandoned lock) and R12 (dead owner's lock
// blocks the item forever — the live example was spec-494590.lock).
//
// Body format JSON v1: `{schema: 1, pid, pid_started_at, session,
// claimed_at}`. Legacy pre-mlc103 bodies (`<token>\npid=<n>\nclaimed_at=
// <ts>`) parse via their `pid=` line and classify through the same shared
// classifier (src/lib/locks/classify.ts — the mgr106 extraction).
//
// Classification posture (design §Architecture 4 + Resolved design
// questions; E-3 pins it):
//   - dead PID → reapable
//   - recycled PID → reapable, detected via the RECORDED `pid_started_at`
//     (JSON v1) compared against the live probe, with the 2s grace window;
//     v1 bodies whose write-time probe failed fall back to `claimed_at`
//     (machine-written at acquire, so trustworthy).
//   - legacy bodies classify on PID liveness ALONE — no recycling
//     cross-check. Their `claimed_at` provenance is untrusted (hand-written
//     or drifted bodies exist in the wild), and E-3(b) pins the
//     conservative posture: a live-PID legacy lock is NEVER reaped.
//   - live-PID locks are never auto-reaped regardless of age; older than
//     SPEC_LOCK_LIVE_WARN_MS they raise a WARN in `devx next` drift and
//     the pick-time mask (TTL demoted to WARN + doctor).
//   - empty body → held (a peer's mid-write window — same as manager lock).
//
// Every reap+acquire pair and every release MUST run inside the backlog
// mutation lock (mlc102 withBacklogLock) — callers own that; claimSpec's
// whole transaction already holds it, and the loop driver wraps its
// release call sites.
//
// Spec: dev/dev-mlc103-2026-07-28T09:02-spec-lock-lifecycle.md
// Design: _devx/workstreams/multi-loop-concurrency/design.md §Architecture 4

import { readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import {
  RECYCLING_GRACE_MS,
  defaultPidAlive,
} from "../locks/classify.js";
import { probePidStartedAt } from "../manage/pid-uptime.js";

export const SPEC_LOCK_SCHEMA = 1;

/** Live-PID locks older than this raise a WARN (devx next drift + pick-time
 *  mask + devx doctor) — never auto-reaped. Constant, not a knob. */
export const SPEC_LOCK_LIVE_WARN_MS = 2 * 60 * 60 * 1000;

export function specLockPath(repoRoot: string, hash: string): string {
  return join(repoRoot, ".devx-cache", "locks", `spec-${hash}.lock`);
}

// ---------------------------------------------------------------------------
// Body compose / parse
// ---------------------------------------------------------------------------

export interface ParsedSpecLock {
  format: "json-v1" | "legacy";
  /** Holder PID, or null when the body carries none (liveness unknowable). */
  pid: number | null;
  /** Recorded holder start time (JSON v1 only; null when the write-time
   *  probe failed or the body is legacy). */
  pidStartedAt: string | null;
  /** Owner session token (raw, un-normalized), or null. */
  session: string | null;
  claimedAt: string | null;
}

export interface ComposeSpecLockOpts {
  session: string;
  /** ISO timestamp of the claim (claimSpec's isoTimestamp). */
  claimedAt: string;
  /** Default: process.pid. */
  pid?: number;
  /** Recorded holder start time. Default: probe the pid at compose time;
   *  pass null explicitly to simulate a failed probe in tests. */
  pidStartedAt?: string | null;
}

export function composeSpecLockBody(opts: ComposeSpecLockOpts): string {
  const pid = opts.pid ?? process.pid;
  const pidStartedAt =
    opts.pidStartedAt !== undefined
      ? opts.pidStartedAt
      : (probePidStartedAt(pid)?.toISOString() ?? null);
  return (
    JSON.stringify({
      schema: SPEC_LOCK_SCHEMA,
      pid,
      pid_started_at: pidStartedAt,
      session: opts.session,
      claimed_at: opts.claimedAt,
    }) + "\n"
  );
}

/**
 * Parse either body format. Returns null for empty or unparseable content
 * (a JSON-looking body that fails to parse or lacks the object shape).
 * Legacy parse mirrors verify-claim's historical `parseLockOwner`: the
 * first non-empty line is the owner token; `pid=`/`claimed_at=` lines are
 * read from the remainder.
 */
export function parseSpecLockBody(raw: string): ParsedSpecLock | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (trimmed.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const o = parsed as Record<string, unknown>;
    // Unknown future schema FIRST (review EC-6): field semantics may have
    // changed under us (old binary vs new lock in the multi-loop world),
    // so nothing about the body — including what a valid `pid` looks
    // like — can be judged by v1 rules. Liveness unknowable → pid null →
    // the conservative unknown-pid/held classification, session still
    // attributable. Must precede the invalid-pid corruption rule below,
    // which would otherwise reap a v2 body whose pid field is legally
    // shaped differently.
    const unknownSchema = "schema" in o && o.schema !== SPEC_LOCK_SCHEMA;
    // A pid field that is PRESENT but invalid (0, negative, float, string)
    // in a KNOWN-schema body is corruption of a machine-written file →
    // unparseable (reapable), not unknown-pid/held — otherwise a
    // 99%-parseable body would wedge harder than total garbage (review
    // EC-3). A genuinely ABSENT pid stays null → unknown-pid → held.
    let pid: number | null = null;
    if (!unknownSchema && "pid" in o) {
      if (typeof o.pid !== "number" || !Number.isInteger(o.pid) || o.pid <= 0) return null;
      pid = o.pid;
    }
    const session =
      typeof o.session === "string" && o.session.trim() !== "" ? o.session.trim() : null;
    return {
      format: "json-v1",
      pid,
      pidStartedAt:
        typeof o.pid_started_at === "string" && o.pid_started_at.trim() !== ""
          ? o.pid_started_at
          : null,
      session,
      claimedAt:
        typeof o.claimed_at === "string" && o.claimed_at.trim() !== ""
          ? o.claimed_at
          : null,
    };
  }
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  const session = lines[0] ?? null;
  let pid: number | null = null;
  let claimedAt: string | null = null;
  // Scan ALL lines (not lines[1:]) so a body whose token line was lost
  // (`pid=123\nclaimed_at=…`) still yields a classifiable pid — the
  // session token then reads as "pid=123" (historic first-line contract)
  // but a dead holder is reapable instead of wedged (review EC-5). Legacy
  // pid=0 stays null → unknown-pid/held: legacy bodies are hand-edit
  // territory, so unlike JSON v1 an invalid pid is not proof of machine
  // corruption.
  for (const line of lines) {
    const pidMatch = /^pid=(\d+)$/.exec(line);
    if (pidMatch) {
      const n = Number.parseInt(pidMatch[1], 10);
      if (Number.isInteger(n) && n > 0) pid = n;
      continue;
    }
    const claimedMatch = /^claimed_at=(.+)$/.exec(line);
    if (claimedMatch) claimedAt = claimedMatch[1].trim();
  }
  return { format: "legacy", pid, pidStartedAt: null, session, claimedAt };
}

/** Owner token from a lock body of either format. The verify-claim
 *  `parseLockOwner` delegates here (single source of truth for owner
 *  extraction). A body that fails the JSON-v1 parse (corrupt `{…` content)
 *  or parses without a usable session falls back to the HISTORIC
 *  first-non-empty-line contract — verify-claim/gather keep returning an
 *  ownership verdict ("owned by '<junk>'", conservative) instead of
 *  degrading to unverifiable (review BH-F4). Null only for empty bodies. */
export function specLockOwner(raw: string): string | null {
  const body = parseSpecLockBody(raw);
  if (body?.session) return body.session;
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (t !== "") return t;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export type SpecLockClassification =
  /** No lock file on disk. */
  | { kind: "missing" }
  /** Empty/whitespace body — a peer's mid-write window. Held. */
  | { kind: "empty" }
  /** Body present but not attributable to any format. Reapable (matches
   *  the mgr106 unparseable posture). */
  | { kind: "unparseable" }
  /** Read failed with a non-ENOENT error (EACCES/EIO). Held (conservative). */
  | { kind: "unreadable" }
  /** Parseable but carries no PID — liveness unknowable. Held. */
  | { kind: "unknown-pid"; body: ParsedSpecLock }
  /** Holder PID alive (and, for v1, its start time matches the record).
   *  `ageMs` is now − claimed_at, or null when claimed_at is unparseable. */
  | { kind: "live"; body: ParsedSpecLock; ageMs: number | null }
  /** Holder PID not running. Reapable. */
  | { kind: "dead"; body: ParsedSpecLock }
  /** Holder PID alive but provably a different process. Reapable. */
  | { kind: "recycled"; body: ParsedSpecLock };

export interface SpecLockProbes {
  /** Test/fake-fs seam. Default: fs.readFileSync utf8. */
  readFile?: (path: string) => string;
  pidAlive?: (pid: number) => boolean;
  pidStartedAt?: (pid: number) => Date | null;
  now?: () => Date;
}

/** Reapable at claim time ⇔ dead, recycled, or unparseable. Exported so
 *  acquire, pick-time masking and `devx doctor` (db36af) dispatch on one
 *  predicate instead of three copies of the switch. */
export function isReapableSpecLock(cls: SpecLockClassification): boolean {
  return cls.kind === "dead" || cls.kind === "recycled" || cls.kind === "unparseable";
}

/**
 * Classify the spec lock at `lockPath`. Exported for `devx doctor`
 * (dev-db36af) — doctor consumes the classification and owns the offline
 * repair surface; this module never auto-reaps live PIDs.
 */
export function classifySpecLock(
  lockPath: string,
  probes: SpecLockProbes = {},
): SpecLockClassification {
  const readFile = probes.readFile ?? ((p: string) => readFileSync(p, "utf8"));
  let raw: string;
  try {
    raw = readFile(lockPath);
  } catch (err) {
    return isEnoentish(err) ? { kind: "missing" } : { kind: "unreadable" };
  }
  if (raw.trim() === "") return { kind: "empty" };
  const body = parseSpecLockBody(raw);
  if (!body) return { kind: "unparseable" };
  if (body.pid === null) return { kind: "unknown-pid", body };

  const pidAlive = probes.pidAlive ?? defaultPidAlive;
  if (!pidAlive(body.pid)) return { kind: "dead", body };

  // PID alive — recycling cross-check, v1-recorded start time preferred.
  // Legacy bodies get NO cross-check (header: E-3(b) pins liveness-only).
  const startedAt = (probes.pidStartedAt ?? ((pid: number) => probePidStartedAt(pid)))(
    body.pid,
  );
  if (startedAt && body.format === "json-v1") {
    const recorded = body.pidStartedAt !== null ? new Date(body.pidStartedAt) : null;
    if (recorded && Number.isFinite(recorded.getTime())) {
      if (startedAt.getTime() > recorded.getTime() + RECYCLING_GRACE_MS) {
        return { kind: "recycled", body };
      }
    } else {
      // v1 body without a usable recorded start (write-time probe failed):
      // claimed_at was machine-written at acquire, so the mgr106 heuristic
      // applies — a holder that started after the claim can't be the
      // claimer.
      const claimed = body.claimedAt !== null ? new Date(body.claimedAt) : null;
      if (
        claimed &&
        Number.isFinite(claimed.getTime()) &&
        startedAt.getTime() > claimed.getTime() + RECYCLING_GRACE_MS
      ) {
        return { kind: "recycled", body };
      }
    }
  }

  const claimedMs = body.claimedAt !== null ? new Date(body.claimedAt).getTime() : NaN;
  const nowMs = (probes.now ?? (() => new Date()))().getTime();
  const ageMs = Number.isFinite(claimedMs) ? Math.max(0, nowMs - claimedMs) : null;
  return { kind: "live", body, ageMs };
}

// ---------------------------------------------------------------------------
// Acquire (reap + retry once) / guarded release
// ---------------------------------------------------------------------------

/** Thrown when the lock is genuinely held (live holder, or an
 *  unverifiable-but-conservative classification). claim.ts maps this to
 *  its public LockHeldError → CLI exit 1. */
export class SpecLockHeldError extends Error {
  readonly lockPath: string;
  readonly holder: SpecLockClassification;
  constructor(lockPath: string, holder: SpecLockClassification) {
    super(`spec lock already held: ${lockPath} (${holder.kind})`);
    this.name = "SpecLockHeldError";
    this.lockPath = lockPath;
    this.holder = holder;
  }
}

export interface SpecLockAcquireFs {
  /** Atomic O_EXCL create — MUST throw EEXIST when the path exists. */
  openExclusive(path: string, contents: string): void;
  readFile(path: string): string;
  unlink(path: string): void;
}

export interface AcquireSpecLockDeps {
  fs: SpecLockAcquireFs;
  pidAlive?: (pid: number) => boolean;
  pidStartedAt?: (pid: number) => Date | null;
  /** Reap notifications (owner pid + why). Default: silent. */
  warn?: (msg: string) => void;
  /**
   * Reap authorization gate — evaluated lazily, only when the holder
   * classifies reapable. Default: always allow.
   *
   * Load-bearing for interactive claims (review BH-F1): `devx devx-helper
   * claim` runs in a short-lived CLI process, so the pid recorded in a
   * perfectly healthy interactive claim's lock is dead within seconds —
   * pid liveness is NOT claim liveness there. claimSpec passes a
   * row-readiness predicate: reap only when the backlog row is actually
   * claimable (`[ ]`), so a duplicate claim against a live peer's
   * in-progress item refuses (pre-mlc103 behavior) instead of destroying
   * the peer's lock, while genuine debris — dead lock left on a row the
   * operator flipped back to ready — still reaps on first contact (G-3).
   */
  allowReap?: () => boolean;
}

/**
 * O_EXCL acquire with the dead-owner reap: on EEXIST, classify the holder —
 * dead / recycled / unparseable (and authorized by `allowReap`) ⇒ WARN +
 * unlink + retry ONCE; anything else ⇒ SpecLockHeldError. Bounded exactly
 * like the manager lock's MAX_STALE_RETRIES=1: at most one reap pass, so a
 * peer re-creating the lock between our unlink and reopen surfaces as held
 * rather than looping. A lock that VANISHES between EEXIST and the classify
 * read gets its own tiny retry budget (it's retryable, not held — review
 * BH-F5), still bounded against a pathological create/delete flapper.
 *
 * MUST be called inside the backlog mutation lock — the classify→unlink→
 * reopen sequence is exactly the TOCTOU the lock serializes.
 */
export function acquireSpecLock(
  lockPath: string,
  body: string,
  deps: AcquireSpecLockDeps,
): void {
  let reapAttempts = 0;
  let vanishedAttempts = 0;
  while (true) {
    try {
      deps.fs.openExclusive(lockPath, body);
      return;
    } catch (err) {
      if (!isEexistish(err)) throw err;
      const cls = classifySpecLock(lockPath, {
        readFile: deps.fs.readFile,
        ...(deps.pidAlive !== undefined ? { pidAlive: deps.pidAlive } : {}),
        ...(deps.pidStartedAt !== undefined ? { pidStartedAt: deps.pidStartedAt } : {}),
      });
      if (cls.kind === "missing") {
        if (vanishedAttempts >= 2) throw new SpecLockHeldError(lockPath, cls);
        vanishedAttempts++;
        continue;
      }
      if (reapAttempts >= 1) throw new SpecLockHeldError(lockPath, cls);
      if (!isReapableSpecLock(cls) || !(deps.allowReap?.() ?? true)) {
        throw new SpecLockHeldError(lockPath, cls);
      }
      deps.warn?.(
        cls.kind === "unparseable"
          ? `spec lock at ${lockPath} is unparseable; reaping and retrying`
          : `spec lock at ${lockPath} holds pid ${(cls as { body: ParsedSpecLock }).body.pid} (${cls.kind === "dead" ? "not running" : "pid recycled"}); reaping and retrying`,
      );
      deps.fs.unlink(lockPath);
      reapAttempts++;
    }
  }
}

export type SpecLockReleaseResult =
  | { released: true }
  /** No lock on disk — benign (idempotent release). */
  | { released: false; reason: "missing" }
  /** Read failed non-ENOENT (EACCES/EIO) — left in place; needs a human. */
  | { released: false; reason: "unreadable" }
  /** Owner token doesn't match `session` — a peer re-claimed after our
   *  lock was cleared; their lock is left untouched (R7 closed). */
  | { released: false; reason: "not-owner"; owner: string | null };

export interface ReleaseSpecLockDeps {
  readFile?: (path: string) => string;
  unlink?: (path: string) => void;
}

/**
 * Guarded release: re-read the body and unlink only when the recorded
 * session matches `session` (after normalizeSessionToken-equivalent
 * trimming — the raw comparison is done by the caller-supplied
 * normalization to avoid a dep cycle with verify-claim; here we compare
 * the `/devx-` normalized forms directly).
 *
 * MUST be called inside the backlog mutation lock: read→compare→unlink is
 * the R7 TOCTOU without it. Unlink failures (EACCES/EPERM) propagate — the
 * caller's WARN path owns surfacing them.
 */
export function releaseSpecLockGuarded(
  lockPath: string,
  session: string,
  deps: ReleaseSpecLockDeps = {},
): SpecLockReleaseResult {
  const readFile = deps.readFile ?? ((p: string) => readFileSync(p, "utf8"));
  const unlink = deps.unlink ?? ((p: string) => unlinkSync(p));
  let raw: string;
  try {
    raw = readFile(lockPath);
  } catch (err) {
    return isEnoentish(err)
      ? { released: false, reason: "missing" }
      : { released: false, reason: "unreadable" };
  }
  const owner = specLockOwner(raw);
  if (owner === null) {
    // Empty body. At release time we HOLD the backlog lock and every
    // acquire also runs under it, so this cannot be a peer's mid-write
    // window (unlike the classify-at-acquire empty case) — it is our own
    // lock whose body write was lost. Leaving it would wedge the hash
    // (empty classifies conservative-held at claim time); unlink it
    // (review EC-1: the pre-mlc103 release cleaned this class too).
    try {
      unlink(lockPath);
    } catch (err) {
      if (isEnoentish(err)) return { released: false, reason: "missing" };
      throw err;
    }
    return { released: true };
  }
  if (normalizeToken(owner) !== normalizeToken(session)) {
    return { released: false, reason: "not-owner", owner };
  }
  try {
    unlink(lockPath);
  } catch (err) {
    if (isEnoentish(err)) return { released: false, reason: "missing" };
    throw err;
  }
  return { released: true };
}

/**
 * Release the lock of a spec the caller has just CLOSED, when no session
 * token is available to guard on.
 *
 * Not a third release path: it is the same unlink, gated on liveness instead
 * of on ownership. The distinction matters because a token is genuinely
 * unavailable here — the lock records the CLAIM process's
 * `defaultSessionId()`, and `markDone` runs in a different process minutes
 * or hours later, so a re-derived token can never match (b931a1 found this
 * the expensive way, and reported success while leaking every lock).
 *
 * WHY THE LIVENESS GATE, rather than an unconditional unlink. The first cut
 * argued that a `[x]` row cannot be claimed, so any lock present must be
 * ours. That is *nearly* true and not true enough: if the row were reset to
 * `[ ]` by a human or by `doctor --fix` and a peer re-claimed it, our
 * mark-done would flip its `[/]` to `[x]` and delete the PEER's live lock —
 * the R7 TOCTOU, reintroduced by the very change meant to clean up after it.
 * The suite caught it: `test/devx-finalize.test.ts`'s peer-reclaim case went
 * red. So a lock that classifies `live` is LEFT ALONE, always. Everything
 * else — dead pid, recycled pid, unparseable, empty — is debris by
 * definition and is what actually accumulated (14 instances by 2026-08-12,
 * the oldest 16 days old; lock #15 was created and orphaned inside the very
 * session that documented why #1–14 existed).
 *
 * This still closes the leak for the case that produced it: an interactive
 * claim runs in a short-lived CLI process, so its lock's pid is dead within
 * seconds and classifies reapable. A loop's lock stays `live` for the run's
 * duration — and the loop driver releases its own, guarded, on the way out.
 *
 * MUST be called inside the backlog mutation lock (the classify→unlink is a
 * TOCTOU without it), and only for a spec the caller has just made
 * unclaimable. Both are the caller's obligation.
 */
export function releaseSpecLockForClosedSpec(
  lockPath: string,
  deps: ReleaseSpecLockDeps & { pidAlive?: (pid: number) => boolean } = {},
): SpecLockReleaseResult {
  const unlink = deps.unlink ?? ((p: string) => unlinkSync(p));
  const cls = classifySpecLock(lockPath, {
    ...(deps.readFile !== undefined ? { readFile: deps.readFile } : {}),
    ...(deps.pidAlive !== undefined ? { pidAlive: deps.pidAlive } : {}),
  });
  if (cls.kind === "missing") return { released: false, reason: "missing" };
  if (cls.kind === "unreadable") return { released: false, reason: "unreadable" };
  if (cls.kind === "live" || cls.kind === "unknown-pid") {
    // A live holder — or one whose liveness is unknowable, which takes the
    // same conservative posture the classifier itself does.
    return {
      released: false,
      reason: "not-owner",
      owner: "session" in cls.body ? cls.body.session : null,
    };
  }
  try {
    unlink(lockPath);
  } catch (err) {
    if (isEnoentish(err)) return { released: false, reason: "missing" };
    // PROPAGATE, matching releaseSpecLockGuarded's contract: an EACCES/EPERM
    // means the lock is still on disk and every future claim of this hash
    // sees it. Flattening that to `reason: "unreadable"` told the operator
    // the body could not be read when in fact it read fine and the UNLINK
    // failed — a different problem with a different fix.
    throw err;
  }
  return { released: true };
}

/** Does the lock at `lockPath` record `session` as its owner? False on any
 *  read/parse failure (lock gone = claim no longer ours — roc101 posture). */
export function specLockOwnedBy(
  lockPath: string,
  session: string,
  readFile?: (path: string) => string,
): boolean {
  const rf = readFile ?? ((p: string) => readFileSync(p, "utf8"));
  try {
    const owner = specLockOwner(rf(lockPath));
    if (owner === null) return false;
    return normalizeToken(owner) === normalizeToken(session);
  } catch {
    return false;
  }
}

/** Same normalization as verify-claim's normalizeSessionToken (trim + strip
 *  one leading `/devx-`). Duplicating the 3-line rule beats an import that
 *  would make verify-claim ⇄ spec-lock cyclic once parseLockOwner delegates
 *  here; test/spec-lock.test.ts pins the two functions equal. */
function normalizeToken(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith("/devx-") ? trimmed.slice("/devx-".length) : trimmed;
}

function isEnoentish(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as NodeJS.ErrnoException;
  return e.code === "ENOENT" || (typeof e.message === "string" && e.message.startsWith("ENOENT"));
}

function isEexistish(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as NodeJS.ErrnoException;
  return e.code === "EEXIST" || (typeof e.message === "string" && e.message.startsWith("EEXIST"));
}
