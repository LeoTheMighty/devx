// Worker session runner (v2l101 — src/lib/loop/worker.ts): prompt-as-argv,
// output capture, grace-kill arming, token estimation.

import { describe, expect, it } from "vitest";

import { estimateTokens, makeClaudeWorker } from "../src/lib/loop/worker.js";

const REPORT =
  '```json\n{"success":true,"summary":"s","key_changes_made":[],"key_learnings":["l"],"acs_met":false}\n```';

/** Worker backed by `node -e` so the test drives a REAL child process. */
function nodeWorker(script: string, graceKillMs?: number) {
  return makeClaudeWorker({
    claudeBin: process.execPath,
    ...(graceKillMs !== undefined ? { graceKillMs } : {}),
    // `claude -p <prompt>` shape → `node -p <prompt>`? No: we override argv
    // entirely by treating the prompt as an ignored first arg and running
    // our script via extraArgs. Layout: node -p <prompt-expr> would eval the
    // prompt; instead use extraArgs to append `-e <script>` AFTER `-p
    // <prompt>`... node treats the LAST -e/-p as the program, so the script
    // wins and the prompt stays inert data.
    extraArgs: ["-e", script],
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
    expect(estimateTokens("abcd", "ab")).toEqual({ input: 1, output: 1, estimated: true });
    expect(estimateTokens("", "").estimated).toBe(true);
  });
});

describe("iteration wall-clock ceiling (BH/EC hang immunity)", () => {
  it("a worker that never reports and never exits is killed at the ceiling and surfaces as an error", async () => {
    const worker = makeClaudeWorker({
      claudeBin: process.execPath,
      extraArgs: ["-e", "setInterval(() => {}, 1000);"],
      iterationTimeoutMs: 300,
    });
    const started = Date.now();
    await expect(worker("p", { cwd: process.cwd() })).rejects.toThrow(/iteration ceiling/);
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 15_000);
});
