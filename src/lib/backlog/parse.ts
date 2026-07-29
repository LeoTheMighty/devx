// Pure backlog-file parsers shared by mgr103 reconcile + future Phase 2
// epic-events-stream + Concierge consumers (party-mode locked decision —
// epic-devx-manage-minimal.md, Architect lens). Phase 1 ships parsing only;
// event emission is deferred to Phase 2.
//
// Three parsers, one snapshot type:
//   parseDevMd(content)       → DevRow[]
//   parseInterviewMd(content) → InterviewQuestion[]
//   parseManualMd(content)    → ManualItem[]
//   parseBacklogSnapshot(io)  → BacklogSnapshot (combines all three)
//
// All parsers are pure (string in → structured rows out). They're tolerant
// of formatting drift: unknown lines are ignored rather than throwing, so a
// half-edited DEV.md doesn't crash the manager mid-tick. Callers (reconcile,
// Phase 2 events stream) decide what to do with the parsed rows.
//
// Format anchors are pinned by the existing repo conventions documented in
// CLAUDE.md "Spec file convention" + INTERVIEW.md preamble + MANUAL.md
// preamble. Tests in test/backlog-parse.test.ts cover the canonical shapes
// + adversarial-edge fixtures (mixed checkbox states, struck rows, missing
// "Status:" text, missing "Blocks:" text).
//
// Spec: dev/dev-mgr103-2026-04-28T19:30-manage-reconcile.md
// Epic: _bmad-output/planning-artifacts/epic-devx-manage-minimal.md

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SpecStatus =
  | "ready"
  | "in-progress"
  | "blocked"
  | "done"
  | "deleted"
  | "superseded";

export type SpecType =
  | "dev"
  | "plan"
  | "test"
  | "debug"
  | "focus"
  | "learn"
  | "qa";

export interface DevRow {
  /** 0-indexed line number in DEV.md. */
  lineIndex: number;
  /** Verbatim line text (post-trim). */
  raw: string;
  /** Spec type — extracted from the file path (`dev/dev-...`). */
  type: SpecType;
  /** Hash extracted from the filename (e.g. `mgr103`). */
  hash: string;
  /** Relative path to the spec file (e.g. `dev/dev-mgr103-...md`). */
  path: string;
  /** Title text after the em-dash separator on the row. */
  title: string;
  /** Resolved status — frontmatter `Status:` text wins; checkbox is the fallback. */
  status: SpecStatus;
  /**
   * Other spec hashes this row's blocked_by list references. Empty if no
   * "Blocked-by:" text. Hashes are normalized to bare `mrg101`-style (the
   * "dev-" prefix and ".md" suffix are stripped if present).
   */
  blocked_by: string[];
  /** True iff the row is wrapped in ~~…~~ (struck — abandoned/deleted). */
  struck: boolean;
  /**
   * Slug of the `### Epic — <name> …` section this row sits under, or null
   * when the row is above any epic heading (or under a non-epic heading at
   * the same/shallower depth). Additive (mlc106) — every pre-existing
   * consumer ignores it; `--epic` scoping is the first reader.
   *
   * OPTIONAL rather than required on purpose: `parseDevMd` always sets both
   * fields (null when there's no heading), but hand-built DevRow literals in
   * tests and callers predate mlc106. Optionality keeps them compiling
   * untouched, so the epic model lands with zero mechanical fixture churn
   * (E-8's "no existing test weakened" box). Readers normalize with
   * `?? null` — never assume the field is present.
   */
  epicSlug?: string | null;
  /** `plan: <hash>` captured from the same heading, or null when absent. */
  epicPlanHash?: string | null;
}

export interface InterviewQuestion {
  /** Q identifier (the digits — e.g. "1" for "Q#1"). Stored as-typed (string). */
  qNum: string;
  /** Whether the checkbox is checked (`[x]`) or there's a "→ Answer:" line. */
  answered: boolean;
  /** Spec hashes referenced in the "Blocks:" line. Empty if none parseable. */
  blocks: string[];
}

