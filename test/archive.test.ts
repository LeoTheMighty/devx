// arc101 — `devx archive` moves a CLOSED doc set out of the live tree, and
// back, without losing a file or a gate verdict.
//
// Spawns the real CLI: `git mv` and `git status` are the subject, so an
// in-process call would assert against a plan nobody executed. Registered in
// SYNC_BLOCKING_TESTS (vitest.shared.ts) for that reason, same as
// engine-layout-migrate.test.ts.
//
// The property that matters most is AC 3 — an archived workstream still
// RESOLVES. Archiving that hid a doc set from `devx status` would not be
// archiving, it would be deleting with extra steps.
//
// Spec: dev/dev-arc101-2026-09-03T11:00-devx-archive.md

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { ENGINE_DEFAULTS, engineConfigFrom } from "../src/lib/engine/config.js";
import { resolveWorkstream } from "../src/lib/engine/workstream.js";
import { type MigrateFs, realMigrateFs } from "../src/lib/layout/migrate.js";
import { planArchive } from "../src/lib/archive/plan.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(REPO_ROOT, "dist", "cli.js");

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

function devx(cwd: string, ...args: string[]): { code: number; out: string; err: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
  return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
}

interface Fixture {
  root: string;
  ws: string;
}

/** A repo with ONE workstream at the given stage, folder-shaped. */
function makeRepo(stage: string, opts: { extras?: boolean } = {}): Fixture {
  const root = mkdtempSync(join(tmpdir(), "arc101-"));
  dirs.push(root);
  git(root, "init", "-b", "main");
  git(root, "config", "user.email", "t@e.com");
  git(root, "config", "user.name", "T");
  git(root, "config", "commit.gpgsign", "false");

  writeFileSync(
    join(root, "devx.config.yaml"),
    ["mode: YOLO", "engine:", "  workstreams_root: _devx/workstreams", "  archive_root: _devx/archive", ""].join("\n"),
  );

  const ws = join(root, "_devx", "workstreams", "scene-engine");
  for (const sub of ["prd", "design", "decisions"]) {
    mkdirSync(join(ws, sub), { recursive: true });
  }
  writeFileSync(join(ws, "prd", "agent.md"), "# PRD\n");
  writeFileSync(join(ws, "prd", "human.md"), "# PRD digest\n");
  writeFileSync(join(ws, "design", "agent.md"), "# Design\n");
  writeFileSync(join(ws, "expectations.md"), "# E\n");
  writeFileSync(join(ws, "todo.md"), "# todo\n");
  writeFileSync(join(ws, "decisions", "2026-08-24-verify.md"), "# verify\n");
  if (opts.extras !== false) {
    // The shape EVERY closed workstream actually has, and the one that broke
    // the first implementation: a retro and a research dir the artifact map
    // cannot name.
    writeFileSync(join(ws, "RETRO-2026-08-24.md"), "# retro\n");
    mkdirSync(join(ws, "research"), { recursive: true });
    writeFileSync(join(ws, "research", "audit.md"), "# audit\n");
  }

  mkdirSync(join(root, "plan"), { recursive: true });
  writeFileSync(
    join(root, "plan", "plan-b7e38f-2026-08-24T10:25-scene-engine.md"),
    [
      "---",
      "hash: b7e38f",
      "type: plan",
      "title: Scene Engine",
      "status: in-progress",
      `stage: ${stage}`,
      "gate_status:",
      "  prd_validated: true",
      "  design_verified: true",
      "  plan_verified: false",
      "  evals_red: false",
      "workstream: _devx/workstreams/scene-engine",
      "gate_verdicts:",
      "  prd: PASS",
      "  design: PASS",
      "---",
      "",
      "## Goal",
      "Demo.",
      "",
    ].join("\n"),
  );

  git(root, "add", "-A");
  git(root, "commit", "-m", "base");
  return { root, ws };
}

