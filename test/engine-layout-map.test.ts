// engine/artifacts — the artifact map and the single layout reader (dlr101,
// workstream docs-layout-resolution phase 1).
//
// Three claims are pinned here, and they are the foundation every later phase
// consumes:
//
//   1. `stageSubject()` returns the canonical path for all 13 artifact-kind
//      rows under BOTH layouts — tested AT `evals` specifically, because
//      nothing in the repo exercises that row today and an untested asymmetry
//      is how the evals directory/file split gets branched around.
//   2. `pathToArtifactKind()` is the same table read backwards, and accepts
//      BOTH layouts' spellings (a `--touched design.md` typed against a
//      folder-layout repo must still resolve).
//   3. Exactly ONE function in `src/` RESOLVES a repo's layout from
//      `engine.docs_layout` or the legacy `personalization["docs.layout"]`
//      key (G-2). Write sites are allowlisted by name, never by spelling.
//
// The 13-row reference is the DESIGN's table (design/agent.md §"The artifact
// map"), not docs/CONFIG.md §15 — §15 still carries its 12-row pre-restructure
// shape (no design/plan human digests, no RESULTS.md, checkpoints/, or
// RED-report.md rows). Adding them is FR-8, phase 7, so §15 could not have
// been matched here; when it is, the two must agree.
//
// Plan: _devx/workstreams/docs-layout-resolution/plan/agent.md §"1. Phase".

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import ts from "typescript";

import {
  ALL_ARTIFACT_KINDS,
  DEFAULT_DOCS_LAYOUT,
  DOCS_LAYOUTS,
  STAGE_DIRS,
  SUBJECT_STAGES,
  buildArtifactKindIndex,
  docsLayoutFrom,
  pathToArtifactKind,
  resolveDocsLayout,
  stageSubject,
  type ArtifactKind,
  type DocsLayout,
} from "../src/lib/engine/artifacts.js";
import { ENGINE_DEFAULTS, engineConfigFrom } from "../src/lib/engine/config.js";

const REPO = join(sep, "tmp", "repo");
const WS_REL = "_devx/workstreams/scene-engine";
const BASE = { repoRoot: REPO, workstreamRel: WS_REL };
const FLAT = { repoRoot: REPO, workstreamRel: "." };

/** design §"The artifact map" — 13 rows, both layouts. */
const ROWS: ReadonlyArray<{ kind: ArtifactKind; ws: string; flat: string }> = [
  { kind: { kind: "agent", stage: "prd" }, ws: "prd/agent.md", flat: "prd.md" },
  { kind: { kind: "agent", stage: "design" }, ws: "design/agent.md", flat: "design.md" },
  { kind: { kind: "agent", stage: "plan" }, ws: "plan/agent.md", flat: "plan.md" },
  { kind: { kind: "human", stage: "prd" }, ws: "prd/human.md", flat: "prd-human.md" },
  { kind: { kind: "outline", stage: "prd" }, ws: "prd/outline.md", flat: "prd-outline.md" },
  {
    kind: { kind: "outline-critique", stage: "prd" },
    ws: "prd/outline-critique.md",
    flat: "prd-outline-critique.md",
  },
  { kind: { kind: "expectations" }, ws: "expectations.md", flat: "expectations.md" },
  { kind: { kind: "todo" }, ws: "todo.md", flat: "todo.md" },
  { kind: { kind: "results" }, ws: "RESULTS.md", flat: "RESULTS.md" },
  { kind: { kind: "evals-dir" }, ws: "evals", flat: "evals" },
  { kind: { kind: "decisions-dir" }, ws: "decisions", flat: "decisions" },
  { kind: { kind: "checkpoints-dir" }, ws: "checkpoints", flat: "checkpoints" },
  { kind: { kind: "red-report" }, ws: "evals/RED-report.md", flat: "evals/RED-report.md" },
];

const abs = (rel: string): string => join(REPO, ...rel.split("/"));

