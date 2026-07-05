// The morning report (v2l101) — gnhf's exit-summary card, devx-flavored and
// markdown-shaped (v2/04-overnight-loop.md §5).
//
// Reconstruct-don't-recall: everything in this report is computed from the
// run's recorded facts (events, git snapshots, gh probe results), never from
// a model's memory of the night. The report presents CLAIMS, not verdicts —
// merge-gate + CI were the actual gate (D-11), and the morning-review
// discipline in the skill body tells the human to verify via `gh pr view`.
//
// Written at loop exit ALWAYS — normal stop, budget stop, abort, SIGTERM,
// SIGINT (driver installs handlers that funnel through the same finalizer).
// Two copies: `.devx-cache/loop/<run-id>/report.md` (the run dir) and
// `.devx-cache/reports/<run-id>.md` (where the dispatcher's overnight-report
// probe already looks — src/lib/next/gather.ts findOvernightReport).
//
// Spec: dev/dev-v2l101-2026-07-05T13:06-overnight-loop.md
// Design: v2/04-overnight-loop.md §5

import { writeAtomic } from "../supervisor-internal.js";
import { type DiffStat } from "./git-tx.js";
import { reportPath, reportsCopyPath } from "./state.js";

// ---------------------------------------------------------------------------
// Summary types (the driver builds one of these as it runs)
// ---------------------------------------------------------------------------

export type ItemOutcome =
  | "merged"
  | "handed-off" // PR opened / pushed, but not merged (CI red, gate said no, hold, …)
  | "abandoned" // failure ladder or per-item budget — claim released, spec [-] blocked
  | "blocked-on-human" // filed INTERVIEW/MANUAL mid-run
  | "in-progress-at-exit" // the loop stopped (budget/signal) mid-item
  | "claim-failed"; // couldn't claim (lock held / row raced away)

export interface TokenTotals {
  input: number;
  output: number;
  /** True when any contributing number was estimated rather than reported —
   *  rendered with a `~` prefix (v2/04 §5). */
  estimated: boolean;
}

export interface ItemResult {
  hash: string;
  type: string;
  title: string;
  specPath: string;
  outcome: ItemOutcome;
  iterationsGood: number;
  iterationsFailed: number;
  tokens: TokenTotals;
  /** PR URL when one was opened. */
  prUrl?: string;
  /** Review-tour link when the tail produced one. */
  tourUrl?: string;
  /** Preserved worktree path (always recorded for abandoned items). */
  worktreePath?: string;
  /** Last failure summary (abandoned / handed-off-red items). */
  lastFailure?: string;
  /** Branch diff stats vs the claim-time base. */
  diff?: DiffStat;
  /** Free-form detail (e.g. merge-gate reason, push-failure detail). */
  detail?: string;
}

