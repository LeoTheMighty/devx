// Pure helper: given a config snapshot + spec type + spec hash, returns the
// branch name `/devx-plan` should write into spec frontmatter (and `/devx`
// will later check out into a worktree).
//
// Closes the LEARN.md cross-epic regression class where every Phase 0 story
// had its `branch:` frontmatter hardcoded to `develop/dev-<hash>` regardless
// of the project's git config — and `/devx` had to correct it on claim.
//
// Truth table (covered exhaustively in test/plan-derive-branch.test.ts):
//   {integration:null,    prefix:"feat/"}    + dev + aud101 → feat/dev-aud101
//   {integration:null,    prefix:"work/"}    + dev + aud101 → work/dev-aud101
//   {integration:"develop", prefix:"develop/"} + dev + aud101 → develop/dev-aud101
//   {integration:"develop", prefix:"feat/"}    + dev + aud101 → develop/feat/dev-aud101
//
// Empty/whitespace `git.integration_branch` collapses to null (single-branch
// path) — a drift between schema validation and runtime input shapes that we
// pin here so the planner emits the same branch whether the user wrote `null`,
// `""`, or `"   "`.
//
// Spec: dev/dev-pln101-2026-04-28T19:30-plan-derive-branch.md

export interface DeriveBranchConfig {
  git?: {
    integration_branch?: string | null;
    branch_prefix?: string;
  };
}

const SINGLE_BRANCH_DEFAULT_PREFIX = "feat/";

/**
 * Compute the branch name for a spec under the given config.
 *
 * Pure: no I/O, no env reads, no current-time calls. The CLI passthrough at
 * `devx plan-helper derive-branch` is the only impure caller.
 *
 * Single-branch projects (`integration_branch` null/missing/empty/whitespace)
 * get `<prefix><type>-<hash>`; develop/main split projects get
 * `<integration>/<prefix><type>-<hash>` UNLESS the prefix already starts with
 * `<integration>/` — that handles the "prefix encodes the full path" shape
 * (`{integration:"develop", prefix:"develop/"}`) without doubling up.
 *
 * `branch_prefix` default is conditional per CLAUDE.md "Branching model":
 *   - single-branch (integration === null): defaults to "feat/"
 *   - split (integration !== null):         defaults to "<integration>/"
 * Picking the wrong default here would silently re-introduce the LEARN.md
 * cross-epic regression in a different shape.
 */
export function deriveBranch(
  config: DeriveBranchConfig,
  type: string,
  hash: string,
): string {
  const integration = normalizeIntegration(config.git?.integration_branch);
  const prefix =
    config.git?.branch_prefix ??
    (integration === null
      ? SINGLE_BRANCH_DEFAULT_PREFIX
      : `${integration}/`);

  if (integration === null) {
    return `${prefix}${type}-${hash}`;
  }
  if (prefix.startsWith(`${integration}/`)) {
    return `${prefix}${type}-${hash}`;
  }
  return `${integration}/${prefix}${type}-${hash}`;
}

function normalizeIntegration(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}
