// Workstream scaffolder + hash→workstream resolver (v2e101).
//
// `devx workstream new <slug> [--hash <hash>]` scaffolds the sibling
// directory a plan spec's engine artifacts live in (v2/02-engine.md §3):
//
//   _devx/workstreams/<slug>/
//   ├── prd/
//   │   ├── agent.md        ← from _devx/templates/engine/prd/agent.md
//   │   ├── human.md        ← agent-authored digest (stage writes it; not scaffolded)
//   │   ├── outline.md      ← HUMAN-ONLY, optional (devx outline init; never scaffolded)
//   │   └── outline-critique.md ← agent's critique (written when an outline exists)
//   ├── design/             ← same quartet, authored at Design stage (not scaffolded)
//   ├── plan/               ← same quartet, authored at Plan stage (not scaffolded)
//   ├── expectations.md     ← from _devx/templates/engine/expectations.md
//   ├── todo.md             ← from _devx/templates/engine/todo.md (hfi101)
//   ├── decisions/          ← empty (dated verify/critique/revision reports)
//   ├── checkpoints/        ← empty (per-phase verification reports)
//   └── evals/              ← empty (RED-gate artifacts + RED-report.md + human-facing companions)
//
// and creates-or-extends the plan spec (`plan/plan-<hash>-<ts>-<slug>.md`)
// with the engine frontmatter: `stage: prd`, `entered_at: prd`,
// `gate_status:` all false, `outcome: {status: null, measure_by: null}`,
// plus a `workstream:` pointer so every gate can resolve hash → dir without
// re-deriving the slug from the filename.
//
// Idempotency contract (spec AC): re-running with the same slug/hash is a
// clean no-op — existing artifacts are NEVER overwritten, live gate flags
// are never reset (ensureEngineFrontmatter adds only missing keys). A slug
// whose directory is claimed by a DIFFERENT spec's workstream pointer, or a
// hash whose spec points at a different directory, is a refusal.
//
// Spec: dev/dev-v2e101-2026-07-05T13:01-engine-cli-primitives.md
// Design: v2/02-engine.md §3, §8

import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

import {
  type EngineState,
  HASH_RE,
  SPEC_TYPE_DIRS,
  ensureEngineFrontmatter,
  frontmatterParseError,
  readEngineState,
} from "./frontmatter.js";
import { type EngineConfig } from "./config.js";
import {
  type ArtifactKind,
  type DocsLayout,
  type ResolvedBase,
  SCAFFOLD_SUBDIR_KINDS,
  SUBJECT_STAGES,
  artifactRel,
  stageSubject,
} from "./artifacts.js";
import { writeAtomic } from "../supervisor-internal.js";

// ---------------------------------------------------------------------------
// fs seam — same shape as devx/claim.ts's ClaimFs (subset).
// ---------------------------------------------------------------------------

export interface EngineFs {
  readFile(path: string): string;
  writeFile(path: string, contents: string): void;
  exists(path: string): boolean;
  mkdirRecursive(path: string): void;
  readdir(path: string): string[];
}

export const realEngineFs: EngineFs = {
  readFile: (p) => readFileSync(p, "utf8"),
  // mlc102: tmp+rename for every engine write — a kill mid-write must never
  // tear a spec's frontmatter patch (R10) or a scaffolded artifact. The
  // explicit parent-dir probe preserves writeFileSync's ENOENT contract
  // (review EC-F7): writeAtomic mkdirs missing parents, which would let a
  // typo'd/stale path silently mint stray directories instead of erroring.
  writeFile: (p, c) => {
    if (!existsSync(dirname(p))) {
      const err = new Error(
        `ENOENT: no such directory, write '${p}'`,
      ) as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    }
    writeAtomic(p, c);
  },
  exists: (p) => existsSync(p),
  mkdirRecursive: (p) => mkdirSync(p, { recursive: true }),
  readdir: (p) => readdirSync(p),
};

/** Kebab-case, ≤50 chars — the spec-filename slug convention (CLAUDE.md). */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The workstream dir under `project-level`: the repo root itself. Spelled
 *  `.` rather than `""` because `workstream:` is already a repo-relative PATH
 *  in every existing spec, so `.` extends that type instead of overloading it
 *  (design §Trade-offs) — and `join(repoRoot, ".")` needs no special case. */
export const PROJECT_LEVEL_WORKSTREAM_REL = ".";

const PLAN_FILENAME_RE =
  /^plan-[a-z0-9]{3,12}-\d{4}-\d{2}-\d{2}T\d{2}:\d{2}-(.+)\.md$/i;

/** Slug tail of a plan-spec FILENAME (shape:
 *  `plan-<hash>-<YYYY-MM-DDTHH:MM>-<slug>.md`), or null when the name doesn't
 *  match. Layout-INDEPENDENT on purpose: under `project-level` the slug still
 *  exists — it names the plan spec's file and title — it just names no
 *  directory (design §"The slug"), so it is the only identity a flat repo's
 *  one workstream has. */
export function planFilenameSlug(name: string): string | null {
  return PLAN_FILENAME_RE.exec(name)?.[1] ?? null;
}

/**
 * Derive the repo-relative workstream dir from a plan-spec FILENAME, or null
 * when the name doesn't match. Single-sourced (hfi103) — resolveWorkstream,
 * the next gatherer, and `devx status` all fall back through this when the
 * spec has no `workstream:` frontmatter.
 *
 * Takes the whole `EngineConfig` rather than a bare `workstreamsRoot`
 * (dlr103) because the FILENAME DERIVATION IS THE PART THAT MUST NOT RUN
 * under `project-level`: it turns `plan-b7e38f-…-scene-engine.md` into
 * `_devx/workstreams/scene-engine`, a folder path in a repo that has no
 * folders. A layout-blind helper that four call sites must remember to guard
 * is the same class of bug as the hand-joined artifact paths this workstream
 * exists to close, so the guard lives here, once.
 *
 * Under `project-level` the answer is `.` unconditionally — including for a
 * name this cannot parse. The layout, not the filename, is what says where
 * the doc set lives, so an unparseable hand-authored name is no reason to
 * report "no workstream" in a repo that plainly has exactly one.
 */