describe("stageSubject — the §15 table, both layouts", () => {
  it("covers every artifact-kind row the table names", () => {
    expect(ROWS).toHaveLength(13);
  });

  for (const row of ROWS) {
    const name = "stage" in row.kind ? `${row.kind.kind} · ${row.kind.stage}` : row.kind.kind;

    it(`resolves ${name} under workstream`, () => {
      const s = stageSubject("workstream", BASE, row.kind);
      expect(s.rel).toBe(posix.join(WS_REL, row.ws));
      expect(s.abs).toBe(abs(posix.join(WS_REL, row.ws)));
    });

    it(`resolves ${name} under project-level`, () => {
      const s = stageSubject("project-level", FLAT, row.kind);
      expect(s.rel).toBe(row.flat);
      expect(s.abs).toBe(abs(row.flat));
    });
  }

  // AC 2 — both forms are returned because both are needed at the same call
  // sites: gate refusals print `rel`, reads use `abs`. Deriving one from the
  // other at the call site is how two spellings drift.
  it("returns rel AND abs, and abs is rel joined onto repoRoot", () => {
    for (const layout of DOCS_LAYOUTS) {
      const base = layout === "workstream" ? BASE : FLAT;
      for (const row of ROWS) {
        const s = stageSubject(layout, base, row.kind);
        expect(typeof s.rel).toBe("string");
        expect(s.abs).toBe(join(REPO, ...s.rel.split("/")));
        expect(s.rel.startsWith("./")).toBe(false);
      }
    }
  });

  // The `./` case is reachable from config: `engineConfigFrom` strips TRAILING
  // slashes from `engine.workstreams_root` but not a leading `./`, so a repo
  // setting `./_devx/workstreams` produces exactly this base. Asserting
  // no-`./` only against the already-clean fixtures is a vacuous assertion.
  it("normalizes a messy base to ONE spelling of rel", () => {
    const cases = [
      "./_devx/workstreams/scene-engine",
      "_devx//workstreams//scene-engine",
      "_devx/workstreams/scene-engine/",
      "_devx/workstreams/other/../scene-engine",
      "  _devx/workstreams/scene-engine  ",
    ];
    for (const workstreamRel of cases) {
      const s = stageSubject("workstream", { repoRoot: REPO, workstreamRel }, {
        kind: "agent",
        stage: "prd",
      });
      expect(s.rel, workstreamRel).toBe(`${WS_REL}/prd/agent.md`);
      expect(s.abs, workstreamRel).toBe(abs(`${WS_REL}/prd/agent.md`));
    }
  });

  it("treats every spelling of `here` as the flat base", () => {
    for (const workstreamRel of [".", "./", "", "  .  "]) {
      expect(
        stageSubject("project-level", { repoRoot: REPO, workstreamRel }, { kind: "todo" }).rel,
        JSON.stringify(workstreamRel),
      ).toBe("todo.md");
    }
  });
});

describe("the reverse index's collision guard can actually fire", () => {
  // The live table has no collision, so without a negative control the guard
  // is a branch nobody has ever executed. Two identities that spell the same
  // path must THROW, not silently keep the first — a reverse lookup returning
  // the wrong stage hands `devx revise` a real file that is the wrong one.
  it("throws when two DIFFERENT identities claim one spelling", () => {
    // Two identities that differ only in `stage` — the dangerous collision,
    // and the one a discriminant-only comparison would wave through.
    const collide = () =>
      buildArtifactKindIndex(
        [
          { kind: "human", stage: "prd" },
          { kind: "human", stage: "design" },
        ] as ArtifactKind[],
        () => "same.md",
      );
    expect(collide).toThrow(/claimed by both/);
    expect(collide).toThrow(/human:prd/);
    expect(collide).toThrow(/human:design/);
  });

  it("is idempotent for the SAME identity seen twice", () => {
    // Both layouts spelling one path (every singleton does) must not throw —
    // otherwise the guard fires on the live table at module load.
    expect(() =>
      buildArtifactKindIndex(
        [{ kind: "todo" }, { kind: "todo" }] as ArtifactKind[],
        () => "todo.md",
      ),
    ).not.toThrow();
  });

  it("compares FULL identity, not just the discriminant", () => {
    // `human · prd` and `human · design` share a discriminant and differ in
    // stage. A guard comparing `kind.kind` alone would call them equal and
    // silently drop the second — which is the collision that matters.
    expect(() => buildArtifactKindIndex(ALL_ARTIFACT_KINDS)).not.toThrow();
    const idx = buildArtifactKindIndex(ALL_ARTIFACT_KINDS);
    expect(idx.get("prd-human.md")).toEqual({ kind: "human", stage: "prd" });
    expect(idx.get("design-human.md")).toEqual({ kind: "human", stage: "design" });
  });

  it("hands out frozen kinds, so a consumer cannot poison the table", () => {
    const k = pathToArtifactKind("prd/agent.md");
    expect(k).toEqual({ kind: "agent", stage: "prd" });
    expect(Object.isFrozen(k)).toBe(true);
    expect(pathToArtifactKind("prd/agent.md")).toEqual({ kind: "agent", stage: "prd" });
  });
});

