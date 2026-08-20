// c808b1 — the apply-vs-propose predicate for an unattended /devx-learn run.
//
// The property under test is a harness fact, not a taste: skill and settings
// edits prompt for confirmation even under bypass-permissions, so an
// unattended tab that tries one hangs until `retro_timeout_minutes` kills it
// and every lesson from that session is lost. Each wedge-path family below is
// a way to spell one of those edits; all of them must route `propose`, and
// ordinary source/doc/test paths must route `apply` or the whole point of the
// unattended mode (lessons that land) goes away.
//
// Fixture roots rather than the real repo/home: the verdict must not depend on
// where the suite happens to be checked out.
//
// Spec: dev/dev-c808b1-2026-08-05T11:25-devx-learn-unattended-apply.md

import { describe, expect, it } from "vitest";

import { runLearnRoute } from "../src/commands/learn-helper.js";
import { routeLearnPath, routeLearnPaths } from "../src/lib/learn/route.js";

const REPO = "/tmp/fixture-repo";
const HOME = "/tmp/fixture-home";
const OPTS = { repoRoot: REPO, home: HOME };

// Every family of path an unattended tab cannot edit, spelled the ways a skill
// body might actually write one.
const WEDGE_PATHS: Array<{ path: string; note: string }> = [
  { path: ".claude/commands/devx-learn.md", note: "repo skill body" },
  { path: "./.claude/commands/devx.md", note: "dot-prefixed skill body" },
  { path: ".claude/settings.json", note: "repo settings" },
  { path: ".claude/settings.local.json", note: "repo local settings" },
  { path: ".claude/agents/reviewer.md", note: "agent definition" },
  { path: "mobile/.claude/commands/x.md", note: "nested .claude" },
  { path: "skills/devx-learn.md", note: "packaged skill mirror" },
  { path: "./skills/devx.md", note: "dot-prefixed mirror" },
  { path: "settings.json", note: "bare settings.json at the root" },
  { path: "worker/settings.local.json", note: "settings file in a subproject" },
  { path: "~/.claude/settings.json", note: "tilde home settings" },
  { path: "~/.claude/devx/proposals/2026-08-20-x.md", note: "outlet-4 personal home" },
  { path: `${HOME}/.claude/CLAUDE.md`, note: "absolute home path" },
  { path: "../other-repo/src/x.ts", note: "escapes the repo via .." },
  { path: "/etc/hosts", note: "absolute path outside the repo" },
  { path: "", note: "empty path" },
  { path: "   ", note: "whitespace-only path" },
  { path: ".", note: "the repo root itself" },
];

const APPLY_PATHS: Array<{ path: string; note: string }> = [
  { path: "src/lib/learn/route.ts", note: "source" },
  { path: "./src/commands/learn-helper.ts", note: "dot-prefixed source" },
  { path: "docs/DESIGN.md", note: "docs" },
  { path: "docs/updates/2026-08-20-x.md", note: "proposal doc" },
  { path: "test/learn-route.test.ts", note: "test" },
  { path: "LEARN.md", note: "root markdown" },
  { path: "devx.config.yaml", note: "repo config" },
  { path: "_devx/templates/engine/prd.md", note: "packaged template" },
  { path: `${REPO}/src/cli.ts`, note: "absolute in-repo path" },
  { path: "src/lib/skills/x.ts", note: "'skills' nested under src is ordinary code" },
];

describe("c808b1 — routeLearnPath: wedge-path families never reach the apply path", () => {
  it.each(WEDGE_PATHS)("proposes $note ($path)", ({ path }) => {
    const verdict = routeLearnPath(path, OPTS);
    expect(verdict.decision).toBe("propose");
    expect(verdict.reason.length).toBeGreaterThan(0);
  });

  it("names the harness gate, not just the outcome, for a skill-body edit", () => {
    expect(routeLearnPath(".claude/commands/devx-learn.md", OPTS).reason).toMatch(
      /confirmation/i,
    );
  });

  it("echoes the path as written so a report row is traceable", () => {
    expect(routeLearnPath("./skills/devx.md", OPTS).path).toBe("./skills/devx.md");
  });
});

describe("c808b1 — routeLearnPath: ordinary repo paths apply", () => {
  it.each(APPLY_PATHS)("applies $note ($path)", ({ path }) => {
    const verdict = routeLearnPath(path, OPTS);
    expect(verdict.decision).toBe("apply");
    expect(verdict.reason.length).toBeGreaterThan(0);
  });
});

describe("c808b1 — routeLearnPaths: one propose proposes the row", () => {
  it("proposes a mixed change set and reports the blocking path", () => {
    const result = routeLearnPaths(
      ["src/lib/learn/route.ts", ".claude/commands/devx-learn.md", "docs/DESIGN.md"],
      OPTS,
    );
    expect(result.decision).toBe("propose");
    expect(result.reason).toContain(".claude/commands/devx-learn.md");
    expect(result.verdicts).toHaveLength(3);
    expect(result.verdicts.map((v) => v.decision)).toEqual(["apply", "propose", "apply"]);
  });

  it("applies an all-clear change set", () => {
    const result = routeLearnPaths(["src/lib/learn/route.ts", "test/learn-route.test.ts"], OPTS);
    expect(result.decision).toBe("apply");
    expect(result.verdicts.every((v) => v.decision === "apply")).toBe(true);
  });

  it("proposes an empty change set rather than applying nothing", () => {
    const result = routeLearnPaths([], OPTS);
    expect(result.decision).toBe("propose");
    expect(result.verdicts).toEqual([]);
  });
});

describe("c808b1 — `devx learn-helper route` CLI surface", () => {
  function capture(paths: string[], quiet?: boolean): { code: number; text: string } {
    let text = "";
    const code = runLearnRoute(paths, { ...OPTS, quiet, out: (s) => (text += s) });
    return { code, text };
  }

  it("prints the verdict as JSON and exits 0 on the apply path", () => {
    const { code, text } = capture(["src/lib/learn/route.ts"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(text);
    expect(parsed.decision).toBe("apply");
    expect(parsed.verdicts).toHaveLength(1);
  });

  it("exits 0 on the propose path too — a propose is an answer, not a failure", () => {
    const { code, text } = capture([".claude/settings.json"]);
    expect(code).toBe(0);
    expect(JSON.parse(text).decision).toBe("propose");
  });

  it("--quiet prints only the decision word", () => {
    expect(capture(["docs/DESIGN.md"], true).text).toBe("apply\n");
    expect(capture(["skills/devx.md"], true).text).toBe("propose\n");
  });

  it("no arguments is a propose, not a usage error", () => {
    const { code, text } = capture([]);
    expect(code).toBe(0);
    expect(JSON.parse(text).decision).toBe("propose");
  });
});
