// The wire protocol between the nudge *emit* side (skill prose) and the nudge
// *detect* side (the Stop hook). One constant, one matcher — nothing else in
// the listener path knows what the sentence says.
//
// Single source of the sentence is the `<!-- nudge-canonical -->` marker in
// `.claude/commands/devx-learn.md` (mirrored byte-identically to
// `skills/devx-learn.md`; `/devx` and `/devx-plan` wrap-ups reference the
// marker by name rather than restating it — pinned by
// `test/learn-skill-guards.test.ts` + `test/skill-todo-discipline.test.ts`).
//
// ⚠ REWORDING THE MARKER MUST UPDATE `NUDGE_PATTERN` IN THE SAME PR — otherwise
// the listener goes silently deaf: every wrap-up keeps printing a nudge nobody
// enqueues, and the failure has no symptom to notice. That coupling is what
// `test/learn-nudge-pin.test.ts` (E-6) makes mechanical: the pattern must be a
// whitespace-collapsed substring of the live marker prose, and mutations of the
// marker must break containment.
//
// Spec: dev/dev-rtl101-2026-07-30T09:31-listener-nudge-pin.md (T1.1)
// Design: _devx/workstreams/retro-listener/design.md §Architecture (Pin)

/**
 * A mid-sentence slice of the canonical nudge, spanning from the friction
 * clause through the command invocation.
 *
 * Deliberately *not* the whole sentence:
 *   - it starts after "If this session hit real" and stops before "before
 *     closing out", so a bolded lead-in or a trailing markdown flourish can't
 *     break the match;
 *   - it still spans both the distinguishing noun ("friction") and the
 *     imperative ("run `/devx-learn`"), so a reworded sentence — the case that
 *     *should* go undetected, because the emit and detect sides have drifted —
 *     does not match.
 *
 * Matching is on wording, not bytes: {@link containsNudge} collapses whitespace
 * runs on both sides, so a hard-wrapped copy of the sentence still detects.
 */
export const NUDGE_PATTERN =
  "friction — a wrong assumption, a missing guard, a step that fought you — run `/devx-learn`";

/**
 * Collapse every whitespace run (spaces, tabs, newlines) to a single space and
 * trim the ends — the normalization both sides of the match go through.
 *
 * This is what makes a hard-wrapped assistant message equal to the one-line
 * marker prose: the terminal wraps, the transcript keeps the newlines, and the
 * sentence is otherwise identical.
 */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * True when `text` carries the canonical nudge.
 *
 * Content match, not authorship: a session that merely *quotes* the sentence
 * false-positives, which costs one spawned retro the user closes. The one case
 * where that would be unbounded — a retro quoting the sentence it exists to
 * reason about — is cut off upstream by the `DEVX_RETRO` guard in
 * `listener.ts`, not here.
 *
 * Total on input: a nullish or non-string message is simply not a nudge.
 */
export function containsNudge(text: string | null | undefined): boolean {
  if (typeof text !== "string" || text === "") return false;
  return collapseWhitespace(text).includes(collapseWhitespace(NUDGE_PATTERN));
}