// The evals asymmetry is the sharp edge, and nothing in the repo exercises it
// today — so it is tested AT `evals`, not only at `prd`.
describe("stageSubject — the evals stage", () => {
  it("names the DIRECTORY for the evals subject, under both layouts", () => {
    expect(stageSubject("workstream", BASE, { kind: "evals-dir" }).rel).toBe(
      `${WS_REL}/evals`,
    );
    expect(stageSubject("project-level", FLAT, { kind: "evals-dir" }).rel).toBe("evals");
  });

  it("still resolves the evals stage's companions as FILES", () => {
    expect(stageSubject("project-level", FLAT, { kind: "outline", stage: "evals" }).rel).toBe(
      "evals-outline.md",
    );
    expect(stageSubject("project-level", FLAT, { kind: "human", stage: "evals" }).rel).toBe(
      "evals-human.md",
    );
    expect(
      stageSubject("project-level", FLAT, { kind: "outline-critique", stage: "evals" }).rel,
    ).toBe("evals-outline-critique.md");
    expect(stageSubject("workstream", BASE, { kind: "outline", stage: "evals" }).rel).toBe(
      `${WS_REL}/evals/outline.md`,
    );
  });

  it("resolves every stage-parametrized companion for every StageDir", () => {
    const basenames = {
      human: "human.md",
      outline: "outline.md",
      "outline-critique": "outline-critique.md",
    } as const;
    for (const stage of STAGE_DIRS) {
      for (const kind of ["human", "outline", "outline-critique"] as const) {
        expect(stageSubject("workstream", BASE, { kind, stage }).rel).toBe(
          `${WS_REL}/${stage}/${basenames[kind]}`,
        );
        expect(stageSubject("project-level", FLAT, { kind, stage }).rel).toBe(
          `${stage}-${basenames[kind]}`,
        );
      }
    }
  });
});

