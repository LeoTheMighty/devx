// mlc102 — withBacklogLock unit tests + the R3 reproduction (AC 1, AC 4).
//
// R3 (design §Race inventory): two unlocked writers read-modify-write the
// same backlog file; the interleaving read A → read B → write A → write B
// silently discards A's update. The repro here drives that exact
// interleaving deterministically against the old (unlocked) path shape,
// then proves zero lost updates when every writer holds the backlog lock
// across its RMW — cross-process, because the race is inter-process by
// nature (same posture as test/init-failure-append-race.test.ts).
//
// Spec: dev/dev-mlc102-2026-07-28T09:02-backlog-mutation-lock.md

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  BACKLOG_LOCK_POLL_MS,
  BACKLOG_LOCK_TIMEOUT_MS,
  BacklogLockTimeoutError,
  backlogLockPath,
  withBacklogLock,
} from "../src/lib/backlog/mutate.js";
import { acquirePathLock } from "../src/lib/manage/lock.js";
import { setBacklogRowState } from "../src/lib/loop/spec-io.js";

const WORKER = join(__dirname, "fixtures", "backlog-mutate-worker.ts");

const tmpDirs: string[] = [];
function makeTmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tmpDirs.length > 0) {
    rmSync(tmpDirs.pop()!, { recursive: true, force: true });
  }
});

function devMdWith(hashes: string[]): string {
  const rows = hashes
    .map(
      (h) =>
        `- [ ] \`dev/dev-${h}-2026-07-28T09:02-item-${h}.md\` — Item ${h}. Status: ready.`,
    )
    .join("\n");
  return `# DEV — backlog\n\n${rows}\n`;
}

