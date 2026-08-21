// Loop driver end-to-end scenarios (v2l101 — src/lib/loop/driver.ts).
//
// Real git fixture (bare origin + clone) so the claim (dvx101), the
// transactional commits/resets, the worktree lifecycle, and the abandon
// flips all run against actual repositories. The worker and the merge tail
// are scripted seams; everything else is production code. The fixture +
// scripted seams live in test/helpers/loop-git-fixture.ts (shared with
// test/loop-iteration.test.ts's E-4 driver scenarios since mss103).

import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defaultSleep, parseUntil, pickNextItem, runLoop } from "../src/lib/loop/driver.js";
import { readEvents } from "../src/lib/loop/state.js";
import {
  instancesDir,
  listInstances,
  readInstance,
} from "../src/lib/loop/instances.js";
import { WorkerTimeoutError, type WorkerRunFn } from "../src/lib/loop/worker.js";
import { realExec } from "../src/lib/loop/git-tx.js";
import { type HandOffKind, type TailFn } from "../src/lib/loop/tail.js";
import {
  MERGED,
  g,
  instantSleep,
  makeFixture,
  mergedTail,
  scriptedWorker,
  armRejectingHook,
  writeHookScript,
  type Fixture,
} from "./helpers/loop-git-fixture.js";
import { GIT } from "./helpers/git-bin.js";

let fixture: Fixture | null = null;
afterEach(() => {
  if (fixture) rmSync(fixture.base, {
    recursive: true,
    force: true,
    // Belt-and-braces against the ENOTEMPTY teardown race; makeFixture
    // disables the auto-gc that caused it, this survives anything else
    // that writes into the fixture as it is being torn down.
    maxRetries: 10,
    retryDelay: 50,
  });
  fixture = null;
});

/** mlc105 retarget: the loop's run state moved from the singleton
 *  `loop/state.json` to per-run `loop/instances/<run-id>.json`. These two
 *  helpers express the SAME invariants the old readLoopState assertions
 *  did — "this run ended in status X" and "nothing was written at all". */
function instanceStatus(cacheDir: string, runId: string): string | null {
  return readInstance(cacheDir, runId)?.status ?? null;
}

function noInstancesWritten(cacheDir: string): boolean {
  return !existsSync(instancesDir(cacheDir)) || listInstances(cacheDir).length === 0;
}

function baseOpts(fx: Fixture, extra: Partial<Parameters<typeof runLoop>[0]> = {}) {
  return {
    repoRoot: fx.repoRoot,
    merged: MERGED,
    out: () => {},
    heartbeatIntervalMs: 3_600_000,
    ...extra,
  };
}

/**
 * Explicit cap for the tests that make real git EXEC A HOOK FILE (debug-5e1a77
 * AC 2 / AC 4). No assertion here is weakened to fit a number; the number is
 * declared because the cost is measured and is not devx's.
 *
 * On macOS a `git` command that execs an executable at a locally-created path
 * pays a per-process security assessment: ~3.5s the FIRST time in a fresh
 * vitest worker and ~0.5s every time after, against ~52ms for the same push
 * with no hook (test/helpers/git-hooks.ts carries the table). It does not
 * cache across processes, and under the blocking pass's concurrent workers the
 * assessments queue against each other — which is why these tests measure
 * ~1.5-1.8s alone and 10-13.4s inside the full suite.
 *
 * The cheap form is a SYMLINK to a system binary (54ms flat, `armRejectingHook`),
 * and every always-fail hook in this file already uses it. The six below cannot:
 * each needs a real PREDICATE — let the claim's push to main through, reject
 * only `refs/heads/feat/*`; or fail commits only inside a worktree, only while
 * a flag file exists. A symlink cannot express that, and rewriting the
 * scenarios to arm/disarm one mid-run would change what they test.
 *
 * The amplification is the whole reason this is not just "make it fast": the
 * split-failure case (the pre-receive hook, on the bare ORIGIN, so the cost is
 * paid by `git-receive-pack`) measures 1.5s alone and 48.2s / 48.4s in two
 * consecutive full blocking passes — 32x, in line with the 36x debug-5e1a77 iteration 2 measured
 * on devx-claim's hook test. Isolation numbers systematically understate these
 * tests; the ~1.71x uniform slowdown `scripts/timeout-headroom.mjs` assumes
 * does not apply to them.
 *
 * 120s against a worst measured 48.2s is ~2.5x headroom. Unlike every cap that
 * came before it in this file, this one can actually FIRE — driver.ts runs the
 * async seam since debug-5e1a77, proven by negative control in
 * test/loop-driver-timeout-enforcement.test.ts — so a real hang here is a red
 * build, not a slow green. That is what makes a measured number legitimate
 * here and illegitimate in a file that still blocks.
 */
const HOOK_TEST_TIMEOUT_MS = 120_000;


// ---------------------------------------------------------------------------
// parseUntil + pickNextItem units
// ---------------------------------------------------------------------------

describe("parseUntil", () => {
  const now = new Date("2026-07-05T22:00:00");
  it("today when still ahead, tomorrow when passed", () => {
    expect(parseUntil("23:30", now)?.getDate()).toBe(now.getDate());
    const tomorrow = parseUntil("07:30", now)!;
    expect(tomorrow.getTime()).toBeGreaterThan(now.getTime());
    expect(tomorrow.getHours()).toBe(7);
  });
  it("rejects garbage", () => {
    for (const bad of ["7:99", "25:00", "bedtime", "07:30:00", ""]) {
      expect(parseUntil(bad, now)).toBeNull();
    }
  });
});

describe("pickNextItem", () => {
  it("debug rows outrank dev rows; --only and exclusions respected; blocked_by honored", () => {
    fixture = makeFixture([
      { hash: "dev001" },
      { hash: "dev002", blockedBy: ["dev001"] },
      { hash: "dbg001", type: "debug" },
    ]);
    const opts = { excluded: new Set<string>(), model: "m", now: () => new Date() };
    expect(pickNextItem(fixture.repoRoot, opts)?.hash).toBe("dbg001");
    expect(pickNextItem(fixture.repoRoot, { ...opts, only: "dev" })?.hash).toBe("dev001");
    expect(
      pickNextItem(fixture.repoRoot, { ...opts, excluded: new Set(["dbg001", "dev001"]) })?.hash,
    ).toBeUndefined();
    // dev002 is blocked by dev001 (not done) — masking dev001 must NOT
    // unblock dev002.
  });
});

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

