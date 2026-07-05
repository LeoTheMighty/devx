// The PR/CI/merge tail for loop-completed items (v2l101).
//
// D-11: loop completion is NOT acceptance. When a worker reports `acs_met`,
// the item is handed to the exact same tail every /devx run uses — PR body
// via the canonical renderer (prt102), remote-CI probe (dvx105), hold check
// (v2t101/D-5), merge-gate (mrg101/dvx106) — and ONLY a green gate merges.
// Anything else leaves the PR open and the morning report says so.
//
// Wrap-don't-duplicate ledger:
//   - PR body        → src/lib/pr-body.ts renderPrBody + loadTemplate +
//                      extractAcChecklist
//   - CI probe       → src/lib/devx/await-remote-ci.ts hasWorkflowFiles +
//                      parseGhRunList (the tail lists ALL runs for the head
//                      SHA — limit 20 — and requires EVERY one green; the
//                      single-run probeRemoteCi shape lets a green workflow
//                      shadow a red/running sibling, review finding MED-5)
//   - hold check     → src/lib/devx/hold-check.ts checkHold (D-5)
//   - merge decision → src/lib/merge-gate.ts mergeGateFor
//   - backlog flips  → src/lib/manage/loop.ts replaceFrontmatterStatus /
//                      flipDevMdCheckbox (via the driver)
//
// gh quirk (memory: feedback_gh_pr_merge_in_worktree): `gh pr merge` can
// exit non-zero while the remote merge still succeeded. We run the merge
// from repoRoot (not the worktree) AND verify via `gh pr view --json
// state,mergeCommit` before classifying a non-zero exit as failure.
//
// Spec: dev/dev-v2l101-2026-07-05T13:06-overnight-loop.md
// Design: v2/04-overnight-loop.md §2 (outer loop), v2/07-decisions.md D-5/D-11

import { join } from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";

import { extractAcChecklist, loadTemplate, renderPrBody } from "../pr-body.js";
import { GhProbeError, hasWorkflowFiles, parseGhRunList } from "../devx/await-remote-ci.js";
import { checkHold } from "../devx/hold-check.js";
import { mergeGateFor, type GateSignals } from "../merge-gate.js";
import { type Exec } from "./git-tx.js";

export interface TailItem {
  hash: string;
  type: string;
  title: string;
  /** Repo-relative spec path. */
  specRelPath: string;
  branch: string;
  worktreePath: string;
  /** Iteration summaries for the PR body's Summary section. */
  changeSummaries: string[];
}

export interface TailCtx {
  repoRoot: string;
  mode: string;
  merged: unknown;
  exec: Exec;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
  now?: () => Date;
  /** CI poll cadence + ceiling. Defaults: 30s poll, 45min ceiling (matches
   *  ci.poll_interval_s / ci.poll_timeout_min defaults). */
  ciPollMs?: number;
  ciTimeoutMs?: number;
  out?: (line: string) => void;
}

/**
 * Hand-off kinds (review finding MED-6) — the driver's systemic-failure
 * rail branches on this:
 *
 *   - "handed-off-ok"      — the tail COMPLETED its protocol and a
 *                            deliberate signal said don't merge (CI red,
 *                            `devx: hold`, merge-gate refusal, abort
 *                            signal). The system worked; resets the rail.
 *   - "handed-off-failure" — the tail could NOT complete its protocol
 *                            (gh pr create failed, CI probe threw, poll
 *                            ceiling, unmergeable mechanics). Outage-shaped;
 *                            increments the abandoned-items streak so a gh/CI
 *                            outage trips the 3-stop instead of stranding up
 *                            to maxItems claims.
 */
export type HandOffKind = "handed-off-ok" | "handed-off-failure";

export type TailOutcome =
  | { outcome: "merged"; prUrl: string; prNumber: number }
  | {
      outcome: "handed-off";
      kind: HandOffKind;
      prUrl: string | null;
      prNumber: number | null;
      detail: string;
    };

export type TailFn = (item: TailItem, ctx: TailCtx) => Promise<TailOutcome>;

// ---------------------------------------------------------------------------
// Default tail
// ---------------------------------------------------------------------------

