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
// Token accounting (O-6, v2/07-decisions.md — upgraded by debug-494590):
// workers are spawned with `--output-format stream-json --verbose`, and the
// stream's `result` event carries the session's AUTHORITATIVE cumulative
// usage (input / output / cache-creation / cache-read). The old chars/4
// estimate read only the final text emission — three orders of magnitude
// under real consumption (a trivial one-turn probe processes ~24k real
// input tokens), which meant the loop's token budgets could never trip.
// Per-message usage events (deduped by message id — the CLI repeats one
// call's usage across its content-block events) provide a real floor for
// sessions killed before the result event; chars/4 remains only as the
// last-resort fallback when no stream events were captured at all, still
// flagged `estimated: true` (rendered with a `~` prefix).
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
  /** Uncached input tokens (authoritative) or chars/4 of the prompt (estimated). */
  input: number;
  /** Output tokens (authoritative) or chars/4 of the captured text (estimated). */
  output: number;
  /** Cache-creation input tokens. 0 on the chars/4 fallback path. */
  cacheCreation: number;
  /** Cache-read input tokens. 0 on the chars/4 fallback path. */
  cacheRead: number;
  /** True when any figure is NOT authoritative CLI-reported usage: either
   *  the chars/4 fallback, or real per-message usage truncated by a kill
   *  (the in-flight call is unreported). Rendered with a `~` prefix. */
  estimated: boolean;
}

