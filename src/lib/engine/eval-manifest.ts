// Eval-manifest parser — the documented shape for a markdown eval (B17).
//
// devx runs CODE evals better than upstream does: `Verified by:` names a test
// path, `devx gate evals` runs it through the project's `projects:` runner and
// stamps its body. What it had no shape for was the eval that is NOT a test
// file — a measurement, a judged output, a human procedure. Those shipped as
// freeform prose, and the only thing that constrained them was
// `isResultOfRecordLine` in evals-lock.ts, which is a LOCKING rule, not an
// authoring one. So an author had to infer the shape from a hashing function.
//
// This module gives that shape a parser, and the template
// `_devx/templates/engine/evals/eval.md` gives it a form. Ported from
// 8am-harness `docs/harness/_templates/eval.md` with two deliberate cuts:
//
//   - `ui` steps are dropped. devx routes browser checks to `/devx-test`
//     walkthroughs or a committed Playwright spec invoked from a `script`
//     step (docs/QA.md), so a `ui` type would be a third path to the same
//     two places.
//   - the step-type catalog's prose stays upstream. devx's templates are
//     CI-gated by byte count (S-1), and a decision guide that long would
//     eat the whole budget.
//
// The one thing a step can declare that nothing else in devx could express:
// **deferred to outcome**. A step marked `(measured at outcome)` asserts a
// number that cannot exist until the thing has been live for a while. It is
// RED by construction before launch, which means it is not evidence of
// anything at Gate 4 — and demanding RED from it, or counting it as a P0
// floor breach, would make the only honest way to write a measurable goal
// also the way to wedge the RED gate. Two consumers read that marker:
//
//   - `devx gate evals` defers a manifest whose steps are ALL deferred
//     (`isOutcomeDeferredManifest`), at any priority.
//   - `devx outcome score --run` executes the deferred steps
//     (`outcomeMeasures`) to score the goals the expectation Covers.
//
// Pure: no I/O, no clock. Callers read files.
//
// Spec: docs/updates/8am-harness-gap-analysis.md rows B17, A18/C5/B20.

/** Step types devx recognizes. `ui` is deliberately absent (see above). */
export const EVAL_STEP_TYPES = ["script", "judge", "metric", "human"] as const;
export type EvalStepType = (typeof EVAL_STEP_TYPES)[number];

/**
 * The deferred-to-outcome marker. Written `(measured at outcome)`; the
 * `/devx ` and `devx ` spellings are accepted because that is how the skill
 * body and the upstream template name the command, and an author who copies
 * either must not silently lose the deferral.
 */
export const OUTCOME_MARKER_RE =
  /\(\s*measured\s+at\s+(?:\/?devx\s+)?outcome\s*\)/i;

// The same marker plus any code fencing around it, for stripping it out of a
// step TITLE. The template writes it in backticks so it renders as a chip,
// and leaving the empty pair behind made every title read `… \`\``.
const OUTCOME_MARKER_IN_TITLE_RE =
  /`*\s*\(\s*measured\s+at\s+(?:\/?devx\s+)?outcome\s*\)\s*`*/i;

export interface EvalStep {
  /** 1-based position in the manifest, from the heading's number when it
   *  carries one, else the step's ordinal. */
  index: number;
  type: EvalStepType;
  title: string;
  /** 1-based line of the step heading. */
  line: number;
  /** `Run:` — the command. Backticks stripped. Locked by the RED stamp. */
  run: string | null;
  /** `Window:` — the fixed observation window a re-run is interpretable
   *  against. Locked (it is part of what the measure asserts). */
  window: string | null;
  /** `Expected:` or `Threshold:` — the bar. Locked. */
  expected: string | null;
  /** True when the step carries OUTCOME_MARKER_RE in its heading or body. */
  deferredToOutcome: boolean;
}

export interface EvalManifest {
  /** True when ≥1 typed step parsed — i.e. this really is a manifest and not
   *  a freeform markdown eval. Every consumer gates on this before applying
   *  a manifest rule, so the freeform evals that shipped before the shape
   *  existed keep their old behavior exactly. */
  isManifest: boolean;
  steps: EvalStep[];
}

// `### 1. metric — adoption` / `### metric: adoption` / `#### 2) script - x`.
// The number and the dash are both optional: the shape that matters is
// "a heading naming a step type".
const STEP_HEADING_RE = new RegExp(
  `^#{2,6}\\s+(?:(\\d+)\\s*[.)]\\s*)?(${EVAL_STEP_TYPES.join("|")})\\b\\s*(?:[—–:-]\\s*)?(.*)$`,
  "i",
);

const ANY_HEADING_RE = /^#{1,6}\s+/;

interface FieldSpec {
  key: "run" | "window" | "expected";
  re: RegExp;
}

// `- **Run:** \`cmd\`` and friends. The label set is deliberately narrow and
// matches evals-lock.ts's split: `Run:`/`Expected:`/`Threshold:`/`Window:`
// are STEP content (hashed under a RED stamp); `Result:`/`Status:` are the
// result of record (writable) and are not parsed here because nothing
// downstream reads them — the Runs table is the record.
const FIELD_SPECS: readonly FieldSpec[] = [
  { key: "run", re: /^[-*+]\s+\*\*Run:\*\*\s*(.*)$/i },
  { key: "window", re: /^[-*+]\s+\*\*Window:\*\*\s*(.*)$/i },
  { key: "expected", re: /^[-*+]\s+\*\*(?:Expected|Threshold):\*\*\s*(.*)$/i },
];