describe("pathToArtifactKind — the same table, read backwards", () => {
  it("round-trips every row in the layout that spells it", () => {
    for (const row of ROWS) {
      expect(pathToArtifactKind(row.ws), row.ws).toEqual(row.kind);
      expect(pathToArtifactKind(row.flat), row.flat).toEqual(row.kind);
    }
  });

  // ROWS covers the §15 table (one stage per companion). The MAP is built
  // over the full SUBJECT_STAGES × STAGE_DIRS product, so driving the reverse
  // test off ROWS leaves ~17 of its 37 keys unexercised — every `design-*`,
  // `plan-*`, and all six `evals` companions, in both spellings. Drive it off
  // the same product the map is built from.
  it("round-trips EVERY representable identity, in both layouts", () => {
    expect(ALL_ARTIFACT_KINDS.length).toBe(3 + STAGE_DIRS.length * 3 + 7);
    for (const kind of ALL_ARTIFACT_KINDS) {
      for (const layout of DOCS_LAYOUTS) {
        const base = layout === "workstream" ? BASE : FLAT;
        // The doc-set-relative spelling — what the reverse map is keyed on.
        const docSetRel = stageSubject(layout, FLAT, kind).rel;
        expect(pathToArtifactKind(docSetRel), `${layout} ${docSetRel}`).toEqual(kind);
        // ...and the repo-relative one is NOT its inverse under workstream.
        void base;
      }
    }
  });

  // The contract that is easy to assume and wrong: `stageSubject` returns a
  // REPO-relative rel, `pathToArtifactKind` keys on a DOC-SET-relative one.
  // They coincide under project-level and diverge under workstream. A phase-2
  // caller feeding a `.rel` straight back in gets null, so pin it here rather
  // than let it surface as a wrong refusal.
  it("is NOT the inverse of stageSubject's repo-relative rel under workstream", () => {
    const rel = stageSubject("workstream", BASE, { kind: "agent", stage: "prd" }).rel;
    expect(rel).toBe(`${WS_REL}/prd/agent.md`);
    expect(pathToArtifactKind(rel)).toBeNull();
    // Under project-level the doc set IS the repo root, so they do coincide.
    const flat = stageSubject("project-level", FLAT, { kind: "agent", stage: "prd" }).rel;
    expect(pathToArtifactKind(flat)).toEqual({ kind: "agent", stage: "prd" });
  });

  it("normalizes the spellings a human actually types", () => {
    for (const p of [
      "./design.md",
      ".//design.md",
      "././design.md",
      "design.md/",
      "  design.md  ",
      "prd/../design.md",
    ]) {
      expect(pathToArtifactKind(p), p).toEqual({ kind: "agent", stage: "design" });
    }
    // Windows separators, and case — the table's only uppercase basenames are
    // RESULTS.md and evals/RED-report.md, and this backs `--touched`.
    expect(pathToArtifactKind("design\\agent.md")).toEqual({ kind: "agent", stage: "design" });
    expect(pathToArtifactKind("results.md")).toEqual({ kind: "results" });
    expect(pathToArtifactKind("RESULTS.md")).toEqual({ kind: "results" });
    expect(pathToArtifactKind("evals/red-report.md")).toEqual({ kind: "red-report" });
    expect(pathToArtifactKind("Prd.md")).toEqual({ kind: "agent", stage: "prd" });
  });

  it("accepts the OTHER layout's spelling — a flat-era shorthand still resolves", () => {
    // `--touched design.md` typed against a folder-layout repo (revise.ts's
    // pre-migration shorthand) and `--touched design/agent.md` typed against a
    // flat repo must both name the same identity.
    expect(pathToArtifactKind("design.md")).toEqual({ kind: "agent", stage: "design" });
    expect(pathToArtifactKind("design/agent.md")).toEqual({ kind: "agent", stage: "design" });
    expect(pathToArtifactKind("plan-outline.md")).toEqual({ kind: "outline", stage: "plan" });
  });

  it("returns null for a path the map does not own", () => {
    for (const p of ["", "README.md", "src/lib/engine/artifacts.ts", "prd", "evals/E-1.ts"]) {
      expect(pathToArtifactKind(p), p).toBeNull();
    }
  });

  it("never resolves the evals stage to an agent document", () => {
    // `{ kind: "agent", stage: "evals" }` is unrepresentable; `evals` is the
    // directory and nothing else.
    expect(pathToArtifactKind("evals")).toEqual({ kind: "evals-dir" });
  });
});

