// `devx learn-watch` — the serial retro watcher's CLI surface (rtl104, T4.4).
//
// Thin wiring ONLY, per the `devx loop` / `src/lib/loop/driver.ts` precedent:
// flag parsing, home/config resolution, terminal I/O (the allow prompt lives
// here because `src/lib/learn/watch.ts` deliberately owns no terminal), the
// exit-code table, and the two read/repair subcommands. Every decision — what
// is ready, which repo may spawn, what outcome to file — stays in the lib.
//
//   devx learn-watch              # drain the queue, serially, until Ctrl-C
//   devx learn-watch --dry-run    # print spawn commands; changes nothing, and
//                                 # is NOT refused while a real watcher runs
//   devx learn-watch list         # pending + readiness · last processed + outcomes
//   devx learn-watch requeue <sid>  # put a processed session back on the queue
//
// Exit codes (design.md §Interfaces):
//   0 — clean stop, including SIGINT ("queue is durable; restart anytime") and
//       every `list`.
//   1 — the watcher singleton is held (message names the lock path), or
//       `requeue` found no such processed session / it is already pending.
//   2 — usage error: an unknown flag, an unknown subcommand, a missing
//       `<sid>`. Commander's own usage failures are mapped here too, via the
//       `exitOverride` below — its default is 1, which this table gives to a
//       *held lock*, and a human reading `$?` should not have to guess which.
//
// Output is line-buffered by construction: every status line is one `write`
// with its own trailing newline, so `devx learn-watch > watch.log &` shows
// progress as it happens rather than in 4KB bursts.
//
// Spec: dev/dev-rtl104-2026-07-30T09:31-watcher-cli-spawn.md (T4.4)
// Design: _devx/workstreams/retro-listener/design.md §Interfaces
// Plan: _devx/workstreams/retro-listener/plan.md §Phase 4

import { readSync } from "node:fs";
import process from "node:process";

import type { Command } from "commander";

import { loadMerged } from "../lib/config-io.js";
import { attachPhase } from "../lib/help.js";
import { learnConfigFrom, resolveLearnHome } from "../lib/learn/config.js";
import {
  type LearnEnv,
  type QueueEntry,
  donePath,
  queuePath,
  readDone,
  readQueue,
} from "../lib/learn/queue.js";
import {
  DEFAULT_SCAN_POLL_MS,
  canPrompt,
  claimWatcherSingleton,
  drainPass,
  requeueFromDone,
  sessionOver,
} from "../lib/learn/watch.js";
import { type LockHandle, PathLockHeldError } from "../lib/manage/lock.js";

/** Output seams. Defaults write straight through to the real streams — one
 *  line per call, never buffered by us. */
export interface LearnWatchIO {
  out?: (line: string) => void;
  err?: (line: string) => void;
}

/** Home + readiness/timeout knobs, resolved once per invocation. */
export interface ResolvedLearnEnv {
  home: string;
  idleSeconds: number;
  retroTimeoutMs: number;
}

/**
 * Resolve the learn home and the two time knobs: `DEVX_LEARN_HOME` >
 * `learn.*` in the merged config > the design defaults.
 *
 * Config reads are best-effort. This command is user-global — it drains
 * sessions from every hooked repo — so a syntactically broken
 * `devx.config.yaml` in whatever directory the human happened to launch from
 * must degrade to the defaults, not refuse to drain a queue that has nothing
 * to do with that repo.
 */
export function resolveLearnEnv(
  opts: { home?: string; merged?: unknown; env?: LearnEnv } = {},
): ResolvedLearnEnv {
  let merged: unknown = opts.merged;
  if (merged === undefined) {
    try {
      merged = loadMerged();
    } catch {
      merged = {};
    }
  }
  const cfg = learnConfigFrom(merged);
  return {
    home: opts.home ?? resolveLearnHome(merged, opts.env ?? process.env),
    idleSeconds: cfg.idleMinutes * 60,
    retroTimeoutMs: cfg.retroTimeoutMinutes * 60_000,
  };
}