describe("devx archive — the liveness rule", () => {
  it("refuses a workstream that is still in flight, naming the stage", () => {
    const { root } = makeRepo("plan");
    const r = devx(root, "archive", "b7e38f");
    expect(r.code).toBe(1);
    expect(r.err).toContain("[workstream-live]");
    expect(r.err).toContain("stage: plan");
    // 0 files moved is the property, not just the exit code.
    expect(git(root, "status", "--porcelain").trim()).toBe("");
  });

  it("archives a done workstream", () => {
    const { root } = makeRepo("done");
    const r = devx(root, "archive", "b7e38f");
    expect(r.code).toBe(0);
    expect(existsSync(join(root, "_devx", "archive", "scene-engine", "prd", "agent.md"))).toBe(true);
    expect(existsSync(join(root, "_devx", "workstreams", "scene-engine"))).toBe(false);
  });

  it("accepts a retired workstream too", () => {
    const { root } = makeRepo("retired");
    expect(devx(root, "archive", "b7e38f").code).toBe(0);
  });
});

describe("devx archive — nothing is left behind", () => {
  it("moves the retro and research dir the artifact map cannot name", () => {
    // The first implementation refused `unmapped-doc-set-files` here, which is
    // right for a LAYOUT migration and wrong for an archive: the doc set owns
    // its directory outright, so everything in it travels.
    const { root } = makeRepo("done");
    const r = devx(root, "archive", "b7e38f");
    expect(r.code).toBe(0);
    const arc = join(root, "_devx", "archive", "scene-engine");
    expect(existsSync(join(arc, "RETRO-2026-08-24.md"))).toBe(true);
    expect(existsSync(join(arc, "research", "audit.md"))).toBe(true);
    expect(existsSync(join(arc, "decisions", "2026-08-24-verify.md"))).toBe(true);
  });

  it("preserves git history across the move (git mv, not rewrite)", () => {
    const { root } = makeRepo("done");
    expect(devx(root, "archive", "b7e38f").code).toBe(0);
    git(root, "commit", "-am", "archived");
    const log = git(
      root,
      "log",
      "--follow",
      "--oneline",
      "--",
      "_devx/archive/scene-engine/prd/agent.md",
    );
    expect(log.split("\n").filter((l) => l.trim() !== "").length).toBeGreaterThanOrEqual(2);
  });
});

describe("devx archive — the spec still resolves (AC 3)", () => {
  it("re-points `workstream:` and leaves every gate verdict untouched", () => {
    const { root } = makeRepo("done");
    const specRel = "plan/plan-b7e38f-2026-08-24T10:25-scene-engine.md";
    const before = readFileSync(join(root, specRel), "utf8");
    expect(devx(root, "archive", "b7e38f").code).toBe(0);
    const after = readFileSync(join(root, specRel), "utf8");

    expect(after).toContain("workstream: _devx/archive/scene-engine");
    // Everything else is byte-identical — the verdicts live in the spec, and
    // the spec does not move.
    expect(after.replace(/^workstream: .*$/m, "")).toBe(
      before.replace(/^workstream: .*$/m, ""),
    );
    expect(after).toContain("prd: PASS");
    expect(after).toContain("design: PASS");
  });

  it("resolveWorkstream follows the pointer to the archive", () => {
    // The property AC 3 actually names. NOT `devx status`: that lists ACTIVE
    // workstreams, and an archived one is `stage: done` by definition, so its
    // absence there is correct and says nothing about resolution.
    const { root } = makeRepo("done");
    expect(devx(root, "archive", "b7e38f").code).toBe(0);
    const engine = engineConfigFrom({
      engine: { workstreams_root: "_devx/workstreams", archive_root: "_devx/archive" },
    });
    const resolved = resolveWorkstream(root, "b7e38f", engine);
    expect(resolved.workstreamAbs).toBe(join(root, "_devx", "archive", "scene-engine"));
    expect(existsSync(join(resolved.workstreamAbs, "prd", "agent.md"))).toBe(true);
  });
});

describe("devx archive — round trip", () => {
  it("--restore puts every file back at its original path", () => {
    const { root } = makeRepo("done");
    const listed = () =>
      git(root, "ls-files").split("\n").filter((l) => l.trim() !== "").sort();
    const before = listed();

    expect(devx(root, "archive", "b7e38f").code).toBe(0);
    // `-a`: `git mv` staged the renames, but the spec's `workstream:` rewrite
    // is an unstaged edit. A bare `commit -m` would leave the tree dirty and
    // the restore below would correctly refuse [dirty-tree] — the same
    // clean-tree precondition `layout migrate` carries.
    git(root, "commit", "-am", "archived");
    expect(devx(root, "archive", "b7e38f", "--restore").code).toBe(0);
    git(root, "commit", "-am", "restored");

    expect(listed()).toEqual(before);
    expect(readFileSync(join(root, "plan/plan-b7e38f-2026-08-24T10:25-scene-engine.md"), "utf8"))
      .toContain("workstream: _devx/workstreams/scene-engine");
  });
});

