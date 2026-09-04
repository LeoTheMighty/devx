// E-8 (P1): the shipped docs describe the implemented behavior (G-4, UC-6,
// CAP-5, FR-8). RED until Phase 7 merges. Runnable standalone: `npx tsx <this file>`.
//
// A reader consults §15 and the schema description BEFORE choosing a layout,
// so a wrong claim there is not cosmetic — it is the difference between a
// discoverable feature and a trap. The test does NOT diff prose. It asserts
// three structural properties, so wording stays free and truth does not.
//
// Which half carries the RED, stated so the report's recorded reason is
// honest: by the time Phase 7 runs, Phases 2 and 4 have made rule 5 true, so
// the claim-check already passes. The 13-row SET-EQUALITY is what fails RED.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { codeOnly, readSrc, repoRoot, srcFiles } from "./_fixture.js";

const failures: string[] = [];
const CONFIG_MD = join(repoRoot, "docs", "CONFIG.md");
const SCHEMA = join(repoRoot, "_devx", "config-schema.json");
const configMd = readFileSync(CONFIG_MD, "utf8");

// ---------------------------------------------------------------------------
// 1. Every ArtifactKind the resolver handles has a §15 row. (RED-bearing.)
// ---------------------------------------------------------------------------

/** The resolver's own enumeration of what it resolves. A runtime export is
 *  preferred — a §15 check cannot set-compare against a type that erases —
 *  but the type declaration is accepted so the shape stays the author's call. */
