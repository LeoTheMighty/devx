// The loop merge tail keeps GRAPH.md fresh (debug-8a9586 — FR-4's fourth
// regen host).
//
// E-5 (`_devx/workstreams/story-graph/evals/E-5_loop-freshness.ts`) pins the
// three ATTENDED flows — claim, `mark-done`, RED emission — each leaving
// `devx graph --check` at exit 0 with no manual regen between them. The loop's
// own merge tail is a fourth state-flipping flow and neither sgr104 nor sgr105
// touched it, so every overnight-merged item used to leave the board stale
// until the next attended claim happened to refresh it. This file is the
// loop-side analogue of E-5's `mark-done` leg (AC 1).
//
// The assertions run the REAL `runGraph({check:true})` against the fixture
// after a full `runLoop`, so they fail the same way the operator's gate would.
//
// Spec: debug/debug-8a9586-2026-08-05T11:47-loop-merge-tail-no-regen-host.md

import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { runGraph } from "../src/commands/graph.js";
import { GRAPH_FILENAME, type RegenFn } from "../src/lib/graph/regen.js";
import { runLoop } from "../src/lib/loop/driver.js";
import { readEvents } from "../src/lib/loop/state.js";
import { type TailFn } from "../src/lib/loop/tail.js";
import {
  MERGED,
  g,
  makeFixture,
  mergedTail,
  scriptedWorker,
  type Fixture,
} from "./helpers/loop-git-fixture.js";

/** The devx repo's own root — the source of the config the fixture copies,
 *  exactly as test/graph-cli.test.ts and the eval fixture do. Hand-rolling a
 *  minimal config here would let this suite drift from the schema. */
const realRepoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Per-test cap. Measured: every case here runs 1.1–1.3s in isolation
 *  (2026-08-19, 12-core macOS). 30s is ~25x headroom for pass 2's
 *  maxForks:2 contention — generous, but a REAL cap, not the default
 *  5s these git-heavy cases would flake against under load
 *  (debug-5c8b21 measured 16 suite tests running past their own caps). */
const TEST_CAP = 30_000;

