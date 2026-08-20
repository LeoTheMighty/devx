// Shared nullish-scalar rule for devx's hand-rolled frontmatter readers.
//
// devx has several read-only frontmatter parsers that pull a few known scalars
// out of a spec's `---` block with a regex rather than a real YAML parse
// (merge-gate.ts readFrontmatter, verify-claim.ts parseSpecClaimFields). Each
// one used to decide for itself what "no value" looked like, and they
// disagreed: merge-gate accepted the 4-character string "null" as a branch
// name and queried `gh pr list --head null`, gating every unset-branch spec as
// "no PR yet" forever even with a green PR open on the derived branch
// (debug-7b3e2a). The engine reader (engine/frontmatter.ts readEngineState)
// never had the bug — it parses with eemeli/yaml — which is exactly the
// behavior this module backfills into the regex readers.
//
// The rule is YAML's, not ours: an unquoted `null` / `Null` / `NULL` / `~` /
// empty value is a null. A QUOTED "null" is a string, and callers that want
// YAML fidelity must test nullish BEFORE stripping quotes.
//
// Spec: debug/debug-7b3e2a-2026-08-07T12:40-merge-gate-reads-yaml-null-branch-as-string.md

/** YAML's unquoted null spellings (`null: false` in the 1.2 core schema plus
 *  the empty value). Exported for tests that want to enumerate the set. */
export const NULLISH_SCALARS: ReadonlySet<string> = new Set([
  "",
  "null",
  "Null",
  "NULL",
  "~",
]);

/**
 * True when `raw` — an already-trimmed, still-quoted frontmatter scalar — is
 * one of YAML's null spellings.
 *
 * Pass the value BEFORE quote-stripping. `"null"` and `'~'` are strings per
 * YAML; collapsing them into null here is the mirror-image of the bug this
 * module exists to fix.
 */
export function isNullishScalar(raw: string): boolean {
  return NULLISH_SCALARS.has(raw.trim());
}
