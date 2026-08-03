// Renderer unit tests (sgr103 / plan Phase 3, T3.7 — renderer half).
//
// `renderStoryGraph` is pure, so these are model-in / string-out. What they
// defend is the property the whole freshness story rests on: the SAME model
// renders the SAME bytes. Every regen hook (Phases 4–5) and `--check` (T3.3)
// turns a determinism bug into a spurious diff on every claim, so the sort
// order of each collection is pinned individually rather than only through
// one end-to-end golden.
//
// Spec: dev/dev-sgr103-2026-08-02T13:57-graph-render-cli.md

import { describe, expect, it } from "vitest";

import type {
  GraphEdge,
  GraphGroup,
  GraphModel,
  GraphNode,
  GraphWarning,
} from "../src/lib/graph/model.js";
import {
  REGEN_COMMAND,
  TITLE_MAX,
  escapeLabel,
  nodeLabel,
  renderStoryGraph,
} from "../src/lib/graph/render.js";

function node(over: Partial<GraphNode> & { hash: string }): GraphNode {
  return {
    type: "dev",
    title: `Title ${over.hash}`,
    status: "ready",
    group: "ws",
    badges: [],
    ...over,
  };
}

function group(over: Partial<GraphGroup> & { id: string }): GraphGroup {
  return {
    kind: "workstream",
    title: over.id,
    collapsed: false,
    stats: { done: 0, total: 1, lastMerged: null },
    ...over,
  };
}

function edge(from: string, to: string, kind: GraphEdge["kind"]): GraphEdge {
  return { from, to, kind, sources: ["row"] };
}

function model(over: Partial<GraphModel> = {}): GraphModel {
  return { nodes: [], edges: [], groups: [], warnings: [], ...over };
}

/** The single fenced ```mermaid block, or null when absent/ambiguous. */
function mermaidBlock(doc: string): string | null {
  const m = [...doc.matchAll(/```mermaid\n([\s\S]*?)```/g)];
  return m.length === 1 ? m[0][1] : null;
}

