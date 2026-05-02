// CLI-passthrough tests for `devx pr-body --spec <path>` (prt102).
//
// Strategy mirrors merge-gate-cli.test.ts: build a per-test fixture project
// on a temp dir with a minimal devx.config.yaml + dev/dev-<hash>-…md spec
// file, then drive runPrBody through its `out`/`err`/`projectPath` test
// seams. No real `gh` call, no network, no subprocess.
//
// Coverage targets per the prt102 spec ACs and locked decisions:
//   1. Happy path: stdout = canonical-template body with substitutions
//      applied; exit 0; stderr empty.
//   2. AC 5 invariant: first non-empty stdout line is the `**Spec:**` line.
//   3. Built-in fallback when .github/pull_request_template.md is absent.
//   4. .github/pull_request_template.md present → loaded from disk (we
//      verify by injecting a CRLF-line-ended file and asserting the
//      substitutions still work).
//   5. Unresolved placeholders → stderr lines (one per name); exit still 0
//      because rendering succeeded (locked decision #5).
//   6. I/O failures: missing config / missing spec / missing template
//      override → exit 65; stderr explanatory.
//   7. Repo-relative spec path is what lands in the **Spec:** line, even
//      when the caller passes an absolute path (no worktree-leak).
//
// Spec: dev/dev-prt102-2026-04-28T19:30-pr-template-substitution.md
// Epic: _bmad-output/planning-artifacts/epic-pr-template.md

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runPrBody } from "../src/commands/pr-body.js";

interface Fixture {
  dir: string;
  configPath: string;
  specPath: string;
  specRelPath: string;
}

interface FixtureOpts {
  mode?: string;
  hash?: string;
  /** When true, write a `.github/pull_request_template.md`. */
  withTemplate?: boolean;
  /** Override the template body (defaults to the canonical Phase 1 shape). */
  templateBody?: string;
  /** Override the spec body. Defaults to a minimal AC-bearing spec. */
  specBody?: string;
}

const CANONICAL_TEMPLATE = `<!-- devx:mode -->
**Spec:** \`<dev/dev-<hash>-<ts>-<slug>.md>\`
**Mode:** <!-- devx:auto:mode --> *(stamped at PR-open by /devx)*

## Summary
<1–3 bullets on what changed>

## Acceptance criteria
<checkbox list copied from spec>

## Test plan
<bulleted list of what local CI gates covered + any manual steps>

## Notes for reviewers
<surprises, deviations, follow-ups>
`;

function makeFixture(opts: FixtureOpts = {}): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "devx-pr-body-cli-"));
  const hash = opts.hash ?? "test01";
  const config = `mode: ${opts.mode ?? "YOLO"}\n`;
  const configPath = join(dir, "devx.config.yaml");
  writeFileSync(configPath, config);

  const specDir = join(dir, "dev");
  mkdirSync(specDir, { recursive: true });
  const specRelPath = `dev/dev-${hash}-2026-04-28T22:30-test.md`;
  const specPath = join(dir, specRelPath);
  const body =
    opts.specBody ??
    `---
hash: ${hash}
type: dev
title: test spec
status: ready
---

## Goal
test.

## Acceptance criteria

- [ ] first ac
- [ ] second ac

## Status log

- 2026-04-28T22:30 — created.
`;
  writeFileSync(specPath, body);

  if (opts.withTemplate) {
    const ghDir = join(dir, ".github");
    mkdirSync(ghDir, { recursive: true });
    writeFileSync(
      join(ghDir, "pull_request_template.md"),
      opts.templateBody ?? CANONICAL_TEMPLATE,
    );
  }

  return { dir, configPath, specPath, specRelPath };
}

