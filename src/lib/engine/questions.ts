// Pure questions.md engine module — the per-workstream HEALTH QUEUE.
//
// devx already had the human inboxes (INTERVIEW.md for decisions, MANUAL.md
// for actions) and the resolver (`/devx-walk`). What it had no durable record
// of was a GATE CONCERN: a Gate-2 ⚠️ lived as one line inside
// `decisions/<date>-design-verify.md` and was never read again, so a
// workstream's frontmatter could say `design_verified: true` while four
// known gaps sat unaddressed and nothing on any surface said so.
//
// This module owns the parse contract and the reconcile transform. Both are
// pure: callers read and write the file, this module only transforms text.
//
// Three properties the shape exists for:
//
//  - **Reconciled, not appended.** Every gate run makes its own open entries
//    mirror THAT run's findings exactly — adds what is new, updates what
//    changed, resolves what it no longer finds. An append-only queue grows a
//    tail of fixed concerns and stops being readable; a replace-wholesale
//    queue loses the hand-written entries beside them. So the transform is
//    line surgery: only the fields a gate owns are rewritten, and everything
//    else in the file survives byte-for-byte.
//  - **A missing Severity is a parse FAILURE, not a default.** Entries are
//    machine-written, so a writer that omits or fumbles the field would
//    otherwise silently downgrade a blocker to a note — the exact failure the
//    queue exists to prevent. Callers catch `QuestionsError` and degrade to a
//    reported "malformed questions.md", never to a confident empty queue.
//  - **Never a gate INPUT.** The queue is written BY gates and read by
//    `devx next` / `devx status` / `/devx-walk`. No gate evaluator may read
//    it — pinned by test/gate-questions-isolation.test.ts, the same posture
//    todo.md has (FR-3).
//
// Fields: Kind · Severity · Blocks · Origin · Recommendation · Status ·
// Resolution. Upstream's `Options` / `Answer` / `Answered-by` / `Channel`
// are deliberately absent: they exist so a second human can sign off on a
// wiki page, and in a solo repo the answer lands in INTERVIEW.md (a decision)
// or MANUAL.md (an action) and comes back through `Resolution:`. Port the
// mechanism, not the ritual.
//
// IDs are stable and never reused — `nextQuestionId` reads the max over ALL
// entries including resolved ones, so a resolved `Q-3` never has its number
// handed to something else.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const QUESTION_KINDS = [
  "gate-concern",
  "open-question",
  "discovered-gap",
  "needs-revision",
] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

export const QUESTION_SEVERITIES = ["blocking", "concern"] as const;
export type QuestionSeverity = (typeof QUESTION_SEVERITIES)[number];

export const QUESTION_STATUSES = [
  "open",
  "asked",
  "answered",
  "resolved",
] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

export interface Question {
  /** `Q-1`, `Q-12` — stable, never reused. */
  id: string;
  title: string;
  /** Null when absent or unrecognized. Unlike Severity this is advisory: a
   *  kind nobody recognizes still reads as an entry, it just does not match
   *  a gate's reconcile scope. */
  kind: QuestionKind | null;
  severity: QuestionSeverity;
  /** `gate-prd` | `gate-design` | `gate-plan` | `gate-evals` | `phase-N`,
   *  or `""` when nothing is blocked. */
  blocks: string;
  origin: string;
  recommendation: string;
  status: QuestionStatus;
  resolution: string;
  /** 1-indexed line of the `## Q-N:` heading — for drift reports. */
  line: number;
}

export interface QuestionsDoc {
  entries: Question[];
  /**
   * 1-indexed lines of `## Q…` headings that do NOT match the canonical
   * `## Q-<n>: <title>` shape.
   *
   * Load-bearing rather than pedantic: a drifted heading makes the whole
   * block invisible to the splitter, so its field bullets land inside the
   * PREVIOUS entry — and an open blocking entry then reads as whatever the
   * entry above it says. Surfaced, never silently swallowed.
   */
  headingDrift: number[];
}

/** An entry is open until it is resolved — `asked` and `answered` are still
 *  waiting on something. */
export const isOpen = (q: Question): boolean => q.status !== "resolved";

/** Blocking ⇒ open AND severity blocking. A resolved blocker blocks nothing. */
export const isBlocking = (q: Question): boolean =>
  isOpen(q) && q.severity === "blocking";

export interface HealthCounts {
  blocking: number;
  concern: number;
}

/** The two numbers `devx next` row 11, `devx status` and `devx board` all
 *  render. One definition so three surfaces cannot disagree. */
export function healthCounts(entries: readonly Question[]): HealthCounts {
  let blocking = 0;
  let concern = 0;
  for (const q of entries) {
    if (!isOpen(q)) continue;
    if (q.severity === "blocking") blocking++;
    else concern++;
  }
  return { blocking, concern };
}

