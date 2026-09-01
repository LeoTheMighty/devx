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

import { join } from "node:path";

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
  if (typeof merged !== "object" || merged === null) return undefined;
  const section = (merged as Record<string, unknown>)[name];
  return typeof section === "object" && section !== null
    ? (section as Record<string, unknown>)
    : undefined;
}

function asLayout(v: unknown): DocsLayout | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return (DOCS_LAYOUTS as readonly string[]).includes(t) ? (t as DocsLayout) : null;
}

/** Resolve the artifact-tree layout from a merged config blob.
 *
 *  `engine.docs_layout` is the home, alongside `engine.workstreams_root`, and
 *  for the same reason that key was never banked: it names where files the
 *  WHOLE REPO shares get written, so two contributors resolving it
 *  differently would split the artifact tree in half. That is repo policy —
 *  committed, schema-validated, PR-reviewed — not a personal preference.
 *
 *  Read defensively (the same shape `baseBranchFrom` reads): an unknown or
 *  malformed value resolves to the shipped default rather than throwing. A
 *  layout is a *shape*, never a gate input, so it must not brick a command. */
export function docsLayoutFrom(merged: unknown): DocsLayout {
  const fromEngine = asLayout(sectionOf(merged, "engine")?.docs_layout);
  if (fromEngine !== null) return fromEngine;
  const legacy = asLayout(sectionOf(merged, "personalization")?.[LEGACY_LAYOUT_KEY]);
  if (legacy !== null) return legacy;
  return DEFAULT_DOCS_LAYOUT;
}

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
