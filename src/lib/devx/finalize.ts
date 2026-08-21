// `devx devx-helper finalize <hash>` — the /devx Phase 8 after-merge tail
// as one primitive (b931a1).
//
// The tail is the last section of the skill body that was still inline git
// prose, and it is the section that runs on `main` — the one tree every
// concurrent session shares — after the PR has already merged. mlcret found
// it failing three ways at once during multi-loop-concurrency
// (`LEARN.md § multi-loop-concurrency` E1/E2/E3/E5):
//
//   E1  unscoped staging: `git add -A` swept a live peer's files into
//       mlc106's mark-done commit.
//   E3  no spec-lock release: 4 of 6 mlc specs left a dead-owner lock on
//       disk permanently. Nothing ever reaps a `done` spec's lock, because
//       reaping only fires on a contending claim for the same hash — which
//       never comes once the item is closed.
//   E2  no rebuild of the self-hosted CLI: `devx` on PATH resolves to the
//       MAIN worktree's gitignored `dist/`, but a story's local gate runs
//       inside its WORKTREE, so `npm test` refreshes the worktree's build
//       and never main's. At mlcret time `devx loop --help | grep -c epic`
//       returned 0 — mlc106's entire scope model was merged and unreachable
//       from the CLI `/devx` itself invokes.
//   E5  narrative timestamps: mlc106's merge line compressed a ~15h
//       overnight gap into 25 minutes and silently switched timezone.
//
// E1 and E5 were closed structurally by sgr105's `mark-done` (it writes the
// flips under the backlog lock and RETURNS the exact pathspecs, and it
// stamps from a clock seam). This module is the wrapper that makes those
// returns impossible to ignore, and it adds the two stages nothing owned:
// the guarded lock release and the dist refresh.
//
// ORDERING is the contract, and it is not arbitrary:
//
//   0. verify    — the checkout is the main worktree, parked on the default
//                  branch, and (after the pull) the merge sha is genuinely an
//                  ancestor of HEAD. All three are pre-write aborts.
//   1. pull      — bring the squash-merge commit into local `main` FIRST.
//                  Everything below writes to files that live on `main`;
//                  writing them on a stale tree and then discovering the
//                  push is non-fast-forward leaves a dirty main behind.
//                  This is the one stage that ABORTS (nothing is written).
//   2. mark-done — the flips, under the backlog lock. Returns pathspecs.
//   3. commit    — `git add -- <those pathspecs>`, never `git add -A`.
//   4. push      — with a bounded rebase-retry on a race-shaped rejection,
//                  the same posture as the claim's push (mlc104).
//   5. worktree  — remove `.worktrees/<type>-<hash>` + delete the branch.
//   6. release   — guarded spec-lock release under the backlog lock. AFTER
//                  the worktree, not before: a `worktree remove` refusal
//                  (uncommitted content) means the item is not really closed,
//                  and releasing first would leave it `done`, unlocked and
//                  re-claimable while a live worktree still sits on the
//                  branch the next attempt will `-D`.
//   7. rebuild   — refresh the main worktree's `dist/`, when this checkout is
//                  the devx source repo. In any other project it is a skip,
//                  not a failure — `build:swap` is devx's own script and the
//                  E2 argument ("`devx` on PATH resolves to THIS tree's
//                  gitignored dist/") is only true for the self-hosted case.
//
// FAILURE POSTURE, two tiers, and the boundary is stage 2:
//   • BEFORE the flips land (validate/resolve/verify/pull) → abort, nothing
//     was written, exit 2 (or 1 for mark-done's retryable state/contention
//     tier, forwarded verbatim from runMarkDone's contract). The aborting
//     stage is named in the JSON's `stage` field, so an agent branching on it
//     gets the real cause and not a guess.
//   • AFTER the flips land → never abort. The merge is already real and
//     remote; a failed `git worktree remove` must not take the bookkeeping
//     down with it. Every later stage is recorded as `ok: false` with its
//     detail, and the CLI answers exit 3 = "the flips landed, one or more
//     tail stages did not — look at `steps`". That is a distinct code from
//     both the retryable tier and the abort tier precisely because the
//     operator's response is different: re-running finalize would fail at
//     mark-done (the row is already `[x]`), so the fix is to finish the
//     named stages by hand.
//
// Spec: dev/dev-b931a1-2026-07-29T10:15-finalize-merge-tail-primitive.md

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  type BacklogLockFn,
  BacklogLockTimeoutError,
  withBacklogLock,
} from "../backlog/mutate.js";
import {
  type Exec,
  type ClaimableType,
  BACKLOG_BY_TYPE,
  isRejectedPush,
  realExec,
} from "./claim.js";
import { type DeriveBranchConfig, deriveBranch } from "../plan/derive-branch.js";
import { releaseSpecLockGuarded, specLockPath } from "./spec-lock.js";
import { type SpecLockReleaseResult } from "./spec-lock.js";

