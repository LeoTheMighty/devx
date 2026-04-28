// promoteIntegrationToDefault — develop→main promotion wrapper for the future
// /devx-manage scheduler (mrg103).
//
// **DEAD CODE in self-host (single-branch).** This file is built, type-checked,
// and exercised by `test/promote-integration.test.ts` on every run, but no
// production code path calls it today. It exists to lock the contract so when
// a non-self-host devx user opts into the develop/main split
// (`git.integration_branch: "develop"`), `/devx-manage` can call this single
// function instead of re-implementing the gate at a second site. One gate, two
// consumption sites — the first locked decision in epic-merge-gate-modes.
//
// Why ship it now if no one calls it? The cost is one file + one test. The
// value is zero-rework when split-branch users arrive AND a regression suite
// that proves the contract holds across mode changes — without that, the gate
// logic could drift between `/devx` and `/devx-manage` and we'd only notice
// after the first split-branch user filed a bug. (See LEARN.md cross-epic
// pattern: skill body says X, code says Y.) Exercising it in CI keeps the
// drift tests green.
//
// Wiring contract for future split-branch consumers:
//   const decision = await promoteIntegrationToDefault(mode, signals);
//   // decision.promoted ↔ the gh api merges call returned 2xx (or would have)
//   // decision.reason   ↔ either the gate's reason (merge:false) or the
//   //                     gh-api error string (merge:true but the call failed)
//
// Spec: dev/dev-mrg103-2026-04-28T19:30-promote-integration.md
// Epic: _bmad-output/planning-artifacts/epic-merge-gate-modes.md

import { spawnSync } from "node:child_process";

import { type GateSignals, mergeGateFor } from "../merge-gate.js";

export interface PromoteResult {
  /** True iff `gh api repos/<o>/<r>/merges` returned a 2xx (gate said merge AND the API call succeeded). */
  promoted: boolean;
  /** Single canonical string describing the outcome — gate reason, API error,
   *  or success annotation. Mirrors mergeGateFor's reason discipline so callers
   *  can grep both surfaces uniformly. */
  reason: string;
}

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface PromoteOpts {
  /** Test seam: replacement for `gh ...` shell-out. */
  exec?: (cmd: string, args: string[]) => ExecResult;
  /** Test seam (and override hook for callers running outside a git
   *  workspace): explicit owner+repo for the merges API endpoint. When
   *  omitted, we resolve via `gh repo view --json nameWithOwner`. */
  ownerRepo?: { owner: string; repo: string };
  /** Branch pair to promote. Defaults to head=develop, base=main — the
   *  recommended devx split. Custom callers (e.g., a project that called
   *  the integration branch `staging`) can override. */
  branches?: { head: string; base: string };
}

function defaultExec(cmd: string, args: string[]): ExecResult {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  // Mirror the merge-gate.ts spawn-error handling so an ENOENT on `gh`
  // surfaces as a clean non-zero exit + readable stderr instead of silently
  // collapsing into "gh said it worked." (Without this guard, `r.status ??
  // 0` would coerce ENOENT → 0 and we'd return promoted:true on a missing
  // gh binary.)
  if (r.error || r.status === null) {
    const detail = r.error ? r.error.message : "spawn returned null status";
    return { stdout: r.stdout ?? "", stderr: detail, exitCode: 127 };
  }
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", exitCode: r.status };
}

function resolveOwnerRepo(
  exec: (cmd: string, args: string[]) => ExecResult,
): { owner: string; repo: string } | null {
  const r = exec("gh", ["repo", "view", "--json", "nameWithOwner"]);
  if (r.exitCode !== 0) return null;
  let parsed: { nameWithOwner?: string };
  try {
    parsed = JSON.parse(r.stdout || "{}");
  } catch {
    return null;
  }
  const nwo = parsed.nameWithOwner;
  if (typeof nwo !== "string" || !nwo.includes("/")) return null;
  const [owner, repo] = nwo.split("/", 2);
  if (!owner || !repo) return null;
  return { owner, repo };
}

export async function promoteIntegrationToDefault(
  mode: string,
  signals: GateSignals,
  opts: PromoteOpts = {},
): Promise<PromoteResult> {
  // Step 1: gate decision. The whole point of this function is that mode logic
  // lives in mergeGateFor() — we never inline mode rules here. If the gate
  // says no, we return the gate's reason verbatim so the audit log of the
  // calling /devx-manage scheduler reads identically to a /devx Phase 8
  // refusal at the same mode + signals.
  const decision = mergeGateFor(mode, signals);
  if (!decision.merge) {
    // Trust-gradient case: the gate uses `advice` instead of `reason`. Surface
    // the advice as the reason so callers don't have to special-case the
    // override path — they just see "trust-gradient block …" or whatever the
    // gate decided to write.
    const reason = decision.reason
      ?? decision.advice?.join("; ")
      ?? "gate blocked merge (no reason supplied)";
    return { promoted: false, reason };
  }

  // Step 2: gate said yes — execute the merge via gh api. We use `gh api`
  // (not `gh pr merge`) because there is no PR for develop→main; this is a
  // direct branch merge using GitHub's repos/{o}/{r}/merges endpoint, which
  // returns 201 on success or 4xx on conflict / forbidden.
  const exec = opts.exec ?? defaultExec;
  const branches = opts.branches ?? { head: "develop", base: "main" };
  const ownerRepo = opts.ownerRepo ?? resolveOwnerRepo(exec);
  if (!ownerRepo) {
    return {
      promoted: false,
      reason: "could not resolve owner/repo from `gh repo view`",
    };
  }

  const r = exec("gh", [
    "api",
    `repos/${ownerRepo.owner}/${ownerRepo.repo}/merges`,
    "-X",
    "POST",
    "-f",
    `base=${branches.base}`,
    "-f",
    `head=${branches.head}`,
  ]);
  if (r.exitCode !== 0) {
    // gh api prints the GitHub error JSON on stderr for non-2xx — keep it
    // verbatim in the reason so the operator can grep "merge_conflict" or
    // "forbidden" without reading separate logs.
    const detail = (r.stderr || r.stdout || "").trim().slice(0, 200);
    return {
      promoted: false,
      reason: `gh api repos/${ownerRepo.owner}/${ownerRepo.repo}/merges failed (exit ${r.exitCode}): ${detail}`,
    };
  }

  return {
    promoted: true,
    reason: `merged ${branches.head} → ${branches.base} via gh api`,
  };
}
