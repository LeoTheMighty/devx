// Central artifact-path resolver — the single source of truth for where a
// workstream's engine artifacts live relative to its directory.
//
// Before this module every consumer join()'d bare filenames ("prd/agent.md",
// "evals/RED-report.md", …) against workstreamAbs independently, which made
// any layout change a ~15-module hunt. All path construction and all
// user-facing artifact names route through these exports; changing the
// layout is now a constants change here plus the prose surfaces.
//
// Naming: `*_REL` constants are workstream-relative POSIX paths (display
// form — what gate messages, next-table reasons, and revise keys print).
// `*Abs()` helpers join them onto an absolute workstream dir with the
// platform separator.
//
// Design: v2/02-engine.md §3 (workstream anatomy)

import { basename, dirname, join, posix } from "node:path";

// ---------------------------------------------------------------------------
// Workstream-relative artifact paths (display form).
// ---------------------------------------------------------------------------

/** Stage folders (folder-per-artifact layout). Each holds agent.md (the
 *  authoritative gate subject), human.md (agent-maintained digest),
 *  outline.md (HUMAN-ONLY, optional), and outline-critique.md (the agent's
 *  critique of the outline). evals/ is stage-folder-shaped too: E-*
 *  artifacts + RED-report.md play the agent.md role there. */
export const STAGE_DIRS = ["prd", "design", "plan", "evals"] as const;
export type StageDir = (typeof STAGE_DIRS)[number];

/** Authoritative artifact basename inside a stage folder. */
export const AGENT_BASENAME = "agent.md";
/** Agent-maintained succinct digest (mermaid-first). Never a gate input. */
export const HUMAN_BASENAME = "human.md";
/** Human-only outline. Never written by an agent; never a gate input. */
export const OUTLINE_BASENAME = "outline.md";
/** The agent's critique of the human's outline. Agent-writable. */
export const OUTLINE_CRITIQUE_BASENAME = "outline-critique.md";

/** PRD stage's authoritative artifact (Gate 1 subject). */
const PRD_REL = "prd/agent.md";
/** Design stage's authoritative artifact (Gate 2 subject). */
const DESIGN_REL = "design/agent.md";
/** Plan stage's authoritative artifact (Gate 3 subject; coverage table + phases). */
const PLAN_REL = "plan/agent.md";
/** EARS expectations — Gate 1 co-input, Gate 4 driver. Workstream root. */
const EXPECTATIONS_REL = "expectations.md";
/** Derived working memory (`devx todo sync`). Workstream root; never a gate input. */
const TODO_REL = "todo.md";
/** RED-gate artifact dir (E-* runnables/checklists + RED-report.md). */
export const EVALS_DIR_REL = "evals";
/** Gate 4's persisted report. */
const RED_REPORT_REL = "evals/RED-report.md";
/** Dated verify/critique/revision reports. */
export const DECISIONS_DIR_REL = "decisions";
/** Per-phase verification reports (/devx verify). */
export const CHECKPOINTS_DIR_REL = "checkpoints";
/** Outcome scoring output (devx outcome). */
export const RESULTS_REL = "RESULTS.md";

/** The subdirs `devx workstream new` creates empty. `prd` is created by the
 *  scaffold's own prd/agent.md write; design/ and plan/ appear when their
 *  stage authors into them (or `devx outline init` gets there first). */
export const SCAFFOLD_SUBDIRS = [
  DECISIONS_DIR_REL,
  CHECKPOINTS_DIR_REL,
  EVALS_DIR_REL,
] as const;

/** Workstream-relative path of a stage-folder file. */
function stageFileRel(stage: StageDir, basename: string): string {
  return `${stage}/${basename}`;
}

/** Workstream-relative outline path for a stage. */
const outlineRel = (stage: StageDir): string =>
  stageFileRel(stage, OUTLINE_BASENAME);
/** Workstream-relative outline-critique path for a stage. */
const outlineCritiqueRel = (stage: StageDir): string =>
  stageFileRel(stage, OUTLINE_CRITIQUE_BASENAME);
/** Workstream-relative human-digest path for a stage. */
const humanRel = (stage: StageDir): string =>
  stageFileRel(stage, HUMAN_BASENAME);

