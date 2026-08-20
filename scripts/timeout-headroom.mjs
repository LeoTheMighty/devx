// Timeout-headroom sweep (debug-5c8b21 AC 3).
//
// WHY THIS EXISTS. Three separate defects in this repo have been "a test whose
// verdict depends on machine speed": debug-c81f04 (backlog-mutate R3),
// debug-74632d (loop-driver teardown ENOTEMPTY), and debug-5c8b21 (the
// loop-concurrency G-1 case, which sat ~1.3x under its 600s cap under
// full-suite load and then timed out on a warm machine). By the third instance
// the audit is the point, not the individual fix: any test whose measured
// duration is close to its own timeout is a red build waiting for a slow day.
// This makes that a number anyone can re-derive instead of a hunch.
//
// USAGE — two modes, one file.
//
//   1. As a vitest reporter, to COLLECT. Append-only, so both `npm test`
//      passes write to one file. Setting DEVX_HEADROOM_OUT is what turns on
//      `includeTaskLocation` in vitest.shared.ts (vitest has no CLI flag for
//      it), and the locations are what let the analyzer find each test's
//      source-declared cap.
//
//        rm -f /tmp/headroom.ndjson
//        DEVX_HEADROOM_OUT=/tmp/headroom.ndjson npx vitest run \
//          --config vitest.parallel.config.ts \
//          --reporter=default --reporter=./scripts/timeout-headroom.mjs
//        DEVX_HEADROOM_OUT=/tmp/headroom.ndjson npx vitest run \
//          --config vitest.blocking.config.ts \
//          --reporter=default --reporter=./scripts/timeout-headroom.mjs
//
//   2. As a CLI, to ANALYZE:
//
//        node scripts/timeout-headroom.mjs /tmp/headroom.ndjson [--min 2] [--all]
//
//      Prints every test whose headroom (cap / measured duration) is under
//      `--min` (default 2), worst first. Exit 1 when anything is under the
//      bar, so it CAN be wired to a gate; nothing calls it from CI today, on
//      purpose — durations are machine-dependent and a flaky gate about
//      flakiness helps no one.
//
// WHY THE CAP IS PARSED FROM SOURCE. Vitest 2.x bakes a per-test timeout into
// the wrapped handler (`withTimeout` in @vitest/runner) and never stores it on
// the task, so a reporter genuinely cannot read it — an earlier cut of this
// script reported the 5,000ms default for a test declared at 300,000ms. The
// analyzer therefore parses each test file with the TypeScript compiler API
// and joins on (file, line) against `task.location`.
//
// ANALYZE AGAINST THE TREE YOU COLLECTED FROM. The join key is (file, line),
// so editing a test file between the sweep and the analysis silently shifts
// every test below the edit onto the wrong cap — and the failure mode is
// quiet: a 300,000ms case gets reported at the 5,000ms default and shows up
// as a false "thin headroom" hit. Re-collect after any edit to `test/`.
//
// SCOPE LIMITS, stated so they are not mistaken for coverage:
//   - Hooks (`beforeAll`/`beforeEach`) have their own `hookTimeout` and are
//     not reported with a duration; they are outside this sweep.
//   - A test whose location is missing (DEVX_HEADROOM_OUT unset when the run
//     started) is counted separately and skipped from the ranking.
//
// LAST SWEEP — 2026-08-20 (evening), 12-core macOS, two-pass gate
// (`test:parallel` then `test:blocking`), 117 files / 2,631 tests parallel
// (25.3s) + 29 files / 759 tests blocking (159.1s), all green. 3,389 distinct
// tests analyzed. Taken after debug-5e1a77 iteration 4 — the ADOPTION cut.
//
//   THE HEADLINE: 3 tests under 1x, and all three are DELIBERATE.
//
//     0.1x  2,007ms/200    exec-async-seam.test.ts:136
//           the pinned false green — the sync seam running 10x past a cap
//           that cannot fire, kept as the live specimen of the fault.
//     0.1x    746ms/100    loop-driver-timeout-enforcement.test.ts:103
//           an `it.fails` case: it passes BECAUSE the cap fired at 100ms.
//           (An `it.fails` row inverts the usual reading — a SHORTER cap is
//           the safe direction there, so this ratio is meant to be small.)
//     1.0x    202ms/200    exec-async-seam.test.ts:114
//           the same proof at the seam level (AC 1).
//
//   Read past all three. There is no longer a single ACCIDENTAL over-cap test
//   in the suite: 16 → 3 (iteration 3) → 0. Under 2x: 21 → 9 → 5, and the two
//   real ones (loop-driver:1027 at 1.1x, :1812 at 1.6x) are ordinary headroom
//   against a cap that now fires. Under 5x: 65 → 52 → 51.
//
//   WHAT CHANGED, and this time it IS the async seam. driver.ts now defaults
//   to `realExecAsync`; git-tx.ts takes an `ExecLike` (`Exec | ExecAsync`) and
//   awaits internally; preflight.ts follows. Nothing else moved: `await` on a
//   non-promise is a no-op, so every synchronous fake injected through
//   `opts.exec` still works verbatim, and no assertion anywhere was touched.
//
//   NEGATIVE-CONTROLLED, so the claim is not vacuous. Flip that one default
//   back to `realExec` and test/loop-driver-timeout-enforcement.test.ts goes
//   red twice: a 20ms `setInterval` armed inside a real runLoop scenario ticks
//   exactly 0 times (as it did before), and the 150ms case runs to a clean
//   `merged` — the false PASS itself, which `it.fails` scores as a failure.
//
//   THE THREE THAT USED TO BE OVER CAP now carry explicit, measured caps
//   (AC 2/AC 4 — declared and justified, not trimmed to fit):
//     2.5x  48,430ms/120,000  loop-driver:1854   split failure (origin hook)
//     9.2x  13,113ms/120,000  loop-driver:901    commit-failure repair
//    11.9x  10,060ms/120,000  loop-driver:592    push failure at acs_met
//   plus three siblings in the same hook-bearing family. All six exec a hook
//   FILE THE TEST WROTE, and on macOS that costs a per-process security
//   assessment (~3.5s cold per worker, ~0.5s after) which QUEUES under the
//   blocking pass's concurrency. The amplification is the point: :1854
//   measures 1.5s alone and 48.4s in the full pass — 32x, reproduced across
//   two consecutive runs, so it is load and not the macOS-sleep artifact that
//   fooled iteration 3. Isolation numbers do not predict these tests; the
//   ~1.71x uniform slowdown assumed below does not apply to them.
//
//   ONE ROW IS STILL HONESTLY UNENFORCEABLE, and is labelled as such in
//   place: init-e2e.test.ts:890 (5,538ms, now under an explicit 30s cap,
//   458ms alone → 11.8x). That file's git seam is `execFileSync`, so its cap
//   still cannot fire. The cap documents the measurement; it does not enforce
//   it. Same for the merge tail (`tail.ts` + `withGhRetry`/`checkHold`, which
//   busy-wait) and `claimSpec`, and for anything the driver runs under
//   `withBacklogLock` — that lock releases around a SYNCHRONOUS callback, so
//   awaiting inside it would drop the lock with a child still running. Those
//   are the remaining adoption surface.
//
// SWEEP -2 — 2026-08-20, 12-core macOS, two-pass gate (`npm run test:parallel`
// then `npm run test:blocking`), 117 files / 2,631 tests parallel (25.5s) + 28
// files / 756 tests blocking (155.4s), all green. 3,386 distinct tests
// analyzed. Taken after debug-5e1a77 iterations 2-3.
//
//   16 tests under 1x → 3. 21 under 2x → 9. 65 under 5x → 52. The worst
//   number in the suite moved from 0.02x (221,677ms against a 5,000ms cap)
//   to 0.4x (13,417ms). The whole blocking pass went 1,024s → 155s.
//
//   The three still over their cap, all still unenforceable (they block):
//     0.4x  13,417ms/5,000  loop-driver.test.ts:863  commit-failure repair
//     0.5x   9,913ms/5,000  loop-driver.test.ts:554  push failure at acs_met
//     0.9x   5,330ms/5,000  init-e2e.test.ts:890     gh-not-auth path
//   The first two are the last two REAL-PREDICATE git hooks in the suite —
//   the expensive form (test/helpers/git-hooks.ts). That is the next cut.
//
//   Two rows under 1x are deliberate and must stay: exec-async-seam.test.ts
//   :136 is the pinned false green (2,009ms under a 200ms cap, PASSED — the
//   fault itself), and :114 is AC 1's `it.fails` proof that a cap CAN fire.
//   Read past both.
//
//   WHAT ACTUALLY MOVED THE NUMBERS, and it was not the async seam. Most of
//   this pass's cost was PATH resolution. A bare `"git"` makes libuv hand the
//   lookup to `execvp` in the child; on macOS a FAILED `execve` attempt costs
//   ~5.6ms, so a spawn costs ~5.6ms per PATH entry that misses. With 26
//   entries ahead of `/usr/bin` that is ~150ms on EVERY git call, against
//   ~11ms for the same command named absolutely — and identical for async
//   spawns, so it is exec-attempt cost, not a `spawnSync` artifact. Both
//   seams now resolve once (`resolveCommandPath`, src/lib/exec.ts) and the
//   fixtures do too (`test/helpers/git-bin.ts`). Measured A/B on
//   loop-driver's `runLoop scenarios` block, 19 tests, twice each:
//   141-149s → 46s (seam) → 15.2-16.4s (fixtures too).
//
//   FAULT (2) WAS STILL OPEN AT THIS POINT. Nothing in this sweep made a cap
//   enforceable — those tests were faster, not interruptible. The seam
//   existed (`realExecAsync`); adoption had not happened. It did in
//   iteration 4 — see LAST SWEEP above.
//
// PRIOR SWEEP — 2026-08-19, 12-core macOS, full two-pass `npm test`
// (113 files / 2,540 tests parallel + 26 files / 733 tests blocking, all
// green). 3,272 distinct tests analyzed. Findings, worst first:
//
//   16 tests ran LONGER THAN THEIR OWN CAP and still reported PASSED.
//   Worst: test/loop-driver.test.ts:1271 at 221,677ms against the 5,000ms
//   default (0.02x). Also >100s-under-5s: loop-driver:903 / :1820 / :861 /
//   :551, learn-watch:1269, devx-claim:754, stub:148.
//
//   That is not thin headroom, it is NO enforcement — and it is exactly
//   fault (2) from vitest.shared.ts: `realExec` is spawnSync, a blocked
//   event loop cannot fire its own timeout callback, so the cap never runs.
//   Every one of the 16 is in SYNC_BLOCKING_TESTS. The fix is the async
//   exec seam (debug-ecdcda, which predicted this sweep would surface them
//   at ~1x), not a cap edit here: raising a cap that never fires changes
//   nothing.
//
//   21 tests under 2x, 65 under 5x. ALL 21 of the under-2x are in
//   SYNC_BLOCKING_TESTS, across 15 files. Of the 65 under-5x, only 5 are in
//   the async parallel pass — test/loop-worker.test.ts:56/:194/:337/:363
//   (3.0-4.9x against explicit 15s caps, and those caps ARE enforceable
//   because that file does not block) and test/manage-spawn-integration
//   .test.ts:124 (4.0x). Nothing in the 2,540-test parallel pass is under
//   2x.
//
//   Read that as the partition working: after debug-7c1e93 split the passes,
//   the async majority has real margin everywhere, and every remaining thin
//   number sits in the set of files whose timeouts are unenforceable by
//   construction. Re-run this sweep after the exec seam goes async — that is
//   the run whose numbers will mean something for the blocking set.
//
//   test/loop-concurrency.test.ts (this spec's subject) no longer appears in
//   any band: each G-1 seed case is ~2.6s against a 300,000ms cap.
//
// READ THE NUMBERS AS RELATIVE, NOT ABSOLUTE. Headroom measured on an idle
// machine overstates the margin a loaded one gets: debug-5c8b21 measured a
// uniform ~1.71x slowdown for every file in a full-suite run on a warm box,
// including a control file whose code had not changed. Treat anything under
// ~2x isolated as already broken, and 2-5x as thin.

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { argv, env, exit, stdout } from "node:process";

