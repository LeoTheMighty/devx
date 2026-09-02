// G-2, the second half: `src/lib/engine/artifacts.ts` exports no callable
// without a production caller — and exactly one function in `src/` reads the
// layout key.
//
// Companion to `evals/E-2_single-reader.ts`, which asserts the same two
// invariants as a standalone runnable. Both exist on purpose: the eval is the
// RED-gate artifact and carries the expectation, this file is what makes the
// invariant fail `npm test` on the day someone re-exports a resolver.
//
// Why the orphan half is an invariant at all: an exported resolver nobody
// calls is not dead code, it is a bypass with no caller YET. `artifactAbs`,
// the six stage-shaped `*_REL` constants and the ten-helper `*Abs` family all
// took an arbitrary rel or spelled a layout by hand; each was one import away
// from re-opening the two-families-of-helpers split this workstream closed.
// The rule that keeps it closed is not "don't do that" — it is that the
// module offers nothing to do it with.
//
// The scan reads CODE, not prose: comments and string bodies are blanked
// first, so the many message strings and doc comments naming
// `engine.docs_layout` are invisible to it.
//
// Spec: dev/dev-dlr105-2026-09-02T09:14-identity-rekey-privatization.md
// Plan: _devx/workstreams/docs-layout-resolution/plan/agent.md §5

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

const REPO_ROOT = join(__dirname, "..");
const SRC_ROOT = join(REPO_ROOT, "src");
const ARTIFACTS_REL = "src/lib/engine/artifacts.ts";

/** A READ of the key, not a write and not a type. `docs_layout:` in an object
 *  literal or an interface member is excluded by requiring the access form. */
const READ_RE = /(?:\?\.|\.)docs_layout\b/;

/** The indexed spellings — `section["docs_layout"]`, and the LEGACY
 *  `section["docs.layout"]` the bank-era key is read through.
 *
 *  It needs its own pass over comment-stripped-but-strings-INTACT source,
 *  because `codeOnly()` blanks string bodies: after it runs,
 *  `section["docs.layout"]` reads `section["           "]` and no regex can
 *  see it. Testing this form against the code-only text is a branch that can
 *  never match — a control that always passes, which is worse than no
 *  control. Prose cannot false-positive here: a comment would have to carry
 *  the brackets and quotes literally. */
const INDEXED_READ_RE = /\[\s*["'](?:docs_layout|docs\.layout)["']\s*\]/;

/** Comments blanked, string bodies KEPT — the companion text to `codeOnly`. */
function commentsOnlyStripped(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, p1: string) => p1 + " ".repeat(m.length - p1.length));
}

/** Exported CALLABLES. Constants and types are not resolvers — they cannot
 *  compose a path on their own, which is the thing being forbidden. */