// ---------------------------------------------------------------------------
// Project-level layout (`engine.docs_layout: project-level`).
// ---------------------------------------------------------------------------
//
// The flat repo-root shape for a repo that only ever designs one thing at a
// time: no slug, no stage folders, one doc set. The folder-per-artifact names
// collapse into `<stage>`-prefixed root files — `prd/agent.md` → `prd.md`,
// `prd/outline.md` → `prd-outline.md`, and so on.
//
// Both layouts resolve to the SAME gate subjects for the same content: layout
// is not a gate input. The one thing that must survive the switch is the
// human-only guarantee on outlines — see `outline.ts`, which classifies these
// root names too. A rename that moved an outline out from under the guard
// would silently drop a guarantee three enforcement layers exist to make.
//
// Registry: docs/CONFIG.md §15 (engine.docs_layout).

/** Repo-relative authoritative artifact for a stage, project-level layout
 *  (`prd.md`, `design.md`, `plan.md`; `evals` keeps its directory). */
const projectAgentRel = (stage: StageDir): string =>
  stage === "evals" ? EVALS_DIR_REL : `${stage}.md`;

/** Repo-relative human digest for a stage, project-level layout. */
const projectHumanRel = (stage: StageDir): string => `${stage}-human.md`;

/** Repo-relative HUMAN-ONLY outline for a stage, project-level layout. */
export const projectOutlineRel = (stage: StageDir): string =>
  `${stage}-${OUTLINE_BASENAME}`;

/** Repo-relative outline critique for a stage, project-level layout.
 *  Agent-writable, exactly as its folder-shaped counterpart is. */
const projectOutlineCritiqueRel = (stage: StageDir): string =>
  `${stage}-${OUTLINE_CRITIQUE_BASENAME}`;

/** Every project-level outline basename, lowercased — the protected set the
 *  path classifier adds under this layout. Derived from STAGE_DIRS so a new
 *  stage cannot arrive with an unprotected outline. */
export const PROJECT_LEVEL_OUTLINE_BASENAMES: readonly string[] = STAGE_DIRS.map(
  (s) => projectOutlineRel(s).toLowerCase(),
);

// ---------------------------------------------------------------------------
// Layout resolution.
// ---------------------------------------------------------------------------

/** The two artifact-tree shapes (docs/CONFIG.md §15). */
export const DOCS_LAYOUTS = ["workstream", "project-level"] as const;
export type DocsLayout = (typeof DOCS_LAYOUTS)[number];

/** Shipped default — the folder-per-artifact tree. */
export const DEFAULT_DOCS_LAYOUT: DocsLayout = "workstream";

/** Legacy home: the preference bank's `docs.layout` key, before the layout
 *  moved to `engine.docs_layout` in committed config. Still READ so a repo
 *  that answered it does not silently flip layout on upgrade; never written.
 *  Remove once no config in the wild carries it. */
const LEGACY_LAYOUT_KEY = "docs.layout";

function sectionOf(merged: unknown, name: string): Record<string, unknown> | undefined {
  // Arrays are rejected at BOTH levels. `typeof [] === "object"`, so without
  // the check a config shaped like an array — or an `engine:` that parsed as a
  // YAML list — would yield a layout while every OTHER engine knob's guard in
  // `engineConfigFrom()` rejects the same blob. One resolver disagreeing with
  // its own file about what counts as a config object is a bug in waiting.
  if (typeof merged !== "object" || merged === null || Array.isArray(merged)) {
    return undefined;
  }
  const section = (merged as Record<string, unknown>)[name];
  return typeof section === "object" && section !== null && !Array.isArray(section)
    ? (section as Record<string, unknown>)
    : undefined;
}

function asLayout(v: unknown): DocsLayout | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return (DOCS_LAYOUTS as readonly string[]).includes(t) ? (t as DocsLayout) : null;
}

/** Where a resolved layout came from. `default` means nobody ever chose one —
 *  the answer `devx next`'s advisory nag needs, and the reason this resolver
 *  returns a source at all rather than making a second predicate re-read the
 *  config beside it (G-2 counts one FUNCTION, not one file). */
export type LayoutSource = "engine" | "legacy" | "default";

/** Resolve the artifact-tree layout from a merged config blob — the ONE
 *  function in `src/` that reads either layout key.
 *
 *  `engine.docs_layout` is the home, alongside `engine.workstreams_root`, and
 *  for the same reason that key was never banked: it names where files the
 *  WHOLE REPO shares get written, so two contributors resolving it
 *  differently would split the artifact tree in half. That is repo policy —
 *  committed, schema-validated, PR-reviewed — not a personal preference.
 *
 *  Read defensively (the same shape `baseBranchFrom` reads): an unknown or
 *  malformed value resolves to the shipped default rather than throwing. A
 *  layout is a *shape*, never a gate input, so it must not brick a command.
 *  That defensiveness is also what makes it safe to call ABOVE
 *  `engineConfigFrom()`'s two early-return guards, which it must be: a repo
 *  that answered only the legacy key has no `engine:` block at all. */
