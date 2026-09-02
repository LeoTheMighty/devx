// dlr106 — `devx layout migrate` refuses rather than half-moving.
//
// Consumer of E-7
// (`_devx/workstreams/docs-layout-resolution/evals/E-7_migrate-refusals.ts`),
// pinned in `npm test` so the invariant survives the workstream that created
// it.
//
// The assertion is never "it exited non-zero": a command that refuses after
// moving four of eight files has already done the damage the refusal exists to
// prevent. Every case therefore compares `git status` BYTE FOR BYTE across the
// attempt. There is no `--force` to test, because every state below is one
// where moving loses information.
//
// It SPAWNS the real CLI (real `git mv`, real `git status`), which is why it is
// registered in `SYNC_BLOCKING_TESTS` (vitest.shared.ts).
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

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(repoRoot, "src", "cli.ts");
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

interface FixtureOpts {
  /** A second plan spec, so the repo carries two live workstreams. */
  secondWorkstream?: { hash: string; slug: string; stage: string };
  /** Extra committed files, repo-relative → contents. */
  extraFiles?: Record<string, string>;
  /** Leave the tree dirty after the initial commit. */
  dirty?: boolean;
  /** Also author the plan artifact (`plan/agent.md`). */
  withPlanArtifact?: boolean;
  /** Skip `git init` entirely — a plain directory, not a repository. */
  noGit?: boolean;
  /** Override `.gitignore` (so a doc-set file can be made ignored). */
  gitignore?: string;
  /** Run after the initial commit — for state that must NOT be committed. */
  afterCommit?: (root: string) => void;
}

/** A migratable `workstream`-layout repo, perturbed by exactly one thing. */
function fixture(opts: FixtureOpts = {}): string {
  const root = mkdtempSync(join(tmpdir(), "dlr106-refuse-"));
  roots.push(root);
  if (opts.noGit !== true) git(root, "init", "-b", "main");

  writeFileSync(
    join(root, "devx.config.yaml"),
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
  writeFileSync(join(root, ".gitignore"), opts.gitignore ?? ".devx-cache/\n");
  for (const f of ["DEV.md", "PLAN.md", "MANUAL.md", "INTERVIEW.md"]) {
    writeFileSync(join(root, f), `# ${f.replace(".md", "")}\n`);
  }
  cpSync(
    join(repoRoot, "_devx", "templates", "engine"),
    join(root, "_devx", "templates", "engine"),
    { recursive: true },
  );

  const spec = (hash: string, slug: string, stage: string): string =>
    [
      "---",
      `hash: ${hash}`,
      "type: plan",
      "created: 2026-09-02T09:00:00-06:00",
      `title: Fixture ${slug}`,
      "status: in-progress",
      `stage: ${stage}`,
      "entered_at: prd",
      "gate_status:",
      "  prd_validated: true",
      "  design_verified: true",
      "  plan_verified: false",
      "  evals_red: false",
      "outcome:",
      "  status: null",
      "  measure_by: null",
      `workstream: _devx/workstreams/${slug}`,
      "---",
      "",
      "## Goal",
      "",
      `Fixture workstream ${slug}.`,
      "",
    ].join("\n");

  mkdirSync(join(root, "plan"), { recursive: true });
  writeFileSync(
    join(root, "plan", `plan-${HASH}-2026-09-02T09:00-${SLUG}.md`),
    spec(HASH, SLUG, "plan"),
  );

  const write = (rel: string, body: string): void => {
    const abs = join(root, "_devx", "workstreams", SLUG, ...rel.split("/"));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  };
  write("prd/agent.md", "# PRD\n");
  write("prd/human.md", "# PRD (human)\n");
  write("design/agent.md", "# Design\n");
  write("expectations.md", "# Expectations\n");
  write("todo.md", "# Todo\n");
  write("decisions/2026-08-01-design-verify.md", "# Design verify\n");
  if (opts.withPlanArtifact === true) write("plan/agent.md", "# Plan\n");

  if (opts.secondWorkstream) {
    const s = opts.secondWorkstream;
    writeFileSync(
      join(root, "plan", `plan-${s.hash}-2026-09-02T10:00-${s.slug}.md`),
      spec(s.hash, s.slug, s.stage),
    );
    const abs = join(root, "_devx", "workstreams", s.slug, "prd", "agent.md");
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, `# PRD — ${s.slug}\n`);
  }

  for (const [rel, body] of Object.entries(opts.extraFiles ?? {})) {
    const abs = join(root, ...rel.split("/"));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }

  if (opts.noGit !== true) {
    git(root, "add", "-A");
    git(root, "commit", "-m", "fixture: init", "--no-gpg-sign");
    if (opts.dirty === true) {
      writeFileSync(join(root, "DEV.md"), "# DEV\n\nuncommitted edit\n");
    }
    opts.afterCommit?.(root);
  }
  return root;
}