/** Bounded rebase-retries for the bookkeeping push, mirroring
 *  CLAIM_PUSH_MAX_RETRIES. Same reasoning: a peer landing its own
 *  bookkeeping commit between our pull and our push is a race worth
 *  retrying; anything else is a broken push worth reporting. */
export const FINALIZE_PUSH_MAX_RETRIES = 2;

export type FinalizeStage =
  | "verify-checkout"
  | "pull"
  | "verify-merge"
  | "mark-done"
  | "commit"
  | "push"
  | "release-lock"
  | "worktree"
  | "rebuild";

export interface FinalizeStep {
  stage: FinalizeStage;
  /** false = the stage ran and failed. A skipped stage is ok:true. */
  ok: boolean;
  /** true when the stage was deliberately not run (nothing to do, or
   *  switched off by a flag). Never an error. */
  skipped?: boolean;
  /** Human-readable outcome or failure detail. Always present on !ok. */
  detail?: string;
}

export interface FinalizeResult {
  hash: string;
  /** The pathspecs mark-done wrote and this call staged. Empty when the
   *  run aborted before stage 2. */
  paths: string[];
  steps: FinalizeStep[];
  /** Did every non-skipped stage succeed? */
  ok: boolean;
  /**
   * mark-done's workstream `todo.md` sync result, surfaced verbatim.
   *
   * It used to be folded into a detail string only when TRUE, which meant a
   * FAILED sync on a workstream item was invisible under prose that said
   * "nothing left to do". False here means either "not a workstream item" or
   * "the sync failed" — mark-done's stderr says which, and the fix is
   * `devx todo sync <plan-hash>`.
   */
  todoSynced: boolean;
}

/** Everything finalize needs from the outside world. Every field is a test
 *  seam with a production default; the tests drive the whole tail with a
 *  fake exec and never touch a real repo or a real `npm run build`. */
export interface FinalizeOpts {
  /** Project repo root — the MAIN checkout. Finalize refuses to run from a
   *  linked worktree (see assertMainWorktree). */
  repoRoot: string;
  /** Spec type: picks the spec dir, the backlog file and the worktree stem. */
  type: ClaimableType;
  /** Merged devx.config.yaml. `git:` drives branch derivation and the
   *  default-branch guard; forwarded to nothing else (mark-done loads its
   *  own). Branch names are NOT re-derived by hand here — `deriveBranch`
   *  (pln101) is the single source of truth, and hardcoding `feat/<type>-
   *  <hash>` is the exact cross-epic regression class it exists to kill. */
  config: DeriveBranchConfig & { git?: { default_branch?: string } };
  /** Merged PR number, forwarded to mark-done. */
  pr: number;
  /** Squash-merge commit sha, forwarded to mark-done. */
  mergeSha: string;
  /**
   * Session token whose claim this is — the value `devx devx-helper claim`
   * returned as `sessionToken`. The lock release is GUARDED on it, so a peer
   * that re-claimed the hash after our lock was cleared keeps its lock.
   *
   * `null` means the caller did not supply one. That is NOT the same as
   * supplying a wrong one, and conflating the two was the bug all three
   * reviewers found: the lock body records the *claim* process's
   * `defaultSessionId()`, so a token re-derived in this later process can
   * never match, and reporting that as "a peer re-claimed the hash" told the
   * operator a story about a peer that does not exist while the lock leaked
   * forever. With `null` the stage fails loudly and names the real cause.
   * Never derive this from the spec's `owner:` or the lock body — a token
   * read from the thing it guards always matches (CLAUDE.md, E13).
   */
  sessionToken: string | null;
  /** Branch to delete after the worktree is removed. When omitted it is
   *  derived via `deriveBranch(config, type, hash)` — but a spec that
   *  RECORDS a branch (mss102 attach mode, or any branch-handoff follow-up)
   *  must pass it explicitly; the recorded name is not the derived one. */
  branch?: string;
  /** Skip stage 7. The rebuild is the only stage that mutates a tree
   *  peers read from, so it stays switchable. */
  rebuild?: boolean;
  /** Test seam — reads a file as utf8 (package.json probe, .git/HEAD). */
  readFile?: (p: string) => string;
  /** Test seam — every git/npm shell-out. */
  exec?: Exec;
  /** Test seam — replaces the cross-process backlog lock (the guarded
   *  release must run under it; see releaseSpecLockGuarded's contract). */
  lock?: BacklogLockFn;
  /** Test seam — the mark-done call. Returns what runMarkDone's JSON
   *  carries, or throws. Defaults to an in-process markDone(). */
  markDone?: () => { paths: string[]; todoSynced: boolean };
  /** Test seam — path existence probe (worktree presence). */
  exists?: (p: string) => boolean;
  /** Test seam — stdout/stderr sinks for progress detail. */
  err?: (s: string) => void;
}