export function resolveDocsLayout(merged: unknown): {
  layout: DocsLayout;
  source: LayoutSource;
} {
  const fromEngine = asLayout(sectionOf(merged, "engine")?.docs_layout);
  if (fromEngine !== null) return { layout: fromEngine, source: "engine" };
  const legacy = asLayout(sectionOf(merged, "personalization")?.[LEGACY_LAYOUT_KEY]);
  if (legacy !== null) return { layout: legacy, source: "legacy" };
  return { layout: DEFAULT_DOCS_LAYOUT, source: "default" };
}

/** Thin wrapper over `resolveDocsLayout()`, kept for its existing callers.
 *  Reads nothing itself. */
export const docsLayoutFrom = (merged: unknown): DocsLayout =>
  resolveDocsLayout(merged).layout;

// ---------------------------------------------------------------------------
// Absolute resolvers.
// ---------------------------------------------------------------------------

/** Join a doc-set-relative artifact path (POSIX form) onto an absolute
 *  directory with the platform separator.
 *
 *  Module-private, and that is the point rather than an accident of having no
 *  outside caller. It takes an ARBITRARY rel, so an exported version keeps
 *  `artifactAbs(wsAbs, "prd/agent.md")` expressible — a hand-built
 *  stage-subject path that carries no `join(` for E-3's scan to see. Callers
 *  name the artifact (`stageSubject`, `planAbs`, …); only the map spells one. */
function artifactAbs(wsAbs: string, rel: string): string {
  return join(wsAbs, ...rel.split("/"));
}

// ---------------------------------------------------------------------------
// The artifact map — one (layout, base, kind) → path decision.
// ---------------------------------------------------------------------------
//
// Before this, the two layouts were two independent families of helpers with
// nothing binding them, and the four basenames were loose strings — which is
// why `stageFileRel(stage, basename: string)` takes an untyped second
// parameter. `ArtifactKind` binds them, so a consumer names WHAT it wants and
// the layout decides WHERE.
//
// Registry: docs/CONFIG.md §15 (the artifact table).

/** The three stages whose subject is an authored document. `evals` is
 *  deliberately absent: its subject IS the evals directory, so
 *  `{ kind: "evals-dir" }` names it and `{ kind: "agent", stage: "evals" }` is
 *  made UNREPRESENTABLE rather than special-cased in a branch. The
 *  stage-parametrized companions keep the full `StageDir`, so
 *  `{ kind: "outline", stage: "evals" }` correctly yields `evals-outline.md`. */
export type SubjectStage = Exclude<StageDir, "evals">;
export const SUBJECT_STAGES: readonly SubjectStage[] = STAGE_DIRS.filter(
  (s): s is SubjectStage => s !== "evals",
);

/** A layout-independent artifact identity. 11 variants render as the §15
 *  table's 13 rows: `agent` expands to three (prd / design / plan), the three
 *  stage-parametrized companions are one row each, and the seven singletons
 *  are one row each. */
export type ArtifactKind =
  | { kind: "agent"; stage: SubjectStage }
  | { kind: "human" | "outline" | "outline-critique"; stage: StageDir }
  | { kind: "expectations" | "todo" | "results" }
  | { kind: "evals-dir" | "decisions-dir" | "checkpoints-dir" }
  | { kind: "red-report" };

/** The §15 ROW INDEX — one entry per documented row, in table order.
 *
 *  It exists because a TYPE erases: `docs/CONFIG.md` §15 claims one row per
 *  artifact kind, and a doc check has nothing to set-compare against unless
 *  the enumeration survives to runtime. `ALL_ARTIFACT_KINDS` is the wrong
 *  granularity for that job — it is the full 22-identity product, because the
 *  reverse map has to key `human · design` apart from `human · prd`. §15 is
 *  read by a human choosing a layout, and the three stage-parametrized
 *  companions have one stage-generic spelling each (`<stage>/human.md` →
 *  `<stage>-human.md`), so four identities are one row. `agent` keeps its
 *  stage: `prd.md`, `design.md` and `plan.md` are three different names.
 *
 *  Written out rather than derived, because the eval that consumes it
 *  (`evals/E-8_docs-truth.ts`) reads this file as TEXT — a `.map()` leaves it
 *  nothing to read. `test/engine-layout-docs-truth.test.ts` re-derives the
 *  same set from `ALL_ARTIFACT_KINDS` and fails if the two disagree, so the
 *  literal cannot rot: a new `ArtifactKind` variant fails that test until it
 *  is listed here, and fails the row check until §15 documents it. */
