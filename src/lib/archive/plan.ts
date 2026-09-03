// `devx archive` — plan the move of a CLOSED doc set out of the live tree
// (arc101).
//
// `engine.archive_root` has been written into every config `devx init`
// produces since the key existed, and read by nothing. So a finished
// workstream sits in `_devx/workstreams/` forever and the live list becomes
// "everything ever worked on" rather than "what is in flight". This is the
// reader.
//
// THE ARCHIVE ALWAYS STORES THE FOLDER SHAPE, whatever layout the repo runs.
// That is the one design decision here worth stating:
//
//   - Under `workstream` it is a no-op restatement — the doc set is already
//     folder-shaped, and archiving is a directory move.
//   - Under `project-level` the doc set is a handful of flat files at the repo
//     root, interleaved with `PLAN.md`/`DEV.md`. They have to become something
//     when they leave, and a folder is the only shape that holds more than one
//     archived workstream without collision.
//   - It makes the archive layout-INDEPENDENT: a repo that later flips layout
//     does not end up with half its history in one shape and half in another,
//     and `--restore` reads the same tree either way.
//
// Because both directions are "move one doc set between two (layout, base)
// pairs", this planner builds its moves with `buildDocSetMoves()` — the same
// function `planLayoutMigration` uses — and executes them with
// `executeMigration()`, passing `setLayout: null` so no layout change is
// recorded for an operation that changes no layout. Archive owns the
// PLANNING; it owns none of the moving.
//
// Spec: dev/dev-arc101-2026-09-03T11:00-devx-archive.md
// Precedent: dev/dev-dlr106-2026-09-02T09:14-layout-migrate.md

import { join } from "node:path";

import {
  type DocsLayout,
  type ResolvedBase,
  normalizeArtifactPath,
} from "../engine/artifacts.js";
import type { EngineConfig } from "../engine/config.js";
import {
  PROJECT_LEVEL_WORKSTREAM_REL,
  planFilenameSlug,
} from "../engine/workstream.js";
import {
  type MigrateFs,
  type Move,
  type MovePlan,
  type PlanSpecRow,
  type Refusal,
  buildDocSetMoves,
  docSetPresentAt,
  isLive,
  readPlanSpecs,
  walkFiles,
} from "../layout/migrate.js";

/** The artifact resolvers' own spelling — imported rather than re-derived, so
 *  a path written into `workstream:` frontmatter here matches the one every
 *  resolver compares against. */
const norm = normalizeArtifactPath;

const absOf = (repoRoot: string, rel: string): string =>
  rel === "" || rel === PROJECT_LEVEL_WORKSTREAM_REL
    ? repoRoot
    : join(repoRoot, ...norm(rel).split("/"));

export interface ArchivePlanOpts {
  fs: MigrateFs;
  repoRoot: string;
  engine: EngineConfig;
  /** Plan-spec hash or workstream slug naming the doc set to move. */
  target: string;
  /** Move archive → live instead of live → archive. */
  restore: boolean;
}

/**
 * The plan, in `MovePlan`'s shape so `executeMigration` and `renderMovePlan`
 * consume it unchanged.
 *
 * `from`/`to` carry the repo's CURRENT layout on both sides — archiving moves
 * a doc set, never a layout — which is what makes `setLayout: null` at the
 * executor honest rather than a special case bolted on.
 */
export interface ArchivePlan extends MovePlan {
  /** The identified spec row, for the CLI's reporting. */
  row: PlanSpecRow | null;
}

/** Match a plan spec by hash or by filename slug. */
function findRow(rows: readonly PlanSpecRow[], target: string): PlanSpecRow | null {
  const wanted = target.trim().toLowerCase();
  for (const row of rows) {
    const hash = /^plan-([a-z0-9]+)-/i.exec(row.name)?.[1]?.toLowerCase();
    if (hash === wanted) return row;
  }
  for (const row of rows) {
    if (planFilenameSlug(row.name)?.toLowerCase() === wanted) return row;
  }
  return null;
}

/**
 * Plan an archive (or a restore). PURE: reads through the fs seam, moves
 * nothing, runs no subprocess — the same guarantee that makes
 * `planLayoutMigration`'s `--dry-run` structural rather than promised.
 *
 * The git-backed refusals (dirty tree, untracked sources, nested repo root)
 * are the caller's to fold in, exactly as they are for a layout migration: a
 * pure function cannot see them.
 */
