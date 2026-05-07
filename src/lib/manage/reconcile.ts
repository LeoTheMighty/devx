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
import type { ManagerState, RosterEntry } from "./state.js";

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

export interface ReconcileResult {
  desiredSpawns: DesiredSpawn[];
  desiredKills: DesiredKill[];
  statusLogUpdates: StatusLogUpdate[];
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
}

const DEFAULT_MODEL = "claude-sonnet-4-6";

// ---------------------------------------------------------------------------
// Reconcile
// ---------------------------------------------------------------------------

export function reconcile(
  state: ManagerState,
  snapshot: BacklogSnapshot,
  opts: ReconcileOpts = {},
): ReconcileResult {
  const roster = state?.roster ?? [];
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

  // ── Compute candidate spawn ────────────────────────────────────────────
  // Living roster = roster entries we're NOT killing this tick.
  const killedPids = new Set(desiredKills.map((k) => k.pid));
  const livingRoster = roster.filter((r) => !killedPids.has(r.pid));

  if (livingRoster.length >= HARD_CAP_PHASE_1) {
    return { desiredSpawns: [], desiredKills, statusLogUpdates };
  }

  // Eligible specs: status === "ready", not already in roster, all
  // blocked_by hashes resolved (status === "done" — superseded/deleted
  // counts as "not blocking" since the dependency is settled). In-progress
  // dependencies are still blocking — we wait for them to land.
  const rosterHashes = new Set(livingRoster.map((r) => r.spec_hash));
  const candidate = pickSpawnCandidate(snapshot.dev, devByHash, rosterHashes);
  if (!candidate) {
    return { desiredSpawns: [], desiredKills, statusLogUpdates };
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

  return { desiredSpawns, desiredKills, statusLogUpdates };
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
    if (canonical.status !== "ready") continue;
    if (rosterHashes.has(canonical.hash)) continue;
    if (canonical.struck) continue;
    if (!blockersResolved(canonical, devByHash)) continue;
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
