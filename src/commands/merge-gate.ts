// `devx merge-gate <hash>` — CLI passthrough for the pure mergeGateFor() decision (mrg102).
//
// Surface:
//   devx merge-gate <hash>          → resolve spec → collect signals → emit JSON
//                                     → exit 0 (merge:true) / 1 (merge:false) / 2 (signal trouble)
//   devx merge-gate <hash> --coverage <pct>
//                                   → inject the touched-line coverage value the
//                                     /devx Phase 5 step measured (so PROD can
//                                     gate without us re-running the runner here;
//                                     dvx104 wires the integration end-to-end).
//
// Three exit codes — they're consumed by /devx Phase 8 in shell-style:
//
//     if devx merge-gate "$HASH"; then gh pr merge "$PR" --squash --delete-branch; fi
//
//   • 0  → mergeGateFor returned merge:true. Caller proceeds with the merge.
//   • 1  → merge:false. Caller logs reason, leaves PR open, optionally files
//          INTERVIEW per `advice`. Mode logic is the gate's call, not the
//          skill's — that's the whole point of the externalization.
//   • 2  → signal collection itself failed (no PR, no spec, malformed gh
//          output). Caller does NOT auto-merge — uncertainty defaults to safe
//          per the third locked decision in epic-merge-gate-modes.
//
// Lockdown signal: `lockdownActive` is the runtime flag distinct from the
// configured mode. /devx-manage owns the flag-flip mechanism (Phase 2). Until
// that lands, we always pass `false` and let the configured mode (LOCKDOWN)
// drive the gate. When /devx-manage ships, this command starts reading
// .devx-cache/lockdown.flag (or whatever path /devx-manage settles on) without
// any caller-visible change.
//
// Coverage signal: see the comment block below `coverageOverride` in
// runMergeGate. Short version: minimum-viable in mrg102 — explicit injection
// only — because YOLO never reads the value and the production wiring lives
// downstream in dvx104. Filed as a known gap in the spec body so it's not
// rediscovered.
//
// Spec: dev/dev-mrg102-2026-04-28T19:30-merge-gate-cli.md
// Epic: _bmad-output/planning-artifacts/epic-merge-gate-modes.md

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Command } from "commander";

import { findProjectConfig, loadMerged } from "../lib/config-io.js";
import { attachPhase } from "../lib/help.js";
import {
  type GateDecision,
  type GateSignals,
  mergeGateFor,
} from "../lib/merge-gate.js";

const SPEC_DIR = "dev";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RunMergeGateOpts {
  /** Test seam: route stdout off process.stdout. */
  out?: (s: string) => void;
  /** Test seam: route stderr off process.stderr. */
  err?: (s: string) => void;
  /** Test seam: explicit project config path (skip findProjectConfig walk). */
  projectPath?: string;
  /** Test seam: shell-out replacement for `gh ...`. */
  exec?: (cmd: string, args: string[]) => ExecResult;
  /**
   * Caller-supplied touched-line coverage (0..1). Used by tests today; will
   * also be how /devx Phase 5 injects what its coverage runner measured once
   * dvx104 lands the wiring. When undefined AND `coverage.enabled` is true,
   * we leave the signal as null — under PROD the gate will block with
   * "PROD: coverage data missing" which is the safe default.
   */
  coverageOverride?: number | null;
}

interface ParsedFrontmatter {
  status?: string;
  branch?: string;
  pr?: number;
}

interface ConfigShape {
  mode?: string;
  promotion?: { autonomy?: { count?: number; initial_n?: number } };
  coverage?: { enabled?: boolean };
}

interface GhStatusCheck {
  status?: string;
  conclusion?: string | null;
  name?: string;
}

interface GhReview {
  state?: string;
  author?: { login?: string } | null;
  submittedAt?: string;
}

/**
 * Pull the three frontmatter scalars merge-gate cares about (status, branch, pr).
 * A real YAML parse would import eemeli/yaml just to read three known scalars
 * out of the prefix block — overkill for this surface, so we hand-roll the
 * minimal regex. The spec frontmatter shape is authored by /devx-plan and
 * /devx, so we control both sides of the contract.
 */