export function planArchive(opts: ArchivePlanOpts): ArchivePlan {
  const { fs, repoRoot, engine, target, restore } = opts;
  const layout: DocsLayout = engine.docsLayout;

  const blank: ArchivePlan = {
    from: layout,
    to: layout,
    noop: false,
    treeMismatch: null,
    specRel: null,
    sourceRel: null,
    workstreamRel: null,
    slug: null,
    moves: [],
    refusals: [],
    row: null,
  };
  const refuse = (r: Refusal, extra: Partial<ArchivePlan> = {}): ArchivePlan => ({
    ...blank,
    ...extra,
    refusals: [r],
  });

  const rows = readPlanSpecs(fs, repoRoot);
  const row = findRow(rows, target);
  if (row === null) {
    return refuse({
      code: "no-workstream",
      message:
        `no engine plan spec matches '${target}' — nothing to ` +
        `${restore ? "restore" : "archive"}. Pass a plan-spec hash or its slug; ` +
        "`devx status` lists both. A v1-era plan row with no `stage:` owns no doc " +
        "set and is deliberately not a match.",
    });
  }

  const slug = planFilenameSlug(row.name);
  if (slug === null) {
    return refuse(
      {
        code: "no-workstream",
        message:
          `'${row.rel}' does not follow the plan-spec filename shape ` +
          "(`plan-<hash>-<timestamp>-<slug>.md`), so its doc set has no identity to " +
          "archive under. Rename it to the convention and re-run.",
      },
      { row },
    );
  }

  // Liveness: an in-flight workstream's artifacts are work, not history.
  // Reused from migrate.ts rather than re-derived from the stage list — the
  // two answering differently is the bug this reuse forecloses.
  if (!restore && isLive(row)) {
    return refuse(
      {
        code: "workstream-live",
        message:
          `'${slug}' is still in flight (stage: ${row.state.stage ?? "unset"}). ` +
          "Archiving moves its artifacts out of every live resolver's reach, so the " +
          "gates, `devx next` and `devx status` would stop seeing work that is not " +
          "finished. Close it (`stage: done`) or retire it first.",
        paths: [row.rel],
      },
      { row, slug },
    );
  }

  const archiveRel = norm(`${engine.archiveRoot}/${slug}`);
  const liveRel =
    layout === "project-level"
      ? PROJECT_LEVEL_WORKSTREAM_REL
      : norm(`${engine.workstreamsRoot}/${slug}`);

  // The archive side is ALWAYS folder-shaped; the live side follows the repo.
  const archiveBase: ResolvedBase = {
    repoRoot,
    workstreamRel: archiveRel,
    layout: "workstream",
  };
  const liveBase: ResolvedBase = { repoRoot, workstreamRel: liveRel, layout };

  const sourceBase = restore ? archiveBase : liveBase;
  const targetBase = restore ? liveBase : archiveBase;
  const sourceLayout: DocsLayout = restore ? "workstream" : layout;
  const targetLayout: DocsLayout = restore ? layout : "workstream";
  const sourceRel = restore ? archiveRel : liveRel;
  const destRel = restore ? liveRel : archiveRel;

  if (docSetPresentAt(fs, targetBase)) {
    return refuse(
      {
        code: "destination-occupied",
        message:
          `a doc set is already at ${destRel === PROJECT_LEVEL_WORKSTREAM_REL ? "the repo root" : `'${destRel}'`}. ` +
          `${restore ? "Restoring" : "Archiving"} onto it would interleave two doc sets, and no reading of ` +
          "that keeps both. Move or delete the existing one first." +
          (targetLayout === "project-level"
            ? ""
            : " An EMPTY directory counts: the directory IS the doc set under the folder " +
              "shape, so remove the shell if a previous run left one."),
        paths: [destRel],
      },
      { row, slug, sourceRel, workstreamRel: destRel },
    );
  }

  // ---- the moves -----------------------------------------------------------
  //
  // TWO REGIMES, and the difference is not a special case — it is the whole
  // reason archiving is not a layout migration:
  //
  //   Both sides folder-shaped (the `workstream` layout, either direction) →
  //   move the directory VERBATIM, every file, structure preserved. The doc
  //   set owns that directory outright, so everything in it belongs to the
  //   workstream and travels with it. Found by running the first version
  //   against this repo: `story-graph` carries `RETRO-2026-08-06.md` and
  //   `research/`, which the artifact map cannot name — and a map-driven plan
  //   refused `unmapped-doc-set-files` on the single most ordinary shape a
  //   CLOSED workstream has. A retro is not an unmappable stray; it is the
  //   most valuable thing in a finished doc set.
  //
  //   One side flat (`project-level`) → map-driven, because at the repo root
  //   the doc set is interleaved with `PLAN.md`, `src/`, and everything else.
  //   There the map is the only thing that knows which files are ours, and
  //   the shapes genuinely differ so names must be translated.
  let moves: Move[];
  let seen: Set<string>;
  const crossesShapes = sourceLayout !== targetLayout;
  if (!crossesShapes) {
    moves = walkFiles(fs, absOf(repoRoot, sourceRel)).map((rel) => ({
      from: `${sourceRel}/${rel}`,
      to: `${destRel}/${rel}`,
      kind: "doc-set",
    }));
    seen = new Set(moves.map((m) => m.from));
  } else {
    ({ moves, seen } = buildDocSetMoves(
      fs,
      sourceLayout,
      sourceBase,
      targetLayout,
      targetBase,
    ));
  }

  if (moves.length === 0) {
    return refuse(
      {
        code: "no-workstream",
        message:
          `no artifacts found at ${sourceRel === PROJECT_LEVEL_WORKSTREAM_REL ? "the repo root" : `'${sourceRel}'`} ` +
          `for '${slug}' — there is nothing to ${restore ? "restore" : "archive"}. ` +
          (restore
            ? "Has it been archived? `devx status` reports where its artifacts resolve."
            : "The doc set may already be archived."),
        paths: [sourceRel],
      },
      { row, slug, sourceRel, workstreamRel: destRel },
    );
  }

  // Only the shape-crossing regime can leave anything behind: the verbatim
  // regime moves every file it finds, so "unmapped" cannot exist there by
  // construction. When the archive holds files the flat layout has no name for
  // — a `RETRO-*.md` archived while the repo was folder-shaped, restored after
  // a layout flip — say so rather than silently stranding them in the archive.
  const refusals: Refusal[] = [];
  if (crossesShapes && sourceRel !== PROJECT_LEVEL_WORKSTREAM_REL) {
    const unmapped = walkFiles(fs, absOf(repoRoot, sourceRel))
      .map((rel) => `${sourceRel}/${rel}`)
      .filter((rel) => !seen.has(rel));
    if (unmapped.length > 0) {
      refusals.push({
        code: "unmapped-doc-set-files",
        message:
          `${unmapped.length} file(s) under '${sourceRel}' have no name in the ` +
          `'${targetLayout}' layout, so restoring would strand them in the archive while ` +
          "moving everything around them — splitting one doc set across two locations. " +
          "Move them into `decisions/` (which travels whole), or restore into the layout " +
          "they were archived from.",
        paths: unmapped,
      });
    }
  }

  return {
    from: layout,
    to: layout,
    noop: false,
    treeMismatch: null,
    specRel: row.rel,
    sourceRel,
    workstreamRel: destRel,
    slug,
    moves,
    refusals,
    row,
  };
}

/** Render an archive plan for `--dry-run`. Mirrors `renderMovePlan`'s shape
 *  so the two commands read alike in a terminal. */
export function renderArchivePlan(plan: ArchivePlan, restore: boolean): string {
  if (plan.refusals.length > 0) {
    return plan.refusals
      .map(
        (r) =>
          `devx archive: refused [${r.code}] — ${r.message}` +
          (r.paths && r.paths.length > 0
            ? `\n${r.paths.map((p) => `  ${p}`).join("\n")}`
            : ""),
      )
      .join("\n");
  }
  const head = restore
    ? `restore ${plan.slug} → ${plan.workstreamRel === PROJECT_LEVEL_WORKSTREAM_REL ? "the repo root" : plan.workstreamRel}`
    : `archive ${plan.slug} → ${plan.workstreamRel}`;
  const lines = plan.moves.map((m: Move) => `  ${m.from} → ${m.to}   [${m.kind}]`);
  lines.push(`  ${plan.specRel}: workstream: → ${plan.workstreamRel}`);
  return [head, ...lines].join("\n");
}