/** Strip surrounding markdown code fencing from a single-line value. */
function unticked(value: string): string {
  const trimmed = value.trim();
  const fenced = /^`+([^`]*)`+$/.exec(trimmed);
  return (fenced ? fenced[1] : trimmed).trim();
}

/**
 * Parse a markdown eval into typed steps.
 *
 * Tolerant by design, like `parseExpectations`: a missing field is `null`
 * and validation is the caller's job. Field values absorb indented
 * continuation lines so a command or a threshold wrapped at the house line
 * width parses as one value — the same wrapped-value lesson v2e102's first
 * real run taught the expectations parser.
 */
export function parseEvalManifest(md: string): EvalManifest {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const steps: EvalStep[] = [];
  let current: EvalStep | null = null;
  let openKey: FieldSpec["key"] | null = null;
  // A `Run:` bullet with no inline value, waiting for its fenced command
  // block. Tracked separately from `openKey` because a BLANK LINE sits
  // between the bullet and the fence in the shape authors actually write,
  // and a blank line closes `openKey` (it has to, or an indented line two
  // paragraphs down would fold into the value).
  let runFencePending = false;
  // Inside a fence everything is literal: a `### metric — x` line in an
  // example block must not open a step, and a `- **Run:**` line in one must
  // not overwrite the real command.
  let fence: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fenceEdge = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence !== null) {
      if (
        fenceEdge &&
        fenceEdge[1][0] === fence[0] &&
        fenceEdge[1].length >= fence.length &&
        line.trim() === fenceEdge[1]
      ) {
        fence = null;
      } else if (current !== null && runFencePending && current.run === null) {
        // A fenced command block IS the `Run:` value when the bullet carried
        // none — the upstream template writes commands that way, and losing
        // them would make every ported manifest look unrunnable.
        const body = line.trim();
        if (body !== "") current.run = body;
      }
      continue;
    }
    // Opened by ANY fence line, info string or not: the closing edge is the
    // one that must match exactly. Requiring an exact match to OPEN meant
    // ```` ```md ```` never opened a fence, so every step heading inside a
    // documentation block became a real step.
    if (fenceEdge) {
      fence = fenceEdge[1];
      continue;
    }

    const heading = STEP_HEADING_RE.exec(line);
    if (heading) {
      const numbered = heading[1] === undefined ? null : Number(heading[1]);
      current = {
        index: numbered ?? steps.length + 1,
        type: heading[2].toLowerCase() as EvalStepType,
        title: unticked(heading[3].replace(OUTCOME_MARKER_IN_TITLE_RE, " ")),
        line: i + 1,
        run: null,
        window: null,
        expected: null,
        deferredToOutcome: OUTCOME_MARKER_RE.test(line),
      };
      steps.push(current);
      openKey = null;
      runFencePending = false;
      continue;
    }
    if (ANY_HEADING_RE.test(line)) {
      // Any other heading closes the step: its fields end where it does.
      current = null;
      openKey = null;
      runFencePending = false;
      continue;
    }
    if (current === null) continue;

    // The marker may sit in the step body rather than the heading.
    if (!current.deferredToOutcome && OUTCOME_MARKER_RE.test(line)) {
      current.deferredToOutcome = true;
    }

    let matched = false;
    for (const spec of FIELD_SPECS) {
      const m = spec.re.exec(line);
      if (!m) continue;
      matched = true;
      openKey = spec.key;
      // First occurrence wins (parseExpectations' duplicate-field policy).
      const raw = m[1].trim();
      if (current[spec.key] === null) {
        const value = spec.key === "run" ? unticked(m[1]) : raw;
        if (value !== "") current[spec.key] = value;
      }
      runFencePending = spec.key === "run" && raw === "";
      break;
    }
    if (matched) continue;
    if (/^\s*$/.test(line) || /^\s*[-*+]\s/.test(line)) {
      openKey = null;
      continue;
    }
    if (openKey !== null && /^\s{2,}\S/.test(line)) {
      const prior = current[openKey];
      const joined = `${prior ?? ""} ${line.trim()}`.trim();
      current[openKey] = openKey === "run" ? unticked(joined) : joined;
    }
  }

  return { isManifest: steps.length > 0, steps };
}

/** The steps `devx outcome score --run` executes, in manifest order. */
export function outcomeMeasures(md: string): EvalStep[] {
  return parseEvalManifest(md).steps.filter((s) => s.deferredToOutcome);
}

/**
 * True when every step in a manifest is deferred to the outcome window.
 *
 * This is the one condition under which Gate 4 lets a markdown artifact
 * stand in for a runnable one at ANY priority (B17): there is, by
 * construction, nothing to watch fail yet. A manifest with even one
 * non-deferred step keeps today's behavior — a P0 must name a target the
 * gate can actually run — because its "only unmet step" is then not the
 * deferred one, and weakening the P0 floor on a partially-runnable manifest
 * would turn the whole RED gate into an opt-out.
 */
export function isOutcomeDeferredManifest(md: string): boolean {
  const { isManifest, steps } = parseEvalManifest(md);
  return isManifest && steps.every((s) => s.deferredToOutcome);
}
