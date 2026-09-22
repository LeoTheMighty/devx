// debug-00b4d3 — `devx outline check` (L2 of the human-only outline guard)
// against RENAMES, in real git. Two failures shared one cause:
//
//  1. A pure move of a human outline — what `devx layout migrate` and `devx
//     archive` do — was refused, because `git diff --name-only` collapses a
//     rename to its destination and the destination reads as authored.
//  2. The same collapse let a human outline renamed to a NON-outline name
//     leave the diff unseen: only the destination is listed, and it is not an
//     outline path, so deleting the human's outline passed.
//
// Shells out to git and the CLI → registered in SYNC_BLOCKING_TESTS.
//
// Spec: debug/debug-00b4d3-2026-09-02T14:36-migration-commit-blocked-by-outline-check.md

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { runOutlineCheck } from "../src/commands/outline.js";
import { captureIo } from "./fixtures/engine-repo.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const cliPath = join(repoRoot, "src", "cli.ts");
const tsxCliEntry = createRequire(import.meta.url).resolve("tsx/cli");
const GIT_ENV = { ...process.env, GIT_CONFIG_NOSYSTEM: "1" };

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}

const roots: string[] = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

const SLUG = "scene-engine";
const HASH = "b7e38f";
const WS = `_devx/workstreams/${SLUG}`;
const HUMAN = "- a bullet the human typed\n";

/** A `workstream`-layout repo with a human-typed prd outline, pushed to an
 *  origin so `origin/main...HEAD` resolves — the shape `devx layout migrate`
 *  runs against (dlr106's fixture, trimmed to what migrate needs). */
function repo(): { root: string; configPath: string; write: (rel: string, body: string) => void } {
  const root = mkdtempSync(join(tmpdir(), "devx-00b4d3-"));
  roots.push(root);
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "t@t");
  git(root, "config", "user.name", "t");
  git(root, "config", "commit.gpgsign", "false");
  const configPath = join(root, "devx.config.yaml");
  writeFileSync(
    configPath,
    [
      "mode: YOLO",
      "git:",
      "  default_branch: main",
      "  integration_branch: null",
      "engine:",
      "  workstreams_root: _devx/workstreams",
      "  docs_layout: workstream",
      "  expectations_min: 3",
      "",
    ].join("\n"),
  );
  writeFileSync(join(root, ".gitignore"), ".devx-cache/\n");
  for (const f of ["DEV.md", "PLAN.md", "MANUAL.md", "INTERVIEW.md"]) writeFileSync(join(root, f), `# ${f}\n`);
  cpSync(join(repoRoot, "_devx", "templates", "engine"), join(root, "_devx", "templates", "engine"), {
    recursive: true,
  });
  mkdirSync(join(root, "plan"), { recursive: true });
  writeFileSync(
    join(root, "plan", `plan-${HASH}-2026-09-02T09:00-${SLUG}.md`),
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
      `workstream: ${WS}`,
      "---",
      "",
      "## Goal",
      "",
      "Fixture.",
      "",
    ].join("\n"),
  );
  const write = (rel: string, body: string): void => {
    const abs = join(root, ...rel.split("/"));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  };
  write(`${WS}/prd/agent.md`, "# PRD\n");
  write(`${WS}/prd/human.md`, "# PRD (human)\n");
  write(`${WS}/design/agent.md`, "# Design\n");
  write(`${WS}/design/human.md`, "# Design (human)\n");
  write(`${WS}/prd/outline.md`, HUMAN);
  write(`${WS}/expectations.md`, "# Expectations\n");
  write(`${WS}/todo.md`, "# Todo\n");
  write(`${WS}/decisions/2026-08-01-design-verify.md`, "# Design verify\n\nPASS.\n");
  write(`${WS}/checkpoints/.gitkeep`, "");
  write(`${WS}/evals/E-1_fixture.ts`, "// e1\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "fixture");
  const origin = mkdtempSync(join(tmpdir(), "devx-00b4d3-origin-"));
  roots.push(origin);
  git(origin, "init", "-q", "--bare");
  git(root, "remote", "add", "origin", origin);
  git(root, "push", "-q", "-u", "origin", "main");
  git(root, "checkout", "-q", "-b", "feat/x");
  return { root, configPath, write };
}

function check(configPath: string): { code: number; out: string } {
  const io = captureIo();
  const code = runOutlineCheck({}, { out: io.out, err: io.err, projectPath: configPath });
  return { code, out: io.stdout() };
}

