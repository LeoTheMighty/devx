// Tour publish + prune (v2t101) — hosting leg per D-4 in v2/07-decisions.md:
// orphan `devx-tours` branch + htmlpreview.github.io wrapper link, raw-file
// fallback for private repos.
//
// The publish MUST NOT disturb the invoking worktree: /devx calls this from
// a feature-branch worktree mid-run, and a checkout/branch switch here would
// stomp the in-flight work. So we never touch HEAD, the working tree, or the
// real index — everything goes through git plumbing against a TEMPORARY
// GIT_INDEX_FILE:
//
//   fetch origin devx-tours          (absent remote branch → orphan create)
//   hash-object -w tour.html         → blob
//   read-tree <parent-tree|--empty>  (temp index)
//   update-index --add --cacheinfo   tours/<hash>/tour.html
//   write-tree                       → tree
//   commit-tree [-p parent]          → commit  (orphan root when no parent)
//   push origin <commit>:refs/heads/devx-tours
//
// Race safety: parallel agents publish concurrently, so a push can lose the
// non-fast-forward race. On rejection we re-fetch (picking up the winner's
// commit as the new parent) and rebuild the tree — retrying up to
// maxAttempts. Each retry re-reads the WINNER's tree, so both tours survive
// (the tree merge is trivially conflict-free: distinct tours/<hash>/ paths).
//
// Prune (retention): tours for MERGED PRs beyond `--keep <n>` are removed so
// the branch doesn't grow unbounded (v2/03-review-tour.md §3). Unmerged
// tours are always kept — their PR review may still be in flight.
//
// Spec: dev/dev-v2t101-2026-07-05T13:04-review-tour.md

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type Exec, type ExecResult, realExec } from "./exec.js";
import { TOURS_CACHE_REL } from "./render.js";

export const TOURS_BRANCH = "devx-tours";
export const TOURS_REMOTE = "origin";
const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_PRUNE_KEEP = 10;

export class TourPublishError extends Error {
  readonly stage:
    | "no-tour-file"
    | "remote-url"
    | "fetch"
    | "plumbing"
    | "push"
    | "race-exhausted"
    | "prune";
  constructor(stage: TourPublishError["stage"], message: string) {
    super(`tour publish failed at stage '${stage}': ${message}`);
    this.name = "TourPublishError";
    this.stage = stage;
  }
}

export interface PublishOpts {
  repoRoot: string;
  /** Test seam — replacement for the real git/gh shell-out. */
  exec?: Exec;
  /** Remote name. Default "origin". */
  remote?: string;
  /** Tours branch name. Default "devx-tours". */
  branch?: string;
  /** Push retry budget for the non-fast-forward race. Default 3. */
  maxAttempts?: number;
  /** Test seam — where the temp GIT_INDEX_FILE dir is created. */
  tmpRoot?: string;
}

export interface PublishResult {
  /** htmlpreview.github.io wrapper — the primary "Take the tour" link. */
  htmlpreviewUrl: string;
  /** raw.githubusercontent.com fallback (private repos / htmlpreview down). */
  rawUrl: string;
  commitSha: string;
  /** 1-based attempt count that finally landed (audit trail for the race). */
  attempts: number;
  /** True when this push created the orphan branch. */
  createdBranch: boolean;
}

// ---------------------------------------------------------------------------
// GitHub remote parsing
// ---------------------------------------------------------------------------

/** Parse `owner/repo` out of a GitHub remote URL. Supports
 *  `git@github.com:owner/repo.git`, `ssh://git@github.com/owner/repo.git`,
 *  and `https://github.com/owner/repo(.git)`. Returns null for non-GitHub
 *  remotes — the caller degrades to a path-only message. */
