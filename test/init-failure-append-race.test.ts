// debug-9c4e21 — appendManualEntry read-check-write race repro + regression.
//
// The RED artifact for the debug loop: pre-fix, appendManualEntry's
// read → anchor-check → writeAtomic sequence is not serialized across
// processes, so (a) a bullet appended by a peer between our read and our
// rename is clobbered (lost update), and (b) two same-kind writers can both
// miss the anchor and double-append. Post-fix (O_EXCL lock around the
// sequence, re-read inside the lock) both assertions hold deterministically.
//
// Real child processes (node --import tsx) exercise the real function — the
// race is inter-process by nature (installSkills runs, /devx-init runs, loop
// workers), so an in-process simulation would prove nothing.
//
// Spec: debug/debug-9c4e21-2026-07-14T12:15-manual-append-read-check-write-race.md

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const WORKER = join(__dirname, "fixtures", "append-manual-worker.ts");

interface WorkerResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runWorker(manualPath: string, goFile: string, kinds: string[]): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", WORKER, manualPath, goFile, kinds.join(",")],
      { cwd: join(__dirname, ".."), stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function anchorCount(content: string, kind: string): number {
  const anchor = `<!-- devx:init-failure:${kind} -->`;
  let count = 0;
  let idx = content.indexOf(anchor);
  while (idx !== -1) {
    count++;
    idx = content.indexOf(anchor, idx + anchor.length);
  }
  return count;
}

describe("debug-9c4e21 — appendManualEntry under concurrent processes", () => {
  const tmpDirs: string[] = [];

  function makeTmp(): string {
    const dir = mkdtempSync(join(tmpdir(), "devx-append-race-"));
    tmpDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    while (tmpDirs.length > 0) {
      rmSync(tmpDirs.pop()!, { recursive: true, force: true });
    }
  });

  // Warm tsx's compile cache with a single worker before the concurrent
  // batches — a cold-cache stampede of 4 simultaneous tsx compiles is a
  // flake vector unrelated to the race under test.
  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), "devx-append-race-warmup-"));
    try {
      const goFile = join(dir, "go");
      writeFileSync(goFile, "go\n");
      const r = await runWorker(join(dir, "MANUAL.md"), goFile, ["warmup"]);
      expect(r.code, `warmup worker failed: ${r.stderr}`).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("never loses a bullet when N processes append distinct kinds concurrently", async () => {
    const dir = makeTmp();
    const manualPath = join(dir, "MANUAL.md");
    const goFile = join(dir, "go");

    const WORKERS = 4;
    const KINDS_PER_WORKER = 6;
    const perWorkerKinds: string[][] = Array.from({ length: WORKERS }, (_, w) =>
      Array.from({ length: KINDS_PER_WORKER }, (_, k) => `race-kind-w${w}-k${k}`),
    );

    const running = perWorkerKinds.map((kinds) => runWorker(manualPath, goFile, kinds));
    // All workers are spin-waiting on the barrier; release them together.
    writeFileSync(goFile, "go\n");
    const results = await Promise.all(running);

    for (const r of results) {
      expect(r.code, `worker failed: ${r.stderr}`).toBe(0);
    }

    const content = readFileSync(manualPath, "utf8");
    const missing = perWorkerKinds.flat().filter((k) => anchorCount(content, k) !== 1);
    expect(
      missing,
      `lost/duplicated bullets under concurrency (read-check-write race): ${missing.join(", ")}`,
    ).toEqual([]);
  }, 60_000);

  it("appends a shared kind exactly once when N processes race on it", async () => {
    const dir = makeTmp();
    const manualPath = join(dir, "MANUAL.md");
    const goFile = join(dir, "go");
    const kind = "race-shared-kind";

    const running = Array.from({ length: 4 }, () => runWorker(manualPath, goFile, [kind]));
    writeFileSync(goFile, "go\n");
    const results = await Promise.all(running);

    for (const r of results) {
      expect(r.code, `worker failed: ${r.stderr}`).toBe(0);
    }

    const content = readFileSync(manualPath, "utf8");
    expect(anchorCount(content, kind), "same-kind anchor must appear exactly once").toBe(1);

    // Exactly one worker performed the append; the rest observed the anchor.
    const appendedTrue = results
      .flatMap((r) => (JSON.parse(r.stdout) as { results: { appended: boolean }[] }).results)
      .filter((x) => x.appended).length;
    expect(appendedTrue, "exactly one process should win the append").toBe(1);
  }, 60_000);
});
