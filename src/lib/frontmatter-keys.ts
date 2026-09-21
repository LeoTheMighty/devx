// Block-scoped, shape-agnostic frontmatter key access — shared by every
// hand-rolled reader and writer of a spec's `---` block.
//
// devx does not YAML-parse specs on the write path; it edits the `---` block
// line by line. Each site used to carry its own key regex, and they
// disagreed about a key written BARE (`owner:` with nothing after the
// colon). `updateSpecForClaim` detected with `/^owner:\s/`, which requires a
// whitespace character after the colon — a bare key misses, `ownerIdx` stays
// -1, and the insert branch splices a SECOND `owner:` into frontmatter that
// already had one. `verify-claim`'s reader then took the last match, read the
// empty one as `""`, and `/devx` Phase 1's resume-detection HALTed on an
// ownership mismatch against the legitimate owner — a claim poisoning its own
// resume path (828385; witnessed on palateful's `imptb1`).
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
    lines: raw.fmText.split(/\r?\n/),
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
  return `---\n${block.lines.join("\n")}\n---${delim}${block.body}`;
}

function keyPattern(key: string): RegExp {
  // `(?=\s|$)` is the whole point: it admits `owner:` (bare, end-of-line)
  // and `owner: x` alike, while still refusing `ownership: x`. A leading
  // `^` with no indentation allowance keeps this to TOP-LEVEL keys, so the
  // `  status: pending` nested under a bare `outcome:` is not mistaken for
  // the spec's own `status:`.
  return new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:(?=\\s|$)`);
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
    lines[idxs[0]] = line;
    // Splice from the back so earlier indices stay valid.
    for (let i = idxs.length - 1; i >= 1; i--) lines.splice(idxs[i], 1);
    return { action: "replaced", removedDuplicates: idxs.length - 1 };
  }
  const anchor = opts.afterKey
    ? findFrontmatterKeys(lines, opts.afterKey)[0]
    : undefined;
  if (anchor === undefined) lines.push(line);
  else lines.splice(anchor + 1, 0, line);
  return { action: "inserted", removedDuplicates: 0 };
}

/**
 * Raw text after `key:` — `""` for a bare key, `null` when absent.
 *
 * Takes the FIRST occurrence. See `parseSpecClaimFields` in verify-claim.ts
 * for why first rather than last: the old splice inserted the authoritative
 * owner ABOVE the stale bare key, so first-wins reads corrupted specs
 * correctly where last-wins reads them as empty.
 */
export function frontmatterKeyValue(
  lines: string[],
  key: string,
): string | null {
  const idxs = findFrontmatterKeys(lines, key);
  if (idxs.length === 0) return null;
  return lines[idxs[0]].slice(key.length + 1);
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
    const m = /^([A-Za-z_][A-Za-z0-9_.-]*):(?=\s|$)/.exec(line);
    if (!m) continue;
    seen.set(m[1], (seen.get(m[1]) ?? 0) + 1);
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
}