/**
 * Read one line from stdin, synchronously, or `null` at EOF / when the read
 * fails.
 *
 * Byte-at-a-time on purpose: the watcher's stdin stays open for the rest of
 * the run, so a buffered read that over-consumed would swallow the answer to
 * the *next* repo's prompt. `canPrompt()` has already established that this
 * process is in the foreground process group, so the read can't take SIGTTIN
 * here (that check is re-run immediately before each prompt inside
 * `repoDecision`, not trusted from startup).
 */
function readLineSync(): string | null {
  const buf = Buffer.alloc(1);
  const bytes: number[] = [];
  // Bytes are accumulated and decoded once at the end: decoding each byte on
  // its own would mangle any non-ASCII answer into replacement characters,
  // and a repo path (which is what the human is being asked about) is not
  // guaranteed ASCII.
  const done = (): string | null =>
    bytes.length === 0 ? null : Buffer.from(bytes).toString("utf8");
  for (;;) {
    let n: number;
    try {
      n = readSync(0, buf, 0, 1, null);
    } catch {
      return done();
    }
    if (n === 0) return done(); // EOF
    if (buf[0] === 0x0a) return Buffer.from(bytes).toString("utf8"); // "\n"
    bytes.push(buf[0]);
  }
}

export interface WatchCmdOpts extends LearnWatchIO {
  /** `--dry-run`: print-only, and exempt from the singleton. */
  dryRun?: boolean;
  /** Home override (test seam; the CLI resolves it from env + config). */
  home?: string;
  /** Merged-config seam. */
  merged?: unknown;
  env?: LearnEnv;
  /** {@link drainPass} seam — no suite ever opens a window. */
  drainPassFn?: typeof drainPass;
  /** {@link claimWatcherSingleton} seam. */
  claimFn?: typeof claimWatcherSingleton;
  /** {@link canPrompt} seam. */
  canPromptFn?: () => boolean;
  /** Terminal read seam for the allow prompt. */
  readLine?: () => string | null;
  /** Install the SIGINT/SIGTERM handlers? Off in tests, which must not touch
   *  the process's signal disposition. */
  installSignals?: boolean;
  /** Stop after this many passes. Unset = until interrupted. */
  maxPasses?: number;
  /** Wait between passes. Default {@link DEFAULT_SCAN_POLL_MS}. */
  scanPollMs?: number;
  /** Async wait seam (tests resolve instantly). */
  delay?: (ms: number) => Promise<void>;
}

/** Real inter-pass wait. Deliberately NOT `unref`'d: the pending timer is what
 *  keeps the process alive between passes. */
function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * The foreground watcher: claim the singleton, then drain-and-wait until
 * interrupted.
 *
 * SIGINT is a *flag*, not an exit: the drain finishes the entry it is on
 * (`shouldStop` is checked between entries and inside the marker wait) and the
 * command returns 0 — the queue is durable, so an interrupted run loses
 * nothing and the message says so.
 *
 * WHY THIS DRIVES `drainPass` ITSELF instead of calling the lib's `runWatch`:
 * node can only run a JS signal handler when the event loop is free, and
 * `runWatch` waits between passes with `sleepSync` (`Atomics.wait`), which
 * blocks the loop for the *whole* run. A handler installed over that loop is
 * never called — measured, not assumed — so Ctrl-C would silently do nothing,
 * which is strictly worse than the default kill it suppressed. Awaiting a real
 * timer between passes gives the loop the gap it needs, so the stop is
 * observed within one scan interval. `runWatch` stays the lib's synchronous
 * driver for embedders and tests, which supply their own `shouldStop`.
 *
 * The one window this does NOT cover is a stop pressed *during* a marker wait:
 * `drainPass` is synchronous, so the flag is only read when the retro's
 * marker lands or the retro timeout expires. Closing the retro's own tab ends
 * that wait — and a second Ctrl-C from a human who won't wait still kills the
 * process, losing nothing but the farewell line.
 */
