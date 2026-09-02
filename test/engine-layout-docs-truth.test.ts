// G-4: the two surfaces that describe layout resolution describe what the
// resolver actually does — `docs/CONFIG.md` §15 and the `docs_layout`
// description in `_devx/config-schema.json`.
//
// Companion to `evals/E-8_docs-truth.ts`, which asserts the same invariant as
// a standalone runnable. Both exist on purpose: the eval is the RED-gate
// artifact and carries the expectation, this file is what makes the invariant
// fail `npm test` on the day someone adds an `ArtifactKind` and leaves §15
// where it was. It goes further than the eval in one direction that matters —
// the eval compares COUNTS, this compares the table's actual path cells
// against `artifactRel()`, so a row that exists but lies still fails.
//
// Why these two surfaces and not "the docs": a reader consults them BEFORE
// choosing a layout, and the schema description is what an editor pops up
// over the key itself. A wrong claim there is not cosmetic — it is the
// difference between a discoverable feature and a trap.
//
// It does NOT diff prose. Everything after the em-dash in a row label, and
// every sentence around the table, is the author's. What is pinned is
// structure: one row per kind, the paths in the cells, and the enum.
//
// Spec: dev/dev-dlr107-2026-09-02T09:14-doc-truth.md
// Plan: _devx/workstreams/docs-layout-resolution/plan/agent.md §7

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ALL_ARTIFACT_KINDS,
  ARTIFACT_KINDS,
  DOCS_LAYOUTS,
  STAGE_DIRS,
  artifactRel,
  type ArtifactKind,
  type DocsLayout,
} from "../src/lib/engine/artifacts.js";
import { codeOnly } from "./helpers/code-only.js";

const REPO_ROOT = join(__dirname, "..");
const CONFIG_MD = readFileSync(join(REPO_ROOT, "docs", "CONFIG.md"), "utf8");
const SCHEMA_RAW = readFileSync(
  join(REPO_ROOT, "_devx", "config-schema.json"),
  "utf8",
);

/** Section 15's own heading — the `engine:` yaml sample sits under it. */
const ENGINE_HEADING = "## 15. Engine";

/** §15's subsection heading — the anchor the table is found under. */
const SECTION_HEADING = "### `docs_layout` — the two shapes";

/** The `<root>/<slug>/` prefix §15 spells for the workstream column. It is a
 *  DISPLAY prefix: `artifactRel` returns doc-set-relative paths, and under
 *  `workstream` the doc set is the workstream dir. */
const WS_PREFIX = "<root>/<slug>/";

/** The stage placeholder the three companion rows are written with. */
const STAGE_TOKEN = "<stage>";

interface TableRow {
  /** Raw first cell — label plus whatever prose follows. */
  label: string;
  /** Leading backticked token: the row's `ArtifactKind` identity. */
  token: string;
  /** Second and third cells, backticks stripped. */
  workstream: string;
  projectLevel: string;
}

/** Parse §15's artifact table. Deliberately strict about where it starts (the
 *  section heading, then the `| Artifact |` header) and where it ends (the
 *  first line that is not a table line) — a loose scan would happily pick up
 *  the next table in the file and report a passing row count for the wrong
 *  table.
 *
 *  Structural problems `throw` rather than `expect`, because this runs at
 *  COLLECTION time: an `expect` failure there aborts the module and the
 *  reader gets a vitest internal, not the sentence explaining that §15's
 *  heading moved. `rows()` re-raises it inside whichever `it` asked. */
function parseArtifactTable(): TableRow[] {
  const start = CONFIG_MD.indexOf(SECTION_HEADING);
  if (start < 0) throw new Error(`docs/CONFIG.md has no '${SECTION_HEADING}' heading`);
  const after = CONFIG_MD.slice(start);
  const headerAt = after.indexOf("| Artifact |");
  if (headerAt < 0) throw new Error("§15 has no `| Artifact |` table header");

  const lines = after.slice(headerAt).split("\n");
  const rows: TableRow[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("|")) break; // end of table
    if (/^\|\s*-+/.test(line)) continue; // separator
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells[0] === "Artifact") continue; // header
    if (cells.length !== 3) {
      throw new Error(`§15 row has ${cells.length} cells, expected 3: ${line}`);
    }
    const token = /^`([a-z:-]+)`/.exec(cells[0] as string)?.[1] ?? "";
    rows.push({
      label: cells[0] as string,
      token,
      workstream: unTick(cells[1] as string),
      projectLevel: unTick(cells[2] as string),
    });
  }
  return rows;
}