export function planFilenameWorkstreamRel(
  name: string,
  engine: EngineConfig,
): string | null {
  if (engine.docsLayout === "project-level") return PROJECT_LEVEL_WORKSTREAM_REL;
  const slug = planFilenameSlug(name);
  return slug === null ? null : `${engine.workstreamsRoot}/${slug}`;
}

/**
 * Repo-relative workstream dir for a PLAN SPEC, from its `workstream:`
 * frontmatter with the filename-slug fallback — and under `project-level`,
 * the repo root regardless of either.
 *
 * This exists because re-signaturing `planFilenameWorkstreamRel()` alone does
 * not actually close the hole it was meant to close. Two of its four call
 * sites spell the fallback as `state.workstream ?? planFilenameWorkstreamRel(…)`,
 * so a spec that HAS a pointer never reaches the layout-aware helper at all —
 * and under `project-level` that pointer is exactly the stale
 * `<workstreams_root>/<slug>` a half-finished migration leaves behind. Each
 * site would then join a directory the layout says does not exist: `devx
 * status` drops the workstream on its existence check, and `devx next` reads
 * every artifact as missing and wedges on "PRD not yet authored" forever.
 *
 * So the `??` itself moves in here with the guard. Same reasoning as the
 * signature change one level down (design §Trade-offs): a rule four call
 * sites must remember to apply is the bug class this workstream exists to
 * close, not an instance of it.
 */
export function planSpecWorkstreamRel(
  name: string,
  workstreamValue: string | null,
  engine: EngineConfig,
): string | null {
  if (engine.docsLayout === "project-level") return PROJECT_LEVEL_WORKSTREAM_REL;
  return workstreamValue ?? planFilenameWorkstreamRel(name, engine);
}

/**
 * Display/identity slug for a workstream, given the plan spec's FILENAME and
 * its resolved dir.
 *
 * Under `project-level` the dir is `.`, whose tail is `.` — nothing anyone
 * typed, and a poor graph-node id or `--workstream` scope token. The slug
 * still exists under that layout; it just names the plan spec's file and
 * title rather than a directory (design §"The slug"), so that is where this
 * reads it from. Single-sourced so `devx next`, `devx graph` and loop scoping
 * spell one workstream's identity the same way.
 */
export function workstreamSlugFor(
  name: string | null,
  wsRel: string | null,
  engine: EngineConfig,
): string | null {
  if (engine.docsLayout === "project-level") {
    return name === null ? null : planFilenameSlug(name);
  }
  // filter(Boolean) guards a trailing-slash `workstream:` hand-edit — plain
  // pop() returns "" there, which is falsy but not nullish.
  return wsRel === null ? null : (wsRel.split("/").filter(Boolean).pop() ?? null);
}

/** Repo-relative engine-template dir. Exported for `devx todo sync`
 *  (hfi103), which instantiates todo.md from the same shipped template
 *  the scaffold uses. */
export const TEMPLATES_DIR = join("_devx", "templates", "engine");
const PLAN_DIR = "plan";

/** Refusal (exit 1): valid request, engine says no. Message is the report. */
export class WorkstreamRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkstreamRefusal";
  }
}

/** Hard error (exit 2): missing templates, unreadable spec, bad input. */
export class WorkstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkstreamError";
  }
}

export interface CreateWorkstreamOpts {
  repoRoot: string;
  /** Optional under `project-level`, where the doc set has no directory to
   *  name and the slug titles the plan spec only; required under
   *  `workstream`, where it IS the directory (design §"The slug"). */
  slug?: string;
  /** Extend this existing plan spec instead of creating a fresh one. */
  hash?: string;
  engine: EngineConfig;
  now?: () => Date;
  fs?: Partial<EngineFs>;
}

export interface CreateWorkstreamResult {
  hash: string;
  slug: string;
  /** Repo-relative plan-spec path. */
  specPath: string;
  /** Repo-relative workstream dir. */
  workstreamDir: string;
  /** What this invocation actually wrote (all false ⇒ full no-op). */
  created: {
    dir: boolean;
    spec: boolean;
    prd: boolean;
    expectations: boolean;
    todo: boolean;
    specFrontmatterExtended: boolean;
  };
  noop: boolean;
}

/** Slug → display title (`harness-fold-in` → `Harness Fold In`). Exported
 *  for `devx todo sync` (hfi103), which substitutes the same template
 *  placeholder the scaffold does — single-sourced so they can't drift. */