/** Thrown by `parseQuestions` on a defect that would downgrade a blocker. */
export class QuestionsError extends Error {}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

const HEADING_RE = /^##\s+(Q-\d+):\s*(.*)$/;
/** Any `## Q…` heading — used only to detect drift off the canonical form. */
const LOOSE_HEADING_RE = /^##\s+Q/i;
const FIELD_RE = /^\s*-\s+\*\*([^*]+):\*\*\s*(.*)$/;

/** Placeholders that mean "empty" in a hand-written or templated entry. */
const EMPTY_VALUES = new Set(["", "—", "-", "–", "n/a", "tbd"]);

function cleanValue(raw: string): string {
  const v = raw.trim();
  return EMPTY_VALUES.has(v.toLowerCase()) ? "" : v;
}

/**
 * Blank out every line that lies inside an HTML comment, PRESERVING the line
 * count.
 *
 * The template ships its field contract inside one comment, so a parser that
 * did not mask it would read the example `## Q-1:` as a live blocking entry
 * in every freshly scaffolded workstream. Upstream strips comments outright;
 * stripping here would desynchronize every line index from the real file, and
 * the reconcile transform edits BY line index. Masking keeps one coordinate
 * system for both halves.
 *
 * Partial lines matter: `text <!-- note --> more` must keep `text  more`, and
 * `<!-- open` must mask the rest of its own line too.
 */
export function maskComments(lines: readonly string[]): string[] {
  const out: string[] = [];
  let inComment = false;
  for (const line of lines) {
    let rest = line;
    let kept = "";
    for (;;) {
      if (inComment) {
        const close = rest.indexOf("-->");
        if (close === -1) {
          rest = "";
          break;
        }
        inComment = false;
        rest = rest.slice(close + 3);
        continue;
      }
      const open = rest.indexOf("<!--");
      if (open === -1) {
        kept += rest;
        rest = "";
        break;
      }
      kept += rest.slice(0, open);
      inComment = true;
      rest = rest.slice(open + 4);
    }
    out.push(kept);
  }
  return out;
}

/** Everything the reconcile transform needs about one entry on disk. */
interface EntrySpan {
  q: Question;
  /** 0-indexed heading line. */
  headingIdx: number;
  /** 0-indexed, exclusive — the next heading, or EOF. */
  endIdx: number;
  /** Lowercased field label → 0-indexed line of its bullet. */
  fieldIdx: Map<string, number>;
  /** 0-indexed line of the LAST field bullet, or the heading when none. */
  lastFieldIdx: number;
}

function parseSpans(masked: readonly string[]): {
  spans: EntrySpan[];
  headingDrift: number[];
} {
  const headings: Array<{ idx: number; id: string; title: string }> = [];
  const headingDrift: number[] = [];
  for (let i = 0; i < masked.length; i++) {
    const m = HEADING_RE.exec(masked[i]);
    if (m !== null) {
      headings.push({ idx: i, id: m[1], title: m[2].trim() });
    } else if (LOOSE_HEADING_RE.test(masked[i])) {
      headingDrift.push(i + 1);
    }
  }

  const spans: EntrySpan[] = [];
  for (let h = 0; h < headings.length; h++) {
    const { idx, id, title } = headings[h];
    const endIdx = h + 1 < headings.length ? headings[h + 1].idx : masked.length;
    const fieldIdx = new Map<string, number>();
    const values = new Map<string, string>();
    let lastFieldIdx = idx;
    for (let i = idx + 1; i < endIdx; i++) {
      const fm = FIELD_RE.exec(masked[i]);
      if (fm === null) continue;
      const label = fm[1].trim().toLowerCase();
      // First spelling wins: a duplicated bullet is a hand-edit artifact, and
      // taking the LAST would let a stray later `- **Severity:** concern`
      // silently downgrade the entry.
      if (!fieldIdx.has(label)) {
        fieldIdx.set(label, i);
        values.set(label, fm[2]);
      }
      lastFieldIdx = i;
    }

    const rawSeverity = cleanValue(values.get("severity") ?? "");
    const severity = rawSeverity.toLowerCase();
    if (severity === "") {
      throw new QuestionsError(
        `${id} (line ${idx + 1}): missing Severity — every entry declares 'blocking' or 'concern'. ` +
          `A missing one reads as a non-blocking note, silently downgrading a blocker.`,
      );
    }
    if (!(QUESTION_SEVERITIES as readonly string[]).includes(severity)) {
      throw new QuestionsError(
        `${id} (line ${idx + 1}): unrecognized Severity '${rawSeverity}' — expected ${QUESTION_SEVERITIES.join(" | ")}. ` +
          `A fumbled severity silently downgrades a blocker to a note.`,
      );
    }

    const rawKind = cleanValue(values.get("kind") ?? "").toLowerCase();
    const kind = (QUESTION_KINDS as readonly string[]).includes(rawKind)
      ? (rawKind as QuestionKind)
      : null;
    const rawStatus = cleanValue(values.get("status") ?? "").toLowerCase();
    // Status defaults OPEN, deliberately the opposite direction from
    // Severity: an unreadable status must never read as `resolved`, which
    // would drop a live entry out of every count. Only the literal
    // `resolved` resolves.
    const status = (QUESTION_STATUSES as readonly string[]).includes(rawStatus)
      ? (rawStatus as QuestionStatus)
      : "open";

    spans.push({
      q: {
        id,
        title,
        kind,
        severity: severity as QuestionSeverity,
        blocks: cleanValue(values.get("blocks") ?? ""),
        origin: cleanValue(values.get("origin") ?? ""),
        recommendation: cleanValue(values.get("recommendation") ?? ""),
        status,
        resolution: cleanValue(values.get("resolution") ?? ""),
        line: idx + 1,
      },
      headingIdx: idx,
      endIdx,
      fieldIdx,
      lastFieldIdx,
    });
  }
  return { spans, headingDrift };
}

