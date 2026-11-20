// `devx checkpoint <dev-hash>` — write a phase's verification record
// (A11/B15).
//
// `_devx/templates/engine/checkpoint.md` shipped with v2s101 and nothing ever
// wrote it: `grep checkpoints/ skills/` was zero hits and `checkpoints/` was
// scaffolded empty in every workstream. v2/02-engine.md §4.8 folds `/devx
// verify` into Phase 5 under YOLO, so the evidence that a phase verified
// lived only in whatever that run's status log happened to say — and nothing
// downstream could reconcile against it.
//
// A CLI rather than four paragraphs of skill prose instructing a template
// fill, for two reasons. The verdict block is schema-fixed (D-9) and
// `renderVerdictBlock` refuses an invalid one, which a hand-fill cannot
// promise; and the S-1 full-run prose budget is nearly spent, so the cheapest
// honest home for a mechanical write is code.
//
// Resolution: dev hash → its spec → `resolveSpecWorkstream` (which already
// handles BOTH spellings of `plan:` — a workstream directory and a plan-spec
// path) → the workstream base → `checkpoints/phase-<n>.md`. Deliberately the
// SHARED resolver and not a fourth hand-rolled pointer match: `plan:` is
// spelled both ways across `dev/` today, and a private match is how a
// consumer silently resolves a different workstream than its neighbours.
//
// Exit codes match every engine command:
//   0 — written.
//   1 — refused with a precise reason (no `phase:`, no resolvable workstream).
//   2 — error: unknown hash, bad flags, unreadable input, failed write.
//
// Design: v2/02-engine.md §4.8; template: _devx/templates/engine/checkpoint.md

import { join } from "node:path";
import type { Command } from "commander";

import { attachPhase } from "../lib/help.js";
import * as artifacts from "../lib/engine/artifacts.js";
import {
  type CheckpointInput,
  type ExpectationRun,
  carryForwardDrift,
  renderCheckpoint,
} from "../lib/engine/checkpoint.js";
import { loadEngineContext } from "../lib/engine/context.js";
import { readEngineState } from "../lib/engine/frontmatter.js";
import { parsePlanCoverageTable } from "../lib/engine/gate-evals.js";
import { parseFrontmatterValue } from "../lib/plan/validate-emit.js";
import { VERDICTS, type Verdict, formatDate } from "../lib/engine/verdict.js";
import {
  type EngineFs,
  findSpecForHashInFs,
  realEngineFs,
  resolveSpecWorkstream,
} from "../lib/engine/workstream.js";

export interface RunCheckpointOpts {
  out?: (s: string) => void;
  err?: (s: string) => void;
  /** Test seam: explicit project config path (skip findProjectConfig walk). */
  projectPath?: string;
  fs?: Partial<EngineFs>;
  now?: () => Date;
}

export interface CheckpointFlags {
  verdict?: string;
  reason?: string;
  lint?: string;
  types?: string;
  suite?: string;
  /** Path to a JSON array of `ExpectationRun`s — the observed runs. */
  runs?: string;
  approver?: string;
  waiverReason?: string;
  /** Override the phase the dev spec's `phase:` frontmatter names. */
  phase?: string;
}

const USAGE =
  "usage: devx checkpoint <dev-hash> --verdict <PASS|CONCERNS|FAIL|WAIVED> --reason <text> [--lint <r>] [--types <r>] [--suite <r>] [--runs <json-path>] [--phase <n>]";

/**
 * Parse `--runs`: a JSON array of observed runs. Deliberately a FILE rather
 * than repeated flags — the detail cell is a sentence with shell-hostile
 * characters in it, and `devx gate coverage --table` already set this seam's
 * precedent for "judgment the CLI records but does not compute".
 */
function parseRuns(json: string): { ok: true; runs: ExpectationRun[] } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return { ok: false, error: `--runs is not valid JSON: ${message(e)}` };
  }
  const rows = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { runs?: unknown }).runs)
      ? ((parsed as { runs: unknown[] }).runs)
      : null;
  if (rows === null) {
    return { ok: false, error: "--runs must be a JSON array, or an object with a `runs` array" };
  }
  const runs: ExpectationRun[] = [];
  for (const [i, raw] of rows.entries()) {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: `--runs[${i}] is not an object` };
    }
    const r = raw as Record<string, unknown>;
    const eId = typeof r.eId === "string" ? r.eId.trim() : "";
    if (!/^E-\d+$/i.test(eId)) {
      return { ok: false, error: `--runs[${i}].eId '${String(r.eId)}' is not an E-<n> id` };
    }
    // An absent exit code is `null` — "nothing was run" — and is NOT
    // defaulted to 0. A missing field read as success is how a checkpoint
    // claims an observation it never made, which is the one thing this
    // record exists to prevent.
    const exitRaw = r.exitCode ?? r.exit ?? null;
    if (exitRaw !== null && !Number.isInteger(exitRaw)) {
      return {
        ok: false,
        error: `--runs[${i}].exitCode must be an integer or null (got ${JSON.stringify(exitRaw)})`,
      };
    }
    runs.push({
      eId: eId.toUpperCase(),
      type: typeof r.type === "string" ? r.type : "",
      command: typeof r.command === "string" ? r.command : "",
      exitCode: exitRaw === null ? null : (exitRaw as number),
      detail: typeof r.detail === "string" ? r.detail : "",
    });
  }
  return { ok: true, runs };
}

