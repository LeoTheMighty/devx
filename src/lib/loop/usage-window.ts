// Usage-window detection floor (uwg101 / c8e2d4).
//
// Recognise a Claude subscription usage-window exhaustion in worker output,
// and parse the window's reset time out of it. Pure: no clock reads, no I/O,
// no config. Ships INERT — nothing calls it yet (uwg102 wires the driver
// seam), which is deliberate: the contract is entirely unit-testable, so
// wiring it later lets that review be about the driver seam rather than
// about regex semantics.
//
// WHY THIS EXISTS. A usage limit is weather, not a defect. Today it rides
// the hard-error backoff ladder (`ladder.ts` — PERMANENT_ERROR_MARKERS
// deliberately covers credit/auth exhaustion only), bumps
// `consecutiveFailures`, abandons the item after 3 strikes and kills the run
// after 3 abandoned items. An overnight run loses hours to a wall it was
// always going to hit.
//
// THE MARKER SET IS SEEDED, NOT OBSERVED. These regexes come from known
// message shapes, not from captured real transcripts (design/agent.md § Risks).
// That asymmetry is why `detectUsageWindowHit` requires CORROBORATION: a
// missed marker degrades to today's behavior, which is merely the status
// quo, while a false positive would pause a healthy run. E-7's live night is
// the only thing that closes the corpus gap; until it runs, fail narrow.
//
// Spec: dev/dev-uwg101-2026-08-21T14:30-uwg101.md
// Design: _devx/workstreams/usage-window-governor/design/agent.md § Architecture 1

/**
 * How much of the transcript tail to scan, in UTF-16 code units.
 *
 * Same posture as `firstPermanentErrorMatchInTail` (`ladder.ts`): a marker
 * appearing early in a long transcript is almost always the agent *reading
 * or writing about* the limit rather than hitting it — including, very
 * literally, whenever someone edits this file. Only the tail is evidence.
 */
export const USAGE_TAIL_CHARS = 4_000;

/** @deprecated Kept as an alias for one release: the old name said BYTES and
 *  the slice was always UTF-16 code units, so on a transcript full of `…`
 *  and `—` the real window was up to 3x the named budget. Renamed rather
 *  than "fixed" — converting to real bytes would silently narrow the window
 *  for every non-ASCII transcript, which is a behavior change nobody asked
 *  for. The honest fix is the honest name. */
export const USAGE_TAIL_BYTES = USAGE_TAIL_CHARS;

/**
 * Known usage-window exhaustion message shapes.
 *
 * Kept narrow on purpose (see the file header). Widen only from a real
 * transcript captured by E-7's live night, and add the real string as a unit
 * case in the same change — a regex widened from a guess is how a false
 * positive gets in.
 */
export const USAGE_LIMIT_MARKERS: RegExp[] = [
  /claude\s+(?:ai\s+|code\s+)?usage\s+limit\s+reached/i,
  /\b\d+\s*-\s*hour\s+limit\s+reached/i,
  /you'?ve\s+(?:reached|hit)\s+your\s+usage\s+limit/i,
  // Separator class covers hyphen, en-dash, em-dash, minus sign and the
  // middle dot — a message using U+2013 was silently unmatched (review).
  /usage\s+limit\s+reached\s*(?:[|·—–−-]|$)/i,
];

/** Where a reset time came from — surfaced in the run summary so a reader
 *  can tell a precise wake from a probe-cadence guess. */
export type ResetSource = "parsed" | "probe";

export interface UsageWindowHit {
  /** Parsed reset time, or null when the message carried none usable. */
  resetAt: Date | null;
  /** `parsed` when `resetAt` is non-null, else `probe`. */
  source: ResetSource;
  /** The matched marker text, verbatim. This is the corpus evidence E-7
   *  asks to be captured — a hit whose text we did not expect is the most
   *  valuable output this module produces. */
  matched: string;
}

export interface DetectUsageWindowInput {
  /** The worker's raw transcript. */
  rawOutput: string;
  /** The validated report, when the worker produced one. `null` is the
   *  driver's own shape (`let report: IterationReport | null = null`), so
   *  accept it rather than making every caller convert. */
  report?: { success: boolean; key_learnings: string[] } | null;
  /** Worker process exit code. Accepted for symmetry with the driver's
   *  worker result, but DELIBERATELY NOT CONSULTED — see the corroboration
   *  note on `detectUsageWindowHit`. */
  exitCode?: number | null;
  /** Clock for the next-occurrence reset form. Defaults to now; passed
   *  explicitly by every test so the parse is deterministic. */
  now?: Date;
  /** Override the tail window, in UTF-16 code units (tests). */
  tailChars?: number;
  /** @deprecated Old name for `tailChars`; it never meant bytes. */
  tailBytes?: number;
}