export const ARTIFACT_KINDS = [
  "agent:prd",
  "agent:design",
  "agent:plan",
  "human",
  "outline",
  "outline-critique",
  "expectations",
  "todo",
  "results",
  "evals-dir",
  "decisions-dir",
  "checkpoints-dir",
  "red-report",
] as const;

export interface StageSubject {
  /** Repo-relative display form — what refusal messages print. */
  rel: string;
  /** Absolute path — what reads use. */
  abs: string;
}

/** The doc-set base a subject resolves against: the repo root, plus the
 *  repo-relative workstream dir (`"."` under `project-level`). This is what
 *  `resolveWorkstream()` already returns. */
export interface SubjectBase {
  repoRoot: string;
  workstreamRel: string;
}

/** One spelling per path, used by BOTH directions of the map.
 *
 *  `stageSubject` and `pathToArtifactKind` normalizing differently is how a
 *  path that resolves one way stops resolving the other, so the rule lives
 *  here once: platform separators become `/`, repeated and leading `./`
 *  segments collapse, `a/../b` resolves, and a trailing slash is dropped.
 *  `posix.normalize` does the middle; the pre/post trims do what it won't.
 *
 *  It deliberately does NOT reject an absolute or `..`-escaping input. A
 *  layout is a shape, never a gate input, and a path resolver that throws
 *  bricks the command that asked — a caller's bad base surfaces as a missing
 *  file, which is a message rather than a crash. */
export function normalizeArtifactPath(p: string): string {
  const slashed = p.trim().replace(/\\/g, "/");
  if (slashed === "") return "";
  const trimmed = posix
    .normalize(slashed)
    .replace(/^\.\/+/, "")
    .replace(/(.)\/+$/, "$1");
  return trimmed === "." ? "" : trimmed;
}

/** Per-kind resolver pair for the stage-parametrized companions. BOTH halves
 *  delegate to the helpers that already existed — the project-level ones
 *  lacked a caller, not a fix. Re-spelling them here would put two independent
 *  definitions of the flat layout in one file, and `projectOutlineRel` is the
 *  one that must never drift: `PROJECT_LEVEL_OUTLINE_BASENAMES` derives from
 *  it, and that set is what keeps root outlines under the human-only guard. */
const COMPANION_REL = {
  human: { workstream: humanRel, "project-level": projectHumanRel },
  outline: { workstream: outlineRel, "project-level": projectOutlineRel },
  "outline-critique": {
    workstream: outlineCritiqueRel,
    "project-level": projectOutlineCritiqueRel,
  },
} as const;

/** Doc-set-relative path of an artifact under a given layout — the half of the
 *  map that the layout actually chooses. Layout-identical rows (`evals/`,
 *  `decisions/`, `checkpoints/`, `expectations.md`, `todo.md`, `RESULTS.md`,
 *  `evals/RED-report.md`) are stated once, not duplicated per branch.
 *
 *  Exported for the DISPLAY sites that name an artifact without reading it —
 *  `engine/next.ts`'s row reasons, gate refusal prose. They have a layout but
 *  no base, and spelling `prd/agent.md` at them in a flat repo names a file
 *  that does not exist. */
export function artifactRel(layout: DocsLayout, kind: ArtifactKind): string {
  switch (kind.kind) {
    case "agent":
      // `projectAgentRel` is `StageDir`-wide and returns the evals DIRECTORY
      // for `evals`; `SubjectStage` already makes that argument unreachable
      // here, which is the whole point of narrowing it.
      return layout === "workstream"
        ? stageFileRel(kind.stage, AGENT_BASENAME)
        : projectAgentRel(kind.stage);
    case "human":
    case "outline":
    case "outline-critique":
      return COMPANION_REL[kind.kind][layout](kind.stage);
    case "expectations":
      return EXPECTATIONS_REL;
    case "todo":
      return TODO_REL;
    case "results":
      return RESULTS_REL;
    case "evals-dir":
      return EVALS_DIR_REL;
    case "decisions-dir":
      return DECISIONS_DIR_REL;
    case "checkpoints-dir":
      return CHECKPOINTS_DIR_REL;
    case "red-report":
      return RED_REPORT_REL;
  }
}

