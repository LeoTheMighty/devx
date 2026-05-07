// Pure reconcile function for the manager loop (mgr103).
//
// Given current manager state (manager.json roster) + a parsed backlog
// snapshot (DEV.md + INTERVIEW.md + MANUAL.md), compute the diff:
//
//   desiredSpawns      — at most one (spec_hash, worker_class, model). Empty
//                        if hard cap full or no eligible spec.
//   desiredKills       — PIDs whose target spec is now done/blocked/deleted/
//                        superseded; mgr105+ executes the actual kill.
//   statusLogUpdates   — point-in-time (spec_hash, line) directives the
//                        Manager observed (e.g. INTERVIEW Q answered →
//                        target spec unblocked). mgr104+ consumes these to
//                        flip spec frontmatter; emitted idempotently every
//                        tick the predicate holds.
//
// Pure function — no I/O. State + snapshot in, structured diff out. The
// tick driver (mgr104+ loop.ts) is responsible for reading + writing files;
// reconcile() does no fs / process / time access.
//
// Hard cap: HARD_CAP_PHASE_1 = 1, exported with the locked comment block
// below. Phase 3 epic-capacity-management replaces this with
// `capacity.max_concurrent` from devx.config.yaml; until then the cap is
// load-bearing for "bootstrap doesn't accidentally fork-bomb itself."
//
// Spec: dev/dev-mgr103-2026-04-28T19:30-manage-reconcile.md
// Epic: _bmad-output/planning-artifacts/epic-devx-manage-minimal.md

import {
  type BacklogSnapshot,
  type DevRow,
  type SpecType,
} from "../backlog/parse.js";
import type { CrashRecord, ManagerState, RosterEntry } from "./state.js";

// ---------------------------------------------------------------------------
// Phase 1 hard cap
//
// Phase 1: hard cap. Phase 3 epic-capacity-management replaces this with
// `capacity.max_concurrent` from devx.config.yaml. Do not change without
// bumping the phase reference.
// ---------------------------------------------------------------------------

export const HARD_CAP_PHASE_1 = 1;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type WorkerClass = SpecType;

export interface DesiredSpawn {
  spec_hash: string;
  worker_class: WorkerClass;
  model: string;
}

export type KillReason = "done" | "blocked" | "deleted" | "superseded" | "absent";

export interface DesiredKill {
  pid: number;
  spec_hash: string;
  reason: KillReason;
}

export interface StatusLogUpdate {
  spec_hash: string;
  line: string;
}

/**
 * mgr105 — instructs the loop to mark a spec `blocked` (DEV.md `[/]`→`[-]`,
 * spec frontmatter status, status-log line, INTERVIEW.md entry) because its
 * `crash_count` reached `manager.max_restarts_per_spec`. Reconcile stays pure;
 * the loop does the file edits.
 */
export interface DesiredBlocking {
  spec_hash: string;
  crash_count: number;
  last_exit_code: number | string;
}

export interface ReconcileResult {
  desiredSpawns: DesiredSpawn[];
  desiredKills: DesiredKill[];
  statusLogUpdates: StatusLogUpdate[];
  /** mgr105+: max-restarts-per-spec exceeded. */
  desiredBlocking: DesiredBlocking[];
}

export interface ReconcileOpts {
  /**
   * Worker model identifier injected into desired spawns. Defaults to
   * `claude-sonnet-4-6` (devx.config.yaml capacity.models.dev). Loop driver
   * is expected to plumb through from config.
   */
  defaultModel?: string;
  /**
   * If true, treat a roster entry whose spec is no longer in DEV.md as a
   * kill candidate (reason "absent"). Defaults to false — Phase 1 prefers
   * leaving an in-flight worker alone if its DEV.md row temporarily
   * disappeared (mid-edit), and the next tick reconciles. Tests cover both.
   */
  killAbsent?: boolean;
  /**
   * mgr105 — `manager.max_restarts_per_spec` (default 5). After this many
   * consecutive crashes on the same spec, reconcile emits a desiredBlocking
   * action instead of a desiredSpawn.
   */
  maxRestarts?: number;
  /**
   * mgr105 — `manager.worker_crash_backoff_s` (default `[10, 30, 90, 300]`).
   * Index = `min(crash_count - 1, len - 1)`. A spec with `crash_count > 0`
   * is only spawnable when wall-clock `now >= last_exit_at + backoffSeconds[i]`.
   */
  backoffSeconds?: number[];
  /**
   * mgr105 — wall-clock injection for backoff arithmetic. Defaults to
   * `() => new Date()`. Tests pass a fake clock to drive deterministic
   * crash-cycle assertions without sleeping.
   */
  now?: () => Date;
}

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_RESTARTS = 5;
const DEFAULT_BACKOFF_SECONDS: readonly number[] = [10, 30, 90, 300];