const EXPORTED_CALLABLE_RE =
  /^export\s+(?:function\s+([A-Za-z0-9_]+)|const\s+([A-Za-z0-9_]+)\s*(?::[^=]*)?=\s*\()/gm;

/** Blank every string/template/regex body and every comment, keeping offsets,
 *  so the scan sees code and not the prose that names the same things.
 *  Parsed with TypeScript's own parser: two hand-rolled versions of this in
 *  earlier evals silently mangled devx's own source, and a scanner that
 *  quietly blanks a file reports zero findings and a false GREEN. */
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

/** Every .ts under a root. A symlinked directory reports as a symlink rather
 *  than a directory, so it is stat'd explicitly — a scan that silently skips
 *  part of the tree reports zero findings and a false pass. */
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

const SRC_FILES = tsFiles(SRC_ROOT).map((f) =>
  relative(REPO_ROOT, f).split(sep).join("/"),
);
/** Comment- and string-blanked source, read once. */
const CODE = new Map(
  SRC_FILES.map((rel) => [rel, codeOnly(readFileSync(join(REPO_ROOT, rel), "utf8"))]),
);
/** The same files with strings intact — only the indexed pass reads these. */
const WITH_STRINGS = new Map(
  SRC_FILES.map((rel) => [
    rel,
    commentsOnlyStripped(readFileSync(join(REPO_ROOT, rel), "utf8")),
  ]),
);

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

function layoutReaders(): string[] {
  const found: string[] = [];
  for (const [rel, code] of CODE) {
    const lines = code.split("\n");
    const stringy = (WITH_STRINGS.get(rel) ?? "").split("\n");
    lines.forEach((line, i) => {
      if (READ_RE.test(line) || INDEXED_READ_RE.test(stringy[i] ?? "")) {
        found.push(`${rel}:${i + 1} (${enclosingFn(lines, i)})`);
      }
    });
  }
  return found;
}

function exportedCallables(src: string): string[] {
  return [...src.matchAll(EXPORTED_CALLABLE_RE)].map((m) => (m[1] ?? m[2]) as string);
}

/** Names with no `\bname\b` occurrence in any consumer's CODE. */
function orphansOf(names: readonly string[], consumers: readonly string[]): string[] {
  return names.filter(
    (n) => !consumers.some((f) => new RegExp(`\\b${n}\\b`).test(CODE.get(f) ?? "")),
  );
}

describe("G-2 — one layout reader", () => {
  it("exactly one line in src/ reads the layout key, in resolveDocsLayout", () => {
    // Asserted on the LINE list, not on distinct function names: a second
    // reader added inside `resolveDocsLayout` itself — the "second predicate
    // re-reading the config" this forbids — would collapse into one name and
    // still count as 1.
    const readers = layoutReaders();
    expect(readers, readers.join(", ")).toEqual([
      expect.stringContaining(`${ARTIFACTS_REL}:`),
    ]);
    expect(readers[0]).toContain("(resolveDocsLayout)");
  });

  it("the scan is honest — it sees every spelling of a read, and no prose", () => {
    // Negative controls. Without these a scanner blind to a spelling, or one
    // that blanks everything, reports zero readers and a false pass.
    const sees = (src: string): boolean =>
      READ_RE.test(codeOnly(src)) || INDEXED_READ_RE.test(commentsOnlyStripped(src));
    expect(sees("const x = merged.engine.docs_layout;\n")).toBe(true);
    expect(sees("const x = merged.engine?.docs_layout;\n")).toBe(true);
    // The indexed pair is why the strings-intact companion text exists: run
    // against `codeOnly` output both branches are permanently dead, and a
    // second legacy reader would be undetectable.
    expect(sees('const x = section["docs_layout"];\n')).toBe(true);
    expect(sees('const x = section["docs.layout"];\n')).toBe(true);
    expect(sees("const x = section[LEGACY_LAYOUT_KEY];\n")).toBe(false); // const, not literal
    // Prose and emitted config are not reads.
    expect(sees("// resolve engine.docs_layout from the merged blob\n")).toBe(false);
    expect(sees('const msg = "engine.docs_layout is unset";\n')).toBe(false);
    expect(sees("const cfg = { engine: { docs_layout: chosen } };\n")).toBe(false);
  });
});

describe("G-2 — no orphaned resolver in artifacts.ts", () => {
  const exported = exportedCallables(readFileSync(join(REPO_ROOT, ARTIFACTS_REL), "utf8"));
  const consumers = SRC_FILES.filter((f) => f !== ARTIFACTS_REL);

  it("found the exported callables (the scan isn't reading an empty file)", () => {
    // Without this, a regex that stopped matching would report zero exports,
    // therefore zero orphans, therefore a pass — the exact false GREEN the
    // invariant exists to prevent.
    expect(exported.length).toBeGreaterThanOrEqual(6);
    expect(exported).toContain("stageSubject");
    expect(exported).toContain("artifactRel");
  });

  it("every exported callable has a caller elsewhere in src/", () => {
    const orphans = orphansOf(exported, consumers);
    expect(
      orphans,
      `${orphans.join(", ")} — delete them, or give them a caller. An exported ` +
        "resolver with no caller is a bypass waiting for its first one (E-2).",
    ).toEqual([]);
  });

  it("the orphan detector actually detects one", () => {
    // A name no file in src/ mentions must come back as an orphan; a name
    // every file mentions must not. Without this the assertion above passes
    // for a detector that always returns [].
    expect(orphansOf(["zzNoSuchResolverExists"], consumers)).toEqual([
      "zzNoSuchResolverExists",
    ]);
    expect(orphansOf(["stageSubject"], consumers)).toEqual([]);
  });

  it("the private spellings are private — the map is the only way in", () => {
    // Named individually rather than inferred, because these are the exact
    // handles a future caller would reach for. `EVALS_DIR_REL` stays public
    // on purpose: it is layout-identical, and `gate-evals.ts` reads it.
    const src = readFileSync(join(REPO_ROOT, ARTIFACTS_REL), "utf8");
    for (const name of [
      "PRD_REL",
      "DESIGN_REL",
      "PLAN_REL",
      "EXPECTATIONS_REL",
      "TODO_REL",
      "RED_REPORT_REL",
      "artifactAbs",
    ]) {
      expect(
        new RegExp(`^export\\s+(?:const|function)\\s+${name}\\b`, "m").test(src),
        `${name} is exported again — a consumer can hand-build a stage-subject path`,
      ).toBe(false);
      // Still DEFINED here: a name that vanished would make the assertion
      // above pass for the wrong reason.
      expect(
        new RegExp(`^(?:const|function)\\s+${name}\\b`, "m").test(src),
        `${name} no longer exists — this guard is now vacuous`,
      ).toBe(true);
    }
    // The two that STAY public, named for the same reason the private list
    // is: they are layout-identical, and `gate-evals.ts` reads the former.
    expect(/^export const EVALS_DIR_REL\b/m.test(src)).toBe(true);
    expect(/^export const CHECKPOINTS_DIR_REL\b/m.test(src)).toBe(true);
  });
});
