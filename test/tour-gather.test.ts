// Tour gather tests (v2t101) — real-git fixture repo in a temp dir.
//
// Fixture shape: init a repo on `main` with a spec file, cut
// `feat/dev-<hash>`, commit a change there, then gather and assert the spec
// ACs surface in the output and the diff/numstat/commits are captured.
//
// Spec: dev/dev-v2t101-2026-07-05T13:04-review-tour.md

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  GatherError,
  extractGoal,
  gatherTour,
  normalizeRenamePath,
  parseAcItems,
  parseFrontmatter,
  resolveBase,
} from "../src/lib/tour/gather.js";
import { runTourGather } from "../src/commands/tour.js";

const HASH = "abc123";

let tmp: string | null = null;
afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = null;
});

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

const SPEC_BODY = `---
hash: ${HASH}
type: dev
created: 2026-07-05T13:04:00-06:00
title: Fixture feature
status: in-progress
branch: feat/dev-${HASH}
---

## Goal

Ship the fixture feature end-to-end.

## Acceptance criteria

- [ ] First fixture AC.
- [x] Second fixture AC, already met.

## Status log

- 2026-07-05T13:04 — created.
`;

interface Fixture {
  repo: string;
  configPath: string;
}

function makeFixtureRepo(): Fixture {
  tmp = mkdtempSync(join(tmpdir(), "devx-tour-gather-"));
  const repo = join(tmp, "repo");
  mkdirSync(repo, { recursive: true });
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Test"]);

  mkdirSync(join(repo, "dev"), { recursive: true });
  writeFileSync(
    join(repo, "dev", `dev-${HASH}-2026-07-05T13:04-fixture.md`),
    SPEC_BODY,
  );
  writeFileSync(join(repo, "app.ts"), "export const x = 1;\n");
  const configPath = join(repo, "devx.config.yaml");
  writeFileSync(
    configPath,
    "mode: YOLO\ngit:\n  default_branch: main\n  integration_branch: null\n  branch_prefix: feat/\n",
  );
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", "init"]);

  git(repo, ["checkout", "-b", `feat/dev-${HASH}`]);
  writeFileSync(
    join(repo, "app.ts"),
    "export const x = 1;\nexport const y = 2;\n",
  );
  writeFileSync(join(repo, "new-file.ts"), "export const z = 3;\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", "feat: add y and z"]);
  // Return to main — gather must work regardless of the checked-out branch.
  git(repo, ["checkout", "main"]);
  return { repo, configPath };
}