describe("resolveDocsLayout — the ONE reader, and where it read from", () => {
  it("reports engine.docs_layout as source `engine`", () => {
    expect(resolveDocsLayout({ engine: { docs_layout: "project-level" } })).toEqual({
      layout: "project-level",
      source: "engine",
    });
    // trimmed, not rejected
    expect(resolveDocsLayout({ engine: { docs_layout: " project-level " } })).toEqual({
      layout: "project-level",
      source: "engine",
    });
  });

  it("reports the legacy bank key as source `legacy`", () => {
    expect(resolveDocsLayout({ personalization: { "docs.layout": "project-level" } })).toEqual({
      layout: "project-level",
      source: "legacy",
    });
  });

  it("reports an unanswered layout as source `default`", () => {
    expect(resolveDocsLayout({})).toEqual({
      layout: DEFAULT_DOCS_LAYOUT,
      source: "default",
    });
  });

  it("prefers engine.docs_layout over the legacy key", () => {
    expect(
      resolveDocsLayout({
        engine: { docs_layout: "workstream" },
        personalization: { "docs.layout": "project-level" },
      }),
    ).toEqual({ layout: "workstream", source: "engine" });
  });

  it("falls through to the legacy key when engine's value is MALFORMED", () => {
    // The precedence corner: `engine.docs_layout` only WINS when it resolves.
    // A typo there must not shadow a legacy answer that is still valid.
    expect(
      resolveDocsLayout({
        engine: { docs_layout: "flat" },
        personalization: { "docs.layout": "project-level" },
      }),
    ).toEqual({ layout: "project-level", source: "legacy" });
  });

  it("is defensive: a malformed value yields the shipped default and does not throw", () => {
    for (const merged of [
      undefined,
      null,
      "nonsense",
      7,
      true,
      [],
      ["project-level"],
      { engine: null },
      { engine: "flat" },
      { engine: [] },
      // An `engine:` that parsed as a YAML list, carrying props. `typeof` says
      // "object", so without an Array.isArray check this would resolve while
      // every other engine knob's guard rejects the same blob.
      Object.assign([], { engine: { docs_layout: "project-level" } }),
      { engine: Object.assign(["x"], { docs_layout: "project-level" }) },
      { engine: { docs_layout: "flat" } },
      { engine: { docs_layout: 7 } },
      { engine: { docs_layout: "" } },
      { engine: { docs_layout: "   " } },
      { engine: { docs_layout: true } },
      { engine: { docs_layout: ["project-level"] } },
      { engine: {}, personalization: { "docs.layout": "sideways" } },
      { personalization: ["docs.layout"] },
    ]) {
      expect(() => resolveDocsLayout(merged)).not.toThrow();
      expect(resolveDocsLayout(merged), JSON.stringify(merged ?? null)).toEqual({
        layout: DEFAULT_DOCS_LAYOUT,
        source: "default",
      });
    }
  });

  it("docsLayoutFrom is a thin wrapper that reads nothing itself", () => {
    for (const merged of [
      { engine: { docs_layout: "project-level" } },
      { personalization: { "docs.layout": "project-level" } },
      {},
      null,
    ]) {
      expect(docsLayoutFrom(merged)).toBe(resolveDocsLayout(merged).layout);
    }
  });
});

describe("EngineConfig carries the layout, resolved ABOVE both guards", () => {
  it("ships docsLayout + layoutSource on the defaults", () => {
    expect(ENGINE_DEFAULTS.docsLayout).toBe(DEFAULT_DOCS_LAYOUT);
    expect(ENGINE_DEFAULTS.layoutSource).toBe("default");
  });

  it("reads engine.docs_layout", () => {
    const cfg = engineConfigFrom({ engine: { docs_layout: "project-level" } });
    expect(cfg.docsLayout).toBe("project-level");
    expect(cfg.layoutSource).toBe("engine");
  });

  // The ordering that is easy to get backwards: a repo that answered ONLY the
  // legacy bank key has no `engine:` block at all, so the second guard fires
  // and the layout is lost if the assignment sits below it.
  it("survives a config with NO engine block but the legacy key set", () => {
    const cfg = engineConfigFrom({ personalization: { "docs.layout": "project-level" } });
    expect(cfg.docsLayout).toBe("project-level");
    expect(cfg.layoutSource).toBe("legacy");
    // The rest still falls back to defaults — the guard still guards.
    expect(cfg.workstreamsRoot).toBe(ENGINE_DEFAULTS.workstreamsRoot);
  });

  it("survives a non-object merged blob", () => {
    for (const merged of [undefined, null, "nonsense", [], 7]) {
      const cfg = engineConfigFrom(merged);
      expect(cfg.docsLayout).toBe(DEFAULT_DOCS_LAYOUT);
      expect(cfg.layoutSource).toBe("default");
    }
  });

  it("a malformed layout value yields the shipped default and does not throw", () => {
    const cfg = engineConfigFrom({
      engine: { docs_layout: "flat", workstreams_root: "streams" },
    });
    expect(cfg.docsLayout).toBe(DEFAULT_DOCS_LAYOUT);
    expect(cfg.layoutSource).toBe("default");
    expect(cfg.workstreamsRoot).toBe("streams");
  });
});

