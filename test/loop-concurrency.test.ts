// The G-1 overlap harness (mlc104 — design §Test architecture): two
// concurrent in-process `runLoop` calls over ONE tmpdir git fixture, driven
// through the RunLoopOpts seams — real claim / spec-lock / backlog-lock /
// backlog code, fake worker ("implements" instantly), fake tail ("merges"
// without gh), seeded delay schedules for ≥3 distinct interleavings. The
// serial baseline is the same fixture run through one loop; assertions
// compare merged-item unions and final DEV.md bytes.
//
// What this pins that the standalone E-1 eval cannot: overlap SAFETY —
// merged union == serial baseline, no double-merge, byte-identical backlog,
// zero contention aborts. (E-1 pins the process-level contract: two real
// CLI loop processes coexisting — its instance-registry clauses land at
// mlc105.)
//
// Honest scope (review BH-8/EC-14): in ONE process every git exec is
// spawnSync and pick→claim runs with no interior await, so a git-level
// push race is structurally impossible here — this harness exercises
// item-level interleavings (pick masking, shared-checkout reconciles,
// disjoint splits), while the R2 rebase-retry itself is exercised by
// test/claim-contention.test.ts's real cross-clone races.
//
// Also here: the driver's claim-contended split (AC 2) and finalizeMerged's
// ff-pull fetch+retry (AC 3).
//
// Spec: dev/dev-mlc104-2026-07-28T09:02-claim-contention-harness.md

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { runLoop } from "../src/lib/loop/driver.js";
import { readEvents } from "../src/lib/loop/state.js";
import { type WorkerRunFn } from "../src/lib/loop/worker.js";
import { type TailFn } from "../src/lib/loop/tail.js";
import { type Exec, realExec } from "../src/lib/exec.js";
import { backlogLockPath, withBacklogLock } from "../src/lib/backlog/mutate.js";
import {
  ClaimContendedError,
  type ClaimSpecResult,
  claimSpec,
} from "../src/lib/devx/claim.js";
import { type RunSummary } from "../src/lib/loop/report.js";

// ---------------------------------------------------------------------------
// Fixture: bare origin + clone with N ready dev items
// ---------------------------------------------------------------------------