/**
 * Parse questions.md. Throws `QuestionsError` on a severity defect — the one
 * class that would silently mislabel a blocker.
 */
export function parseQuestions(content: string): QuestionsDoc {
  const { spans, headingDrift } = parseSpans(maskComments(content.split("\n")));
  return { entries: spans.map((s) => s.q), headingDrift };
}

/** Next free `Q-<n>`: max over EVERY entry, resolved included, + 1. */
export function nextQuestionId(entries: readonly Question[]): string {
  let max = 0;
  for (const q of entries) {
    const m = /^Q-(\d+)$/.exec(q.id);
    if (m !== null) max = Math.max(max, Number(m[1]));
  }
  return `Q-${max + 1}`;
}

// ---------------------------------------------------------------------------
// Reconcile
// ---------------------------------------------------------------------------

/** One finding a gate run produced, in the shape the queue records. */
export interface GateFinding {
  /** The MATCH KEY across runs — keep it stable (an ID, a check name), and
   *  put the varying detail in `recommendation`. A title that changes
   *  resolves the old entry and opens a new one, which is correct but noisy. */
  title: string;
  severity: QuestionSeverity;
  /** The fix. Required for a blocking finding — arrive with a proposal. */
  recommendation: string;
}

export interface ReconcileInput {
  /** The gate this run owns: `gate-prd` | `gate-design` | `gate-plan` |
   *  `gate-evals`. Scopes BOTH halves — a coverage run never touches a
   *  Gate-4 entry. */
  blocks: string;
  /** What surfaced it — `devx gate coverage · design/agent.md`. */
  origin: string;
  findings: readonly GateFinding[];
  /** What a stale entry's `Resolution:` points at — this run's report. */
  resolution: string;
}

export interface ReconcileResult {
  content: string;
  /** Q-ids, in the order the transform touched them. */
  added: string[];
  updated: string[];
  resolved: string[];
}

/**
 * Match key for a title: case- and whitespace-insensitive, trailing
 * punctuation dropped. Two runs that word a finding identically but for a
 * reflowed space must not open a second entry for it.
 */
const matchKey = (title: string): string =>
  title
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.;:,!?]+$/, "")
    .trim();

/** Canonical field order for a rendered entry. */
const FIELD_ORDER: ReadonlyArray<[label: string, key: keyof Question]> = [
  ["Kind", "kind"],
  ["Severity", "severity"],
  ["Blocks", "blocks"],
  ["Origin", "origin"],
  ["Recommendation", "recommendation"],
  ["Status", "status"],
  ["Resolution", "resolution"],
];

const EM_DASH = "—";

/** Id-allocation stand-in for an entry this run appended but has not parsed
 *  back. Only `id` is read by `nextQuestionId`. */
const PLACEHOLDER_QUESTION: Question = {
  id: "",
  title: "",
  kind: "gate-concern",
  severity: "concern",
  blocks: "",
  origin: "",
  recommendation: "",
  status: "open",
  resolution: "",
  line: 0,
};

function renderEntry(
  id: string,
  title: string,
  fields: Readonly<Record<string, string>>,
): string[] {
  const lines = [`## ${id}: ${title}`, ""];
  for (const [label, key] of FIELD_ORDER) {
    const v = fields[key] ?? "";
    lines.push(`- **${label}:** ${v === "" ? EM_DASH : v}`);
  }
  lines.push("", "---", "");
  return lines;
}

