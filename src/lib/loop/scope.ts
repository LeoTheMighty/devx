// Loop scope model (mlc106) — design §Architecture 6, FR-6/CAP-6, UC-1/2/3.
//
// Five flags carve the backlog for one `devx loop` instance:
//
//   --epic <slug|plan-hash>   (repeatable)  by DEV.md `### Epic — …` section
//   --workstream <slug>       (repeatable)  by engine workstream membership
//   --items <h1,h2,…>                       an explicit ordered list
//   --exclude <hash|epic>     (repeatable)  subtractive
//   --focus <text>                          no masking; a worker directive
//
// THE LOAD-BEARING RULE: scope MASKS, it never DROPS. An out-of-scope row is
// rewritten to `blocked` and stays in the row set handed to reconcile, so
// cross-scope `Blocked-by:` edges keep holding — a scoped loop can never
// start item B because its blocker A happened to be filtered out of view.
// (Removal would flip dependents' blockers to "unknown", which reconcile
// also treats as unresolved, but silently and for the wrong reason.) The
// masking itself is applied by the caller through the SAME excluded-set
// mechanism `--only`/already-attempted rows use — see driver.ts pickNextItem.
//
// Within a dimension repeated flags UNION (`--epic a --epic b` = either);
// across dimensions they INTERSECT (`--epic a --workstream w` = both). That
// is the ordinary filter reading, and it is what makes `--items` a genuine
// restriction rather than an additive escape hatch.
//
// Spec: dev/dev-mlc106-2026-07-28T09:02-scope-model-flags.md
// Design: _devx/workstreams/multi-loop-concurrency/design/agent.md §Architecture 6

import { type DevRow, epicSlugify } from "../backlog/parse.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LoopScope {
  /** `--epic` values, normalized. Matches epicSlug OR epicPlanHash. */
  epics: string[];
  /** `--workstream` values, normalized slugs. */
  workstreams: string[];
  /** `--items` hashes, in the order the user typed them (pick order). */
  items: string[];
  /** `--exclude` values — a bare hash or an epic slug/plan-hash. */
  excludes: string[];
  /** `--focus` text, verbatim (only whitespace-trimmed). */
  focus: string | null;
}

export function emptyScope(): LoopScope {
  return { epics: [], workstreams: [], items: [], excludes: [], focus: null };
}

/** True when the scope actually narrows the backlog. `--focus` alone does
 *  NOT: it steers the worker, it does not carve the row set. */
export function scopeMasks(scope: LoopScope): boolean {
  return (
    scope.epics.length > 0 ||
    scope.workstreams.length > 0 ||
    scope.items.length > 0 ||
    scope.excludes.length > 0
  );
}

/** True when any scope dimension at all was supplied (masking or focus). */
export function scopeIsEmpty(scope: LoopScope): boolean {
  return !scopeMasks(scope) && scope.focus === null;
}

export interface CrossScopeBlock {
  /** The in-scope hash that cannot start. */
  hash: string;
  /** Out-of-scope, unfinished blocker hashes, in `blocked_by` order. */
  blockedBy: string[];
}

export interface ScopeMaskResult {
  /** Hashes the caller must mask to `blocked` (mask, never drop). */
  masked: ReadonlySet<string>;
  /**
   * Pick order the caller must impose, or null when scope doesn't dictate
   * one. Only `--items` produces an order — its whole point is "do these,
   * in this order" (AC 3).
   */
  order: string[] | null;
  /**
   * In-scope rows held up by an out-of-scope unfinished blocker. Reported —
   * never silently skipped — because from inside a scoped run the item just
   * looks stuck, and the blocking hash is the only actionable fact.
   */
  crossScopeBlocks: CrossScopeBlock[];
}

