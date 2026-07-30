// The watcher's judgment: is this session over, may we spawn a retro for this
// repo, can we ask the human — and, since rtl104 (T4.3), the drain loop that
// composes those answers with `spawn.ts`. What is NOT here is terminal I/O
// beyond the seams declared below and any flag/exit-code handling: those live
// in `commands/learn-watch.ts`, which stays thin passthrough (the `runLoop` /
// `src/lib/loop/driver.ts` precedent).
//
// Everything that reads the clock, the filesystem, git, or the terminal takes
// an injectable seam, because every one of these decisions has a failure mode
// that only shows up on a machine that isn't the one running the tests:
//
//   - **readiness fails safe, never open.** "No transcript to stat" is not
//     proof a session ended; treating it as ready spawns a focus-stealing tab
//     mid-work (upstream's round-3 bug). Age the entry against its own queue
//     `ts` instead. The one exception is an *undatable* entry — a hand-edited
//     `ts` that fails the strict ISO regex has no age to check, and wedging the
//     serial queue on it forever is the worse of the two failures, so it
//     serves.
//   - **allowlist keys are repo roots, and never the empty string.** Two
//     sessions started from two subdirectories of one checkout are one
//     decision, not two prompts; and a cwd-less entry must not be able to
//     write `{"": "allow"}`, which would read as "allow" for every other
//     cwd-less entry forever.
//   - **prompt-ability is a foreground-process-group test, not `isatty`.**
//     BSD/macOS `nohup` leaves stdin on the tty, so a backgrounded watcher
//     passes `isatty()`, reads from the terminal, takes SIGTTIN and *stops* —
//     which no `catch` can cover. Node exposes neither `getpgrp` nor
//     `tcgetpgrp`, so the platform-independent comparison upstream makes in
//     Python is done here by reading `ps -o stat= -p <pid>` and looking for
//     the trailing `+` that means "foreground".
//
// Ported semantics: `reference/harness-learn-watch` (its docstrings are the
// trap inventory) + `reference/2026-07-28-retro-listener.md` §"Failure modes".
//
// Spec: dev/dev-rtl103-2026-07-30T09:31-watcher-core.md (T3.1, T3.2)
// Design: _devx/workstreams/retro-listener/design.md §Architecture (Watch)

import { execFileSync } from "node:child_process";
import { readFileSync, statSync, unlinkSync } from "node:fs";
import { isatty } from "node:tty";

import {
  type AcquireExtra,
  type BlockingAcquireOpts,
  type LockHandle,
  PathLockHeldError,
  acquirePathLock,
  sleepSync,
} from "../manage/lock.js";
import { writeAtomic } from "../supervisor-internal.js";
import { LEARN_DEFAULTS } from "./config.js";
import {
  type RunFn,
  type SpawnArm,
  type SpawnResult,
  type SpawnRetroOpts,
  isSpawnableSessionId,
  spawnRetro,
} from "./spawn.js";
import {
  type LearnEnv,
  type QueueEntry,
  type TaggedEntry,
  appendDone,
  appendPending,
  doneMarkerPath,
  endedMarkerPath,
  isSafeSessionId,
  queuePath,
  readDone,
  readQueue,
  removeFromQueue,
  reposPath,
  watchLockPath,
  withQueueLock,
} from "./queue.js";

// ---------------------------------------------------------------------------
// Readiness (T3.1)
// ---------------------------------------------------------------------------

/** Design default (`learn.idle_minutes: 15`), in seconds. */
export const DEFAULT_IDLE_SECONDS = 15 * 60;

export interface ReadinessOpts {
  /** Learn home — only used to look for `<home>/markers/<sid>.ended`. */
  home: string;
  /** Quiet window that reads as "session over". Default {@link DEFAULT_IDLE_SECONDS}. */
  idleSeconds?: number;
  /** Epoch milliseconds. Injected everywhere so no test sleeps. */
  now?: () => number;
  /** `stat` seam — returns the transcript's mtime in epoch ms, or null when
   *  there is nothing to stat (missing file, unreadable, not a file). */
  mtimeMs?: (path: string) => number | null;
}

/**
 * Strict ISO-8601 instant: `YYYY-MM-DDTHH:MM:SS[.sss][Z|±HH:MM]`.
 *
 * Strict *on purpose*. `Date.parse` accepts a hand-typed `2026-07-28` and
 * anchors it at midnight UTC, which makes a date-only entry look freshly
 * queued (or ancient) depending on the day — either way the readiness verdict
 * becomes a coin flip on a value nobody intended as an instant. Failing the
 * regex instead makes the entry *undatable*, which {@link sessionOver} turns
 * into "serve it" rather than "wait forever".
 */
const STRICT_ISO =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * When the hook enqueued this entry, in epoch milliseconds, or `null` when the
 * entry carries no parseable instant.
 *
 * Deliberately the *original* `ts` and never `requeued_ts`: `requeueFromDone`
 * keeps `ts` and adds its own stamp, so an explicitly requeued old session is
 * instantly ready instead of serving a fresh idle window the human already
 * waited out once.
 */
