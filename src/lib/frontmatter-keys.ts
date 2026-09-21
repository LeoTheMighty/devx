// Block-scoped, shape-agnostic frontmatter key access — shared by every
// hand-rolled reader and writer of a spec's `---` block.
//
// devx does not YAML-parse specs on the write path; it edits the `---` block
// line by line. Each site used to carry its own key regex, and they
// disagreed about a key written BARE (`owner:` with nothing after the
// colon). `updateSpecForClaim` detected with `/^owner:\s/`, which requires a
// whitespace character after the colon — a bare key misses, `ownerIdx` stays
// -1, and the insert branch splices a SECOND `owner:` into frontmatter that
// already had one — invalid YAML, witnessed on palateful's `imptb1`
// (828385). `verify-claim`'s reader then took the last match and read the
// empty one as `""`. (828385 said this made `/devx` Phase 1 HALT against the
// legitimate owner. It did not: ownership is decided from the lock, and the
// spec's `owner:` only feeds an advisory drift flag. Corrected in
// debug-108c57.)
//
// The bug was never that a bare key is invalid. A bare key is valid YAML, and
// it is load-bearing in devx's own templates: `gate_status:`, `outcome:` and
// `gate_verdicts:` head nested mappings in 14 of 25 plan specs, and `spawned:`
// bare is an empty list. The defect was a WRITER using a detector stricter
// than the YAML it was editing. So the fix is this primitive, not a rule
// against the data.
//
// Routing every writer through `upsertFrontmatterKey` is what makes the
// property durable. The alternative — each site enumerating the keys it
// knows about — has the failure mode one level up: the next key to acquire a
// writer re-opens the hole silently, because nothing reminds its author that
// bare keys exist. Here a new key inherits correctness.
//
// Spec: debug/debug-828385-2026-09-20T10:06-claim-splices-duplicate-owner-key.md

import { splitFrontmatter as splitFrontmatterRaw } from "./engine/frontmatter.js";

/** A spec's `---` block, split from the text around it. */
export interface FrontmatterBlock {
  /** The block's lines, WITHOUT the `---` fences. Mutate, then `render`. */
  lines: string[];
  /** The newline that followed the closing `---` ("" at end-of-file). */
  delim: string;
  /** Everything after that newline. */
  body: string;
}

/**
 * Split `content` into the frontmatter block as LINES, or `null` when there
 * is no block.
 *
 * Block-scoping is the load-bearing half of reading a spec correctly, and
 * it is the half that is easy to skip: a spec *about* frontmatter keys
 * carries frontmatter-shaped lines in its body by construction. 828385's own
 * body holds a bare `owner:` inside a fenced ```yaml sample, and a correctly
 * line-anchored `grep '^owner:$'` over the whole file reports the spec as
 * carrying the bug it documents. Anchoring does not save you; scoping does.
 *
 * Delegates the actual `---` parse to `engine/frontmatter.ts`'s
 * `splitFrontmatter` rather than re-deriving it. That module owns the fence
 * regex, and it is CRLF-tolerant (`/^---\r?\n…\r?\n---(\r?\n|$)/`) where a
 * fresh hand-rolled `/^---\n…\n---/` is not: on a CRLF-normalized spec the
 * naive version finds NO frontmatter, which surfaces as "spec missing
 * frontmatter block" from the claim and as a silent "no owner" from doctor.
 * Two parsers for one format is the `debug-9f24c7` class; one parser, two
 * views, is not.
 *
 * Named `…Lines` rather than sharing the bare `splitFrontmatter`: the
 * unqualified name belongs to the thing that does the work, and this is a
 * view over it. Two same-named exports with different return contracts is
 * the `artifacts.ts` "two spellings of one path" hazard, and it is worst
 * exactly where it would bite — a hand-resolved merge conflict picking
 * whichever import the editor offered. Decided with shrule (AC 6) rather
 * than left for a resolution to guess.
 *
 * Line endings inside the block normalize to LF on write. The engine parse
 * keeps `\r` on interior lines, so they are stripped here and re-joined with
 * `\n` — a spec whose frontmatter round-trips through an edit comes back LF,
 * which is what every authoring site already emits.
 */
export function splitFrontmatterLines(content: string): FrontmatterBlock | null {
  const raw = splitFrontmatterRaw(content);
  if (raw === null) return null;
  return {
    // An empty block has no lines, not one empty line — otherwise a write
    // renders a stray blank line inside the fences (review round 2).
    lines: raw.fmText === "" ? [] : raw.fmText.split(/\r?\n/),
    delim: raw.delim,
    body: raw.body,
  };
}