function readFrontmatter(specPath: string): ParsedFrontmatter {
  const text = readFileSync(specPath, "utf8");
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!m) return {};
  const result: ParsedFrontmatter = {};
  for (const line of m[1].split("\n")) {
    const kv = /^([a-z_][a-z0-9_]*):\s*(.*)$/i.exec(line);
    if (!kv) continue;
    const key = kv[1];
    let val = kv[2].trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
    if (key === "pr" && /^\d+$/.test(val)) {
      result.pr = Number.parseInt(val, 10);
    } else if (key === "status" || key === "branch") {
      result[key] = val;
    }
  }
  return result;
}

function findSpecForHash(projectDir: string, hash: string): string | null {
  const dir = join(projectDir, SPEC_DIR);
  if (!existsSync(dir)) return null;
  for (const name of readdirSync(dir)) {
    if (name.startsWith(`dev-${hash}-`) && name.endsWith(".md")) {
      return join(dir, name);
    }
  }
  return null;
}

function defaultExec(cmd: string, args: string[]): ExecResult {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  // spawnSync returns {error, status:null} when the spawn itself failed
  // (ENOENT, EACCES, …). Coercing `r.status ?? 0` would mask that as a
  // success and downstream JSON parse would silently produce empty results
  // — collapsing into a misleading "no PR yet" instead of the real "gh isn't
  // installed" failure. Surface it as a non-zero exit + the spawn error
  // message in stderr so safeFailureExit can tell the operator what to fix.
  if (r.error || r.status === null) {
    const detail = r.error ? r.error.message : "spawn returned null status";
    return { stdout: r.stdout ?? "", stderr: detail, exitCode: 127 };
  }
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", exitCode: r.status };
}

/**
 * Distill `gh pr view --json statusCheckRollup` into the single canonical
 * conclusion shape the gate consumes. Locked decision (party-mode 2026-04-28):
 * non-success conclusions other than `cancelled` (notably `pending`,
 * `action_required`) treat as "failure" for the gate's purposes; the raw
 * conclusion stays in the reason string for audit.
 *
 *   - empty array          → null     (no checks configured for this PR)
 *   - any not-COMPLETED    → "pending"
 *   - any FAILURE          → "failure"
 *   - any CANCELLED        → "cancelled"
 *   - any ACTION_REQUIRED  → "action_required"
 *   - all SUCCESS/SKIPPED/NEUTRAL → "success"
 *
 * Iteration order matters: NOT-COMPLETED runs first because a still-running
 * check should always be reported as "pending" even if a sibling already
 * failed (we don't want the audit log to say "failure" before the rest of CI
 * has had a chance to weigh in).
 */
export function aggregateChecks(checks: GhStatusCheck[]): string | null {
  if (checks.length === 0) return null;
  for (const c of checks) {
    const status = (c.status ?? "").toUpperCase();
    if (status && status !== "COMPLETED") return "pending";
  }
  for (const c of checks) {
    const concl = (c.conclusion ?? "").toUpperCase();
    if (concl === "FAILURE") return "failure";
    if (concl === "CANCELLED") return "cancelled";
    if (concl === "ACTION_REQUIRED") return "action_required";
  }
  return "success";
}

/**
 * Count distinct reviewers whose latest review state is CHANGES_REQUESTED. A
 * subsequent APPROVED dismisses prior CHANGES_REQUESTED — same dismissal
 * semantics GitHub uses for branch-protection mergeability checks. COMMENTED
 * / PENDING / DISMISSED reviews don't change blocking state and are skipped.
 *
 * `gh pr view --json reviews` returns chronological order. We overwrite as we
 * iterate so the final map holds each reviewer's most recent terminal state.
 */