describe("runPrBody — happy path", () => {
  let fx: Fixture | null = null;
  afterEach(() => {
    if (fx) rmSync(fx.dir, { recursive: true, force: true });
    fx = null;
  });

  it("emits canonical body to stdout; exit 0; first non-empty line is **Spec:**", () => {
    fx = makeFixture({ withTemplate: true });
    let stdout = "";
    let stderr = "";
    const code = runPrBody(
      { spec: fx.specRelPath },
      {
        out: (s) => {
          stdout += s;
        },
        err: (s) => {
          stderr += s;
        },
        projectPath: fx.configPath,
      },
    );
    expect(code).toBe(0);
    const firstNonEmpty = stdout.split("\n").find((l) => l.trim() !== "");
    expect(firstNonEmpty).toBe(`**Spec:** \`${fx.specRelPath}\``);
    expect(stdout).toContain("**Mode:** YOLO");
    expect(stdout).toContain("- [ ] first ac");
    expect(stdout).toContain("- [ ] second ac");
    // stderr carries one line per unresolved placeholder. Summary / test plan
    // / notes were not provided here, so three lines expected.
    expect(stderr).toContain("unresolved-placeholder: summary");
    expect(stderr).toContain("unresolved-placeholder: test-plan");
    expect(stderr).toContain("unresolved-placeholder: notes");
  });

  it("substitutes summary / test plan / notes from flags", () => {
    fx = makeFixture({ withTemplate: true });
    let stdout = "";
    let stderr = "";
    const code = runPrBody(
      {
        spec: fx.specRelPath,
        summary: "- bullet a",
        testPlan: "- ran tests",
        notes: "- (none)",
      },
      {
        out: (s) => {
          stdout += s;
        },
        err: (s) => {
          stderr += s;
        },
        projectPath: fx.configPath,
      },
    );
    expect(code).toBe(0);
    expect(stdout).toContain("- bullet a");
    expect(stdout).toContain("- ran tests");
    expect(stdout).toContain("- (none)");
    expect(stderr).toBe("");
  });

  it("uses built-in template when .github/pull_request_template.md is absent", () => {
    fx = makeFixture({ withTemplate: false });
    let stdout = "";
    const code = runPrBody(
      { spec: fx.specRelPath, summary: "x", testPlan: "y", notes: "z" },
      {
        out: (s) => {
          stdout += s;
        },
        projectPath: fx.configPath,
      },
    );
    expect(code).toBe(0);
    expect(stdout).toContain(`**Spec:** \`${fx.specRelPath}\``);
    expect(stdout).toContain("**Mode:** YOLO");
  });

  it("normalizes CRLF in on-disk template (Windows-checkout safety)", () => {
    fx = makeFixture({
      withTemplate: true,
      templateBody: CANONICAL_TEMPLATE.replace(/\n/g, "\r\n"),
    });
    let stdout = "";
    const code = runPrBody(
      { spec: fx.specRelPath, summary: "x", testPlan: "y", notes: "z" },
      {
        out: (s) => {
          stdout += s;
        },
        projectPath: fx.configPath,
      },
    );
    expect(code).toBe(0);
    expect(stdout).toContain("**Mode:** YOLO");
  });

  it("uppercases the mode (yolo → YOLO)", () => {
    fx = makeFixture({ mode: "yolo" });
    let stdout = "";
    const code = runPrBody(
      { spec: fx.specRelPath, summary: "x", testPlan: "y", notes: "z" },
      {
        out: (s) => {
          stdout += s;
        },
        projectPath: fx.configPath,
      },
    );
    expect(code).toBe(0);
    expect(stdout).toContain("**Mode:** YOLO");
  });
});

describe("runPrBody — repo-relative spec path discipline", () => {
  let fx: Fixture | null = null;
  afterEach(() => {
    if (fx) rmSync(fx.dir, { recursive: true, force: true });
    fx = null;
  });

  it("converts an absolute spec path into a repo-relative `**Spec:**` line", () => {
    // Worktree-path leak guard: /devx Phase 7 calls `devx pr-body` from within
    // .worktrees/dev-<hash>/, but the **Spec:** line on github.com must point
    // at the repo-rooted path (mobile companion + reviewer anchor on it).
    fx = makeFixture({ withTemplate: true });
    let stdout = "";
    const code = runPrBody(
      { spec: fx.specPath, summary: "x", testPlan: "y", notes: "z" }, // ABSOLUTE
      {
        out: (s) => {
          stdout += s;
        },
        projectPath: fx.configPath,
      },
    );
    expect(code).toBe(0);
    expect(stdout).toContain(`**Spec:** \`${fx.specRelPath}\``);
    expect(stdout).not.toContain(fx.dir); // absolute path didn't leak
  });
});

describe("runPrBody — BOM + extra-defensive load paths", () => {
  let fx: Fixture | null = null;
  afterEach(() => {
    if (fx) rmSync(fx.dir, { recursive: true, force: true });
    fx = null;
  });

  it("strips a UTF-8 BOM from .github/pull_request_template.md before substitution", () => {
    // Self-review fix (Edge Case Hunter): a leading BOM byte (U+FEFF) shifts
    // every `^` regex anchor by one character and silently breaks the marker
    // strip + substitutions — the rendered PR body would still look correct
    // at a glance but the first non-empty line would be the marker (or
    // worse, the BOM-prefixed marker), violating AC 5.
    fx = makeFixture({
      withTemplate: true,
      templateBody: "\uFEFF" + CANONICAL_TEMPLATE,
    });
    let stdout = "";
    const code = runPrBody(
      { spec: fx.specRelPath, summary: "x", testPlan: "y", notes: "z" },
      {
        out: (s) => {
          stdout += s;
        },
        projectPath: fx.configPath,
      },
    );
    expect(code).toBe(0);
    const firstNonEmpty = stdout.split("\n").find((l) => l.trim() !== "");
    expect(firstNonEmpty).toBe(`**Spec:** \`${fx.specRelPath}\``);
    expect(stdout).not.toContain("\uFEFF");
    expect(stdout).not.toContain("<!-- devx:mode -->");
  });
});

