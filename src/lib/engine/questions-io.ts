// questions.md IO seam — the one place a gate's post-verdict bookkeeping
// touches the health queue on disk.
//
// Same split as todo.ts / todo-truth.ts: the pure module (questions.ts)
// transforms text, this sibling owns the read-reconcile-write and every
// degradation decision that comes with a real filesystem.
//
// POSTURE, and it is the whole reason this is a separate function rather than
// three lines inside each gate: **this never changes a verdict, never changes
// an exit code, and never throws.** The queue is STATE-ADJACENT bookkeeping
// written AFTER the verdict is computed and printed. A gate that failed to
// record a concern has still graded the artifact correctly, and a gate that
// crashed on an unparseable questions.md would be a gate taken down by its
// own paperwork. Every failure comes back as a `warning` the caller prints to
// stderr and moves past — the same posture `devx graph`'s regen hook takes.
//
// Grandfathering (FR-1, as todo.md does it): an absent questions.md is
// instantiated from the shipped template so a pre-queue workstream acquires
// one on first touch, with no backfill of concerns the gate cannot see.

import { dirname, join } from "node:path";

import { type ResolvedBase, artifactRel, stageSubject } from "./artifacts.js";
import {
  type Question,
  type ReconcileInput,
  QuestionsError,
  parseQuestions,
  reconcileGateConcerns,
} from "./questions.js";

/** Read + write seam. `EngineFs` qualifies structurally. */
export interface QuestionsFs {
  exists(path: string): boolean;
  readFile(path: string): string;
  writeFile(path: string, contents: string): void;
  mkdirRecursive(path: string): void;
}

export interface QuestionsReconcileOutcome {
  /** Repo-relative questions.md path — what the caller names in its JSON. */
  rel: string;
  /** True when this run instantiated the file (grandfathered workstream). */
  created: boolean;
  added: string[];
  updated: string[];
  resolved: string[];
}

export interface QuestionsReconcileReport {
  /** Null when nothing was written — either nothing to do, or a degradation
   *  that `warning` names. */
  outcome: QuestionsReconcileOutcome | null;
  /** Non-null when the caller should print a degradation to stderr. */
  warning: string | null;
}

export interface ReconcileOnDiskOpts {
  fs: QuestionsFs;
  repoRoot: string;
  base: ResolvedBase;
  /** Repo-relative templates dir (`workstream.TEMPLATES_DIR`). */
  templatesDir: string;
  /** Substituted for `<workstream title>` in a freshly instantiated file. */
  title: string;
  input: ReconcileInput;
}

/**
 * Make this gate's open entries in the workstream's questions.md mirror this
 * run's findings, and persist the result.
 *
 * Degradations, each a warning and a no-write:
 *  - the shipped template is missing → the queue still gets its entries, in a
 *    header-less file. Keeping a second spelling of the header in this module
 *    so it could be "complete" is exactly how two definitions of one file
 *    shape get started; an entry nobody can read the preamble of is still a
 *    recorded concern.
 *  - questions.md exists but does not parse → nothing is written. A
 *    hand-broken severity is the one defect the parser refuses to guess at,
 *    and reconciling against a half-read queue could resolve an entry whose
 *    real state nobody knows.
 *  - the write fails → warned, with the transform discarded.
 */
