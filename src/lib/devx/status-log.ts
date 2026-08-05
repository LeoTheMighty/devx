// Append-only `## Status log` splice — shared by every spec mutator.
//
// CLAUDE.md's working agreement is "status log is append-only": agents add
// lines, they never rewrite them. The splice that enforces it is fiddly
// (find the section, find its end, preserve the blank line separating it
// from whatever follows) and was written once for the claim (dvx101). When
// mark-done (sgr105) needed the identical splice, copying it would have
// meant two implementations of the repo's most-asserted invariant drifting
// apart — the exact "don't duplicate business logic" case. Extracted here;
// `updateSpecForClaim` and `updateSpecForDone` both call it.
//
// Spec: dev/dev-sgr105-2026-08-02T13:57-mark-done-phase8.md

/**
 * Append `logLine` to the spec's `## Status log` section.
 *
 * The section is bounded by its heading and the next `## ` heading (or EOF).
 * Trailing whitespace inside the section is normalised away before the
 * append so repeated calls don't accumulate blank lines, and the blank line
 * that separates the section from a following one is restored.
 *
 * A spec with no `## Status log` section gets one minted at EOF — spec
 * authors should always ship the section (CLAUDE.md §Spec file convention),
 * but a missing one must not cost the caller its state transition.
 */
export function appendStatusLogLine(content: string, logLine: string): string {
  const slMatch = /^## Status log\s*\n/m.exec(content);
  if (!slMatch) {
    const tail = content.endsWith("\n") ? "" : "\n";
    return `${content}${tail}\n## Status log\n\n${logLine}\n`;
  }
  const slStart = slMatch.index + slMatch[0].length;
  // Find the next `## ` heading after the status-log heading (could be EOF).
  // `m` makes `^` match line starts.
  let slEnd = content.length;
  const nextHeading = /^## /m.exec(content.slice(slStart));
  if (nextHeading) {
    slEnd = slStart + nextHeading.index;
  }
  const sectionBody = content.slice(slStart, slEnd).replace(/\s+$/, "");
  const trailer = slEnd < content.length ? "\n\n" : "\n";
  return (
    content.slice(0, slStart) +
    `${sectionBody}\n${logLine}${trailer}` +
    content.slice(slEnd)
  );
}