describe("renderStoryGraph — document shape", () => {
  const base = model({
    nodes: [node({ hash: "aaa111" }), node({ hash: "aaa222", status: "done" })],
    groups: [group({ id: "ws", stats: { done: 1, total: 2, lastMerged: null } })],
    edges: [edge("aaa111", "aaa222", "blocks")],
  });

  it("emits banner, legend, exactly one mermaid block, and a Warnings section", () => {
    const doc = renderStoryGraph(base);
    expect(doc).toContain("GENERATED FILE");
    expect(doc).toContain(REGEN_COMMAND);
    expect(doc).toContain("## Legend");
    expect(doc).toContain("## Warnings");
    expect(mermaidBlock(doc)).not.toBeNull();
    // Exactly one — a second block would break every downstream extractor.
    expect([...doc.matchAll(/```mermaid/g)]).toHaveLength(1);
    expect(mermaidBlock(doc)).toMatch(/^flowchart TD/);
  });

  it("renders no timestamp, date-stamp, or version string in the body", () => {
    const doc = renderStoryGraph(base);
    // A bare ISO date or time anywhere would make the file churn daily. The
    // ONLY legitimate date is a collapsed group's `last merged`, which this
    // model has none of.
    expect(doc).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(doc).not.toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it("says so explicitly when there are no warnings", () => {
    expect(renderStoryGraph(base)).toContain("None — every edge resolved");
  });

  it("lists warnings with their codes, sorted, when present", () => {
    const warnings: GraphWarning[] = [
      { code: "unknown-blocker", hash: "zzz999", message: "z message" },
      { code: "edge-drift", hash: "aaa111", message: "a message" },
    ];
    const doc = renderStoryGraph(model({ ...base, warnings }));
    expect(doc).toContain("2 warnings");
    expect(doc.indexOf("edge-drift")).toBeLessThan(doc.indexOf("unknown-blocker"));
  });

  it("contains no six-hex-digit token that a hash grep could mistake for a spec", () => {
    // The classDef palette is deliberately 3-digit hex: `#ffffff` is itself
    // hash-shaped and made E-1's phantom check fire on the palette.
    const doc = renderStoryGraph(base);
    const sixHex = doc.match(/#[0-9a-f]{6}\b/g);
    expect(sixHex).toBeNull();
  });
});

describe("renderStoryGraph — determinism", () => {
  it("is byte-identical across repeated renders of the same model", () => {
    const m = model({
      nodes: [node({ hash: "bbb222" }), node({ hash: "aaa111" })],
      groups: [group({ id: "ws" })],
      edges: [edge("bbb222", "aaa111", "blocks")],
    });
    expect(renderStoryGraph(m)).toBe(renderStoryGraph(m));
  });

  it("is insensitive to input array order (nodes, edges, groups, warnings)", () => {
    const nodes = [
      node({ hash: "aaa111", group: "alpha" }),
      node({ hash: "bbb222", group: "beta" }),
      node({ hash: "ccc333", group: "alpha" }),
    ];
    const groups = [
      group({ id: "alpha" }),
      group({ id: "beta", kind: "epic" }),
    ];
    const edges = [
      edge("aaa111", "ccc333", "blocks"),
      edge("bbb222", "aaa111", "lineage"),
    ];
    const warnings: GraphWarning[] = [
      { code: "hyphen-key", hash: "bbb222", message: "b" },
      { code: "edge-drift", hash: "aaa111", message: "a" },
    ];
    const forward = renderStoryGraph(model({ nodes, groups, edges, warnings }));
    const reversed = renderStoryGraph(
      model({
        nodes: [...nodes].reverse(),
        groups: [...groups].reverse(),
        edges: [...edges].reverse(),
        warnings: [...warnings].reverse(),
      }),
    );
    expect(reversed).toBe(forward);
  });

  it("orders groups by kind (workstream, epic, standalone) then id", () => {
    const doc = renderStoryGraph(
      model({
        nodes: [
          node({ hash: "sss111", group: "standalone" }),
          node({ hash: "eee111", group: "zeta-epic" }),
          node({ hash: "www111", group: "zzz-ws" }),
        ],
        groups: [
          group({ id: "standalone", kind: "standalone" }),
          group({ id: "zeta-epic", kind: "epic" }),
          group({ id: "zzz-ws", kind: "workstream" }),
        ],
      }),
    );
    // `zzz-ws` sorts LAST alphabetically but FIRST by kind — proves the
    // ranking beats the id comparison rather than merely agreeing with it.
    expect(doc.indexOf("www111")).toBeLessThan(doc.indexOf("eee111"));
    expect(doc.indexOf("eee111")).toBeLessThan(doc.indexOf("sss111"));
  });

  it("orders nodes by hash within a group", () => {
    const mm = mermaidBlock(
      renderStoryGraph(
        model({
          nodes: [node({ hash: "ccc333" }), node({ hash: "aaa111" }), node({ hash: "bbb222" })],
          groups: [group({ id: "ws" })],
        }),
      ),
    )!;
    expect(mm.indexOf("aaa111")).toBeLessThan(mm.indexOf("bbb222"));
    expect(mm.indexOf("bbb222")).toBeLessThan(mm.indexOf("ccc333"));
  });
});

describe("renderStoryGraph — edge classes", () => {
  const m = model({
    nodes: ["aaa111", "aaa222", "aaa333", "aaa444"].map((hash) => node({ hash })),
    groups: [group({ id: "ws" })],
    edges: [
      edge("aaa111", "aaa222", "blocks"),
      edge("aaa111", "aaa333", "lineage"),
      edge("aaa111", "aaa444", "parallel"),
    ],
  });

  it("renders the three kinds with visually distinct glyphs", () => {
    const mm = mermaidBlock(renderStoryGraph(m))!;
    expect(mm).toContain("aaa111 --> aaa222");
    expect(mm).toContain("aaa111 -.-> aaa333");
    expect(mm).toContain("aaa111 --- |par| aaa444");
  });

  it("keeps the parallel link both arrowless and labeled", () => {
    const line = mermaidBlock(renderStoryGraph(m))!
      .split("\n")
      .find((l) => l.includes("aaa111") && l.includes("aaa444"))!;
    expect(line).not.toContain("-->");
    expect(line).toContain("|par|");
  });

  it("declares every edge after every subgraph block", () => {
    const mm = mermaidBlock(renderStoryGraph(m))!;
    // Mermaid attributes a node to the subgraph that declares it; an edge
    // emitted mid-subgraph would silently adopt the node into that subgraph.
    const lastEnd = mm.lastIndexOf("\n  end");
    expect(mm.indexOf("aaa111 --> aaa222")).toBeGreaterThan(lastEnd);
  });
});

describe("renderStoryGraph — collapsed groups", () => {
  const m = model({
    nodes: [
      node({ hash: "ddd111", group: "closed", status: "done" }),
      node({ hash: "ddd222", group: "closed", status: "done" }),
      node({ hash: "aaa111", group: "live" }),
    ],
    groups: [
      group({
        id: "closed",
        collapsed: true,
        stats: { done: 2, total: 2, lastMerged: "2026-07-05" },
      }),
      group({ id: "live" }),
    ],
    edges: [edge("aaa111", "ddd111", "blocks"), edge("ddd222", "ddd111", "blocks")],
  });

  it("renders a summary node instead of the members", () => {
    const mm = mermaidBlock(renderStoryGraph(m))!;
    expect(mm).not.toMatch(/ddd111|ddd222/);
    expect(mm).toContain("closed — 2/2 done, last merged 2026-07-05");
  });

  it("redirects an inbound edge onto the summary node", () => {
    const mm = mermaidBlock(renderStoryGraph(m))!;
    expect(mm).toContain("aaa111 --> grp_closed");
  });

  it("drops an edge whose endpoints collapse into the same summary node", () => {
    // ddd222 → ddd111 would become grp_closed → grp_closed: a self-loop on
    // settled history, which is noise, not information.
    const mm = mermaidBlock(renderStoryGraph(m))!;
    expect(mm).not.toContain("grp_closed --> grp_closed");
  });
});

describe("escapeLabel / nodeLabel", () => {
  it("neutralizes quotes, hashes, angle brackets, and newlines", () => {
    const out = escapeLabel('say "hi" #1 <b>\nnext');
    expect(out).not.toContain('"');
    expect(out).not.toContain("#");
    expect(out).not.toContain("<");
    expect(out).not.toContain("\n");
  });

  it("neutralizes square brackets — a `]` in a title corrupts the whole block", () => {
    // Mermaid fails the ENTIRE ```mermaid block on one parse error, so a
    // single spec titled `Fix the [x] checkbox` would blank the board.
    const out = escapeLabel("Fix the [x] checkbox");
    expect(out).not.toContain("[");
    expect(out).not.toContain("]");
    expect(out).toBe("Fix the (x) checkbox");
  });

  it("truncates to at most the requested width, with an ellipsis", () => {
    const out = escapeLabel("x".repeat(200));
    expect(out.length).toBeLessThanOrEqual(TITLE_MAX);
    expect(out.endsWith("…")).toBe(true);
  });

  it("leaves a short label untouched", () => {
    expect(escapeLabel("Alpha one")).toBe("Alpha one");
  });

  it("labels a node `<hash> <title>` and degrades to the bare hash", () => {
    expect(nodeLabel(node({ hash: "aaa111", title: "Alpha one" }))).toBe(
      "aaa111 Alpha one",
    );
    // A trailing space would be a one-byte diff the first time a title lands.
    expect(nodeLabel(node({ hash: "aaa111", title: "" }))).toBe("aaa111");
  });

  it("appends human-gate badges in PARENTHESES, never brackets", () => {
    // Brackets here would put a `]` inside the `id["…"]` construct. No spec
    // on today's board carries a badge, so the live render cannot catch this
    // — the first INTERVIEW-gated spec would have.
    const label = nodeLabel(
      node({ hash: "aaa111", title: "Alpha", badges: ["INTERVIEW Q#9", "MANUAL M1"] }),
    );
    expect(label).toContain("MANUAL M1");
    expect(label).toContain("INTERVIEW Q");
    expect(label).not.toContain("[");
    expect(label).not.toContain("]");
  });

  it("keeps a badge-bearing node's rendered line bracket-balanced", () => {
    const mm = renderStoryGraph(
      model({
        nodes: [node({ hash: "aaa111", title: "Alpha [beta]", badges: ["MANUAL M1"] })],
        groups: [group({ id: "ws" })],
      }),
    );
    const line = mm.split("\n").find((l) => l.includes('aaa111["'))!;
    // Exactly the opening `[` and the closing `]` of the node construct.
    expect(line.match(/\[/g)).toHaveLength(1);
    expect(line.match(/\]/g)).toHaveLength(1);
  });
});

describe("renderStoryGraph — resilience", () => {
  it("still renders a node whose group is missing from model.groups", () => {
    // Silently dropping a spec off the board is the worst failure this
    // renderer can have; an ungrouped bucket is the visible alternative.
    const doc = renderStoryGraph(
      model({
        nodes: [node({ hash: "orp111", group: "nowhere" })],
        groups: [],
      }),
    );
    expect(doc).toContain("orp111");
    expect(doc).toContain("ungrouped");
  });

  it("omits a subgraph for a group with no members", () => {
    const mm = mermaidBlock(
      renderStoryGraph(
        model({ nodes: [], groups: [group({ id: "empty" })] }),
      ),
    )!;
    expect(mm).not.toContain("subgraph");
  });

  it("gives colliding group slugs distinct mermaid ids", () => {
    // `a-b` and `a.b` both slugify to `a_b`; sharing an id would merge two
    // unrelated parts of the board into one subgraph.
    const mm = mermaidBlock(
      renderStoryGraph(
        model({
          nodes: [
            node({ hash: "aaa111", group: "a-b" }),
            node({ hash: "bbb222", group: "a.b" }),
          ],
          groups: [group({ id: "a-b" }), group({ id: "a.b" })],
        }),
      ),
    )!;
    const ids = [...mm.matchAll(/subgraph (\S+)\[/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("drops an edge whose endpoint was never declared as a node", () => {
    // Mermaid MINTS a bare node for an id it meets only in an edge — the
    // phantom class this workstream exists to kill, arriving via a model bug
    // rather than via the backlog.
    const mm = mermaidBlock(
      renderStoryGraph(
        model({
          nodes: [node({ hash: "aaa111" })],
          groups: [group({ id: "ws" })],
          edges: [edge("aaa111", "ghost1", "blocks")],
        }),
      ),
    )!;
    expect(mm).not.toContain("ghost1");
  });

  it("gives the orphan bucket a distinct id when a real group is named `ungrouped`", () => {
    const mm = mermaidBlock(
      renderStoryGraph(
        model({
          nodes: [
            node({ hash: "aaa111", group: "ungrouped" }),
            node({ hash: "orp111", group: "nowhere" }),
          ],
          groups: [group({ id: "ungrouped" })],
        }),
      ),
    )!;
    const ids = [...mm.matchAll(/subgraph (\S+)\[/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("falls back to a defined class for an unrecognized status", () => {
    const mm = mermaidBlock(
      renderStoryGraph(
        model({
          nodes: [node({ hash: "aaa111", status: "wat" as GraphNode["status"] })],
          groups: [group({ id: "ws" })],
        }),
      ),
    )!;
    expect(mm).toContain("class aaa111 unknownStatus");
    expect(mm).not.toContain("class aaa111 undefined");
  });
});
