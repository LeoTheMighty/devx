// Outline protection L1 + L3 — pure decision logic and the CLI seams that
// don't shell out to git (guard, init). The real-git leg (check, commit)
// lives in test/outline-check-git.test.ts (SYNC_BLOCKING).

import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  AGENT_ENV_MARKERS,
  agentSessionRefusal,
  classifyDiffNames,
  guardDecision,
  isAgentSessionEnv,
  isProtectedOutlinePath,
  outlineKindOf,
  renderDenyJson,
} from "../src/lib/engine/outline.js";
import {
  builtinSkeleton,
  outlineTemplateRel,
} from "../src/lib/engine/outline-scaffold.js";
import {
  runOutlineGuard,
  runOutlineInit,
} from "../src/commands/outline.js";
import { REAL_REPO_ROOT, captureIo, makeEngineRepo } from "./fixtures/engine-repo.js";

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

  // docs.layout: project-level — the flat repo-root shape. Without these the
  // layout switch would silently un-protect every outline in the repo.
  it("protects project-level stage outlines at the repo root", () => {
    expect(isProtectedOutlinePath("prd-outline.md")).toBe(true);
    expect(isProtectedOutlinePath("design-outline.md")).toBe(true);
    expect(isProtectedOutlinePath("plan-outline.md")).toBe(true);
    expect(isProtectedOutlinePath("evals-outline.md")).toBe(true);
  });

  it("protects project-level outlines handed over as absolute paths", () => {
    // Edit/Write hand the guard absolute paths; the repo root is unknowable
    // in a pure function, so these match at any depth.
    expect(isProtectedOutlinePath("/abs/repo/design-outline.md")).toBe(true);
    expect(isProtectedOutlinePath("C:\\repo\\plan-outline.md")).toBe(true);
  });

  it("is case-insensitive on project-level outline basenames", () => {
    expect(isProtectedOutlinePath("PRD-Outline.md")).toBe(true);
    expect(isProtectedOutlinePath("/abs/repo/DESIGN-OUTLINE.MD")).toBe(true);
  });

  it("does NOT protect project-level critiques — the critique is the agent's product", () => {
    expect(isProtectedOutlinePath("prd-outline-critique.md")).toBe(false);
    expect(isProtectedOutlinePath("design-outline-critique.md")).toBe(false);
    expect(isProtectedOutlinePath("/abs/repo/plan-outline-critique.md")).toBe(false);
  });

  it("does NOT protect project-level agent/human artifacts", () => {
    expect(isProtectedOutlinePath("prd.md")).toBe(false);
    expect(isProtectedOutlinePath("design.md")).toBe(false);
    expect(isProtectedOutlinePath("prd-human.md")).toBe(false);
  });

  it("exempts shipped project-level outline templates, like every other scaffold", () => {
    expect(isProtectedOutlinePath("_devx/templates/engine/prd-outline.md")).toBe(false);
    expect(
      isProtectedOutlinePath("/abs/repo/_devx/templates/engine/design-outline.md"),
    ).toBe(false);
  });

  it("does NOT protect an unrelated file that merely ends in -outline.md", () => {
    expect(isProtectedOutlinePath("docs/course-outline.md")).toBe(false);
    expect(isProtectedOutlinePath("chapter-outline.md")).toBe(false);
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

// ---------------------------------------------------------------------------
// runOutlineInit — bootstrap-only, never-overwrite, both layouts
// ---------------------------------------------------------------------------

const AGENT_ENV = { CLAUDECODE: "1" } as Record<string, string | undefined>;

const PROJECT_LEVEL_CONFIG = [
  "mode: YOLO",
  "engine:",
  "  docs_layout: project-level",
  "projects:",
  "  - name: cli",
  "    path: .",
  "",
].join("\n");

/** The pre-2026-09-01 spelling: the layout as a preference-bank key. Still
 *  honored so an existing repo does not silently flip layout on upgrade. */
const LEGACY_LAYOUT_CONFIG = [
  "mode: YOLO",
  "personalization:",
  "  docs.layout: project-level",
  "projects:",
  "  - name: cli",
  "    path: .",
  "",
].join("\n");

describe("runOutlineInit", () => {
  const repos: { cleanup(): void }[] = [];
  afterEach(() => {
    while (repos.length > 0) repos.pop()!.cleanup();
  });

  function repoWithWorkstream(config?: string): ReturnType<typeof makeEngineRepo> {
    const repo = makeEngineRepo(config === undefined ? {} : { config });
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

  function init(
    repo: ReturnType<typeof makeEngineRepo>,
    args: string[],
    flags: Parameters<typeof runOutlineInit>[1] = {},
    env: Record<string, string | undefined> = HUMAN_ENV,
  ): { code: number; io: ReturnType<typeof captureIo> } {
    const io = captureIo();
    const code = runOutlineInit(args, flags, {
      out: io.out,
      err: io.err,
      projectPath: repo.configPath,
      env,
    });
    return { code, io };
  }

  it("scaffolds <ws>/<stage>/outline.md under the workstream layout", () => {
    const repo = repoWithWorkstream();
    const { code, io } = init(repo, ["abc123", "prd"]);
    expect(code).toBe(0);
    expect(io.json()).toEqual({
      layout: "workstream",
      created: ["_devx/workstreams/demo/prd/outline.md"],
      skipped: [],
    });
  });

  it("is agent-runnable — bootstrapping an EMPTY file is mechanical", () => {
    const repo = repoWithWorkstream();
    const { code, io } = init(repo, ["abc123", "prd"], {}, AGENT_ENV);
    expect(code).toBe(0);
    expect(repo.exists("_devx/workstreams/demo/prd/outline.md")).toBe(true);
    // …and it says so out loud: the bullets are still the human's job.
    expect(io.stderr()).toContain("Type the bullets yourself");
  });

  it("writes the shipped scaffold body — bullets only, no prose", () => {
    const repo = repoWithWorkstream();
    expect(init(repo, ["abc123", "design"]).code).toBe(0);
    const body = repo.read("_devx/workstreams/demo/design/outline.md");
    expect(body).toBe(repo.read("_devx/templates/engine/design/outline.md"));
    expect(body).toContain("# design outline");
    for (const line of body.split("\n")) {
      // Everything outside the header comment and the title is a bullet.
      if (line.trim() === "" || line.startsWith("#")) continue;
      if (line.startsWith("<!--") || line.endsWith("-->")) continue;
      if (!line.startsWith("*") && !line.startsWith(" ")) {
        expect.unreachable(`non-bullet line in scaffold: ${line}`);
      }
    }
  });

  it("NEVER overwrites — not for a human, not for an agent", () => {
    const repo = repoWithWorkstream();
    expect(init(repo, ["abc123", "design"]).code).toBe(0);
    const typed = "# design outline — demo\n\n* my own bullet\n";
    repo.write("_devx/workstreams/demo/design/outline.md", typed);

    for (const env of [HUMAN_ENV, AGENT_ENV]) {
      const { code, io } = init(repo, ["abc123", "design"], {}, env);
      // Idempotent, not an error: bootstrapping something already present is
      // a no-op, and the human's bytes are untouched.
      expect(code).toBe(0);
      expect(io.json()).toEqual({
        layout: "workstream",
        created: [],
        skipped: ["_devx/workstreams/demo/design/outline.md"],
      });
      expect(io.stderr()).toContain("never overwritten");
      expect(repo.read("_devx/workstreams/demo/design/outline.md")).toBe(typed);
    }
  });

  it("--all bootstraps every missing stage and skips the rest", () => {
    const repo = repoWithWorkstream();
    expect(init(repo, ["abc123", "prd"]).code).toBe(0);
    const { code, io } = init(repo, ["abc123"], { all: true });
    expect(code).toBe(0);
    expect(io.json()).toEqual({
      layout: "workstream",
      created: [
        "_devx/workstreams/demo/design/outline.md",
        "_devx/workstreams/demo/plan/outline.md",
        "_devx/workstreams/demo/evals/outline.md",
      ],
      skipped: ["_devx/workstreams/demo/prd/outline.md"],
    });
  });

  it("scaffolds <stage>-outline.md at the root under project-level", () => {
    const repo = repoWithWorkstream(PROJECT_LEVEL_CONFIG);
    const { code, io } = init(repo, ["prd"]);
    expect(code).toBe(0);
    expect(io.json()).toEqual({
      layout: "project-level",
      created: ["prd-outline.md"],
      skipped: [],
    });
    expect(repo.read("prd-outline.md")).toBe(
      repo.read("_devx/templates/engine/prd/outline.md"),
    );
  });

  it("project-level --all covers all four root outlines", () => {
    const repo = repoWithWorkstream(PROJECT_LEVEL_CONFIG);
    const { code, io } = init(repo, [], { all: true });
    expect(code).toBe(0);
    expect(io.json()).toMatchObject({
      layout: "project-level",
      created: [
        "prd-outline.md",
        "design-outline.md",
        "plan-outline.md",
        "evals-outline.md",
      ],
    });
  });

  it("still honors the legacy personalization docs.layout key", () => {
    // Moved to engine.docs_layout on 2026-09-01. A repo that answered the old
    // key must keep its layout on upgrade — silently reverting to
    // `workstream` would scaffold into a tree that repo does not use.
    const repo = repoWithWorkstream(LEGACY_LAYOUT_CONFIG);
    const { code, io } = init(repo, ["prd"]);
    expect(code).toBe(0);
    expect(io.json()).toEqual({
      layout: "project-level",
      created: ["prd-outline.md"],
      skipped: [],
    });
  });

  it("project-level refuses a hash argument, naming the right command", () => {
    const repo = repoWithWorkstream(PROJECT_LEVEL_CONFIG);
    const { code, io } = init(repo, ["abc123", "prd"]);
    expect(code).toBe(2);
    expect(io.stderr()).toContain("devx outline init prd");
  });

  it("--layout overrides the resolved layout in both directions", () => {
    const ws = repoWithWorkstream();
    expect(init(ws, ["prd"], { layout: "project-level" }).io.json()).toEqual({
      layout: "project-level",
      created: ["prd-outline.md"],
      skipped: [],
    });
    const pl = repoWithWorkstream(PROJECT_LEVEL_CONFIG);
    expect(init(pl, ["abc123", "prd"], { layout: "workstream" }).io.json()).toEqual({
      layout: "workstream",
      created: ["_devx/workstreams/demo/prd/outline.md"],
      skipped: [],
    });
  });

  it("rejects an unknown layout", () => {
    const repo = repoWithWorkstream();
    const { code, io } = init(repo, ["abc123", "prd"], { layout: "flat" });
    expect(code).toBe(2);
    expect(io.stderr()).toContain("unknown layout 'flat'");
  });

  it("rejects unknown stages", () => {
    const repo = repoWithWorkstream();
    const { code, io } = init(repo, ["abc123", "retro"]);
    expect(code).toBe(2);
    expect(io.stderr()).toContain("unknown stage");
  });

  it("scaffolds the repo-root OUTLINE.md with --project", () => {
    const repo = repoWithWorkstream();
    const { code, io } = init(repo, [], { project: true });
    expect(code).toBe(0);
    expect(io.json()).toEqual({
      layout: "workstream",
      created: ["OUTLINE.md"],
      skipped: [],
    });
  });

  it("--project still refuses stray arguments", () => {
    const repo = repoWithWorkstream();
    const { code, io } = init(repo, ["abc123", "prd"], { project: true });
    expect(code).toBe(2);
    expect(io.stderr()).toContain("--project takes no hash/stage arguments");
    expect(repo.exists("OUTLINE.md")).toBe(false);
  });

  it("--project and --all are not combinable", () => {
    const repo = repoWithWorkstream();
    const { code, io } = init(repo, [], { project: true, all: true });
    expect(code).toBe(2);
    expect(io.stderr()).toContain("run them separately");
  });
});

// ---------------------------------------------------------------------------
// Scaffold bodies + kind classification
// ---------------------------------------------------------------------------

describe("outlineKindOf", () => {
  it("reads the stage off both layouts' spellings", () => {
    expect(outlineKindOf("_devx/workstreams/x/prd/outline.md")).toEqual({
      kind: "stage",
      stage: "prd",
    });
    expect(outlineKindOf("evals-outline.md")).toEqual({ kind: "stage", stage: "evals" });
    expect(outlineKindOf("OUTLINE.md")).toEqual({ kind: "project" });
  });

  it("returns null when the scaffold origin is unknowable (fail closed)", () => {
    // A bare token with no stage parent: protected, but nothing to compare
    // against — partitionOutlinePaths must treat it as authored.
    expect(outlineKindOf("outline.md")).toBeNull();
    expect(outlineKindOf("_devx/workstreams/x/outline.md")).toBeNull();
  });
});

describe("builtin scaffolds", () => {
  it("mirror the shipped templates byte-for-byte", () => {
    const kinds = [
      ...(["prd", "design", "plan", "evals"] as const).map(
        (stage) => ({ kind: "stage", stage }) as const,
      ),
      { kind: "project" } as const,
    ];
    for (const kind of kinds) {
      const shipped = readFileSync(
        join(REAL_REPO_ROOT, ...outlineTemplateRel(kind).split("/")),
        "utf8",
      );
      expect(builtinSkeleton(kind), `${outlineTemplateRel(kind)} drifted`).toBe(shipped);
    }
  });
});