function commitAll(root: string, msg: string): void {
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", msg);
}

describe("AC 1 — a real `devx layout migrate`, committed, then `devx outline check`", () => {
  it("passes: the migration only MOVES the human's outline", () => {
    const { root, configPath } = repo();
    const r = spawnSync(process.execPath, [tsxCliEntry, cliPath, "layout", "migrate", "--to", "project-level"], {
      cwd: root,
      env: GIT_ENV,
      encoding: "utf8",
      timeout: 120_000,
    });
    if (r.status !== 0) throw new Error(`INFRA — migrate failed (${r.status}): ${r.stderr}${r.stdout}`);
    commitAll(root, "migrate");
    // The migration really did carry the outline, byte for byte.
    expect(git(root, "show", "HEAD:prd-outline.md")).toBe(HUMAN);
    const { code, out } = check(configPath);
    const json = JSON.parse(out);
    expect(json.touched).toEqual([]);
    expect(json.moved).toEqual([{ from: `${WS}/prd/outline.md`, to: "prd-outline.md" }]);
    expect(code).toBe(0);
  });

  it("…and migrating back to the folder layout passes too", () => {
    const { root, configPath } = repo();
    const run = (to: string) =>
      spawnSync(process.execPath, [tsxCliEntry, cliPath, "layout", "migrate", "--to", to], {
        cwd: root,
        env: GIT_ENV,
        encoding: "utf8",
        timeout: 120_000,
      });
    git(root, "checkout", "-q", "main");
    const a = run("project-level");
    if (a.status !== 0) throw new Error(`INFRA — migrate failed: ${a.stderr}${a.stdout}`);
    commitAll(root, "to project-level");
    git(root, "push", "-q", "origin", "main");
    git(root, "checkout", "-q", "-b", "feat/back");
    const b = run("workstream");
    if (b.status !== 0) throw new Error(`INFRA — migrate back failed: ${b.stderr}${b.stdout}`);
    commitAll(root, "back to workstream");
    const { code, out } = check(configPath);
    expect(JSON.parse(out).moved).toEqual([{ from: "prd-outline.md", to: `${WS}/prd/outline.md` }]);
    expect(code).toBe(0);
  });
});

// Review round 1 of 00b4d3: a "same kind" rule — kind read from a path's
// shape — exempted moves that change what an outline MEANS, several of which
// the old scan blocked. Only the exact destinations migrate/archive produce
// are exempt now; every one of these blocks.
describe("review round 1: a move that changes what an outline means still blocks", () => {
  const blocks = (setup: (r: ReturnType<typeof repo>) => void) => {
    const r = repo();
    setup(r);
    commitAll(r.root, "move");
    return check(r.configPath).code;
  };
  it("into ANOTHER workstream", () => {
    expect(
      blocks((r) => {
        mkdirSync(join(r.root, "_devx/workstreams/other/prd"), { recursive: true });
        git(r.root, "mv", `${WS}/prd/outline.md`, "_devx/workstreams/other/prd/outline.md");
      }),
    ).toBe(1);
  });
  it("to an unprotected path of the same shape (`docs/prd/…`)", () => {
    expect(
      blocks((r) => {
        mkdirSync(join(r.root, "docs/prd"), { recursive: true });
        git(r.root, "mv", `${WS}/prd/outline.md`, "docs/prd/outline.md");
      }),
    ).toBe(1);
  });
  it("into `_devx/templates/`, where it would become the scaffold", () => {
    expect(
      blocks((r) => {
        mkdirSync(join(r.root, "_devx/templates/x/prd"), { recursive: true });
        git(r.root, "mv", `${WS}/prd/outline.md`, "_devx/templates/x/prd/outline.md");
      }),
    ).toBe(1);
  });
  it("to a name with a trailing space", () => {
    expect(blocks((r) => git(r.root, "mv", `${WS}/prd/outline.md`, `${WS}/prd/outline.md `))).toBe(1);
  });
  it("renaming the whole workstream", () => {
    expect(blocks((r) => git(r.root, "mv", WS, "_devx/workstreams/renamed"))).toBe(1);
  });
  it("archiving under a DIFFERENT slug", () => {
    expect(
      blocks((r) => {
        mkdirSync(join(r.root, "_devx/archive/other/prd"), { recursive: true });
        git(r.root, "mv", `${WS}/prd/outline.md`, "_devx/archive/other/prd/outline.md");
      }),
    ).toBe(1);
  });
  it("the root project outline moved into a subdirectory", () => {
    const r = repo();
    git(r.root, "checkout", "-q", "main");
    writeFileSync(join(r.root, "OUTLINE.md"), HUMAN);
    commitAll(r.root, "project outline");
    git(r.root, "push", "-q", "origin", "main");
    git(r.root, "checkout", "-q", "feat/x");
    git(r.root, "rebase", "-q", "main");
    mkdirSync(join(r.root, "sub"), { recursive: true });
    git(r.root, "mv", "OUTLINE.md", "sub/OUTLINE.md");
    commitAll(r.root, "move project outline");
    expect(check(r.configPath).code).toBe(1);
  });
  it("restoring from the archive — archived outlines are unprotected, so a restore could launder edits", () => {
    const r = repo();
    git(r.root, "checkout", "-q", "main");
    mkdirSync(join(r.root, "_devx", "archive"), { recursive: true });
    git(r.root, "mv", WS, `_devx/archive/${SLUG}`);
    commitAll(r.root, "archive");
    git(r.root, "push", "-q", "origin", "main");
    git(r.root, "checkout", "-q", "-b", "feat/restore");
    git(r.root, "mv", `_devx/archive/${SLUG}`, WS);
    commitAll(r.root, "restore");
    expect(check(r.configPath).code).toBe(1);
  });
});

