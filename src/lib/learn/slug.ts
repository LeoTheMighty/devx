// Pure slug sanitizer for /devx-learn branch + proposal-file naming.
//
// Session content is untrusted input (design § Guards): learning titles are
// mined from a live session thread, so anything that ends up in a git branch
// name (`fw/learn-<date>-<slug>`) or a proposal filename
// (`docs/updates/<date>-<slug>.md`) must pass through here first. The skill
// body is contractually forbidden from ever passing raw session text to
// git/gh — slugs come from `devx learn-helper slug` only (pinned by E-6).
//
// Contract (design §Interfaces): lowercase, reduce to [a-z0-9-],
// collapse/trim dashes, ≤40 chars, empty → "session-retro". Disallowed
// characters become dash separators (not silently deleted) so word
// boundaries survive: "hello; rm -rf /" → "hello-rm-rf", not "hellormrf".
//
// Spec: dev/dev-hfi104-2026-07-24T10:41-devx-learn-skill.md (T4.1)

const MAX_SLUG_LENGTH = 40;
const FALLBACK_SLUG = "session-retro";

export function sanitizeLearnSlug(raw: string): string {
  let slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length > MAX_SLUG_LENGTH) {
    // Re-trim after the cut — truncation can strand a trailing dash.
    slug = slug.slice(0, MAX_SLUG_LENGTH).replace(/-+$/, "");
  }
  return slug.length === 0 ? FALLBACK_SLUG : slug;
}