/**
 * Seed the runs table from the plan's coverage rows for this phase.
 *
 * Every seeded row carries `exitCode: null` — ⏳, "nothing run" — because
 * that is the truth: no command was observed. A seed is a worklist for the
 * operator, never evidence, and filling the exit column with zeroes would
 * turn an un-run phase into a green record.
 */
function seedRuns(plan: string, phase: number): ExpectationRun[] {
  return parsePlanCoverageTable(plan)
    .filter((row) => row.phase === phase)
    .map((row) => ({
      eId: row.eId,
      type: row.validationType ?? "",
      command: "",
      exitCode: null,
      detail: "not recorded — pass --runs to record the observed run",
    }));
}

export function runCheckpoint(
  args: string[],
  flags: CheckpointFlags,
  opts: RunCheckpointOpts = {},
): number {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const err = opts.err ?? ((s) => process.stderr.write(s));
  const fs: EngineFs = { ...realEngineFs, ...(opts.fs ?? {}) };
  const now = opts.now ?? (() => new Date());

  if (args.length !== 1) {
    err(`${USAGE}\n`);
    return 2;
  }
  const verdictRaw = (flags.verdict ?? "").trim().toUpperCase();
  if (!(VERDICTS as readonly string[]).includes(verdictRaw)) {
    err(
      `devx checkpoint: --verdict must be one of ${VERDICTS.join(" | ")} (got '${flags.verdict ?? ""}')\n`,
    );
    return 2;
  }
  const verdict = verdictRaw as Verdict;
  if (!flags.reason || flags.reason.trim() === "") {
    err(
      "devx checkpoint: --reason <text> is required — the verdict block records WHY in 1–2 sentences (D-9)\n",
    );
    return 2;
  }
  // D-9: a WAIVED record names its approver and its reason, or it is not a
  // waiver — it is an unexplained pass. `renderVerdictBlock` refuses it too;
  // refusing here names the missing FLAG rather than the missing field.
  if (verdict === "WAIVED") {
    if (!flags.approver || flags.approver.trim() === "") {
      err("devx checkpoint: --verdict WAIVED requires --approver <name> (D-9)\n");
      return 2;
    }
    if (!flags.waiverReason || flags.waiverReason.trim() === "") {
      err("devx checkpoint: --verdict WAIVED requires --waiver-reason <text> (D-9)\n");
      return 2;
    }
  } else if (flags.approver !== undefined || flags.waiverReason !== undefined) {
    err("devx checkpoint: --approver/--waiver-reason only apply with --verdict WAIVED\n");
    return 2;
  }

  const ctx = loadEngineContext(opts.projectPath);
  if (!ctx.ok) {
    err(`devx checkpoint: ${ctx.error}\n`);
    return 2;
  }
  const { repoRoot, engine } = ctx.ctx;

  const hash = args[0].toLowerCase();
  const specAbs = findSpecForHashInFs(fs, repoRoot, "dev", hash);
  if (specAbs === null) {
    err(`devx checkpoint: no dev spec found for hash '${hash}'\n`);
    return 2;
  }
  let specContent: string;
  try {
    specContent = fs.readFile(specAbs);
  } catch (e) {
    err(`devx checkpoint: ${specAbs} unreadable: ${message(e)}\n`);
    return 2;
  }
  const state = readEngineState(specContent);

  // `--phase` overrides, because a dev spec minted before `phase:` existed is
  // grandfathered (debug-9b9be5) and a human may know which phase it is. An
  // absent phase with no override is a REFUSAL, not a guess: a checkpoint
  // filed against the wrong phase is worse than none.
  let phase: number | null = state.phase;
  if (flags.phase !== undefined) {
    if (!/^[1-9]\d*$/.test(flags.phase.trim())) {
      err(`devx checkpoint: --phase must be a positive integer (got '${flags.phase}')\n`);
      return 2;
    }
    phase = Number(flags.phase.trim());
  }
  if (phase === null) {
    out(
      `${JSON.stringify({
        checkpoint: null,
        hash,
        refusal:
          "the dev spec carries no `phase:` frontmatter, so which plan phase this verifies is unknown — pass --phase <n>",
      })}\n`,
    );
    return 1;
  }

  const membership = resolveSpecWorkstream(
    fs,
    repoRoot,
    engine,
    specContent,
    parseFrontmatterValue,
  );
  if (membership.workstreamRel === null) {
    out(
      `${JSON.stringify({
        checkpoint: null,
        hash,
        refusal:
          "this spec resolves to no engine workstream (no `workstream:`/`plan:`/`from:` pointer) — a standalone story has no plan phase to verify",
      })}\n`,
    );
    return 1;
  }

  const base: artifacts.ResolvedBase = {
    repoRoot,
    workstreamRel: membership.workstreamRel,
    layout: engine.docsLayout,
  };
  const dir = artifacts.stageSubject(base.layout, base, { kind: "checkpoints-dir" });
  const name = `phase-${phase}.md`;
  const abs = join(dir.abs, name);
  const rel = `${dir.rel}/${name}`;

  // The runs table: observed if the caller recorded one, otherwise seeded
  // from the plan with every exit code null.
  let runs: ExpectationRun[];
  if (flags.runs !== undefined) {
    let json: string;
    try {
      json = fs.readFile(flags.runs);
    } catch (e) {
      err(`devx checkpoint: cannot read --runs '${flags.runs}': ${message(e)}\n`);
      return 2;
    }
    const parsed = parseRuns(json);
    if (!parsed.ok) {
      err(`devx checkpoint: ${parsed.error}\n`);
      return 2;
    }
    runs = parsed.runs;
  } else {
    const planSubject = artifacts.stageSubject(base.layout, base, {
      kind: "agent",
      stage: "plan",
    });
    let plan = "";
    if (artifacts.artifactExists(fs, base, { kind: "agent", stage: "plan" })) {
      try {
        plan = fs.readFile(planSubject.abs);
      } catch {
        // An unreadable plan seeds an empty table — the verdict and the
        // cross-cutting checks are still worth recording, and the table says
        // "no expectation" rather than inventing rows.
      }
    }
    runs = seedRuns(plan, phase);
  }

  // Carry the previous file's drift note forward (see carryForwardDrift): a
  // checkpoint is current-state, but a drift note is a finding about the
  // PLAN, and a re-run must not silently drop the only record of it.
  let previous: string | null = null;
  if (fs.exists(abs)) {
    try {
      previous = fs.readFile(abs);
    } catch {
      // Unreadable previous file: the write below still replaces it, and the
      // drift note is lost — but it was already unreadable, so there is
      // nothing to carry and nothing a refusal would save.
    }
  }

  const input: CheckpointInput = {
    workstreamLabel:
      membership.slug ??
      (membership.workstreamRel === "." ? "<repo root>" : membership.workstreamRel),
    phase,
    date: formatDate(now()),
    verdict,
    statusReason: flags.reason.trim(),
    ...(verdict === "WAIVED"
      ? {
          waiver: {
            active: true,
            approver: flags.approver!.trim(),
            reason: flags.waiverReason!.trim(),
          },
        }
      : {}),
    runs,
    checks: {
      lint: flags.lint ?? "",
      types: flags.types ?? "",
      suite: flags.suite ?? "",
    },
    drift: carryForwardDrift(previous),
  };

  let body: string;
  try {
    body = renderCheckpoint(input);
  } catch (e) {
    // A D-9 violation `renderCheckpoint` caught that the flag checks above
    // did not — refuse rather than write an invalid record.
    err(`devx checkpoint: ${message(e)}\n`);
    return 2;
  }

  try {
    fs.mkdirRecursive(dir.abs);
    fs.writeFile(abs, body);
  } catch (e) {
    err(`devx checkpoint: write failed: ${message(e)}\n`);
    return 2;
  }

  out(
    `${JSON.stringify({
      checkpoint: rel,
      hash,
      phase,
      verdict,
      workstream: membership.workstreamRel,
      runs: runs.length,
      seeded: flags.runs === undefined,
      drift_carried: input.drift !== "",
    })}\n`,
  );
  return 0;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function register(program: Command): void {
  const sub = program
    .command("checkpoint")
    .description(
      "Write a plan phase's verification record to the workstream's checkpoints/phase-<n>.md: a D-9 verdict block, the observed expectation runs, and the cross-cutting checks. Resolves the phase from the dev spec's `phase:` frontmatter. Re-running overwrites every section but 'Drift noted', which is carried forward.",
    )
    .argument("<hash>", "dev spec hash (the story that implemented the phase)")
    .requiredOption("--verdict <verdict>", "PASS | CONCERNS | FAIL | WAIVED")
    .requiredOption("--reason <text>", "1–2 sentences for the verdict block's status_reason")
    .option("--lint <result>", "lint result over the touched surfaces")
    .option("--types <result>", "typecheck result")
    .option("--suite <result>", "full-suite result, ideally with a count")
    .option(
      "--runs <json-path>",
      "JSON array of observed runs ({eId, type, command, exitCode, detail}); omitted → seeded from the plan's coverage rows with every exit code null",
    )
    .option("--phase <n>", "override the phase the dev spec's `phase:` names")
    .option("--approver <name>", "waiver approver (required with --verdict WAIVED)")
    .option("--waiver-reason <text>", "waiver reason (required with --verdict WAIVED)")
    .action((hash: string, cmdOpts: CheckpointFlags) => {
      const code = runCheckpoint([hash], cmdOpts);
      if (code !== 0) process.exit(code);
    });
  attachPhase(sub, 1);
}