function artifactKinds(): string[] | null {
  const src = readSrc("src/lib/engine/artifacts.ts");
  const sf = ts.createSourceFile("a.ts", src, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  let kinds: string[] | null = null;
  ts.forEachChild(sf, (n) => {
    // `export const ARTIFACT_KINDS = [...] as const`
    if (ts.isVariableStatement(n)) {
      for (const d of n.declarationList.declarations) {
        if (d.name.getText(sf) !== "ARTIFACT_KINDS" || !d.initializer) continue;
        const lits = [...d.initializer.getText(sf).matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
        if (lits.length > 0) kinds = lits;
      }
    }
    // `export type ArtifactKind = "a" | "b" | …` (or a discriminated union
    // whose `kind:` members are the enumeration).
    if (ts.isTypeAliasDeclaration(n) && n.name.getText(sf) === "ArtifactKind" && kinds === null) {
      const body = n.type.getText(sf);
      const tagged = [...body.matchAll(/kind\s*:\s*["']([^"']+)["']/g)].map((m) => m[1]);
      const bare = [...body.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
      const found = tagged.length > 0 ? tagged : bare;
      if (found.length > 0) kinds = [...new Set(found)];
    }
  });
  return kinds;
}

/** Row labels of the §15 artifact table. */
function sectionTableRows(): string[] {
  const start = configMd.indexOf("### `docs_layout` — the two shapes");
  if (start === -1) return [];
  const rest = configMd.slice(start);
  const end = rest.indexOf("\n\n", rest.indexOf("| Artifact |"));
  const table = rest.slice(rest.indexOf("| Artifact |"), end === -1 ? undefined : rest.indexOf("| Artifact |") + end);
  return table
    .split("\n")
    .filter((l) => l.trim().startsWith("|") && !/^\|\s*-+/.test(l.trim()))
    .slice(1) // header
    .map((l) => l.split("|")[1]?.trim() ?? "")
    .filter((l) => l !== "");
}

const kinds = artifactKinds();
const rows = sectionTableRows();

if (kinds === null) {
  failures.push(
    "src/lib/engine/artifacts.ts exposes no enumeration of ArtifactKind (neither an `ARTIFACT_KINDS` runtime export nor an `ArtifactKind` type alias) — §15 cannot be set-compared against what the resolver actually handles (feature missing, T1.1)",
  );
} else if (rows.length !== kinds.length) {
  failures.push(
    `§15's artifact table has ${rows.length} row(s); the resolver handles ${kinds.length} artifact kind(s). One row per kind, so a future kind cannot land undocumented. Kinds: ${kinds.join(", ")}. Rows: ${rows.join(" / ")}`,
  );
}

// Two rows §15 is missing today regardless of how the union is spelled — the
// PRD called this "gains its two missing rows"; the table also needs splitting.
for (const missing of ["checkpoints", "RESULTS.md"]) {
  if (!rows.some((r) => r.toLowerCase().includes(missing.toLowerCase().replace(".md", "")))) {
    failures.push(`§15's artifact table has no row for \`${missing}\` — the resolver handles it and the table does not name it`);
  }
}

// ---------------------------------------------------------------------------
// 2. No claim of layout-aware resolution that no code implements.
// ---------------------------------------------------------------------------

/** A `<name>Abs(<expr>.workstreamAbs)` call — the layout-BLIND spelling. Once
 *  Phase 4 re-signatures the helpers over the resolved base, this form cannot
 *  be written, so its absence is the mechanical proof rule 5 is true. */
const BLIND_RE = /\b[a-zA-Z]+Abs\(\s*[A-Za-z0-9_.]*\bworkstreamAbs\b\s*\)/;

/** Surfaces §15 rule 5 and the schema description claim resolve by layout. */
const CLAIMED_SURFACES: Array<{ claim: string; modules: string[] }> = [
  {
    claim: "§15 rule 5: a gate resolves its subject through the layout",
    modules: [
      "src/commands/gate.ts",
      "src/lib/engine/gate-prd.ts",
      "src/lib/engine/gate-coverage.ts",
      "src/lib/engine/gate-evals.ts",
    ],
  },
  {
    claim: "§15 rule 3: `devx outline init` resolves this key to decide where a scaffold lands",
    modules: ["src/commands/outline.ts", "src/lib/engine/outline.ts"],
  },
];

for (const s of CLAIMED_SURFACES) {
  const blind = s.modules.filter((m) => existsSync(join(repoRoot, ...m.split("/"))) && BLIND_RE.test(codeOnly(readSrc(m))));
  if (blind.length > 0) {
    failures.push(
      `false claim — ${s.claim}, but ${blind.join(", ")} still resolves layout-blind (\`…Abs(ws.workstreamAbs)\`)`,
    );
  }
}

// A resolver with no production caller is the same lie one layer down.
if (kinds !== null) {
  const usesResolver = srcFiles()
    .filter((f) => f !== "src/lib/engine/artifacts.ts")
    .some((f) => /\bstageSubject\b/.test(codeOnly(readSrc(f))));
  if (!usesResolver) {
    failures.push(
      "the docs describe layout-aware resolution but no module outside artifacts.ts calls `stageSubject()` — the claim has no implementation behind it",
    );
  }
}

// ---------------------------------------------------------------------------
// 3. Both documents' enum matches DOCS_LAYOUTS.
// ---------------------------------------------------------------------------

const artifactsSrc = readSrc("src/lib/engine/artifacts.ts");
const layoutsM = /DOCS_LAYOUTS\s*=\s*\[([^\]]*)\]/.exec(artifactsSrc);
const layouts = layoutsM ? [...layoutsM[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]) : [];
if (layouts.length === 0) {
  failures.push("could not read DOCS_LAYOUTS from artifacts.ts — the enum comparison has no source of truth");
} else {
  const schema = JSON.parse(readFileSync(SCHEMA, "utf8")) as Record<string, unknown>;
  const findDocsLayout = (node: unknown): Record<string, unknown> | null => {
    if (typeof node !== "object" || node === null) return null;
    const o = node as Record<string, unknown>;
    const props = o.properties as Record<string, unknown> | undefined;
    if (props && typeof props === "object" && "docs_layout" in props) {
      return props.docs_layout as Record<string, unknown>;
    }
    for (const v of Object.values(o)) {
      const hit = findDocsLayout(v);
      if (hit) return hit;
    }
    return null;
  };
  const node = findDocsLayout(schema);
  if (node === null) {
    failures.push("_devx/config-schema.json has no `docs_layout` property — the key a reader hits via editor autocomplete is undocumented");
  } else {
    const enumVals = (node.enum as string[] | undefined) ?? [];
    if (JSON.stringify(enumVals) !== JSON.stringify(layouts)) {
      failures.push(
        `schema \`docs_layout.enum\` is ${JSON.stringify(enumVals)} but DOCS_LAYOUTS is ${JSON.stringify(layouts)}`,
      );
    }
    const desc = String(node.description ?? "");
    for (const l of layouts) {
      if (!desc.includes(l) && !configMd.includes(`\`${l}\``)) {
        failures.push(`neither the schema description nor §15 names the layout '${l}'`);
      }
    }
  }
  for (const l of layouts) {
    if (!configMd.includes(l)) failures.push(`docs/CONFIG.md never names the layout '${l}'`);
  }
}

if (!existsSync(join(repoRoot, "test", "engine-layout-docs-truth.test.ts"))) {
  failures.push(
    "test/engine-layout-docs-truth.test.ts missing — the doc-truth invariant is not pinned in `npm test` (feature missing, T7.1)",
  );
}

if (failures.length > 0) {
  console.error("E-8 RED — the shipped docs do not describe the implemented behavior:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("E-8 GREEN — §15 has a row per ArtifactKind, makes no unimplemented claim, and both enums match DOCS_LAYOUTS.");