/** Everything git can see, untracked included — the whole tree state. */
const treeState = (root: string): string =>
  git(root, "status", "--porcelain=v1", "-uall");

/** Does this filesystem fold case? Asked, never assumed — the same question
 *  the clash predicate asks, so the test and the code agree about the platform
 *  rather than both hardcoding a guess about it. */
function caseInsensitiveFs(root: string): boolean {
  const probe = join(root, "DevxCaseProbe.tmp");
  writeFileSync(probe, "");
  try {
    return existsSync(join(root, "devxcaseprobe.tmp"));
  } finally {
    rmSync(probe, { force: true });
  }
}

/** The doc set's files, repo-relative, sorted — an EXACT inventory.
 *
 *  The first version of this asked only whether the workstream directory was
 *  non-empty, which would have passed with five of six artifacts already moved
 *  — the exact half-migrated state this file exists to catch. "Nothing moved"
 *  has to be compared against a list, not a boolean. */
function docSetFiles(root: string): string[] {
  const base = join(root, "_devx", "workstreams", SLUG);
  const out: string[] = [];
  const walk = (dirAbs: string, prefix: string): void => {
    if (!existsSync(dirAbs)) return;
    for (const name of readdirSync(dirAbs).sort()) {
      const abs = join(dirAbs, name);
      const rel = prefix === "" ? name : `${prefix}/${name}`;
      if (statSync(abs).isDirectory()) walk(abs, rel);
      else out.push(rel);
    }
  };
  walk(base, "");
  return out.sort();
}

afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

interface RefusalCase {
  name: string;
  code: string;
  /** Text the refusal must carry so the operator knows what to do next. */
  mustSay: RegExp;
  build: () => string;
}

