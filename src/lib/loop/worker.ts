// The per-iteration worker session runner (v2l101).
//
// Every iteration is a FRESH `claude` session (context rot designed out —
// v2/04 §1: orchestrator-owned append-only memory read by fresh sessions).
// The manager's spawnWorker (mgr104) spawns detached fire-and-forget
// `claude /devx <hash>` processes; the loop's inner contract needs the
// opposite shape — a synchronous session whose stdout we capture, parse,
// and branch on — so this module owns its own spawn while reusing mgr104's
// claude-binary resolution convention (DEVX_CLAUDE_BIN).
//
// Grace-kill (v2/04 §4): a worker that emitted its final structured report
// but didn't exit gets its PROCESS TREE killed after ~15s. Workers are
// spawned detached (their own process group) exactly so `kill(-pid)` can
// reap stray grandchildren (dev servers the model forgot to stop).
//
// Token accounting (O-6, v2/07-decisions.md): the worker spawn path doesn't
// expose authoritative usage yet, so tokens are ESTIMATED from transcript
// length (chars/4) and flagged `estimated: true` — the morning report
// renders them with a `~` prefix. When the harness exposes usage events,
// this is the one seam to update.
//
// Spec: dev/dev-v2l101-2026-07-05T13:06-overnight-loop.md

import {
  type ChildProcess,
  type SpawnOptions,
  spawn as nodeSpawn,
} from "node:child_process";

import { extractReportJson, validateIterationReport } from "./iteration.js";

export const DEFAULT_GRACE_KILL_MS = 15_000;
const DEFAULT_CLAUDE_BIN = "claude";
/** Hard ceiling on captured output — an out-of-control worker must not OOM
 *  the orchestrator. 8 MB of transcript is far beyond any honest iteration. */
const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;

export interface WorkerTokens {
  input: number;
  output: number;
  estimated: boolean;
}

export interface WorkerRunResult {
  /** Full captured stdout+stderr text (bounded). */
  rawOutput: string;
  /** Child exit code; null when signal-terminated / grace-killed. */
  exitCode: number | null;
  /** True when the grace-kill timer had to reap the process tree. */
  graceKilled: boolean;
  tokens: WorkerTokens;
}

export type WorkerRunFn = (
  prompt: string,
  opts: { cwd: string; signal?: AbortSignal },
) => Promise<WorkerRunResult>;

