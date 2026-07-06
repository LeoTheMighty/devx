// `devx next` v2 — the repo-level 12-row first-match decision table
// (v2d101). Pure function: a fully-materialized RepoSnapshot in, one
// decision out. All I/O (backlog reads, gh probes, lock reads, heartbeat)
// lives in gather.ts; the skill body renders this function's output — the
// 8am-harness `next_command()` move, so dashboard/mobile/skill can never
// drift (v2/05-dispatcher.md §2).
//
// First match wins:
//
//   | #   | Condition                                        | Action            |
//   |-----|--------------------------------------------------|-------------------|
//   | 1   | loop/manager run live (heartbeat fresh)          | report-loop       |
//   | 2   | own PR open with CI red                          | fix-ci            |
//   | 3   | own PR open, CI green, unmerged                  | merge-tail        |
//   | 4   | PR merged but spec/backlog not reconciled        | reconcile-merge   |
//   | 5   | spec claimed by me, in-progress                  | resume            |
//   | 5.5 | outcome due (status pending, measure_by ≤ today) | outcome-due       |
//   | 6   | INTERVIEW.md unanswered items block ready work   | interview         |
//   | 7   | DEBUG.md has ready items                         | execute-debug     |
//   | 8   | DEV.md ready items whose workstream gates pass   | execute-dev       |
//   | 9   | a workstream is mid-pipeline                     | workstream-stage  |
//   | 10  | PLAN.md has ready plan items                     | plan-prd          |
//   | 11  | nothing ready, blocked items exist               | report-blocked    |
//   | 12  | genuinely empty                                  | propose-interview |
//
// Row 5.5 (v2o101): inserted as a fractional row rather than renumbering —
// the canonical 1–12 numbers are pinned across v2/05-dispatcher.md §2, the
// S-4 matrix, and the skill body, and an outcome that came due outranks new
// work (rows 6+) but never preempts in-flight work (rows 1–5).
//
// Row 8 before row 9 keeps shipping ahead of planning when both are
// available; `--prefer plan` (opts.preferPlan) flips the 8/9 evaluation
// order while keeping the canonical row numbers in the output.
//
// Deliberate widenings vs the §2 letter (documented, not drift):
//   - Row 3 also fires on ci "none" (empty check rollup) — merge-gate
//     re-verifies CI itself, so the fail-safe lives downstream.
//   - Row 9 includes done-but-outcome-unscored workstreams (v1 row 2 →
//     `/devx outcome <hash>`) — outcome scoring must surface somewhere,
//     and the mid-pipeline slot is the natural home.
//
// Backlog↔frontmatter drift is REPORTED in the output (`drift: [...]`),
// never silently fixed — the reconcile fix is a human/skill decision.
//
// Spec: dev/dev-v2d101-2026-07-05T13:05-universal-dispatcher.md
// Design: v2/05-dispatcher.md §2; v2/07-decisions.md D-8, D-12

import type { SpecStatus, SpecType } from "../backlog/parse.js";
import type { NextDecision } from "../engine/next.js";

// ---------------------------------------------------------------------------
// Snapshot types (gather.ts materializes these; tests build them directly)
// ---------------------------------------------------------------------------

export type NextAction =
  | "report-loop"
  | "fix-ci"
  | "merge-tail"
  | "reconcile-merge"
  | "resume"
  | "outcome-due"
  | "interview"
  | "execute-debug"
  | "execute-dev"
  | "workstream-stage"
  | "plan-prd"
  | "report-blocked"
  | "propose-interview";

/** Backlog↔frontmatter drift — reported, never silently fixed. */
export interface DriftEntry {
  hash: string;
  /** Backlog file the row lives in ("DEV.md" | "DEBUG.md" | "PLAN.md"). */
  backlog: string;
  kind: "status-mismatch" | "in-progress-without-lock";
  /** Status the backlog row carries (checkbox/Status: text). */
  backlogStatus?: SpecStatus;
  /** Status the spec frontmatter carries. */
  specStatus?: string | null;
  detail: string;
}

export interface LoopSignal {
  live: boolean;
  /** Which state file said "live". Null when no loop state exists (the
   *  graceful pre-v2l101 degradation). */
  source: "manager-heartbeat" | "loop-state" | null;
  pid: number | null;
  ts: string | null;
  ageSeconds: number | null;
  /** Repo-relative path of a morning report that landed overnight, if any. */
  overnightReport: string | null;
}

export type CiState = "red" | "green" | "pending" | "none";

