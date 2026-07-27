// The overnight-loop driver (v2l101) — `devx loop` as a MODE OF THE MANAGER,
// not a new daemon (v2/04 §7).
//
// Reuse ledger:
//   - singleton lock       → manage/lock.ts acquireManagerLock (mgr106 —
//                            stale-PID + PID-recycling cross-check)
//   - item pick            → manage/reconcile.ts reconcile (mgr103; the loop
//                            masks excluded/type-filtered rows to "blocked"
//                            so blocker resolution stays intact)
//   - claim                → devx/claim.ts claimSpec (dvx101 — atomic 6-step
//                            claim: lock, backlog flip, frontmatter, commit,
//                            push, worktree; roc101 lock file IS the claim's
//                            ownership sentinel)
//   - state atomicity      → supervisor-internal writeAtomic via loop/state.ts
//                            (mgr102's tmp+rename pattern)
//   - abandon flips        → manage/loop.ts replaceFrontmatterStatus +
//                            flipDevMdCheckbox via loop/spec-io.ts
//   - PR/CI/merge tail     → loop/tail.ts (prt102 + dvx105 + mrg101 + D-5)
//
// Two nested loops, both bounded (v2/04 §2): the OUTER loop claims backlog
// items under night budgets; the INNER loop runs the gnhf iteration contract
// (fresh worker session per iteration, structured report, transactional
// commit-or-reset, failure ladder). The morning report is written at exit
// ALWAYS — normal stop, abort, SIGTERM/SIGINT all funnel through the same
// finally block.
//
// Status-log geography (load-bearing): ITERATION entries (success/[FAIL]/
// [ERROR]) are appended to the spec copy INSIDE THE WORKTREE and committed
// on the feature branch — that's what the next fresh iteration reads (the
// worker's cwd is the worktree), and squash-merge folds the history into
// main (v2/04 §2 "ours lives on-branch so the history merges"). ITEM-level
// entries (claim, abandon, done) land on the MAIN worktree's spec copy —
// that's the copy reconcile/dispatcher read for status.
//
// Spec: dev/dev-v2l101-2026-07-05T13:06-overnight-loop.md
// Design: v2/04-overnight-loop.md (all sections)

import { readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { writeAtomic } from "../supervisor-internal.js";

import { loadMerged } from "../config-io.js";
import { parseBacklogSnapshot, parseDevMd, type DevRow } from "../backlog/parse.js";
import { reconcile } from "../manage/reconcile.js";
import {
  ManagerLockHeldError,
  acquireManagerLock,
  type LockHandle,
} from "../manage/lock.js";
import {
  ClaimError,
  LockHeldError,
  claimSpec,
  type ClaimSpecResult,
} from "../devx/claim.js";
import {
  normalizeSessionToken,
  parseLockOwner,
} from "../devx/verify-claim.js";
import { type DeriveBranchConfig } from "../plan/derive-branch.js";

import {
  heartbeatIntervalMsFrom,
  loopConfigFrom,
  loopModeGate,
  type LoopConfig,
} from "./config.js";
import {
  buildCommitRepairPrompt,
  buildIterationPrompt,
  buildReportRetryPrompt,
  extractReportJson,
  validateIterationReport,
  type IterationReport,
  type PriorAttempt,
} from "./iteration.js";
import {
  CommitFailedError,
  LOOP_BOOKKEEPING_COMMIT_PREFIX,
  PushFailedError,
  commitAll,
  diffStat,
  getHead,
  hasUncommittedChanges,
  isBookkeepingOnlyWorktree,
  pushCurrentBranch,
  realExec,
  resetHard,
  statusSnapshot,
  type Exec,
} from "./git-tx.js";
import {
  afterItemAbandoned,
  afterItemCompleted,
  classifyIteration,
  emptyLadderState,
  firstPermanentErrorMatchInTail,
  ladderDecision,
  nextLadderState,
  shouldStopAfterAbandonment,
  type IterationClass,
  type LadderState,
} from "./ladder.js";
import {
  appendEvent,
  errorChainText,
  newRunId,
  recoverStaleLoopState,
  serializeError,
  writeLoopState,
  type LoopState,
} from "./state.js";
import {
  appendStatusEntryToFile,
  clearSpecOwner,
  hasPhase4StatusLine,
  markBacklogRowDone,
  setBacklogRowState,
  setSpecStatus,
  type EntryPrefix,
} from "./spec-io.js";
import { writeMorningReport, type ItemResult, type RunSummary, type TokenTotals } from "./report.js";
import { defaultTail, type HandOffKind, type TailFn } from "./tail.js";
import {
  WorkerTimeoutError,
  makeClaudeWorker,
  type WorkerRunFn,
  type WorkerTokens,
} from "./worker.js";

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export interface LoopFlags {
  /** "HH:MM" wall-clock deadline (next occurrence). */
  until?: string;
  /** Overrides downward only (min with config). */
  maxItems?: number;
  /** Total-token override — downward only. */
  maxTokens?: number;
  /** Restrict picks to one spec type ("dev" | "debug"). */
  only?: string;
  dryRun?: boolean;
}

export interface DryRunPlan {
  mode: string;
  budgets: RunSummary["budgets"];
  items: Array<{ hash: string; type: string; title: string; path: string }>;
}

export interface RunLoopOpts {
  repoRoot: string;
  /** Defaults to `<repoRoot>/.devx-cache`. */
  cacheDir?: string;
  /** Merged config blob; defaults to loadMerged(). */
  merged?: unknown;
  flags?: LoopFlags;
  now?: () => Date;
  /** git + gh seam. */
  exec?: Exec;
  /** Fresh-session-per-iteration worker. Defaults to `claude -p`. */
  worker?: WorkerRunFn;
  /** PR/CI/merge tail. Defaults to defaultTail. */
  tail?: TailFn;
  /** Claim seam — defaults to devx/claim.ts claimSpec. */
  claim?: (hash: string, type: string) => Promise<ClaimSpecResult>;
  sessionId?: string;
  out?: (line: string) => void;
  /** Interruptible sleep seam (backoff + CI polling). */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
  pidAlive?: (pid: number) => boolean;
  /** state.json heartbeat cadence; default 60s. */
  heartbeatIntervalMs?: number;
  /** Manager-lock seam (tests). Defaults to acquireManagerLock(cacheDir). */
  acquireLock?: () => LockHandle;
  /** CI polling knobs forwarded to the tail. */
  ciPollMs?: number;
  ciTimeoutMs?: number;
}

export interface RunLoopResult {
  /** 0 stopped clean · 1 lock held · 2 aborted · 3 mode-refused ·
   *  4 bad flags. */
  exitCode: number;
  refusedReason?: string;
  summary: RunSummary | null;
  reportPath: string | null;
  plan?: DryRunPlan;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const UNTIL_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** "HH:MM" → the NEXT occurrence (today if still ahead, else tomorrow). */
export function parseUntil(hhmm: string, now: Date): Date | null {
  const m = UNTIL_RE.exec(hhmm.trim());
  if (!m) return null;
  const target = new Date(now.getTime());
  target.setHours(Number.parseInt(m[1], 10), Number.parseInt(m[2], 10), 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target;
}

/**
 * Interruptible sleep — resolves after `ms` OR immediately when the signal
 * aborts (so a SIGTERM during a 4-minute backoff or a CI poll wakes the
 * loop at once instead of blocking the drain). Exported for direct tests
 * of the abort-listener wiring (review finding LOW-9).
 */
export function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function emptyTokens(): TokenTotals {
  return { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, estimated: false };
}

function addTokens(into: TokenTotals, t: WorkerTokens): void {
  into.input += t.input;
  into.output += t.output;
  into.cacheCreation += t.cacheCreation;
  into.cacheRead += t.cacheRead;
  if (t.estimated) into.estimated = true;
}

/** The budget counter (debug-494590): NEW tokens processed — uncached input
 *  + output + cache-creation. Cache READS are excluded: they re-bill the
 *  same context on every turn (a trivial one-turn session reads ~17k), so
 *  counting them makes the number turn-count-dominated and would trip the
 *  2M/item default mid-first-iteration on every honest item. They are still
 *  accounted and rendered in the morning report. */
function tokensTotal(t: TokenTotals): number {
  return t.input + t.output + t.cacheCreation;
}

// ---------------------------------------------------------------------------
// Item pick (reconcile as the picker)
// ---------------------------------------------------------------------------

interface PickedItem {
  hash: string;
  type: string;
  path: string;
  title: string;
}

function readFileOr(
  path: string,
  fallback: string,
  warn?: (msg: string) => void,
): string {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    // EC-LOW-10: ENOENT is the expected "no such backlog" case; anything
    // else (EACCES, EISDIR, EIO) must not silently masquerade as an empty
    // backlog — a 20-item DEV.md behind a permission error would otherwise
    // read as "nothing to do".
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && warn) {
      warn(`${path} unreadable (${code ?? "unknown"}) — treated as empty`);
    }
    return fallback;
  }
}

/**
 * Pick the next claimable item: DEBUG.md rows first (dispatcher rows 7 < 8),
 * then DEV.md, filtered by `--only`, minus `excluded` (already attempted /
 * claim-failed this run). Masking rather than removal: an excluded READY row
 * is rewritten to status "blocked" so it can't be picked but still blocks
 * its dependents (removal would flip dependents' blockers to "unknown" —
 * same conservative posture, but masking keeps the semantics explicit).
 */
export function pickNextItem(
  repoRoot: string,
  opts: {
    only?: string;
    excluded: ReadonlySet<string>;
    model: string;
    now: () => Date;
    /** Non-ENOENT backlog read failures are surfaced here (EC-LOW-10). */
    warn?: (msg: string) => void;
  },
): PickedItem | null {
  const snapshot = parseBacklogSnapshot({
    devMd: readFileOr(join(repoRoot, "DEV.md"), "", opts.warn),
    interviewMd: readFileOr(join(repoRoot, "INTERVIEW.md"), "", opts.warn),
    manualMd: readFileOr(join(repoRoot, "MANUAL.md"), "", opts.warn),
  });
  const debugRows = parseDevMd(readFileOr(join(repoRoot, "DEBUG.md"), "", opts.warn));
  // Debug-first matches the dispatcher's row order (7 before 8). Under
  // `--only dev` the dev rows go first instead: reconcile's devByHash is
  // first-write-wins, so a hash pathologically duplicated across both
  // backlogs would otherwise be shadowed by its masked DEBUG copy and
  // become unpickable for the whole run (EC-LOW-11).
  const ordered: DevRow[] =
    opts.only === "dev"
      ? [...snapshot.dev, ...debugRows]
      : [...debugRows, ...snapshot.dev];
  const combined: DevRow[] = ordered.map((row) => {
    if (
      row.status === "ready" &&
      (opts.excluded.has(row.hash) ||
        (opts.only !== undefined && row.type !== opts.only))
    ) {
      return { ...row, status: "blocked" as const };
    }
    return row;
  });
  const recon = reconcile(
    { generation: 0, roster: [] },
    { ...snapshot, dev: combined },
    { defaultModel: opts.model, now: opts.now },
  );
  const candidate = recon.desiredSpawns[0];
  if (!candidate) return null;
  const row = combined.find((r) => r.hash === candidate.spec_hash);
  if (!row) return null;
  return {
    hash: row.hash,
    type: row.type,
    path: row.path,
    title: row.title,
  };
}

// ---------------------------------------------------------------------------
// The driver
// ---------------------------------------------------------------------------

export async function runLoop(opts: RunLoopOpts): Promise<RunLoopResult> {
  const repoRoot = opts.repoRoot;
  const cacheDir = opts.cacheDir ?? join(repoRoot, ".devx-cache");
  const now = opts.now ?? (() => new Date());
  const out = opts.out ?? ((line: string) => process.stdout.write(line + "\n"));
  const exec = opts.exec ?? realExec;
  const sleep = opts.sleep ?? defaultSleep;
  const signal = opts.signal;
  const flags = opts.flags ?? {};

  const merged = opts.merged !== undefined ? opts.merged : safeLoadMerged();
  const gate = loopModeGate(merged);
  if (!gate.allowed) {
    out(`devx loop: refused — ${gate.reason}`);
    return {
      exitCode: 3,
      refusedReason: gate.reason ?? "mode refused",
      summary: null,
      reportPath: null,
    };
  }
  const mode = gate.mode;

  // Budgets: flags override DOWNWARD only (a flag can tighten the config's
  // night budget, never exceed it — the config is the owner's standing
  // consent; a typo'd flag must not 10x it).
  const cfg = loopConfigFrom(merged);
  if (flags.maxItems !== undefined && (!Number.isFinite(flags.maxItems) || flags.maxItems < 1)) {
    out("devx loop: --max-items must be a positive integer");
    return { exitCode: 4, refusedReason: "bad --max-items", summary: null, reportPath: null };
  }
  if (flags.maxTokens !== undefined && (!Number.isFinite(flags.maxTokens) || flags.maxTokens < 1)) {
    out("devx loop: --max-tokens must be a positive integer");
    return { exitCode: 4, refusedReason: "bad --max-tokens", summary: null, reportPath: null };
  }
  if (flags.only !== undefined && flags.only !== "dev" && flags.only !== "debug") {
    out(`devx loop: --only must be 'dev' or 'debug' (got '${flags.only}')`);
    return { exitCode: 4, refusedReason: "bad --only", summary: null, reportPath: null };
  }
  let untilDeadline: Date | null = null;
  if (flags.until !== undefined) {
    untilDeadline = parseUntil(flags.until, now());
    if (untilDeadline === null) {
      out(`devx loop: --until must be HH:MM (got '${flags.until}')`);
      return { exitCode: 4, refusedReason: "bad --until", summary: null, reportPath: null };
    }
  }
  const maxItems =
    flags.maxItems !== undefined ? Math.min(Math.floor(flags.maxItems), cfg.maxItems) : cfg.maxItems;
  const maxTotalTokens =
    flags.maxTokens !== undefined
      ? Math.min(Math.floor(flags.maxTokens), cfg.maxTotalTokens)
      : cfg.maxTotalTokens;

  const budgets: RunSummary["budgets"] = {
    maxItems,
    maxTotalTokens,
    maxIterationsPerItem: cfg.maxIterationsPerItem,
    maxTokensPerItem: cfg.maxTokensPerItem,
    until: untilDeadline !== null ? untilDeadline.toISOString() : null,
  };
  const model = devModelFrom(merged);

  // ── Dry run: full plan, zero side effects ───────────────────────────────
  if (flags.dryRun === true) {
    const excluded = new Set<string>();
    const items: DryRunPlan["items"] = [];
    while (items.length < maxItems) {
      const pick = pickNextItem(repoRoot, { ...(flags.only !== undefined ? { only: flags.only } : {}), excluded, model, now });
      if (!pick) break;
      items.push({ hash: pick.hash, type: pick.type, title: pick.title, path: pick.path });
      excluded.add(pick.hash);
    }
    const plan: DryRunPlan = { mode, budgets, items };
    out(`devx loop --dry-run (mode ${mode})`);
    out(
      `budgets: ${maxItems} items · ${cfg.maxIterationsPerItem} iterations/item · ` +
        `${cfg.maxTokensPerItem.toLocaleString("en-US")} tokens/item · ` +
        `${maxTotalTokens.toLocaleString("en-US")} total tokens` +
        (budgets.until !== null ? ` · until ${budgets.until}` : ""),
    );
    if (items.length === 0) {
      out("would claim: nothing (no eligible ready items)");
    } else {
      out("would claim, in order:");
      for (const item of items) out(`  - ${item.hash} (${item.type}) — ${item.title || item.path}`);
    }
    out("no locks taken, no state written, nothing spawned.");
    return { exitCode: 0, summary: null, reportPath: null, plan };
  }

  // ── Lock + run state ────────────────────────────────────────────────────
  let lock: LockHandle;
  try {
    lock = (opts.acquireLock ?? (() => acquireManagerLock(cacheDir)))();
  } catch (e) {
    if (e instanceof ManagerLockHeldError) {
      out(`devx loop: ${e.message} (a manager or another loop is already running)`);
      return { exitCode: 1, refusedReason: e.message, summary: null, reportPath: null };
    }
    throw e;
  }

  recoverStaleLoopState(cacheDir, opts.pidAlive, now);
  const startedAt = now();
  const runId = newRunId(startedAt, process.pid);
  const sessionId = opts.sessionId ?? runId;
  const worker = opts.worker ?? makeClaudeWorker();
  const tailFn = opts.tail ?? defaultTail;
  const claimFn =
    opts.claim ??
    ((hash: string, type: string) =>
      claimSpec(hash, {
        sessionId,
        repoRoot,
        config: (merged ?? {}) as DeriveBranchConfig & { git?: { default_branch?: string } },
        now,
        // BH-MED-4: claimSpec's own git calls (add/commit/push/worktree)
        // don't inject GIT_TERMINAL_PROMPT — wrap the seam so the claim's
        // push can never hang on a credential TTY prompt overnight.
        exec: (cmd, args, o) =>
          exec(cmd, args, { ...(o ?? {}), env: { GIT_TERMINAL_PROMPT: "0" } }),
        type,
      }));

  const writeState = (status: LoopState["status"], abortReason?: string): void => {
    const state: LoopState = {
      status,
      pid: process.pid,
      ts: now().toISOString(),
      run_id: runId,
      started_at: startedAt.toISOString(),
      ...(abortReason !== undefined ? { abort_reason: abortReason } : {}),
    };
    try {
      writeLoopState(cacheDir, state);
    } catch {
      // never let a state write kill the loop
    }
  };
  const event = (name: string, fields: Record<string, unknown> = {}): void => {
    appendEvent(cacheDir, runId, name, fields, now);
  };

  writeState("running");
  event("loop:start", { mode, budgets, pid: process.pid });
  // Heartbeat cadence derives from manager.heartbeat_interval_s — the same
  // knob `devx next` uses for its freshness window (interval × 3), so a
  // config edit can't put the writer's cadence outside the reader's window
  // and flap a live loop between running/dead (review finding LOW-15).
  const hbInterval = setInterval(
    () => writeState("running"),
    opts.heartbeatIntervalMs ?? heartbeatIntervalMsFrom(merged),
  );
  hbInterval.unref?.();

  // ── The run ─────────────────────────────────────────────────────────────
  const items: ItemResult[] = [];
  const totals = emptyTokens();
  let ladder: LadderState = emptyLadderState();
  let abortReason: string | null = null;
  let stopReason: string | null = null;
  const excluded = new Set<string>();
  const isAttempted = (r: ItemResult): boolean => r.outcome !== "claim-failed";
  // Review finding MED-7: without a bound, a SYSTEMIC claim failure (locks
  // dir unwritable, origin push refused, git broken) walks the entire
  // backlog doing a full commit+rollback cycle per row. Three in a row is
  // systemic — stop and report.
  const MAX_CONSECUTIVE_CLAIM_FAILURES = 3;
  let consecutiveClaimFailures = 0;

  const outerStop = (): string | null => {
    if (signal?.aborted) return "stopped by signal";
    if (items.filter(isAttempted).length >= maxItems) return `max items reached (${maxItems})`;
    if (untilDeadline !== null && now().getTime() >= untilDeadline.getTime()) {
      return `--until deadline reached (${flags.until})`;
    }
    if (tokensTotal(totals) >= maxTotalTokens) {
      return `total token budget exhausted (${tokensTotal(totals)}/${maxTotalTokens})`;
    }
    return null;
  };

  try {
    while (true) {
      const stop = outerStop();
      if (stop !== null) {
        stopReason = stop;
        break;
      }
      const pick = pickNextItem(repoRoot, {
        ...(flags.only !== undefined ? { only: flags.only } : {}),
        excluded,
        model,
        now,
        warn: (msg) => {
          event("backlog:read-warning", { msg });
          out(`loop: WARN — ${msg}`);
        },
      });
      if (!pick) {
        stopReason = "no eligible backlog items remain";
        break;
      }
      excluded.add(pick.hash);
      event("item:pick", { hash: pick.hash, type: pick.type, path: pick.path });

      // Claim (dvx101 atomic claim; its own rollback on failure).
      let claim: ClaimSpecResult;
      try {
        claim = await claimFn(pick.hash, pick.type);
      } catch (e) {
        const detail =
          e instanceof LockHeldError
            ? `spec lock already held (${e.lockPath})`
            : e instanceof ClaimError
              ? e.message
              : errorChainText(e);
        event("item:claim-failed", { hash: pick.hash, error: serializeError(e) });
        out(`loop: claim failed for ${pick.hash} — skipping (${detail})`);
        items.push({
          hash: pick.hash,
          type: pick.type,
          title: pick.title,
          specPath: pick.path,
          outcome: "claim-failed",
          iterationsGood: 0,
          iterationsFailed: 0,
          tokens: emptyTokens(),
          detail,
        });
        consecutiveClaimFailures++;
        if (consecutiveClaimFailures >= MAX_CONSECUTIVE_CLAIM_FAILURES) {
          stopReason = `${consecutiveClaimFailures} consecutive claim failures — systemic claim problem, stopping the loop (last: ${detail})`;
          break;
        }
        continue;
      }
      consecutiveClaimFailures = 0;
      event("item:claimed", { hash: pick.hash, branch: claim.branch, claimSha: claim.claimSha });
      out(`loop: claimed ${pick.hash} on ${claim.branch}`);

      const worktree = join(repoRoot, ".worktrees", `${pick.type}-${pick.hash}`);
      let result: RunItemResult;
      try {
        result = await runItem({
          pick,
          claim,
          worktree,
          repoRoot,
          cacheDir,
          runId,
          cfg,
          merged,
          mode,
          sessionId,
          exec,
          worker,
          tailFn,
          sleep,
          signal,
          now,
          out,
          event,
          ladder,
          totals,
          maxTotalTokens,
          untilDeadline,
          ciPollMs: opts.ciPollMs,
          ciTimeoutMs: opts.ciTimeoutMs,
        });
      } catch (e) {
        // BH-LOW-10: an unexpected throw out of runItem must not vanish the
        // in-flight item from the morning report — its claim + worktree are
        // still live and the human needs the pointer.
        items.push({
          hash: pick.hash,
          type: pick.type,
          title: pick.title,
          specPath: pick.path,
          outcome: "in-progress-at-exit",
          iterationsGood: 0,
          iterationsFailed: 0,
          tokens: emptyTokens(),
          worktreePath: relToRepo(worktree, repoRoot),
          detail: `driver error mid-item: ${errorChainText(e)}`,
        });
        throw e;
      }
      items.push(result.item);
      if (result.loopAbort !== null) {
        abortReason = result.loopAbort;
        break;
      }
      // The systemic rail (review findings MED-4 + MED-6):
      //   - abandoned WITHOUT any committed progress   → streak +1
      //   - abandoned WITH ≥1 good committed iteration → streak unchanged
      //     (the pipeline demonstrably works; the item was just big)
      //   - handed-off-failure (gh/CI outage shape)    → streak +1 — a dead
      //     gh must trip the 3-stop instead of stranding maxItems claims
      //   - merged / handed-off-ok                     → streak reset
      if (result.item.outcome === "abandoned" || result.handoffKind === "handed-off-failure") {
        ladder =
          result.item.outcome === "abandoned"
            ? afterItemAbandoned(ladder, { madeProgress: result.item.iterationsGood >= 1 })
            : afterItemAbandoned(ladder, { madeProgress: false });
        if (shouldStopAfterAbandonment(ladder)) {
          abortReason = `${ladder.consecutiveAbandonedItems} consecutive items abandoned or handed off failing — systemic problem, stopping the loop`;
          break;
        }
      } else if (
        result.item.outcome === "merged" ||
        result.item.outcome === "handed-off"
      ) {
        ladder = afterItemCompleted(ladder);
      }
      if (result.item.outcome === "in-progress-at-exit") {
        // The stop condition fired mid-item — the next outerStop() records
        // the reason and exits; nothing else to claim.
        continue;
      }
    }
  } catch (e) {
    abortReason = `unexpected driver error: ${errorChainText(e)}`;
    event("loop:driver-error", { error: serializeError(e) });
  } finally {
    clearInterval(hbInterval);
  }

  // ── Finalize: report ALWAYS, state, lock ───────────────────────────────
  const endedAt = now();
  const summary: RunSummary = {
    runId,
    mode,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    abortReason,
    stopReason: abortReason === null ? stopReason : null,
    budgets,
    items,
    totals,
  };
  let reportPathOut: string | null = null;
  try {
    reportPathOut = writeMorningReport(cacheDir, summary);
  } catch {
    reportPathOut = null;
  }
  event("loop:end", {
    abortReason,
    stopReason,
    items: items.length,
    tokens: totals,
    report: reportPathOut,
  });
  writeState(abortReason !== null ? "aborted" : "stopped", abortReason ?? undefined);
  try {
    lock.release();
  } catch {
    // surfaced by the next acquire's stale sweep if it matters
  }
  if (reportPathOut !== null) out(`loop: morning report written to ${reportPathOut}`);
  if (abortReason !== null) out(`loop: ABORTED — ${abortReason}`);
  else out(`loop: stopped — ${stopReason ?? "done"}`);

  return {
    exitCode: abortReason !== null ? 2 : 0,
    summary,
    reportPath: reportPathOut,
  };
}

// ---------------------------------------------------------------------------
// Per-item inner loop
// ---------------------------------------------------------------------------

interface RunItemArgs {
  pick: PickedItem;
  claim: ClaimSpecResult;
  worktree: string;
  repoRoot: string;
  cacheDir: string;
  runId: string;
  cfg: LoopConfig;
  merged: unknown;
  mode: string;
  /** The run's claim-owner token — abandon/finalize verify the spec lock
   *  still records it before mutating main-worktree state (roc101 posture). */
  sessionId: string;
  exec: Exec;
  worker: WorkerRunFn;
  tailFn: TailFn;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  signal: AbortSignal | undefined;
  now: () => Date;
  out: (line: string) => void;
  event: (name: string, fields?: Record<string, unknown>) => void;
  ladder: LadderState;
  totals: TokenTotals;
  maxTotalTokens: number;
  untilDeadline: Date | null;
  ciPollMs?: number;
  ciTimeoutMs?: number;
}

interface RunItemResult {
  item: ItemResult;
  /** Non-null ⇒ the whole loop must abort now (permanent error). */
  loopAbort: string | null;
  /** Set when the item's outcome is "handed-off" — routes the systemic
   *  rail (review finding MED-6): only handed-off-ok resets the streak;
   *  handed-off-failure (gh/CI outage shape) increments it. */
  handoffKind?: HandOffKind;
}

async function runItem(args: RunItemArgs): Promise<RunItemResult> {
  const {
    pick,
    worktree,
    repoRoot,
    cfg,
    exec,
    worker,
    sleep,
    signal,
    now,
    out,
    event,
  } = args;

  const itemTokens = emptyTokens();
  const prior: PriorAttempt[] = [];
  const changeSummaries: string[] = [];
  let itemState: LadderState = {
    consecutiveFailures: 0,
    consecutiveErrors: 0,
    consecutiveInfraErrors: 0,
    consecutiveAbandonedItems: args.ladder.consecutiveAbandonedItems,
  };
  let iteration = 0;
  let good = 0;
  let failed = 0;
  /** Iterations lost to environment failures — never charged to the item
   *  (dc7514). */
  let infra = 0;
  /** Token spend lost to infra iterations — excluded from the PER-ITEM
   *  budget (the item isn't charged for environment failures) but still in
   *  itemTokens/totals for honest night accounting (MED-8). */
  let infraTokens = 0;
  /** Failure summaries + learnings accumulated across failed iterations —
   *  folded into the main-spec abandon entry when the worktree (and its
   *  per-iteration status log) is discarded, so the next attempt doesn't
   *  start blind (review MED: discard must not erase the breadcrumbs). */
  const failureNotes: string[] = [];
  let pendingRepair: string | null = null;
  let lastFailure: string | null = null;
  /** Loop-owned WARN lines that must reach the morning report (lock-release
   *  failure, main-push failure — review findings LOW-10/LOW-11). */
  const itemWarnings: string[] = [];

  const worktreeSpecPath = join(worktree, pick.path);
  const mainSpecPath = join(repoRoot, pick.path);
  const backlogPath = join(repoRoot, pick.type === "debug" ? "DEBUG.md" : "DEV.md");
  // Deliberately repoRoot-anchored (NOT args.cacheDir): claimSpec hardcodes
  // `<repoRoot>/.devx-cache/locks/spec-<hash>.lock`, and this path must
  // match the claim's creation path or release becomes a no-op. The
  // manager lock + loop state honor cacheDir; the spec lock follows dvx101.
  const lockPath = join(repoRoot, ".devx-cache", "locks", `spec-${pick.hash}.lock`);
  const baseSha = safeHead(exec, worktree);

  /**
   * roc101 posture (AA-F1): before the item-end mutations of main-worktree
   * state (abandon flips, done flips, lock release), verify the spec lock
   * still records THIS run's session. Workers are prompt-framed `claude -p`
   * sessions that never re-claim, so in the normal night this always holds —
   * the check defends against a human (or another agent) legitimately
   * stealing the claim mid-run after manually clearing our lock.
   */
  const ownsClaim = (): boolean => {
    try {
      const owner = parseLockOwner(readFileSync(lockPath, "utf8"));
      if (owner === null) return false;
      return normalizeSessionToken(owner) === normalizeSessionToken(args.sessionId);
    } catch {
      return false; // lock gone = claim no longer ours
    }
  };

  const baseItem = (): Omit<ItemResult, "outcome"> => ({
    hash: pick.hash,
    type: pick.type,
    title: pick.title,
    specPath: pick.path,
    iterationsGood: good,
    iterationsFailed: failed,
    ...(infra > 0 ? { iterationsInfra: infra } : {}),
    tokens: itemTokens,
    // NB: same array reference on purpose — warnings pushed AFTER a
    // snapshot (e.g. during finalizeMerged) still reach the report.
    ...(itemWarnings.length > 0 ? { warnings: itemWarnings } : {}),
    ...(baseSha !== null ? { diff: diffStat(exec, worktree, baseSha) } : {}),
  });

  // Loop-owned status entry on the WORKTREE spec copy + a commit that records
  // it on the feature branch. Best-effort at every layer — the JSONL log is
  // the fallback memory when the spec append itself fails.
  const recordIteration = (
    prefix: EntryPrefix,
    head: string,
    changes: string[],
    learnings: string[],
    commit: boolean,
  ): void => {
    try {
      appendStatusEntryToFile(worktreeSpecPath, {
        iso: now().toISOString(),
        prefix,
        head,
        changes,
        learnings,
      });
    } catch (e) {
      event("iteration:status-append-failed", { error: serializeError(e) });
      return;
    }
    if (!commit) return;
    try {
      // Subject built from the SAME constant isBookkeepingOnlyWorktree
      // matches — rewording one side can't silently break the discard
      // predicate (dc7514 wrap-don't-duplicate).
      commitAll(exec, worktree, `${LOOP_BOOKKEEPING_COMMIT_PREFIX}${iteration} for ${pick.hash}`);
    } catch (e) {
      event("iteration:record-commit-failed", { error: serializeError(e) });
    }
  };

  const appendMainEntry = (
    prefix: EntryPrefix,
    head: string,
    learnings?: string[],
  ): void => {
    try {
      appendStatusEntryToFile(mainSpecPath, {
        iso: now().toISOString(),
        prefix,
        head,
        ...(learnings !== undefined && learnings.length > 0 ? { learnings } : {}),
      });
    } catch (e) {
      event("item:main-status-append-failed", { error: serializeError(e) });
    }
  };

  const commitOnMain = (message: string): void => {
    try {
      // BH-MED-5: pathspec-limit the COMMIT itself. A bare `git commit -m`
      // commits the entire staged index — sweeping any work the user left
      // staged in the main worktree overnight into a loop-authored commit
      // (and, on the merged path, pushing it). With the trailing pathspec,
      // only the loop's two files are committed regardless of index state.
      const r = exec(
        "git",
        [
          "-c",
          "commit.gpgsign=false",
          "-c",
          "tag.gpgsign=false",
          "commit",
          "-m",
          message,
          "--",
          pick.path,
          backlogRel(pick.type),
        ],
        { cwd: repoRoot, env: { GIT_TERMINAL_PROMPT: "0" } },
      );
      if (r.exitCode !== 0) throw new Error(r.stderr.trim() || r.stdout.trim());
    } catch (e) {
      event("item:main-commit-failed", { error: serializeError(e) });
    }
  };

  const releaseSpecLock = (): void => {
    try {
      unlinkSync(lockPath);
    } catch (e) {
      // ENOENT = already gone (fine). Anything else (EACCES, EPERM, …)
      // means the lock file is STILL on disk and every future claim of
      // this spec sees LockHeldError forever — that must not be swallowed
      // silently (review finding LOW-10): event it and put a WARN line
      // with the path in the morning report.
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return;
      event("item:lock-release-failed", { lockPath, error: serializeError(e) });
      itemWarnings.push(
        `spec lock could not be released (${code ?? "unknown"}) — remove ${relToRepo(lockPath, repoRoot)} by hand or the next claim of ${pick.hash} will refuse`,
      );
      out(`loop: WARN — failed to release spec lock ${lockPath}`);
    }
  };

  /**
   * Push main after a loop-owned commit on it (abandon / exit / mark-done
   * paths — review finding LOW-11). Never forces. Failure is tolerated —
   * the commit is local and the morning report gets a "main ahead of
   * origin" WARN so the human knows to push.
   */
  const pushMain = (): void => {
    const push = exec("git", ["push"], {
      cwd: repoRoot,
      env: { GIT_TERMINAL_PROMPT: "0" },
    });
    if (push.exitCode !== 0) {
      event("item:main-push-failed", { stderr: push.stderr.trim() });
      itemWarnings.push(
        `main is ahead of origin — push failed after a loop-owned commit: ${firstLineOf(push.stderr) || "(no stderr)"}`,
      );
    }
  };

  /**
   * Rollback for a failed iteration — extending the commit-failure repair
   * guarantee past a single iteration (review finding MED-2). When a
   * repair iteration itself fails or hard-errors, the tree still holds the
   * PRIOR successful iteration's preserved work; blindly resetting would
   * discard it. So while pendingRepair is set, re-attempt the commit ONCE
   * (the original failure may have been transient — a stale index.lock, a
   * hook flake): if it lands, the preserved work is safe on the branch and
   * nothing is reset. Only when the re-attempt also fails do we reset —
   * and then the discarded-diff stat is recorded for the [FAIL]/[ERROR]
   * entry. Clears pendingRepair on every path (BH-HIGH-1 posture).
   *
   * Returns a note for the status-log entry, or null. Throws only when the
   * reset itself fails (caller abandons the item).
   */
  const rollbackIteration = (): string | null => {
    if (pendingRepair === null) {
      resetHard(exec, worktree);
      return null;
    }
    try {
      const res = commitAll(
        exec,
        worktree,
        `${pick.type === "debug" ? "fix" : "feat"}(${pick.hash}): salvage work preserved across a commit failure\n\nloop iteration ${iteration}; spec ${pick.path}`,
      );
      pendingRepair = null;
      if (res.committed) {
        event("iteration:repair-salvage-committed", { iteration, head: res.head });
        return "prior iteration's preserved work committed via salvage re-attempt (original commit failure was transient)";
      }
      // Nothing to commit — the tree held no preserved work after all.
      resetHard(exec, worktree);
      return null;
    } catch (e) {
      event("iteration:repair-salvage-failed", { iteration, error: serializeError(e) });
      const discarded = uncommittedDiffNote(exec, worktree);
      resetHard(exec, worktree);
      pendingRepair = null;
      return discarded !== null
        ? `salvage re-attempt also failed; discarded preserved work: ${discarded}`
        : "salvage re-attempt also failed; preserved work discarded";
    }
  };

  /** Bound accumulator for failure breadcrumbs (newest kept). 12 entries is
   *  ample for the 8-iteration default budget while keeping the eventual
   *  status-log entry readable. */
  const pushFailureNote = (note: string, learnings?: string[]): void => {
    failureNotes.push(note);
    for (const l of learnings ?? []) failureNotes.push(`learning: ${l}`);
    if (failureNotes.length > 12) failureNotes.splice(0, failureNotes.length - 12);
  };

  /** Set the backlog row's checkbox AND its `Status:` prose in one edit —
   *  the dc7514 incident left `[-]` + "Status: in-progress" drift because
   *  the old path flipped only the checkbox. */
  const setBacklogRow = (
    checkbox: " " | "/" | "-",
    statusText: "ready" | "in-progress" | "blocked",
  ): void => {
    try {
      const content = readFileSync(backlogPath, "utf8");
      const next = setBacklogRowState(content, pick.hash, pick.type, checkbox, statusText);
      if (next === null) {
        // No row for this hash — the exact drift class this flip exists to
        // kill must not recur silently (EC-MED-9).
        event("item:backlog-row-missing", { hash: pick.hash, backlog: backlogRel(pick.type) });
        itemWarnings.push(
          `no ${backlogRel(pick.type)} row found for ${pick.hash} — backlog not flipped to [${checkbox}] ${statusText}; reconcile by hand`,
        );
        return;
      }
      if (next !== content) writeAtomic(backlogPath, next);
    } catch (e) {
      event("item:backlog-row-flip-failed", { error: serializeError(e) });
    }
  };

  /** Discard a bookkeeping-only worktree + its local branch (the claim never
   *  pushed the feature branch; iteration commits are local). Returns true
   *  only when the worktree is actually gone — callers fall back to the
   *  preserve path on failure. */
  const discardWorktree = (): boolean => {
    try {
      const r = exec("git", ["worktree", "remove", "--force", worktree], {
        cwd: repoRoot,
        env: { GIT_TERMINAL_PROMPT: "0" },
      });
      if (r.exitCode !== 0) {
        event("item:worktree-discard-failed", { stderr: r.stderr.trim() });
        return false;
      }
    } catch (e) {
      event("item:worktree-discard-failed", { error: serializeError(e) });
      return false;
    }
    const b = exec("git", ["branch", "-D", args.claim.branch], {
      cwd: repoRoot,
      env: { GIT_TERMINAL_PROMPT: "0" },
    });
    if (b.exitCode !== 0 && !/not found/i.test(b.stderr)) {
      // The worktree is already gone (can't fall back to preserving it) but
      // a stale local branch makes the NEXT claim's `worktree add -b` fail —
      // that must reach the morning report, not just the JSONL (EC-HIGH-3).
      event("item:branch-delete-failed", { stderr: b.stderr.trim() });
      itemWarnings.push(
        `stale local branch ${args.claim.branch} could not be deleted — \`git branch -D ${args.claim.branch}\` by hand or the next claim of ${pick.hash} will fail`,
      );
    }
    return true;
  };

  /** Roll the claim's main-worktree state back to ready: spec `status:
   *  ready`, dead `owner:` cleared, backlog row `[ ]` + `Status: ready`. */
  const rollClaimBackToReady = (): void => {
    try {
      if (!setSpecStatus(mainSpecPath, "ready")) {
        event("item:ready-status-flip-noop", { spec: pick.path });
      }
    } catch (e) {
      event("item:ready-status-flip-failed", { error: serializeError(e) });
    }
    try {
      clearSpecOwner(mainSpecPath);
    } catch (e) {
      event("item:owner-clear-failed", { error: serializeError(e) });
    }
    setBacklogRow(" ", "ready");
  };

  const abandonItem = (reason: string): RunItemResult => {
    event("item:abandon", { hash: pick.hash, reason, worktree });
    if (!ownsClaim()) {
      // Someone took (or cleared) the claim mid-run — do NOT mutate spec /
      // backlog / lock state we no longer own; preserve the worktree and
      // surface it (roc101: halt without touching a peer's claim).
      event("item:abandon-ownership-lost", { hash: pick.hash });
      out(`loop: claim for ${pick.hash} is no longer this run's — leaving backlog state untouched`);
      return {
        item: {
          ...baseItem(),
          outcome: "abandoned",
          worktreePath: relToRepo(worktree, repoRoot),
          ...(lastFailure !== null ? { lastFailure } : {}),
          detail: `${reason}; claim ownership lost mid-run — spec/backlog left untouched`,
        },
        loopAbort: null,
      };
    }
    // dc7514 abandon hygiene: when the worktree preserves NOTHING beyond the
    // loop's own bookkeeping commits, parking the item as `[-]` blocked
    // behind a forensics chore is pure drag — discard the worktree and flip
    // the item back to ready (the failure stays recorded in the status log).
    // Snapshot before the discard (BH-MED-6 posture: diffStat needs the
    // worktree alive).
    const snapshot = baseItem();
    const bookkeepingOnly =
      baseSha !== null && isBookkeepingOnlyWorktree(exec, worktree, baseSha);
    if (bookkeepingOnly && discardWorktree()) {
      // The discarded worktree held the per-iteration [FAIL]/learning
      // entries — fold them into the main-spec entry so the next attempt
      // doesn't start blind.
      appendMainEntry(
        "[FAIL]",
        `loop abandoned ${pick.hash}: ${reason}; no real work was preserved — bookkeeping-only worktree discarded, item left ready`,
        failureNotes,
      );
      rollClaimBackToReady();
      releaseSpecLock();
      commitOnMain(`chore(loop): abandon ${pick.hash} (${reason}; nothing preserved — left ready)`);
      pushMain();
      out(`loop: abandoned ${pick.hash} — ${reason}; nothing preserved, item left ready`);
      return {
        item: {
          ...snapshot,
          ...(itemWarnings.length > 0 ? { warnings: itemWarnings } : {}),
          outcome: "abandoned",
          leftState: "ready",
          ...(lastFailure !== null ? { lastFailure } : {}),
          detail: reason,
        },
        loopAbort: null,
      };
    }
    appendMainEntry(
      "[FAIL]",
      `loop abandoned ${pick.hash}: ${reason}; worktree preserved at ${relToRepo(worktree, repoRoot)}`,
    );
    try {
      if (!setSpecStatus(mainSpecPath, "blocked")) {
        event("item:abandon-status-flip-noop", { spec: pick.path });
      }
    } catch (e) {
      event("item:abandon-status-flip-failed", { error: serializeError(e) });
    }
    setBacklogRow("-", "blocked");
    releaseSpecLock();
    commitOnMain(`chore(loop): abandon ${pick.hash} (${reason})`);
    pushMain();
    out(`loop: abandoned ${pick.hash} — ${reason}; worktree preserved at ${worktree}`);
    return {
      item: {
        ...baseItem(),
        outcome: "abandoned",
        leftState: "blocked",
        worktreePath: relToRepo(worktree, repoRoot),
        ...(lastFailure !== null ? { lastFailure } : {}),
        detail: reason,
      },
      loopAbort: null,
    };
  };

  /**
   * dc7514 abandon-the-run: N consecutive infra-errors mean the ENVIRONMENT
   * is broken, not the item — roll the claim back to ready (the next healthy
   * run re-attempts it with a fresh failure budget) and let the caller abort
   * the run. Only a fully-discarded bookkeeping-only worktree flips to
   * ready; real preserved work keeps the claim intact (stopped-mid-item
   * shape) because a ready row with a surviving worktree/branch wedges the
   * next claim (EC-HIGH-2).
   */
  const releaseItemToReady = (reason: string): RunItemResult => {
    event("item:released-environment", { hash: pick.hash, reason, worktree });
    if (!ownsClaim()) {
      event("item:release-ownership-lost", { hash: pick.hash });
      out(`loop: claim for ${pick.hash} is no longer this run's — leaving backlog state untouched`);
      return {
        item: {
          ...baseItem(),
          outcome: "released",
          worktreePath: relToRepo(worktree, repoRoot),
          detail: `${reason}; claim ownership lost mid-run — spec/backlog left untouched`,
        },
        loopAbort: null,
      };
    }
    const snapshot = baseItem();
    const bookkeepingOnly =
      baseSha !== null && isBookkeepingOnlyWorktree(exec, worktree, baseSha);
    const discarded = bookkeepingOnly && discardWorktree();
    if (!discarded) {
      // Real preserved work (or a failed discard): flipping the row to
      // ready while the worktree + branch survive would make the NEXT
      // run's claim half-execute and wedge (`worktree add -b` fails on the
      // existing path/branch — review EC-HIGH-2). Keep the claim intact
      // instead: the honest, resumable stopped-mid-item shape.
      appendMainEntry(
        "",
        `loop aborted mid-item (${reason}); worktree + claim preserved at ${relToRepo(worktree, repoRoot)}`,
      );
      commitOnMain(`chore(loop): ${pick.hash} in progress at loop exit (environment failure)`);
      pushMain();
      out(`loop: ${pick.hash} left in progress — ${reason}; worktree + claim preserved`);
      return {
        item: {
          ...snapshot,
          ...(itemWarnings.length > 0 ? { warnings: itemWarnings } : {}),
          outcome: "in-progress-at-exit",
          worktreePath: relToRepo(worktree, repoRoot),
          detail: reason,
        },
        loopAbort: null,
      };
    }
    appendMainEntry(
      "",
      `loop released ${pick.hash} back to ready: ${reason}; no real work was lost (bookkeeping-only worktree discarded)`,
      failureNotes,
    );
    rollClaimBackToReady();
    releaseSpecLock();
    commitOnMain(`chore(loop): release ${pick.hash} back to ready (environment failure — item not at fault)`);
    pushMain();
    out(`loop: released ${pick.hash} back to ready — ${reason}`);
    return {
      item: {
        ...snapshot,
        ...(itemWarnings.length > 0 ? { warnings: itemWarnings } : {}),
        outcome: "released",
        leftState: "ready",
        detail: reason,
      },
      loopAbort: null,
    };
  };

  const exitInProgress = (why: string): RunItemResult => {
    event("item:in-progress-at-exit", { hash: pick.hash, why, worktree });
    // Same roc101 ownership posture as abandonItem (review finding LOW-11):
    // if the claim was taken over / cleared mid-run, the main-worktree spec
    // is no longer ours to write.
    if (!ownsClaim()) {
      event("item:exit-ownership-lost", { hash: pick.hash });
      out(`loop: claim for ${pick.hash} is no longer this run's — leaving main spec untouched at exit`);
      return {
        item: {
          ...baseItem(),
          outcome: "in-progress-at-exit",
          worktreePath: relToRepo(worktree, repoRoot),
          ...(lastFailure !== null ? { lastFailure } : {}),
          detail: `${why}; claim ownership lost mid-run — main spec left untouched`,
        },
        loopAbort: null,
      };
    }
    appendMainEntry("", `loop stopped mid-item (${why}); worktree + claim preserved`);
    // Commit + push the appended entry: an uncommitted main-worktree edit
    // left overnight is exactly the kind of surprise dirt the loop must
    // not leave behind (review finding LOW-11).
    commitOnMain(`chore(loop): ${pick.hash} in progress at loop exit (${why})`);
    pushMain();
    return {
      item: {
        ...baseItem(),
        outcome: "in-progress-at-exit",
        worktreePath: relToRepo(worktree, repoRoot),
        ...(lastFailure !== null ? { lastFailure } : {}),
        detail: why,
      },
      loopAbort: null,
    };
  };

  while (true) {
    // ── Pre-iteration budget + stop checks ─────────────────────────────
    if (signal?.aborted) return exitInProgress("stopped by signal");
    if (args.untilDeadline !== null && now().getTime() >= args.untilDeadline.getTime()) {
      return exitInProgress("--until deadline reached");
    }
    if (tokensTotal(args.totals) >= args.maxTotalTokens) {
      return exitInProgress("total token budget exhausted");
    }
    // Budget rungs charge only ATTRIBUTABLE iterations/spend — infra
    // iterations are environment losses and must not exhaust an innocent
    // item's budgets into an abandon (dc7514; the pure-infra case is
    // bounded by the 3-consecutive-infra run abort instead).
    if (good + failed >= cfg.maxIterationsPerItem) {
      return abandonItem(
        `iteration budget exhausted (${cfg.maxIterationsPerItem} iterations without acs_met)`,
      );
    }
    if (tokensTotal(itemTokens) - infraTokens >= cfg.maxTokensPerItem) {
      return abandonItem(
        `per-item token budget exhausted (${tokensTotal(itemTokens) - infraTokens}/${cfg.maxTokensPerItem})`,
      );
    }
    iteration++;

    // ── Pre-flight: clean tree required (unless this is a repair pass) ──
    if (pendingRepair === null) {
      try {
        if (hasUncommittedChanges(exec, worktree)) {
          resetHard(exec, worktree);
          event("iteration:preflight-reset", { iteration });
        }
      } catch (e) {
        return abandonItem(`git pre-flight failed: ${errorChainText(e)}`);
      }
    }
    event("iteration:start", {
      iteration,
      git: statusSnapshot(exec, worktree, baseSha ?? undefined),
      repair: pendingRepair !== null,
    });

    // ── Prompt + worker (fresh session per iteration) ───────────────────
    const basePrompt = buildIterationPrompt({
      hash: pick.hash,
      specRelPath: pick.path,
      iteration,
      maxIterations: cfg.maxIterationsPerItem,
      priorAttempts: prior,
    });
    const prompt =
      pendingRepair !== null
        ? buildCommitRepairPrompt(basePrompt, pendingRepair)
        : basePrompt;

    let raw = "";
    let workerError: Error | null = null;
    let report: IterationReport | null = null;
    /** The PRIMARY worker call rejected (timeout kill / spawn failure).
     *  Deliberately narrow (review MED): a retry-session death (the primary
     *  demonstrably RAN) and post-processing throws are hard-errors, never
     *  infra. */
    let workerDied = false;
    let dieOutputTokens = 0;
    let sleepGapMs = 0;
    const tokensBeforeIteration = tokensTotal(itemTokens);
    try {
      let r: Awaited<ReturnType<typeof worker>>;
      try {
        r = await worker(prompt, { cwd: worktree, ...(signal !== undefined ? { signal } : {}) });
      } catch (e) {
        workerDied = true;
        throw e;
      }
      raw = r.rawOutput;
      addTokens(itemTokens, r.tokens);
      addTokens(args.totals, r.tokens);
      sleepGapMs += r.sleepGapMs ?? 0;
      if (r.graceKilled) event("iteration:grace-killed", { iteration });
      const parsed = extractReportJson(raw);
      const validated = parsed !== null ? validateIterationReport(parsed) : null;
      if (validated !== null && validated.ok) {
        report = validated.report;
      } else if (signal?.aborted) {
        // Review finding LOW-13: the abort check is hoisted ABOVE the
        // report-retry spawn — never start a second worker session against
        // a run that's already draining. The post-block abort handling
        // rolls back and exits as stopped-mid-item.
        workerError = new Error("aborted before the report retry");
      } else {
        // Retry protocol: one cheap re-ask for JUST the JSON. The retry is
        // NEVER preempted by permanent-error marker sniffing (review
        // finding MED-3): marker text mid-transcript is routinely the
        // worked-on code itself (an iteration editing ladder.ts echoes
        // "credit balance is too low"), and a recoverable report must win
        // over a marker guess. One cheap spawn against a genuinely dead
        // API fails fast and costs nothing.
        const errors =
          validated !== null && !validated.ok
            ? validated.errors
            : [{ code: "no-json-found" as const, message: "no JSON object found in the output" }];
        event("iteration:report-retry", { iteration, errors });
        const retry = await worker(buildReportRetryPrompt(raw, errors), {
          cwd: worktree,
          ...(signal !== undefined ? { signal } : {}),
        });
        addTokens(itemTokens, retry.tokens);
        addTokens(args.totals, retry.tokens);
        sleepGapMs += retry.sleepGapMs ?? 0;
        const reparsed = extractReportJson(retry.rawOutput);
        const revalidated = reparsed !== null ? validateIterationReport(reparsed) : null;
        if (revalidated !== null && revalidated.ok) {
          report = revalidated.report;
        } else {
          // Permanent-error classification applies only NOW — after the
          // retry also failed — and only against the transcript TAIL:
          // real credit/auth exhaustion is the last thing a dying session
          // prints. Corroboration ("report absent") is structural in this
          // branch: both attempts produced no parseable report.
          const marker =
            firstPermanentErrorMatchInTail(retry.rawOutput) ??
            firstPermanentErrorMatchInTail(raw);
          const exitNote =
            r.exitCode !== null && r.exitCode !== 0
              ? `; worker exited ${r.exitCode}: ${tailOf(raw, 300)}`
              : "";
          workerError =
            marker !== null
              ? new Error(`worker output matches a permanent-error marker: ${marker}`)
              : new Error(
                  `worker report unparseable after retry (${errors.map((e) => e.message).join("; ")})${exitNote}`,
                );
        }
      }
    } catch (e) {
      workerError = e instanceof Error ? e : new Error(String(e));
      // Review finding MED-8: a timed-out worker consumed real API budget
      // before the kill — fold its estimated spend into the accounting so
      // N timeouts can't silently blow past the token budgets.
      if (e instanceof WorkerTimeoutError) {
        addTokens(itemTokens, e.tokens);
        addTokens(args.totals, e.tokens);
        if (workerDied) {
          // Only the PRIMARY session's death signals feed the infra
          // classification — a retry timeout's gap/output must not excuse
          // an iteration whose primary session demonstrably ran (EC-MED-6).
          dieOutputTokens = e.tokens.output;
          sleepGapMs += e.sleepGapMs;
        }
      }
    }
    if (signal?.aborted && report === null) {
      // The abort tore the worker down mid-flight — don't count it as a
      // failure; roll back (salvaging any commit-failure-preserved work
      // first, review finding MED-2) and exit as stopped-mid-item.
      try {
        rollbackIteration();
      } catch {
        // preserved dirty tree is the pre-flight's problem on resume
      }
      return exitInProgress("stopped by signal");
    }

    // ── Classify + transactional outcome ───────────────────────────────
    let filesChanged = false;
    try {
      filesChanged = hasUncommittedChanges(exec, worktree);
    } catch (e) {
      workerError = workerError ?? new Error(`git status failed: ${errorChainText(e)}`);
    }
    let cls: IterationClass = classifyIteration({
      ...(report !== null
        ? { report: { success: report.success, key_learnings: report.key_learnings } }
        : {}),
      ...(workerError !== null ? { error: { message: errorChainText(workerError) } } : {}),
      ...(workerDied
        ? { infra: { workerDied: true, outputTokens: dieOutputTokens, sleepGapMs } }
        : {}),
      filesChanged,
    });

    let commitFailureDetail: string | null = null;
    if (cls === "success" && report !== null) {
      // Loop-owned commit: status entry first so it rides the same commit.
      recordIteration("", `loop iteration ${iteration}: ${report.summary}`, report.key_changes_made, report.key_learnings, false);
      try {
        commitAll(
          exec,
          worktree,
          `${pick.type === "debug" ? "fix" : "feat"}(${pick.hash}): ${report.summary}\n\nloop iteration ${iteration}; spec ${pick.path}`,
        );
        pendingRepair = null;
      } catch (e) {
        if (e instanceof CommitFailedError) {
          commitFailureDetail = e.detail;
          cls = classifyIteration({
            report: { success: report.success, key_learnings: report.key_learnings },
            filesChanged,
            commitFailed: true,
          });
        } else {
          workerError = e instanceof Error ? e : new Error(String(e));
          cls = "hard-error";
        }
      }
    }

    itemState = nextLadderState(itemState, cls);
    const decision = ladderDecision(cls, itemState, {
      maxConsecutiveFailures: cfg.maxConsecutiveFailures,
      backoffMs: cfg.backoffMs,
    });
    event("iteration:end", {
      iteration,
      class: cls,
      decision: decision.kind,
      consecutiveFailures: itemState.consecutiveFailures,
      consecutiveErrors: itemState.consecutiveErrors,
      consecutiveInfraErrors: itemState.consecutiveInfraErrors,
      tokens: itemTokens,
      git: statusSnapshot(exec, worktree, baseSha ?? undefined),
      ...(sleepGapMs > 0 ? { sleepGapMs } : {}),
      ...(workerError !== null ? { error: serializeError(workerError) } : {}),
    });

    switch (cls) {
      case "success": {
        good++;
        prior.push({ iteration, success: true, summary: report!.summary });
        changeSummaries.push(...report!.key_changes_made);
        out(`loop: ${pick.hash} iteration ${iteration} ok — ${report!.summary}`);
        if (report!.acs_met) {
          return await completeItem();
        }
        break;
      }
      case "reported-failure":
      case "no-op": {
        failed++;
        const summaryText =
          cls === "no-op"
            ? `no-op iteration (no file changes, no new learnings) — counted as failure`
            : report!.summary;
        lastFailure = summaryText;
        prior.push({ iteration, success: false, summary: summaryText });
        pushFailureNote(`iteration ${iteration} [FAIL]: ${summaryText}`, report?.key_learnings);
        // rollbackIteration salvages commit-failure-preserved work with a
        // re-attempted commit before any reset (MED-2) and clears
        // pendingRepair on every path (BH-HIGH-1: a stale pendingRepair
        // would poison every following iteration with a repair prompt
        // against a clean tree).
        let note: string | null = null;
        try {
          note = rollbackIteration();
        } catch (e) {
          return abandonItem(`rollback failed: ${errorChainText(e)}`);
        }
        recordIteration(
          "[FAIL]",
          `loop iteration ${iteration}: ${summaryText}${note !== null ? ` (${note})` : ""}`,
          [],
          report?.key_learnings ?? [],
          true,
        );
        out(`loop: ${pick.hash} iteration ${iteration} [FAIL] — ${summaryText}`);
        break;
      }
      case "infra-error": {
        // NOT the item's fault (dc7514): the environment killed a session
        // that never really ran. No `failed++`, no lastFailure — the item's
        // failure budget is untouched; the run-level infra streak decides.
        // The iteration's spend is likewise exempted from the per-item
        // token budget (it stays in itemTokens/totals for honest night
        // accounting).
        infra++;
        infraTokens += tokensTotal(itemTokens) - tokensBeforeIteration;
        const msg =
          workerError !== null ? errorChainText(workerError) : "worker died report-less";
        prior.push({
          iteration,
          success: false,
          summary: `(environment failure — not this item's fault) ${msg}`,
        });
        let note: string | null = null;
        try {
          note = rollbackIteration();
        } catch (e) {
          return abandonItem(`rollback failed after infra-error: ${errorChainText(e)}`);
        }
        recordIteration(
          "[ERROR]",
          `loop iteration ${iteration}: infra-error (environment failure, not charged to the item): ${msg}${note !== null ? ` (${note})` : ""}`,
          [],
          [],
          true,
        );
        out(`loop: ${pick.hash} iteration ${iteration} [INFRA] — ${msg}`);
        break;
      }
      case "hard-error":
      case "permanent-error": {
        failed++;
        const msg = workerError !== null ? errorChainText(workerError) : "unknown hard error";
        lastFailure = msg;
        prior.push({ iteration, success: false, summary: msg });
        pushFailureNote(`iteration ${iteration} [ERROR]: ${msg}`);
        // Same salvage-before-reset + pendingRepair discipline as above.
        let note: string | null = null;
        try {
          note = rollbackIteration();
        } catch (e) {
          return abandonItem(`rollback failed after error: ${errorChainText(e)}`);
        }
        recordIteration(
          "[ERROR]",
          `loop iteration ${iteration}: ${msg}${note !== null ? ` (${note})` : ""}`,
          [],
          [],
          true,
        );
        out(`loop: ${pick.hash} iteration ${iteration} [ERROR] — ${msg}`);
        break;
      }
      case "commit-failure": {
        failed++;
        lastFailure = `git commit failed: ${firstLineOf(commitFailureDetail ?? "")}`;
        prior.push({ iteration, success: false, summary: lastFailure });
        pushFailureNote(`iteration ${iteration} [ERROR]: ${lastFailure}`);
        pendingRepair = commitFailureDetail ?? "(no git output captured)";
        // The tree is deliberately PRESERVED (the one no-rollback path);
        // the entry is appended uncommitted and rides the repair commit.
        recordIteration("[ERROR]", `loop iteration ${iteration}: git commit failed; next iteration is repair-only`, [], [firstLineOf(commitFailureDetail ?? "")], false);
        out(`loop: ${pick.hash} iteration ${iteration} commit failed — next iteration repairs`);
        break;
      }
    }

    switch (decision.kind) {
      case "continue":
      case "repair-iteration":
        break;
      case "backoff":
        event("iteration:backoff", { iteration, ms: decision.ms, index: decision.index });
        await sleep(decision.ms, signal);
        break;
      case "abandon-item":
        return abandonItem(decision.reason);
      case "abort-loop": {
        const abandoned = exitInProgress(`loop aborted: ${decision.reason}`);
        return { item: abandoned.item, loopAbort: decision.reason };
      }
      case "abort-run-environment": {
        // dc7514: the environment (not the item) is broken — roll the claim
        // back to ready and abort the whole run.
        const released = releaseItemToReady(decision.reason);
        return { item: released.item, loopAbort: decision.reason };
      }
    }
  }

  // ── acs_met tail (D-11: hand off to the normal PR/CI/merge path) ───────
  async function completeItem(): Promise<RunItemResult> {
    try {
      pushCurrentBranch(exec, worktree);
    } catch (e) {
      if (e instanceof PushFailedError) {
        // AC: push-failure = abort-item-after-preserving. The commit is
        // local + preserved; the item is abandoned so a human untangles
        // the remote in the morning.
        lastFailure = e.message;
        return abandonItem(`push failed (commit preserved locally): ${firstLineOf(e.detail)}`);
      }
      throw e;
    }
    event("item:pushed", { hash: pick.hash });
    const tailOutcome = await args.tailFn(
      {
        hash: pick.hash,
        type: pick.type,
        title: pick.title,
        specRelPath: pick.path,
        branch: args.claim.branch,
        worktreePath: worktree,
        changeSummaries,
      },
      {
        repoRoot,
        mode: args.mode,
        merged: args.merged,
        exec,
        sleep,
        ...(signal !== undefined ? { signal } : {}),
        now,
        ...(args.ciPollMs !== undefined ? { ciPollMs: args.ciPollMs } : {}),
        ...(args.ciTimeoutMs !== undefined ? { ciTimeoutMs: args.ciTimeoutMs } : {}),
        out,
      },
    );
    event("item:tail", { hash: pick.hash, ...tailOutcome });

    if (tailOutcome.outcome === "merged") {
      // BH-MED-6: capture the item snapshot (incl. diff stats) BEFORE
      // finalizeMerged removes the worktree — afterwards diffStat runs
      // against a deleted directory and reports 0/+0/-0 for exactly the
      // items that shipped the most work.
      const snapshot = baseItem();
      finalizeMerged(tailOutcome.prUrl);
      return {
        item: {
          ...snapshot,
          // Warnings pushed DURING finalize (lock release, main push) must
          // still reach the report even though the snapshot predates them.
          ...(itemWarnings.length > 0 ? { warnings: itemWarnings } : {}),
          outcome: "merged",
          prUrl: tailOutcome.prUrl,
        },
        loopAbort: null,
      };
    }
    // handed-off: PR exists (or creation failed) — the claim + worktree stay
    // for the morning; the report carries the reason. The kind routes the
    // driver's systemic rail (review finding MED-6).
    return {
      item: {
        ...baseItem(),
        outcome: "handed-off",
        ...(tailOutcome.prUrl !== null ? { prUrl: tailOutcome.prUrl } : {}),
        worktreePath: relToRepo(worktree, repoRoot),
        detail: tailOutcome.detail,
        ...(lastFailure !== null ? { lastFailure } : {}),
      },
      loopAbort: null,
      handoffKind: tailOutcome.kind,
    };
  }

  function finalizeMerged(prUrl: string): void {
    // Cleanup (the /devx Phase 12 shape): remove worktree, ff main, mark
    // spec done + backlog [x] + PR link, commit, push. Every step is
    // best-effort — a partial cleanup is dispatcher row-4's bread and
    // butter (reconcile-merge) and the report says what landed.
    if (!ownsClaim()) {
      // The PR merged (that part is real and remote) but our claim was
      // taken over mid-run — leave the local reconcile to whoever owns it
      // now; dispatcher row 4 catches the drift either way.
      event("item:finalize-ownership-lost", { hash: pick.hash, prUrl });
      out(`loop: ${pick.hash} merged but claim ownership was lost — skipping local reconcile`);
      return;
    }
    try {
      const r = exec("git", ["worktree", "remove", "--force", worktree], {
        cwd: repoRoot,
        env: { GIT_TERMINAL_PROMPT: "0" },
      });
      if (r.exitCode !== 0) event("item:worktree-remove-failed", { stderr: r.stderr.trim() });
    } catch (e) {
      event("item:worktree-remove-failed", { error: serializeError(e) });
    }
    const pull = exec("git", ["pull", "--ff-only"], {
      cwd: repoRoot,
      env: { GIT_TERMINAL_PROMPT: "0" },
    });
    if (pull.exitCode !== 0) {
      event("item:pull-ff-failed", { stderr: pull.stderr.trim() });
    }
    try {
      // BH-LOW-9 / EC-MED-5: a `false` return means the frontmatter had no
      // flippable status line — surface it (the checkbox is about to flip
      // while the source-of-truth field silently stays in-progress).
      if (!setSpecStatus(mainSpecPath, "done")) {
        event("item:done-status-flip-noop", { spec: pick.path });
      }
    } catch (e) {
      event("item:done-status-flip-failed", { error: serializeError(e) });
    }
    // dvx103 (cf65aa): the interactive /devx skill writes the mandatory
    // `phase 4:` status-log line itself, but in the loop the orchestrator
    // owns the Status log and workers may not touch it — so the merge tail
    // appends the line when it's missing, or every loop-shipped spec reds
    // test/devx-status-log-discipline.test.ts on the next branch cut.
    try {
      if (!hasPhase4StatusLine(readFileSync(mainSpecPath, "utf8"))) {
        appendMainEntry(
          "",
          "phase 4: loop-shipped — per-iteration verification (see iteration lines above) stood in for the interactive self-review pass; line appended by the loop merge tail per dvx103",
        );
      }
    } catch (e) {
      event("item:phase4-append-failed", { error: serializeError(e) });
    }
    appendMainEntry("", `merged via devx loop — PR ${prUrl}`);
    try {
      const content = readFileSync(backlogPath, "utf8");
      const next = markBacklogRowDone(content, pick.hash, pick.type, prUrl);
      // EC-LOW-13: tmp+rename like every other loop write — a kill -9
      // mid-write must never tear the backlog.
      if (next !== content) writeAtomic(backlogPath, next);
    } catch (e) {
      event("item:backlog-done-flip-failed", { error: serializeError(e) });
    }
    releaseSpecLock();
    commitOnMain(`chore: mark ${pick.hash} done after loop merge (${prUrl})`);
    pushMain();
    out(`loop: ${pick.hash} merged + reconciled (${prUrl})`);
  }

  function backlogRel(type: string): string {
    return type === "debug" ? "DEBUG.md" : "DEV.md";
  }
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function safeLoadMerged(): unknown {
  try {
    return loadMerged();
  } catch {
    return null;
  }
}

function devModelFrom(merged: unknown): string {
  if (merged && typeof merged === "object") {
    const capacity = (merged as Record<string, unknown>).capacity;
    if (capacity && typeof capacity === "object") {
      const models = (capacity as Record<string, unknown>).models;
      if (models && typeof models === "object") {
        const v = (models as Record<string, unknown>).dev;
        if (typeof v === "string" && v !== "") return v;
      }
    }
  }
  return "claude-sonnet-4-6";
}

function safeHead(exec: Exec, cwd: string): string | null {
  try {
    return getHead(exec, cwd);
  } catch {
    return null;
  }
}

function relToRepo(p: string, repoRoot: string): string {
  return p.startsWith(repoRoot + "/") ? p.slice(repoRoot.length + 1) : p;
}

function firstLineOf(s: string): string {
  return s.split("\n").find((l) => l.trim() !== "")?.trim() ?? s.trim();
}

/**
 * Best-effort description of the uncommitted work a reset is about to
 * discard (review finding MED-2 — the [ERROR] entry must say what was
 * lost when the salvage re-attempt also failed). Never throws.
 */
function uncommittedDiffNote(exec: Exec, cwd: string): string | null {
  try {
    const env = { GIT_TERMINAL_PROMPT: "0" };
    let files = 0;
    let added = 0;
    let deleted = 0;
    const d = exec("git", ["diff", "--numstat", "HEAD"], { cwd, env });
    if (d.exitCode === 0) {
      for (const line of d.stdout.split("\n")) {
        if (line.trim() === "") continue;
        const [a, del] = line.split("\t");
        files++;
        if (a !== "-" && del !== "-") {
          added += Number.parseInt(a ?? "0", 10) || 0;
          deleted += Number.parseInt(del ?? "0", 10) || 0;
        }
      }
    }
    const u = exec("git", ["ls-files", "--others", "--exclude-standard"], { cwd, env });
    const untracked =
      u.exitCode === 0 ? u.stdout.split("\n").filter((l) => l.trim() !== "").length : 0;
    if (files === 0 && untracked === 0) return null;
    return `${files} tracked files (+${added}/-${deleted})${untracked > 0 ? ` + ${untracked} untracked` : ""}`;
  } catch {
    return null;
  }
}

function tailOf(s: string, n: number): string {
  const t = s.trim();
  return t.length > n ? `…${t.slice(-n)}` : t;
}