const DEFAULT_OUT = "/tmp/devx-headroom.ndjson";

/** Vitest's own default when no `testTimeout` is configured. None of this
 *  repo's three configs sets one, so this is the effective cap for every test
 *  that does not declare its own. */
const VITEST_DEFAULT_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// Mode 1: reporter
// ---------------------------------------------------------------------------

/** Walk a vitest task tree, yielding leaf test tasks. */
function* leaves(task) {
  if (!task) return;
  if (Array.isArray(task.tasks) && task.tasks.length > 0) {
    for (const child of task.tasks) yield* leaves(child);
    return;
  }
  if (task.type === "test" || task.type === "custom") yield task;
}

/** Full `describe > describe > it` name, so a bare `it` name is locatable.
 *  The file task is itself a suite (it carries `filepath`) — skip it, the
 *  path is reported separately. */
function fullName(task) {
  const parts = [task.name];
  for (let t = task.suite; t && t.type === "suite" && !t.filepath; t = t.suite) {
    parts.unshift(t.name);
  }
  return parts.join(" > ");
}

export default class TimeoutHeadroomReporter {
  onInit() {
    this.out = env.DEVX_HEADROOM_OUT || DEFAULT_OUT;
  }

  onFinished(files = []) {
    const rows = [];
    for (const file of files) {
      for (const task of leaves(file)) {
        const duration = task.result?.duration;
        if (typeof duration !== "number") continue; // skipped / not run
        rows.push({
          file: file.name,
          name: fullName(task),
          state: task.result?.state ?? "unknown",
          durationMs: Math.round(duration),
          line: task.location?.line ?? null,
        });
      }
    }
    if (rows.length === 0) return;
    appendFileSync(this.out || DEFAULT_OUT, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
    stdout.write(`\n[timeout-headroom] appended ${rows.length} rows to ${this.out}\n`);
  }
}

/** Start a fresh sweep: the reporter appends, so a stale file would blend two
 *  runs' numbers together. */
export const truncate = (path = env.DEVX_HEADROOM_OUT || DEFAULT_OUT) =>
  writeFileSync(path, "", "utf8");

// ---------------------------------------------------------------------------
// Mode 2: CLI analyzer — source-declared caps, joined on (file, line)
// ---------------------------------------------------------------------------

const num = (text) => Number(String(text).replace(/_/g, ""));

/** `it` / `test`, including `it.each(...)`, `it.skip`, `it.concurrent`, … */
function isTestCallee(text) {
  return /^(it|test)\b/.test(text);
}
function isSuiteCallee(text) {
  return /^(describe|suite)\b/.test(text);
}

/** The timeout an `it(...)`/`describe(...)` call declares, or null.
 *  Two accepted forms: a trailing numeric argument, and an options object
 *  carrying `timeout:`. */
function declaredTimeout(ts, call) {
  for (const arg of call.arguments) {
    if (ts.isNumericLiteral(arg)) return num(arg.text);
    if (ts.isObjectLiteralExpression(arg)) {
      for (const prop of arg.properties) {
        if (
          ts.isPropertyAssignment(prop) &&
          prop.name &&
          prop.name.getText() === "timeout" &&
          ts.isNumericLiteral(prop.initializer)
        ) {
          return num(prop.initializer.text);
        }
      }
    }
    // A named constant (`G1_CASE_TIMEOUT_MS`) resolves in the second pass.
    if (ts.isIdentifier(arg) && /TIMEOUT|_MS$/i.test(arg.text)) {
      return { ident: arg.text };
    }
  }
  return null;
}

/** file → Map(line → capMs). Enclosing `describe` caps apply to tests that
 *  do not declare their own. */
async function capsForFile(ts, path) {
  const src = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );

  // Pass 1: module-level `const X = 123` so a named cap resolves.
  const consts = new Map();
  for (const stmt of src.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.initializer && ts.isNumericLiteral(decl.initializer)) {
        consts.set(decl.name.text, num(decl.initializer.text));
      }
    }
  }
  const resolve = (t) => {
    if (t == null) return null;
    if (typeof t === "number") return t;
    return consts.has(t.ident) ? consts.get(t.ident) : null;
  };

  const caps = new Map();
  const walk = (node, inherited) => {
    let next = inherited;
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(src);
      if (isSuiteCallee(callee)) {
        next = resolve(declaredTimeout(ts, node)) ?? inherited;
      } else if (isTestCallee(callee)) {
        const own = resolve(declaredTimeout(ts, node));
        const cap = own ?? inherited;
        const line = src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1;
        // `explicit` tracks whether a cap was DECLARED, not whether it differs
        // from the default — a test that spells out 5_000 is still a decision.
        caps.set(line, { cap: cap ?? VITEST_DEFAULT_TIMEOUT_MS, explicit: cap != null });
      }
    }
    ts.forEachChild(node, (child) => walk(child, next));
  };
  walk(src, null);
  return caps;
}

async function analyze(path, minHeadroom, showAll) {
  const ts = (await import("typescript")).default;

  const rows = readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));

  // A test can appear twice (both passes, retries): keep the SLOWEST sighting,
  // because the worst case is what reds the build.
  const worst = new Map();
  for (const r of rows) {
    const key = `${r.file}::${r.name}`;
    const prev = worst.get(key);
    if (!prev || r.durationMs > prev.durationMs) worst.set(key, r);
  }

  const capCache = new Map();
  const ranked = [];
  const unlocated = [];
  for (const r of worst.values()) {
    if (r.line == null) {
      unlocated.push(r);
      continue;
    }
    if (!capCache.has(r.file)) capCache.set(r.file, await capsForFile(ts, r.file));
    const entry = capCache.get(r.file).get(r.line) ?? {
      cap: VITEST_DEFAULT_TIMEOUT_MS,
      explicit: false,
    };
    ranked.push({
      ...r,
      timeoutMs: entry.cap,
      explicit: entry.explicit,
      headroom: r.durationMs === 0 ? Infinity : entry.cap / r.durationMs,
    });
  }
  ranked.sort((a, b) => a.headroom - b.headroom);

  const line = (r) =>
    `  ${r.headroom === Infinity ? "  inf" : r.headroom.toFixed(1).padStart(5)}x  ` +
    `${String(r.durationMs).padStart(7)}ms / ${String(r.timeoutMs).padStart(7)}ms  ` +
    `${r.explicit ? "explicit" : "default "}  ${r.file}:${r.line}\n            ${r.name}`;

  const thin = ranked.filter((r) => r.headroom < minHeadroom);
  stdout.write(`Analyzed ${ranked.length} distinct tests from ${path}\n\n`);
  if (thin.length === 0) {
    stdout.write(`No test is under ${minHeadroom}x of its own timeout.\n`);
  } else {
    stdout.write(`${thin.length} test(s) under ${minHeadroom}x of their timeout:\n`);
    for (const r of thin) stdout.write(line(r) + "\n");
  }
  if (showAll) {
    stdout.write(`\nAll tests, thinnest headroom first:\n`);
    for (const r of ranked) stdout.write(line(r) + "\n");
  } else {
    stdout.write(`\nThinnest 15:\n`);
    for (const r of ranked.slice(0, 15)) stdout.write(line(r) + "\n");
  }
  if (unlocated.length > 0) {
    stdout.write(
      `\n${unlocated.length} test(s) had no location? — rerun with --includeTaskLocation.\n`,
    );
  }
  return thin.length === 0 ? 0 : 1;
}

const invokedDirectly = argv[1] && argv[1].endsWith("timeout-headroom.mjs");
if (invokedDirectly) {
  const args = argv.slice(2);
  const path = args.find((a) => !a.startsWith("--") && !/^\d+$/.test(a)) ?? DEFAULT_OUT;
  const minIdx = args.indexOf("--min");
  const min = minIdx >= 0 ? Number(args[minIdx + 1]) : 2;
  exit(await analyze(path, min, args.includes("--all")));
}
