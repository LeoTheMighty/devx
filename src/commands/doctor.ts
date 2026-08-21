// `devx doctor [--fix]` — mechanical state reconciliation (db36af).
//
// The reconcile() role from the ManageAgent design, surfaced as a standalone
// primitive so a wedged backlog heals itself instead of waiting for a human
// to do forensics. Two real datasets motivated it, both hand-reconciliations
// of this repo: the 2026-07-24 post-mortem (every repair step in commit
// `5f83f3e` was mechanical once the facts were established) and the
// 2026-08-12 pass (commit `9e1d9d3` — 14 stale locks, 2 dead-owner claims,
// 2 mirror drifts, 8 dead blockers, 2 orphan worktrees; a full session of
// forensics, all of it derivable from disk).
//
// Surface:
//   devx doctor          read-only; prints findings, writes nothing
//   devx doctor --fix    additionally applies the mechanical class
//   devx doctor --json   machine-readable {findings, fixed}
//
// EXIT CODES ARE ADVISORY, never a gate:
//   0 — nothing found, or everything found was fixed.
//   3 — unfixed findings remain. Deliberately 3 and not 1: doctor is wired
//       into `devx next` and loop start, and a nonzero that reads as
//       "the command failed" would train callers to ignore it. 3 means
//       "I have something to tell you" — the shape `check-hold` uses.
//   2 — doctor itself could not run (no config, unreadable repo).
//
// Spec: dev/dev-db36af-2026-07-25T08:55-devx-doctor-reconcile.md

import { dirname } from "node:path";
import process from "node:process";

import type { Command } from "commander";

import { findProjectConfig, loadMerged } from "../lib/config-io.js";
import { realExecAsync } from "../lib/exec.js";
import { attachPhase } from "../lib/help.js";
import { collectFindings } from "../lib/doctor/collect.js";
import { type FixOpts, applyFixes } from "../lib/doctor/fix.js";
import {
  DOCTOR_EXIT_CLEAN,
  DOCTOR_EXIT_FINDINGS,
  type DoctorReport,
} from "../lib/doctor/types.js";

export interface RunDoctorOpts {
  out?: (s: string) => void;
  err?: (s: string) => void;
  /** Test seam: explicit project config path (skip the findProjectConfig walk). */
  projectPath?: string;
  /** Test seam: project repo root. */
  repoRoot?: string;
  /** Test seam: forwarded to every detector. */
  detectOpts?: Record<string, unknown>;
  /** Test seam: forwarded to the fixers. */
  fixOpts?: Partial<FixOpts>;
}

function render(report: DoctorReport): string {
  const lines: string[] = [];
  if (report.fixed.length > 0) {
    lines.push(`devx doctor: fixed ${report.fixed.filter((f) => f.ok).length}`);
    for (const f of report.fixed) {
      const tag = f.ok ? "[fixed] " : "[FAIL]  ";
      lines.push(
        `  ${tag}${f.class}: ${f.target} - ${f.action}${f.error ? ` (${f.error})` : ""}`,
      );
    }
  }
  const remaining = report.findings;
  if (remaining.length === 0) {
    lines.push("devx doctor: no findings - repo state is reconciled");
    return `${lines.join("\n")}\n`;
  }
  const fixable = remaining.filter((f) => f.fixable).length;
  lines.push(
    `devx doctor: ${remaining.length} finding(s)` +
      (fixable > 0 ? ` - ${fixable} fixable with \`--fix\`` : " - none mechanically fixable"),
  );
  for (const f of remaining) {
    lines.push(`  ${f.fixable ? "[fixable]" : "[report] "} ${f.class}: ${f.detail}`);
  }
  return `${lines.join("\n")}\n`;
}

export async function runDoctor(
  args: string[],
  opts: RunDoctorOpts = {},
): Promise<number> {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const err = opts.err ?? ((s) => process.stderr.write(s));

  let fix = false;
  let json = false;
  for (const a of args) {
    if (a === "--fix") fix = true;
    else if (a === "--json") json = true;
    else {
      err(`devx doctor: unknown flag '${a}'\nusage: devx doctor [--fix] [--json]\n`);
      return 64;
    }
  }

  const projectConfigPath = opts.projectPath ?? findProjectConfig();
  if (!projectConfigPath) {
    err("devx doctor: devx.config.yaml not found (walked up from cwd)\n");
    return 2;
  }
  const repoRoot = opts.repoRoot ?? dirname(projectConfigPath);
  try {
    loadMerged({ projectPath: projectConfigPath });
  } catch (e) {
    err(
      `devx doctor: config load failed: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    return 2;
  }

  const findings = await collectFindings(repoRoot, opts.detectOpts ?? {});
  const report: DoctorReport = { findings, fixed: [] };

  if (fix) {
    try {
      report.fixed = await applyFixes(findings, {
        repoRoot,
        exec: realExecAsync,
        ...(opts.fixOpts ?? {}),
      });
    } catch (e) {
      // Most likely a BacklogLockTimeoutError: a loop holds the backlog lock,
      // which is the exact situation somebody runs `doctor --fix` in. Letting
      // it escape put commander's raw error on stderr and exited 1 — the code
      // this file's header explicitly rejects, and it threw away the report we
      // had already computed. Report what we found, say why nothing was
      // repaired, and keep the advisory exit code.
      err(
        `devx doctor: --fix could not run (${e instanceof Error ? e.message : String(e)}) — findings below are unrepaired; retry once the lock holder finishes\n`,
      );
    }
    // Drop the ones actually repaired, so what remains reads as "still needs
    // a human" rather than replaying the whole scan back at the operator.
    const repaired = new Set(
      report.fixed.filter((f) => f.ok).map((f) => `${f.class} ${f.target}`),
    );
    report.findings = findings.filter((f) => !repaired.has(`${f.class} ${f.target}`));
  }

  out(json ? `${JSON.stringify(report)}\n` : render(report));
  return report.findings.length === 0 ? DOCTOR_EXIT_CLEAN : DOCTOR_EXIT_FINDINGS;
}

export function register(program: Command): void {
  const cmd = program
    .command("doctor")
    .description(
      "Detect - and with --fix mechanically repair - repo-state debris that otherwise needs human forensics: stale spec locks on closed items, backlog/frontmatter mirror drift, bookkeeping-only loop abandonments; plus report-only findings for dead owners, orphan worktrees and dead blockers. Advisory, never a merge gate: exit 0 clean / 3 findings remain / 2 doctor could not run.",
    )
    .option("--fix", "apply the mechanical class (report-only findings are never mutated)")
    .option("--json", "emit {findings, fixed} as JSON instead of the human report")
    .action(async (options: { fix?: boolean; json?: boolean }) => {
      const argv: string[] = [];
      if (options.fix) argv.push("--fix");
      if (options.json) argv.push("--json");
      const code = await runDoctor(argv, {});
      if (code !== 0) process.exit(code);
    });
  attachPhase(cmd, 2);
}

// Re-exported for the callers that predate the lib move (the loop driver
// imports from `src/lib/doctor/collect.js` directly; this keeps the command's
// own surface self-describing).
export { collectFindings };
