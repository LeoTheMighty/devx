// RepoSnapshot gatherer for `devx next` v2 (v2d101). All the I/O that the
// pure decision table (decide.ts) must never do: backlog reads, spec
// frontmatter reads, lock probes, manager/loop heartbeat, gh PR + CI
// probes, workstream artifact scans. Every side effect is routed through
// an injectable seam (fs / exec / now / sessionToken) so the S-4 test
// matrix can drive all 12 rows against synthetic repos without touching
// gh or the wall clock.
//
// Wrap-don't-duplicate ledger:
//   - backlog rows        → src/lib/backlog/parse.ts (mgr103)
//   - engine frontmatter  → src/lib/engine/frontmatter.ts (v2e101)
//   - spec-by-hash lookup → src/lib/engine/workstream.ts findSpecForHashInFs
//   - workstream rows     → src/lib/engine/next.ts nextForWorkstream (v1)
//   - lock ownership      → src/lib/devx/verify-claim.ts parse/normalize
//   - heartbeat path      → src/lib/manage/state.ts heartbeatPath (mgr102)
//   - frontmatter scalars → src/lib/plan/validate-emit.ts parseFrontmatterValue
//
// Spec: dev/dev-v2d101-2026-07-05T13:05-universal-dispatcher.md
// Design: v2/05-dispatcher.md §2

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join } from "node:path";

import {
  type DevRow,
  parseDevMd,
  parseInterviewMd,
} from "../backlog/parse.js";
import { readEngineState } from "../engine/frontmatter.js";
import { type EngineConfig } from "../engine/config.js";
import {
  type WorkstreamArtifacts,
  nextForWorkstream,
} from "../engine/next.js";
import { isMeasureByDue } from "../engine/outcome.js";
import { formatDate } from "../engine/verdict.js";
import { findSpecForHashInFs } from "../engine/workstream.js";
import {
  normalizeSessionToken,
  parseLockOwner,
} from "../devx/verify-claim.js";
import { heartbeatPath } from "../manage/state.js";
import { parseFrontmatterValue } from "../plan/validate-emit.js";
import { type Exec, realExec } from "../tour/exec.js";
import {
  type BlockedItemSignal,
  type CiState,
  type ClaimSignal,
  type DriftEntry,
  type GateInfo,
  type InterviewBlockSignal,
  type LoopSignal,
  type MergeReconcileSignal,
  type OutcomeDueSignal,
  type OwnPrSignal,
  type PlanItemSignal,
  type ReadyItemSignal,
  type RepoSnapshot,
  type WorkstreamSignal,
} from "./decide.js";

// ---------------------------------------------------------------------------
// Seams
// ---------------------------------------------------------------------------

export interface NextFs {
  readFile(path: string): string;
  exists(path: string): boolean;
  readdir(path: string): string[];
  statMtimeMs(path: string): number;
}

export const realNextFs: NextFs = {
  readFile: (p) => readFileSync(p, "utf8"),
  exists: (p) => existsSync(p),
  readdir: (p) => readdirSync(p),
  statMtimeMs: (p) => statSync(p).mtimeMs,
};

export interface GatherOpts {
  repoRoot: string;
  /** Full merged config blob (manager.heartbeat_interval_s lives here). */
  merged: unknown;
  engine: EngineConfig;
  fs?: Partial<NextFs>;
  exec?: Exec;
  now?: () => Date;
  /** Current session's token — enables the row-5 "claimed by me" check.
   *  Without it, in-progress-with-lock claims report as "unverified". */
  sessionToken?: string;
  /** Heartbeat freshness window override (seconds). Defaults to
   *  3 × manager.heartbeat_interval_s (itself defaulting to 60). */
  heartbeatFreshSeconds?: number;
  /** Skip the gh PR probe entirely (rows 2–3 come back empty). The S-5
   *  init e2e and offline runs use this; a gh failure degrades the same
   *  way with a warning. */
  skipGh?: boolean;
}

// ---------------------------------------------------------------------------
// Gatherer
// ---------------------------------------------------------------------------

