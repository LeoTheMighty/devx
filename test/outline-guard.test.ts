// Outline protection L1 + L3 — pure decision logic and the CLI seams that
// don't shell out to git (guard, init). The real-git leg (check, commit)
// lives in test/outline-check-git.test.ts (SYNC_BLOCKING).

import { afterEach, describe, expect, it } from "vitest";

import {
  AGENT_ENV_MARKERS,
  agentSessionRefusal,
  classifyDiffNames,
  guardDecision,
  isAgentSessionEnv,
  isProtectedOutlinePath,
  renderDenyJson,
} from "../src/lib/engine/outline.js";
import {
  runOutlineGuard,
  runOutlineInit,
} from "../src/commands/outline.js";
import { captureIo, makeEngineRepo } from "./fixtures/engine-repo.js";

const HUMAN_ENV = {} as Record<string, string | undefined>;

// ---------------------------------------------------------------------------
// isProtectedOutlinePath
// ---------------------------------------------------------------------------

describe("isProtectedOutlinePath", () => {
  it("protects workstream stage outlines at any depth", () => {
    expect(isProtectedOutlinePath("_devx/workstreams/x/prd/outline.md")).toBe(true);
    expect(isProtectedOutlinePath("_devx/workstreams/x/evals/outline.md")).toBe(true);
    expect(isProtectedOutlinePath("/abs/repo/_devx/workstreams/x/plan/outline.md")).toBe(true);
    expect(isProtectedOutlinePath("_devx\\workstreams\\x\\design\\outline.md")).toBe(true);
  });

  it("protects the repo-root OUTLINE.md", () => {
    expect(isProtectedOutlinePath("OUTLINE.md")).toBe(true);
    expect(isProtectedOutlinePath("/abs/repo/OUTLINE.md")).toBe(true);
  });

  it("does NOT protect shipped outline templates (agent-authored scaffolds)", () => {
    expect(isProtectedOutlinePath("_devx/templates/engine/prd/outline.md")).toBe(false);
    expect(isProtectedOutlinePath("/abs/repo/_devx/templates/engine/OUTLINE.md")).toBe(false);
  });

  it("does NOT protect the agent's critique files", () => {
    expect(isProtectedOutlinePath("_devx/workstreams/x/prd/outline-critique.md")).toBe(false);
    expect(isProtectedOutlinePath("OUTLINE-CRITIQUE.md")).toBe(false);
  });

  it("does NOT protect agent.md / human.md / unrelated files", () => {
    expect(isProtectedOutlinePath("_devx/workstreams/x/prd/agent.md")).toBe(false);
    expect(isProtectedOutlinePath("_devx/workstreams/x/prd/human.md")).toBe(false);
    expect(isProtectedOutlinePath("src/outline.ts")).toBe(false);
    expect(isProtectedOutlinePath("docs/outline-notes.md")).toBe(false);
  });

  it("scopes protection to root + workstreams — a docs site's own outline.md is untouched", () => {
    expect(isProtectedOutlinePath("docs/outline.md")).toBe(false);
    expect(isProtectedOutlinePath("website/docs/outline.md")).toBe(false);
  });

  it("is case-insensitive on the basename (APFS/NTFS resolve case-insensitively)", () => {
    expect(isProtectedOutlinePath("_devx/workstreams/x/prd/Outline.md")).toBe(true);
    expect(isProtectedOutlinePath("outline.md")).toBe(true);
    expect(isProtectedOutlinePath("OUTLINE.MD")).toBe(true);
  });

  it("collapses ../ traversal — the template carve-out can't be dodged", () => {
    expect(
      isProtectedOutlinePath("_devx/templates/../workstreams/x/prd/outline.md"),
    ).toBe(true);
    expect(
      isProtectedOutlinePath("/r/_devx/templates/engine/../../workstreams/x/prd/outline.md"),
    ).toBe(true);
  });

  it("dequotes git's quotePath rendering before classifying", () => {
    expect(
      isProtectedOutlinePath('"_devx/workstreams/caf\\303\\251/prd/outline.md"'),
    ).toBe(true);
  });
});

describe("classifyDiffNames", () => {
  it("filters a git name listing down to protected paths", () => {
    expect(
      classifyDiffNames([
        "src/cli.ts",
        "_devx/workstreams/x/prd/outline.md",
        "_devx/workstreams/x/prd/outline-critique.md",
        "OUTLINE.md",
        "",
        "  ",
      ]),
    ).toEqual(["_devx/workstreams/x/prd/outline.md", "OUTLINE.md"]);
  });
});

// ---------------------------------------------------------------------------
// guardDecision
// ---------------------------------------------------------------------------

function editPayload(tool: string, file_path: string): unknown {
  return { tool_name: tool, tool_input: { file_path } };
}