describe("withBacklogLock — unit (AC 1)", () => {
  it("pins the 30s/20ms constants and the locks/backlog.lock path", () => {
    expect(BACKLOG_LOCK_TIMEOUT_MS).toBe(30_000);
    expect(BACKLOG_LOCK_POLL_MS).toBe(20);
    expect(backlogLockPath("/x/.devx-cache")).toBe(
      join("/x/.devx-cache", "locks", "backlog.lock"),
    );
  });

  it("runs fn under the lock, returns its value, and releases after", () => {
    const cacheDir = join(makeTmp("devx-backlog-lock-"), ".devx-cache");
    const lockFile = backlogLockPath(cacheDir);
    const result = withBacklogLock(cacheDir, "unit", () => {
      expect(existsSync(lockFile), "lock file must exist inside fn").toBe(true);
      return 42;
    });
    expect(result).toBe(42);
    expect(existsSync(lockFile), "lock file must be released after fn").toBe(false);
  });

  it("releases the lock when fn throws", () => {
    const cacheDir = join(makeTmp("devx-backlog-lock-"), ".devx-cache");
    expect(() =>
      withBacklogLock(cacheDir, "thrower", () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(existsSync(backlogLockPath(cacheDir))).toBe(false);
    // A subsequent acquisition must succeed immediately.
    expect(withBacklogLock(cacheDir, "after-throw", () => "ok")).toBe("ok");
  });

  it("is re-entrant within the process (nested sections don't self-deadlock)", () => {
    const cacheDir = join(makeTmp("devx-backlog-lock-"), ".devx-cache");
    const lockFile = backlogLockPath(cacheDir);
    const result = withBacklogLock(cacheDir, "outer", () =>
      // A non-re-entrant lock would block here for the full timeout; the
      // 50ms override turns a regression into a fast, explicit throw.
      withBacklogLock(
        cacheDir,
        "inner",
        () => {
          expect(existsSync(lockFile)).toBe(true);
          return "nested";
        },
        { timeoutMs: 50 },
      ),
    );
    expect(result).toBe("nested");
    // Only the OUTER exit releases — verified by the file being gone now.
    expect(existsSync(lockFile)).toBe(false);
  });

  it("re-entrancy keys on the resolved path, not the cacheDir spelling", () => {
    const base = makeTmp("devx-backlog-lock-");
    const cacheDir = join(base, ".devx-cache");
    const aliased = join(base, "sub", "..", ".devx-cache");
    const result = withBacklogLock(cacheDir, "outer", () =>
      withBacklogLock(aliased, "inner-aliased", () => "ok", { timeoutMs: 50 }),
    );
    expect(result).toBe("ok");
    expect(existsSync(backlogLockPath(cacheDir))).toBe(false);
  });

  it("timeout diagnostic names the holder pid and the waiting label (AC 1)", () => {
    const cacheDir = join(makeTmp("devx-backlog-lock-"), ".devx-cache");
    const held = acquirePathLock(resolve(backlogLockPath(cacheDir)));
    try {
      let clock = 0;
      let thrown: unknown;
      try {
        withBacklogLock(cacheDir, "contended-section", () => "never", {
          timeoutMs: 100,
          nowMs: () => clock,
          sleep: (ms) => {
            clock += ms;
          },
          // The holder is this same live process — force the live answer so
          // the stale reaper can't cut the wait short.
          pidAlive: () => true,
          pidStartedAt: () => null,
        });
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(BacklogLockTimeoutError);
      const err = thrown as BacklogLockTimeoutError;
      expect(err.holderPid).toBe(process.pid);
      expect(err.label).toBe("contended-section");
      expect(err.message).toContain(`pid ${process.pid}`);
      expect(err.message).toContain("contended-section");
    } finally {
      held.release();
    }
  });

  it("reaps a dead-PID holder instead of timing out", () => {
    const cacheDir = join(makeTmp("devx-backlog-lock-"), ".devx-cache");
    const stale = acquirePathLock(resolve(backlogLockPath(cacheDir)));
    let slept = 0;
    const result = withBacklogLock(cacheDir, "reap", () => "ran", {
      sleep: () => {
        slept++;
      },
      pidAlive: () => false,
      warn: () => {},
    });
    expect(result).toBe("ran");
    expect(slept, "dead-holder reap must not wait out the poll loop").toBe(0);
    stale.release(); // tolerates the reaped file
  });
});

describe("R3 reproduction — lost DEV.md update (AC 4)", () => {
  it("the old unlocked shape loses a flip under the read/read/write/write interleave", () => {
    const dir = makeTmp("devx-r3-unlocked-");
    const devMd = join(dir, "DEV.md");
    writeFileSync(devMd, devMdWith(["aaa111", "bbb222"]), "utf8");

    // Writer A and writer B, interleaved exactly as two unlocked processes
    // can be scheduled: both read, then both write. This is the literal
    // pre-mlc102 path shape (readFileSync → setBacklogRowState →
    // writeFileSync with nothing serializing the pair).
    const readA = readFileSync(devMd, "utf8");
    const readB = readFileSync(devMd, "utf8");
    writeFileSync(devMd, setBacklogRowState(readA, "aaa111", "dev", "/", "in-progress")!, "utf8");
    writeFileSync(devMd, setBacklogRowState(readB, "bbb222", "dev", "/", "in-progress")!, "utf8");

    const final = readFileSync(devMd, "utf8");
    // B's write, based on the stale pre-A read, silently reverted A's flip.
    expect(final).toContain("dev-bbb222");
    expect(
      /- \[\/\] `dev\/dev-aaa111-/.test(final),
      "R3: writer A's flip must be LOST on the unlocked shape (if this now holds, the repro no longer demonstrates the race)",
    ).toBe(false);
  });

  // Warm tsx's compile cache before the concurrent batch (flake-vector
  // posture copied from test/init-failure-append-race.test.ts).
  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), "devx-r3-warmup-"));
    try {
      const devMd = join(dir, "DEV.md");
      writeFileSync(devMd, devMdWith(["aaa000"]), "utf8");
      const goFile = join(dir, "go");
      writeFileSync(goFile, "go\n");
      const r = await runWorker(join(dir, ".devx-cache"), devMd, goFile, ["aaa000"]);
      expect(r.code, `warmup worker failed: ${r.stderr}`).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("N processes flipping distinct rows under the lock lose nothing", async () => {
    const dir = makeTmp("devx-r3-locked-");
    const devMd = join(dir, "DEV.md");
    const cacheDir = join(dir, ".devx-cache");
    const goFile = join(dir, "go");

    const WORKERS = 4;
    const FLIPS_PER_WORKER = 5;
    const perWorker: string[][] = Array.from({ length: WORKERS }, (_, w) =>
      Array.from({ length: FLIPS_PER_WORKER }, (_, k) => `w${w}k${k}a`),
    );
    writeFileSync(devMd, devMdWith(perWorker.flat()), "utf8");

    const running = perWorker.map((hashes) => runWorker(cacheDir, devMd, goFile, hashes));
    // Real barrier (review EC-F6): wait until every worker has booted and
    // announced readiness BEFORE releasing — otherwise the go file lands
    // while workers are still compiling and the "simultaneous" release is
    // fiction (a serializing scheduler could then pass with a broken lock).
    const readyDeadline = Date.now() + 30_000;
    while (readdirSync(dir).filter((f) => f.startsWith("go.ready-")).length < WORKERS) {
      if (Date.now() > readyDeadline) throw new Error("workers never became ready");
      await new Promise((res) => setTimeout(res, 10));
    }
    writeFileSync(goFile, "go\n");
    const results = await Promise.all(running);
    for (const r of results) {
      expect(r.code, `worker failed: ${r.stderr}`).toBe(0);
    }

    const final = readFileSync(devMd, "utf8");
    const lost = perWorker
      .flat()
      .filter((h) => !new RegExp(`- \\[/\\] \`dev/dev-${h}-`).test(final));
    expect(
      lost,
      `flips lost under concurrency despite the backlog lock: ${lost.join(", ")}`,
    ).toEqual([]);
    // And the lock itself must be released once everyone is done.
    expect(existsSync(backlogLockPath(cacheDir))).toBe(false);
  }, 60_000);
});

interface WorkerResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runWorker(
  cacheDir: string,
  devMdPath: string,
  goFile: string,
  hashes: string[],
): Promise<WorkerResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", WORKER, cacheDir, devMdPath, goFile, hashes.join(",")],
      { cwd: join(__dirname, ".."), stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
  });
}
