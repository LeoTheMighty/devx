// The inner iteration contract (v2l101) — gnhf's 62-line iteration prompt
// adapted to devx's spec-file world, plus the structured-report schema the
// loop's control flow branches on.
//
// Three surfaces:
//
//   buildIterationPrompt(params)     — the per-iteration prompt frame
//                                      (v2/04-overnight-loop.md §2.2). The
//                                      load-bearing sentences are pinned by
//                                      test/loop-iteration.test.ts; edit them
//                                      there first.
//   buildCommitRepairPrompt(...)     — the one no-rollback path: the previous
//                                      iteration's work couldn't be committed,
//                                      so the next iteration is repair-only.
//   buildReportRetryPrompt(...)      — the schema-mismatch retry protocol:
//                                      one cheap re-ask for JUST the JSON.
//
//   extractReportJson(text)          — recover the final JSON object from a
//                                      fenced / prose-wrapped reply (gnhf's
//                                      json-extract idea).
//   validateIterationReport(value)   — typed errors; control flow branches
//                                      ONLY on the validated object, never on
//                                      prose (v2/04 §2.3).
//
// Design rule (memory mapping, v2/04 §2): the worker NEVER commits and NEVER
// edits the Status log — the loop owns both. The prompt says so verbatim;
// the transactional git layer (git-tx.ts) makes violations recoverable
// anyway (reset --hard discards a rogue worker's commits is NOT true — a
// rogue commit survives reset --hard HEAD; the driver's git snapshot log is
// how we catch that class).
//
// Spec: dev/dev-v2l101-2026-07-05T13:06-overnight-loop.md
// Design: v2/04-overnight-loop.md §2.2–2.3

// ---------------------------------------------------------------------------
// Report schema
// ---------------------------------------------------------------------------

export interface IterationReport {
  /** Did this iteration make a meaningful, kept-worthy contribution? false ⇒
   *  the loop discards every workspace change from this iteration. */
  success: boolean;
  /** One-sentence summary of the accomplishment (or the failure). */
  summary: string;
  /** Material outcomes, grouped by logical unit of work — not activities. */
  key_changes_made: string[];
  /** New learnings future iterations should know. Feed the Status log. */
  key_learnings: string[];
  /** true ONLY when every acceptance criterion in the spec is met. Routes
   *  the item to the PR/CI/merge tail (D-11: this is a claim, not
   *  acceptance — merge-gate + CI remain the only path to main). */
  acs_met: boolean;
}

export const REPORT_FIELDS = [
  "success",
  "summary",
  "key_changes_made",
  "key_learnings",
  "acs_met",
] as const;

export type ReportErrorCode =
  | "no-json-found"
  | "not-an-object"
  | "missing-field"
  | "wrong-type";

export interface ReportValidationError {
  code: ReportErrorCode;
  /** Field the error applies to; absent for whole-document errors. */
  field?: string;
  message: string;
}

export type ValidateReportResult =
  | { ok: true; report: IterationReport }
  | { ok: false; errors: ReportValidationError[] };

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/**
 * Validate a parsed JSON value against the report schema. Typed errors so
 * the retry prompt can tell the model exactly what was wrong. Extra keys
 * are IGNORED (models decorate; rejecting on extras would burn a retry on
 * harmless junk) — but every required field must be present with the right
 * type. Nothing is coerced: `"true"` is not a boolean, `null` is not an
 * empty array.
 */
export function validateIterationReport(value: unknown): ValidateReportResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false,
      errors: [
        {
          code: "not-an-object",
          message: "the report must be a single JSON object",
        },
      ],
    };
  }
  const obj = value as Record<string, unknown>;
  const errors: ReportValidationError[] = [];

  const checks: Array<{
    field: (typeof REPORT_FIELDS)[number];
    ok: (v: unknown) => boolean;
    want: string;
  }> = [
    { field: "success", ok: (v) => typeof v === "boolean", want: "a boolean" },
    { field: "summary", ok: (v) => typeof v === "string" && v.trim() !== "", want: "a non-empty string" },
    { field: "key_changes_made", ok: isStringArray, want: "an array of strings" },
    { field: "key_learnings", ok: isStringArray, want: "an array of strings" },
    { field: "acs_met", ok: (v) => typeof v === "boolean", want: "a boolean" },
  ];
  for (const c of checks) {
    if (!(c.field in obj)) {
      errors.push({
        code: "missing-field",
        field: c.field,
        message: `${c.field} is required`,
      });
      continue;
    }
    if (!c.ok(obj[c.field])) {
      errors.push({
        code: "wrong-type",
        field: c.field,
        message: `${c.field} must be ${c.want}`,
      });
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    report: {
      success: obj.success as boolean,
      summary: (obj.summary as string).trim(),
      key_changes_made: obj.key_changes_made as string[],
      key_learnings: obj.key_learnings as string[],
      acs_met: obj.acs_met as boolean,
    },
  };
}