// ---------------------------------------------------------------------------
// Reconcile
// ---------------------------------------------------------------------------

export function reconcile(
  state: ManagerState,
  snapshot: BacklogSnapshot,
  opts: ReconcileOpts = {},
): ReconcileResult {
  const roster = state?.roster ?? [];
  const crashes = state?.crashes ?? [];
  const crashByHash = new Map<string, CrashRecord>();
  for (const c of crashes) {
    if (!crashByHash.has(c.spec_hash)) crashByHash.set(c.spec_hash, c);
  }
  const devByHash = new Map<string, DevRow>();
  for (const row of snapshot.dev) {
    // First-write-wins: if a hash appears twice in DEV.md (shouldn't happen
    // in practice but a hand-edit could produce it), prefer the earlier row
    // since that's the canonical entry. Defends against duplicate-row
    // hand-edits during a fix-forward.
    if (!devByHash.has(row.hash)) devByHash.set(row.hash, row);
  }

  // ── Compute kills ──────────────────────────────────────────────────────
  const desiredKills: DesiredKill[] = [];
  for (const entry of roster) {
    const row = devByHash.get(entry.spec_hash);
    if (!row) {
      if (opts.killAbsent) {
        desiredKills.push({
          pid: entry.pid,
          spec_hash: entry.spec_hash,
          reason: "absent",
        });
      }
      continue;
    }
    const reason = killReasonForStatus(row.status);
    if (reason) {
      desiredKills.push({
        pid: entry.pid,
        spec_hash: entry.spec_hash,
        reason,
      });
    }
  }

  // ── Compute status-log updates (unblock detection) ─────────────────────
  // Idempotent point-in-time emission: every tick a predicate holds, emit
  // the line. mgr104+ tick driver dedups by reading the spec's status log
  // before appending. Reconcile stays pure.
  const statusLogUpdates: StatusLogUpdate[] = [];

  // INTERVIEW Q answered → blocks list contains a currently-blocked spec.
  for (const q of snapshot.interview) {
    if (!q.answered) continue;
    for (const hash of q.blocks) {
      const row = devByHash.get(hash);
      if (!row || row.status !== "blocked") continue;
      statusLogUpdates.push({
        spec_hash: hash,
        line: `manager: detected INTERVIEW Q#${q.qNum} answered → spec ${pathOrHash(row, hash)} unblocked`,
      });
    }
  }

  // MANUAL item checked → blocks list contains a currently-blocked spec.
  for (const m of snapshot.manual) {
    if (!m.checked) continue;
    for (const hash of m.blocks) {
      const row = devByHash.get(hash);
      if (!row || row.status !== "blocked") continue;
      statusLogUpdates.push({
        spec_hash: hash,
        line: `manager: detected MANUAL ${m.id} checked → spec ${pathOrHash(row, hash)} unblocked`,
      });
    }
  }

  // ── Compute desiredBlocking + filter spawn-eligibility (mgr105) ────────
  // For every spec with a crash record + status the manager is responsible
  // for (ready OR in-progress with a stale claim — see "stale claim
  // restart" note below): if its crash_count has hit max_restarts, emit a
  // desiredBlocking action; the loop applies the file edits + clears the
  // crash record. Iteration order is DEV.md row order so the loop's
  // INTERVIEW.md write order matches what users see in the backlog.
  //
  // Stale-claim restart: a spec marked `[/]` in-progress with a crashes
  // record is the post-crash state — `/devx`'s claim flipped DEV.md to
  // `[/]`, the worker died, the manager's on-exit handler stamped a
  // crashes entry, and the DEV.md row never reverted. The manager owns
  // the respawn (and the eventual blocking) for these. Specs in-progress
  // WITHOUT a crash record are owned by the live `/devx` session — leave
  // those alone.
  const desiredBlocking: DesiredBlocking[] = [];
  const maxRestarts = clampMaxRestarts(opts.maxRestarts);
  const backoff = normalizeBackoff(opts.backoffSeconds);
  const nowFn = opts.now ?? (() => new Date());
  const blockingHashes = new Set<string>();
  const seenForBlocking = new Set<string>();
  for (const row of snapshot.dev) {
    if (seenForBlocking.has(row.hash)) continue;
    seenForBlocking.add(row.hash);
    const canonical = devByHash.get(row.hash) ?? row;
    if (canonical.struck) continue;
    const c = crashByHash.get(canonical.hash);
    if (!c) continue;
    if (canonical.status !== "ready" && canonical.status !== "in-progress") continue;
    if (c.crash_count >= maxRestarts) {
      desiredBlocking.push({
        spec_hash: canonical.hash,
        crash_count: c.crash_count,
        last_exit_code: c.last_exit_code,
      });
      blockingHashes.add(canonical.hash);
    }
  }

  // ── Compute candidate spawn ────────────────────────────────────────────
  // Living roster = roster entries we're NOT killing this tick.
  const killedPids = new Set(desiredKills.map((k) => k.pid));
  const livingRoster = roster.filter((r) => !killedPids.has(r.pid));

  if (livingRoster.length >= HARD_CAP_PHASE_1) {
    return {
      desiredSpawns: [],
      desiredKills,
      statusLogUpdates,
      desiredBlocking,
    };
  }

  // Eligible specs: status === "ready", not already in roster, all
  // blocked_by hashes resolved (status === "done" — superseded/deleted
  // counts as "not blocking" since the dependency is settled). In-progress
  // dependencies are still blocking — we wait for them to land. mgr105
  // adds two extra filters: maxed-out crashed specs (about to be blocked
  // this tick) and specs inside their backoff window.
  const rosterHashes = new Set(livingRoster.map((r) => r.spec_hash));
  const nowMs = nowFn().getTime();
  const candidate = pickSpawnCandidate(
    snapshot.dev,
    devByHash,
    rosterHashes,
    crashByHash,
    blockingHashes,
    backoff,
    nowMs,
  );
  if (!candidate) {
    return {
      desiredSpawns: [],
      desiredKills,
      statusLogUpdates,
      desiredBlocking,
    };
  }

  // `||` not `??` — empty-string state.model (corrupt manager.json or schema
  // drift) would otherwise leak through to spawn as `--model ""` and fail
  // opaquely at child-process layer. Both reviewers (BH#16, EC#10) flagged.
  const desiredSpawns: DesiredSpawn[] = [
    {
      spec_hash: candidate.hash,
      worker_class: candidate.type,
      model: opts.defaultModel || state?.model || DEFAULT_MODEL,
    },
  ];

  return { desiredSpawns, desiredKills, statusLogUpdates, desiredBlocking };
}

