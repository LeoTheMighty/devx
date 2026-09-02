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

import { join, posix } from "node:path";

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
export const PRD_REL = "prd/agent.md";
/** Design stage's authoritative artifact (Gate 2 subject). */
export const DESIGN_REL = "design/agent.md";
/** Plan stage's authoritative artifact (Gate 3 subject; coverage table + phases). */
export const PLAN_REL = "plan/agent.md";
/** EARS expectations — Gate 1 co-input, Gate 4 driver. Workstream root. */
export const EXPECTATIONS_REL = "expectations.md";
/** Derived working memory (`devx todo sync`). Workstream root; never a gate input. */
export const TODO_REL = "todo.md";
/** RED-gate artifact dir (E-* runnables/checklists + RED-report.md). */
export const EVALS_DIR_REL = "evals";
/** Gate 4's persisted report. */
export const RED_REPORT_REL = "evals/RED-report.md";
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
export function stageFileRel(stage: StageDir, basename: string): string {
  return `${stage}/${basename}`;
}

/** Workstream-relative outline path for a stage. */
export const outlineRel = (stage: StageDir): string =>
  stageFileRel(stage, OUTLINE_BASENAME);
/** Workstream-relative outline-critique path for a stage. */
export const outlineCritiqueRel = (stage: StageDir): string =>
  stageFileRel(stage, OUTLINE_CRITIQUE_BASENAME);
/** Workstream-relative human-digest path for a stage. */
export const humanRel = (stage: StageDir): string =>
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
export const projectAgentRel = (stage: StageDir): string =>
  stage === "evals" ? EVALS_DIR_REL : `${stage}.md`;

/** Repo-relative human digest for a stage, project-level layout. */
export const projectHumanRel = (stage: StageDir): string => `${stage}-human.md`;

/** Repo-relative HUMAN-ONLY outline for a stage, project-level layout. */
export const projectOutlineRel = (stage: StageDir): string =>
  `${stage}-${OUTLINE_BASENAME}`;

/** Repo-relative outline critique for a stage, project-level layout.
 *  Agent-writable, exactly as its folder-shaped counterpart is. */
export const projectOutlineCritiqueRel = (stage: StageDir): string =>
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

/** Join a workstream-relative artifact path (POSIX form) onto an absolute
 *  workstream dir with the platform separator. */
export function artifactAbs(wsAbs: string, rel: string): string {
  return join(wsAbs, ...rel.split("/"));
}

export const prdAbs = (wsAbs: string): string => artifactAbs(wsAbs, PRD_REL);
export const designAbs = (wsAbs: string): string => artifactAbs(wsAbs, DESIGN_REL);
export const planAbs = (wsAbs: string): string => artifactAbs(wsAbs, PLAN_REL);
export const expectationsAbs = (wsAbs: string): string =>
  artifactAbs(wsAbs, EXPECTATIONS_REL);
export const todoAbs = (wsAbs: string): string => artifactAbs(wsAbs, TODO_REL);
export const evalsDirAbs = (wsAbs: string): string =>
  artifactAbs(wsAbs, EVALS_DIR_REL);
export const redReportAbs = (wsAbs: string): string =>
  artifactAbs(wsAbs, RED_REPORT_REL);
export const decisionsDirAbs = (wsAbs: string): string =>
  artifactAbs(wsAbs, DECISIONS_DIR_REL);
export const checkpointsDirAbs = (wsAbs: string): string =>
  artifactAbs(wsAbs, CHECKPOINTS_DIR_REL);
export const resultsAbs = (wsAbs: string): string =>
  artifactAbs(wsAbs, RESULTS_REL);

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
function normalizeArtifactPath(p: string): string {
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
 *  `evals/RED-report.md`) are stated once, not duplicated per branch. */
function artifactRel(layout: DocsLayout, kind: ArtifactKind): string {
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
 *  collide silently, and that is the collision that matters: the reverse
 *  lookup would return the wrong STAGE, which is a real file that exists. */
const identityOf = (k: ArtifactKind): string =>
  "stage" in k ? `${k.kind}:${k.stage}` : k.kind;

/** Build the reverse index over a kind list. Exported for its negative
 *  control: a guard nothing can trip is a guard nobody knows works, and the
 *  live table has no collision to prove it with. */
export function buildArtifactKindIndex(
  kinds: readonly ArtifactKind[],
  // Seam, and the only reason it exists: no two identities in the LIVE table
  // spell the same path, so a collision cannot be constructed through the
  // public API — and a guard that has never executed is a guard nobody knows
  // works. Injecting the resolver lets the throw be proven.
  relFor: (layout: DocsLayout, kind: ArtifactKind) => string = artifactRel,
): ReadonlyMap<string, ArtifactKind> {
  const map = new Map<string, ArtifactKind>();
  for (const kind of kinds) {
    for (const layout of DOCS_LAYOUTS) {
      // Keys are lowercased: this backs a user-typed surface (`devx revise
      // --touched`), the table's only uppercase basenames are `RESULTS.md`
      // and `RED-report.md`, and `outline.ts`'s classifier already lowercases.
      // Two case conventions in one repo is how a real path returns null.
      const rel = normalizeArtifactPath(relFor(layout, kind)).toLowerCase();
      const existing = map.get(rel);
      if (existing && identityOf(existing) !== identityOf(kind)) {
        throw new Error(
          `artifacts: '${rel}' is claimed by both ` +
            `'${identityOf(existing)}' and '${identityOf(kind)}'`,
        );
      }
      if (!existing) map.set(rel, kind);
    }
  }
  return map;
}

/** The same table read backwards, built once. Keyed on the doc-set-relative
 *  spelling in BOTH layouts, because a `--touched design.md` typed against a
 *  folder-layout repo (a flat-era shorthand) and the same string typed against
 *  a flat repo (the current name) must resolve to the same identity.
 *
 *  This runs at module load, and `engine/config.ts` now imports this file for
 *  values — so a throw here would brick every command. It cannot: the input is
 *  two compile-time constant lists, so the guard is a dev-time assert that
 *  fires the moment a new `StageDir` or kind introduces a collision, and never
 *  on user input. */
const REVERSE_MAP = buildArtifactKindIndex(ALL_ARTIFACT_KINDS);

/** Reverse of `stageSubject()`'s kind→path half: a **doc-set-relative**
 *  artifact path in EITHER layout's spelling → its layout-independent
 *  identity, or `null` when the map does not own the path.
 *
 *  Doc-set-relative, and the distinction is load-bearing: `stageSubject`
 *  returns a REPO-relative `rel`, so under `workstream` this is NOT its
 *  inverse — `pathToArtifactKind("_devx/workstreams/x/prd/agent.md")` is
 *  `null`, and a caller round-tripping a `.rel` must strip the workstream
 *  prefix first. Under `project-level` the two coincide because the doc set
 *  IS the repo root.
 *
 *  Because it is layout-blind by design (both spellings resolve), composing
 *  it with `stageSubject` can RELOCATE a path: in a workstream repo a file
 *  genuinely named `design.md` maps to `{agent, design}` and back out to
 *  `design/agent.md`. Consumers that mean "the artifact at this exact path"
 *  must check the layout themselves; the map answers "which artifact is this
 *  the name of", which is the question `devx revise --touched` asks. */
export function pathToArtifactKind(rel: string): ArtifactKind | null {
  return REVERSE_MAP.get(normalizeArtifactPath(rel).toLowerCase()) ?? null;
}

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