// ---------------------------------------------------------------------------
// JSON recovery (fenced / prose-wrapped output)
// ---------------------------------------------------------------------------

/**
 * Recover the final report JSON from a worker's raw text output. Workers are
 * told to end with a single fenced ```json block, but models wrap, prefix,
 * and trail. Strategy, in order:
 *
 *   1. Last fenced ```json (or bare ```) block that parses as an object.
 *   2. Last balanced `{...}` region in the text that parses as an object AND
 *      mentions a "success" key (cheap relevance filter so a stray JSON blob
 *      in quoted test output doesn't win).
 *
 * Returns the parsed value or null when nothing recoverable exists. Shape
 * validation is the caller's job (validateIterationReport) — this function
 * only finds and parses.
 */
export function extractReportJson(text: string): unknown | null {
  if (typeof text !== "string" || text.trim() === "") return null;

  // 1. Fenced blocks, last-first — preferring the last block that actually
  // VALIDATES as a report over the last that merely parses. Without the
  // preference, a trailing decorative fence (quoted package.json, pasted
  // test output) would shadow a perfectly valid report emitted just before
  // it, burning a retry and potentially rolling back real work (EC-MED-7).
  const fenceRe = /```(?:json)?[^\S\n]*\n([\s\S]*?)```/g;
  const fenced: string[] = [];
  for (const m of text.matchAll(fenceRe)) fenced.push(m[1]);
  let lastParsed: unknown | null = null;
  for (let i = fenced.length - 1; i >= 0; i--) {
    const parsed = tryParseObject(fenced[i]);
    if (parsed === null) continue;
    if (validateIterationReport(parsed).ok) return parsed;
    if (lastParsed === null) lastParsed = parsed;
  }
  if (lastParsed !== null) return lastParsed;

  // 2. Balanced-brace scan, last-first, same validate-first preference.
  // Track string/escape state so braces inside JSON strings don't break
  // the balance count.
  const candidates = balancedObjectRegions(text);
  let lastRegionParsed: unknown | null = null;
  for (let i = candidates.length - 1; i >= 0; i--) {
    const region = candidates[i];
    if (!/"success"/.test(region)) continue;
    const parsed = tryParseObject(region);
    if (parsed === null) continue;
    if (validateIterationReport(parsed).ok) return parsed;
    if (lastRegionParsed === null) lastRegionParsed = parsed;
  }
  return lastRegionParsed;
}

function tryParseObject(s: string): unknown | null {
  try {
    const v = JSON.parse(s.trim());
    if (v && typeof v === "object" && !Array.isArray(v)) return v;
    return null;
  } catch {
    return null;
  }
}

