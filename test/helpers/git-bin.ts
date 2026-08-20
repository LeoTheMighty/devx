// The absolute path to `git`, resolved ONCE per process (debug-5e1a77).
//
// Passing a bare `"git"` to `execFileSync`/`spawnSync` makes libuv hand PATH
// resolution to `execvp` in the child, and on macOS every FAILED `execve`
// attempt costs ~5.6ms. On a dev box whose shell profile has grown PATH to 54
// entries with 26 of them ahead of `/usr/bin`, that is ~150ms of pure lookup
// on every git call a fixture makes — against ~11ms for the same command named
// absolutely. Measured on test/loop-driver.test.ts's `runLoop scenarios`
// block (19 tests, real git throughout): 141-149s → 15.2-16.4s once BOTH the
// production seam and these fixtures stopped searching PATH per spawn.
//
// Production code does not need this — src/lib/exec.ts's `realExec` /
// `realExecAsync` resolve internally. It exists for the test fixtures that
// drive git directly instead of through the seam, and it deliberately reuses
// the production resolver rather than restating the rule.
import { resolveCommandPath } from "../../src/lib/exec.js";

export const GIT = resolveCommandPath("git", process.env.PATH);
