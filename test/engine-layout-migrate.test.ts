// dlr106 — `devx layout migrate` moves the doc set and preserves every gate
// verdict across the move.
//
// Consumer of E-6 (`_devx/workstreams/docs-layout-resolution/evals/E-6_migrate.ts`),
// pinned in `npm test` so the invariant survives the workstream that created
// it. E-6 proves the mechanism on a fixture reproducing ClassyLights `b7e38f`;
// this file pins that same mechanism plus the two properties E-6 has no way to
// see — that the planner is genuinely pure, and that the round trip is lossless.
//
// It SPAWNS the real CLI, which is why it is registered in
// `SYNC_BLOCKING_TESTS` (vitest.shared.ts): `git mv` and `git status` are the
// subject, and an in-process call would assert against a plan nobody executed.
//
// Spec: dev/dev-dlr106-2026-09-02T09:14-layout-migrate.md
// Plan: _devx/workstreams/docs-layout-resolution/plan/agent.md §6

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import type { DocsLayout } from "../src/lib/engine/artifacts.js";
import { ENGINE_DEFAULTS } from "../src/lib/engine/config.js";
import {
  type MigrateFs,
  planLayoutMigration,
} from "../src/lib/layout/migrate.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(repoRoot, "src", "cli.ts");
// Resolved through Node's module walk, never constructed: a linked worktree
// has no node_modules of its own, and a spawn failure there produces empty
// output that reads exactly like a legitimate failure (mlc101).
const tsxCliEntry = createRequire(import.meta.url).resolve("tsx/cli");

const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr ?? ""}`);
  }
  return r.stdout ?? "";
}

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd: string): CliResult {
  const r = spawnSync(process.execPath, [tsxCliEntry, cliPath, ...args], {
    cwd,
    env: GIT_ENV,
    encoding: "utf8",
    timeout: 120_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** A spawn that produced nothing on EITHER stream never ran the CLI — a
 *  harness fault wearing a result's clothes (mlc101). */
function assertRan(res: CliResult, what: string): void {
  if (res.stdout.trim() === "" && res.stderr.trim() === "") {
    throw new Error(
      `INFRA — \`${what}\` produced no output on either stream (status ${res.status}); the CLI did not run.`,
    );
  }
}

const roots: string[] = [];

const SLUG = "scene-engine";
const HASH = "b7e38f";

/** The human-only outline, in each layout's spelling. AC 8 turns on these
 *  moving like any other artifact: the PreToolUse guard denies AGENT writes,
 *  and the CLI is not an agent — a migration that moved everything except the
 *  human's outlines would break the tree where the human cares most. */
const PRD_OUTLINE_FLAT = "prd-outline.md";
const PRD_OUTLINE_NESTED = "prd/outline.md";
const SPEC_NAME = `plan-${HASH}-2026-09-02T09:00-${SLUG}.md`;

/**
 * A repo reproducing ClassyLights `b7e38f`: stage `plan`, Gates 1 and 2
 * already passed, a doc set on disk in the given layout.
 *
 * `withPlanArtifact` is off by default and that is not laziness: under
 * `project-level` the plan artifact's flat name is `plan.md`, which collides
 * case-insensitively with the `PLAN.md` backlog this fixture also writes
 * (debug-135dc9). Migrating a repo that HAS authored a plan is therefore a
 * refusal, and it gets its own test in the refusals file rather than being
 * quietly excluded here.
 */