// ---------------------------------------------------------------------------
// G-2: exactly ONE function reads the layout key.
// ---------------------------------------------------------------------------
//
// The metric is one FUNCTION, not one file: re-expressing a caller against a
// second exported predicate beside `resolveDocsLayout()` would leave the count
// at two — the same drift bug wearing a new name.

const SRC_ROOT = join(__dirname, "..", "src");

/** A READ of the key — property access, indexed access, OR a destructuring
 *  binding. The binding form is included deliberately: this scan's whole job
 *  is to count readers, and a regex that cannot see `const { docs_layout } =
 *  …` can be satisfied by respelling a read rather than removing it. That is
 *  the "fix the code, not the eval" rule inverted, and it is exactly what an
 *  earlier draft of this phase did.
 *
 *  Object-literal WRITES and interface members are excluded by anchoring the
 *  binding form on a declaration keyword and a following `=`: `const { … } =`
 *  is a read, while `engine: { docs_layout: docsLayout }` — an emitted config
 *  — is not. Anchoring is what separates them; matching the braces alone
 *  flags every write site in `init-questions.ts`.
 *
 *  Known limit, stated rather than discovered later: a destructuring pattern
 *  split across lines escapes the line-at-a-time scan. The allowlist below is
 *  the backstop for anything the heuristic mis-sorts — by name, in the open. */
const LAYOUT_READ_RE =
  /(?:\?\.|\.)docs_layout\b|\b(?:const|let|var)\s*\{[^{}]*\bdocs_layout\b[^{}]*\}\s*=/;

/** The indexed-access spelling — `section["docs_layout"]`, and the LEGACY
 *  `section["docs.layout"]`, which is how the bank-era key is read.
 *
 *  It gets its own pass over comment-stripped-but-strings-INTACT source,
 *  because `codeOnly()` blanks string bodies: after it runs,
 *  `section["docs.layout"]` reads `section["           "]` and no regex on
 *  earth can see it. Scanning the code-only text for this form is a branch
 *  that can never match — a control that always passes, which is worse than
 *  no control. Prose cannot false-positive here: a comment or message would
 *  have to contain the brackets and quotes literally. */
const LAYOUT_INDEX_READ_RE = /\[\s*["'](?:docs_layout|docs\.layout)["']\s*\]/;

/** Comments blanked, string bodies KEPT — the companion text to `codeOnly`. */
function commentsOnlyStripped(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, p1: string) => p1 + " ".repeat(m.length - p1.length));
}

/** Sites that name the key but do NOT resolve a repo's layout, allowlisted by
 *  `file#function` with the reason — never by being invisible to the regex.
 *
 *  G-2 counts layout RESOLVERS: functions that answer "what shape is this
 *  repo's artifact tree?" from a merged config blob. `renderInitConfig` asks
 *  no such question — it renders the answer `devx init`'s own interview
 *  already produced into a brand-new config file, from an in-process
 *  `InitConfig`, never from a merged blob. Listing it here is a claim a
 *  reviewer can check; a regex that happens not to match it is not. */
const SANCTIONED_NON_RESOLVERS = new Map<string, string>([
  ["src/lib/init-write.ts#renderInitConfig", "write path — renders init's own answer"],
]);

