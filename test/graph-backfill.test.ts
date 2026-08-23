// Unit coverage for `devx graph backfill` (sgr106 / plan Phase 6, T6.6).
//
// Everything runs against an in-memory fs — the module's whole I/O surface is
// the `EngineFs`-style seam, so no temp dirs and no real backlog lock (the
// lock seam is the identity function here; its real behavior is mlc102's
// suite). E-6 covers the same contract end-to-end through the built CLI on a
// real git repo; this file pins the pieces individually so a regression names
// itself instead of arriving as one red eval.
//
// The three rules under test, in order: adds-only, never-guesses, idempotent.
//
// Spec: dev/dev-sgr106-2026-08-02T13:57-graph-backfill.md

import { describe, expect, it } from "vitest";

import { ENGINE_DEFAULTS } from "../src/lib/engine/config.js";
import { applyEnginePatch } from "../src/lib/engine/frontmatter.js";
import type { EngineFs } from "../src/lib/engine/workstream.js";
import {
  type BackfillFs,
  appendRowBlockers,
  planBackfill,
  runBackfill,
} from "../src/lib/graph/backfill.js";

// ---------------------------------------------------------------------------
// In-memory fixture repo (the graph-model.test.ts fs, plus writeFile)
// ---------------------------------------------------------------------------

const ROOT = "/repo";
const TS = "2026-08-01T08:00";

interface Fixture {
  fs: BackfillFs;
  files: Record<string, string>;
  writes: string[];
}

