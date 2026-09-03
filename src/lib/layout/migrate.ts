// `devx layout migrate` — the one command that rewrites a user's artifact
// tree, and the only phase of this workstream that writes outside devx.
//
// Shape first: a PURE planner (`planLayoutMigration`) produces a `MovePlan`
// the caller either renders (`--dry-run`) or executes. Non-destructive dry-run
// is therefore a property of the structure rather than of remembering to check
// a flag before each write — there is exactly one function that moves files,
// and `--dry-run` never reaches it.
//
// Ordering is moves → spec frontmatter → config, and the PRD's stated reason
// for config-last is backwards: it says an interrupted run leaves config
// describing its tree, when in fact it leaves config describing the
// PRE-migration shape while the tree carries the new one. BOTH orderings
// mismatch on interruption. Config-last is right for a different reason — the
// clean-tree precondition makes every `git mv` revertible in one command, and
// a config write first would dirty the tree and destroy exactly that recovery.
// The mismatch is made DETECTABLE by phase 3's `layout-tree-mismatch` doctor
// finding rather than assumed away.
//
// Only the plan spec's `workstream:` field is rewritten. `stage:`,
// `gate_status:` and `gate_verdicts:` live in the SPEC, not in the tree, so
// passed gates survive a migration BY CONSTRUCTION — nothing copies them, so
// nothing can drop them.
//
// **The doc set, not the artifact map, is what moves.** Enumerating only the
// paths the map can name looks equivalent and is not: a workstream directory
// also holds `RETRO-<date>.md`, `research/`, hand-written notes — six such
// files/dirs across six workstreams in devx's own repo today. Planning from
// the map alone moved the artifacts, reported success, and left the rest
// behind in a directory the OTHER layout has no place for. So the source doc
// set is walked whole and every file must be accounted for; an unclaimed one
// is a refusal, never silence.
//
// Refusals, and no `--force`: every one names a state where moving would lose
// information. A `--force` on any of them is a request to lose it quietly.
//
// R-5: THIS IS NOT REVERT-SAFE for a repo that ran it. Reverting devx's own
// PR does not un-migrate anyone's tree; rollback afterwards is a second
// migration in the opposite direction — which is why the emptied source
// directories are pruned, and why the abort path removes the destination
// directories it created. `docSetPresentAt` reads a workstream directory's
// mere EXISTENCE as a doc set, so any leftover shell makes that rollback
// refuse forever. `--dry-run` is the real mitigation.
//
// Spec: dev/dev-dlr106-2026-09-02T09:14-layout-migrate.md
// Plan: _devx/workstreams/docs-layout-resolution/plan/agent.md §6

import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmdirSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { setLeaf } from "../config-io.js";
import {
  ALL_ARTIFACT_KINDS,
  type ArtifactKind,
  type DocsLayout,
  type ResolvedBase,
  artifactKindIdentity,
  normalizeArtifactPath,
  stageSubject,
} from "../engine/artifacts.js";
import type { EngineConfig } from "../engine/config.js";
import { type Exec } from "../exec.js";
import {
  type EngineState,
  applyEnginePatch,
  readEngineState,
} from "../engine/frontmatter.js";
import { dequoteGitPath } from "../engine/outline.js";
import {
  PROJECT_LEVEL_WORKSTREAM_REL,
  planFilenameSlug,
  planFilenameWorkstreamRel,
  planSpecWorkstreamRel,
  realEngineFs,
} from "../engine/workstream.js";

/** Spec directory holding plan specs — the walk that answers "how many
 *  workstreams does this repo have". A directory LISTING of the workstreams
 *  root answers a different question (how many folders exist), and under
 *  `project-level` there is no folder to list at all — so both questions get
 *  asked, of the source that can answer each. */
const PLAN_DIR = "plan";

/** Stages a workstream can be in and still be LIVE. Anything else is history:
 *  its artifacts are a record, not work in flight. */
const DEAD_STAGES = new Set(["done", "retired"]);

// ---------------------------------------------------------------------------
// fs seam
// ---------------------------------------------------------------------------

/**
 * Read seam for the planner. `EngineFs`'s read half plus `isDirectory`, which
 * the walk genuinely needs: `decisions/`, `checkpoints/` and `evals/` are
 * DIRECTORY artifacts, and enumerating their contents file-by-file is what
 * makes the plan honest.
 *
 * File-by-file rather than `git mv <dir> <dir>`, and the reason is a footgun
 * rather than a preference: `git mv a/decisions decisions` moves the source
 * INSIDE the destination when the destination already exists, silently
 * producing `decisions/decisions/`. A per-file plan cannot express that, and
 * it is also what `--dry-run` has to print to be worth reading.
 */
export interface MigrateFs {
  exists(path: string): boolean;
  readdir(path: string): string[];
  readFile(path: string): string;
  isDirectory(path: string): boolean;
}

