// RED step-body locking — "fix the code, not the eval."
//
// Ported from mycase/8am-harness #59 play 1, the constitution-level one.
//
// The RED gate's whole claim is that an eval was watched failing for the
// right reason BEFORE any code existed to pass it. That claim is worth
// exactly as much as the eval's immutability afterwards: an eval quietly
// softened during implementation turns a green run into a tautology, and
// nothing downstream can tell the difference. Before this module the only
// protection was instruction-level — "don't weaken the eval" in a skill body
// — which is a request, not a guard.
//
// Three layers, matching the outline guard's proven shape:
//
//   L1 (write-time)  PreToolUse hook → evalsGuardDecision()
//   L2 (gate-time)   Gate 4 stamps each eval's step-body sha256 into
//                    gate_status.red_eval_shas
//   L3 (verify-time) verifyStepBodies() FAILs a body that moved under a
//                    stamp, naming the eval
//
// What stays writable while locked: the RESULT OF RECORD. An eval's Status /
// Last-run / Runs rows are how a run is recorded at all — freezing those
// would freeze the gate itself. Only the step body is locked, and the split
// between them is mechanical (`isResultOfRecordLine`), not a judgment call
// made per edit.
//
// Pure: no I/O, no clock. Callers read files and gate_status.
//
// Spec: docs/CONFIG.md §15; upstream rationale in mycase/8am-harness #59.

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Step body vs result of record
// ---------------------------------------------------------------------------

/**
 * The result-of-record CONVENTION for a markdown eval (debug-evlk01 H).
 * Result-of-record lines are left out of the lock's hash so recording a run
 * never reads as editing the eval; everything else is a step and is locked.
 *
 * Result of record (writable, NOT hashed):
 *   - `Status:`, `Last run:` / `Last-run:`, `Verdict:` — outcome of a run.
 *   - `Result:` — the OBSERVED result of a run.
 *   - table rows inside a section headed `Runs` (`## Runs`, `### Runs (…)`).
 *
 * Step (locked, hashed):
 *   - `Run:` — the command. It defines what the eval does; changing
 *     `--lines 10000` to `--lines 10` weakens the eval and must read `moved`.
 *   - `Expected:` / `Threshold:` — the bar the eval asserts. **To lock an
 *     expected result, write it as `Expected:` or `Threshold:`, never as
 *     `Result:`** — `Result:` is reserved for what a run observed.
 *   - every table row outside a `Runs` section — a steps table or a
 *     thresholds table is part of the eval.
 *
 * Before evlk01, `Run:` and `Result:` were both stripped and EVERY `|` line
 * was treated as a Runs row, so an eval's command, its bar and any tabular
 * steps could all be weakened with an identical sha. Resolved at a point
 * where no workstream in devx or palateful carried a stamp, so tightening
 * what is hashed invalidated nothing.
 */
const RESULT_FIELDS = ["status", "last run", "last-run", "runs", "result", "verdict"];

const RESULT_LINE_RE = new RegExp(
  `^\\s*(?:[-*+]\\s*)?\\**\\s*(${RESULT_FIELDS.join("|")})\\s*\\**\\s*:`,
  "i",
);

/** A markdown table row. Result of record ONLY inside a Runs section. */
const TABLE_ROW_RE = /^\s*\|/;
/** An ATX heading, CommonMark-style: at most 3 spaces of indent (4+ is a code
 *  block, so an indented `    # Runs x` is NOT a heading), optional closing
 *  `#`s. Group 1 is the `#`s, group 2 the text. */
const ATX_HEADING_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*#*[ \t]*$/;
/** A setext underline (`Runs` over `----` or `====`). */
const SETEXT_UNDERLINE_RE = /^ {0,3}(=+|-+)[ \t]*$/;
/** A fenced code block opener or closer. */
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
/** A heading that opens a Runs section: exactly `Runs`, optionally with a
 *  parenthetical (`Runs (2026)`) or a trailing colon. Anchored at BOTH ends —
 *  `Runs per worker` or `Runs-per-second thresholds` name a steps/threshold
 *  table, and treating them as Runs sections left those tables unhashed
 *  (review of evlk01, M2). */