/** A path cell, normalized for comparison: backticks off, and the trailing
 *  slash a directory row is written with dropped — `artifactRel` returns
 *  `evals`, §15 writes `evals/`, and both are the same statement. */
function unTick(cell: string): string {
  return cell.replace(/`/g, "").trim().replace(/\/$/, "");
}

/** A kind's §15 ROW identity: stage-qualified for the three subjects (three
 *  distinct filenames), stage-generic for the companions (one spelling with
 *  `<stage>` substituted). Re-derived here rather than imported so the test
 *  and `ARTIFACT_KINDS` are two independent statements of the same set —
 *  importing the projection would make the comparison a tautology. */
function rowIdentity(k: ArtifactKind): string {
  return k.kind === "agent" ? `agent:${k.stage}` : k.kind;
}

/** The row a token names, as an `ArtifactKind`.
 *
 *  Guarded against ARTIFACT_KINDS first: an unrecognized token would sail
 *  into `artifactRel`'s switch, fall off the end, and compare against
 *  `"<root>/<slug>/undefined"` — a failure message that describes the symptom
 *  and hides the cause. */
function kindForToken(token: string): ArtifactKind {
  if (!(ARTIFACT_KINDS as readonly string[]).includes(token)) {
    throw new Error(
      `§15 row \`${token}\` names no ArtifactKind — expected one of ${ARTIFACT_KINDS.join(", ")}`,
    );
  }
  const [head, stage] = token.split(":");
  return (stage === undefined ? { kind: head } : { kind: head, stage }) as ArtifactKind;
}

/** §15's `docs_layout` subsection — heading to the next heading.
 *
 *  Scoped rather than searched whole-file: `workstream` and `project-level`
 *  appear all over CONFIG.md, so a document-wide `toContain` would pass on a
 *  §15 that says nothing at all. The claims below are claims THIS section
 *  makes. */
function section(): string {
  const start = CONFIG_MD.indexOf(SECTION_HEADING);
  if (start < 0) throw new Error(`docs/CONFIG.md has no '${SECTION_HEADING}' heading`);
  const body = CONFIG_MD.slice(start + SECTION_HEADING.length);
  const nextHeading = /\n#{2,3} /.exec(body);
  return body.slice(0, nextHeading ? nextHeading.index : undefined);
}

/** All of section 15 — the yaml sample block lives above the `docs_layout`
 *  subsection, in the section that registers every `engine.*` key. */
function engineSection(): string {
  const start = CONFIG_MD.indexOf(ENGINE_HEADING);
  if (start < 0) throw new Error(`docs/CONFIG.md has no '${ENGINE_HEADING}' heading`);
  const body = CONFIG_MD.slice(start + ENGINE_HEADING.length);
  const nextHeading = /\n## /.exec(body);
  return body.slice(0, nextHeading ? nextHeading.index : undefined);
}

/** Parsed once, re-raised inside the test that needs it (see
 *  `parseArtifactTable`). */
let parsed: TableRow[] | Error | null = null;
function rows(): TableRow[] {
  if (parsed === null) {
    try {
      parsed = parseArtifactTable();
    } catch (e) {
      parsed = e instanceof Error ? e : new Error(String(e));
    }
  }
  if (parsed instanceof Error) throw parsed;
  return parsed;
}