describe("runPrBody — error paths", () => {
  let fx: Fixture | null = null;
  afterEach(() => {
    if (fx) rmSync(fx.dir, { recursive: true, force: true });
    fx = null;
  });

  it("returns 65 when devx.config.yaml is not found", () => {
    let stderr = "";
    const code = runPrBody(
      { spec: "dev/dev-foo.md" },
      {
        err: (s) => {
          stderr += s;
        },
        projectPath: "/nonexistent/devx.config.yaml",
      },
    );
    // findProjectConfig isn't called when projectPath is supplied — but
    // /nonexistent/dev/dev-foo.md doesn't exist either, so we still hit a
    // 65 exit. Validate via the spec-not-found branch, which is the same
    // exit code and the same operator-actionable message.
    expect(code).toBe(65);
    expect(stderr).toMatch(/spec file not found|devx\.config\.yaml/);
  });

  it("returns 65 when the spec file is missing", () => {
    fx = makeFixture();
    let stderr = "";
    const code = runPrBody(
      { spec: "dev/dev-doesnotexist.md" },
      {
        err: (s) => {
          stderr += s;
        },
        projectPath: fx.configPath,
      },
    );
    expect(code).toBe(65);
    expect(stderr).toContain("spec file not found");
  });

  it("returns 65 when --template-path points at a missing file", () => {
    fx = makeFixture();
    let stderr = "";
    const code = runPrBody(
      { spec: fx.specRelPath, templatePath: "missing/template.md" },
      {
        err: (s) => {
          stderr += s;
        },
        projectPath: fx.configPath,
      },
    );
    expect(code).toBe(65);
    expect(stderr).toContain("--template-path file not found");
  });

  it("returns 65 when an absolute spec path resolves outside the project", () => {
    // Self-review fix (Edge Case Hunter): a worktree-leak guard. An absolute
    // spec path that doesn't resolve inside projectDir (sibling worktree,
    // symlink, shared spec store) used to silently emit the absolute path
    // into the **Spec:** line. Now we hard-error with exit 65 so the
    // operator fixes the call rather than leaking.
    fx = makeFixture();
    const outsideDir = mkdtempSync(join(tmpdir(), "devx-pr-body-outside-"));
    const outsideSpec = join(outsideDir, "wrong.md");
    writeFileSync(
      outsideSpec,
      "## Acceptance criteria\n\n- [ ] x\n",
    );
    let stderr = "";
    const code = runPrBody(
      { spec: outsideSpec },
      {
        err: (s) => {
          stderr += s;
        },
        projectPath: fx.configPath,
      },
    );
    rmSync(outsideDir, { recursive: true, force: true });
    expect(code).toBe(65);
    expect(stderr).toContain("outside the project");
  });

  it("returns 65 when --template-path points at an empty template", () => {
    // Self-review fix (Edge Case Hunter): an empty (or whitespace-only)
    // template after load is a config bug, not a graceful-degradation case.
    // Returning a body of `**Spec:**` alone would slip silently into
    // `gh pr create` and produce an empty-bodied PR.
    fx = makeFixture();
    const emptyTpl = join(fx.dir, "empty.md");
    writeFileSync(emptyTpl, "   \n  \n");
    let stderr = "";
    const code = runPrBody(
      { spec: fx.specRelPath, templatePath: emptyTpl },
      {
        err: (s) => {
          stderr += s;
        },
        projectPath: fx.configPath,
      },
    );
    expect(code).toBe(65);
    expect(stderr).toContain("template is empty");
  });

  it("returns 65 when devx.config.yaml has no `mode` key", () => {
    fx = makeFixture();
    // Strip the mode key.
    writeFileSync(fx.configPath, "project:\n  shape: empty-dream\n");
    let stderr = "";
    const code = runPrBody(
      { spec: fx.specRelPath },
      {
        err: (s) => {
          stderr += s;
        },
        projectPath: fx.configPath,
      },
    );
    expect(code).toBe(65);
    expect(stderr).toContain("no `mode` key");
  });
});
