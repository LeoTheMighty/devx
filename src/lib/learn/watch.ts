// The watcher's judgment, as pure functions: is this session over, may we
// spawn a retro for this repo, and can we ask the human. No process spawning,
// no drain loop, no terminal I/O beyond the seams declared here — those live in
// `spawn.ts` / `learn-watch.ts` (Phase 4) and compose this file.
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
import { readFileSync, statSync } from "node:fs";
import { isatty } from "node:tty";

import { writeAtomic } from "../supervisor-internal.js";
import {
  type QueueEntry,
  endedMarkerPath,
  isSafeSessionId,
  reposPath,
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
