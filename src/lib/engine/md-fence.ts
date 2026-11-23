// Fenced-code-block detection for the engine's line-based markdown checks
// (harness-s4: Gate 2's mechanical hygiene and `devx render lint`).
//
// Why not a one-line `^\s*```` toggle: a design doc in this repo writes the
// inline span ```` ```mermaid``` ```` at the start of a bullet. A toggle reads
// that as an opener, every fence after it flips parity, and every heading
// below lands "inside a code block" — the story-graph design's
// `## Resolved design questions` went unseen exactly that way on the first
// real-repo run. CommonMark already settles it: a backtick fence's info
// string may not contain a backtick, and a closer is the same character, at
// least as long, with nothing after it but whitespace.

// A trailing `\r` (CRLF file, split on `\n`) is tolerated: `.` and `[ \t]`
// both stop at it, so without `\r?` a CRLF fence never opens or closes —
// and blankFencedLines' callers that pass un-stripped lines (validate-emit)
// would read fenced example rows as real ones.
const OPEN_RE = /^[ \t]*(`{3,}|~{3,})(.*)\r?$/;
const CLOSE_RE = /^[ \t]*(`{3,}|~{3,})[ \t]*\r?$/;

/** One entry per input line: `true` when the line is a fence line or sits
 *  inside a fenced block (and so is code, not prose or structure). */
export function fencedLineMask(lines: readonly string[]): boolean[] {
  let open: { char: string; len: number } | null = null;
  return lines.map((line) => {
    if (open !== null) {
      const c = CLOSE_RE.exec(line);
      if (c && c[1][0] === open.char && c[1].length >= open.len) open = null;
      return true;
    }
    const o = OPEN_RE.exec(line);
    if (o === null) return false;
    const char = o[1][0];
    if (char === "`" && o[2].includes("`")) return false; // inline span, not a fence
    open = { char, len: o[1].length };
    return true;
  });
}

/** Info-string language of a fence opener line (`mermaid`, `ts`, `''`). */
export function fenceLang(line: string): string {
  const o = OPEN_RE.exec(line);
  return o ? (o[2].trim().split(/\s+/)[0] ?? "") : "";
}