export function blockingReviewCount(reviews: GhReview[]): number {
  const latestByLogin = new Map<string, string>();
  for (const r of reviews) {
    const login = r.author?.login ?? "";
    const state = (r.state ?? "").toUpperCase();
    if (state === "COMMENTED" || state === "PENDING" || state === "DISMISSED") continue;
    if (login) latestByLogin.set(login, state);
  }
  let n = 0;
  for (const state of latestByLogin.values()) {
    if (state === "CHANGES_REQUESTED") n++;
  }
  return n;
}

function emitDecision(
  decision: GateDecision,
  exitCode: number,
  out: (s: string) => void,
): number {
  out(`${JSON.stringify(decision)}\n`);
  return exitCode;
}

function safeFailureExit(
  reason: string,
  out: (s: string) => void,
  err: (s: string) => void,
  detail?: string,
): number {
  // Locked decision: gh signal-collection failure → safe-default
  // {merge:false, reason:"gh signal collection failed"}. Never auto-merge on
  // uncertain signals. Detail goes to stderr for the operator; the JSON on
  // stdout is what /devx parses.
  if (detail) err(`devx merge-gate: ${detail}\n`);
  return emitDecision({ merge: false, reason }, 2, out);
}

export function runMergeGate(
  args: string[],
  flags: { coverage?: number | null },
  opts: RunMergeGateOpts = {},
): number {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const err = opts.err ?? ((s) => process.stderr.write(s));
  const exec = opts.exec ?? defaultExec;

  if (args.length !== 1) {
    err("usage: devx merge-gate <hash> [--coverage <pct>]\n");
    return 64;
  }
  const hash = args[0];
  // Spec convention from CLAUDE.md: 6 hex/alnum chars. Range 3..12 covers
  // every existing hash (aud101, mrg102, a10001, …) plus a little headroom
  // without permitting 2-char garbage or the unbounded path-traversal shape.
  if (!/^[a-z0-9]{3,12}$/i.test(hash)) {
    err(`devx merge-gate: invalid hash '${hash}' (expected hex/alnum 3-12 chars)\n`);
    return 64;
  }

  const projectConfigPath = opts.projectPath ?? findProjectConfig();
  if (!projectConfigPath) {
    err("devx merge-gate: devx.config.yaml not found (walked up from cwd)\n");
    return 64;
  }
  const projectDir = dirname(projectConfigPath);

  const specPath = findSpecForHash(projectDir, hash);
  if (!specPath) {
    return emitDecision(
      { merge: false, reason: `no spec file for hash '${hash}' under ${SPEC_DIR}/` },
      1,
      out,
    );
  }

  const fm = readFrontmatter(specPath);

  // Resolve PR number. Two sources, in priority order:
  //   1. explicit `pr: <n>` in frontmatter (set by /devx Phase 7 once added)
  //   2. `gh pr list --head <branch>` lookup using the spec's branch field
  // The branch field is authored by /devx-plan and stable across the lifetime
  // of the spec, so the gh lookup is robust to spec-frontmatter drift.
  const branch =
    typeof fm.branch === "string" && fm.branch.length > 0
      ? fm.branch
      : `feat/dev-${hash}`;

  let prNumber: number | undefined = fm.pr;
  if (prNumber === undefined) {
    const r = exec("gh", [
      "pr",
      "list",
      "--head",
      branch,
      "--state",
      "all",
      "--json",
      "number,state",
      "--limit",
      "1",
    ]);
    if (r.exitCode !== 0) {
      return safeFailureExit(
        "gh signal collection failed",
        out,
        err,
        `gh pr list --head ${branch} failed (exit ${r.exitCode}): ${r.stderr.trim()}`,
      );
    }
    let parsed: { number: number; state: string }[] | null = null;
    try {
      const j = JSON.parse(r.stdout || "[]");
      if (Array.isArray(j)) parsed = j;
    } catch {
      parsed = null;
    }
    if (parsed === null) {
      return safeFailureExit(
        "gh signal collection failed",
        out,
        err,
        `gh pr list returned malformed JSON: ${r.stdout.slice(0, 120)}`,
      );
    }
    if (parsed.length === 0) {
      return emitDecision({ merge: false, reason: "no PR yet" }, 2, out);
    }
    prNumber = parsed[0].number;
  }

  // Load + type-narrow config. Treating the merged blob as ConfigShape after
  // a runtime object-shape check lets us pull the three knobs we need without
  // hauling in the full schema.
  let merged: ConfigShape;
  try {
    const raw = loadMerged({ projectPath: projectConfigPath });
    merged = (raw && typeof raw === "object" ? raw : {}) as ConfigShape;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    err(`devx merge-gate: config load failed: ${msg}\n`);
    return 64;
  }
  const mode = String(merged.mode ?? "");
  const trustCount = Number(merged.promotion?.autonomy?.count ?? 0);
  const trustInitialN = Number(merged.promotion?.autonomy?.initial_n ?? 0);
  const coverageEnabled = merged.coverage?.enabled === true;

  // Live PR signals: status checks + reviews. One gh call (--json bundles both).
  const v = exec("gh", [
    "pr",
    "view",
    String(prNumber),
    "--json",
    "statusCheckRollup,reviews",
  ]);
  if (v.exitCode !== 0) {
    return safeFailureExit(
      "gh signal collection failed",
      out,
      err,
      `gh pr view ${prNumber} failed (exit ${v.exitCode}): ${v.stderr.trim()}`,
    );
  }
  let live: { statusCheckRollup?: GhStatusCheck[]; reviews?: GhReview[] };
  try {
    const j = JSON.parse(v.stdout || "{}");
    if (!j || typeof j !== "object") throw new Error("non-object payload");
    live = j as { statusCheckRollup?: GhStatusCheck[]; reviews?: GhReview[] };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return safeFailureExit(
      "gh signal collection failed",
      out,
      err,
      `gh pr view returned malformed JSON: ${msg}`,
    );
  }

  const checks = Array.isArray(live.statusCheckRollup) ? live.statusCheckRollup : [];
  const reviews = Array.isArray(live.reviews) ? live.reviews : [];
  const ciConclusion = aggregateChecks(checks);
  const blockingReviewComments = blockingReviewCount(reviews);

  // Coverage signal — config-gated. mrg102 ships injection-only because the
  // production source-of-truth (touched-line coverage from Phase 5's runner
  // output) is dvx104's responsibility. Under YOLO this never matters; under
  // PROD a missing value is the safe-default block path.
  let coveragePctTouched: number | null = null;
  if (coverageEnabled) {
    if (flags.coverage !== undefined && flags.coverage !== null) {
      coveragePctTouched = flags.coverage;
    } else if (opts.coverageOverride !== undefined) {
      coveragePctTouched = opts.coverageOverride;
    }
  }

  // Runtime lockdown flag — distinct from `mode === "LOCKDOWN"`. Owned by
  // /devx-manage (Phase 2); always false here until that lands.
  const lockdownActive = false;

  const signals: GateSignals = {
    ciConclusion,
    lockdownActive,
    blockingReviewComments,
    coveragePctTouched,
    count: trustCount,
    initialN: trustInitialN,
  };

  const decision = mergeGateFor(mode, signals);
  return emitDecision(decision, decision.merge ? 0 : 1, out);
}

function parseCoverageFlag(raw: string | undefined): number | null | undefined {
  if (raw === undefined) return undefined;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw new Error(
      `devx merge-gate: --coverage expects a number in [0, 1], got '${raw}'`,
    );
  }
  return n;
}

export function register(program: Command): void {
  const sub = program
    .command("merge-gate")
    .description(
      "Compute the mode-derived merge decision for a spec PR (Phase 1). Emits JSON; exit 0 = merge, 1 = no-merge, 2 = signal trouble.",
    )
    .argument("<hash>", "spec hash (e.g. 'mrg102')")
    .option(
      "--coverage <pct>",
      "touched-line coverage in [0, 1] from Phase 5's coverage runner",
    )
    .action((hash: string, opts: { coverage?: string }) => {
      const coverage = parseCoverageFlag(opts.coverage);
      const code = runMergeGate([hash], { coverage }, {});
      if (code !== 0) {
        process.exit(code);
      }
    });
  attachPhase(sub, 1);
}