export interface ManualItem {
  /** M identifier (e.g. "M1.2", "M4.3", "MS.1", "MP0.2"). */
  id: string;
  /** Whether the checkbox is checked. */
  checked: boolean;
  /** Spec hashes referenced in the "Blocks:" line. Empty if none parseable. */
  blocks: string[];
}

export interface BacklogSnapshot {
  dev: DevRow[];
  interview: InterviewQuestion[];
  manual: ManualItem[];
}

// ---------------------------------------------------------------------------
// DEV.md parser
// ---------------------------------------------------------------------------

// Top-level row shape:
//   - [<state>] `<type>/<type>-<hash>-<ts>-<slug>.md` — <title>. Status: <status>. ...
// Or struck:
//   - ~~`<type>/<type>-<hash>-...md` — ...~~
//
// `<state>` ∈ { ' ', '/', '-', 'x' }. Frontmatter Status field is the source
// of truth, but DEV.md rows are the only thing the parser sees here — the
// "Status: <text>" text inside the line is treated as authoritative for
// reconcile purposes. The Status field check is what mgr104+ keys off of when
// flipping the checkbox; reconcile is consuming a snapshot, not flipping it.
//
// Non-row lines (headers, prose) are silently skipped. A row missing a
// recognizable hash is also skipped — defends against half-edited files.