const RUNS_HEADING_RE = /^runs(?:\s*\(.*\))?\s*:?$/i;

/** True when a field line records the outcome of a run rather than defining
 *  the eval's steps. Table rows are decided by `stepBody`, which knows
 *  which section a row sits in. */
export function isResultOfRecordLine(line: string): boolean {
  return RESULT_LINE_RE.test(line);
}

/**
 * Reduce an eval artifact to its step body: the part the RED gate's claim
 * rests on. Result-of-record lines are dropped; whitespace is normalized so
 * a reflow, a trailing space, or a CRLF checkout never reads as a semantic
 * change (which would make the lock cry wolf and get switched off).
 */
export function stepBody(md: string): string {
  const lines = md.split(/\r?\n/);
  const kept: string[] = [];
  // Inside a fenced code block everything is code, so it is step content:
  // hashed verbatim, never read as a heading or a result-of-record line. A
  // shell comment like `# Runs the bench` inside a fence used to OPEN a Runs
  // section and un-hash every table after it (review of evlk01, M1).
  let fence: string | null = null;
  // A Runs section lasts until the next heading at the same or a higher
  // level; a deeper sub-heading stays inside it.
  let runsLevel: number | null = null;

  const openHeading = (level: number, text: string): void => {
    if (runsLevel !== null && level <= runsLevel) runsLevel = null;
    if (runsLevel === null && RUNS_HEADING_RE.test(text.trim())) runsLevel = level;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (fence !== null) {
      kept.push(line);
      const close = FENCE_RE.exec(line);
      if (
        close &&
        close[1][0] === fence[0] &&
        close[1].length >= fence.length &&
        line.trim() === close[1]
      ) {
        fence = null;
      }
      continue;
    }
    const open = FENCE_RE.exec(line);
    if (open) {
      fence = open[1];
      kept.push(line);
      continue;
    }

    const atx = ATX_HEADING_RE.exec(line);
    if (atx) {
      openHeading(atx[1].length, atx[2] ?? "");
      kept.push(line);
      continue;
    }
    // Setext: a text line followed by `===` (level 1) or `---` (level 2).
    // Neither a table row nor a result-of-record line is ever taken as its
    // text: `Status: RED` over a `---` rule would otherwise become a heading,
    // be kept, and make recording a run read as `moved`.
    const next = lines[i + 1];
    const underline = next === undefined ? null : SETEXT_UNDERLINE_RE.exec(next);
    if (
      underline &&
      line.trim() !== "" &&
      !TABLE_ROW_RE.test(line) &&
      !isResultOfRecordLine(line)
    ) {
      openHeading(underline[1][0] === "=" ? 1 : 2, line);
      kept.push(line, next as string);
      i++;
      continue;
    }

    if (isResultOfRecordLine(line)) continue;
    if (runsLevel !== null && TABLE_ROW_RE.test(line)) continue;
    kept.push(line);
  }
  return kept
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The lockable content of an eval artifact, decided by its path (AC 4 of
 * debug-75563d).
 *
 * `stepBody()`'s result-of-record stripping is written for step-bearing
 * MARKDOWN: it drops `Status:` / `Last run:` lines and Runs-table rows so
 * recording a run never reads as editing the eval. Applied to a `.ts`
 * eval that rule is wrong and silently destructive — a script whose
 * source contains a line like `| date | RED |` (a template literal, a
 * fixture, a comment) would have that line stripped from its own hash,
 * so editing it afterwards would not register as `moved`.
 *
 * A non-markdown eval is therefore all step body and is hashed whole.
 * Both the stamp and the verify go through here, so the two can never
 * disagree about what a given artifact's lockable content is.
 */
export function lockableBody(evalPath: string, raw: string): string {
  return evalPath.toLowerCase().endsWith(".md") ? stepBody(raw) : normalizeSource(raw);
}

/**
 * Whitespace-normalize a non-markdown eval WITHOUT dropping any line.
 *
 * Hashing raw bytes made a CRLF checkout (git `core.autocrlf`) or an editor
 * that strips trailing spaces read as `moved` — "fix the code, not the eval"
 * on an eval nobody changed. That is the cry-wolf failure `stepBody()`
 * already guards markdown against, and a lock that cries wolf gets switched
 * off. Only line endings and trailing whitespace are normalized; unlike
 * `stepBody()` no line is ever stripped, so AC 4's "a non-md eval is all
 * step body" still holds.
 *
 * On a file that is already LF with no trailing whitespace this is the
 * identity, so every stamp taken before this change still verifies.
 */
function normalizeSource(raw: string): string {
  return raw
    .split(/\r?\n/)
    .map((l) => l.replace(/[ \t]+$/, ""))
    .join("\n");
}

/** sha256 of an eval's lockable body — the value Gate 4 stamps. */
export function stepBodySha(evalPath: string, raw: string): string {
  return createHash("sha256").update(lockableBody(evalPath, raw), "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Stamping and verification
// ---------------------------------------------------------------------------

/** `gate_status.red_eval_shas` — eval path (REPO-relative) → sha256 of its
 *  lockable body (see `lockableBody`). */
export type RedEvalShas = Record<string, string>;

/** Hash each eval artifact's lockable body. Called by Gate 4 on every
 *  non-FAIL verdict (PASS, CONCERNS, WAIVED) with the artifacts that RAN —
 *  which includes markdown eval-specs and P1+ evals that exited 0, not only
 *  those observed RED. The gate then carries forward earlier stamps for
 *  evals that still exist (see `carryForwardStamps` in commands/gate.ts). */
export function stampEvalShas(evals: Record<string, string>): RedEvalShas {
  const out: RedEvalShas = {};
  for (const [rel, md] of Object.entries(evals)) out[rel] = stepBodySha(rel, md);
  return out;
}

export interface StepBodyFinding {
  kind: "moved" | "missing" | "unstamped" | "repointed" | "dropped" | "unverifiable";
  evalPath: string;
  message: string;
}

/**
 * Compare stamped shas against the evals on disk now.
 *
 * `moved`     — a locked step body changed. This is the failure the whole
 *               module exists for.
 * `missing`   — a stamped eval is gone. Deleting an eval out from under a
 *               RED stamp is the same class of move as editing it.
 * `unstamped` — an eval exists that Gate 4 never stamped. Advisory: it is
 *               how a grandfathered workstream looks, and how a legitimately
 *               new eval looks before its gate re-runs.
 */
export function verifyStepBodies(
  stamped: RedEvalShas,
  current: Record<string, string>,
): StepBodyFinding[] {
  const findings: StepBodyFinding[] = [];
  for (const [rel, sha] of Object.entries(stamped)) {
    if (!(rel in current)) {
      findings.push({
        kind: "missing",
        evalPath: rel,
        message: `${rel} was stamped by the RED gate and is now absent — an eval cannot leave under its own stamp`,
      });
      continue;
    }
    const now = stepBodySha(rel, current[rel]);
    if (now !== sha) {
      findings.push({
        kind: "moved",
        evalPath: rel,
        message: `${rel} step body changed under a RED stamp (${sha.slice(0, 12)} → ${now.slice(0, 12)}) — fix the code, not the eval; if the expectation genuinely changed, \`devx revise\` re-opens the red stage and clears the stamp`,
      });
    }
  }
  for (const rel of Object.keys(current)) {
    if (!(rel in stamped)) {
      findings.push({
        kind: "unstamped",
        evalPath: rel,
        message: `${rel} carries no RED stamp — in a locked workstream, \`devx revise\` re-opens the red stage so it can be gated`,
      });
    }
  }
  return findings;
}

/**
 * True when findings should fail a verification.
 *
 * `moved` and `missing` always block. The eval-SET findings block only in a
 * coverage-locked workstream (debug-evlk01 B/C): `unstamped` (an eval added
 * after the lock), `repointed` (an expectation pointed at a different file),
 * `dropped` (a locked eval removed, or reclassified so it no longer runs) and
 * `unverifiable` (the inputs needed to check the set are gone). Each is a way
 * to run — or stop running — code nobody watched fail. Elsewhere they are
 * advisory, which is what keeps grandfathering intact.
 */
export const blocksVerification = (
  f: readonly StepBodyFinding[],
  opts: { locked?: boolean } = {},
): boolean =>
  f.some(
    (x) =>
      x.kind === "moved" ||
      x.kind === "missing" ||
      (opts.locked === true &&
        (x.kind === "unstamped" ||
          x.kind === "repointed" ||
          x.kind === "dropped" ||
          x.kind === "unverifiable")),
  );

// ---------------------------------------------------------------------------
// L1 — the write-time guard
// ---------------------------------------------------------------------------

const EDIT_TOOLS = new Set(["Edit", "Write", "NotebookEdit", "MultiEdit"]);

/** Repo-relative-ish match for a RED eval artifact: an `E-*` file inside an
 *  `evals` directory. Mirrors the outline guard's segment-anchored style so
 *  an absolute path from Edit/Write classifies the same as a diff name. */
export function isEvalArtifactPath(path: string): boolean {
  const segs = path.replace(/\\/g, "/").split("/").filter((s) => s !== "" && s !== ".");
  if (segs.length < 2) return false;
  const base = segs[segs.length - 1];
  if (segs[segs.length - 2] !== "evals") return false;
  // The gate's own report is not an eval.
  if (/^RED-report\.md$/i.test(base)) return false;
  return /^E-/.test(base);
}

export interface EvalsGuardDecision {
  deny: boolean;
  reason?: string;
}

export interface EvalsGuardInput {
  /** The PreToolUse payload. */
  payload: unknown;
  /** Whether the workstream owning the target is currently RED-locked
   *  (`gate_status.evals_red === true`). Resolved by the caller — this
   *  module does no I/O. */
  evalsRed: boolean;
}

/**
 * Decide a PreToolUse payload against the RED lock.
 *
 * Denies an edit to a locked eval artifact. Unknown or malformed input
 * allows: like the outline guard, this must never brick unrelated tool use,
 * and a guard that fails closed on a shape it did not expect gets disabled.
 *
 * NOTE the deliberate asymmetry with the outline guard — this one is scoped
 * by STATE (`evals_red`), not by path alone. An eval is fully writable while
 * it is being authored; it locks only once a gate has certified it failing
 * for the right reason, and unlocks when the red stage is re-opened by
 * `devx revise` (which clears the stamp) — not by re-running the gate, which
 * cannot re-stamp an eval that now passes (debug-evlk01 D).
 */
export function evalsGuardDecision(input: EvalsGuardInput): EvalsGuardDecision {
  if (!input.evalsRed) return { deny: false };
  const p = input.payload;
  if (typeof p !== "object" || p === null) return { deny: false };
  const { tool_name, tool_input } = p as {
    tool_name?: unknown;
    tool_input?: unknown;
  };
  const tool = typeof tool_name === "string" ? tool_name : "";
  if (!EDIT_TOOLS.has(tool)) return { deny: false };
  const inp =
    typeof tool_input === "object" && tool_input !== null
      ? (tool_input as Record<string, unknown>)
      : {};
  const target =
    (typeof inp.file_path === "string" && inp.file_path) ||
    (typeof inp.notebook_path === "string" && inp.notebook_path) ||
    "";
  if (target === "" || !isEvalArtifactPath(target)) return { deny: false };

  return {
    deny: true,
    reason:
      `${tool} on '${target}' denied: this eval is RED-locked. The gate ` +
      "certified it failing for the right reason, and an eval edited during " +
      "implementation turns a green run into a tautology. Fix the code, not " +
      "the eval. If the expectation itself genuinely changed, that is a " +
      "revision: `devx revise` re-opens the red stage and clears the stamp " +
      "(re-running the gate cannot re-stamp an eval that now passes — it " +
      "requires P0 evals to be RED). Result of record stays writable and does " +
      "not need this: Status / Last run / Verdict / Result lines, and the " +
      "table under a `Runs` heading.",
  };
}
