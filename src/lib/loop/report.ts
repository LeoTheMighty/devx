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
  | "split" // budget exhausted WITH real progress — WIP branch pushed, follow-up spec filed (branch-handoff, mss103); parent superseded
  | "abandoned" // failure ladder or per-item budget — claim released; left blocked (work preserved) or ready (nothing preserved)
  | "released" // environment failure (infra-errors) — claim rolled back to ready; item not at fault (dc7514)
  | "blocked-on-human" // filed INTERVIEW/MANUAL mid-run
  | "in-progress-at-exit" // the loop stopped (budget/signal) mid-item
  | "claim-failed" // couldn't claim (lock held / row raced away)
  | "claim-contended"; // push race lost after bounded rebase-retries (mlc104) — peer healthy, item skipped this run

export interface TokenTotals {
  /** Uncached input tokens (authoritative CLI usage, debug-494590). */
  input: number;
  output: number;
  /** Cache-creation input tokens — counted by the budget rails. */
  cacheCreation: number;
  /** Cache-read input tokens — rendered for visibility but excluded from
   *  the budget counter (see driver tokensTotal). */
  cacheRead: number;
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
  /** Iterations lost to environment failures (infra-errors) — never charged
   *  to the item (dc7514). */
  iterationsInfra?: number;
  /** Where the abandon/release/split left the backlog: `blocked` (real work
   *  preserved, human decides) or `ready` (nothing preserved — re-claimable;
   *  for `split`, the FOLLOW-UP row is the ready one — the parent row is
   *  struck superseded). */
  leftState?: "ready" | "blocked";
  /** Repo-relative follow-up spec path when this item split (outcome
   *  `split`, or a worker-requested merge-first split on a merged/handed-off
   *  item — mss103). */
  followUpSpecPath?: string;
  tokens: TokenTotals;
  /** PR URL when one was opened. */
  prUrl?: string;
  /** Preserved worktree path (always recorded for abandoned items). */
  worktreePath?: string;
  /** Last failure summary (abandoned / handed-off-red items). */
  lastFailure?: string;
  /** Branch diff stats vs the claim-time base. */
  diff?: DiffStat;
  /** Free-form detail (e.g. merge-gate reason, push-failure detail). */
  detail?: string;
  /** Loop-owned WARN lines (lock-release failure, main-push failure, …) —
   *  the report is where a swallowed cleanup failure gets its one honest
   *  surface (review findings LOW-10/LOW-11). */
  warnings?: string[];
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
  /** lpf101 preflight result at loop start. Absent on runs that predate the
   *  preflight or when `loop.preflight_main_health: off`. */
  mainHealth?: {
    state: "green" | "red" | "unknown" | "no-workflow";
    branch: string;
    /** Present iff state === "red". */
    failing?: { workflowName: string; conclusion: string; headSha: string; url: string };
    detail?: string;
    /** True when the run started despite a red main (--force / warn). */
    forced?: boolean;
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function fmtTokens(t: TokenTotals): string {
  const p = t.estimated ? "~" : "";
  const n = (v: number): string => v.toLocaleString("en-US");
  const cache =
    t.cacheCreation > 0 || t.cacheRead > 0
      ? ` (cache ${p}${n(t.cacheCreation)} write / ${p}${n(t.cacheRead)} read)`
      : "";
  return `${p}${n(t.input)} in / ${p}${n(t.output)} out${cache}`;
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

/** `dev/dev-abc123-2026-…-slug.md` → `abc123` (null when unparseable).
 *  The timestamp anchor is load-bearing: a looser `^[a-z]+-([a-z0-9]+)-`
 *  happily reads `not-a-spec-path` as the hash `a` and would print a
 *  confidently wrong `/devx a` into the morning report. */
function hashFromSpecPath(specPath: string): string | null {
  const base = specPath.slice(specPath.lastIndexOf("/") + 1);
  const m = /^[a-z]+-([a-z0-9]{3,12})-\d{4}-\d{2}-\d{2}T/.exec(base);
  return m ? m[1] : null;
}

const OUTCOME_LABEL: Record<ItemOutcome, string> = {
  merged: "merged",
  "handed-off": "handed off (PR open, NOT merged)",
  split: "split (budget exhausted with real progress — follow-up spec filed)",
  abandoned: "abandoned",
  released: "released (environment failure — item not at fault, left ready)",
  "blocked-on-human": "blocked on human",
  "in-progress-at-exit": "in progress at loop exit",
  "claim-failed": "claim failed (skipped)",
  "claim-contended": "claim contended (a peer won the push race — skipped this run)",
};

function itemSection(item: ItemResult): string {
  const lines: string[] = [];
  const label =
    item.outcome === "abandoned" && item.leftState === "ready"
      ? "abandoned (nothing preserved — left ready)"
      : item.outcome === "merged" && item.leftState === "blocked"
        ? // mss103: the PR merged at reduced scope but the follow-up split
          // failed, so the spec was left blocked. A bare "merged" here
          // would contradict the backlog row (review AA-7).
          "merged at reduced scope — split FAILED, spec left blocked"
        : item.outcome === "released" && item.leftState === undefined
        ? // Ownership-lost release: the backlog was deliberately left
          // untouched — the default label's "left ready" would misstate it.
          "released (environment failure — claim ownership lost; backlog left untouched)"
        : OUTCOME_LABEL[item.outcome];
  lines.push(`### \`${item.hash}\` — ${item.title || item.specPath} → **${label}**`);
  lines.push("");
  lines.push(`- Spec: \`${item.specPath}\``);
  const infraNote =
    item.iterationsInfra !== undefined && item.iterationsInfra > 0
      ? ` / ${item.iterationsInfra} infra (environment — not charged to the item)`
      : "";
  lines.push(
    `- Iterations: ${item.iterationsGood} good / ${item.iterationsFailed} failed${infraNote} · tokens ${fmtTokens(item.tokens)}`,
  );
  if (item.prUrl) lines.push(`- PR: ${item.prUrl}`);
  if (item.outcome === "merged") {
    // Honest-unavailable lines (review finding LOW-14): the overnight loop
    // does not generate review tours and does not parse test counts out of
    // the tail — say so explicitly rather than plumbing fields nothing
    // ever sets.
    lines.push(
      `- Tour: not generated (overnight loop) — run \`devx tour ${item.hash}\` if you want one`,
    );
    lines.push(`- Test delta: not tracked (v1 bound)`);
  }
  if (item.diff) lines.push(`- Diff: ${fmtDiff(item.diff)}`);
  if (item.followUpSpecPath !== undefined) {
    lines.push(`- Follow-up: \`${item.followUpSpecPath}\``);
  }
  if (item.worktreePath) lines.push(`- Preserved worktree: \`${item.worktreePath}\``);
  if (item.lastFailure) lines.push(`- Last failure: ${item.lastFailure}`);
  if (item.detail) lines.push(`- Detail: ${item.detail}`);
  for (const w of item.warnings ?? []) lines.push(`- WARN: ${w}`);
  return lines.join("\n");
}

function nextSteps(summary: RunSummary): string[] {
  const out: string[] = [];
  out.push("- `devx next` — the dispatcher's morning review (row 1 reads this report).");
  for (const item of summary.items) {
    switch (item.outcome) {
      case "merged":
        if (item.leftState === "blocked") {
          // mss103: merged at reduced scope, but the follow-up split
          // failed — the unmet ACs are in the spec's status log and
          // nowhere else, so this needs a human before anything else.
          out.push(
            `- \`${item.hash}\` merged at REDUCED SCOPE but its split failed — the spec is \`[-]\` blocked and its status log lists the acceptance criteria that never shipped; re-split (\`devx split ${item.hash}\`) or re-scope before unblocking.`,
          );
        } else if (item.prUrl) {
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
        if (item.leftState === "ready") {
          out.push(
            `- \`${item.hash}\` failed repeatedly but preserved no work — left \`[ ]\` ready (it will be re-attempted; fix the underlying failure first${item.lastFailure ? `: ${item.lastFailure}` : ""}).`,
          );
        } else if (item.worktreePath) {
          out.push(
            `- \`git -C ${item.worktreePath} log --oneline\` — review \`${item.hash}\`'s preserved work; spec is \`[-]\` blocked, unblock via DEV.md + \`status: ready\` when addressed.`,
          );
        }
        break;
      case "split": {
        const followHash =
          item.followUpSpecPath !== undefined ? hashFromSpecPath(item.followUpSpecPath) : null;
        out.push(
          `- \`${item.hash}\` — split → follow-up ready: \`/devx ${followHash ?? "<hash>"}\`${
            item.followUpSpecPath !== undefined ? ` (\`${item.followUpSpecPath}\`)` : ""
          } — the WIP branch is recorded on the follow-up spec; the parent is superseded.`,
        );
        break;
      }
      case "released":
        out.push(
          item.leftState === "ready"
            ? `- \`${item.hash}\` — environment failure (item not at fault, left ready): fix the environment (power/network/lid — see MANUAL.md) and rerun \`devx loop\`.`
            : `- \`${item.hash}\` — environment failure, but claim ownership changed mid-run and the backlog was left untouched: verify the current owner (\`.devx-cache/locks/spec-${item.hash}.lock\`) before touching it.`,
        );
        break;
      case "in-progress-at-exit":
        out.push(
          `- \`${item.hash}\` was mid-flight when the loop stopped — worktree preserved${
            item.worktreePath ? ` at \`${item.worktreePath}\`` : ""
          }; its spec lock is still held by this run's session (verify before re-claiming).`,
        );
        break;
      case "claim-contended":
        out.push(
          `- \`${item.hash}\` — claim contended (a peer won the push race; mlc104): no action needed, it re-enters the pick pool on the next run. Verify the peer actually claimed it (\`git log --oneline -5\` on main / \`.devx-cache/locks/spec-${item.hash}.lock\`) if it keeps recurring.`,
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
    split: 0,
    abandoned: 0,
    released: 0,
    "blocked-on-human": 0,
    "in-progress-at-exit": 0,
    "claim-failed": 0,
    "claim-contended": 0,
  };
  for (const item of summary.items) counts[item.outcome]++;

  const lines: string[] = [];
  lines.push(`# devx loop — morning report (\`${summary.runId}\`)`);
  lines.push("");
  lines.push(
    `Ran ${fmtDuration(summary.startedAt, summary.endedAt)} (${summary.startedAt} → ${summary.endedAt}) in mode ${summary.mode}.`,
  );
  lines.push("");
  const mh = summary.mainHealth;
  if (mh !== undefined && mh.state === "red" && mh.failing !== undefined) {
    lines.push(
      `**Baseline: '${mh.branch}' was RED at loop start** — ${mh.failing.workflowName} concluded '${mh.failing.conclusion}' at ${mh.failing.headSha.slice(0, 7)} (${mh.failing.url})${
        mh.forced === true ? " — forced start; every item's CI red matching this check is baseline, not the item's fault" : ""
      }.`,
    );
    lines.push("");
  } else if (mh !== undefined && mh.state === "unknown") {
    lines.push(
      `Main-health probe inconclusive at loop start${mh.detail !== undefined ? ` (${mh.detail})` : ""} — the run proceeded with unknown '${mh.branch}' health.`,
    );
    lines.push("");
  }
  if (summary.abortReason !== null) {
    lines.push(`**ABORTED: ${summary.abortReason}**`);
    lines.push("");
  } else if (summary.stopReason !== null) {
    lines.push(`Stopped: ${summary.stopReason}.`);
    lines.push("");
  }
  lines.push(
    `**Items:** ${summary.items.length} attempted · ${counts.merged} merged · ${counts["handed-off"]} handed off · ${counts.abandoned} abandoned · ${counts["blocked-on-human"]} blocked on human${
      counts.split > 0 ? ` · ${counts.split} split` : ""
    }${
      counts.released > 0 ? ` · ${counts.released} released (environment)` : ""
    }${
      counts["in-progress-at-exit"] > 0 ? ` · ${counts["in-progress-at-exit"]} in progress at exit` : ""
    }${
      // mlc104 (review EC-9): a night of pure contention must not render a
      // summary line that says nothing happened.
      counts["claim-contended"] > 0 ? ` · ${counts["claim-contended"]} claim-contended (peers won races)` : ""
    }${counts["claim-failed"] > 0 ? ` · ${counts["claim-failed"]} claim-failed` : ""}`,
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