export interface OwnPrSignal {
  number: number;
  branch: string;
  url: string;
  ci: CiState;
  /** Spec type derived from the branch tail (`feat/debug-<hash>` → "debug").
   *  Row 3 routes dev PRs to `devx merge-gate` and everything else through
   *  the `/devx <hash>` dispatcher (merge-gate resolves dev/ specs only). */
  specType: string | null;
  /** Spec hash derived from the branch tail (`feat/dev-<hash>` → hash). */
  hash: string | null;
}

export interface MergeReconcileSignal {
  hash: string;
  backlog: string;
  backlogStatus: SpecStatus;
  specStatus: string;
  specPath: string;
}

export type ClaimOwnership =
  | "owned"
  | "unverified"
  | "other-session"
  | "no-lock";

export interface ClaimSignal {
  hash: string;
  backlog: string;
  ownership: ClaimOwnership;
  lockOwner: string | null;
}

export interface InterviewBlockSignal {
  qNum: string;
  /** Hashes this unanswered question blocks that exist in DEV/DEBUG with
   *  status ready|blocked. */
  blocks: string[];
}

export interface GateInfo {
  /** True when the spec's from:/plan:/workstream: chain names an
   *  engine-managed workstream. Standalone debug/chore specs are exempt. */
  required: boolean;
  /** True when required && the workstream's evals_red gate flag is true. */
  passed: boolean;
  /** Repo-relative workstream dir the gate resolved to, if any. */
  workstream: string | null;
  reason: string | null;
}

export interface ReadyItemSignal {
  hash: string;
  type: SpecType;
  backlog: string;
  path: string;
  title: string;
  gate: GateInfo;
}

export interface WorkstreamSignal {
  hash: string;
  slug: string;
  stage: string | null;
  /** The v1 workstream-stage decision (nextForWorkstream) — reused verbatim. */
  decision: NextDecision;
}

/** A closed workstream whose armed outcome came due (row 5.5, v2o101). */
export interface OutcomeDueSignal {
  hash: string;
  slug: string;
  /** measure_by as written; null/unparseable dates count as due (a pending
   *  outcome must never wait forever on a malformed date). */
  measureBy: string | null;
}

export interface PlanItemSignal {
  hash: string;
  path: string;
  title: string;
}

export interface BlockedItemSignal {
  hash: string;
  backlog: string;
  status: SpecStatus;
  blocked_by: string[];
  owner: string | null;
}

export interface RepoSnapshot {
  loop: LoopSignal;
  /** Own open PRs (gh --author @me), CI state resolved. */
  prs: OwnPrSignal[];
  /** Done-mismatch pairs: one side (backlog row / spec frontmatter) says
   *  done, the other doesn't — a merge that never got its cleanup phase. */
  unreconciled: MergeReconcileSignal[];
  /** In-progress rows with a spec lock (ownership per sessionToken). */
  claims: ClaimSignal[];
  /** Closed workstreams with outcome pending + measure_by ≤ today (row 5.5). */
  outcomeDue: OutcomeDueSignal[];
  interviewBlocking: InterviewBlockSignal[];
  /** DEBUG.md ready rows, blockers resolved, in file order. */
  debugReady: ReadyItemSignal[];
  /** DEV.md ready rows, blockers resolved, in file order, gate resolved. */
  devReady: ReadyItemSignal[];
  /** plan/ specs with engine frontmatter that are mid-pipeline. */
  midPipeline: WorkstreamSignal[];
  /** PLAN.md ready rows in file order. */
  planReady: PlanItemSignal[];
  /** Blocked rows across DEV/DEBUG/PLAN (for row 11's report). */
  blocked: BlockedItemSignal[];
  drift: DriftEntry[];
  /** Degradations the gatherer hit (gh unavailable, unreadable spec, …). */
  warnings: string[];
}

export interface RepoNextDecision {
  row: number;
  action: NextAction;
  command: string | null;
  detail: string;
  drift: DriftEntry[];
  warnings: string[];
  /**
   * Morning report that landed within the last 24h, if any — surfaced on
   * EVERY decision, not just row 1, so the common "loop finished
   * overnight, wrote its report, exited cleanly" case still gets the
   * review-first signal (adversarial-review BH#6/EC#6).
   */
  overnightReport: string | null;
}

