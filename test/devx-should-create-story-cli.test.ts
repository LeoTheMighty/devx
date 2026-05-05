// CLI-passthrough tests for `devx devx-helper should-create-story <hash>`
// (dvx102). Exercises the resolution pipeline end-to-end:
//   - load config from a fixture devx.config.yaml
//   - locate spec under <repoRoot>/dev/dev-<hash>-*.md
//   - count ACs from spec content
//   - probe story-file existence under
//     <repoRoot>/_bmad-output/implementation-artifacts/story-<hash>.md
//   - emit the expected JSON shape on stdout
//
// Strategy mirrors devx-helper-cli.test.ts (the dvx101 CLI tests).
//
// Spec: dev/dev-dvx102-2026-04-28T19:30-devx-conditional-create-story.md

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runShouldCreateStory } from "../src/commands/devx-helper.js";
import { countActionableAcs } from "../src/commands/devx-helper.js";

interface Fixture {
  dir: string;
  configPath: string;
  specPath: string;
}

interface FixtureOpts {
  hash?: string;
  shape?: string;
  canary?: string;
  acCount?: number;
  withStoryFile?: boolean;
}

function makeFixture(opts: FixtureOpts = {}): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "devx-should-create-story-"));
  const hash = opts.hash ?? "dvx102";
  const shape = opts.shape ?? "empty-dream";
  const acCount = opts.acCount ?? 5;

  const configLines = [
    "mode: YOLO",
    "project:",
    `  shape: ${shape}`,
  ];
  if (opts.canary !== undefined) {
    configLines.push("_internal:");
    configLines.push(`  skip_create_story_canary: ${opts.canary}`);
  }
  configLines.push("");
  const configPath = join(dir, "devx.config.yaml");
  writeFileSync(configPath, configLines.join("\n"));

  const specDir = join(dir, "dev");
  mkdirSync(specDir, { recursive: true });
  const specPath = join(specDir, `dev-${hash}-2026-04-28T19:30-fixture.md`);
  const acLines: string[] = [];
  for (let i = 1; i <= acCount; i++) {
    acLines.push(`- [ ] AC #${i} — fixture acceptance criterion.`);
  }
  writeFileSync(
    specPath,
    [
      "---",
      `hash: ${hash}`,
      "type: dev",
      "title: Fixture",
      "status: ready",
      "---",
      "",
      "## Goal",
      "",
      "Test.",
      "",
      "## Acceptance criteria",
      "",
      ...acLines,
      "",
      "## Status log",
      "",
      "- 2026-04-28T19:30 — created by /devx-plan",
      "",
    ].join("\n"),
  );

  if (opts.withStoryFile) {
    const storyDir = join(dir, "_bmad-output", "implementation-artifacts");
    mkdirSync(storyDir, { recursive: true });
    writeFileSync(
      join(storyDir, `story-${hash}.md`),
      "# Story (fixture)\n",
    );
  }

  return { dir, configPath, specPath };
}

function destroy(fx: Fixture): void {
  rmSync(fx.dir, { recursive: true, force: true });
}

interface CapturedIO {
  stdout: string;
  stderr: string;
}

function capture(): {
  out: (s: string) => void;
  err: (s: string) => void;
  io: CapturedIO;
} {
  const io: CapturedIO = { stdout: "", stderr: "" };
  return {
    out: (s) => {
      io.stdout += s;
    },
    err: (s) => {
      io.stderr += s;
    },
    io,
  };
}