function balancedObjectRegions(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"' && depth > 0) {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start !== -1) {
          out.push(text.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Prompt frames
// ---------------------------------------------------------------------------

export interface PriorAttempt {
  iteration: number;
  success: boolean;
  summary: string;
}

export interface IterationPromptParams {
  /** Spec hash — the worker's unit of identity for the night. */
  hash: string;
  /** Repo-relative spec path (e.g. `dev/dev-abc123-...md`). */
  specRelPath: string;
  /** 1-based iteration number for this item. */
  iteration: number;
  /** Per-item iteration budget, so the worker can size its slice honestly. */
  maxIterations: number;
  /** Orchestrator-owned memory: prior attempts this run (newest last). The
   *  durable history lives in the spec's Status log, which the prompt sends
   *  the worker to read first. */
  priorAttempts?: PriorAttempt[];
}

const OUTPUT_FIELD_LINES = [
  "- success: whether you made a meaningful contribution that got the spec closer to done. Setting this to false means every workspace change you made will be discarded. A complete no-op iteration (no file changes AND no new meaningful learnings worth recording) is not a success — set success=false so the loop can halt rather than spin on no-op iterations.",
  "- summary: a concise one-sentence summary of the accomplishment in this iteration.",
  "- key_changes_made: an array of descriptions of key changes you made. Group by logical units of work, not by file. Describe material outcomes, not activities.",
  "- key_learnings: an array of new learnings that were surprising, weren't captured by the Status log, and would inform future iterations.",
  "- acs_met: set to true ONLY when every acceptance criterion in the spec is met and verified. This routes the item to the PR/CI/merge tail — it is a claim, not acceptance; CI still gates the merge.",
];

/**
 * The §2.2 prompt frame. Every load-bearing sentence below is pinned by
 * test/loop-iteration.test.ts — the contract is what keeps unattended
 * iterations honest, so it must not drift silently.
 */
export function buildIterationPrompt(params: IterationPromptParams): string {
  const prior = params.priorAttempts ?? [];
  const priorSection =
    prior.length === 0
      ? ""
      : `\n\n## Prior attempts this run\n\n${prior
          .map(
            (a) =>
              `- iteration ${a.iteration}: ${a.success ? "ok" : "[FAIL]"} — ${a.summary}`,
          )
          .join("\n")}`;

  return `You are one iteration of an unattended overnight loop working on a devx spec.
This is iteration ${params.iteration} of at most ${params.maxIterations} on spec \`${params.hash}\`. Each iteration makes one incremental, verifiable step — it does not complete the entire spec.

## Instructions

1. Read the spec at \`${params.specRelPath}\` — read the spec's Status log first to understand what previous iterations did and learned. Do NOT edit the Status log or the spec file — the loop orchestrator owns both.
2. Pick the next smallest logical unit of work that is individually verifiable. Do not attempt the whole spec.
3. If your attempt didn't move the needle, record learnings and report failure rather than continuously pivoting.
4. Run the relevant build/tests/linters before reporting success. Do NOT claim success on unverified work.
5. Do NOT commit; do NOT edit the Status log — the loop owns both. Do not push, do not touch git branches or worktrees.
6. Stop any background processes you started (dev servers, watchers, browsers) before finishing.
7. Only emit the final JSON after the result is final: work complete, validation run, background processes stopped.

## Output

End your reply with a single fenced \`\`\`json code block containing exactly one JSON object with these fields:

${OUTPUT_FIELD_LINES.join("\n")}${priorSection}`;
}

/**
 * The commit-repair variant (v2/04 §2.4, "commit failure" row): the previous
 * iteration produced workspace changes the loop could not commit. This is
 * the ONE no-rollback path — the work is preserved and the next iteration
 * is dedicated to repair, nothing else.
 */
export function buildCommitRepairPrompt(
  basePrompt: string,
  gitCommitOutput: string,
): string {
  return `${basePrompt}

## Previous Commit Failure — REPAIR-ONLY ITERATION

The previous iteration made workspace changes, but the loop could not commit them because git commit failed.
Do not start unrelated work.
Inspect and fix the existing uncommitted changes so the commit can pass, then report success.

Git commit output:

\`\`\`
${gitCommitOutput}
\`\`\``;
}

/**
 * The schema-mismatch retry (v2/04 §2.3 "retry on shape mismatch"): one
 * cheap re-ask that carries the typed validation errors + the tail of the
 * previous raw output. The retry worker does NOT do new work — it only
 * re-emits the report.
 */
export function buildReportRetryPrompt(
  rawOutput: string,
  errors: ReportValidationError[],
): string {
  const tail = rawOutput.length > 4000 ? rawOutput.slice(-4000) : rawOutput;
  const errorLines = errors
    .map((e) => `- ${e.field ? `${e.field}: ` : ""}${e.message} (${e.code})`)
    .join("\n");
  return `A previous automated iteration finished its work but its final report did not validate against the required schema. Do NOT do any new work, do NOT modify any files. Your only job is to re-emit the structured report as a single fenced \`\`\`json code block containing exactly one JSON object with the fields:

${OUTPUT_FIELD_LINES.join("\n")}

Validation errors on the previous report:

${errorLines}

Previous output (tail):

\`\`\`
${tail}
\`\`\``;
}