export function gatherRepoSnapshot(opts: GatherOpts): RepoSnapshot {
  const fs: NextFs = { ...realNextFs, ...(opts.fs ?? {}) };
  const exec = opts.exec ?? realExec;
  const now = (opts.now ?? (() => new Date()))();
  const { repoRoot, engine } = opts;
  const warnings: string[] = [];
  const drift: DriftEntry[] = [];

  // ── Backlog rows ────────────────────────────────────────────────────────
  const devRows = readBacklogRows(fs, repoRoot, "DEV.md", warnings);
  const debugRows = readBacklogRows(fs, repoRoot, "DEBUG.md", warnings);
  const planRows = readBacklogRows(fs, repoRoot, "PLAN.md", warnings);

  // ── Per-row spec resolution: effective status, drift, unreconciled,
  //    claims. The frontmatter Status field is the source of truth; the
  //    checkbox mirrors it (CLAUDE.md). Mismatch is REPORTED, never fixed.
  const unreconciled: MergeReconcileSignal[] = [];
  const claims: ClaimSignal[] = [];
  interface ResolvedRow {
    row: DevRow;
    backlog: string;
    specPath: string | null;
    specContent: string | null;
    specStatus: string | null;
    effectiveStatus: string;
  }
  const resolved: ResolvedRow[] = [];
  // Struck rows (~~…~~ → deleted/superseded) never produce work signals,
  // but they MUST participate in blocker resolution: a dependent whose
  // blocker was struck is unblocked (same posture as mgr103 reconcile,
  // whose devByHash includes struck rows — adversarial-review BH#1: the
  // dispatcher and the manager must not disagree about the same backlog).
  const struckStatusByHash = new Map<string, string>();
  const resolveRows = (rows: DevRow[], backlog: string): void => {
    for (const row of rows) {
      if (row.struck) {
        if (!struckStatusByHash.has(row.hash)) {
          struckStatusByHash.set(row.hash, row.status);
        }
        continue;
      }
      let specPath: string | null = null;
      let specContent: string | null = null;
      let specStatus: string | null = null;
      specPath = findSpecForHashInFs(fs, repoRoot, row.type, row.hash);
      if (specPath !== null) {
        try {
          specContent = fs.readFile(specPath);
          // Lowercase at the seam: parseDevMd normalizes row statuses but
          // frontmatter `status: Done` (hand-edit) would otherwise produce
          // phantom drift + a row-4 livelock (adversarial-review EC#3).
          specStatus = readEngineState(specContent).status?.toLowerCase() ?? null;
        } catch (e) {
          warnings.push(
            `${backlog} row '${row.hash}': spec unreadable (${errMessage(e)})`,
          );
        }
      } else {
        warnings.push(
          `${backlog} row '${row.hash}' points at a missing spec (${row.path})`,
        );
      }
      const effectiveStatus = specStatus ?? row.status;
      if (specStatus !== null && specStatus !== row.status) {
        drift.push({
          hash: row.hash,
          backlog,
          kind: "status-mismatch",
          backlogStatus: row.status,
          specStatus,
          detail: `${backlog} row says '${row.status}' but spec frontmatter says '${specStatus}' — reconcile manually (checkbox mirrors frontmatter)`,
        });
        const doneMismatch =
          (specStatus === "done") !== (row.status === "done");
        // Row 4 (reconcile-merge / cleanup phase) is an execute-arm
        // concept — plan specs are unclaimable, so a PLAN.md done-mismatch
        // stays a reported drift defect only (adversarial-review BH#5/EC#4:
        // `/devx <plan-hash>` is a guaranteed-failing fix command).
        if (doneMismatch && backlog !== "PLAN.md") {
          unreconciled.push({
            hash: row.hash,
            backlog,
            backlogStatus: row.status,
            specStatus,
            specPath: repoRel(specPath ?? row.path, repoRoot),
          });
        }
      }
      // Claim/lock semantics apply only to the claimable backlogs (DEV.md +
      // DEBUG.md — the execute arm). Plan specs go in-progress without a
      // spec lock (the planning stages own them), so probing locks there
      // would report phantom "in-progress-without-lock" drift.
      if (effectiveStatus === "in-progress" && backlog !== "PLAN.md") {
        const claim = claimSignalFor(
          fs,
          repoRoot,
          backlog,
          row.hash,
          opts.sessionToken,
          drift,
        );
        if (claim.ownership === "other-session") {
          // Row 5 deliberately skips a live peer's claim, but a dead peer's
          // leftover lock must not vanish into row 12's "genuinely empty" —
          // surface it (adversarial-review EC#5).
          warnings.push(
            `'${row.hash}' is in-progress with a lock held by another session (lock owner '${claim.lockOwner}') — leave it alone, or verify staleness before intervening`,
          );
        }
        claims.push(claim);
      }
      resolved.push({
        row,
        backlog,
        specPath,
        specContent,
        specStatus,
        effectiveStatus,
      });
    }
  };
  resolveRows(devRows, "DEV.md");
  resolveRows(debugRows, "DEBUG.md");
  resolveRows(planRows, "PLAN.md");

  // Status lookup for blocker resolution — spec-status-preferring, across
  // every backlog (a DEV row may be blocked by a plan or debug hash).
  // Struck rows contribute their deleted/superseded status (settled) but
  // never override a live row for the same hash.
  const statusByHash = new Map<string, string>();
  for (const r of resolved) {
    if (!statusByHash.has(r.row.hash)) {
      statusByHash.set(r.row.hash, r.effectiveStatus);
    }
  }
  for (const [hash, status] of struckStatusByHash) {
    if (!statusByHash.has(hash)) statusByHash.set(hash, status);
  }
  const blockersResolved = (row: DevRow): boolean => {
    for (const blocker of row.blocked_by) {
      const st = statusByHash.get(blocker);
      // Unknown blocker → conservative "unresolved" (same posture as
      // mgr103 reconcile + pln103 validate-emit).
      if (st === undefined) return false;
      if (st !== "done" && st !== "deleted" && st !== "superseded") {
        return false;
      }
    }
    return true;
  };

  // ── Ready + blocked signals ─────────────────────────────────────────────
  const devReady: ReadyItemSignal[] = [];
  const debugReady: ReadyItemSignal[] = [];
  const planReady: PlanItemSignal[] = [];
  const blocked: BlockedItemSignal[] = [];
  for (const r of resolved) {
    if (r.effectiveStatus === "blocked") {
      blocked.push({
        hash: r.row.hash,
        backlog: r.backlog,
        status: "blocked",
        blocked_by: r.row.blocked_by,
        owner: r.specContent ? ownerFrom(r.specContent) : null,
      });
      continue;
    }
    if (r.effectiveStatus !== "ready") continue;
    // A ready row whose spec file is missing OR unreadable is not routable
    // — the warning above is the operator signal; don't hand /devx a dead
    // hash, and don't fail-open a gate we couldn't even read (BH#9).
    if (r.specPath === null || r.specContent === null) continue;
    if (!blockersResolved(r.row)) {
      // Ready-but-blocked-by-unshipped-deps: not row-7/8/10 eligible; it
      // is still "blocked" for row 11's report.
      blocked.push({
        hash: r.row.hash,
        backlog: r.backlog,
        status: r.row.status,
        blocked_by: r.row.blocked_by,
        owner: null,
      });
      continue;
    }
    if (r.backlog === "DEBUG.md") {
      debugReady.push({
        hash: r.row.hash,
        type: r.row.type,
        backlog: r.backlog,
        path: r.row.path,
        title: r.row.title,
        // Debug specs are standalone by design (v2/05-dispatcher.md §4) —
        // never workstream-gated.
        gate: { required: false, passed: true, workstream: null, reason: "debug specs are standalone" },
      });
    } else if (r.backlog === "DEV.md") {
      // specContent is non-null here (unreadable rows were de-routed above).
      const gate = resolveWorkstreamGate(
        fs,
        repoRoot,
        engine,
        r.specContent,
        warnings,
        r.row.hash,
      );
      devReady.push({
        hash: r.row.hash,
        type: r.row.type,
        backlog: r.backlog,
        path: r.row.path,
        title: r.row.title,
        gate,
      });
    } else {
      // PLAN.md ready rows — row 10's domain.
      planReady.push({ hash: r.row.hash, path: r.row.path, title: r.row.title });
    }
  }

  // ── INTERVIEW.md blocking questions (row 6) ─────────────────────────────
  const interviewBlocking: InterviewBlockSignal[] = [];
  const interviewAbs = join(repoRoot, "INTERVIEW.md");
  if (fs.exists(interviewAbs)) {
    try {
      const questions = parseInterviewMd(fs.readFile(interviewAbs));
      for (const q of questions) {
        if (q.answered) continue;
        const blockingHashes = q.blocks.filter((h) => {
          const st = statusByHash.get(h);
          return st === "ready" || st === "blocked";
        });
        if (blockingHashes.length > 0) {
          interviewBlocking.push({ qNum: q.qNum, blocks: blockingHashes });
        }
      }
    } catch (e) {
      warnings.push(`INTERVIEW.md unreadable: ${errMessage(e)}`);
    }
  }

  // ── Mid-pipeline workstreams (row 9 — reuse the v1 stage rows) + due
  //    outcomes (row 5.5, v2o101) — one plan/ scan feeds both. ────────────
  const { midPipeline, outcomeDue } = gatherWorkstreamSignals(
    fs,
    repoRoot,
    engine,
    formatDate(now),
    warnings,
  );

  // ── Loop / manager heartbeat (row 1) ────────────────────────────────────
  const loop = gatherLoopSignal(fs, repoRoot, opts, now, warnings);

  // ── Own open PRs + CI (rows 2–3) ────────────────────────────────────────
  const prs = opts.skipGh ? [] : gatherOwnPrs(exec, repoRoot, warnings);

  return {
    loop,
    prs,
    unreconciled,
    claims,
    outcomeDue,
    interviewBlocking,
    debugReady,
    devReady,
    midPipeline,
    planReady,
    blocked,
    drift,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Backlog + claim helpers
// ---------------------------------------------------------------------------

function readBacklogRows(
  fs: NextFs,
  repoRoot: string,
  name: string,
  warnings: string[],
): DevRow[] {
  const abs = join(repoRoot, name);
  if (!fs.exists(abs)) return [];
  try {
    return parseDevMd(fs.readFile(abs));
  } catch (e) {
    // The backlogs are the most load-bearing input — an unreadable file
    // must NOT silently degrade into "genuinely empty" (adversarial-review
    // finding: a chmod-000 DEV.md produced row 12 with zero signal).
    warnings.push(
      `${name} exists but is unreadable (${errMessage(e)}) — treated as empty`,
    );
    return [];
  }
}

function claimSignalFor(
  fs: NextFs,
  repoRoot: string,
  backlog: string,
  hash: string,
  sessionToken: string | undefined,
  drift: DriftEntry[],
): ClaimSignal {
  const lockPath = join(repoRoot, ".devx-cache", "locks", `spec-${hash}.lock`);
  if (!fs.exists(lockPath)) {
    drift.push({
      hash,
      backlog,
      kind: "in-progress-without-lock",
      detail: `'${hash}' is in-progress but no lock exists at .devx-cache/locks/spec-${hash}.lock — orphaned claim; file INTERVIEW.md rather than silently re-claiming`,
    });
    return { hash, backlog, ownership: "no-lock", lockOwner: null };
  }
  let lockOwner: string | null = null;
  try {
    lockOwner = parseLockOwner(fs.readFile(lockPath));
  } catch {
    lockOwner = null;
  }
  if (lockOwner === null) {
    return { hash, backlog, ownership: "unverified", lockOwner: null };
  }
  if (sessionToken === undefined || sessionToken.trim() === "") {
    return { hash, backlog, ownership: "unverified", lockOwner };
  }
  const owned =
    normalizeSessionToken(lockOwner) === normalizeSessionToken(sessionToken);
  return {
    hash,
    backlog,
    ownership: owned ? "owned" : "other-session",
    lockOwner,
  };
}

function ownerFrom(specContent: string): string | null {
  return parseFrontmatterValue(specContent, "owner");
}

// ---------------------------------------------------------------------------
// Workstream gate resolution (row 8's evals_red requirement)
// ---------------------------------------------------------------------------

function exemptGate(reason: string): GateInfo {
  return { required: false, passed: true, workstream: null, reason };
}

/**
 * Resolve whether a dev spec belongs to an engine-managed workstream, and
 * if so whether that workstream's `evals_red` gate has passed. Chain, in
 * order: `workstream:` frontmatter → `from:`/`plan:` naming a
 * `<workstreamsRoot>/<slug>/plan.md` path → `from:`/`plan:` naming a
 * `plan/plan-<hash>-…` spec with engine frontmatter. Standalone specs
 * (from: an epic file, a v2 design doc, or nothing) are exempt — D-8's
 * "small work must not be forced through four gates".
 */
export function resolveWorkstreamGate(
  fs: NextFs,
  repoRoot: string,
  engine: EngineConfig,
  specContent: string,
  warnings: string[],
  hash: string,
): GateInfo {
  const st = readEngineState(specContent);
  let wsRel: string | null = st.workstream;
  let planHash: string | null = null;

  if (wsRel === null) {
    const wsRe = new RegExp(
      `(?:^|/)${escapeRegex(engine.workstreamsRoot)}/([a-z0-9-]+)(?:/|$)`,
    );
    for (const key of ["from", "plan"]) {
      const v = parseFrontmatterValue(specContent, key);
      if (!v) continue;
      const wsMatch = wsRe.exec(v);
      if (wsMatch) {
        wsRel = `${engine.workstreamsRoot}/${wsMatch[1]}`;
        break;
      }
      const planMatch = /(?:^|\/)plan-([a-z0-9]{3,12})-[^/]*\.md$/.exec(v);
      if (planMatch && planHash === null) {
        planHash = planMatch[1];
      }
    }
  }

  let planState: ReturnType<typeof readEngineState> | null = null;
  let resolvedWs: string | null = null;
  if (wsRel !== null) {
    // Find the plan spec claiming this workstream dir (same adoption walk
    // as createWorkstream's no-hash path).
    const planDir = join(repoRoot, "plan");
    if (fs.exists(planDir)) {
      for (const name of [...fs.readdir(planDir)].sort()) {
        if (!name.endsWith(".md")) continue;
        try {
          const cand = readEngineState(fs.readFile(join(planDir, name)));
          if (cand.workstream === wsRel) {
            planState = cand;
            resolvedWs = wsRel;
            break;
          }
        } catch {
          // unreadable plan spec — keep scanning
        }
      }
    }
    if (planState === null) {
      warnings.push(
        `'${hash}' names workstream '${wsRel}' but no plan spec claims it — gate not resolvable, treated exempt`,
      );
      return exemptGate(`workstream '${wsRel}' unresolvable`);
    }
  } else if (planHash !== null) {
    const specAbs = findSpecForHashInFs(fs, repoRoot, "plan", planHash);
    if (specAbs !== null) {
      try {
        const cand = readEngineState(fs.readFile(specAbs));
        // Legacy (pre-engine) plan specs have no stage — exempt.
        if (cand.stage !== null) {
          planState = cand;
          resolvedWs = cand.workstream;
        }
      } catch {
        // unreadable — exempt below
      }
    }
  }

  if (planState === null) {
    return exemptGate("standalone spec — no engine workstream in from:/plan: chain");
  }
  const passed = planState.gateStatus.evals_red === true;
  return {
    required: true,
    passed,
    workstream: resolvedWs,
    reason: passed
      ? "evals_red is true"
      : "workstream gate evals_red is false — RED artifacts must land before execution",
  };
}

// ---------------------------------------------------------------------------
// Workstream scan: mid-pipeline (row 9) + due outcomes (row 5.5)
// ---------------------------------------------------------------------------

function gatherWorkstreamSignals(
  fs: NextFs,
  repoRoot: string,
  engine: EngineConfig,
  /** YYYY-MM-DD — the outcome measure_by due-date comparison anchor. */
  today: string,
  warnings: string[],
): { midPipeline: WorkstreamSignal[]; outcomeDue: OutcomeDueSignal[] } {
  const planDir = join(repoRoot, "plan");
  const midPipeline: WorkstreamSignal[] = [];
  const outcomeDue: OutcomeDueSignal[] = [];
  if (!fs.exists(planDir)) return { midPipeline, outcomeDue };
  for (const name of [...fs.readdir(planDir)].sort()) {
    if (!name.endsWith(".md")) continue;
    let content: string;
    try {
      content = fs.readFile(join(planDir, name));
    } catch (e) {
      warnings.push(`plan/${name} unreadable: ${errMessage(e)}`);
      continue;
    }
    const state = readEngineState(content);
    // Only engine-managed specs participate (legacy plan specs have no
    // stage — PLAN.md row 10 is their surface).
    if (state.stage === null) continue;
    const hash = state.hash ?? hashFromFilename(name);
    if (hash === null) continue;

    let wsRel = state.workstream;
    if (wsRel === null) {
      const m =
        /^plan-[a-z0-9]{3,12}-\d{4}-\d{2}-\d{2}T\d{2}:\d{2}-(.+)\.md$/i.exec(name);
      if (m) wsRel = `${engine.workstreamsRoot}/${m[1]}`;
    }
    const slug = wsRel !== null ? (wsRel.split("/").pop() ?? wsRel) : hash;

    // Row 5.5: an armed outcome that came due. Gated on stage 'done' to
    // match what `devx outcome score` will actually accept — a pending
    // outcome on a revised (rolled-back) workstream would otherwise emit a
    // command that refuses forever, livelocking the dispatcher above rows
    // 6–12 (adversarial-review BH#1). A rolled-back workstream's pending
    // outcome resurfaces here once the replay reaches done again (its
    // stage rows meanwhile surface at row 9).
    if (
      state.stage === "done" &&
      state.outcome.status === "pending" &&
      isMeasureByDue(state.outcome.measure_by, today)
    ) {
      outcomeDue.push({ hash, slug, measureBy: state.outcome.measure_by });
    }

    const wsAbs = wsRel !== null ? join(repoRoot, ...wsRel.split("/")) : null;
    const artifacts = artifactsFor(fs, wsAbs);
    const decision = nextForWorkstream(hash, state, artifacts, today);
    // Row-9 domain: a stage/gate command exists AND it isn't the v1
    // "all gates passed → /devx executes its dev items" terminal row
    // (that is row 8's domain via DEV.md).
    if (decision.command !== null && decision.row !== 12) {
      midPipeline.push({
        hash,
        slug,
        stage: state.stage,
        decision,
      });
    }
  }
  return { midPipeline, outcomeDue };
}

function artifactsFor(fs: NextFs, wsAbs: string | null): WorkstreamArtifacts {
  if (wsAbs === null || !fs.exists(wsAbs)) {
    return {
      prd: false,
      expectations: false,
      design: false,
      plan: false,
      evalsAuthored: false,
    };
  }
  const evalsAbs = join(wsAbs, "evals");
  let evalsAuthored = false;
  if (fs.exists(evalsAbs)) {
    evalsAuthored = fs
      .readdir(evalsAbs)
      .some((n) => n !== "RED-report.md" && !n.startsWith("."));
  }
  return {
    prd: fs.exists(join(wsAbs, "prd.md")),
    expectations: fs.exists(join(wsAbs, "expectations.md")),
    design: fs.exists(join(wsAbs, "design.md")),
    plan: fs.exists(join(wsAbs, "plan.md")),
    evalsAuthored,
  };
}

function hashFromFilename(name: string): string | null {
  const m = /^plan-([a-z0-9]{3,12})-/i.exec(name);
  return m ? m[1].toLowerCase() : null;
}

// ---------------------------------------------------------------------------
// Loop / manager heartbeat (row 1)
// ---------------------------------------------------------------------------

const DEFAULT_HEARTBEAT_INTERVAL_S = 60;
const OVERNIGHT_REPORT_WINDOW_MS = 24 * 60 * 60 * 1000;

function gatherLoopSignal(
  fs: NextFs,
  repoRoot: string,
  opts: GatherOpts,
  now: Date,
  warnings: string[],
): LoopSignal {
  const cacheDir = join(repoRoot, ".devx-cache");
  const freshS =
    opts.heartbeatFreshSeconds ??
    heartbeatIntervalFrom(opts.merged) * 3;

  const dead: LoopSignal = {
    live: false,
    source: null,
    pid: null,
    ts: null,
    ageSeconds: null,
    overnightReport: findOvernightReport(fs, repoRoot, now),
  };

  // Shared freshness predicate: |now − ts| within the window. The absolute
  // value guards BOTH directions — a stale file (loop crashed via SIGKILL /
  // power loss, mgr106's stale-PID lesson) AND a future-dated ts (clock
  // skew / TZ-mangled hand edit) must not report "live" forever
  // (adversarial-review BH#2 / EC#1 / EC#2).
  const isFresh = (tsMs: number): boolean =>
    Math.abs(now.getTime() - tsMs) <= freshS * 1000;

  // v2l101's loop state file — probed first so the overnight loop wins the
  // "who is live" attribution once it lands. Degrades gracefully to the
  // manager heartbeat (and then to "no loop state") until then. `status:
  // "running"` alone is NOT trusted: the ts must be fresh, otherwise a
  // crash-orphaned state file would wedge the dispatcher at row 1 until
  // someone hand-deletes the cache.
  const loopStateAbs = join(cacheDir, "loop", "state.json");
  if (fs.exists(loopStateAbs)) {
    try {
      const parsed = JSON.parse(fs.readFile(loopStateAbs)) as {
        status?: unknown;
        pid?: unknown;
        ts?: unknown;
      };
      if (parsed && typeof parsed === "object" && parsed.status === "running") {
        const tsMs =
          typeof parsed.ts === "string" ? Date.parse(parsed.ts) : NaN;
        if (Number.isFinite(tsMs) && isFresh(tsMs)) {
          return {
            ...dead,
            live: true,
            source: "loop-state",
            pid: typeof parsed.pid === "number" ? parsed.pid : null,
            ts: typeof parsed.ts === "string" ? parsed.ts : null,
            ageSeconds: Math.round((now.getTime() - tsMs) / 1000),
          };
        }
        warnings.push(
          `.devx-cache/loop/state.json says status:"running" but its ts is ${
            Number.isFinite(tsMs) ? "stale/skewed" : "missing/unparseable"
          } — treating the loop as dead (crash-orphaned state?)`,
        );
      }
    } catch (e) {
      warnings.push(`.devx-cache/loop/state.json unreadable: ${errMessage(e)}`);
    }
  }

  const hbAbs = heartbeatPath(cacheDir);
  if (!fs.exists(hbAbs)) return dead;
  try {
    const parsed = JSON.parse(fs.readFile(hbAbs)) as {
      ts?: unknown;
      pid?: unknown;
    };
    if (!parsed || typeof parsed !== "object" || typeof parsed.ts !== "string") {
      return dead;
    }
    const tsMs = Date.parse(parsed.ts);
    if (!Number.isFinite(tsMs)) return dead;
    const ageSeconds = Math.round((now.getTime() - tsMs) / 1000);
    const live = isFresh(tsMs);
    return {
      ...dead,
      live,
      source: live ? "manager-heartbeat" : null,
      pid: typeof parsed.pid === "number" ? parsed.pid : null,
      ts: parsed.ts,
      ageSeconds,
    };
  } catch (e) {
    warnings.push(`manager heartbeat unreadable: ${errMessage(e)}`);
    return dead;
  }
}

function heartbeatIntervalFrom(merged: unknown): number {
  if (!merged || typeof merged !== "object") return DEFAULT_HEARTBEAT_INTERVAL_S;
  const manager = (merged as Record<string, unknown>).manager;
  if (!manager || typeof manager !== "object") return DEFAULT_HEARTBEAT_INTERVAL_S;
  const v = (manager as Record<string, unknown>).heartbeat_interval_s;
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  return DEFAULT_HEARTBEAT_INTERVAL_S;
}

function findOvernightReport(
  fs: NextFs,
  repoRoot: string,
  now: Date,
): string | null {
  const reportsAbs = join(repoRoot, ".devx-cache", "reports");
  if (!fs.exists(reportsAbs)) return null;
  let best: { name: string; mtime: number } | null = null;
  let names: string[];
  try {
    names = fs.readdir(reportsAbs);
  } catch {
    return null;
  }
  for (const name of names) {
    if (!name.endsWith(".md")) continue;
    let mtime: number;
    try {
      mtime = fs.statMtimeMs(join(reportsAbs, name));
    } catch {
      continue;
    }
    if (now.getTime() - mtime > OVERNIGHT_REPORT_WINDOW_MS) continue;
    if (best === null || mtime > best.mtime || (mtime === best.mtime && name > best.name)) {
      best = { name, mtime };
    }
  }
  return best !== null ? `.devx-cache/reports/${best.name}` : null;
}

// ---------------------------------------------------------------------------
// Own PRs + CI (rows 2–3)
// ---------------------------------------------------------------------------

const BRANCH_HASH_RE =
  /(?:^|\/)(dev|plan|test|debug|focus|learn|qa)-([a-z0-9]{3,12})$/i;

interface GhRollupItem {
  conclusion?: unknown;
  status?: unknown;
  state?: unknown;
}

interface GhPr {
  number?: unknown;
  headRefName?: unknown;
  url?: unknown;
  statusCheckRollup?: unknown;
}

function gatherOwnPrs(
  exec: Exec,
  repoRoot: string,
  warnings: string[],
): OwnPrSignal[] {
  const r = exec(
    "gh",
    [
      "pr",
      "list",
      "--author",
      "@me",
      "--state",
      "open",
      "--json",
      "number,headRefName,url,statusCheckRollup",
    ],
    { cwd: repoRoot },
  );
  if (r.exitCode !== 0) {
    warnings.push(
      `gh pr list failed (exit ${r.exitCode}): ${r.stderr.trim() || "(no stderr)"} — rows 2–3 skipped`,
    );
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(r.stdout.trim() || "[]");
  } catch (e) {
    warnings.push(`gh pr list returned malformed JSON (${errMessage(e)}) — rows 2–3 skipped`);
    return [];
  }
  if (!Array.isArray(parsed)) {
    warnings.push("gh pr list returned a non-array — rows 2–3 skipped");
    return [];
  }
  const out: OwnPrSignal[] = [];
  for (const raw of parsed as GhPr[]) {
    if (!raw || typeof raw !== "object") continue;
    const number = typeof raw.number === "number" ? raw.number : null;
    const branch = typeof raw.headRefName === "string" ? raw.headRefName : null;
    if (number === null || branch === null) continue;
    const url = typeof raw.url === "string" ? raw.url : "";
    const ci = rollupToCi(raw.statusCheckRollup);
    const hashMatch = BRANCH_HASH_RE.exec(branch);
    out.push({
      number,
      branch,
      url,
      ci,
      specType: hashMatch ? hashMatch[1].toLowerCase() : null,
      hash: hashMatch ? hashMatch[2].toLowerCase() : null,
    });
  }
  return out;
}

const RED_CONCLUSIONS = new Set([
  "FAILURE",
  "TIMED_OUT",
  "CANCELLED",
  "ACTION_REQUIRED",
  "STARTUP_FAILURE",
  "STALE",
]);
const OK_CONCLUSIONS = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);

/**
 * Fold a gh `statusCheckRollup` array to one CI state. Handles both item
 * shapes gh emits: CheckRun (`status` + `conclusion`) and StatusContext
 * (`state`). Unknown shapes count as pending — the fail-safe direction
 * (we neither fix-forward nor merge on a signal we can't read).
 */
export function rollupToCi(rollup: unknown): CiState {
  if (!Array.isArray(rollup) || rollup.length === 0) return "none";
  let sawRed = false;
  let sawPending = false;
  let sawOk = false;
  for (const raw of rollup as GhRollupItem[]) {
    if (!raw || typeof raw !== "object") {
      sawPending = true;
      continue;
    }
    if (typeof raw.state === "string" && raw.state !== "") {
      // StatusContext shape.
      const st = raw.state.toUpperCase();
      if (st === "FAILURE" || st === "ERROR") sawRed = true;
      else if (st === "SUCCESS") sawOk = true;
      else sawPending = true;
      continue;
    }
    const conclusion =
      typeof raw.conclusion === "string" ? raw.conclusion.toUpperCase() : "";
    const status = typeof raw.status === "string" ? raw.status.toUpperCase() : "";
    if (conclusion !== "") {
      if (RED_CONCLUSIONS.has(conclusion)) sawRed = true;
      else if (OK_CONCLUSIONS.has(conclusion)) sawOk = true;
      else sawPending = true;
    } else if (status !== "" && status !== "COMPLETED") {
      sawPending = true;
    } else {
      sawPending = true;
    }
  }
  if (sawRed) return "red";
  if (sawPending) return "pending";
  return sawOk ? "green" : "none";
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function repoRel(p: string, repoRoot: string): string {
  return p.startsWith(repoRoot + "/") ? p.slice(repoRoot.length + 1) : p;
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
