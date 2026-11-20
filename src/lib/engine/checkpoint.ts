// Pure checkpoint renderer — the per-phase verification record (A11/B15).
//
// `_devx/templates/engine/checkpoint.md` shipped with v2s101 and was never
// written by anything: `grep checkpoints/ skills/` returned zero hits, and
// `checkpoints/` was scaffolded empty in every workstream. The evidence
// record was designed, templated, and then never produced — so a phase's
// verification lived only in whatever a `/devx` run happened to say in its
// status log, and nothing downstream could reconcile against it.
//
// This module renders the file; `src/commands/checkpoint.ts` resolves the
// paths and writes it. Pure by contract, same posture as verdict.ts and
// render.ts: callers read and write, this only transforms text.
//
// This renderer is the SINGLE definition of the artifact's shape, and the
// shipped `_devx/templates/engine/checkpoint.md` is deleted with it. That
// template had no reader at all — not before (nothing wrote checkpoints) and
// not now (this builds the file whole), so it was dead prose inside a gated
// budget, and a second definition of one artifact's shape is exactly how a
// rendered file and its scaffold drift apart. A reader who wants the shape
// opens a real checkpoint, or this function.
//
// Design: v2/02-engine.md §4.8 (/devx verify folded into Phase 5 under YOLO)

import {
  INACTIVE_WAIVER,
  type Verdict,
  type Waiver,
  renderVerdictBlock,
} from "./verdict.js";

/** One expectation's observed run, as the checkpoint's table records it. */
export interface ExpectationRun {
  /** `E-1`. */
  eId: string;
  /** `tests-first` | `tests-after` | `human` | `waived` — from the plan's
   *  coverage table, carried verbatim rather than re-classified here. */
  type: string;
  /** The command that was run, or `—` when the type has none (human). */
  command: string;
  /** Observed exit code, or null when nothing was run. */
  exitCode: number | null;
  /** What the run showed. Free text — this is the evidence line. */
  detail: string;
}

export interface CrossCuttingChecks {
  /** Lint result over the touched surfaces. */
  lint: string;
  /** Typecheck result. */
  types: string;
  /** Full-suite result, ideally with a count. */
  suite: string;
}

export interface CheckpointInput {
  /** Workstream label for the heading — the slug, or `<repo root>` under
   *  `project-level` where there is no directory to name. */
  workstreamLabel: string;
  /** 1-based plan phase. */
  phase: number;
  /** YYYY-MM-DD. */
  date: string;
  verdict: Verdict;
  /** 1–2 sentences, straight into the verdict block's `status_reason:`. */
  statusReason: string;
  waiver?: Waiver;
  runs: readonly ExpectationRun[];
  checks: CrossCuttingChecks;
  /**
   * What the implementation revealed that later phases must absorb, or empty
   * for none.
   *
   * Carried rather than generated: on a re-run this is the one section whose
   * content a human may have typed, so the writer reads the previous file's
   * drift section and hands it back here. A checkpoint is current-state (the
   * phase either verifies now or it does not), but a drift note is a finding
   * about the PLAN, and overwriting one would silently drop the only record
   * that the plan needs changing.
   */
  drift: string;
}

/** The glyph column: a run that passed, a run that failed, nothing run. */
function statusGlyph(run: ExpectationRun): string {
  if (run.exitCode === null) return "⏳";
  return run.exitCode === 0 ? "✅" : "❌";
}

/** Escape a table cell: a pipe inside a command would split the row, and a
 *  newline would end it. */
function cell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

const EM_DASH = "—";
const nonEmpty = (s: string): string => (s.trim() === "" ? EM_DASH : cell(s));

/**
 * Render `checkpoints/phase-<n>.md`.
 *
 * Throws on a D-9 violation in the verdict block (an unrecognized verdict, a
 * WAIVED with no named approver) — `renderVerdictBlock` owns that rule, and
 * an invalid record is worse than no record.
 */
export function renderCheckpoint(input: CheckpointInput): string {
  const block = renderVerdictBlock({
    gate: input.verdict,
    statusReason: input.statusReason,
    // The producer, named so a reader knows the evidence was machine-written
    // from an observed run rather than typed afterwards.
    reviewer: "devx checkpoint",
    updated: input.date,
    waiver: input.waiver ?? INACTIVE_WAIVER,
  });

  const rows =
    input.runs.length > 0
      ? input.runs.map(
          (r) =>
            `| ${cell(r.eId)} | ${nonEmpty(r.type)} | ${
              r.command.trim() === "" ? EM_DASH : `\`${cell(r.command)}\``
            } | ${r.exitCode === null ? EM_DASH : r.exitCode} | ${statusGlyph(r)} | ${nonEmpty(r.detail)} |`,
        )
      : [
          // Not an empty table: a phase with no expectation of its own is a
          // real case (an infra phase, a doc phase), and a reader must be able
          // to tell it from a checkpoint whose table was never filled.
          `| ${EM_DASH} | ${EM_DASH} | ${EM_DASH} | ${EM_DASH} | ${EM_DASH} | no expectation is verified in this phase |`,
        ];

  return [
    block.trimEnd(),
    "",
    `# Checkpoint — ${input.workstreamLabel} phase ${input.phase} — ${input.date}`,
    "",
    "<!-- The phase's verification plan run as the pass/fail of record.",
    "     Written by `devx checkpoint`; re-running it overwrites every section",
    '     but "Drift noted", which is carried forward. done ≠ verified. -->',
    "",
    "## Expectation runs",
    "",
    "| E-id | Type | Command | Exit | Status | Detail |",
    "|---|---|---|---|---|---|",
    ...rows,
    "",
    "## Cross-cutting checks",
    "",
    `- Lint (touched surfaces): ${nonEmpty(input.checks.lint)}`,
    `- Types: ${nonEmpty(input.checks.types)}`,
    `- Full suite: ${nonEmpty(input.checks.suite)}`,
    "",
    "## Drift noted",
    "",
    input.drift.trim() === ""
      ? "Nothing — the plan's later phases need no change from this one."
      : input.drift.trim(),
    "",
  ].join("\n");
}

/** Heading the drift section carries, in both the template and the render. */
const DRIFT_HEADING = "## Drift noted";

/**
 * The previous checkpoint's drift section, so a re-run carries it forward.
 *
 * Returns `""` when there is no previous file, no drift section, or the
 * section still holds the render's own "Nothing —" sentence or the template's
 * `<…>` placeholder — none of those is a human finding, and carrying one
 * forward would make every checkpoint claim a drift note it does not have.
 */
export function carryForwardDrift(previous: string | null): string {
  if (previous === null) return "";
  const at = previous.indexOf(DRIFT_HEADING);
  if (at === -1) return "";
  const body = previous
    .slice(at + DRIFT_HEADING.length)
    // The drift section is last in the render, but a hand-edited file may
    // have grown another heading after it.
    .split(/^## /m)[0]
    .trim();
  if (body === "") return "";
  if (body.startsWith("Nothing —")) return "";
  // The shipped template's placeholder is a `<…>` paragraph.
  if (/^<[^>]*>$/s.test(body)) return "";
  return body;
}