describe("devx devx-helper should-create-story — happy path", () => {
  let fx: Fixture;
  afterEach(() => destroy(fx));

  it("canary off (default) + empty-dream + 5 ACs + no story → exit 0, decision invoke=false, action=invoke", async () => {
    fx = makeFixture();
    const cap = capture();
    const code = await runShouldCreateStory(["dvx102"], {
      out: cap.out,
      err: cap.err,
      projectPath: fx.configPath,
      repoRoot: fx.dir,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(cap.io.stdout);
    expect(parsed.hash).toBe("dvx102");
    expect(parsed.canary).toBe("off");
    expect(parsed.decision.invoke).toBe(false);
    expect(parsed.decision.reason).toMatch(/empty-dream \+ 5 ACs/);
    expect(parsed.effective.action).toBe("invoke");
    expect(parsed.effective.statusLog).toContain("canary=off");
    expect(parsed.effective.statusLog).toContain("INVOKED (canary=off");
    expect(parsed.inputs).toEqual({ acCount: 5, hasStoryFile: false });
  });

  it("canary active + empty-dream + 5 ACs + no story → action=skip", async () => {
    fx = makeFixture({ canary: "active" });
    const cap = capture();
    const code = await runShouldCreateStory(["dvx102"], {
      out: cap.out,
      err: cap.err,
      projectPath: fx.configPath,
      repoRoot: fx.dir,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(cap.io.stdout);
    expect(parsed.canary).toBe("active");
    expect(parsed.decision.invoke).toBe(false);
    expect(parsed.effective.action).toBe("skip");
    expect(parsed.effective.statusLog).toContain("SKIPPED (helper)");
  });

  it("canary active + story file present → action=read-existing", async () => {
    fx = makeFixture({ canary: "active", withStoryFile: true });
    const cap = capture();
    const code = await runShouldCreateStory(["dvx102"], {
      out: cap.out,
      err: cap.err,
      projectPath: fx.configPath,
      repoRoot: fx.dir,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(cap.io.stdout);
    expect(parsed.decision.reason).toBe("story-file-exists");
    expect(parsed.effective.action).toBe("read-existing");
    expect(parsed.inputs.hasStoryFile).toBe(true);
  });

  it("non-empty-dream shape → decision invoke=true, action=invoke", async () => {
    fx = makeFixture({ shape: "mature-refactor-and-add", canary: "active" });
    const cap = capture();
    const code = await runShouldCreateStory(["dvx102"], {
      out: cap.out,
      err: cap.err,
      projectPath: fx.configPath,
      repoRoot: fx.dir,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(cap.io.stdout);
    expect(parsed.decision.invoke).toBe(true);
    expect(parsed.decision.reason).toBe("shape-not-empty-dream");
    expect(parsed.effective.action).toBe("invoke");
  });

  it("AC count below threshold → decision invoke=true, reason=few-actionable-acs", async () => {
    fx = makeFixture({ canary: "active", acCount: 2 });
    const cap = capture();
    const code = await runShouldCreateStory(["dvx102"], {
      out: cap.out,
      err: cap.err,
      projectPath: fx.configPath,
      repoRoot: fx.dir,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(cap.io.stdout);
    expect(parsed.decision.reason).toBe("few-actionable-acs");
    expect(parsed.effective.action).toBe("invoke");
    expect(parsed.inputs.acCount).toBe(2);
  });

  it("invalid canary value silently defaults to off", async () => {
    fx = makeFixture({ canary: "on" }); // typo
    const cap = capture();
    const code = await runShouldCreateStory(["dvx102"], {
      out: cap.out,
      err: cap.err,
      projectPath: fx.configPath,
      repoRoot: fx.dir,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(cap.io.stdout);
    expect(parsed.canary).toBe("off");
  });
});

describe("devx devx-helper should-create-story — exit 2 (resolve failures)", () => {
  let fx: Fixture;
  afterEach(() => destroy(fx));

  it("no spec file matching hash → exit 2 with stage:resolve", async () => {
    fx = makeFixture();
    const cap = capture();
    const code = await runShouldCreateStory(["zzz999"], {
      out: cap.out,
      err: cap.err,
      projectPath: fx.configPath,
      repoRoot: fx.dir,
    });
    expect(code).toBe(2);
    const parsed = JSON.parse(cap.io.stdout);
    expect(parsed.error).toBe("rollback");
    expect(parsed.stage).toBe("resolve");
    expect(cap.io.stderr).toMatch(/no spec file found/);
  });

  it("missing devx.config.yaml → exit 2 with stage:config-load", async () => {
    const cap = capture();
    const code = await runShouldCreateStory(["dvx102"], {
      out: cap.out,
      err: cap.err,
      projectPath: "/nonexistent/devx.config.yaml",
    });
    expect(code).toBe(2);
    const parsed = JSON.parse(cap.io.stdout);
    expect(parsed.error).toBe("rollback");
    expect(parsed.stage).toBe("config-load");
  });
});

describe("devx devx-helper should-create-story — exit 64 (usage)", () => {
  it("missing hash arg → exit 64", async () => {
    const cap = capture();
    const code = await runShouldCreateStory([], {
      out: cap.out,
      err: cap.err,
    });
    expect(code).toBe(64);
    expect(cap.io.stderr).toMatch(/usage:/);
  });

  it("invalid hash shape → exit 64", async () => {
    const cap = capture();
    const code = await runShouldCreateStory(["../bad"], {
      out: cap.out,
      err: cap.err,
    });
    expect(code).toBe(64);
    expect(cap.io.stderr).toMatch(/invalid hash/);
  });
});

// ---------------------------------------------------------------------------
// countActionableAcs — column-0 checkbox counter
// ---------------------------------------------------------------------------

describe("countActionableAcs", () => {
  it("counts column-0 `- [ ]` items under ## Acceptance criteria", () => {
    const spec = [
      "## Goal",
      "",
      "intro",
      "",
      "## Acceptance criteria",
      "",
      "- [ ] one",
      "- [ ] two",
      "  - sub-bullet (not an AC)",
      "- [ ] three",
      "",
      "## Status log",
      "",
      "- some entry",
    ].join("\n");
    expect(countActionableAcs(spec)).toBe(3);
  });

  it("returns 0 when no Acceptance criteria heading", () => {
    expect(countActionableAcs("## Goal\n\nintro\n")).toBe(0);
  });

  it("returns 0 when section is empty", () => {
    const spec = [
      "## Acceptance criteria",
      "",
      "## Status log",
    ].join("\n");
    expect(countActionableAcs(spec)).toBe(0);
  });

  it("counts ALL checkbox states (structural — Phase 2 re-run mid-impl is stable)", () => {
    // Per the helper's contract: the AC count is a structural property
    // of the spec (how many criteria it imposes), not a transient count
    // of open items. A mid-impl Phase 2 re-run with some ACs checked
    // off must yield the same decision as the original run.
    const spec = [
      "## Acceptance criteria",
      "",
      "- [x] done",
      "- [/] in-progress",
      "- [-] blocked",
      "- [ ] todo",
      "- [ ] also todo",
    ].join("\n");
    expect(countActionableAcs(spec)).toBe(5);
  });

  it("handles CRLF line endings", () => {
    // Hand-edited specs from Windows or some editors land CRLF;
    // make sure the column-0 anchor + section delimiter still work.
    const spec = [
      "## Acceptance criteria",
      "",
      "- [ ] one",
      "- [ ] two",
      "- [ ] three",
      "",
      "## Status log",
      "",
      "- entry",
    ].join("\r\n");
    expect(countActionableAcs(spec)).toBe(3);
  });

  it("ignores indented checkboxes (sub-items are not ACs)", () => {
    const spec = [
      "## Acceptance criteria",
      "",
      "- [ ] outer",
      "  - [ ] indented (not an AC)",
      "    - [ ] doubly indented (also not)",
    ].join("\n");
    expect(countActionableAcs(spec)).toBe(1);
  });
});
