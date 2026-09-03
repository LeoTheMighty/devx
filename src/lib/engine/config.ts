// Defensive `engine.*` config reads (v2e101).
//
// The `engine:` block does NOT exist in devx.config.yaml or the schema yet —
// v2x101 adds it (v2/02-engine.md §7 is the target shape). Until then every
// engine primitive reads its knobs through this narrowing helper so a config
// with no `engine:` key (i.e. every project today) resolves to the design
// defaults, and a partially-populated block fills in only what it names.
//
// Spec: dev/dev-v2e101-2026-07-05T13:01-engine-cli-primitives.md

import {
  DEFAULT_DOCS_LAYOUT,
  resolveDocsLayout,
  type DocsLayout,
  type LayoutSource,
} from "./artifacts.js";

export interface EngineConfig {
  workstreamsRoot: string;
  /** Where a CLOSED doc set is moved by `devx archive` (arc101). Read here
   *  and nowhere else, which is the point: the key has been written into
   *  every config `devx init` produces since it existed, and until arc101
   *  nothing read it — a documented knob that did nothing. */
  archiveRoot: string;
  expectationsMin: number;
  proseBudgetKb: number;
  /** Column set for the design human render's Reading Guide (§31 port).
   *  Defaults to the plan-stage critique lenses so the document is mapped in
   *  a vocabulary the repo already uses, rather than a parallel one. */
  readingGuideRoles: string[];
  /** The artifact tree's SHAPE (docs/CONFIG.md §15). Carried here because
   *  every `resolveWorkstream` / `resolveSpecWorkstream` call site already
   *  threads this object whole — so the layout arrives without a new
   *  parameter anywhere, and cannot be forgotten at a call site. */
  docsLayout: DocsLayout;
  /** Where `docsLayout` came from. `default` means nobody ever chose one,
   *  which is what `devx next`'s advisory nag asks about — so the question is
   *  answered from this ONE resolution rather than by re-reading the config. */
  layoutSource: LayoutSource;
}

/** Frozen, and its one array with it. `{ ...ENGINE_DEFAULTS }` is a SHALLOW
 *  copy, so every config derived from it — and every test fixture spreading it
 *  — shares this exact `readingGuideRoles` instance. Nothing mutates it in
 *  place today; freezing is what keeps that true, because a single `push()`
 *  would otherwise leak into every later caller in the process. */
export const ENGINE_DEFAULTS: EngineConfig = Object.freeze({
  workstreamsRoot: "_devx/workstreams",
  archiveRoot: "_devx/archive",
  expectationsMin: 3,
  proseBudgetKb: 60,
  readingGuideRoles: Object.freeze(["pm", "architect", "dev", "qa"]) as string[],
  docsLayout: DEFAULT_DOCS_LAYOUT,
  layoutSource: "default",
});

/**
 * Narrow a merged-config blob (from config-io loadMerged, or any object)
 * down to the engine knobs, falling back per-key to ENGINE_DEFAULTS.
 * Malformed values (non-string root, non-positive numbers) fall back too —
 * the engine must never crash on a half-typed config edit.
 */
export function engineConfigFrom(merged: unknown): EngineConfig {
  // The spread is shallow, so the array is copied explicitly — otherwise every
  // returned config aliases the frozen default and a caller assigning into it
  // would throw rather than get its own list.
  const out: EngineConfig = {
    ...ENGINE_DEFAULTS,
    readingGuideRoles: [...ENGINE_DEFAULTS.readingGuideRoles],
  };
  // ABOVE both guards, and the ordering is load-bearing. `resolveDocsLayout()`
  // reads TWO sections — `engine.docs_layout` and the legacy
  // `personalization["docs.layout"]` — so a repo that answered only the legacy
  // key has no `engine:` block at all, and the second guard below would drop
  // its layout on the floor. The resolver is defensive on both reads, which is
  // what makes calling it up here safe.
  const layout = resolveDocsLayout(merged);
  out.docsLayout = layout.layout;
  out.layoutSource = layout.source;
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
  if (typeof e.archive_root === "string" && e.archive_root.trim() !== "") {
    out.archiveRoot = e.archive_root.trim().replace(/\/+$/, "");
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
  if (Array.isArray(e.reading_guide_roles)) {
    // Non-string / blank entries are dropped rather than rendered as empty
    // columns; an all-blank list falls back to the default set, because a
    // Reading Guide with no role columns is a table of contents that lost
    // the half that makes it a routing map.
    const roles = e.reading_guide_roles
      .filter((r): r is string => typeof r === "string")
      .map((r) => r.trim())
      .filter((r) => r !== "");
    if (roles.length > 0) out.readingGuideRoles = roles;
  }
  return out;
}