/** Re-join a (possibly mutated) block with its surroundings. */
export function renderFrontmatter(block: FrontmatterBlock): string {
  // Mirrors engine/frontmatter.ts's (module-private) joinFrontmatter: a
  // block that ended the file with no trailing newline gets one back, so a
  // rendered spec is never missing its final newline.
  const delim =
    block.delim === "" && block.body === "" ? "\n" : block.delim;
  const inner = block.lines.length > 0 ? `${block.lines.join("\n")}\n` : "";
  return `---\n${inner}---${delim}${block.body}`;
}

/**
 * Edit a spec's frontmatter lines in place and return the new content,
 * keeping the file's own line endings. `edit` mutates the lines and returns
 * false to abandon the edit. Returns null when there is no frontmatter
 * block or the edit was abandoned.
 *
 * This is the second of two render paths, on purpose. `renderFrontmatter`
 * normalizes the block to LF, which claim and mark-done document and test.
 * The loop and split writers had the opposite contract — a CRLF spec keeps
 * its CRLF (v2l101 EC-MED-5) — and moving them onto the shared key logic
 * (debug-108c57 items 1-3) must not silently change that. The key-finding
 * rules are shared; only the line ending of the result differs.
 */
export function editFrontmatter(
  content: string,
  edit: (lines: string[]) => boolean,
): string | null {
  const raw = splitFrontmatterRaw(content);
  if (raw === null) return null;
  const eol = /^---[ \t]*\r\n/.test(content) ? "\r\n" : "\n";
  const lines = raw.fmText === "" ? [] : raw.fmText.split(/\r?\n/);
  if (!edit(lines)) return null;
  const inner = lines.length > 0 ? `${lines.join(eol)}${eol}` : "";
  const delim = raw.delim === "" && raw.body === "" ? eol : raw.delim;
  return `---${eol}${inner}---${delim}${raw.body}`;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function keyPattern(key: string): RegExp {
  // `(?=\s|$)` is the whole point: it admits `owner:` (bare, end-of-line)
  // and `owner: x` alike, while still refusing `ownership: x`. A leading
  // `^` with no indentation allowance keeps this to TOP-LEVEL keys, so the
  // `  status: pending` nested under a bare `outcome:` is not mistaken for
  // the spec's own `status:`.
  //
  // It also admits every spelling YAML treats as the SAME key: `"owner":`,
  // `'owner':` and `owner :` (debug-108c57 item 11). A detector stricter
  // than YAML is exactly how 828385 happened — it missed a bare key, the
  // writer inserted, and the file got a second `owner`. Missing a quoted
  // key reproduces that bug by another spelling.
  const k = escapeRegex(key);
  return new RegExp(`^(?:"${k}"|'${k}'|${k})[ \\t]*:(?=\\s|$)`);
}

/**
 * Exclusive end index of the lines that belong to the top-level key at
 * `i`: the key line itself plus every following line that continues it —
 * indented children of a nested mapping, the body of a block scalar
 * (`key: |`), the indented tail of a multi-line flow value, and — under a
 * header with no value — a compact sequence at the key's own indent
 * (`spawned:` then `- a`). Blank and comment lines count only when more
 * continuation follows them; trailing ones stay outside.
 *
 * Not handled: a multi-line flow value whose continuation starts at column
 * 0 (`a: [x,` then `y]`). YAML allows it; no spec in either repo has it.
 *
 * Every mutation that removes, replaces or inserts next to a key has to use
 * this (debug-108c57 items 8-10). Touching only the header line leaves the
 * children attached to whatever precedes them — invalid YAML for a nested
 * mapping, and for a block scalar SILENT corruption: the orphaned lines
 * fold into the previous key's value and still parse.
 */
export function keyBlockEnd(lines: string[], i: number): number {
  // A header with nothing after its colon (optionally a comment) can own a
  // compact sequence written at its own indent: `spawned:` then `- a`.
  const bareHeader = /:[ \t]*(#.*)?$/.test(lines[i]);
  let end = i + 1;
  let j = i + 1;
  while (j < lines.length) {
    const l = lines[j];
    if (l.trim() === "" || /^[ \t]*#/.test(l)) {
      // Blank lines and comment lines — at any indent — are PROVISIONAL:
      // they join the block only if real continuation follows them. An
      // indented `  # set by planner` under a scalar key is not a child,
      // and treating it as one made the scalar-overwrite refusal fire on
      // specs every writer used to handle (review round 2).
      j++;
      continue;
    }
    if (/^[ \t]/.test(l) || (bareHeader && /^-( |$)/.test(l))) {
      j++;
      end = j;
      continue;
    }
    break;
  }
  return end;
}

/**
 * Indices of every top-level line declaring `key`, in document order.
 *
 * Returns all of them, not the first: callers that need to reason about
 * duplicates (a corrupted spec) must be able to see them rather than having
 * the primitive silently pick one.
 */
export function findFrontmatterKeys(lines: string[], key: string): number[] {
  const re = keyPattern(key);
  const out: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) out.push(i);
  }
  return out;
}

