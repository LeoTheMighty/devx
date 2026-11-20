// `devx render lint` — the measurable half of docs/RENDER-STYLE.md
// (harness-s4; gap analysis rows B9 / C16 / D6 / E3).
//
// A stage's human digest is held to a style bar: the fewest words that carry
// what the design IS, every fact stated once and pointed at from elsewhere.
// RENDER-STYLE.md is the contract; this module measures the rules a program
// can measure, so the stage self-checks before anyone reads the page and two
// runs on one input give one answer.
//
// Pure, line-based, dependency-free: the caller supplies the text. Two
// severities:
//
//   HARD      the render is not done while one stands (rule 9 of /devx-plan
//             fixes every HARD before the stage's gate runs). The CLI exits 1.
//   advisory  the author fixes what they can; nothing blocks on it.
//
// Ported from 8am-harness's design_human_lint.py (rules R1–R6, R9, R10, R13),
// re-shaped for devx's renders in three ways:
//   - the budget unit is a `##` section — devx renders put each mechanism at
//     `##` (a `## Design` container, upstream's shape, budgets its `###`s);
//   - dropped: the 3-space bullet-nesting rule and the anchor-character rule
//     (both exist for a wiki renderer devx does not publish to), and the
//     status-code / size-limit "contract detail" rule (web-service specific);
//   - HTML comments are stripped first — devx templates carry guidance in
//     them, and GitHub does not render them.
//
// Gates never call this: a stage's human digest is not a gate input
// (test/outline-isolation.test.ts pins that firewall).

import { fenceLang, fencedLineMask } from "./md-fence.js";

// ---------------------------------------------------------------------------
// Budgets — docs/RENDER-STYLE.md §Budgets mirrors these; keep them in step.
// ---------------------------------------------------------------------------

export const RENDER_BUDGETS = {
  /** Whole-render prose words: advisory above, HARD above the hard stop. */
  totalProseWords: 4000,
  totalProseWordsHard: 5000,
  overviewWords: 200,
  /** Each budgeted section, children included. */
  sectionWords: 350,
  paragraphWords: 80,
  /** A bullet's own text; nested children excluded. */
  bulletWords: 40,
  tableCellWords: 20,
  tableCellWordsHard: 40,
  /** The Decision log's decision cell — links only, one line. */
  decisionLogRowWords: 20,
  footnotesPer100Words: 2.5,
  /** WHY-sentences / sentences in one section (≥ 6 sentences). */
  rationaleRatio: 0.25,
  /** A number+unit fact stated in this many sections is restated. */
  repeatSections: 3,
  /** Words in a phrase two sections may not both carry. */
  sharedNgram: 8,
} as const;

export type LintSeverity = "HARD" | "advisory";

export interface LintFinding {
  rule: string;
  severity: LintSeverity;
  /** Section title the finding sits in, or `(document)`. */
  section: string;
  /** 1-based line; 0 when the finding is about a whole section/document. */
  line: number;
  message: string;
}

export interface LintMetrics {
  totalWords: number;
  proseWords: number;
  overviewWords: number;
  sections: Record<string, number>;
  sectionsOverBudget: Array<[string, number]>;
  longestParagraph: { words: number; section: string; line: number };
  paragraphsOver: number;
  bulletsOver: number;
  tableCellsOver: number;
  tableCellsHard: number;
  footnotes: number;
  footnoteTargets: number;
  footnoteNumberingOk: boolean;
  footnotesPer100Words: number;
  backrefs: number;
  backrefTargetsMarked: number;
  duplicatePhrases: number;
  restatedFacts: number;
  mermaidBlocks: number;
  codeBlocks: number;
  hardFindings: number;
  advisoryFindings: number;
  /** Present when the caller supplied the stage's agent.md. */
  agentWords?: number;
  ratioToAgent?: number | null;
}

export interface LintReport {
  findings: LintFinding[];
  metrics: LintMetrics;
}

// ---------------------------------------------------------------------------
// Section vocabulary (keys are lowercased, inline markup stripped).
// ---------------------------------------------------------------------------

/** Not prose a reader reads linearly — excluded from budgets and duplicates. */
const BOILERPLATE = new Set(["reading guide", "table of contents", "decision log", "glossary"]);
/** One-line stances by design — excluded from duplicate and WHY checks. */
const STANCE = new Set([
  "trade-offs",
  "discarded considerations",
  "what we're not doing",
  "decision log",
  "out of scope",
  "non-goals",
]);
/** Sections whose bullets are negative by nature — the "No X" rule skips them. */
const NEGATIVE_OK = new Set([
  ...STANCE,
  "constraints",
  "assumptions",
  "risks",
  "security considerations",
  "open questions",
  "unresolved design questions",
]);
/** Sections that legitimately describe today's state on the way to the new one. */
const HISTORY_OK = new Set(["migration plan"]);
const OVERVIEW = "overview";
const DECISION_LOG = "decision log";
/** An h2 that only groups mechanisms — its `###` children are the budget units. */
const CONTAINER_H2 = new Set(["design"]);

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