export type SpawnFn = (
  cmd: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export interface ClaudeWorkerOpts {
  claudeBin?: string;
  graceKillMs?: number;
  /** Hard wall-clock ceiling per worker session (BH/EC-HIGH: a worker that
   *  never emits a report and never exits must not eat the night — the
   *  grace-kill only arms AFTER a valid report; this ceiling covers the
   *  report-less hang). Default 60min. */
  iterationTimeoutMs?: number;
  spawnFn?: SpawnFn;
  /** Extra argv appended after `-p <prompt>` (e.g. a --model override). */
  extraArgs?: string[];
}

/** Default per-session wall-clock ceiling. Generous — an honest iteration
 *  on a hard slice can run long — but bounded, so `--until` is honored
 *  within one ceiling's slack at worst. */
export const DEFAULT_ITERATION_TIMEOUT_MS = 60 * 60_000;

/** After the process EXITS, wait at most this long for the stdio pipes to
 *  drain (`close`). An escaped grandchild holding the pipes open must not
 *  keep the promise pending forever (EC-HIGH-3 probe). */
const EXIT_DRAIN_MS = 2_000;

/**
 * Build the default worker runner: `claude -p <prompt>` in the worktree cwd,
 * stdout+stderr captured. The prompt travels as ONE argv element — never
 * through a shell (same injection posture as git-tx).
 */
export function makeClaudeWorker(opts: ClaudeWorkerOpts = {}): WorkerRunFn {
  const claudeBin =
    opts.claudeBin ?? process.env.DEVX_CLAUDE_BIN ?? DEFAULT_CLAUDE_BIN;
  const graceKillMs = opts.graceKillMs ?? DEFAULT_GRACE_KILL_MS;
  const iterationTimeoutMs = opts.iterationTimeoutMs ?? DEFAULT_ITERATION_TIMEOUT_MS;
  const spawnFn: SpawnFn = opts.spawnFn ?? (nodeSpawn as unknown as SpawnFn);
  const extraArgs = opts.extraArgs ?? [];

  return (prompt, runOpts) =>
    new Promise<WorkerRunResult>((resolve, reject) => {
      let child: ChildProcess;
      try {
        child = spawnFn(claudeBin, ["-p", prompt, ...extraArgs], {
          cwd: runOpts.cwd,
          // Own process group so the grace-kill can reap the whole tree.
          detached: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
        return;
      }

      let output = "";
      let truncated = false;
      let graceKilled = false;
      let timedOut = false;
      let graceTimer: NodeJS.Timeout | null = null;
      let drainTimer: NodeJS.Timeout | null = null;
      let settled = false;

      const capture = (chunk: Buffer | string): void => {
        if (truncated) return;
        output += chunk.toString();
        if (output.length > MAX_CAPTURE_BYTES) {
          output = output.slice(0, MAX_CAPTURE_BYTES);
          truncated = true;
        }
        maybeArmGraceKill();
      };

      const killTree = (): void => {
        const pid = child.pid;
        if (pid === undefined) return;
        try {
          // Negative PID = the process group (detached spawn above).
          process.kill(-pid, "SIGKILL");
        } catch {
          try {
            child.kill("SIGKILL");
          } catch {
            // already gone
          }
        }
      };

      // Arm the grace-kill once the captured output contains a VALID final
      // report — a worker that reported but won't exit (stray dev server
      // holding stdio open) gets its tree reaped after graceKillMs.
      const maybeArmGraceKill = (): void => {
        if (graceTimer !== null || settled) return;
        const parsed = extractReportJson(output);
        if (parsed === null) return;
        if (!validateIterationReport(parsed).ok) return;
        graceTimer = setTimeout(() => {
          graceKilled = true;
          killTree();
        }, graceKillMs);
        graceTimer.unref?.();
      };

      const onAbort = (): void => {
        killTree();
      };
      if (runOpts.signal) {
        if (runOpts.signal.aborted) killTree();
        else runOpts.signal.addEventListener("abort", onAbort, { once: true });
      }

      child.stdout?.on("data", capture);
      child.stderr?.on("data", capture);

      // Hard per-session ceiling: a worker that hangs BEFORE producing any
      // valid report has no other bound (the grace-kill arms only after a
      // valid report). On timeout the tree is reaped and the run surfaces
      // as an error to the driver (report-less exit) → hard-error ladder.
      const timeoutTimer = setTimeout(() => {
        timedOut = true;
        killTree();
      }, iterationTimeoutMs);
      timeoutTimer.unref?.();

      const cleanup = (): void => {
        if (graceTimer !== null) clearTimeout(graceTimer);
        if (drainTimer !== null) clearTimeout(drainTimer);
        clearTimeout(timeoutTimer);
        runOpts.signal?.removeEventListener("abort", onAbort);
      };

      const settle = (exitCode: number | null): void => {
        if (settled) return;
        settled = true;
        cleanup();
        if (timedOut) {
          reject(
            new Error(
              `worker session exceeded the ${Math.round(iterationTimeoutMs / 60000)}min iteration ceiling and was killed`,
            ),
          );
          return;
        }
        resolve({
          rawOutput: output,
          exitCode,
          graceKilled,
          tokens: estimateTokens(prompt, output),
        });
      };

      child.once("error", (e) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(e);
      });
      // Prefer `close` (streams fully drained) but never DEPEND on it: an
      // escaped grandchild that inherited the pipes can hold `close` open
      // forever even after the worker exits (EC-HIGH-3). `exit` + a bounded
      // drain window guarantees settlement.
      child.once("close", (code) => settle(code));
      child.once("exit", (code) => {
        if (settled) return;
        drainTimer = setTimeout(() => settle(code), EXIT_DRAIN_MS);
        drainTimer.unref?.();
      });
    });
}

/** chars/4 heuristic, flagged estimated (O-6). */
export function estimateTokens(prompt: string, output: string): WorkerTokens {
  return {
    input: Math.ceil(prompt.length / 4),
    output: Math.ceil(output.length / 4),
    estimated: true,
  };
}