/**
 * Set `key` to `value`, replacing in place when it is already present and
 * inserting otherwise. Mutates `lines` and returns what it did.
 *
 * Replacement targets the FIRST occurrence and deletes any others, so a spec
 * already corrupted by the old splice converges to a single key instead of
 * growing a third (828385 AC 3).
 *
 * `afterKey` positions a fresh insert immediately after that key when it
 * exists, else at the end of the block.
 */
export function upsertFrontmatterKey(
  lines: string[],
  key: string,
  value: string,
  opts: { afterKey?: string } = {},
): { action: "replaced" | "inserted"; removedDuplicates: number } {
  const line = `${key}: ${value}`;
  const idxs = findFrontmatterKeys(lines, key);
  if (idxs.length > 0) {
    // Refuse rather than orphan (item 9). Writing a scalar over a key that
    // heads a nested mapping or a multi-line value would leave its children
    // attached to the new scalar line — `outcome: null` followed by
    // `  status: pending` — which is invalid YAML, or for a block scalar
    // parses silently as a different value. Every writer today targets a
    // scalar key, so this cannot fire on them; it exists so the first
    // caller that points this at `gate_status:` or `outcome:` fails loudly
    // instead of corrupting the spec.
    if (keyBlockEnd(lines, idxs[0]) > idxs[0] + 1) {
      throw new Error(
        `upsertFrontmatterKey: '${key}' heads a nested or multi-line value; refusing to overwrite it with a scalar`,
      );
    }
    // Keep a trailing `# comment` from the line being replaced, as the
    // loop's status writer always did (`status: ready  # parked` flips to
    // `status: blocked  # parked`). Only for an unquoted value, where a
    // ` #` can only start a comment.
    const old = valueAfterKey(lines[idxs[0]], key);
    const comment = /["']/.test(old) ? null : /(\s+#.*)$/.exec(old);
    lines[idxs[0]] = comment ? `${line}${comment[1]}` : line;
    // Remove each later duplicate TOGETHER WITH its continuation lines
    // (item 8), back to front so earlier indices stay valid.
    for (let n = idxs.length - 1; n >= 1; n--) {
      const at = idxs[n];
      lines.splice(at, keyBlockEnd(lines, at) - at);
    }
    return { action: "replaced", removedDuplicates: idxs.length - 1 };
  }
  const anchor = opts.afterKey
    ? findFrontmatterKeys(lines, opts.afterKey)[0]
    : undefined;
  if (anchor === undefined) lines.push(line);
  // After the anchor's whole block, never between the anchor and its own
  // children (item 10).
  else lines.splice(keyBlockEnd(lines, anchor), 0, line);
  return { action: "inserted", removedDuplicates: 0 };
}

/**
 * Raw text after `key:` — `""` for a bare key, `null` when absent.
 *
 * When the key is declared more than once, returns the FIRST MEANINGFUL
 * value — the first that is not bare, comment-only, an empty quoted string,
 * or a YAML null — else the first. This is the one resolution rule for
 * every reader built on this module (debug-108c57, review round 2: doctor
 * read first-wins through here while verify-claim read first-non-empty,
 * so the two disagreed on the same spec). It is right in both key orders
 * the old claim splice could produce, which only ever paired a real value
 * with a bare one.
 */
export function frontmatterKeyValue(
  lines: string[],
  key: string,
): string | null {
  const values = frontmatterKeyValues(lines, key);
  if (values.length === 0) return null;
  return values.find(isMeaningfulValue) ?? values[0];
}

const NULLISH_VALUES = new Set(["", "''", '""', "~", "null", "Null", "NULL"]);

/** A raw value (text after the colon) with a trailing or whole-line
 *  comment removed. */
function stripComment(raw: string): string {
  const t = raw.trim();
  if (t.startsWith("#")) return "";
  return /["']/.test(t) ? t : t.replace(/\s+#.*$/, "");
}

/** Bare, or only a comment — YAML reads both as null. */
export function isBareValue(raw: string): boolean {
  return stripComment(raw) === "";
}

function isMeaningfulValue(raw: string): boolean {
  return !NULLISH_VALUES.has(stripComment(raw));
}

/** Text after the key's colon, for any spelling `keyPattern` accepts. A
 *  fixed `key.length + 1` slice is wrong once `"owner":` or `owner :` can
 *  match. */
function valueAfterKey(line: string, key: string): string {
  const m = keyPattern(key).exec(line);
  return m ? line.slice(m[0].length) : "";
}

/** Every value `key` is declared with, in document order (a corrupted spec
 *  can carry several). Callers that must resolve a duplicate deliberately
 *  use this rather than guessing from `frontmatterKeyValue`. */
export function frontmatterKeyValues(lines: string[], key: string): string[] {
  return findFrontmatterKeys(lines, key).map((i) => valueAfterKey(lines[i], key));
}

/**
 * Top-level keys declared more than once, in first-seen order.
 *
 * Generic on purpose. Duplicate keys are invalid YAML whatever the key is,
 * and enumerating the ones devx happens to write today is how the next
 * writer re-opens the hole.
 */
export function duplicateFrontmatterKeys(lines: string[]): string[] {
  const seen = new Map<string, number>();
  for (const line of lines) {
    // Conservative on purpose. A looser "anything up to the first colon"
    // reads a column-0 YAML list item (`- foo: bar`) as a key named
    // `- foo` — the same class of reader-disagrees-with-YAML defect this
    // module exists to end. Validated against every top-level key in
    // devx + palateful (168 distinct): none is missed by this pattern.
    // Quoted and space-before-colon spellings name the same key as the
    // bare one (item 11), so they normalize to it before counting.
    const m = /^(?:"([^"]+)"|'([^']+)'|([A-Za-z_][A-Za-z0-9_. -]*?))[ \t]*:(?=\s|$)/.exec(line);
    if (!m) continue;
    const k = m[1] ?? m[2] ?? m[3].trimEnd();
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
}

/** A structural problem in one spec's frontmatter. */
export interface SpecFrontmatterIssue {
  kind: "duplicate" | "bare";
  keys: string[];
}

/** Scalar keys that devx's own readers and writers act on. A bare one of
 *  these is the 828385 hazard; a bare `gate_status:` or `outcome:` heads a
 *  nested mapping and is normal. */
const SCALAR_SPEC_KEYS = ["owner", "branch"] as const;

/**
 * Structural problems in a spec's frontmatter, for the validator and for
 * `devx doctor` — one rule set, two callers (debug-108c57 items 14-15).
 *
 * - `duplicate`: any key declared twice. Invalid YAML whatever the key.
 * - `bare`: `owner:` or `branch:` with nothing after the colon. Keyed to
 *   those two on purpose: bareness is not wrong in general (it heads nested
 *   mappings in 14 of devx's 25 plan specs), but these are scalars that
 *   devx reads and writes, and `null` is the correct empty spelling.
 *
 * What is NOT checked, and why. 828385 AC 7b also asked that `owner:` be
 * null or a `/devx-` session token. Measured 2026-09-21 across devx and
 * palateful: 23 of 223 real owner values are neither — 19 bare `/devx`, 2
 * `interactive-session-…`, 1 human session label, 1 `unassigned` — and
 * most are legitimate human or interactive ownership. Ownership is decided
 * from the lock, not from this field, so flagging those would be noise with
 * no hazard behind it, and a noisy check gets ignored. The `branch:`
 * sentinel case (`unassigned`) cannot be caught by shape at all — it is a
 * valid ref name — and belongs to merge-gate's reader (`debug-1dfbdd`).
 */
export function specFrontmatterIssues(lines: string[]): SpecFrontmatterIssue[] {
  const out: SpecFrontmatterIssue[] = [];
  const dupes = duplicateFrontmatterKeys(lines);
  if (dupes.length > 0) out.push({ kind: "duplicate", keys: dupes });
  const bare = SCALAR_SPEC_KEYS.filter((k) => {
    const values = frontmatterKeyValues(lines, k);
    // Bare only when EVERY declaration is bare; a duplicate pair with one
    // real value is already reported as `duplicate`.
    return values.length > 0 && values.every(isBareValue);
  });
  if (bare.length > 0) out.push({ kind: "bare", keys: [...bare] });
  return out;
}
