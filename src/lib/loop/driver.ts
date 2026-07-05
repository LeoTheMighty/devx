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
import { flipDevMdCheckbox } from "../manage/loop.js";
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

import { loopConfigFrom, loopModeGate, type LoopConfig } from "./config.js";
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
  PushFailedError,
  commitAll,
  diffStat,
  getHead,
  hasUncommittedChanges,
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
  firstPermanentErrorMatch,
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
  markBacklogRowDone,
  setSpecStatus,
  type EntryPrefix,
} from "./spec-io.js";
import { writeMorningReport, type ItemResult, type RunSummary, type TokenTotals } from "./report.js";
import { defaultTail, type TailFn } from "./tail.js";
import { makeClaudeWorker, type WorkerRunFn, type WorkerTokens } from "./worker.js";

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

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
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
  return { input: 0, output: 0, estimated: false };
}

function addTokens(into: TokenTotals, t: WorkerTokens): void {
  into.input += t.input;
  into.output += t.output;
  if (t.estimated) into.estimated = true;
}

function tokensTotal(t: TokenTotals): number {
  return t.input + t.output;
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
  const hbInterval = setInterval(
    () => writeState("running"),
    opts.heartbeatIntervalMs ?? 60_000,
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
        continue;
      }
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
      if (result.item.outcome === "abandoned") {
        ladder = afterItemAbandoned(ladder);
        if (shouldStopAfterAbandonment(ladder)) {
          abortReason = `${ladder.consecutiveAbandonedItems} consecutive abandoned items — systemic problem, stopping the loop`;
          break;
        }
      } else if (result.item.outcome === "merged" || result.item.outcome === "handed-off") {
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
    consecutiveAbandonedItems: args.ladder.consecutiveAbandonedItems,
  };
  let iteration = 0;
  let good = 0;
  let failed = 0;
  let pendingRepair: string | null = null;
  let lastFailure: string | null = null;

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
    tokens: itemTokens,
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
      commitAll(exec, worktree, `chore(loop): record iteration ${iteration} for ${pick.hash}`);
    } catch (e) {
      event("iteration:record-commit-failed", { error: serializeError(e) });
    }
  };

  const appendMainEntry = (prefix: EntryPrefix, head: string): void => {
    try {
      appendStatusEntryToFile(mainSpecPath, {
        iso: now().toISOString(),
        prefix,
        head,
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
    } catch {
      // already gone / unreadable — the report points at the path anyway
    }
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
    try {
      flipDevMdCheckbox(backlogPath, pick.hash);
    } catch (e) {
      event("item:abandon-backlog-flip-failed", { error: serializeError(e) });
    }
    releaseSpecLock();
    commitOnMain(`chore(loop): abandon ${pick.hash} (${reason})`);
    out(`loop: abandoned ${pick.hash} — ${reason}; worktree preserved at ${worktree}`);
    return {
      item: {
        ...baseItem(),
        outcome: "abandoned",
        worktreePath: relToRepo(worktree, repoRoot),
        ...(lastFailure !== null ? { lastFailure } : {}),
        detail: reason,
      },
      loopAbort: null,
    };
  };

  const exitInProgress = (why: string): RunItemResult => {
    event("item:in-progress-at-exit", { hash: pick.hash, why, worktree });
    appendMainEntry("", `loop stopped mid-item (${why}); worktree + claim preserved`);
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
    if (iteration >= cfg.maxIterationsPerItem) {
      return abandonItem(
        `iteration budget exhausted (${cfg.maxIterationsPerItem} iterations without acs_met)`,
      );
    }
    if (tokensTotal(itemTokens) >= cfg.maxTokensPerItem) {
      return abandonItem(
        `per-item token budget exhausted (${tokensTotal(itemTokens)}/${cfg.maxTokensPerItem})`,
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
    try {
      const r = await worker(prompt, { cwd: worktree, ...(signal !== undefined ? { signal } : {}) });
      raw = r.rawOutput;
      addTokens(itemTokens, r.tokens);
      addTokens(args.totals, r.tokens);
      if (r.graceKilled) event("iteration:grace-killed", { iteration });
      const parsed = extractReportJson(raw);
      const validated = parsed !== null ? validateIterationReport(parsed) : null;
      if (validated !== null && validated.ok) {
        report = validated.report;
      } else if (firstPermanentErrorMatch(raw) !== null) {
        // BH-HIGH-2: a `claude -p` hitting credit/auth exhaustion exits with
        // the marker text in its OUTPUT, not in a thrown error. Surface it
        // as a worker error carrying the matched text so classifyIteration's
        // permanent-error rung actually fires — and do NOT burn a retry
        // spawn against a dead API.
        workerError = new Error(
          `worker output matches a permanent-error marker: ${firstPermanentErrorMatch(raw)}`,
        );
      } else {
        // Retry protocol: one cheap re-ask for JUST the JSON.
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
        const reparsed = extractReportJson(retry.rawOutput);
        const revalidated = reparsed !== null ? validateIterationReport(reparsed) : null;
        if (revalidated !== null && revalidated.ok) {
          report = revalidated.report;
        } else {
          const retryMarker = firstPermanentErrorMatch(retry.rawOutput);
          const exitNote =
            r.exitCode !== null && r.exitCode !== 0
              ? `; worker exited ${r.exitCode}: ${tailOf(raw, 300)}`
              : "";
          workerError =
            retryMarker !== null
              ? new Error(`worker output matches a permanent-error marker: ${retryMarker}`)
              : new Error(
                  `worker report unparseable after retry (${errors.map((e) => e.message).join("; ")})${exitNote}`,
                );
        }
      }
    } catch (e) {
      workerError = e instanceof Error ? e : new Error(String(e));
    }
    if (signal?.aborted && report === null) {
      // The abort tore the worker down mid-flight — don't count it as a
      // failure; roll back and exit as stopped-mid-item.
      try {
        resetHard(exec, worktree);
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
      tokens: itemTokens,
      git: statusSnapshot(exec, worktree, baseSha ?? undefined),
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
        try {
          resetHard(exec, worktree);
        } catch (e) {
          return abandonItem(`rollback failed: ${errorChainText(e)}`);
        }
        // BH-HIGH-1: the preserved commit-failure changes (if any) were just
        // discarded by the reset — a stale pendingRepair would poison every
        // following iteration with a repair prompt against a clean tree.
        pendingRepair = null;
        recordIteration("[FAIL]", `loop iteration ${iteration}: ${summaryText}`, [], report?.key_learnings ?? [], true);
        out(`loop: ${pick.hash} iteration ${iteration} [FAIL] — ${summaryText}`);
        break;
      }
      case "hard-error":
      case "permanent-error": {
        failed++;
        const msg = workerError !== null ? errorChainText(workerError) : "unknown hard error";
        lastFailure = msg;
        prior.push({ iteration, success: false, summary: msg });
        try {
          resetHard(exec, worktree);
        } catch (e) {
          return abandonItem(`rollback failed after error: ${errorChainText(e)}`);
        }
        pendingRepair = null; // see BH-HIGH-1 note above — reset discards the repair target
        recordIteration("[ERROR]", `loop iteration ${iteration}: ${msg}`, [], [], true);
        out(`loop: ${pick.hash} iteration ${iteration} [ERROR] — ${msg}`);
        break;
      }
      case "commit-failure": {
        failed++;
        lastFailure = `git commit failed: ${firstLineOf(commitFailureDetail ?? "")}`;
        prior.push({ iteration, success: false, summary: lastFailure });
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
        item: { ...snapshot, outcome: "merged", prUrl: tailOutcome.prUrl },
        loopAbort: null,
      };
    }
    // handed-off: PR exists (or creation failed) — the claim + worktree stay
    // for the morning; the report carries the reason.
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
    const push = exec("git", ["push"], {
      cwd: repoRoot,
      env: { GIT_TERMINAL_PROMPT: "0" },
    });
    if (push.exitCode !== 0) event("item:main-push-failed", { stderr: push.stderr.trim() });
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

function tailOf(s: string, n: number): string {
  const t = s.trim();
  return t.length > n ? `…${t.slice(-n)}` : t;
}