describe("guardDecision", () => {
  it("denies Edit/Write/MultiEdit/NotebookEdit on outline paths", () => {
    for (const tool of ["Edit", "Write", "MultiEdit"]) {
      const d = guardDecision(editPayload(tool, "/r/_devx/workstreams/x/prd/outline.md"));
      expect(d.deny).toBe(true);
      expect(d.reason).toContain("human-only");
    }
    const nb = guardDecision({
      tool_name: "NotebookEdit",
      tool_input: { notebook_path: "/r/OUTLINE.md" },
    });
    expect(nb.deny).toBe(true);
  });

  it("allows edit tools on non-outline paths (incl. outline-critique.md)", () => {
    expect(guardDecision(editPayload("Edit", "/r/x/prd/outline-critique.md")).deny).toBe(false);
    expect(guardDecision(editPayload("Write", "/r/x/prd/agent.md")).deny).toBe(false);
    expect(guardDecision(editPayload("Write", "/r/OUTLINE-CRITIQUE.md")).deny).toBe(false);
  });

  it("denies Bash commands that write/remove an outline path", () => {
    for (const cmd of [
      "echo hi > _devx/workstreams/x/prd/outline.md",
      "cat foo >> OUTLINE.md",
      "sed -i '' 's/a/b/' _devx/workstreams/x/plan/outline.md",
      "cp /tmp/x _devx/workstreams/x/evals/outline.md",
      "rm OUTLINE.md",
      "touch _devx/workstreams/x/prd/Outline.md",
    ]) {
      expect(guardDecision({ tool_name: "Bash", tool_input: { command: cmd } }).deny).toBe(true);
    }
  });

  it("allows read-only diagnostics and index-only git verbs over outline paths", () => {
    for (const cmd of [
      "cat _devx/workstreams/x/prd/outline.md",
      "grep -n goals _devx/workstreams/x/prd/outline.md",
      "git log -- _devx/workstreams/x/prd/outline.md",
      "git restore --staged _devx/workstreams/x/evals/outline.md",
      "git rm --cached OUTLINE.md",
    ]) {
      expect(
        guardDecision({ tool_name: "Bash", tool_input: { command: cmd } }).deny,
        cmd,
      ).toBe(false);
    }
  });

  it("the allow-list never rides shell operators (chained-command bypass)", () => {
    for (const cmd of [
      "devx outline check && printf hi > _devx/workstreams/x/prd/outline.md",
      "devx outline guard; echo hi > OUTLINE.md",
      "cat _devx/workstreams/x/prd/outline.md > /tmp/copy && cp /tmp/copy _devx/workstreams/x/prd/outline.md",
      "grep x $(echo _devx/workstreams/x/prd/outline.md)",
    ]) {
      expect(
        guardDecision({ tool_name: "Bash", tool_input: { command: cmd } }).deny,
        cmd,
      ).toBe(true);
    }
  });

  it("allows Bash commands that only touch outline TEMPLATES", () => {
    expect(
      guardDecision({
        tool_name: "Bash",
        tool_input: { command: "git add _devx/templates/engine/prd/outline.md" },
      }).deny,
    ).toBe(false);
    // …but a mixed command naming a real outline still denies.
    expect(
      guardDecision({
        tool_name: "Bash",
        tool_input: {
          command:
            "cp _devx/templates/engine/prd/outline.md _devx/workstreams/x/prd/outline.md",
        },
      }).deny,
    ).toBe(true);
  });

  it("carves out `devx outline check|guard` Bash invocations", () => {
    expect(
      guardDecision({
        tool_name: "Bash",
        tool_input: { command: "devx outline check --diff origin/main...HEAD" },
      }).deny,
    ).toBe(false);
    expect(
      guardDecision({ tool_name: "Bash", tool_input: { command: "  devx outline guard" } }).deny,
    ).toBe(false);
  });

  it("allows unrelated Bash commands and unknown tools", () => {
    expect(
      guardDecision({ tool_name: "Bash", tool_input: { command: "npm test" } }).deny,
    ).toBe(false);
    expect(
      guardDecision({ tool_name: "Read", tool_input: { file_path: "/r/OUTLINE.md" } }).deny,
    ).toBe(false);
  });

  it("allows malformed payloads (never bricks unrelated tool use)", () => {
    expect(guardDecision(null).deny).toBe(false);
    expect(guardDecision("junk").deny).toBe(false);
    expect(guardDecision({}).deny).toBe(false);
    expect(guardDecision({ tool_name: "Edit" }).deny).toBe(false);
  });
});