describe("the archive under the project-level layout (the archive always stores folders)", () => {
  it("a root flat outline archived into `<archive_root>/<slug>/<stage>/` passes", () => {
    const { root, configPath } = repo();
    git(root, "checkout", "-q", "main");
    git(root, "mv", `${WS}/prd/outline.md`, "prd-outline.md");
    commitAll(root, "as if project-level");
    git(root, "push", "-q", "origin", "main");
    git(root, "checkout", "-q", "-b", "feat/archive");
    mkdirSync(join(root, "_devx/archive", SLUG, "prd"), { recursive: true });
    git(root, "mv", "prd-outline.md", `_devx/archive/${SLUG}/prd/outline.md`);
    commitAll(root, "archive");
    const { code, out } = check(configPath);
    expect(JSON.parse(out).moved).toEqual([{ from: "prd-outline.md", to: `_devx/archive/${SLUG}/prd/outline.md` }]);
    expect(code).toBe(0);
  });
});

describe("pure moves of a human outline pass", () => {
  it("an archive-style move of the whole workstream (what `devx archive` does)", () => {
    const { root, configPath } = repo();
    mkdirSync(join(root, "_devx", "archive"), { recursive: true });
    git(root, "mv", WS, `_devx/archive/${SLUG}`);
    commitAll(root, "archive");
    expect(check(configPath).code).toBe(0);
  });
});

describe("everything that is not a pure move still blocks", () => {
  it("an outline renamed to a NON-outline name — the human's outline disappears", () => {
    const { root, configPath } = repo();
    git(root, "mv", `${WS}/prd/outline.md`, `${WS}/prd/notes.md`);
    commitAll(root, "rename away");
    const { code, out } = check(configPath);
    expect(code).toBe(1);
    expect(JSON.parse(out).touched).toContain(`${WS}/prd/outline.md`);
  });
  it("a rename that also changes the content", () => {
    const { root, configPath, write } = repo();
    git(root, "mv", `${WS}/prd/outline.md`, "prd-outline.md");
    write("prd-outline.md", `${HUMAN}- and an agent's line\n`);
    commitAll(root, "rename + edit");
    expect(check(configPath).code).toBe(1);
  });
  it("a non-outline file moved INTO an outline path", () => {
    const { root, configPath } = repo();
    git(root, "mv", `${WS}/prd/human.md`, `${WS}/design/outline.md`);
    commitAll(root, "into outline");
    expect(check(configPath).code).toBe(1);
  });
  it("an outline moved to ANOTHER stage's outline path", () => {
    const { root, configPath } = repo();
    git(root, "mv", `${WS}/prd/outline.md`, `${WS}/design/outline.md`);
    commitAll(root, "re-stage");
    expect(check(configPath).code).toBe(1);
  });
  it("an outline deleted outright", () => {
    const { root, configPath } = repo();
    git(root, "rm", "-q", `${WS}/prd/outline.md`);
    commitAll(root, "delete");
    expect(check(configPath).code).toBe(1);
  });
  it("an outline edited in place", () => {
    const { root, configPath, write } = repo();
    write(`${WS}/prd/outline.md`, `${HUMAN}- agent line\n`);
    commitAll(root, "edit");
    expect(check(configPath).code).toBe(1);
  });
});