export class FinalizeAbort extends Error {
  readonly stage: FinalizeStage;
  constructor(stage: FinalizeStage, message: string) {
    super(message);
    this.name = "FinalizeAbort";
    this.stage = stage;
  }
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function fail(r: { exitCode: number; stderr: string; stdout: string }): string {
  return r.stderr.trim() || r.stdout.trim() || `exit ${r.exitCode}`;
}

// ---------------------------------------------------------------------------
// Pure decision half
// ---------------------------------------------------------------------------

/**
 * Read the sha HEAD currently points at, without spawning `git`.
 *
 * `.git/HEAD` is either a raw sha (detached) or `ref: refs/heads/<name>`; a
 * loose ref is one more file read, and a packed ref is a line in
 * `.git/packed-refs`. Three reads worst case, all of them tiny.
 *
 * Returns null whenever the answer is not knowable — a linked worktree
 * (`.git` is a file), a missing ref, a bare repo. Callers must treat null as
 * "no opinion", never as a mismatch.
 */
export function headSha(
  repoRoot: string,
  readFile: (p: string) => string,
): string | null {
  let head: string;
  try {
    head = readFile(join(repoRoot, ".git", "HEAD")).trim();
  } catch {
    return null;
  }
  if (/^[0-9a-f]{40,64}$/i.test(head)) return head;
  const m = /^ref:\s*(\S+)$/.exec(head);
  if (!m) return null;
  const ref = m[1];
  try {
    const loose = readFile(join(repoRoot, ".git", ref)).trim();
    if (/^[0-9a-f]{40,64}$/i.test(loose)) return loose;
  } catch {
    // fall through to packed-refs
  }
  try {
    for (const line of readFile(join(repoRoot, ".git", "packed-refs")).split("\n")) {
      const p = /^([0-9a-f]{40,64})\s+(\S+)$/.exec(line.trim());
      if (p && p[2] === ref) return p[1];
    }
  } catch {
    // no packed-refs
  }
  return null;
}

/**
 * Is the build under `repoRoot/dist` built from a different commit than HEAD?
 *
 * Compares the sha `scripts/build-info.mjs` embedded in
 * `dist/build-info.json` against the sha HEAD points at — NOT, as the first
 * cut did, the mtime of `dist/build-info.json` against the mtime of
 * `.git/logs/HEAD`. That predicate was wrong in the most common way
 * possible: the reflog is appended by EVERY head movement, including
 * `/devx` Phase 1's own claim commit, which touches only `DEV.md` and a spec
 * and cannot make the compiled CLI stale. So from the claim through the
 * merge, every single `devx` invocation of a normal run printed the banner —
 * and a warning that fires wrongly is one operators learn to ignore, which
 * this module's own docstring said before it did it.
 *
 * Still no subprocess: the embedded sha is abbreviated (`git rev-parse
 * --short`), so the comparison is a prefix test against the full sha read
 * out of `.git`. That is a handful of small file reads on a CLI whose whole
 * value is being cheap to call, versus ~150ms of process spawn per
 * invocation on this machine.
 *
 * Returns null when the question is unanswerable — no build-info (running
 * from src under tsx, or a tarball install with no provenance), no readable
 * ref, or an unparseable stamp. Unanswerable must read as "not stale".
 */
export function isBuildStale(
  repoRoot: string,
  deps: { readFile?: (p: string) => string } = {},
): boolean | null {
  const readFile = deps.readFile ?? ((p: string) => readFileSync(p, "utf8"));

  let builtSha: string;
  try {
    const raw = JSON.parse(readFile(join(repoRoot, "dist", "build-info.json"))) as {
      sha?: unknown;
    };
    if (typeof raw.sha !== "string" || !/^[0-9a-f]{7,}$/i.test(raw.sha)) return null;
    builtSha = raw.sha.toLowerCase();
  } catch {
    return null;
  }

  const head = headSha(repoRoot, readFile);
  if (head === null) return null;
  return !head.toLowerCase().startsWith(builtSha);
}

/** The one-line warning `devx` prints when its own build predates HEAD.
 *  Pure so the wording is testable without a repo. */
export function staleBuildWarning(repoRoot: string): string {
  return (
    `devx: WARNING — this CLI is running a build older than ${repoRoot}'s HEAD.\n` +
    `devx:   \`npm run build\` in ${repoRoot}, or re-run through ` +
    `\`devx devx-helper finalize\`, which refreshes it after every merge.\n`
  );
}

/**
 * Derive the pathspec list to stage. Exists so the "never `git add -A`"
 * rule is a return value rather than a sentence in a skill body: the only
 * thing the caller can stage is what mark-done says it wrote.
 *
 * Drops anything outside the repo-relative shape mark-done promises — a
 * path that escapes the repo (`../`) or is absolute would widen the commit
 * beyond the tree this call owns, and silently staging it is exactly the
 * class E1 names.
 */
export function stageablePaths(paths: readonly string[]): string[] {
  return paths.filter(
    (p) =>
      p.length > 0 &&
      !p.startsWith("/") &&
      !p.startsWith("../") &&
      !p.includes("/../") &&
      p !== "..",
  );
}

/**
 * Is `repoRoot` the main checkout rather than a linked worktree?
 *
 * Finalize mutates `main`'s backlog, `main`'s specs and `main`'s `dist/`.
 * Run from inside `.worktrees/<type>-<hash>` — which is where the agent
 * that just merged is standing — every one of those writes would land on
 * the wrong tree, and the worktree-removal stage would try to remove the
 * directory it is executing in. `.git` is a DIRECTORY in the main checkout
 * and a FILE (a gitdir pointer) in every linked worktree, so this is one
 * stat and no shell-out.
 */
export function isMainWorktree(
  repoRoot: string,
  deps: { isDirectory?: (p: string) => boolean | null } = {},
): boolean | null {
  const isDirectory =
    deps.isDirectory ??
    ((p: string) => {
      try {
        return statSync(p).isDirectory();
      } catch {
        return null;
      }
    });
  return isDirectory(join(repoRoot, ".git"));
}

/**
 * Read the checked-out branch name straight out of `.git/HEAD`.
 *
 * No `git` shell-out: this runs on the abort path before anything is written,
 * and `.git/HEAD` is a single line — either `ref: refs/heads/<name>` or a raw
 * sha (detached). Returns null when the file is missing or detached, which
 * callers treat as "unknowable", never as "wrong branch".
 */
export function currentBranch(
  repoRoot: string,
  readFile: (p: string) => string,
): string | null {
  let raw: string;
  try {
    raw = readFile(join(repoRoot, ".git", "HEAD"));
  } catch {
    return null;
  }
  const m = /^ref:\s*refs\/heads\/(.+?)\s*$/m.exec(raw);
  return m ? m[1] : null;
}

/**
 * The branch this checkout must be on for the tail to write to the right
 * place. `git.default_branch` when set; `main` otherwise — the same fallback
 * the rest of the codebase uses.
 */
export function expectedBranch(
  config: { git?: { default_branch?: string; integration_branch?: string | null } },
): string {
  const integration = config.git?.integration_branch;
  if (typeof integration === "string" && integration.trim() !== "") {
    return integration.trim();
  }
  const def = config.git?.default_branch;
  return typeof def === "string" && def.trim() !== "" ? def.trim() : "main";
}

/**
 * Does `repoRoot` look like the devx source checkout — i.e. is its `dist/`
 * the build that `devx` on PATH actually resolves to?
 *
 * Stage 7 exists for exactly one situation: devx building itself. `skills/`
 * ships in the npm tarball and `devx init` installs the Phase 8 prose into
 * consumer repos, so without this probe every merge in every other project
 * would run `npm run build:swap`, get `Missing script`, and exit 3 — telling
 * that project's agent to go finish a stage by hand that never applied to it.
 *
 * The probe is the honest one: does THIS repo declare the script that does
 * the rebuild? A consumer repo does not, and never will.
 */
export function isSelfHostedCheckout(
  repoRoot: string,
  readFile: (p: string) => string,
): boolean {
  try {
    const pkg = JSON.parse(readFile(join(repoRoot, "package.json"))) as {
      scripts?: Record<string, unknown>;
    };
    return typeof pkg.scripts?.["build:swap"] === "string";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Impure driver half
// ---------------------------------------------------------------------------

/**
 * Run the after-merge tail. See the file header for stage order and the
 * two-tier failure posture.
 *
 * Throws `FinalizeAbort` only for the pre-write tier; once mark-done has
 * returned, this function always resolves with a `FinalizeResult` whose
 * `steps` carry the per-stage detail.
 */
export function finalize(hash: string, opts: FinalizeOpts): FinalizeResult {
  const exec = opts.exec ?? realExec;
  const err = opts.err ?? ((s: string) => process.stderr.write(s));
  const exists = opts.exists ?? ((p: string) => existsSync(p));
  const readFile = opts.readFile ?? ((p: string) => readFileSync(p, "utf8"));
  const repoRoot = opts.repoRoot;
  const steps: FinalizeStep[] = [];
  // No `env` here: realExec already pins GIT_TERMINAL_PROMPT=0 (no credential
  // prompt can hang us) and LC_ALL=C (the `/not found/i` and
  // `/nothing to commit/i` matches below are English-string matches, and a
  // localized git would silently defeat them).
  const git = (...args: string[]) => exec("git", args, { cwd: repoRoot });

  // ---- stage 0: verify the checkout ---------------------------------------
  // Reported under its OWN stage name. It used to throw `stage: "pull"`,
  // which sent an agent branching on the machine-readable field off to debug
  // a network problem when the real fix was `cd` to the main worktree.
  {
    const main = isMainWorktree(repoRoot);
    if (main === false) {
      throw new FinalizeAbort(
        "verify-checkout",
        `${repoRoot} is a linked worktree, not the main checkout — finalize writes to the backlog, the spec and dist/ on the integration branch. Re-run it from the main worktree.`,
      );
    }
    // The prose has always promised "one commit on `main`", and nothing ever
    // checked. A main worktree parked on another branch — after a
    // branch-handoff split, or any human checkout — takes `pull --ff-only`
    // and the bookkeeping commit onto THAT branch, silently.
    const want = expectedBranch(opts.config);
    const have = currentBranch(repoRoot, readFile);
    if (have !== null && have !== want) {
      throw new FinalizeAbort(
        "verify-checkout",
        `${repoRoot} is on branch '${have}', not '${want}' — the bookkeeping commit and the pull both belong on the integration branch. Nothing was written. \`git checkout ${want}\` and re-run.`,
      );
    }
    steps.push({
      stage: "verify-checkout",
      ok: true,
      detail: have !== null ? `on ${have}` : "branch unknowable (detached HEAD) — proceeding",
    });
  }

  // ---- stage 1: pull -----------------------------------------------------
  // One fetch+retry before giving up, mirroring the loop's mlc104 posture: a
  // transient fetch failure (network blip, a peer's push landing mid-fetch)
  // should not strand a merge that already landed on origin. Unlike the loop
  // we ABORT when it still fails — the loop cannot stall overnight, an
  // interactive caller can and should stop rather than write to a stale tree.
  {
    let r = git("pull", "--ff-only");
    if (r.exitCode !== 0) {
      const f = git("fetch", "origin", "--prune");
      if (f.exitCode !== 0) {
        err(`devx finalize: fetch retry failed: ${fail(f)}\n`);
      }
      // Attempted even after a failed fetch: `git pull` runs its own fetch,
      // so the explicit one is belt-and-suspenders, not a precondition.
      r = git("pull", "--ff-only");
    }
    if (r.exitCode !== 0) {
      throw new FinalizeAbort(
        "pull",
        `git pull --ff-only failed in ${repoRoot} after one fetch retry: ${fail(r)}. ` +
          `Nothing was written. Local main must carry the squash-merge commit before the bookkeeping flips land on it.`,
      );
    }
    steps.push({ stage: "pull", ok: true, detail: r.stdout.trim() || "up to date" });
  }

  // ---- stage 1b: verify the merge actually landed -------------------------
  // `--merge-sha` was only ever shape-checked (4-64 hex) and used to render
  // text. But stage 5 runs `git branch -D`, which force-deletes: if the merge
  // did NOT land — `gh pr merge` from a worktree exits non-zero often enough
  // that the skill body warns about it, and an agent can misread the verify —
  // the pull is a no-op, mark-done flips the row, and the branch holding the
  // only copy of the work is destroyed, with the remote copy gone too if
  // `--delete-branch` ran. One ancestry check makes that structural.
  //
  // Three outcomes, and the middle one matters: exit 0 = landed; exit 1 =
  // definitively NOT an ancestor, abort before writing anything; anything
  // else (unknown object in a shallow clone, git unavailable) = unanswerable,
  // which must not block a real merge — it degrades to a warning and
  // suppresses only the destructive half, the branch delete.
  let mergeVerified: boolean | null = null;
  {
    const r = git("merge-base", "--is-ancestor", opts.mergeSha, "HEAD");
    if (r.exitCode === 0) {
      mergeVerified = true;
      steps.push({
        stage: "verify-merge",
        ok: true,
        detail: `${opts.mergeSha.slice(0, 7)} is an ancestor of HEAD`,
      });
    } else if (r.exitCode === 1) {
      throw new FinalizeAbort(
        "verify-merge",
        `commit ${opts.mergeSha} is NOT an ancestor of HEAD after the pull — the merge did not land on this branch. Nothing was written. Re-check \`gh pr view <n> --json state,mergeCommit\`; finalize would otherwise force-delete a branch whose commits are nowhere else.`,
      );
    } else {
      mergeVerified = null;
      steps.push({
        stage: "verify-merge",
        ok: true,
        skipped: true,
        detail: `could not verify ${opts.mergeSha.slice(0, 7)} is merged (${fail(r)}) — continuing, but the branch delete is suppressed`,
      });
    }
  }

  // ---- stage 2: mark-done ------------------------------------------------
  // The write boundary. Everything above aborts; everything below reports.
  let paths: string[];
  let todoSynced = false;
  {
    const run =
      opts.markDone ??
      (() => {
        throw new FinalizeAbort(
          "mark-done",
          "no markDone implementation supplied (the CLI wires the real one)",
        );
      });
    const res = run();
    paths = stageablePaths(res.paths);
    todoSynced = res.todoSynced;
    const dropped = res.paths.length - paths.length;
    steps.push({
      stage: "mark-done",
      ok: true,
      detail:
        `flipped ${paths.length} path(s)` +
        (res.todoSynced ? ", todo.md synced" : "") +
        (dropped > 0 ? `; dropped ${dropped} out-of-repo path(s)` : ""),
    });
  }

  // ---- stage 3: commit ---------------------------------------------------
  // `git add -- <paths>`, never `git add -A` / `git add .`. This is the
  // structural half of E1: the pathspecs are a value returned by the
  // previous stage, so there is nothing for a caller to improvise.
  let committed = false;
  if (paths.length === 0) {
    steps.push({
      stage: "commit",
      ok: true,
      skipped: true,
      detail: "mark-done reported no paths to stage",
    });
  } else {
    const add = git("add", "--", ...paths);
    if (add.exitCode !== 0) {
      steps.push({ stage: "commit", ok: false, detail: `git add failed: ${fail(add)}` });
    } else {
      const c = git(
        "-c",
        "commit.gpgsign=false",
        "-c",
        "tag.gpgsign=false",
        "commit",
        "-m",
        `chore: mark ${hash} done after PR #${opts.pr} merge`,
        "--",
        ...paths,
      );
      if (c.exitCode !== 0) {
        // "nothing to commit" is a success shape, not a failure: a re-run
        // after a partial tail finds the flips already committed.
        const out = `${c.stdout}\n${c.stderr}`;
        if (/nothing to commit|no changes added/i.test(out)) {
          steps.push({
            stage: "commit",
            ok: true,
            skipped: true,
            detail: "already committed",
          });
          committed = true;
        } else {
          steps.push({ stage: "commit", ok: false, detail: `git commit failed: ${fail(c)}` });
        }
      } else {
        committed = true;
        steps.push({ stage: "commit", ok: true, detail: `committed ${paths.length} path(s)` });
      }
    }
  }

  // ---- stage 4: push -----------------------------------------------------
  // The 9f24c7 class lives here: an overnight run committed three times and
  // died on the push, leaving the work invisible on origin with no branch to
  // find it by. Bounded rebase-retry on a race-shaped rejection only —
  // isRejectedPush deliberately does not match "failed to push some refs",
  // which git prints for hook and policy refusals too.
  if (!committed) {
    steps.push({
      stage: "push",
      ok: true,
      skipped: true,
      detail: "nothing committed to push",
    });
  } else {
    let pushed = false;
    let detail = "";
    for (let attempt = 0; attempt <= FINALIZE_PUSH_MAX_RETRIES; attempt++) {
      const p = git("push");
      if (p.exitCode === 0) {
        pushed = true;
        detail = attempt === 0 ? "pushed" : `pushed after ${attempt} rebase-retr${attempt === 1 ? "y" : "ies"}`;
        break;
      }
      detail = fail(p);
      if (!isRejectedPush(p.stderr) || attempt === FINALIZE_PUSH_MAX_RETRIES) break;
      const rb = git("pull", "--rebase");
      if (rb.exitCode !== 0) {
        // A conflicted rebase leaves the tree mid-operation; abort so the
        // repo is left in a state a human can reason about, and stop
        // retrying (the next push would fail identically).
        git("rebase", "--abort");
        detail = `push rejected and the rebase-retry conflicted: ${fail(rb)}`;
        break;
      }
    }
    steps.push({ stage: "push", ok: pushed, detail });
  }

  // ---- stage 5: worktree + branch ----------------------------------------
  {
    const worktree = join(repoRoot, ".worktrees", `${opts.type}-${hash}`);
    // deriveBranch (pln101), NOT a hand-rolled `feat/<type>-<hash>`. On a
    // split-branch project the real branch is `<integration>/feat/…`, and a
    // hardcoded name makes `git branch -D` fail with "not found" — which the
    // already-gone matcher below would report as a clean success while the
    // real branch survived. That is the exact cross-epic regression class
    // deriveBranch exists to kill; re-deriving it by hand here would have
    // reintroduced it in a new place.
    const branch = opts.branch ?? deriveBranch(opts.config, opts.type, hash);
    const details: string[] = [];
    let ok = true;
    let worktreeGone = true;
    if (!exists(worktree)) {
      // The DIRECTORY is gone, but git's admin entry under `.git/worktrees/`
      // may not be — a hand `rm -rf` leaves it, and it then fails both the
      // next `worktree add` for that path AND the `branch -D` below with
      // "used by worktree at …". `prune` is the command an operator actually
      // needs here, and it is a no-op when there is nothing stale.
      const pruned = git("worktree", "prune");
      details.push(
        pruned.exitCode === 0
          ? "worktree directory already gone; pruned any stale registration"
          : `worktree directory already gone; \`git worktree prune\` failed: ${fail(pruned)}`,
      );
    } else {
      // NOT --force. A worktree with uncommitted changes at this point holds
      // work that is NOT in the PR that just merged, and destroying it is the
      // dead-owner mistake db36af's field data records: the two dead-owner
      // claims found on 2026-08-12 needed OPPOSITE actions, and the
      // discriminator was worktree contents, not liveness. Refusing here
      // leaves the judgment with the human, which is where it belongs.
      const r = git("worktree", "remove", worktree);
      if (r.exitCode !== 0) {
        ok = false;
        worktreeGone = false;
        details.push(
          `git worktree remove failed: ${fail(r)} — if it reports modified or untracked files, that content is NOT in PR #${opts.pr}; inspect it before forcing`,
        );
      } else {
        details.push("worktree removed");
      }
    }
    // Only attempt the branch delete once the worktree is gone: git refuses
    // to delete a branch a worktree has checked out, and reporting that as a
    // second independent failure would double-count one cause. And never
    // when the merge could not be verified — `-D` is a force-delete, and an
    // unverified merge is exactly when it destroys the only copy.
    if (worktreeGone && mergeVerified === null) {
      details.push(
        `branch ${branch} left in place — the merge could not be verified, and \`git branch -D\` is a force-delete; confirm the PR merged, then delete it by hand`,
      );
    } else if (worktreeGone) {
      const b = git("branch", "-D", branch);
      if (b.exitCode === 0) {
        details.push(`deleted ${branch}`);
      } else if (/not found/i.test(`${b.stderr}${b.stdout}`)) {
        details.push(`${branch} already gone`);
      } else {
        ok = false;
        details.push(
          `git branch -D ${branch} failed: ${fail(b)} — left in place it either fails the next claim of ${hash} at \`worktree add -b\` or gets silently adopted by it`,
        );
      }
    }
    steps.push({ stage: "worktree", ok, detail: details.join("; ") });
  }

  // ---- stage 6: release the spec lock ------------------------------------
  // E3. Guarded, and under the backlog lock — releaseSpecLockGuarded's own
  // contract says the read→compare→unlink is the R7 TOCTOU without it. The
  // guard is what makes this safe to run at all: if a human cleared our lock
  // and a peer re-claimed the hash in the interval, the lock on disk is the
  // PEER's and must survive our release.
  //
  // Runs AFTER the worktree stage, deliberately (see the header): releasing
  // first would leave a `done`, unlocked, re-claimable spec whose worktree
  // still holds unmerged content.
  {
    const lockPath = specLockPath(repoRoot, hash);
    const lock: BacklogLockFn =
      opts.lock ??
      (<T,>(label: string, fn: () => T): T =>
        withBacklogLock(join(repoRoot, ".devx-cache"), label, fn));
    if (opts.sessionToken === null) {
      // No token supplied. Do NOT invent one: `defaultSessionId()` re-derived
      // in this process can never match a lock written by the claim process,
      // so a guarded release would come back `not-owner` and — before this
      // check existed — get reported as "a peer re-claimed the hash". That
      // sentence described a peer that did not exist, exit stayed 0, and the
      // lock leaked forever. Which is E3, the defect this stage was added to
      // close, reported green. Fail loudly and name the real cause.
      steps.push({
        stage: "release-lock",
        ok: exists(lockPath) ? false : true,
        ...(exists(lockPath) ? {} : { skipped: true }),
        detail: exists(lockPath)
          ? `no --session-token was passed, so the guarded release cannot run — the token is the one \`devx devx-helper claim\` returned as \`sessionToken\`, and it CANNOT be re-derived here or read out of the lock (that always matches and defeats the guard). ${lockPath} is still on disk; pass the token and re-run the release, or clear it by hand.`
          : "no lock on disk",
      });
    } else {
      try {
        const res: SpecLockReleaseResult = lock("finalize-release-spec-lock", () =>
          releaseSpecLockGuarded(lockPath, opts.sessionToken as string),
        );
        if (res.released) {
          steps.push({ stage: "release-lock", ok: true, detail: `released ${lockPath}` });
        } else if (res.reason === "missing") {
          steps.push({
            stage: "release-lock",
            ok: true,
            skipped: true,
            detail: "no lock on disk",
          });
        } else if (res.reason === "not-owner") {
          // With an EXPLICIT token this really does mean someone else holds
          // it — the sentence is now true when it is printed.
          steps.push({
            stage: "release-lock",
            ok: true,
            skipped: true,
            detail: `lock is owned by '${res.owner ?? "unknown"}', not the token supplied — a peer re-claimed ${hash}; release skipped`,
          });
        } else {
          steps.push({
            stage: "release-lock",
            ok: false,
            detail: `lock body at ${lockPath} is unreadable — left in place; inspect it by hand or the next claim of ${hash} refuses forever`,
          });
        }
      } catch (e) {
        if (e instanceof BacklogLockTimeoutError) {
          steps.push({
            stage: "release-lock",
            ok: false,
            detail: `backlog lock held by pid ${e.holderPid ?? "?"} — release skipped; re-run finalize's release once the peer finishes, or delete ${lockPath} by hand`,
          });
        } else {
          steps.push({ stage: "release-lock", ok: false, detail: errMessage(e) });
        }
      }
    }
  }

  // ---- stage 7: refresh the self-hosted build ----------------------------
  // E2. `devx` on PATH resolves to THIS tree's gitignored dist/, and the
  // story's local gate refreshed its worktree's build, not this one — so
  // without this stage the next `/devx` claim runs the CLI as it was before
  // the merge. mlc106 shipped an entire scope model that `devx loop --help`
  // could not see.
  //
  // Built into `dist.next` and swapped in, rather than compiled over the
  // live `dist/` in place: a peer session invoking `devx` mid-build would
  // otherwise load a half-emitted tree. The swap is two renames, so the
  // window where `dist/` is absent is a syscall wide instead of a whole tsc
  // run. `npm run build:swap` owns that dance (scripts/swap-dist.mjs); the
  // plain `npm run build` an operator types by hand is left compiling in
  // place, because there is no peer to protect from a build you are watching.
  if (opts.rebuild === false) {
    steps.push({
      stage: "rebuild",
      ok: true,
      skipped: true,
      detail: "--no-rebuild",
    });
  } else if (!isSelfHostedCheckout(repoRoot, readFile)) {
    // A SKIP, not a failure. `skills/devx.md` ships in the npm tarball and
    // `devx init` installs this Phase 8 prose into consumer repos — without
    // this branch, every merge in every other project would run
    // `npm run build:swap`, get `Missing script`, and exit 3, telling that
    // project's agent to go finish a stage by hand that never applied to it.
    steps.push({
      stage: "rebuild",
      ok: true,
      skipped: true,
      detail:
        `${repoRoot} is not the devx source checkout (no \`build:swap\` script) — nothing to rebuild; \`devx\` on PATH is installed, not built from here`,
    });
  } else {
    const r = exec("npm", ["run", "build:swap"], { cwd: repoRoot });
    if (r.exitCode === 0) {
      steps.push({ stage: "rebuild", ok: true, detail: "dist/ refreshed from post-merge HEAD" });
    } else {
      // Warn-and-continue with an ACTIONABLE message, per the AC: the merge
      // has landed and the bookkeeping is pushed; a broken build is the next
      // person's problem, not a reason to unwind any of that.
      steps.push({
        stage: "rebuild",
        ok: false,
        detail:
          `npm run build:swap failed in ${repoRoot}: ${fail(r)} — \`devx\` on PATH still runs the PRE-merge build. ` +
          `Run \`npm run build\` in ${repoRoot} before the next claim, or that claim executes stale code.`,
      });
    }
  }

  return {
    hash,
    paths,
    steps,
    todoSynced,
    ok: steps.every((s) => s.ok),
  };
}
