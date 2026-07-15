// Tour gather step (v2t101) — the deterministic first leg of
// `devx tour build` (v2/03-review-tour.md §2):
//
//   gather (CLI, deterministic)  ← this module
//   narrate (agent, judgment)    ← /devx skill body, schema-constrained
//   render (CLI, deterministic)  ← render.ts
//
// Emits everything the narrating agent needs as one JSON blob: spec
// frontmatter + Goal + parsed ACs (the spec replaces any external-tracker
// intent source; ACs seed the coverage rows), the full
// `git diff <base>...<branch>`, per-file numstat, the commit list, and the
// changed-file list. Pure gather — zero narration, zero judgment. Re-runs
// are deterministic given the same git state.
//
// Base/branch resolution mirrors the claim/merge-gate conventions:
//   • branch: spec frontmatter `branch:` when present, else
//     deriveBranch(config, type, hash) (pln101) — never hardcoded.
//   • base:   `git.integration_branch` when set, else `git.default_branch`,
//     else "main" — the same integration-branch-or-default resolution /devx
//     uses when cutting the worktree.
//
// Spec: dev/dev-v2t101-2026-07-05T13:04-review-tour.md
// Design: v2/03-review-tour.md §1 change 4 ("Re-point the generator inputs")

import { readFileSync } from "node:fs";

import {
  AmbiguousSpecHashError,
  SPEC_TYPE_DIRS,
  findSpecForHashAnyType,
} from "../engine/frontmatter.js";
import { extractAcChecklist } from "../pr-body.js";
import { deriveBranch, type DeriveBranchConfig } from "../plan/derive-branch.js";
import { type Exec, realExec } from "./exec.js";


// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface GatherConfig extends DeriveBranchConfig {
  git?: DeriveBranchConfig["git"] & { default_branch?: string };
}

export interface GatherOpts {
  /** Project repo root — spec lookup + git commands resolve here. */
  repoRoot: string;
  /** Merged devx config (for base/branch derivation). */
  config?: GatherConfig;
  /** Test seam — replacement for the real git shell-out. */
  exec?: Exec;
}

export interface GatheredAc {
  text: string;
  checked: boolean;
}

export interface GatheredCommit {
  sha: string;
  subject: string;
}

export interface GatheredNumstat {
  file: string;
  /** null for binary files (git prints `-`). */
  additions: number | null;
  deletions: number | null;
}

export interface GatheredChangedFile {
  /** git name-status letter: A/M/D/R…; renames keep the full `R100` form. */
  status: string;
  file: string;
}

export interface TourGather {
  meta: {
    hash: string;
    specPath: string;
    title: string;
    base: string;
    branch: string;
    sha: string;
    files: number;
    additions: number;
    deletions: number;
    commits: number;
  };
  spec: {
    frontmatter: Record<string, string>;
    goal: string;
    /** Raw `## Acceptance criteria` checkbox block (pr-body extractor). */
    acChecklist: string;
    /** Parsed AC items — these seed the tour's coverage rows. */
    acceptanceCriteria: GatheredAc[];
  };
  fullDiff: string;
  numstat: GatheredNumstat[];
  commits: GatheredCommit[];
  changedFiles: GatheredChangedFile[];
}

export class GatherError extends Error {
  readonly stage:
    | "no-spec"
    | "git-diff"
    | "git-numstat"
    | "git-log"
    | "git-name-status"
    | "git-rev-parse"
    | "empty-diff";
  constructor(stage: GatherError["stage"], message: string) {
    super(`tour gather failed at stage '${stage}': ${message}`);
    this.name = "GatherError";
    this.stage = stage;
  }
}

// ---------------------------------------------------------------------------
// Spec parsing
// ---------------------------------------------------------------------------

/** Hand-rolled frontmatter read (merge-gate precedent: we author both sides
 *  of the spec contract; a YAML dependency for a flat scalar block is
 *  overkill). Captures every scalar `key: value` line. Caller normalizes
 *  BOM/CRLF before invoking (gatherTour does). */
export function parseFrontmatter(specText: string): Record<string, string> {
  const m = /^---\n([\s\S]*?)\n---/.exec(specText);
  if (!m) return {};
  const result: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = /^([a-z_][a-z0-9_]*):\s*(.*)$/i.exec(line);
    if (!kv) continue;
    let val = kv[2].trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
    result[kv[1]] = val;
  }
  return result;
}