describe("gatherTour (real git fixture)", () => {
  it("surfaces spec Goal + ACs and captures diff/numstat/commits/changed files", () => {
    const fx = makeFixtureRepo();
    const g = gatherTour(HASH, {
      repoRoot: fx.repo,
      config: { git: { default_branch: "main", integration_branch: null } },
    });

    // Spec side — ACs seed the tour's coverage rows.
    expect(g.spec.goal).toBe("Ship the fixture feature end-to-end.");
    expect(g.spec.acceptanceCriteria).toEqual([
      { text: "First fixture AC.", checked: false },
      { text: "Second fixture AC, already met.", checked: true },
    ]);
    expect(g.spec.frontmatter.title).toBe("Fixture feature");

    // Meta side.
    expect(g.meta.hash).toBe(HASH);
    expect(g.meta.base).toBe("main");
    expect(g.meta.branch).toBe(`feat/dev-${HASH}`);
    expect(g.meta.title).toBe("Fixture feature");
    expect(g.meta.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(g.meta.files).toBe(2);
    expect(g.meta.commits).toBe(1);
    expect(g.meta.additions).toBe(2);
    expect(g.meta.deletions).toBe(0);
    expect(g.meta.specPath).toBe(
      `dev/dev-${HASH}-2026-07-05T13:04-fixture.md`,
    );

    // Diff side.
    expect(g.fullDiff).toContain("diff --git a/app.ts b/app.ts");
    expect(g.fullDiff).toContain("+export const y = 2;");
    expect(g.fullDiff).toContain("new-file.ts");
    expect(g.numstat).toEqual(
      expect.arrayContaining([
        { file: "app.ts", additions: 1, deletions: 0 },
        { file: "new-file.ts", additions: 1, deletions: 0 },
      ]),
    );
    expect(g.commits).toHaveLength(1);
    expect(g.commits[0].subject).toBe("feat: add y and z");
    expect(g.changedFiles).toEqual(
      expect.arrayContaining([
        { status: "M", file: "app.ts" },
        { status: "A", file: "new-file.ts" },
      ]),
    );
  });

  it("throws no-spec for an unknown hash", () => {
    const fx = makeFixtureRepo();
    try {
      gatherTour("nosuch", { repoRoot: fx.repo });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(GatherError);
      expect((e as GatherError).stage).toBe("no-spec");
    }
  });

  it("throws empty-diff when the branch has no changes vs base", () => {
    const fx = makeFixtureRepo();
    git(fx.repo, ["branch", "feat/dev-eee111", "main"]);
    writeFileSync(
      join(fx.repo, "dev", "dev-eee111-2026-07-05T13:04-empty.md"),
      SPEC_BODY.replace(new RegExp(HASH, "g"), "eee111"),
    );
    try {
      gatherTour("eee111", { repoRoot: fx.repo });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(GatherError);
      expect((e as GatherError).stage).toBe("empty-diff");
    }
  });
});

describe("runTourGather CLI", () => {
  it("emits the gather JSON on stdout, exit 0", () => {
    const fx = makeFixtureRepo();
    let stdout = "";
    let stderr = "";
    const code = runTourGather(HASH, {
      out: (s) => {
        stdout += s;
      },
      err: (s) => {
        stderr += s;
      },
      projectPath: fx.configPath,
    });
    expect(code).toBe(0);
    expect(stderr).toBe("");
    const parsed = JSON.parse(stdout) as {
      meta: { hash: string };
      spec: { acceptanceCriteria: { text: string }[] };
      fullDiff: string;
    };
    expect(parsed.meta.hash).toBe(HASH);
    expect(parsed.spec.acceptanceCriteria[0].text).toBe("First fixture AC.");
    expect(parsed.fullDiff).toContain("+export const y = 2;");
  });

  it("exit 65 when the spec is missing", () => {
    const fx = makeFixtureRepo();
    let stderr = "";
    const code = runTourGather("nosuch", {
      out: () => {},
      err: (s) => {
        stderr += s;
      },
      projectPath: fx.configPath,
    });
    expect(code).toBe(65);
    expect(stderr).toContain("no spec file");
  });

  it("exit 64 on a malformed hash", () => {
    let stderr = "";
    const code = runTourGather("../../etc", {
      out: () => {},
      err: (s) => {
        stderr += s;
      },
    });
    expect(code).toBe(64);
    expect(stderr).toContain("invalid hash");
  });
});

describe("gather helpers", () => {
  it("resolveBase prefers integration branch, then default, then main", () => {
    expect(
      resolveBase({ git: { integration_branch: "develop" } }),
    ).toBe("develop");
    expect(
      resolveBase({ git: { integration_branch: null, default_branch: "trunk" } }),
    ).toBe("trunk");
    expect(resolveBase({ git: { integration_branch: "  " } })).toBe("main");
    expect(resolveBase(undefined)).toBe("main");
  });

  it("extractGoal returns '' when the section is absent", () => {
    expect(extractGoal("## Something else\nbody\n")).toBe("");
  });

  it("parseAcItems folds indented continuations into the parent item", () => {
    const items = parseAcItems(
      "- [ ] Parent AC:\n  with a continuation line\n- [x] Done AC.",
    );
    expect(items).toEqual([
      { text: "Parent AC: with a continuation line", checked: false },
      { text: "Done AC.", checked: true },
    ]);
  });

  it("normalizeRenamePath resolves git rename notation to the new path (Blind Hunter #7)", () => {
    expect(normalizeRenamePath("src/{old.ts => new.ts}")).toBe("src/new.ts");
    expect(normalizeRenamePath("old.ts => new.ts")).toBe("new.ts");
    expect(normalizeRenamePath("src/{ => sub}/file.ts")).toBe("src/sub/file.ts");
    expect(normalizeRenamePath("src/{sub => }/file.ts")).toBe("src/file.ts");
    expect(normalizeRenamePath("plain/path.ts")).toBe("plain/path.ts");
  });

  it("CRLF + BOM spec files still parse frontmatter/Goal/ACs (Edge Case Hunter #5)", () => {
    const fx = makeFixtureRepo();
    const crlfSpec = `﻿${SPEC_BODY.replace(new RegExp(HASH, "g"), "ccc999").replace(/\n/g, "\r\n")}`;
    writeFileSync(
      join(fx.repo, "dev", "dev-ccc999-2026-07-05T13:04-crlf.md"),
      crlfSpec,
    );
    git(fx.repo, ["branch", "feat/dev-ccc999", `feat/dev-${HASH}`]);
    const g = gatherTour("ccc999", {
      repoRoot: fx.repo,
      config: { git: { default_branch: "main", integration_branch: null } },
    });
    expect(g.meta.title).toBe("Fixture feature");
    expect(g.spec.acceptanceCriteria).toHaveLength(2);
    expect(g.spec.goal).toBe("Ship the fixture feature end-to-end.");
  });

  it("parseFrontmatter (pre-normalized input) captures scalar lines", () => {
    expect(parseFrontmatter("---\nhash: x1\ntitle: 'Quoted'\n---\nbody")).toEqual({
      hash: "x1",
      title: "Quoted",
    });
  });
});