/**
 * The first usage-limit marker in the transcript's TAIL, or null.
 *
 * Returns the matched text rather than a boolean so the caller can record
 * it: `USAGE_LIMIT_MARKERS` is seeded from guesses, and the real string is
 * the only thing that can correct them.
 */
export function firstUsageMarkerInTail(
  raw: string,
  tailChars: number = USAGE_TAIL_CHARS,
): string | null {
  return markerMatchInTail(raw, tailChars)?.text ?? null;
}

/** The matched marker plus where it sat in the ORIGINAL string — the offset
 *  is what lets `detectUsageWindowHit` parse the reset from a window
 *  anchored at the marker rather than from the whole transcript. */
interface MarkerMatch {
  text: string;
  /** Index into `raw`, not into the tail slice. */
  index: number;
}

function markerMatchInTail(raw: string, tailChars: number): MarkerMatch | null {
  if (raw === "") return null;
  // `slice(-0)` is `slice(0)` — the WHOLE string. Passing 0 to mean "scan
  // nothing" would have maximised the false-positive surface instead of
  // eliminating it, which matters once uwg102 exposes this as config where
  // `0` reads as "disable". The sibling `firstPermanentErrorMatchInTail`
  // guards this the same way; the guard was dropped here and review caught it.
  const width = Math.max(1, Math.floor(tailChars));
  const offset = raw.length > width ? raw.length - width : 0;
  const tail = raw.slice(offset);

  // EARLIEST BY POSITION, not first-by-list-order. `matched` is the corpus
  // evidence E-7 asks to capture; returning whichever pattern happens to sit
  // first in the array would quietly report the wrong string.
  let best: MarkerMatch | null = null;
  for (const re of USAGE_LIMIT_MARKERS) {
    const m = re.exec(tail);
    if (m === null) continue;
    if (best === null || m.index < best.index - offset) {
      best = { text: m[0], index: offset + m.index };
    }
  }
  return best;
}

/**
 * Parse the window reset time out of a limit message.
 *
 * Three observed shapes:
 *   (a) `…usage limit reached|1755756000`  — unix epoch seconds suffix
 *   (b) `…resets 3am` / `…resets at 3:30pm` — wall-clock next occurrence
 *   (c) an embedded ISO-8601 timestamp
 *
 * A parsed time **in the past returns null**, falling through to the probe
 * path. This is not defensive tidying: a stale timestamp would otherwise
 * produce a zero-length pause that resolves instantly, the loop would
 * immediately re-hit the limit, and the run would spin at full speed against
 * a wall — worse than the hard-error backoff this replaces.
 */