/** Every .ts/.tsx under a root. `withFileTypes` reports a symlinked directory
 *  as a symlink rather than a directory, so it is stat'd explicitly — a scan
 *  that silently skips part of the tree reports zero readers and a false
 *  GREEN, which is the one failure mode a scan must not have. */
function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    const isDir = e.isDirectory() || (e.isSymbolicLink() && statSync(p).isDirectory());
    if (isDir) out.push(...tsFiles(p));
    else if (/\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts")) out.push(p);
  }
  return out.sort();
}

/** Blank every string/template/regex body and every comment, keeping offsets,
 *  so the scan sees code and not the prose that names the key. */
function codeOnly(src: string): string {
  const sf = ts.createSourceFile("scan.ts", src, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const buf = src.split("");
  const blank = (from: number, to: number): void => {
    for (let i = from; i < to && i < buf.length; i++) if (buf[i] !== "\n") buf[i] = " ";
  };
  const walk = (n: ts.Node): void => {
    switch (n.kind) {
      case ts.SyntaxKind.StringLiteral:
      case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      case ts.SyntaxKind.RegularExpressionLiteral:
        blank(n.getStart(sf) + 1, n.end - 1);
        return;
      case ts.SyntaxKind.TemplateHead:
      case ts.SyntaxKind.TemplateMiddle:
        blank(n.getStart(sf) + 1, n.end - 2);
        return;
      case ts.SyntaxKind.TemplateTail:
        blank(n.getStart(sf) + 1, n.end - 1);
        return;
      default:
        ts.forEachChild(n, walk);
    }
  };
  ts.forEachChild(sf, walk);
  return buf
    .join("")
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
}

/** Nearest preceding column-0 declaration — the function G-2 counts. A nested
 *  arrow helper is not it, and matching one misattributes the finding. */
function enclosingFn(lines: string[], idx: number): string {
  for (let i = idx; i >= 0; i--) {
    const m =
      /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/.exec(lines[i]) ??
      /^(?:export\s+)?const\s+([A-Za-z0-9_]+)\s*[:=].*(?:=>|function)/.exec(lines[i]);
    if (m) return m[1];
  }
  return "<module scope>";
}

interface Reader {
  site: string;
  line: string;
}

function scanLayoutReaders(): Reader[] {
  const readers: Reader[] = [];
  for (const file of tsFiles(SRC_ROOT)) {
    const src = readFileSync(file, "utf8");
    const lines = codeOnly(src).split("\n");
    const withStrings = commentsOnlyStripped(src).split("\n");
    const rel = relative(join(__dirname, ".."), file).split(sep).join("/");
    lines.forEach((line, i) => {
      const isRead =
        LAYOUT_READ_RE.test(line) || LAYOUT_INDEX_READ_RE.test(withStrings[i] ?? "");
      if (isRead) {
        readers.push({ site: `${rel}#${enclosingFn(lines, i)}`, line: `${rel}:${i + 1}` });
      }
    });
  }
  return readers;
}

describe("G-2 — exactly one function reads the layout key", () => {
  it("finds a single resolver across src/, and it is resolveDocsLayout", () => {
    const all = scanLayoutReaders();
    const resolvers = all.filter((r) => !SANCTIONED_NON_RESOLVERS.has(r.site));
    const where = all.map((r) => `${r.line} (${r.site})`).join(", ");

    // Assert on the LINE list, not just the distinct names. Deduping by
    // function name alone is a false-pass generator: a second reader added
    // beside `resolveDocsLayout` — precisely the "second predicate re-reading
    // the config" this invariant exists to forbid — collapses into the same
    // name and the count still reads 1.
    expect(resolvers.map((r) => r.line), where).toHaveLength(1);
    expect(resolvers[0]?.site).toBe("src/lib/engine/artifacts.ts#resolveDocsLayout");
  });

  it("every allowlisted non-resolver still exists — a stale entry is a hole", () => {
    // An allowlist nobody prunes silently re-opens the invariant the day the
    // named function is renamed or deleted.
    const sites = new Set(scanLayoutReaders().map((r) => r.site));
    for (const [site, reason] of SANCTIONED_NON_RESOLVERS) {
      expect(sites.has(site), `${site} (${reason}) is allowlisted but no longer reads the key`)
        .toBe(true);
    }
  });

  it("the scan is honest — it sees every spelling of a read, and no prose", () => {
    // Negative controls. Without these a scanner that blanks everything, or
    // one blind to a spelling, reports zero readers and a false GREEN.
    const sees = (src: string): boolean =>
      LAYOUT_READ_RE.test(codeOnly(src)) ||
      LAYOUT_INDEX_READ_RE.test(commentsOnlyStripped(src));

    // property access, optional chaining, indexed, and the LEGACY spelling —
    // the last has no live site in src/ under this exact form, so without a
    // control its branch is untested and a second legacy reader would be
    // undetectable. (This control is what caught `codeOnly` blanking string
    // bodies, which had made both indexed branches permanently dead.)
    expect(sees("const x = merged.engine.docs_layout;\n")).toBe(true);
    expect(sees("const x = merged.engine?.docs_layout;\n")).toBe(true);
    expect(sees('const x = section["docs_layout"];\n')).toBe(true);
    expect(sees('const x = section["docs.layout"];\n')).toBe(true);
    expect(sees("const x = section[LEGACY_LAYOUT_KEY];\n")).toBe(false); // const, not literal
    // destructuring — the form an earlier draft of this phase used to make
    // the count read 1 without removing the read.
    expect(sees("const { docs_layout } = merged.engine ?? {};\n")).toBe(true);
    expect(sees("const { docs_layout: layout } = merged.engine ?? {};\n")).toBe(true);

    // ...and prose, comments, and object-literal WRITES are not reads.
    expect(sees('const s = "engine.docs_layout is unset";\n')).toBe(false);
    expect(sees("// engine.docs_layout is the home\n")).toBe(false);
    expect(sees("const out = { docs_layout: resolved.layout };\n")).toBe(false);
  });
});

// The duplicate hand-written `DocsLayout` at init-questions.ts:58 is a parallel
// TYPE that can drift the same way the readers could. It is now an import.
describe("no duplicate DocsLayout type", () => {
  it("init-questions re-exports the resolver's type rather than restating it", () => {
    const src = readFileSync(join(SRC_ROOT, "lib", "init-questions.ts"), "utf8");
    expect(src).not.toMatch(/type\s+DocsLayout\s*=\s*["']workstream["']/);
    expect(src).toMatch(/from\s+["']\.\/engine\/artifacts\.js["']/);
  });
});

// Type-level: `{ kind: "agent", stage: "evals" }` must not compile.
describe("the evals agent document is unrepresentable", () => {
  // NOTE: this control is enforced by `npm run typecheck`, NOT by vitest —
  // vitest strips types without checking them, so a green run of this file
  // alone proves nothing about the claim. It works in both directions under
  // tsc: widening the type makes the directive an unused-`@ts-expect-error`
  // error, so the control cannot rot into a no-op.
  it("SubjectStage excludes evals", () => {
    // @ts-expect-error — evals has no agent document; its subject is the dir.
    const bad: ArtifactKind = { kind: "agent", stage: "evals" };
    expect(bad).toBeTruthy();
  });

  it("SUBJECT_STAGES is DERIVED from STAGE_DIRS, not restated beside it", () => {
    // A hand-written parallel list is the exact drift this phase removed for
    // `DocsLayout`: add a stage to STAGE_DIRS and it would silently get
    // companions, no agent row, and no reverse-map entry, with nothing red.
    expect([...SUBJECT_STAGES, "evals"]).toEqual([...STAGE_DIRS]);
    expect(SUBJECT_STAGES).not.toContain("evals");
  });

  it("DocsLayout is the union the map ships", () => {
    const layouts: DocsLayout[] = [...DOCS_LAYOUTS];
    expect(layouts).toEqual(["workstream", "project-level"]);
  });
});