/** Extract the `## Goal` section body (trimmed), or "" when absent. */
export function extractGoal(specText: string): string {
  const m = /^##\s+Goal\s*$/m.exec(specText);
  if (!m) return "";
  const rest = specText.slice(m.index + m[0].length);
  const next = /^##\s/m.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

/** Parse an AC checkbox block into items. Sub-headings and blank lines are
 *  skipped; indented continuation lines fold into the preceding item. */
export function parseAcItems(acChecklist: string): GatheredAc[] {
  const items: GatheredAc[] = [];
  for (const line of acChecklist.split("\n")) {
    const m = /^[ \t]*-\s+\[([ x/-])\]\s?(.*)$/.exec(line);
    if (m) {
      items.push({ text: m[2].trim(), checked: m[1] === "x" });
      continue;
    }
    // Indented continuation of the previous checkbox — fold in.
    if (items.length > 0 && /^\s+\S/.test(line)) {
      items[items.length - 1].text += ` ${line.trim()}`;
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// Gather
// ---------------------------------------------------------------------------

/** Resolve the diff base: integration branch when the project runs a split,
 *  else the default branch, else "main". */
export function resolveBase(config: GatherConfig | undefined): string {
  const integration = config?.git?.integration_branch;
  if (typeof integration === "string" && integration.trim() !== "") {
    return integration.trim();
  }
  const def = config?.git?.default_branch;
  if (typeof def === "string" && def.trim() !== "") {
    return def.trim();
  }
  return "main";
}

export function gatherTour(hash: string, opts: GatherOpts): TourGather {
  const exec = opts.exec ?? realExec;
  const config = opts.config ?? {};

  // Type-aware resolution (debug-6a913f): a hash can name a spec of any
  // backlog type — debug-loop PRs need tours too.
  let resolved;
  try {
    resolved = findSpecForHashAnyType(opts.repoRoot, hash);
  } catch (e) {
    if (e instanceof AmbiguousSpecHashError) {
      throw new GatherError("no-spec", e.message);
    }
    throw e;
  }
  if (!resolved) {
    throw new GatherError(
      "no-spec",
      `no spec file for hash '${hash}' under any spec dir (${SPEC_TYPE_DIRS.join("/, ")}/)`,
    );
  }
  const specPath = resolved.path;
  // BOM strip + CRLF normalization (same treatment as pr-body's
  // loadTemplate): the frontmatter/Goal/AC regexes anchor on bare `\n`, so
  // a CRLF-saved spec would otherwise silently lose ALL frontmatter
  // (self-review finding, Edge Case Hunter #5).
  const specText = readFileSync(specPath, "utf8")
    .replace(/^﻿/, "")
    .replace(/\r\n/g, "\n");
  const frontmatter = parseFrontmatter(specText);
  const goal = extractGoal(specText);
  const acChecklist = extractAcChecklist(specText);
  const acceptanceCriteria = parseAcItems(acChecklist);

  const base = resolveBase(config);
  const branch =
    frontmatter.branch && frontmatter.branch.trim() !== ""
      ? frontmatter.branch.trim()
      : deriveBranch(config, frontmatter.type?.trim() || "dev", hash);

  const git = (stage: GatherError["stage"], args: string[]): string => {
    const r = exec("git", args, { cwd: opts.repoRoot });
    if (r.exitCode !== 0) {
      throw new GatherError(
        stage,
        `git ${args.join(" ")} exited ${r.exitCode}: ${r.stderr.trim() || "(no stderr)"}`,
      );
    }
    return r.stdout;
  };

  const sha = git("git-rev-parse", ["rev-parse", branch]).trim();

  // Three-dot diff: changes on the branch since it forked from base — the
  // same view the PR will show. Two-dot would fold in unrelated base motion.
  const range = `${base}...${branch}`;
  const fullDiff = git("git-diff", ["diff", range]);
  if (fullDiff.trim() === "") {
    throw new GatherError(
      "empty-diff",
      `git diff ${range} is empty — nothing to tour (is the branch pushed/committed?)`,
    );
  }

  const numstat = parseNumstat(
    git("git-numstat", ["diff", "--numstat", range]),
  );
  const changedFiles = parseNameStatus(
    git("git-name-status", ["diff", "--name-status", range]),
  );
  const commits = parseLog(
    git("git-log", ["log", "--format=%H%x09%s", `${base}..${branch}`]),
  );

  let additions = 0;
  let deletions = 0;
  for (const n of numstat) {
    additions += n.additions ?? 0;
    deletions += n.deletions ?? 0;
  }

  return {
    meta: {
      hash,
      specPath: specPath.startsWith(opts.repoRoot)
        ? specPath.slice(opts.repoRoot.length).replace(/^\/+/, "")
        : specPath,
      title: frontmatter.title ?? hash,
      base,
      branch,
      sha,
      files: changedFiles.length,
      additions,
      deletions,
      commits: commits.length,
    },
    spec: { frontmatter, goal, acChecklist, acceptanceCriteria },
    fullDiff,
    numstat,
    commits,
    changedFiles,
  };
}

// ---------------------------------------------------------------------------
// Output parsers
// ---------------------------------------------------------------------------

/** Normalize git's rename notation to the NEW path so numstat rows join
 *  against changedFiles/diff paths (self-review finding, Blind Hunter #7):
 *    `src/{old.ts => new.ts}`  → `src/new.ts`
 *    `old.ts => new.ts`        → `new.ts`
 *  Non-rename paths pass through untouched. */
export function normalizeRenamePath(file: string): string {
  const braced = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(file);
  if (braced) {
    // `{old => new}` with empty sides handles `{ => sub}/file` moves too.
    return `${braced[1]}${braced[3]}${braced[4]}`.replace(/\/\//g, "/");
  }
  const arrow = / => /.exec(file);
  if (arrow) return file.slice(arrow.index + arrow[0].length);
  return file;
}

function parseNumstat(out: string): GatheredNumstat[] {
  const rows: GatheredNumstat[] = [];
  for (const line of out.split("\n")) {
    if (line.trim() === "") continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const [a, d, ...fileParts] = parts;
    rows.push({
      file: normalizeRenamePath(fileParts.join("\t")),
      additions: a === "-" ? null : Number.parseInt(a, 10),
      deletions: d === "-" ? null : Number.parseInt(d, 10),
    });
  }
  return rows;
}

function parseNameStatus(out: string): GatheredChangedFile[] {
  const rows: GatheredChangedFile[] = [];
  for (const line of out.split("\n")) {
    if (line.trim() === "") continue;
    const parts = line.split("\t");
    if (parts.length < 2) continue;
    const status = parts[0];
    // Renames/copies emit `R100\told\tnew` — the new path is the last field.
    rows.push({ status, file: parts[parts.length - 1] });
  }
  return rows;
}

function parseLog(out: string): GatheredCommit[] {
  const rows: GatheredCommit[] = [];
  for (const line of out.split("\n")) {
    if (line.trim() === "") continue;
    const tab = line.indexOf("\t");
    if (tab === -1) continue;
    rows.push({ sha: line.slice(0, tab), subject: line.slice(tab + 1) });
  }
  return rows;
}