const CASES: RefusalCase[] = [
  {
    name: "two live workstreams",
    code: "two-live-workstreams",
    // `/workstream/i` matched almost any message this command could print —
    // including a success line. Pin the sentence that tells the operator what
    // to DO, which is the half a regression would lose.
    mustSay: /live workstreams.*Close or retire the others/s,
    build: () =>
      fixture({
        secondWorkstream: { hash: "c1d2e3", slug: "second-thing", stage: "design" },
      }),
  },
  {
    name: "doc set already at the destination",
    code: "destination-occupied",
    // A root `prd.md` is exactly what a half-finished migration leaves behind.
    mustSay: /doc set is already at the 'project-level' destination/,
    build: () => fixture({ extraFiles: { "prd.md": "# PRD — already here\n" } }),
  },
  {
    name: "dirty working tree",
    code: "dirty-tree",
    mustSay: /working tree is dirty.*Commit or stash first/s,
    build: () => fixture({ dirty: true }),
  },
  {
    name: "one live workstream and one done one",
    code: "multiple-doc-sets",
    // The `>=2 live` rule misses this: a `done` workstream still owns a tree,
    // and under `project-level` EVERY spec resolves to the repo root — so the
    // done one would read the migrated workstream's artifacts as its own.
    // Silent aliasing, which is worse than orphaning.
    mustSay: /other doc set\(s\) exist on disk/,
    build: () =>
      fixture({
        secondWorkstream: { hash: "aa11bb", slug: "legacy-thing", stage: "done" },
      }),
  },
  {
    name: "an unmapped file in the doc set",
    code: "unmapped-doc-set-files",
    // `RETRO-<date>.md` is not in the artifact map, and six of devx's own
    // workstreams carry one. Planning from the map alone moved the artifacts,
    // reported success, and left this behind.
    mustSay: /not artifacts the layout map can name/,
    build: () =>
      fixture({
        extraFiles: {
          [`_devx/workstreams/${SLUG}/RETRO-2026-08-01.md`]: "# Retro\n",
        },
      }),
  },
  {
    name: "an exact-name destination clash on a non-evidence artifact",
    code: "destination-clash",
    // `destination-occupied` only knows five basenames, so every `*-human.md`,
    // every `*-outline.md`, `RESULTS.md` and every file inside decisions/ fell
    // through both checks and died mid-`git mv` with the tree half moved.
    mustSay: /already taken by a file that is not moving/,
    build: () => fixture({ extraFiles: { "prd-human.md": "# already here\n" } }),
  },
  {
    name: "an ignored file inside the doc set",
    code: "untracked-sources",
    // Invisible to `git status`, so the dirty-tree refusal passes — and
    // `git mv` cannot move it, so the migration would leave it behind.
    mustSay: /not tracked by git/,
    build: () =>
      fixture({
        gitignore: ".devx-cache/\n**/.DS_Store\n",
        afterCommit: (root) =>
          writeFileSync(
            join(root, "_devx", "workstreams", SLUG, "decisions", ".DS_Store"),
            "x",
          ),
      }),
  },
];