/** CommonMark ATX heading; a closing `#` run counts only after a space, so
 *  `## C#` keeps its `#`. */
const HEADING_RE = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const HR_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const BULLET_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const FOOTNOTE_RE = /<sup>\[(\d+)\]\(#([^)\s]+)\)<\/sup>/g;
const BACKREF_RE = /<sup>((?:\[\d+\])+)<\/sup>/g;
const MD_FOOTNOTE_RE = /\[\^[^\]]+\]/g;
const LINK_RE = /\[([^\]]*)\]\([^)]*\)/g;
const INLINE_MD_RE = /[`*_~]+/g;
const HTML_TAG_RE = /<[^>]+>/g;
/** A word carries a letter or digit — `|`, `—`, `→`, `·` are not words. */
const WORD_RE = /\S*[\p{L}\p{N}]\S*/gu;
const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+(?=[A-Z`*(\[])/;

/** Engine apparatus a human page never carries: stable IDs, §-citations,
 *  gate numbers. A reader a week later cannot resolve `G-2` without opening
 *  the agent artifact — write the thing it names instead. */
const APPARATUS_RE = /\b(?:E|G|FR|UC|CAP)-\d+\b|§\s?\d+(?:\.\d+)*|\bGate [1-4]\b|\bRED gate\b/g;
const RATIONALE_RE =
  /\b(?:because|so that|which is why|the reason|rather than|instead of|would have|is what makes|this is why|the point is|is exactly what|precisely|not just|not merely)\b/i;
const NON_CHANGE_RE = /^\s*(?:No|Not|Never|There (?:is|are) no)\b/;
const HISTORY_RE =
  /\b(?:the old\b|previously|originally|earlier draft|an earlier|used to\b|superseded|reversed|the document previously)/;
const CUTOVER_RE = /\b(?:dropped|drops|retired|retires|removed|removes|sunset|decommissioned)\b/;
const META_PROSE_RE =
  /\b(?:worth (?:stating|noting|calling out)|stated here rather than|called out so that|it is worth|note that|to be clear|importantly|for the avoidance of doubt|spelled out because|precisely because|is load-bearing)\b/i;
const FACT_RE =
  /\b\d+(?:[.,]\d+)?\s?(?:KB|MB|GB|days?|hours?|hrs?|minutes?|min|seconds?|ms|%|k|M|B|x)\b|\bp\d\d\s*[≤<=]+\s*\d+\s?(?:s|ms|min)?\b/gi;
/** A table column that restates what another section owns. Whole-cell: a
 *  risk table's "Why it matters" is its impact column, not a rationale copy
 *  (the first real-repo run flagged exactly that). */
const DUP_COLUMN_RE = /^\**(failure(?: modes?)?|failures|why|rationale|reasons?)\**$/i;
const PAREN_RE = /\(([^()]{2,80})\)/g;
const SEE_RE = /\b(?:see|under|in|per)\s+(?:the\s+)?([A-Z][\w&'/ -]{2,40})/g;

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

function stripInline(text: string): string {
  return text
    .replace(FOOTNOTE_RE, "")
    .replace(BACKREF_RE, "")
    .replace(HTML_TAG_RE, "")
    .replace(LINK_RE, "$1")
    .replace(INLINE_MD_RE, "");
}

export function countWords(text: string): number {
  return stripInline(text).match(WORD_RE)?.length ?? 0;
}

/** GitHub's heading anchor: rendered text, lowercased, punctuation dropped,
 *  each space a hyphen (so `A & B` → `a--b`). */
export function githubSlug(title: string): string {
  return stripInline(title)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\s-]/gu, "")
    .replace(/ /g, "-");
}

const keyOf = (title: string): string => stripInline(title).trim().toLowerCase();

/** GitHub's anchor minting over a document's headings in order: a repeated
 *  slug gets `-1`, `-2`, …. One instance per document pass — the lint and
 *  `renumberFootnotes` must agree on which `notes` is `notes-1`. */
function makeSlugger(): (title: string) => string {
  const seen = new Map<string, number>();
  return (title) => {
    const base = githubSlug(title);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  };
}

/** Index of the first `<!--` that is NOT inside an inline code span, or -1.
 *  A render that writes `` `<!--` `` is quoting the syntax; treating it as an
 *  opener would blank every line after it and lint nothing — silently. */
function commentStart(s: string): number {
  for (let at = s.indexOf("<!--"); at !== -1; at = s.indexOf("<!--", at + 1)) {
    const ticks = s.slice(0, at).match(/`/g)?.length ?? 0;
    if (ticks % 2 === 0) return at;
  }
  return -1;
}

/** Blank out `<!-- … -->` spans (multi-line too) outside fenced code, keeping
 *  line numbers. GitHub never renders them, and devx templates use them for
 *  author guidance that must not count against the reader's budget. */
function stripHtmlComments(lines: string[], fenced: boolean[]): string[] {
  let inComment = false;
  return lines.map((line, i) => {
    if (fenced[i]) return line;
    let out = "";
    let rest = line;
    for (;;) {
      if (inComment) {
        const end = rest.indexOf("-->");
        if (end === -1) return out;
        rest = rest.slice(end + 3);
        inComment = false;
      } else {
        const start = commentStart(rest);
        if (start === -1) return out + rest;
        out += rest.slice(0, start);
        rest = rest.slice(start + 4);
        inComment = true;
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

interface Section {
  level: number;
  title: string;
  key: string;
  /** 0-based line of the heading. */
  start: number;
  /** [0-based line, text] body lines, fenced code removed. */
  lines: Array<[number, string]>;
  parent: Section | null;
}

function h2Of(s: Section): Section {
  let x = s;
  while (x.parent !== null && x.level > 2) x = x.parent;
  return x;
}

function ancestry(s: Section): Section[] {
  const out: Section[] = [];
  for (let x: Section | null = s; x !== null; x = x.parent) out.push(x);
  return out;
}

const isBoilerplate = (s: Section): boolean => ancestry(s).some((a) => BOILERPLATE.has(a.key));
const isStance = (s: Section): boolean => STANCE.has(s.key);
const sectionKey = (s: Section): string => (s.level >= 3 ? `${h2Of(s).title} › ${s.title}` : s.title);

interface Parsed {
  sections: Section[];
  fences: Array<{ lang: string }>;
}

function parseSections(md: string): Parsed {
  const raw = md.split("\n").map((l) => l.replace(/\r$/, ""));
  const fenced = fencedLineMask(raw);
  const lines = stripHtmlComments(raw, fenced);
  const sections: Section[] = [];
  const fences: Array<{ lang: string }> = [];
  const stack: Section[] = [];
  let current: Section | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (fenced[i]) {
      if (i === 0 || !fenced[i - 1]) fences.push({ lang: fenceLang(raw[i]) });
      continue;
    }
    const text = lines[i];
    const m = HEADING_RE.exec(text);
    if (m) {
      const level = m[1].length;
      if (level === 1) continue; // the page title — not body
      while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
      current = {
        level,
        title: m[2],
        key: keyOf(m[2]),
        start: i,
        lines: [],
        parent: stack.length > 0 ? stack[stack.length - 1] : null,
      };
      stack.push(current);
      sections.push(current);
      continue;
    }
    if (current === null) continue; // preamble before the first `##`
    current.lines.push([i, text]);
  }
  return { sections, fences };
}

type BlockKind = "para" | "bullet" | "table" | "quote";

function blocksOf(lines: Array<[number, string]>): Array<[BlockKind, Array<[number, string]>]> {
  const blocks: Array<[BlockKind, Array<[number, string]>]> = [];
  let buf: Array<[number, string]> = [];
  let kind: BlockKind | null = null;
  const flush = (): void => {
    if (kind !== null && buf.length > 0) blocks.push([kind, buf]);
    buf = [];
    kind = null;
  };
  const start = (k: BlockKind): void => {
    if (kind !== k) {
      flush();
      kind = k;
    }
  };
  for (const [no, text] of lines) {
    if (text.trim() === "" || HR_RE.test(text)) {
      flush();
      continue;
    }
    if (TABLE_ROW_RE.test(text)) start("table");
    else if (text.trimStart().startsWith(">")) start("quote");
    else if (BULLET_RE.test(text)) start("bullet");
    else if (kind === "bullet" && /^[ \t]/.test(text)) {
      /* continuation of a bullet */
    } else start("para");
    buf.push([no, text]);
  }
  flush();
  return blocks;
}

/** A bullet block's items: [line, indent, own text]. */
function bulletItems(block: Array<[number, string]>): Array<[number, number, string]> {
  const items: Array<[number, number, string]> = [];
  for (const [no, text] of block) {
    const m = BULLET_RE.exec(text);
    if (m) {
      items.push([no, m[1].replace(/\t/g, "    ").length, m[2]]);
      continue;
    }
    const indent = text.length - text.trimStart().length;
    for (let k = items.length - 1; k >= 0; k--) {
      if (indent > items[k][1]) {
        items[k][2] += ` ${text.trim()}`;
        break;
      }
    }
  }
  return items;
}

function tableCells(block: Array<[number, string]>): Array<[number, string]> {
  const cells: Array<[number, string]> = [];
  for (const [no, text] of block) {
    if (TABLE_SEP_RE.test(text)) continue;
    const row = text.trim().replace(/^\|/, "").replace(/\|$/, "");
    for (const cell of row.split(/(?<!\\)\|/)) cells.push([no, cell.trim()]);
  }
  return cells;
}

const sentencesOf = (text: string): string[] =>
  stripInline(text)
    .trim()
    .split(SENTENCE_SPLIT_RE)
    .filter((s) => countWords(s) >= 4);

const tokensOf = (text: string): string[] => stripInline(text).toLowerCase().match(/[a-z0-9]+/g) ?? [];

// ---------------------------------------------------------------------------
// Lint
// ---------------------------------------------------------------------------

export function lintRender(md: string, opts: { agentMd?: string } = {}): LintReport {
  const B = RENDER_BUDGETS;
  const { sections, fences } = parseSections(md);
  const findings: LintFinding[] = [];
  const F = (f: LintFinding): void => {
    findings.push(f);
  };

  // Anchors: GitHub suffixes a repeated slug with -1, -2, …
  const slugs = new Map<string, Section>();
  const slugOfSection = new Map<Section, string>();
  const mint = makeSlugger();
  for (const s of sections) {
    const slug = mint(s.title);
    slugs.set(slug, s);
    slugOfSection.set(s, slug);
  }
  const headingKeys = new Map(sections.map((s) => [s.key, s]));

  let totalProse = 0;
  const sectionWords: Record<string, number> = {};
  let paraOver = 0;
  let bulletOver = 0;
  let cellOver = 0;
  let cellHard = 0;
  let longest = { words: 0, section: "", line: 0 };
  const footnotes: Array<{ line: number; num: number; slug: string; section: string }> = [];
  const backrefs: Array<{ line: number; nums: number[]; sec: Section }> = [];
  const phraseIndex = new Map<string, Set<string>>();
  const phraseLines = new Map<string, Array<[number, string]>>();
  const factIndex = new Map<string, Map<string, number>>();
  const rationale = new Map<string, [number, number]>();

  const bodyWords = (s: Section): number =>
    s.lines.reduce((n, [, t]) => n + (TABLE_SEP_RE.test(t) ? 0 : countWords(t)), 0);
  const subtreeWords = (s: Section): number =>
    bodyWords(s) + sections.filter((c) => c.parent === s).reduce((n, c) => n + subtreeWords(c), 0);

  const index = (text: string, s: Section, line: number, factsOnly = false): void => {
    const key = sectionKey(s);
    const stance = isStance(s);
    if (!stance) {
      for (const m of stripInline(text).matchAll(FACT_RE)) {
        const fact = m[0].trim().replace(/\s+/g, " ").toLowerCase();
        const where = factIndex.get(fact) ?? new Map<string, number>();
        if (!where.has(key)) where.set(key, line);
        factIndex.set(fact, where);
      }
    }
    if (factsOnly) return;
    if (!stance) {
      const toks = tokensOf(text);
      for (let k = 0; k + B.sharedNgram <= toks.length; k++) {
        const g = toks.slice(k, k + B.sharedNgram).join(" ");
        const set = phraseIndex.get(g) ?? new Set<string>();
        set.add(key);
        phraseIndex.set(g, set);
        const ls = phraseLines.get(g) ?? [];
        if (!ls.some(([, sec]) => sec === key)) ls.push([line, key]);
        phraseLines.set(g, ls);
      }
      const sents = sentencesOf(text);
      const r = rationale.get(s.title) ?? [0, 0];
      r[1] += sents.length;
      r[0] += sents.filter((x) => RATIONALE_RE.test(x)).length;
      rationale.set(s.title, r);
    }
    // Inline cross-references that should be footnotes.
    const plain = text.replace(FOOTNOTE_RE, "");
    for (const m of plain.matchAll(PAREN_RE)) {
      const inner = m[1].trim();
      let cand = inner.split(",").pop()!.trim();
      cand = cand.replace(/^(?:see|under|in|per)\s+(?:the\s+)?/i, "").replace(/\s+(?:above|below|section)$/i, "");
      const target = headingKeys.get(keyOf(cand));
      if (target && target !== s) {
        F({
          rule: "inline-crossref",
          severity: "advisory",
          section: s.title,
          line,
          message: `\`(${inner})\` is a cross-reference in prose — write it as a footnote \`<sup>[n](#${githubSlug(target.title)})</sup>\` and drop the parenthetical`,
        });
      }
    }
    const noParens = stripInline(plain).replace(PAREN_RE, "");
    for (const m of noParens.matchAll(SEE_RE)) {
      // The longest word-boundary prefix that names a heading.
      const words = m[1].trim().split(/\s+/);
      for (let n = words.length; n >= 1; n--) {
        const cand = words.slice(0, n).join(" ").replace(/[.,;:]+$/, "");
        const target = headingKeys.get(keyOf(cand));
        if (target && target !== s) {
          F({
            rule: "inline-crossref",
            severity: "advisory",
            section: s.title,
            line,
            message: `prose points at the "${target.title}" section by name — make it a footnote \`<sup>[n](#${githubSlug(target.title)})</sup>\``,
          });
          break;
        }
      }
    }
  };

  for (const s of sections) {
    const boiler = isBoilerplate(s);
    if (!boiler) totalProse += bodyWords(s);

    for (const [no, text] of s.lines) {
      for (const m of text.matchAll(APPARATUS_RE)) {
        F({
          rule: "apparatus-leak",
          severity: "HARD",
          section: s.title,
          line: no + 1,
          message: `engine vocabulary on a human page: \`${m[0]}\` — name the thing it stands for, or drop it`,
        });
      }
      for (const m of text.matchAll(MD_FOOTNOTE_RE)) {
        F({
          rule: "footnote-form",
          severity: "HARD",
          section: s.title,
          line: no + 1,
          message: `\`${m[0]}\` is a Markdown end-note; a render's footnote is \`<sup>[n](#section-slug)</sup>\` — a jump to the owning section`,
        });
      }
      for (const m of text.matchAll(FOOTNOTE_RE)) {
        footnotes.push({ line: no + 1, num: Number(m[1]), slug: m[2], section: s.title });
      }
      for (const m of text.replace(FOOTNOTE_RE, "").matchAll(BACKREF_RE)) {
        backrefs.push({ line: no + 1, nums: [...m[1].matchAll(/\d+/g)].map((x) => Number(x[0])), sec: s });
      }
    }

    if (s.key === DECISION_LOG) {
      for (const [kind, block] of blocksOf(s.lines)) {
        if (kind !== "table") continue;
        for (const [no, text] of block.slice(2)) {
          const cells = tableCells([[no, text]]).map(([, c]) => c);
          if (cells.length >= 2 && countWords(cells[1]) > B.decisionLogRowWords) {
            F({
              rule: "decision-log-row",
              severity: "advisory",
              section: s.title,
              line: no + 1,
              message: `Decision log row is ${countWords(cells[1])} words (budget ${B.decisionLogRowWords}) — links only, one line; the reasoning lives in the record`,
            });
          }
        }
      }
    }
    if (boiler) continue;

    const h2 = h2Of(s);
    for (const [kind, block] of blocksOf(s.lines)) {
      if (kind === "para") {
        const text = block.map(([, t]) => t.trim()).join(" ");
        const n = countWords(text);
        if (n > longest.words) longest = { words: n, section: s.title, line: block[0][0] + 1 };
        if (n > B.paragraphWords) {
          paraOver++;
          F({
            rule: "paragraph-length",
            severity: "advisory",
            section: s.title,
            line: block[0][0] + 1,
            message: `paragraph is ${n} words (budget ${B.paragraphWords}) — split into nested bullets, or a sub-heading per thing it covers`,
          });
        }
        index(text, s, block[0][0] + 1);
      } else if (kind === "bullet") {
        for (const [no, , own] of bulletItems(block)) {
          const n = countWords(own);
          if (n > B.bulletWords) {
            bulletOver++;
            F({
              rule: "bullet-length",
              severity: "advisory",
              section: s.title,
              line: no + 1,
              message: `bullet is ${n} words (budget ${B.bulletWords}) — headline on the bullet, context in nested bullets`,
            });
          }
          if (
            !NEGATIVE_OK.has(s.key) &&
            !NEGATIVE_OK.has(h2.key) &&
            NON_CHANGE_RE.test(stripInline(own)) &&
            !own.trimStart().startsWith("N/A")
          ) {
            F({
              rule: "non-change",
              severity: "advisory",
              section: s.title,
              line: no + 1,
              message: "states what the design does *not* do — keep it only when the absence is itself a change",
            });
          }
          index(own, s, no + 1);
        }
      } else if (kind === "table") {
        const chain = ancestry(s)
          .map((a) => a.key)
          .join(" ");
        for (const [no, cell] of tableCells(block.slice(0, 1))) {
          const m = DUP_COLUMN_RE.exec(cell);
          // The owning section may carry its own column: a Failure column
          // inside a Failure handling section is the content, not a copy.
          if (m && !isStance(s) && !chain.includes(m[1].toLowerCase().slice(0, 4))) {
            F({
              rule: "duplicate-column",
              severity: "advisory",
              section: s.title,
              line: no + 1,
              message: `column \`${cell}\` restates what another section owns (failure handling, rationale) — drop it; footnote the owning section from the row`,
            });
          }
        }
        for (const [no, cell] of tableCells(block)) {
          const n = countWords(cell);
          if (n > B.tableCellWordsHard) {
            cellHard++;
            F({
              rule: "table-cell-length",
              severity: "HARD",
              section: s.title,
              line: no + 1,
              message: `table cell is ${n} words (hard limit ${B.tableCellWordsHard}) — a cell is a phrase; move the rest to the owning section and footnote it`,
            });
          } else if (n > B.tableCellWords) {
            cellOver++;
            F({
              rule: "table-cell-length",
              severity: "advisory",
              section: s.title,
              line: no + 1,
              message: `table cell is ${n} words (budget ${B.tableCellWords})`,
            });
          }
          index(cell, s, no + 1, true);
        }
      }
      // quotes: guidance or provenance panels — not budgeted
    }

    if (!isStance(s)) {
      for (const [no, text] of s.lines) {
        const plain = stripInline(text);
        if (META_PROSE_RE.test(plain)) {
          F({
            rule: "meta-prose",
            severity: "advisory",
            section: s.title,
            line: no + 1,
            message: "prose commenting on its own importance — the fact is on the page or it is not; drop the qualifier",
          });
        }
        if (!HISTORY_OK.has(h2.key) && HISTORY_RE.test(text) && !CUTOVER_RE.test(text)) {
          F({
            rule: "old-design",
            severity: "advisory",
            section: s.title,
            line: no + 1,
            message: "describes the old design or its history — the render states the current design; history lives in decision records",
          });
        }
      }
    }
  }

  // Budget units: each `##` (children included), except a container `##`
  // whose `###` children are the units; Overview has its own budget.
  for (const s of sections) {
    if (isBoilerplate(s) || s.key === OVERVIEW) continue;
    const isUnit =
      (s.level === 2 && !CONTAINER_H2.has(s.key)) ||
      (s.level === 3 && s.parent !== null && CONTAINER_H2.has(s.parent.key));
    if (isUnit) sectionWords[sectionKey(s)] = subtreeWords(s);
  }

  const ov = headingKeys.get(OVERVIEW);
  const ovWords = ov ? subtreeWords(ov) : 0;
  if (ov && ovWords > B.overviewWords) {
    F({
      rule: "overview-length",
      severity: "advisory",
      section: ov.title,
      line: ov.start + 1,
      message: `Overview is ${ovWords} words (budget ${B.overviewWords}) — the problem and the approach; mechanics belong to their own sections`,
    });
  }
  const sectionsOver: Array<[string, number]> = [];
  for (const [key, n] of Object.entries(sectionWords)) {
    if (n > B.sectionWords) {
      sectionsOver.push([key, n]);
      F({
        rule: "section-length",
        severity: "advisory",
        section: key,
        line: 0,
        message: `section is ${n} words (budget ${B.sectionWords}) — depth beyond the budget belongs in agent.md`,
      });
    }
  }
  if (totalProse > B.totalProseWordsHard) {
    F({
      rule: "total-length",
      severity: "HARD",
      section: "(document)",
      line: 0,
      message: `render carries ${totalProse} prose words (hard limit ${B.totalProseWordsHard}; target ${B.totalProseWords})`,
    });
  } else if (totalProse > B.totalProseWords) {
    F({
      rule: "total-length",
      severity: "advisory",
      section: "(document)",
      line: 0,
      message: `render carries ${totalProse} prose words (target ${B.totalProseWords})`,
    });
  }

  // Footnotes: each jump resolves, numbered first-appearance, one per target.
  const expected = new Map<string, number>();
  for (const f of footnotes) {
    if (!slugs.has(f.slug)) {
      F({
        rule: "footnote-target",
        severity: "HARD",
        section: f.section,
        line: f.line,
        message: `footnote [${f.num}] points at \`#${f.slug}\`, which matches no heading`,
      });
      continue;
    }
    if (!expected.has(f.slug)) expected.set(f.slug, expected.size + 1);
  }
  let numberingOk = true;
  for (const f of footnotes) {
    const want = expected.get(f.slug);
    if (want !== undefined && want !== f.num) {
      numberingOk = false;
      F({
        rule: "footnote-numbering",
        severity: "HARD",
        section: f.section,
        line: f.line,
        message: `footnote [${f.num}] → \`#${f.slug}\` should be [${want}] (one number per target section, first-appearance order; \`--renumber\` fixes it)`,
      });
    }
  }
  if (footnotes.length > 0) {
    const guide = sections.find((x) => x.key === "reading guide" || x.key === "table of contents");
    const legendOk = guide !== undefined && guide.lines.some(([, t]) => /superscript/i.test(t));
    if (!legendOk) {
      F({
        rule: "footnote-legend",
        severity: "advisory",
        section: guide?.title ?? "Reading guide",
        line: guide ? guide.start + 1 : 0,
        message: "the render uses footnotes but the Reading guide does not say what a superscript number is — add the one-sentence gloss",
      });
    }
  }
  const density = totalProse > 0 ? (footnotes.length / totalProse) * 100 : 0;
  if (density > B.footnotesPer100Words) {
    F({
      rule: "footnote-density",
      severity: "advisory",
      section: "(document)",
      line: 0,
      message: `${footnotes.length} footnotes for ${totalProse} words (${density.toFixed(1)}/100) — a render that is mostly pointers has lost its own prose`,
    });
  }

  // Back-references (R13): a destination carries `<sup>[n]</sup>` at its top.
  const marked = new Map<string, number>();
  for (const b of backrefs) {
    const secSlug = slugOfSection.get(b.sec) ?? githubSlug(b.sec.title);
    const want = expected.get(secSlug);
    for (const n of b.nums) {
      if (want !== undefined && n === want) {
        marked.set(secSlug, b.line);
        const first = b.sec.lines.find(([, t]) => t.trim() !== "" && !TABLE_SEP_RE.test(t) && !HR_RE.test(t));
        if (first && first[0] + 1 !== b.line) {
          F({
            rule: "backref-place",
            severity: "advisory",
            section: b.sec.title,
            line: b.line,
            message: "back-reference marker is below the section's first line — a reader lands on the heading, so the marker goes at the top",
          });
        }
      } else {
        F({
          rule: "backref-mismatch",
          severity: "HARD",
          section: b.sec.title,
          line: b.line,
          message: `back-reference [${n}] sits in "${b.sec.title}", which ${
            want !== undefined
              ? `footnote [${want}] targets — the marker must read [${want}]`
              : "no footnote targets — a back-reference belongs only in a destination"
          }`,
        });
      }
    }
  }
  for (const [slug, num] of expected) {
    if (marked.has(slug)) continue;
    const tgt = slugs.get(slug)!;
    F({
      rule: "backref-missing",
      severity: "advisory",
      section: tgt.title,
      line: tgt.start + 1,
      message: `"${tgt.title}" is a footnote destination with no back-reference — add \`<sup>[${num}]</sup>\` as its first line`,
    });
  }

  // Duplicate facts: a shared phrase across sections, reported once per pair.
  let dupPhrases = 0;
  const reportedPairs = new Set<string>();
  for (const [g, secs] of phraseIndex) {
    if (secs.size < 2) continue;
    const pair = [...secs].sort().join(" | ");
    if (reportedPairs.has(pair)) continue;
    reportedPairs.add(pair);
    dupPhrases++;
    const where = [...(phraseLines.get(g) ?? [])].sort((a, b) => a[0] - b[0]).slice(0, 2);
    F({
      rule: "duplicate-phrase",
      severity: "advisory",
      section: where[0][1],
      line: where[0][0],
      message: `the same ${B.sharedNgram}+-word phrase appears in ${where.map(([ln, sec]) => `${sec} (line ${ln})`).join(" and ")} — one home, footnote the other`,
    });
  }
  let restated = 0;
  for (const [fact, where] of factIndex) {
    if (where.size < B.repeatSections) continue;
    restated++;
    const homes = [...where.entries()]
      .slice(0, 4)
      .map(([sec, ln]) => `${sec} (line ${ln})`)
      .join(", ");
    F({
      rule: "restated-fact",
      severity: "advisory",
      section: "(document)",
      line: Math.min(...where.values()),
      message: `\`${fact}\` is stated in ${where.size} sections: ${homes} — state it once where it is owned; footnote it from the others`,
    });
  }
  for (const [title, [why, total]] of rationale) {
    if (total >= 6 && why / total > B.rationaleRatio) {
      F({
        rule: "why-heavy",
        severity: "advisory",
        section: title,
        line: 0,
        message: `${why} of ${total} sentences explain why — the render says what the design is; the why lives in decision records`,
      });
    }
  }

  const hard = findings.filter((f) => f.severity === "HARD").length;
  const metrics: LintMetrics = {
    totalWords: countWords(md),
    proseWords: totalProse,
    overviewWords: ovWords,
    sections: sectionWords,
    sectionsOverBudget: sectionsOver,
    longestParagraph: longest,
    paragraphsOver: paraOver,
    bulletsOver: bulletOver,
    tableCellsOver: cellOver,
    tableCellsHard: cellHard,
    footnotes: footnotes.length,
    footnoteTargets: expected.size,
    footnoteNumberingOk: numberingOk,
    footnotesPer100Words: Math.round(density * 100) / 100,
    backrefs: backrefs.length,
    backrefTargetsMarked: marked.size,
    duplicatePhrases: dupPhrases,
    restatedFacts: restated,
    mermaidBlocks: fences.filter((f) => f.lang.toLowerCase() === "mermaid").length,
    codeBlocks: fences.filter((f) => f.lang.toLowerCase() !== "mermaid").length,
    hardFindings: hard,
    advisoryFindings: findings.length - hard,
  };
  if (opts.agentMd !== undefined) {
    const aw = countWords(opts.agentMd);
    metrics.agentWords = aw;
    metrics.ratioToAgent = aw > 0 ? Math.round((metrics.totalWords / aw) * 1000) / 1000 : null;
  }
  return { findings, metrics };
}

// ---------------------------------------------------------------------------
// Renumber
// ---------------------------------------------------------------------------

/** Rewrite footnote numbers in first-appearance order (one per target) and
 *  bring each destination's back-reference marker into step. Fenced code is
 *  left alone. Idempotent. */
export function renumberFootnotes(md: string): string {
  const lines = md.split("\n");
  const fenced = fencedLineMask(lines);
  const order = new Map<string, number>();
  const pass1 = lines.map((line, i) =>
    fenced[i]
      ? line
      : line.replace(FOOTNOTE_RE, (_m, _n: string, slug: string) => {
          if (!order.has(slug)) order.set(slug, order.size + 1);
          return `<sup>[${order.get(slug)}](#${slug})</sup>`;
        }),
  );
  let curSlug: string | null = null;
  const mint = makeSlugger();
  return pass1
    .map((line, i) => {
      if (fenced[i]) return line;
      const h = HEADING_RE.exec(line);
      if (h && h[1].length >= 2) {
        curSlug = mint(h[2]);
        return line;
      }
      const n = curSlug !== null ? order.get(curSlug) : undefined;
      return n === undefined ? line : line.replace(BACKREF_RE, `<sup>[${n}]</sup>`);
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// Text report
// ---------------------------------------------------------------------------

export function formatLintReport(r: LintReport, path: string): string {
  const B = RENDER_BUDGETS;
  const m = r.metrics;
  const pad = (v: number | string): string => String(v).padStart(6);
  const out = [`render lint — ${path}`, ""];
  out.push(`  prose words      ${pad(m.proseWords)}   (target ${B.totalProseWords}, hard ${B.totalProseWordsHard}; ${m.totalWords} incl. boilerplate)`);
  if (m.ratioToAgent !== undefined && m.ratioToAgent !== null) {
    out.push(`  ratio to agent   ${pad(m.ratioToAgent)}   (${m.agentWords} words)`);
  }
  out.push(`  overview words   ${pad(m.overviewWords)}   (budget ${B.overviewWords})`);
  out.push(`  sections over    ${pad(m.sectionsOverBudget.length)}   (budget ${B.sectionWords}/section)`);
  out.push(
    `  longest para     ${pad(m.longestParagraph.words)}   words, ${m.longestParagraph.section || "—"} line ${m.longestParagraph.line}; ${m.paragraphsOver} over ${B.paragraphWords}`,
  );
  out.push(`  bullets over     ${pad(m.bulletsOver)}   (budget ${B.bulletWords})`);
  out.push(`  table cells over ${pad(m.tableCellsOver)}   advisory, ${m.tableCellsHard} HARD (>${B.tableCellWords} / >${B.tableCellWordsHard} words)`);
  out.push(
    `  footnotes        ${pad(m.footnotes)}   → ${m.footnoteTargets} sections, ${m.footnotesPer100Words}/100 words, numbering ${m.footnoteNumberingOk ? "ok" : "BROKEN"}`,
  );
  out.push(`  backrefs         ${pad(m.backrefs)}   ${m.backrefTargetsMarked} of ${m.footnoteTargets} destinations marked`);
  out.push(`  duplicate phrase ${pad(m.duplicatePhrases)}   section pairs sharing a ${B.sharedNgram}-word phrase`);
  out.push(`  restated facts   ${pad(m.restatedFacts)}   number+unit facts in ≥${B.repeatSections} sections`);
  out.push(`  diagrams / code  ${String(m.mermaidBlocks).padStart(3)} / ${m.codeBlocks}`);
  out.push(`  findings         ${pad(m.hardFindings)} HARD, ${m.advisoryFindings} advisory`);
  out.push("");
  const sorted = [...r.findings].sort(
    (a, b) => Number(a.severity !== "HARD") - Number(b.severity !== "HARD") || a.rule.localeCompare(b.rule) || a.line - b.line,
  );
  for (const f of sorted) {
    const where = f.line ? `${f.section}:${f.line}` : f.section;
    out.push(`  [${f.severity.padEnd(8)}] ${f.rule.padEnd(18)} ${where} — ${f.message}`);
  }
  return `${out.join("\n")}\n`;
}