describe("runLoop scenarios", () => {
  it("LOCKDOWN refuses entirely (D-6): exit 3, no lock, no state, no claim", async () => {
    fixture = makeFixture([{ hash: "aaa111" }]);
    const { worker } = scriptedWorker([]);
    const r = await runLoop(
      baseOpts(fixture, { merged: { ...MERGED, mode: "LOCKDOWN" }, worker }),
    );
    expect(r.exitCode).toBe(3);
    expect(r.refusedReason).toMatch(/LOCKDOWN/);
    expect(existsSync(join(fixture.cacheDir, "locks", "manager.lock"))).toBe(false);
    expect(noInstancesWritten(fixture.cacheDir)).toBe(true);
    expect(readFileSync(join(fixture.repoRoot, "DEV.md"), "utf8")).toContain("- [ ] `dev/dev-aaa111");
  });

  it("--dry-run prints the full plan without claiming or writing state", async () => {
    fixture = makeFixture([{ hash: "aaa111" }, { hash: "bbb222" }]);
    const lines: string[] = [];
    const r = await runLoop(
      baseOpts(fixture, {
        flags: { dryRun: true },
        out: (l) => lines.push(l),
      }),
    );
    expect(r.exitCode).toBe(0);
    expect(r.plan?.items.map((i) => i.hash)).toEqual(["aaa111", "bbb222"]);
    expect(r.plan?.mode).toBe("YOLO");
    expect(r.plan?.budgets.maxItems).toBe(10);
    expect(lines.join("\n")).toContain("would claim, in order:");
    expect(noInstancesWritten(fixture.cacheDir)).toBe(true);
    expect(existsSync(join(fixture.cacheDir, "locks", "manager.lock"))).toBe(false);
    expect(readFileSync(join(fixture.repoRoot, "DEV.md"), "utf8")).toContain("- [ ] `dev/dev-aaa111");
  });

  it("bad flags exit 4 before any side effect", async () => {
    fixture = makeFixture([{ hash: "aaa111" }]);
    for (const flags of [
      { until: "bedtime" },
      { maxItems: 0 },
      { maxTokens: -5 },
      { only: "plan" },
    ]) {
      const r = await runLoop(baseOpts(fixture, { flags }));
      expect(r.exitCode).toBe(4);
    }
    expect(noInstancesWritten(fixture.cacheDir)).toBe(true);
  });

  it("happy path: success + acs_met → push → tail(merged) → full reconcile", async () => {
    fixture = makeFixture([{ hash: "aaa111", title: "Ship the widget" }]);
    const { worker, prompts } = scriptedWorker([
      {
        kind: "report",
        files: { "widget.txt": "widget v1\n" },
        report: {
          summary: "built the widget",
          key_changes_made: ["widget.txt created"],
          key_learnings: ["widgets are easy"],
          acs_met: true,
        },
      },
    ]);
    const { tail, calls } = mergedTail();
    const r = await runLoop(baseOpts(fixture, { worker, tail }));

    expect(r.exitCode).toBe(0);
    expect(r.summary?.items).toHaveLength(1);
    const item = r.summary!.items[0];
    expect(item.outcome).toBe("merged");
    expect(item.prUrl).toBe("https://github.com/x/y/pull/99");
    expect(item.iterationsGood).toBe(1);
    expect(calls).toHaveLength(1);

    // Prompt carried the contract.
    expect(prompts[0]).toContain("iteration 1 of at most 4 on spec `aaa111`");

    // Branch pushed to origin BEFORE the tail ran.
    const remoteRefs = execFileSync(GIT, ["ls-remote", "--heads", fixture.origin], {
      encoding: "utf8",
    });
    expect(remoteRefs).toContain("refs/heads/feat/dev-aaa111");

    // Reconcile: DEV.md [x] + PR link, spec done + status-log line, lock
    // released, worktree removed.
    const devMd = readFileSync(join(fixture.repoRoot, "DEV.md"), "utf8");
    expect(devMd).toMatch(/- \[x\] `dev\/dev-aaa111.*Status: done.*PR: https:\/\/github\.com\/x\/y\/pull\/99/);
    const spec = readFileSync(join(fixture.repoRoot, fixture.specRel({ hash: "aaa111" })), "utf8");
    expect(spec).toContain("status: done");
    expect(spec).toContain("merged via devx loop — PR https://github.com/x/y/pull/99");
    // cf65aa + debug-3b9e07: the loop appends the dvx103 `phase 4:` line
    // (workers are barred from the Status log), before the merged line, in
    // the exact shape test/devx-status-log-discipline.test.ts detects. No
    // iteration reported review evidence, so the line must be the honest
    // explicit-zero form — never a claimed review that didn't run (AC 2).
    expect(spec).toMatch(/^- .*\bphase 4: NO adversarial-review pass was reported/m);
    expect(spec.indexOf("phase 4:")).toBeLessThan(
      spec.indexOf("merged via devx loop"),
    );
    expect(existsSync(join(fixture.cacheDir, "locks", "spec-aaa111.lock"))).toBe(false);
    expect(existsSync(join(fixture.repoRoot, ".worktrees", "dev-aaa111"))).toBe(false);
    expect(existsSync(join(fixture.cacheDir, "locks", "manager.lock"))).toBe(false);

    // Report written to both locations; the run's instance is stopped and
    // its per-run lock is gone (the capacity slot is free immediately).
    expect(r.reportPath).not.toBeNull();
    expect(readFileSync(r.reportPath!, "utf8")).toContain("1 merged");
    expect(instanceStatus(fixture.cacheDir, r.summary!.runId)).toBe("stopped");
    expect(
      existsSync(join(fixture.cacheDir, "locks", `loop-${r.summary!.runId}.lock`)),
    ).toBe(false);

    // JSONL log has the lifecycle spine.
    const events = readEvents(fixture.cacheDir, r.summary!.runId).map((e) => e.event);
    for (const expected of ["loop:start", "item:claimed", "iteration:start", "iteration:end", "item:pushed", "item:tail", "loop:end"]) {
      expect(events).toContain(expected);
    }
  });

  it("merge tail does not duplicate an existing phase-4 line (cf65aa)", async () => {
    fixture = makeFixture([{ hash: "ccc333" }]);
    // Simulate a spec that already carries the line (e.g. appended manually
    // or by a prior partial run) before the loop merges it.
    const specAbs = join(fixture.repoRoot, fixture.specRel({ hash: "ccc333" }));
    writeFileSync(
      specAbs,
      readFileSync(specAbs, "utf8").replace(
        "- 2026-07-05T13:00 — created.",
        "- 2026-07-05T13:00 — created.\n- 2026-07-05T14:00 — phase 4: self-review found nothing actionable",
      ),
      "utf8",
    );
    g(fixture.repoRoot, "add", "-A");
    g(fixture.repoRoot, "commit", "-q", "-m", "pre-existing phase 4 line");
    g(fixture.repoRoot, "push", "-q", "origin", "main");

    const { worker } = scriptedWorker([
      { kind: "report", files: { "w.txt": "w\n" }, report: { acs_met: true } },
    ]);
    const r = await runLoop(baseOpts(fixture, { worker, tail: mergedTail().tail }));
    expect(r.summary?.items[0]?.outcome).toBe("merged");
    const spec = readFileSync(specAbs, "utf8");
    expect(spec.match(/^- .*\bphase 4:/gm)).toHaveLength(1);
    expect(spec).not.toContain("line composed by the loop merge tail");
  });

  it("review evidence composes the canonical `phase 4:` line, lands BRANCH-SIDE before the PR, and satisfies the dvx103 discipline check (debug-3b9e07 AC 1/AC 3)", async () => {
    fixture = makeFixture([{ hash: "rev111" }]);
    const { worker } = scriptedWorker([
      {
        kind: "report",
        files: { "a.txt": "a\n" },
        report: {
          summary: "step 1",
          key_changes_made: ["a.txt"],
          review: { findings: 3, fixed: 3, shape: "sequential multi-lens", summary: "fixed the frobnicator aliasing bug" },
        },
      },
      {
        kind: "report",
        files: { "b.txt": "b\n" },
        report: {
          summary: "step 2",
          key_changes_made: ["b.txt"],
          acs_met: true,
          review: { findings: 1, fixed: 1, summary: "fixed the final off-by-one" },
        },
      },
    ]);
    const r = await runLoop(baseOpts(fixture, { worker, tail: mergedTail().tail }));
    expect(r.summary?.items[0]?.outcome).toBe("merged");

    // The line rode the FEATURE BRANCH into the push that precedes the PR —
    // the rtl104/rtl106 hole: a handed-off or orphaned PR merged by a human
    // must already carry the audit line (finalizeMerged never runs there).
    const specRel = fixture.specRel({ hash: "rev111" });
    const branchSpec = g(fixture.origin, "show", `feat/dev-rev111:${specRel}`);
    expect(branchSpec).toMatch(/^- .*\bphase 4: sequential multi-lens review \(2 review passes across loop iterations\); 4 findings; ALL fixed in-place — fixed the final off-by-one/m);

    // The reconciled main spec carries it too, and satisfies the EXACT
    // section-bounded detection test/devx-status-log-discipline.test.ts
    // runs (its parseSpec regexes — kept in lockstep by hasPhase4StatusLine,
    // pinned in test/loop-spec-io.test.ts), on a spec that reached ship
    // stage (`status: done`), so the two contracts verify each other.
    const spec = readFileSync(join(fixture.repoRoot, specRel), "utf8");
    expect(spec).toContain("status: done");
    const statusLogBody =
      spec.match(/^## Status log\s*\n([\s\S]*?)(?=\n## |$(?![\r\n]))/m)?.[1] ?? "";
    expect(/^- .*\bphase 4:/m.test(statusLogBody)).toBe(true);
    // Exactly one line — the merge-tail fallback must not duplicate the
    // branch-side append. (The scripted tail never really merges the branch
    // into origin/main, so main's copy comes from the fallback here; the
    // count is over the whole spec either way.)
    expect(spec.match(/^- .*\bphase 4:/gm)).toHaveLength(1);
  });

  it("malformed review evidence is dropped with a WARN; a handed-off tail still gets the explicit-zero line branch-side (debug-3b9e07 AC 2)", async () => {
    fixture = makeFixture([{ hash: "rev222" }]);
    const { worker } = scriptedWorker([
      {
        kind: "report",
        files: { "c.txt": "c\n" },
        report: { summary: "did it", key_changes_made: ["c.txt"], acs_met: true, review: { findings: "many" } },
      },
    ]);
    const tail: TailFn = async () => ({
      outcome: "handed-off",
      kind: "handed-off-ok",
      prUrl: "https://github.com/x/y/pull/13",
      prNumber: 13,
      detail: "remote CI concluded 'failure' — not merging",
    });
    const lines: string[] = [];
    const r = await runLoop(baseOpts(fixture, { worker, tail, out: (l) => lines.push(l) }));
    const item = r.summary!.items[0];
    expect(item.outcome).toBe("handed-off");
    expect(lines.join("\n")).toContain("malformed review evidence");
    const events = readEvents(fixture.cacheDir, r.summary!.runId).map((e) => e.event);
    expect(events).toContain("iteration:review-evidence-invalid");

    // Stripped evidence must not fabricate a review: the branch-side line is
    // the explicit-zero form, present on the pushed branch even though the
    // tail handed off and finalizeMerged never ran.
    const specRel = fixture.specRel({ hash: "rev222" });
    const branchSpec = g(fixture.origin, "show", `feat/dev-rev222:${specRel}`);
    expect(branchSpec).toMatch(/^- .*\bphase 4: NO adversarial-review pass was reported/m);
    expect(branchSpec.match(/^- .*\bphase 4:/gm)).toHaveLength(1);
    // Main's copy stays untouched — the item is still in flight.
    const mainSpec = readFileSync(join(fixture.repoRoot, specRel), "utf8");
    expect(mainSpec).not.toContain("phase 4:");
  });

  it("3 consecutive reported failures after REAL work abandon the item: [-] blocked, lock released, worktree PRESERVED", async () => {
    fixture = makeFixture([{ hash: "bbb222", title: "Doomed thing" }]);
    // One good committed iteration first — a worktree with real work is
    // preserved on abandon (a bookkeeping-only one is discarded; dc7514
    // hygiene has its own scenarios below).
    const { worker } = scriptedWorker([
      { kind: "report", files: { "real.txt": "real\n" }, report: { summary: "step 1", key_changes_made: ["real.txt"] } },
      { kind: "report", files: { "junk.txt": "x" }, report: { success: false, summary: "try 1 failed", key_learnings: ["it is hard"] } },
      { kind: "report", report: { success: false, summary: "try 2 failed" } },
      { kind: "report", report: { success: false, summary: "try 3 failed" } },
    ]);
    const merged = { ...MERGED, loop: { ...MERGED.loop, max_iterations_per_item: 8 } };
    const r = await runLoop(baseOpts(fixture, { merged, worker, tail: mergedTail().tail }));

    expect(r.exitCode).toBe(0); // one abandoned item is a stop, not an abort
    const item = r.summary!.items[0];
    expect(item.outcome).toBe("abandoned");
    expect(item.iterationsFailed).toBe(3);
    expect(item.worktreePath).toBe(".worktrees/dev-bbb222");
    expect(item.lastFailure).toContain("try 3 failed");

    // Backlog + spec flipped to blocked; lock released.
    expect(readFileSync(join(fixture.repoRoot, "DEV.md"), "utf8")).toMatch(/- \[-\] `dev\/dev-bbb222/);
    const spec = readFileSync(join(fixture.repoRoot, fixture.specRel({ hash: "bbb222" })), "utf8");
    expect(spec).toContain("status: blocked");
    expect(spec).toMatch(/\[FAIL\] loop abandoned bbb222/);
    expect(existsSync(join(fixture.cacheDir, "locks", "spec-bbb222.lock"))).toBe(false);

    // Worktree preserved, tree CLEAN (junk was reset), with the on-branch
    // [FAIL] history committed.
    const wt = join(fixture.repoRoot, ".worktrees", "dev-bbb222");
    expect(existsSync(wt)).toBe(true);
    expect(existsSync(join(wt, "real.txt"))).toBe(true);
    expect(existsSync(join(wt, "junk.txt"))).toBe(false);
    expect(g(wt, "status", "--porcelain")).toBe("");
    const wtSpec = readFileSync(join(wt, fixture.specRel({ hash: "bbb222" })), "utf8");
    expect(wtSpec).toContain("[FAIL] loop iteration 2: try 1 failed");
    expect(wtSpec).toContain("Learning: it is hard");
    expect(wtSpec).toContain("[FAIL] loop iteration 4: try 3 failed");

    // The abandon landed as a commit on main AND was pushed to origin
    // (LOW-11: no loop-owned main commit may be left unpushed silently).
    expect(g(fixture.repoRoot, "log", "-1", "--format=%s")).toContain("abandon bbb222");
    expect(
      execFileSync(GIT, ["--git-dir", fixture.origin, "log", "-1", "--format=%s"], {
        encoding: "utf8",
      }),
    ).toContain("abandon bbb222");
  });

  it("worker-death errors ride the backoff ladder; permanent errors abort the loop NOW", async () => {
    fixture = makeFixture([{ hash: "ccc333" }, { hash: "ddd444" }]);
    const { worker } = scriptedWorker([
      // A thrown worker call is a report-less death → infra-error (dc7514);
      // still rides backoff[0] before the next attempt.
      { kind: "throw", message: "TypeError: fetch failed" },
      { kind: "throw", message: "credit balance is too low" }, // permanent → abort
    ]);
    const { sleep, slept } = instantSleep();
    const r = await runLoop(baseOpts(fixture, { worker, sleep, tail: mergedTail().tail }));

    expect(r.exitCode).toBe(2);
    expect(r.summary?.abortReason).toMatch(/permanent error/i);
    expect(slept).toContain(1); // backoff_ms[0] from MERGED.loop
    // Only the first item was touched; the loop never claimed ddd444.
    expect(r.summary?.items.map((i) => i.hash)).toEqual(["ccc333"]);
    expect(instanceStatus(fixture.cacheDir, r.summary!.runId)).toBe("aborted");
    // Report still written (ALWAYS-on-exit).
    expect(readFileSync(r.reportPath!, "utf8")).toContain("ABORTED");
    // The item's claim + worktree are preserved for the morning.
    expect(existsSync(join(fixture.repoRoot, ".worktrees", "dev-ccc333"))).toBe(true);
  });

  it("no-op success (no files, no learnings) is a failure — three of them abandon (nothing preserved → left ready)", async () => {
    fixture = makeFixture([{ hash: "eee555" }]);
    const { worker } = scriptedWorker([
      { kind: "report", report: { success: true, summary: "totally did it", key_learnings: [] } },
    ]);
    const r = await runLoop(baseOpts(fixture, { worker, tail: mergedTail().tail }));
    const item = r.summary!.items[0];
    expect(item.outcome).toBe("abandoned");
    expect(item.iterationsFailed).toBe(3);
    expect(item.lastFailure).toContain("no-op iteration");
    // dc7514 hygiene: the worktree held only bookkeeping — discarded, item
    // left ready with the failure on the main spec's status log.
    expect(existsSync(join(fixture.repoRoot, ".worktrees", "dev-eee555"))).toBe(false);
    const spec = readFileSync(join(fixture.repoRoot, fixture.specRel({ hash: "eee555" })), "utf8");
    expect(spec).toContain("status: ready");
    expect(spec).toMatch(/\[FAIL\] loop abandoned eee555/);
  });

  it("report retry protocol: garbage first output, valid JSON on the retry ask", async () => {
    fixture = makeFixture([{ hash: "fff666" }]);
    const { worker, prompts } = scriptedWorker([
      { kind: "raw", raw: "I did great work but forgot the JSON", files: { "w.txt": "w" } },
      {
        kind: "report",
        report: { summary: "recovered report", key_changes_made: ["w.txt"], acs_met: true },
      },
    ]);
    const { tail } = mergedTail();
    const r = await runLoop(baseOpts(fixture, { worker, tail }));
    expect(r.summary!.items[0].outcome).toBe("merged");
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("Do NOT do any new work");
    expect(prompts[1]).toContain("no JSON object found");
  });

  it("iteration budget exhaustion with real progress SPLITS with the budget reason (mss103 — was abandon pre-split-rail)", async () => {
    fixture = makeFixture([{ hash: "ggg777" }]);
    // Never acs_met, always success — burns the 4-iteration budget.
    const { worker } = scriptedWorker([
      { kind: "report", files: { "inc.txt": "1" }, report: { summary: "inch forward", key_changes_made: ["inc"] } },
      { kind: "report", files: { "inc2.txt": "2" }, report: { summary: "inch forward", key_changes_made: ["inc"] } },
      { kind: "report", files: { "inc3.txt": "3" }, report: { summary: "inch forward", key_changes_made: ["inc"] } },
      { kind: "report", files: { "inc4.txt": "4" }, report: { summary: "inch forward", key_changes_made: ["inc"] } },
    ]);
    // maxItems 1 — the follow-up row is an ordinary ready row and would
    // otherwise be claimed and split again on the next pass.
    const r = await runLoop(
      baseOpts(fixture, { worker, tail: mergedTail().tail, flags: { maxItems: 1 } }),
    );
    const item = r.summary!.items[0];
    // mss103: four committed good iterations are exactly the "real
    // progress" the budget rail now hands to a follow-up instead of
    // parking behind a forensics chore. The RAIL and its reason string are
    // unchanged — only the terminal shape is.
    expect(item.outcome).toBe("split");
    expect(item.detail).toMatch(/iteration budget exhausted \(4 iterations/);
    expect(item.iterationsGood).toBe(4);
    // The work now lives on the PUSHED branch (the worktree is released so
    // the follow-up's claim can attach to it), not in a parked worktree.
    const wt = join(fixture.repoRoot, ".worktrees", "dev-ggg777");
    expect(existsSync(wt)).toBe(false);
    expect(
      execFileSync(
        "git",
        ["--git-dir", fixture.origin, "ls-tree", "-r", "--name-only", "feat/dev-ggg777"],
        { encoding: "utf8" },
      ),
    ).toContain("inc4.txt");
  });

  it("--max-items overrides downward only and stops pre-claim", async () => {
    fixture = makeFixture([{ hash: "hhh888" }, { hash: "iii999" }]);
    const { worker } = scriptedWorker([
      { kind: "report", files: { "a.txt": "a" }, report: { summary: "done", acs_met: true, key_changes_made: ["a"] } },
    ]);
    const r = await runLoop(
      baseOpts(fixture, { worker, tail: mergedTail().tail, flags: { maxItems: 1 } }),
    );
    expect(r.summary?.items).toHaveLength(1);
    expect(r.summary?.stopReason).toMatch(/max items reached \(1\)/);
    // Second item untouched.
    expect(readFileSync(join(fixture.repoRoot, "DEV.md"), "utf8")).toContain("- [ ] `dev/dev-iii999");
    // Downward-only: a flag larger than config clamps to config.
    const r2 = await runLoop(baseOpts(fixture, { flags: { dryRun: true, maxItems: 99 } }));
    expect(r2.plan?.budgets.maxItems).toBe(10);
  });

  it("--until stops the loop mid-run, preserving the in-flight item's claim + worktree", async () => {
    fixture = makeFixture([{ hash: "jjj000" }]);
    // Clock: claim + iteration 1 happen at 22:00; the worker flips the clock
    // past the deadline, so the NEXT pre-iteration check exits mid-item.
    let late = false;
    const clock = (): Date =>
      late ? new Date("2026-07-06T07:31:00") : new Date("2026-07-05T22:00:00");
    const { worker } = scriptedWorker([
      { kind: "report", files: { "w.txt": "w" }, report: { summary: "step 1", key_changes_made: ["w"] } },
    ]);
    const flippingWorker: WorkerRunFn = async (prompt, opts) => {
      const r = await worker(prompt, opts);
      late = true;
      return r;
    };
    const r = await runLoop(
      baseOpts(fixture, { worker: flippingWorker, tail: mergedTail().tail, now: clock, flags: { until: "07:30" } }),
    );
    const item = r.summary!.items[0];
    expect(item.outcome).toBe("in-progress-at-exit");
    expect(r.exitCode).toBe(0);
    // Claim + lock + worktree stay for the morning.
    expect(existsSync(join(fixture.cacheDir, "locks", "spec-jjj000.lock"))).toBe(true);
    expect(existsSync(join(fixture.repoRoot, ".worktrees", "dev-jjj000"))).toBe(true);
    expect(readFileSync(join(fixture.repoRoot, "DEV.md"), "utf8")).toMatch(/- \[\/\] `dev\/dev-jjj000/);
    const report = readFileSync(r.reportPath!, "utf8");
    expect(report).toContain("in progress at loop exit");
    // LOW-11: the exit entry is COMMITTED on main (not left as dirt) and
    // pushed to origin.
    expect(g(fixture.repoRoot, "log", "-1", "--format=%s")).toContain(
      "jjj000 in progress at loop exit",
    );
    expect(g(fixture.repoRoot, "status", "--porcelain")).toBe("");
    expect(
      execFileSync(GIT, ["--git-dir", fixture.origin, "log", "-1", "--format=%s"], {
        encoding: "utf8",
      }),
    ).toContain("jjj000 in progress at loop exit");
  });

  it("push failure at acs_met = abort-item-after-preserving (abandon, commits intact)", async () => {
    fixture = makeFixture([{ hash: "kkk111" }]);
    // A pre-push hook that rejects feature branches but lets the claim's
    // main push through.
    const hooksDir = join(fixture.base, "hooks");
    // NB: a HEAD push reports local_ref as literal "HEAD" — match on the
    // resolved remote_ref instead.
    writeHookScript(
      hooksDir,
      "pre-push",
      `#!/bin/sh\nwhile read local_ref local_sha remote_ref remote_sha; do\n  case "$remote_ref" in refs/heads/feat/*) echo "feature pushes rejected" >&2; exit 1;; esac\ndone\nexit 0\n`,
    );
    g(fixture.repoRoot, "config", "core.hooksPath", hooksDir);

    const { worker } = scriptedWorker([
      { kind: "report", files: { "k.txt": "k" }, report: { summary: "did it", acs_met: true, key_changes_made: ["k"] } },
    ]);
    const tailCalls: number[] = [];
    const tail: TailFn = async () => {
      tailCalls.push(1);
      return { outcome: "merged", prUrl: "x", prNumber: 1 };
    };
    const r = await runLoop(baseOpts(fixture, { worker, tail }));
    const item = r.summary!.items[0];
    expect(item.outcome).toBe("abandoned");
    expect(item.detail).toMatch(/push failed \(commit preserved locally\)/);
    expect(tailCalls).toHaveLength(0); // tail never ran
    // The commit is preserved in the worktree.
    const wt = join(fixture.repoRoot, ".worktrees", "dev-kkk111");
    expect(existsSync(join(wt, "k.txt"))).toBe(true);
    expect(g(wt, "status", "--porcelain")).toBe("");
  }, HOOK_TEST_TIMEOUT_MS);

  it("handed-off items keep claim + worktree and surface the tail detail", async () => {
    fixture = makeFixture([{ hash: "lll222" }]);
    const { worker } = scriptedWorker([
      { kind: "report", files: { "l.txt": "l" }, report: { summary: "done", acs_met: true, key_changes_made: ["l"] } },
    ]);
    const tail: TailFn = async () => ({
      outcome: "handed-off",
      kind: "handed-off-ok",
      prUrl: "https://github.com/x/y/pull/12",
      prNumber: 12,
      detail: "remote CI concluded 'failure' — not merging",
    });
    const r = await runLoop(baseOpts(fixture, { worker, tail }));
    const item = r.summary!.items[0];
    expect(item.outcome).toBe("handed-off");
    expect(item.detail).toContain("not merging");
    expect(existsSync(join(fixture.repoRoot, ".worktrees", "dev-lll222"))).toBe(true);
    expect(readFileSync(r.reportPath!, "utf8")).toContain("NOT merged");
  });

  // mlc105 inverted this test. It used to assert that a held `manager.lock`
  // refused the loop — the singleton posture race R6 is about. The loop no
  // longer takes that lock at all (it is the manage DAEMON's singleton now),
  // so the invariant worth pinning is the OPPOSITE one, plus the admission
  // gate that replaced it.
  it("a held manager.lock does NOT refuse a loop any more (mlc105)", async () => {
    fixture = makeFixture([{ hash: "mmm333" }]);
    const { acquireManagerLock } = await import("../src/lib/manage/lock.js");
    const held = acquireManagerLock(fixture.cacheDir);
    try {
      // --only debug ⇒ nothing to pick, so the run reaches its stop reason
      // without spawning a worker; all we're proving is that it STARTED.
      const r = await runLoop(baseOpts(fixture, { flags: { only: "debug" } }));
      expect(r.exitCode).toBe(0);
      expect(r.summary?.stopReason).toMatch(/no eligible backlog items/);
      expect(instanceStatus(fixture.cacheDir, r.summary!.runId)).toBe("stopped");
    } finally {
      held.release();
    }
  });

  it("admission refuses past capacity.max_concurrent → exit 1 naming knob, count, run-ids", async () => {
    fixture = makeFixture([{ hash: "mmm444" }]);
    // One live peer + a cap of 1 ⇒ this run must not start. The peer's pid
    // is ours, so it classifies live without any probe stubbing.
    mkdirSync(instancesDir(fixture.cacheDir), { recursive: true });
    writeFileSync(
      join(instancesDir(fixture.cacheDir), "loop-peer.json"),
      JSON.stringify({
        schema: 1,
        run_id: "loop-peer",
        pid: process.pid,
        pid_started_at: null,
        started_at: new Date().toISOString(),
        scope: null,
        status: "running",
        current_item: null,
        iteration: 0,
        ts: new Date().toISOString(),
      }),
      "utf8",
    );
    const r = await runLoop(
      baseOpts(fixture, { merged: { ...MERGED, capacity: { max_concurrent: 1 } } }),
    );
    expect(r.exitCode).toBe(1);
    expect(r.refusedReason).toMatch(/capacity\.max_concurrent is 1/);
    expect(r.refusedReason).toMatch(/loop-peer/);
    // Refused ⇒ nothing of ours was registered and the item is untouched.
    expect(listInstances(fixture.cacheDir).map((i) => i.run_id)).toEqual(["loop-peer"]);
    expect(readFileSync(join(fixture.repoRoot, "DEV.md"), "utf8")).toContain(
      "- [ ] `dev/dev-mmm444",
    );
  });

  it("abort signal stops cleanly: report written, lock released, state stopped", async () => {
    fixture = makeFixture([{ hash: "nnn444" }, { hash: "ooo555" }]);
    const ac = new AbortController();
    const { worker } = scriptedWorker([
      { kind: "report", files: { "n.txt": "n" }, report: { summary: "step", key_changes_made: ["n"] } },
    ]);
    // Abort after the first worker call returns.
    const abortingWorker: WorkerRunFn = async (prompt, opts) => {
      const r = await worker(prompt, opts);
      ac.abort();
      return r;
    };
    const r = await runLoop(
      baseOpts(fixture, { worker: abortingWorker, tail: mergedTail().tail, signal: ac.signal }),
    );
    expect(r.exitCode).toBe(0);
    expect(r.summary?.stopReason).toMatch(/signal/);
    expect(r.reportPath).not.toBeNull();
    expect(instanceStatus(fixture.cacheDir, r.summary!.runId)).toBe("stopped");
    expect(existsSync(join(fixture.cacheDir, "locks", "manager.lock"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Review-fix regression scenarios (BH/EC/AA findings)
// ---------------------------------------------------------------------------

describe("runLoop review-fix scenarios", () => {
  it("permanent-error marker in the output TAIL + failed retry aborts the loop (BH/EC-HIGH, reshaped by MED-3)", async () => {
    fixture = makeFixture([{ hash: "ppp111" }, { hash: "qqq222" }]);
    const { worker, prompts } = scriptedWorker([
      { kind: "raw", raw: "API Error: Your credit balance is too low to access the Anthropic API.\n" },
    ]);
    const r = await runLoop(baseOpts(fixture, { worker, tail: mergedTail().tail }));
    expect(r.exitCode).toBe(2);
    expect(r.summary?.abortReason).toMatch(/permanent error/i);
    // MED-3: the report retry ALWAYS runs first (a marker can be the
    // worked-on code); permanent classification lands only after the retry
    // also failed — exactly TWO worker calls, then abort.
    expect(prompts).toHaveLength(2);
    // The second item was never claimed.
    expect(r.summary?.items.map((i) => i.hash)).toEqual(["ppp111"]);
  });

  it("marker mid-transcript with a recoverable report is NORMAL handling, not permanent (MED-3)", async () => {
    fixture = makeFixture([{ hash: "mkr001" }]);
    // Iteration 1: the worker edited marker-bearing code (the marker text
    // appears mid-transcript, >2000 chars from the end) and forgot its
    // JSON; the retry recovers a valid report. Must NOT abort the loop.
    const { worker, prompts } = scriptedWorker([
      {
        kind: "raw",
        raw:
          "updated ladder.ts markers: credit balance is too low added\n" +
          "x".repeat(3000) +
          "\nran tests, all green — oops, forgot the JSON block",
        files: { "m.txt": "m" },
      },
      {
        kind: "report",
        report: { summary: "recovered", key_changes_made: ["m.txt"], acs_met: true },
      },
    ]);
    const r = await runLoop(baseOpts(fixture, { worker, tail: mergedTail().tail }));
    expect(r.exitCode).toBe(0);
    expect(r.summary?.abortReason).toBeNull();
    expect(r.summary!.items[0].outcome).toBe("merged");
    expect(prompts).toHaveLength(2);
  });

  it("3 consecutive abandoned items stop the whole loop (AA-F3): exit 2, 4th item untouched", async () => {
    fixture = makeFixture([
      { hash: "abn001" },
      { hash: "abn002" },
      { hash: "abn003" },
      { hash: "abn004" },
    ]);
    // max_consecutive_failures 1 → every item abandons after one failure.
    const merged = {
      ...MERGED,
      loop: { ...MERGED.loop, max_consecutive_failures: 1 },
    };
    const { worker } = scriptedWorker([
      { kind: "report", report: { success: false, summary: "doomed" } },
    ]);
    const r = await runLoop(baseOpts(fixture, { merged, worker, tail: mergedTail().tail }));
    expect(r.exitCode).toBe(2);
    expect(r.summary?.abortReason).toMatch(/3 consecutive items abandoned or handed off failing/);
    expect(r.summary?.items.map((i) => i.outcome)).toEqual([
      "abandoned",
      "abandoned",
      "abandoned",
    ]);
    // The 4th item stays [ ] ready — the loop stopped before churning it.
    expect(readFileSync(join(fixture.repoRoot, "DEV.md"), "utf8")).toContain(
      "- [ ] `dev/dev-abn004",
    );
  });

  it("per-item token budget exhaustion trips the rail (AA-F4; terminal shape is split since mss103 — the iteration committed real work)", async () => {
    fixture = makeFixture([{ hash: "tok001" }]);
    // Worker reports 150 tokens/iteration; cap at 100 → rail trips before iteration 2.
    const merged = { ...MERGED, loop: { ...MERGED.loop, max_tokens_per_item: 100 } };
    const { worker } = scriptedWorker([
      { kind: "report", files: { "t.txt": "t" }, report: { summary: "step", key_changes_made: ["t"] } },
    ]);
    const r = await runLoop(
      baseOpts(fixture, { merged, worker, tail: mergedTail().tail, flags: { maxItems: 1 } }),
    );
    const item = r.summary!.items[0];
    expect(item.outcome).toBe("split");
    expect(item.detail).toMatch(/per-item token budget exhausted/);
  });

  it("real-scale authoritative figures trip the per-item budget; cache reads are excluded from the counter (debug-494590 AC 4)", async () => {
    fixture = makeFixture([{ hash: "tok494" }]);
    // Authoritative per-iteration usage at honest overnight scale: 24k
    // uncached in + 600k cache-write + 42 out = 624,042 counted tokens
    // (the 1.7M cache READS are rendered but not counted — else the
    // default 2M/item would trip mid-first-iteration on every item).
    // 2M/item ⇒ iteration 4 still runs (3 × 624,042 < 2M) and the trip
    // lands at the pre-check for iteration 5 (4 × 624,042 = 2,496,168).
    const merged = {
      ...MERGED,
      loop: { ...MERGED.loop, max_iterations_per_item: 8, max_tokens_per_item: 2_000_000, max_total_tokens: 100_000_000 },
    };
    let calls = 0;
    const worker: WorkerRunFn = async (_prompt, opts) => {
      calls++;
      writeFileSync(join(opts.cwd, `w${calls}.txt`), "w", "utf8");
      return {
        rawOutput: `did work\n\n\`\`\`json\n${JSON.stringify({ success: true, summary: "s", key_changes_made: ["w"], key_learnings: [], acs_met: false })}\n\`\`\`\n`,
        exitCode: 0,
        graceKilled: false,
        tokens: { input: 24_000, output: 42, cacheCreation: 600_000, cacheRead: 1_700_000, estimated: false },
      };
    };
    const r = await runLoop(
      baseOpts(fixture, { merged, worker, tail: mergedTail().tail, flags: { maxItems: 1 } }),
    );
    const item = r.summary!.items[0];
    // Terminal shape is split since mss103 (four committed good iterations
    // = real progress); the counter math this test exists for is untouched.
    expect(item.outcome).toBe("split");
    expect(item.detail).toMatch(/per-item token budget exhausted/);
    // Cache reads NOT counted: counting them (2,324,042/iteration) would
    // have tripped after iteration 1; the old in+out-only counter
    // (24,042/iteration) would never have tripped inside the 8-iteration
    // cap. calls=4 is the signature of the corrected counter.
    expect(calls).toBe(4);
    // Authoritative accounting rides through untouched — no `~` estimate flag,
    // cache figures preserved for the morning report.
    expect(item.tokens.estimated).toBe(false);
    expect(item.tokens.input).toBe(96_000);
    expect(item.tokens.cacheCreation).toBe(2_400_000);
    expect(item.tokens.cacheRead).toBe(6_800_000);
  });

  it("cache-creation counts toward the TOTAL budget too (debug-494590 AC 4, total rail)", async () => {
    fixture = makeFixture([{ hash: "tok495" }]);
    // Same 624,042 counted tokens/iteration; per-item rail parked out of the
    // way. Total 1.5M ⇒ iteration 3 runs (2 × 624,042 < 1.5M) and the
    // pre-check for iteration 4 trips (3 × 624,042 = 1,872,126). Were
    // cacheCreation NOT counted, 24,042/iteration could never reach 1.5M
    // inside the 8-iteration cap.
    const merged = {
      ...MERGED,
      loop: { ...MERGED.loop, max_iterations_per_item: 8, max_tokens_per_item: 100_000_000, max_total_tokens: 1_500_000 },
    };
    let calls = 0;
    const worker: WorkerRunFn = async (_prompt, opts) => {
      calls++;
      writeFileSync(join(opts.cwd, `w${calls}.txt`), "w", "utf8");
      return {
        rawOutput: `did work\n\n\`\`\`json\n${JSON.stringify({ success: true, summary: "s", key_changes_made: ["w"], key_learnings: [], acs_met: false })}\n\`\`\`\n`,
        exitCode: 0,
        graceKilled: false,
        tokens: { input: 24_000, output: 42, cacheCreation: 600_000, cacheRead: 1_700_000, estimated: false },
      };
    };
    const r = await runLoop(baseOpts(fixture, { merged, worker, tail: mergedTail().tail }));
    expect(calls).toBe(3);
    expect(r.summary!.items[0].outcome).toBe("in-progress-at-exit");
    expect(r.summary!.items[0].detail).toMatch(/total token budget exhausted/);
  });

  it("--max-tokens (total) stops mid-item as in-progress-at-exit + clamps downward only (AA-F4)", async () => {
    fixture = makeFixture([{ hash: "tok002" }]);
    const { worker } = scriptedWorker([
      { kind: "report", files: { "t.txt": "t" }, report: { summary: "step", key_changes_made: ["t"] } },
    ]);
    const r = await runLoop(
      baseOpts(fixture, { worker, tail: mergedTail().tail, flags: { maxTokens: 100 } }),
    );
    expect(r.summary!.items[0].outcome).toBe("in-progress-at-exit");
    expect(r.summary?.stopReason).toMatch(/total token budget exhausted/);
    // Downward-only clamp visible in dry-run.
    const r2 = await runLoop(baseOpts(fixture, { flags: { dryRun: true, maxTokens: 10 ** 12 } }));
    expect(r2.plan?.budgets.maxTotalTokens).toBe(MERGED.loop.max_total_tokens);
  });

  it("commit-failure → ONE repair iteration; a failed repair clears pendingRepair (BH-HIGH-1)", async () => {
    fixture = makeFixture([{ hash: "rep001" }]);
    // pre-commit hook fails only inside worktrees while the flag exists.
    const hooksDir = join(fixture.base, "hooks");
    const flagPath = join(fixture.base, "commit-blocked");
    writeHookScript(
      hooksDir,
      "pre-commit",
      `#!/bin/sh\ncase "$PWD" in *".worktrees/"*) [ -f "${flagPath}" ] && { echo "hook says no" >&2; exit 1; } ;; esac\nexit 0\n`,
    );
    writeFileSync(flagPath, "1", "utf8");
    g(fixture.repoRoot, "config", "core.hooksPath", hooksDir);

    const { worker, prompts } = scriptedWorker([
      // 1: success report + files → loop commit FAILS (hook) → repair pending.
      { kind: "report", files: { "r.txt": "r" }, report: { summary: "wrote r", key_changes_made: ["r"] } },
      // 2: repair iteration reports failure → rollback; pendingRepair must clear.
      { kind: "report", report: { success: false, summary: "could not repair" } },
      // 3: fresh (non-repair) iteration succeeds and finishes the item.
      { kind: "report", files: { "r2.txt": "r2" }, report: { summary: "did it cleanly", key_changes_made: ["r2"], acs_met: true } },
    ]);
    // Unblock commits once the repair iteration runs.
    const unblockingWorker: WorkerRunFn = async (prompt, opts) => {
      const res = await worker(prompt, opts);
      if (prompts.length === 2) rmSync(flagPath, { force: true });
      return res;
    };
    const { tail } = mergedTail();
    const r = await runLoop(baseOpts(fixture, { worker: unblockingWorker, tail }));

    expect(prompts).toHaveLength(3);
    expect(prompts[0]).not.toContain("REPAIR-ONLY");
    expect(prompts[1]).toContain("REPAIR-ONLY ITERATION");
    expect(prompts[1]).toContain("hook says no");
    // BH-HIGH-1: after the failed repair rolled back, iteration 3 must be a
    // NORMAL prompt again — not a stale repair prompt against a clean tree.
    expect(prompts[2]).not.toContain("REPAIR-ONLY");
    expect(r.summary!.items[0].outcome).toBe("merged");
    expect(r.summary!.items[0].iterationsFailed).toBe(2);
  }, HOOK_TEST_TIMEOUT_MS);

  it("repair-iteration failure salvages the preserved work via a commit re-attempt (MED-2)", async () => {
    fixture = makeFixture([{ hash: "sal001" }]);
    // pre-commit hook blocks worktree commits while the flag exists —
    // the "transiently failing" commit seam.
    const hooksDir = join(fixture.base, "hooks");
    const flagPath = join(fixture.base, "commit-blocked");
    writeHookScript(
      hooksDir,
      "pre-commit",
      `#!/bin/sh\ncase "$PWD" in *".worktrees/"*) [ -f "${flagPath}" ] && { echo "hook says no" >&2; exit 1; } ;; esac\nexit 0\n`,
    );
    writeFileSync(flagPath, "1", "utf8");
    g(fixture.repoRoot, "config", "core.hooksPath", hooksDir);

    const { worker, prompts } = scriptedWorker([
      // 1: success + precious files → loop commit FAILS → preserved + repair pending.
      { kind: "report", files: { "precious.txt": "prior work\n" }, report: { summary: "wrote precious", key_changes_made: ["precious"] } },
      // 2: the repair iteration HARD-ERRORS. Pre-MED-2 this reset away the
      //    preserved work; now the loop re-attempts the commit first.
      { kind: "throw", message: "TypeError: boom mid-repair" },
      // 3: reported failure → 3rd consecutive failure → abandon (worktree preserved).
      { kind: "report", report: { success: false, summary: "still stuck" } },
    ]);
    // The transient unblock: the flag clears while iteration 2's worker
    // runs, so the salvage re-attempt after its hard error succeeds.
    const unblocking: WorkerRunFn = async (prompt, opts) => {
      if (prompts.length === 1) rmSync(flagPath, { force: true });
      return worker(prompt, opts);
    };
    const { sleep } = instantSleep();
    const r = await runLoop(baseOpts(fixture, { worker: unblocking, sleep, tail: mergedTail().tail }));

    const item = r.summary!.items[0];
    expect(item.outcome).toBe("abandoned");
    // The prior iteration's work is COMMITTED in the preserved worktree,
    // not discarded.
    const wt = join(fixture.repoRoot, ".worktrees", "dev-sal001");
    expect(readFileSync(join(wt, "precious.txt"), "utf8")).toBe("prior work\n");
    expect(g(wt, "log", "--format=%s")).toContain("salvage work preserved across a commit failure");
    expect(g(wt, "status", "--porcelain")).toBe("");
    // The [ERROR] entry says the salvage happened.
    const wtSpec = readFileSync(join(wt, fixture.specRel({ hash: "sal001" })), "utf8");
    expect(wtSpec).toContain("preserved work committed via salvage re-attempt");
    // Iteration 3 was a NORMAL prompt (pendingRepair cleared by the salvage).
    expect(prompts[2]).not.toContain("REPAIR-ONLY");
    const events = readEvents(fixture.cacheDir, r.summary!.runId).map((e) => e.event);
    expect(events).toContain("iteration:repair-salvage-committed");
  }, HOOK_TEST_TIMEOUT_MS);

  it("salvage re-attempt that ALSO fails resets and records the discarded-diff stat (MED-2)", async () => {
    fixture = makeFixture([{ hash: "sal002" }]);
    const hooksDir = join(fixture.base, "hooks");
    // Commits in worktrees fail unconditionally — the failure is permanent.
    writeHookScript(
      hooksDir,
      "pre-commit",
      `#!/bin/sh\ncase "$PWD" in *".worktrees/"*) echo "hook says no" >&2; exit 1;; esac\nexit 0\n`,
    );
    g(fixture.repoRoot, "config", "core.hooksPath", hooksDir);

    // max_consecutive_failures 2 ⇒ the failing repair iteration is the 2nd
    // failure and abandons — leaving the worktree (and its spec's
    // uncommitted entry) for inspection. (A THROWN worker is an infra-error
    // since dc7514 and never charges the item — a reported failure drives
    // the same MED-2 salvage path.)
    const merged = { ...MERGED, loop: { ...MERGED.loop, max_consecutive_failures: 2 } };
    const { worker } = scriptedWorker([
      { kind: "report", files: { "doomed.txt": "will be discarded\n" }, report: { summary: "wrote doomed", key_changes_made: ["d"] } },
      { kind: "report", report: { success: false, summary: "could not repair the commit" } },
    ]);
    const { sleep } = instantSleep();
    const r = await runLoop(baseOpts(fixture, { merged, worker, sleep, tail: mergedTail().tail }));

    const item = r.summary!.items[0];
    expect(item.outcome).toBe("abandoned");
    const wt = join(fixture.repoRoot, ".worktrees", "dev-sal002");
    // The preserved work WAS discarded (both commit attempts failed)…
    expect(existsSync(join(wt, "doomed.txt"))).toBe(false);
    // …and the [ERROR] entry says exactly what was lost.
    const wtSpec = readFileSync(join(wt, fixture.specRel({ hash: "sal002" })), "utf8");
    expect(wtSpec).toMatch(/salvage re-attempt also failed; discarded preserved work: \d+ tracked files/);
    const events = readEvents(fixture.cacheDir, r.summary!.runId).map((e) => e.event);
    expect(events).toContain("iteration:repair-salvage-failed");
  }, HOOK_TEST_TIMEOUT_MS);

  // Explicit cap, and the number is measured rather than guessed: this
  // scenario drives THREE items through real git fixtures with spawned
  // workers, and clocks 4,373ms on a quiet machine against vitest's 5,000ms
  // default — 14% headroom locally, and negative on a loaded macOS runner
  // (observed 5,519ms, PR #143). It has now failed CI twice on timing alone
  // with no diff touching the driver.
  //
  // This is NOT the `debug-5e1a77` anti-pattern. That rule says do not raise
  // a cap that CANNOT FIRE — a sync-blocking test where a blocked event loop
  // means the timeout never runs at all, so no value is enforcement. Here the
  // cap fires correctly (this file is in the async blocking pass); the cap is
  // simply set below the work. Raising it to a realistic value IS enforcement.
  //
  // `scripts/timeout-headroom.mjs` (debug-5c8b21 AC 3) is the sweep that
  // finds this class; see debug spec `2e1174` for running it across the
  // blocking pass rather than one test at a time.
  it("abandoned items WITH committed progress don't trip the systemic 3-stop (MED-4)", async () => {
    fixture = makeFixture([
      { hash: "big001" },
      { hash: "big002" },
      { hash: "big003" },
      { hash: "big004" },
    ]);
    // Reaches abandon-with-progress via the FAILURE LADDER, not the budget
    // rail: since mss103 a budget-exhausted item with real progress splits
    // instead of abandoning (see the E-3 group), so the ladder path —
    // one good committed iteration, then 3 consecutive reported failures —
    // is where this guarantee still has to hold. Every other abandon
    // caller (rollback failure, push failure, split fallback) reaches the
    // same code.
    const merged = {
      ...MERGED,
      loop: { ...MERGED.loop, max_iterations_per_item: 8, max_consecutive_failures: 3 },
    };
    const seen = new Map<string, number>();
    const worker: WorkerRunFn = async (prompt, opts) => {
      const hash = /on spec `([a-z0-9]+)`/.exec(prompt)?.[1] ?? "unknown";
      const n = (seen.get(hash) ?? 0) + 1;
      seen.set(hash, n);
      if (n === 1) writeFileSync(join(opts.cwd, "inc.txt"), "1", "utf8");
      const report =
        n === 1
          ? { success: true, summary: "inch", key_changes_made: ["inc"], key_learnings: [], acs_met: false }
          : { success: false, summary: `try ${n} failed`, key_changes_made: [], key_learnings: [], acs_met: false };
      return {
        rawOutput: `\`\`\`json\n${JSON.stringify(report)}\n\`\`\``,
        exitCode: 0,
        graceKilled: false,
        tokens: { input: 100, output: 50, cacheCreation: 0, cacheRead: 0, estimated: true },
      };
    };
    const { sleep } = instantSleep();
    const r = await runLoop(baseOpts(fixture, { merged, worker, sleep, tail: mergedTail().tail }));
    // All FOUR items ran (no abort at 3) and the loop stopped normally.
    expect(r.exitCode).toBe(0);
    expect(r.summary?.abortReason).toBeNull();
    expect(r.summary?.items.map((i) => i.outcome)).toEqual([
      "abandoned",
      "abandoned",
      "abandoned",
      "abandoned",
    ]);
    expect(r.summary?.items.every((i) => i.iterationsGood === 1)).toBe(true);
    // Real work preserved → the blocked-with-worktree shape, and NOT the
    // split rail (which would have reset the streak for a different reason
    // and so would not exercise afterItemAbandoned's madeProgress arm).
    expect(r.summary?.items.every((i) => i.leftState === "blocked")).toBe(true);
    const events = readEvents(fixture.cacheDir, r.summary!.runId).map((e) => e.event);
    expect(events).not.toContain("item:split");
  }, 30_000);

  it("3 consecutive handed-off-FAILURE tails trip the systemic stop; the next item is untouched (MED-6)", async () => {
    fixture = makeFixture([
      { hash: "out001" },
      { hash: "out002" },
      { hash: "out003" },
      { hash: "out004" },
    ]);
    const { worker } = scriptedWorker([
      { kind: "report", files: { "o.txt": "o" }, report: { summary: "done", key_changes_made: ["o"], acs_met: true } },
    ]);
    // gh outage shape: every tail fails to create the PR.
    const tail: TailFn = async () => ({
      outcome: "handed-off",
      kind: "handed-off-failure",
      prUrl: null,
      prNumber: null,
      detail: "gh pr create failed (exit 4): connection refused",
    });
    const r = await runLoop(baseOpts(fixture, { worker, tail }));
    expect(r.exitCode).toBe(2);
    expect(r.summary?.abortReason).toMatch(/3 consecutive items abandoned or handed off failing/);
    expect(r.summary?.items.map((i) => i.outcome)).toEqual([
      "handed-off",
      "handed-off",
      "handed-off",
    ]);
    // The 4th item was never claimed — no stranded claims during an outage.
    expect(readFileSync(join(fixture.repoRoot, "DEV.md"), "utf8")).toContain(
      "- [ ] `dev/dev-out004",
    );
  });

  it("a handed-off-OK tail resets the failure-hand-off streak (MED-6)", async () => {
    fixture = makeFixture([
      { hash: "mix001" },
      { hash: "mix002" },
      { hash: "mix003" },
      { hash: "mix004" },
    ]);
    const { worker } = scriptedWorker([
      { kind: "report", files: { "m.txt": "m" }, report: { summary: "done", key_changes_made: ["m"], acs_met: true } },
    ]);
    const kinds: HandOffKind[] = [
      "handed-off-failure",
      "handed-off-failure",
      "handed-off-ok", // CI-red shape — the system worked; resets the rail
      "handed-off-failure",
    ];
    let call = 0;
    const tail: TailFn = async () => ({
      outcome: "handed-off",
      kind: kinds[Math.min(call++, kinds.length - 1)],
      prUrl: null,
      prNumber: null,
      detail: "scripted",
    });
    const r = await runLoop(baseOpts(fixture, { worker, tail }));
    // No systemic abort: fail, fail, ok(reset), fail never reaches 3.
    expect(r.exitCode).toBe(0);
    expect(r.summary?.abortReason).toBeNull();
    expect(r.summary?.items).toHaveLength(4);
  });

  it("3 consecutive claim failures stop the loop instead of walking the backlog (MED-7)", async () => {
    fixture = makeFixture([
      { hash: "clm001" },
      { hash: "clm002" },
      { hash: "clm003" },
      { hash: "clm004" },
      { hash: "clm005" },
    ]);
    const { worker } = scriptedWorker([]);
    const claim = async (): Promise<never> => {
      throw new Error("locks dir unwritable");
    };
    const r = await runLoop(baseOpts(fixture, { worker, claim, tail: mergedTail().tail }));
    expect(r.exitCode).toBe(0);
    expect(r.summary?.stopReason).toMatch(/3 consecutive claim failures/);
    expect(r.summary?.items.map((i) => i.outcome)).toEqual([
      "claim-failed",
      "claim-failed",
      "claim-failed",
    ]);
    // Rows 4+5 untouched — the loop did NOT churn the rest of the backlog.
    const devMd = readFileSync(join(fixture.repoRoot, "DEV.md"), "utf8");
    expect(devMd).toContain("- [ ] `dev/dev-clm004");
    expect(devMd).toContain("- [ ] `dev/dev-clm005");
  });

  it("a successful claim resets the claim-failure counter (MED-7)", async () => {
    fixture = makeFixture([
      { hash: "cnt001" },
      { hash: "cnt002" },
      { hash: "cnt003" },
      { hash: "cnt004" },
    ]);
    const { worker } = scriptedWorker([
      { kind: "report", files: { "c.txt": "c" }, report: { summary: "done", key_changes_made: ["c"], acs_met: true } },
    ]);
    // Fail, fail, succeed (reset), fail, fail — never 3 consecutive.
    const { claimSpec } = await import("../src/lib/devx/claim.js");
    let call = 0;
    const failing = new Set([1, 2, 4, 5]);
    const fx = fixture;
    const claim = async (hash: string, type: string) => {
      call++;
      if (failing.has(call)) throw new Error(`synthetic claim outage ${call}`);
      return claimSpec(hash, {
        sessionId: "cnt-test",
        repoRoot: fx.repoRoot,
        config: MERGED,
        type,
      });
    };
    const r = await runLoop(baseOpts(fixture, { worker, claim, tail: mergedTail().tail }));
    expect(r.summary?.stopReason).not.toMatch(/claim failures/);
    const outcomes = r.summary!.items.map((i) => i.outcome);
    expect(outcomes.filter((o) => o === "claim-failed")).toHaveLength(3);
    expect(outcomes.filter((o) => o === "merged")).toHaveLength(1);
  });

  it("a timed-out worker's estimated tokens still land in the budgets (MED-8)", async () => {
    fixture = makeFixture([{ hash: "tmo001" }]);
    const worker: WorkerRunFn = async () => {
      throw new WorkerTimeoutError("worker session exceeded the 60min awake-time iteration ceiling and was killed", {
        input: 500,
        output: 700,
        cacheCreation: 0,
        cacheRead: 0,
        estimated: true,
      });
    };
    const { sleep } = instantSleep();
    const r = await runLoop(baseOpts(fixture, { worker, sleep, tail: mergedTail().tail }));
    const item = r.summary!.items[0];
    // dc7514: ~zero-output timeouts are infra-errors — 3 of them abort the
    // RUN and release the item (not charged), but the spend still counts.
    expect(item.outcome).toBe("released");
    expect(r.exitCode).toBe(2);
    // 3 iterations × (500 in + 700 out), all accounted.
    expect(item.tokens.input).toBe(1500);
    expect(item.tokens.output).toBe(2100);
    expect(item.tokens.estimated).toBe(true);
    expect(r.summary!.totals.input).toBe(1500);
    expect(r.summary!.totals.output).toBe(2100);
  });

  it("abort before the report retry skips the second spawn (LOW-13)", async () => {
    fixture = makeFixture([{ hash: "abt001" }]);
    const ac = new AbortController();
    const prompts: string[] = [];
    const worker: WorkerRunFn = async (prompt) => {
      prompts.push(prompt);
      ac.abort(); // SIGTERM lands while the worker runs; output has no JSON
      return {
        rawOutput: "some progress but no report",
        exitCode: 0,
        graceKilled: false,
        tokens: { input: 10, output: 10, cacheCreation: 0, cacheRead: 0, estimated: true },
      };
    };
    const r = await runLoop(
      baseOpts(fixture, { worker, tail: mergedTail().tail, signal: ac.signal }),
    );
    // No retry spawn against a draining run.
    expect(prompts).toHaveLength(1);
    expect(r.summary!.items[0].outcome).toBe("in-progress-at-exit");
  });

  it("lock-release failure is evented and WARNed in the morning report (LOW-10)", async () => {
    fixture = makeFixture([{ hash: "lck001" }]);
    const locksDir = join(fixture.cacheDir, "locks");
    const { worker } = scriptedWorker([
      { kind: "report", report: { success: false, summary: "doomed" } },
    ]);
    // Make the locks dir read-only after the LAST iteration so ownsClaim
    // can still read the lock but the abandon's unlink fails.
    let calls = 0;
    const chmodWorker: WorkerRunFn = async (p, o) => {
      const res = await worker(p, o);
      calls++;
      if (calls === 3) chmodSync(locksDir, 0o555);
      return res;
    };
    try {
      const r = await runLoop(baseOpts(fixture, { worker: chmodWorker, tail: mergedTail().tail }));
      const item = r.summary!.items[0];
      expect(item.outcome).toBe("abandoned");
      expect(
        item.warnings?.some((w) => w.includes("spec lock could not be released")),
      ).toBe(true);
      expect(readFileSync(r.reportPath!, "utf8")).toContain(
        "WARN: spec lock could not be released",
      );
      const events = readEvents(fixture.cacheDir, r.summary!.runId).map((e) => e.event);
      expect(events).toContain("item:lock-release-failed");
    } finally {
      chmodSync(locksDir, 0o755);
    }
  });

  it("exitInProgress halts without touching main when claim ownership was lost (LOW-11 / roc101)", async () => {
    fixture = makeFixture([{ hash: "own001" }]);
    const fx = fixture;
    const { worker } = scriptedWorker([
      { kind: "report", files: { "w.txt": "w" }, report: { summary: "step", key_changes_made: ["w"] } },
    ]);
    // A peer "steals" the claim mid-run: the lock file vanishes after
    // iteration 1; the token-budget stop then exits mid-item.
    const stealingWorker: WorkerRunFn = async (prompt, opts) => {
      const res = await worker(prompt, opts);
      rmSync(join(fx.cacheDir, "locks", "spec-own001.lock"), { force: true });
      return res;
    };
    const r = await runLoop(
      baseOpts(fixture, { worker: stealingWorker, tail: mergedTail().tail, flags: { maxTokens: 100 } }),
    );
    const item = r.summary!.items[0];
    expect(item.outcome).toBe("in-progress-at-exit");
    expect(item.detail).toContain("claim ownership lost");
    // Main spec untouched, no loop-owned exit commit on main.
    const spec = readFileSync(join(fx.repoRoot, fx.specRel({ hash: "own001" })), "utf8");
    expect(spec).not.toContain("loop stopped mid-item");
    expect(g(fx.repoRoot, "log", "-1", "--format=%s")).toContain("claim own001");
  });

  it("main-push failure after a loop-owned commit is tolerated with a report WARN (LOW-11)", async () => {
    fixture = makeFixture([{ hash: "psh001" }]);
    // The hooks dir starts EMPTY — the claim's own push (which happens before
    // the worker runs) must succeed. The worker then arms a rejecting hook,
    // so every push after it fails. A symlink to /usr/bin/false instead of a
    // flag-file predicate script: same instant, same effect, ~13s cheaper
    // (see test/helpers/git-hooks.ts).
    const hooksDir = join(fixture.base, "hooks");
    mkdirSync(hooksDir, { recursive: true });
    g(fixture.repoRoot, "config", "core.hooksPath", hooksDir);
    const { worker } = scriptedWorker([
      { kind: "report", report: { success: false, summary: "doomed" } },
    ]);
    const flaggingWorker: WorkerRunFn = async (p, o) => {
      const res = await worker(p, o);
      armRejectingHook(hooksDir, "pre-push");
      return res;
    };
    const r = await runLoop(baseOpts(fixture, { worker: flaggingWorker, tail: mergedTail().tail }));
    const item = r.summary!.items[0];
    expect(item.outcome).toBe("abandoned");
    // The abandon commit landed locally; the push failure became a WARN,
    // not a crash.
    expect(g(fixture.repoRoot, "log", "-1", "--format=%s")).toContain("abandon psh001");
    expect(item.warnings?.some((w) => w.includes("main is ahead of origin"))).toBe(true);
    expect(readFileSync(r.reportPath!, "utf8")).toContain("WARN: main is ahead of origin");
  });

  it("merged items carry real diff stats (BH-MED-6) and don't sweep user-staged work on main (BH-MED-5)", async () => {
    fixture = makeFixture([{ hash: "dif001" }]);
    // The user left something staged in the main worktree overnight.
    writeFileSync(join(fixture.repoRoot, "user-wip.txt"), "half-finished\n", "utf8");
    g(fixture.repoRoot, "add", "user-wip.txt");

    const { worker } = scriptedWorker([
      {
        kind: "report",
        files: { "shipped.txt": "line1\nline2\nline3\n" },
        report: { summary: "shipped", key_changes_made: ["shipped.txt"], acs_met: true },
      },
    ]);
    const r = await runLoop(baseOpts(fixture, { worker, tail: mergedTail().tail }));
    const item = r.summary!.items[0];
    expect(item.outcome).toBe("merged");
    // Diff captured BEFORE the worktree was removed.
    expect(item.diff?.filesChanged).toBeGreaterThan(0);
    expect(item.diff?.linesAdded).toBeGreaterThan(0);
    // The mark-done commit on main did NOT include the user's staged file.
    const lastCommitFiles = g(fixture.repoRoot, "show", "--name-only", "--format=", "HEAD");
    expect(lastCommitFiles).not.toContain("user-wip.txt");
    // ...and the staged work is still staged, untouched.
    expect(g(fixture.repoRoot, "diff", "--cached", "--name-only")).toContain("user-wip.txt");
  });
});

// ---------------------------------------------------------------------------
// Infra-failure classification + abandon hygiene (dc7514 — the 2026-07-24
// hfi103 incident: 3 hung workers killed by the iteration ceiling with ~32
// output tokens each were classed hard-error ×3 → the ITEM was abandoned
// into `blocked` + dead owner + DEV.md prose drift + a bookkeeping-only
// preserved worktree, wedging the whole backlog behind its dependents).
// ---------------------------------------------------------------------------

describe("infra-error classification + abandon hygiene (dc7514)", () => {
  it("3 report-less worker timeouts with ~zero output abort the RUN as environment failure and leave the item ready — the incident repro", async () => {
    fixture = makeFixture([{ hash: "hng001" }, { hash: "hng002" }]);
    // The incident shape: the worker session hung at startup, the ceiling
    // killed it, ~32 tokens of output were ever produced.
    const worker: WorkerRunFn = async () => {
      throw new WorkerTimeoutError(
        "worker session exceeded the 60min iteration ceiling and was killed",
        { input: 500, output: 32, cacheCreation: 0, cacheRead: 0, estimated: true },
      );
    };
    const { sleep } = instantSleep();
    const r = await runLoop(baseOpts(fixture, { worker, sleep, tail: mergedTail().tail }));

    // Abandon-the-RUN, not abandon-the-item: environment failure aborts,
    // and the next item was never attempted (churn stops at the abort).
    expect(r.exitCode).toBe(2);
    expect(r.summary?.abortReason).toMatch(/environment failure/i);
    expect(r.summary!.items).toHaveLength(1);
    const item = r.summary!.items[0];
    expect(item.outcome).not.toBe("abandoned");

    // The item's claimed-state is rolled back to ready — NOT blocked.
    const spec = readFileSync(join(fixture.repoRoot, fixture.specRel({ hash: "hng001" })), "utf8");
    expect(spec).toContain("status: ready");
    expect(spec).not.toContain("status: blocked");
    expect(spec).not.toMatch(/^owner:/m); // dead session must not stay owner
    const devMd = readFileSync(join(fixture.repoRoot, "DEV.md"), "utf8");
    expect(devMd).toMatch(/- \[ \] `dev\/dev-hng001/);
    expect(devMd).toMatch(/dev-hng001[^\n]*Status: ready/); // no checkbox↔prose drift

    // Bookkeeping-only worktree + branch discarded; lock released.
    expect(existsSync(join(fixture.repoRoot, ".worktrees", "dev-hng001"))).toBe(false);
    expect(g(fixture.repoRoot, "branch", "--list", "feat/dev-hng001")).toBe("");
    expect(existsSync(join(fixture.cacheDir, "locks", "spec-hng001.lock"))).toBe(false);

    // The run aborted rather than churning the next item through the same
    // broken environment.
    expect(devMd).toContain("- [ ] `dev/dev-hng002");

    // The morning report says whose fault it was.
    expect(readFileSync(r.reportPath!, "utf8")).toMatch(
      /environment failure — item not at fault/,
    );
  });

  it("infra iterations never exhaust the item's iteration budget into an abandon (review MED)", async () => {
    fixture = makeFixture([{ hash: "bud001" }]);
    // Iteration budget of 2 with 3 report-less deaths: the old accounting
    // would abandon on "iteration budget exhausted" after 2 — charging the
    // item for environment losses. The infra streak must reach 3 and abort
    // the run instead.
    const merged = { ...MERGED, loop: { ...MERGED.loop, max_iterations_per_item: 2 } };
    const worker: WorkerRunFn = async () => {
      throw new WorkerTimeoutError("worker session exceeded the 60min awake-time iteration ceiling and was killed", {
        input: 100,
        output: 10,
        cacheCreation: 0,
        cacheRead: 0,
        estimated: true,
      });
    };
    const { sleep } = instantSleep();
    const r = await runLoop(baseOpts(fixture, { merged, worker, sleep, tail: mergedTail().tail }));
    const item = r.summary!.items[0];
    expect(item.outcome).toBe("released");
    expect(item.detail).not.toMatch(/iteration budget exhausted/);
    expect(r.summary?.abortReason).toMatch(/environment failure/i);
  });

  it("abandon after REAL failures with a bookkeeping-only worktree discards it and leaves the item ready (no forensics needed)", async () => {
    fixture = makeFixture([{ hash: "hyg001" }]);
    // 3 honest reported failures, no committed work — only the loop's own
    // `chore(loop): record iteration` bookkeeping lands on the branch.
    const { worker } = scriptedWorker([
      { kind: "report", report: { success: false, summary: "try 1 failed" } },
      { kind: "report", report: { success: false, summary: "try 2 failed" } },
      { kind: "report", report: { success: false, summary: "try 3 failed" } },
    ]);
    const r = await runLoop(baseOpts(fixture, { worker, tail: mergedTail().tail }));

    expect(r.exitCode).toBe(0);
    const item = r.summary!.items[0];
    expect(item.outcome).toBe("abandoned");
    // Nothing worth preserving → worktree + branch discarded, item ready.
    expect(existsSync(join(fixture.repoRoot, ".worktrees", "dev-hyg001"))).toBe(false);
    expect(g(fixture.repoRoot, "branch", "--list", "feat/dev-hyg001")).toBe("");
    const spec = readFileSync(join(fixture.repoRoot, fixture.specRel({ hash: "hyg001" })), "utf8");
    expect(spec).toContain("status: ready");
    expect(spec).not.toMatch(/^owner:/m);
    // The failure is still recorded — released, not amnesiac.
    expect(spec).toMatch(/\[FAIL\] loop abandoned hyg001/);
    const devMd = readFileSync(join(fixture.repoRoot, "DEV.md"), "utf8");
    expect(devMd).toMatch(/- \[ \] `dev\/dev-hyg001/);
    expect(devMd).toMatch(/dev-hyg001[^\n]*Status: ready/);
  });

  it("abandon with REAL preserved work keeps the blocked flip but reconciles the DEV.md Status prose with the checkbox", async () => {
    fixture = makeFixture([{ hash: "hyg002" }]);
    // One good committed iteration (real work), then 3 reported failures →
    // abandon preserves the worktree; the row must read `[-]` AND
    // `Status: blocked` (the incident left `[-]` + `Status: in-progress`).
    const { worker } = scriptedWorker([
      { kind: "report", files: { "real.txt": "real work\n" }, report: { summary: "step 1", key_changes_made: ["real.txt"] } },
      { kind: "report", report: { success: false, summary: "try 1 failed" } },
      { kind: "report", report: { success: false, summary: "try 2 failed" } },
      { kind: "report", report: { success: false, summary: "try 3 failed" } },
    ]);
    const merged = { ...MERGED, loop: { ...MERGED.loop, max_iterations_per_item: 8 } };
    const r = await runLoop(baseOpts(fixture, { merged, worker, tail: mergedTail().tail }));

    const item = r.summary!.items[0];
    expect(item.outcome).toBe("abandoned");
    expect(item.iterationsGood).toBe(1);
    // Real work → preserved worktree + blocked, as before.
    expect(existsSync(join(fixture.repoRoot, ".worktrees", "dev-hyg002"))).toBe(true);
    expect(readFileSync(join(fixture.repoRoot, fixture.specRel({ hash: "hyg002" })), "utf8")).toContain(
      "status: blocked",
    );
    // The new part: no checkbox↔prose drift on the backlog row.
    const devMd = readFileSync(join(fixture.repoRoot, "DEV.md"), "utf8");
    expect(devMd).toMatch(/- \[-\] `dev\/dev-hyg002/);
    expect(devMd).toMatch(/dev-hyg002[^\n]*Status: blocked/);
    expect(devMd).not.toMatch(/dev-hyg002[^\n]*Status: in-progress/);
  });
});

// ---------------------------------------------------------------------------
// b41f7c: attach-mode (mss102) claims hand the loop a branch it did NOT
// create. The abandon path's `discardWorktree` used to `git branch -D` it
// unconditionally — and the handed-off commits sit BELOW the claim's base
// SHA, so `isBookkeepingOnlyWorktree` reports "nothing preserved" while the
// branch is the only remaining copy of the parent's work.
// ---------------------------------------------------------------------------

describe("attach-mode branch disposal (b41f7c)", () => {
  /** Create `branch` off main with one commit — the parent run's handed-off
   *  WIP, as it looks to a follow-up claim (branch present locally, nothing
   *  checked out). Returns the inherited tip SHA. */
  function seedHandoffBranch(fx: Fixture, branch: string, file: string): string {
    const tmp = join(fx.base, `seed-${branch.replace(/\//g, "-")}`);
    g(fx.repoRoot, "worktree", "add", "-q", "-b", branch, tmp, "main");
    writeFileSync(join(tmp, file), "parent WIP — the only copy\n", "utf8");
    g(tmp, "add", "-A");
    g(tmp, "commit", "-q", "-m", "feat: parent WIP handed off to the follow-up");
    const sha = g(tmp, "rev-parse", "HEAD");
    g(fx.repoRoot, "worktree", "remove", "--force", tmp);
    return sha;
  }

  it("abandon with a bookkeeping-only worktree keeps the INHERITED branch (rewound to the handed-off tip), never `branch -D`s it", async () => {
    fixture = makeFixture([{ hash: "att001", branch: "feat/dev-par001" }]);
    const inherited = seedHandoffBranch(fixture, "feat/dev-par001", "wip.txt");

    // 3 honest reported failures → abandon with nothing preserved beyond the
    // loop's own `chore(loop): record iteration` bookkeeping. Pre-fix this
    // deleted feat/dev-par001 outright (reflog-only recovery once origin's
    // copy is gone — the fixture never pushed it).
    const { worker } = scriptedWorker([
      { kind: "report", report: { success: false, summary: "try 1 failed" } },
      { kind: "report", report: { success: false, summary: "try 2 failed" } },
      { kind: "report", report: { success: false, summary: "try 3 failed" } },
    ]);
    const r = await runLoop(baseOpts(fixture, { worker, tail: mergedTail().tail }));

    const item = r.summary!.items[0];
    expect(item.outcome).toBe("abandoned");
    // The claim attached, so the worktree is still discarded…
    expect(existsSync(join(fixture.repoRoot, ".worktrees", "dev-att001"))).toBe(false);
    // …but the inherited branch survives, at exactly the handed-off tip:
    // this run's bookkeeping commits are gone, the parent's work is not.
    expect(g(fixture.repoRoot, "branch", "--list", "feat/dev-par001")).not.toBe("");
    expect(g(fixture.repoRoot, "rev-parse", "feat/dev-par001")).toBe(inherited);
    expect(g(fixture.repoRoot, "show", "feat/dev-par001:wip.txt")).toContain("only copy");
    expect(g(fixture.repoRoot, "log", "--format=%s", "feat/dev-par001")).not.toContain(
      "chore(loop)",
    );

    const events = readEvents(fixture.cacheDir, r.summary!.runId);
    expect(events.map((e) => e.event)).toContain("item:inherited-branch-preserved");
    expect(events.map((e) => e.event)).not.toContain("item:branch-delete-failed");
    // Preserving the inheritance is the designed outcome, not an incident —
    // no operator WARN, and the item goes back to ready for the next claim
    // (which re-attaches to exactly what it was handed).
    expect(item.warnings ?? []).toEqual([]);
    expect(item.leftState).toBe("ready");
    const devMd = readFileSync(join(fixture.repoRoot, "DEV.md"), "utf8");
    expect(devMd).toMatch(/- \[ \] `dev\/dev-att001/);
  });

  it("a DERIVED claim branch is still deleted — the fix is scoped to inherited branches", async () => {
    // Same abandon shape, no `branch:` frontmatter: the claim created
    // feat/dev-att002 with `worktree add -b`, so it holds nothing the claim
    // didn't put there and stays disposable (dc7514 hygiene, unchanged).
    fixture = makeFixture([{ hash: "att002" }]);
    const { worker } = scriptedWorker([
      { kind: "report", report: { success: false, summary: "try 1 failed" } },
      { kind: "report", report: { success: false, summary: "try 2 failed" } },
      { kind: "report", report: { success: false, summary: "try 3 failed" } },
    ]);
    const r = await runLoop(baseOpts(fixture, { worker, tail: mergedTail().tail }));

    expect(r.summary!.items[0].outcome).toBe("abandoned");
    expect(g(fixture.repoRoot, "branch", "--list", "feat/dev-att002")).toBe("");
    expect(
      readEvents(fixture.cacheDir, r.summary!.runId).map((e) => e.event),
    ).not.toContain("item:inherited-branch-preserved");
  });

  it("an undeletable derived branch WARNs about silent adoption, not just a failing claim (AC 3)", async () => {
    // Post-mss102 a surviving debris branch does NOT simply fail the next
    // claim: if the spec records a `branch:` naming it, the claim ATTACHES
    // and the dead run's commits ride into the follow-up's PR. The warning
    // has to name that hazard, not promise the old failure.
    fixture = makeFixture([{ hash: "att003" }]);
    const { worker } = scriptedWorker([
      { kind: "report", report: { success: false, summary: "try 1 failed" } },
      { kind: "report", report: { success: false, summary: "try 2 failed" } },
      { kind: "report", report: { success: false, summary: "try 3 failed" } },
    ]);
    // Fail ONLY `git branch -D` — everything else is the real git.
    const exec: typeof realExec = (cmd, args, opts) =>
      cmd === "git" && args[0] === "branch" && args[1] === "-D"
        ? { exitCode: 1, stdout: "", stderr: "error: cannot delete branch (simulated)" }
        : realExec(cmd, args, opts);
    const r = await runLoop(baseOpts(fixture, { worker, exec, tail: mergedTail().tail }));

    const warning = (r.summary!.items[0].warnings ?? []).find((w) =>
      w.includes("stale local branch feat/dev-att003"),
    );
    expect(warning).toBeDefined();
    expect(warning).toContain("silently adopted");
    expect(warning).not.toMatch(/will fail\b/);
    expect(readFileSync(r.reportPath!, "utf8")).toContain("stale local branch feat/dev-att003");
    expect(
      readEvents(fixture.cacheDir, r.summary!.runId).map((e) => e.event),
    ).toContain("item:branch-delete-failed");
  });

  it("a rewind that cannot be proven safe leaves the inherited branch untouched and WARNs", async () => {
    // Deleting handed-off work is unrecoverable; leaving a branch with this
    // run's bookkeeping on top is not. When `branch -f` fails the loop takes
    // the recoverable side and says so.
    fixture = makeFixture([{ hash: "att004", branch: "feat/dev-par004" }]);
    const inherited = seedHandoffBranch(fixture, "feat/dev-par004", "wip.txt");
    const { worker } = scriptedWorker([
      { kind: "report", report: { success: false, summary: "try 1 failed" } },
      { kind: "report", report: { success: false, summary: "try 2 failed" } },
      { kind: "report", report: { success: false, summary: "try 3 failed" } },
    ]);
    const exec: typeof realExec = (cmd, args, opts) =>
      cmd === "git" && args[0] === "branch" && args[1] === "-f"
        ? { exitCode: 1, stdout: "", stderr: "fatal: cannot force-update branch (simulated)" }
        : realExec(cmd, args, opts);
    const r = await runLoop(baseOpts(fixture, { worker, exec, tail: mergedTail().tail }));

    // Branch alive with the handed-off commit reachable — the rewind failing
    // must never degrade into a delete.
    expect(g(fixture.repoRoot, "show", "feat/dev-par004:wip.txt")).toContain("only copy");
    expect(
      g(fixture.repoRoot, "merge-base", "--is-ancestor", inherited, "feat/dev-par004"),
    ).toBe("");
    const warning = (r.summary!.items[0].warnings ?? []).find((w) =>
      w.includes("inherited branch feat/dev-par004"),
    );
    expect(warning).toBeDefined();
    expect(warning).toContain("bookkeeping commits");
    expect(
      readEvents(fixture.cacheDir, r.summary!.runId).map((e) => e.event),
    ).toContain("item:inherited-branch-rewind-skipped");
  });
});

// ---------------------------------------------------------------------------
// defaultSleep (LOW-9 — the backoff/CI-poll sleep must wake on abort)
// ---------------------------------------------------------------------------

describe("defaultSleep", () => {
  it("resolves immediately when the signal aborts mid-sleep (SIGTERM during backoff)", async () => {
    const ac = new AbortController();
    const started = Date.now();
    const p = defaultSleep(60_000, ac.signal);
    setTimeout(() => ac.abort(), 20);
    await p;
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("resolves immediately on an already-aborted signal", async () => {
    const ac = new AbortController();
    ac.abort();
    const started = Date.now();
    await defaultSleep(60_000, ac.signal);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("sleeps the full duration without a signal", async () => {
    const started = Date.now();
    await defaultSleep(30);
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
  });
});

// ---------------------------------------------------------------------------
// E-3: budget-rail split (mid-story-split phase 3 — mss103)
//
// The budget rail splits instead of abandoning when real committed progress
// exists: WIP branch pushed, branch-handoff follow-up filed by the DRIVER,
// parent superseded, abandonment streak untouched. Zero progress takes
// today's abandon path verbatim; any thrown split error falls back to
// abandonItem (status-quo floor).
// ---------------------------------------------------------------------------

describe("E-3: budget-rail split (mss103)", () => {
  it("real progress at iteration-budget exhaustion → outcome split: WIP branch pushed, follow-up spec + DEV.md row committed on main, report names the follow-up path", async () => {
    fixture = makeFixture([{ hash: "aaa111", title: "Big thing" }]);
    const { worker } = scriptedWorker([
      {
        kind: "report",
        files: { "real.txt": "real\n" },
        report: { summary: "step 1", key_changes_made: ["real.txt"], key_learnings: ["worktree layout matters"] },
      },
      {
        kind: "report",
        files: { "real2.txt": "more\n" },
        report: { summary: "step 2", key_changes_made: ["real2.txt"] },
      },
    ]);
    const merged = { ...MERGED, loop: { ...MERGED.loop, max_iterations_per_item: 2 } };
    // maxItems 1: the follow-up row is an ORDINARY ready row (by design),
    // so without the cap the loop would claim + split it again in a chain.
    const r = await runLoop(
      baseOpts(fixture, { merged, worker, tail: mergedTail().tail, flags: { maxItems: 1 } }),
    );

    expect(r.exitCode).toBe(0);
    const item = r.summary!.items[0];
    expect(item.outcome).toBe("split");
    expect(item.leftState).toBe("ready");
    expect(item.iterationsGood).toBe(2);
    expect(item.detail).toMatch(/iteration budget exhausted/);
    expect(item.followUpSpecPath).toMatch(/^dev\/dev-[a-z0-9]+-.+\.md$/);
    const followUpPath = item.followUpSpecPath!;
    const followUpHash = /^dev\/dev-([a-z0-9]+)-/.exec(followUpPath)![1];

    // Follow-up spec on main: branch-handoff shape — inherits the parent's
    // WIP branch, carries the remaining ACs + carried-forward sections +
    // the successful iterations' learnings.
    const followUp = readFileSync(join(fixture.repoRoot, followUpPath), "utf8");
    expect(followUp).toContain("branch: feat/dev-aaa111");
    expect(followUp).toContain("from: dev/dev-aaa111-2026-07-05T13:00-item-aaa111.md");
    expect(followUp).toContain("status: ready");
    expect(followUp).toContain("the aaa111 thing works");
    expect(followUp).toContain("## Carried forward");
    expect(followUp).toContain("### State to trust");
    expect(followUp).toContain("### Gotchas");
    expect(followUp).toContain("### Do NOT");
    expect(followUp).toContain("worktree layout matters");

    // Parent spec on main: superseded, spawned wired.
    const parent = readFileSync(
      join(fixture.repoRoot, fixture.specRel({ hash: "aaa111" })),
      "utf8",
    );
    expect(parent).toContain("status: superseded");
    expect(parent).toContain(`superseded_by: ${followUpHash}`);
    expect(parent).toContain(followUpHash);

    // DEV.md: parent row struck superseded, follow-up row ready.
    const dev = readFileSync(join(fixture.repoRoot, "DEV.md"), "utf8");
    expect(dev).toMatch(new RegExp(`~~.*dev-aaa111.*~~ superseded by ${followUpHash}\\.`));
    expect(dev).toContain(`\`${followUpPath}\``);
    expect(dev).toMatch(new RegExp(`${followUpPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\`[^\\n]*Status: ready`));

    // WIP branch pushed to origin; worktree removed; local branch kept
    // (the follow-up's claim attaches to it).
    expect(
      execFileSync(
        "git",
        ["--git-dir", fixture.origin, "rev-parse", "--verify", "refs/heads/feat/dev-aaa111"],
        { encoding: "utf8" },
      ).trim(),
    ).toMatch(/^[0-9a-f]{40}$/);
    expect(existsSync(join(fixture.repoRoot, ".worktrees", "dev-aaa111"))).toBe(false);
    expect(g(fixture.repoRoot, "branch", "--list", "feat/dev-aaa111")).not.toBe("");

    // Lock released; split bookkeeping committed AND pushed to origin main.
    expect(existsSync(join(fixture.cacheDir, "locks", "spec-aaa111.lock"))).toBe(false);
    expect(g(fixture.repoRoot, "log", "-1", "--format=%s")).toContain("split aaa111");
    expect(
      execFileSync(GIT, ["--git-dir", fixture.origin, "log", "-1", "--format=%s", "main"], {
        encoding: "utf8",
      }),
    ).toContain("split aaa111");

    // Morning report names the follow-up path + the /devx command.
    const report = readFileSync(r.reportPath!, "utf8");
    expect(report).toContain(followUpPath);
    expect(report).toContain(`/devx ${followUpHash}`);
    expect(report).toContain("1 split");

    // Events: item:split emitted, no fallback.
    const events = readEvents(fixture.cacheDir, r.summary!.runId).map((e) => e.event);
    expect(events).toContain("item:split");
    expect(events).not.toContain("item:split-fallback");
  });

  it("bookkeeping-only worktree at budget exhaustion → abandon path byte-identical to today (no split artifacts)", async () => {
    fixture = makeFixture([{ hash: "bbb222", title: "No-progress thing" }]);
    // Two reported failures burn the 2-iteration budget with good=0.
    const { worker } = scriptedWorker([
      { kind: "report", report: { success: false, summary: "try 1 failed" } },
      { kind: "report", report: { success: false, summary: "try 2 failed" } },
    ]);
    const merged = { ...MERGED, loop: { ...MERGED.loop, max_iterations_per_item: 2 } };
    const r = await runLoop(baseOpts(fixture, { merged, worker, tail: mergedTail().tail }));

    const item = r.summary!.items[0];
    expect(item.outcome).toBe("abandoned");
    expect(item.leftState).toBe("ready");
    expect(item.detail).toMatch(/iteration budget exhausted/);
    expect(item.followUpSpecPath).toBeUndefined();

    // Exactly today's dc7514 abandon hygiene: worktree discarded, item left
    // ready, failure folded into the main spec's status log.
    expect(existsSync(join(fixture.repoRoot, ".worktrees", "dev-bbb222"))).toBe(false);
    const spec = readFileSync(join(fixture.repoRoot, fixture.specRel({ hash: "bbb222" })), "utf8");
    expect(spec).toContain("status: ready");
    expect(spec).toMatch(/\[FAIL\] loop abandoned bbb222/);
    expect(spec).not.toContain("superseded");

    // No split artifacts anywhere: single dev spec, no struck row, no
    // split events.
    expect(readdirSync(join(fixture.repoRoot, "dev"))).toHaveLength(1);
    const dev = readFileSync(join(fixture.repoRoot, "DEV.md"), "utf8");
    expect(dev).not.toContain("~~");
    expect(dev).not.toContain("superseded");
    const events = readEvents(fixture.cacheDir, r.summary!.runId).map((e) => e.event);
    expect(events).not.toContain("item:split");
    expect(events).not.toContain("item:split-fallback");
  });

  it("a split resets the abandonment streak (afterItemCompleted) — 2 abandons + split + abandon does NOT trip the 3-stop", async () => {
    // Order in DEV.md: bbb, ccc abandon progress-less (streak 2), aaa
    // splits (streak → 0), ddd abandons (streak 1). If split failed to
    // reset, ddd would be the 3rd consecutive → abort exit 2; if split
    // INCREMENTED, the abort would fire right after aaa.
    fixture = makeFixture([
      { hash: "bbb222" },
      { hash: "ccc333" },
      { hash: "aaa111" },
      { hash: "ddd444" },
    ]);
    const { worker } = scriptedWorker([
      { kind: "report", report: { success: false, summary: "b1" } },
      { kind: "report", report: { success: false, summary: "b2" } },
      { kind: "report", report: { success: false, summary: "c1" } },
      { kind: "report", report: { success: false, summary: "c2" } },
      { kind: "report", files: { "a.txt": "a" }, report: { summary: "a1", key_changes_made: ["a"] } },
      { kind: "report", files: { "a2.txt": "a2" }, report: { summary: "a2", key_changes_made: ["a2"] } },
      { kind: "report", report: { success: false, summary: "d1" } },
      { kind: "report", report: { success: false, summary: "d2" } },
    ]);
    const merged = { ...MERGED, loop: { ...MERGED.loop, max_iterations_per_item: 2 } };
    // maxItems 4: after aaa splits, its follow-up row is ready and sits
    // directly after aaa's struck row, so the 4th pick is the follow-up
    // (whose scripted iterations fail progress-less → abandoned). The
    // discriminator holds either way: a split that INCREMENTED the streak
    // would abort right after aaa (3rd consecutive); one that failed to
    // RESET would abort on the 4th abandon (2+1). Only reset-to-0 exits 0.
    const r = await runLoop(
      baseOpts(fixture, { merged, worker, tail: mergedTail().tail, flags: { maxItems: 4 } }),
    );

    expect(r.summary!.items.map((i) => i.outcome)).toEqual([
      "abandoned",
      "abandoned",
      "split",
      "abandoned",
    ]);
    expect(r.exitCode).toBe(0);
    expect(r.summary!.abortReason).toBeNull();
  });

  it("split failure falls back to abandonItem verbatim (status-quo floor): thrown push rejects the split transaction before any main mutation", async () => {
    fixture = makeFixture([{ hash: "eee555", title: "Fallback thing" }]);
    // Origin rejects feature-branch pushes → pushCurrentBranch (the split
    // transaction's first step) throws → splitItem falls back. The claim's
    // main push already happened, so only feat/* is refused.
    const hookPath = join(fixture.origin, "hooks", "pre-receive");
    writeFileSync(
      hookPath,
      '#!/bin/sh\nwhile read old new ref; do case "$ref" in refs/heads/feat/*) echo "feat pushes rejected"; exit 1;; esac; done\nexit 0\n',
      "utf8",
    );
    chmodSync(hookPath, 0o755);
    const { worker } = scriptedWorker([
      { kind: "report", files: { "w.txt": "w" }, report: { summary: "s1", key_changes_made: ["w"] } },
      { kind: "report", files: { "w2.txt": "w2" }, report: { summary: "s2", key_changes_made: ["w2"] } },
    ]);
    const merged = { ...MERGED, loop: { ...MERGED.loop, max_iterations_per_item: 2 } };
    const r = await runLoop(baseOpts(fixture, { merged, worker, tail: mergedTail().tail }));

    // Exactly where abandonItem puts a real-work item today: [-] blocked,
    // worktree preserved, lock released, [FAIL] entry on the main spec.
    const item = r.summary!.items[0];
    expect(item.outcome).toBe("abandoned");
    expect(item.leftState).toBe("blocked");
    expect(item.followUpSpecPath).toBeUndefined();
    expect(item.worktreePath).toBe(".worktrees/dev-eee555");
    expect(existsSync(join(fixture.repoRoot, ".worktrees", "dev-eee555"))).toBe(true);
    const spec = readFileSync(join(fixture.repoRoot, fixture.specRel({ hash: "eee555" })), "utf8");
    expect(spec).toContain("status: blocked");
    expect(spec).toMatch(/\[FAIL\] loop abandoned eee555/);
    expect(readFileSync(join(fixture.repoRoot, "DEV.md"), "utf8")).toMatch(/- \[-\] `dev\/dev-eee555/);
    expect(existsSync(join(fixture.cacheDir, "locks", "spec-eee555.lock"))).toBe(false);

    // No split artifacts: single dev spec, fallback evented, no item:split.
    expect(readdirSync(join(fixture.repoRoot, "dev"))).toHaveLength(1);
    const events = readEvents(fixture.cacheDir, r.summary!.runId).map((e) => e.event);
    expect(events).toContain("item:split-fallback");
    expect(events).not.toContain("item:split");
  }, HOOK_TEST_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// E-3 review-fix regressions (mss103 adversarial self-review)
//
// The split rail must never be MORE destructive than the abandon path it
// replaces, and must never supersede a parent whose branch holds no
// product work.
// ---------------------------------------------------------------------------

describe("E-3: split rail progress oracle (mss103 review fixes)", () => {
  it("commit-failure-preserved work at budget exhaustion abandons (preserving the dirty worktree) instead of splitting it away (BH-1/EC-1 HIGH)", async () => {
    fixture = makeFixture([{ hash: "dir111", title: "Dirty thing" }]);
    // pre-commit hook blocks worktree commits from the 2nd commit on, so
    // iteration 2's work stays PRESERVED-uncommitted (pendingRepair) and
    // the budget runs out before any repair iteration can land it.
    const hooksDir = join(fixture.base, "hooks");
    const flagPath = join(fixture.base, "commit-blocked");
    writeHookScript(
      hooksDir,
      "pre-commit",
      `#!/bin/sh\ncase "$PWD" in *".worktrees/"*) [ -f "${flagPath}" ] && { echo "hook says no" >&2; exit 1; } ;; esac\nexit 0\n`,
    );
    g(fixture.repoRoot, "config", "core.hooksPath", hooksDir);

    const { worker, prompts } = scriptedWorker([
      { kind: "report", files: { "committed.txt": "safe\n" }, report: { summary: "landed step 1", key_changes_made: ["committed.txt"] } },
      { kind: "report", files: { "precious.txt": "uncommitted gold\n" }, report: { summary: "step 2", key_changes_made: ["precious.txt"] } },
    ]);
    // Arm the hook only after iteration 1 committed cleanly.
    const armingWorker: WorkerRunFn = async (prompt, opts) => {
      const res = await worker(prompt, opts);
      if (prompts.length === 1) writeFileSync(flagPath, "1", "utf8");
      return res;
    };
    // Budget 2: iteration 1 good, iteration 2 commit-failure (failed++) →
    // good + failed === 2 at the next loop top → budget rail fires with a
    // dirty tree.
    const merged = { ...MERGED, loop: { ...MERGED.loop, max_iterations_per_item: 2 } };
    const r = await runLoop(
      baseOpts(fixture, { merged, worker: armingWorker, tail: mergedTail().tail, flags: { maxItems: 1 } }),
    );

    const item = r.summary!.items[0];
    // The status-quo floor: abandon-with-preserved-work, NOT a split.
    expect(item.outcome).toBe("abandoned");
    expect(item.leftState).toBe("blocked");
    expect(item.followUpSpecPath).toBeUndefined();

    // The uncommitted work still exists on disk — the whole point.
    const wt = join(fixture.repoRoot, ".worktrees", "dev-dir111");
    expect(existsSync(wt)).toBe(true);
    expect(readFileSync(join(wt, "precious.txt"), "utf8")).toBe("uncommitted gold\n");

    // No split artifacts: one spec, no struck row, no split events.
    expect(readdirSync(join(fixture.repoRoot, "dev"))).toHaveLength(1);
    const dev = readFileSync(join(fixture.repoRoot, "DEV.md"), "utf8");
    expect(dev).not.toContain("superseded");
    expect(dev).toMatch(/- \[-\] `dev\/dev-dir111/);
    const events = readEvents(fixture.cacheDir, r.summary!.runId).map((e) => e.event);
    expect(events).not.toContain("item:split");
  }, HOOK_TEST_TIMEOUT_MS);

  it("a learnings-only success is not splittable progress: budget exhaustion abandons rather than superseding a parent whose branch holds no product work (BH-4)", async () => {
    fixture = makeFixture([{ hash: "lrn111", title: "Learnings-only thing" }]);
    // success=true with NO file changes but new learnings — legal (a no-op
    // needs both absent), and its commit carries only the loop's own
    // status-log append under a feat() subject.
    const { worker } = scriptedWorker([
      { kind: "report", report: { summary: "read a lot", key_learnings: ["the parser is recursive"] } },
      { kind: "report", report: { summary: "read more", key_learnings: ["and memoized"] } },
    ]);
    const merged = { ...MERGED, loop: { ...MERGED.loop, max_iterations_per_item: 2 } };
    const r = await runLoop(
      baseOpts(fixture, { merged, worker, tail: mergedTail().tail, flags: { maxItems: 1 } }),
    );

    const item = r.summary!.items[0];
    expect(item.iterationsGood).toBe(2);
    expect(item.outcome).toBe("abandoned");
    expect(item.followUpSpecPath).toBeUndefined();
    expect(readdirSync(join(fixture.repoRoot, "dev"))).toHaveLength(1);
    const spec = readFileSync(join(fixture.repoRoot, fixture.specRel({ hash: "lrn111" })), "utf8");
    expect(spec).not.toContain("status: superseded");
    const events = readEvents(fixture.cacheDir, r.summary!.runId).map((e) => e.event);
    expect(events).not.toContain("item:split");
  });

  it("a split_request with no committed product work is ignored, not honored: no PR, no follow-up, the loop keeps iterating (BH-3)", async () => {
    fixture = makeFixture([{ hash: "req111", title: "Premature splitter" }]);
    const { tail, calls } = mergedTail();
    const { worker } = scriptedWorker([
      // Iteration 1: no files, but learnings (so not a no-op) + a
      // well-formed split request. The branch holds nothing but the
      // loop's status-log commit — the request must not be honored.
      {
        kind: "report",
        report: {
          summary: "explored, then asked to split",
          key_learnings: ["this is bigger than it looked"],
          split_request: {
            title: "Do the actual work",
            remaining_acs: ["the req111 thing works"],
          },
        },
      },
      // Iteration 2: real work, finishes normally.
      {
        kind: "report",
        files: { "real.txt": "real" },
        report: { summary: "actually did it", key_changes_made: ["real.txt"], acs_met: true },
      },
    ]);
    const r = await runLoop(baseOpts(fixture, { worker, tail, flags: { maxItems: 1 } }));

    const item = r.summary!.items[0];
    // The premature request was ignored and the item ran on to completion.
    expect(item.outcome).toBe("merged");
    expect(item.iterationsGood).toBe(2);
    expect(item.followUpSpecPath).toBeUndefined();
    expect(calls).toHaveLength(1); // exactly one tail run — not one per request
    expect(readdirSync(join(fixture.repoRoot, "dev"))).toHaveLength(1);
    const events = readEvents(fixture.cacheDir, r.summary!.runId).map((e) => e.event);
    expect(events).toContain("iteration:split-request-ignored");
    expect(events).not.toContain("item:split");
  });
});

// ---------------------------------------------------------------------------
// E-3: worker-requested split on the non-merged tails (mss103 review fixes)
// ---------------------------------------------------------------------------

describe("E-3: worker-requested split, non-merged tails (mss103 review fixes)", () => {
  const SPLIT_REQUEST = {
    title: "Second half of the work",
    remaining_acs: ["the second half works"],
  };

  it("handed-off tail still files the follow-up (blocked on the pending PR) while the outcome stays handed-off (AA-6)", async () => {
    fixture = makeFixture([{ hash: "hnd111", title: "Handed-off splitter" }]);
    const { worker } = scriptedWorker([
      {
        kind: "report",
        files: { "half.txt": "half\n" },
        report: {
          summary: "shipped the first half",
          key_changes_made: ["half.txt"],
          split_request: SPLIT_REQUEST,
        },
      },
    ]);
    const tail: TailFn = async () => ({
      outcome: "handed-off",
      kind: "handed-off-ok",
      prUrl: "https://github.com/x/y/pull/13",
      prNumber: 13,
      detail: "remote CI concluded 'failure' — not merging",
    });
    const r = await runLoop(baseOpts(fixture, { worker, tail, flags: { maxItems: 1 } }));

    const item = r.summary!.items[0];
    expect(item.outcome).toBe("handed-off");
    expect(item.followUpSpecPath).toMatch(/^dev\/dev-[a-z0-9]+-.+\.md$/);
    const followUpPath = item.followUpSpecPath!;

    // Merge-first shape: the follow-up waits on the parent's PR landing.
    const followUp = readFileSync(join(fixture.repoRoot, followUpPath), "utf8");
    expect(followUp).toContain("blocked_by: [hnd111]");
    expect(followUp).toContain("the second half works");
    expect(readFileSync(join(fixture.repoRoot, "DEV.md"), "utf8")).toContain(
      "Blocked-by: hnd111.",
    );

    // Claim + worktree still preserved for the morning (handed-off posture).
    expect(existsSync(join(fixture.repoRoot, ".worktrees", "dev-hnd111"))).toBe(true);
    expect(existsSync(join(fixture.cacheDir, "locks", "spec-hnd111.lock"))).toBe(true);

    // The follow-up was committed AND pushed, not left dirty on main.
    expect(g(fixture.repoRoot, "status", "--porcelain")).toBe("");
    expect(
      execFileSync(GIT, ["--git-dir", fixture.origin, "ls-tree", "-r", "--name-only", "main"], {
        encoding: "utf8",
      }),
    ).toContain(followUpPath);
  });

  it("merged tail whose split FAILS leaves the parent [-] blocked with the unmet ACs in its status log, never [x] done (BH-2/AA-7)", async () => {
    fixture = makeFixture([{ hash: "fal111", title: "Failing splitter" }]);
    const { worker } = scriptedWorker([
      {
        kind: "report",
        files: { "shipped.txt": "shipped\n" },
        report: {
          summary: "shipped the first half",
          key_changes_made: ["shipped.txt"],
          split_request: SPLIT_REQUEST,
        },
      },
    ]);
    // Break the split at its resolve stage: performSplit needs the DEV.md
    // row for the parent to splice after, and the spec lock to match. The
    // cheapest honest break is removing the parent's backlog row between
    // the claim and the split — insertDevMdRow then throws.
    const tail: TailFn = async () => {
      const devMd = join(fixture!.repoRoot, "DEV.md");
      writeFileSync(
        devMd,
        readFileSync(devMd, "utf8")
          .split("\n")
          .filter((l) => !l.includes("dev-fal111"))
          .join("\n"),
        "utf8",
      );
      return { outcome: "merged", prUrl: "https://github.com/x/y/pull/14", prNumber: 14 };
    };
    const r = await runLoop(baseOpts(fixture, { worker, tail, flags: { maxItems: 1 } }));

    const item = r.summary!.items[0];
    // The PR merged (real + remote) but the item is NOT a clean merge.
    expect(item.outcome).toBe("merged");
    expect(item.leftState).toBe("blocked");
    expect(item.followUpSpecPath).toBeUndefined();

    // The parent kept its unmet ACs instead of being marked done.
    const spec = readFileSync(join(fixture.repoRoot, fixture.specRel({ hash: "fal111" })), "utf8");
    expect(spec).toContain("status: blocked");
    expect(spec).not.toContain("status: done");
    expect(spec).toContain("the worker-requested split FAILED");
    expect(spec).toContain("the second half works");

    // No follow-up spec was invented.
    expect(readdirSync(join(fixture.repoRoot, "dev"))).toHaveLength(1);

    // The morning report tells the truth about the divergence.
    const report = readFileSync(r.reportPath!, "utf8");
    expect(report).toContain("merged at reduced scope — split FAILED, spec left blocked");
    expect(report).toContain("devx split fal111");
    const events = readEvents(fixture.cacheDir, r.summary!.runId).map((e) => e.event);
    expect(events).toContain("item:split-fallback");
    expect(events).not.toContain("item:split");
  });

  it("a failed worktree removal still splits, but WARNs that the follow-up's claim of the WIP branch will fail (AA-9)", async () => {
    fixture = makeFixture([{ hash: "wtf111", title: "Unremovable worktree" }]);
    const { worker } = scriptedWorker([
      { kind: "report", files: { "a.txt": "a" }, report: { summary: "s1", key_changes_made: ["a"] } },
      { kind: "report", files: { "b.txt": "b" }, report: { summary: "s2", key_changes_made: ["b"] } },
    ]);
    // Fail ONLY `git worktree remove` — everything else is the real git.
    const exec: typeof realExec = (cmd, args, opts) => {
      if (cmd === "git" && args[0] === "worktree" && args[1] === "remove") {
        return { exitCode: 1, stdout: "", stderr: "fatal: cannot remove worktree (simulated)" };
      }
      return realExec(cmd, args, opts);
    };
    const merged = { ...MERGED, loop: { ...MERGED.loop, max_iterations_per_item: 2 } };
    const r = await runLoop(
      baseOpts(fixture, { merged, worker, exec, tail: mergedTail().tail, flags: { maxItems: 1 } }),
    );

    const item = r.summary!.items[0];
    // The split still happened — worktree removal is cleanup, not a gate.
    expect(item.outcome).toBe("split");
    expect(item.followUpSpecPath).toBeDefined();
    expect(existsSync(join(fixture.repoRoot, item.followUpSpecPath!))).toBe(true);

    // …and the operator is told why their next claim would otherwise fail.
    const warning = (item.warnings ?? []).find((w) => w.includes("could not be removed"));
    expect(warning).toBeDefined();
    expect(warning).toContain("feat/dev-wtf111");
    expect(readFileSync(r.reportPath!, "utf8")).toContain("could not be removed after the split");
    const events = readEvents(fixture.cacheDir, r.summary!.runId).map((e) => e.event);
    expect(events).toContain("item:split-worktree-remove-failed");
  });
});
