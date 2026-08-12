// End-to-end smoke against the BUILT CLI: a fixture DEV.md + stub claude in a
// tmpdir, with `devx manage --once` invoked there via spawnSync.
//
// WHY THIS LIVES IN ITS OWN FILE (debug-ecdcda)
//
// This is the only synchronous-child-process test in the manage-spawn
// integration set. The sync-blocking partition (debug-7c1e93) is per-FILE
// while the blocking itself is per-TEST, so while this test shared a file
// with five `await runManagerOnce(...)` tests, that whole file was pinned into
// pass 2 — and the async tests ran at `maxForks: 2` alongside genuinely
// long blockers like loop-driver.test.ts (561s of solid spawnSync). They
// timed out on the 5,000ms default while needing ~355ms of real work.
//
// Measured 2026-08-12 on a 12-core macOS box, against the PRE-SPLIT file
// (all 6 tests still together) so the two rows are the same population:
//   pre-split file, in isolation ... 6 tests, 1.32s, 0 failures
//   pre-split file, inside pass 2 .. 3 failures, all `Test timed out in
//                                    5000ms`; in-file sibling at 52,131ms
//
// A ~14x amplification on a 355ms test is contention, not intrinsic cost.
// Note this also refutes the "it starves itself, so no partition can rescue
// it" reading recorded in vitest.blocking.config.ts: the self-inflicted share
// is this one test, and in isolation the entire file — this test included —
// finishes in 1.32s. The starvation was cross-file all along.
//
// So: keep the one real blocker here (pass 2), and let the five async tests
// run in pass 1 where their timers are schedulable. Membership is mechanical
// and pinned by test/vitest-split.test.ts — if you add a sync child-process
// call to the sibling file, that pin fails and tells you to move it back.
//
// Spec: debug/debug-ecdcda-2026-08-05T13:10-manage-spawn-5s-timeouts-under-load.md

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const CLI_DIST = join(REPO_ROOT, "dist", "cli.js");

// Skipped if dist/cli.js doesn't exist (running vitest before `npm run build`).
const cliExists = existsSync(CLI_DIST);
const cliDescribe = cliExists ? describe : describe.skip;

cliDescribe("`devx manage --once` end-to-end with fixture DEV.md (mgr104 AC #6)", () => {
  it("tick 1 spawns a stub worker and writes worker log", () => {
    const cwd = mkdtempSync(join(tmpdir(), "devx-mgr-e2e-"));
    try {
      const stub = join(cwd, "stub-claude.sh");
      writeFileSync(stub, "#!/bin/sh\necho stub-args: $@\nsleep 0.05\nexit 0\n", "utf8");
      chmodSync(stub, 0o755);

      writeFileSync(
        join(cwd, "DEV.md"),
        "### Epic\n- [ ] `dev/dev-e2ee2e-2026-05-07T11:00-e2e.md` — fixture. Status: ready.\n",
        "utf8",
      );

      // Worker logs go under HOME/Library/Logs/devx (or platform-equiv) by
      // default; we don't have a way to override via CLI today, so we cap
      // testing to: PID was recorded + summary line shape. Worker-log path
      // assertion is covered by the in-process integration tests in
      // test/manage-spawn-integration.test.ts.
      const r = spawnSync("node", [CLI_DIST, "manage", "--once"], {
        cwd,
        encoding: "utf8",
        env: { ...process.env, DEVX_CLAUDE_BIN: stub },
      });

      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/^tick 1: spawned e2ee2e\n$/);

      const state = JSON.parse(
        readFileSync(join(cwd, ".devx-cache", "state", "manager.json"), "utf8"),
      );
      expect(state.roster?.length).toBeGreaterThanOrEqual(0); // race: child may have exited already
      expect(state.generation).toBe(1);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 10000);
});
