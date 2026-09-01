// Outline scaffolds — the one thing an agent may write to an outline file,
// and the rule that keeps that safe.
//
// `devx outline init` creates an EMPTY outline: a header comment stating the
// structure rules plus a skeleton of section bullets. It never overwrites, so
// it can only ever produce this exact body. A file still carrying it holds
// nothing a human typed, which is why L2 (`devx outline check`, the
// merge-gate's `outlineClean` signal, the overnight loop's tail) lets a
// PRISTINE scaffold ride a PR while blocking every authored outline.
//
// Body resolution, in preference order (all three count as pristine, so a
// repo that adds or retunes its template later does not retroactively turn
// already-scaffolded files into "authored" ones):
//
//   1. the repo's own `_devx/templates/engine/…` (the human may have tuned it)
//   2. the template shipped inside the installed devx package
//   3. builtinSkeleton() below — the offline floor
//
// Residual, deliberately accepted: shipped templates are agent-writable (they
// have to be, or no template change could ever merge), so an agent that first
// rewrote `_devx/templates/engine/<stage>/outline.md` and then ran `init`
// could land its own words in an outline. That path is not silent — the
// template edit sits in the PR diff under a reviewed path — and it is the
// same trust boundary that already makes templates exempt from L1. Narrowing
// pristine to the packaged body only would break the honest case (a human who
// tuned their repo's template) to close a hole review already covers.
//
// Everything here takes its file access injected; the module does no I/O of
// its own beyond resolving the package's template directory from
// `import.meta.url`.
//
// Design: v2/02-engine.md §3; classification lives in ./outline.ts.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Exec } from "../exec.js";
import { OUTLINE_BASENAME, STAGE_DIRS, type StageDir } from "./artifacts.js";
import {
  PROJECT_OUTLINE_REL,
  type OutlineKind,
  classifyDiffNames,
  outlineKindOf,
} from "./outline.js";

// ---------------------------------------------------------------------------
// Builtin skeletons (offline floor — mirrors of the shipped templates)
// ---------------------------------------------------------------------------

/** The structure rules, verbatim in every scaffold. Bullets only: the
 *  outline's whole value is that it is skimmable in a minute, and prose in a
 *  human-only file is the one thing the agent cannot trim for you. */
const RULES = (ticks: string, extra?: string): string =>
  `     STRUCTURE — bullet points, nothing else:
       * one thought per bullet, ≤ 12 words, no closing period
         * nest two spaces deeper for the detail that earns its place
       * name things in ticks: ${ticks}${extra === undefined ? "" : `\n       * ${extra}`}
       * no paragraphs, no tables, no headings below the title
     EXTREMELY brief is the target — the whole file skimmable in a minute.
     Delete the \`<…>\` hints as you go. Land it with: devx outline commit -->`;

/** Per-stage tick examples + the one extra rule a stage earns. Design gets
 *  the excerpt rule: a design outline is where a code block is most tempting
 *  and least useful — the excerpt is the point, the implementation is not. */
const STAGE_RULES: Record<StageDir, { ticks: string; extra?: string }> = {
  prd: { ticks: "`runOutlineInit()`, `src/lib/engine/`, `--all`" },
  design: {
    ticks: "`runOutlineInit()`, `src/lib/engine/`, `--all`",
    extra: "code is EXCERPTS only — a signature or a call, never a block",
  },
  plan: { ticks: "`runOutlineInit()`, `src/lib/engine/`, `--all`" },
  evals: { ticks: "`E-3`, `test/outline-guard.test.ts`, `--all`" },
};

const stageHeader = (stage: StageDir): string =>
  `<!-- HUMAN-ONLY. Agents never write this file (PreToolUse hook + \`devx outline
     check\` in CI + merge-gate). An agent may run \`devx outline init\` to create
     this scaffold; it never overwrites, so nothing you type here can be lost.

${RULES(STAGE_RULES[stage].ticks, STAGE_RULES[stage].extra)}`;

