// Idempotent upgrade-mode re-run for `/devx-init` (ini507).
//
// Public surface:
//   - runInitUpgrade(opts) — orchestrates the upgrade flow:
//       1. Read existing devx.config.yaml; halt if missing or `devx_version`
//          is absent (corrupt path — manual review required).
//       2. Compare on-disk version to the package version; load + run
//          migrations whose `from` is >= the on-disk version (PRD addendum:
//          "skip migrations whose from-version < installed devx_version").
//       3. Compute the delta of new top-level keys for the version pair
//          (via a pluggable registry) and prompt only for those.
//       4. Detect + repair drifted surfaces: CLAUDE.md devx-block markers,
//          supervisor units, CI workflow, PR template, personas, INTERVIEW
//          seeding.
//       5. Emit the `kept N / added M / migrated K` summary line — `added`
//          counts include surfaces auto-repaired (per epic party-mode note),
//          not just new config keys.
//   - compareSemver(a, b) — pure: lexicographic semver compare returning
//       negative/zero/positive. Exported for tests + for callers (migration
//       loaders) that need to reorder/filter by version.
//
// Behavior:
//   - "Halted" is a hard stop (no repair, no migration). Caller surfaces an
//     INTERVIEW.md entry per spec — this module returns the reason and never
//     touches MANUAL.md or INTERVIEW.md itself (those writes belong to the
//     orchestrator that knows the broader narrative).
//   - "Same version" is NOT a no-op — surfaces drift independently of the
//     version (a user can hand-delete CLAUDE.md), so we always run the
//     repair phase. The summary's `migrated` will be 0 in that case.
//   - Migrations are pluggable. The default loader returns []; Phase 0 ships
//     no migrations on disk. When 0.2.0+ lands, the loader will scan
//     `_devx/migrations/<from>-<to>.{js,mjs}` and dynamic-import each
//     module's default `apply(doc)` export.
//   - Every surface check / repair is injectable so tests run hermetically.
//     Defaults wire through the existing ini502/ini503/ini505/ini504
//     entrypoints (writeInitFiles, writeInitGh, runInitSupervisor,
//     seedPersonas, seedInterview).
//
// Spec: dev/dev-ini507-2026-04-26T19:35-init-idempotent-upgrade.md
// Epic: _bmad-output/planning-artifacts/epic-init-skill.md
// Builds on: ini501 (PartialConfig + DEVX_VERSION), ini502 (writeInitFiles +
//            CLAUDE.md / .gitignore detection), ini503 (writeInitGh +
//            workflow / PR template), ini504 (seedPersonas + seedInterview),
//            ini505 (runInitSupervisor), ini506 (init_partial flag bookkeeping).

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Document, isMap, isScalar, parseDocument } from "yaml";

import {
  defaultDevxHome,
  readPackageVersion,
  writeAtomic,
} from "./supervisor-internal.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type UpgradeStatus = "halted-corrupt" | "completed" | "aborted";

export type RepairSurface =
  | "claude-md-markers"
  | "supervisor-units"
  | "ci-workflow"
  | "pr-template"
  | "personas"
  | "interview-seed";

export interface RepairOutcome {
  surface: RepairSurface;
  /** "missing" → repair attempted; "present" → left alone. */
  detected: "present" | "missing";
  /** True iff repair ran and succeeded. False when surface was present OR
   *  when the repair raised. */
  repaired: boolean;
  /** Optional human-readable detail (e.g. "added markers to CLAUDE.md"). */
  detail?: string;
}

export interface NewKey {
  /** Dotted path into devx.config.yaml — array form so map writes don't have
   *  to re-parse. e.g. `["concierge", "context_window_target"]`. */
  path: readonly string[];
  /** Single-line summary the user sees in the prompt. */
  description: string;
  /** Default the upgrade will write if `ask` is absent or returns the
   *  sentinel `undefined`. */
  proposedDefault: unknown;
}

/** Per version-pair, the keys that were added moving from `from` → `to`. */
export type NewKeysRegistry = (
  fromVersion: string,
  toVersion: string,
) => ReadonlyArray<NewKey>;