let fixture: Fixture | null = null;
afterEach(() => {
  if (fixture) {
    rmSync(fixture.base, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
  fixture = null;
});

/**
 * Give the fixture the two things `devx graph` needs and the loop fixture
 * doesn't ship: a devx.config.yaml at the root, and a committed baseline
 * GRAPH.md. Returns the baseline board so callers can prove it CHANGED —
 * "`--check` is 0" alone would also pass on a board that was already stale
 * in a way the render happens to reproduce.
 */
function seedBoard(fx: Fixture): string {
  copyFileSync(join(realRepoRoot, "devx.config.yaml"), join(fx.repoRoot, "devx.config.yaml"));
  const code = runGraph({ cwd: fx.repoRoot, out: () => {}, err: () => {} });
  expect(code).toBe(0);
  const baseline = readFileSync(join(fx.repoRoot, GRAPH_FILENAME), "utf8");
  g(fx.repoRoot, "add", "-A");
  g(fx.repoRoot, "commit", "-q", "-m", "chore: baseline GRAPH.md");
  g(fx.repoRoot, "push", "-q", "origin", "main");
  return baseline;
}

/** The operator's gate, in-process. 0 = the committed board matches a fresh
 *  render; 1 = drift (what a stale board looks like in CI). */
function graphCheck(fx: Fixture): number {
  return runGraph({ cwd: fx.repoRoot, check: true, out: () => {}, err: () => {} });
}

const shipStep = {
  kind: "report" as const,
  files: { "shipped.txt": "shipped\n" },
  report: {
    summary: "shipped it",
    key_changes_made: ["shipped.txt"],
    key_learnings: [],
    acs_met: true,
  },
};

describe("loop merge tail — GRAPH.md freshness (debug-8a9586)", () => {
  it("AC 1/AC 2: a loop-merged item leaves `devx graph --check` at exit 0, board committed", async () => {
    fixture = makeFixture([{ hash: "gph111", title: "Board item" }]);
    const baseline = seedBoard(fixture);
    expect(graphCheck(fixture)).toBe(0);

    const { worker } = scriptedWorker([shipStep]);
    const { tail } = mergedTail();
    const r = await runLoop({
      repoRoot: fixture.repoRoot,
      merged: MERGED,
      out: () => {},
      heartbeatIntervalMs: 3_600_000,
      worker,
      tail,
    });

    expect(r.exitCode).toBe(0);
    expect(r.summary!.items[0].outcome).toBe("merged");

    // The row flipped …
    expect(readFileSync(join(fixture.repoRoot, "DEV.md"), "utf8")).toMatch(
      /- \[x\] `dev\/dev-gph111/,
    );
    // … and the board flipped with it, in the same run. This is the whole
    // spec: before the fix `--check` exited 1 here because the tail never
    // regenerated.
    const after = readFileSync(join(fixture.repoRoot, GRAPH_FILENAME), "utf8");
    expect(after).not.toBe(baseline);
    expect(graphCheck(fixture)).toBe(0);

    // AC 2: the board rode along in the CLEANUP COMMIT's pathspec, not left
    // dirty on main for the next session to trip over. `commitOnMain` is
    // pathspec-limited, so an unnamed GRAPH.md would show up here.
    expect(g(fixture.repoRoot, "status", "--porcelain")).not.toContain(GRAPH_FILENAME);
    const committed = execFileSync(
      "git",
      ["show", "--name-only", "--format=", "HEAD"],
      { cwd: fixture.repoRoot, encoding: "utf8" },
    );
    expect(committed).toContain(GRAPH_FILENAME);
    // Pushed, too — the morning's `git status` on main must be clean.
    expect(
      execFileSync("git", ["--git-dir", fixture.origin, "show", "--name-only", "--format=", "main"], {
        encoding: "utf8",
      }),
    ).toContain(GRAPH_FILENAME);
  }, TEST_CAP);

  it("AC 3: the split-FAILED `[-]` blocked flip refreshes the board too", async () => {
    fixture = makeFixture([{ hash: "gph222", title: "Failing splitter" }]);
    const baseline = seedBoard(fixture);

    const { worker } = scriptedWorker([
      {
        kind: "report",
        files: { "half.txt": "half\n" },
        report: {
          summary: "shipped the first half",
          key_changes_made: ["half.txt"],
          split_request: { title: "Second half", remaining_acs: ["the second half works"] },
        },
      },
    ]);
    // Break the split at its resolve stage the way loop-driver.test.ts does:
    // drop the parent's DEV.md row between the claim and the split, so
    // performSplit has nothing to splice after and the tail falls back to the
    // `[-]` blocked branch.
    const tail: TailFn = async () => {
      const devMd = join(fixture!.repoRoot, "DEV.md");
      writeFileSync(
        devMd,
        readFileSync(devMd, "utf8")
          .split("\n")
          .filter((l) => !l.includes("dev-gph222"))
          .join("\n"),
        "utf8",
      );
      return { outcome: "merged", prUrl: "https://github.com/x/y/pull/14", prNumber: 14 };
    };
    const r = await runLoop({
      repoRoot: fixture.repoRoot,
      merged: MERGED,
      out: () => {},
      heartbeatIntervalMs: 3_600_000,
      worker,
      tail,
      flags: { maxItems: 1 },
    });

    expect(r.summary!.items[0].leftState).toBe("blocked");
    expect(
      readFileSync(join(fixture.repoRoot, fixture.specRel({ hash: "gph222" })), "utf8"),
    ).toContain("status: blocked");

    // A blocked flip is a state change, so the board must move with it.
    const after = readFileSync(join(fixture.repoRoot, GRAPH_FILENAME), "utf8");
    expect(after).not.toBe(baseline);
    expect(graphCheck(fixture)).toBe(0);
    expect(g(fixture.repoRoot, "status", "--porcelain")).not.toContain(GRAPH_FILENAME);
  }, TEST_CAP);

  it("a merged tail with a SUCCESSFUL split commits the follow-up spec AND the board together", async () => {
    // The pathspec interaction worth pinning: `commitOnMain` `git add`s the
    // extras as ONE list, and a failure there drops ALL of them. So the board
    // joining the follow-up spec must not cost the follow-up its commit — and
    // the board must render the follow-up, which only exists because the split
    // ran moments earlier.
    fixture = makeFixture([{ hash: "gph666", title: "Good splitter" }]);
    seedBoard(fixture);
    const { worker } = scriptedWorker([
      {
        kind: "report",
        files: { "half.txt": "half\n" },
        report: {
          summary: "shipped the first half",
          key_changes_made: ["half.txt"],
          split_request: { title: "Second half", remaining_acs: ["the second half works"] },
        },
      },
    ]);
    const { tail } = mergedTail();
    const r = await runLoop({
      repoRoot: fixture.repoRoot,
      merged: MERGED,
      out: () => {},
      heartbeatIntervalMs: 3_600_000,
      worker,
      tail,
      flags: { maxItems: 1 },
    });

    const followUpPath = r.summary!.items[0].followUpSpecPath;
    expect(followUpPath).toBeTruthy();

    const committed = execFileSync("git", ["show", "--name-only", "--format=", "HEAD"], {
      cwd: fixture.repoRoot,
      encoding: "utf8",
    });
    expect(committed).toContain(followUpPath!);
    expect(committed).toContain(GRAPH_FILENAME);
    // The board knows about a spec that did not exist when the item was
    // claimed, and nothing is left dirty on main.
    expect(readFileSync(join(fixture.repoRoot, GRAPH_FILENAME), "utf8")).toContain(
      followUpPath!.replace(/^dev\/dev-([a-z0-9]+).*$/, "$1"),
    );
    expect(g(fixture.repoRoot, "status", "--porcelain")).toBe("");
    expect(graphCheck(fixture)).toBe(0);
  }, TEST_CAP);

  it("a FAILING regen warns and continues — the merge bookkeeping still lands", async () => {
    fixture = makeFixture([{ hash: "gph333", title: "Bad render" }]);
    seedBoard(fixture);
    const { worker } = scriptedWorker([shipStep]);
    const { tail } = mergedTail();
    const regen: RegenFn = () => ({ ok: false, warning: "GRAPH.md not regenerated: cycle" });

    const r = await runLoop({
      repoRoot: fixture.repoRoot,
      merged: MERGED,
      out: () => {},
      heartbeatIntervalMs: 3_600_000,
      worker,
      tail,
      regen,
    });

    // The merge that already landed on origin is NOT undone by a bad render.
    expect(r.exitCode).toBe(0);
    const item = r.summary!.items[0];
    expect(item.outcome).toBe("merged");
    expect(readFileSync(join(fixture.repoRoot, "DEV.md"), "utf8")).toMatch(
      /- \[x\] `dev\/dev-gph333/,
    );
    // But the human is told the board is now stale, and the event is on the
    // record for the morning report.
    expect((item.warnings ?? []).join("\n")).toMatch(/cycle[\s\S]*devx graph/);
    expect(readEvents(fixture.cacheDir, r.summary!.runId).map((e) => e.event)).toContain(
      "item:graph-regen-failed",
    );
  }, TEST_CAP);

  it("a THROWING regen hook is contained — same warn-and-continue posture", async () => {
    fixture = makeFixture([{ hash: "gph444", title: "Throwing render" }]);
    seedBoard(fixture);
    const { worker } = scriptedWorker([shipStep]);
    const { tail } = mergedTail();
    const regen: RegenFn = () => {
      throw new Error("ENOSPC writing the board");
    };

    const r = await runLoop({
      repoRoot: fixture.repoRoot,
      merged: MERGED,
      out: () => {},
      heartbeatIntervalMs: 3_600_000,
      worker,
      tail,
      regen,
    });

    // Only the DEFAULT regen carries the never-throws guarantee; an injected
    // one escaping the tail would skip the commit that closes the item.
    expect(r.exitCode).toBe(0);
    const item = r.summary!.items[0];
    expect(item.outcome).toBe("merged");
    expect((item.warnings ?? []).join("\n")).toContain("ENOSPC writing the board");
    expect(readFileSync(join(fixture.repoRoot, "DEV.md"), "utf8")).toMatch(
      /- \[x\] `dev\/dev-gph444/,
    );
    expect(g(fixture.repoRoot, "status", "--porcelain")).toBe("");
  }, TEST_CAP);

  it("a gitignored GRAPH.md is regenerated but kept OUT of the pathspec", async () => {
    fixture = makeFixture([{ hash: "gph555", title: "Ignored board" }]);
    seedBoard(fixture);
    // Ignore the board AFTER committing it, then drop it from the index —
    // `git add` refuses an ignored path for the WHOLE pathspec, so naming it
    // would take the done-flip commit down with it.
    appendFileSync(join(fixture.repoRoot, ".gitignore"), `${GRAPH_FILENAME}\n`, "utf8");
    g(fixture.repoRoot, "rm", "-q", "--cached", GRAPH_FILENAME);
    g(fixture.repoRoot, "add", "-A");
    g(fixture.repoRoot, "commit", "-q", "-m", "chore: gitignore the board");
    g(fixture.repoRoot, "push", "-q", "origin", "main");

    const { worker } = scriptedWorker([shipStep]);
    const { tail } = mergedTail();
    const r = await runLoop({
      repoRoot: fixture.repoRoot,
      merged: MERGED,
      out: () => {},
      heartbeatIntervalMs: 3_600_000,
      worker,
      tail,
    });

    expect(r.summary!.items[0].outcome).toBe("merged");
    // The bookkeeping commit still landed …
    expect(readFileSync(join(fixture.repoRoot, "DEV.md"), "utf8")).toMatch(
      /- \[x\] `dev\/dev-gph555/,
    );
    // … the board was still rendered on disk for whoever reads it …
    expect(existsSync(join(fixture.repoRoot, GRAPH_FILENAME))).toBe(true);
    // … and it is not in the commit, because git would have refused it.
    expect(
      execFileSync("git", ["show", "--name-only", "--format=", "HEAD"], {
        cwd: fixture.repoRoot,
        encoding: "utf8",
      }),
    ).not.toContain(GRAPH_FILENAME);
    expect(readEvents(fixture.cacheDir, r.summary!.runId).map((e) => e.event)).toContain(
      "item:graph-regen-gitignored",
    );
  }, TEST_CAP);
});