/** Resolve an artifact's repo-relative display path and its absolute path.
 *
 *  BOTH forms are returned because both are needed at the same call sites —
 *  gate refusals print `rel`, reads use `abs`. Returning one and making the
 *  caller derive the other is how two spellings drift. */
export function stageSubject(
  layout: DocsLayout,
  base: SubjectBase,
  kind: ArtifactKind,
): StageSubject {
  const artifact = artifactRel(layout, kind);
  // Under `project-level` the base IS the repo root, so `workstreamRel` is
  // `"."` and every rel is a plain root path. Normalizing through the SAME
  // helper `pathToArtifactKind` uses is what makes `rel` a single spelling:
  // `./_devx/ws/x` (reachable from `engine.workstreams_root: ./…`, which
  // `engineConfigFrom` strips trailing slashes from but not a leading `./`)
  // and `a//b` would otherwise produce a `rel` that no string comparison
  // against a canonical path can match, while `abs` silently collapsed to the
  // right file — two spellings of one path, which is the whole bug class this
  // map exists to close.
  const wsRel = normalizeArtifactPath(base.workstreamRel);
  const rel = normalizeArtifactPath(wsRel === "" ? artifact : `${wsRel}/${artifact}`);
  return { rel, abs: artifactAbs(base.repoRoot, rel) };
}

// ---------------------------------------------------------------------------
// Layout-aware absolute resolvers.
// ---------------------------------------------------------------------------

/** A doc-set base plus the layout that shapes it — exactly what
 *  `resolveWorkstream()` returns, which is why every consumer can pass its
 *  `ws` straight through.
 *
 *  The layout travels WITH the base rather than beside it because the pair is
 *  what identifies a doc set: a `workstreamRel` of `.` means the repo root
 *  under `project-level` and a directory literally named `.` under
 *  `workstream`, and the helpers below cannot tell those apart from the
 *  path alone. Splitting them into two arguments is what let 21 call sites
 *  hand a bare `wsAbs` to a layout-blind helper and read every artifact as
 *  missing (dlr104).
 *
 *  Four helpers, not the ten dlr104 wrote: the other six never acquired a
 *  caller, and an exported resolver nobody calls is a bypass waiting for its
 *  first one (E-2). A kind that needs an absolute path and has no helper here
 *  reaches for `stageSubject(layout, base, kind).abs`, which is what these
 *  are. Adding one back is a one-line change the day something calls it. */
export interface ResolvedBase extends SubjectBase {
  layout: DocsLayout;
}

const absOf = (base: ResolvedBase, kind: ArtifactKind): string =>
  stageSubject(base.layout, base, kind).abs;

export const planAbs = (base: ResolvedBase): string =>
  absOf(base, { kind: "agent", stage: "plan" });
export const todoAbs = (base: ResolvedBase): string =>
  absOf(base, { kind: "todo" });
export const evalsDirAbs = (base: ResolvedBase): string =>
  absOf(base, { kind: "evals-dir" });
export const decisionsDirAbs = (base: ResolvedBase): string =>
  absOf(base, { kind: "decisions-dir" });

/** `SCAFFOLD_SUBDIRS` as identities rather than rels — what the scaffold
 *  iterates so its three empty dirs land wherever the layout puts them
 *  (the repo root under `project-level`). Same order, and asserted to be the
 *  same set as `SCAFFOLD_SUBDIRS` in `test/engine-artifacts.test.ts`: two
 *  spellings of one list is how the flat layout ends up with two of the three.
 */
export const SCAFFOLD_SUBDIR_KINDS: readonly ArtifactKind[] = [
  { kind: "decisions-dir" },
  { kind: "checkpoints-dir" },
  { kind: "evals-dir" },
];

/** Minimal read seam — `EngineFs`, `NextFs` and the eval fixtures all qualify
 *  structurally, so this module still imports nothing from them. */
export interface ArtifactProbeFs {
  exists(path: string): boolean;
  readdir(path: string): string[];
}

