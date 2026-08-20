// Loop preflight main-health check (lpf101).
//
// A red integration branch taxes every worker with re-deriving "that failure
// is baseline" — and worse, it converts the whole night into unmergeable
// output: every feature branch inherits main's red check, the tail correctly
// hands every item off, and the loop burns the entire backlog into open PRs
// with zero merges (the 2026-07-27 palateful overnight run: 8 attempted,
// 0 merged, 5 handed off, all red on the same inherited check). Probe once
// at loop entry; refuse by default, or thread the red baseline into every
// iteration prompt + the morning report when the operator forces the start.
//
// Probe shape (implementer's choice per the spec, justified here and in the
// status log): `gh run list --branch <base> --limit 15`, folded to the
// NEWEST run per workflow. NOT `--limit 1` — the arci1 incident showed that
// consulting only the newest run lets an unrelated green workflow shadow a
// red sibling (two workflows on one repo, lint green after test red). A
// workflow's own newer green DOES forgive its older red.
//
// Uncertainty never blocks the night: probe failure, empty run list, or
// everything-in-flight all yield "unknown" and the loop proceeds, recording
// the state in the morning report (same posture as the failure ladder).
//
// Spec: dev/dev-lpf101-2026-07-26T15:57-loop-preflight-main-health.md

import { existsSync, readdirSync } from "node:fs";

import {
  GhProbeError,
  hasWorkflowFiles,
  parseGhRunList,
} from "../devx/await-remote-ci.js";
import { type ExecLike } from "./git-tx.js";

type GhRun = ReturnType<typeof parseGhRunList>[number];

export type MainHealthState = "green" | "red" | "unknown" | "no-workflow";

export interface FailingRun {
  workflowName: string;
  conclusion: string;
  headSha: string;
  url: string;
  databaseId: number;
}

export interface MainHealth {
  state: MainHealthState;
  branch: string;
  /** Present iff state === "red": the run that proves it. */
  failing?: FailingRun;
  /** Present on "unknown" / "no-workflow": why nothing decisive was found. */
  detail?: string;
}

/** Conclusions that prove the branch is red. `cancelled` / `skipped` /
 *  `neutral` / `stale` prove nothing about the code and are ignored. */
const RED_CONCLUSIONS = new Set([
  "failure",
  "timed_out",
  "startup_failure",
  "action_required",
]);

/** The branch the loop's claims/PRs target — the one whose health matters:
 *  `git.integration_branch ?? git.default_branch ?? "main"` (same resolution
 *  the skill body documents for Phase 5's diff base). */
export function baseBranchFrom(merged: unknown): string {
  if (merged && typeof merged === "object" && !Array.isArray(merged)) {
    const git = (merged as Record<string, unknown>).git;
    if (git && typeof git === "object" && !Array.isArray(git)) {
      const g = git as Record<string, unknown>;
      if (typeof g.integration_branch === "string" && g.integration_branch.trim() !== "") {
        return g.integration_branch.trim();
      }
      if (typeof g.default_branch === "string" && g.default_branch.trim() !== "") {
        return g.default_branch.trim();
      }
    }
  }
  return "main";
}

export interface ProbeMainHealthDeps {
  exec: ExecLike;
  repoRoot: string;
  /** fs seams (tests). Default to the real fs. */
  exists?: (path: string) => boolean;
  readdir?: (path: string) => string[];
}

export async function probeMainHealth(
  deps: ProbeMainHealthDeps,
  branch: string,
): Promise<MainHealth> {
  const fs = {
    exists: deps.exists ?? ((p: string) => existsSync(p)),
    readdir: deps.readdir ?? ((p: string) => readdirSync(p)),
  };
  if (!hasWorkflowFiles(fs, deps.repoRoot)) {
    return {
      state: "no-workflow",
      branch,
      detail: "no remote CI workflows configured — local gates are authoritative",
    };
  }
  const r = await deps.exec(
    "gh",
    [
      "run",
      "list",
      "--branch",
      branch,
      "--limit",
      "15",
      "--json",
      "databaseId,status,conclusion,url,headSha,workflowName",
    ],
    { cwd: deps.repoRoot },
  );
  if (r.exitCode !== 0) {
    return {
      state: "unknown",
      branch,
      detail: `gh run list exited ${r.exitCode}: ${firstLine(r.stderr) || "(no stderr)"}`,
    };
  }
  let runs: GhRun[];
  try {
    runs = parseGhRunList(r.stdout);
  } catch (e) {
    return {
      state: "unknown",
      branch,
      detail: e instanceof GhProbeError ? e.message : String(e),
    };
  }
  if (runs.length === 0) {
    return { state: "unknown", branch, detail: `no workflow runs found for '${branch}'` };
  }
  // Newest run per workflow (gh lists newest-first): a workflow's own newer
  // green forgives its older red, but a red sibling workflow is never
  // shadowed by an unrelated green one (the arci1 blind spot).
  const newestPerWorkflow = new Map<string, GhRun>();
  for (const run of runs) {
    if (!newestPerWorkflow.has(run.workflowName)) {
      newestPerWorkflow.set(run.workflowName, run);
    }
  }
  let sawGreen = false;
  for (const run of newestPerWorkflow.values()) {
    if (run.status !== "completed") continue; // in flight — proves nothing yet
    if (run.conclusion !== null && RED_CONCLUSIONS.has(run.conclusion)) {
      return {
        state: "red",
        branch,
        failing: {
          workflowName: run.workflowName,
          conclusion: run.conclusion,
          headSha: run.headSha,
          url: run.url,
          databaseId: run.databaseId,
        },
      };
    }
    if (run.conclusion === "success") sawGreen = true;
  }
  if (sawGreen) return { state: "green", branch };
  return {
    state: "unknown",
    branch,
    detail: `no decisive completed run among the newest runs per workflow on '${branch}'`,
  };
}

/** The forced-start baseline sentence — threaded verbatim into every
 *  iteration prompt and the morning report so no worker re-derives the
 *  pre-existing failure. Null unless the health is red. */
export function baselineLine(h: MainHealth): string | null {
  if (h.state !== "red" || h.failing === undefined) return null;
  const f = h.failing;
  return (
    `main ('${h.branch}') is red at ${f.headSha.slice(0, 7)}: ` +
    `${f.workflowName} concluded '${f.conclusion}' (${f.url}) — treat this ` +
    `failure as baseline; do not re-derive it, and do not try to fix it ` +
    `unless your spec is about it.`
  );
}

/** One-line human rendering shared by the dry-run plan and the driver. */
export function describeMainHealth(h: MainHealth): string {
  switch (h.state) {
    case "red": {
      const f = h.failing;
      return f !== undefined
        ? `RED — ${f.workflowName} concluded '${f.conclusion}' at ${f.headSha.slice(0, 7)} (${f.url})`
        : "RED";
    }
    case "green":
      return "green";
    case "no-workflow":
      return `n/a (${h.detail ?? "no workflows"})`;
    case "unknown":
      return `unknown (${h.detail ?? "no decisive signal"})`;
  }
}

function firstLine(s: string): string {
  return s.split("\n").find((l) => l.trim() !== "")?.trim() ?? s.trim();
}