/**
 * mgr105 — pure backoff-window predicate. Exposed for direct unit testing
 * per Murat-lens AC: "backoff respect is unit-tested via reconcile.ts's pure
 * decision (given `{last_exit_at, crash_count, now}` → 'spawn' or 'wait')."
 *
 * Returns `"spawn"` if the spec's backoff window has elapsed (or the spec
 * has no crash record / zero crashes), `"wait"` otherwise. Treats malformed
 * `last_exit_at` strings as "spawn" (fail-open) — a corrupted record
 * shouldn't permanently park a spec; the next exit refreshes the field.
 */
export function backoffDecision(input: {
  crash: CrashRecord | null | undefined;
  now: number;
  backoffSeconds?: number[];
}): "spawn" | "wait" {
  if (!input.crash) return "spawn";
  if (input.crash.crash_count <= 0) return "spawn";
  const backoff = normalizeBackoff(input.backoffSeconds);
  const idx = Math.min(input.crash.crash_count - 1, backoff.length - 1);
  const waitS = backoff[idx];
  const last = Date.parse(input.crash.last_exit_at);
  if (!Number.isFinite(last)) return "spawn";
  return input.now >= last + waitS * 1000 ? "spawn" : "wait";
}

function normalizeBackoff(input: number[] | undefined): number[] {
  if (!input || !Array.isArray(input) || input.length === 0) {
    return [...DEFAULT_BACKOFF_SECONDS];
  }
  // Filter out negatives / non-finite entries so a malformed config doesn't
  // collapse the wait window to zero (treating "wait -10s" as already
  // elapsed). If filtering empties the array, fall back to defaults.
  const cleaned = input.filter((n) => typeof n === "number" && Number.isFinite(n) && n >= 0);
  if (cleaned.length === 0) return [...DEFAULT_BACKOFF_SECONDS];
  return cleaned;
}

function clampMaxRestarts(input: number | undefined): number {
  // Reject undefined / NaN / negative values → use the project default.
  // Accept 0 by clamping to 1: a user who set `max_restarts_per_spec: 0`
  // meaning "block on first crash" gets that intent honored (count >= 1
  // → block at the first crash). Without this clamp, 0 silently fell
  // through to the default of 5 — BH-MED 5 silent-config-override.
  if (typeof input !== "number" || !Number.isFinite(input) || input < 0) {
    return DEFAULT_MAX_RESTARTS;
  }
  return Math.max(1, Math.floor(input));
}

