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

import { hasFinalReport } from "./iteration.js";

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
  /** Machine-suspend time detected during the session (heartbeat probe —
   *  dc7514). Slept time never counts against the iteration ceiling. */
  sleepGapMs?: number;
}

export type WorkerRunFn = (
  prompt: string,
  opts: { cwd: string; signal?: AbortSignal },
) => Promise<WorkerRunResult>;

/**
 * Thrown when a worker session hits the iteration wall-clock ceiling.
 * Carries the tokens ESTIMATED from the prompt + everything captured
 * before the kill (review finding MED-8): a timed-out session consumed
 * real API budget — rejecting with a bare Error dropped that spend from
 * the night's accounting, letting N timeouts silently exceed
 * max_total_tokens. The driver folds `tokens` into its budgets on the
 * timeout path.
 */
export class WorkerTimeoutError extends Error {
  readonly tokens: WorkerTokens;
  /** Suspend time detected during the session (dc7514). Positive ⇒ the kill
   *  fired against a machine that slept — the driver classes it
   *  `infra-error`, never `hard-error`. */
  readonly sleepGapMs: number;
  constructor(message: string, tokens: WorkerTokens, sleepGapMs = 0) {
    super(message);
    this.name = "WorkerTimeoutError";
    this.tokens = tokens;
    this.sleepGapMs = sleepGapMs;
  }
}

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
  /** Wall-clock seam for the sleep-gap probe (tests simulate suspend by
   *  jumping this clock). Defaults to Date.now. */
  nowMs?: () => number;
}

/** Cadence of the sleep-gap heartbeat probe. Each firing compares wall-clock
 *  elapsed against the scheduled interval: timers pause during machine
 *  suspend, so a firing that arrives ≫ late by wall clock reveals slept time
 *  (dc7514 — `caffeinate -i` does not block lid-close sleep, and the old
 *  single setTimeout ceiling fired hours late, mostly measuring a sleeping
 *  machine). Clamped down for short test ceilings. */
export const SLEEP_PROBE_INTERVAL_MS = 30_000;

/** A probe firing later than interval × this factor is treated as a suspend
 *  gap (2× tolerates ordinary event-loop lag without false positives). */
export const SLEEP_GAP_FACTOR = 2;

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
  const nowMs = opts.nowMs ?? Date.now;
  // Probe cadence: the standing 30s heartbeat, shrunk for short ceilings so
  // a kill still lands within ~a quarter of the ceiling (test ceilings run
  // in the hundreds of ms).
  const probeMs = Math.max(
    25,
    Math.min(SLEEP_PROBE_INTERVAL_MS, Math.floor(iterationTimeoutMs / 4)),
  );

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

      // Arm the grace-kill once the captured output ENDS with a valid final
      // report — a worker that reported but won't exit (stray dev server
      // holding stdio open) gets its tree reaped after graceKillMs.
      // Positional, not anywhere-in-output (review finding LOW-12): a
      // schema-valid report echoed early (quoted prompt example, pasted
      // fixture) followed by more output means the session is still
      // mid-work — killing there would reap an honest worker. The seam
      // invariant lives on hasFinalReport (iteration.ts). Because output
      // streams in chunks, the timer RE-VERIFIES at fire time: content that
      // arrived after arming un-finalizes the report, so the timer disarms
      // (a later trailing report re-arms via capture; the iteration ceiling
      // still bounds a session that never finalizes).
      const maybeArmGraceKill = (): void => {
        if (graceTimer !== null || settled) return;
        if (!hasFinalReport(output)) return;
        graceTimer = setTimeout(() => {
          if (settled) return;
          if (!hasFinalReport(output)) {
            // The report is no longer the trailing content — still working.
            graceTimer = null;
            return;
          }
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

      // Hard per-session ceiling on AWAKE time (dc7514): a worker that hangs
      // BEFORE producing any valid report has no other bound (the grace-kill
      // arms only after a valid report). The old single setTimeout stretched
      // across machine suspend — Node timers pause while the lid is closed,
      // so the kill fired hours late and each "iteration" mostly measured a
      // sleeping machine. Instead, a heartbeat probe measures wall-clock
      // drift between firings: a firing ≫ late reveals a suspend gap, which
      // is EXCUSED from the ceiling. On timeout the tree is reaped and the
      // rejection carries the gap so the driver can class a post-wake kill
      // as infra-error, never hard-error.
      const startMs = nowMs();
      let lastProbeMs = startMs;
      let sleepGapMs = 0;
      const probeTimer = setInterval(() => {
        // Once killed or settled there is nothing left to measure — without
        // this guard the interval keeps re-firing killTree and inflating
        // sleepGapMs during the exit-drain window (review LOW).
        if (settled || timedOut) return;
        const t = nowMs();
        const sinceLast = t - lastProbeMs;
        lastProbeMs = t;
        if (sinceLast > probeMs * SLEEP_GAP_FACTOR) {
          sleepGapMs += sinceLast - probeMs;
        }
        const awakeMs = t - startMs - sleepGapMs;
        if (awakeMs >= iterationTimeoutMs) {
          timedOut = true;
          killTree();
        }
      }, probeMs);
      probeTimer.unref?.();

      const cleanup = (): void => {
        if (graceTimer !== null) clearTimeout(graceTimer);
        if (drainTimer !== null) clearTimeout(drainTimer);
        clearInterval(probeTimer);
        runOpts.signal?.removeEventListener("abort", onAbort);
      };

      const settle = (exitCode: number | null): void => {
        if (settled) return;
        settled = true;
        cleanup();
        if (timedOut) {
          // Carry the estimated spend on the rejection — the session
          // consumed budget before the kill (review finding MED-8) — and
          // the sleep gap for the driver's infra classification (dc7514).
          const sleptNote =
            sleepGapMs > 0
              ? ` (${Math.round(sleepGapMs / 60000)}min of machine sleep detected and excluded)`
              : "";
          reject(
            new WorkerTimeoutError(
              `worker session exceeded the ${Math.round(iterationTimeoutMs / 60000)}min awake-time iteration ceiling and was killed${sleptNote}`,
              estimateTokens(prompt, output),
              sleepGapMs,
            ),
          );
          return;
        }
        resolve({
          rawOutput: output,
          exitCode,
          graceKilled,
          tokens: estimateTokens(prompt, output),
          sleepGapMs,
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
