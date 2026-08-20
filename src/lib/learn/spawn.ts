// The one genuinely new mechanism in this repo: opening an interactive retro in
// a window we do not own. Everything here is either a *string* (the shell the
// spawned tab runs) or a thin, seam-injected call to `tmux`/`osascript` — the
// drain loop's judgment lives in `watch.ts`, and the CLI wiring in
// `commands/learn-watch.ts`.
//
// Three properties are load-bearing, and each of them is a bug upstream already
// paid for (`reference/harness-learn-watch` §`wrapper_command`/`spawn`):
//
//   - **The spawned process is not our child.** `tmux new-window` and
//     `osascript … do script` both return as soon as the window exists, so the
//     only completion signal is the marker file the wrapper writes. That marker
//     therefore has to land on *every* exit path a shell can still see, and it
//     has to carry the exit status — `claude …; touch <marker>` loses both the
//     signal case (SIGHUP from a closed tab kills the shell before `touch`) and
//     the status (a fork that never started filed as `completed`).
//   - **Exactly one write, from exactly one trap.** bash defers a trap until the
//     foreground command returns, so a signal trap *and* an EXIT trap would both
//     fire on the signal paths and the recorded outcome would depend on their
//     ordering. There is deliberately no EXIT trap, and the signal trap `exit`s
//     rather than falling through to the trailing write.
//   - **The trap reads `$?` instead of asserting an outcome.** A single Ctrl-C
//     in Claude Code clears the input line rather than exiting, so the SIGINT is
//     absorbed, `claude` goes on to exit 0, and a trap hard-coding "interrupted"
//     would file a clean retro as interrupted. `rc=$?` gets both directions
//     right: absorbed Ctrl-C records `0`, a closed tab records `129`
//     (128+SIGHUP), which `mapMarkerToOutcome`'s `>= 128` arm reads as
//     interrupted.
//
// `DEVX_RETRO=1` in front of `claude` is the other half of E-2's self-trigger
// bound: the listener matches on message *content*, so a retro that quotes the
// nudge while mining it — which is `/devx-learn`'s whole job — would queue
// itself, and the fork gets a fresh session id every time so the dedupe would
// never catch it. The variable is inherited by every hook the fork runs, which
// makes "the loop can't self-trigger" mechanical rather than a property of how
// the retro happens to word its output.
//
// Spec: dev/dev-rtl104-2026-07-30T09:31-watcher-cli-spawn.md (T4.1, T4.2)
// Design: _devx/workstreams/retro-listener/design.md §Architecture (Spawn)

import { spawnSync } from "node:child_process";
import { mkdirSync, unlinkSync } from "node:fs";

import { type LearnEnv, doneMarkerPath, markersDir } from "./queue.js";

// ---------------------------------------------------------------------------
// Session-id validation (T4.1)
// ---------------------------------------------------------------------------

/**
 * UUID-shaped: hex digits and dashes only. Claude Code session ids are UUIDs;
 * this is their character class rather than the strict 8-4-4-4-12 grouping, so
 * a differently-grouped id from a future client version still spawns.
 *
 * Deliberately *narrower* than `isSafeSessionId` (queue.ts), which also admits
 * `.`, `_` and letters because it only has to protect a filename. This id goes
 * into an argv **and** into a shell command string, so the guard runs before
 * either is constructed (mgr104 discipline) and refuses rather than sanitizes:
 * every metacharacter that could matter — `$`, backtick, quote, `;`, space,
 * newline, `/` — is outside the class, so there is no "quoted it, probably
 * fine" path to reason about at all.
 */
const SPAWNABLE_SESSION_ID = /^[0-9a-fA-F][0-9a-fA-F-]{3,63}$/;

export function isSpawnableSessionId(sid: unknown): sid is string {
  return typeof sid === "string" && SPAWNABLE_SESSION_ID.test(sid);
}

function assertSpawnableSessionId(sid: unknown): asserts sid is string {
  if (!isSpawnableSessionId(sid)) {
    throw new Error(
      `unsafe session id for a spawn: ${JSON.stringify(sid)} (want ${SPAWNABLE_SESSION_ID.source})`,
    );
  }
}