export interface ScopeMaskOpts {
  /**
   * Resolve a row's engine-workstream slug. Injected (not imported) so this
   * module stays pure — the driver supplies a cached, fs-backed resolver
   * built on the SAME `resolveSpecWorkstream` walk `devx next`'s gate uses.
   * Only consulted when `--workstream` is in play.
   */
  workstreamOf?: (row: DevRow) => string | null;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Normalize an `--epic` / `--exclude` token for comparison. Epic headings
 * carry display names (`Alpha Wave`); users type slugs (`alpha-wave`) or a
 * plan hash (`ab12cd`). Slugifying BOTH sides makes `--epic "Alpha Wave"`,
 * `--epic alpha-wave` and `--epic Alpha_Wave` the same argument (Q#13b:
 * accept slug or hash, normalized).
 */
export function normalizeScopeToken(token: string): string {
  return epicSlugify(token.trim());
}

/** Bare-hash shape, matching the backlog parser's own hash capture. */
const HASH_SHAPE_RE = /^[a-z0-9]{3,12}$/;

export function isHashShape(token: string): boolean {
  return HASH_SHAPE_RE.test(token.trim().toLowerCase());
}

function rowEpicKeys(row: DevRow): string[] {
  const keys: string[] = [];
  if (row.epicSlug != null && row.epicSlug !== "") keys.push(normalizeScopeToken(row.epicSlug));
  if (row.epicPlanHash != null && row.epicPlanHash !== "") {
    keys.push(normalizeScopeToken(row.epicPlanHash));
  }
  return keys;
}

// ---------------------------------------------------------------------------
// The mask
// ---------------------------------------------------------------------------

/**
 * Compute which rows fall outside `scope`, plus the pick order `--items`
 * dictates and any cross-scope blocker the caller must report.
 *
 * `rows` is the FULL row set (DEBUG.md + DEV.md, in the caller's pick
 * order) — blockers are looked up inside it, so passing a pre-filtered set
 * would reintroduce the very cross-scope hole this masks around.
 */
export function buildScopeMask(
  rows: readonly DevRow[],
  scope: LoopScope,
  opts: ScopeMaskOpts = {},
): ScopeMaskResult {
  if (!scopeMasks(scope)) {
    return { masked: new Set(), order: null, crossScopeBlocks: [] };
  }

  const epics = new Set(scope.epics.map(normalizeScopeToken));
  const workstreams = new Set(scope.workstreams.map(normalizeScopeToken));
  const items = new Set(scope.items.map((h) => h.trim().toLowerCase()));
  const excludes = new Set(scope.excludes.map(normalizeScopeToken));

  // Workstream resolution touches the filesystem once per spec; memoize so a
  // 200-row backlog costs 200 reads, not 200 × (rows scanned per blocker).
  const wsCache = new Map<string, string | null>();
  const wsOf = (row: DevRow): string | null => {
    if (opts.workstreamOf === undefined) return null;
    if (!wsCache.has(row.hash)) {
      let slug: string | null = null;
      try {
        slug = opts.workstreamOf(row);
      } catch {
        // Unreadable spec — treat as "no membership". A read failure must
        // not silently pull an unrelated item INTO a scoped run.
        slug = null;
      }
      wsCache.set(row.hash, slug === null ? null : normalizeScopeToken(slug));
    }
    return wsCache.get(row.hash) ?? null;
  };

  const inScope = (row: DevRow): boolean => {
    if (epics.size > 0 && !rowEpicKeys(row).some((k) => epics.has(k))) return false;
    if (workstreams.size > 0) {
      const slug = wsOf(row);
      if (slug === null || !workstreams.has(slug)) return false;
    }
    if (items.size > 0 && !items.has(row.hash.toLowerCase())) return false;
    if (excludes.size > 0) {
      if (excludes.has(normalizeScopeToken(row.hash))) return false;
      if (rowEpicKeys(row).some((k) => excludes.has(k))) return false;
    }
    return true;
  };

  const masked = new Set<string>();
  const kept: DevRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    // First-write-wins on duplicate hashes, matching reconcile's canonical
    // row choice — otherwise a hash listed in two backlogs could be both
    // masked and kept depending on iteration order.
    if (seen.has(row.hash)) continue;
    seen.add(row.hash);
    if (inScope(row)) kept.push(row);
    else masked.add(row.hash);
  }

