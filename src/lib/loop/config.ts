// Defensive `loop:` config reads + the mode gate for `devx loop` (v2l101).
//
// Mirrors the engineConfigFrom pattern (src/lib/engine/config.ts): a merged
// config blob in, a fully-defaulted LoopConfig out. Malformed / missing keys
// fall back per-key — the loop must never crash on a half-typed config edit,
// and a fresh project with no `loop:` block gets the design defaults from
// v2/04-overnight-loop.md §3.
//
// Mode gate (D-6, v2/07-decisions.md): `devx loop` is disabled ENTIRELY in
// LOCKDOWN. The loop's trust model is transactional git + worktrees +
// merge-gate + harness permissions — but LOCKDOWN means "nothing ships until
// this is resolved", and an unattended loop is the opposite of that. Every
// other mode may run the loop; per-PR behavior differences (what blocks the
// merge) stay downstream in `mergeGateFor` — the loop itself doesn't fork on
// YOLO/BETA/PROD.
//
// Spec: dev/dev-v2l101-2026-07-05T13:06-overnight-loop.md
// Design: v2/04-overnight-loop.md §3

export interface LoopConfig {
  maxIterationsPerItem: number;
  maxTokensPerItem: number;
  maxConsecutiveFailures: number;
  maxItems: number;
  maxTotalTokens: number;
  /** Exponential-ish backoff for hard errors — index by consecutive-errors-1,
   *  clamped to the last entry. */
  backoffMs: number[];
}

export const LOOP_DEFAULTS: LoopConfig = {
  maxIterationsPerItem: 8,
  maxTokensPerItem: 2_000_000,
  maxConsecutiveFailures: 3,
  maxItems: 10,
  maxTotalTokens: 10_000_000,
  backoffMs: [60_000, 120_000, 240_000],
};

/** 3 consecutive abandoned items ⇒ stop the whole loop (v2/04 §3 — systemic
 *  problem; don't churn the entire backlog into blocked). Not configurable:
 *  it's a safety rail, not a budget. */
export const MAX_CONSECUTIVE_ABANDONED_ITEMS = 3;

function posInt(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const n = Math.floor(v);
  return n >= 1 ? n : null;
}

/**
 * Narrow a merged-config blob down to the loop knobs, falling back per-key
 * to LOOP_DEFAULTS. Non-positive / non-finite numbers fall back (a budget of
 * zero would make the loop a no-op that still claims work — reject it).
 * backoff_ms entries are filtered to non-negative finite numbers; an array
 * that filters to empty falls back whole (same posture as reconcile's
 * normalizeBackoff).
 */
export function loopConfigFrom(merged: unknown): LoopConfig {
  const out: LoopConfig = { ...LOOP_DEFAULTS, backoffMs: [...LOOP_DEFAULTS.backoffMs] };
  if (!merged || typeof merged !== "object" || Array.isArray(merged)) return out;
  const loop = (merged as Record<string, unknown>).loop;
  if (!loop || typeof loop !== "object" || Array.isArray(loop)) return out;
  const l = loop as Record<string, unknown>;

  const iters = posInt(l.max_iterations_per_item);
  if (iters !== null) out.maxIterationsPerItem = iters;
  const perItemTokens = posInt(l.max_tokens_per_item);
  if (perItemTokens !== null) out.maxTokensPerItem = perItemTokens;
  const consecutive = posInt(l.max_consecutive_failures);
  if (consecutive !== null) out.maxConsecutiveFailures = consecutive;
  const items = posInt(l.max_items);
  if (items !== null) out.maxItems = items;
  const totalTokens = posInt(l.max_total_tokens);
  if (totalTokens !== null) out.maxTotalTokens = totalTokens;

  if (Array.isArray(l.backoff_ms)) {
    const cleaned = l.backoff_ms.filter(
      (n): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0,
    );
    if (cleaned.length > 0) out.backoffMs = cleaned;
  }
  return out;
}

/** Bounds for the loop's state.json heartbeat cadence (review finding
 *  LOW-15). Lower bound keeps a garbage config from busy-writing state.json;
 *  upper bound keeps `devx next`'s freshness window (interval × 3) from
 *  growing so large a dead loop looks alive for hours. */
export const HEARTBEAT_MIN_S = 5;
export const HEARTBEAT_MAX_S = 600;
export const HEARTBEAT_DEFAULT_S = 60;

/**
 * Derive the loop's heartbeat interval (ms) from
 * `manager.heartbeat_interval_s` — the SAME knob `devx next` reads to size
 * its liveness freshness window (src/lib/next/gather.ts, window =
 * interval × 3). Deriving both from one knob means a config edit can't put
 * the writer's cadence outside the reader's window and flap a live loop
 * between running/dead. Non-numeric / non-positive values fall back to the
 * 60s default; valid values clamp to [HEARTBEAT_MIN_S, HEARTBEAT_MAX_S].
 */
export function heartbeatIntervalMsFrom(merged: unknown): number {
  let seconds = HEARTBEAT_DEFAULT_S;
  if (merged && typeof merged === "object" && !Array.isArray(merged)) {
    const manager = (merged as Record<string, unknown>).manager;
    if (manager && typeof manager === "object" && !Array.isArray(manager)) {
      const v = (manager as Record<string, unknown>).heartbeat_interval_s;
      if (typeof v === "number" && Number.isFinite(v) && v > 0) {
        seconds = Math.min(Math.max(v, HEARTBEAT_MIN_S), HEARTBEAT_MAX_S);
      }
    }
  }
  return Math.round(seconds * 1000);
}

export interface LoopModeGate {
  allowed: boolean;
  /** Normalized (uppercased) mode string read from the config. */
  mode: string;
  /** Populated when `allowed` is false. */
  reason?: string;
}

/**
 * D-6: LOCKDOWN disables `devx loop` entirely. And the gate FAILS CLOSED on
 * an unreadable config or a missing/garbage `mode:` key (EC-HIGH-2): the
 * loop is UNATTENDED auto-merge machinery — defaulting a broken config to
 * YOLO would silently run the most permissive gate all night on what might
 * be a BETA/PROD project whose config just got a bad edit. `mode` is a
 * required schema key; a human fixes it in daylight and reruns.
 */
export function loopModeGate(merged: unknown): LoopModeGate {
  if (!merged || typeof merged !== "object" || Array.isArray(merged)) {
    return {
      allowed: false,
      mode: "UNKNOWN",
      reason:
        "devx.config.yaml is missing or unreadable — refusing to run the unattended loop (fail closed)",
    };
  }
  const raw = (merged as Record<string, unknown>).mode;
  if (typeof raw !== "string" || raw.trim() === "") {
    return {
      allowed: false,
      mode: "UNKNOWN",
      reason:
        "config has no readable `mode:` — refusing to run the unattended loop (fail closed; mode is a required key)",
    };
  }
  const mode = raw.trim().toUpperCase();
  if (mode === "LOCKDOWN") {
    return {
      allowed: false,
      mode,
      reason:
        "devx loop is disabled in LOCKDOWN mode (D-6) — resolve the incident and exit LOCKDOWN first (/devx-mode resume)",
    };
  }
  return { allowed: true, mode };
}