export type UpgradeAsk = (key: NewKey) => unknown | Promise<unknown>;

export interface MigrationModule {
  fromVersion: string;
  toVersion: string;
  /** Mutates the YAML doc in place. Returns the dotted key paths it touched
   *  (each as `["a", "b", "c"]`) so the caller can credit them as `migrated`
   *  in the summary. */
  apply: (
    doc: Document,
  ) => ReadonlyArray<readonly string[]> | Promise<ReadonlyArray<readonly string[]>>;
}

export type MigrationLoader = (dir: string) => Promise<MigrationModule[]>;

export interface UpgradeSummary {
  fromVersion: string;
  toVersion: string;
  /** Top-level config keys preserved verbatim (no migration touched them and
   *  they were present on disk). */
  kept: number;
  /** Surfaces auto-repaired + new config keys written. The combined number
   *  per the epic party-mode note. */
  added: number;
  /** Distinct config keys mutated by migrations. */
  migrated: number;
  /** Migration descriptors that ran in order. */
  migrationsRan: ReadonlyArray<{
    from: string;
    to: string;
    keysTouched: ReadonlyArray<readonly string[]>;
  }>;
  /** New keys actually written this run. Subset of newKeysAvailable when an
   *  ask provider declined to write some of them. */
  newKeysWritten: ReadonlyArray<NewKey>;
  /** Per-surface repair outcomes. */
  repairs: ReadonlyArray<RepairOutcome>;
}

export interface UpgradeResult {
  status: UpgradeStatus;
  summary?: UpgradeSummary;
  /** One-line `kept N / added M / migrated K`. Always set on `completed`. */
  summaryLine?: string;
  /** Set on `halted-corrupt` and `aborted`. */
  reason?: string;
}

// ---------------------------------------------------------------------------
// Surface detector / repairer types
// ---------------------------------------------------------------------------

export interface SurfaceContext {
  repoRoot: string;
  configPath: string;
  /** Parsed YAML doc; mutators MUST persist via writeAtomic if they change it. */
  doc: Document;
}

export type SurfaceDetector = (ctx: SurfaceContext) => boolean;
export type SurfaceRepair = (ctx: SurfaceContext) => Promise<boolean> | boolean;

