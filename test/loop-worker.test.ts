// Worker session runner (v2l101 — src/lib/loop/worker.ts): prompt-as-argv,
// output capture, grace-kill arming, token estimation.

import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";

import { WorkerTimeoutError, estimateTokens, makeClaudeWorker } from "../src/lib/loop/worker.js";

const REPORT =
  '```json\n{"success":true,"summary":"s","key_changes_made":[],"key_learnings":["l"],"acs_met":false}\n```';

/** Worker backed by `node -e` so the test drives a REAL child process.
 *  The spawn seam replaces the claude argv entirely — relying on
 *  `node -p <prompt> -e <script>` last-flag-wins semantics broke on CI
 *  (node 20 resolves the flags differently than node 24; both grace-kill
 *  tests hung 15s → PR #67 CI red). The seam keeps every real-process
 *  property the tests exercise (own process group, pipes, kill -pid). */
function nodeWorker(script: string, graceKillMs?: number) {
  return makeClaudeWorker({
    claudeBin: process.execPath,
    ...(graceKillMs !== undefined ? { graceKillMs } : {}),
    spawnFn: (_bin, _args, opts) => spawn(process.execPath, ["-e", script], opts),
  });
}

describe("makeClaudeWorker (real child processes)", () => {
  it("captures stdout+stderr and the exit code; prompt travels as one argv element", async () => {
    const worker = nodeWorker(
      `process.stdout.write("out "); process.stderr.write("err "); process.stdout.write(${JSON.stringify(REPORT)});`,
    );
    const evilPrompt = 'do things; `$(rm -rf /)` "quoted"';
    const r = await worker(evilPrompt, { cwd: process.cwd() });
    expect(r.exitCode).toBe(0);
    expect(r.graceKilled).toBe(false);
    expect(r.rawOutput).toContain("out ");
    expect(r.rawOutput).toContain("err ");
    expect(r.rawOutput).toContain('"success":true');
    // Estimated tokens are flagged.
    expect(r.tokens.estimated).toBe(true);
    expect(r.tokens.input).toBeGreaterThan(0);
  });

  it("grace-kills a worker that reported but won't exit (~15s contract, shrunk for test)", async () => {
    const worker = nodeWorker(
      // Prints a VALID final report, then hangs forever.
      `process.stdout.write(${JSON.stringify(REPORT)}); setInterval(() => {}, 1000);`,
      300,
    );
    const started = Date.now();
    const r = await worker("p", { cwd: process.cwd() });
    expect(r.graceKilled).toBe(true);
    expect(r.rawOutput).toContain('"success":true');
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 15_000);

  it("does NOT grace-kill on invalid report text (waits for real exit)", async () => {
    const worker = nodeWorker(
      `process.stdout.write("no json here"); setTimeout(() => {}, 400);`,
      50,
    );
    const r = await worker("p", { cwd: process.cwd() });
    expect(r.graceKilled).toBe(false);
    expect(r.exitCode).toBe(0);
  });

  it("abort signal kills the worker tree", async () => {
    const ac = new AbortController();
    const worker = nodeWorker(`setInterval(() => {}, 1000);`);
    setTimeout(() => ac.abort(), 200);
    const r = await worker("p", { cwd: process.cwd(), signal: ac.signal });
    expect(r.exitCode).toBeNull(); // signal-terminated
  }, 15_000);

  it("rejects when the binary doesn't exist", async () => {
    const worker = makeClaudeWorker({ claudeBin: "/definitely/not/a/binary" });
    await expect(worker("p", { cwd: process.cwd() })).rejects.toThrow();
  });
});

describe("estimateTokens", () => {
  it("chars/4, ceil, flagged estimated (O-6)", () => {
    expect(estimateTokens("abcd", "ab")).toEqual({
      input: 1,
      output: 1,
      cacheCreation: 0,
      cacheRead: 0,
      estimated: true,
    });
    expect(estimateTokens("", "").estimated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Authoritative token accounting (debug-494590)
//
// Repro of the under-count: loop-2026-07-24T16-46 self-reported ~11.5k in /
// ~9.3k out for 13 iterations producing +2,861 diff lines — the chars/4
// estimate reads only the worker's FINAL text emission, invisible to the
// session's real cumulative usage. An empirical probe of `claude -p "Reply
// with exactly the word: ok"` (CLI 2.1.220, 2026-07-26) processed 24,155
// real input tokens (10 uncached + 6,609 cache-create + 17,536 cache-read)
// while chars/4 of the visible text records ~9 in / ~1 out — three orders
// of magnitude under. The fix: spawn with `--output-format stream-json` and
// read the result event's cumulative `usage` (the O-6 upgrade path).
// ---------------------------------------------------------------------------

const REPORT_TEXT =
  'work done\n```json\n{"success":true,"summary":"s","key_changes_made":[],"key_learnings":["l"],"acs_met":false}\n```';

/** Stream-json fixture modeled on the real probe (see comment above):
 *  two assistant events sharing one message id (identical usage — summing
 *  naively double-counts), a tool-result user event, a second assistant
 *  message carrying the final report text, and the result event with the
 *  session's CUMULATIVE usage. */
const STREAM_EVENTS = [
  { type: "system", subtype: "init", cwd: "/tmp", session_id: "s1" },
  {
    type: "assistant",
    message: {
      id: "msg_1",
      content: [{ type: "thinking", thinking: "hm" }],
      usage: { input_tokens: 10, cache_creation_input_tokens: 6609, cache_read_input_tokens: 17536, output_tokens: 4 },
    },
  },
  {
    type: "assistant",
    message: {
      id: "msg_1",
      content: [{ type: "text", text: "working on it" }],
      usage: { input_tokens: 10, cache_creation_input_tokens: 6609, cache_read_input_tokens: 17536, output_tokens: 4 },
    },
  },
  { type: "user", message: { content: [{ type: "tool_result", content: "big tool output" }] } },
  {
    type: "assistant",
    message: {
      id: "msg_2",
      content: [{ type: "text", text: REPORT_TEXT }],
      usage: { input_tokens: 25, cache_creation_input_tokens: 0, cache_read_input_tokens: 24000, output_tokens: 80 },
    },
  },
  { type: "rate_limit_event", rate_limit_info: { status: "allowed" } },
  {
    type: "result",
    subtype: "success",
    is_error: false,
    result: REPORT_TEXT,
    usage: { input_tokens: 35, cache_creation_input_tokens: 6609, cache_read_input_tokens: 41536, output_tokens: 120 },
    num_turns: 2,
    total_cost_usd: 0.05,
  },
];
const STREAM_FIXTURE = STREAM_EVENTS.map((e) => JSON.stringify(e)).join("\n") + "\n";

describe("authoritative token accounting (debug-494590)", () => {
  it("spawns claude with --output-format stream-json --verbose so usage is reported", async () => {
    let seenArgs: readonly string[] = [];
    const worker = makeClaudeWorker({
      claudeBin: process.execPath,
      spawnFn: (_bin, args, opts) => {
        seenArgs = args;
        return spawn(process.execPath, ["-e", `process.stdout.write(${JSON.stringify(STREAM_FIXTURE)});`], opts);
      },
    });
    await worker("p", { cwd: process.cwd() });
    expect(seenArgs).toContain("--output-format");
    expect(seenArgs[seenArgs.indexOf("--output-format") + 1]).toBe("stream-json");
    expect(seenArgs).toContain("--verbose");
  });

  it("the result event's cumulative usage replaces the chars/4 estimate (the 494590 repro)", async () => {
    const worker = nodeWorker(`process.stdout.write(${JSON.stringify(STREAM_FIXTURE)});`);
    const r = await worker("p", { cwd: process.cwd() });
    expect(r.exitCode).toBe(0);
    // Authoritative figures from the result event — NOT chars/4 of anything.
    expect(r.tokens).toEqual({
      input: 35,
      output: 120,
      cacheCreation: 6609,
      cacheRead: 41536,
      estimated: false,
    });
  });

  it("rawOutput is the reconstructed assistant text — report extractable, event noise excluded", async () => {
    const worker = nodeWorker(`process.stdout.write(${JSON.stringify(STREAM_FIXTURE)});`);
    const r = await worker("p", { cwd: process.cwd() });
    expect(r.rawOutput).toContain("working on it");
    expect(r.rawOutput).toContain('"success":true');
    expect(r.rawOutput).not.toContain('"type":"result"');
    expect(r.rawOutput).not.toContain("tool_result");
  });

  it("a killed session carries the real usage accumulated so far, deduped by message id", async () => {
    const partial =
      STREAM_EVENTS.slice(0, 5)
        .map((e) => JSON.stringify(e))
        .join("\n") + "\n"; // everything up to msg_2, NO result event
    const worker = makeClaudeWorker({
      claudeBin: process.execPath,
      spawnFn: (_bin, _args, opts) =>
        spawn(process.execPath, ["-e", `process.stdout.write(${JSON.stringify(partial)}); setInterval(() => {}, 1000);`], opts),
      iterationTimeoutMs: 5_000,
    });
    let caught: unknown;
    try {
      await worker("p", { cwd: process.cwd() });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(WorkerTimeoutError);
    const err = caught as WorkerTimeoutError;
    // msg_1 counted ONCE (its two events repeat the same call's usage) +
    // msg_2: input 10+25, output 4+80, cacheRead 17536+24000. Partial (the
    // in-flight call at kill time is unreported) ⇒ flagged estimated.
    expect(err.tokens.input).toBe(35);
    expect(err.tokens.output).toBe(84);
    expect(err.tokens.cacheCreation).toBe(6609);
    expect(err.tokens.cacheRead).toBe(41536);
    expect(err.tokens.estimated).toBe(true);
  }, 15_000);

  it("the result event arms the grace-kill (session over; CLI should have exited)", async () => {
    const resultOnly = JSON.stringify(STREAM_EVENTS[STREAM_EVENTS.length - 1]) + "\n";
    const worker = makeClaudeWorker({
      claudeBin: process.execPath,
      spawnFn: (_bin, _args, opts) =>
        spawn(process.execPath, ["-e", `process.stdout.write(${JSON.stringify(resultOnly)}); setInterval(() => {}, 1000);`], opts),
      graceKillMs: 200,
      iterationTimeoutMs: 30_000,
    });
    const r = await worker("p", { cwd: process.cwd() });
    expect(r.graceKilled).toBe(true);
  }, 15_000);

  it("an error result's text lands in rawOutput so permanent-error markers stay scannable", async () => {
    const errorEvent =
      JSON.stringify({
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        result: "Credit balance is too low",
        usage: { input_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 2 },
      }) + "\n";
    const worker = nodeWorker(`process.stdout.write(${JSON.stringify(errorEvent)}); process.exit(1);`);
    const r = await worker("p", { cwd: process.cwd() });
    expect(r.exitCode).toBe(1);
    expect(r.rawOutput).toContain("Credit balance is too low");
    expect(r.tokens.estimated).toBe(false);
    expect(r.tokens.input).toBe(5);
  });

  it("plain-text output (no stream events) still falls back to chars/4, flagged estimated", async () => {
    const worker = nodeWorker(`process.stdout.write("plain old text " + ${JSON.stringify(REPORT)});`);
    const r = await worker("p", { cwd: process.cwd() });
    expect(r.tokens.estimated).toBe(true);
    expect(r.tokens.cacheCreation).toBe(0);
    expect(r.tokens.cacheRead).toBe(0);
    expect(r.rawOutput).toContain("plain old text");
  });

  it("stream mode: an echoed schema-valid report mid-session does NOT arm the grace-kill (review MED)", async () => {
    // An assistant text block ENDING with a pasted report fixture, followed
    // by a ≥graceKillMs tool-only stall. In stream mode only the result
    // event may arm the kill — the ceiling, not the grace-kill, must end
    // this session (rejection), and the honest stall is never reaped early.
    const echoEvent =
      JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_e",
          content: [{ type: "text", text: REPORT_TEXT }],
          usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 5 },
        },
      }) + "\n";
    const worker = makeClaudeWorker({
      claudeBin: process.execPath,
      spawnFn: (_bin, _args, opts) =>
        spawn(process.execPath, ["-e", `process.stdout.write(${JSON.stringify(echoEvent)}); setInterval(() => {}, 1000);`], opts),
      graceKillMs: 100,
      iterationTimeoutMs: 1_500,
    });
    await expect(worker("p", { cwd: process.cwd() })).rejects.toThrow(/iteration ceiling/);
  }, 15_000);

  it("a degenerate result usage (empty/renamed keys) never becomes authoritative zero (review MED)", async () => {
    const events =
      [
        STREAM_EVENTS[1], // msg_1 usage 10/4 + 6609cc/17536cr
        { type: "result", subtype: "success", is_error: false, result: "ok", usage: {} },
      ]
        .map((e) => JSON.stringify(e))
        .join("\n") + "\n";
    const worker = nodeWorker(`process.stdout.write(${JSON.stringify(events)});`);
    const r = await worker("p", { cwd: process.cwd() });
    // Falls to the per-message floor, flagged — NOT unflagged zeros.
    expect(r.tokens).toEqual({
      input: 10,
      output: 4,
      cacheCreation: 6609,
      cacheRead: 17536,
      estimated: true,
    });
  });

  it("id-less assistant events with identical usage dedupe by value (review LOW)", async () => {
    const anon = {
      type: "assistant",
      message: {
        content: [{ type: "text", text: "t" }],
        usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 100, output_tokens: 4 },
      },
    };
    const events = [anon, anon].map((e) => JSON.stringify(e)).join("\n") + "\n";
    const worker = nodeWorker(`process.stdout.write(${JSON.stringify(events)});`);
    const r = await worker("p", { cwd: process.cwd() });
    // Counted once (repeated same-call usage), not summed twice.
    expect(r.tokens.input).toBe(10);
    expect(r.tokens.output).toBe(4);
    expect(r.tokens.cacheRead).toBe(100);
    expect(r.tokens.estimated).toBe(true);
  });
});

describe("iteration wall-clock ceiling (BH/EC hang immunity)", () => {
  it("a worker that never reports and never exits is killed at the ceiling and surfaces as an error", async () => {
    const worker = makeClaudeWorker({
      claudeBin: process.execPath,
            spawnFn: (_bin, _args, opts) => spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"], opts),
      iterationTimeoutMs: 300,
    });
    const started = Date.now();
    await expect(worker("p", { cwd: process.cwd() })).rejects.toThrow(/iteration ceiling/);
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 15_000);

  it("the timeout rejection carries the estimated tokens for the captured output (MED-8)", async () => {
    const worker = makeClaudeWorker({
      claudeBin: process.execPath,
      // Prints ~400 chars of output, then hangs — that spend must not
      // vanish from the night's accounting when the ceiling kills it.
      // Ceiling is generous vs node's startup time so the write always
      // lands BEFORE the kill, even under full-suite parallel load (a
      // 500ms ceiling flaked when child startup exceeded it).
      spawnFn: (_bin, _args, opts) => spawn(process.execPath, ["-e", `process.stdout.write("x".repeat(400)); setInterval(() => {}, 1000);`], opts),
      iterationTimeoutMs: 5_000,
    });
    let caught: unknown;
    try {
      await worker("a prompt of some length", { cwd: process.cwd() });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(WorkerTimeoutError);
    const err = caught as WorkerTimeoutError;
    expect(err.tokens.estimated).toBe(true);
    expect(err.tokens.input).toBeGreaterThan(0);
    expect(err.tokens.output).toBeGreaterThanOrEqual(100); // 400 chars / 4
  }, 15_000);
});

describe("sleep-aware iteration ceiling (dc7514 — suspend time is excused)", () => {
  it("machine-suspend time is excluded from the ceiling; the surviving session's result carries sleepGapMs", async () => {
    // The wall clock jumps +2h mid-session (simulated lid-close suspend);
    // the ceiling is far below 2h. The old single-setTimeout ceiling design
    // measured that as elapsed time; the probe must excuse it and let the
    // honest worker finish.
    let offset = 0;
    setTimeout(() => {
      offset = 2 * 3_600_000;
    }, 150);
    const worker = makeClaudeWorker({
      claudeBin: process.execPath,
      spawnFn: (_bin, _args, opts) =>
        spawn(
          process.execPath,
          ["-e", `setTimeout(() => { process.stdout.write(${JSON.stringify(REPORT)}); }, 600);`],
          opts,
        ),
      // 5s, not 2s: under full-suite parallel load, child startup + probe
      // lag below the 2× excuse threshold accumulated past a 2s ceiling
      // and killed the honest child (same flake class as the MED-8 test's
      // 500ms→5s bump above).
      iterationTimeoutMs: 5_000,
      nowMs: () => Date.now() + offset,
    });
    const r = await worker("p", { cwd: process.cwd() });
    expect(r.exitCode).toBe(0);
    expect(r.sleepGapMs).toBeGreaterThan(3_000_000); // ~the 2h gap was detected
  }, 15_000);

  it("a post-wake kill fires on AWAKE time and the rejection carries the sleep gap for infra classification", async () => {
    let offset = 0;
    setTimeout(() => {
      offset = 2 * 3_600_000;
    }, 150);
    const worker = makeClaudeWorker({
      claudeBin: process.execPath,
      spawnFn: (_bin, _args, opts) =>
        spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"], opts),
      iterationTimeoutMs: 800,
      nowMs: () => Date.now() + offset,
    });
    let caught: unknown;
    try {
      await worker("p", { cwd: process.cwd() });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(WorkerTimeoutError);
    const err = caught as WorkerTimeoutError;
    expect(err.sleepGapMs).toBeGreaterThan(3_000_000);
    expect(err.message).toMatch(/awake-time iteration ceiling/);
    expect(err.message).toMatch(/machine sleep detected and excluded/);
  }, 15_000);

  it("a session with no suspend reports sleepGapMs 0", async () => {
    const worker = nodeWorker(`process.stdout.write(${JSON.stringify(REPORT)});`);
    const r = await worker("p", { cwd: process.cwd() });
    expect(r.sleepGapMs).toBe(0);
  });
});

describe("final-report anchoring (LOW-12 — grace-kill arms only on a TRAILING report)", () => {
  it("a schema-valid report EARLY in the output followed by more content does not arm the grace-kill", async () => {
    // Report first, then more output, then a hang. If the early report
    // armed the kill, we'd resolve with graceKilled=true; instead the
    // iteration ceiling must be what ends the session (rejection).
    const worker = makeClaudeWorker({
      claudeBin: process.execPath,
            spawnFn: (_bin, _args, opts) => spawn(process.execPath, ["-e", `process.stdout.write(${JSON.stringify(REPORT)}); process.stdout.write("\\n...still working on cleanup...\\n"); setInterval(() => {}, 1000);`], opts),
      graceKillMs: 100,
      iterationTimeoutMs: 1_500,
    });
    await expect(worker("p", { cwd: process.cwd() })).rejects.toThrow(/iteration ceiling/);
  }, 15_000);

  it("a report as the FINAL content still arms the grace-kill (existing contract intact)", async () => {
    const worker = makeClaudeWorker({
      claudeBin: process.execPath,
            spawnFn: (_bin, _args, opts) => spawn(process.execPath, ["-e", `process.stdout.write("preamble work log\\n"); process.stdout.write(${JSON.stringify(REPORT)}); setInterval(() => {}, 1000);`], opts),
      graceKillMs: 200,
      iterationTimeoutMs: 30_000,
    });
    const r = await worker("p", { cwd: process.cwd() });
    expect(r.graceKilled).toBe(true);
  }, 15_000);
});
