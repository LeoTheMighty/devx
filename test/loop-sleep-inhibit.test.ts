// Sleep inhibitor (v2l101 — src/lib/loop/sleep-inhibit.ts).

import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { describe, expect, it } from "vitest";

import {
  SLEEP_INHIBITED_ENV,
  startSleepInhibit,
  type SpawnLike,
} from "../src/lib/loop/sleep-inhibit.js";

interface FakeChild extends EventEmitter {
  unref: () => void;
  kill: (sig?: string) => boolean;
  killedWith: string[];
}

function fakeSpawn(behavior: "spawn" | "error" | "throw" = "spawn"): {
  spawnFn: SpawnLike;
  calls: Array<{ cmd: string; args: string[]; env: NodeJS.ProcessEnv }>;
  children: FakeChild[];
} {
  const calls: Array<{ cmd: string; args: string[]; env: NodeJS.ProcessEnv }> = [];
  const children: FakeChild[] = [];
  const spawnFn: SpawnLike = (cmd, args, options) => {
    if (behavior === "throw") throw new Error("ENOENT");
    calls.push({ cmd, args: [...args], env: options.env });
    const child = new EventEmitter() as FakeChild;
    child.unref = () => {};
    child.killedWith = [];
    child.kill = (sig?: string) => {
      child.killedWith.push(sig ?? "SIGTERM");
      return true;
    };
    children.push(child);
    queueMicrotask(() => child.emit(behavior === "spawn" ? "spawn" : "error", new Error("nope")));
    return child as unknown as ChildProcess;
  };
  return { spawnFn, calls, children };
}

describe("startSleepInhibit", () => {
  it("env loop-breaker: DEVX_SLEEP_INHIBITED=1 skips without spawning", async () => {
    const { spawnFn, calls } = fakeSpawn();
    const h = await startSleepInhibit({
      platform: "darwin",
      env: { [SLEEP_INHIBITED_ENV]: "1" },
      spawnFn,
    });
    expect(h).toMatchObject({ kind: "skipped", reason: "already-inhibited" });
    expect(calls).toHaveLength(0);
  });

  it("darwin: caffeinate -i -w <pid>, breaker env set on the child", async () => {
    const { spawnFn, calls } = fakeSpawn();
    const h = await startSleepInhibit({ platform: "darwin", env: {}, pid: 1234, spawnFn });
    expect(h.kind).toBe("active");
    expect(calls[0].cmd).toBe("caffeinate");
    expect(calls[0].args).toEqual(["-i", "-w", "1234"]);
    expect(calls[0].env[SLEEP_INHIBITED_ENV]).toBe("1");
  });

  it("linux: systemd-inhibit holds idle:sleep via a helper child (no re-exec)", async () => {
    const { spawnFn, calls } = fakeSpawn();
    const h = await startSleepInhibit({ platform: "linux", env: {}, spawnFn });
    expect(h.kind).toBe("active");
    expect(calls[0].cmd).toBe("systemd-inhibit");
    expect(calls[0].args).toContain("--what=idle:sleep");
    expect(calls[0].args).toContain("--mode=block");
    // Argv exec — the wrapped command is plain args, no shell string.
    expect(calls[0].args.slice(-2)).toEqual(["sleep", "infinity"]);
  });

  it("stop() kills the helper", async () => {
    const { spawnFn, children } = fakeSpawn();
    const h = await startSleepInhibit({ platform: "darwin", env: {}, spawnFn });
    h.stop();
    expect(children[0].killedWith).toEqual(["SIGTERM"]);
  });

  it("unavailable binary (spawn error event) degrades to skipped + warns", async () => {
    const { spawnFn } = fakeSpawn("error");
    const warnings: string[] = [];
    const h = await startSleepInhibit({
      platform: "linux",
      env: {},
      spawnFn,
      warn: (m) => warnings.push(m),
    });
    expect(h).toMatchObject({ kind: "skipped", reason: "unavailable" });
    expect(warnings[0]).toMatch(/unavailable/);
  });

  it("synchronous spawn throw degrades the same way", async () => {
    const { spawnFn } = fakeSpawn("throw");
    const h = await startSleepInhibit({ platform: "darwin", env: {}, spawnFn, warn: () => {} });
    expect(h).toMatchObject({ kind: "skipped", reason: "unavailable" });
  });

  it("unsupported platforms skip cleanly", async () => {
    const { spawnFn, calls } = fakeSpawn();
    const h = await startSleepInhibit({ platform: "win32", env: {}, spawnFn });
    expect(h).toMatchObject({ kind: "skipped", reason: "unsupported" });
    expect(calls).toHaveLength(0);
  });
});