function fixture(
  layout: DocsLayout,
  opts: { withPlanArtifact?: boolean } = {},
): { root: string; specAbs: string; docSet: (rel: string) => string } {
  const root = mkdtempSync(join(tmpdir(), `dlr106-${layout}-`));
  roots.push(root);
  git(root, "init", "-b", "main");

  writeFileSync(
    join(root, "devx.config.yaml"),
    [
      "mode: YOLO",
      "git:",
      "  default_branch: main",
      "  integration_branch: null",
      "engine:",
      "  workstreams_root: _devx/workstreams",
      `  docs_layout: ${layout}   # inline comment must survive the write`,
      "  expectations_min: 3",
      "",
    ].join("\n"),
  );
  writeFileSync(join(root, ".gitignore"), ".devx-cache/\n");
  for (const f of ["DEV.md", "PLAN.md", "MANUAL.md", "INTERVIEW.md"]) {
    writeFileSync(join(root, f), `# ${f.replace(".md", "")}\n`);
  }
  cpSync(
    join(repoRoot, "_devx", "templates", "engine"),
    join(root, "_devx", "templates", "engine"),
    { recursive: true },
  );

  const flat = layout === "project-level";
  const docSetRel = flat ? "." : `_devx/workstreams/${SLUG}`;
  const docSet = (rel: string): string =>
    join(root, ...(flat ? rel.split("/") : [...docSetRel.split("/"), ...rel.split("/")]));

  mkdirSync(join(root, "plan"), { recursive: true });
  const specAbs = join(root, "plan", SPEC_NAME);
  writeFileSync(
    specAbs,
    [
      "---",
      `hash: ${HASH}`,
      "type: plan",
      "created: 2026-09-02T09:00:00-06:00",
      `title: Fixture ${SLUG}`,
      "status: in-progress",
      "stage: plan",
      "entered_at: prd",
      "gate_status:",
      "  prd_validated: true",
      "  design_verified: true",
      "  plan_verified: false",
      "  evals_red: false",
      "outcome:",
      "  status: null",
      "  measure_by: null",
      `workstream: ${docSetRel}`,
      "gate_verdicts:",
      "  prd: PASS",
      "  design: PASS",
      "---",
      "",
      "## Goal",
      "",
      `Fixture workstream ${SLUG}.`,
      "",
    ].join("\n"),
  );

  const write = (rel: string, body: string): void => {
    const abs = docSet(rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  };
  write(flat ? "prd.md" : "prd/agent.md", "# PRD\n");
  write(flat ? "prd-human.md" : "prd/human.md", "# PRD (human)\n");
  write(flat ? "design.md" : "design/agent.md", "# Design\n");
  write(flat ? "design-human.md" : "design/human.md", "# Design (human)\n");
  write(flat ? PRD_OUTLINE_FLAT : PRD_OUTLINE_NESTED, "- a bullet the human typed\n");
  write("expectations.md", "# Expectations\n");
  write("todo.md", "# Todo\n");
  write("decisions/2026-08-01-design-verify.md", "# Design verify\n\nPASS.\n");
  write("decisions/2026-08-02-prd-critique.md", "# PRD critique\n");
  write("checkpoints/.gitkeep", "");
  write("evals/E-1_fixture.ts", "// e1\n");
  if (opts.withPlanArtifact === true) write(flat ? "plan.md" : "plan/agent.md", "# Plan\n");

  git(root, "add", "-A");
  git(root, "commit", "-m", "fixture: init", "--no-gpg-sign");
  return { root, specAbs, docSet };
}

/** Every file the `workstream` fixture carries, at its flat counterpart.
 *  Spelled out rather than derived from the resolver under test — a derived
 *  expectation agrees with the implementation by construction. */
const MIGRATED_FILES = [
  "prd.md",
  "prd-human.md",
  "design.md",
  "design-human.md",
  PRD_OUTLINE_FLAT, // AC 8 — the human-only outline moves with the rest
  "expectations.md",
  "todo.md",
  "decisions/2026-08-01-design-verify.md",
  "decisions/2026-08-02-prd-critique.md",
  "checkpoints/.gitkeep",
  "evals/E-1_fixture.ts",
] as const;

/** Every file under `root` (git-visible or not), path → contents; directories
 *  recorded too. The witness for "this function wrote nothing": a porcelain
 *  comparison alone would miss a write to an ignored path or a stray `mkdir`. */
function treeSnapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dirAbs: string, prefix: string): void => {
    for (const name of readdirSync(dirAbs).sort()) {
      if (name === ".git") continue;
      const abs = join(dirAbs, name);
      const rel = prefix === "" ? name : `${prefix}/${name}`;
      if (statSync(abs).isDirectory()) {
        out[`${rel}/`] = "";
        walk(abs, rel);
      } else {
        out[rel] = readFileSync(abs, "utf8");
      }
    }
  };
  walk(root, "");
  return out;
}

/** Frontmatter lines for the two blocks a migration must not touch. */
function gateBlocks(specAbs: string): string {
  const fm = /^---\n([\s\S]*?)\n---/.exec(readFileSync(specAbs, "utf8"))?.[1] ?? "";
  return fm
    .split("\n")
    .filter((l) =>
      /^(gate_status:|gate_verdicts:|\s{2}(prd_validated|design_verified|plan_verified|evals_red|prd|design|plan|evals):)/.test(
        l,
      ),
    )
    .join("\n");
}

const porcelain = (root: string): string =>
  git(root, "status", "--porcelain=v1", "-uall");

afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

describe("dlr106 — devx layout migrate", () => {
  it("[workstream → project-level] moves the whole doc set and preserves both gate verdicts (E-6)", () => {
    const { root, specAbs } = fixture("workstream");
    const before = gateBlocks(specAbs);
    expect(before).toContain("prd: PASS");

    const res = runCli(["layout", "migrate", "--to", "project-level"], root);
    assertRan(res, "devx layout migrate --to project-level");
    expect(res.status, `${res.stderr}${res.stdout}`).toBe(0);

    for (const rel of MIGRATED_FILES) {
      expect(existsSync(join(root, ...rel.split("/"))), `${rel} did not land`).toBe(true);
    }
    // Moved, not copied.
    expect(existsSync(join(root, "_devx", "workstreams", SLUG, "prd", "agent.md"))).toBe(
      false,
    );

    // `git mv`, not delete+create: history has to survive the rename — for
    // EVERY file, not just one. `toBeGreaterThan(0)` would pass a regression
    // where a single path used `git mv` and the rest were copy+delete, which
    // is exactly the history loss this exists to pin against.
    const renames = git(root, "status", "--porcelain=v1", "-uall", "--find-renames")
      .split("\n")
      .filter((l) => /^R/.test(l.trim()));
    expect(renames.length).toBe(MIGRATED_FILES.length);

    // The whole point (AC 3): gate state lives in the SPEC, so it survives by
    // construction — nothing copies it, so nothing can drop it.
    expect(gateBlocks(specAbs)).toBe(before);
    // …and the one field that DOES change, changed.
    expect(readFileSync(specAbs, "utf8")).toMatch(/^workstream: \.$/m);
    // The config write preserves its inline comment (setLeaf, AC 4).
    const cfg = readFileSync(join(root, "devx.config.yaml"), "utf8");
    expect(cfg).toMatch(/docs_layout: project-level\s+# inline comment must survive/);
  });

  it("[project-level → workstream] is a lossless round trip — the documented rollback (R-5)", () => {
    const { root } = fixture("workstream");
    expect(runCli(["layout", "migrate", "--to", "project-level"], root).status).toBe(0);
    git(root, "add", "-A");
    git(root, "commit", "-m", "forward", "--no-gpg-sign");

    // The emptied source directory must be GONE. `docSetPresentAt` reads a
    // workstream directory's mere existence as a doc set, so a leftover empty
    // `_devx/workstreams/<slug>/` would make this reverse migration refuse
    // with `destination-occupied` — taking away the only rollback R-5 has.
    expect(existsSync(join(root, "_devx", "workstreams", SLUG))).toBe(false);

    const back = runCli(["layout", "migrate", "--to", "workstream"], root);
    assertRan(back, "devx layout migrate --to workstream");
    expect(back.status, `${back.stderr}${back.stdout}`).toBe(0);
    git(root, "add", "-A");
    git(root, "commit", "-m", "back", "--no-gpg-sign");

    // Byte-identical to where it started, two migrations ago — every artifact,
    // the plan spec, all of it.
    //
    // `devx.config.yaml` is excluded, and it is the only exclusion: `setLeaf`
    // preserves an inline comment across a scalar write but normalizes the
    // run of spaces before its `#` to one (yaml's serializer, verified against
    // `setLeaf` directly — pre-existing behaviour, unrelated to this phase).
    // The VALUE round-trips exactly, which is what the layout knob has to do;
    // asserting the whitespace would pin a yaml-library detail as if it were a
    // migration invariant.
    expect(
      git(root, "diff", "--stat", "HEAD~2", "HEAD", "--", ".", ":(exclude)devx.config.yaml").trim(),
    ).toBe("");
    expect(readFileSync(join(root, "devx.config.yaml"), "utf8")).toMatch(
      /docs_layout: workstream\s+# inline comment must survive/,
    );
  });

  it("--dry-run renders every move and makes none of them (AC 6)", () => {
    const { root } = fixture("workstream");
    const before = porcelain(root);
    const res = runCli(["layout", "migrate", "--to", "project-level", "--dry-run"], root);
    assertRan(res, "devx layout migrate --dry-run");
    expect(res.status, `${res.stderr}${res.stdout}`).toBe(0);
    expect(res.stdout).toContain("prd.md");
    expect(res.stdout).toContain("dry run — 0 of");
    expect(porcelain(root)).toBe(before);
    expect(existsSync(join(root, "prd.md"))).toBe(false);
    // The config is the last thing a real run writes; a dry run writes none of it.
    expect(readFileSync(join(root, "devx.config.yaml"), "utf8")).toContain(
      "docs_layout: workstream",
    );
  });

  it("migrating to the layout the repo is already in is a no-op, not a refusal", () => {
    const { root } = fixture("workstream");
    const before = porcelain(root);
    const res = runCli(["layout", "migrate", "--to", "workstream"], root);
    assertRan(res, "devx layout migrate --to workstream");
    expect(res.status, `${res.stderr}${res.stdout}`).toBe(0);
    expect(res.stdout).toContain("already at 'workstream'");
    expect(porcelain(root)).toBe(before);
  });

  it("planLayoutMigration is PURE — it computes a real plan and changes nothing (AC 1)", () => {
    // Purity is what makes `--dry-run` structural rather than careful, so it
    // is asserted against the FILESYSTEM. An earlier version of this test
    // checked that the injected seam's key list was `[exists, isDirectory,
    // readFile, readdir]` and billed that as "the runtime witness"; it
    // witnessed only that an object literal written 20 lines above had the
    // keys it was written with, and could not fail for any change to the
    // source. `treeSnapshot` also catches what porcelain cannot — a write to
    // an ignored path, or a stray directory.
    const { root } = fixture("workstream");
    const before = porcelain(root);
    const beforeTree = treeSnapshot(root);

    const fs: MigrateFs = {
      exists: (p) => existsSync(p),
      readdir: (p) => readdirSync(p),
      readFile: (p) => readFileSync(p, "utf8"),
      isDirectory: (p) => existsSync(p) && statSync(p).isDirectory(),
    };
    const plan = planLayoutMigration(
      fs,
      root,
      { ...ENGINE_DEFAULTS, docsLayout: "workstream" },
      "project-level",
    );

    // It computed a real answer…
    expect(plan.refusals).toEqual([]);
    expect(plan.moves.map((m) => m.to).sort()).toEqual([...MIGRATED_FILES].sort());
    // …and changed nothing doing it.
    expect(porcelain(root)).toBe(before);
    expect(treeSnapshot(root)).toEqual(beforeTree);
  });

  it("prunes EMPTY scaffold directories too, so the rollback survives (R-5)", () => {
    // `devx workstream new` scaffolds decisions/checkpoints/evals EMPTY, and
    // `checkpoints/` stays empty until the first `/devx verify` — so this is
    // the shape of every mid-flight workstream, ClassyLights `b7e38f`
    // included. A prune driven off the ancestors of MOVED FILES cannot see a
    // directory that holds none, and the leftover shell makes the reverse
    // migration refuse `destination-occupied` forever.
    const { root } = fixture("workstream");
    rmSync(join(root, "_devx", "workstreams", SLUG, "checkpoints", ".gitkeep"));
    git(root, "add", "-A");
    git(root, "commit", "-m", "empty checkpoints", "--no-gpg-sign");

    expect(runCli(["layout", "migrate", "--to", "project-level"], root).status).toBe(0);
    expect(existsSync(join(root, "_devx", "workstreams", SLUG))).toBe(false);
    git(root, "add", "-A");
    git(root, "commit", "-m", "forward", "--no-gpg-sign");

    const back = runCli(["layout", "migrate", "--to", "workstream"], root);
    expect(back.status, `${back.stderr}${back.stdout}`).toBe(0);
  });

  it("a config/tree mismatch is reported, not answered with 'nothing to migrate'", () => {
    // What an interrupted run leaves, and what `devx doctor` reports as
    // `layout-tree-mismatch`. Both `--to` values are dead ends here, so the
    // one thing the command must not do is reassure.
    const { root } = fixture("workstream");
    expect(runCli(["layout", "migrate", "--to", "project-level"], root).status).toBe(0);
    // Put the config back while the tree stays flat.
    const cfgPath = join(root, "devx.config.yaml");
    writeFileSync(
      cfgPath,
      readFileSync(cfgPath, "utf8").replace(
        "docs_layout: project-level",
        "docs_layout: workstream",
      ),
    );

    const res = runCli(["layout", "migrate", "--to", "workstream"], root);
    assertRan(res, "devx layout migrate --to workstream");
    expect(res.status, `${res.stderr}${res.stdout}`).toBe(1);
    expect(res.stdout).toContain("the tree on disk looks like 'project-level'");
    expect(res.stdout).toContain("layout-tree-mismatch");
  });
});
