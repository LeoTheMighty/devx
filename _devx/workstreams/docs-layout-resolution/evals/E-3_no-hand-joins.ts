// E-3 (P0): no consumer builds a stage-subject path from string parts
// (G-1, G-2, CAP-1, FR-1, FR-5). RED until Phase 4 merges.
// Runnable standalone: `npx tsx <this file>`.
//
// Authored as T4.1 — BEFORE T4.5 closes the hand-joins — so its negative
// control has something to control against. R-6: an author tuning the
// accepted-fragile allowlist against E-3's stale four-site list can allowlist
// a real bypass away and still report 0. The control below therefore does not
// take the count on faith: it asserts the scan flags every known-live bypass
// TODAY, and asserts it does NOT flag the three sites that only look like
// bypasses. If the control ever stops finding a site, the scan has been
// blunted and this eval says so instead of reporting a clean sweep.
//
// A "hand-join" is an expression that COMPOSES A PATH from a base and a
// stage-subject name. Three things are deliberately not that:
//   - `planAbs(join(root, slug))` — the join builds the BASE and hands it to
//     the resolver. That is the shape this workstream steers toward.
//   - `join(repoRoot, TEMPLATES_DIR, …)` — a template SOURCE. Templates are
//     workstream-shaped on disk in BOTH layouts, so routing it through the
//     layout throws `engine template missing`.
//   - `` `${PRD_REL} is missing the ## Goals section` `` — prose that NAMES a
//     subject without building a path. Phase 2 re-homes those onto
//     `subject.rel` as message text; they are not FR-5's bypasses, and a scan
//     that swept them in would report ~40 sites and drown the five real ones.
// The discriminator is adjacency: inside a template, a subject token counts
// only when a `/` sits directly against it on one side — the one syntactic
// mark that separates composing a path from mentioning a name.

import { existsSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { ScanDesync, codeOnly, readSrc, repoRoot, srcFiles } from "./_fixture.js";

const failures: string[] = [];
const RESOLVER = "src/lib/engine/artifacts.ts";

/** Stage-subject names. Layout-DEPENDENT spellings only: `EVALS_DIR_REL` and
 *  `CHECKPOINTS_DIR_REL` are identical in both shapes and stay joinable. */
const SUBJECT_IDENTS = [
  "PRD_REL",
  "DESIGN_REL",
  "PLAN_REL",
  "EXPECTATIONS_REL",
  "TODO_REL",
  "TODO_FILENAME",
  "RED_REPORT_REL",
  "DECISIONS_DIR_REL",
  "RESULTS_REL",
];
const SUBJECT_LITERALS = [
  "prd/agent.md",
  "design/agent.md",
  "plan/agent.md",
  "expectations.md",
  "todo.md",
  "RESULTS.md",
  "evals/RED-report.md",
  // project-level spellings — a bypass written in the new shape is still a bypass
  "prd.md",
  "design.md",
  "plan.md",
];
/** Presence of this marks a template-SOURCE path, which must stay literal. */
const TEMPLATE_SOURCE_MARKER = "TEMPLATES_DIR";

interface Hit {
  file: string;
  line: number;
  start: number;
  end: number;
  text: string;
}

function scanFile(rel: string): Hit[] {
  let code: string;
  try {
    code = codeOnly(readSrc(rel));
  } catch (e) {
    throw new Error(
      `INFRA — the source scanner failed on ${rel}: ${e instanceof ScanDesync ? e.message : String(e)}. Fix the scanner before reading any verdict from this eval.`,
    );
  }
  // Parse the ORIGINAL (comments/strings intact) so node positions are real,
  // but decide on the BLANKED text so a doc comment quoting `prd/agent.md`
  // is not mistaken for code that builds it.
  const src = readSrc(rel);
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const hits: Hit[] = [];

  const identRe = new RegExp(`\\b(?:${SUBJECT_IDENTS.join("|")})\\b`);
  const litAlt = SUBJECT_LITERALS.map((l) => l.replace(/[.]/g, "\\.")).join("|");

  /** True when a subject name in a template is COMPOSING a path — a `/` abuts
   *  it. Interpolations are collapsed to a single marker first, so
   *  `.../${artifacts.EXPECTATIONS_REL}` reads as `/<S>` and the member-access
   *  prefix cannot hide the separator from a naive character window. */
  const composesPath = (span: string): boolean => {
    const collapsed = span.replace(/\$\{[^{}]*\}/g, (m) =>
      identRe.test(m) ? "\u0000S\u0000" : "\u0000X\u0000",
    );
    if (/\/\u0000S\u0000|\u0000S\u0000\//.test(collapsed)) return true;
    // Bare literal segments — `${base}/RESULTS.md` carries no quotes at all.
    return new RegExp(`(?:/(?:${litAlt})|(?:${litAlt})/)`).test(collapsed);
  };

  const record = (node: ts.Node): void => {
    const span = src.slice(node.getStart(sf), node.end);
    const blanked = code.slice(node.getStart(sf), node.end);
    if (blanked.includes(TEMPLATE_SOURCE_MARKER)) return;
    const namesSubject =
      SUBJECT_IDENTS.some((id) => new RegExp(`\\b${id}\\b`).test(blanked)) ||
      // In a template a subject filename appears BARE, with no quotes at all
      // (`${base}/RESULTS.md`), so the quoted form alone would miss it.
      SUBJECT_LITERALS.some(
        (l) =>
          span.includes(`"${l}"`) ||
          span.includes(`'${l}'`) ||
          (ts.isTemplateExpression(node) && span.includes(l)),
      );
    if (!namesSubject) return;
    // A join()'s arguments ARE path segments — adjacency is implicit there.
    // Inside a template it has to be shown.
    if (ts.isTemplateExpression(node) && !composesPath(span)) return;
    hits.push({
      file: rel,
      line: src.slice(0, node.getStart(sf)).split("\n").length,
      start: node.getStart(sf),
      end: node.end,
      text: span.replace(/\s+/g, " ").slice(0, 140),
    });
  };

  const walk = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sf);
      if (/(^|\.)(join|resolve)$/.test(callee)) {
        // A base plus a subject name. A call whose every argument is a literal
        // is building a fixed relative path, not joining onto a base.
        const hasBase = node.arguments.some((a) => !ts.isStringLiteralLike(a));
        if (hasBase) {
          record(node);
          return;
        }
      }
    }
    if (ts.isTemplateExpression(node)) {
      record(node);
      // Fall through: an inner join() still deserves its own hit.
    }
    ts.forEachChild(node, walk);
  };
  ts.forEachChild(sf, walk);
  // An outer template that merely CONTAINS the offending one is the same
  // site reported twice (`outcome.ts` wraps its RESULTS.md join in a
  // JSON.stringify template). Keep the innermost — that is the line to fix.
  return hits.filter(
    (h) => !hits.some((o) => o !== h && o.start >= h.start && o.end <= h.end),
  );
}