// ---------------------------------------------------------------------------
// Wrapper command (T4.1)
// ---------------------------------------------------------------------------

/** Characters `sh` reads literally — the set `shlex.quote` leaves bare. */
const SHELL_SAFE = /^[A-Za-z0-9@%+=:,./_-]+$/;

/**
 * POSIX single-quote a value for embedding in a `sh -c` string, mirroring
 * Python's `shlex.quote` (which the reference uses for the cwd and the marker
 * path). Inside single quotes every character is literal, so the only case to
 * handle is a single quote itself: close, escape, reopen.
 *
 * The empty string quotes to `''` rather than to nothing — `cd ` with a bare
 * empty word is a no-op that would run the retro in the wrong directory and
 * file it as `error-fork` instead of `error-cd`. (`classifyEntry` retires
 * cwd-less entries long before this, but the quoting must not be the thing that
 * makes it safe.)
 */
export function shellQuote(value: string): string {
  if (value !== "" && SHELL_SAFE.test(value)) return value;
  return `'${value.split("'").join(`'\\''`)}'`;
}

/**
 * Env var the wrapper exports for an unattended retro, and the skill-body
 * argument it passes alongside it (c808b1).
 *
 * BOTH, not either: the argument is what `/devx-learn`'s own body branches on,
 * and the env var is what every *subprocess* the retro runs inherits — a
 * `devx learn-helper …` call, a hook, a nested tool — none of which can see
 * the slash command's arguments. Dropping the env var would make the mode
 * invisible one process down; dropping the argument would make the skill body
 * read process state to learn how it was invoked.
 *
 * `DEVX_RETRO=1` stays on both paths regardless: it is the self-trigger bound
 * (E-2), and an unattended retro is exactly the run with nobody to notice the
 * loop.
 */
export const LEARN_UNATTENDED_ENV = "DEVX_LEARN_UNATTENDED";
export const LEARN_UNATTENDED_ARG = "unattended";

/** Per-spawn mode inputs for {@link buildWrapperCommand}. */
export interface WrapperOpts {
  /**
   * Run the retro in unattended mode: auto-prune instead of waiting for a
   * human to strike rows, and route outlet-1 rows through the apply path.
   *
   * Default OFF, and off is the *attended* contract verbatim — an unspecified
   * spawn must never widen what the retro may do (`learn.auto_apply` is the
   * only thing that turns it on, and it is itself default-false).
   */
  unattended?: boolean;
}

/**
 * The shell the spawned tab runs: the forked retro, wrapped so its completion
 * marker lands on every exit path and carries the exit status.
 *
 * Marker contents, which `mapMarkerToOutcome` translates:
 *   `0` clean exit · `128+N` killed by signal N (tab closed) · another nonzero
 *   number = `claude` failed · `error-cd` = the cwd is gone.
 *
 * Written via tmp+rename (the cross-epic atomic-write pattern) so the watcher
 * polling for it can never read a half-written status.
 *
 * The trap body is single-quote-free on purpose: it is itself embedded in a
 * single-quoted shell word, and E-9 pins its shape with a `[^']*` match.
 */
export function buildWrapperCommand(
  sid: string,
  cwd: string,
  markerPath: string,
  opts: WrapperOpts = {},
): string {
  // Before any command construction — not after, and not "it's quoted anyway".
  assertSpawnableSessionId(sid);
  if (typeof cwd !== "string") {
    throw new Error(`cwd must be a string; got ${JSON.stringify(cwd)}`);
  }
  if (typeof markerPath !== "string" || markerPath === "") {
    throw new Error(`markerPath must be a non-empty string; got ${JSON.stringify(markerPath)}`);
  }

  // Both halves of the mode, or neither — see LEARN_UNATTENDED_ENV. The
  // slash-command argument is a bare word from a constant, never session text,
  // so it needs no quoting of its own inside the double-quoted word.
  const unattended = opts.unattended === true;
  const slash = unattended ? `/devx-learn ${LEARN_UNATTENDED_ARG}` : "/devx-learn";
  const modeEnv = unattended ? `${LEARN_UNATTENDED_ENV}=1 ` : "";

  return [
    `M=${shellQuote(markerPath)}; `,
    'w() { printf "%s" "$1" > "$M.tmp" && mv "$M.tmp" "$M"; }; ',
    `trap 'rc=$?; w "$rc"; exit "$rc"' HUP INT TERM; `,
    `cd ${shellQuote(cwd)} || { w error-cd; exit 1; }; `,
    `DEVX_RETRO=1 ${modeEnv}claude --resume ${shellQuote(sid)} --fork-session "${slash}"; `,
    'w "$?"',
  ].join("");
}

// ---------------------------------------------------------------------------
// Arm selection + argv construction (T4.2)
// ---------------------------------------------------------------------------

/** Which mechanism opens the window — see {@link selectSpawnArm}. */
export type SpawnArm = "tmux" | "terminal" | "manual";

/** The tmux window name, so a stray retro tab is identifiable at a glance. */
export const TMUX_WINDOW_NAME = "devx-retro";

/**
 * How this machine can open a window right now.
 *
 * `$TMUX` first: inside a tmux session a new window is the least disruptive
 * surface and works over ssh, where Terminal.app doesn't exist. Then darwin's
 * Terminal.app. Otherwise `manual` — the command is printed for the human, and
 * the caller must file the entry immediately rather than awaiting a marker only
 * a human could trigger (upstream held the serial queue for the full retro
 * timeout, 6h by default, per entry on this branch).
 */
export function selectSpawnArm(
  env: LearnEnv = process.env,
  platform: NodeJS.Platform | string = process.platform,
): SpawnArm {
  const tmux = env.TMUX;
  if (typeof tmux === "string" && tmux !== "") return "tmux";
  if (platform === "darwin") return "terminal";
  return "manual";
}

/** `tmux new-window -n devx-retro <cmd>` — the command is one argv element, so
 *  tmux hands it to `sh -c` whole and no quoting of ours is re-parsed. */
export function tmuxArgv(cmd: string): [string, string[]] {
  return ["tmux", ["new-window", "-n", TMUX_WINDOW_NAME, cmd]];
}

/**
 * Escape a shell command for embedding in an AppleScript double-quoted string
 * literal — backslashes first, then double quotes, exactly as the reference
 * does. Both characters are present in real wrappers (`printf "%s"`, `"$rc"`,
 * and any cwd with a quote in it), and getting the order wrong double-escapes
 * the backslashes we just introduced.
 */
export function escapeAppleScript(cmd: string): string {
  return cmd.split("\\").join("\\\\").split('"').join('\\"');
}

/** `osascript -e 'tell … do script "<cmd>"' -e 'tell … activate'`. */
export function terminalArgv(cmd: string): [string, string[]] {
  const escaped = escapeAppleScript(cmd);
  return [
    "osascript",
    [
      "-e",
      `tell application "Terminal" to do script "${escaped}"`,
      "-e",
      'tell application "Terminal" to activate',
    ],
  ];
}

// ---------------------------------------------------------------------------
// The spawn seam (T4.2)
// ---------------------------------------------------------------------------

/**
 * Run a command to completion and report its exit status (`null` when it was
 * killed by a signal or could not be started). The one seam between this module
 * and the outside world — tests inject it so no suite ever opens a window.
 */
export type RunFn = (cmd: string, args: readonly string[]) => number | null;

/**
 * `capture` because the two arms want opposite things (and the reference makes
 * the same split): `tmux new-window` says nothing on success and its errors are
 * the only diagnosis the human gets, so it inherits; `osascript … do script`
 * echoes the AppleScript window object it just made, which would interleave
 * garbage into the drain's line-buffered log, so it is piped away.
 */
function defaultRun(capture: boolean): RunFn {
  return (cmd, args) => {
    const stream = capture ? "pipe" : "inherit";
    const result = spawnSync(cmd, [...args], { stdio: ["ignore", stream, stream] });
    if (result.error) return null;
    return result.status;
  };
}

/**
 * What a spawn attempt did. `manual` and `error-spawn` are terminal — the
 * caller files the entry with that outcome and moves on; only `spawned` is
 * followed by an `awaitMarker`, and `dry-run` consumes nothing at all.
 */
export type SpawnResult = "spawned" | "manual" | "dry-run" | "error-spawn";

export interface SpawnRetroOpts extends WrapperOpts {
  /** Print-only: no marker directory, no stale-marker unlink, no window. */
  dryRun?: boolean;
  /** Arm-selection inputs. Default to the real environment. */
  env?: LearnEnv;
  platform?: NodeJS.Platform | string;
  /** Force an arm, bypassing {@link selectSpawnArm} (tests; `--arm` later). */
  arm?: SpawnArm;
  /** Test seam for `tmux`/`osascript`. */
  run?: RunFn;
  /** Line-buffered output seam; the CLI passes its own writer. */
  log?: (line: string) => void;
}

/**
 * Open the retro for `sid` in a new window, or hand the command to the human.
 *
 * Dry-run prints and touches *nothing*. Upstream's earlier version faked a `0`
 * marker here, which walked the entry all the way through `awaitMarker` →
 * `finish`: a `--dry-run` meant to check someone's setup silently drained every
 * pending retro and wrote `completed` rows for retros that never ran, into the
 * done log the phase-2 debate rests on.
 *
 * A pre-existing `.done` marker is removed before the real spawn — a stale one
 * (from a requeue, or a previous timed-out attempt) would make the next
 * `awaitMarker` return instantly with someone else's status.
 */
export function spawnRetro(
  home: string,
  // Optional rather than required, so a `QueueEntry` straight off the queue is
  // assignable — both fields are `unknown` and asserted below anyway, and
  // making the drain build a synthetic `{session_id, cwd}` object would only
  // move the same two checks somewhere less obvious.
  entry: { session_id?: unknown; cwd?: unknown },
  opts: SpawnRetroOpts = {},
): SpawnResult {
  const sid = entry.session_id;
  // Hard-asserted rather than defensively handled: the drain retires id-less
  // and cwd-less entries as `error-malformed` before ever reaching a spawn, so
  // a throw here is a real bug in the caller, not a queue-data problem.
  //
  // Drain-loop obligation (T4.3): `classifyEntry` screens with queue.ts's
  // *filename* guard, which is the wider charset — a hand-edited queue line
  // like `abc_def` classifies `ok` there and throws here, wedging the serial
  // queue on the head entry after every restart. The drain must screen with
  // {@link isSpawnableSessionId} as well, and file the difference as
  // `error-malformed`.
  assertSpawnableSessionId(sid);
  const cwd = entry.cwd;
  if (typeof cwd !== "string" || cwd.trim() === "") {
    throw new Error(`spawnRetro: entry has no cwd (session ${sid})`);
  }

  const log = opts.log ?? ((line: string) => process.stdout.write(`${line}\n`));
  const marker = doneMarkerPath(home, sid);
  const cmd = buildWrapperCommand(sid, cwd, marker, { unattended: opts.unattended });

  if (opts.dryRun) {
    log(`  [dry-run] would spawn: ${cmd}`);
    return "dry-run";
  }

  const arm = opts.arm ?? selectSpawnArm(opts.env, opts.platform);
  if (arm === "manual") {
    log("  no tmux session and not macOS — run this yourself in another terminal:");
    log(`    ${cmd}`);
    return "manual";
  }

  mkdirSync(markersDir(home), { recursive: true });
  try {
    unlinkSync(marker);
  } catch {
    // Absent is the common case.
  }

  const [bin, args] = arm === "tmux" ? tmuxArgv(cmd) : terminalArgv(cmd);
  const status = (opts.run ?? defaultRun(arm === "terminal"))(bin, args);
  if (status === 0) return "spawned";

  // An `error-spawn` row in the done log with nothing to act on is a dead end:
  // the entry is retired, so the human's only recovery is `requeue`, and they
  // have no idea what failed. Print the same command the manual arm prints.
  log(`  spawn failed (${arm} arm, status ${status === null ? "not-started" : status}) — run it yourself:`);
  log(`    ${cmd}`);
  return "error-spawn";
}