export function queuedAt(entry: QueueEntry): number | null {
  const raw = entry.ts;
  if (typeof raw !== "string") return null;
  const m = STRICT_ISO.exec(raw);
  if (!m) return null;

  // Shape can pass while the value can't exist — and V8's `Date.parse` does
  // NOT reject those: `2026-02-31T00:00:00Z` silently rolls forward to March
  // 3rd. A rolled-over date is a *wrong* age, which is worse than no age at
  // all (no age serves; a wrong age can hold an entry back for days), so the
  // fields are range-checked here rather than left to the parser.
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

/** Default `stat` seam: mtime in epoch ms, or null for anything unstattable. */
function statMtimeMs(path: string): number | null {
  try {
    const st = statSync(path);
    return st.isFile() ? st.mtimeMs : null;
  } catch {
    return null;
  }
}

/**
 * Is the session behind this entry over — i.e. may we spawn its retro now?
 *
 * Three triggers, in order of confidence:
 *
 *   1. `<home>/markers/<sid>.ended` — the SessionEnd hook saw the session
 *      close. Exact, and the only fast path.
 *   2. transcript mtime older than the idle window — nothing has been written
 *      for `idleSeconds`, so the human has moved on.
 *   3. *no transcript to stat* — age the entry against its own queue `ts`.
 *      This is the fail-safe arm: the alternative (assume over) spawns a tab
 *      in the middle of a live session. An entry whose `ts` is undatable
 *      serves immediately, since there is no age to wait out and a wedged
 *      serial queue starves every session behind it.
 */
export function sessionOver(entry: QueueEntry, opts: ReadinessOpts): boolean {
  const idleMs = (opts.idleSeconds ?? DEFAULT_IDLE_SECONDS) * 1000;
  const now = opts.now ? opts.now() : Date.now();
  const mtimeOf = opts.mtimeMs ?? statMtimeMs;

  const sid = entry.session_id;
  if (isSafeSessionId(sid)) {
    // The marker path is derived, not user-controlled; an unsafe id can't
    // reach it (and never got a marker written either), so it falls through
    // to the mtime/age arms rather than throwing.
    if (statSync(endedMarkerPath(opts.home, sid), { throwIfNoEntry: false })) {
      return true;
    }
  }

  const tp = entry.transcript_path;
  const mtime = typeof tp === "string" && tp !== "" ? mtimeOf(tp) : null;
  if (mtime === null) {
    const queued = queuedAt(entry);
    if (queued === null) return true; // undatable — serve rather than wedge
    return now - queued > idleMs;
  }
  return now - mtime > idleMs;
}

// ---------------------------------------------------------------------------
// Repo allowlist (T3.2)
// ---------------------------------------------------------------------------

/** What `repos.json` may say about a repo. `null` = never reviewed. */
export type RepoDecision = "allow" | "deny";

/**
 * `git rev-parse` seam. Returns the command's trimmed stdout on success, or
 * `null` for any failure (non-zero exit, git missing, timeout) — the caller
 * treats "no answer" as "not a git checkout".
 */
export type GitExec = (cwd: string) => string | null;

export interface RepoOpts {
  /** Override the `git rev-parse --show-toplevel` call. */
  gitExec?: GitExec;
}

function defaultGitExec(cwd: string): string | null {
  try {
    const out = execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      timeout: 5_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const trimmed = out.trim();
    return trimmed === "" ? null : trimmed;
  } catch {
    return null;
  }
}

/**
 * Memo for {@link repoKey}. The watcher is a long-lived poll loop and
 * `pickReady` resolves a key for every ready entry on every pass — an unserved
 * backlog of 4 entries at a 5s poll forks `git` ~69k times a day without this.
 * A repo root moving under a running watcher is worth a restart, not a fork
 * per poll.
 */
const repoKeyCache = new Map<string, string>();

/** Drop the memo. Tests call this between cases; the watcher never does. */
export function resetRepoKeyCache(): void {
  repoKeyCache.clear();
}

/**
 * The allowlist key for a session's cwd: its git repo root, so two sessions
 * started from two subdirectories of one checkout are one decision rather than
 * two prompts. Falls back to the path itself when it isn't a checkout (or git
 * is unavailable) — the path is then the identity.
 *
 * An absent/blank cwd yields `""`, which every consumer below treats as "no
 * key": it is never looked up and never written. That is the structural half
 * of the poisoning guard — `{"": "allow"}` can be hand-written into
 * `repos.json` but can never be *reached*.
 */
export function repoKey(cwd: unknown, opts: RepoOpts = {}): string {
  if (typeof cwd !== "string" || cwd.trim() === "") return "";
  const cached = repoKeyCache.get(cwd);
  if (cached !== undefined) return cached;
  const resolved = (opts.gitExec ?? defaultGitExec)(cwd) ?? cwd;
  repoKeyCache.set(cwd, resolved);
  return resolved;
}

/**
 * Read `repos.json`. Tolerant like the queue readers: a missing file is the
 * common case, and a hand-mangled one degrades to "nothing reviewed yet"
 * rather than crashing a watcher that would otherwise keep draining.
 */
export function readRepos(home: string): Record<string, RepoDecision> {
  let raw: string;
  try {
    raw = readFileSync(reposPath(home), "utf8");
  } catch {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: Record<string, RepoDecision> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    // Unknown verdicts ("maybe", 1, null) are dropped rather than honored:
    // an unreadable decision must read as "never reviewed", which prompts,
    // not as an implicit allow.
    if (key !== "" && (value === "allow" || value === "deny")) out[key] = value;
  }
  return out;
}

/**
 * The recorded decision for this cwd's repo, or `null` if it has never been
 * reviewed. Never prompts — the watcher uses this to tell servable entries
 * from ones that need a human at a terminal.
 *
 * Two keys are consulted: the repo root, then the raw cwd (keys written before
 * repo-root keying, or by a hand-edited file). Blank keys are skipped on both
 * arms, so a cwd-less entry can never match a poisoned `{"": "allow"}` row.
 */
export function repoLookup(
  home: string,
  cwd: unknown,
  opts: RepoOpts = {},
): RepoDecision | null {
  const repos = readRepos(home);
  const raw = typeof cwd === "string" ? cwd : "";
  for (const key of [repoKey(cwd, opts), raw]) {
    if (key === "") continue;
    const hit = repos[key];
    if (hit !== undefined) return hit;
  }
  return null;
}

/**
 * Persist a decision for this cwd's repo, keyed by repo root, and return it.
 *
 * Throws on a keyless cwd rather than writing `{"": ...}`. Reaching here
 * without a cwd is a caller bug — `classifyEntry` retires cwd-less entries as
 * `error-malformed` long before the allowlist path — and a silent no-op would
 * make the watcher re-prompt for the same entry every pass.
 */
export function recordRepoDecision(
  home: string,
  cwd: unknown,
  decision: RepoDecision,
  opts: RepoOpts = {},
): RepoDecision {
  const key = repoKey(cwd, opts);
  if (key === "") {
    throw new Error("cannot record a repo decision without a cwd");
  }
  const repos = readRepos(home);
  repos[key] = decision;
  // Whole-file rewrite, so tmp+rename (the cross-epic atomic-write pattern):
  // a crash mid-write must leave the old allowlist, never a truncated one.
  writeAtomic(reposPath(home), JSON.stringify(repos, null, 2) + "\n");
  return decision;
}

// ---------------------------------------------------------------------------
// Prompt-ability (T3.2)
// ---------------------------------------------------------------------------

export interface PromptOpts {
  /** `isatty(0)` seam. */
  stdinIsTty?: () => boolean;
  /** `ps -o stat= -p <pid>` seam: the STAT field, or null if it can't be read. */
  processStat?: (pid: number) => string | null;
  /** Which pid to ask about. Defaults to this process. */
  pid?: number;
}

function defaultProcessStat(pid: number): string | null {
  try {
    const out = execFileSync("ps", ["-o", "stat=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 5_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const trimmed = out.trim();
    return trimmed === "" ? null : trimmed;
  } catch {
    return null;
  }
}

/**
 * Can we actually read an answer from the terminal without being stopped?
 *
 * `isatty()` alone is not enough. GNU `nohup` redirects stdin from /dev/null,
 * so on Linux a backgrounded watcher reads as non-interactive — but BSD/macOS
 * `nohup` only redirects stdout/stderr, leaving stdin on the tty. There
 * `isatty()` is true, a read reaches the terminal from a background job, the
 * process takes SIGTTIN and *stops*: not an exception, a stopped process, and
 * the documented "skips unreviewed repos rather than blocking" becomes a
 * hang. Upstream compares the process group to the terminal's foreground
 * group; Node binds neither `getpgrp` nor `tcgetpgrp`, so we read the STAT
 * field instead, where a trailing `+` means "in the foreground process group"
 * on both BSD and Linux `ps`.
 *
 * Fails closed on every unknown: no tty, no `ps`, unparseable STAT → false.
 * Skipping an unreviewed repo costs one deferred retro; guessing wrong the
 * other way costs a wedged watcher nobody is watching.
 *
 * Cheap by design (two syscalls' worth) — consumers re-check it immediately
 * before each prompt rather than trusting a value read at startup, because a
 * watcher Ctrl-Z'd and `bg`'d after launch has silently changed the answer.
 */
export function canPrompt(opts: PromptOpts = {}): boolean {
  const isTty = opts.stdinIsTty ?? (() => isatty(0));
  try {
    if (!isTty()) return false;
  } catch {
    return false;
  }
  const stat = (opts.processStat ?? defaultProcessStat)(opts.pid ?? process.pid);
  if (typeof stat !== "string") return false;
  return stat.trim().endsWith("+");
}

/** A recorded decision, or `unknown` = "nobody has reviewed this repo and we
 *  can't ask right now" — the caller skips the entry rather than guessing. */
export type RepoVerdict = RepoDecision | "unknown";

export interface RepoDecisionOpts extends RepoOpts, PromptOpts {
  /** Did this run start attached to an answerable terminal? */
  interactive: boolean;
  /**
   * Ask the human about `key` and hand back their raw answer, or `null` when
   * stdin went away between the check and the read. Required: this module owns
   * no terminal I/O, so the actual readline lives in the CLI layer.
   */
  ask: (key: string) => string | null;
  /** {@link canPrompt} seam for the re-check. Default: the real thing. */
  promptable?: () => boolean;
}

/**
 * May we spawn a retro for this cwd's repo — `allow`, `deny`, or `unknown`?
 *
 * A recorded verdict short-circuits; otherwise this is the *only* place that
 * prompts, and it re-runs {@link canPrompt} first rather than trusting the
 * value the run started with. A watcher Ctrl-Z'd and `bg`'d after launch is no
 * longer in the terminal's foreground group, and reading there does not throw —
 * it takes SIGTTIN and *stops* the process, which no `catch` can cover. The
 * re-check costs two syscalls; skipping it costs a wedged watcher.
 *
 * `unknown` is also what a vanished stdin (`ask` → null) yields, so the caller
 * can drop to non-interactive for the rest of the run instead of looping on an
 * unanswerable prompt.
 */
export function repoDecision(
  home: string,
  cwd: unknown,
  opts: RepoDecisionOpts,
): RepoVerdict {
  const known = repoLookup(home, cwd, opts);
  if (known !== null) return known;
  if (!opts.interactive) return "unknown";
  const promptable = opts.promptable ?? (() => canPrompt(opts));
  if (!promptable()) return "unknown";
  const key = repoKey(cwd, opts);
  // Unreachable via the drain loop (`classifyEntry` retires cwd-less entries
  // first), but a keyless prompt could only write `{"": …}`, so it defers.
  if (key === "") return "unknown";
  const answer = opts.ask(key);
  if (answer === null) return "unknown";
  const decision: RepoDecision = /^y(es)?$/i.test(answer.trim()) ? "allow" : "deny";
  return recordRepoDecision(home, cwd, decision, opts);
}

// ---------------------------------------------------------------------------
// Entry classification + pickReady (T3.3)
// ---------------------------------------------------------------------------

/**
 * The outcome vocabulary written to the done log (FR-3, verbatim upstream).
 *
 * `manual` is the one outcome no marker can produce: on a machine with neither
 * tmux nor Terminal.app the command is printed for the human and the entry is
 * retired *immediately*. Filing it as anything else would either lie about a
 * retro that may never run or (upstream's bug) hold the serial queue for the
 * full retro timeout waiting on a marker only a human could trigger.
 */
export type Outcome =
  | "completed"
  | "completed-interrupted"
  | "error-cd"
  | "error-malformed"
  | "error-spawn"
  | "manual"
  | "skipped-denied-repo"
  | "timeout"
  | `error-fork:${string}`;

export type EntryClass = "ok" | "error-malformed";

/**
 * Can this queue line be served at all?
 *
 * `error-malformed` covers the three shapes that only misbehave downstream:
 *
 *   - **no `session_id`** — nothing to `claude --resume`; a hand-edited line.
 *   - **an unsafe `session_id`** — one that can't be a marker filename, so its
 *     completion marker could never be found and the drain would await a
 *     timeout it can't avoid.
 *   - **no `cwd`** — writable by the *normal* path (the hook records
 *     `payload.cwd`, which can be null), and past this point a blank cwd only
 *     does damage: `cd ''` is a no-op so the fork runs in the wrong directory
 *     and files as `error-fork` rather than `error-cd`, and `repoKey("")` is
 *     the empty key the allowlist guard exists to keep unreachable.
 *
 * Sessions are per-project: without an id or a directory there is nothing to
 * resume, so the drain retires the entry rather than wedging the serial queue
 * on it forever (or re-crashing on the same head entry after every restart).
 */
export function classifyEntry(entry: QueueEntry): EntryClass {
  if (!isSafeSessionId(entry.session_id)) return "error-malformed";
  if (typeof entry.cwd !== "string" || entry.cwd.trim() === "") return "error-malformed";
  return "ok";
}

/**
 * The skip-set key for an entry: its `session_id`, or its line when it has
 * none. `--dry-run` remembers what it has already dealt with instead of
 * consuming it, and a malformed line (which has no id, by definition) would
 * otherwise be re-picked and re-printed on every pass.
 */
export function skipKey(entry: TaggedEntry): string {
  const sid = entry.session_id;
  if (typeof sid === "string" && sid !== "") return sid;
  return `#line:${entry.lineIndex ?? -1}`;
}

/** Readiness seams minus `home`, which {@link pickReady} takes as its own
 *  argument — one home per call, so a mismatched pair can't send readiness to a
 *  different markers directory than the queue it just read. */
export interface PickReadyOpts extends Omit<ReadinessOpts, "home">, RepoOpts {
  /** Can this run answer an allow prompt? Unreviewed repos are unservable when not. */
  interactive: boolean;
  /** Keys ({@link skipKey}) this run has dealt with without consuming — dry-run only. */
  skip?: ReadonlySet<string>;
}

export interface ReadyPick {
  /** The entry to serve next, or null when nothing is servable this pass. */
  entry: (QueueEntry & TaggedEntry) | null;
  /**
   * Ready entries passed over on the way to {@link entry}: unreviewed repos a
   * non-interactive run can't ask about. Only what we walked past — entries
   * behind the pick are not examined.
   */
  unservable: Array<QueueEntry & TaggedEntry>;
}

/**
 * The first ready entry we can actually serve, plus the ready ones we can't.
 *
 * Skip-don't-starve: a non-interactive watcher (`nohup … < /dev/null &`) can't
 * answer the allow prompt, so an unreviewed repo is unservable — and stopping
 * at it would let one unknown repo starve every other repo's retro
 * permanently. The caller notes each skipped entry once per session and moves
 * on.
 *
 * Malformed entries are classified *before* the allowlist arm, deliberately
 * diverging from upstream: there, a cwd-less entry keys as `""`, looks up as
 * "never reviewed", and a non-interactive run therefore reports it as an
 * unreviewed repo forever instead of retiring it. Here it comes back as the
 * pick so the drain can file it `error-malformed` — the AC-4 promise that
 * malformed entries are retired before any prompt or spawn path.
 */
export function pickReady(home: string, opts: PickReadyOpts): ReadyPick {
  const skip = opts.skip;
  const unservable: Array<QueueEntry & TaggedEntry> = [];
  for (const entry of readQueue(home)) {
    if (skip?.has(skipKey(entry))) continue;
    if (!sessionOver(entry, { ...opts, home })) continue;
    if (classifyEntry(entry) === "error-malformed") return { entry, unservable };
    if (!opts.interactive && repoLookup(home, entry.cwd, opts) === null) {
      unservable.push(entry);
      continue;
    }
    return { entry, unservable };
  }
  return { entry: null, unservable };
}

// ---------------------------------------------------------------------------
// Outcomes + queue ops (T3.4)
// ---------------------------------------------------------------------------

/** Cap on the status echoed into `error-fork:<status>` — the done log is a
 *  dataset, and marker content is whatever landed on disk. */
const MAX_STATUS_CHARS = 64;

/**
 * Translate a completion marker's contents into a done-log outcome.
 *
 * `marker` is the marker file's text, or `null` when there is no marker — the
 * bounded await gave up, so the tab was SIGKILL'd or the human never finished.
 *
 *   - `""` / `"0"` → `completed`. Empty counts: the marker exists, so the
 *     wrapper reached its write.
 *   - `"signal"` → `completed-interrupted`, for markers still in flight from a
 *     pre-`rc=$?` wrapper.
 *   - `"error-cd"` → `error-cd`: the spawned shell couldn't enter the cwd.
 *   - ≥128 → `completed-interrupted`. 128+N means `claude` was killed by
 *     signal N — the tab went away, which is a user gesture, not a fork that
 *     failed to start.
 *   - any other status → `error-fork:<status>`. Only a real nonzero exit is a
 *     fork failure.
 */
export function mapMarkerToOutcome(marker: string | null | undefined): Outcome {
  if (typeof marker !== "string") return "timeout";
  const status = (marker.split("\n", 1)[0] ?? "").trim().slice(0, MAX_STATUS_CHARS);
  if (status === "" || status === "0") return "completed";
  if (status === "signal") return "completed-interrupted";
  if (status === "error-cd") return "error-cd";
  if (/^\d+$/.test(status) && Number(status) >= 128) return "completed-interrupted";
  return `error-fork:${status}`;
}

export interface FinishOpts {
  /** Clock seam for `processed_ts`. */
  now?: () => Date;
  /** Queue-lock tuning for the removal half. */
  lock?: BlockingAcquireOpts;
}

/**
 * Retire an entry: append it to the done log with its outcome, cut it from the
 * pending queue, and drop its markers. Returns whether a queue row was cut
 * (false = someone already drained it).
 *
 * Evidence first, on purpose. A crash between the append and the removal
 * leaves the entry in both files, so the next pass re-serves it and the done
 * log gets a second row — visible, and de-dupable after the fact. The other
 * order loses the row entirely, and the done log is the phase-2 dataset.
 *
 * Removal is by line identity, not `session_id`: that is what lets a malformed
 * id-less line be retired at all (queue.ts contract 2), and it runs inside the
 * queue lock so the read-and-rewrite is one critical section.
 */
export function finish(
  home: string,
  entry: QueueEntry & TaggedEntry,
  outcome: Outcome,
  opts: FinishOpts = {},
): boolean {
  appendDone(home, entry, outcome, opts.now);
  const removed = withQueueLock(home, () => removeFromQueue(home, entry), opts.lock);
  const sid = entry.session_id;
  if (isSafeSessionId(sid)) {
    for (const path of [endedMarkerPath(home, sid), doneMarkerPath(home, sid)]) {
      try {
        unlinkSync(path);
      } catch {
        // Absent is the common case; an undeletable marker is not worth
        // failing a retirement that already made it into the done log.
      }
    }
  }
  return removed;
}

/**
 * Put a processed session back on the pending queue — the manual undo for a
 * retro that timed out, died with the tab, or was simply worth redoing.
 *
 * The most recent done row wins. `processed_ts` and `outcome` are stripped so
 * the entry reads as pending again, `requeued_ts` records the revival, and the
 * original `ts` is *kept*: readiness keys off `ts`, so a requeued session is
 * instantly ready rather than serving a fresh idle window the human already
 * waited out once.
 *
 * Throws when there is no such done row, and when the session is already
 * pending — appending a duplicate would spawn two retros for one session.
 */
export function requeueFromDone(
  home: string,
  sid: string,
  opts: { now?: () => Date; lock?: BlockingAcquireOpts } = {},
): QueueEntry {
  const matches = readDone(home).filter((e) => e.session_id === sid);
  const last = matches[matches.length - 1];
  if (!last) {
    throw new Error(`no processed entry for session ${sid} in the done log`);
  }
  const now = opts.now ?? (() => new Date());
  const { processed_ts: _ts, outcome: _outcome, ...rest } = last;
  const entry: QueueEntry = { ...rest, requeued_ts: now().toISOString() };
  withQueueLock(
    home,
    () => {
      if (readQueue(home).some((e) => e.session_id === sid)) {
        throw new Error(`session ${sid} is already pending`);
      }
      appendPending(home, entry, now);
    },
    opts.lock,
  );
  return entry;
}

/**
 * Take the watcher singleton, or throw. Release the returned handle when the
 * drain ends.
 *
 * Serialism is the invariant the whole design rests on: concurrent retros
 * collide in one checkout and race each other's open-PR dedupe. The queue lock
 * guards the queue *rewrite*, not pick → spawn → finish, so two watchers would
 * both take the head entry — two tabs for one session, two `completed` rows
 * for one retro. Not contrived: the docs both say "leave it running in a spare
 * terminal" and give a `nohup` line, and a watcher that survived a laptop
 * sleep is invisible.
 *
 * A separate inode from the queue lock, so a long-held watcher can never block
 * the Stop hook's append.
 */
export function claimWatcherSingleton(home: string, opts: AcquireExtra = {}): LockHandle {
  return acquirePathLock(watchLockPath(home), {
    ...opts,
    heldError: (path) =>
      new PathLockHeldError(
        path,
        `another watcher is already draining ${queuePath(home)} — retros are serial by ` +
          `design; stop that one first, or run \`devx learn-watch list\` to see the queue. ` +
          `Lock: ${path}`,
      ),
  });
}

// ---------------------------------------------------------------------------
// awaitMarker (T4.3)
// ---------------------------------------------------------------------------

/** Scan interval between drain passes. */
export const DEFAULT_SCAN_POLL_MS = 5_000;
/** Poll interval while waiting on a spawned retro's completion marker. */
export const DEFAULT_MARKER_POLL_MS = 2_000;
/** `learn.retro_timeout_minutes` (360) in ms — the SIGKILL/never-finished bound. */
export const DEFAULT_RETRO_TIMEOUT_MS = LEARN_DEFAULTS.retroTimeoutMinutes * 60_000;

export interface AwaitMarkerOpts {
  /** Give up after this long and report `null` (→ `timeout`). */
  timeoutMs?: number;
  /** Poll interval. Injected so sequencing tests never sleep wall-clock. */
  pollMs?: number;
  /** Clock seam (epoch ms). */
  now?: () => number;
  /** Synchronous sleep seam. Default {@link sleepSync}. */
  sleep?: (ms: number) => void;
  /** Marker read seam: the file's text, or null when it isn't there yet. */
  readMarker?: (path: string) => string | null;
  /** SIGINT seam — abandon the wait (the entry stays pending, by design). */
  shouldStop?: () => boolean;
}

function defaultReadMarker(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * Block until the spawned retro's `<sid>.done` marker appears, and return its
 * contents — or `null` when the bound expired or the watcher was interrupted.
 *
 * Polling a file is the *only* completion signal available: `tmux new-window`
 * and `osascript … do script` both return as soon as the window exists, so the
 * retro is not our child and there is nothing to `wait` on. The bound is what
 * covers the one exit path the wrapper's trap cannot — SIGKILL, or a human who
 * closes the laptop and never finishes — and `null` maps to `timeout` rather
 * than to a fabricated status.
 *
 * Synchronous on purpose: the whole drain is serial, and an async poll here
 * would buy nothing but an event loop to keep alive. Two bounds, not one: the
 * deadline, plus a poll-count backstop so an injected clock that doesn't
 * advance (a pinned test clock, a suspended VM's monotonic source) degrades to
 * a timeout instead of spinning forever.
 */
export function awaitMarker(home: string, sid: string, opts: AwaitMarkerOpts = {}): string | null {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_RETRO_TIMEOUT_MS;
  const pollMs = Math.max(1, opts.pollMs ?? DEFAULT_MARKER_POLL_MS);
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? sleepSync;
  const read = opts.readMarker ?? defaultReadMarker;
  const path = doneMarkerPath(home, sid);

  const deadline = now() + timeoutMs;
  const maxPolls = Math.ceil(timeoutMs / pollMs) * 2 + 4;
  for (let poll = 0; poll < maxPolls; poll++) {
    const marker = read(path);
    if (marker !== null) return marker;
    if (opts.shouldStop?.()) return null;
    const left = deadline - now();
    if (left <= 0) return null;
    sleep(Math.min(pollMs, left));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Drain loop (T4.3)
// ---------------------------------------------------------------------------

/** {@link spawnRetro}'s shape, as a seam — tests pass a fake so no suite ever
 *  opens a window, and the CLI passes nothing. */
export type SpawnFn = (
  home: string,
  entry: { session_id?: unknown; cwd?: unknown },
  opts: SpawnRetroOpts,
) => SpawnResult;

export interface DrainPassOpts extends RepoOpts, PromptOpts {
  /** Learn home — queue, done log, markers, locks. */
  home: string;
  /** Print-only: no spawn, no marker, no done-log row, no queue rewrite. */
  dryRun?: boolean;
  /** Did this run start attached to an answerable terminal? */
  interactive: boolean;
  /** Readiness window. Default {@link DEFAULT_IDLE_SECONDS}. */
  idleSeconds?: number;
  /** Clock seam (epoch ms) — readiness, `processed_ts`, and the marker bound. */
  now?: () => number;
  /** Line-buffered output seam. */
  log?: (line: string) => void;
  /**
   * Keys ({@link skipKey}) this run has already dealt with. Lives for the whole
   * run, not the pass: it is what keeps `--dry-run` from re-printing the head
   * entry every 5s, and what keeps an unservable entry from starving the ones
   * behind it. Created per-call when the caller doesn't own one.
   */
  seen?: Set<string>;
  /** Keys whose status note has already been printed — once per session, not
   *  once per pass, so a skipped entry doesn't scroll a note every scan. */
  noted?: Set<string>;
  /** Terminal read for the allow prompt. This module owns no terminal I/O, so
   *  the default declines (→ `unknown` → the run drops to non-interactive). */
  ask?: (key: string) => string | null;
  /** {@link canPrompt} seam for the pre-prompt re-check. */
  promptable?: () => boolean;
  /** Readiness `stat` seam. */
  mtimeMs?: (path: string) => number | null;
  /** Forced spawn arm / arm-selection inputs, forwarded to {@link spawnRetro}. */
  arm?: SpawnArm;
  env?: LearnEnv;
  platform?: NodeJS.Platform | string;
  /** `tmux`/`osascript` seam, forwarded to {@link spawnRetro}. */
  run?: RunFn;
  /** {@link spawnRetro} seam. */
  spawn?: SpawnFn;
  /** {@link awaitMarker} seam (a fake completes instantly in tests). */
  awaitMarkerFn?: (sid: string) => string | null;
  /** Marker-wait bound + poll, forwarded to {@link awaitMarker}. */
  retroTimeoutMs?: number;
  markerPollMs?: number;
  /** Synchronous sleep seam, forwarded to {@link awaitMarker}. */
  sleep?: (ms: number) => void;
  /** SIGINT seam: stop between entries and mid-marker-wait. */
  shouldStop?: () => boolean;
}

export interface DrainSummary {
  /** Entries this pass took a decision on (dry-run prints included). */
  handled: number;
  /** Entries retired into the done log. Always 0 under `--dry-run`. */
  retired: number;
  /** Spawn commands printed under `--dry-run`. */
  printed: number;
  /** Ready entries walked past (unreviewed repo, unanswerable prompt). */
  skipped: number;
  /** What was filed, in order — the pass's contribution to the done log. */
  outcomes: Array<{ session_id: string | null; outcome: Outcome }>;
  /** Interactivity as it stands *after* the pass: a prompt whose stdin
   *  vanished drops the rest of the run to non-interactive. */
  interactive: boolean;
}

/** How an entry reads in the log: session id (or its line) plus its cwd. */
function entryLabel(entry: QueueEntry & TaggedEntry): string {
  const sid = typeof entry.session_id === "string" && entry.session_id !== ""
    ? entry.session_id
    : `<line ${(entry.lineIndex ?? -1) + 1}>`;
  const cwd = typeof entry.cwd === "string" && entry.cwd !== "" ? entry.cwd : "<no cwd>";
  return `${sid} (${cwd})`;
}

/** The done-log identity of an entry, or null for an id-less (malformed) line. */
function sessionIdOf(entry: QueueEntry): string | null {
  return typeof entry.session_id === "string" && entry.session_id !== "" ? entry.session_id : null;
}

/**
 * One drain pass: serve ready entries — one at a time, to completion — until
 * nothing else is servable, then return.
 *
 * "Pass" is deliberately the whole queue rather than a single entry: the
 * watcher's contract is serial, not one-per-scan, and a per-entry pass would
 * make a 4-deep backlog take 4 scan intervals to clear (and would make
 * `--dry-run` print only the head entry, which is the one thing a setup check
 * must not do).
 *
 * The order of the guards is the contract:
 *
 *   1. **malformed first** — before any prompt or spawn. Two screens, not one:
 *      `classifyEntry` uses queue.ts's *filename* charset, while a spawn also
 *      puts the id in an argv and a shell string, so a hand-edited `abc_def`
 *      classifies `ok` there and throws in `spawnRetro`. Screening with
 *      {@link isSpawnableSessionId} here is what keeps that difference from
 *      wedging the serial queue on the head entry after every restart.
 *   2. **repo decision** — `deny` retires as `skipped-denied-repo`; `unknown`
 *      (stdin vanished between the foreground check and the read) notes once
 *      and drops the rest of the run to non-interactive rather than looping on
 *      an unanswerable prompt.
 *   3. **spawn** — and only the `spawned` arm reaches {@link awaitMarker}.
 *      `manual` and `error-spawn` are terminal: the command was printed, so
 *      the entry is retired immediately instead of holding the serial queue
 *      for the full retro timeout on a marker nobody will write.
 *
 * `--dry-run` is non-destructive *by construction*, not by care: nothing on
 * the dry path calls `finish`, `recordRepoDecision`, or a non-print spawn. It
 * also asks `pickReady` to treat unreviewed repos as servable — a setup check
 * that hides exactly the entries whose repo hasn't been decided yet would show
 * an empty queue on the very first run, which is when it is run.
 */
export function drainPass(opts: DrainPassOpts): DrainSummary {
  const { home } = opts;
  const dryRun = opts.dryRun === true;
  const log = opts.log ?? ((line: string) => process.stdout.write(`${line}\n`));
  const seen = opts.seen ?? new Set<string>();
  const noted = opts.noted ?? new Set<string>();
  const now = opts.now ?? (() => Date.now());
  const nowDate = () => new Date(now());
  const spawn = opts.spawn ?? spawnRetro;
  const await_ =
    opts.awaitMarkerFn ??
    ((sid: string) =>
      awaitMarker(home, sid, {
        timeoutMs: opts.retroTimeoutMs,
        pollMs: opts.markerPollMs,
        now,
        sleep: opts.sleep,
        shouldStop: opts.shouldStop,
      }));

  const summary: DrainSummary = {
    handled: 0,
    retired: 0,
    printed: 0,
    skipped: 0,
    outcomes: [],
    interactive: opts.interactive,
  };

  const note = (key: string, line: string): void => {
    if (noted.has(key)) return;
    noted.add(key);
    log(line);
  };

  const retire = (entry: QueueEntry & TaggedEntry, outcome: Outcome): void => {
    // The one write barrier: every done-log/queue mutation in the drain goes
    // through here, so `--dry-run`'s "changes nothing" is a single condition
    // rather than a promise repeated at six call sites.
    if (dryRun) return;
    finish(home, entry, outcome, { now: nowDate });
    summary.retired++;
    summary.outcomes.push({ session_id: sessionIdOf(entry), outcome });
  };

  for (;;) {
    if (opts.shouldStop?.()) break;

    const pick = pickReady(home, {
      ...opts,
      interactive: dryRun ? true : summary.interactive,
      skip: seen,
      now,
    });

    for (const passed of pick.unservable) {
      const key = skipKey(passed);
      seen.add(key);
      summary.skipped++;
      note(
        key,
        `  skip ${entryLabel(passed)} — repo not reviewed and this run can't ask; ` +
          `run \`devx learn-watch\` in a foreground terminal to decide`,
      );
    }

    const entry = pick.entry;
    if (entry === null) break;

    // Marked handled before anything can throw: a pass must never revisit an
    // entry it has already taken a decision on, or a spawn that fails in a new
    // way turns into an infinite loop on the head entry.
    seen.add(skipKey(entry));
    summary.handled++;

    const sid = entry.session_id;
    if (classifyEntry(entry) !== "ok" || !isSpawnableSessionId(sid)) {
      log(`  ${entryLabel(entry)}: unusable queue entry — filing error-malformed`);
      retire(entry, "error-malformed");
      continue;
    }

    if (dryRun) {
      // Never prompts and never writes `repos.json`, so only a *recorded*
      // decision can be honored here; an unreviewed repo is reported as one.
      const known = repoLookup(home, entry.cwd, opts);
      if (known === "deny") {
        log(`  [dry-run] would skip ${entryLabel(entry)} — repo denied`);
        continue;
      }
      if (known === null) {
        log(`  [dry-run] ${entryLabel(entry)} — repo not reviewed yet; a real run would ask first`);
      }
    } else {
      const verdict = repoDecision(home, entry.cwd, {
        ...opts,
        interactive: summary.interactive,
        ask: opts.ask ?? (() => null),
      });
      if (verdict === "deny") {
        log(`  ${entryLabel(entry)}: repo denied — filing skipped-denied-repo`);
        retire(entry, "skipped-denied-repo");
        continue;
      }
      if (verdict === "unknown") {
        note(
          skipKey(entry),
          `  skip ${entryLabel(entry)} — the allow prompt could not be answered; ` +
            `continuing non-interactively`,
        );
        summary.skipped++;
        summary.interactive = false;
        continue;
      }
    }

    if (!dryRun) log(`  retro for ${entryLabel(entry)} — opening a window`);
    const result = spawn(home, entry, {
      dryRun,
      arm: opts.arm,
      env: opts.env,
      platform: opts.platform,
      run: opts.run,
      log,
    });

    if (result === "dry-run") {
      summary.printed++;
      continue;
    }
    if (result === "manual") {
      retire(entry, "manual");
      continue;
    }
    if (result === "error-spawn") {
      retire(entry, "error-spawn");
      continue;
    }

    const marker = await_(sid);
    if (marker === null && opts.shouldStop?.() === true) {
      // Interrupted, not timed out. The retro's window is very likely still
      // open, so filing `timeout` here would put a fabricated row in the
      // dataset the phase-2 debate rests on. Leave the entry pending instead —
      // the queue is durable and the message says so.
      log(
        `  ${entryLabel(entry)}: interrupted while its retro was open — left pending ` +
          `(finish it in that window, or requeue after it lands)`,
      );
      break;
    }
    const outcome = mapMarkerToOutcome(marker);
    log(`  ${entryLabel(entry)}: ${outcome}`);
    retire(entry, outcome);
  }

  return summary;
}

export interface RunWatchOpts extends Omit<DrainPassOpts, "seen" | "noted"> {
  /** Wait between passes. Default {@link DEFAULT_SCAN_POLL_MS}. */
  scanPollMs?: number;
  /** Stop after this many passes — the bound tests run under. Unset = forever
   *  (until `shouldStop`), which is what the CLI wants. */
  maxPasses?: number;
  /** Take the watcher singleton for the duration. Default: every run except
   *  `--dry-run` (a read-only setup check must not demand killing a working
   *  watcher — and must not take a lock a working watcher would then lose). */
  claim?: boolean;
  /** Singleton-claim tuning, forwarded to {@link claimWatcherSingleton}. */
  claimOpts?: AcquireExtra;
}

/**
 * The foreground watcher: claim the singleton, then drain-and-wait until
 * interrupted.
 *
 * The `seen`/`noted` sets are created here and shared across every pass — they
 * are per-*run* state (see {@link DrainPassOpts.seen}), and re-creating them
 * per pass would make `--dry-run` reprint the whole queue every 5 seconds and
 * a skipped entry re-note forever.
 *
 * `PathLockHeldError` propagates rather than being caught: the CLI turns it
 * into exit 1 with the lock path in the message, and swallowing it here would
 * mean two watchers draining one queue — two tabs for one session.
 */
export function runWatch(opts: RunWatchOpts): DrainSummary {
  const claim = opts.claim ?? opts.dryRun !== true;
  const handle = claim ? claimWatcherSingleton(opts.home, opts.claimOpts) : null;
  const scanPollMs = Math.max(1, opts.scanPollMs ?? DEFAULT_SCAN_POLL_MS);
  const sleep = opts.sleep ?? sleepSync;
  const seen = new Set<string>();
  const noted = new Set<string>();

  const total: DrainSummary = {
    handled: 0,
    retired: 0,
    printed: 0,
    skipped: 0,
    outcomes: [],
    interactive: opts.interactive,
  };

  try {
    for (let pass = 0; opts.maxPasses === undefined || pass < opts.maxPasses; pass++) {
      if (opts.shouldStop?.()) break;
      const one = drainPass({ ...opts, interactive: total.interactive, seen, noted });
      total.handled += one.handled;
      total.retired += one.retired;
      total.printed += one.printed;
      total.skipped += one.skipped;
      total.outcomes.push(...one.outcomes);
      total.interactive = one.interactive;
      if (opts.shouldStop?.()) break;
      if (opts.maxPasses !== undefined && pass === opts.maxPasses - 1) break;
      sleep(scanPollMs);
    }
  } finally {
    handle?.release();
  }

  return total;
}
