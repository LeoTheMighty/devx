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
// LAST SWEEP — 2026-08-19, 12-core macOS, full two-pass `npm test`
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
