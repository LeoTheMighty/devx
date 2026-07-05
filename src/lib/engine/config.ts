// Defensive `engine.*` config reads (v2e101).
//
// The `engine:` block does NOT exist in devx.config.yaml or the schema yet —
// v2x101 adds it (v2/02-engine.md §7 is the target shape). Until then every
// engine primitive reads its knobs through this narrowing helper so a config
// with no `engine:` key (i.e. every project today) resolves to the design
// defaults, and a partially-populated block fills in only what it names.
//
// Spec: dev/dev-v2e101-2026-07-05T13:01-engine-cli-primitives.md

export interface EngineConfig {
  workstreamsRoot: string;
  expectationsMin: number;
  proseBudgetKb: number;
}

export const ENGINE_DEFAULTS: EngineConfig = {
  workstreamsRoot: "_devx/workstreams",
  expectationsMin: 3,
  proseBudgetKb: 60,
};

/**
 * Narrow a merged-config blob (from config-io loadMerged, or any object)
 * down to the engine knobs, falling back per-key to ENGINE_DEFAULTS.
 * Malformed values (non-string root, non-positive numbers) fall back too —
 * the engine must never crash on a half-typed config edit.
 */
export function engineConfigFrom(merged: unknown): EngineConfig {
  const out: EngineConfig = { ...ENGINE_DEFAULTS };
  if (!merged || typeof merged !== "object" || Array.isArray(merged)) {
    return out;
  }
  const engine = (merged as Record<string, unknown>).engine;
  if (!engine || typeof engine !== "object" || Array.isArray(engine)) {
    return out;
  }
  const e = engine as Record<string, unknown>;
  if (typeof e.workstreams_root === "string" && e.workstreams_root.trim() !== "") {
    out.workstreamsRoot = e.workstreams_root.trim().replace(/\/+$/, "");
  }
  if (
    typeof e.expectations_min === "number" &&
    Number.isFinite(e.expectations_min) &&
    e.expectations_min >= 1
  ) {
    out.expectationsMin = Math.floor(e.expectations_min);
  }
  if (
    typeof e.prose_budget_kb === "number" &&
    Number.isFinite(e.prose_budget_kb) &&
    e.prose_budget_kb > 0
  ) {
    out.proseBudgetKb = e.prose_budget_kb;
  }
  return out;
}
