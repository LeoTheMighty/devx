// `devx board` — the static board (D1).
//
// Two things get tested separately because they fail differently: the
// GRAPH.md slice (a text transform whose off-by-one emits mermaid that does
// not parse) and the page content (a panel that renders a confident wrong
// value — the class of defect `devx status` and `devx next` already guard
// against, which the board must not reintroduce).

import { describe, expect, it } from "vitest";

import { runBoard } from "../src/commands/board.js";
import {
  buildBoardModel,
  extractMermaid,
  extractWorkstreamSubgraph,
} from "../src/lib/board/model.js";
import { esc, pageName, pageNames } from "../src/lib/board/render.js";
import { ENGINE_DEFAULTS } from "../src/lib/engine/config.js";
import { realEngineFs } from "../src/lib/engine/workstream.js";
import {
  type EngineRepo,
  captureIo,
  makeEngineRepo,
} from "./fixtures/engine-repo.js";

const WS = "_devx/workstreams/demo-feature";
const OTHER = "_devx/workstreams/other-thing";
const FIXED_NOW = () => new Date(Date.UTC(2026, 10, 20, 12, 0, 0));

// ---------------------------------------------------------------------------
// GRAPH.md extraction
// ---------------------------------------------------------------------------

const GRAPH = `<!-- GENERATED FILE -->

# Story graph

## Board

\`\`\`mermaid
flowchart TD
  subgraph sg_demo_feature["demo-feature (workstream)"]
    aaa111["aaa111 First story"]
    bbb222["bbb222 Second story"]
  end
  subgraph sg_other_thing["other-thing (workstream)"]
    ccc333["ccc333 Elsewhere"]
  end
  aaa111 --> bbb222
  classDef ready fill:#eef,stroke:#39f,color:#036
  classDef done fill:#efe,stroke:#3a3,color:#040
  class aaa111 done
  class bbb222 ready
  class ccc333 ready
\`\`\`
`;

describe("extractMermaid", () => {
  it("pulls the fenced block, trimmed", () => {
    const m = extractMermaid(GRAPH)!;
    expect(m.startsWith("flowchart TD")).toBe(true);
    expect(m.endsWith("class ccc333 ready")).toBe(true);
    expect(m).not.toContain("```");
  });

  it("returns null when there is no mermaid block", () => {
    expect(extractMermaid("# Story graph\n\nnothing here\n")).toBeNull();
  });
});