export async function defaultTail(item: TailItem, ctx: TailCtx): Promise<TailOutcome> {
  const exec = ctx.exec;
  const out = ctx.out ?? (() => {});
  const pollMs = ctx.ciPollMs ?? 30_000;
  const timeoutMs = ctx.ciTimeoutMs ?? 45 * 60_000;

  // ── 1. PR: reuse an existing open PR for this branch, else create ──────
  let prNumber: number | null = null;
  let prUrl: string | null = null;
  const listed = exec(
    "gh",
    ["pr", "list", "--head", item.branch, "--state", "open", "--json", "number,url"],
    { cwd: ctx.repoRoot },
  );
  if (listed.exitCode === 0) {
    try {
      const arr = JSON.parse(listed.stdout.trim() || "[]");
      if (Array.isArray(arr) && arr.length > 0 && typeof arr[0]?.number === "number") {
        prNumber = arr[0].number;
        prUrl = typeof arr[0].url === "string" ? arr[0].url : null;
      }
    } catch {
      // fall through to create
    }
  }
  if (prNumber === null) {
    const body = buildTailPrBody(item, ctx);
    const created = exec(
      "gh",
      [
        "pr",
        "create",
        "--head",
        item.branch,
        "--title",
        `${item.type === "debug" ? "fix" : "feat"}: ${item.hash} — ${item.title || item.specRelPath}`,
        "--body",
        body,
      ],
      { cwd: ctx.repoRoot },
    );
    if (created.exitCode !== 0) {
      return handOff(
        "handed-off-failure",
        null,
        null,
        `gh pr create failed (exit ${created.exitCode}): ${firstLine(created.stderr)}`,
      );
    }
    prUrl = created.stdout.trim().split("\n").pop() ?? null;
    const numMatch = prUrl !== null ? /\/pull\/(\d+)/.exec(prUrl) : null;
    prNumber = numMatch ? Number.parseInt(numMatch[1], 10) : null;
    out(`loop: opened PR ${prUrl ?? "(url unknown)"} for ${item.hash}`);
  }

  // ── 2. Remote CI: ALL runs for the head SHA must be completed + green ──
  // Review finding MED-5: the single-run probe (`gh run list --limit 1`)
  // let the most-recently-created workflow shadow its siblings — a green
  // lint run listed first while the test run was red/still running meant
  // an unattended merge on partial CI. The unattended tail demands the
  // strict form: list up to 20 runs for the branch, keep only those whose
  // headSha matches the pushed tip, and merge only when EVERY one of them
  // is completed+success. Any run still in flight ⇒ keep polling; any
  // non-success conclusion ⇒ hand off.
  let ciConclusion: string | null = null;
  if (hasWorkflowFiles({ exists: existsSync, readdir: readdirSync }, ctx.repoRoot)) {
    const rev = exec("git", ["rev-parse", item.branch], { cwd: ctx.repoRoot });
    const headSha = rev.stdout.trim();
    if (rev.exitCode !== 0 || !/^[0-9a-f]{40}$/.test(headSha)) {
      return handOff(
        "handed-off-failure",
        prUrl,
        prNumber,
        `CI probe failed: git rev-parse ${item.branch} exited ${rev.exitCode}: ${firstLine(rev.stderr) || headSha || "(no output)"}`,
      );
    }
    const deadline = Date.now() + timeoutMs;
    let lastProbe = "no-runs-for-head-sha";
    while (true) {
      if (ctx.signal?.aborted) {
        return handOff("handed-off-ok", prUrl, prNumber, "loop stopped while awaiting CI");
      }
      const ghR = exec(
        "gh",
        [
          "run",
          "list",
          "--branch",
          item.branch,
          "--limit",
          "20",
          "--json",
          "databaseId,status,conclusion,url,headSha,workflowName",
        ],
        { cwd: ctx.repoRoot },
      );
      if (ghR.exitCode !== 0) {
        return handOff(
          "handed-off-failure",
          prUrl,
          prNumber,
          `CI probe failed: gh run list exited ${ghR.exitCode}: ${firstLine(ghR.stderr) || "(no stderr)"}`,
        );
      }
      let runs;
      try {
        runs = parseGhRunList(ghR.stdout);
      } catch (e) {
        const msg = e instanceof GhProbeError ? e.message : errMessage(e);
        return handOff("handed-off-failure", prUrl, prNumber, `CI probe failed: ${msg}`);
      }
      const forHead = runs.filter((r) => r.headSha === headSha);
      if (forHead.length === 0) {
        lastProbe = "no-runs-for-head-sha";
      } else if (forHead.some((r) => r.status !== "completed")) {
        lastProbe = "in-progress";
      } else {
        const red = forHead.find((r) => r.conclusion !== "success");
        if (red !== undefined) {
          // CI red: the loop does NOT fix-forward unattended — that's a
          // judgment call for the morning (the inner contract works spec
          // slices, not CI archaeology). A deliberate red is the system
          // WORKING, so this is an ok-shaped hand-off.
          return handOff(
            "handed-off-ok",
            prUrl,
            prNumber,
            `remote CI concluded '${red.conclusion ?? "unknown"}' (${red.workflowName || `run ${red.databaseId}`}) — not merging`,
          );
        }
        ciConclusion = "success";
        break;
      }
      if (Date.now() >= deadline) {
        return handOff(
          "handed-off-failure",
          prUrl,
          prNumber,
          `remote CI did not complete within ${Math.round(timeoutMs / 60000)}min (last probe: ${lastProbe})`,
        );
      }
      await ctx.sleep(pollMs, ctx.signal);
    }
  }
  // No remote CI configured — local gates were authoritative (dvx105
  // three-state contract); merge-gate treats null as ok.

  // ── 3. Hold check (D-5): a `devx: hold` comment/review blocks the merge ─
  let blockingComments = 0;
  if (prNumber !== null) {
    try {
      const hold = checkHold(prNumber, {
        repoRoot: ctx.repoRoot,
        exec: (cmd, args, o) => exec(cmd, args, o),
      });
      if (hold.hold) {
        return handOff("handed-off-ok", prUrl, prNumber, `hold requested: ${hold.reason ?? "devx: hold"}`);
      }
    } catch (e) {
      // Fail SAFE on an unreadable hold state: treat as a blocking comment
      // so the gate below refuses in BETA/PROD; YOLO ignores comments by
      // contract, and a YOLO project explicitly opted out of that ceremony.
      blockingComments = 1;
      void e;
    }
  }

  // ── 4. Merge gate (mrg101) — the ONLY path to main ─────────────────────
  const signals: GateSignals = {
    ciConclusion,
    lockdownActive: false,
    blockingReviewComments: blockingComments,
    coveragePctTouched: null,
    ...autonomyFrom(ctx.merged),
  };
  const decision = mergeGateFor(ctx.mode, signals);
  if (!decision.merge) {
    return handOff(
      "handed-off-ok",
      prUrl,
      prNumber,
      `merge-gate refused: ${decision.reason ?? (decision.advice ?? []).join("; ")}`,
    );
  }

  // ── 5. Merge (from repoRoot; verify on non-zero exit) ──────────────────
  if (prNumber === null) {
    return handOff(
      "handed-off-failure",
      prUrl,
      prNumber,
      "PR number unknown — cannot merge mechanically",
    );
  }
  const mergeR = exec(
    "gh",
    ["pr", "merge", String(prNumber), "--squash", "--delete-branch"],
    { cwd: ctx.repoRoot },
  );
  if (mergeR.exitCode !== 0) {
    const view = exec(
      "gh",
      ["pr", "view", String(prNumber), "--json", "state,mergeCommit"],
      { cwd: ctx.repoRoot },
    );
    let mergedAnyway = false;
    if (view.exitCode === 0) {
      try {
        const j = JSON.parse(view.stdout.trim() || "{}");
        mergedAnyway = j?.state === "MERGED";
      } catch {
        // fall through
      }
    }
    if (!mergedAnyway) {
      return handOff(
        "handed-off-failure",
        prUrl,
        prNumber,
        `gh pr merge exited ${mergeR.exitCode} and PR is not merged: ${firstLine(mergeR.stderr)}`,
      );
    }
  }
  out(`loop: merged PR #${prNumber} for ${item.hash}`);
  return { outcome: "merged", prUrl: prUrl ?? `#${prNumber}`, prNumber };
}

