// Spec-file + backlog-row edits the loop orchestrator owns (v2l101).
//
// The memory-mapping rule (v2/04 §2): gnhf's notes.md ≡ the spec's
// append-only Status log — same fields (Summary/Changes/Learnings,
// [FAIL]/[ERROR] prefixes), same ONLY-the-orchestrator-writes rule, but ours
// lives on-branch in the spec so the history merges. Workers never touch it;
// every append below is loop-driver code.
//
// Pure composers + thin write wrappers:
//
//   composeStatusEntry(...)     — one status-log entry (multi-line bullet).
//   appendToStatusLog(content, entry) — section-aware append (same section
//                                  discipline as updateSpecForClaim in
//                                  devx/claim.ts; a spec without the section
//                                  gets one appended at EOF).
//   markBacklogRowDone(...)     — `[/]`/`[-]` → `[x]` + inline PR link +
//                                  Status text flip (the /devx Phase 12
//                                  cleanup shape).
//
// Frontmatter status flips reuse manage/loop.ts's exported
// replaceFrontmatterStatus (wrap-don't-duplicate); backlog `[-]` flips reuse
// flipDevMdCheckbox from the same module.
//
// Spec: dev/dev-v2l101-2026-07-05T13:06-overnight-loop.md

import { readFileSync } from "node:fs";

import { writeAtomic } from "../supervisor-internal.js";
import { blankFencedLines } from "../backlog/parse.js";
import { replaceFrontmatterStatus } from "../manage/loop.js";

// ---------------------------------------------------------------------------
// Status-log entries
// ---------------------------------------------------------------------------

export type EntryPrefix = "" | "[FAIL]" | "[ERROR]";

export interface StatusEntryInput {
  iso: string;
  prefix: EntryPrefix;
  head: string;
  changes?: string[];
  learnings?: string[];
}

/** One entry: `- <iso> — [PREFIX ]<head>` + indented Changes/Learnings. */
export function composeStatusEntry(input: StatusEntryInput): string {
  const prefix = input.prefix === "" ? "" : `${input.prefix} `;
  const lines = [`- ${input.iso} — ${prefix}${sanitizeLine(input.head)}`];
  for (const [label, items] of [
    ["Changes", input.changes],
    ["Learnings", input.learnings],
  ] as const) {
    if (!items || items.length === 0) continue;
    for (const item of items) {
      lines.push(`  - ${label === "Changes" ? "Change" : "Learning"}: ${sanitizeLine(item)}`);
    }
  }
  return lines.join("\n");
}

/** Status-log entries are single logical bullets — strip newlines from
 *  agent-derived text so one rogue summary can't forge extra log lines
 *  (append-only history integrity). */
function sanitizeLine(s: string): string {
  return s.replace(/\s*\n\s*/g, " ").trim();
}

/**
 * Append an entry inside the `## Status log` section (before any following
 * `## ` heading). Specs without the section get one appended at EOF — same
 * defensive posture as updateSpecForClaim.
 *
 * Heading detection runs against a fence-blanked view of the file
 * (blankFencedLines — the same primitive backlog/parse.ts uses), so a
 * `## Status log` example inside a fenced code block can neither claim the
 * entry nor terminate the real section early (EC-MED-6). Line-based so the
 * blanked view and the real content share indices.
 */
export function appendToStatusLog(content: string, entry: string): string {
  const lines = content.split("\n");
  const blanked = blankFencedLines(lines.map(stripCR));
  const headingIdx = blanked.findIndex((l) => /^## Status log\s*$/.test(l));
  if (headingIdx === -1) {
    const tail = content.endsWith("\n") ? "" : "\n";
    return `${content}${tail}\n## Status log\n\n${entry}\n`;
  }
  let endIdx = lines.length;
  for (let i = headingIdx + 1; i < blanked.length; i++) {
    if (/^## /.test(blanked[i])) {
      endIdx = i;
      break;
    }
  }
  // Trim trailing blank lines inside the section, insert the entry, restore
  // the single blank separator before any following section.
  let lastBody = endIdx - 1;
  while (lastBody > headingIdx && lines[lastBody].trim() === "") lastBody--;
  const before = lines.slice(0, lastBody + 1);
  const after = lines.slice(endIdx);
  const separator = after.length > 0 ? [""] : [];
  const next = [...before, ...entry.split("\n"), ...separator, ...after];
  // Preserve a trailing newline when the section is the last thing in the
  // file (split/join drops nothing, but the trimmed-blank case can).
  if (after.length === 0 && content.endsWith("\n") && next[next.length - 1] !== "") {
    next.push("");
  }
  return next.join("\n");
}

function stripCR(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

/** Read-modify-write a spec file: append one status entry. Atomic
 *  (tmp+rename). Throws on read/write failure — callers decide best-effort. */
export function appendStatusEntryToFile(
  specPath: string,
  input: StatusEntryInput,
): void {
  const content = readFileSync(specPath, "utf8");
  const next = appendToStatusLog(content, composeStatusEntry(input));
  writeAtomic(specPath, next);
}

/** Flip the spec's frontmatter `status:` (atomic). Returns false when the
 *  content had no flippable status line (surfaced, not silent). */
export function setSpecStatus(specPath: string, status: string): boolean {
  const content = readFileSync(specPath, "utf8");
  const next = replaceFrontmatterStatus(content, status);
  if (next === content && !content.includes(`status: ${status}`)) return false;
  if (next !== content) writeAtomic(specPath, next);
  return true;
}

// ---------------------------------------------------------------------------
// Backlog-row done flip (merge cleanup)
// ---------------------------------------------------------------------------

/**
 * Flip the backlog row for `hash` to `[x]`, rewrite its `Status:` text to
 * `done`, and append the PR link inline (the /devx Phase 12 shape) when not
 * already present. Pure — content in, content out (unchanged when the row
 * isn't found or is already `[x]` with the link).
 */
export function markBacklogRowDone(
  content: string,
  hash: string,
  type: string,
  prUrl: string | null,
): string {
  const rowRe = new RegExp(
    String.raw`^(\s*-\s*)\[[ /\-]\](\s*\x60${escapeRe(type)}/${escapeRe(type)}-${escapeRe(hash)}-[^\n]*)$`,
    "m",
  );
  const m = rowRe.exec(content);
  if (!m) return content;
  let rest = m[2];
  rest = rest.replace(/Status: (?:ready|in-progress|blocked)(?=[.\s]|$)/, "Status: done");
  if (prUrl !== null && !rest.includes(prUrl)) {
    rest = rest.replace(/\s*$/, "") + ` PR: ${prUrl}`;
  }
  // Replacer FUNCTION, not a string: `rest` is row-derived (agent-authored
  // title etc.); a `$&` / `$'` / `` $` `` in it would be expanded by a
  // string replacement and duplicate the row inline (EC-MED-4).
  return content.replace(rowRe, () => `${m[1]}[x]${rest}`);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