export interface RunSummary {
  runId: string;
  mode: string;
  startedAt: string;
  endedAt: string;
  /** Non-null when the loop aborted (permanent error, 3 abandoned items,
   *  signal) rather than stopping on budgets/backlog-empty. */
  abortReason: string | null;
  /** Why the outer loop stopped when it wasn't an abort ("max items reached",
   *  "--until deadline", "backlog empty", …). */
  stopReason: string | null;
  budgets: {
    maxItems: number;
    maxTotalTokens: number;
    maxIterationsPerItem: number;
    maxTokensPerItem: number;
    until: string | null;
  };
  items: ItemResult[];
  totals: TokenTotals;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function fmtTokens(t: TokenTotals): string {
  const p = t.estimated ? "~" : "";
  return `${p}${t.input.toLocaleString("en-US")} in / ${p}${t.output.toLocaleString("en-US")} out`;
}

function fmtDuration(startIso: string, endIso: string): string {
  const ms = Math.max(0, Date.parse(endIso) - Date.parse(startIso));
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function fmtDiff(d: DiffStat | undefined): string {
  if (!d) return "";
  return `${d.filesChanged} files, +${d.linesAdded}/-${d.linesDeleted}`;
}

const OUTCOME_LABEL: Record<ItemOutcome, string> = {
  merged: "merged",
  "handed-off": "handed off (PR open, NOT merged)",
  abandoned: "abandoned",
  "blocked-on-human": "blocked on human",
  "in-progress-at-exit": "in progress at loop exit",
  "claim-failed": "claim failed (skipped)",
};

function itemSection(item: ItemResult): string {
  const lines: string[] = [];
  lines.push(`### \`${item.hash}\` — ${item.title || item.specPath} → **${OUTCOME_LABEL[item.outcome]}**`);
  lines.push("");
  lines.push(`- Spec: \`${item.specPath}\``);
  lines.push(
    `- Iterations: ${item.iterationsGood} good / ${item.iterationsFailed} failed · tokens ${fmtTokens(item.tokens)}`,
  );
  if (item.prUrl) lines.push(`- PR: ${item.prUrl}`);
  if (item.tourUrl) lines.push(`- Tour: ${item.tourUrl}`);
  if (item.diff) lines.push(`- Diff: ${fmtDiff(item.diff)}`);
  if (item.worktreePath) lines.push(`- Preserved worktree: \`${item.worktreePath}\``);
  if (item.lastFailure) lines.push(`- Last failure: ${item.lastFailure}`);
  if (item.detail) lines.push(`- Detail: ${item.detail}`);
  return lines.join("\n");
}

function nextSteps(summary: RunSummary): string[] {
  const out: string[] = [];
  out.push("- `devx next` — the dispatcher's morning review (row 1 reads this report).");
  for (const item of summary.items) {
    switch (item.outcome) {
      case "merged":
        if (item.prUrl) {
          out.push(
            `- \`gh pr view ${item.prUrl}\` — verify the merge claim for \`${item.hash}\` (claims, not verdicts).`,
          );
        }
        break;
      case "handed-off":
        // `gh pr view` takes a positional number/url/branch (no --head flag
        // — that's `pr list`); fall back to the list form when no PR URL
        // was captured (BH-LOW-8 / EC-LOW-9).
        out.push(
          item.prUrl !== undefined
            ? `- \`gh pr view ${item.prUrl}\` — \`${item.hash}\` needs a human decision (CI/gate did not clear it).`
            : `- \`gh pr list --head feat/${item.type}-${item.hash}\` — \`${item.hash}\` needs a human decision (no PR URL was captured).`,
        );
        break;
      case "abandoned":
        if (item.worktreePath) {
          out.push(
            `- \`git -C ${item.worktreePath} log --oneline\` — review \`${item.hash}\`'s preserved work; spec is \`[-]\` blocked, unblock via DEV.md + \`status: ready\` when addressed.`,
          );
        }
        break;
      case "in-progress-at-exit":
        out.push(
          `- \`${item.hash}\` was mid-flight when the loop stopped — worktree preserved${
            item.worktreePath ? ` at \`${item.worktreePath}\`` : ""
          }; its spec lock is still held by this run's session (verify before re-claiming).`,
        );
        break;
      default:
        break;
    }
  }
  return out;
}

export function renderMorningReport(summary: RunSummary): string {
  const counts: Record<ItemOutcome, number> = {
    merged: 0,
    "handed-off": 0,
    abandoned: 0,
    "blocked-on-human": 0,
    "in-progress-at-exit": 0,
    "claim-failed": 0,
  };
  for (const item of summary.items) counts[item.outcome]++;

  const lines: string[] = [];
  lines.push(`# devx loop — morning report (\`${summary.runId}\`)`);
  lines.push("");
  lines.push(
    `Ran ${fmtDuration(summary.startedAt, summary.endedAt)} (${summary.startedAt} → ${summary.endedAt}) in mode ${summary.mode}.`,
  );
  lines.push("");
  if (summary.abortReason !== null) {
    lines.push(`**ABORTED: ${summary.abortReason}**`);
    lines.push("");
  } else if (summary.stopReason !== null) {
    lines.push(`Stopped: ${summary.stopReason}.`);
    lines.push("");
  }
  lines.push(
    `**Items:** ${summary.items.length} attempted · ${counts.merged} merged · ${counts["handed-off"]} handed off · ${counts.abandoned} abandoned · ${counts["blocked-on-human"]} blocked on human${
      counts["in-progress-at-exit"] > 0 ? ` · ${counts["in-progress-at-exit"]} in progress at exit` : ""
    }`,
  );
  lines.push(`**Tokens:** ${fmtTokens(summary.totals)}`);
  lines.push(
    `**Budgets:** max ${summary.budgets.maxItems} items · ${summary.budgets.maxIterationsPerItem} iterations/item · ${summary.budgets.maxTokensPerItem.toLocaleString("en-US")} tokens/item · ${summary.budgets.maxTotalTokens.toLocaleString("en-US")} total${
      summary.budgets.until !== null ? ` · until ${summary.budgets.until}` : ""
    }`,
  );
  lines.push("");
  lines.push(
    "> These are the run's **claims** — reconstruct from disk (`git status`, `git log --oneline`, open PRs) before trusting them.",
  );
  lines.push("");

  if (summary.items.length === 0) {
    lines.push("## Items");
    lines.push("");
    lines.push("_No items were attempted._");
  } else {
    lines.push("## Items");
    lines.push("");
    lines.push(summary.items.map(itemSection).join("\n\n"));
  }
  lines.push("");
  lines.push("## Next steps");
  lines.push("");
  lines.push(nextSteps(summary).join("\n"));
  lines.push("");
  return lines.join("\n");
}

/**
 * Write the report to BOTH locations (run dir + the dispatcher's reports
 * dir), atomically each. Returns the run-dir path, or null when even that
 * write failed (the caller logs; a report failure must not mask the run's
 * exit path).
 */
export function writeMorningReport(
  cacheDir: string,
  summary: RunSummary,
): string | null {
  const body = renderMorningReport(summary);
  const primary = reportPath(cacheDir, summary.runId);
  let ok = false;
  try {
    writeAtomic(primary, body);
    ok = true;
  } catch {
    // fall through — still try the copy
  }
  try {
    writeAtomic(reportsCopyPath(cacheDir, summary.runId), body);
    ok = true;
  } catch {
    // best-effort
  }
  return ok ? primary : null;
}