export function reconcileQuestionsOnDisk(
  opts: ReconcileOnDiskOpts,
): QuestionsReconcileReport {
  const { fs, repoRoot, base, templatesDir, title, input } = opts;
  // BOTH forms from the one resolver: `.abs` for the reads, `.rel` for the
  // warnings. Concatenating `workstreamRel` with the artifact name by hand is
  // what rendered `./questions.md` under `project-level` at every other site
  // that tried it (dlr104) — a path the operator cannot open.
  const { abs, rel: displayRel } = stageSubject(base.layout, base, {
    kind: "questions",
  });

  let before: string;
  let created = false;
  let warning: string | null = null;

  if (fs.exists(abs)) {
    try {
      before = fs.readFile(abs);
    } catch (e) {
      return {
        outcome: null,
        warning: `${displayRel} unreadable (${message(e)}) — this run's findings were not recorded in the health queue`,
      };
    }
    try {
      parseQuestions(before);
    } catch (e) {
      // QuestionsError is the deliberate refusal; anything else is a bug in
      // the parser, and either way the queue must not be rewritten from a
      // reading nobody trusts.
      const why = e instanceof QuestionsError ? e.message : message(e);
      return {
        outcome: null,
        warning: `${displayRel} does not parse (${why}) — fix the entry; this run's findings were not recorded`,
      };
    }
  } else {
    // The template tree ships workstream-shaped inside the npm package under
    // BOTH layouts, so the SOURCE name is pinned to that spelling while the
    // destination resolves through this repo's layout. `questions` happens to
    // be layout-identical, so pinning changes nothing today; stating it is
    // what keeps the rule the same at every template-reading site.
    const templateRel = artifactRel("workstream", { kind: "questions" });
    const templateAbs = join(repoRoot, templatesDir, ...templateRel.split("/"));
    if (fs.exists(templateAbs)) {
      try {
        before = fs.readFile(templateAbs).replace(/<workstream title>/g, () => title);
      } catch (e) {
        before = "";
        warning = `${templatesDir}/${templateRel} unreadable (${message(e)}) — the health queue was created without its header`;
      }
    } else {
      before = "";
      warning = `engine template missing at ${templatesDir}/${templateRel} (run \`devx init\`) — the health queue was created without its header`;
    }
    created = true;
  }

  const r = reconcileGateConcerns(before, input);
  const changed =
    r.content !== before ||
    created ||
    r.added.length + r.updated.length + r.resolved.length > 0;
  if (!changed) return { outcome: null, warning };

  try {
    fs.mkdirRecursive(dirname(abs));
    fs.writeFile(abs, r.content);
  } catch (e) {
    return {
      outcome: null,
      warning: `${displayRel} write failed (${message(e)}) — this run's findings were not recorded in the health queue`,
    };
  }

  return {
    outcome: {
      rel: displayRel,
      created,
      added: r.added,
      updated: r.updated,
      resolved: r.resolved,
    },
    warning,
  };
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------
// Read side
// ---------------------------------------------------------------------------

export interface LoadedQuestions {
  /** Parsed entries. EMPTY when the file does not parse — see `error`. */
  entries: Question[];
  /** 1-indexed lines of `## Q…` headings off the canonical shape. */
  headingDrift: number[];
  /**
   * Non-null when the file EXISTS but could not be read or parsed.
   *
   * Separate from "absent" on purpose, and it is the difference between two
   * answers a surface must never conflate: an absent queue is SILENCE (a
   * grandfathered workstream, nothing to report), while a malformed one is a
   * queue whose real counts are unknown. Rendering `0 blocking` for the
   * second is a confident empty state over a file that may hold four
   * blockers — the shape D-13 exists to prevent.
   */
  error: string | null;
}

/**
 * Read + parse a workstream's health queue. Null when the file is absent
 * (grandfathered — every renderer omits its line).
 *
 * Never throws: a surface that renders the queue is advisory, and the three
 * that do (`devx next`, `devx status`, `devx board`) must degrade to a named
 * warning rather than taking the command down.
 */
export function loadQuestions(
  fs: Pick<QuestionsFs, "exists" | "readFile">,
  base: ResolvedBase,
): LoadedQuestions | null {
  const { abs } = stageSubject(base.layout, base, { kind: "questions" });
  if (!fs.exists(abs)) return null;
  let content: string;
  try {
    content = fs.readFile(abs);
  } catch (e) {
    return { entries: [], headingDrift: [], error: `unreadable: ${message(e)}` };
  }
  try {
    const doc = parseQuestions(content);
    return { entries: doc.entries, headingDrift: doc.headingDrift, error: null };
  } catch (e) {
    return {
      entries: [],
      headingDrift: [],
      error: e instanceof QuestionsError ? e.message : message(e),
    };
  }
}
