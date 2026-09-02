// E-2 (P0): exactly one function reads the layout key, and artifacts.ts
// exports no resolver without a production caller (G-2, CAP-1, FR-2).
// RED until Phase 5 merges. Runnable standalone: `npx tsx <this file>`.
//
// Verified in Phase 5, not Phase 1 (R-9): Phase 1 is additive, so the orphan
// half is structurally unsatisfiable there — the map only gains callers once
// Phase 4's sweep lands. Asserting it earlier would write a RED that the
// phase it names cannot turn green.
//
// The scan reads CODE, not prose: comments are stripped first, so the many
// message strings and doc comments naming `engine.docs_layout` are invisible
// to it. What counts is a property read — `.docs_layout`, `["docs_layout"]`,
// or the legacy `["docs.layout"]` index.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { ScanDesync, codeOnly, readSrc, repoRoot, srcFiles } from "./_fixture.js";

const failures: string[] = [];

// A READ of the key, not a write and not a type. `docs_layout:` in an object
// literal or an interface member is excluded by requiring the access form.
const READ_RE =
  /(?:\?\.|\.)docs_layout\b|\[\s*["']docs_layout["']\s*\]|\[\s*["']docs\.layout["']\s*\]/;

/** Nearest preceding function-ish declaration — the "one function" G-2 counts. */
function enclosingFn(lines: string[], idx: number): string {
  for (let i = idx; i >= 0; i--) {
    // Column 0 only: a nested arrow helper (`const set = …`) is not the
    // function G-2 counts, and matching one misattributes the finding.
    const m =
      /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/.exec(lines[i]) ??
      /^(?:export\s+)?const\s+([A-Za-z0-9_]+)\s*[:=].*(?:=>|function)/.exec(lines[i]);
    if (m) return m[1];
  }
  return "<module scope>";
}

interface Reader {
  file: string;
  line: number;
  fn: string;
  text: string;
}

/** codeOnly, with a desync surfaced as INFRA rather than swallowed — a
 *  scanner that quietly blanks a file reports 0 findings and GREEN. */
function scan(rel: string): string {
  try {
    return codeOnly(readSrc(rel));
  } catch (e) {
    if (e instanceof ScanDesync) {
      throw new Error(`INFRA — the source scanner desynced on ${rel}: ${e.message}. Fix the scanner before reading any verdict from this eval.`);
    }
    throw e;
  }
}

const readers: Reader[] = [];
for (const rel of srcFiles()) {
  const lines = scan(rel).split("\n");
  lines.forEach((line, i) => {
    if (READ_RE.test(line)) {
      readers.push({ file: rel, line: i + 1, fn: enclosingFn(lines, i), text: line.trim() });
    }
  });
}

const distinctFns = new Set(readers.map((r) => `${r.file}#${r.fn}`));
if (distinctFns.size !== 1) {
  failures.push(
    `${distinctFns.size} functions read the layout key; G-2 requires exactly 1. Found: ` +
      readers.map((r) => `${r.file}:${r.line} (${r.fn})`).join(", "),
  );
}

// ---------------------------------------------------------------------------
// Orphaned exports in the resolver module.
// ---------------------------------------------------------------------------

const ARTIFACTS_REL = "src/lib/engine/artifacts.ts";
const artifactsSrc = readSrc(ARTIFACTS_REL);

// Exported callables only — constants and types are not "resolvers".
const exported: string[] = [];
for (const m of artifactsSrc.matchAll(
  /^export\s+(?:function\s+([A-Za-z0-9_]+)|const\s+([A-Za-z0-9_]+)\s*(?::[^=]*)?=\s*\()/gm,
)) {
  exported.push((m[1] ?? m[2]) as string);
}

const consumers = srcFiles().filter((f) => f !== ARTIFACTS_REL);
const orphans: string[] = [];
for (const name of exported) {
  const used = consumers.some((f) =>
    new RegExp(`\\b${name}\\b`).test(scan(f)),
  );
  if (!used) orphans.push(name);
}

if (orphans.length > 0) {
  failures.push(
    `${orphans.length} exported resolver(s) in ${ARTIFACTS_REL} have no production caller — delete them or give them one: ${orphans.join(", ")}`,
  );
}

if (!existsSync(join(repoRoot, "test", "engine-layout-single-reader.test.ts"))) {
  failures.push(
    "test/engine-layout-single-reader.test.ts missing — the single-reader + zero-orphan invariant is not pinned in `npm test` (feature missing, T5.1)",
  );
}

if (failures.length > 0) {
  console.error("E-2 RED — the layout key still has more than one reader:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  "E-2 GREEN — exactly one function reads the layout key; artifacts.ts exports no orphaned resolver.",
);