describe("docs/CONFIG.md §15 — the artifact table is keyed on ArtifactKind", () => {
  it("ARTIFACT_KINDS is exactly the row projection of ALL_ARTIFACT_KINDS", () => {
    // The chain this closes: add a variant to `ArtifactKind` and
    // `artifactRel`'s exhaustive switch forces it into `ALL_ARTIFACT_KINDS`;
    // this assertion then forces it into `ARTIFACT_KINDS`; the next one
    // forces it into §15. No link is skippable.
    const derived = [...new Set(ALL_ARTIFACT_KINDS.map(rowIdentity))];
    expect([...ARTIFACT_KINDS].sort()).toEqual([...derived].sort());
    expect(new Set(ARTIFACT_KINDS).size, "ARTIFACT_KINDS has a duplicate").toBe(
      ARTIFACT_KINDS.length,
    );
  });

  it("has one row per ArtifactKind, in ARTIFACT_KINDS order", () => {
    expect(rows().map((r) => r.token)).toEqual([...ARTIFACT_KINDS]);
  });

  it("names every row with a leading backticked kind, not free prose", () => {
    for (const row of rows()) {
      expect(row.token, `row does not lead with a kind: ${row.label}`).not.toBe("");
    }
  });

  it("spells the paths the resolver actually produces, in both layouts", () => {
    // The half the eval's count check cannot see: a row can exist and still
    // name a file nothing writes. Every cell is compared to `artifactRel`.
    const companions = new Set<string>(["human", "outline", "outline-critique"]);
    const expected = (layout: DocsLayout, kind: ArtifactKind): string =>
      (layout === "workstream" ? WS_PREFIX : "") + artifactRel(layout, kind);

    for (const row of rows()) {
      const kind = kindForToken(row.token);
      if (!companions.has(kind.kind)) {
        expect(row.workstream, row.token).toBe(expected("workstream", kind));
        expect(row.projectLevel, row.token).toBe(expected("project-level", kind));
        continue;
      }
      // Stage-generic: the row must hold for EVERY stage once `<stage>` is
      // substituted, which is what makes one row honest for four kinds.
      expect(row.workstream, `${row.token} ws cell`).toContain(STAGE_TOKEN);
      expect(row.projectLevel, `${row.token} flat cell`).toContain(STAGE_TOKEN);
      for (const stage of STAGE_DIRS) {
        const staged = { kind: kind.kind, stage } as ArtifactKind;
        const ws = row.workstream.split(STAGE_TOKEN).join(stage);
        const flat = row.projectLevel.split(STAGE_TOKEN).join(stage);
        expect(ws, `${row.token} · ${stage}`).toBe(expected("workstream", staged));
        expect(flat, `${row.token} · ${stage}`).toBe(expected("project-level", staged));
      }
    }
  });

  it("names the two artifacts the pre-dlr107 table omitted entirely", () => {
    // `checkpoints/` and `RESULTS.md` were resolved by code and documented
    // nowhere — the specific gap FR-8 was written against. Pinned by name so
    // a future restructure cannot quietly drop them again.
    for (const token of ["checkpoints-dir", "results"]) {
      expect(rows().map((r) => r.token)).toContain(token);
    }
  });
});

describe("docs/CONFIG.md §15 — claims match the implementation", () => {
  it("names both layouts", () => {
    for (const layout of DOCS_LAYOUTS) {
      expect(section(), `§15 never names '${layout}'`).toContain(`\`${layout}\``);
    }
  });

  it("offers the reader exactly DOCS_LAYOUTS in the config block's own comment", () => {
    // The other enum a reader meets — the `# workstream | project-level`
    // comment beside the key in §15's yaml sample. A third layout that landed
    // in code and not here would leave the sample quietly wrong.
    const line = /^\s*docs_layout:.*?#\s*(.+)$/m.exec(engineSection());
    expect(line, "§15's yaml block has no commented `docs_layout:` line").not.toBeNull();
    const listed = ((line as RegExpExecArray)[1] as string)
      .split("—")[0] // the trailing gloss, not part of the enum
      .split("|")
      .map((v) => v.trim())
      .filter((v) => v !== "");
    expect(listed).toEqual([...DOCS_LAYOUTS]);
  });

  it("claims layout-aware resolution only where code resolves through the layout", () => {
    // Rules 3 and 5 each name a surface. `…Abs(ws.workstreamAbs)` is the
    // layout-BLIND spelling: dlr104 re-signatured the helpers over the
    // RESOLVED base, so its absence is the mechanical proof the claim holds.
    //
    // This is E-8's check, carried into `npm test` on purpose: workstream
    // evals are standalone `npx tsx` scripts and explicitly "never part of
    // `npm test`" (devx.config.yaml → workstream-evals), so without this the
    // claim would be gated by nothing once the RED gate is behind us.
    //
    // The companion half — that `stageSubject` has a production caller at all
    // — is already pinned by `engine-layout-single-reader.test.ts`: an
    // uncalled resolver in artifacts.ts fails there as an orphaned export.
    const BLIND_RE = /\b[a-zA-Z]+Abs\(\s*[A-Za-z0-9_.]*\bworkstreamAbs\b\s*\)/;
    const CLAIMED: ReadonlyArray<{ claim: string; modules: readonly string[] }> = [
      {
        claim: "rule 5 — a gate resolves its subject through the layout",
        modules: [
          "src/commands/gate.ts",
          "src/lib/engine/gate-prd.ts",
          "src/lib/engine/gate-coverage.ts",
          "src/lib/engine/gate-evals.ts",
        ],
      },
      {
        claim: "rule 3 — `devx outline init` resolves this key to decide where a scaffold lands",
        modules: ["src/commands/outline.ts", "src/lib/engine/outline.ts"],
      },
    ];

    for (const surface of CLAIMED) {
      for (const rel of surface.modules) {
        const abs = join(REPO_ROOT, ...rel.split("/"));
        // A renamed module must fail loudly. An allowlist that silently skips
        // what it can no longer find is a check that passes by not looking.
        expect(existsSync(abs), `${rel} is gone — update the allowlist`).toBe(true);
        expect(
          BLIND_RE.test(codeOnly(readFileSync(abs, "utf8"))),
          `false claim — §15 ${surface.claim}, but ${rel} still resolves layout-blind`,
        ).toBe(false);
      }
    }
  });

  it("gets its own arithmetic right, if it states any", () => {
    // §15 explains why 22 identities are 13 rows. Two numbers in prose are two
    // numbers that rot the day a stage is added — the exact silent-drift class
    // this phase exists to close, so they are checked rather than trusted.
    // No claim, no check: the wording stays the author's, the arithmetic does
    // not.
    const identities = /(\d+) representable identities/.exec(section());
    if (identities) expect(Number(identities[1])).toBe(ALL_ARTIFACT_KINDS.length);
    const rendered = /render as (\d+) rows/.exec(section());
    if (rendered) expect(Number(rendered[1])).toBe(ARTIFACT_KINDS.length);
  });

  it("documents how to switch, since rule 4 tells the reader to", () => {
    // §15 raises "wanting a second unit of work is the signal to switch" and
    // used to leave the cost hanging. The command exists (dlr106); the doc
    // that raises the question is where it belongs.
    expect(section()).toContain("devx layout migrate --to");
  });

  it("records RETRO-<date>.md as layout-independent rather than omitting it", () => {
    // It IS a real workstream artifact. Silence would read as an oversight of
    // the same family this phase closes; the table's absence is a decision.
    expect(section()).toContain("RETRO-<date>.md");
  });
});