/**
 * Make this gate's open entries mirror this run's findings exactly.
 *
 * Both halves, or the queue lies in one direction or the other:
 *
 *  - **Each current finding gets an entry.** Matched against an existing OPEN
 *    `gate-concern` entry with the same `Blocks` by title; matched → its
 *    Severity / Origin / Recommendation are rewritten in place and its id and
 *    status are kept; unmatched → a fresh `Q-<n>` appended, `Status: open`.
 *  - **Each stale entry closes.** An open `gate-concern` entry for this gate
 *    that matches NO finding in this run is fixed: `Status: resolved`,
 *    `Resolution:` this run's report. Without this half a gate that now
 *    advances still reads "blocked" on every board — which is what makes a
 *    re-run that PASSES resolve the prior FAIL's entries.
 *
 * Only `gate-concern` entries whose `Blocks` matches are in scope. A parked
 * `open-question`, a `discovered-gap` filed mid-build, and another gate's
 * concerns are all left untouched: this is a reconcile, not a truncate.
 *
 * Line surgery, not re-render: existing entries keep their prose, their
 * hand-added bullets and their ordering. A field a gate owns but the entry
 * lacks is INSERTED after its last bullet rather than silently dropped.
 */
export function reconcileGateConcerns(
  content: string,
  input: ReconcileInput,
): ReconcileResult {
  const lines = content.split("\n");
  const { spans } = parseSpans(maskComments(lines));

  const inScope = spans.filter(
    (s) =>
      s.q.kind === "gate-concern" &&
      s.q.blocks === input.blocks &&
      isOpen(s.q),
  );
  const byKey = new Map<string, EntrySpan>();
  // First wins, so a duplicated title updates the EARLIEST entry and the
  // later one resolves as stale — which collapses an accidental duplicate
  // instead of ping-ponging between the two on alternating runs.
  for (const s of inScope) {
    const k = matchKey(s.q.title);
    if (!byKey.has(k)) byKey.set(k, s);
  }

  /** 0-indexed line → replacement text. */
  const replace = new Map<number, string>();
  /** 0-indexed line → lines inserted AFTER it. */
  const insert = new Map<number, string[]>();

  const setField = (span: EntrySpan, label: string, value: string): void => {
    const text = `- **${label}:** ${value === "" ? EM_DASH : value}`;
    const idx = span.fieldIdx.get(label.toLowerCase());
    if (idx !== undefined) {
      replace.set(idx, text);
      return;
    }
    const at = insert.get(span.lastFieldIdx) ?? [];
    at.push(text);
    insert.set(span.lastFieldIdx, at);
  };

  const added: string[] = [];
  const updated: string[] = [];
  const resolved: string[] = [];
  const matched = new Set<string>();
  const appended: string[] = [];

  // Ids are allocated against EVERY entry (resolved ones included) and
  // advanced locally per append, so two findings in one run never collide.
  let ids = spans.map((s) => s.q);

  for (const f of input.findings) {
    const key = matchKey(f.title);
    const hit = byKey.get(key);
    if (hit !== undefined && !matched.has(key)) {
      matched.add(key);
      setField(hit, "Severity", f.severity);
      setField(hit, "Origin", input.origin);
      setField(hit, "Recommendation", f.recommendation);
      updated.push(hit.q.id);
      continue;
    }
    // Unmatched, or a second finding colliding onto one entry: a new entry.
    const id = nextQuestionId(ids);
    appended.push(
      ...renderEntry(id, f.title, {
        kind: "gate-concern",
        severity: f.severity,
        blocks: input.blocks,
        origin: input.origin,
        recommendation: f.recommendation,
        status: "open",
        resolution: "",
      }),
    );
    ids = [...ids, { ...PLACEHOLDER_QUESTION, id }];
    added.push(id);
  }

  for (const s of inScope) {
    if (matched.has(matchKey(s.q.title))) continue;
    setField(s, "Status", "resolved");
    setField(s, "Resolution", input.resolution);
    resolved.push(s.q.id);
  }

  if (replace.size === 0 && insert.size === 0 && appended.length === 0) {
    return { content, added, updated, resolved };
  }

  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    out.push(replace.get(i) ?? lines[i]);
    const ins = insert.get(i);
    if (ins !== undefined) out.push(...ins);
  }
  if (appended.length > 0) {
    // One blank line of separation, and never two: the template ends in a
    // comment with no trailing blank, while a file that already holds
    // entries ends in `---` + blank.
    while (out.length > 0 && out[out.length - 1].trim() === "") out.pop();
    out.push("", ...appended);
  }
  return {
    content: out.join("\n"),
    added,
    updated,
    resolved,
  };
}

// ---------------------------------------------------------------------------
// Gate → queue adapters
// ---------------------------------------------------------------------------

/** `GateKey` → the `Blocks:` value its entries carry. Spelled from the gate
 *  key rather than listed, so a new gate cannot arrive with a queue scope
 *  nobody recognizes. */
export const blocksForGate = (gateKey: string): string => `gate-${gateKey}`;

/** `phase-<n>` — the `Blocks:` value a checkpoint-era entry carries. */
export const blocksForPhase = (phase: number): string => `phase-${phase}`;
