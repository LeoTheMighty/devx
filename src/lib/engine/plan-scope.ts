// Phase scope of a story's edit to a workstream's plan/agent.md.
//
// A workstream story trues ITS OWN phase's rows in `plan/agent.md` in the
// commit that lands it (`/devx` as-built sync). Anything wider — another
// phase's tasks, another phase's as-built prose — is a revision and goes
// through `devx revise`. The skill body has always said so; nothing checked
// it.
//
// debug-2d6fc1 is what that gap cost. dlr102's story commit was amended with
// main's WORKING COPY of the shared plan/agent.md, which at that moment held
// dlr103's uncommitted edits (its shell had drifted onto the main worktree):
// dlr103's T3.1-T3.6 checkbox flips and a 28-line "As-built (dlr103)" block
// rode PR #152 to main before dlr103's own PR existed. A per-file pathspec
// cannot catch that — the captured text is in a file the story legitimately
// owns. A content rule can: every changed line must sit inside the story's
// own phase.
//
// The one exception is measured, not assumed. Replaying the naive rule over
// every phase-story commit in devx's history flagged dlr105 as well: its
// only out-of-phase change flipped Phase 4's CHECKLIST row to [x], and dlr104
// was already `done` at dlr105's base. That is catch-up for a sibling that
// merged and forgot its own box, not a capture of unmerged work (dlr103 was
// `in-progress` at dlr102's base). So: flipping another phase's checklist
// row to [x] is allowed when that phase's spec is done at the base. Nothing
// else crosses. Replayed: 1 violation (dlr102, 3e61e67), 0 false positives.
//
// The first half is pure (texts, hunks and a done-predicate in, violations
// out). `checkStoryPlanScope` below wires it to git for the CLI and CI.
//
// Spec: debug/debug-2d6fc1-2026-09-02T11:20-peer-commit-swept-uncommitted-artifact.md

import type { Exec } from "../exec.js";
import {
  findFrontmatterKeys,
  frontmatterKeyValue,
  keyBlockEnd,
  splitFrontmatterLines,
} from "../frontmatter-keys.js";
import { isNullishScalar } from "../frontmatter-scalar.js";

/**
 * The plan phase each line belongs to (0-indexed by line), or null for a
 * line outside every phase — `## Current state`, `## Risks`, the file's
 * header, and so on.
 *
 * Two regions carry phases:
 * - a `## Phase checklist…` section: a `- [ ] Phase N…` row, plus the
 *   indented lines under it (where an as-built note sits), belong to N;
 * - a `## Phases…` section: everything from a phase heading to the next
 *   `###` or `##` belongs to that phase.
 *
 * Phase headings are recognised in every spelling devx's plans use
 * (review round 1: the live usage-window-governor plan writes
 * `### Phase 1 — \`uwg101\`: …` and has no checklist, and a map that knew
 * only `### 1. Phase` attributed 0 of its 131 lines — every legitimate
 * as-built edit there would have failed CI):
 *   `### 1. Phase: …`   `### 1) Phase …`   `### Phase 1 — …`   `### **2. Phase…**`
 * Headings inside a fenced code block are ignored.
 */
export function planPhaseMap(text: string): (number | null)[] {
  const out: (number | null)[] = [];
  let region: "checklist" | "phases" | null = null;
  let cur: number | null = null;
  let fence: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const f = /^\s*(```+|~~~+)/.exec(line);
    if (f) {
      if (fence === null) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      out.push(region === null ? null : cur);
      continue;
    }
    if (fence !== null) {
      out.push(region === null ? null : cur);
      continue;
    }
    const h2 = /^## (.+?)\s*$/.exec(line);
    if (h2) {
      const title = h2[1].replace(/[*_`]/g, "").trim().toLowerCase();
      region = title.startsWith("phase checklist")
        ? "checklist"
        : /^phases\b/.test(title)
          ? "phases"
          : null;
      cur = null;
      out.push(null);
      continue;
    }
    if (region === "checklist") {
      const row = /^- \[.\] Phase (\d+)\b/.exec(line);
      if (row) cur = Number(row[1]);
      else if (line.trim() !== "" && !/^\s/.test(line)) cur = null;
      out.push(cur);
      continue;
    }
    if (region === "phases") {
      if (/^### /.test(line)) cur = phaseHeadingNumber(line);
      out.push(cur);
      continue;
    }
    out.push(null);
  }
  return out;
}

/** The phase number a `###` heading names, in any spelling devx uses. */
export function phaseHeadingNumber(line: string): number | null {
  const h = line.replace(/^###\s+/, "").replace(/[*_]/g, "").trim();
  const m = /^(\d+)[.)]\s*Phase\b/i.exec(h) ?? /^Phase\s+(\d+)\b/i.exec(h);
  return m ? Number(m[1]) : null;
}