export function parseGithubRemote(
  url: string,
): { owner: string; repo: string } | null {
  const trimmed = url.trim();
  const m =
    /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/github\.com\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(
      trimmed,
    );
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

export function tourUrls(
  owner: string,
  repo: string,
  branch: string,
  hash: string,
): { htmlpreviewUrl: string; rawUrl: string } {
  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/tours/${hash}/tour.html`;
  return {
    htmlpreviewUrl: `https://htmlpreview.github.io/?${rawUrl}`,
    rawUrl,
  };
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

interface GitCtx {
  exec: Exec;
  repoRoot: string;
  env?: Record<string, string>;
}

function git(ctx: GitCtx, args: string[]): ExecResult {
  return ctx.exec("git", args, { cwd: ctx.repoRoot, env: ctx.env });
}

function gitOk(
  ctx: GitCtx,
  stage: TourPublishError["stage"],
  args: string[],
): string {
  const r = git(ctx, args);
  if (r.exitCode !== 0) {
    throw new TourPublishError(
      stage,
      `git ${args.join(" ")} exited ${r.exitCode}: ${r.stderr.trim() || "(no stderr)"}`,
    );
  }
  return r.stdout;
}

/** Fetch the tours branch; returns the remote tip sha or null when the
 *  branch doesn't exist yet (first-ever publish → orphan create).
 *
 *  The "branch absent" discrimination matches git's stderr, so the fetch
 *  runs under LC_ALL=C — a localized git (de/fr/ja catalogs ship with git)
 *  would otherwise emit a translated message, misclassify the first-ever
 *  publish as a hard fetch error, and never create the orphan branch
 *  (self-review finding, Edge Case Hunter #3). */
function fetchToursTip(
  ctx: GitCtx,
  remote: string,
  branch: string,
): string | null {
  const f = ctx.exec(
    "git",
    ["fetch", remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`],
    { cwd: ctx.repoRoot, env: { ...(ctx.env ?? {}), LC_ALL: "C" } },
  );
  if (f.exitCode !== 0) {
    // Distinguish "branch doesn't exist" (fine — we create it) from real
    // fetch failures (network/auth — abort). git says "couldn't find remote
    // ref" for the former.
    const stderr = f.stderr.toLowerCase();
    if (
      stderr.includes("couldn't find remote ref") ||
      stderr.includes("could not find remote ref")
    ) {
      return null;
    }
    throw new TourPublishError(
      "fetch",
      `git fetch ${remote} ${branch} exited ${f.exitCode}: ${f.stderr.trim()}`,
    );
  }
  // The fetch SUCCEEDED, so the tracking ref must resolve. A rev-parse
  // failure here is NOT "branch absent" — returning null would build an
  // orphan ROOT commit that, if it won the push, discards every previously
  // published tour (self-review finding, Blind Hunter #4). Surface it.
  const rev = git(ctx, ["rev-parse", `refs/remotes/${remote}/${branch}`]);
  if (rev.exitCode !== 0) {
    throw new TourPublishError(
      "fetch",
      `git fetch succeeded but refs/remotes/${remote}/${branch} did not resolve (rev-parse exited ${rev.exitCode}: ${rev.stderr.trim() || "(no stderr)"})`,
    );
  }
  return rev.stdout.trim();
}

/** Detect a lost push race. Deliberately narrow — auth/network/hook
 *  failures must surface as hard errors, not spin the retry loop: git's
 *  non-FF rejection always carries "[rejected]" plus one of the two hint
 *  phrases, while permission/hook failures carry neither. */
function isNonFastForward(pushResult: ExecResult): boolean {
  const s = (pushResult.stderr + pushResult.stdout).toLowerCase();
  return (
    s.includes("non-fast-forward") ||
    s.includes("fetch first") ||
    s.includes("[rejected]")
  );
}

export function publishTour(hash: string, opts: PublishOpts): PublishResult {
  const exec = opts.exec ?? realExec;
  const remote = opts.remote ?? TOURS_REMOTE;
  const branch = opts.branch ?? TOURS_BRANCH;
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  const tourFile = join(opts.repoRoot, TOURS_CACHE_REL, hash, "tour.html");
  if (!existsSync(tourFile)) {
    throw new TourPublishError(
      "no-tour-file",
      `${tourFile} not found — run \`devx tour build ${hash} --tour-json <path>\` first`,
    );
  }

  const baseCtx: GitCtx = { exec, repoRoot: opts.repoRoot };

  // Remote identity → the two URLs. Resolved up front so URL problems fail
  // before we mutate anything.
  const remoteUrlOut = gitOk(baseCtx, "remote-url", [
    "remote",
    "get-url",
    remote,
  ]).trim();
  const gh = parseGithubRemote(remoteUrlOut);
  if (!gh) {
    throw new TourPublishError(
      "remote-url",
      `remote '${remote}' (${remoteUrlOut}) is not a recognizable GitHub URL — cannot derive tour links`,
    );
  }
  const urls = tourUrls(gh.owner, gh.repo, branch, hash);

  // Blob write is parent-independent — do it once outside the retry loop.
  const blob = gitOk(baseCtx, "plumbing", [
    "hash-object",
    "-w",
    "--",
    tourFile,
  ]).trim();

  const tmpDir = mkdtempSync(join(opts.tmpRoot ?? tmpdir(), "devx-tour-pub-"));
  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const parent = fetchToursTip(baseCtx, remote, branch);
      // Fresh temp index per attempt — a stale index from a lost race would
      // resurrect the loser's (pre-refetch) view of the tree.
      const ctx: GitCtx = {
        ...baseCtx,
        env: { GIT_INDEX_FILE: join(tmpDir, `index-${attempt}`) },
      };

      if (parent) {
        gitOk(ctx, "plumbing", ["read-tree", parent]);
      } else {
        gitOk(ctx, "plumbing", ["read-tree", "--empty"]);
      }
      gitOk(ctx, "plumbing", [
        "update-index",
        "--add",
        "--cacheinfo",
        `100644,${blob},tours/${hash}/tour.html`,
      ]);
      const tree = gitOk(ctx, "plumbing", ["write-tree"]).trim();

      // No-op publish (same tour bytes already on the branch): skip the
      // commit + push entirely. Determinstic rendering makes this common on
      // fix-forward re-runs.
      if (parent) {
        const parentTree = gitOk(baseCtx, "plumbing", [
          "rev-parse",
          `${parent}^{tree}`,
        ]).trim();
        if (parentTree === tree) {
          return {
            ...urls,
            commitSha: parent,
            attempts: attempt,
            createdBranch: false,
          };
        }
      }

      const commitArgs = ["commit-tree", tree];
      if (parent) commitArgs.push("-p", parent);
      commitArgs.push("-m", `tour(${hash}): publish review tour`);
      const commit = gitOk(baseCtx, "plumbing", commitArgs).trim();

      const push = git(baseCtx, [
        "push",
        remote,
        `${commit}:refs/heads/${branch}`,
      ]);
      if (push.exitCode === 0) {
        return {
          ...urls,
          commitSha: commit,
          attempts: attempt,
          createdBranch: parent === null,
        };
      }
      if (!isNonFastForward(push)) {
        throw new TourPublishError(
          "push",
          `git push exited ${push.exitCode}: ${push.stderr.trim() || "(no stderr)"}`,
        );
      }
      // Lost the race — loop refetches the winner's tip as the new parent.
    }
    throw new TourPublishError(
      "race-exhausted",
      `push to ${remote}/${branch} lost the non-fast-forward race ${maxAttempts} times — is something force-pushing the tours branch?`,
    );
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Prune
// ---------------------------------------------------------------------------

export interface PruneOpts extends PublishOpts {
  /** How many MERGED-PR tours to retain (newest by branch-commit time).
   *  Unmerged tours are always kept. Default 10. */
  keep?: number;
  /** Branch-name derivation for the merged-PR lookup. Default `feat/dev-`.
   *  v1 scope note: `devx tour gather/build/publish` only operate on dev/
   *  specs, so every tour on the branch is a dev tour today. If tours ever
   *  ship for other spec types, the lookup must try each type's branch
   *  shape or those tours are retained forever (fail-safe direction, but
   *  unbounded growth — self-review finding, Blind Hunter #9). */
  featureBranchPrefix?: string;
}

export interface PruneResult {
  pruned: string[];
  kept: string[];
  /** Commit that landed the prune, or null when nothing to prune. */
  commitSha: string | null;
}

/** List tour hashes present on the remote tours branch tip. `-z` output
 *  (NUL-separated, no C-quoting) so unusual directory names are listed
 *  verbatim instead of quoted past the regex and silently retained forever
 *  (self-review finding, Blind Hunter #8). */
function listTourHashes(ctx: GitCtx, tip: string): string[] {
  const out = gitOk(ctx, "prune", [
    "ls-tree",
    "-z",
    "--name-only",
    tip,
    "tours/",
  ]);
  const hashes: string[] = [];
  for (const entry of out.split("\0")) {
    const m = /^tours\/([^/]+)$/.exec(entry.trim());
    if (m) hashes.push(m[1]);
  }
  return hashes;
}

export function pruneTours(opts: PruneOpts): PruneResult {
  const exec = opts.exec ?? realExec;
  const remote = opts.remote ?? TOURS_REMOTE;
  const branch = opts.branch ?? TOURS_BRANCH;
  const keep = opts.keep ?? DEFAULT_PRUNE_KEEP;
  const prefix = opts.featureBranchPrefix ?? "feat/dev-";
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseCtx: GitCtx = { exec, repoRoot: opts.repoRoot };

  if (!Number.isInteger(keep) || keep < 0) {
    throw new TourPublishError(
      "prune",
      `--keep must be a non-negative integer (got ${keep})`,
    );
  }

  const tmpDir = mkdtempSync(
    join(opts.tmpRoot ?? tmpdir(), "devx-tour-prune-"),
  );
  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const tip = fetchToursTip(baseCtx, remote, branch);
      if (tip === null) {
        return { pruned: [], kept: [], commitSha: null };
      }
      const hashes = listTourHashes(baseCtx, tip);

      // Partition merged vs unmerged via gh. A gh failure keeps the tour
      // (safe direction: never prune a tour whose PR state is unknown).
      const merged: { hash: string; when: number }[] = [];
      const keptAlways: string[] = [];
      for (const h of hashes) {
        const r = exec(
          "gh",
          [
            "pr",
            "list",
            "--head",
            `${prefix}${h}`,
            "--state",
            "merged",
            "--json",
            "number",
            "--limit",
            "1",
          ],
          { cwd: opts.repoRoot },
        );
        let isMerged = false;
        if (r.exitCode === 0) {
          try {
            const parsed = JSON.parse(r.stdout || "[]");
            isMerged = Array.isArray(parsed) && parsed.length > 0;
          } catch {
            isMerged = false;
          }
        }
        if (!isMerged) {
          keptAlways.push(h);
          continue;
        }
        // Recency = last commit touching this tour path on the tours branch.
        const logR = git(baseCtx, [
          "log",
          "-1",
          "--format=%ct",
          tip,
          "--",
          `tours/${h}`,
        ]);
        const when =
          logR.exitCode === 0 ? Number.parseInt(logR.stdout.trim(), 10) : 0;
        merged.push({ hash: h, when: Number.isFinite(when) ? when : 0 });
      }

      merged.sort((a, b) => b.when - a.when);
      const keptMerged = merged.slice(0, keep).map((m) => m.hash);
      const toPrune = merged.slice(keep).map((m) => m.hash);
      const kept = [...keptAlways, ...keptMerged];

      if (toPrune.length === 0) {
        return { pruned: [], kept, commitSha: null };
      }

      const ctx: GitCtx = {
        ...baseCtx,
        env: { GIT_INDEX_FILE: join(tmpDir, `index-${attempt}`) },
      };
      gitOk(ctx, "plumbing", ["read-tree", tip]);
      for (const h of toPrune) {
        gitOk(ctx, "plumbing", [
          "update-index",
          "--force-remove",
          `tours/${h}/tour.html`,
        ]);
      }
      const tree = gitOk(ctx, "plumbing", ["write-tree"]).trim();
      const commit = gitOk(baseCtx, "plumbing", [
        "commit-tree",
        tree,
        "-p",
        tip,
        "-m",
        `tour: prune ${toPrune.length} merged tour(s) beyond keep=${keep}`,
      ]).trim();
      const push = git(baseCtx, [
        "push",
        remote,
        `${commit}:refs/heads/${branch}`,
      ]);
      if (push.exitCode === 0) {
        return { pruned: toPrune, kept, commitSha: commit };
      }
      if (!isNonFastForward(push)) {
        throw new TourPublishError(
          "push",
          `git push exited ${push.exitCode}: ${push.stderr.trim() || "(no stderr)"}`,
        );
      }
    }
    throw new TourPublishError(
      "race-exhausted",
      `prune push to ${remote}/${branch} lost the non-fast-forward race ${maxAttempts} times`,
    );
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}
