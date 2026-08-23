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
import {
  isLockedFlag,
  LOCKED_MACHINERY_REASON,
  routeLearnPath,
  routeLearnPaths,
} from "../src/lib/learn/route.js";

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
  { path: "_devx/templates/engine/prd/agent.md", note: "packaged template" },
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

// c808b1 — the locked-machinery carve-out, the half of the predicate no path
// pattern can decide. The spec's test AC is "a locked-machinery row never
// reaches the apply path", and the failure it guards against is specific: a
// row that loosens gate logic lives in ordinary `src/` code, so every path
// rule says `apply` and only the caller's declaration stands between an
// unattended run and a system with no floor.
describe("c808b1 — locked machinery outranks every path rule", () => {
  // Deliberately the most apply-looking change set in the repo.
  const ORDINARY = ["src/lib/merge-gate.ts", "test/merge-gate.test.ts", "docs/MODES.md"];

  it("a locked row of otherwise-appliable paths proposes", () => {
    const unlocked = routeLearnPaths(ORDINARY, OPTS);
    expect(unlocked.decision).toBe("apply"); // control: the paths alone say apply

    const locked = routeLearnPaths(ORDINARY, { ...OPTS, locked: true });
    expect(locked.decision).toBe("propose");
    expect(locked.reason).toBe(LOCKED_MACHINERY_REASON);
  });

  it("leaves no `apply` verdict anywhere for a consumer to pick up", () => {
    // A report renderer or a retry that scans per-path verdicts must not find
    // a green light on any single path of a locked row.
    const locked = routeLearnPaths(ORDINARY, { ...OPTS, locked: true });
    expect(locked.verdicts).toHaveLength(ORDINARY.length);
    expect(locked.verdicts.every((v) => v.decision === "propose")).toBe(true);
    expect(locked.verdicts.every((v) => v.reason === LOCKED_MACHINERY_REASON)).toBe(true);
    expect(JSON.stringify(locked)).not.toMatch(/"decision": ?"apply"/);
  });

  it("proposes a locked row with no paths at all", () => {
    const locked = routeLearnPaths([], { ...OPTS, locked: true });
    expect(locked.decision).toBe("propose");
    expect(locked.reason).toBe(LOCKED_MACHINERY_REASON);
  });

  it("single-path routing honors the flag too — the guard has no bypass door", () => {
    const v = routeLearnPath("src/lib/merge-gate.ts", { ...OPTS, locked: true });
    expect(v.decision).toBe("propose");
    expect(v.reason).toBe(LOCKED_MACHINERY_REASON);
    expect(v.path).toBe("src/lib/merge-gate.ts");
  });

  it("is one-directional — `locked` can never turn a wedge path into an apply", () => {
    for (const path of [".claude/commands/devx.md", "skills/devx.md", "~/.claude/settings.json"]) {
      for (const locked of [true, false, undefined]) {
        expect(routeLearnPath(path, { ...OPTS, locked }).decision, `${path} locked=${locked}`).toBe(
          "propose",
        );
      }
    }
  });

  it("omitted / false means not locked, so ordinary rows still apply", () => {
    expect(routeLearnPaths(ORDINARY, { ...OPTS, locked: false }).decision).toBe("apply");
    expect(routeLearnPaths(ORDINARY, { ...OPTS, locked: undefined }).decision).toBe("apply");
  });

  // The flag arrives from a skill body assembling CLI args by hand. Every way
  // of fumbling its type has to land on `propose`: this is the one flag whose
  // caller-bug must not end in an unattended apply.
  it("reads fail-closed — any non-false value counts as locked", () => {
    for (const value of [true, "true", "false", "no", 0, 1, "", [], {}]) {
      expect(isLockedFlag(value), JSON.stringify(value)).toBe(true);
    }
    for (const value of [false, undefined, null]) {
      expect(isLockedFlag(value), String(value)).toBe(false);
    }
  });

  it("fail-closed reading reaches the routing functions, not just the helper", () => {
    const bogus = routeLearnPaths(ORDINARY, { ...OPTS, locked: "no" as unknown as boolean });
    expect(bogus.decision).toBe("propose");
  });
});

describe("c808b1 — `devx learn-helper route --locked` CLI surface", () => {
  function capture(paths: string[], opts: { quiet?: boolean; locked?: boolean } = {}) {
    let text = "";
    const code = runLearnRoute(paths, { ...OPTS, ...opts, out: (s) => (text += s) });
    return { code, text };
  }

  it("--locked forces propose on an ordinary change set and exits 0", () => {
    const { code, text } = capture(["src/lib/merge-gate.ts"], { locked: true });
    expect(code).toBe(0);
    const parsed = JSON.parse(text);
    expect(parsed.decision).toBe("propose");
    expect(parsed.reason).toBe(LOCKED_MACHINERY_REASON);
  });

  it("--locked --quiet prints just the decision word", () => {
    expect(capture(["src/lib/merge-gate.ts"], { locked: true, quiet: true }).text).toBe("propose\n");
    expect(capture(["src/lib/merge-gate.ts"], { quiet: true }).text).toBe("apply\n");
  });
});