function g(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

// 3 items: enough for a non-trivial 2/1 split between the loops while
// keeping the harness's real-git cost inside CI budgets (4 items pushed
// the full-suite wall-clock past the test timeout under worker
// contention — each item costs a real claim commit+push+worktree plus a
// full finalize reconcile).
const HASHES = ["aa1101", "bb2202", "cc3303"] as const;
const PR_NUMBER: Record<string, number> = {
  aa1101: 101,
  bb2202: 202,
  cc3303: 303,
};
const prUrlFor = (hash: string): string =>
  `https://github.com/x/y/pull/${PR_NUMBER[hash] ?? 999}`;

interface Fixture {
  base: string;
  repoRoot: string;
  cacheDir: string;
}

function specRel(hash: string): string {
  return `dev/dev-${hash}-2026-07-28T08:00-item-${hash}.md`;
}

function makeFixture(hashes: readonly string[] = HASHES): Fixture {
  const base = mkdtempSync(join(tmpdir(), "devx-loop-concurrency-"));
  const origin = join(base, "origin.git");
  const repoRoot = join(base, "repo");
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", origin], { encoding: "utf8" });
  execFileSync("git", ["clone", "-q", origin, repoRoot], { encoding: "utf8" });
  g(repoRoot, "config", "user.email", "loop@test");
  g(repoRoot, "config", "user.name", "loop");
  g(repoRoot, "config", "commit.gpgsign", "false");
  execFileSync("mkdir", ["-p", join(repoRoot, "dev")]);
  const rows = ["# DEV — backlog", ""];
  for (const hash of hashes) {
    rows.push(`- [ ] \`${specRel(hash)}\` — Item ${hash}. Status: ready.`);
    writeFileSync(
      join(repoRoot, specRel(hash)),
      [
        "---",
        `hash: ${hash}`,
        "type: dev",
        "created: 2026-07-28T08:00:00-06:00",
        `title: Item ${hash}`,
        "status: ready",
        "---",
        "",
        "## Goal",
        "",
        `Do the ${hash} thing.`,
        "",
        "## Status log",
        "",
        "- 2026-07-28T08:00 — created.",
        "",
      ].join("\n"),
      "utf8",
    );
  }
  writeFileSync(join(repoRoot, "DEV.md"), rows.join("\n") + "\n", "utf8");
  writeFileSync(join(repoRoot, "DEBUG.md"), "# DEBUG — backlog\n", "utf8");
  writeFileSync(join(repoRoot, ".gitignore"), ".devx-cache/\n.worktrees/\n", "utf8");
  g(repoRoot, "add", "-A");
  g(repoRoot, "commit", "-q", "-m", "fixture base");
  g(repoRoot, "push", "-q", "-u", "origin", "main");
  return { base, repoRoot, cacheDir: join(repoRoot, ".devx-cache") };
}

const MERGED = {
  mode: "YOLO",
  git: { default_branch: "main", integration_branch: null, branch_prefix: "feat/" },
  loop: {
    max_iterations_per_item: 4,
    max_tokens_per_item: 1_000_000,
    max_consecutive_failures: 3,
    max_items: 10,
    max_total_tokens: 10_000_000,
    backoff_ms: [1, 2, 3],
  },
};

// ---------------------------------------------------------------------------
// Seeded schedule (deterministic interleavings without Math.random)
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Worker that "implements" the item instantly (one file, acs_met) after a
 *  seeded delay — the delay is the interleaving driver. */
function seededWorker(rand: () => number): WorkerRunFn {
  return async (_prompt, opts) => {
    await wait(Math.floor(rand() * 15));
    writeFileSync(join(opts.cwd, "impl.txt"), "implemented\n", "utf8");
    const report = {
      success: true,
      summary: "implemented",
      key_changes_made: ["impl.txt"],
      key_learnings: [],
      acs_met: true,
    };
    return {
      rawOutput: `done\n\n\`\`\`json\n${JSON.stringify(report)}\n\`\`\`\n`,
      exitCode: 0,
      graceKilled: false,
      tokens: { input: 100, output: 50, cacheCreation: 0, cacheRead: 0, estimated: true },
    };
  };
}

/** Tail that "merges" without gh — deterministic per-hash PR URL so the
 *  final DEV.md bytes are run-order-independent. */
function seededTail(rand: () => number): TailFn {
  return async (item) => {
    await wait(Math.floor(rand() * 15));
    return {
      outcome: "merged" as const,
      prUrl: prUrlFor(item.hash),
      prNumber: PR_NUMBER[item.hash] ?? 999,
    };
  };
}

const noopLock = () => ({ release() {} });
const instantSleep = async (): Promise<void> => {};

function loopOpts(
  fx: Fixture,
  name: string,
  rand: () => number,
  extra: Partial<Parameters<typeof runLoop>[0]> = {},
) {
  return {
    repoRoot: fx.repoRoot,
    merged: MERGED,
    out: () => {},
    heartbeatIntervalMs: 3_600_000,
    acquireLock: noopLock,
    sessionId: name,
    worker: seededWorker(rand),
    tail: seededTail(rand),
    sleep: instantSleep,
    ...extra,
  };
}

function mergedHashes(summary: RunSummary | null): string[] {
  return (summary?.items ?? []).filter((i) => i.outcome === "merged").map((i) => i.hash);
}

let fixtures: Fixture[] = [];
afterEach(() => {
  for (const fx of fixtures) rmSync(fx.base, { recursive: true, force: true });
  fixtures = [];
});

function track(fx: Fixture): Fixture {
  fixtures.push(fx);
  return fx;
}

// ---------------------------------------------------------------------------
// Serial baseline + overlapping pairs (AC 4)
// ---------------------------------------------------------------------------

async function runBaseline(): Promise<{ devMd: string; merged: string[] }> {
  // NOT track()ed: this runs in `beforeAll`, and the afterEach sweeper would
  // delete the fixture out from under the seed cases that follow. Owns its
  // own cleanup instead — the caller keeps only the strings.
  const fx = makeFixture();
  try {
    const r = await runLoop(loopOpts(fx, "baseline", mulberry32(1)));
    expect(r.exitCode).toBe(0);
    const merged = mergedHashes(r.summary).sort();
    expect(merged).toEqual([...HASHES].sort());
    return { devMd: readFileSync(join(fx.repoRoot, "DEV.md"), "utf8"), merged };
  } finally {
    rmSync(fx.base, { recursive: true, force: true });
  }
}

// G-1 SEEDS and G1_CASE_TIMEOUT_MS: the assertion set is unchanged from
// mlc104 (merged union == serial baseline, DEV.md byte-equal, 0 contention
// aborts, >=3 seeds) — only its packaging is. Each seed is its own `it`, and
// the serial baseline is a `beforeAll`, so each case is bounded by its own
// cap instead of four fixtures sharing one.
//
// WHY (debug-5c8b21). This was a single `it` covering baseline + 3 seeds
// under a 600s cap, and it timed out inside a full-suite run:
//
//   isolated, idle machine, 2026-08-03 ....... 122s  (4.9x under the cap)
//   full suite, same machine+commit .......... 467s  (1.3x under the cap)
//   full suite, same machine, ~1h later ...... >600s TIMEOUT
//
// The load amplification was uniform (~1.71x) across changed and unchanged
// files in that run — `claim-contention.test.ts`, byte-identical across both,
// slowed by the same factor — so the failure was machine load, not a diff.
// The defect was the ~1.3x margin: at that headroom the verdict is a function
// of machine speed, not of correctness.
//
// Two things fixed it. (a) debug-7c1e93 partitioned `npm test` so the
// sync-blocking files (this one included) run in their own maxForks:2 pass
// instead of ~11-wide against the async majority. (b) this split, which
// divides the wall-clock of the largest case by ~4.
//
// Re-measured on this tree, isolated (2026-08-19, 12-core macOS):
//
//   whole file, before the split ........ 15.7s / 9 tests
//   the old single G-1 case ............. 10.4s  (58x under the old 600s cap)
//   whole file, after the split ......... 16.1s / 11 tests
//   ONE seed case, after the split ...... ~2.6s  (115x under the 300s cap)
//
// The cap below is therefore both a TIGHTENING (600s -> 300s, so a genuinely
// wedged case fails in half the time and the file's worst-case wall-clock
// stops being one 600s block for four fixtures' work) and a headroom increase.
// Sizing it against the WORST case ever measured rather than today's fast
// box: the 2026-08-03 machine's ~30s per fixture run (122s / 4) x that run's
// 1.71x load amplification = ~52s, so 300s leaves ~5.8x even there, and ~115x
// here. Do NOT collapse these back into one case, and do NOT raise the global
// testTimeout instead — that hides the same fragility everywhere else
// (debug-c81f04, debug-74632d are the same class). `scripts/timeout-headroom.mjs`
// is the suite-wide audit for that class.
const G1_SEEDS = [11, 22, 33] as const;
const G1_CASE_TIMEOUT_MS = 300_000;

describe("two overlapping in-process loops over one fixture (G-1 harness)", () => {
  let baseline: { devMd: string; merged: string[] };

  // One serial baseline for all seeds — the reference bytes are seed-
  // independent, so re-running it per case would be pure cost.
  beforeAll(async () => {
    baseline = await runBaseline();
  }, G1_CASE_TIMEOUT_MS);

  for (const seed of G1_SEEDS) {
    it(
      `seed ${seed}: merged union == serial baseline, DEV.md byte-equal, 0 contention aborts`,
      async () => {
        const fx = track(makeFixture());
        const rand = mulberry32(seed);
        // Loop B: staggered start + skewed clock (distinct runId — newRunId
        // is pid+timestamp and both loops share this process's pid).
        const bStartDelay = 1 + Math.floor(rand() * 25);
        const [a, b] = await Promise.all([
          runLoop(loopOpts(fx, `loop-A-${seed}`, mulberry32(seed * 7 + 1))),
          (async () => {
            await wait(bStartDelay);
            return runLoop(
              loopOpts(fx, `loop-B-${seed}`, mulberry32(seed * 13 + 2), {
                now: () => new Date(Date.now() + 60_000),
              }),
            );
          })(),
        ]);

        // 0 contention aborts: neither run aborted, neither stopped on the
        // systemic-claim-failures rail, no hard claim failures at all.
        for (const r of [a, b]) {
          expect(r.exitCode, `seed ${seed}`).toBe(0);
          expect(r.summary?.abortReason ?? null, `seed ${seed}`).toBeNull();
          expect(r.summary?.stopReason ?? "").not.toMatch(/systemic claim problem/);
          expect(
            (r.summary?.items ?? []).filter((i) => i.outcome === "claim-failed"),
            `seed ${seed}`,
          ).toEqual([]);
        }

        // Merged union == serial baseline, disjoint between the two loops.
        const aMerged = mergedHashes(a.summary);
        const bMerged = mergedHashes(b.summary);
        const union = [...aMerged, ...bMerged].sort();
        expect(union, `seed ${seed}: no double-merge`).toEqual(baseline.merged);

        // Final DEV.md byte-equal to the serial baseline's.
        const devMd = readFileSync(join(fx.repoRoot, "DEV.md"), "utf8");
        expect(devMd, `seed ${seed}`).toBe(baseline.devMd);
        for (const hash of HASHES) {
          expect(devMd).toContain(`PR: ${prUrlFor(hash)}`);
        }
      },
      G1_CASE_TIMEOUT_MS,
    );
  }
});

// ---------------------------------------------------------------------------
// Driver claim-contended split (AC 2)
// ---------------------------------------------------------------------------

describe("driver claim-contended routing", () => {
  it("maps ClaimContendedError to item:claim-contended, picks next, merges the rest", async () => {
    const fx = track(makeFixture(["aa1101", "bb2202"]));
    const contendedHashes: string[] = [];
    const claim = async (hash: string, type: string) => {
      if (hash === "aa1101") {
        contendedHashes.push(hash);
        throw new ClaimContendedError(hash, 2, "peer won the race (test)");
      }
      return claimSpec(hash, {
        sessionId: "contended-split-test",
        repoRoot: fx.repoRoot,
        config: MERGED.git ? { git: MERGED.git } : {},
        type,
      });
    };
    const r = await runLoop(loopOpts(fx, "contended-split-test", mulberry32(5), { claim }));
    expect(r.exitCode).toBe(0);
    expect(contendedHashes).toEqual(["aa1101"]);

    const byHash = new Map((r.summary?.items ?? []).map((i) => [i.hash, i]));
    expect(byHash.get("aa1101")?.outcome).toBe("claim-contended");
    expect(byHash.get("aa1101")?.detail).toMatch(/peer won the race/);
    expect(byHash.get("bb2202")?.outcome).toBe("merged");
    expect(r.summary?.stopReason ?? "").not.toMatch(/systemic/);

    const events = readEvents(fx.cacheDir, r.summary!.runId).map((e) => e.event);
    expect(events).toContain("item:claim-contended");
    expect(events).not.toContain("item:claim-failed");
  }, 60_000);

  it("pure contention never trips the systemic rail and never burns the item budget", async () => {
    const fx = track(makeFixture());
    const claim = async (hash: string): Promise<never> => {
      throw new ClaimContendedError(hash, 2, "always contended (test)");
    };
    // maxItems 1: contended picks are NOT attempts — the loop must still
    // walk ALL rows (masking each) instead of stopping after one.
    const r = await runLoop(
      loopOpts(fx, "all-contended-test", mulberry32(6), {
        claim,
        flags: { maxItems: 1 },
      }),
    );
    expect(r.exitCode).toBe(0);
    expect(r.summary?.abortReason ?? null).toBeNull();
    expect(r.summary?.stopReason).toMatch(/no eligible backlog items/);
    expect(r.summary?.stopReason ?? "").not.toMatch(/systemic claim problem/);
    const outcomes = (r.summary?.items ?? []).map((i) => i.outcome);
    expect(outcomes).toEqual(HASHES.map(() => "claim-contended"));
  }, 60_000);

  it("three consecutive REAL claim failures still stop the loop (budget reserved for broken claims)", async () => {
    const fx = track(makeFixture(["aa1101", "bb2202", "cc3303", "dd4404"]));
    const claim = async (): Promise<never> => {
      throw new Error("locks dir unwritable (test)");
    };
    const r = await runLoop(loopOpts(fx, "broken-claims-test", mulberry32(7), { claim }));
    expect(r.summary?.stopReason).toMatch(/systemic claim problem/);
    expect((r.summary?.items ?? []).filter((i) => i.outcome === "claim-failed")).toHaveLength(3);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// finalizeMerged ff-pull fetch+retry (AC 3)
// ---------------------------------------------------------------------------

describe("finalizeMerged pull --ff-only retry", () => {
  it("a transient first-pull failure is retried after a fetch and the reconcile completes", async () => {
    const fx = track(makeFixture(["aa1101"]));
    let pullCalls = 0;
    const exec: Exec = (cmd, args, opts) => {
      if (cmd === "git" && args[0] === "pull" && args.includes("--ff-only")) {
        pullCalls++;
        if (pullCalls === 1) {
          return { stdout: "", stderr: "fatal: unable to access origin (transient)", exitCode: 1 };
        }
      }
      return realExec(cmd, args, opts);
    };
    const r = await runLoop(loopOpts(fx, "pull-retry-test", mulberry32(8), { exec }));
    expect(r.exitCode).toBe(0);
    expect(pullCalls).toBe(2);
    expect(mergedHashes(r.summary)).toEqual(["aa1101"]);
    // The retry succeeded, so the terminal-failure event never fired and
    // the backlog reconcile landed.
    const events = readEvents(fx.cacheDir, r.summary!.runId).map((e) => e.event);
    expect(events).not.toContain("item:pull-ff-failed");
    expect(readFileSync(join(fx.repoRoot, "DEV.md"), "utf8")).toContain(
      `- [x] \`${specRel("aa1101")}\``,
    );
  }, 60_000);

  it("a still-failing retry surfaces item:pull-ff-failed (unchanged terminal posture)", async () => {
    const fx = track(makeFixture(["aa1101"]));
    const exec: Exec = (cmd, args, opts) => {
      if (cmd === "git" && args[0] === "pull" && args.includes("--ff-only")) {
        return { stdout: "", stderr: "fatal: unable to access origin (down)", exitCode: 1 };
      }
      return realExec(cmd, args, opts);
    };
    const r = await runLoop(loopOpts(fx, "pull-retry-fail-test", mulberry32(9), { exec }));
    const events = readEvents(fx.cacheDir, r.summary!.runId).map((e) => e.event);
    expect(events).toContain("item:pull-ff-failed");
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Backlog-lock timeout during claim (debug-a7c3f9 — mlc104 review EC-8)
// ---------------------------------------------------------------------------
//
// Root cause (AC 2): mlc102 made the whole claim transaction one section
// under `locks/backlog.lock` (claim.ts's `backlogLock` seam), and chose
// "held is retryable contention" semantics AT THE CLI — `devx devx-helper
// claim` maps BacklogLockTimeoutError to exit 1 `{error: "backlog lock
// held"}` (devx-helper.ts:239, documented in the /devx skill body). The
// IN-PROCESS driver disagreed: its claim catch (driver.ts) had exactly two
// branches — ClaimContendedError → `claim-contended` (budget untouched) and
// everything else → `claim-failed` + `consecutiveClaimFailures++`. A
// BacklogLockTimeoutError fell into "everything else", so a live peer
// holding the lock past 30s counted toward MAX_CONSECUTIVE_CLAIM_FAILURES
// (3) and three waiting picks in a row stopped the night as a "systemic
// claim problem". mlc104 widened the locked section from 1 push to up to 5
// network ops (3 pushes + 2 rebase-pulls), so a slow remote × N loops makes
// 30s reachable with nothing broken — healthy contention, misdiagnosed.
//
// The fixtures below drive the REAL machinery: a peer's lock file (live pid
// ⇒ classifyExistingLock says held, no stale reap) parked before the claim,
// a real `withBacklogLock` acquire inside the claim seam, so the driver sees
// the genuine error the acquire path constructs — holder pid and all. The
// hold is taken INSIDE the claim seam because the driver's own admission
// section (`loop-admission`) runs under the same lock at startup.

/** A peer's lock body: our own pid is unambiguously live, and acquired_at
 *  = now can't trip the PID-recycling cross-check (this process started
 *  earlier), so the acquire classifies it "held" for the full deadline. */
function livePeerLockBody(): string {
  return JSON.stringify({ pid: process.pid, acquired_at: new Date().toISOString() }) + "\n";
}

function holdBacklogLock(fx: Fixture, body: string): void {
  const path = backlogLockPath(fx.cacheDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, "utf8");
}

/** Claim seam that parks a peer's hold and then takes the real lock with a
 *  short deadline — every claim raises a genuine BacklogLockTimeoutError. */
function lockBlockedClaim(
  fx: Fixture,
  body: string,
): (hash: string, type: string) => Promise<ClaimSpecResult> {
  return async (hash, type) => {
    holdBacklogLock(fx, body);
    return withBacklogLock(
      fx.cacheDir,
      `claim-${hash}`,
      () =>
        claimSpec(hash, {
          sessionId: "lock-timeout-test",
          repoRoot: fx.repoRoot,
          config: { git: MERGED.git },
          type,
        }),
      { timeoutMs: 60, pollMs: 10 },
    );
  };
}

describe("driver backlog-lock-timeout routing", () => {
  it("a live holder's timeout routes like contention — never the systemic claim rail", async () => {
    // 4 rows: pre-fix this produced 3 claim-failed in a row and stopped on
    // "systemic claim problem" under PURE contention (the AC 1 repro).
    const fx = track(makeFixture(["aa1101", "bb2202", "cc3303", "dd4404"]));
    const r = await runLoop(
      loopOpts(fx, "lock-timeout-live", mulberry32(11), {
        claim: lockBlockedClaim(fx, livePeerLockBody()),
      }),
    );
    expect(r.exitCode).toBe(0);
    const items = r.summary?.items ?? [];
    expect(items.filter((i) => i.outcome === "claim-failed")).toEqual([]);
    expect(items.map((i) => i.outcome)).toEqual([
      "claim-contended",
      "claim-contended",
      "claim-contended",
    ]);
    expect(r.summary?.stopReason ?? "").not.toMatch(/systemic claim problem/);
    // …but a holder that never lets go is still surfaced, on its OWN rail,
    // naming the pid to `ps` (AC 3's "without masking wedged holders").
    expect(r.summary?.stopReason ?? "").toMatch(/backlog-lock timeouts/);
    expect(r.summary?.stopReason ?? "").toMatch(new RegExp(`pid ${process.pid}\\b`));
    expect(items[0]?.detail ?? "").toMatch(/backlog lock timeout/);

    const events = readEvents(fx.cacheDir, r.summary!.runId).map((e) => e.event);
    expect(events).toContain("item:claim-lock-timeout");
    expect(events).not.toContain("item:claim-failed");
  }, 60_000);

  it("live-holder timeouts don't burn the item budget — the loop keeps walking rows", async () => {
    const fx = track(makeFixture(["aa1101", "bb2202"]));
    // maxItems 1: a lock-timeout pick is not an attempt, so the loop must
    // walk BOTH rows (masking each) instead of stopping after the first.
    const r = await runLoop(
      loopOpts(fx, "lock-timeout-budget", mulberry32(12), {
        claim: lockBlockedClaim(fx, livePeerLockBody()),
        flags: { maxItems: 1 },
      }),
    );
    expect(r.exitCode).toBe(0);
    expect(r.summary?.abortReason ?? null).toBeNull();
    expect((r.summary?.items ?? []).map((i) => i.outcome)).toEqual([
      "claim-contended",
      "claim-contended",
    ]);
    expect(r.summary?.stopReason).toMatch(/no eligible backlog items/);
  }, 60_000);

  it("a holder that isn't provably live still counts toward the systemic budget", async () => {
    // Empty body = a peer's mid-write window OR a corrupt lock: the
    // classifier conservatively calls it held (never reaps it), and the
    // holder pid is unreadable. Not provably live ⇒ no masking (design
    // §Risks: masking only applies to live-held locks) ⇒ the systemic rail.
    const fx = track(makeFixture(["aa1101", "bb2202", "cc3303", "dd4404"]));
    const r = await runLoop(
      loopOpts(fx, "lock-timeout-unreadable", mulberry32(13), {
        claim: lockBlockedClaim(fx, ""),
      }),
    );
    const items = r.summary?.items ?? [];
    expect(items.filter((i) => i.outcome === "claim-failed")).toHaveLength(3);
    expect(r.summary?.stopReason).toMatch(/systemic claim problem/);
    const events = readEvents(fx.cacheDir, r.summary!.runId).map((e) => e.event);
    expect(events).not.toContain("item:claim-lock-timeout");
  }, 60_000);
});