export interface WorkerRunResult {
  /** Reconstructed session text (bounded): assistant text blocks + stderr +
   *  any non-stream-event output. NOT the raw JSONL — report extraction and
   *  permanent-error scanning run on this. */
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
        // stream-json is the token-accounting seam (debug-494590): the
        // result event carries authoritative cumulative usage. --verbose is
        // required by the CLI for stream-json in print mode.
        child = spawnFn(claudeBin, ["-p", prompt, "--output-format", "stream-json", "--verbose", ...extraArgs], {
          cwd: runOpts.cwd,
          // Own process group so the grace-kill can reap the whole tree.
          detached: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
        return;
      }

      let transcript = "";
      let truncated = false;
      let graceKilled = false;
      let timedOut = false;
      let graceTimer: NodeJS.Timeout | null = null;
      let drainTimer: NodeJS.Timeout | null = null;
      let settled = false;

      // ── Stream-json accounting state (debug-494590) ──────────────────────
      /** Partial stdout line awaiting its newline. */
      let stdoutBuf = "";
      /** Authoritative cumulative usage from the result event, when seen. */
      let finalUsage: StreamUsage | null = null;
      /** Per-message usage, keyed by message id — the CLI emits one event
       *  per content block, each repeating the SAME call's usage; summing
       *  naively double-counts. Kill-path floor when no result event. */
      const perMessageUsage = new Map<string, StreamUsage>();
      /** The result event ends the session definitively — grace-kill arms. */
      let resultSeen = false;
      /** True once any recognized stream event parsed. In stream mode the
       *  trailing-report predicate must NOT arm the grace-kill (review MED):
       *  intermediate assistant text now streams in as it completes, so a
       *  text block ENDING with an echoed schema-valid report (a pasted test
       *  fixture — this repo is full of them) followed by a ≥15s tool-only
       *  phase would read as "reported but won't exit" and SIGKILL an honest
       *  session; only the result event is definitive here. */
      let streamEventSeen = false;

      const appendTranscript = (s: string): void => {
        if (truncated || s === "") return;
        transcript += s;
        if (transcript.length > MAX_CAPTURE_BYTES) {
          transcript = transcript.slice(0, MAX_CAPTURE_BYTES);
          truncated = true;
        }
      };

      /** Route one complete stdout line: stream events are mined for text +
       *  usage; anything unrecognized (plain-text CLI fallback, error spew)
       *  passes through to the transcript verbatim. */
      const handleLine = (line: string): void => {
        const trimmed = line.trim();
        if (trimmed === "") return;
        let ev: unknown = null;
        if (trimmed.startsWith("{")) {
          try {
            ev = JSON.parse(trimmed);
          } catch {
            ev = null;
          }
        }
        if (ev === null || typeof ev !== "object" || Array.isArray(ev)) {
          appendTranscript(line + "\n");
          return;
        }
        const e = ev as Record<string, unknown>;
        switch (e.type) {
          case "assistant": {
            streamEventSeen = true;
            const msg = e.message;
            if (msg && typeof msg === "object") {
              const m = msg as Record<string, unknown>;
              const content = Array.isArray(m.content) ? m.content : [];
              for (const block of content) {
                if (
                  block &&
                  typeof block === "object" &&
                  (block as Record<string, unknown>).type === "text" &&
                  typeof (block as Record<string, unknown>).text === "string"
                ) {
                  appendTranscript(`${(block as Record<string, unknown>).text as string}\n`);
                }
              }
              const u = usageFrom(m.usage);
              if (u !== null) {
                // Id-less fallback keys by the usage VALUES (review LOW): a
                // per-event counter key would re-count the same call's
                // repeated usage — the exact double-count the map prevents.
                const id =
                  typeof m.id === "string"
                    ? m.id
                    : `anon:${u.input}/${u.output}/${u.cacheCreation}/${u.cacheRead}`;
                perMessageUsage.set(id, u);
              }
            }
            break;
          }
          case "result": {
            streamEventSeen = true;
            const u = usageFrom(e.usage);
            if (u !== null) finalUsage = u;
            // An error result's text is load-bearing (permanent-error
            // markers); a success result's text duplicates the final
            // assistant message already in the transcript.
            if (e.is_error === true) {
              if (typeof e.result === "string") appendTranscript(`${e.result}\n`);
              else appendTranscript(`error result (subtype: ${String(e.subtype ?? "unknown")})\n`);
            }
            resultSeen = true;
            break;
          }
          // Known non-content stream events: swallowed (tool results and
          // init/system noise must not pollute report extraction or the
          // permanent-error tail scan).
          case "system":
          case "user":
          case "stream_event":
          case "rate_limit_event":
            streamEventSeen = true;
            break;
          default:
            // A JSON object that is NOT a recognized stream event — e.g. the
            // bare report object printed by a plain-text CLI. Pass through.
            appendTranscript(line + "\n");
        }
      };

      /** The transcript as report extraction would see it if the pending
       *  partial line flushed as text — keeps grace-kill arming live for
       *  trailing content that never got its newline (plain-text fallback). */
      const effectiveTranscript = (): string =>
        stdoutBuf === "" ? transcript : transcript + stdoutBuf;

      const captureStdout = (chunk: Buffer | string): void => {
        stdoutBuf += chunk.toString();
        let nl: number;
        // eslint-disable-next-line no-cond-assign
        while ((nl = stdoutBuf.indexOf("\n")) !== -1) {
          const line = stdoutBuf.slice(0, nl);
          stdoutBuf = stdoutBuf.slice(nl + 1);
          handleLine(line);
        }
        // A pathological unterminated line must not grow unbounded. Known
        // cost (review LOW, accepted): a single JSONL event >8MB loses its
        // usage (the tail fragment can't parse) — bounded-by-design; the
        // per-message floor / chars/4 fallback still account the session.
        if (stdoutBuf.length > MAX_CAPTURE_BYTES) {
          appendTranscript(stdoutBuf);
          stdoutBuf = "";
        }
        maybeArmGraceKill();
      };

      const captureStderr = (chunk: Buffer | string): void => {
        appendTranscript(chunk.toString());
        maybeArmGraceKill();
      };

      /** Flush the pending partial stdout line (settle-time). */
      const flushStdoutBuf = (): void => {
        if (stdoutBuf === "") return;
        handleLine(stdoutBuf);
        stdoutBuf = "";
      };

      /** Best available accounting at this moment: result-event usage
       *  (authoritative) → per-message floor (real but kill-truncated) →
       *  chars/4 estimate (no stream events at all). */
      const currentTokens = (): WorkerTokens => {
        const floor = (): WorkerTokens | null => {
          if (perMessageUsage.size === 0) return null;
          const sum: WorkerTokens = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, estimated: true };
          for (const u of perMessageUsage.values()) {
            sum.input += u.input;
            sum.output += u.output;
            sum.cacheCreation += u.cacheCreation;
            sum.cacheRead += u.cacheRead;
          }
          return sum;
        };
        if (finalUsage !== null) {
          // A degenerate all-zero result usage must not override a real
          // per-message floor (review MED): "authoritative zero" would
          // silently resurrect the never-trips budget class this fix closes.
          const zero =
            finalUsage.input + finalUsage.output + finalUsage.cacheCreation + finalUsage.cacheRead === 0;
          const f = zero ? floor() : null;
          return f ?? { ...finalUsage, estimated: false };
        }
        return floor() ?? estimateTokens(prompt, effectiveTranscript());
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
      // In stream mode the result event is the ONLY arming signal (it is
      // emitted exactly once, after all content) — the trailing-report
      // predicate is unsafe there because intermediate assistant text
      // streams in as it completes (see streamEventSeen). On the plain-text
      // fallback path the trailing-report predicate still governs.
      const armed = (): boolean =>
        resultSeen || (!streamEventSeen && hasFinalReport(effectiveTranscript()));
      const maybeArmGraceKill = (): void => {
        if (graceTimer !== null || settled) return;
        if (!armed()) return;
        graceTimer = setTimeout(() => {
          if (settled) return;
          if (!armed()) {
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

      // utf8 decoding at the stream layer: a pipe chunk split mid-multibyte
      // character (em-dashes are 3 bytes) must not inject U+FFFD into the
      // reconstructed text (review LOW).
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", captureStdout);
      child.stderr?.on("data", captureStderr);

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
        // sleepGapMs during the exit-drain window (review LOW). resultSeen /
        // graceKilled likewise end the measurement: a session that already
        // finished its report must not be reclassified as a timeout by a
        // probe firing inside the grace/drain window at the ceiling
        // boundary (review LOW — the completed-with-report variant).
        if (settled || timedOut || graceKilled || resultSeen) return;
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
        flushStdoutBuf();
        if (timedOut) {
          // Carry the accounted spend on the rejection — the session
          // consumed budget before the kill (review finding MED-8) — and
          // the sleep gap for the driver's infra classification (dc7514).
          const sleptNote =
            sleepGapMs > 0
              ? ` (${Math.round(sleepGapMs / 60000)}min of machine sleep detected and excluded)`
              : "";
          reject(
            new WorkerTimeoutError(
              `worker session exceeded the ${Math.round(iterationTimeoutMs / 60000)}min awake-time iteration ceiling and was killed${sleptNote}`,
              currentTokens(),
              sleepGapMs,
            ),
          );
          return;
        }
        resolve({
          rawOutput: transcript,
          exitCode,
          graceKilled,
          tokens: currentTokens(),
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

/** Usage figures mined from one stream-json event's `usage` object. */
interface StreamUsage {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
}

function nonNegNum(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
}

/** Parse a stream event's `usage` payload; null when absent/malformed —
 *  including when NONE of the recognized keys carries a finite number
 *  (review MED: an empty/renamed-key `usage` coerced to all-zeros would
 *  become "authoritative zero" and silently re-disable the budget rails,
 *  the exact failure class debug-494590 closes). */
function usageFrom(u: unknown): StreamUsage | null {
  if (!u || typeof u !== "object" || Array.isArray(u)) return null;
  const o = u as Record<string, unknown>;
  const keys = [
    "input_tokens",
    "output_tokens",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
  ] as const;
  if (!keys.some((k) => typeof o[k] === "number" && Number.isFinite(o[k] as number))) {
    return null;
  }
  return {
    input: nonNegNum(o.input_tokens),
    output: nonNegNum(o.output_tokens),
    cacheCreation: nonNegNum(o.cache_creation_input_tokens),
    cacheRead: nonNegNum(o.cache_read_input_tokens),
  };
}

/** chars/4 heuristic, flagged estimated (O-6) — last-resort fallback when
 *  the session produced no stream-json usage events at all. */
export function estimateTokens(prompt: string, output: string): WorkerTokens {
  return {
    input: Math.ceil(prompt.length / 4),
    output: Math.ceil(output.length / 4),
    cacheCreation: 0,
    cacheRead: 0,
    estimated: true,
  };
}
