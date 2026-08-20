// Git-hook fixtures for the tests that drive real repositories.
//
// WHY THIS FILE EXISTS (debug-5e1a77). A `git push` / `git commit` that has
// to RUN a hook is 10-70x slower than one that doesn't, and the whole of that
// cost lands inside a `spawnSync` — i.e. inside a window where the test's own
// timeout cannot fire. Measured 2026-08-20 in a FRESH vitest worker per row,
// 12-core macOS, bare local origin on the same disk:
//
//   no hooksPath at all ..........................    52 ms
//   hook = a file this test wrote (script OR a copy
//     of /usr/bin/true — the content is irrelevant)
//       first push in the worker .................  3,569 ms
//       every push after that ....................    530 ms
//   hook = a SYMLINK to /usr/bin/true ............    54 ms  ← flat, no first-run hit
//
// The penalty is macOS's security assessment of an executable at a
// locally-created path. It is charged per exec, it does not cache across
// processes, and priming the file with a direct `spawnSync` from the test
// first does NOT satisfy it (measured: no change across the six hook-bearing
// loop-driver scenarios, 73.2s → 72.0s). Resolving to a system binary is what
// avoids it, because that path is already trusted.
//
// So: when a hook only ever has to SUCCEED or only ever has to FAIL, use
// {@link armRejectingHook} / {@link disarmHook} and pay nothing. Reach for
// {@link writeHookScript} only when the hook is a real predicate (over $PWD,
// a flag file, or its stdin ref list) — and know that each such hook costs
// the file ~3.5s once plus ~0.5s per hooked git command, in isolation, and
// considerably more under full-suite load where concurrent workers'
// assessments queue against each other.
//
// Spec: debug/debug-5e1a77-2026-08-19T16:08-unenforceable-timeouts-false-green.md

import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** First system `false` that exists — macOS and Linux disagree on the path,
 *  and the point of the symlink is that it resolves to a TRUSTED one. */
const SYSTEM_FALSE =
  ["/usr/bin/false", "/bin/false"].find((p) => existsSync(p)) ?? "/usr/bin/false";

/**
 * Install a hook that always fails, for free.
 *
 * `/usr/bin/false` exits 1 and says nothing, which is exactly what a
 * "reject everything" fixture hook does — git supplies its own
 * `pre-push hook declined` / `... hook declined` message either way, so
 * assertions that read git's output are unaffected. Idempotent: an existing
 * hook at that name is replaced.
 *
 * Use this for a hook that is armed for the whole test, and for one a worker
 * arms mid-run (create the symlink at the moment the fixture would otherwise
 * have written its flag file — same instant, same effect, none of the cost).
 */
export function armRejectingHook(hooksDir: string, name: string): string {
  mkdirSync(hooksDir, { recursive: true });
  const path = join(hooksDir, name);
  rmSync(path, { force: true });
  symlinkSync(SYSTEM_FALSE, path);
  return path;
}

/** Remove a hook installed by {@link armRejectingHook} (the "flag cleared"
 *  half of an arm/disarm pair). No-op when it isn't there. */
export function disarmHook(hooksDir: string, name: string): void {
  rmSync(join(hooksDir, name), { force: true });
}

/**
 * Write a real hook SCRIPT — a predicate git has to run.
 *
 * Only for hooks that must decide per invocation (on `$PWD`, a flag file, or
 * the ref list on stdin). Every such hook is expensive; see the file header
 * for the numbers before adding another one.
 */
export function writeHookScript(hooksDir: string, name: string, body: string): string {
  mkdirSync(hooksDir, { recursive: true });
  const path = join(hooksDir, name);
  writeFileSync(path, body, { mode: 0o755 });
  return path;
}