const STAGE_SECTIONS: Record<StageDir, string[]> = {
  prd: [
    "* Problem\n  * <what hurts today, in one line>",
    "* Who\n  * <who hits it, how often>",
    "* Done looks like\n  * <the observable change; one bullet per outcome>",
    "* Non-goals\n  * <what this explicitly does not do>",
    "* Constraints\n  * <budgets, deadlines, contracts that cannot move>",
    "* Risks\n  * <what would make this the wrong thing to build>",
  ],
  design: [
    "* Shape\n  * <the pieces, and how they connect>",
    "* Seams\n  * <where it plugs into existing code — `path/file.ts`>",
    "* Data\n  * <the types/state that move — `type Foo = { … }`>",
    "* Failure modes\n  * <what breaks, and what happens then>",
    "* Rejected\n  * <the alternative, and the one reason it lost>",
    "* Non-goals\n  * <what this design deliberately leaves alone>",
  ],
  plan: [
    "* Phases\n  * <one bullet per phase, in order>",
    "* Verification\n  * <how each phase is proven — tests-first or tests-alongside>",
    "* Dependencies\n  * <what must land first, inside or outside this workstream>",
    "* Risks\n  * <the phase most likely to go sideways, and the fallback>",
  ],
  evals: [
    "* Expectations to prove\n  * <one bullet per E-* that must go RED first>",
    "* Observed how\n  * <the signal that says pass/fail — not the implementation>",
    "* Fixtures\n  * <the data or repo state each one needs>",
    "* Out of scope\n  * <what stays unproven here, and why that is fine>",
  ],
};

const PROJECT_SKELETON = `<!-- OUTLINE.md — the project-wide outline. HUMAN-ONLY (PreToolUse hook +
     \`devx outline check\` in CI + merge-gate). An agent may run
     \`devx outline init --project\` to create this scaffold; it never
     overwrites, so nothing you type here can be lost. The agent reads it as
     seed context at every PRD stage and critiques it in OUTLINE-CRITIQUE.md.

${RULES("`devx next`, `src/lib/engine/`, `main`")}

# project outline

* What this is
  * <the one-line pitch, in your words>
* Who it is for
  * <the user, and what they do instead today>
* Invariants
  * <what must never break, however the code moves>
* Boundaries
  * <what this project is deliberately not>
* Vocabulary
  * <the words this repo uses oddly, defined once>
`;

/** Builtin scaffold body for a kind — used when neither the repo's nor the
 *  package's template dir is reachable. */
export function builtinSkeleton(kind: OutlineKind): string {
  if (kind.kind === "project") return PROJECT_SKELETON;
  return `${stageHeader(kind.stage)}

# ${kind.stage} outline — <workstream title>

${STAGE_SECTIONS[kind.stage].join("\n")}
`;
}

// ---------------------------------------------------------------------------
// Template location
// ---------------------------------------------------------------------------

/** Repo-relative (and package-relative) path of a kind's shipped template. */
export function outlineTemplateRel(kind: OutlineKind): string {
  return kind.kind === "project"
    ? `_devx/templates/engine/${PROJECT_OUTLINE_REL}`
    : `_devx/templates/engine/${kind.stage}/${OUTLINE_BASENAME}`;
}

/** The installed package's `_devx/templates/engine/` parent (the package
 *  root). `src/lib/engine/x.ts` and `dist/lib/engine/x.js` sit at the same
 *  depth, so one resolution covers source and build. */
function packageRoot(): string {
  return resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..");
}

export interface ScaffoldIo {
  /** Absolute repo root — where the repo's own template copies live. */
  repoRoot: string;
  /** Read a file, or return null when it is absent/unreadable. */
  readFile(abs: string): string | null;
}

/** Every body that counts as this kind's pristine scaffold, most-preferred
 *  first. Never empty — the builtin is always the last candidate. */
