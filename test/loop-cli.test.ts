// `devx loop` CLI registration (v2l101 — src/commands/loop.ts). The heavy
// behavior lives in runLoop (test/loop-driver.test.ts); this pins the
// commander surface the skill body invokes.

import { Command } from "commander";
import { describe, expect, it } from "vitest";

import { register } from "../src/commands/loop.js";

function buildProgram(): Command {
  const program = new Command();
  program.name("devx").exitOverride();
  register(program);
  return program;
}

describe("devx loop registration", () => {
  it("registers the loop command with the skill-pinned flag surface", () => {
    const program = buildProgram();
    const cmd = program.commands.find((c) => c.name() === "loop");
    expect(cmd).toBeDefined();
    const flags = cmd!.options.map((o) => o.flags);
    expect(flags).toContain("--until <HH:MM>");
    expect(flags).toContain("--max-items <n>");
    expect(flags).toContain("--max-tokens <n>");
    expect(flags).toContain("--only <type>");
    expect(flags).toContain("--dry-run");
  });

  it("description names the refusal mode (LOCKDOWN) and the morning report", () => {
    const program = buildProgram();
    const cmd = program.commands.find((c) => c.name() === "loop")!;
    expect(cmd.description()).toMatch(/morning report/i);
    expect(cmd.description()).toMatch(/LOCKDOWN/);
  });
});

describe("parseIntFlag (EC-LOW-12 — strict digits only)", () => {
  it("rejects scientific/decimal shapes instead of silently truncating", async () => {
    const { parseIntFlag } = await import("../src/commands/loop.js");
    expect(parseIntFlag("1e6")).toBeNaN();
    expect(parseIntFlag("5.9")).toBeNaN();
    expect(parseIntFlag("-3")).toBeNaN();
    expect(parseIntFlag("12abc")).toBeNaN();
    expect(parseIntFlag(" 42 ")).toBe(42);
    expect(parseIntFlag(undefined)).toBeUndefined();
  });
});

describe("signal → AbortController wiring (LOW-9)", () => {
  it("SIGTERM while the loop runs aborts the driver's signal and the command returns", async () => {
    const { runLoopCommand } = await import("../src/commands/loop.js");
    const { runLoop } = await import("../src/lib/loop/driver.js");
    let captured: AbortSignal | undefined;
    const fake: typeof runLoop = async (opts) => {
      captured = opts.signal;
      // Behave like a running loop: return only once the signal aborts.
      await new Promise<void>((resolve) => {
        if (!opts.signal || opts.signal.aborted) return resolve();
        opts.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      return { exitCode: 0, summary: null, reportPath: null };
    };
    // dry-run keeps the sleep inhibitor out of the picture.
    const pending = runLoopCommand({ dryRun: true }, { runLoop: fake });
    await new Promise((r) => setTimeout(r, 20)); // let the handlers install
    expect(captured).toBeDefined();
    expect(captured!.aborted).toBe(false);
    process.emit("SIGTERM", "SIGTERM");
    const code = await pending;
    expect(captured!.aborted).toBe(true);
    expect(code).toBe(0);
  });
});