/**
 * Does this artifact exist, under the name the layout actually gives it?
 *
 * `fs.exists` is not enough and the reason is specific to `project-level`:
 * there the doc set IS the repo root, so `plan.md` sits beside devx's own
 * `PLAN.md` backlog — and macOS (APFS/HFS+) and Windows (NTFS) are
 * case-INSENSITIVE by default, so `existsSync("<root>/plan.md")` answers TRUE
 * on a repo that has authored no plan at all. Every consequence of that is
 * silent: `devx next` reports the plan authored and wedges on Gate 3 forever,
 * `validate-emit` reads the BACKLOG as the epic plan, and `backfill` mines it
 * for phase pointers. A directory listing is the only thing that knows
 * `plan.md` is not `PLAN.md`.
 *
 * Under `workstream` the two questions cannot differ — an artifact lives in a
 * directory devx owns, with no differently-cased neighbour — so that branch
 * keeps the cheap `exists` and its behavior is unchanged.
 *
 * The general fix for every REMAINING `fs.exists` in the tree is `debug-135dc9`;
 * this closes the sites dlr104 itself makes reachable.
 */
export function artifactExists(
  fs: ArtifactProbeFs,
  base: ResolvedBase,
  kind: ArtifactKind,
): boolean {
  const subject = stageSubject(base.layout, base, kind);
  if (base.layout !== "project-level") return fs.exists(subject.abs);
  if (!fs.exists(subject.abs)) return false;
  // Only now pay for the listing: the cheap probe is a correct NEGATIVE in
  // both layouts, so the readdir runs only to disqualify a case-blind hit.
  const parent = dirname(subject.abs);
  const name = basename(subject.abs);
  try {
    return fs.readdir(parent).includes(name);
  } catch {
    // An unreadable parent cannot confirm the name. Answering false keeps the
    // failure in the "artifact not authored" direction, which every consumer
    // already handles, rather than handing back a file we could not verify.
    return false;
  }
}

/** Every representable identity, in one place, so both the reverse map and
 *  its tests are driven by the same product rather than a hand-kept list. */
export const ALL_ARTIFACT_KINDS: readonly ArtifactKind[] = [
  ...SUBJECT_STAGES.map((stage): ArtifactKind => ({ kind: "agent", stage })),
  ...STAGE_DIRS.flatMap((stage): ArtifactKind[] => [
    { kind: "human", stage },
    { kind: "outline", stage },
    { kind: "outline-critique", stage },
  ]),
  { kind: "expectations" },
  { kind: "todo" },
  { kind: "results" },
  { kind: "evals-dir" },
  { kind: "decisions-dir" },
  { kind: "checkpoints-dir" },
  { kind: "red-report" },
].map((k) => Object.freeze(k) as ArtifactKind);

/** Full identity of a kind — `(kind, stage)`, not just the discriminant.
 *  Comparing discriminants alone would let `human · prd` and `human · design`
 *  collide silently, and that is the collision that matters: two rows of the
 *  cascade table, or of the reverse index, would answer for each other.
 *
 *  Exported because it is the ONLY sanctioned way to compare two kinds.
 *  `ArtifactKind` is a plain object literal, so `===` is reference equality
 *  and `JSON.stringify` is key-order dependent — both silently answer "not
 *  the same artifact" for two spellings of one identity. */
export const artifactKindIdentity = (k: ArtifactKind): string =>
  "stage" in k ? `${k.kind}:${k.stage}` : k.kind;

// ---------------------------------------------------------------------------
// evals/ classification.
// ---------------------------------------------------------------------------

/** Basename of the Gate 4 report inside evals/. */
export const RED_REPORT_BASENAME = "RED-report.md";

/** Non-authored evals/ residents: the gate report plus the human-facing
 *  companions (folder-per-artifact layout). Listing any of these must NOT
 *  count as "RED artifacts authored" — that existence check routes
 *  `devx next` between row 10 (author evals) and row 11 (run the gate). */
const NON_AUTHORED_EVAL_ENTRIES = new Set([
  RED_REPORT_BASENAME,
  HUMAN_BASENAME,
  OUTLINE_BASENAME,
  OUTLINE_CRITIQUE_BASENAME,
]);

/** True when an evals/ directory entry is an authored RED artifact
 *  (an E-* runnable/checklist or its fixture), as opposed to the gate's
 *  own report, a human-facing companion doc, or a dotfile. */
export function isAuthoredEvalEntry(name: string): boolean {
  return !name.startsWith(".") && !NON_AUTHORED_EVAL_ENTRIES.has(name);
}