/** A `git diff -U0` hunk, 1-based as git prints it. */
export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
}

/** Hunk headers out of a unified diff (`@@ -a,b +c,d @@`). */
export function parseDiffHunks(diff: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  for (const line of diff.split("\n")) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!m) continue;
    hunks.push({
      oldStart: Number(m[1]),
      oldCount: m[2] === undefined ? 1 : Number(m[2]),
      newStart: Number(m[3]),
      newCount: m[4] === undefined ? 1 : Number(m[4]),
    });
  }
  return hunks;
}

export interface PlanScopeViolation {
  side: "removed" | "added";
  /** 1-based line number on that side. */
  line: number;
  /** The phase the line belongs to, or null when it is outside every phase. */
  phase: number | null;
  text: string;
}

export interface PlanScopeInput {
  /** The phase this story implements (its spec's `phase:`). */
  ownPhase: number;
  oldText: string;
  newText: string;
  hunks: DiffHunk[];
  /** Whether phase N's story was already `done` at the diff's base. */
  phaseIsDone: (phase: number) => boolean;
}

/**
 * Every changed line of a story's plan/agent.md edit that falls outside the
 * story's own phase. Empty = in scope.
 */
export function checkPlanScope(input: PlanScopeInput): PlanScopeViolation[] {
  const oldLines = input.oldText.split(/\r?\n/);
  const newLines = input.newText.split(/\r?\n/);
  const oldMap = planPhaseMap(input.oldText);
  const newMap = planPhaseMap(input.newText);
  const out: PlanScopeViolation[] = [];
  const ROW = /^- \[( |x|X)\] Phase (\d+)\b(.*)$/;
  for (const h of input.hunks) {
    const removed = Array.from({ length: h.oldCount }, (_, i) => h.oldStart - 1 + i);
    const added = Array.from({ length: h.newCount }, (_, i) => h.newStart - 1 + i);
    // The measured exception, as a PAIR (review round 1): a done phase's
    // checklist row flipped in place, ` ` → `x`, with the rest of the row
    // byte-identical. Judged per line, it let a retitle, a deleted row, or
    // a brand-new `[x]` row through under cover of a flip.
    const excused = new Set<string>();
    for (const r of removed) {
      const rm = ROW.exec(oldLines[r] ?? "");
      if (!rm || rm[1] !== " " || oldMap[r] !== Number(rm[2])) continue;
      const n = Number(rm[2]);
      if (!input.phaseIsDone(n)) continue;
      const a = added.find((x) => {
        const am = ROW.exec(newLines[x] ?? "");
        return (
          !excused.has(`+${x}`) &&
          am !== null &&
          am[1] !== " " &&
          Number(am[2]) === n &&
          am[3] === rm[3] &&
          newMap[x] === n
        );
      });
      if (a !== undefined) {
        excused.add(`-${r}`);
        excused.add(`+${a}`);
      }
    }
    for (const r of removed) {
      if (oldMap[r] === input.ownPhase || excused.has(`-${r}`)) continue;
      out.push({ side: "removed", line: r + 1, phase: oldMap[r] ?? null, text: oldLines[r] ?? "" });
    }
    for (const a of added) {
      if (newMap[a] === input.ownPhase || excused.has(`+${a}`)) continue;
      out.push({ side: "added", line: a + 1, phase: newMap[a] ?? null, text: newLines[a] ?? "" });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Against git — what `devx workstream scope-check` and CI run
// ---------------------------------------------------------------------------


export interface StoryScopeReport {
  /** Why the check did not apply, when it did not. */
  skipped: string | null;
  story: string | null;
  ownPhase: number | null;
  workstream: string | null;
  /** Violations grouped by plan file. */
  files: { path: string; reason: string | null; violations: PlanScopeViolation[] }[];
  /**
   * Plan files a story WITHOUT a phase changed. Reported, not failed: such a
   * story has no phase to hold it to, and a retro or debug story can have a
   * legitimate reason. Measured 2026-09-21: no non-phase story commit in
   * devx's history has touched a plan file. Surfaced so the case is never
   * silent (review round 1: it used to exit 0 without looking at the diff).
   */
  unscoped: string[];
}

/** A git call the check depends on failed. Fail closed: exit 2. */
export class PlanScopeError extends Error {}

const STORY_TYPE_DIRS = ["dev", "debug"] as const;

/** The story hash a branch name carries (`feat/dev-abc123` → abc123), with
 *  any number of prefix segments (`user/feat/dev-abc123`). */
export function storyFromBranch(branch: string): string | null {
  const m = /(?:^|\/)(?:dev|debug)-([A-Za-z0-9]+)$/.exec(branch.trim());
  return m ? m[1] : null;
}

function scalar(raw: string | null): string | null {
  if (raw === null) return null;
  const noComment = raw.replace(/\s+#.*$/, "").trim();
  // Nullish BEFORE unquoting: a quoted "null" is a string (frontmatter-scalar).
  if (isNullishScalar(noComment)) return null;
  return noComment.replace(/^(["'])(.*)\1$/, "$2");
}

/** A workstream pointer as a repo-relative directory: `./` and trailing
 *  `/`, `/plan/agent.md` or `/plan.md` removed. */
function normalizeWsDir(pointer: string): string {
  return pointer
    .replace(/^\.\//, "")
    .replace(/\/+$/, "")
    .replace(/\/plan\/agent\.md$/, "")
    .replace(/\/plan\.md$/, "");
}

/** Is `path` a workstream plan artifact? Every layout's spelling —
 *  `<ws>/plan/agent.md`, the flat `<ws>/plan.md`, a project-level root
 *  `plan.md` — but never a shipped template. */
function isPlanArtifact(path: string): boolean {
  if (path.startsWith("_devx/templates/")) return false;
  return /(^|\/)plan\/agent\.md$/.test(path) || /(^|\/)plan\.md$/.test(path);
}

/**
 * Check every plan file a story's diff touches. `base` and `head` are
 * commits; the diff is `base..head` (the caller resolves a three-dot range
 * to its merge base first, as git itself does). Throws PlanScopeError when a
 * git call it depends on fails.
 */
export function checkStoryPlanScope(opts: {
  repoRoot: string;
  base: string;
  head: string;
  story: string;
  exec: Exec;
}): StoryScopeReport {
  // Pin porcelain behaviour the user's config could otherwise change: colour
  // codes break hunk parsing and an external diff yields no hunks at all —
  // both silent passes (review round 1). No rename pairing: a rename is a
  // delete plus an add, so a plan cannot leave its filename filter unseen.
  const git = (args: string[]) =>
    opts.exec("git", ["-c", "core.quotePath=false", "-c", "color.ui=false", ...args], {
      cwd: opts.repoRoot,
    });
  const must = (args: string[], what: string) => {
    const r = git(args);
    if (r.exitCode !== 0) throw new PlanScopeError(`${what} failed: ${r.stderr.trim() || `git ${args.join(" ")}`}`);
    return r.stdout;
  };
  const readAt = (rev: string, path: string): string | null => {
    const r = git(["show", `${rev}:${path}`]);
    return r.exitCode === 0 ? r.stdout : null;
  };
  for (const rev of [opts.base, opts.head]) must(["rev-parse", "--verify", "--quiet", `${rev}^{commit}`], `resolving '${rev}'`);

  const report: StoryScopeReport = {
    skipped: null,
    story: opts.story,
    ownPhase: null,
    workstream: null,
    files: [],
    unscoped: [],
  };

  const findSpec = (rev: string, hash: string): string | null => {
    for (const dir of STORY_TYPE_DIRS) {
      const ls = must(["ls-tree", "-r", "--name-only", rev, "--", dir], `listing ${dir}/ at ${rev}`);
      const hit = ls.split("\n").find((p) => p.startsWith(`${dir}/${dir}-${hash}-`) && p.endsWith(".md"));
      if (hit) return readAt(rev, hit);
    }
    return null;
  };
  const fields = (text: string | null) => {
    const fm = text ? splitFrontmatterLines(text) : null;
    const get = (k: string) => (fm ? scalar(frontmatterKeyValue(fm.lines, k)) : null);
    const phase = get("phase");
    return {
      phase: phase !== null && /^\d+$/.test(phase) ? Number(phase) : null,
      plan: get("plan"),
      from: get("from"),
      status: get("status"),
    };
  };
  const wsDirOf = (pointer: string, rev: string): string => {
    // A pointer at a plan SPEC (`plan/plan-<hash>-….md`) names its workstream
    // in that spec's `workstream:` key.
    if (/\.md$/.test(pointer) && !/(^|\/)plan(\/agent)?\.md$/.test(pointer)) {
      const ws = scalar(frontmatterKeyValue(splitFrontmatterLines(readAt(rev, pointer) ?? "")?.lines ?? [], "workstream"));
      if (ws !== null) return normalizeWsDir(ws);
    }
    return normalizeWsDir(pointer);
  };

  const changed = must(
    ["diff", "--name-only", "--no-renames", "--no-ext-diff", `${opts.base}..${opts.head}`],
    "listing changed files",
  )
    .split("\n")
    .filter((p) => p !== "" && isPlanArtifact(p));

  const own = findSpec(opts.head, opts.story);
  if (own === null) {
    report.skipped = `no spec for '${opts.story}' at ${opts.head}`;
    report.unscoped = changed;
    return report;
  }
  let f = fields(own);
  // A split follow-up carries no `phase:` of its own; it continues its
  // parent's phase (review round 1 — `devx split` emits neither key).
  //
  // `from:` alone does NOT make a follow-up: it records every kind of
  // provenance, and a debug spec merely FILED from a phase story has it
  // too. This PR's own CI run proved it — 2d6fc1, filed from dlr103, was
  // scoped to dlr103's phase 3. What `devx split` does that filing does not
  // is record the follow-up in the parent's `spawned:` list (appendSpawned),
  // so inheritance requires the parent to name this story there.
  if ((f.phase === null || f.plan === null) && f.from !== null) {
    const parentHash = /(?:dev|debug)-([A-Za-z0-9]+)-/.exec(f.from)?.[1];
    const parentText = parentHash ? findSpec(opts.head, parentHash) : null;
    const parent = fields(parentText);
    const pfm = parentText ? splitFrontmatterLines(parentText) : null;
    const spawnedAt = pfm ? findFrontmatterKeys(pfm.lines, "spawned")[0] : undefined;
    const spawned =
      pfm && spawnedAt !== undefined
        ? pfm.lines.slice(spawnedAt, keyBlockEnd(pfm.lines, spawnedAt)).join("\n")
        : "";
    const namesUs = new RegExp(`(^|[^A-Za-z0-9])${opts.story}([^A-Za-z0-9]|$)`).test(spawned);
    if (namesUs && parent.phase !== null && parent.plan !== null) {
      f = { ...f, phase: f.phase ?? parent.phase, plan: f.plan ?? parent.plan };
    }
  }
  if (f.phase === null || f.plan === null) {
    report.skipped = "not a workstream-phase story (no `phase:` / `plan:`)";
    report.unscoped = changed;
    return report;
  }
  const phase = f.phase;
  const wsDir = wsDirOf(f.plan, opts.head);
  report.ownPhase = phase;
  report.workstream = wsDir;

  const doneAtBase = new Map<number, boolean>();
  const phaseIsDone = (n: number): boolean => {
    const cached = doneAtBase.get(n);
    if (cached !== undefined) return cached;
    // Every spec in THIS workstream whose FRONTMATTER says `phase: N` must be
    // done — not merely one of them, and not a body line that happens to
    // read `phase: N` (review round 1). A split parent can be done while its
    // follow-up still works the phase; that phase is not finished.
    const g = git(["grep", "-l", "-E", "^phase:", opts.base, "--", ...STORY_TYPE_DIRS]);
    if (g.exitCode > 1) throw new PlanScopeError(`searching specs at ${opts.base} failed: ${g.stderr.trim()}`);
    let claimants = 0;
    let done = 0;
    for (const hit of g.stdout.split("\n").filter(Boolean)) {
      const path = hit.slice(hit.indexOf(":") + 1);
      const sf = fields(readAt(opts.base, path));
      if (sf.phase !== n || sf.plan === null || wsDirOf(sf.plan, opts.base) !== wsDir) continue;
      claimants++;
      if (sf.status === "done") done++;
    }
    const result = claimants > 0 && done === claimants;
    doneAtBase.set(n, result);
    return result;
  };

  for (const path of changed) {
    const inOwn = wsDir === "" || wsDir === "." ? !path.includes("/") : path.startsWith(`${wsDir}/`);
    if (!inOwn) {
      report.files.push({
        path,
        reason: `is another workstream's plan (this story's is ${wsDir || "the repo root"})`,
        violations: [],
      });
      continue;
    }
    const oldText = readAt(opts.base, path) ?? "";
    const newText = readAt(opts.head, path) ?? "";
    // A plan in which no phase can be found cannot be scoped — say so and
    // fail closed, rather than reporting every line as out of phase.
    const known = (txt: string) => planPhaseMap(txt).some((x) => x !== null);
    if ((oldText !== "" && !known(oldText)) || (newText !== "" && !known(newText))) {
      throw new PlanScopeError(
        `${path}: no phase sections recognised (expected \`## Phases\` with \`### N. Phase\` or \`### Phase N\` headings)`,
      );
    }
    const hunks = parseDiffHunks(
      must(
        ["diff", "-U0", "--no-renames", "--no-ext-diff", "--no-color", `${opts.base}..${opts.head}`, "--", path],
        `diffing ${path}`,
      ),
    );
    const violations = checkPlanScope({ ownPhase: phase, oldText, newText, hunks, phaseIsDone });
    if (violations.length > 0) report.files.push({ path, reason: null, violations });
  }
  return report;
}
