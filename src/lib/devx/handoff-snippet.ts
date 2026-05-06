// Handoff Snippet shape validator (dvx107 AC #5).
//
// The /devx skill emits a "Handoff Snippet" when it stops mid-loop (context
// budget, quality risk, blocker, mode change, user halt). The snippet is a
// fenced ```text``` block containing five required sections plus a final
// `Continue from <…>.` line — see `.claude/commands/devx.md` § "Handoff
// Snippet (when stopping before the run completes)" for the canonical shape.
//
// This module is the validator backing `test/devx-handoff-snippet.test.ts`.
// Keeping the structural rule in code (not just prose) means the discipline
// test exercises the exact same rule the skill body documents, instead of
// re-implementing the parsing inside the test file. Today this module is
// library-only — no CLI wrapper. If a future consumer (ManageAgent, mobile
// companion) needs runtime validation of agent-emitted snippets, add a thin
// `devx devx-helper validate-handoff` passthrough at that point; the
// shape stays stable.
//
// Design choices:
//   • Fence count is 3+ backticks (skill body uses 4 to nest the template
//     inside the markdown doc; runtime emissions use 3). Close fence must be
//     the same length as the open fence.
//   • Section presence is matched on the bare heading prefix
//     (e.g. `## Already done`); the trailing parenthetical (e.g.
//     ` (do not rerun)`) is allowed but not required, so the validator
//     doesn't break if a future maintainer adjusts the parenthetical wording.
//   • A snippet with an internal triple-backtick fenced sub-block requires
//     a 4+-backtick outer fence; this is a known limitation the skill body
//     already accommodates by using 4-backtick fences for the template.

export const REQUIRED_SECTION_HEADINGS = [
  "## Already done",
  "## Next up",
  "## State to trust",
  "## Gotchas",
  "## Do NOT",
] as const;

export type RequiredSectionHeading = (typeof REQUIRED_SECTION_HEADINGS)[number];

export interface FencedTextBlock {
  /** The literal fence string (e.g. "```" or "````"). */
  fence: string;
  /** The inner content of the fenced block (no outer fence lines). */
  body: string;
}

export interface HandoffSnippet extends FencedTextBlock {
  /** The final "Continue from <…>." line, exactly as it appeared. */
  continueLine: string;
}

export type HandoffSnippetParseError =
  | { code: "missing-fence" }
  | { code: "unterminated-fence" }
  | { code: "missing-section"; section: RequiredSectionHeading }
  | { code: "missing-continue-line" };

export type HandoffSnippetParseResult =
  | { ok: true; errors: []; snippet: HandoffSnippet }
  | { ok: false; errors: HandoffSnippetParseError[] };

/**
 * Locate the first fenced ```text``` block in `message` and validate it
 * against the dvx107 Handoff Snippet shape.
 *
 * Returns `{ ok: true, snippet, errors: [] }` when the snippet conforms, or
 * `{ ok: false, errors: [...] }` with one error per missing structural
 * requirement. Errors are stable, machine-readable codes so callers can
 * surface targeted failure messages.
 */
export function parseHandoffSnippet(message: string): HandoffSnippetParseResult {
  const errors: HandoffSnippetParseError[] = [];

  const block = findFencedTextBlock(message);
  if (!block) {
    errors.push({ code: "missing-fence" });
    return { ok: false, errors };
  }
  if (block.body === null) {
    errors.push({ code: "unterminated-fence" });
    return { ok: false, errors };
  }

  for (const heading of REQUIRED_SECTION_HEADINGS) {
    if (!hasSection(block.body, heading)) {
      errors.push({ code: "missing-section", section: heading });
    }
  }

  const continueLine = findContinueLine(block.body);
  if (!continueLine) {
    errors.push({ code: "missing-continue-line" });
  }

  if (errors.length > 0 || continueLine === null) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    errors: [],
    snippet: { fence: block.fence, body: block.body, continueLine },
  };
}

/**
 * Find the first fenced ```text``` block in `message`. Tolerant to 3+
 * backticks; the close fence must match the open fence length exactly.
 *
 * Returns `null` when no opening fence is found, or `{ fence, body: null }`
 * when an opening fence exists without a matching close (the caller treats
 * that as `unterminated-fence`).
 */
function findFencedTextBlock(
  message: string,
): { fence: string; body: string } | { fence: string; body: null } | null {
  const lines = message.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    // CommonMark allows arbitrary info-string after the language tag
    // (` ```text title="..." `). Anchor on word-boundary so we still match
    // ` ```text ` and ` ```text\t...` while accepting ` ```text foo `.
    const open = lines[i].match(/^(`{3,})text\b[^\n]*$/);
    if (!open) continue;
    const fence = open[1];
    const closeRe = new RegExp(`^${fence}\\s*$`);
    for (let j = i + 1; j < lines.length; j++) {
      if (closeRe.test(lines[j])) {
        return { fence, body: lines.slice(i + 1, j).join("\n") };
      }
    }
    return { fence, body: null };
  }
  return null;
}

/**
 * Test whether `body` contains a heading that begins with `heading`. Allows
 * a trailing space + parenthetical (e.g. `## Already done (do not rerun)`)
 * but rejects unrelated prefixes (e.g. `## Already doneness`).
 */
function hasSection(body: string, heading: RequiredSectionHeading): boolean {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Allow any whitespace (space or tab) or end-of-line after the heading
  // prefix so a future fixture using `\t` won't silently fail to match.
  const re = new RegExp(`^${escaped}(\\s|$)`, "m");
  return re.test(body);
}

function findContinueLine(body: string): string | null {
  const m = body.match(/^Continue from .+\.[ \t]*$/m);
  // Trim trailing horizontal whitespace so callers comparing against a
  // canonical `Continue from <hash>.` string don't have to defensively
  // .trimEnd() the result.
  return m ? m[0].replace(/[ \t]+$/, "") : null;
}