describe("devx archive — refusals", () => {
  it("--dry-run moves nothing and predicts the real run", () => {
    const { root } = makeRepo("done");
    const r = devx(root, "archive", "b7e38f", "--dry-run");
    expect(r.code).toBe(0);
    expect(r.out).toContain("dry run — 0 of");
    expect(git(root, "status", "--porcelain").trim()).toBe("");
    expect(existsSync(join(root, "_devx", "workstreams", "scene-engine"))).toBe(true);
  });

  it("refuses a dirty tree", () => {
    const { root } = makeRepo("done");
    writeFileSync(join(root, "dirt.txt"), "x\n");
    const r = devx(root, "archive", "b7e38f");
    expect(r.code).toBe(1);
    expect(r.err).toContain("[dirty-tree]");
  });

  it("refuses when the destination is already occupied", () => {
    const { root } = makeRepo("done");
    mkdirSync(join(root, "_devx", "archive", "scene-engine", "prd"), { recursive: true });
    writeFileSync(join(root, "_devx", "archive", "scene-engine", "prd", "agent.md"), "old\n");
    git(root, "add", "-A");
    git(root, "commit", "-m", "prior archive");
    const r = devx(root, "archive", "b7e38f");
    expect(r.code).toBe(1);
    expect(r.err).toContain("[destination-occupied]");
  });

  it("refuses an unknown target", () => {
    const { root } = makeRepo("done");
    const r = devx(root, "archive", "nosuch");
    expect(r.code).toBe(1);
    expect(r.err).toContain("[no-workstream]");
  });

  it("has no --force", () => {
    const { root } = makeRepo("plan");
    const r = devx(root, "archive", "b7e38f", "--force");
    expect(r.code).not.toBe(0);
    expect(git(root, "status", "--porcelain").trim()).toBe("");
  });
});

describe("arc101 — the planner is pure, and shares the mover", () => {
  it("planArchive writes nothing and runs no subprocess", () => {
    const { root } = makeRepo("done");
    const before = git(root, "status", "--porcelain");
    const engine = engineConfigFrom({
      engine: { workstreams_root: "_devx/workstreams", archive_root: "_devx/archive" },
    });
    const plan = planArchive({
      fs: realMigrateFs as MigrateFs,
      repoRoot: root,
      engine,
      target: "b7e38f",
      restore: false,
    });
    expect(plan.moves.length).toBeGreaterThan(0);
    expect(plan.refusals).toEqual([]);
    expect(git(root, "status", "--porcelain")).toBe(before);
  });

  it("archive and layout migrate share ONE executor (AC 6)", async () => {
    // Not a style assertion: two copies of the move/spec-rewrite ordering are
    // two things that can drift, and the ordering is the whole recovery story.
    const archiveSrc = readFileSync(join(REPO_ROOT, "src/commands/archive.ts"), "utf8");
    const layoutSrc = readFileSync(join(REPO_ROOT, "src/commands/layout.ts"), "utf8");
    for (const src of [archiveSrc, layoutSrc]) {
      expect(src).toContain("executeMigration");
      expect(src).toContain('from "../lib/layout/migrate.js"');
    }
    // And the planner reuses the mover rather than re-walking the map itself.
    const planSrc = readFileSync(join(REPO_ROOT, "src/lib/archive/plan.ts"), "utf8");
    expect(planSrc).toContain("buildDocSetMoves");

    const mod = await import("../src/lib/layout/migrate.js");
    expect(typeof mod.executeMigration).toBe("function");
    expect(typeof mod.buildDocSetMoves).toBe("function");
  });

  it("engine.archive_root is READ, with a default (the inert-key fix)", () => {
    expect(ENGINE_DEFAULTS.archiveRoot).toBe("_devx/archive");
    expect(engineConfigFrom({ engine: { archive_root: "docs/attic/" } }).archiveRoot).toBe(
      "docs/attic",
    );
    expect(engineConfigFrom({}).archiveRoot).toBe("_devx/archive");
  });
});