export function titleFromSlug(slug: string): string {
  return slug
    .split("-")
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** Minute-precision local ISO — the spec-filename timestamp shape. */
function formatMinuteIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Second-precision local ISO with offset — the `created:` frontmatter shape. */
function formatFullIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const offMin = -d.getTimezoneOffset();
  const sign = offMin >= 0 ? "+" : "-";
  const abs = Math.abs(offMin);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

export function generateHash(
  fs: Pick<EngineFs, "exists" | "readdir">,
  repoRoot: string,
): string {
  // 6 hex chars per the spec convention. Regenerate on the (unlikely)
  // collision with an existing spec in ANY type dir — mss101 widened the
  // scan from `plan/` so consumers minting non-plan hashes (`devx split`)
  // can't collide with an existing dev/debug/test spec.
  for (let attempt = 0; attempt < 32; attempt++) {
    const hash = randomBytes(3).toString("hex");
    const collision = SPEC_TYPE_DIRS.some((type) => {
      const dir = join(repoRoot, type);
      return (
        fs.exists(dir) &&
        fs.readdir(dir).some((n) => n.startsWith(`${type}-${hash}-`))
      );
    });
    if (!collision) return hash;
  }
  throw new WorkstreamError("could not generate a collision-free hash");
}

/** The three artifacts the scaffold instantiates from shipped templates.
 *
 *  One `kind` per row, and both paths are derived from it: the DESTINATION
 *  through this repo's layout, the SOURCE through `workstream` always. The
 *  template tree ships workstream-shaped inside the npm package under BOTH
 *  layouts, so resolving the source through `project-level` would look for
 *  `_devx/templates/engine/prd.md`, find nothing, and throw `engine template
 *  missing` on the very use case that layout exists for (E-3's MUST_NOT_FLAG
 *  entry says the same thing from the other side).
 *
 *  `templateSourceRel()` rather than a literal: the pinned layout is the
 *  claim being made, and pinning it in an argument keeps one definition of
 *  what `prd/agent.md` spells. */
const templateSourceRel = (kind: ArtifactKind): string =>
  artifactRel("workstream", kind);

const SCAFFOLDED_ARTIFACTS: ReadonlyArray<{
  kind: ArtifactKind;
  key: "prd" | "expectations" | "todo";
}> = [
  { kind: { kind: "agent", stage: "prd" }, key: "prd" },
  { kind: { kind: "expectations" }, key: "expectations" },
  { kind: { kind: "todo" }, key: "todo" },
];

/** Artifacts whose presence proves a doc set already lives at a base. The
 *  three authored subjects plus the two root files — anything the scaffold or
 *  a stage would have written. */
const DOC_SET_EVIDENCE: readonly ArtifactKind[] = [
  ...SUBJECT_STAGES.map((stage): ArtifactKind => ({ kind: "agent", stage })),
  { kind: "expectations" },
  { kind: "todo" },
];

/**
 * Is a doc set already present at this base?
 *
 * LOCAL and temporary: `dev-lay101` owns the shared one-doc-set predicate over
 * the 0/1/≥2 × layout matrix, and this carries its signature so the two
 * refusal sites (here and `devx layout migrate`) collapse onto it when it
 * lands. Delete this then — never keep a second permanent definition
 * (design §Out of scope; R-8).
 *
 * The question replaces "does the directory exist", which under
 * `project-level` asks about the repo root and is therefore always true — so
 * the no-hash adoption path, UC-1's exact flow, refused every invocation
 * before writing anything.
 *
 * Under `workstream` the directory IS part of the doc set: nothing but
 * scaffolding creates `<workstreams_root>/<slug>/`, so its existence is
 * sufficient evidence and behavior there is unchanged, empty dir included.
 * Under `project-level` the base is the repo root, which is evidence of
 * nothing, so only artifacts count.
 */
function docSetPresentAt(
  fs: Pick<EngineFs, "exists" | "readdir">,
  base: ResolvedBase,
): boolean {
  if (base.layout !== "project-level") {
    return fs.exists(join(base.repoRoot, ...base.workstreamRel.split("/")));
  }
  // Exact-name, NOT `fs.exists`. Under `project-level` the doc set sits at the
  // repo root beside devx's own backlogs, and macOS/Windows filesystems are
  // case-insensitive by default — so `existsSync("plan.md")` answers TRUE for
  // the repo's `PLAN.md` backlog, and every scaffold refused with "a doc set
  // already exists at '.'" on the one platform most owners run. `plan.md` is
  // not `PLAN.md`; the listing is the only thing that knows that.
  //
  // (The deeper `plan.md`/`PLAN.md` collision this exposes is filed as
  // `debug-135dc9` — probes elsewhere still ask `fs.exists`.)
  const dirAbs = join(base.repoRoot, ...base.workstreamRel.split("/"));
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

/** Slug for a `project-level` scaffold invoked with none: the repo's own
 *  directory name, kebab-normalized.
 *
 *  The slug still exists under this layout — it names the plan spec's file and
 *  title (design §"The slug") — it just names no directory, so it needs a
 *  source that is about the project rather than about a path. The repo's name
 *  is the only one the tool can read without asking, and it is what the owner
 *  would have typed. A name that normalizes to nothing (a repo checked out as
 *  `_`, or at `/`) falls back to a constant rather than minting an invalid
 *  spec filename. */
export function defaultProjectSlug(repoRoot: string): string {
  const normalized = basename(repoRoot)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/, "");
  return normalized === "" ? "project" : normalized;
}

/** One doc set the repo holds: its identity slug and the base its artifacts
 *  resolve against. */
export interface DocSetEntry {
  slug: string;
  base: ResolvedBase;
}

/**
 * Every doc set in the repo — the enumeration `devx graph`'s backfill and
 * `devx layout migrate` both walk.
 *
 * Under `workstream` this is the `readdir(<workstreams_root>)` it always was.
 * Under `project-level` that root does not exist, so the readdir yields
 * nothing and phase ordering silently degrades to an empty board — no error,
 * no warning, just missing edges. This layer answers the question the
 * enumeration was really asking: there is exactly one doc set, at the repo
 * root, and its slug comes from the plan spec that claims it (the same place
 * `resolveSpecWorkstream` reads it from, so membership and enumeration cannot
 * disagree about one workstream's name).
 */
export function enumerateDocSets(
  fs: Pick<EngineFs, "exists" | "readdir" | "readFile">,
  repoRoot: string,
  engine: EngineConfig,
  cache?: PlanSpecIndexCache,
): DocSetEntry[] {
  if (engine.docsLayout === "project-level") {
    const base: ResolvedBase = {
      repoRoot,
      workstreamRel: PROJECT_LEVEL_WORKSTREAM_REL,
      layout: engine.docsLayout,
    };
    // The claiming spec first (an explicit `workstream:` pointer is
    // evidence), then any engine-managed plan spec — the same two passes, in
    // the same order, as `resolveSpecWorkstream`'s flat arm.
    const entries = planSpecEntries(fs, repoRoot, cache);
    // Pass 1 projects the pointer exactly as `resolveSpecWorkstream` does —
    // under this layout ANY non-null `workstream:` means "the root", including
    // a stale `<root>/<slug>` left by a half-finished migration. A raw compare
    // against `.` missed those, so the two disagreed about which spec owns the
    // doc set; `readOrderingSignals`' membership guard then discarded every
    // ordering signal, silently (review BH#3).
    const claiming =
      entries.find((e) => e.state.workstream !== null) ??
      // Pass 2: no pointer anywhere. Prefer a LIVE workstream — `entries` is
      // sorted by filename, i.e. by random hash, so "first engine spec" is an
      // arbitrary pick that lands on a long-since-done one as often as not.
      entries.find(
        (e) =>
          e.state.stage !== null &&
          e.state.stage !== "done" &&
          e.state.stage !== "retired",
      ) ??
      entries.find((e) => e.state.stage !== null);
    // A doc set with no readable name is still a doc set. Returning [] here
    // reproduces the exact silent-empty-board failure this function exists to
    // prevent, and contradicts `planFilenameWorkstreamRel`'s stated contract:
    // an unparseable hand-authored filename is no reason to report "no
    // workstream" in a repo that plainly has exactly one (review BH#7).
    const slug =
      workstreamSlugFor(claiming?.name ?? null, PROJECT_LEVEL_WORKSTREAM_REL, engine) ??
      defaultProjectSlug(repoRoot);
    return [{ slug, base }];
  }
  const root = join(repoRoot, engine.workstreamsRoot);
  if (!fs.exists(root)) return [];
  let names: string[];
  try {
    names = [...fs.readdir(root)].sort();
  } catch {
    return [];
  }
  return names.map((slug) => ({
    slug,
    base: {
      repoRoot,
      workstreamRel: `${engine.workstreamsRoot}/${slug}`,
      layout: engine.docsLayout,
    },
  }));
}

/**
 * Scaffold (or idempotently complete) a workstream. See file header for
 * the full contract. Throws WorkstreamRefusal (exit 1) / WorkstreamError
 * (exit 2).
 */
export function createWorkstream(
  opts: CreateWorkstreamOpts,
): CreateWorkstreamResult {
  const fs: EngineFs = { ...realEngineFs, ...(opts.fs ?? {}) };
  const now = (opts.now ?? (() => new Date()))();
  const { repoRoot } = opts;
  const flat = opts.engine.docsLayout === "project-level";

  // A missing slug is a REFUSAL under `workstream` (valid request, engine says
  // no) rather than a usage error, and it names the config key that made it
  // required — the operator's fix is one line away and the message points at
  // it. Under `project-level` the doc set has no directory, so the slug is
  // pure identity and the repo's own name is the honest default.
  if (opts.slug === undefined) {
    if (!flat) {
      throw new WorkstreamRefusal(
        "a slug is required under `engine.docs_layout: workstream` — it names the workstream's directory. " +
          "Run `devx workstream new <slug>`, or set `engine.docs_layout: project-level` for a repo that designs one thing at a time",
      );
    }
  }
  const slug = opts.slug ?? defaultProjectSlug(repoRoot);

  if (!SLUG_RE.test(slug) || slug.length > 50) {
    throw new WorkstreamError(
      `invalid slug '${slug}' (expected kebab-case, ≤50 chars)`,
    );
  }
  if (opts.hash !== undefined && !HASH_RE.test(opts.hash)) {
    throw new WorkstreamError(
      `invalid hash '${opts.hash}' (expected hex/alnum 3-12 chars)`,
    );
  }

  // Under `project-level` the doc set IS the repo root and the slug names no
  // directory at all (design §"The slug").
  const wsRel = flat
    ? PROJECT_LEVEL_WORKSTREAM_REL
    : `${opts.engine.workstreamsRoot}/${slug}`;
  const wsAbs = flat ? repoRoot : join(repoRoot, opts.engine.workstreamsRoot, slug);
  const base: ResolvedBase = {
    repoRoot,
    workstreamRel: wsRel,
    layout: opts.engine.docsLayout,
  };

  // ---- Resolve the plan spec: --hash wins; otherwise look for a spec that
  //      already claims this workstream dir; otherwise create fresh. ------
  let specAbs: string | null = null;
  let specState: EngineState | null = null;
  if (opts.hash !== undefined) {
    specAbs = findSpecForHashInFs(fs, repoRoot, PLAN_DIR, opts.hash);
    if (specAbs !== null) {
      specState = readEngineState(fs.readFile(specAbs));
      // Projected, not raw: under `project-level` every other resolver maps a
      // stale `<root>/<slug>` pointer to `.` (planSpecWorkstreamRel,
      // resolveWorkstream, resolveSpecWorkstream). Comparing raw here made this
      // the ONE place that disagreed, so `--hash` adoption — the documented
      // path for a spec that predates a layout flip — refused every time, and
      // the no-hash path then minted a duplicate spec beside it (review EC#5).
      const claimed =
        specState.workstream === null
          ? null
          : flat
            ? PROJECT_LEVEL_WORKSTREAM_REL
            : specState.workstream;
      if (claimed !== null && claimed !== wsRel) {
        throw new WorkstreamRefusal(
          `spec for hash '${opts.hash}' already belongs to workstream '${specState.workstream}' — refusing to rebind it to '${wsRel}'`,
        );
      }
    }
  } else {
    // No hash: adopt the spec that already points at this dir, if any.
    const planDir = join(repoRoot, PLAN_DIR);
    if (fs.exists(planDir)) {
      for (const name of [...fs.readdir(planDir)].sort()) {
        if (!name.endsWith(".md")) continue;
        const st = readEngineState(fs.readFile(join(planDir, name)));
        // Same projection as the `--hash` arm above.
        const claimed =
          st.workstream === null
            ? null
            : flat
              ? PROJECT_LEVEL_WORKSTREAM_REL
              : st.workstream;
        if (claimed !== wsRel) continue;
        // Under `project-level` `wsRel` is `.` for EVERY workstream, so this
        // loop matches any spec that claims the root — not the one the
        // operator named. Adopting it silently would return a hash and a
        // filename slug that disagree with the requested slug, print
        // "'<requested>' already scaffolded" for something never scaffolded,
        // and title the templates from a name no artifact carries (review
        // BH#4/EC#2). A repo that already designs one thing cannot start a
        // second under this layout; say so instead.
        const claimedSlug = workstreamSlugFor(name, wsRel, opts.engine);
        if (flat && opts.slug !== undefined && claimedSlug !== slug) {
          throw new WorkstreamRefusal(
            `this repo's doc set already belongs to workstream '${claimedSlug ?? basename(name)}' (plan/${name}) — ` +
              "`engine.docs_layout: project-level` holds exactly one doc set, so it cannot also hold " +
              `'${slug}'. Finish or retire that workstream, or switch to \`engine.docs_layout: workstream\``,
          );
        }
        specAbs = join(planDir, name);
        specState = st;
        break;
      }
    }
    if (specAbs === null && docSetPresentAt(fs, base)) {
      // Wording stays byte-identical under `workstream`, where the probe is
      // still literally "does the directory exist" — the operator's muscle
      // memory and every doc that quotes this string keep working. Only the
      // flat layout, where there is no directory to name, gets new prose.
      throw new WorkstreamRefusal(
        flat
          ? `a doc set already exists at the repo root but no plan spec points at it — re-run with --hash <hash> to bind an existing spec`
          : `workstream dir '${wsRel}' exists but no plan spec points at it — re-run with --hash <hash> to bind an existing spec`,
      );
    }
  }

  const created = {
    dir: false,
    spec: false,
    prd: false,
    expectations: false,
    todo: false,
    specFrontmatterExtended: false,
  };

  // ---- Create the spec if it doesn't exist yet. -------------------------
  let hash: string;
  if (specAbs === null) {
    hash = opts.hash ?? generateHash(fs, repoRoot);
    const specName = `plan-${hash}-${formatMinuteIso(now)}-${slug}.md`;
    specAbs = join(repoRoot, PLAN_DIR, specName);
    if (fs.exists(specAbs)) {
      throw new WorkstreamError(`spec path collision at plan/${specName}`);
    }
    fs.mkdirRecursive(join(repoRoot, PLAN_DIR));
    fs.writeFile(specAbs, freshSpecContent(hash, slug, wsRel, now));
    created.spec = true;
  } else {
    hash = specState?.hash ?? opts.hash ?? "";
    if (hash === "") {
      throw new WorkstreamError(
        `spec at ${basename(specAbs)} has no readable hash frontmatter`,
      );
    }
    // Extend: add missing engine keys only; never reset live state.
    const before = fs.readFile(specAbs);
    const { content: after, changed } = ensureEngineFrontmatter(before, {
      stage: "prd",
      enteredAt: "prd",
      workstream: wsRel,
    });
    if (changed) {
      fs.writeFile(specAbs, after);
      created.specFrontmatterExtended = true;
    }
  }

  // ---- Scaffold the dir tree (write-if-missing everywhere). -------------
  // Flat-era guard (adversarial review): on a pre-migration workstream,
  // write-if-missing would mint a FRESH template prd/agent.md next to the
  // real prd.md — the gate then reads the empty template and the real
  // content is invisible. Refuse with the doctor recipe instead.
  //
  // LAYOUT-DISCRIMINATED (dlr103). Under `project-level` a `<stage>.md` at the
  // doc-set base is not debris at all — it is the layout's AUTHORITATIVE
  // artifact — so the same probe that is a correct refusal under `workstream`
  // becomes a refusal of the very shape the config asked for. That misfire is
  // latent today only because this function still resolves `wsAbs` to
  // `<workstreams_root>/<slug>`; phase 4 moves the base to the repo root,
  // at which point an undiscriminated guard would refuse every invocation.
  // The reachable case NOW is an interrupted migration: config already flipped
  // to `project-level`, folder tree still on disk.
  //
  // The stage list is DERIVED (SUBJECT_STAGES), not inline, so a new stage
  // cannot arrive with an unguarded flat-era form. `SUBJECT_STAGES` and not
  // `STAGE_DIRS`: it is exactly `STAGE_DIRS` minus `evals`, and `evals` was a
  // DIRECTORY in the flat era too — an `evals.md` check would refuse a file
  // that was never an artifact, printing a `git mv evals.md evals/agent.md`
  // recipe for a path the engine has never read.
  if (opts.engine.docsLayout !== "project-level" && fs.exists(wsAbs)) {
    for (const stage of SUBJECT_STAGES) {
      if (fs.exists(join(wsAbs, `${stage}.md`))) {
        throw new WorkstreamRefusal(
          `workstream '${slug}' carries flat-era ${stage}.md (pre folder-per-artifact layout) — migrate first: ` +
            `mkdir -p ${wsRel}/${stage} && git mv ${wsRel}/${stage}.md ${wsRel}/${stage}/agent.md (devx doctor lists every affected file)`,
        );
      }
    }
  }
  if (!fs.exists(wsAbs)) {
    fs.mkdirRecursive(wsAbs);
    created.dir = true;
  }
  // `SCAFFOLD_SUBDIRS` land at the repo root under `project-level` (owner
  // decision, 2026-09-01). They are layout-identical rels, so routing them
  // through the base is what puts them there — no branch needed.
  for (const kind of SCAFFOLD_SUBDIR_KINDS) {
    const subAbs = stageSubject(base.layout, base, kind).abs;
    if (fs.exists(subAbs)) continue;
    fs.mkdirRecursive(subAbs);
    // Counts as creation. Under `project-level` `wsAbs` IS the repo root, so
    // the `created.dir` above can never fire — without this a run that made
    // three new root directories reported `noop: true` and told the operator
    // "already scaffolded — nothing to do" (review EC#7).
    created.dir = true;
  }

  const title = titleFromSlug(slug);
  for (const t of SCAFFOLDED_ARTIFACTS) {
    // DESTINATION resolves through the layout; SOURCE never does. The shipped
    // templates are workstream-shaped on disk in BOTH layouts, so an
    // `ArtifactKind`-driven rel of `prd.md` would look for
    // `_devx/templates/engine/prd.md` — which does not exist — and throw
    // `engine template missing` on every flat-repo scaffold (E-3's
    // MUST_NOT_FLAG entry says the same thing from the other side).
    const dest = stageSubject(base.layout, base, t.kind).abs;
    if (fs.exists(dest)) continue;
    const source = templateSourceRel(t.kind);
    const templateAbs = join(repoRoot, TEMPLATES_DIR, ...source.split("/"));
    if (!fs.exists(templateAbs)) {
      throw new WorkstreamError(
        `engine template missing at ${TEMPLATES_DIR}/${source} — run \`devx init\` (v2 scaffold) first`,
      );
    }
    const body = fs
      .readFile(templateAbs)
      .replace(/<workstream title>/g, title);
    // Stage-folder artifacts (prd/agent.md) need their parent dir first —
    // realEngineFs.writeFile deliberately throws on a missing parent.
    fs.mkdirRecursive(dirname(dest));
    fs.writeFile(dest, body);
    created[t.key] = true;
  }

  const specRel = `${PLAN_DIR}/${basename(specAbs)}`;
  const noop =
    !created.dir &&
    !created.spec &&
    !created.prd &&
    !created.expectations &&
    !created.todo &&
    !created.specFrontmatterExtended;

  return { hash, slug, specPath: specRel, workstreamDir: wsRel, created, noop };
}

function freshSpecContent(
  hash: string,
  slug: string,
  wsRel: string,
  now: Date,
): string {
  const title = titleFromSlug(slug);
  return [
    "---",
    `hash: ${hash}`,
    "type: plan",
    `created: ${formatFullIso(now)}`,
    `title: ${title}`,
    "status: in-progress",
    "stage: prd",
    "entered_at: prd",
    "gate_status:",
    "  prd_validated: false",
    "  design_verified: false",
    "  plan_verified: false",
    "  evals_red: false",
    "outcome:",
    "  status: null",
    "  measure_by: null",
    `workstream: ${wsRel}`,
    "---",
    "",
    "## Goal",
    "",
    `Workstream '${title}' — PRD stage next. Artifacts live in \`${wsRel}/\`.`,
    "",
    "## Status log",
    "",
    `- ${formatMinuteIso(now)} — workstream scaffolded by \`devx workstream new ${slug}\`.`,
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// hash → workstream resolution (shared by every gate + revise + next)
// ---------------------------------------------------------------------------

export interface ResolvedWorkstream {
  hash: string;
  /** Absolute plan-spec path. */
  specAbs: string;
  /** Repo-relative plan-spec path. */
  specRel: string;
  /** Spec file content at resolve time. */
  content: string;
  state: EngineState;
  /** 9f24c7 / D-13: first YAML error in the spec's frontmatter block, or
   *  null when it parses. Non-null means `state` above is soft-degraded —
   *  fields below the error may be silently absent. Additive: the resolver
   *  still resolves; reporting is the consumer's call (the gates warn). */
  frontmatterError: string | null;
  /** Repo-relative workstream dir. */
  workstreamRel: string;
  /** Absolute workstream dir. */
  workstreamAbs: string;
  /** Repo root — carried so the resolved workstream IS an `artifacts.ResolvedBase`
   *  and every `*Abs()` call site can pass `ws` straight through (dlr104). */
  repoRoot: string;
  /** The layout this workstream was resolved under. Travels with the base for
   *  the same reason: a consumer holding one without the other cannot tell a
   *  root doc set from a directory named `.`. */
  layout: DocsLayout;
}

/**
 * Resolve a workstream by spec hash: plan spec → `workstream:` frontmatter
 * pointer (fallback: filename-slug derivation for hand-authored specs) →
 * directory. Throws WorkstreamError when the spec or the directory can't
 * be found — every consumer maps that to exit 2.
 */
export function resolveWorkstream(
  repoRoot: string,
  hash: string,
  engine: EngineConfig,
  fsOverride: Partial<EngineFs> = {},
): ResolvedWorkstream {
  const fs: EngineFs = { ...realEngineFs, ...fsOverride };
  if (!HASH_RE.test(hash)) {
    throw new WorkstreamError(
      `invalid hash '${hash}' (expected hex/alnum 3-12 chars)`,
    );
  }
  const specAbs = findSpecForHashInFs(fs, repoRoot, PLAN_DIR, hash);
  if (!specAbs) {
    throw new WorkstreamError(
      `no plan spec for hash '${hash}' under ${PLAN_DIR}/`,
    );
  }
  const content = fs.readFile(specAbs);
  const state = readEngineState(content);

  // Frontmatter pointer, then the filename-slug fallback — and under
  // `project-level`, the repo root regardless of both. The gatherer and
  // `devx status` resolve through this same helper, so the three cannot drift
  // into disagreeing about where one hash's artifacts live.
  const workstreamRel = planSpecWorkstreamRel(basename(specAbs), state.workstream, engine);
  if (workstreamRel === null) {
    // Unreachable under `project-level`, and correctly so: a filename that
    // cannot be parsed is no reason to fail a lookup the layout has already
    // answered.
    throw new WorkstreamError(
      `spec for '${hash}' has no \`workstream:\` frontmatter and its filename slug can't be derived — run \`devx workstream new <slug> --hash ${hash}\``,
    );
  }
  let workstreamAbs: string;
  if (engine.docsLayout === "project-level") {
    // The repo root always exists, so the probe below would be meaningless
    // here — and worse than meaningless if a stale pointer were ever allowed
    // to reach it, which is precisely why the helper above never returns one.
    workstreamAbs = repoRoot;
  } else {
    workstreamAbs = join(repoRoot, ...workstreamRel.split("/"));
    if (!fs.exists(workstreamAbs)) {
      throw new WorkstreamError(
        `workstream dir '${workstreamRel}' not found — run \`devx workstream new ${workstreamRel.split("/").pop()} --hash ${hash}\``,
      );
    }
  }
  return {
    hash,
    specAbs,
    specRel: `${PLAN_DIR}/${basename(specAbs)}`,
    content,
    state,
    frontmatterError: frontmatterParseError(content),
    workstreamRel,
    workstreamAbs,
    repoRoot,
    layout: engine.docsLayout,
  };
}

/** findSpecForHashIn but routed through the fs seam (for tests). Exported
 *  for the v2d101 repo-level gatherer (src/lib/next/gather.ts) so the spec
 *  resolution stays single-sourced. Minimal fs shape so read-only seams
 *  (NextFs) qualify structurally. */
export function findSpecForHashInFs(
  fs: Pick<EngineFs, "exists" | "readdir">,
  repoRoot: string,
  specDir: string,
  hash: string,
): string | null {
  const dir = join(repoRoot, specDir);
  if (!fs.exists(dir)) return null;
  for (const name of [...fs.readdir(dir)].sort()) {
    if (name.startsWith(`${specDir}-${hash}-`) && name.endsWith(".md")) {
      return join(dir, name);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// spec content → workstream membership (the shared frontmatter walk)
// ---------------------------------------------------------------------------

/**
 * Where a spec's workstream membership came from — the walk tries three
 * arms in order and reports which one answered, so callers can render an
 * honest reason instead of guessing.
 */
export type MembershipVia =
  | "workstream-frontmatter" // `workstream: _devx/workstreams/<slug>`
  | "path-in-from-or-plan" //  `from:`/`plan:` naming a workstream path
  | "plan-hash" //             `from:`/`plan:` naming a plan-<hash> spec
  | "none";

export interface SpecWorkstreamMembership {
  /** Repo-relative workstream dir (`_devx/workstreams/<slug>`), or null. */
  workstreamRel: string | null;
  /** Bare slug — the tail of `workstreamRel`. Null when unresolved. */
  slug: string | null;
  /** Engine state of the plan spec that owns the workstream, when found. */
  planState: EngineState | null;
  /** Plan hash pulled from `from:`/`plan:` when no workstream path appeared. */
  planHash: string | null;
  via: MembershipVia;
  /**
   * True when the spec NAMES a workstream dir but no plan spec claims it —
   * the membership is asserted but unverifiable. Gate callers treat this as
   * exempt-with-warning; scope callers still honor the named slug (the row
   * says which workstream it belongs to, and a missing plan spec is a
   * separate drift problem `devx next` already reports).
   */
  unclaimed: boolean;
}

function escapeRegexLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Lazily-built index of `plan/`'s engine states, shared across calls. */
export interface PlanSpecIndexCache {
  entries?: Array<{ name: string; state: EngineState }>;
}

function planSpecEntries(
  fs: Pick<EngineFs, "exists" | "readdir" | "readFile">,
  repoRoot: string,
  cache: PlanSpecIndexCache | undefined,
): Array<{ name: string; state: EngineState }> {
  if (cache?.entries !== undefined) return cache.entries;
  const entries: Array<{ name: string; state: EngineState }> = [];
  const planDir = join(repoRoot, PLAN_DIR);
  if (fs.exists(planDir)) {
    for (const name of [...fs.readdir(planDir)].sort()) {
      if (!name.endsWith(".md")) continue;
      try {
        entries.push({ name, state: readEngineState(fs.readFile(join(planDir, name))) });
      } catch {
        // unreadable plan spec — keep scanning
      }
    }
  }
  if (cache !== undefined) cache.entries = entries;
  return entries;
}

/**
 * Resolve which engine workstream a spec belongs to, from its file content.
 *
 * Chain (design §Architecture 6 / gather.ts's original inline walk):
 *   1. `workstream:` frontmatter pointer;
 *   2. `from:` / `plan:` naming a `<workstreamsRoot>/<slug>/…` path;
 *   3. `from:` / `plan:` naming a `plan/plan-<hash>-…` spec, resolved
 *      through the plan dir to that spec's engine frontmatter.
 *
 * Extracted at mlc106 so `--workstream` scoping and `resolveWorkstreamGate`
 * share ONE walk. Duplicating it would let the two drift, and the pair
 * disagreeing about membership is exactly the failure that makes a scoped
 * overnight run claim an out-of-scope item.
 *
 * `frontmatterValue` is injected rather than imported to keep this module
 * free of a dependency on the plan/ layer (which imports engine/).
 */
export function resolveSpecWorkstream(
  fs: Pick<EngineFs, "exists" | "readdir" | "readFile">,
  repoRoot: string,
  engine: EngineConfig,
  specContent: string,
  frontmatterValue: (content: string, key: string) => string | null,
  /**
   * Optional cross-call memo of the `plan/` directory's engine states.
   * Without it every call re-`readdir`s plan/ and re-reads every plan spec,
   * so resolving membership for a 120-row backlog costs ~3,600 file reads
   * (review BH#15). Callers that resolve many specs in a row (the loop's
   * scope validation, `devx next`) should pass one shared object.
   */
  cache?: PlanSpecIndexCache,
): SpecWorkstreamMembership {
  const st = readEngineState(specContent);
  // Under `project-level` every resolved membership IS the repo root: the
  // pointer's spelling (`.`, absent, or a stale `<root>/<slug>`) records only
  // THAT the spec belongs, never where. Projecting each arm's answer through
  // this keeps the three arms as they are — the arm that answered is still
  // reported honestly — while making the resolved path layout-correct.
  const flat = engine.docsLayout === "project-level";
  const asLayoutRel = (rel: string): string =>
    flat ? PROJECT_LEVEL_WORKSTREAM_REL : rel;

  let wsRel: string | null = st.workstream === null ? null : asLayoutRel(st.workstream);
  let via: MembershipVia = wsRel !== null ? "workstream-frontmatter" : "none";
  let planHash: string | null = null;

  if (wsRel === null) {
    const wsRe = new RegExp(
      `(?:^|/)${escapeRegexLiteral(engine.workstreamsRoot)}/([a-z0-9-]+)(?:/|$)`,
    );
    for (const key of ["from", "plan"]) {
      const v = frontmatterValue(specContent, key);
      if (!v) continue;
      const wsMatch = wsRe.exec(v);
      if (wsMatch) {
        // Honest consequence, recorded rather than repaired: under
        // `project-level` no path a flat repo produces can match this regex,
        // so this arm is effectively DEAD there and membership degrades to
        // the `workstream-frontmatter` and `plan-hash` arms. That is correct —
        // under this layout there is exactly one workstream. It is kept
        // functional (rather than skipped) only so a stale folder path
        // surviving an interrupted migration still reads as a membership
        // SIGNAL, projected to the root like every other spelling.
        wsRel = asLayoutRel(`${engine.workstreamsRoot}/${wsMatch[1]}`);
        via = "path-in-from-or-plan";
        break;
      }
      const planMatch = /(?:^|\/)plan-([a-z0-9]{3,12})-[^/]*\.md$/.exec(v);
      if (planMatch && planHash === null) planHash = planMatch[1];
    }
  }

  const none = (): SpecWorkstreamMembership => ({
    workstreamRel: null,
    slug: null,
    planState: null,
    planHash,
    via: "none",
    unclaimed: false,
  });

  if (wsRel !== null) {
    // Find the plan spec claiming this workstream dir (same adoption walk
    // as createWorkstream's no-hash path), in two passes.
    //
    // Pass 1 is the walk as it always was, with the layout projection applied
    // to BOTH sides — under `project-level` a spec pointing at `.` and a plan
    // spec still pointing at a stale `<root>/<slug>` are the same claim, and
    // comparing raw strings would call it unclaimed. Under `workstream` the
    // projection is the identity, so this is byte-for-byte today's behavior.
    //
    // Pass 2 runs only under `project-level`, for the plan spec that carries
    // no pointer at all: there is exactly one doc set, so any engine-managed
    // plan spec owns it. It is a SECOND pass and not the first test because
    // an explicit pointer is evidence and `stage !== null` is only inference —
    // in a repo whose `plan/` has accumulated several workstreams' specs over
    // its life, taking the first engine spec found would hand back a
    // long-since-done one. (Several specs all explicitly claiming the root is
    // genuinely ambiguous and stays first-wins, exactly as two specs naming
    // one directory do today; `layout-tree-mismatch` is the surface for it.)
    let planState: EngineState | null = null;
    let planName: string | null = null;
    for (const entry of planSpecEntries(fs, repoRoot, cache)) {
      const claimed =
        entry.state.workstream !== null && asLayoutRel(entry.state.workstream) === wsRel;
      if (claimed) {
        planState = entry.state;
        planName = entry.name;
        break;
      }
    }
    if (planState === null && flat) {
      for (const entry of planSpecEntries(fs, repoRoot, cache)) {
        if (entry.state.stage !== null) {
          planState = entry.state;
          planName = entry.name;
          break;
        }
      }
    }
    return {
      workstreamRel: wsRel,
      // Under `project-level` the slug lives in the CLAIMING plan spec's
      // filename; with no claimant there is no name to read it from, and the
      // helper answers null rather than being handed a sentinel.
      slug: workstreamSlugFor(planName, wsRel, engine),
      planState,
      planHash,
      via,
      unclaimed: planState === null,
    };
  }

  if (planHash !== null) {
    const specAbs = findSpecForHashInFs(fs, repoRoot, PLAN_DIR, planHash);
    if (specAbs !== null) {
      try {
        const cand = readEngineState(fs.readFile(specAbs));
        // Legacy (pre-engine) plan specs have no stage — not engine members.
        if (cand.stage !== null) {
          const rel = planSpecWorkstreamRel(basename(specAbs), cand.workstream, engine);
          return {
            workstreamRel: rel,
            slug: workstreamSlugFor(basename(specAbs), rel, engine),
            planState: cand,
            planHash,
            via: "plan-hash",
            unclaimed: false,
          };
        }
      } catch {
        // unreadable — fall through to "none"
      }
    }
  }

  return none();
}