const ROW_RE =
  /^- (?:\[(?<state>[ \/\-x])\]\s+)?(?<struckOpen>~~)?`(?<path>(?<type>dev|plan|test|debug|focus|learn|qa)\/\k<type>-(?<hash>[a-z0-9]{3,12})-[^`]+?\.md)`(?<rest>.*)$/;

const STATUS_TEXT_RE = /Status:\s*([A-Za-z\-]+)/;
const BLOCKED_BY_TEXT_RE = /Blocked-by:\s*([^.\n]+?)(?:\.|$)/i;

// Epic section headings (mlc106 / design §Architecture 6). Canonical shape:
//   ### Epic — multi-loop-concurrency (plan: 20eb6f)
// Tolerated variants seen in this repo's own DEV.md:
//   ### Epic 1 — BMAD audit                        (numbered, no plan hash)
//   ### Epic — portability-install (Track 1, plan: b3f7a1)   (extra parenthetical text)
// The name is everything between the dash and the first ` (`, or to EOL when
// there is no parenthetical; the plan hash is pulled independently from a
// `plan: <hash>` anywhere on the heading line, so parenthetical prose before
// it (the "Track 1, " case) doesn't break the capture.
const ATX_HEADING_RE = /^(#{1,6})\s+(.*)$/;
// Capture any run of alphanumerics, then range-check — an anchored
// `{3,12}` would fail to match a 13-char hash outright and silently yield
// `null` instead of an honest "that isn't a hash" (review BH#9).
const EPIC_PLAN_HASH_RE = /\bplan:\s*(?:plan-)?([a-z0-9]+)/i;
/** A heading whose remaining name is only plan metadata isn't named at all. */
const PLAN_ONLY_NAME_RE = /^plan:\s*\S+$/i;
/**
 * Name/description separators accepted after the `Epic` prefix, most
 * specific first. Em/en dash is canonical; the spaced ASCII forms are
 * accepted because epic headings are 100% hand- or agent-typed (nothing in
 * the codebase emits them) and an editor that autocorrects `—` back to `-`
 * would otherwise orphan every row under that heading with no diagnostic
 * (review BH#2/EC#6). Requiring SPACES around the ASCII forms is what keeps
 * `### Epic 2-b — gamma` splitting on the em dash rather than on the `-`
 * inside the number.
 */
const EPIC_SEPARATORS = ["—", "–", " -- ", " - "] as const;

/**
 * Extract an epic heading's display name, or null when the text isn't an
 * epic heading (or names nothing).
 */
function epicNameFrom(text: string): string | null {
  if (!/^Epic\b/.test(text)) return null;
  let name: string | null = null;
  for (const sep of EPIC_SEPARATORS) {
    const i = text.indexOf(sep);
    if (i > 0) {
      name = text.slice(i + sep.length).trim();
      break;
    }
  }
  if (name === null) return null;
  // Strip ONE trailing parenthetical — that's where `(plan: …)` and
  // `(Track 1, plan: …)` live. Splitting at the FIRST ` (` instead would
  // truncate `Epic — devx (v2) engine` down to `devx`, collapsing two
  // distinct epics onto one key (review EC#7).
  name = name.replace(/\s*\([^()]*\)\s*$/, "").trim();
  // `### Epic — (plan: ab12cd)` and `### Epic — plan: ab12cd` name nothing;
  // without this they'd slugify to the phantom key `plan-ab12cd`.
  if (name === "" || PLAN_ONLY_NAME_RE.test(name)) return null;
  return name;
}

/**
 * Kebab-case an epic heading's display name. `Alpha Wave` → `alpha-wave`;
 * `` `/devx-init` skill `` → `devx-init-skill`. Non-alphanumerics collapse to
 * single hyphens so a heading and a `--epic` argument that differ only in
 * punctuation still match (the normalization is applied to BOTH sides).
 */
export function epicSlugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface EpicSection {
  slug: string;
  planHash: string | null;
  /** Heading depth (# count) — a later heading at this depth or shallower
   *  ends the section; a deeper one (a sub-heading inside the epic) does
   *  not. Without the depth check, a `#### Notes` bullet list inside an
   *  epic would orphan every row below it. */
  depth: number;
}

/** Track the current epic section as a heading line goes by. */
function epicSectionFor(
  line: string,
  current: EpicSection | null,
): EpicSection | null {
  const heading = ATX_HEADING_RE.exec(line);
  if (!heading) return current;
  const depth = heading[1].length;
  const text = heading[2].trim();
  const name = epicNameFrom(text);
  if (name !== null) {
    const planMatch = EPIC_PLAN_HASH_RE.exec(text);
    const rawHash = planMatch ? planMatch[1].toLowerCase() : null;
    const planHash =
      rawHash !== null && rawHash.length >= 3 && rawHash.length <= 12 ? rawHash : null;
    const slug = epicSlugify(name);
    // A heading that slugifies to nothing is not a usable partition key —
    // treat it as a plain heading so rows below it get null rather than an
    // empty-string slug that `--epic ""` could match.
    if (slug === "") return depth <= (current?.depth ?? depth) ? null : current;
    return { slug, planHash, depth };
  }
  // Non-epic heading: ends the section only when it's at the same depth or
  // shallower (a real sibling/parent section boundary).
  if (current !== null && depth <= current.depth) return null;
  return current;
}

/**
 * Strip a trailing `\r` left over from CRLF line endings. Files saved by
 * Windows editors produce `\r\n`, and `content.split("\n")` keeps the `\r`;
 * downstream regex anchors and `splitHashes` token checks then break
 * silently. Stripping here keeps every parser CRLF-tolerant in one place.
 */
function stripCR(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

/**
 * Replace every line inside a ``` ... ``` fenced block with an empty
 * string, preserving line indices for downstream tooling (DevRow.lineIndex
 * stays accurate). Fences may be indented (sub-bullet code blocks); the
 * leading-whitespace allowance matches CommonMark's tolerance.
 *
 * Without this, an example block in INTERVIEW.md (`Example: \`\`\`markdown
 * - [x] Q#7 ... \`\`\``) parses as a real Q#7 entry — two reviewers flagged
 * (BH#2 fence-state, EC#3 answer-marker false positive). Pre-stripping the
 * fenced lines closes both via the same primitive.
 */
export function blankFencedLines(lines: string[]): string[] {
  // Both CommonMark fence characters. Tildes matter more since mlc106: a
  // `~~~`-fenced example containing `### Epic — …` would otherwise not just
  // inject a phantom ROW (the pre-mlc106 risk) but MIS-ATTRIBUTE every real
  // row below it to a fictional epic (review BH#4). Three-or-more is
  // required, so a struck row (`- ~~…~~`) can never read as a fence.
  let fence: "`" | "~" | null = null;
  return lines.map((line) => {
    const m = /^[ \t]*(`{3,}|~{3,})/.exec(line);
    if (m) {
      const kind = m[1][0] as "`" | "~";
      // A fence only closes with its OWN character (CommonMark): a `~~~`
      // line inside a ``` block is content, not a terminator.
      if (fence === null) {
        fence = kind;
        return "";
      }
      if (fence === kind) {
        fence = null;
        return "";
      }
      return "";
    }
    return fence !== null ? "" : line;
  });
}

export interface EpicHeading {
  slug: string;
  planHash: string | null;
}

/**
 * Every `### Epic — …` section declared in a backlog file, whether or not it
 * currently has rows under it.
 *
 * Row-derived epic keys alone are not enough for `--epic` validation: an
 * epic heading whose items are all done — or that was scaffolded ahead of
 * its rows — genuinely exists, and refusing `--epic <it>` with "matches no
 * section" sends the operator hunting a typo that isn't there (review EC#8).
 */
export function parseEpicHeadings(content: string): EpicHeading[] {
  const lines = blankFencedLines(content.split("\n").map(stripCR));
  const out: EpicHeading[] = [];
  const seen = new Set<string>();
  let epic: EpicSection | null = null;
  for (const line of lines) {
    const next = epicSectionFor(line, epic);
    if (next !== null && next !== epic && !seen.has(next.slug)) {
      seen.add(next.slug);
      out.push({ slug: next.slug, planHash: next.planHash });
    }
    epic = next;
  }
  return out;
}

export function parseDevMd(content: string): DevRow[] {
  const lines = blankFencedLines(content.split("\n").map(stripCR));
  const rows: DevRow[] = [];
  let epic: EpicSection | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    epic = epicSectionFor(line, epic);
    const m = ROW_RE.exec(line);
    if (!m || !m.groups) continue;
    const groups = m.groups as {
      state?: string;
      struckOpen?: string;
      path: string;
      type: string;
      hash: string;
      rest: string;
    };
    const struck =
      groups.struckOpen === "~~" || /~~\s*$/.test(line);
    // Title: the chunk after `<path>` ` ` and the dash separator, ending at
    // either a sentence-ending period (the canonical shape) or a `Status:` /
    // `Blocked-by:` / `Blocks:` marker (defends against authors who omit the
    // trailing period — Edge Case Hunter EC#5). Em + en + (double-)hyphen all
    // tolerated as separators (Blind Hunter BH#5). The `--?` form ensures we
    // consume both hyphens of `--` rather than letting the second leak into
    // the captured title.
    const titleMatch =
      /^\s*(?:[—–]|--?)\s*([^\n]+?)(?:\s*(?:\.\s|\.$|$|(?=\s(?:Status|Blocked-by|Blocks):)))/.exec(
        groups.rest,
      );
    const title = titleMatch ? titleMatch[1].trim() : "";

    const statusMatch = STATUS_TEXT_RE.exec(groups.rest);
    const checkboxStatus = checkboxToStatus(groups.state);
    let status: SpecStatus;
    if (struck) {
      // Struck rows are abandoned. Some prior rows in MANUAL/INTERVIEW use
      // ~~~~ for "N/A — superseded"; same shape applies to DEV.md.
      // Distinguish "deleted" (cleanly abandoned) vs "superseded" (replaced)
      // by the presence of "(superseded by …)" text — fallback "deleted".
      status = /superseded/i.test(groups.rest) ? "superseded" : "deleted";
    } else if (statusMatch) {
      status = normalizeStatus(statusMatch[1]) ?? checkboxStatus ?? "ready";
    } else if (checkboxStatus) {
      status = checkboxStatus;
    } else {
      // Bare row with neither checkbox nor explicit status text. Treat as
      // ready — same default as the spec file convention.
      status = "ready";
    }

    const blockedByMatch = BLOCKED_BY_TEXT_RE.exec(groups.rest);
    const blocked_by = blockedByMatch
      ? splitHashes(blockedByMatch[1])
      : [];

    rows.push({
      lineIndex: i,
      raw: line,
      type: groups.type as SpecType,
      hash: groups.hash,
      path: groups.path,
      title,
      status,
      blocked_by,
      struck,
      epicSlug: epic?.slug ?? null,
      epicPlanHash: epic?.planHash ?? null,
    });
  }
  return rows;
}

function checkboxToStatus(state: string | undefined): SpecStatus | null {
  switch (state) {
    case " ":
      return "ready";
    case "/":
      return "in-progress";
    case "-":
      return "blocked";
    case "x":
      return "done";
    default:
      return null;
  }
}

function normalizeStatus(text: string): SpecStatus | null {
  const t = text.toLowerCase().trim();
  if (
    t === "ready" ||
    t === "in-progress" ||
    t === "blocked" ||
    t === "done" ||
    t === "deleted" ||
    t === "superseded"
  ) {
    return t;
  }
  return null;
}

/**
 * Extract bare hashes from a "Blocked-by:" or "Blocks:" text fragment.
 * Tolerant of separator variants (`,`, ` ; `, ` and `, whitespace) and prefix
 * variants (`dev-mgr101`, `\`dev-mgr101\``, bare `mgr101`).
 */
function splitHashes(text: string): string[] {
  const hashes: string[] = [];
  // Strip backticks + commas + "and" + whitespace; keep alnum + hyphen.
  // Then split on whitespace and pull the trailing hash component out of
  // each token. Case-insensitive throughout — a hand-edit `dev-MGR101` is
  // normalized to `mgr101` (Blind Hunter BH#9 — the prior version's
  // case-sensitive file/dash matchers silently dropped uppercase tokens).
  const tokens = text
    .replace(/`/g, " ")
    .replace(/,/g, " ")
    .replace(/\band\b/gi, " ")
    .split(/\s+/)
    .filter(Boolean);
  for (const tok of tokens) {
    // Cases (case-insensitive):
    //   dev/dev-mgr101-2026-04-28T19:30-manage-scaffold.md → mgr101
    //   dev-mgr101                                          → mgr101
    //   mgr101                                              → mgr101
    let h: string | null = null;
    const fileMatch = /^[a-z]+\/[a-z]+-([a-z0-9]{3,12})-/i.exec(tok);
    if (fileMatch) h = fileMatch[1].toLowerCase();
    if (!h) {
      const dashMatch = /^[a-z]+-([a-z0-9]{3,12})$/i.exec(tok);
      if (dashMatch) h = dashMatch[1].toLowerCase();
    }
    // Bare-token check: must contain at least one letter — pure-digit
    // tokens like "12345" are typos / row numbers, not hashes. Edge Case
    // Hunter EC#6: prior version accepted "12345" as a phantom blocker
    // and held the row indefinitely as unresolved.
    if (
      !h &&
      /^[a-z0-9]{3,12}$/i.test(tok) &&
      /[a-z]/i.test(tok)
    ) {
      h = tok.toLowerCase();
    }
    if (h && !hashes.includes(h)) hashes.push(h);
  }
  return hashes;
}

// ---------------------------------------------------------------------------
// INTERVIEW.md parser
// ---------------------------------------------------------------------------

// Question header shape:
//   - [<state>] **Q#<num> — title** ...
//   - [<state>] Q#<num> ...           (less-canonical fallback)
// Where state ∈ { ' ', 'x' }. Sub-bullets follow until the next top-level
// `- [` line. We collect sub-bullet text to look for "Blocks:" + "→ Answer:"
// markers.

const INTERVIEW_HEADER_RE =
  /^- \[(?<state>[ x])\]\s+(?:\*\*)?Q#(?<num>\d+)/;
const ANSWER_MARKER_RE = /(?:^|\s)→\s*Answer\s*:/m;
const BLOCKS_TEXT_RE = /Blocks?:\s*([^.\n]+?)(?:\.|$)/i;

// Fenced-block stripping happens once at the top of each parser via
// blankFencedLines() — every fenced line is replaced by "" so downstream
// regex anchors never see fenced content. The body-collection helpers
// below operate on the already-blanked lines, so no per-body re-strip is
// needed.

export function parseInterviewMd(content: string): InterviewQuestion[] {
  const lines = blankFencedLines(content.split("\n").map(stripCR));
  const questions: InterviewQuestion[] = [];
  for (let i = 0; i < lines.length; i++) {
    const headerMatch = INTERVIEW_HEADER_RE.exec(lines[i]);
    if (!headerMatch || !headerMatch.groups) continue;
    const checkboxAnswered = headerMatch.groups.state === "x";
    const qNum = headerMatch.groups.num;

    // Collect the body — every following line until the next question
    // header (or EOF). Edge Case Hunter EC#2: terminating on any column-0
    // `^- ` prematurely ate context bullets between header + sub-bullets;
    // header-regex match is the precise terminator. ATX headings still
    // bound the section.
    let bodyEnd = i + 1;
    while (bodyEnd < lines.length) {
      const next = lines[bodyEnd];
      if (INTERVIEW_HEADER_RE.test(next)) break;
      if (/^#{1,6}\s/.test(next)) break;
      bodyEnd++;
    }
    const body = lines.slice(i, bodyEnd).join("\n");
    const answered = checkboxAnswered || ANSWER_MARKER_RE.test(body);
    const blocksMatch = BLOCKS_TEXT_RE.exec(body);
    const blocks = blocksMatch ? splitHashes(blocksMatch[1]) : [];

    questions.push({ qNum, answered, blocks });
    // Skip past the body so we don't re-scan it for nested bullets.
    i = bodyEnd - 1;
  }
  return questions;
}

// ---------------------------------------------------------------------------
// MANUAL.md parser
// ---------------------------------------------------------------------------

// Manual item header shape:
//   - [<state>] **M<id> — title**
//   - [<state>] ~~**M<id> — title**~~ N/A — ...   (struck = N/A or done-with-note)
// Where state ∈ { ' ', 'x' }. id is "M1.2", "M4.3", "MS.1", "MP0.2", etc.
// Sub-bullets carry the "Blocks:" text just like INTERVIEW.

// M id shapes seen in the wild: M1.2, M3.1, M4.4 (digit + .digit), MS.1
// (letter + .digit), MP0.2 (letter+digit + .digit). Pattern allows any
// alnum chunk after the leading M, then a required .digit suffix — the
// suffix is what disambiguates an item id from arbitrary `**Manage**`
// prose that might otherwise match.
const MANUAL_HEADER_RE =
  /^- \[(?<state>[ x])\]\s+(?:~~)?(?:\*\*)?(?<id>M[A-Z0-9]+\.[0-9]+)/;

export function parseManualMd(content: string): ManualItem[] {
  const lines = blankFencedLines(content.split("\n").map(stripCR));
  const items: ManualItem[] = [];
  for (let i = 0; i < lines.length; i++) {
    const headerMatch = MANUAL_HEADER_RE.exec(lines[i]);
    if (!headerMatch || !headerMatch.groups) continue;
    const checked = headerMatch.groups.state === "x";
    const id = headerMatch.groups.id;

    // Body terminator: next manual header or ATX heading. Same rationale
    // as parseInterviewMd — column-0 `^- ` was too eager and cut bodies
    // short on free-form context bullets between header and sub-bullets.
    let bodyEnd = i + 1;
    while (bodyEnd < lines.length) {
      const next = lines[bodyEnd];
      if (MANUAL_HEADER_RE.test(next)) break;
      if (/^#{1,6}\s/.test(next)) break;
      bodyEnd++;
    }
    const body = lines.slice(i, bodyEnd).join("\n");
    const blocksMatch = BLOCKS_TEXT_RE.exec(body);
    const blocks = blocksMatch ? splitHashes(blocksMatch[1]) : [];

    items.push({ id, checked, blocks });
    i = bodyEnd - 1;
  }
  return items;
}

// ---------------------------------------------------------------------------
// Combined snapshot
// ---------------------------------------------------------------------------

export interface BacklogSnapshotInput {
  /** DEV.md contents — required (the central backlog). */
  devMd: string;
  /** INTERVIEW.md contents — optional; treated as empty when absent. */
  interviewMd?: string;
  /** MANUAL.md contents — optional; treated as empty when absent. */
  manualMd?: string;
}

export function parseBacklogSnapshot(io: BacklogSnapshotInput): BacklogSnapshot {
  return {
    dev: parseDevMd(io.devMd),
    interview: io.interviewMd ? parseInterviewMd(io.interviewMd) : [],
    manual: io.manualMd ? parseManualMd(io.manualMd) : [],
  };
}