export interface DecideOpts {
  /** `--prefer plan`: evaluate row 9 before row 8. Row numbers in the
   *  output stay canonical. */
  preferPlan?: boolean;
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

type RowFn = (
  s: RepoSnapshot,
) => Omit<RepoNextDecision, "drift" | "warnings" | "overnightReport"> | null;

const row1: RowFn = (s) => {
  if (!s.loop.live) return null;
  const who =
    s.loop.source === "manager-heartbeat" ? "manager" : "loop";
  const age =
    s.loop.ageSeconds !== null ? `heartbeat ${s.loop.ageSeconds}s ago` : "heartbeat fresh";
  const report = s.loop.overnightReport
    ? ` — a report landed overnight at ${s.loop.overnightReport}; review it first`
    : "";
  return {
    row: 1,
    action: "report-loop",
    command: null,
    detail: `a ${who} run is live (pid ${s.loop.pid ?? "?"}, ${age}) — don't start overlapping work${report}`,
  };
};

const row2: RowFn = (s) => {
  const pr = s.prs.find((p) => p.ci === "red");
  if (!pr) return null;
  return {
    row: 2,
    action: "fix-ci",
    command: pr.hash ? `/devx ${pr.hash}` : `gh pr checks ${pr.number}`,
    detail: `own PR #${pr.number} (${pr.branch}) has CI red — fix forward on that branch (${pr.url})`,
  };
};

const row3: RowFn = (s) => {
  // ci === "none" (no checks reported) is deliberately merge-tail-eligible:
  // an empty rollup is either a no-CI repo or a just-pushed PR whose checks
  // haven't registered — `devx merge-gate` re-verifies CI itself, so the
  // fail-safe lives there, not here (accepted v1 bound).
  const pr = s.prs.find((p) => p.ci === "green" || p.ci === "none");
  if (!pr) return null;
  const ciNote = pr.ci === "none" ? " (no checks reported)" : "";
  // merge-gate resolves dev/ specs only; debug/plan/etc. PRs route through
  // the dispatcher, whose execute/debug arm owns their merge tail.
  let command: string;
  if (pr.hash && pr.specType === "dev") {
    command = `devx merge-gate ${pr.hash}`;
  } else if (pr.hash) {
    command = `/devx ${pr.hash}`;
  } else {
    command = `gh pr view ${pr.number}`;
  }
  return {
    row: 3,
    action: "merge-tail",
    command,
    detail: `own PR #${pr.number} (${pr.branch}) is CI green${ciNote} and unmerged — run the merge-gate tail (respect devx: hold via check-hold)`,
  };
};

const row4: RowFn = (s) => {
  const m = s.unreconciled[0];
  if (!m) return null;
  return {
    row: 4,
    action: "reconcile-merge",
    command: `/devx ${m.hash}`,
    detail: `'${m.hash}' is done-mismatched (${m.backlog} row says '${m.backlogStatus}', spec says '${m.specStatus}') — run the cleanup phase (worktree, checkbox, status log)`,
  };
};

const row5: RowFn = (s) => {
  // Owned claims resume directly; unverified claims (no session token
  // supplied) route through the roc101 owner check first. Claims held by
  // another session never fire this row — that work belongs to a live peer.
  const owned = s.claims.find((c) => c.ownership === "owned");
  if (owned) {
    return {
      row: 5,
      action: "resume",
      command: `/devx ${owned.hash}`,
      detail: `'${owned.hash}' is in-progress and this session holds the claim — resume it`,
    };
  }
  const unverified = s.claims.find((c) => c.ownership === "unverified");
  if (unverified) {
    // Command is executable verbatim (no placeholder tokens — machine
    // consumers run `command` as-is): without --session-token the CLI
    // auto-derives the CURRENT session's token, which is exactly the
    // roc101 semantics — exit 0 only if this session took the claim.
    // Debug claims need --type debug (verify-claim resolves dev/ by
    // default).
    const typeFlag =
      unverified.backlog === "DEBUG.md" ? " --type debug" : "";
    return {
      row: 5,
      action: "resume",
      command: `devx devx-helper verify-claim ${unverified.hash}${typeFlag}`,
      detail: `'${unverified.hash}' is in-progress with a lock held — verify claim ownership (roc101) before resuming (pass --session-token if you claimed under an explicit token); on 'owned' run /devx ${unverified.hash}`,
    };
  }
  return null;
};

const row5_5: RowFn = (s) => {
  const due = s.outcomeDue[0];
  if (!due) return null;
  const when = due.measureBy
    ? `measure_by ${due.measureBy} has passed`
    : "measure_by is unset/unparseable (counts as due)";
  return {
    row: 5.5,
    action: "outcome-due",
    command: `/devx outcome ${due.hash}`,
    detail: `workstream '${due.slug}' (${due.hash}) has an outcome due — ${when}; score its G- goals vs reality (keep|tune|restart|retire)`,
  };
};

const row6: RowFn = (s) => {
  if (s.interviewBlocking.length === 0) return null;
  const qs = s.interviewBlocking
    .map((q) => `Q#${q.qNum} (blocks ${q.blocks.join(", ")})`)
    .join("; ");
  return {
    row: 6,
    action: "interview",
    command: "/devx-interview",
    detail: `INTERVIEW.md has ${s.interviewBlocking.length} unanswered question(s) blocking ready work: ${qs}`,
  };
};

const row7: RowFn = (s) => {
  const item = s.debugReady[0];
  if (!item) return null;
  return {
    row: 7,
    action: "execute-debug",
    command: `/devx ${item.hash}`,
    detail: `DEBUG.md top ready item '${item.hash}' — ${item.title || item.path} (repro-first: a failing test is the RED artifact)`,
  };
};

const row8: RowFn = (s) => {
  const item = s.devReady.find((i) => !i.gate.required || i.gate.passed);
  if (!item) return null;
  const gateNote = item.gate.required
    ? ` (workstream gate evals_red passed for ${item.gate.workstream ?? "its workstream"})`
    : "";
  return {
    row: 8,
    action: "execute-dev",
    command: `/devx ${item.hash}`,
    detail: `DEV.md top ready item '${item.hash}' — ${item.title || item.path}${gateNote}`,
  };
};

const row9: RowFn = (s) => {
  const ws = s.midPipeline[0];
  if (!ws) return null;
  return {
    row: 9,
    action: "workstream-stage",
    command: ws.decision.command,
    detail: `workstream '${ws.slug}' (${ws.hash}) is mid-pipeline at stage '${ws.stage ?? "?"}' — ${ws.decision.reason}`,
  };
};

const row10: RowFn = (s) => {
  const item = s.planReady[0];
  if (!item) return null;
  return {
    row: 10,
    action: "plan-prd",
    command: `/devx prd ${item.hash}`,
    detail: `PLAN.md top ready item '${item.hash}' — ${item.title || item.path}; start its PRD stage`,
  };
};

const row11: RowFn = (s) => {
  if (s.blocked.length === 0) return null;
  const lines = s.blocked
    .map(
      (b) =>
        `'${b.hash}' (${b.backlog}${b.owner ? `, owner ${b.owner}` : ""})${
          b.blocked_by.length > 0 ? ` blocked-by: ${b.blocked_by.join(", ")}` : ""
        }`,
    )
    .join("; ");
  return {
    row: 11,
    action: "report-blocked",
    command: null,
    detail: `nothing is ready; ${s.blocked.length} blocked item(s): ${lines}`,
  };
};

const row12: RowFn = () => ({
  row: 12,
  action: "propose-interview",
  command: "/devx-interview",
  detail:
    "backlogs are genuinely empty — propose interviewing the user for the next objective",
});

const CANONICAL_ORDER: RowFn[] = [
  row1,
  row2,
  row3,
  row4,
  row5,
  row5_5,
  row6,
  row7,
  row8,
  row9,
  row10,
  row11,
  row12,
];

const PREFER_PLAN_ORDER: RowFn[] = [
  row1,
  row2,
  row3,
  row4,
  row5,
  row5_5,
  row6,
  row7,
  row9, // flipped: planning ahead of shipping
  row8,
  row10,
  row11,
  row12,
];

export function decideRepoNext(
  snapshot: RepoSnapshot,
  opts: DecideOpts = {},
): RepoNextDecision {
  const order = opts.preferPlan ? PREFER_PLAN_ORDER : CANONICAL_ORDER;
  for (const row of order) {
    const hit = row(snapshot);
    if (hit) {
      return {
        ...hit,
        drift: snapshot.drift,
        warnings: snapshot.warnings,
        overnightReport: snapshot.loop.overnightReport,
      };
    }
  }
  // Unreachable — row 12 always matches. Kept for the type system.
  return {
    row: -1,
    action: "propose-interview",
    command: null,
    detail: "no row matched",
    drift: snapshot.drift,
    warnings: snapshot.warnings,
    overnightReport: snapshot.loop.overnightReport,
  };
}

/** One-line human rendering of a decision (CLI prints this on stderr). */
export function renderHumanLine(d: RepoNextDecision): string {
  const cmd = d.command ? ` → run: ${d.command}` : "";
  const drift =
    d.drift.length > 0 ? ` [drift: ${d.drift.length} reconcile defect(s) — see JSON]` : "";
  // Row 1 already weaves the report into its detail; every other row gets
  // the review-first nudge appended.
  const report =
    d.overnightReport && d.row !== 1
      ? ` [overnight report: ${d.overnightReport} — review it first]`
      : "";
  return `next [row ${d.row}/${d.action}] ${d.detail}${cmd}${report}${drift}`;
}
