// Unit coverage for the story-graph read model (sgr102 / plan Phase 2, T2.7).
//
// Everything runs against an in-memory GraphFs — the module's whole I/O
// surface is the `EngineFs`-style seam, so the fixture repos here need no
// disk and no temp dirs. The dialect fixtures mirror the two audited
// downstream repos the RED evals model (ffm: frontmatter-only edges on done
// rows under a `(workstream <hash>)` heading; palateful: prose-only row
// edges, the hyphenated `blocked-by:` key, mixed ##/### headings with prose
// suffixes) so this suite and E-3/E-4 pin the same behavior at two levels.
//
// Spec: dev/dev-sgr102-2026-08-02T13:57-graph-model.md

import { describe, expect, it } from "vitest";

import { ENGINE_DEFAULTS } from "../src/lib/engine/config.js";
import {
  type BuildGraphResult,
  type GraphFs,
  type GraphModel,
  buildGraphModel,
} from "../src/lib/graph/model.js";

// ---------------------------------------------------------------------------
// In-memory fixture repo
// ---------------------------------------------------------------------------

const ROOT = "/repo";
const TS = "2026-08-01T08:00";

function makeFs(files: Record<string, string>): GraphFs {
  const rel = (p: string): string => {
    const n = p.replace(/\\/g, "/");
    if (n === ROOT) return "";
    return n.startsWith(`${ROOT}/`) ? n.slice(ROOT.length + 1) : n;
  };
  const dirs = new Set<string>([""]);
  for (const f of Object.keys(files)) {
    const parts = f.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  return {
    readFile(p) {
      const r = rel(p);
      const hit = files[r];
      if (hit === undefined) throw new Error(`ENOENT: ${r}`);
      return hit;
    },
    exists(p) {
      const r = rel(p);
      return files[r] !== undefined || dirs.has(r);
    },
    readdir(p) {
      const r = rel(p);
      if (!dirs.has(r)) throw new Error(`ENOTDIR: ${r}`);
      const prefix = r === "" ? "" : `${r}/`;
      const out = new Set<string>();
      for (const f of Object.keys(files)) {
        if (!f.startsWith(prefix)) continue;
        const rest = f.slice(prefix.length);
        if (rest === "") continue;
        out.add(rest.split("/")[0]);
      }
      return [...out].sort();
    },
  };
}

function specRel(type: string, hash: string, slug: string): string {
  return `${type}/${type}-${hash}-${TS}-${slug}.md`;
}

interface SpecOpts {
  type: string;
  hash: string;
  slug: string;
  title?: string;
  status?: string;
  /** Extra frontmatter lines, verbatim. */
  fm?: string[];
  /** Extra status-log lines, verbatim (without the leading `- `). */
  log?: string[];
}

function specFile(o: SpecOpts): [string, string] {
  return [
    specRel(o.type, o.hash, o.slug),
    [
      "---",
      `hash: ${o.hash}`,
      `type: ${o.type}`,
      `created: ${TS}:00-06:00`,
      `title: "${o.title ?? o.slug}"`,
      `status: ${o.status ?? "ready"}`,
      ...(o.fm ?? []),
      "---",
      "",
      "## Status log",
      "",
      `- ${TS} — filed (fixture).`,
      ...(o.log ?? []).map((l) => `- ${l}`),
      "",
    ].join("\n"),
  ];
}

function row(
  state: " " | "/" | "-" | "x",
  type: string,
  hash: string,
  slug: string,
  title: string,
  status: string,
  annotations: string[] = [],
): string {
  const ann = annotations.length > 0 ? ` ${annotations.join(" ")}` : "";
  return `- [${state}] \`${specRel(type, hash, slug)}\` — ${title}.${ann} Status: ${status}.`;
}

function build(files: Record<string, string>): BuildGraphResult {
  return buildGraphModel(makeFs(files), ROOT, ENGINE_DEFAULTS);
}

function ok(files: Record<string, string>): GraphModel {
  const r = build(files);
  if (!r.ok) throw new Error(`unexpected cycle: ${r.cycle.join(", ")}`);
  return r.model;
}

function blockEdges(m: GraphModel): string[] {
  return m.edges
    .filter((e) => e.kind === "blocks")
    .map((e) => `${e.from}->${e.to}`);
}

function codes(m: GraphModel, code: string): GraphModel["warnings"] {
  return m.warnings.filter((w) => w.code === code);
}

// ---------------------------------------------------------------------------
// AC 1 — cross-dir spec index
// ---------------------------------------------------------------------------

describe("spec index (AC 1)", () => {
  it("indexes every spec type dir and unions rows from all four backlogs", () => {
    const m = ok({
      ...Object.fromEntries([
        specFile({ type: "dev", hash: "aaa111", slug: "dev-one" }),
        specFile({ type: "debug", hash: "bbb111", slug: "bug-one" }),
        specFile({ type: "test", hash: "ccc111", slug: "test-one" }),
        specFile({ type: "plan", hash: "ddd111", slug: "plan-one" }),
        specFile({ type: "qa", hash: "eee111", slug: "qa-one" }),
      ]),
      "DEV.md": ["# DEV", "", row(" ", "dev", "aaa111", "dev-one", "Dev one", "ready"), ""].join("\n"),
      "DEBUG.md": ["# DEBUG", "", row(" ", "debug", "bbb111", "bug-one", "Bug one", "ready"), ""].join("\n"),
      "TEST.md": ["# TEST", "", row(" ", "test", "ccc111", "test-one", "Test one", "ready"), ""].join("\n"),
      "PLAN.md": ["# PLAN", "", row(" ", "plan", "ddd111", "plan-one", "Plan one", "ready"), ""].join("\n"),
    });
    expect(m.nodes.map((n) => n.hash)).toEqual([
      "aaa111",
      "bbb111",
      "ccc111",
      "ddd111",
      "eee111",
    ]);
    // eee111 has no backlog row at all — the spec index alone puts it on
    // the board (the union, not an intersection).
    expect(m.nodes.find((n) => n.hash === "eee111")?.type).toBe("qa");
    expect(m.nodes.find((n) => n.hash === "ccc111")?.type).toBe("test");
  });

  it("reads `title:` from frontmatter in preference to the row title", () => {
    const m = ok({
      ...Object.fromEntries([
        specFile({ type: "dev", hash: "aaa111", slug: "one", title: "Canonical title" }),
      ]),
      "DEV.md": ["# DEV", "", row(" ", "dev", "aaa111", "one", "Row title", "ready"), ""].join("\n"),
    });
    expect(m.nodes[0].title).toBe("Canonical title");
  });

  it("falls back to the row title when the spec file is missing", () => {
    const m = ok({
      "DEV.md": ["# DEV", "", row(" ", "dev", "aaa111", "one", "Row title", "ready"), ""].join("\n"),
    });
    expect(m.nodes).toHaveLength(1);
    expect(m.nodes[0]).toMatchObject({ hash: "aaa111", title: "Row title", type: "dev" });
  });

  it("survives a spec whose frontmatter is malformed YAML", () => {
    const m = ok({
      [specRel("dev", "aaa111", "one")]: "---\nhash: aaa111\n  bad: [unclosed\n---\n\nbody\n",
      "DEV.md": ["# DEV", "", row(" ", "dev", "aaa111", "one", "One", "ready"), ""].join("\n"),
    });
    expect(m.nodes.map((n) => n.hash)).toEqual(["aaa111"]);
    expect(m.nodes[0].status).toBe("ready");
  });
});

// ---------------------------------------------------------------------------
// AC 2 — effective status + struck exclusion
// ---------------------------------------------------------------------------

describe("nodes: effectiveStatus + struck rows (AC 2)", () => {
  it("takes frontmatter status over the row's, case-insensitively", () => {
    const m = ok({
      ...Object.fromEntries([
        specFile({ type: "dev", hash: "aaa111", slug: "one", status: "Done" }),
      ]),
      "DEV.md": ["# DEV", "", row("/", "dev", "aaa111", "one", "One", "in-progress"), ""].join("\n"),
    });
    expect(m.nodes[0].status).toBe("done");
  });

  it("falls back to the row status when frontmatter carries none", () => {
    const m = ok({
      [specRel("dev", "aaa111", "one")]: "---\nhash: aaa111\ntype: dev\n---\n\nbody\n",
      "DEV.md": ["# DEV", "", row("-", "dev", "aaa111", "one", "One", "blocked"), ""].join("\n"),
    });
    expect(m.nodes[0].status).toBe("blocked");
  });

  it("excludes struck rows as nodes, and drops edges into them silently", () => {
    const m = ok({
      ...Object.fromEntries([
        specFile({ type: "dev", hash: "aaa111", slug: "gone", status: "deleted" }),
        specFile({ type: "dev", hash: "aaa222", slug: "live" }),
      ]),
      "DEV.md": [
        "# DEV",
        "",
        `- ~~\`${specRel("dev", "aaa111", "gone")}\` — Abandoned.~~`,
        row(" ", "dev", "aaa222", "live", "Live", "ready", ["Blocked-by: aaa111."]),
        "",
      ].join("\n"),
    });
    // The spec file for aaa111 still exists — struck exclusion must win over
    // the spec index, or an abandoned item silently reappears on the board.
    expect(m.nodes.map((n) => n.hash)).toEqual(["aaa222"]);
    expect(blockEdges(m)).toEqual([]);
    // An abandoned blocker is a resolved state, not a defect: no warning.
    expect(m.warnings).toEqual([]);
  });

  it("keeps a hash that is struck in one backlog but live in another", () => {
    const m = ok({
      ...Object.fromEntries([specFile({ type: "debug", hash: "bbb111", slug: "bug" })]),
      "DEV.md": ["# DEV", "", `- ~~\`${specRel("debug", "bbb111", "bug")}\` — Moved.~~`, ""].join("\n"),
      "DEBUG.md": ["# DEBUG", "", row(" ", "debug", "bbb111", "bug", "Bug", "ready"), ""].join("\n"),
    });
    expect(m.nodes.map((n) => n.hash)).toEqual(["bbb111"]);
  });
});

// ---------------------------------------------------------------------------
// AC 3 — blocking-edge union, validation, drift
// ---------------------------------------------------------------------------

describe("blocking edges (AC 3)", () => {
  const dialect = (): Record<string, string> => ({
    ...Object.fromEntries([
      specFile({ type: "dev", hash: "pal111", slug: "flow-one", title: "Flow one" }),
      specFile({ type: "dev", hash: "pal222", slug: "flow-two", title: "Flow two", status: "in-progress" }),
      specFile({ type: "dev", hash: "pal333", slug: "side-one", title: "Side one", fm: ["blocked-by: [pal111]"] }),
      specFile({ type: "dev", hash: "pal444", slug: "side-two", title: "Side two", status: "blocked", fm: ["blocked_by: [pal222]"] }),
    ]),
    "DEV.md": [
      "# DEV",
      "",
      "## Epic — palate-flow (plan: wsp001) — batch 2 of the rebuild",
      "",
      row(" ", "dev", "pal111", "flow-one", "Flow one", "ready", ["Blocked-by: pal222."]),
      row("/", "dev", "pal222", "flow-two", "Flow two", "in-progress"),
      "",
      "### Epic — palate-side (plan: wsp002), continued from batch 1",
      "",
      row(" ", "dev", "pal333", "side-one", "Side one", "ready"),
      row("-", "dev", "pal444", "side-two", "Side two", "blocked", ["Blocked-by: pal111."]),
      "",
    ].join("\n"),
  });

  it("unions row + frontmatter blockers, deduped and per-source tagged", () => {
    const m = ok(dialect());
    expect(blockEdges(m).sort()).toEqual([
      "pal111->pal222", // row-only
      "pal333->pal111", // hyphen-key frontmatter only
      "pal444->pal111", // row side of the disagreement
      "pal444->pal222", // frontmatter side of the disagreement
    ]);
    const byKey = new Map(m.edges.map((e) => [`${e.from}->${e.to}`, e.sources]));
    expect(byKey.get("pal111->pal222")).toEqual(["row"]);
    expect(byKey.get("pal333->pal111")).toEqual(["frontmatter"]);
    expect(byKey.get("pal444->pal111")).toEqual(["row"]);
    expect(byKey.get("pal444->pal222")).toEqual(["frontmatter"]);
  });

  it("tags an edge declared on BOTH sides with both sources, once", () => {
    const m = ok({
      ...Object.fromEntries([
        specFile({ type: "dev", hash: "aaa111", slug: "one" }),
        specFile({ type: "dev", hash: "aaa222", slug: "two", fm: ["blocked_by: [aaa111]"] }),
      ]),
      "DEV.md": [
        "# DEV",
        "",
        row(" ", "dev", "aaa111", "one", "One", "ready"),
        row(" ", "dev", "aaa222", "two", "Two", "ready", ["Blocked-by: aaa111."]),
        "",
      ].join("\n"),
    });
    expect(m.edges.filter((e) => e.kind === "blocks")).toEqual([
      { from: "aaa222", to: "aaa111", kind: "blocks", sources: ["row", "frontmatter"] },
    ]);
  });

  it("warns edge-drift only on the spec whose two sources disagree", () => {
    const m = ok(dialect());
    const drift = codes(m, "edge-drift");
    expect(drift.map((w) => w.hash)).toEqual(["pal444"]);
    expect(drift[0].message).toContain("pal111");
    expect(drift[0].message).toContain("pal222");
  });

  it("warns hyphen-key naming the spec that uses `blocked-by:`", () => {
    const m = ok(dialect());
    const hyphen = codes(m, "hyphen-key");
    expect(hyphen.map((w) => w.hash)).toEqual(["pal333"]);
    expect(hyphen[0].message).toContain("blocked_by");
  });

  it("drops unknown tokens with a warning naming the source row", () => {
    const m = ok({
      ...Object.fromEntries([
        specFile({ type: "dev", hash: "tgt111", slug: "target-one", status: "in-progress" }),
      ]),
      "DEV.md": [
        "# DEV",
        "",
        row("/", "dev", "tgt111", "target-one", "Target one", "in-progress", [
          "Blocked-by: ifh3, ifh4 (consumes their `failed: true` records).",
        ]),
        "",
      ].join("\n"),
    });
    expect(m.nodes.map((n) => n.hash)).toEqual(["tgt111"]);
    expect(blockEdges(m)).toEqual([]);
    const unknown = codes(m, "unknown-blocker");
    expect(unknown.map((w) => w.hash)).toEqual(["tgt111", "tgt111"]);
    expect(unknown.every((w) => (w.source ?? "").includes("tgt111"))).toBe(true);
    expect(unknown.map((w) => w.message).join(" ")).toContain("ifh3");
    expect(unknown.map((w) => w.message).join(" ")).toContain("ifh4");
  });

  it("recovers markup-wrapped and spec-path blockers across type dirs", () => {
    const m = ok({
      ...Object.fromEntries([
        specFile({ type: "dev", hash: "rsh101", slug: "rsh-one", status: "in-progress" }),
        specFile({ type: "debug", hash: "rshrd1", slug: "rsh-red" }),
        specFile({ type: "debug", hash: "dbg001", slug: "some-bug" }),
        specFile({ type: "dev", hash: "tgt222", slug: "target-two" }),
        specFile({ type: "dev", hash: "tgt333", slug: "target-three", status: "blocked" }),
      ]),
      "DEV.md": [
        "# DEV",
        "",
        row(" ", "dev", "tgt222", "target-two", "Target two", "ready", [
          "Blocked-by: ~~rsh101~~ (superseded), **now debug-rshrd1**: rerun.",
        ]),
        row("-", "dev", "tgt333", "target-three", "Target three", "blocked", [
          `Blocked-by: ${specRel("debug", "dbg001", "some-bug")}.`,
        ]),
        row("/", "dev", "rsh101", "rsh-one", "Rsh one", "in-progress"),
        "",
      ].join("\n"),
    });
    expect(blockEdges(m).sort()).toEqual([
      "tgt222->rsh101",
      "tgt222->rshrd1",
      "tgt333->dbg001",
    ]);
    // The prose words interleaved with those real hashes (`**now …**`,
    // `rerun`) are hash-SHAPED but not hashes. They are dropped and warned
    // — never rendered — which is the whole point of validating against the
    // known-hash set rather than trusting tokenization.
    expect(codes(m, "unknown-blocker").map((w) => w.message).join(" ")).toContain("'now'");
    expect(m.nodes.some((n) => n.hash === "now" || n.hash === "rerun")).toBe(false);
  });

  it("reads frontmatter-only edges on done rows whose prose is PR narration", () => {
    const m = ok({
      ...Object.fromEntries([
        specFile({ type: "dev", hash: "ffm111", slug: "widget-core", status: "done" }),
        specFile({ type: "dev", hash: "ffm222", slug: "widget-polish", status: "done", fm: ["blocked_by: [ffm111]"] }),
      ]),
      "DEV.md": [
        "# DEV",
        "",
        "### ffm-widget (workstream wsf001)",
        "",
        `- [x] \`${specRel("dev", "ffm111", "widget-core")}\` — Widget core. PR: https://github.com/x/y/pull/1 (merged abc1234). Status: done.`,
        `- [x] \`${specRel("dev", "ffm222", "widget-polish")}\` — Widget polish. PR: https://github.com/x/y/pull/2 (merged def5678). Status: done.`,
        "",
      ].join("\n"),
    });
    expect(blockEdges(m)).toEqual(["ffm222->ffm111"]);
  });

  it("normalizes a spec-path value inside frontmatter `blocked_by:`", () => {
    const m = ok({
      ...Object.fromEntries([
        specFile({ type: "dev", hash: "aaa111", slug: "one" }),
        specFile({
          type: "dev",
          hash: "aaa222",
          slug: "two",
          fm: [`blocked_by: [${specRel("dev", "aaa111", "one")}]`],
        }),
      ]),
    });
    expect(blockEdges(m)).toEqual(["aaa222->aaa111"]);
  });
});

// ---------------------------------------------------------------------------
// AC 4 — parallel + lineage edges
// ---------------------------------------------------------------------------

describe("parallel + lineage edges (AC 4)", () => {
  it("canonicalizes a parallel pair so a mutual declaration is one edge", () => {
    const m = ok({
      ...Object.fromEntries([
        specFile({ type: "dev", hash: "aaa222", slug: "two" }),
        specFile({ type: "dev", hash: "aaa111", slug: "one" }),
      ]),
      "DEV.md": [
        "# DEV",
        "",
        row(" ", "dev", "aaa111", "one", "One", "ready", ["Parallel-safe with aaa222."]),
        row(" ", "dev", "aaa222", "two", "Two", "ready", ["Parallel-safe with aaa111."]),
        "",
      ].join("\n"),
    });
    expect(m.edges.filter((e) => e.kind === "parallel")).toEqual([
      { from: "aaa111", to: "aaa222", kind: "parallel", sources: ["row"] },
    ]);
  });

  it("drops an unknown parallel peer with a warning naming the row", () => {
    const m = ok({
      ...Object.fromEntries([specFile({ type: "dev", hash: "aaa111", slug: "one" })]),
      "DEV.md": [
        "# DEV",
        "",
        row(" ", "dev", "aaa111", "one", "One", "ready", ["Parallel-safe with zzz999."]),
        "",
      ].join("\n"),
    });
    expect(m.edges.filter((e) => e.kind === "parallel")).toEqual([]);
    const unknown = codes(m, "unknown-blocker");
    expect(unknown).toHaveLength(1);
    expect(unknown[0].message).toContain("zzz999");
    expect(unknown[0].message).toContain("Parallel-safe");
  });

  it("reads `spawned:` in both value forms and dedupes against `from:`", () => {
    const m = ok({
      ...Object.fromEntries([
        // Inline-array form + the child's reciprocal `from:` bridge.
        specFile({ type: "dev", hash: "bbb222", slug: "beta-two", fm: ["spawned: [bbb333]"] }),
        specFile({
          type: "dev",
          hash: "bbb333",
          slug: "beta-three",
          fm: [`from: ${specRel("dev", "bbb222", "beta-two")}`],
        }),
        // Bare-scalar form.
        specFile({ type: "dev", hash: "ccc111", slug: "gamma-one", fm: ["spawned: ccc222"] }),
        specFile({ type: "dev", hash: "ccc222", slug: "gamma-two" }),
        // Block-list form, spec paths.
        specFile({
          type: "dev",
          hash: "ddd111",
          slug: "delta-one",
          fm: ["spawned:", `  - ${specRel("dev", "ddd222", "delta-two")}`, `  - ${specRel("test", "ddd333", "delta-three")}`],
        }),
        specFile({ type: "dev", hash: "ddd222", slug: "delta-two" }),
        specFile({ type: "test", hash: "ddd333", slug: "delta-three" }),
      ]),
    });
    const lineage = m.edges
      .filter((e) => e.kind === "lineage")
      .map((e) => `${e.from}->${e.to}`);
    expect(lineage.sort()).toEqual([
      "bbb222->bbb333",
      "ccc111->ccc222",
      "ddd111->ddd222",
      "ddd111->ddd333",
    ]);
    // `spawned:` on the parent and `from:` on the child describe the SAME
    // parent→child edge — one edge, not two arrows.
    expect(lineage.filter((e) => e === "bbb222->bbb333")).toHaveLength(1);
  });

  it("renders a `superseded_by:` lineage edge and ignores unresolvable `from:`", () => {
    const m = ok({
      ...Object.fromEntries([
        specFile({ type: "dev", hash: "aaa111", slug: "one", status: "superseded", fm: ["superseded_by: aaa222"] }),
        specFile({
          type: "dev",
          hash: "aaa222",
          slug: "two",
          fm: ["from: _bmad-output/planning-artifacts/epic-devx-skill.md"],
        }),
      ]),
    });
    expect(m.edges.filter((e) => e.kind === "lineage")).toEqual([
      { from: "aaa111", to: "aaa222", kind: "lineage", sources: ["frontmatter"] },
    ]);
    // A `from:` naming a non-spec document is not a defect — no warning.
    expect(m.warnings).toEqual([]);
  });

  it("keeps lineage edges out of the cycle check", () => {
    // bbb222 spawned bbb333 and bbb333's `from:` points back — a legitimate
    // bidirectional-looking pair that must not read as a cycle.
    const r = build({
      ...Object.fromEntries([
        specFile({ type: "dev", hash: "bbb222", slug: "beta-two", fm: ["spawned: [bbb333]"] }),
        specFile({ type: "dev", hash: "bbb333", slug: "beta-three", fm: ["spawned: [bbb222]"] }),
      ]),
    });
    expect(r.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC 5 — groups, collapse, badges
// ---------------------------------------------------------------------------

describe("groups (AC 5)", () => {
  const workstreamRepo = (): Record<string, string> => ({
    ...Object.fromEntries([
      specFile({
        type: "plan",
        hash: "wsa001",
        slug: "ws-alpha",
        status: "in-progress",
        fm: ["stage: executing", "workstream: _devx/workstreams/ws-alpha"],
      }),
      // Direct pointer arm.
      specFile({ type: "dev", hash: "aaa111", slug: "alpha-one", fm: ["plan: _devx/workstreams/ws-alpha"] }),
      // The `from:` plan-hash bridge arm.
      specFile({ type: "dev", hash: "aaa222", slug: "alpha-two", fm: [`from: ${specRel("plan", "wsa001", "ws-alpha")}`] }),
      // No workstream anywhere, no epic heading.
      specFile({ type: "dev", hash: "adh111", slug: "adhoc-one" }),
    ]),
    "DEV.md": [
      "# DEV",
      "",
      "### Epic — ws-alpha (plan: wsa001)",
      "",
      row(" ", "dev", "aaa111", "alpha-one", "Alpha one", "ready"),
      row(" ", "dev", "aaa222", "alpha-two", "Alpha two", "ready"),
      "",
      "## Ad-hoc",
      "",
      row(" ", "dev", "adh111", "adhoc-one", "Adhoc one", "ready"),
      "",
    ].join("\n"),
  });

  it("resolves membership via the workstream pointer and the `from:` bridge", () => {
    const m = ok(workstreamRepo());
    const groupOf = new Map(m.nodes.map((n) => [n.hash, n.group]));
    expect(groupOf.get("aaa111")).toBe("ws-alpha");
    expect(groupOf.get("aaa222")).toBe("ws-alpha");
    expect(groupOf.get("wsa001")).toBe("ws-alpha");
    expect(groupOf.get("adh111")).toBe("standalone");
    expect(m.groups.find((g) => g.id === "ws-alpha")?.kind).toBe("workstream");
    expect(m.groups.find((g) => g.id === "standalone")?.kind).toBe("standalone");
  });

  it("groups by backlog heading in BOTH tolerated variants", () => {
    const m = ok({
      ...Object.fromEntries([
        specFile({ type: "dev", hash: "ffm111", slug: "widget-core", status: "done" }),
        specFile({ type: "dev", hash: "pal111", slug: "flow-one" }),
      ]),
      "DEV.md": [
        "# DEV",
        "",
        // No `Epic — ` prefix; `(workstream <hash>)` linkage.
        "### ffm-widget (workstream wsf001)",
        "",
        row("x", "dev", "ffm111", "widget-core", "Widget core", "done"),
        "",
        // `##` depth, `(plan: …)` linkage, prose suffix after the parens.
        "## Epic — palate-flow (plan: wsp001) — batch 2 of the rebuild",
        "",
        row(" ", "dev", "pal111", "flow-one", "Flow one", "ready"),
        "",
      ].join("\n"),
    });
    const groupOf = new Map(m.nodes.map((n) => [n.hash, n.group]));
    expect(groupOf.get("ffm111")).toBe("ffm-widget");
    expect(groupOf.get("pal111")).toBe("palate-flow");
    expect(m.groups.map((g) => `${g.kind}:${g.id}`).sort()).toEqual([
      "epic:ffm-widget",
      "epic:palate-flow",
    ]);
    // Both headings carry a linkage hash — nothing fell back.
    expect(codes(m, "heading-fallback")).toEqual([]);
  });

  it("warns heading-fallback when an epic heading names no plan hash", () => {
    const m = ok({
      ...Object.fromEntries([specFile({ type: "dev", hash: "aaa111", slug: "one" })]),
      "DEV.md": [
        "# DEV",
        "",
        "### Epic 1 — bare epic",
        "",
        row(" ", "dev", "aaa111", "one", "One", "ready"),
        "",
      ].join("\n"),
    });
    const fallback = codes(m, "heading-fallback");
    expect(fallback).toHaveLength(1);
    expect(fallback[0].source).toBe("DEV.md");
    expect(fallback[0].message).toContain("bare-epic");
    // The rows still group — the warning is about the missing linkage, not
    // about losing the partition.
    expect(m.nodes[0].group).toBe("bare-epic");
  });

  it("suppresses heading-fallback once the group has fully settled", () => {
    const m = ok({
      ...Object.fromEntries([
        specFile({ type: "dev", hash: "aaa111", slug: "one", status: "done" }),
      ]),
      "DEV.md": [
        "# DEV",
        "",
        "### Epic 1 — closed epic",
        "",
        row("x", "dev", "aaa111", "one", "One", "done"),
        "",
      ].join("\n"),
    });
    // The linkage is still missing, but nobody will ever add it to a closed
    // epic — an unactionable nag on every render buries the live drift.
    expect(m.groups[0].collapsed).toBe(true);
    expect(codes(m, "heading-fallback")).toEqual([]);
  });

  it("suppresses heading-fallback for a heading with no rows under it", () => {
    const m = ok({
      ...Object.fromEntries([specFile({ type: "dev", hash: "aaa111", slug: "one" })]),
      "DEV.md": [
        "# DEV",
        "",
        "### Epic — scaffolded ahead",
        "",
        "### Epic — real one (plan: wsr001)",
        "",
        row(" ", "dev", "aaa111", "one", "One", "ready"),
        "",
      ].join("\n"),
    });
    expect(codes(m, "heading-fallback")).toEqual([]);
  });

  it("reads the `devx loop` merge-line dialect, and the latest of several", () => {
    const m = ok({
      ...Object.fromEntries([
        specFile({
          type: "dev",
          hash: "aaa111",
          slug: "one",
          status: "done",
          log: [
            "2026-07-30T16:58:47.217Z — merged via devx loop — PR https://github.com/x/y/pull/104",
            "2026-08-01T09:10 — merged via PR #110 (squash → 93b0aa4).",
          ],
        }),
        // BMAD-era prose records the same event without the marker — the
        // pinned contract omits rather than guesses.
        specFile({
          type: "dev",
          hash: "aaa222",
          slug: "two",
          status: "done",
          log: ["2026-04-26T20:25 — merged. Squash-merged to main as 70872e4."],
        }),
      ]),
      "DEV.md": [
        "# DEV",
        "",
        "### Epic — dialects (plan: wsd001)",
        "",
        row("x", "dev", "aaa111", "one", "One", "done"),
        "",
        "### Epic — silent (plan: wss001)",
        "",
        row("x", "dev", "aaa222", "two", "Two", "done"),
        "",
      ].join("\n"),
    });
    expect(m.groups.find((g) => g.id === "dialects")?.stats.lastMerged).toBe("2026-08-01");
    expect(m.groups.find((g) => g.id === "silent")?.stats.lastMerged).toBeNull();
  });

  it("prefers the workstream pointer over a conflicting epic heading", () => {
    const m = ok({
      ...Object.fromEntries([
        specFile({
          type: "plan",
          hash: "wsa001",
          slug: "ws-alpha",
          fm: ["stage: executing", "workstream: _devx/workstreams/ws-alpha"],
        }),
        specFile({ type: "dev", hash: "aaa111", slug: "one", fm: ["plan: _devx/workstreams/ws-alpha"] }),
      ]),
      "DEV.md": [
        "# DEV",
        "",
        "### Epic — some-other-section (plan: zzz999)",
        "",
        row(" ", "dev", "aaa111", "one", "One", "ready"),
        "",
      ].join("\n"),
    });
    expect(m.nodes.find((n) => n.hash === "aaa111")?.group).toBe("ws-alpha");
  });

  it("collapses a group whose members are all settled, with last merge date", () => {
    const m = ok({
      ...Object.fromEntries([
        specFile({
          type: "dev",
          hash: "ddd111",
          slug: "done-one",
          status: "done",
          log: ["2026-07-15T11:47 — merged via PR #76 (squash → 4e5e541)."],
        }),
        specFile({
          type: "dev",
          hash: "ddd222",
          slug: "done-two",
          status: "done",
          log: ["2026-07-18T09:02 — merged via PR #79 (squash → b0223bd)."],
        }),
        specFile({ type: "dev", hash: "aaa111", slug: "live-one" }),
      ]),
      "DEV.md": [
        "# DEV",
        "",
        "### Epic — ws-done (plan: wsd001)",
        "",
        row("x", "dev", "ddd111", "done-one", "Done one", "done"),
        row("x", "dev", "ddd222", "done-two", "Done two", "done"),
        "",
        "### Epic — ws-live (plan: wsl001)",
        "",
        row(" ", "dev", "aaa111", "live-one", "Live one", "ready"),
        "",
      ].join("\n"),
    });
    const done = m.groups.find((g) => g.id === "ws-done");
    expect(done).toMatchObject({
      collapsed: true,
      stats: { done: 2, total: 2, lastMerged: "2026-07-18" },
    });
    const live = m.groups.find((g) => g.id === "ws-live");
    expect(live).toMatchObject({
      collapsed: false,
      stats: { done: 0, total: 1, lastMerged: null },
    });
  });

  it("counts deleted/superseded members as settled for the collapse rule", () => {
    const m = ok({
      ...Object.fromEntries([
        specFile({ type: "dev", hash: "aaa111", slug: "one", status: "done" }),
        specFile({ type: "dev", hash: "aaa222", slug: "two", status: "superseded" }),
      ]),
      "DEV.md": [
        "# DEV",
        "",
        "### Epic — mixed (plan: wsm001)",
        "",
        row("x", "dev", "aaa111", "one", "One", "done"),
        row("x", "dev", "aaa222", "two", "Two", "superseded"),
        "",
      ].join("\n"),
    });
    expect(m.groups[0]).toMatchObject({ collapsed: true, stats: { done: 2, total: 2 } });
  });

  it("orders groups workstream → epic → standalone, then by id", () => {
    const m = ok({
      ...Object.fromEntries([
        specFile({
          type: "plan",
          hash: "wsz001",
          slug: "zeta",
          fm: ["stage: executing", "workstream: _devx/workstreams/zeta"],
        }),
        specFile({ type: "dev", hash: "aaa111", slug: "one", fm: ["plan: _devx/workstreams/zeta"] }),
        specFile({ type: "dev", hash: "bbb111", slug: "two" }),
        specFile({ type: "dev", hash: "ccc111", slug: "three" }),
        specFile({ type: "dev", hash: "ddd111", slug: "four" }),
      ]),
      "DEV.md": [
        "# DEV",
        "",
        // Above every heading — the ungrouped bucket.
        row(" ", "dev", "ddd111", "four", "Four", "ready"),
        "",
        "### Epic — beta-epic (plan: wsb001)",
        "",
        row(" ", "dev", "bbb111", "two", "Two", "ready"),
        "",
        "### Epic — alpha-epic (plan: wsa001)",
        "",
        row(" ", "dev", "ccc111", "three", "Three", "ready"),
        "",
      ].join("\n"),
    });
    expect(m.groups.map((g) => g.id)).toEqual([
      "zeta",
      "alpha-epic",
      "beta-epic",
      "standalone",
    ]);
  });
});

describe("badges (AC 5)", () => {
  const repo = (interview: string, manual: string): Record<string, string> => ({
    ...Object.fromEntries([
      specFile({ type: "dev", hash: "aaa111", slug: "one" }),
      specFile({ type: "dev", hash: "aaa222", slug: "two" }),
    ]),
    "DEV.md": [
      "# DEV",
      "",
      row(" ", "dev", "aaa111", "one", "One", "ready"),
      row(" ", "dev", "aaa222", "two", "Two", "ready"),
      "",
    ].join("\n"),
    "INTERVIEW.md": interview,
    "MANUAL.md": manual,
  });

  it("attaches INTERVIEW/MANUAL badges to the nodes they block", () => {
    const m = ok(
      repo(
        ["# INTERVIEW", "", "- [ ] **Q#9 — which budget?**", "  - Blocks: aaa111.", ""].join("\n"),
        ["# MANUAL", "", "- [ ] **MV2.1 — supervise the first night**", "  - Blocks: aaa111, aaa222.", ""].join("\n"),
      ),
    );
    const byHash = new Map(m.nodes.map((n) => [n.hash, n.badges]));
    expect(byHash.get("aaa111")).toEqual(["INTERVIEW Q#9", "MANUAL MV2.1"]);
    expect(byHash.get("aaa222")).toEqual(["MANUAL MV2.1"]);
  });

  it("ignores answered questions and checked manual items", () => {
    const m = ok(
      repo(
        ["# INTERVIEW", "", "- [x] **Q#9 — which budget?**", "  - Blocks: aaa111.", ""].join("\n"),
        ["# MANUAL", "", "- [x] **MV2.1 — done**", "  - Blocks: aaa222.", ""].join("\n"),
      ),
    );
    expect(m.nodes.every((n) => n.badges.length === 0)).toBe(true);
  });

  it("never invents a node from a badge pointing at an unknown hash", () => {
    const m = ok(
      repo(
        ["# INTERVIEW", "", "- [ ] **Q#3 — ?**", "  - Blocks: zzz999.", ""].join("\n"),
        "# MANUAL\n",
      ),
    );
    expect(m.nodes.map((n) => n.hash)).toEqual(["aaa111", "aaa222"]);
    expect(m.nodes.every((n) => n.badges.length === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC 6 — cycle detection
// ---------------------------------------------------------------------------

describe("cycle detection (AC 6)", () => {
  it("fails on a mutual block, enumerating every member", () => {
    const r = build({
      ...Object.fromEntries([
        specFile({ type: "dev", hash: "cyc111", slug: "cycle-one", fm: ["blocked_by: [cyc222]"] }),
        specFile({ type: "dev", hash: "cyc222", slug: "cycle-two", fm: ["blocked_by: [cyc111]"] }),
      ]),
    });
    expect(r).toEqual({ ok: false, cycle: ["cyc111", "cyc222"] });
  });

  it("fails on a self-block", () => {
    const r = build({
      ...Object.fromEntries([
        specFile({ type: "dev", hash: "slf111", slug: "self-one", fm: ["blocked_by: [slf111]"] }),
      ]),
    });
    expect(r).toEqual({ ok: false, cycle: ["slf111"] });
  });

  it("enumerates every member of a longer cycle", () => {
    const r = build({
      ...Object.fromEntries([
        specFile({ type: "dev", hash: "aaa111", slug: "one", fm: ["blocked_by: [aaa222]"] }),
        specFile({ type: "dev", hash: "aaa222", slug: "two", fm: ["blocked_by: [aaa333]"] }),
        specFile({ type: "dev", hash: "aaa333", slug: "three", fm: ["blocked_by: [aaa111]"] }),
        // Not part of the cycle — must not be reported.
        specFile({ type: "dev", hash: "bbb111", slug: "four", fm: ["blocked_by: [aaa111]"] }),
      ]),
    });
    expect(r).toEqual({ ok: false, cycle: ["aaa111", "aaa222", "aaa333"] });
  });

  it("enumerates members of TWO disjoint cycles in one run", () => {
    const r = build({
      ...Object.fromEntries([
        specFile({ type: "dev", hash: "aaa111", slug: "a1", fm: ["blocked_by: [aaa222]"] }),
        specFile({ type: "dev", hash: "aaa222", slug: "a2", fm: ["blocked_by: [aaa111]"] }),
        specFile({ type: "dev", hash: "bbb111", slug: "b1", fm: ["blocked_by: [bbb222]"] }),
        specFile({ type: "dev", hash: "bbb222", slug: "b2", fm: ["blocked_by: [bbb111]"] }),
      ]),
    });
    expect(r).toEqual({
      ok: false,
      cycle: ["aaa111", "aaa222", "bbb111", "bbb222"],
    });
  });

  it("accepts a deep acyclic chain without recursing off the stack", () => {
    const files: Record<string, string> = {};
    const n = 2000;
    for (let i = 0; i < n; i++) {
      const hash = `ch${String(i).padStart(4, "0")}`;
      const prev = i === 0 ? null : `ch${String(i - 1).padStart(4, "0")}`;
      const [p, c] = specFile({
        type: "dev",
        hash,
        slug: `chain-${i}`,
        fm: prev ? [`blocked_by: [${prev}]`] : [],
      });
      files[p] = c;
    }
    const r = build(files);
    expect(r.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Determinism + fenced-block hygiene
// ---------------------------------------------------------------------------

describe("determinism", () => {
  const repo = (): Record<string, string> => ({
    ...Object.fromEntries([
      specFile({ type: "dev", hash: "aaa222", slug: "two", fm: ["blocked_by: [aaa111]"] }),
      specFile({ type: "dev", hash: "aaa111", slug: "one" }),
      specFile({ type: "dev", hash: "aaa333", slug: "three" }),
    ]),
    "DEV.md": [
      "# DEV",
      "",
      row(" ", "dev", "aaa333", "three", "Three", "ready", ["Parallel-safe with aaa111."]),
      row(" ", "dev", "aaa222", "two", "Two", "ready"),
      row(" ", "dev", "aaa111", "one", "One", "ready"),
      "",
      "Example row shape (illustrative only — must NOT render):",
      "",
      "```",
      row(" ", "dev", "ffffff", "example", "Example row", "ready"),
      "```",
      "",
    ].join("\n"),
  });

  it("is byte-stable across runs of the same state", () => {
    expect(JSON.stringify(ok(repo()))).toBe(JSON.stringify(ok(repo())));
  });

  it("sorts nodes by hash and edges by (from, to, kind)", () => {
    const m = ok(repo());
    expect(m.nodes.map((n) => n.hash)).toEqual(["aaa111", "aaa222", "aaa333"]);
    expect(m.edges.map((e) => `${e.from}->${e.to}:${e.kind}`)).toEqual([
      "aaa111->aaa333:parallel",
      "aaa222->aaa111:blocks",
    ]);
  });

  it("never renders a row that lives inside a fenced code block", () => {
    const m = ok(repo());
    expect(m.nodes.some((n) => n.hash === "ffffff")).toBe(false);
  });

  it("refuses to render when a backlog file exists but is unreadable", () => {
    // The empty-board failure mode: a chmod-000 DEV.md that degraded to
    // "contributes nothing" renders a clean, plausible, WRONG graph.
    const files: Record<string, string> = {
      ...Object.fromEntries([specFile({ type: "dev", hash: "aaa111", slug: "one" })]),
      "DEV.md": "# DEV\n",
    };
    const base = makeFs(files);
    const fs: GraphFs = {
      ...base,
      readFile(p) {
        if (p.endsWith("DEV.md")) throw new Error("EACCES: permission denied");
        return base.readFile(p);
      },
    };
    expect(() => buildGraphModel(fs, ROOT, ENGINE_DEFAULTS)).toThrow(/DEV\.md.*unreadable/);
  });

  it("degrades gracefully when a single SPEC is unreadable", () => {
    const files: Record<string, string> = {
      ...Object.fromEntries([
        specFile({ type: "dev", hash: "aaa111", slug: "one" }),
        specFile({ type: "dev", hash: "aaa222", slug: "two" }),
      ]),
      "DEV.md": [
        "# DEV",
        "",
        row(" ", "dev", "aaa111", "one", "One", "ready"),
        row("-", "dev", "aaa222", "two", "Two", "blocked", ["Blocked-by: aaa111."]),
        "",
      ].join("\n"),
    };
    const base = makeFs(files);
    const fs: GraphFs = {
      ...base,
      readFile(p) {
        if (p.includes("aaa222")) throw new Error("EACCES: permission denied");
        return base.readFile(p);
      },
    };
    const r = buildGraphModel(fs, ROOT, ENGINE_DEFAULTS);
    if (!r.ok) throw new Error("unexpected cycle");
    // The item survives on its row alone — only its frontmatter is lost.
    // aaa111 reads its title from frontmatter ("one"); aaa222, whose spec is
    // unreadable, falls back to the row's ("Two").
    expect(r.model.nodes.map((n) => `${n.hash}:${n.status}:${n.title}`)).toEqual([
      "aaa111:ready:one",
      "aaa222:blocked:Two",
    ]);
    expect(blockEdges(r.model)).toEqual(["aaa222->aaa111"]);
  });

  it("returns an empty model on a repo with no backlogs and no specs", () => {
    const m = ok({ "README.md": "# nothing here\n" });
    expect(m).toEqual({ nodes: [], edges: [], groups: [], warnings: [] });
  });

  it("hands the caller the same warnings array the model carries", () => {
    const r = build({
      ...Object.fromEntries([specFile({ type: "dev", hash: "aaa111", slug: "one" })]),
      "DEV.md": [
        "# DEV",
        "",
        "### Epic 1 — bare",
        "",
        row(" ", "dev", "aaa111", "one", "One", "ready"),
        "",
      ].join("\n"),
    });
    if (!r.ok) throw new Error("unexpected cycle");
    expect(r.warnings).toBe(r.model.warnings);
    expect(r.warnings).toHaveLength(1);
  });
});