// ---------------------------------------------------------------------------
// Cap enforcement (programmatic-bypass guard)
//
// Used by mgr104's spawn driver as a belt-and-suspenders check: if the
// caller ever attempts to spawn beyond HARD_CAP_PHASE_1 (programmatic bug,
// concurrent reconcile race, …), throw before invoking child_process.spawn.
//
// AC #6 pins the EXACT error message — do not paraphrase. The format is:
//   "Phase 1 hard cap: cannot spawn second worker (running: <hash1>)"
// where <hash1> is the spec_hash of the first roster entry.
// ---------------------------------------------------------------------------

export function enforceHardCap(
  roster: RosterEntry[],
  desiredSpawns: DesiredSpawn[],
): void {
  const total = roster.length + desiredSpawns.length;
  if (total > HARD_CAP_PHASE_1) {
    const runningHash = roster[0]?.spec_hash ?? "unknown";
    throw new Error(
      `Phase 1 hard cap: cannot spawn second worker (running: ${runningHash})`,
    );
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function killReasonForStatus(status: DevRow["status"]): KillReason | null {
  switch (status) {
    case "done":
      return "done";
    case "blocked":
      return "blocked";
    case "deleted":
      return "deleted";
    case "superseded":
      return "superseded";
    default:
      return null;
  }
}

function pathOrHash(row: DevRow | undefined, hash: string): string {
  if (!row) return hash;
  // Spec stem = `<type>-<hash>` (matches the AC example "dev-a10004"). Type
  // is parameterized so non-dev rows (plan-, test-, debug-, ...) get the
  // correct stem instead of falling through to the bare hash. Blind Hunter
  // BH#11.
  const stemMatch = /\/([a-z]+-[a-z0-9]+)-/.exec(row.path);
  return stemMatch ? stemMatch[1] : hash;
}

function pickSpawnCandidate(
  dev: DevRow[],
  devByHash: Map<string, DevRow>,
  rosterHashes: Set<string>,
  crashByHash: Map<string, CrashRecord>,
  blockingHashes: Set<string>,
  backoffSeconds: number[],
  nowMs: number,
): DevRow | null {
  // First-write-wins on duplicates: skip any row whose hash already had a
  // canonical record stored (devByHash holds the first occurrence). This
  // ensures pathological hand-edits with two rows for the same hash don't
  // get spawned twice — and the candidate decision uses the canonical
  // status (e.g., a first-row "blocked" entry hides a second-row "ready").
  const seen = new Set<string>();
  for (const row of dev) {
    if (seen.has(row.hash)) continue;
    seen.add(row.hash);
    const canonical = devByHash.get(row.hash) ?? row;
    // mgr105 stale-claim restart: in-progress specs with a crash record
    // are eligible for spawn (the manager owns the respawn after the
    // worker died and the DEV.md row didn't revert). In-progress without
    // a crash record stays off-limits — that's a live `/devx` session.
    const crash = crashByHash.get(canonical.hash);
    if (canonical.status !== "ready") {
      if (canonical.status !== "in-progress") continue;
      if (!crash) continue;
    }
    if (rosterHashes.has(canonical.hash)) continue;
    if (canonical.struck) continue;
    if (!blockersResolved(canonical, devByHash)) continue;
    // mgr105: skip specs about to be blocked this tick (max-restarts
    // exceeded) — they're getting flipped to status=blocked by the loop.
    if (blockingHashes.has(canonical.hash)) continue;
    // mgr105: skip specs inside their post-crash backoff window. Caller
    // emits no statusLogUpdate here — the next exit (or successful run)
    // refreshes the picture; a wait window is the expected normal path.
    const decision = backoffDecision({
      crash,
      now: nowMs,
      backoffSeconds,
    });
    if (decision === "wait") continue;
    return canonical;
  }
  return null;
}

function blockersResolved(
  row: DevRow,
  devByHash: Map<string, DevRow>,
): boolean {
  for (const blocker of row.blocked_by) {
    const dep = devByHash.get(blocker);
    if (!dep) {
      // Unknown blocker — DEV.md doesn't list it. Conservative: treat as
      // unresolved so we don't spawn against a phantom dep. The user can
      // resolve by either (a) adding the blocker row, (b) removing the
      // blocked_by entry, (c) marking the blocker hash as `superseded` in
      // a known row. Same conservatism as PR-time validate-emit (pln103).
      return false;
    }
    // "done" / "deleted" / "superseded" all count as settled — the upstream
    // dependency is no longer blocking. "ready" / "in-progress" / "blocked"
    // still block (we wait for the upstream to ship before spawning).
    if (
      dep.status !== "done" &&
      dep.status !== "deleted" &&
      dep.status !== "superseded"
    ) {
      return false;
    }
  }
  return true;
}