const consumers = srcFiles().filter((f) => f !== RESOLVER);
const hits: Hit[] = [];
for (const rel of consumers) hits.push(...scanFile(rel));

// ---------------------------------------------------------------------------
// Negative control (R-6). Runs FIRST: a blunted scan must not be allowed to
// report a clean sweep.
// ---------------------------------------------------------------------------

/** Bypasses live in the tree right now. Each must be flagged TODAY. Once
 *  Phase 4 closes them the control flips to `closed` and stops demanding a
 *  hit — but a site that vanishes from the scan while its code is unchanged
 *  is a blunted scan, and that is what this catches. */
const MUST_FLAG = [
  { file: "src/lib/engine/todo-truth.ts", what: "join(workstreamAbs, TODO_FILENAME)" },
  { file: "src/commands/todo.ts", what: "join(ws.workstreamAbs, TODO_FILENAME)" },
  { file: "src/lib/devx/mark-done.ts", what: "join(repoRoot, workstreamRel, TODO_FILENAME)" },
  { file: "src/lib/plan/validate-emit.ts", what: "`${wsRoot}/${epicSlug}/${PLAN_REL}`" },
  { file: "src/commands/outcome.ts", what: "`${ws.workstreamRel}/RESULTS.md`" },
];

/** Sites that only LOOK like bypasses. Flagging one means the scan has become
 *  a liability — closing it would break the template lookup or re-route a
 *  base-join that already feeds the resolver correctly. */
const MUST_NOT_FLAG = [
  {
    file: "src/lib/graph/backfill.ts",
    match: /planAbs\(join\(|todoAbs\(join\(/,
    why: "a workstream-BASE join feeding the resolver, not a subject built by hand",
  },
  {
    file: "src/commands/todo.ts",
    match: /TEMPLATES_DIR/,
    why: "shipped-template SOURCE — templates are workstream-shaped on disk in BOTH layouts",
  },
  {
    file: "src/lib/engine/workstream.ts",
    match: /TEMPLATES_DIR/,
    why: "shipped-template SOURCE — resolving it through the layout throws `engine template missing`",
  },
];

const controlFailures: string[] = [];
for (const site of MUST_FLAG) {
  const stillLive = hits.some((h) => h.file === site.file);
  const codeGone = !existsSync(join(repoRoot, ...site.file.split("/")));
  if (!stillLive && !codeGone) {
    // Either Phase 4 closed it (fine) or the scan stopped seeing it (not).
    const body = codeOnly(readSrc(site.file));
    const identsStillThere = SUBJECT_IDENTS.some((id) =>
      new RegExp(`\\b${id}\\b`).test(body),
    ) || SUBJECT_LITERALS.some((lit) => readSrc(site.file).includes(lit));
    if (identsStillThere) {
      controlFailures.push(
        `negative control: ${site.file} still mentions a stage-subject name but the scan flags nothing there — expected to catch ${site.what}. The scan has been blunted, not the code fixed (R-6).`,
      );
    }
  }
}
for (const site of MUST_NOT_FLAG) {
  const wrong = hits.filter((h) => h.file === site.file && site.match.test(h.text));
  for (const w of wrong) {
    controlFailures.push(
      `negative control: ${site.file}:${w.line} was flagged but is NOT a bypass — ${site.why}. Closing it would break the build.`,
    );
  }
}
failures.push(...controlFailures);

// ---------------------------------------------------------------------------
// The invariant itself: zero, globally. Not "zero against a known list".
// ---------------------------------------------------------------------------

for (const h of hits) {
  failures.push(`${h.file}:${h.line} builds a stage-subject path from string parts: ${h.text}`);
}

if (!existsSync(join(repoRoot, "test", "engine-layout-no-hand-joins.test.ts"))) {
  failures.push(
    "test/engine-layout-no-hand-joins.test.ts missing — the no-hand-joins invariant is not pinned in `npm test` (feature missing, T4.1)",
  );
}

if (failures.length > 0) {
  console.error(
    `E-3 RED — ${hits.length} site(s) still build a stage-subject path outside ${RESOLVER}:`,
  );
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  "E-3 GREEN — 0 hand-joined stage-subject paths outside the resolver; the negative control still discriminates.",
);