  // ── Cross-scope blockers (AC 3) ───────────────────────────────────────
  // An in-scope row whose `Blocked-by:` names a masked row that has NOT
  // settled. `done` / `deleted` / `superseded` blockers are settled — those
  // never hold anything up, in or out of scope (reconcile's blockersResolved
  // uses the same three).
  const byHash = new Map<string, DevRow>();
  for (const row of rows) if (!byHash.has(row.hash)) byHash.set(row.hash, row);
  const settled = (r: DevRow): boolean =>
    r.status === "done" || r.status === "deleted" || r.status === "superseded";

  const crossScopeBlocks: CrossScopeBlock[] = [];
  for (const row of kept) {
    // Only `ready`, non-struck rows are reportable. Anything else would not
    // have been picked with or without the scope (reconcile skips struck
    // rows unconditionally and non-ready ones by status), so naming it here
    // blames the scope for a hold it didn't cause — and a noisy report is
    // one nobody reads.
    if (row.status !== "ready" || row.struck) continue;
    const blockers = row.blocked_by.filter((b) => {
      if (!masked.has(b)) return false;
      const dep = byHash.get(b);
      // Unknown blockers are a pre-existing backlog defect, not a scope
      // artifact — reconcile already refuses to spawn against a phantom dep
      // and `devx next` reports the drift. Don't claim scope caused it.
      return dep !== undefined && !settled(dep);
    });
    if (blockers.length > 0) crossScopeBlocks.push({ hash: row.hash, blockedBy: blockers });
  }

  // ── Order (AC 3) ──────────────────────────────────────────────────────
  // `--items` is the only dimension that dictates order: list order wins
  // over backlog order. Hashes the user listed that aren't in the row set
  // are dropped here (validation already refused them up front).
  const order =
    scope.items.length > 0
      ? scope.items
          .map((h) => h.trim().toLowerCase())
          .filter((h) => byHash.has(h) && !masked.has(h))
      : null;

  return { masked, order, crossScopeBlocks };
}

/**
 * Apply `order` to a row list: listed hashes first in list order, everything
 * else after in its original order. Non-listed rows are already masked, so
 * their relative order is cosmetic — keeping them present is what preserves
 * the blocker lookups.
 */
export function applyScopeOrder(
  rows: readonly DevRow[],
  order: string[] | null,
): DevRow[] {
  if (order === null || order.length === 0) return [...rows];
  const rank = new Map(order.map((h, i) => [h, i]));
  const listed: DevRow[] = [];
  const rest: DevRow[] = [];
  for (const row of rows) {
    if (rank.has(row.hash)) listed.push(row);
    else rest.push(row);
  }
  listed.sort(
    (a, b) => (rank.get(a.hash) ?? 0) - (rank.get(b.hash) ?? 0),
  );
  return [...listed, ...rest];
}

// ---------------------------------------------------------------------------
// Validation (fail fast — exit 4)
// ---------------------------------------------------------------------------

export interface ScopeValidationOpts {
  /** Non-fatal notices (unknown `--exclude` token, settled `--items` row). */
  warn?: (msg: string) => void;
  /**
   * Epic slugs/plan hashes declared by HEADINGS, including sections that
   * currently have no rows. Row-derived keys alone would refuse `--epic X`
   * for a real-but-empty section (review EC#8).
   */
  knownEpicKeys?: Iterable<string>;
  /** The active `--only` type filter, folded into the emptiness check so
   *  `--only dev --items <debug-hash>` is refused rather than idling. */
  only?: string | null;
}

/**
 * Validate a parsed scope against the parsed backlog. Returns the error
 * messages; a non-empty array means the caller exits 4 WITHOUT taking a
 * lock or writing anything (AC 4).
 *
 * Fatal (a typo here silently produces a run that does nothing, or the
 * wrong thing):
 *   - `--epic X` matching no row's epic slug or plan hash;
 *   - `--workstream W` matching no row's membership;
 *   - `--items` containing a non-hash-shaped token, or a hash absent from
 *     the backlog, or duplicates;
 *   - `--focus` that is empty/whitespace.
 *
 * Non-fatal, WARN only: `--exclude Y` matching nothing. Excluding an item
 * that isn't there is a no-op by definition and a legitimate belt-and-braces
 * habit in a wrapper script ("never touch this hash, whatever the backlog
 * says today") — refusing it would break the one usage that's actually
 * defensive. The WARN still surfaces the typo.
 */