export async function runLearnWatch(opts: WatchCmdOpts = {}): Promise<number> {
  const out = opts.out ?? ((line: string) => process.stdout.write(line));
  const err = opts.err ?? ((line: string) => process.stderr.write(line));
  const log = (line: string): void => out(`${line}\n`);
  const { home, idleSeconds, retroTimeoutMs } = resolveLearnEnv(opts);
  const dryRun = opts.dryRun === true;

  // Claimed before anything is printed: a refusal should read as a refusal,
  // not as a watcher that started and then changed its mind. `--dry-run` is
  // exempt — it drains nothing, and demanding the lock would make the setup
  // check unusable exactly when a watcher is doing its job.
  let handle: LockHandle | null = null;
  if (!dryRun) {
    try {
      handle = (opts.claimFn ?? claimWatcherSingleton)(home);
    } catch (e) {
      if (e instanceof PathLockHeldError) {
        err(`devx learn-watch: ${e.message}\n`);
        return 1;
      }
      throw e;
    }
  }

  const pending = readQueue(home).length;
  log(`devx learn-watch: ${pending} pending · queue ${queuePath(home)}`);
  log(
    "(retros spawn one at a time — end one with /exit, Ctrl-D, or by closing its " +
      "tab, and the next follows)",
  );
  if (dryRun) {
    log("(--dry-run: printing spawn commands only — the queue and done log are left alone)");
  }

  const readLine = opts.readLine ?? readLineSync;
  const drain = opts.drainPassFn ?? drainPass;
  const wait = opts.delay ?? delayMs;
  const scanPollMs = Math.max(1, opts.scanPollMs ?? DEFAULT_SCAN_POLL_MS);

  let stopped = false;
  const onSignal = (): void => {
    stopped = true;
  };
  const installSignals = opts.installSignals ?? true;
  if (installSignals) {
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
  }

  // Per-RUN state, not per-pass (see DrainPassOpts.seen): re-creating these
  // every pass would make `--dry-run` reprint the whole queue every 5 seconds
  // and re-note every skipped entry forever.
  const seen = new Set<string>();
  const noted = new Set<string>();
  let interactive = (opts.canPromptFn ?? canPrompt)();

  try {
    for (let pass = 0; opts.maxPasses === undefined || pass < opts.maxPasses; pass++) {
      if (stopped) break;
      const summary = drain({
        home,
        dryRun,
        interactive,
        idleSeconds,
        retroTimeoutMs,
        log,
        seen,
        noted,
        shouldStop: () => stopped,
        ask: (key: string) => {
          // `repoDecision` reads a null answer as "unknown" and drops the rest
          // of the run to non-interactive — exactly right for a stdin that
          // went away mid-run.
          out(`  allow retros for ${key}? [y/N] `);
          return readLine();
        },
      });
      // A prompt whose stdin vanished downgrades the REST of the run.
      interactive = summary.interactive;
      if (stopped) break;
      if (opts.maxPasses !== undefined && pass === opts.maxPasses - 1) break;
      await wait(scanPollMs);
    }
  } finally {
    handle?.release();
    if (installSignals) {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
    }
  }

  if (stopped) log("stopped — queue is durable; restart me anytime");
  return 0;
}

/** How many processed entries `list` shows (design.md §Interfaces: "last 5"). */
export const LIST_DONE_TAIL = 5;

/** A queue field as one display column: the value, or `?` when it is missing
 *  or the wrong type (hand-edited lines reach here too). */
function col(value: unknown): string {
  return typeof value === "string" && value !== "" ? value : "?";
}

export interface ListCmdOpts extends LearnWatchIO {
  home?: string;
  merged?: unknown;
  env?: LearnEnv;
  /** Clock seam for the readiness column. */
  now?: () => number;
}

/**
 * `devx learn-watch list` — the read-only view: what is queued and whether it
 * is servable yet, then the tail of the done log with its outcomes.
 *
 * Readiness is computed with the same `sessionOver` the drain uses, so a
 * "ready" here means the watcher would take it on its next pass — the column
 * is the answer to "why hasn't my retro run?", and a second implementation of
 * readiness could answer that differently from the code that acts on it.
 */