export function parseResetTime(raw: string, now: Date = new Date()): Date | null {
  const future = (d: Date): Date | null =>
    Number.isFinite(d.getTime()) && d.getTime() > now.getTime() ? d : null;

  // Each shape FALLS THROUGH on a null rather than returning it. A shape
  // that matched-but-was-stale is not evidence that the other shapes are
  // absent: `prev|1600000000 … resets 6am` used to return null and drop to
  // the probe path with a perfectly good wall-clock reset sitting right
  // there (review MED-2).

  // (a) unix epoch seconds (10 digits) or millis (13), after a `|`.
  const epoch = /\|\s*(\d{10}|\d{13})\b/.exec(raw);
  if (epoch) {
    const n = Number(epoch[1]);
    const d = future(new Date(epoch[1].length === 13 ? n : n * 1000));
    if (d !== null) return d;
  }

  // (c) ISO-8601 — checked before the wall-clock form, because an ISO
  // string contains digits a loose time regex would happily misread.
  const iso = /\b(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\b/.exec(
    raw,
  );
  if (iso) {
    const d = new Date(iso[1]);
    if (Number.isFinite(d.getTime())) {
      const f = future(d);
      if (f !== null) return f;
    }
  }

  // (b) wall-clock next occurrence: "resets 3am", "resets at 3:30 pm".
  const wall = /reset[s]?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?/i.exec(raw);
  if (wall) {
    const hour12 = Number(wall[1]);
    if (hour12 < 1 || hour12 > 12) return null;
    const minutes = wall[2] !== undefined ? Number(wall[2]) : 0;
    if (minutes > 59) return null;
    const pm = wall[3].toLowerCase() === "p";
    const hour24 = pm ? (hour12 === 12 ? 12 : hour12 + 12) : hour12 === 12 ? 0 : hour12;
    const candidate = new Date(now);
    candidate.setHours(hour24, minutes, 0, 0);
    // NEXT occurrence: "resets 3am" said at 4am means tomorrow's 3am.
    if (candidate.getTime() <= now.getTime()) {
      candidate.setDate(candidate.getDate() + 1);
    }
    return future(candidate);
  }

  return null;
}

/**
 * How far back from the matched marker to look for a reset time.
 *
 * THE RESET MUST BE PARSED NEAR THE MARKER, not from the whole transcript —
 * this was a HIGH, found independently by two reviewers, and it is the most
 * devx-specific bug in the module. The ISO regex matches
 * `dev/dev-uwg101-2026-08-21T14:30-uwg101.md`: **a devx spec filename IS an
 * ISO-8601 timestamp**. A worker that edited any spec file and then hit the
 * wall would have paused until a filename, reported as `parsed` (precise)
 * rather than `probe`. And since bare ISO strings parse as LOCAL time, an
 * ordinary log stamp from earlier in the run could resolve to a *future*
 * instant and wake the loop hours early, straight back into the wall.
 *
 * A window rather than the marker's line alone, because the observed shapes
 * put the reset on the same line (`|<epoch>`, `resets 3am`) but a wrapped
 * or multi-line message should still resolve.
 */
export const RESET_SCAN_CHARS = 300;

/**
 * Is this iteration a usage-window hit?
 *
 * TWO conditions, both required:
 *
 *   1. a marker in the transcript TAIL, and
 *   2. CORROBORATION — the iteration did not report success.
 *
 * WHAT COUNTS AS CORROBORATION changed under review, and the change matters
 * in both directions:
 *
 *   • `exitCode` is NOT consulted. `classifyIteration` (`driver.ts`) treats a
 *     valid report as authoritative regardless of exit status, and a governor
 *     that is STRICTER than the driver would pause iterations the driver
 *     considers healthy — a `claude -p` that emits valid JSON and then exits
 *     non-zero on a stream hiccup is a real shape.
 *   • `report.success === false` DOES corroborate. A reported failure whose
 *     tail names a usage limit is the wall, and the old rule sent it down
 *     the reported-failure ladder burning `consecutiveFailures` — E-1's
 *     exact failure mode, in the one case where the agent told us plainly
 *     what happened.
 *
 * So: **a report claiming success clears the hit; nothing else does.** That
 * is one sentence, it matches the driver's own posture, and it removes the
 * old rule's incoherence (trusting `exitCode` to override a report while
 * ignoring the report's own verdict).
 *
 * A false pause remains strictly worse than a missed one — a missed marker
 * degrades to the pre-governor behavior, while a false pause halts work that
 * was fine — which is why the tail bound and the success-clears rule are
 * both kept narrow.
 */
export function detectUsageWindowHit(
  input: DetectUsageWindowInput,
): UsageWindowHit | null {
  // Non-string input would throw on `.length`. `ladder.ts`'s sibling guards
  // this; the guard was dropped here and review caught it. A detector on the
  // hot path of every iteration must not be the thing that crashes a run.
  if (typeof input.rawOutput !== "string") return null;

  const match = markerMatchInTail(
    input.rawOutput,
    input.tailChars ?? input.tailBytes ?? USAGE_TAIL_CHARS,
  );
  if (match === null) return null;

  // Corroboration: a report claiming success clears the hit; nothing else.
  if (input.report != null && input.report.success === true) return null;

  // Anchored at the marker — see RESET_SCAN_CHARS.
  const from = Math.max(0, match.index - RESET_SCAN_CHARS);
  const window = input.rawOutput.slice(from, match.index + match.text.length + RESET_SCAN_CHARS);
  const resetAt = parseResetTime(window, input.now ?? new Date());
  return { resetAt, source: resetAt !== null ? "parsed" : "probe", matched: match.text };
}