function makeFs(initial: Record<string, string>): Fixture {
  const files = { ...initial };
  const writes: string[] = [];
  const rel = (p: string): string => {
    const n = p.replace(/\\/g, "/");
    if (n === ROOT) return "";
    return n.startsWith(`${ROOT}/`) ? n.slice(ROOT.length + 1) : n;
  };
  const dirsOf = (): Set<string> => {
    const dirs = new Set<string>([""]);
    for (const f of Object.keys(files)) {
      const parts = f.split("/");
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
    }
    return dirs;
  };
  const fs: BackfillFs = {
    readFile(p) {
      const hit = files[rel(p)];
      if (hit === undefined) throw new Error(`ENOENT: ${rel(p)}`);
      return hit;
    },
    writeFile(p, contents) {
      files[rel(p)] = contents;
      writes.push(rel(p));
    },
    exists(p) {
      const r = rel(p);
      return files[r] !== undefined || dirsOf().has(r);
    },
    readdir(p) {
      const r = rel(p);
      if (!dirsOf().has(r)) throw new Error(`ENOTDIR: ${r}`);
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
  return { fs, files, writes };
}

function specRel(type: string, hash: string, slug: string): string {
  return `${type}/${type}-${hash}-${TS}-${slug}.md`;
}

function spec(opts: {
  type?: string;
  hash: string;
  slug: string;
  title: string;
  status: string;
  fm?: string[];
}): [string, string] {
  const type = opts.type ?? "dev";
  return [
    specRel(type, opts.hash, opts.slug),
    [
      "---",
      `hash: ${opts.hash}`,
      `type: ${type}`,
      `created: ${TS}:00-06:00`,
      `title: "${opts.title}"`,
      `status: ${opts.status}`,
      ...(opts.fm ?? []),
      "---",
      "",
      "## Goal",
      "",
      `Fixture goal for ${opts.hash}.`,
      "",
      "## Status log",
      "",
      `- ${TS} — filed (fixture).`,
      "",
    ].join("\n"),
  ];
}

function row(
  state: " " | "/" | "-" | "x",
  hash: string,
  slug: string,
  title: string,
  status: string,
  annotations: string[] = [],
): string {
  const ann = annotations.length > 0 ? ` ${annotations.join(" ")}` : "";
  return `- [${state}] \`${specRel("dev", hash, slug)}\` — ${title}.${ann} Status: ${status}.`;
}

const identityLock = <T>(_label: string, fn: () => T): T => fn();

function run(fx: Fixture, dryRun = false) {
  return runBackfill(ROOT, ENGINE_DEFAULTS, {
    fs: fx.fs,
    dryRun,
    lock: identityLock,
  });
}

function fmBlock(content: string): string {
  const m = /^---\n([\s\S]*?)\n---/.exec(content);
  return m ? m[1] : "";
}

// ---------------------------------------------------------------------------
// Pass 1 — mechanical completion
// ---------------------------------------------------------------------------

describe("pass 1 — mechanical completion", () => {
  function twoSided(): Fixture {
    const [p111, c111] = spec({
      hash: "aaa111",
      slug: "one",
      title: "One",
      status: "ready",
    });
    const [p222, c222] = spec({
      hash: "aaa222",
      slug: "two",
      title: "Two",
      status: "ready",
    });
    return makeFs({
      "devx.config.yaml": "mode: yolo\n",
      [p111]: c111,
      [p222]: c222,
      "DEV.md": [
        "# DEV",
        "",
        row(" ", "aaa111", "one", "One", "ready", ["Blocked-by: aaa222."]),
        row(" ", "aaa222", "two", "Two", "ready"),
        "",
      ].join("\n"),
    });
  }

  it("writes a row-only edge into frontmatter in canonical underscore form", () => {
    const fx = twoSided();
    const result = run(fx);
    expect(result.ok).toBe(true);
    expect(fmBlock(fx.files[specRel("dev", "aaa111", "one")])).toContain(
      "blocked_by: [aaa222]",
    );
  });

  it("leaves the already-complete row prose untouched (adds only)", () => {
    const fx = twoSided();
    run(fx);
    const line = fx.files["DEV.md"]
      .split("\n")
      .find((l) => l.includes("aaa111"))!;
    expect(line).toContain("Blocked-by: aaa222.");
    expect(line.match(/aaa222/g)).toHaveLength(1);
  });

  it("normalizes a hyphenated blocked-by key and removes the old spelling", () => {
    const [p111, c111] = spec({
      hash: "aaa111",
      slug: "one",
      title: "One",
      status: "ready",
    });
    const [p333, c333] = spec({
      hash: "aaa333",
      slug: "three",
      title: "Three",
      status: "ready",
      fm: ["blocked-by: [aaa111]"],
    });
    const fx = makeFs({
      "devx.config.yaml": "mode: yolo\n",
      [p111]: c111,
      [p333]: c333,
      "DEV.md": [
        "# DEV",
        "",
        row(" ", "aaa111", "one", "One", "ready"),
        row(" ", "aaa333", "three", "Three", "ready"),
        "",
      ].join("\n"),
    });
    run(fx);
    const fm = fmBlock(fx.files[specRel("dev", "aaa333", "three")]);
    expect(fm).toContain("blocked_by: [aaa111]");
    expect(fm).not.toMatch(/blocked-by:/);
  });

  it("writes the full union to both sides when they disagree", () => {
    const [p111, c111] = spec({
      hash: "aaa111",
      slug: "one",
      title: "One",
      status: "ready",
    });
    const [p222, c222] = spec({
      hash: "aaa222",
      slug: "two",
      title: "Two",
      status: "ready",
    });
    const [p444, c444] = spec({
      hash: "aaa444",
      slug: "four",
      title: "Four",
      status: "blocked",
      fm: ["blocked_by: [aaa222]"],
    });
    const fx = makeFs({
      "devx.config.yaml": "mode: yolo\n",
      [p111]: c111,
      [p222]: c222,
      [p444]: c444,
      "DEV.md": [
        "# DEV",
        "",
        row(" ", "aaa111", "one", "One", "ready"),
        row(" ", "aaa222", "two", "Two", "ready"),
        row("-", "aaa444", "four", "Four", "blocked", ["Blocked-by: aaa111."]),
        "",
      ].join("\n"),
    });
    run(fx);
    const fm = fmBlock(fx.files[specRel("dev", "aaa444", "four")]);
    expect(fm).toContain("aaa222");
    expect(fm).toContain("aaa111");
    const line = fx.files["DEV.md"].split("\n").find((l) => l.includes("aaa444"))!;
    expect(line).toContain("Blocked-by: aaa111, aaa222.");
    expect(line).toContain("Status: blocked.");
  });

  it("gives a settled row frontmatter only — no new prose on a done row", () => {
    const [p111, c111] = spec({
      hash: "ffm111",
      slug: "core",
      title: "Core",
      status: "done",
    });
    const [p222, c222] = spec({
      hash: "ffm222",
      slug: "polish",
      title: "Polish",
      status: "done",
      fm: ["blocked_by: [ffm111]"],
    });
    const fx = makeFs({
      "devx.config.yaml": "mode: yolo\n",
      [p111]: c111,
      [p222]: c222,
      "DEV.md": [
        "# DEV",
        "",
        row("x", "ffm111", "core", "Core", "done"),
        // A done row that DOES carry the annotation — the settled check, not
        // the "row bears no annotation" check, is what must hold here.
        row("x", "ffm222", "polish", "Polish", "done", ["Blocked-by: ffm111."]),
        "",
      ].join("\n"),
    });
    const before = fx.files["DEV.md"];
    run(fx);
    expect(fx.files["DEV.md"]).toBe(before);
    expect(fmBlock(fx.files[specRel("dev", "ffm222", "polish")])).toContain("ffm111");
  });

  it("never grows a live row that carries no Blocked-by annotation", () => {
    const [p111, c111] = spec({
      hash: "aaa111",
      slug: "one",
      title: "One",
      status: "ready",
    });
    const [p222, c222] = spec({
      hash: "aaa222",
      slug: "two",
      title: "Two",
      status: "ready",
      fm: ["blocked_by: [aaa111]"],
    });
    const fx = makeFs({
      "devx.config.yaml": "mode: yolo\n",
      [p111]: c111,
      [p222]: c222,
      "DEV.md": [
        "# DEV",
        "",
        row(" ", "aaa111", "one", "One", "ready"),
        row(" ", "aaa222", "two", "Two", "ready"),
        "",
      ].join("\n"),
    });
    const before = fx.files["DEV.md"];
    run(fx);
    expect(fx.files["DEV.md"]).toBe(before);
  });

  it("preserves an existing spec-path-shaped blocker verbatim", () => {
    const [p111, c111] = spec({
      hash: "aaa111",
      slug: "one",
      title: "One",
      status: "ready",
    });
    const [p222, c222] = spec({
      hash: "aaa222",
      slug: "two",
      title: "Two",
      status: "ready",
    });
    const [p333, c333] = spec({
      hash: "aaa333",
      slug: "three",
      title: "Three",
      status: "ready",
      fm: [`blocked_by: [${specRel("dev", "aaa111", "one")}]`],
    });
    const fx = makeFs({
      "devx.config.yaml": "mode: yolo\n",
      [p111]: c111,
      [p222]: c222,
      [p333]: c333,
      "DEV.md": [
        "# DEV",
        "",
        row(" ", "aaa111", "one", "One", "ready"),
        row(" ", "aaa222", "two", "Two", "ready"),
        row(" ", "aaa333", "three", "Three", "ready", ["Blocked-by: aaa222."]),
        "",
      ].join("\n"),
    });
    run(fx);
    const fm = fmBlock(fx.files[specRel("dev", "aaa333", "three")]);
    expect(fm).toContain(specRel("dev", "aaa111", "one"));
    expect(fm).toContain("aaa222");
  });

  it("never materializes a token that matches no known spec", () => {
    const [p111, c111] = spec({
      hash: "aaa111",
      slug: "one",
      title: "One",
      status: "ready",
    });
    const fx = makeFs({
      "devx.config.yaml": "mode: yolo\n",
      [p111]: c111,
      "DEV.md": [
        "# DEV",
        "",
        row(" ", "aaa111", "one", "One", "ready", ["Blocked-by: zzz999."]),
        "",
      ].join("\n"),
    });
    run(fx);
    expect(fmBlock(fx.files[specRel("dev", "aaa111", "one")])).not.toContain("zzz999");
    expect(fx.writes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Derived edges — durable state only
// ---------------------------------------------------------------------------

function workstreamFixture(extra: Record<string, string> = {}): Fixture {
  const [p1, c1] = spec({
    hash: "stp111",
    slug: "step-one",
    title: "Step one",
    status: "done",
    fm: ["plan: _devx/workstreams/ws-steps", "phase: 1"],
  });
  const [p2, c2] = spec({
    hash: "stp222",
    slug: "step-two",
    title: "Step two",
    status: "ready",
    fm: ["plan: _devx/workstreams/ws-steps", "phase: 2"],
  });
  return makeFs({
    "devx.config.yaml": "mode: yolo\n",
    "_devx/workstreams/ws-steps/plan/agent.md": "# Plan — ws-steps\n",
    [p1]: c1,
    [p2]: c2,
    "DEV.md": [
      "# DEV",
      "",
      row("x", "stp111", "step-one", "Step one", "done"),
      row(" ", "stp222", "step-two", "Step two", "ready"),
      "",
    ].join("\n"),
    ...extra,
  });
}

describe("derived edges", () => {
  it("derives the predecessor from durable `phase:` ordering", () => {
    const fx = workstreamFixture();
    const result = run(fx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.derived).toEqual([
      { from: "stp222", to: "stp111", via: "phase", workstream: "ws-steps" },
    ]);
    expect(fmBlock(fx.files[specRel("dev", "stp222", "step-two")])).toContain(
      "blocked_by: [stp111]",
    );
  });

  it("does not derive over a spec that already declares a blocker", () => {
    // stp222 declares stp111 explicitly; a third phase-3 spec that declares
    // its own (non-adjacent) blocker must keep it and gain nothing.
    const [p3, c3] = spec({
      hash: "stp333",
      slug: "step-three",
      title: "Step three",
      status: "ready",
      fm: [
        "plan: _devx/workstreams/ws-steps",
        "phase: 3",
        "blocked_by: [stp111]",
      ],
    });
    const fx = workstreamFixture({
      [p3]: c3,
    });
    fx.files["DEV.md"] = `${fx.files["DEV.md"]}${row(" ", "stp333", "step-three", "Step three", "ready")}\n`;
    const result = run(fx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.derived.map((d) => d.from)).not.toContain("stp333");
    expect(fmBlock(fx.files[specRel("dev", "stp333", "step-three")])).not.toContain(
      "stp222",
    );
  });

  it("skips a phase gap to the nearest populated earlier phase", () => {
    const [p4, c4] = spec({
      hash: "stp444",
      slug: "step-four",
      title: "Step four",
      status: "ready",
      fm: ["plan: _devx/workstreams/ws-steps", "phase: 7"],
    });
    const fx = workstreamFixture({ [p4]: c4 });
    fx.files["DEV.md"] = `${fx.files["DEV.md"]}${row(" ", "stp444", "step-four", "Step four", "ready")}\n`;
    const result = run(fx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.plan.derived.find((d) => d.from === "stp444"),
    ).toMatchObject({ to: "stp222" });
  });

  it("reads ordering from a plan/agent.md `(dev spec: <hash>)` pointer", () => {
    const [pa, ca] = spec({
      hash: "ptr111",
      slug: "ptr-one",
      title: "Ptr one",
      status: "done",
      fm: ["from: _devx/workstreams/ws-ptr/plan/agent.md"],
    });
    const [pb, cb] = spec({
      hash: "ptr222",
      slug: "ptr-two",
      title: "Ptr two",
      status: "ready",
      fm: ["from: _devx/workstreams/ws-ptr/plan/agent.md"],
    });
    const fx = makeFs({
      "devx.config.yaml": "mode: yolo\n",
      "_devx/workstreams/ws-ptr/plan/agent.md": [
        "# Plan — ws-ptr",
        "",
        "- [x] Phase 1: the first one (dev spec: ptr111)",
        "- [ ] Phase 2: the second one (dev spec: ptr222)",
        "",
      ].join("\n"),
      [pa]: ca,
      [pb]: cb,
      "DEV.md": [
        "# DEV",
        "",
        row("x", "ptr111", "ptr-one", "Ptr one", "done"),
        row(" ", "ptr222", "ptr-two", "Ptr two", "ready"),
        "",
      ].join("\n"),
    });
    const result = run(fx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.derived).toEqual([
      { from: "ptr222", to: "ptr111", via: "plan-pointer", workstream: "ws-ptr" },
    ]);
  });

  it("reads ordering from a todo.md phase pointer", () => {
    const [pa, ca] = spec({
      hash: "tdo111",
      slug: "todo-one",
      title: "Todo one",
      status: "done",
      fm: ["from: _devx/workstreams/ws-todo/plan/agent.md"],
    });
    const [pb, cb] = spec({
      hash: "tdo222",
      slug: "todo-two",
      title: "Todo two",
      status: "ready",
      fm: ["from: _devx/workstreams/ws-todo/plan/agent.md"],
    });
    const fx = makeFs({
      "devx.config.yaml": "mode: yolo\n",
      "_devx/workstreams/ws-todo/plan/agent.md": "# Plan — ws-todo\n",
      "_devx/workstreams/ws-todo/todo.md": [
        "# Todo — ws-todo",
        "",
        "- [ ] Stage: Execute",
        "  - [x] Phase 1: the first one → tdo111",
        "  - [ ] Phase 2: the second one → tdo222",
        "",
      ].join("\n"),
      [pa]: ca,
      [pb]: cb,
      "DEV.md": [
        "# DEV",
        "",
        row("x", "tdo111", "todo-one", "Todo one", "done"),
        row(" ", "tdo222", "todo-two", "Todo two", "ready"),
        "",
      ].join("\n"),
    });
    const result = run(fx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.derived).toEqual([
      { from: "tdo222", to: "tdo111", via: "todo-pointer", workstream: "ws-todo" },
    ]);
  });

  it("suppresses a phase edge the row's `Parallel-safe with` refutes", () => {
    const fx = workstreamFixture();
    fx.files["DEV.md"] = fx.files["DEV.md"].replace(
      "Step two. Status: ready.",
      "Step two. Parallel-safe with stp111 (no shared files). Status: ready.",
    );
    const result = run(fx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.derived).toHaveLength(0);
    expect(result.plan.suppressed).toEqual([
      {
        from: "stp222",
        to: "stp111",
        reason: "declared `Parallel-safe with` — the row refutes the phase order",
      },
    ]);
    expect(fmBlock(fx.files[specRel("dev", "stp222", "step-two")])).not.toContain(
      "stp111",
    );
  });

  it("never infers ordering onto a settled spec", () => {
    const fx = workstreamFixture();
    const path = specRel("dev", "stp222", "step-two");
    fx.files[path] = fx.files[path].replace("status: ready", "status: done");
    fx.files["DEV.md"] = fx.files["DEV.md"].replace(
      row(" ", "stp222", "step-two", "Step two", "ready"),
      row("x", "stp222", "step-two", "Step two", "done"),
    );
    const result = run(fx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.derived).toHaveLength(0);
    expect(result.plan.suppressed).toEqual([
      {
        from: "stp222",
        to: null,
        reason: "settled (done) — phase ordering is not inferred onto shipped work",
      },
    ]);
    expect(fx.writes).toHaveLength(0);
  });

  it("refuses when derived ordering would close a blocking cycle", () => {
    // stp111 (phase 1) is authored as blocked by stp222 (phase 2); deriving
    // stp222 → stp111 from the phase order would close the loop.
    const fx = workstreamFixture();
    const path111 = specRel("dev", "stp111", "step-one");
    fx.files[path111] = fx.files[path111].replace(
      "phase: 1",
      "phase: 1\nblocked_by: [stp222]",
    );
    const result = run(fx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/cycle/);
    expect(result.cycle).toEqual(["stp111", "stp222"]);
    expect(fx.writes).toHaveLength(0);
  });

  it("tolerates a non-directory file in the workstreams root and a plan-less dir", () => {
    const fx = workstreamFixture({
      "_devx/workstreams/notes.md": "stray non-workstream file\n",
      "_devx/workstreams/ws-noplan/todo.md": "# Todo — ws-noplan\n",
    });
    const result = run(fx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.derived).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Pass 2 — the underivable report
// ---------------------------------------------------------------------------

describe("pass 2 — underivable report", () => {
  function orphanFixture(): Fixture {
    const [pa, ca] = spec({
      hash: "orp111",
      slug: "orphan-one",
      title: "Orphan one",
      status: "ready",
      fm: ["from: _devx/workstreams/ws-orphan/plan/agent.md", "phase: 1"],
    });
    const [pb, cb] = spec({
      hash: "und111",
      slug: "orphan-und",
      title: "Orphan und",
      status: "ready",
      fm: ["from: _devx/workstreams/ws-orphan/plan/agent.md"],
    });
    return makeFs({
      "devx.config.yaml": "mode: yolo\n",
      "_devx/workstreams/ws-orphan/plan/agent.md": "# Plan — ws-orphan\n\nProse only.\n",
      [pa]: ca,
      [pb]: cb,
      "DEV.md": [
        "# DEV",
        "",
        row(" ", "orp111", "orphan-one", "Orphan one", "ready"),
        row(" ", "und111", "orphan-und", "Orphan und", "ready"),
        "",
      ].join("\n"),
    });
  }

  it("reports a workstream member with no phase, no pointer and no edge", () => {
    const fx = orphanFixture();
    const result = run(fx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.underivable.map((u) => u.hash)).toEqual(["und111"]);
    expect(result.plan.underivable[0].workstream).toBe("ws-orphan");
  });

  it("never guesses an edge for the underivable spec", () => {
    const fx = orphanFixture();
    run(fx);
    expect(fmBlock(fx.files[specRel("dev", "und111", "orphan-und")])).not.toContain(
      "orp111",
    );
  });

  it("does not report a spec that is somebody's blocker", () => {
    const fx = orphanFixture();
    // und111 gains an inbound edge — its position in the graph is recorded.
    const path = specRel("dev", "orp111", "orphan-one");
    fx.files[path] = fx.files[path].replace("phase: 1", "blocked_by: [und111]");
    const result = run(fx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.underivable).toHaveLength(0);
  });

  it("does not double-report a spec whose frontmatter is unparseable", () => {
    // und111's block does not parse, so it looks phase-less, edge-less and
    // workstream-less to every reader. That is one problem with one name —
    // it must not also surface as a missing ordering a human should supply.
    const fx = orphanFixture();
    const path = specRel("dev", "und111", "orphan-und");
    fx.files[path] = fx.files[path].replace(
      'title: "Orphan und"',
      "title: Orphan: und",
    );
    const result = run(fx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.unparseable.map((u) => u.hash)).toEqual(["und111"]);
    expect(result.plan.underivable).toHaveLength(0);
  });

  it("does not report a spec that belongs to no workstream", () => {
    const [p111, c111] = spec({
      hash: "aaa111",
      slug: "one",
      title: "One",
      status: "ready",
    });
    const [p222, c222] = spec({
      hash: "aaa222",
      slug: "two",
      title: "Two",
      status: "ready",
    });
    const fx = makeFs({
      "devx.config.yaml": "mode: yolo\n",
      [p111]: c111,
      [p222]: c222,
      "DEV.md": [
        "# DEV",
        "",
        row(" ", "aaa111", "one", "One", "ready"),
        row(" ", "aaa222", "two", "Two", "ready"),
        "",
      ].join("\n"),
    });
    const result = run(fx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.underivable).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Dry run + idempotency
// ---------------------------------------------------------------------------

describe("dry run and idempotency", () => {
  function drifted(): Fixture {
    const [p111, c111] = spec({
      hash: "aaa111",
      slug: "one",
      title: "One",
      status: "ready",
    });
    const [p222, c222] = spec({
      hash: "aaa222",
      slug: "two",
      title: "Two",
      status: "ready",
    });
    return makeFs({
      "devx.config.yaml": "mode: yolo\n",
      [p111]: c111,
      [p222]: c222,
      "DEV.md": [
        "# DEV",
        "",
        row(" ", "aaa111", "one", "One", "ready", ["Blocked-by: aaa222."]),
        row(" ", "aaa222", "two", "Two", "ready"),
        "",
      ].join("\n"),
    });
  }

  it("--dry-run computes the same plan and writes nothing", () => {
    const fx = drifted();
    const snapshot = JSON.stringify(fx.files);
    const result = run(fx, true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.frontmatter.map((f) => f.hash)).toEqual(["aaa111"]);
    expect(result.filesWritten).toHaveLength(0);
    expect(fx.writes).toHaveLength(0);
    expect(JSON.stringify(fx.files)).toBe(snapshot);
  });

  it("a second run writes zero files", () => {
    const fx = drifted();
    const first = run(fx);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.filesWritten).toEqual([specRel("dev", "aaa111", "one")]);
    const afterFirst = JSON.stringify(fx.files);

    fx.writes.length = 0;
    const second = run(fx);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.filesWritten).toHaveLength(0);
    expect(fx.writes).toHaveLength(0);
    expect(JSON.stringify(fx.files)).toBe(afterFirst);
  });

  it("a hyphen-key normalization is also a one-shot", () => {
    const [p111, c111] = spec({
      hash: "aaa111",
      slug: "one",
      title: "One",
      status: "ready",
    });
    const [p333, c333] = spec({
      hash: "aaa333",
      slug: "three",
      title: "Three",
      status: "ready",
      fm: ["blocked-by: [aaa111]"],
    });
    const fx = makeFs({
      "devx.config.yaml": "mode: yolo\n",
      [p111]: c111,
      [p333]: c333,
      "DEV.md": [
        "# DEV",
        "",
        row(" ", "aaa111", "one", "One", "ready"),
        row(" ", "aaa333", "three", "Three", "ready"),
        "",
      ].join("\n"),
    });
    run(fx);
    fx.writes.length = 0;
    const second = run(fx);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.filesWritten).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

describe("refusals", () => {
  it("refuses to complete edges on an already-cyclic board", () => {
    const [p111, c111] = spec({
      hash: "aaa111",
      slug: "one",
      title: "One",
      status: "ready",
      fm: ["blocked_by: [aaa222]"],
    });
    const [p222, c222] = spec({
      hash: "aaa222",
      slug: "two",
      title: "Two",
      status: "ready",
      fm: ["blocked_by: [aaa111]"],
    });
    const fx = makeFs({
      "devx.config.yaml": "mode: yolo\n",
      [p111]: c111,
      [p222]: c222,
      "DEV.md": [
        "# DEV",
        "",
        row(" ", "aaa111", "one", "One", "ready"),
        row(" ", "aaa222", "two", "Two", "ready"),
        "",
      ].join("\n"),
    });
    const result = run(fx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.cycle).toEqual(["aaa111", "aaa222"]);
    expect(fx.writes).toHaveLength(0);
  });

  it("reports unparseable frontmatter instead of trying to complete it", () => {
    const [p111, c111] = spec({
      hash: "aaa111",
      slug: "one",
      title: "One",
      status: "ready",
    });
    const [p222, c222] = spec({
      hash: "aaa222",
      slug: "two",
      title: "Two",
      status: "ready",
    });
    const fx = makeFs({
      "devx.config.yaml": "mode: yolo\n",
      // An unquoted title carrying a colon — the shape two shipped specs in
      // this repo were found in. Every engine reader sees an empty block.
      [p111]: c111.replace('title: "One"', "title: State persistence: one"),
      [p222]: c222,
      "DEV.md": [
        "# DEV",
        "",
        row(" ", "aaa111", "one", "One", "ready", ["Blocked-by: aaa222."]),
        row(" ", "aaa222", "two", "Two", "ready"),
        "",
      ].join("\n"),
    });
    const before = fx.files[specRel("dev", "aaa111", "one")];
    const result = run(fx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.unparseable.map((u) => u.hash)).toEqual(["aaa111"]);
    expect(result.plan.frontmatter).toHaveLength(0);
    expect(fx.files[specRel("dev", "aaa111", "one")]).toBe(before);
    expect(fx.writes).toHaveLength(0);
  });

  it("surfaces an unreadable spec as a warning and keeps completing the rest", () => {
    const fx = (() => {
      const base = (() => {
        const [p111, c111] = spec({
          hash: "aaa111",
          slug: "one",
          title: "One",
          status: "ready",
        });
        const [p222, c222] = spec({
          hash: "aaa222",
          slug: "two",
          title: "Two",
          status: "ready",
        });
        return makeFs({
          "devx.config.yaml": "mode: yolo\n",
          [p111]: c111,
          [p222]: c222,
          "DEV.md": [
            "# DEV",
            "",
            row(" ", "aaa111", "one", "One", "ready", ["Blocked-by: aaa222."]),
            row(" ", "aaa222", "two", "Two", "ready"),
            "",
          ].join("\n"),
        });
      })();
      const inner = base.fs;
      const bad = specRel("dev", "aaa222", "two");
      base.fs = {
        ...inner,
        readFile(p) {
          if (p.endsWith(bad)) throw new Error("EACCES");
          return inner.readFile(p);
        },
      };
      return base;
    })();
    const planned = planBackfill(fx.fs, ROOT, ENGINE_DEFAULTS);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.warnings.join("\n")).toMatch(/aaa222.*unreadable/);
    expect(planned.plan.frontmatter.map((f) => f.hash)).toEqual(["aaa111"]);
  });
});

// ---------------------------------------------------------------------------
// Row splice + frontmatter patch (the two writers, in isolation)
// ---------------------------------------------------------------------------

describe("appendRowBlockers", () => {
  it("splices inside the annotation, before its terminating period", () => {
    const line =
      "- [ ] `dev/dev-aaa111-2026-08-01T08:00-one.md` — One. Blocked-by: aaa222. Status: ready.";
    expect(appendRowBlockers(line, ["aaa333"])).toBe(
      "- [ ] `dev/dev-aaa111-2026-08-01T08:00-one.md` — One. Blocked-by: aaa222, aaa333. Status: ready.",
    );
  });

  it("handles an annotation that runs to end-of-line", () => {
    const line = "- [ ] `dev/dev-aaa111-2026-08-01T08:00-one.md` — One. Blocked-by: aaa222";
    expect(appendRowBlockers(line, ["aaa333", "aaa444"])).toBe(
      "- [ ] `dev/dev-aaa111-2026-08-01T08:00-one.md` — One. Blocked-by: aaa222, aaa333, aaa444",
    );
  });

  it("is a no-op on a row with no annotation, and on an empty addition list", () => {
    const line = "- [ ] `dev/dev-aaa111-2026-08-01T08:00-one.md` — One. Status: ready.";
    expect(appendRowBlockers(line, ["aaa333"])).toBe(line);
    expect(appendRowBlockers(`${line} Blocked-by: aaa222.`, [])).toBe(
      `${line} Blocked-by: aaa222.`,
    );
  });
});

describe("applyEnginePatch blocked_by", () => {
  const base = [
    "---",
    "hash: aaa111",
    "type: dev",
    'title: "One"',
    "status: ready",
    "---",
    "",
    "## Goal",
    "",
    "Body stays put.",
    "",
  ].join("\n");

  it("writes the canonical inline-array form", () => {
    const out = applyEnginePatch(base, { blocked_by: ["aaa222", "aaa333"] });
    expect(out).toContain("blocked_by: [aaa222, aaa333]");
    expect(out).toContain("Body stays put.");
  });

  it("removes the hyphenated spelling of itself", () => {
    const withHyphen = base.replace("status: ready", "status: ready\nblocked-by: [aaa222]");
    const out = applyEnginePatch(withHyphen, { blocked_by: ["aaa222"] });
    expect(out).toContain("blocked_by: [aaa222]");
    expect(out).not.toMatch(/blocked-by:/);
  });

  it("leaves every other key and the body untouched", () => {
    const out = applyEnginePatch(base, { blocked_by: ["aaa222"] });
    expect(out).toContain('title: "One"');
    expect(out).toContain("hash: aaa111");
    expect(out.split("## Goal")[1]).toBe("\n\nBody stays put.\n");
  });
});

// ---------------------------------------------------------------------------
// Seam sanity: the module never writes through anything but its fs seam
// ---------------------------------------------------------------------------

describe("fs seam", () => {
  it("routes every write through the injected fs", () => {
    const fx = makeFs({
      "devx.config.yaml": "mode: yolo\n",
      ...Object.fromEntries([
        spec({ hash: "aaa111", slug: "one", title: "One", status: "ready" }),
        spec({ hash: "aaa222", slug: "two", title: "Two", status: "ready" }),
      ]),
      "DEV.md": [
        "# DEV",
        "",
        row(" ", "aaa111", "one", "One", "ready", ["Blocked-by: aaa222."]),
        row(" ", "aaa222", "two", "Two", "ready"),
        "",
      ].join("\n"),
    });
    const result = run(fx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(fx.writes).toEqual(result.filesWritten);
  });

  it("accepts the EngineFs shape without widening", () => {
    // Compile-time assertion: a full EngineFs must satisfy BackfillFs.
    const widen = (fs: EngineFs): BackfillFs => fs;
    expect(typeof widen).toBe("function");
  });
});
