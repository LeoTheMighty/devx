// Child-process worker for test/backlog-mutate.test.ts (mlc102 AC 4).
//
// Usage: node --import tsx backlog-mutate-worker.ts \
//          <cacheDir> <devMdPath> <goFile> <hash1,hash2,...>
//
// Spin-waits on <goFile> (barrier — all workers released together), then
// flips each listed DEV.md row `[ ]` → `[/]` via the same
// read-modify-write shape the loop driver uses, each RMW inside
// withBacklogLock. The race is inter-process by nature (N `devx loop`
// instances + interactive /devx), so an in-process simulation of the
// locked path would prove nothing — same posture as
// test/init-failure-append-race.test.ts.
// Emits JSON {flipped: n} on stdout; non-zero exit on any error.

import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { withBacklogLock } from "../../src/lib/backlog/mutate.js";
import { setBacklogRowState } from "../../src/lib/loop/spec-io.js";

const [cacheDir, devMdPath, goFile, hashesArg] = process.argv.slice(2);
if (!cacheDir || !devMdPath || !goFile || !hashesArg) {
  process.stderr.write("usage: backlog-mutate-worker <cacheDir> <devMd> <goFile> <hashes>\n");
  process.exit(64);
}
const hashes = hashesArg.split(",").filter((h) => h !== "");

// Barrier (review EC-F6): announce readiness first — the test releases the
// go file only after ALL workers have finished their tsx boot and are
// spinning here, so every worker's first RMW genuinely lands in the same
// contention window. The spin sleeps between checks (Atomics.wait — no
// 100%-CPU busy loop while peers compile).
writeFileSync(`${goFile}.ready-${process.pid}`, "ready\n", "utf8");
const sleep = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};
const deadline = Date.now() + 30_000;
while (!existsSync(goFile)) {
  if (Date.now() > deadline) {
    process.stderr.write("barrier timeout\n");
    process.exit(1);
  }
  sleep(5);
}

try {
  for (const hash of hashes) {
    withBacklogLock(cacheDir, `test-flip-${hash}`, () => {
      const content = readFileSync(devMdPath, "utf8");
      // Widen the read→write window the way a real caller does real work
      // in between (parse, splice, log) — a busy spin so concurrent
      // workers genuinely overlap their critical-section attempts.
      const spinUntil = Date.now() + 2;
      while (Date.now() < spinUntil) {
        /* hold the read */
      }
      const next = setBacklogRowState(content, hash, "dev", "/", "in-progress");
      if (next === null) {
        throw new Error(`no DEV.md row for ${hash}`);
      }
      writeFileSync(devMdPath, next, "utf8");
    });
  }
  process.stdout.write(JSON.stringify({ flipped: hashes.length }) + "\n");
} catch (e) {
  process.stderr.write(`${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
  process.exit(1);
}