describe("renderDenyJson", () => {
  it("emits the PreToolUse permissionDecision contract", () => {
    const parsed = JSON.parse(renderDenyJson("why")) as {
      hookSpecificOutput: Record<string, string>;
    };
    expect(parsed.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toBe("why");
  });
});

// ---------------------------------------------------------------------------
// runOutlineGuard (CLI wrapper around the decision)
// ---------------------------------------------------------------------------

describe("runOutlineGuard", () => {
  it("prints the deny JSON and exits 0 on a protected write", () => {
    const io = captureIo();
    const code = runOutlineGuard({
      out: io.out,
      err: io.err,
      stdin: () =>
        JSON.stringify(editPayload("Write", "_devx/workstreams/x/prd/outline.md")),
    });
    expect(code).toBe(0);
    const parsed = io.json() as { hookSpecificOutput: Record<string, string> };
    expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("prints nothing and exits 0 on an allowed call", () => {
    const io = captureIo();
    const code = runOutlineGuard({
      out: io.out,
      err: io.err,
      stdin: () => JSON.stringify(editPayload("Edit", "src/cli.ts")),
    });
    expect(code).toBe(0);
    expect(io.stdout()).toBe("");
  });

  it("allows on unparseable stdin", () => {
    const io = captureIo();
    expect(runOutlineGuard({ out: io.out, err: io.err, stdin: () => "not json" })).toBe(0);
    expect(io.stdout()).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Agent-session env detection + init refusal
// ---------------------------------------------------------------------------

describe("isAgentSessionEnv", () => {
  it("detects each marker; ignores empty values", () => {
    expect(isAgentSessionEnv({})).toBe(false);
    expect(isAgentSessionEnv({ CLAUDECODE: "1" })).toBe(true);
    expect(isAgentSessionEnv({ CHIRP_SESSION_ID: "abc" })).toBe(true);
    expect(isAgentSessionEnv({ CLAUDECODE: "" })).toBe(false);
    expect(AGENT_ENV_MARKERS).toContain("CLAUDECODE");
  });
});

describe("runOutlineInit", () => {
  const repos: { cleanup(): void }[] = [];
  afterEach(() => {
    while (repos.length > 0) repos.pop()!.cleanup();
  });

  function repoWithWorkstream(): { root: string; configPath: string } {
    const repo = makeEngineRepo();
    repos.push(repo);
    repo.write(
      "plan/plan-abc123-2026-08-23T10:00-demo.md",
      [
        "---",
        "hash: abc123",
        "type: plan",
        "created: 2026-08-23T10:00:00-06:00",
        "title: Demo",
        "status: in-progress",
        "stage: prd",
        "entered_at: prd",
        "gate_status:",
        "  prd_validated: false",
        "  design_verified: false",
        "  plan_verified: false",
        "  evals_red: false",
        "outcome:",
        "  status: null",
        "  measure_by: null",
        "workstream: _devx/workstreams/demo",
        "---",
        "",
        "## Goal",
        "Demo.",
      ].join("\n"),
    );
    repo.mkdir("_devx/workstreams/demo");
    return repo;
  }

  it("refuses inside an agent session", () => {
    const repo = repoWithWorkstream();
    const io = captureIo();
    const code = runOutlineInit(["abc123", "prd"], {}, {
      out: io.out,
      err: io.err,
      projectPath: repo.configPath,
      env: { CLAUDECODE: "1" },
    });
    expect(code).toBe(1);
    expect(io.stderr()).toContain("refusing to run inside an agent session");
    expect(io.stderr()).toBe(agentSessionRefusal("init") + "\n");
  });

  it("scaffolds <ws>/<stage>/outline.md for a human", () => {
    const repo = repoWithWorkstream();
    const io = captureIo();
    const code = runOutlineInit(["abc123", "prd"], {}, {
      out: io.out,
      err: io.err,
      projectPath: repo.configPath,
      env: HUMAN_ENV,
    });
    expect(code).toBe(0);
    expect(io.json()).toEqual({ created: "_devx/workstreams/demo/prd/outline.md" });
  });

  it("never overwrites an existing outline", () => {
    const repo = repoWithWorkstream();
    const io1 = captureIo();
    expect(
      runOutlineInit(["abc123", "design"], {}, {
        out: io1.out,
        err: io1.err,
        projectPath: repo.configPath,
        env: HUMAN_ENV,
      }),
    ).toBe(0);
    const io2 = captureIo();
    const code = runOutlineInit(["abc123", "design"], {}, {
      out: io2.out,
      err: io2.err,
      projectPath: repo.configPath,
      env: HUMAN_ENV,
    });
    expect(code).toBe(1);
    expect(io2.stderr()).toContain("never overwritten");
  });

  it("rejects unknown stages", () => {
    const repo = repoWithWorkstream();
    const io = captureIo();
    const code = runOutlineInit(["abc123", "retro"], {}, {
      out: io.out,
      err: io.err,
      projectPath: repo.configPath,
      env: HUMAN_ENV,
    });
    expect(code).toBe(2);
    expect(io.stderr()).toContain("unknown stage");
  });

  it("scaffolds the repo-root OUTLINE.md with --project", () => {
    const repo = repoWithWorkstream();
    const io = captureIo();
    const code = runOutlineInit([], { project: true }, {
      out: io.out,
      err: io.err,
      projectPath: repo.configPath,
      env: HUMAN_ENV,
    });
    expect(code).toBe(0);
    expect(io.json()).toEqual({ created: "OUTLINE.md" });
  });
});