export function scaffoldBodies(kind: OutlineKind, io: ScaffoldIo): string[] {
  const rel = outlineTemplateRel(kind).split("/");
  const bodies: string[] = [];
  for (const root of [io.repoRoot, packageRoot()]) {
    const body = io.readFile(join(root, ...rel));
    if (body !== null && body !== "" && !bodies.includes(body)) bodies.push(body);
  }
  const builtin = builtinSkeleton(kind);
  if (!bodies.includes(builtin)) bodies.push(builtin);
  return bodies;
}

/** The body `devx outline init` writes for a kind. */
export function scaffoldBody(kind: OutlineKind, io: ScaffoldIo): string {
  return scaffoldBodies(kind, io)[0];
}

// ---------------------------------------------------------------------------
// Pristine classification (L2's exemption)
// ---------------------------------------------------------------------------

export interface OutlinePartition {
  /** Outlines carrying human content — these block a PR. */
  authored: string[];
  /** Outlines still byte-identical to the scaffold — harmless in a PR. */
  scaffolds: string[];
}

export interface PartitionIo extends ScaffoldIo {
  /** Content of a repo-relative path at the revision under scan, or null
   *  when it is absent there (deleted, or unreadable). */
  readAtRev(repoRelPath: string): string | null;
}

/** Split protected outline paths into human-authored vs pristine scaffolds.
 *
 *  Fails CLOSED in every ambiguous direction: an unreadable path, a path
 *  deleted at the revision, and a path whose scaffold origin is unknowable
 *  (`outlineKindOf` → null) all count as authored. Deleting a human's
 *  outline in a PR is exactly as unwanted as editing one. */
export function partitionOutlinePaths(
  paths: readonly string[],
  io: PartitionIo,
  kindOf: (path: string) => OutlineKind | null,
): OutlinePartition {
  const authored: string[] = [];
  const scaffolds: string[] = [];
  for (const path of paths) {
    const kind = kindOf(path);
    const body = kind === null ? null : io.readAtRev(path);
    if (kind === null || body === null) {
      authored.push(path);
      continue;
    }
    if (scaffoldBodies(kind, io).includes(body)) scaffolds.push(path);
    else authored.push(path);
  }
  return { authored, scaffolds };
}

/** Stage list an `--all` bootstrap covers, in stage order. */
export const BOOTSTRAP_STAGES: readonly StageDir[] = STAGE_DIRS;

/** The one-call form every L2 site uses: classify a `git diff --name-only`
 *  listing, then apply the scaffold exemption. Keeps `devx outline check`,
 *  the merge gate's `outlineClean` signal, and the overnight loop's tail
 *  answering the same question the same way — three copies of this scan
 *  disagreeing is exactly how a guarantee rots. */
export function scanOutlineDiff(
  diffStdout: string,
  io: { repoRoot: string; readFile?: (abs: string) => string | null; exec: Exec; rev: string },
): OutlinePartition & { clean: boolean } {
  const part = partitionOutlinePaths(
    classifyDiffNames(diffStdout.split("\n")),
    {
      repoRoot: io.repoRoot,
      readFile: io.readFile ?? defaultReadFile,
      readAtRev: gitShowReader(io.exec, io.repoRoot, io.rev),
    },
    outlineKindOf,
  );
  return { ...part, clean: part.authored.length === 0 };
}

/** Filesystem reader used when a caller has no injected fs seam. */
export function defaultReadFile(abs: string): string | null {
  try {
    return readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

/** `readAtRev` backed by `git show <rev>:<path>` — the content that would
 *  actually merge, not whatever the working tree happens to hold. A failed
 *  show (path absent at the rev, unknown rev) returns null, which the
 *  partition reads as authored: fail closed. */
export function gitShowReader(
  exec: Exec,
  repoRoot: string,
  rev: string,
): (repoRelPath: string) => string | null {
  return (repoRelPath) => {
    const r = exec("git", ["show", `${rev}:${repoRelPath}`], { cwd: repoRoot });
    return r.exitCode === 0 ? r.stdout : null;
  };
}
