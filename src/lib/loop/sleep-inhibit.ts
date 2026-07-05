// Sleep inhibition for `devx loop` (v2l101) — gnhf's sleep.ts mechanism,
// minimized to devx's needs.
//
// Deviation from gnhf, on purpose: gnhf re-execs itself under
// `systemd-inhibit` on Linux (with a ready-file handshake). devx keeps a
// HELPER-PROCESS shape on every platform instead — the supervisor scaffold
// (sup40x) already owns the "who keeps devx alive" problem, so the loop only
// needs the inhibitor mechanism, not the re-exec dance:
//
//   darwin → `caffeinate -i -w <pid>`   (exits by itself when we exit)
//   linux  → `systemd-inhibit --what=idle:sleep --mode=block ... sleep infinity`
//            (the inhibitor lock is held while the child lives; stop() kills it)
//   other  → skipped (unsupported)
//
// The env-var loop-breaker (DEVX_SLEEP_INHIBITED=1) is kept from gnhf even
// though we don't re-exec: it lets an outer wrapper (a user's own
// systemd-inhibit invocation, a future supervisor unit that pre-wraps the
// manager) tell the loop "already handled" so we never stack inhibitors or
// recurse.
//
// Everything is best-effort: an unavailable inhibitor is a warning, never a
// failed loop (a sleeping laptop fails safe — the run just pauses).
//
// Spec: dev/dev-v2l101-2026-07-05T13:06-overnight-loop.md
// Design: v2/04-overnight-loop.md §4

import { type ChildProcess, spawn as nodeSpawn } from "node:child_process";

export const SLEEP_INHIBITED_ENV = "DEVX_SLEEP_INHIBITED";

export type SleepInhibitHandle =
  | { kind: "active"; command: string; stop: () => void }
  | {
      kind: "skipped";
      reason: "already-inhibited" | "unavailable" | "unsupported";
      stop: () => void;
    };

export type SpawnLike = (
  cmd: string,
  args: readonly string[],
  options: { stdio: "ignore"; detached: boolean; env: NodeJS.ProcessEnv },
) => ChildProcess;

export interface SleepInhibitOpts {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  pid?: number;
  spawnFn?: SpawnLike;
  /** WARN sink — defaults to stderr. */
  warn?: (msg: string) => void;
}

const noop = (): void => {};

/**
 * Start a sleep inhibitor for the current process. Resolves once the helper
 * either spawned (active) or definitively failed (skipped). The helper is
 * unref'd so it never keeps the loop's event loop alive; stop() kills it
 * (darwin's `caffeinate -w` would exit on its own, but killing is cheap and
 * symmetric).
 */
export function startSleepInhibit(
  opts: SleepInhibitOpts = {},
): Promise<SleepInhibitHandle> {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const pid = opts.pid ?? process.pid;
  const spawnFn = opts.spawnFn ?? (nodeSpawn as unknown as SpawnLike);
  const warn =
    opts.warn ?? ((msg: string) => process.stderr.write(`devx loop: ${msg}\n`));

  if (env[SLEEP_INHIBITED_ENV] === "1") {
    return Promise.resolve({
      kind: "skipped",
      reason: "already-inhibited",
      stop: noop,
    });
  }

  let command: string;
  let args: string[];
  if (platform === "darwin") {
    command = "caffeinate";
    args = ["-i", "-w", String(pid)];
  } else if (platform === "linux") {
    command = "systemd-inhibit";
    args = [
      "--what=idle:sleep",
      "--mode=block",
      "--who=devx",
      "--why=devx loop is running unattended",
      "sleep",
      "infinity",
    ];
  } else {
    return Promise.resolve({ kind: "skipped", reason: "unsupported", stop: noop });
  }

  return new Promise((resolve) => {
    let settled = false;
    let child: ChildProcess;
    try {
      child = spawnFn(command, args, {
        stdio: "ignore",
        detached: false,
        env: { ...env, [SLEEP_INHIBITED_ENV]: "1" },
      });
    } catch (e) {
      warn(`sleep inhibitor unavailable (${command}): ${errMessage(e)}`);
      resolve({ kind: "skipped", reason: "unavailable", stop: noop });
      return;
    }
    const settle = (handle: SleepInhibitHandle): void => {
      if (settled) return;
      settled = true;
      resolve(handle);
    };
    child.once("error", (e) => {
      warn(`sleep inhibitor unavailable (${command}): ${errMessage(e)}`);
      settle({ kind: "skipped", reason: "unavailable", stop: noop });
    });
    child.once("spawn", () => {
      child.unref?.();
      settle({
        kind: "active",
        command,
        stop: () => {
          try {
            child.kill("SIGTERM");
          } catch {
            // best-effort — the helper exits with us anyway on darwin
          }
        },
      });
    });
  });
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