describe("_devx/config-schema.json — the claim a reader hits via autocomplete", () => {
  const schema = (): Record<string, unknown> =>
    JSON.parse(SCHEMA_RAW) as Record<string, unknown>;

  /** The `docs_layout` property node, wherever it sits in the tree. Throws
   *  rather than asserts for the same reason `parseArtifactTable` does: this
   *  resolves at collection time, and a missing key should read as a sentence
   *  inside a failing test, not as a module that would not load. */
  function layoutNode(): Record<string, unknown> {
    const find = (n: unknown): Record<string, unknown> | null => {
      if (typeof n !== "object" || n === null) return null;
      const o = n as Record<string, unknown>;
      const props = o.properties as Record<string, unknown> | undefined;
      if (props && "docs_layout" in props) {
        return props.docs_layout as Record<string, unknown>;
      }
      for (const v of Object.values(o)) {
        const hit = find(v);
        if (hit) return hit;
      }
      return null;
    };
    const found = find(schema());
    if (found === null) {
      throw new Error("_devx/config-schema.json has no `docs_layout` property");
    }
    return found;
  }

  /** Its description — the string an editor pops up over the key. */
  const description = (): string => String(layoutNode().description ?? "");

  it("enumerates exactly DOCS_LAYOUTS, in order", () => {
    expect(layoutNode().enum).toEqual([...DOCS_LAYOUTS]);
  });

  it("restates §15 rule 5 — the gate claim — rather than paraphrasing it", () => {
    // The two surfaces disagreeing is the failure this phase closes. Rule 5
    // is the load-bearing sentence: it is why a reader may pick either layout
    // without wondering whether gates will behave differently.
    const desc = description();
    expect(desc).toContain(
      "a gate resolves its subject through the layout, so the same `devx gate prd` runs against `prd/agent.md` or `prd.md` and returns the same verdict for the same content",
    );
    expect(desc).toContain("layout is not a gate input");
  });

  it("carries rule 4's 'not enforced today' caveat with the one-doc-set claim", () => {
    // Stating the constraint without the caveat is the trap in miniature: the
    // reader believes devx will stop them, and nothing does (dev-lay101).
    const desc = description();
    expect(desc).toMatch(/ONE in-flight doc set/);
    expect(desc).toMatch(/NOT mechanically enforced today/);
  });

  it("names both layouts and points at the full table", () => {
    const desc = description();
    for (const layout of DOCS_LAYOUTS) expect(desc).toContain(layout);
    expect(desc).toMatch(/docs\/CONFIG\.md/);
  });
});