export function runLearnWatchList(opts: ListCmdOpts = {}): number {
  const out = opts.out ?? ((line: string) => process.stdout.write(line));
  const log = (line: string): void => out(`${line}\n`);
  const { home, idleSeconds } = resolveLearnEnv(opts);

  const pending = readQueue(home);
  log(`pending (${pending.length}) · ${queuePath(home)}`);
  for (const entry of pending) {
    const ready = sessionOver(entry as QueueEntry, {
      home,
      idleSeconds,
      ...(opts.now ? { now: opts.now } : {}),
    });
    log(
      `  ${col(entry.session_id)}  ${col(entry.ts)}  ${col(entry.cwd)}  ` +
        `[${ready ? "ready" : "session still active"}]`,
    );
  }

  const done = readDone(home);
  const tail = done.slice(-LIST_DONE_TAIL);
  log(`processed (last ${tail.length} of ${done.length}) · ${donePath(home)}`);
  for (const entry of tail) {
    log(`  ${col(entry.session_id)}  ${col(entry.processed_ts)}  ${col(entry.outcome)}`);
  }
  return 0;
}

export interface RequeueCmdOpts extends LearnWatchIO {
  home?: string;
  merged?: unknown;
  env?: LearnEnv;
  now?: () => Date;
}

/**
 * `devx learn-watch requeue <sid>` — put a processed session back on the
 * pending queue.
 *
 * Both refusals the lib raises (no such processed session; it is already
 * pending) are exit 1, not 2: the command line was well-formed, the *state*
 * didn't match. A missing `<sid>` is the usage error, and it exits 2 from the
 * action wiring below.
 */
export function runLearnWatchRequeue(sid: string | undefined, opts: RequeueCmdOpts = {}): number {
  const out = opts.out ?? ((line: string) => process.stdout.write(line));
  const err = opts.err ?? ((line: string) => process.stderr.write(line));
  if (typeof sid !== "string" || sid.trim() === "") {
    err("usage: devx learn-watch requeue <session-id>\n");
    return 2;
  }
  const { home } = resolveLearnEnv(opts);
  try {
    requeueFromDone(home, sid.trim(), { ...(opts.now ? { now: opts.now } : {}) });
  } catch (e) {
    err(`devx learn-watch requeue: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
  out(`requeued ${sid.trim()} — it will spawn on the watcher's next pass\n`);
  return 0;
}

export function register(program: Command): void {
  const cmd = program
    .command("learn-watch")
    .description(
      "Serial retro watcher: drain the queued sessions the /devx-learn hooks recorded, spawning one `claude --resume … /devx-learn` at a time. Foreground; Ctrl-C is safe (the queue is durable).",
    )
    .option(
      "--dry-run",
      "Print the spawn command for every ready session and change nothing (no marker, no done-log row, no queue rewrite); allowed while another watcher is draining",
      false,
    )
    // A typo'd subcommand (`learn-watch lst`) must not silently start a real
    // drain, so excess arguments are a usage error rather than ignored.
    .allowExcessArguments(false)
    .action(async (opts: { dryRun?: boolean }) => {
      const code = await runLearnWatch({ dryRun: opts.dryRun === true });
      if (code !== 0) process.exit(code);
    });

  // Commander's own usage failures exit 1 by default, which this command's
  // table reserves for a held lock; remap them to 2. Help/version paths carry
  // exitCode 0 and stay 0.
  cmd.exitOverride((e) => {
    process.exit(e.exitCode === 0 ? 0 : 2);
  });

  cmd
    .command("list")
    .description(
      "Show pending sessions with their readiness state, plus the tail of the done log with outcomes. Read-only.",
    )
    .allowExcessArguments(false)
    .action(() => {
      const code = runLearnWatchList();
      if (code !== 0) process.exit(code);
    });

  cmd
    .command("requeue")
    .description(
      "Put a processed session back on the pending queue, keeping its original ts (so it is instantly ready). Refuses if it is already pending.",
    )
    // Optional at the commander layer so the missing-argument case lands in
    // our own exit-2 usage path rather than commander's exit 1.
    .argument("[sid]", "session id from `devx learn-watch list`")
    .allowExcessArguments(false)
    .action((sid: string | undefined) => {
      const code = runLearnWatchRequeue(sid);
      if (code !== 0) process.exit(code);
    });

  attachPhase(cmd, 1);
}

export const name = "learn-watch";
export const phase = 1;