function handOff(
  kind: HandOffKind,
  prUrl: string | null,
  prNumber: number | null,
  detail: string,
): TailOutcome {
  return { outcome: "handed-off", kind, prUrl, prNumber, detail };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildTailPrBody(item: TailItem, ctx: TailCtx): string {
  let specBody = "";
  try {
    specBody = readFileSync(join(ctx.repoRoot, item.specRelPath), "utf8");
  } catch {
    // renderer flags the unresolved AC placeholder — visible, not fatal
  }
  const summary =
    item.changeSummaries.length > 0
      ? item.changeSummaries.map((s) => `- ${s}`).join("\n")
      : undefined;
  const rendered = renderPrBody({
    template: loadTemplate(ctx.repoRoot),
    mode: ctx.mode,
    specPath: item.specRelPath,
    acChecklist: extractAcChecklist(specBody),
    ...(summary !== undefined ? { summary } : {}),
    testPlan:
      "Produced by `devx loop` — each iteration ran the relevant build/tests before reporting success; remote CI gates this merge (D-11).",
    notes: `Overnight loop item (\`${item.hash}\`); iteration history is in the spec's Status log on this branch.`,
    tour: { unavailableReason: "overnight loop run — generate via devx tour if needed" },
  });
  return rendered.body;
}

function autonomyFrom(merged: unknown): { count: number; initialN: number } {
  const out = { count: 0, initialN: 0 };
  if (!merged || typeof merged !== "object") return out;
  const promotion = (merged as Record<string, unknown>).promotion;
  if (!promotion || typeof promotion !== "object") return out;
  const autonomy = (promotion as Record<string, unknown>).autonomy;
  if (!autonomy || typeof autonomy !== "object") return out;
  const a = autonomy as Record<string, unknown>;
  if (typeof a.count === "number" && Number.isFinite(a.count)) out.count = a.count;
  if (typeof a.initial_n === "number" && Number.isFinite(a.initial_n)) {
    out.initialN = a.initial_n;
  }
  return out;
}

function firstLine(s: string): string {
  return s.split("\n").find((l) => l.trim() !== "")?.trim() ?? s.trim();
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