export const realMigrateFs: MigrateFs = {
  exists: (p) => existsSync(p),
  readdir: (p) => readdirSync(p),
  readFile: (p) => readFileSync(p, "utf8"),
  // `lstat`, NOT `stat`, and the difference is a data-loss bug rather than a
  // nicety. `stat` follows symlinks, so a symlinked directory inside the doc
  // set reads as a directory: the walk recurses THROUGH it and never emits the
  // link itself, so the one thing git actually tracks (the link, mode 120000)
  // is dropped from the plan, while every file "under" it is planned at a path
  // git has never heard of. To git a symlink is a file; `lstat` says the same,
  // so it is planned as one move and `git mv`'d like anything else.
  isDirectory: (p) => {
    try {
      return lstatSync(p).isDirectory();
    } catch {
      // A broken link, a race with a concurrent delete, a permission wall —
      // none of them is a directory, and none should abort a plan that has
      // other artifacts to describe.
      return false;
    }
  },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One file move, both sides repo-relative POSIX. */
export interface Move {
  from: string;
  to: string;
  /** The artifact identity that put this file in the plan — `agent:prd`,
   *  `decisions-dir`, … Rendered by `--dry-run` so the operator can see WHY
   *  a path is moving, not just that it is. */
  kind: string;
}

/** A refusal: a repo state where migrating would lose information. */
export interface Refusal {
  /** Stable machine tag, matched exactly by tests and greppable in logs. */
  code: string;
  /** Operator-facing sentence. Names what was found, so the next action is
   *  obvious without re-deriving the state. */
  message: string;
  /** Paths the refusal is about, when it has any. */
  paths?: string[];
}

export interface MovePlan {
  /** Layout the repo is in now, per config. */
  from: DocsLayout;
  /** Layout `--to` named. */
  to: DocsLayout;
  /** True when `from === to` — nothing to do, and not an error. */
  noop: boolean;
  /**
   * Set on a `noop` when the TREE looks like the other layout — i.e. config
   * and disk disagree, which is exactly what an interrupted run leaves and
   * what phase 3's `layout-tree-mismatch` doctor finding reports. Without
   * this the one state that most needs help gets "already at X — nothing to
   * migrate", which is true of the config and false of the repo.
   */
  treeMismatch: DocsLayout | null;
  /** Repo-relative path of the plan spec whose `workstream:` gets rewritten. */
  specRel: string | null;
  /** Repo-relative doc-set dir the artifacts are moving OUT of. Carried so the
   *  prune can be bounded to it rather than derived from move ancestors — an
   *  ancestor walk has no upper bound and deletes whatever sits above. */
  sourceRel: string | null;
  /** Value `workstream:` is rewritten to (and the destination doc-set dir). */
  workstreamRel: string | null;
  /** Identity slug of the doc set being migrated. */
  slug: string | null;
  moves: Move[];
  /** Refusals found by the pure predicate. Non-empty ⇒ nothing may move. */
  refusals: Refusal[];
}

// ---------------------------------------------------------------------------
// Doc-set presence (the lay101-signature predicate)
// ---------------------------------------------------------------------------

/** Artifacts whose presence proves a doc set already lives at a base — the
 *  three authored subjects plus the two root files. Same set as
 *  `workstream.ts`'s, and deliberately a SECOND copy: `dev-lay101` owns the
 *  shared predicate, and when it lands BOTH this and the scaffold's collapse
 *  onto it (design §Out of scope; R-8). Two local copies scheduled to die
 *  together beat one premature abstraction that has to be un-shared. */
const DOC_SET_EVIDENCE: readonly ArtifactKind[] = [
  { kind: "agent", stage: "prd" },
  { kind: "agent", stage: "design" },
  { kind: "agent", stage: "plan" },
  { kind: "expectations" },
  { kind: "todo" },
];

/**
 * Is a doc set already present at this base?
 *
 * Carries `docSetPresentAt`'s signature from `workstream.ts` on purpose (see
 * `DOC_SET_EVIDENCE`). The `project-level` arm asks for an EXACT NAME from a
 * directory listing rather than `fs.exists`, and that is not defensive
 * programming — it is the difference between working and not on the platforms
 * most owners run. Under `project-level` the doc set sits at the repo root
 * beside devx's own `PLAN.md` backlog, and macOS (APFS/HFS+) and Windows
 * (NTFS) are case-INSENSITIVE by default, so `existsSync("<root>/plan.md")`
 * answers TRUE for `PLAN.md`. Every migration into a flat layout would then
 * refuse with "a doc set is already at the destination" on a repo that has
 * none. `plan.md` is not `PLAN.md`; only the listing knows that.
 *
 * (The general `fs.exists` case-blindness is `debug-135dc9`.)
 */
export function docSetPresentAt(
  fs: Pick<MigrateFs, "exists" | "readdir">,
  base: ResolvedBase,
): boolean {
  const dirAbs = absOf(base.repoRoot, base.workstreamRel);
  if (base.layout !== "project-level") {
    // Under `workstream` the directory IS part of the doc set — nothing but
    // scaffolding creates it — so its existence is sufficient evidence,
    // empty dir included.
    return fs.exists(dirAbs);
  }
  let present: Set<string>;
  try {
    present = new Set(fs.readdir(dirAbs));
  } catch {
    return false;
  }
  return DOC_SET_EVIDENCE.some((kind) =>
    present.has(basename(stageSubject(base.layout, base, kind).rel)),
  );
}

/** Repo-relative POSIX → absolute, with the platform separator. `.` and `""`
 *  both mean the repo root. */
function absOf(repoRoot: string, rel: string): string {
  const norm = normalizeArtifactPath(rel);
  return norm === "" ? repoRoot : join(repoRoot, ...norm.split("/"));
}

// ---------------------------------------------------------------------------
// Plan-spec walk
// ---------------------------------------------------------------------------

export interface PlanSpecRow {
  /** Basename inside `plan/`. */
  name: string;
  /** Repo-relative path. */
  rel: string;
  state: EngineState;
}

/**
 * Every engine-managed plan spec in the repo, read from `plan/`'s frontmatter.
 *
 * A spec with no `stage:` is not an engine workstream — it is a v1-era plan
 * item that never entered the pipeline, and it owns no artifact tree. Counting
 * those would make the ≥2 refusal fire on repos with a single doc set and a
 * handful of legacy rows, which is every repo that migrated from v1.
 */
export function readPlanSpecs(
  fs: Pick<MigrateFs, "exists" | "readdir" | "readFile">,
  repoRoot: string,
): PlanSpecRow[] {
  const dirAbs = join(repoRoot, PLAN_DIR);
  if (!fs.exists(dirAbs)) return [];
  let names: string[];
  try {
    names = [...fs.readdir(dirAbs)].sort();
  } catch {
    return [];
  }
  const rows: PlanSpecRow[] = [];
  for (const name of names) {
    if (!name.endsWith(".md")) continue;
    let state: EngineState;
    try {
      state = readEngineState(fs.readFile(join(dirAbs, name)));
    } catch {
      // Unreadable plan spec — keep scanning. A parse failure must not decide
      // a migration; the doc-set predicates below still answer.
      continue;
    }
    if (state.stage === null) continue;
    rows.push({ name, rel: `${PLAN_DIR}/${name}`, state });
  }
  return rows;
}

/** The live subset: still in flight, so its artifacts are work rather than
 *  history. `stage !== "done" && stage !== "retired"`, per the plan. */
export const isLive = (row: PlanSpecRow): boolean =>
  row.state.stage !== null && !DEAD_STAGES.has(row.state.stage);

// ---------------------------------------------------------------------------
// The planner
// ---------------------------------------------------------------------------

/** Directory-shaped artifacts. Their CONTENTS move, one file at a time. */
const DIR_KINDS: readonly ArtifactKind[] = [
  { kind: "evals-dir" },
  { kind: "decisions-dir" },
  { kind: "checkpoints-dir" },
];

const DIR_KIND_IDS = new Set(DIR_KINDS.map(artifactKindIdentity));

/** File-shaped artifacts: everything representable except the three directory
 *  kinds and `red-report`, which lives INSIDE `evals/` and would otherwise be
 *  planned twice — once by name and once by the evals walk. Derived from
 *  `ALL_ARTIFACT_KINDS` rather than listed, so a newly-added artifact kind
 *  cannot be silently left behind by the migration. */
const FILE_KINDS: readonly ArtifactKind[] = ALL_ARTIFACT_KINDS.filter(
  (k) => !DIR_KIND_IDS.has(artifactKindIdentity(k)) && k.kind !== "red-report",
);

/** Files under `dirAbs`, as paths relative to it, POSIX-spelled, depth-first
 *  and sorted so a plan is reproducible run to run. Directories are recursed,
 *  never emitted: git tracks files, so an empty directory is not a move.
 *  Symlinks are leaves — see `realMigrateFs.isDirectory`.
 *
 *  Exported at arc101: `devx archive`'s verbatim regime walks a doc set the
 *  same way, and a second four-line recursion is a second set of decisions
 *  about symlinks, sort order and unreadable directories. */
export function walkFiles(
  fs: Pick<MigrateFs, "readdir" | "isDirectory">,
  dirAbs: string,
  prefix = "",
): string[] {
  let names: string[];
  try {
    names = [...fs.readdir(dirAbs)].sort();
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of names) {
    const childAbs = join(dirAbs, name);
    const childRel = prefix === "" ? name : `${prefix}/${name}`;
    if (fs.isDirectory(childAbs)) {
      out.push(...walkFiles(fs, childAbs, childRel));
    } else {
      out.push(childRel);
    }
  }
  return out;
}

/** Directories under `dirAbs`, deepest first — the prune order. */
function walkDirs(
  fs: Pick<MigrateFs, "readdir" | "isDirectory">,
  dirAbs: string,
  prefix = "",
): string[] {
  let names: string[];
  try {
    names = [...fs.readdir(dirAbs)].sort();
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of names) {
    const childAbs = join(dirAbs, name);
    if (!fs.isDirectory(childAbs)) continue;
    const childRel = prefix === "" ? name : `${prefix}/${name}`;
    out.push(...walkDirs(fs, childAbs, childRel));
    out.push(childRel);
  }
  return out;
}

const baseFor = (
  repoRoot: string,
  layout: DocsLayout,
  workstreamRel: string,
): ResolvedBase => ({ repoRoot, workstreamRel, layout });

/**
 * Repo-relative doc-set dir for a layout: the repo root under `project-level`,
 * `<workstreams_root>/<slug>` under `workstream`.
 *
 * Routed through `planFilenameWorkstreamRel` rather than re-spelling the join.
 * That helper is the one dlr103 created expressly to single-source it, and a
 * second spelling of one path is the exact bug class this workstream exists to
 * close — the layout is passed as an override so the helper answers about the
 * DESTINATION rather than about the repo's current shape. Normalized on the
 * way out because `engineConfigFrom` strips a trailing slash but not a leading
 * `./`, and this value is written into the spec's `workstream:` frontmatter,
 * where a second spelling would then be committed.
 */
function docSetRelFor(
  name: string,
  engine: EngineConfig,
  layout: DocsLayout,
): string | null {
  const rel = planFilenameWorkstreamRel(name, { ...engine, docsLayout: layout });
  if (rel === null) return null;
  return normalizeArtifactPath(rel) || PROJECT_LEVEL_WORKSTREAM_REL;
}

/**
 * Every file move that carries one doc set from (layout, base) to another,
 * plus the set of sources it claimed.
 *
 * Extracted at arc101 because `devx archive` performs the SAME operation
 * against different bases — a live doc set to `<archive_root>/<slug>` and
 * back — and a second copy of this loop is precisely the drift CLAUDE.md's
 * don't-duplicate rule exists to stop. The two callers differ only in which
 * (layout, base) pairs they hand in; every subtlety below (exact-name probing,
 * the double-reach dedupe, directory walking) is identical for both and would
 * have had to be re-discovered by the copy.
 *
 * `seen` is returned, not just `moves`: the `unmapped-doc-set-files` refusal
 * is computed by subtracting it from a walk of the source, and a caller that
 * re-derived that set from `moves` would silently disagree on the files the
 * map reaches twice.
 */
export function buildDocSetMoves(
  fs: MigrateFs,
  fromLayout: DocsLayout,
  sourceBase: ResolvedBase,
  toLayout: DocsLayout,
  targetBase: ResolvedBase,
): { moves: Move[]; seen: Set<string> } {
  const moves: Move[] = [];
  const seen = new Set<string>();
  const push = (src: string, dst: string, kind: string): void => {
    // A file the map reaches twice (`evals/RED-report.md` is only excluded
    // from FILE_KINDS because of this) must appear once. Dedupe on the SOURCE:
    // two plans for one file is one `git mv` failing on the second attempt.
    if (src === dst || seen.has(src)) return;
    seen.add(src);
    moves.push({ from: src, to: dst, kind });
  };

  for (const kind of FILE_KINDS) {
    const src = stageSubject(fromLayout, sourceBase, kind);
    const dst = stageSubject(toLayout, targetBase, kind);
    // Exact-name, for the same reason `docSetPresentAt` is: under
    // `project-level` these sit beside `PLAN.md`/`DEV.md` on a case-insensitive
    // filesystem, so `fs.exists` alone would plan a move of a file that is not
    // there — and `git mv` would move the BACKLOG.
    if (!fileExistsExact(fs, src.abs)) continue;
    push(src.rel, dst.rel, artifactKindIdentity(kind));
  }

  for (const kind of DIR_KINDS) {
    const src = stageSubject(fromLayout, sourceBase, kind);
    const dst = stageSubject(toLayout, targetBase, kind);
    if (!fs.exists(src.abs) || !fs.isDirectory(src.abs)) continue;
    for (const rel of walkFiles(fs, src.abs)) {
      push(`${src.rel}/${rel}`, `${dst.rel}/${rel}`, artifactKindIdentity(kind));
    }
  }

  return { moves, seen };
}

/**
 * Plan a layout migration. PURE: reads the filesystem through the seam and
 * returns what WOULD happen. It moves nothing, writes nothing, and runs no
 * subprocess — which is what makes `--dry-run` a structural guarantee instead
 * of a promise.
 *
 * Refusals that are STRUCTURAL — the ones that stop the plan from being
 * computable at all — return immediately, because everything after them would
 * be guesswork. The independent ones (`unmapped-doc-set-files`,
 * `destination-clash`, `destination-outside-repo`) accumulate, so an operator
 * with three of them fixes three rather than discovering them one run at a
 * time. The two git-backed refusals (dirty tree, untracked sources) are the
 * caller's to fold in; a pure function cannot see them.
 */
export function planLayoutMigration(
  fs: MigrateFs,
  repoRoot: string,
  engine: EngineConfig,
  target: DocsLayout,
): MovePlan {
  const from = engine.docsLayout;
  const blank: MovePlan = {
    from,
    to: target,
    noop: from === target,
    treeMismatch: null,
    specRel: null,
    sourceRel: null,
    workstreamRel: null,
    slug: null,
    moves: [],
    refusals: [],
  };
  const refuse = (r: Refusal, extra: Partial<MovePlan> = {}): MovePlan => ({
    ...blank,
    ...extra,
    refusals: [r],
  });

  const specs = readPlanSpecs(fs, repoRoot);
  const live = specs.filter(isLive);

  if (from === target) {
    // Migrating to the layout the repo is already in is a no-op, not a
    // failure — "refused: a doc set is already at the destination" would be
    // technically true and useless, since the destination IS the source. But
    // config is only one of the two things that decide a layout, so ask the
    // disk too: an interrupted run leaves them disagreeing, and that is the
    // state that most needs to be told the truth rather than "nothing to do".
    const otherLayout: DocsLayout =
      from === "project-level" ? "workstream" : "project-level";
    const probe = live[0] ?? specs[0];
    let treeMismatch: DocsLayout | null = null;
    if (probe !== undefined) {
      const otherRel = docSetRelFor(probe.name, engine, otherLayout);
      const ownRel =
        docSetRelFor(probe.name, engine, from) ?? PROJECT_LEVEL_WORKSTREAM_REL;
      if (
        otherRel !== null &&
        docSetPresentAt(fs, baseFor(repoRoot, otherLayout, otherRel)) &&
        !docSetPresentAt(fs, baseFor(repoRoot, from, ownRel))
      ) {
        treeMismatch = otherLayout;
      }
    }
    return { ...blank, treeMismatch };
  }

  // ---- structural refusals -------------------------------------------------

  if (live.length >= 2) {
    return refuse({
      code: "two-live-workstreams",
      message:
        `${live.length} live workstreams (stage is neither done nor retired): ` +
        `${live.map((r) => `${r.state.hash ?? r.name} (${r.state.stage})`).join(", ")}. ` +
        "A migration moves ONE doc set, and the destination layout holds one — " +
        "moving either would orphan the rest. Close or retire the others first.",
      paths: live.map((r) => r.rel),
    });
  }

  // No live workstream is not automatically a refusal: a repo whose only
  // workstream is `done` still has a tree, and migrating it is legitimate.
  // Two DEAD ones are ambiguous for exactly the reason two live ones are.
  const owner = live[0] ?? (specs.length === 1 ? specs[0] : undefined);
  if (owner === undefined) {
    return refuse({
      code: "no-workstream",
      message:
        specs.length === 0
          ? "no engine workstream found — `plan/` holds no spec with a `stage:`, so there is " +
            "no doc set to migrate. Run `devx workstream new` first."
          : `${specs.length} workstreams and none live — cannot tell which doc set to migrate. ` +
            "Re-open the one you mean (`stage:` other than done/retired) and re-run.",
      paths: specs.map((r) => r.rel),
    });
  }

  const slug = planFilenameSlug(owner.name);
  const sourceRel = planSpecWorkstreamRel(owner.name, owner.state.workstream, engine);
  const targetRel = docSetRelFor(owner.name, engine, target);
  if (sourceRel === null || targetRel === null) {
    // Which side failed decides the advice, because the two have different
    // fixes and only one of them is about frontmatter. Under `project-level`
    // `planSpecWorkstreamRel` returns `.` unconditionally and never consults
    // `workstream:`, so telling that operator to add the field would be advice
    // that provably does nothing.
    return refuse(
      {
        code: "no-workstream",
        message:
          sourceRel === null
            ? `cannot resolve the CURRENT doc-set directory for '${owner.name}' — it has no ` +
              "`workstream:` frontmatter and its filename carries no parseable slug. Add " +
              "`workstream: <dir>` to the plan spec, or rename it to the " +
              "`plan-<hash>-<YYYY-MM-DDTHH:MM>-<slug>.md` shape, and re-run."
            : `cannot resolve the DESTINATION doc-set directory for '${owner.name}' — its ` +
              "filename carries no parseable slug, and the slug is what the destination " +
              "directory gets called. Rename the plan spec to the " +
              "`plan-<hash>-<YYYY-MM-DDTHH:MM>-<slug>.md` shape and re-run. " +
              "(`workstream:` frontmatter cannot help here — under this layout it is not " +
              "read at all, and the destination name comes from the filename.)",
        paths: [owner.rel],
      },
      { specRel: owner.rel, slug },
    );
  }

  const sourceBase = baseFor(repoRoot, from, sourceRel);
  const targetBase = baseFor(repoRoot, target, targetRel);
  const sourceDirAbs = absOf(repoRoot, sourceRel);
  // Under `workstream` the doc set is a bounded directory devx owns, so it can
  // be walked whole. Under `project-level` the "doc set" is the repo root,
  // which is a boundary around nothing — `README.md` and `package.json` are
  // not artifacts — so only the map can speak there.
  const sourceIsBoundedDir = from !== "project-level";
  const found: Partial<MovePlan> = {
    specRel: owner.rel,
    sourceRel,
    workstreamRel: targetRel,
    slug,
  };

  // Every OTHER doc set on disk would be orphaned by a move into a layout that
  // holds one. The >=2-live check above cannot see these: a `done` workstream
  // still owns a tree, and under `project-level` `planSpecWorkstreamRel`
  // returns `.` for EVERY spec — so after the migration each of those done
  // specs resolves to the repo root and reads the migrated workstream's
  // artifacts as its own. That is worse than orphaning; it is silent aliasing.
  if (sourceIsBoundedDir && target === "project-level") {
    const others = otherDocSetDirs(fs, repoRoot, engine, sourceRel);
    if (others.length > 0) {
      return refuse(
        {
          code: "multiple-doc-sets",
          message:
            `${others.length} other doc set(s) exist on disk. The '${target}' layout holds ` +
            "exactly one, at the repo root — so after this migration every one of those " +
            "would resolve to the repo root too and read the migrated workstream's " +
            "artifacts as its own. Archive or delete them first; a done workstream still " +
            "owns its tree.",
          paths: others,
        },
        found,
      );
    }
  }

  if (docSetPresentAt(fs, targetBase)) {
    // Exactly what a half-finished migration leaves behind, which is why the
    // message names the destination rather than saying "already migrated":
    // the operator has to look at what is there before anything else moves.
    return refuse(
      {
        code: "destination-occupied",
        message:
          `a doc set is already at the '${target}' destination ` +
          `(${targetRel === "." ? "the repo root" : targetRel}). ` +
          "Migrating onto it would overwrite or interleave two doc sets, and there is no " +
          "reading of that which keeps both. Move or delete the existing one first." +
          (target === "project-level"
            ? ""
            : " An EMPTY directory counts: under `workstream` the directory is itself the " +
              "doc set, so remove the shell if a previous run left one."),
        paths: DOC_SET_EVIDENCE.map((k) => stageSubject(target, targetBase, k).rel).filter(
          (rel) => fs.exists(absOf(repoRoot, rel)),
        ),
      },
      found,
    );
  }

  // ---- the moves -----------------------------------------------------------
  const { moves, seen } = buildDocSetMoves(fs, from, sourceBase, target, targetBase);

  // ---- independent refusals, accumulated -----------------------------------
  const refusals: Refusal[] = [];

  if (sourceIsBoundedDir) {
    const prefix = normalizeArtifactPath(sourceRel);
    const unmapped = walkFiles(fs, sourceDirAbs)
      .map((rel) => `${prefix}/${rel}`)
      .filter((rel) => !seen.has(rel));
    if (unmapped.length > 0) {
      refusals.push({
        code: "unmapped-doc-set-files",
        message:
          `${unmapped.length} file(s) in the doc set are not artifacts the layout map can ` +
          "name, so this migration has nowhere to put them and would leave them behind — " +
          "splitting the doc set across two layouts and, because the source directory would " +
          "then survive, making the reverse migration refuse forever. Move them into " +
          "`decisions/` (which migrates whole), or out of the doc set, and re-run.",
        paths: unmapped,
      });
    }
  }

  const clashes = destinationClashes(fs, repoRoot, moves);
  if (clashes.length > 0) {
    refusals.push({
      code: "destination-clash",
      message:
        `${clashes.length} destination path(s) are already taken by a file that is not ` +
        "moving. `git mv` would fail partway through the list, leaving the tree half " +
        "migrated — the exact state these refusals exist to prevent. A case-DIFFERING name " +
        "counts only where the filesystem says it does: the canonical instance is `plan.md` " +
        "against devx's own `PLAN.md` backlog on macOS/APFS and Windows/NTFS " +
        "(debug-135dc9), and on a case-sensitive filesystem those coexist and this does not " +
        "fire.",
      paths: clashes.map((c) => `${c.to}  (taken by ${c.existing})`),
    });
  }

  const escaping = moves.filter((m) => escapesRepo(m.to) || escapesRepo(m.from));
  if (escaping.length > 0) {
    refusals.push({
      code: "destination-outside-repo",
      message:
        "the resolved layout puts artifacts outside the repository. " +
        "`engine.workstreams_root` is taken verbatim, so a `../` or absolute value points " +
        "the destination out of the tree — where `git mv` refuses anyway, but only after " +
        "directories have been created there. Fix `engine.workstreams_root` to a path " +
        "inside the repo and re-run.",
      paths: escaping.map((m) => `${m.from} → ${m.to}`),
    });
  }

  return { ...blank, ...found, noop: false, moves, refusals };
}

/** Doc-set directories under `workstreams_root` other than the one migrating.
 *  A directory listing is the right question HERE — unlike the live-workstream
 *  count, which is about specs — because the concern is trees left on disk,
 *  and a tree can outlive the spec that made it. */
function otherDocSetDirs(
  fs: Pick<MigrateFs, "exists" | "readdir" | "isDirectory">,
  repoRoot: string,
  engine: EngineConfig,
  sourceRel: string,
): string[] {
  const rootRel = normalizeArtifactPath(engine.workstreamsRoot);
  const rootAbs = absOf(repoRoot, rootRel);
  if (!fs.exists(rootAbs) || !fs.isDirectory(rootAbs)) return [];
  let names: string[];
  try {
    names = [...fs.readdir(rootAbs)].sort();
  } catch {
    return [];
  }
  const mine = normalizeArtifactPath(sourceRel);
  return names
    .map((n) => `${rootRel}/${n}`)
    .filter((rel) => rel !== mine && fs.isDirectory(absOf(repoRoot, rel)));
}

/** A repo-relative path that leaves the repository — absolute, or climbing out
 *  through `..`. `normalizeArtifactPath` resolves interior `a/../b`, so a
 *  leading `..` is the only surviving escape. */
function escapesRepo(rel: string): boolean {
  const n = normalizeArtifactPath(rel);
  return n.startsWith("/") || n === ".." || n.startsWith("../");
}

/**
 * Destination paths already taken by a file that is not itself moving.
 *
 * Covers BOTH an exact name and a case-differing one, and it has to cover
 * both: splitting the two between this and `docSetPresentAt` left a gap the
 * width of the artifact map. `docSetPresentAt` only knows five basenames, so
 * every `*-human.md`, every `*-outline.md`, `RESULTS.md`, and every file inside
 * `decisions/` / `checkpoints/` / `evals/` fell through both checks and died
 * mid-`git mv` with the tree half moved.
 *
 * The case-differing arm asks the FILESYSTEM rather than asserting a platform.
 * A listing that holds `PLAN.md` while `exists("plan.md")` answers true means
 * the two names are one file here; a listing that holds `PLAN.md` while
 * `exists("plan.md")` answers false means they are two, and there is nothing
 * to refuse. That probe costs one `exists` and makes the refusal correct on
 * ext4 and case-sensitive APFS instead of blocking `--to project-level`
 * permanently on Linux for a reason that is untrue there.
 *
 * Only directories that exist NOW are consulted: a destination directory the
 * migration itself will create cannot collide with anything.
 */
function destinationClashes(
  fs: Pick<MigrateFs, "exists" | "readdir" | "isDirectory">,
  repoRoot: string,
  moves: readonly Move[],
): Array<{ to: string; existing: string }> {
  const sources = new Set(moves.map((m) => normalizeArtifactPath(m.from)));
  const listings = new Map<string, string[] | null>();
  const listing = (dirRel: string): string[] | null => {
    const hit = listings.get(dirRel);
    if (hit !== undefined) return hit;
    const dirAbs = absOf(repoRoot, dirRel);
    let names: string[] | null;
    try {
      names = fs.exists(dirAbs) && fs.isDirectory(dirAbs) ? fs.readdir(dirAbs) : null;
    } catch {
      names = null;
    }
    listings.set(dirRel, names);
    return names;
  };

  const found: Array<{ to: string; existing: string }> = [];
  for (const m of moves) {
    const slash = m.to.lastIndexOf("/");
    const dirRel = slash >= 0 ? m.to.slice(0, slash) : ".";
    const names = listing(dirRel);
    if (names === null) continue;
    const want = m.to.slice(slash + 1);
    for (const name of names) {
      const sameName = name === want;
      const sameNameCaseBlind =
        !sameName &&
        name.toLowerCase() === want.toLowerCase() &&
        // The filesystem's own answer, not an assumption about the platform.
        fs.exists(absOf(repoRoot, m.to));
      if (!sameName && !sameNameCaseBlind) continue;
      const existingRel = normalizeArtifactPath(
        dirRel === "." ? name : `${dirRel}/${name}`,
      );
      // A file that is itself moving away is not an obstacle. (No such move
      // exists across today's two layouts; the guard costs one lookup and
      // keeps a future same-directory rename from reading as a clash.)
      if (sources.has(existingRel)) continue;
      found.push({ to: m.to, existing: existingRel });
      break;
    }
  }
  return found;
}

/** `fs.exists`, but the name has to match the listing byte for byte. See
 *  `docSetPresentAt` for why `existsSync` is not enough at the repo root. */
function fileExistsExact(
  fs: Pick<MigrateFs, "exists" | "readdir">,
  abs: string,
): boolean {
  if (!fs.exists(abs)) return false;
  try {
    return fs.readdir(dirname(abs)).includes(basename(abs));
  } catch {
    // An unreadable parent cannot confirm the name, and a move is not the
    // place to guess. Answering false leaves the file where it is.
    return false;
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Human-readable move list — what `--dry-run` prints, and what a real run
 *  prints after the fact. Same renderer both times on purpose: the operator
 *  compares the two by eye. */
export function renderMovePlan(plan: MovePlan): string {
  if (plan.noop) {
    const head = `already at '${plan.to}' — nothing to migrate`;
    if (plan.treeMismatch === null) return `${head}\n`;
    return (
      `${head}\n` +
      `  BUT the tree on disk looks like '${plan.treeMismatch}', not '${plan.to}'.\n` +
      "  Config and disk disagree — this is `devx doctor`'s `layout-tree-mismatch`,\n" +
      "  and it is what an interrupted migration leaves. Neither `--to` can fix it:\n" +
      `  set \`engine.docs_layout: ${plan.treeMismatch}\` to match the tree, or move the\n` +
      "  artifacts back by hand, then re-run.\n"
    );
  }
  const lines = [
    `${plan.from} → ${plan.to}${plan.slug === null ? "" : ` (${plan.slug})`}`,
    ...plan.moves.map((m) => `  ${m.from} → ${m.to}   [${m.kind}]`),
  ];
  if (plan.moves.length === 0) {
    lines.push("  (no artifact files found at the source — nothing to move)");
  }
  if (plan.specRel !== null && plan.workstreamRel !== null) {
    lines.push(`  ${plan.specRel}: workstream: → ${plan.workstreamRel}`);
  }
  lines.push(`  devx.config.yaml: engine.docs_layout: → ${plan.to}`);
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// The executor
// ---------------------------------------------------------------------------

/** Write seam — the mutations the executor makes. Kept separate from
 *  `MigrateFs` so the planner's type cannot express a write. */
export interface MigrateWriteFs {
  mkdirRecursive(path: string): void;
  writeFile(path: string, contents: string): void;
  /** Remove a directory ONLY if it is empty. A non-empty directory, a missing
   *  one, and a permission wall are all no-ops — this is cleanup, and cleanup
   *  that can delete data is not cleanup. */
  rmdirIfEmpty(path: string): void;
}

/** Production writer: the engine's atomic write + mkdir, plus the guarded
 *  rmdir. `writeFile` is `realEngineFs`'s tmp+rename, so a kill mid-write
 *  cannot tear the plan spec's frontmatter (mlc102, R10). */
export const realMigrateWriteFs: MigrateWriteFs = {
  mkdirRecursive: (p) => realEngineFs.mkdirRecursive(p),
  writeFile: (p, c) => realEngineFs.writeFile(p, c),
  rmdirIfEmpty: (p) => {
    try {
      rmdirSync(p);
    } catch {
      // ENOTEMPTY / ENOENT / EACCES — all "leave it alone", which is the only
      // correct answer for a cleanup step that must never delete data.
    }
  },
};

export interface ExecuteMigrationOpts {
  repoRoot: string;
  plan: MovePlan;
  /** Absolute path of `devx.config.yaml` — the file `setLeaf` rewrites. */
  configPath: string;
  exec: Exec;
  fs: MigrateFs;
  writeFs: MigrateWriteFs;
  /** Injected so the config write is testable without a real YAML round-trip
   *  against the caller's own config file. Defaults to the real writer.
   *
   *  `null` SKIPS the config step entirely, and that is not a test seam:
   *  `devx archive` (arc101) performs the same moves and the same
   *  `workstream:` rewrite, but changes no layout — writing
   *  `engine.docs_layout` there would record a layout change that did not
   *  happen. Expressed as a value rather than a second executor because the
   *  alternative is forking a function whose ordering guarantees are the
   *  whole reason it exists. */
  setLayout?: ((target: DocsLayout, configPath: string) => void) | null;
}

export interface ExecuteMigrationResult {
  moved: string[];
  specRewritten: string | null;
  configWritten: boolean;
  /** Now-empty source directories removed after the moves. Surfaced by the
   *  CLI: a delete nobody reported is a delete nobody can audit. */
  pruned: string[];
}

/** Thrown mid-execution. The tree is HALF-MOVED when this escapes — the
 *  message carries the recovery command, because at that point the operator
 *  needs it more than a stack trace. */
export class MigrationAborted extends Error {
  readonly moved: string[];
  constructor(message: string, moved: string[]) {
    super(message);
    this.name = "MigrationAborted";
    this.moved = moved;
  }
}

/** Refusal raised by an executor-side precondition — nothing has moved. */
export class MigrationRefused extends Error {
  readonly refusal: Refusal;
  constructor(refusal: Refusal) {
    super(refusal.message);
    this.name = "MigrationRefused";
    this.refusal = refusal;
  }
}

/**
 * Every path git currently tracks, repo-relative POSIX.
 *
 * `-z` because a path with a newline in it is legal and `\n`-splitting a
 * `git ls-files` would then report two files, neither of which exists. `-z`
 * also turns OFF git's path quoting, so no dequoting is needed here.
 *
 * Returns `null` when git cannot answer at all — a plain directory, or no git.
 */
function trackedPaths(exec: Exec, repoRoot: string): Set<string> | null {
  const r = exec("git", ["ls-files", "-z"], { cwd: repoRoot });
  if (r.exitCode !== 0) return null;
  return new Set(r.stdout.split("\0").filter((p) => p !== ""));
}

/**
 * Sources `git mv` cannot move because git does not track them.
 *
 * The clean-tree refusal guarantees every file on disk is tracked OR ignored,
 * so this set is essentially the ignored one — and an ignored file inside a
 * doc set is a state where the migration silently leaves data behind.
 *
 * Exported because it belongs in the REFUSAL set, not only inside the
 * executor: a `--dry-run` that succeeds where the real run refuses is a dry
 * run that lied, and predicting the real run is its entire job.
 */
export function untrackedSourcesRefusal(
  exec: Exec,
  repoRoot: string,
  moves: readonly Move[],
): Refusal | null {
  const tracked = trackedPaths(exec, repoRoot);
  if (tracked === null) {
    return {
      code: "not-a-git-repo",
      message:
        "`git ls-files` failed — this is not a git repository, or git is unavailable. " +
        "The migration moves files with `git mv` so history survives the rename; there is " +
        "no fs.rename fallback, because a rename git cannot see severs every artifact's " +
        "history.",
    };
  }
  const untracked = moves.map((m) => m.from).filter((p) => !tracked.has(p));
  if (untracked.length === 0) return null;
  return {
    code: "untracked-sources",
    message:
      `${untracked.length} file(s) in the doc set are not tracked by git, so \`git mv\` ` +
      "cannot move them and the migration would leave them behind at the old paths. Most " +
      "often they are ignored (a `.DS_Store`, a build artifact); the contents of a " +
      "symlinked directory look like this too, since git tracks the link and not what it " +
      "points at. Commit them, delete them, or narrow the ignore rule, then re-run.",
    paths: untracked,
  };
}

/**
 * Perform the migration: `git mv` every move, rewrite the plan spec's
 * `workstream:`, prune the emptied source directories, then write the config.
 *
 * The order is load-bearing and is NOT the PRD's stated reason (see the file
 * header). Moves first because they are the only step a clean tree makes
 * revertible in one command; the config write last because it is the step that
 * would dirty the tree and take that recovery away.
 *
 * Callers must have checked `plan.refusals` AND folded in the git-backed
 * refusals. The tracked-ness re-check below is deliberate belt-and-braces on a
 * destructive operation, not the primary gate.
 */
export function executeMigration(
  opts: ExecuteMigrationOpts,
): ExecuteMigrationResult {
  const { repoRoot, plan, exec, fs, writeFs } = opts;
  // `undefined` → the real writer; `null` → no config step at all (archive).
  const setLayout =
    opts.setLayout === null
      ? null
      : (opts.setLayout ??
        ((target: DocsLayout, configPath: string) =>
          setLeaf(["engine", "docs_layout"], target, "project", {
            projectPath: configPath,
          })));

  const untracked = untrackedSourcesRefusal(exec, repoRoot, plan.moves);
  if (untracked !== null) throw new MigrationRefused(untracked);

  // Destination parents, created lazily but REMEMBERED. Creating them without
  // remembering was fine until the FIRST move failed: nothing was staged, so
  // `git reset --hard HEAD` had nothing to undo there, and the empty
  // destination directory survived the recovery — where `docSetPresentAt`
  // reads a directory's existence as a doc set and wedges every retry on
  // `destination-occupied`, with no file to name in the refusal.
  const createdDirs: string[] = [];
  const ensureParent = (destAbs: string): void => {
    const parent = dirname(destAbs);
    if (fs.exists(parent)) return;
    writeFs.mkdirRecursive(parent);
    createdDirs.push(parent);
  };
  const dropCreatedDirs = (): void => {
    for (const d of [...createdDirs].reverse()) writeFs.rmdirIfEmpty(d);
  };

  const moved: string[] = [];
  for (const m of plan.moves) {
    const destAbs = absOf(repoRoot, m.to);
    ensureParent(destAbs);
    // `--` before the pathspecs: both sides are built from DISK state, so a
    // file named `-f` would otherwise be read as a flag. Same posture as
    // git-tx.ts, and it costs nothing to keep it where the argv is derived
    // rather than literal.
    const r = exec("git", ["mv", "--", m.from, m.to], { cwd: repoRoot });
    if (r.exitCode !== 0) {
      dropCreatedDirs();
      throw new MigrationAborted(
        `git mv '${m.from}' '${m.to}' failed: ${(r.stderr || r.stdout).trim()}\n` +
          `${moved.length} file(s) had already moved. The tree was clean before this run, ` +
          "so `git reset --hard HEAD` restores it exactly (`git mv` STAGES its renames, " +
          "which is why `git checkout -- .` alone is not enough). Destination directories " +
          "this run created have already been removed.",
        moved,
      );
    }
    moved.push(m.from);
  }

  // Only `workstream:` — `stage:`, `gate_status:` and `gate_verdicts:` are
  // never read here, so no amount of care is required to preserve them. That
  // is the whole design: they live in the spec, and the spec does not move.
  let specRewritten: string | null = null;
  if (plan.specRel !== null && plan.workstreamRel !== null) {
    const specAbs = absOf(repoRoot, plan.specRel);
    try {
      const patched = applyEnginePatch(fs.readFile(specAbs), {
        workstream: plan.workstreamRel,
      });
      writeFs.writeFile(specAbs, patched);
      specRewritten = plan.specRel;
    } catch (e) {
      throw new MigrationAborted(
        `the files moved, but rewriting '${plan.specRel}' failed: ` +
          `${e instanceof Error ? e.message : String(e)}. Set ` +
          `\`workstream: ${plan.workstreamRel}\` by hand and then ` +
          `\`engine.docs_layout: ${plan.to}\`, or \`git reset --hard HEAD\` to undo the moves.`,
        moved,
      );
    }
  }

  // Prune the emptied source tree. Skipped under `project-level` (the source
  // is the repo root), load-bearing under `workstream`: `docSetPresentAt`
  // reads a workstream directory's mere EXISTENCE as a doc set, so an empty
  // `_devx/workstreams/<slug>/` left behind makes the reverse migration refuse
  // `destination-occupied` forever — and that reverse migration is the only
  // rollback R-5 has after the fact.
  //
  // After the spec rewrite, deliberately: it deletes nothing git tracks (empty
  // directories are not tracked), so it cannot affect the recovery above.
  const pruned = pruneSourceDocSet(fs, writeFs, repoRoot, plan);

  if (setLayout !== null) {
    try {
      setLayout(plan.to, opts.configPath);
    } catch (e) {
      throw new MigrationAborted(
        "the files moved and the spec was rewritten, but the config write failed: " +
          `${e instanceof Error ? e.message : String(e)}. Set ` +
          `\`engine.docs_layout: ${plan.to}\` by hand — the tree is already in that shape, ` +
          "and `devx doctor`'s `layout-tree-mismatch` finding will keep reporting the gap " +
          "until you do.",
        moved,
      );
    }
  }

  return { moved, specRewritten, configWritten: setLayout !== null, pruned };
}

/**
 * Remove the directories the moves emptied, deepest first, INCLUDING the doc
 * set's own directory.
 *
 * Bounded to `plan.sourceRel` and its descendants — walked from that directory
 * rather than derived from the ancestors of moved files, and both halves of
 * that matter. Deriving from move ancestors missed every EMPTY directory
 * (`devx workstream new` scaffolds `decisions/`, `checkpoints/` and `evals/`
 * empty, and `checkpoints/` stays empty until the first `/devx verify`), which
 * is exactly the shape a mid-flight workstream has — so the rollback stayed
 * broken for the repos most likely to migrate. It also had no upper bound: the
 * ancestor chain runs all the way to the repo root, and with
 * `workstreams_root: docs/planning/ws` it deleted the user's `docs/`.
 *
 * Skipped when the source doc set IS the repo root: nothing there belongs to
 * the doc set rather than to the repo.
 *
 * `rmdirIfEmpty` is the whole safety story — it refuses a non-empty directory,
 * so anything still holding a file survives untouched rather than being swept.
 */
function pruneSourceDocSet(
  fs: Pick<MigrateFs, "exists" | "readdir" | "isDirectory">,
  writeFs: Pick<MigrateWriteFs, "rmdirIfEmpty">,
  repoRoot: string,
  plan: MovePlan,
): string[] {
  const sourceRel =
    plan.sourceRel === null ? null : normalizeArtifactPath(plan.sourceRel);
  if (sourceRel === null || sourceRel === "" || sourceRel === ".") return [];
  const sourceAbs = absOf(repoRoot, sourceRel);
  if (!fs.exists(sourceAbs) || !fs.isDirectory(sourceAbs)) return [];

  // Descendants deepest-first, then the doc-set dir itself last.
  const rels = [...walkDirs(fs, sourceAbs).map((r) => `${sourceRel}/${r}`), sourceRel];
  const pruned: string[] = [];
  for (const rel of rels) {
    const abs = absOf(repoRoot, rel);
    if (!fs.exists(abs) || !fs.isDirectory(abs)) continue;
    let names: string[];
    try {
      names = fs.readdir(abs);
    } catch {
      continue;
    }
    if (names.length > 0) continue;
    writeFs.rmdirIfEmpty(abs);
    if (!fs.exists(abs)) pruned.push(rel);
  }
  return pruned;
}

// ---------------------------------------------------------------------------
// Git-backed refusals (the predicates a pure function cannot see)
// ---------------------------------------------------------------------------

/**
 * Does `devx.config.yaml` sit at the git top level?
 *
 * It has to, and the reason is the recovery model rather than tidiness. Both
 * git predicates here run with `cwd: repoRoot` while `git status` reports paths
 * relative to the TOP LEVEL, so in a monorepo checkout the dirty-tree refusal
 * fires on unrelated dirt and prints paths that do not resolve from
 * `repoRoot`. Worse, the abort path's `git reset --hard HEAD` is repo-wide: run
 * from a nested devx project it discards the OUTER repo's uncommitted work —
 * the exact information loss the clean-tree refusal exists to prevent.
 *
 * `realpath` on both sides because macOS hands out `/var/...` temp dirs that
 * git reports as `/private/var/...`; comparing raw strings would refuse every
 * temp-dir fixture and every `/tmp` checkout.
 */
export function nestedRepoRootRefusal(exec: Exec, repoRoot: string): Refusal | null {
  const r = exec("git", ["rev-parse", "--show-toplevel"], { cwd: repoRoot });
  // "Not a git repo at all" is a different refusal with a different message,
  // raised by the two predicates below; do not double-report it here.
  if (r.exitCode !== 0) return null;
  const toplevel = r.stdout.trim();
  if (toplevel === "") return null;
  const canon = (p: string): string => {
    try {
      return realpathSync(p);
    } catch {
      return resolve(p);
    }
  };
  if (canon(toplevel) === canon(repoRoot)) return null;
  return {
    code: "nested-repo-root",
    message:
      `devx.config.yaml is at '${repoRoot}' but the git repository's top level is ` +
      `'${toplevel}'. This migration's recovery model is repo-wide — a clean tree plus ` +
      "`git reset --hard HEAD` — so running it from a nested project would put the OUTER " +
      "repo's uncommitted work inside the blast radius of a rollback, and the dirty-tree " +
      "check would report paths that do not resolve from here. Run the migration in a " +
      "repository whose root is the devx project.",
  };
}

/**
 * Is the working tree clean? Returns a `Refusal` when it is not, or when git
 * cannot answer at all.
 *
 * `-uall` because plain `--porcelain` collapses an untracked directory to
 * `?? dir/`, which would hide a whole half-migrated doc set behind one line.
 * `-z` rather than `core.quotePath=false`: quoting is what makes a ` -> `
 * rename split unsafe (a file literally named `a -> b.md` arrives C-quoted and
 * tears into two fragments, doubling the reported count), and `-z` both
 * disables quoting AND delivers a rename's two paths as separate NUL-delimited
 * records. Both sides are recorded because a pending rename is exactly what a
 * previous interrupted migration leaves, and the operator needs both ends.
 *
 * Clean is not fussiness: it is what makes `git reset --hard HEAD` a complete
 * undo. Without it, recovering from a failed migration would also discard
 * whatever the operator had in flight — the same information loss the refusal
 * exists to prevent, just relocated.
 */
export function dirtyTreeRefusal(exec: Exec, repoRoot: string): Refusal | null {
  const st = exec("git", ["status", "--porcelain=v1", "-uall", "-z"], {
    cwd: repoRoot,
  });
  if (st.exitCode !== 0) {
    return {
      code: "not-a-git-repo",
      message:
        `\`git status\` failed: ${(st.stderr || st.stdout).trim() || "no output"}. ` +
        "A migration moves files with `git mv` so each artifact's history survives the " +
        "rename — a non-git directory is therefore a refusal, not a case for an fs.rename " +
        "fallback.",
    };
  }
  const paths = parsePorcelainZ(st.stdout);
  if (paths.length === 0) return null;
  return {
    code: "dirty-tree",
    message:
      `the working tree is dirty (${paths.length} path(s) with uncommitted changes). ` +
      "A clean tree is what makes this migration recoverable: every `git mv` is undone by " +
      "one `git reset --hard HEAD`, and that command would also throw away uncommitted " +
      "work. Commit or stash first, then re-run.",
    paths,
  };
}

/**
 * Paths out of `git status --porcelain=v1 -z`.
 *
 * Records are NUL-terminated `XY <path>`. A rename or copy (`R`/`C` in either
 * status column) is followed by ONE EXTRA record holding the original path,
 * with no `XY ` prefix — which is why this is a stateful scan rather than a
 * map: consuming that follower as a status record would mis-parse its first
 * three characters as flags. `-z` disables quoting, so `dequoteGitPath` is a
 * no-op here and is applied only as a belt for a git that quoted anyway.
 */
function parsePorcelainZ(stdout: string): string[] {
  const records = stdout.split("\0").filter((r) => r !== "");
  const paths: string[] = [];
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    if (rec.length < 4) continue;
    const xy = rec.slice(0, 2);
    paths.push(dequoteGitPath(rec.slice(3)));
    if (xy.includes("R") || xy.includes("C")) {
      const orig = records[++i];
      if (orig !== undefined) paths.push(dequoteGitPath(orig));
    }
  }
  return paths;
}