describe("extractWorkstreamSubgraph", () => {
  it("slices one workstream's subgraph with a flowchart header", () => {
    const s = extractWorkstreamSubgraph(GRAPH, "demo-feature")!;
    expect(s.split("\n")[0]).toBe("flowchart TD");
    expect(s).toContain('subgraph sg_demo_feature["demo-feature (workstream)"]');
    expect(s).toContain("aaa111");
    expect(s).toContain("bbb222");
    // The other workstream's node must not leak in — a page showing someone
    // else's stories is worse than a page showing none.
    expect(s).not.toContain("ccc333");
    // Exactly one `end`, so the block is balanced and mermaid parses it.
    expect(s.split("\n").filter((l) => l.trim() === "end")).toHaveLength(1);
  });

  it("carries every classDef and only the class lines for its own nodes", () => {
    const s = extractWorkstreamSubgraph(GRAPH, "demo-feature")!;
    // classDefs are global — without them the status colouring is gone, which
    // is the one thing the graph panel is for.
    expect(s).toContain("classDef ready");
    expect(s).toContain("classDef done");
    expect(s).toContain("class aaa111 done");
    expect(s).toContain("class bbb222 ready");
    expect(s).not.toContain("class ccc333");
  });

  it("returns null for a workstream with no subgraph (settled, collapsed)", () => {
    expect(extractWorkstreamSubgraph(GRAPH, "nope")).toBeNull();
  });

  it("matches on the TITLE, so a slug with regex metacharacters is literal", () => {
    const graph = GRAPH.replace(
      'sg_demo_feature["demo-feature (workstream)"]',
      'sg_a_b["a.b (workstream)"]',
    ).replace("demo-feature (workstream)", "a.b (workstream)");
    expect(extractWorkstreamSubgraph(graph, "a.b")).not.toBeNull();
    // `.` must not match `axb` — that is the collision the title match exists
    // to avoid, since the renderer slugifies both to `a_b`.
    expect(extractWorkstreamSubgraph(graph, "axb")).toBeNull();
  });

  it("also slices an epic-kind subgraph", () => {
    const graph = GRAPH.replace("(workstream)", "(epic)");
    expect(extractWorkstreamSubgraph(graph, "demo-feature")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

describe("render helpers", () => {
  it("escapes every HTML metacharacter", () => {
    expect(esc(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });

  it("collapses a slug into a safe page name", () => {
    expect(pageName("demo-feature")).toBe("demo-feature.html");
    // A slug comes from a directory name; a traversal attempt must not escape
    // the out dir.
    expect(pageName("../../etc/passwd")).toBe("etc-passwd.html");
    expect(pageName("a b/c")).toBe("a-b-c.html");
    expect(pageName("...")).toBe("workstream.html");
  });

  it("breaks a page-name collision rather than overwriting the page", () => {
    // `pageName` is lossy by necessity, so two slugs can land on one file.
    // Without the suffix the second page overwrites the first and BOTH index
    // cards link to the survivor — one workstream's state shown under
    // another's name, which is worse than showing nothing.
    expect(pageNames(["a.b", "a-b", "a b"])).toEqual([
      "a.b.html",
      "a-b.html",
      "a-b-2.html",
    ]);
  });

  it("breaks a collision between two entries with the SAME slug", () => {
    // Two plan specs pointing at one workstream dir — the ambiguity
    // `layout-tree-mismatch` already names. A slug-keyed map would hand both
    // the same answer again, so the resolution is positional.
    expect(pageNames(["dup", "dup", "dup"])).toEqual([
      "dup.html",
      "dup-2.html",
      "dup-3.html",
    ]);
  });

  it("leaves a collision-free list byte-identical to pageName", () => {
    const slugs = ["one", "two", "three"];
    expect(pageNames(slugs)).toEqual(slugs.map(pageName));
  });
});

// ---------------------------------------------------------------------------
// The model + the command, against real files
// ---------------------------------------------------------------------------

function planSpec(
  hash: string,
  wsRel: string,
  over: { stage?: string; outcome?: string; designVerdict?: string } = {},
): string {
  return [
    "---",
    `hash: ${hash}`,
    "type: plan",
    "status: in-progress",
    `stage: ${over.stage ?? "design"}`,
    "gate_status:",
    "  prd_validated: true",
    "  design_verified: false",
    "  plan_verified: false",
    "  evals_red: false",
    ...(over.designVerdict !== undefined
      ? ["gate_verdicts:", `  design: ${over.designVerdict}`]
      : []),
    ...(over.outcome !== undefined
      ? ["outcome:", `  status: ${over.outcome}`, "  measure_by: 2026-12-01"]
      : []),
    `workstream: ${wsRel}`,
    "---",
    "body",
    "",
  ].join("\n");
}

function entry(id: string, fields: Record<string, string> = {}): string {
  const f = {
    Kind: "gate-concern",
    Severity: "blocking",
    Blocks: "gate-design",
    Origin: "devx gate coverage",
    Recommendation: "cover it",
    Status: "open",
    Resolution: "—",
    ...fields,
  };
  return [
    `## ${id}: ${id} title`,
    "",
    ...Object.entries(f).map(([k, v]) => `- **${k}:** ${v}`),
    "",
    "---",
    "",
  ].join("\n");
}

function seed(): EngineRepo {
  const repo = makeEngineRepo();
  repo.write(
    "plan/plan-aaa111-2026-07-24T10:41-demo-feature.md",
    planSpec("aaa111", WS, { designVerdict: "FAIL" }),
  );
  repo.write(
    "plan/plan-ccc333-2026-07-24T10:41-other-thing.md",
    planSpec("ccc333", OTHER, { stage: "done", outcome: "pending" }),
  );
  repo.mkdir(WS);
  repo.mkdir(OTHER);
  repo.write(`${WS}/prd/agent.md`, "# PRD\n");
  repo.write(
    `${WS}/questions.md`,
    [entry("Q-1"), entry("Q-2", { Severity: "concern" }), entry("Q-3", { Status: "resolved", Resolution: "decisions/x.md" })].join(""),
  );
  repo.write(
    `${WS}/todo.md`,
    ["- [x] Stage: PRD", "- [x] Gate: prd", "- [ ] Stage: Design", "  - [ ] a free note", ""].join("\n"),
  );
  repo.write("GRAPH.md", GRAPH);
  return repo;
}

function model(repo: EngineRepo) {
  return buildBoardModel({
    fs: realEngineFs,
    repoRoot: repo.root,
    engine: ENGINE_DEFAULTS,
    graphMd: repo.read("GRAPH.md"),
  });
}

describe("buildBoardModel", () => {
  it("includes every engine workstream, active and closed, with its health", () => {
    const repo = seed();
    try {
      const m = model(repo);
      expect(m.workstreams.map((w) => [w.slug, w.active])).toEqual([
        ["demo-feature", true],
        ["other-thing", false],
      ]);
      const demo = m.workstreams[0];
      expect(demo.counts).toEqual({ blocking: 1, concern: 1 });
      expect(demo.hasQueue).toBe(true);
      expect(demo.health).toBe("health: 1 blocking · 1 concern");
      expect(demo.healthError).toBeNull();
      // The resolved entry stays in the model (it is the record) but sorts last.
      expect(demo.questions.map((q) => q.id)).toEqual(["Q-1", "Q-2", "Q-3"]);
    } finally {
      repo.cleanup();
    }
  });

  it("distinguishes an ABSENT queue from a clean one", () => {
    const repo = seed();
    try {
      const other = model(repo).workstreams[1];
      expect(other.hasQueue).toBe(false);
      expect(other.counts).toEqual({ blocking: 0, concern: 0 });
      expect(other.health).toBeNull();
    } finally {
      repo.cleanup();
    }
  });

  it("carries the gate summary from the shared renderer, FAIL fix path included", () => {
    const repo = seed();
    try {
      const demo = model(repo).workstreams[0];
      expect(demo.gateSummary).toContain("design FAIL");
      expect(demo.gateSummary).toContain("re-run: devx gate coverage aaa111");
    } finally {
      repo.cleanup();
    }
  });

  it("flattens the todo checklist with depth preserved", () => {
    const repo = seed();
    try {
      const demo = model(repo).workstreams[0];
      expect(demo.todo.map((t) => [t.text, t.checked, t.depth])).toEqual([
        ["Stage: PRD", true, 0],
        ["Gate: prd", true, 0],
        ["Stage: Design", false, 0],
        ["a free note", false, 1],
      ]);
    } finally {
      repo.cleanup();
    }
  });

  it("reports a malformed queue with no counts rather than zeroes", () => {
    const repo = seed();
    try {
      repo.write(`${WS}/questions.md`, "## Q-1: broken\n\n- **Kind:** gate-concern\n");
      const demo = model(repo).workstreams[0];
      expect(demo.healthError).toContain("missing Severity");
      expect(demo.health).toMatch(/^health: unreadable/);
      expect(demo.questions).toEqual([]);
    } finally {
      repo.cleanup();
    }
  });

  it("slices each workstream its own subgraph", () => {
    const repo = seed();
    try {
      const m = model(repo);
      expect(m.workstreams[0].mermaid).toContain("aaa111");
      expect(m.workstreams[0].mermaid).not.toContain("ccc333");
      expect(m.workstreams[1].mermaid).toContain("ccc333");
      expect(m.mermaid).toContain("aaa111");
      expect(m.mermaid).toContain("ccc333");
    } finally {
      repo.cleanup();
    }
  });
});

describe("devx board", () => {
  function build(repo: EngineRepo, flags: { out?: string } = {}) {
    const io = captureIo();
    const code = runBoard(flags, {
      ...io,
      projectPath: repo.configPath,
      now: FIXED_NOW,
    });
    return { code, json: io.json, stderr: io.stderr() };
  }

  it("writes an index plus one page per workstream", () => {
    const repo = seed();
    try {
      const r = build(repo);
      expect(r.code).toBe(0);
      expect(r.json()).toMatchObject({
        board: ".devx-cache/board/index.html",
        workstreams: 2,
        pages: 3,
        graph: true,
      });
      expect(repo.exists(".devx-cache/board/index.html")).toBe(true);
      expect(repo.exists(".devx-cache/board/demo-feature.html")).toBe(true);
      expect(repo.exists(".devx-cache/board/other-thing.html")).toBe(true);
    } finally {
      repo.cleanup();
    }
  });

  it("the index carries every panel the board promises", () => {
    const repo = seed();
    try {
      build(repo);
      const html = repo.read(".devx-cache/board/index.html");
      expect(html).toContain("<title>devx board</title>");
      expect(html).toContain("demo-feature");
      expect(html).toContain('href="demo-feature.html"');
      expect(html).toContain("1 blocking");
      expect(html).toContain("1 concern");
      expect(html).toContain("design FAIL");
      expect(html).toContain("(outcome pending)");
      // Active and closed are separate sections.
      expect(html).toContain("Active (1)");
      expect(html).toContain("Closed (1)");
    } finally {
      repo.cleanup();
    }
  });

  it("a workstream page carries stage, gates, focus, health, todo and the graph", () => {
    const repo = seed();
    try {
      build(repo);
      const html = repo.read(".devx-cache/board/demo-feature.html");
      expect(html).toContain("stage: design");
      expect(html).toContain("design FAIL");
      expect(html).toContain("focus:");
      expect(html).toContain("Health queue");
      expect(html).toContain("Q-1");
      expect(html).toContain("cover it");
      expect(html).toContain("resolved by decisions/x.md");
      expect(html).toContain("Working memory");
      expect(html).toContain("Stage: Design");
      expect(html).toContain('<pre class="mermaid">');
      expect(html).toContain('href="index.html"');
    } finally {
      repo.cleanup();
    }
  });

  it("loads mermaid ONLY on a page that has a graph", () => {
    const repo = seed();
    try {
      // other-thing has a subgraph; strip it so the page has none.
      repo.write("GRAPH.md", GRAPH.replace(/  subgraph sg_other_thing[\s\S]*?\n  end\n/, ""));
      build(repo);
      expect(repo.read(".devx-cache/board/demo-feature.html")).toContain("mermaid.esm.min.mjs");
      const other = repo.read(".devx-cache/board/other-thing.html");
      expect(other).not.toContain("mermaid.esm.min.mjs");
      expect(other).toContain("No subgraph in GRAPH.md");
    } finally {
      repo.cleanup();
    }
  });

  it("escapes authored text — a `<` in a recommendation cannot eat the page", () => {
    const repo = seed();
    try {
      repo.write(
        `${WS}/questions.md`,
        entry("Q-1", { Recommendation: "use <script>alert(1)</script> nowhere" }),
      );
      build(repo);
      const html = repo.read(".devx-cache/board/demo-feature.html");
      expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
      expect(html).not.toContain("<script>alert(1)");
    } finally {
      repo.cleanup();
    }
  });

  it("links each card at the file it actually wrote", () => {
    const repo = seed();
    try {
      build(repo);
      const index = repo.read(".devx-cache/board/index.html");
      for (const href of ["demo-feature.html", "other-thing.html"]) {
        expect(index).toContain(`href="${href}"`);
        expect(repo.exists(`.devx-cache/board/${href}`)).toBe(true);
      }
    } finally {
      repo.cleanup();
    }
  });

  it("honours --out", () => {
    const repo = seed();
    try {
      const r = build(repo, { out: "tmp/board" });
      expect(r.code).toBe(0);
      expect(r.json()).toMatchObject({ board: "tmp/board/index.html" });
      expect(repo.exists("tmp/board/index.html")).toBe(true);
    } finally {
      repo.cleanup();
    }
  });

  it("writes an honest empty board rather than failing, with no workstreams", () => {
    const repo = makeEngineRepo();
    try {
      const r = build(repo);
      expect(r.code).toBe(0);
      expect(r.json()).toMatchObject({ workstreams: 0, pages: 1, graph: false });
      const html = repo.read(".devx-cache/board/index.html");
      expect(html).toContain("No engine workstreams");
      expect(html).toContain("No GRAPH.md");
    } finally {
      repo.cleanup();
    }
  });

  it("writes nothing into the repo but its own output dir", () => {
    const repo = seed();
    try {
      const before = repo.read("plan/plan-aaa111-2026-07-24T10:41-demo-feature.md");
      const queueBefore = repo.read(`${WS}/questions.md`);
      const todoBefore = repo.read(`${WS}/todo.md`);
      build(repo);
      expect(repo.read("plan/plan-aaa111-2026-07-24T10:41-demo-feature.md")).toBe(before);
      expect(repo.read(`${WS}/questions.md`)).toBe(queueBefore);
      expect(repo.read(`${WS}/todo.md`)).toBe(todoBefore);
    } finally {
      repo.cleanup();
    }
  });
});
