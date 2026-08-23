// Canonical repo root resolution (mlc101 — workstream multi-loop-concurrency,
// phase 1).
//
// Every devx process must agree on ONE repo root and ONE `.devx-cache`
// regardless of cwd. A `devx loop` launched from inside a linked worktree
// otherwise finds the worktree's own devx.config.yaml and forks the whole
// state universe — locks, events, loop state — from every peer (race R1).
// Resolution goes through git's common dir: whichever worktree cwd sits in,
// `git rev-parse --git-common-dir` names the shared `.git` of the MAIN
// checkout, so every process derives the same root.
//
// `findProjectConfig` (config-io.ts) keeps its job of *finding*
// devx.config.yaml; this module answers the different question "which
// checkout is canonical" — entry points (`devx loop`, `devx manage`) refuse
// linked-worktree starts and pass the canonical cacheDir down explicitly.
//
// Spec: dev/dev-mlc101-2026-07-28T09:02-canonical-repo-root.md
// Design: _devx/workstreams/multi-loop-concurrency/design/agent.md §Architecture 1

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

export interface RepoRootInfo {
  /** Absolute path of the canonical MAIN checkout root (realpathed). */
  root: string;
  /** `<root>/.devx-cache` — the single state universe. */
  cacheDir: string;
  /** True when the queried cwd sits inside a linked worktree, i.e. its
   *  working tree is NOT the main checkout. */
  isLinkedWorktree: boolean;
}

/** Thrown when the canonical root cannot be determined (not a git repo,
 *  git missing, or unexpected rev-parse output). Callers that support
 *  non-git operation catch this and fall back to their legacy cwd-based
 *  resolution. */
export class RepoRootError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepoRootError";
  }
}

/** realpath when the path exists; the resolved path as-is otherwise
 *  (fixture/fake paths in pure-interpretation callers never exist).
 *  Exported for callers comparing their own paths against `root`. */
export function tryRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * Pure interpretation of `git rev-parse --git-dir --git-common-dir
 * --show-toplevel` output relative to the cwd the command ran in. Exported
 * separately so callers with an injected exec seam (claim.ts) can classify
 * without this module shelling out or touching the filesystem beyond
 * realpath.
 *
 * The linked-worktree discriminator is `git-dir != git-common-dir` — the
 * only shape git guarantees: a linked worktree's git dir is
 * `<commonDir>/worktrees/<name>` while the main worktree's IS the common
 * dir. Comparing toplevel against the common dir's parent (the first-cut
 * approach) misclassifies submodule and separate-git-dir MAIN checkouts —
 * their common dir is `<super>/.git/modules/<name>` / the external git dir,
 * which is not `<toplevel>/.git` even though nothing worktree-shaped is
 * going on (adversarial-review HIGH, verified against real git).
 *
 * Main root: the toplevel itself when not linked; the common dir's parent
 * for the normal `<mainRoot>/.git` layout when linked. A linked worktree of
 * a submodule/separate-git-dir repo (common dir not named `.git`) has no
 * path-derivable main checkout — best-effort: the common dir, still
 * refused upstream via isLinkedWorktree.
 */
export function interpretRevParse(
  gitDirRaw: string,
  commonDirRaw: string,
  toplevelRaw: string,
  cwd: string,
): RepoRootInfo {
  const abs = (raw: string): string =>
    isAbsolute(raw.trim()) ? raw.trim() : resolve(cwd, raw.trim());
  const gitDir = tryRealpath(abs(gitDirRaw));
  const commonDir = tryRealpath(abs(commonDirRaw));
  const toplevel = tryRealpath(abs(toplevelRaw));
  const isLinkedWorktree = gitDir !== commonDir;
  const root = !isLinkedWorktree
    ? toplevel
    : basename(commonDir) === ".git"
      ? dirname(commonDir)
      : commonDir;
  return { root, cacheDir: join(root, ".devx-cache"), isLinkedWorktree };
}

/** The three-flag probe every resolver path runs; exported so the claim
 *  path's exec-seam probe stays argv-identical to the real one. */
export const REV_PARSE_ARGS = [
  "rev-parse",
  "--git-dir",
  "--git-common-dir",
  "--show-toplevel",
] as const;

/**
 * Resolve the canonical repo root for `cwd` (default: process.cwd()).
 *
 * Ensures `cacheDir` exists on return when the root is a devx project
 * (devx.config.yaml at the root) — every consumer (locks, events, loop
 * state) assumes the directory; creating it here is what makes "one
 * `.devx-cache`" a post-condition of resolution rather than a hope. The
 * config gate keeps `devx loop --dry-run` in a random non-devx git repo
 * from littering it with an empty `.devx-cache/`. Creation is
 * best-effort: a permission failure surfaces later at lock acquisition
 * with a better error than mkdir's.
 *
 * Throws RepoRootError outside a git work tree.
 */
export function resolveRepoRoot(cwd: string = process.cwd()): RepoRootInfo {
  let out: string;
  try {
    out = execFileSync("git", [...REV_PARSE_ARGS], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new RepoRootError(
      `cannot resolve canonical repo root from ${cwd}: git rev-parse failed (${msg.split("\n")[0]})`,
    );
  }
  const lines = out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  if (lines.length !== 3) {
    throw new RepoRootError(
      `cannot resolve canonical repo root from ${cwd}: expected 3 lines from git rev-parse, got ${lines.length}`,
    );
  }
  const info = interpretRevParse(lines[0], lines[1], lines[2], cwd);
  if (existsSync(join(info.root, "devx.config.yaml"))) {
    try {
      mkdirSync(info.cacheDir, { recursive: true });
    } catch {
      /* surfaced later by whichever lock/state write needs the dir */
    }
  }
  return info;
}