export function validateScope(
  scope: LoopScope,
  rows: readonly DevRow[],
  opts: ScopeMaskOpts & ScopeValidationOpts = {},
): string[] {
  const errors: string[] = [];
  const epicKeys = new Set<string>();
  for (const row of rows) for (const k of rowEpicKeys(row)) epicKeys.add(k);
  for (const k of opts.knownEpicKeys ?? []) {
    const norm = normalizeScopeToken(k);
    if (norm !== "") epicKeys.add(norm);
  }
  const hashes = new Set(rows.map((r) => r.hash.toLowerCase()));

  for (const raw of scope.epics) {
    const key = normalizeScopeToken(raw);
    if (key === "") {
      errors.push(`--epic requires a non-empty slug or plan hash (got '${raw}')`);
    } else if (!epicKeys.has(key)) {
      errors.push(
        `--epic '${raw}' matches no \`### Epic — …\` section in DEV.md/DEBUG.md` +
          (epicKeys.size > 0
            ? ` (known: ${[...epicKeys].sort().join(", ")})`
            : " (no epic headings found)"),
      );
    }
  }

  if (scope.workstreams.length > 0) {
    const known = new Set<string>();
    for (const row of rows) {
      let slug: string | null = null;
      try {
        slug = opts.workstreamOf?.(row) ?? null;
      } catch {
        slug = null;
      }
      if (slug !== null && slug !== "") known.add(normalizeScopeToken(slug));
    }
    for (const raw of scope.workstreams) {
      const key = normalizeScopeToken(raw);
      if (key === "") {
        errors.push(`--workstream requires a non-empty slug (got '${raw}')`);
      } else if (!known.has(key)) {
        errors.push(
          `--workstream '${raw}' matches no backlog row's workstream membership` +
            (known.size > 0
              ? ` (known: ${[...known].sort().join(", ")})`
              : " (no rows resolve to an engine workstream)"),
        );
      }
    }
  }

  const seenItems = new Set<string>();
  for (const raw of scope.items) {
    const h = raw.trim().toLowerCase();
    if (h === "") {
      errors.push("--items contains an empty entry (check for a stray comma)");
      continue;
    }
    if (!isHashShape(h)) {
      errors.push(`--items entry '${raw}' is not a spec hash (expected 3-12 alphanumerics)`);
      continue;
    }
    if (seenItems.has(h)) {
      errors.push(`--items lists '${raw}' more than once — the pick order would be ambiguous`);
      continue;
    }
    seenItems.add(h);
    if (!hashes.has(h)) {
      errors.push(`--items entry '${raw}' is not in DEV.md or DEBUG.md`);
    }
  }

  // A `--items` list of already-settled rows is a night that claims nothing
  // and says nothing — the same "looks stuck from inside a scoped run"
  // failure AC 3 exists to eliminate, arriving by a different route.
  if (errors.length === 0 && scope.items.length > 0) {
    const byHash = new Map(rows.map((r) => [r.hash.toLowerCase(), r] as const));
    const settledItems = [...seenItems].filter((h) => {
      const r = byHash.get(h);
      return (
        r !== undefined &&
        (r.struck ||
          r.status === "done" ||
          r.status === "deleted" ||
          r.status === "superseded")
      );
    });
    if (settledItems.length === seenItems.size && seenItems.size > 0) {
      errors.push(
        `every --items entry is already settled (${settledItems.join(", ")}) — this run would claim nothing`,
      );
    } else if (settledItems.length > 0) {
      opts.warn?.(
        `--items entries already settled and therefore skipped: ${settledItems.join(", ")}`,
      );
    }
  }

  for (const raw of scope.excludes) {
    const key = normalizeScopeToken(raw);
    if (key === "") {
      errors.push(`--exclude requires a non-empty hash or epic slug (got '${raw}')`);
      continue;
    }
    // A path or a `dev-<hash>`/`.md` paste is MALFORMED, not merely unknown.
    // `--exclude` is the one flag whose whole job is "never touch this", so
    // degrading a malformed value to a warning means the loop cheerfully
    // claims the exact item the operator forbade (review BH#13). `--items`
    // already rejects the same shapes fatally via isHashShape.
    const rawTrimmed = raw.trim();
    if (
      !epicKeys.has(key) &&
      !hashes.has(key) &&
      (rawTrimmed.includes("/") || /\.md$/i.test(rawTrimmed))
    ) {
      errors.push(
        `--exclude '${raw}' looks like a spec path — pass the bare hash (e.g. 'mlc101') or an epic slug`,
      );
      continue;
    }
    if (!epicKeys.has(key) && !hashes.has(key)) {
      opts.warn?.(
        `--exclude '${raw}' matches no backlog row or epic — nothing to exclude (typo?)`,
      );
    }
  }

  if (scope.focus !== null && scope.focus.trim() === "") {
    errors.push("--focus requires non-empty text");
  }

  // ── Emptiness (the intersection check) ────────────────────────────────
  // Every check above validates ONE dimension against the raw backlog, but
  // the mask INTERSECTS them. `--epic alpha --items <hash-in-beta>`, or
  // `--items X --exclude X`, or `--only dev --items <debug-hash>` all pass
  // the per-dimension checks and then select zero rows: exit 0, lock taken,
  // instance registered, worker never spawned, and a report that says "0
  // attempted" with no reason. Refuse loudly instead — a scope that can
  // never claim anything is exactly the malformed-flags case AC 4 covers.
  // Skipped when earlier errors already explain the problem.
  if (errors.length === 0 && scopeMasks(scope)) {
    const mask = buildScopeMask(rows, scope, opts);
    const claimable = rows.filter(
      (r) =>
        !mask.masked.has(r.hash) &&
        !r.struck &&
        r.status !== "done" &&
        r.status !== "deleted" &&
        r.status !== "superseded" &&
        (opts.only == null || r.type === opts.only),
    );
    if (claimable.length === 0) {
      errors.push(
        `scope selects 0 of ${rows.length} backlog rows — no combination of the given flags can claim anything` +
          (opts.only != null ? ` (with --only ${opts.only})` : "") +
          "; widen or correct the scope",
      );
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * One-line scope descriptor — the SAME string in the instance file, the
 * `loop:start` event, the report header, and `devx next` row 1, so a human
 * comparing two surfaces never has to translate between them.
 *
 * Returns null for a fully unscoped run so every one of those surfaces keeps
 * its pre-mlc106 bytes (E-8: N=1 remains the degenerate case).
 */
export function describeScope(scope: LoopScope, only?: string | null): string | null {
  const parts: string[] = [];
  // NORMALIZED, not raw. Two loops scoped to the same epic via different
  // spellings (`--epic alpha-wave` vs `--epic "Alpha Wave"`) select the same
  // rows, so they must render the same descriptor — otherwise no surface can
  // show a human that the two runs overlap, which is the one thing these
  // descriptors exist to make visible. Normalizing also keeps every value
  // space-free, so the space-delimited grammar stays parseable (review
  // EC#5/BH#10); `focus` is the sole free-text part and is JSON-quoted.
  const norm = (vs: string[]): string =>
    vs.map(normalizeScopeToken).filter((v) => v !== "").join(",");
  if (only != null) parts.push(`only:${only}`);
  if (scope.epics.length > 0) parts.push(`epic:${norm(scope.epics)}`);
  if (scope.workstreams.length > 0) parts.push(`workstream:${norm(scope.workstreams)}`);
  if (scope.items.length > 0) {
    parts.push(`items:${scope.items.map((h) => h.trim().toLowerCase()).join(",")}`);
  }
  if (scope.excludes.length > 0) parts.push(`exclude:${norm(scope.excludes)}`);
  if (scope.focus !== null) parts.push(`focus:${JSON.stringify(scope.focus)}`);
  return parts.length > 0 ? parts.join(" ") : null;
}