export interface RunInitUpgradeOpts {
  repoRoot: string;
  configPath?: string;
  /** Override the package version (the upgrade target). Defaults to the
   *  version baked into the installed `@devx/cli` package. */
  currentVersion?: string;
  /** Override the migrations dir (defaults to `<package>/_devx/migrations/`). */
  migrationsDir?: string;
  /** Override the migration loader (defaults to the dynamic-import scanner). */
  loadMigrations?: MigrationLoader;
  /** Provide the new-keys delta for a version pair. Defaults to `() => []`
   *  (Phase 0 has no version bumps yet). */
  newKeysRegistry?: NewKeysRegistry;
  /** Per-new-key prompt. If absent OR if it returns `undefined`, the
   *  proposed default is written. */
  ask?: UpgradeAsk;
  /** Per-surface detectors. Missing entries fall back to the built-in
   *  defaults. Tests pass scripted detectors. */
  detect?: Partial<Record<RepairSurface, SurfaceDetector>>;
  /** Per-surface repair actions. Missing entries fall back to the built-in
   *  defaults. Tests pass scripted repairs. */
  repair?: Partial<Record<RepairSurface, SurfaceRepair>>;
  /** Stdout writer for the summary line + per-surface progress. */
  out?: (s: string) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MIGRATIONS_REL = ["_devx", "migrations"];

/** Top-level config keys we count for `kept`. Mirrors the 15 sections of
 *  devx.config.yaml plus `devx_version` + `init_partial`. Pinned here so a
 *  hand-edited config that drops a section still produces a stable count
 *  (we credit only sections actually present on disk, but the universe of
 *  "countable keys" is fixed). */
const TOP_LEVEL_KEYS_UNIVERSE: ReadonlySet<string> = new Set([
  "devx_version",
  "init_partial",
  "mode",
  "project",
  "thoroughness",
  "capacity",
  "permissions",
  "git",
  "promotion",
  "coverage",
  "ci",
  "qa",
  "focus_group",
  "self_healing",
  "notifications",
  "ui",
  "manager",
  "concierge",
  "storage",
  "observability",
  "bmad",
]);

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

export async function runInitUpgrade(
  opts: RunInitUpgradeOpts,
): Promise<UpgradeResult> {
  const configPath =
    opts.configPath ?? join(opts.repoRoot, "devx.config.yaml");
  const out = opts.out ?? (() => {});

  // ---- 1. Read + halt if corrupt ----------------------------------------

  if (!existsSync(configPath)) {
    return {
      status: "halted-corrupt",
      reason: `${configPath} does not exist — run /devx-init in fresh-mode`,
    };
  }

  let doc: Document;
  try {
    doc = parseDocument(readFileSync(configPath, "utf8"));
  } catch (err) {
    return {
      status: "halted-corrupt",
      reason: `unparseable YAML at ${configPath}: ${(err as Error).message}`,
    };
  }

  // eemeli/yaml's parseDocument is lenient — it accumulates parse errors on
  // doc.errors rather than throwing for most malformed input. Treat any
  // non-empty errors collection as corrupt so a syntactically broken file
  // doesn't sneak past as "missing devx_version."
  if (doc.errors.length > 0) {
    return {
      status: "halted-corrupt",
      reason: `unparseable YAML at ${configPath}: ${doc.errors[0]?.message ?? "unknown parse error"}`,
    };
  }

  const fromVersion = doc.get("devx_version");
  if (typeof fromVersion !== "string" || fromVersion.trim().length === 0) {
    return {
      status: "halted-corrupt",
      reason: `devx_version is missing from ${configPath} — manual review required`,
    };
  }

  const toVersion = opts.currentVersion ?? readPackageVersion();

  // ---- 2. Migrations -----------------------------------------------------
  //
  // Load + filter to those whose `from` is >= the on-disk version (per the
  // spec's "skip migrations whose from-version < installed devx_version").
  // Sort by `from` ascending so chained migrations apply in order.

  const migrationsDir =
    opts.migrationsDir ?? defaultMigrationsDir();
  const loadMigrations = opts.loadMigrations ?? defaultMigrationLoader;
  const allMigrations = await loadMigrations(migrationsDir);
  const applicable = allMigrations
    .filter((m) => compareSemver(m.fromVersion, fromVersion) >= 0)
    .filter((m) => compareSemver(m.toVersion, toVersion) <= 0)
    .sort((a, b) => compareSemver(a.fromVersion, b.fromVersion));

  const migrationsRan: Array<{
    from: string;
    to: string;
    keysTouched: ReadonlyArray<readonly string[]>;
  }> = [];
  const migratedKeys = new Set<string>();
  for (const m of applicable) {
    const touched = await m.apply(doc);
    migrationsRan.push({
      from: m.fromVersion,
      to: m.toVersion,
      keysTouched: touched,
    });
    for (const path of touched) migratedKeys.add(joinKeyPath(path));
  }

  // ---- 3. New-keys delta + prompts ---------------------------------------

  const registry = opts.newKeysRegistry ?? (() => []);
  const newKeys = registry(fromVersion, toVersion);
  const newKeysWritten: NewKey[] = [];

  for (const key of newKeys) {
    // Skip if the key already exists on disk (a prior upgrade landed it, or
    // the user hand-added it). Idempotency invariant: never re-prompt for a
    // key the user has already answered.
    if (doc.hasIn(key.path)) continue;

    let value: unknown;
    if (opts.ask) {
      const answered = await opts.ask(key);
      value = answered === undefined ? key.proposedDefault : answered;
    } else {
      value = key.proposedDefault;
    }
    doc.setIn(key.path as string[], value);
    newKeysWritten.push(key);
  }

  // ---- 4. Persist any doc mutations --------------------------------------
  //
  // Migrations + new-key writes both mutate `doc`. Persist once at the end so
  // a mid-run crash leaves the previous file untouched (atomic-rename).

  const versionBumped = compareSemver(fromVersion, toVersion) < 0;
  const docMutated = migrationsRan.length > 0 || newKeysWritten.length > 0;
  if (docMutated || versionBumped) {
    // Bump devx_version via in-place scalar mutation so any inline comment on
    // the line (e.g. `devx_version: 0.1.0  # set by /devx-init at <ts>`) is
    // preserved — same pitfall cfg202's setLeaf was built to avoid. Fall back
    // to setIn when the key didn't exist (shouldn't happen since we already
    // halted on missing devx_version, but defensive).
    const existing = doc.getIn(["devx_version"], true);
    if (isScalar(existing)) {
      existing.value = toVersion;
    } else {
      doc.setIn(["devx_version"], toVersion);
    }
    writeAtomic(configPath, doc.toString());
  }

  // ---- 5. Surface detection + repair -------------------------------------

  const ctx: SurfaceContext = {
    repoRoot: opts.repoRoot,
    configPath,
    doc,
  };

  const detectors: Record<RepairSurface, SurfaceDetector> = {
    "claude-md-markers": opts.detect?.["claude-md-markers"] ?? defaultDetectClaudeMd,
    "supervisor-units": opts.detect?.["supervisor-units"] ?? defaultDetectSupervisor,
    "ci-workflow": opts.detect?.["ci-workflow"] ?? defaultDetectCiWorkflow,
    "pr-template": opts.detect?.["pr-template"] ?? defaultDetectPrTemplate,
    personas: opts.detect?.personas ?? defaultDetectPersonas,
    "interview-seed": opts.detect?.["interview-seed"] ?? defaultDetectInterviewSeed,
  };

  const repairers: Record<RepairSurface, SurfaceRepair> = {
    "claude-md-markers": opts.repair?.["claude-md-markers"] ?? defaultRepairClaudeMd,
    "supervisor-units": opts.repair?.["supervisor-units"] ?? defaultRepairSupervisor,
    "ci-workflow": opts.repair?.["ci-workflow"] ?? defaultRepairCiWorkflow,
    "pr-template": opts.repair?.["pr-template"] ?? defaultRepairPrTemplate,
    personas: opts.repair?.personas ?? defaultRepairPersonas,
    "interview-seed": opts.repair?.["interview-seed"] ?? defaultRepairInterviewSeed,
  };

  const repairs: RepairOutcome[] = [];
  // Pinned ordering — supervisor before workflow before personas, so a
  // platform that needs a unit installed lands it before the CI workflow that
  // might depend on it being healthy. (Today none do, but the ordering is
  // load-bearing for future migrations.)
  const order: ReadonlyArray<RepairSurface> = [
    "claude-md-markers",
    "supervisor-units",
    "ci-workflow",
    "pr-template",
    "personas",
    "interview-seed",
  ];

  for (const surface of order) {
    const detector = detectors[surface];
    const present = safeDetect(detector, ctx, surface, out);
    if (present) {
      repairs.push({ surface, detected: "present", repaired: false });
      continue;
    }
    const repair = repairers[surface];
    const repaired = await safeRepair(repair, ctx, surface, out);
    repairs.push({
      surface,
      detected: "missing",
      repaired,
      detail: repaired ? `repaired ${surface}` : `repair failed for ${surface}`,
    });
  }

  // ---- 6. Counts ---------------------------------------------------------

  const onDiskTopLevel = topLevelKeysOnDisk(doc);
  const repairedSurfaces = repairs.filter((r) => r.repaired).length;
  // Distinct top-level keys touched by any migration. Migration-touched keys
  // count as `migrated`, NOT `kept`, even though they're still on disk.
  const migratedTopLevel = new Set<string>();
  for (const k of migratedKeys) {
    const top = k.split(".")[0];
    if (top) migratedTopLevel.add(top);
  }
  const kept = [...onDiskTopLevel].filter((k) => !migratedTopLevel.has(k)).length;
  // `added` = surfaces auto-repaired + new config keys written. Distinct
  // surfaces (we counted them once) + distinct new keys (each NewKey is one
  // entry).
  const added = repairedSurfaces + newKeysWritten.length;
  const migrated = migratedKeys.size;

  const summary: UpgradeSummary = {
    fromVersion,
    toVersion,
    kept,
    added,
    migrated,
    migrationsRan,
    newKeysWritten,
    repairs,
  };

  const summaryLine = `kept ${kept} / added ${added} / migrated ${migrated}`;
  out(`${summaryLine}\n`);

  return {
    status: "completed",
    summary,
    summaryLine,
  };
}

// ---------------------------------------------------------------------------
// Semver compare — pure
// ---------------------------------------------------------------------------

/** Compare two semver strings. Returns negative if `a` < `b`, zero if equal,
 *  positive if `a` > `b`. Pre-release suffixes (`-rc.1`, `+build.7`) are
 *  stripped before comparison — Phase 0 doesn't ship pre-releases and the
 *  full pre-release ordering rules add complexity we don't yet need. */
export function compareSemver(a: string, b: string): number {
  const parse = (s: string): [number, number, number] => {
    const stripped = s.split(/[-+]/)[0] ?? "0.0.0";
    const parts = stripped.split(".").map((p) => {
      const n = Number.parseInt(p, 10);
      return Number.isFinite(n) ? n : 0;
    });
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  };
  const [ax, ay, az] = parse(a);
  const [bx, by, bz] = parse(b);
  if (ax !== bx) return ax - bx;
  if (ay !== by) return ay - by;
  return az - bz;
}

// ---------------------------------------------------------------------------
// Migration loader — default (dynamic-import scanner)
// ---------------------------------------------------------------------------

const MIGRATION_FILENAME_RE =
  /^(\d+\.\d+\.\d+(?:[-+][\w.]+)?)-(\d+\.\d+\.\d+(?:[-+][\w.]+)?)\.(?:js|mjs)$/;

const defaultMigrationLoader: MigrationLoader = async (dir) => {
  if (!existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  const out: MigrationModule[] = [];
  for (const entry of entries) {
    const match = entry.match(MIGRATION_FILENAME_RE);
    if (!match || !match[1] || !match[2]) continue;
    const fromVersion = match[1];
    const toVersion = match[2];
    const fullPath = join(dir, entry);
    try {
      const url = pathToFileURL(fullPath).href;
      const mod = (await import(url)) as { default?: unknown; apply?: unknown };
      const apply = (mod.default ?? mod.apply) as MigrationModule["apply"] | undefined;
      if (typeof apply !== "function") continue;
      out.push({ fromVersion, toVersion, apply });
    } catch {
      // Skip malformed migration files; surface as a regular run-without-them
      // rather than crashing the upgrade. A future LearnAgent can file a
      // DEBUG entry from the missing-migration repair drift.
      continue;
    }
  }
  return out;
};

function defaultMigrationsDir(): string {
  // src/lib/init-upgrade.ts → ../../_devx/migrations
  // dist/lib/init-upgrade.js → ../../_devx/migrations
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "..", ...DEFAULT_MIGRATIONS_REL);
}

// ---------------------------------------------------------------------------
// Default surface detectors
// ---------------------------------------------------------------------------

const CLAUDE_MARKER_START = "<!-- devx:start -->";
const CLAUDE_MARKER_END = "<!-- devx:end -->";

function defaultDetectClaudeMd(ctx: SurfaceContext): boolean {
  const path = join(ctx.repoRoot, "CLAUDE.md");
  if (!existsSync(path)) return false;
  try {
    const raw = readFileSync(path, "utf8");
    return raw.includes(CLAUDE_MARKER_START) && raw.includes(CLAUDE_MARKER_END);
  } catch {
    return false;
  }
}

function defaultDetectSupervisor(ctx: SurfaceContext): boolean {
  // Treat "config opted out" (`os_supervisor: none`) as PRESENT — there's
  // nothing to repair when the user explicitly disabled the supervisor.
  const osSupervisor = ctx.doc.getIn(["manager", "os_supervisor"]);
  if (osSupervisor === "none") return true;

  // Coarse Phase-0 probe: the supervisor stub script's presence under the
  // devx home directory. False-positives (stub present but the platform unit
  // got hand-removed) are tolerated — the repair path's installSupervisor is
  // idempotent so a needless re-install costs nothing. False-negatives (stub
  // missing) are the load-bearing case: that's a sign sup401's installer
  // never ran or got purged. Fine-grained per-platform verify (launchctl /
  // systemctl / schtasks) lives in supervisor.ts and would shell out, which
  // makes the upgrade slow + flaky on hosts with trimmed PATH.
  const home = process.env.DEVX_HOME ?? defaultDevxHome();
  return existsSync(join(home, "bin", "devx-supervisor-stub.sh"));
}

function defaultDetectCiWorkflow(ctx: SurfaceContext): boolean {
  return existsSync(
    join(ctx.repoRoot, ".github", "workflows", "devx-ci.yml"),
  );
}

// Detector path is unchanged across the prt101 migration: the on-disk
// .github/pull_request_template.md location did not move. The writer moved
// from src/lib/init-gh.ts → src/lib/init-write.ts (writePrTemplate); see
// defaultRepairPrTemplate below for the new repair entrypoint.
function defaultDetectPrTemplate(ctx: SurfaceContext): boolean {
  return existsSync(
    join(ctx.repoRoot, ".github", "pull_request_template.md"),
  );
}

function defaultDetectPersonas(ctx: SurfaceContext): boolean {
  const dir = join(ctx.repoRoot, "focus-group", "personas");
  if (!existsSync(dir)) return false;
  try {
    if (!statSync(dir).isDirectory()) return false;
    const entries = readdirSync(dir).filter((n) => n.endsWith(".md"));
    return entries.length > 0;
  } catch {
    return false;
  }
}

function defaultDetectInterviewSeed(ctx: SurfaceContext): boolean {
  const path = join(ctx.repoRoot, "INTERVIEW.md");
  if (!existsSync(path)) return false;
  try {
    const raw = readFileSync(path, "utf8");
    // "Seeded" means the file has at least one checkbox bullet beyond the
    // empty-state header — same heuristic init-interview.ts uses for the
    // INVERSE check ("isEmptyState").
    return /^- \[[ xX/-]\]/m.test(raw);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Default surface repairers
// ---------------------------------------------------------------------------

async function defaultRepairClaudeMd(ctx: SurfaceContext): Promise<boolean> {
  // Use ini502's writeInitFiles with skipExistingConfig:true. It detects the
  // missing markers and appends them; backlog files / spec dirs / .gitignore
  // are all idempotent (skip-if-present) so this is safe to call. Returns
  // true iff the CLAUDE.md outcome ended in {created, appended, updated} —
  // anything else (conflict, skipped) means we did not actually repair.
  const { writeInitFiles } = await import("./init-write.js");
  const partialConfig = reconstructPartialConfig(ctx.doc);
  const state = synthesizedInitState(ctx);
  const result = writeInitFiles({
    repoRoot: ctx.repoRoot,
    config: partialConfig,
    state,
    skipExistingConfig: true,
  });
  return (
    result.claudeMd === "created" ||
    result.claudeMd === "appended" ||
    result.claudeMd === "updated"
  );
}

async function defaultRepairSupervisor(ctx: SurfaceContext): Promise<boolean> {
  const { runInitSupervisor } = await import("./init-supervisor.js");
  const result = runInitSupervisor({ configPath: ctx.configPath });
  // Repair is successful only when every role's install actually landed (or
  // the role was intentionally skipped via `os_supervisor: none`). A "ran"
  // result whose install stayed at "skipped" means the dispatcher hit a
  // platform-specific blocker — credit that as failure so the summary is
  // honest. Verify outcomes don't gate `repaired` because verifySupervisor
  // already files MANUAL.md on failure and the user-facing signal there is
  // independent of this counter.
  if (result.roles.length === 0) return false;
  return result.roles.every((r) => {
    if (r.status === "skipped") return r.reason === "config-none";
    return r.install === "fresh" || r.install === "kept" || r.install === "rewritten";
  });
}

async function defaultRepairCiWorkflow(ctx: SurfaceContext): Promise<boolean> {
  // Re-run writeInitGh's local-write phase. The function is idempotent for
  // workflow files (skipped-identical / kept-existing-different) and we only
  // care about the missing-then-wrote case here. We synthesize an init-state
  // so the function can pick the right stack template; it auto-detects on
  // disk in production, so the synthesis falls back to that if the doc
  // doesn't carry the answer.
  const { writeInitGh } = await import("./init-gh.js");
  const partialConfig = reconstructPartialConfig(ctx.doc);
  const state = synthesizedInitState(ctx);
  const result = writeInitGh({
    repoRoot: ctx.repoRoot,
    config: partialConfig,
    state,
  });
  return result.workflows.some(
    (w) => w.path.endsWith("devx-ci.yml") && w.outcome === "wrote",
  );
}

async function defaultRepairPrTemplate(ctx: SurfaceContext): Promise<boolean> {
  const { writePrTemplate } = await import("./init-write.js");
  const result = writePrTemplate(ctx.repoRoot);
  return result.action === "wrote";
}

async function defaultRepairPersonas(ctx: SurfaceContext): Promise<boolean> {
  const { seedPersonas } = await import("./init-personas.js");
  const result = await seedPersonas({
    repoRoot: ctx.repoRoot,
    whoFor: "you propose",
  });
  return result.created.length > 0;
}

async function defaultRepairInterviewSeed(
  ctx: SurfaceContext,
): Promise<boolean> {
  const { seedInterview } = await import("./init-interview.js");
  // The INTERVIEW seeder needs a stack hint. Cheap to re-detect from disk
  // here — we don't keep the original answer in devx.config.yaml.
  const stack = inferStackFromRepo(ctx.repoRoot);
  const result = seedInterview({ repoRoot: ctx.repoRoot, stack });
  return result.outcome === "seeded";
}

// ---------------------------------------------------------------------------
// Helpers — pure
// ---------------------------------------------------------------------------

function topLevelKeysOnDisk(doc: Document): Set<string> {
  const out = new Set<string>();
  const root = doc.contents;
  if (!isMap(root)) return out;
  for (const item of root.items) {
    const key = isScalar(item.key) ? item.key.value : item.key;
    if (typeof key === "string" && TOP_LEVEL_KEYS_UNIVERSE.has(key)) {
      out.add(key);
    }
  }
  return out;
}

function joinKeyPath(path: ReadonlyArray<string>): string {
  return path.join(".");
}

/** Build a minimal PartialConfig from the on-disk YAML. Only the fields
 *  ini502/503/504/505 actually consume during repair are populated — the
 *  rest stay defaulted (and writeInitFiles' skipExistingConfig:true means
 *  we never re-render the full 15-section payload). */
function reconstructPartialConfig(doc: Document): import("./init-questions.js").PartialConfig {
  type Mode = import("./init-questions.js").Mode;
  type ProjectShape = import("./init-state.js").ProjectShape;

  const mode = (doc.get("mode") as Mode | undefined) ?? "YOLO";
  const shape =
    (doc.getIn(["project", "shape"]) as ProjectShape | undefined) ??
    "empty-dream";
  const thoroughness =
    (doc.get("thoroughness") as
      | "send-it"
      | "balanced"
      | "thorough"
      | undefined) ?? deriveThoroughness(mode);
  const integrationBranch =
    (doc.getIn(["git", "integration_branch"]) as string | null | undefined) ??
    null;
  const protectMain =
    (doc.getIn(["git", "protect_main"]) as boolean | undefined) ??
    Boolean(integrationBranch);
  const branchPrefix =
    (doc.getIn(["git", "branch_prefix"]) as string | undefined) ??
    (integrationBranch ? "develop/" : "feat/");
  const prStrategy =
    (doc.getIn(["git", "pr_strategy"]) as
      | "direct-to-main"
      | "pr-to-main"
      | "pr-to-develop"
      | undefined) ?? (integrationBranch ? "pr-to-develop" : "pr-to-main");
  const devxVersion =
    (doc.get("devx_version") as string | undefined) ?? "0.0.0";
  const initPartial = doc.get("init_partial");

  return {
    devx_version: devxVersion,
    mode,
    project: { shape },
    thoroughness,
    git: {
      integration_branch: integrationBranch,
      branch_prefix: branchPrefix,
      pr_strategy: prStrategy,
      protect_main: protectMain,
    },
    _meta: {
      // plan_seed only feeds the CLAUDE.md template; the upgrade path uses
      // the "(seeded by /devx-plan)" placeholder when we don't have the
      // original answer, which is fine — the CLAUDE.md repair is rare and
      // the user can hand-edit the seed line later.
      plan_seed: "",
      first_slice: "",
      who_for: "",
      team_size: "solo",
      stack_description: "",
    },
    ...(typeof initPartial === "boolean" ? { init_partial: initPartial } : {}),
  };
}

/** Build the minimum InitState fields ini502/503 read during repair. We
 *  intentionally do NOT call detectInitState here — it shells out to git +
 *  gh, which makes the upgrade flow slow and flaky on hosts where the user
 *  has trimmed PATH. The repair callers only need a handful of fields. */
function synthesizedInitState(
  ctx: SurfaceContext,
): import("./init-state.js").InitState {
  const integrationBranch =
    (ctx.doc.getIn(["git", "integration_branch"]) as string | null | undefined) ??
    null;
  const defaultBranch =
    (ctx.doc.getIn(["git", "default_branch"]) as string | undefined) ?? "main";

  // Stack hint comes from on-disk markers. CI workflow repair needs it.
  const detectedStack = inferStackFromRepo(ctx.repoRoot);

  return {
    repoRoot: ctx.repoRoot,
    kind: "already-on-devx",
    hasCommits: true,
    hasUncommittedChanges: false,
    defaultBranch,
    currentBranch: defaultBranch,
    isOnDefaultBranch: true,
    hasRemote: false,
    remoteUrl: null,
    developBranchExists: integrationBranch === "develop",
    mainProtected: false,
    hasTags: false,
    multipleAuthorsLast90d: false,
    devxVersion: (ctx.doc.get("devx_version") as string | undefined) ?? null,
    hasUserConfig: false,
    userConfigPath: "",
    hasReadme: existsSync(join(ctx.repoRoot, "README.md")),
    readmeFirstParagraph: null,
    personasPopulated: defaultDetectPersonas(ctx),
    detectedStack,
    detectedStackFile: null,
    hasProdEnvVars: false,
    hasGithubWorkflows: existsSync(
      join(ctx.repoRoot, ".github", "workflows"),
    ),
    hasTests: false,
    inferredShape: null,
    halts: [],
  };
}

function inferStackFromRepo(
  repoRoot: string,
): import("./init-state.js").DetectedStack {
  const probes: Array<[import("./init-state.js").DetectedStack, string]> = [
    ["typescript", "package.json"],
    ["flutter", "pubspec.yaml"],
    ["rust", "Cargo.toml"],
    ["go", "go.mod"],
    ["python", "pyproject.toml"],
  ];
  const hits = probes.filter(([, f]) => existsSync(join(repoRoot, f)));
  if (hits.length === 0) return "empty";
  if (hits.length > 1) return "mixed";
  return hits[0]?.[0] ?? "empty";
}

function deriveThoroughness(
  mode: import("./init-questions.js").Mode,
): "send-it" | "balanced" | "thorough" {
  if (mode === "YOLO") return "send-it";
  if (mode === "PROD") return "thorough";
  return "balanced";
}

// ---------------------------------------------------------------------------
// Safe wrappers — never let a detector / repair throw mid-loop
// ---------------------------------------------------------------------------

function safeDetect(
  detector: SurfaceDetector,
  ctx: SurfaceContext,
  surface: RepairSurface,
  out: (s: string) => void,
): boolean {
  try {
    return detector(ctx);
  } catch (err) {
    // Detector failure → assume missing (false-negative is the safe bias —
    // we'd rather over-repair than under-repair). Log once.
    out(
      `  [warn] ${surface} detector raised: ${(err as Error).message}; assuming missing\n`,
    );
    return false;
  }
}

async function safeRepair(
  repair: SurfaceRepair,
  ctx: SurfaceContext,
  surface: RepairSurface,
  out: (s: string) => void,
): Promise<boolean> {
  try {
    return await repair(ctx);
  } catch (err) {
    out(
      `  [fail] ${surface} repair raised: ${(err as Error).message}\n`,
    );
    return false;
  }
}