describe("dlr106 — devx layout migrate refuses rather than half-moving", () => {
  for (const c of CASES) {
    it(`[${c.name}] exits 1 with 0 files moved and git status byte-identical`, () => {
      const root = c.build();
      const before = treeState(root);
      const beforeFiles = docSetFiles(root);
      expect(beforeFiles.length).toBeGreaterThan(0); // the inventory is real

      const res = runCli(["layout", "migrate", "--to", "project-level"], root);
      assertRan(res, "devx layout migrate --to project-level");

      // 1, not 2: a contradicted repo state is a refusal — a valid request the
      // engine says no to — not a hard error.
      expect(res.status, `${res.stderr}${res.stdout}`).toBe(1);
      const text = `${res.stdout}${res.stderr}`;
      expect(text).toContain(`[${c.code}]`);
      expect(text).toMatch(c.mustSay);

      // The assertions that matter: nothing moved, and the doc set is still
      // whole — an exact inventory, so a refusal that fired after moving five
      // of six files fails here rather than passing a non-empty check.
      expect(treeState(root)).toBe(before);
      expect(docSetFiles(root)).toEqual(beforeFiles);
      // The config is the LAST thing a successful run writes, so an untouched
      // layout knob is independent evidence the executor never started.
      expect(
        readFileSync(join(root, "devx.config.yaml"), "utf8"),
      ).toContain("docs_layout: workstream");
    });

    it(`[${c.name}] refuses a --dry-run identically`, () => {
      // A `--dry-run` that succeeds where the real run refuses is a dry run
      // that lied, and predicting the real run is its entire job.
      const root = c.build();
      const before = treeState(root);
      const res = runCli(
        ["layout", "migrate", "--to", "project-level", "--dry-run"],
        root,
      );
      assertRan(res, "devx layout migrate --dry-run");
      expect(res.status, `${res.stderr}${res.stdout}`).toBe(1);
      expect(`${res.stdout}${res.stderr}`).toContain(`[${c.code}]`);
      expect(treeState(root)).toBe(before);
    });
  }

  it("[destination case-clash] refuses `plan.md` against the repo's own PLAN.md (debug-135dc9)", () => {
    // Found by running the migration against a real fixture, not by reading
    // the map: `plan.md` and `PLAN.md` are the SAME PATH on macOS/APFS and
    // Windows/NTFS, so `git mv … plan.md` targets the backlog. Every
    // exact-name predicate correctly reports "no doc set at the destination" —
    // the clash is with a file that is not an artifact at all.
    //
    // PLATFORM NOTE: this pin is meaningful only on a case-INSENSITIVE
    // filesystem. The clash predicate asks the filesystem rather than assuming
    // a platform, so on ext4 (Linux CI) `plan.md` and `PLAN.md` genuinely
    // coexist, the refusal correctly does NOT fire, and this test is skipped.
    // A green Linux run is therefore not evidence that the pin holds — read it
    // on macOS.
    const root = fixture({ withPlanArtifact: true });
    if (!caseInsensitiveFs(root)) return;
    const before = treeState(root);
    const res = runCli(["layout", "migrate", "--to", "project-level"], root);
    assertRan(res, "devx layout migrate --to project-level");
    expect(res.status, `${res.stderr}${res.stdout}`).toBe(1);
    const text = `${res.stdout}${res.stderr}`;
    expect(text).toContain("[destination-clash]");
    expect(text).toContain("PLAN.md");
    expect(treeState(root)).toBe(before);
  });

  it("[nested repo root] refuses when devx.config.yaml is not at the git top level", () => {
    // The recovery model is repo-wide (`git reset --hard HEAD`), so running
    // from a nested project would put the OUTER repo's uncommitted work inside
    // a rollback's blast radius — the exact information loss the clean-tree
    // refusal exists to prevent.
    const outer = mkdtempSync(join(tmpdir(), "dlr106-outer-"));
    roots.push(outer);
    git(outer, "init", "-b", "main");
    writeFileSync(join(outer, "README.md"), "# outer\n");
    const inner = fixture({ noGit: true });
    cpSync(inner, join(outer, "tools", "devx-project"), { recursive: true });
    git(outer, "add", "-A");
    git(outer, "commit", "-m", "init", "--no-gpg-sign");

    const nested = join(outer, "tools", "devx-project");
    const res = runCli(["layout", "migrate", "--to", "project-level"], nested);
    assertRan(res, "devx layout migrate --to project-level");
    expect(res.status, `${res.stderr}${res.stdout}`).toBe(1);
    expect(`${res.stdout}${res.stderr}`).toContain("[nested-repo-root]");
  });

  it("[not a git repo] is a refusal, not an fs.rename fallback (AC 6)", () => {
    // A rename git cannot see severs every artifact's history, which is the
    // one thing the migration exists to preserve. There is no non-git path.
    const root = fixture({ noGit: true });
    const res = runCli(["layout", "migrate", "--to", "project-level"], root);
    assertRan(res, "devx layout migrate --to project-level");
    expect(res.status, `${res.stderr}${res.stdout}`).toBe(1);
    expect(`${res.stdout}${res.stderr}`).toContain("[not-a-git-repo]");
    // Nothing landed at the flat destination.
    expect(readdirSync(root)).not.toContain("prd.md");
  });

  it("there is no --force", () => {
    // Not a style point: every refusal above names a state where moving loses
    // information, so a flag that overrode them would be a flag for losing it
    // quietly. Commander rejects the unknown option, which is the enforcement.
    const root = fixture({ dirty: true });
    const before = treeState(root);
    const res = runCli(
      ["layout", "migrate", "--to", "project-level", "--force"],
      root,
    );
    assertRan(res, "devx layout migrate --force");
    expect(res.status).not.toBe(0);
    expect(`${res.stdout}${res.stderr}`).toMatch(/unknown option/i);
    expect(treeState(root)).toBe(before);
  });

  it("an unknown --to layout is a usage error (exit 2), not a refusal", () => {
    const root = fixture();
    const res = runCli(["layout", "migrate", "--to", "flat"], root);
    assertRan(res, "devx layout migrate --to flat");
    expect(res.status, `${res.stderr}${res.stdout}`).toBe(2);
    expect(`${res.stdout}${res.stderr}`).toMatch(/unknown layout 'flat'/);
  });
});
