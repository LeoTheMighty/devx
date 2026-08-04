// Pure helpers + atomic-or-rollback driver for the per-spec claim operation
// invoked by `/devx` Phase 1 (dvx101). Closes the LEARN.md cross-epic
// regression where every Phase 0 story experienced the same "claim commit
// unpushed → main diverges → pull --ff-only fails post-merge" cycle (see
// memory/feedback_devx_push_claim_before_pr.md).
//
// Surface:
//
//   claimSpec(hash, opts)
//     Drives all six steps in fixed order — lock → DEV.md flip → spec
//     frontmatter + status log → claim commit → push → worktree create.
//     Returns {branch, lockPath, claimSha}. Test seams (fs, exec, now,
//     repoRoot) make the whole thing exercisable without real disk/git.
//
//   flipDevMdRow / updateSpecForClaim
//     Pure splicers, exported so the unit tests can hammer them
//     directly without standing up a fake repo.
//
// Rollback contract (party-mode locked decision, epic-devx-skill.md):
//   • Lock acquire fails (`exit 1` lock-already-held). No state mutated.
//   • Steps 2/3 fail (DEV.md/spec composition + tmp-rename). The .tmp
//     files are unlinked; no real file changed. Lock released. Throws
//     ClaimError (exit 2).
//   • Step 3.5 (sgr104) regenerates GRAPH.md after the rename batch so the
//     claim commit ships a board that agrees with the row it just flipped.
//     A regen failure WARNs and the claim continues (a derived file never
//     aborts a state flip); so does a `git add` that refuses the board, and
//     an unreadable pre-claim copy skips the regen outright so there is
//     nothing un-rollback-able. A failure in any LATER step rolls GRAPH.md
//     back by restoring the pre-claim bytes — or unlinking it, when this
//     claim's regen is what created it. On a race-shaped push rejection the
//     board leaves the commit before the rebase (its repo-wide summary line
//     conflicts with every peer's), so contention never costs the claim.
//   • Step 4 fails (commit). Working-tree edits are reverted via
//     `git checkout -- DEV.md <spec>` (+ the GRAPH.md restore-or-unlink).
//     Lock released. Throws (exit 2).
//   • Step 5 fails (push). Race-shaped rejections (non-fast-forward — a
//     peer pushed first) first rebase-retry in place, ≤2 rounds (mlc104);
//     still-lost rolls back and throws ClaimContendedError (exit 1 —
//     retryable contention, not a broken claim). Non-race push failures
//     roll back as before: local commit reverted via
//     `git reset --soft HEAD~1` + restore of ONLY the claim's two files
//     (never `--hard` — that would wipe unrelated user WIP repo-wide;
//     v2l101 review HIGH finding). Lock released. Throws (exit 2).
//   • Step 6 fails (worktree). Per locked decision: claim is real (commit
//     pushed), so we DO NOT silently revert. Lock released so a follow-up
//     /devx can manually create the worktree. Throws (exit 2).
//
// Spec: dev/dev-dvx101-2026-04-28T19:30-devx-claim-atomic.md
// Epic: _bmad-output/planning-artifacts/epic-devx-skill.md

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative as pathRelative } from "node:path";

import {
  type DeriveBranchConfig,
  deriveBranch,
} from "../plan/derive-branch.js";
import {
  type BacklogLockFn,
  BacklogLockTimeoutError,
  withBacklogLock,
} from "../backlog/mutate.js";
import { engineConfigFrom } from "../engine/config.js";
import {
  GRAPH_FILENAME,
  type RegenFn,
  regenerateGraph,
} from "../graph/regen.js";
import { REV_PARSE_ARGS, interpretRevParse } from "../repo-root.js";
import {
  SpecLockHeldError,
  acquireSpecLock,
  composeSpecLockBody,
} from "./spec-lock.js";
import { VerifyClaimError, parseSpecClaimFields } from "./verify-claim.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type Exec = (
  cmd: string,
  args: string[],
  opts?: { cwd?: string },
) => ExecResult;

/**
 * fs seam — sync ops because every consumer (claimSpec, the CLI passthrough)
 * is itself sync-ish. Async wouldn't buy us anything; spawnSync is sync.
 *
 * `openExclusive` is the load-bearing primitive: it MUST throw if the path
 * already exists (O_CREAT | O_EXCL). The default impl uses Node's `wx` flag
 * which maps to that exact pair. Tests inject a fake whose first call
 * succeeds and second throws — that's the synthetic race the party-mode
 * locked decision calls for.
 */
export interface ClaimFs {
  /** Atomic O_EXCL create. Throws if path exists. */
  openExclusive(path: string, contents: string): void;
  readFile(path: string): string;
  writeFile(path: string, contents: string): void;
  rename(oldPath: string, newPath: string): void;
  exists(path: string): boolean;
  mkdirRecursive(path: string): void;
  unlink(path: string): void;
  readdir(path: string): string[];
}

export const realFs: ClaimFs = {
  openExclusive: (path, contents) => {
    // Node's `wx` flag === O_CREAT | O_EXCL. The open throws EEXIST
    // synchronously if the file already exists — that's the contract
    // claimSpec relies on for the lock semantics.
    const fd = openSync(path, "wx");
    let createdFile = true;
    try {
      writeFileSync(fd, contents, "utf8");
    } catch (e) {
      // Adversarial-review-surfaced edge: if writeFileSync throws after the
      // O_EXCL create succeeded (ENOSPC mid-write, signal interrupt, …) the
      // empty/partial file remains on disk and poisons every future claim
      // with LockHeldError. Unlink before re-throwing so the lock is not
      // leaked. closeSync still runs in finally.
      try {
        unlinkSync(path);
        createdFile = false;
      } catch {
        // Best-effort — re-throw the original error either way.
      }
      throw e;
    } finally {
      closeSync(fd);
      // Defensive belt-and-suspenders: if we re-threw above the unlink path
      // already ran; this branch is a no-op.
      void createdFile;
    }
  },
  readFile: (p) => readFileSync(p, "utf8"),
  writeFile: (p, c) => writeFileSync(p, c, "utf8"),
  rename: (a, b) => renameSync(a, b),
  exists: (p) => existsSync(p),
  mkdirRecursive: (p) => mkdirSync(p, { recursive: true }),
  unlink: (p) => {
    try {
      unlinkSync(p);
    } catch (e) {
      // ENOENT is fine — caller might unlink twice (idempotent). Anything
      // else (EACCES, EBUSY, EPERM) means the file is on disk but we
      // couldn't remove it — surface to stderr so the operator sees the
      // lock leak. Without this, every future /devx invocation sees
      // LockHeldError forever and there's no signal pointing at the
      // failed unlink.
      const code = (e as { code?: string } | null)?.code;
      if (code !== "ENOENT") {
        process.stderr.write(
          `devx claim: failed to unlink '${p}' (${code ?? "unknown"}): ${
            e instanceof Error ? e.message : String(e)
          }\n`,
        );
      }
    }
  },
  readdir: (p) => readdirSync(p),
};

const realExec: Exec = (cmd, args, opts) => {
  // GIT_TERMINAL_PROMPT=0 (mlc102 review BH-MED-3): the claim's push now
  // runs INSIDE the global backlog lock — a credential prompt hanging the
  // push would wedge every concurrent loop's mutations behind a live,
  // unreapable holder. Failing the push fast (and rolling the claim back)
  // is strictly better than an interactive hang inside the critical
  // section. The loop driver already injected this via its exec seam;
  // this closes the direct-CLI path.
  // LC_ALL=C (mlc104 review EC-1): isRejectedPush classifies the push
  // stderr by matching git's English rejection strings ("[rejected]",
  // "fetch first", "non-fast-forward"). A localized git would emit
  // translated messages, silently turning every real race into
  // ClaimError('git-push') — counted by the driver's systemic budget. Pin
  // the message locale for every claim git call.
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    cwd: opts?.cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
  });
  if (r.error || r.status === null) {
    const detail = r.error ? r.error.message : "spawn returned null status";
    return { stdout: r.stdout ?? "", stderr: detail, exitCode: 127 };
  }
  return {
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    exitCode: r.status,
  };
};

export interface ClaimSpecOpts {
  /** Required: identifies who/what claimed (lands in `owner:` + status log). */
  sessionId: string;
  /** Project repo root. Defaults to the directory of devx.config.yaml. */
  repoRoot: string;
  /** Pre-loaded config — used for deriveBranch + git.default_branch lookup,
   *  and (sgr104) narrowed by `engineConfigFrom` for the GRAPH.md regen.
   *
   *  `engine` is named explicitly even though `engineConfigFrom` takes
   *  `unknown`: without it the type invites callers to pass a hand-built
   *  `{git: {...}}` that compiles clean and silently renders the board with
   *  ENGINE_DEFAULTS. On a project with a non-default
   *  `engine.workstreams_root` that means the claim's board groups by epic
   *  while `devx graph`'s groups by workstream — `devx graph --check` red on
   *  a clean tree, with nothing to point at. Pass the whole merged blob. */
  config: DeriveBranchConfig & {
    git?: { default_branch?: string };
    engine?: unknown;
  };
  /** Test seam — defaults to wall-clock; tests inject a fixed Date. */
  now?: () => Date;
  /** Test seam — partial fs override (real fs for unspecified keys). */
  fs?: Partial<ClaimFs>;
  /** Test seam — replacement for the real `git` shell-out. */
  exec?: Exec;
  /** Spec type (default "dev"). v2d101 extends the claim primitive to
   *  debug/* specs (DEBUG.md row flip, `.worktrees/debug-<hash>` stem);
   *  any other type throws ClaimError("validate"). */
  type?: string;
  /** Test seam — replaces the cross-process backlog lock (mlc102) around
   *  the claim transaction. Fake-fs unit tests pass the identity lock
   *  `(label, fn) => fn()` (their `/repo` root has no real `.devx-cache`
   *  to lock in); production callers leave it unset. */
  lock?: BacklogLockFn;
  /** Test seam — the GRAPH.md regen hook (sgr104). Defaults to the real
   *  `regenerateGraph`, whose write is a real-disk `writeAtomic`; fake-fs
   *  tests inject one that writes through their fake (and one that fails,
   *  to pin the warn-and-continue posture). */
  regen?: RegenFn;
}

export interface ClaimSpecResult {
  /** The claim's branch. Normally the derived
   *  `<branch_prefix><type>-<hash>`; in mss102 attach mode it is the branch
   *  the spec's `branch:` frontmatter handed off, which the claim did NOT
   *  create — consumers that dispose of the branch must account for that
   *  (see `debug/debug-b41f7c-…-attach-branch-loop-hazards.md`). */
  branch: string;
  /** Absolute path to the `.devx-cache/locks/spec-<hash>.lock` sentinel. */
  lockPath: string;
  /** SHA of the `chore: claim <hash> for /devx` commit on `main`. */
  claimSha: string;
}

/**
 * Thrown when the spec lock at `.devx-cache/locks/spec-<hash>.lock` is
 * already held by another /devx invocation. Caller (CLI passthrough) maps
 * this to exit 1 — distinct from exit 2 (rollback).
 */
export class LockHeldError extends Error {
  readonly lockPath: string;
  constructor(lockPath: string) {
    super(`spec lock already held: ${lockPath}`);
    this.name = "LockHeldError";
    this.lockPath = lockPath;
  }
}

/**
 * Thrown for any non-lock failure — composition error, commit failure,
 * push failure, worktree-create failure. Caller (CLI passthrough) maps
 * this to exit 2 ("rollback" — the surface the spec specifies; the body
 * tells the operator what landed).
 */
export class ClaimError extends Error {
  readonly stage: string;
  constructor(stage: string, message: string) {
    super(`claim failed at stage '${stage}': ${message}`);
    this.name = "ClaimError";
    this.stage = stage;
  }
}

/**
 * Thrown when the claim push lost the race to origin and stayed lost after
 * the bounded rebase-retries (mlc104). Deliberately NOT a ClaimError
 * subclass: contention is a healthy-peers signal, not a broken-claim
 * signal — the loop driver masks the hash and picks the next item without
 * touching its consecutive-claim-failures budget, and the CLI maps it to
 * the retryable exit 1 (like a held lock), not the rollback exit 2. The
 * rollback HAS run by the time this throws — nothing durable was left.
 */
export class ClaimContendedError extends Error {
  readonly hash: string;
  readonly retries: number;
  constructor(hash: string, retries: number, message: string) {
    super(
      `claim contended for ${hash}: push lost to origin after ${retries} rebase-retr${retries === 1 ? "y" : "ies"}: ${message}`,
    );
    this.name = "ClaimContendedError";
    this.hash = hash;
    this.retries = retries;
  }
}

/** Bounded rebase-retries inside the locked claim section (design
 *  §Architecture 3): initial push + up to 2 pull-rebase-repush rounds. */
export const CLAIM_PUSH_MAX_RETRIES = 2;

/**
 * Does this push stderr describe a LOST RACE (peer advanced the remote ref
 * between our last fetch and our push) rather than a broken push (auth,
 * network, missing remote, hook policy)? Only race-shaped rejections earn a
 * rebase-retry; everything else keeps the pre-mlc104 ClaimError('git-push')
 * path so the driver's systemic-failure budget still sees genuinely broken
 * claims.
 *
 * Deliberately NOT matched (review BH-1): "failed to push some refs" — git
 * prints that trailer on EVERY refused push, including pre-push/pre-receive
 * hook rejections and "[remote rejected]" policy refusals, which are not
 * races and would route persistent refusals around the driver's
 * systemic-failure budget while walking the whole backlog. Also not
 * matched: "cannot lock ref" — a remote's STALE ref-lock file is
 * persistent, not a race, and a genuine concurrent-lock blip failing three
 * consecutive claims (the systemic threshold) is implausible. The race
 * markers are the specific non-fast-forward strings only: "[rejected]"
 * (bracket contents exact, so "[remote rejected]" does not match),
 * "fetch first", "non-fast-forward".
 */
export function isRejectedPush(stderr: string): boolean {
  return /\[rejected\]|non-fast-forward|fetch first/i.test(stderr);
}

const HASH_RE = /^[a-z0-9]{3,12}$/i;

/**
 * Claimable spec types (v2d101): `/devx` executes DEV.md dev items and
 * DEBUG.md debug items through the same claim primitive. The type picks
 * the spec dir (`dev/` vs `debug/`), the backlog file whose row gets
 * flipped (DEV.md vs DEBUG.md), and the worktree stem
 * (`.worktrees/<type>-<hash>`). Other spec types stay unclaimable — plan
 * specs are consumed by the planning stages, not the execute arm.
 */
export const CLAIMABLE_TYPES = ["dev", "debug"] as const;
export type ClaimableType = (typeof CLAIMABLE_TYPES)[number];

const BACKLOG_BY_TYPE: Record<ClaimableType, string> = {
  dev: "DEV.md",
  debug: "DEBUG.md",
};

function isClaimableType(t: string): t is ClaimableType {
  return (CLAIMABLE_TYPES as readonly string[]).includes(t);
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Flip the matching `- [ ] \`<type>/<type>-<hash>-…\`` row in the backlog
 * file (DEV.md for dev, DEBUG.md for debug) from `[ ]` → `[/]` and
 * `Status: ready` → `Status: in-progress`. Throws if the row isn't found
 * in `[ ]` state — that's the signal that another agent has already
 * claimed (or the row was never created).
 *
 * Textual splice rather than markdown-AST roundtrip: every backlog entry
 * in the repo follows the canonical `- [<state>] \`dev/...\`` shape, and
 * an AST roundtrip would reformat the rest of the file (loses intentional
 * blank-line separators between epic sections).
 */
export function flipDevMdRow(
  content: string,
  hash: string,
  type: ClaimableType = "dev",
): string {
  if (!HASH_RE.test(hash)) {
    throw new Error(
      `flipDevMdRow: invalid hash '${hash}' (expected hex/alnum 3-12 chars)`,
    );
  }
  // Anchor on path-component boundary (`<type>-${hash}-`) so a hash that's
  // a prefix of another (e.g. `mrg10` vs `mrg101`) doesn't match the wrong
  // row. Existing rows always look like `\`<type>/<type>-<hash>-<ts>` where
  // the char after the hash is always `-` followed by the timestamp.
  const probeRe = new RegExp(
    `^- \\[ \\] \`${type}/${type}-${escapeRegex(hash)}-`,
  );
  const lines = content.split("\n");
  let foundIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (probeRe.test(lines[i])) {
      foundIdx = i;
      break;
    }
  }
  if (foundIdx === -1) {
    // Distinct messages for "ready row not found" vs "row exists in another
    // state" — saves one debug round-trip. We probe for any-state row to
    // produce the more informative error.
    const anyStateRe = new RegExp(
      `\`${type}/${type}-${escapeRegex(hash)}-`,
    );
    for (const line of lines) {
      if (anyStateRe.test(line)) {
        throw new Error(
          `flipDevMdRow: row for hash '${hash}' exists but is not in [ ] (ready) state — already claimed?`,
        );
      }
    }
    throw new Error(
      `flipDevMdRow: no ${BACKLOG_BY_TYPE[type]} row found for hash '${hash}'`,
    );
  }
  let line = lines[foundIdx];
  line = line.replace("- [ ] ", "- [/] ");
  // Anchor the `ready` replacement on a `.` or end-of-line right after.
  // `\b` is NOT enough — `\b` matches between word and non-word chars, so
  // `Status: ready-for-dev` would be incorrectly rewritten to
  // `Status: in-progress-for-dev` (the `-` is a non-word char). The
  // lookahead pins us to the canonical shape every existing row uses:
  // `Status: ready.` (period + space).
  line = line.replace(/Status: ready(?=[.\s]|$)/, "Status: in-progress");
  lines[foundIdx] = line;
  return lines.join("\n");
}

/**
 * Update spec frontmatter + append a status-log line. Mutates:
 *   - `status: ready` → `status: in-progress`
 *   - `owner:` line: insert (after status:) or replace if present
 *   - status log: append `- <iso> — claimed by /devx in session /devx-<sid>`
 *
 * Throws if the spec lacks frontmatter or `status:`. Idempotent on owner —
 * a re-claim by the same session is a no-op shape change (status already
 * in-progress, owner unchanged), but we DO append another status-log line
 * (history is append-only — see CLAUDE.md "Working agreements").
 */
export function updateSpecForClaim(
  content: string,
  sessionId: string,
  isoTimestamp: string,
): string {
  const fmMatch = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!fmMatch) {
    throw new Error("updateSpecForClaim: spec missing frontmatter block");
  }
  const fmBlock = fmMatch[1];
  const fmLines = fmBlock.split("\n");
  let statusIdx = -1;
  let ownerIdx = -1;
  for (let i = 0; i < fmLines.length; i++) {
    if (/^status:\s/.test(fmLines[i])) statusIdx = i;
    if (/^owner:\s/.test(fmLines[i])) ownerIdx = i;
  }
  if (statusIdx === -1) {
    throw new Error("updateSpecForClaim: frontmatter missing `status:` line");
  }
  fmLines[statusIdx] = "status: in-progress";
  const ownerLine = `owner: /devx-${sessionId}`;
  if (ownerIdx === -1) {
    fmLines.splice(statusIdx + 1, 0, ownerLine);
  } else {
    fmLines[ownerIdx] = ownerLine;
  }
  const newFm = fmLines.join("\n");
  const before = content.slice(0, fmMatch.index);
  const after = content.slice(fmMatch.index + fmMatch[0].length);
  let updated = `${before}---\n${newFm}\n---${after}`;

  const logLine = `- ${isoTimestamp} — claimed by /devx in session /devx-${sessionId}`;
  // Status log lives in `## Status log` section. Find the section bounds
  // (next `## ` heading or EOF) and append at the end of the body —
  // preserving any trailing newlines outside the section.
  const slMatch = /^## Status log\s*\n/m.exec(updated);
  if (!slMatch) {
    // No section yet — append a fresh one at EOF. Spec authors should
    // always include this section per CLAUDE.md, but defend anyway.
    const tail = updated.endsWith("\n") ? "" : "\n";
    updated = `${updated}${tail}\n## Status log\n\n${logLine}\n`;
    return updated;
  }
  const slStart = slMatch.index + slMatch[0].length;
  // Find next `## ` heading after the status-log heading (could be EOF).
  // `m` flag makes `^` match line starts.
  let slEnd = updated.length;
  const restAfterHeading = updated.slice(slStart);
  const nextHeading = /^## /m.exec(restAfterHeading);
  if (nextHeading) {
    slEnd = slStart + nextHeading.index;
  }
  // Strip trailing whitespace inside the section, append, restore the
  // single newline that separates it from the next section (if any).
  const sectionBody = updated.slice(slStart, slEnd).replace(/\s+$/, "");
  const trailer = slEnd < updated.length ? "\n\n" : "\n";
  const newSection = `${sectionBody}\n${logLine}${trailer}`;
  return updated.slice(0, slStart) + newSection + updated.slice(slEnd);
}

/**
 * Locate a spec file by hash under <repoRoot>/<type>/. Returns absolute
 * path or null. Mirrors merge-gate.ts's resolver — same shape, same
 * boundary. `type` defaults to "dev" so every pre-v2d101 caller keeps its
 * behavior byte-identical.
 */
export function findSpecForHash(
  fs: ClaimFs,
  repoRoot: string,
  hash: string,
  type: string = "dev",
): string | null {
  const dir = join(repoRoot, type);
  if (!fs.exists(dir)) return null;
  for (const name of fs.readdir(dir)) {
    if (name.startsWith(`${type}-${hash}-`) && name.endsWith(".md")) {
      return join(dir, name);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

/**
 * Run the six-step claim. Step ordering is fixed; rollback is per-stage
 * per the file-header table.
 *
 * Returns Promise to match the public contract from
 * `dev/dev-dvx101-...-devx-claim-atomic.md` AC #1. Internally synchronous
 * (every fs op is sync; spawnSync is sync) — the Promise wrap is purely
 * forward-compatibility for any future async I/O.
 */
export async function claimSpec(
  hash: string,
  opts: ClaimSpecOpts,
): Promise<ClaimSpecResult> {
  if (!HASH_RE.test(hash)) {
    throw new ClaimError(
      "validate",
      `invalid hash '${hash}' (expected hex/alnum 3-12 chars)`,
    );
  }
  if (!opts.sessionId || opts.sessionId.trim() === "") {
    throw new ClaimError("validate", "sessionId must be non-empty");
  }
  if (!opts.repoRoot) {
    throw new ClaimError("validate", "repoRoot is required");
  }

  const fs: ClaimFs = { ...realFs, ...(opts.fs ?? {}) };
  const exec = opts.exec ?? realExec;
  const regen: RegenFn = opts.regen ?? regenerateGraph;
  const now = (opts.now ?? (() => new Date()))();
  const type = opts.type ?? "dev";
  if (!isClaimableType(type)) {
    throw new ClaimError(
      "validate",
      `unclaimable spec type '${type}' (expected one of: ${CLAIMABLE_TYPES.join(", ")})`,
    );
  }
  const backlogName = BACKLOG_BY_TYPE[type];
  const isoTimestamp = formatIsoLocal(now);

  // Canonical-root assertion (mlc101, defense in depth for R1): a claim
  // driven with a linked worktree as repoRoot would flip DEV.md and take
  // locks in a forked `.devx-cache` universe. Probe via the exec seam so
  // fake-exec tests decide their own answer; anything indeterminate
  // (non-zero exit, unexpected shape — e.g. a non-git fixture path) skips
  // the check rather than blocking legitimate claims.
  const rev = exec("git", [...REV_PARSE_ARGS], { cwd: opts.repoRoot });
  if (rev.exitCode === 0) {
    const revLines = rev.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "");
    if (revLines.length === 3) {
      const rootInfo = interpretRevParse(
        revLines[0],
        revLines[1],
        revLines[2],
        opts.repoRoot,
      );
      if (rootInfo.isLinkedWorktree) {
        throw new ClaimError(
          "validate",
          `repoRoot ${opts.repoRoot} is a linked worktree — claims must run against the canonical main checkout at ${rootInfo.root}`,
        );
      }
    }
  }

  const derivedBranch = deriveBranch(opts.config, type, hash);
  // Push target vs worktree base — the two are the same on single-branch
  // projects (this repo) and DIFFER on split-branch:
  //
  //   - pushTarget: where DEV.md lives. CLAUDE.md "Backlog files live on
  //     `main` in the main worktree" — so the claim commit (which edits
  //     DEV.md + the spec frontmatter) ALWAYS lands on default_branch,
  //     even when integration_branch is set. Closes
  //     feedback_devx_push_claim_before_pr.md by pushing to origin/main.
  //   - worktreeBase: what the feature branch forks off. The skill body
  //     prose at .claude/commands/devx.md says
  //     `BASE=${git.integration_branch:-${git.default_branch:-main}}` —
  //     develop for split-branch, main for single. The PR opens against
  //     this base, so the worktree must fork from the same place.
  //
  // Conflating them was the adversarial-review-surfaced bug: claim was
  // pushed to default_branch (correct) but the worktree was also based
  // on default_branch (wrong on split-branch — would have produced a
  // feature branch from main even though develop is the integration
  // target).
  const pushTarget =
    opts.config.git?.default_branch && opts.config.git.default_branch.trim()
      ? opts.config.git.default_branch.trim()
      : "main";
  const integrationBranch =
    typeof opts.config.git?.integration_branch === "string" &&
    opts.config.git.integration_branch.trim() !== ""
      ? opts.config.git.integration_branch.trim()
      : null;
  const worktreeBase = integrationBranch ?? pushTarget;

  const lockPath = join(
    opts.repoRoot,
    ".devx-cache",
    "locks",
    `spec-${hash}.lock`,
  );
  const devMdAbs = join(opts.repoRoot, backlogName);
  const specPath = findSpecForHash(fs, opts.repoRoot, hash, type);
  if (!specPath) {
    throw new ClaimError(
      "resolve",
      `no spec file found at ${join(opts.repoRoot, type)}/${type}-${hash}-*.md`,
    );
  }
  if (!fs.exists(devMdAbs)) {
    throw new ClaimError("resolve", `${backlogName} not found at ${devMdAbs}`);
  }

  // mss102: claim branch inheritance. A branch-handoff follow-up (devx
  // split) records its PARENT's WIP branch in `branch:` frontmatter; the
  // claim attaches the worktree to that branch (no `-b`, no base) so the
  // handed-off work is claimable cold by any session.
  //
  // Scope is deliberately narrower than "spec carries `branch:`": every
  // plan-emitted spec records its own DERIVED name in advance (enforced by
  // validate-emit), so treating "recorded branch exists" as attach-worthy
  // would silently adopt debris — a leftover branch from a crashed loop
  // run or a closed-not-merged PR — where pre-mss102 the claim failed
  // loudly at `worktree add -b`. Inheritance is therefore keyed on the
  // recorded branch DIFFERING from the derived one, which is true only for
  // a genuine handoff. Ordinary claims keep their pre-mss102 behavior
  // byte-for-byte and never pay a probe. This narrows AC 2's literal
  // wording; the decision is INTERVIEW Q#14.
  let recordedBranch: string | null = null;
  try {
    recordedBranch = parseSpecClaimFields(fs.readFile(specPath)).branch;
  } catch (e) {
    // Malformed frontmatter is pre-mss102 territory: the claim proceeds on
    // the derive path and fails loudly at compose, as it always did. A real
    // read failure must NOT degrade into a silently-wrong base — a
    // handoff follow-up would re-implement from main with the parent's
    // pushed WIP stranded (review EC-3).
    if (!(e instanceof VerifyClaimError)) {
      throw new ClaimError(
        "resolve",
        `could not read ${specPath} to resolve branch inheritance: ${errMessage(e)}`,
      );
    }
  }
  // Note: on the cold-session path this fetches one ref and creates the
  // local branch — repo mutations that happen BEFORE the claim transaction
  // and are therefore not covered by its rollback. Both are idempotent and
  // inert (a tracking-ref update plus a branch pointing exactly at it), so
  // a claim that fails afterwards leaves nothing to undo; the next attempt
  // simply hits the local probe instead of re-fetching.
  const inheritance = resolveInheritedBranch({
    exec,
    repoRoot: opts.repoRoot,
    recorded: recordedBranch,
    derivedBranch,
    reserved: [pushTarget, integrationBranch],
  });
  for (const w of inheritance.warnings) {
    process.stderr.write(`devx claim: WARN — ${w}\n`);
  }
  const attachBranch = inheritance.branch;
  const branch = attachBranch ?? derivedBranch;

  // Attach cannot work while the branch is checked out elsewhere — git
  // refuses `worktree add` on a branch another worktree holds. In the
  // flagship handoff shape the PARENT's worktree is exactly that holder
  // (the loop's split sequence never removes it), so this is the common
  // case, not the exotic one. Fail HERE, before the claim transaction
  // mutates anything, with the removal command the operator actually
  // needs — pre-fix this surfaced as a post-push wedge whose suggested
  // rerun could never succeed (review EC-1).
  if (attachBranch !== null) {
    const holder = worktreeHolding(exec, opts.repoRoot, attachBranch);
    if (holder !== null) {
      throw new ClaimError(
        "validate",
        `spec ${hash} inherits branch '${attachBranch}', but that branch is checked out in the worktree at ${holder} — ` +
          `remove it first (\`git worktree remove ${holder}\`), then re-run the claim`,
      );
    }
  }

  // mlc102: the whole claim transaction — spec lock, backlog + spec flips,
  // claim commit, push, worktree add — is one cross-process critical
  // section under the backlog mutation lock (design §Architecture 2).
  // Without it, a peer's DEV.md write between our read and our rename is
  // silently reverted (R3), and a reader can observe the flipped DEV.md
  // before the spec flip lands (R4). The lock anchors at
  // <repoRoot>/.devx-cache — the same universe the spec lock uses.
  const backlogLock: BacklogLockFn =
    opts.lock ??
    ((label, fn) => {
      // Stage classification (review BH-LOW-5): an acquisition failure that
      // isn't contention (locks dir EACCES/EROFS) maps to the ClaimError
      // stage contract like every other pre-transaction failure — nothing
      // was mutated. fn's own errors (entered) and the timeout keep their
      // types: LockHeldError/ClaimError propagate to the CLI's existing
      // branches; BacklogLockTimeoutError gets its own exit-1 mapping.
      let entered = false;
      try {
        return withBacklogLock(join(opts.repoRoot, ".devx-cache"), label, () => {
          entered = true;
          return fn();
        });
      } catch (e) {
        if (entered || e instanceof BacklogLockTimeoutError) throw e;
        throw new ClaimError("backlog-lock", errMessage(e));
      }
    });

  return backlogLock(`claim-${hash}`, (): ClaimSpecResult => {
    // ---- Step 1: lock ----
    // mkdir is wrapped in try/catch separately so a permission failure
    // doesn't get reported as "lock held" — distinct exit code semantics.
    try {
      fs.mkdirRecursive(dirname(lockPath));
    } catch (e) {
      throw new ClaimError(
        "lock",
        `mkdir ${dirname(lockPath)} failed: ${errMessage(e)}`,
      );
    }
    // mlc103: JSON v1 body with liveness metadata; on EEXIST the acquire
    // classifies the holder (shared mgr106 posture) and reaps dead/
    // recycled/unparseable owners with one retry — all inside this backlog
    // lock hold, so the classify→unlink→reopen sequence can't race a peer
    // (R8/R12). Live holders (and every can't-determine case) stay held.
    //
    // allowReap = row readiness (review BH-F1): interactive claims are
    // written by the short-lived `devx devx-helper claim` process, so a
    // HEALTHY interactive claim's recorded pid is dead within seconds —
    // pid liveness is not claim liveness. A reapable-classified lock is
    // only reaped when the backlog row is actually claimable (`[ ]`); a
    // duplicate claim against an in-progress row refuses exactly like
    // pre-mlc103, while dead debris on a genuinely ready row (crashed
    // session whose row was reset — the G-3 spec-494590 shape) reaps on
    // first contact. Residual (documented): an operator who resets an
    // in-progress row to ready while its interactive session still works
    // re-opens the item to a second claim — backlog-state surgery has
    // always meant that.
    const lockBody = composeSpecLockBody({
      session: opts.sessionId,
      claimedAt: isoTimestamp,
    });
    try {
      acquireSpecLock(lockPath, lockBody, {
        fs,
        warn: (msg) => process.stderr.write(`devx claim: ${msg}\n`),
        allowReap: () => {
          try {
            flipDevMdRow(fs.readFile(devMdAbs), hash, type);
            return true;
          } catch {
            return false;
          }
        },
      });
    } catch (e) {
      // Held (live or unverifiable holder) is the spec-defined exit-1 path.
      // Anything else (EACCES, ENOSPC, …) is a system-level failure → exit 2.
      if (e instanceof SpecLockHeldError) {
        throw new LockHeldError(lockPath);
      }
      throw new ClaimError("lock", `openExclusive failed: ${errMessage(e)}`);
    }

    // From here on, releaseLock() must run on every error path.
    // Unguarded on purpose: this rollback runs in the SAME backlog-lock
    // hold that just created the lock, so no peer can have re-claimed —
    // the guarded release's ownership re-check would be a tautology here.
    const releaseLock = () => fs.unlink(lockPath);

    // ---- Step 2 + 3: compose updated DEV.md + spec ----
    let devMdAfter: string;
    let specAfter: string;
    try {
      const devMdBefore = fs.readFile(devMdAbs);
      devMdAfter = flipDevMdRow(devMdBefore, hash, type);
      const specBefore = fs.readFile(specPath);
      specAfter = updateSpecForClaim(specBefore, opts.sessionId, isoTimestamp);
    } catch (e) {
      releaseLock();
      throw new ClaimError("compose", errMessage(e));
    }

    // ---- Write to .tmp + atomic rename. Same shape as supervisor-internal's
    //      writeAtomic + emit-retro-story's renamePlan: write all tmps first,
    //      then rename in fixed order. If a rename fails mid-batch, undo prior
    //      renames by writing back the original content.
    //
    // Tag includes 8 hex chars of randomness so two claimSpec calls in the
    // same ms (rapid test loop, future ManageAgent parallelism) don't write
    // to the same tmp path. emit-retro-story.ts uses the same shape; the
    // missing randomness here was a regression vs that module (Phase 2+
    // parallelism would have hit it).
    const tag = `${process.pid}.${Date.now()}.${randomBytes(4).toString("hex")}`;
    const devMdTmp = `${devMdAbs}.tmp.${tag}`;
    const specTmp = `${specPath}.tmp.${tag}`;
    const tmpsWritten: string[] = [];
    try {
      fs.writeFile(devMdTmp, devMdAfter);
      tmpsWritten.push(devMdTmp);
      fs.writeFile(specTmp, specAfter);
      tmpsWritten.push(specTmp);
    } catch (e) {
      for (const t of tmpsWritten) fs.unlink(t);
      releaseLock();
      throw new ClaimError("write-tmp", errMessage(e));
    }

    // Capture pre-rename content so we can restore on later failures.
    let devMdOriginal: string | null = null;
    let specOriginal: string | null = null;
    try {
      devMdOriginal = fs.readFile(devMdAbs);
      specOriginal = fs.readFile(specPath);
    } catch (e) {
      for (const t of tmpsWritten) fs.unlink(t);
      releaseLock();
      throw new ClaimError("read-pre-rename", errMessage(e));
    }

    // Map each rename's destination to its original content so the recovery
    // loop is generic — restoring N files at once instead of hardcoding the
    // pair. Future-proofs against reordering or adding a 3rd file.
    const renamePlan: Array<{ tmp: string; dest: string; original: string }> = [
      { tmp: devMdTmp, dest: devMdAbs, original: devMdOriginal },
      { tmp: specTmp, dest: specPath, original: specOriginal },
    ];
    const renamesDone: Array<{ dest: string; original: string }> = [];
    try {
      for (const step of renamePlan) {
        fs.rename(step.tmp, step.dest);
        renamesDone.push({ dest: step.dest, original: step.original });
      }
    } catch (e) {
      // Restore every rename that DID land — generic over N artifacts so a
      // reorder or addition (e.g. a future PLAN.md edit in the same claim)
      // doesn't silently skip a restore.
      for (const done of renamesDone) {
        try {
          fs.writeFile(done.dest, done.original);
        } catch {
          /* best-effort: operator can recover from git index */
        }
      }
      // Unlink any tmps that haven't been renamed (renamed tmps no longer
      // exist; the destination file holds the content).
      const renamedDests = new Set(renamesDone.map((r) => r.dest));
      for (const step of renamePlan) {
        if (!renamedDests.has(step.dest)) fs.unlink(step.tmp);
      }
      releaseLock();
      throw new ClaimError("rename", errMessage(e));
    }

    // Repo-relative pathspecs for every git call below. Declared here rather
    // than at Step 4 because the regen's rollback needs to sit next to the
    // other two artifacts' rollback.
    const relativeDevMd = relativeFromRepo(devMdAbs, opts.repoRoot);
    const relativeSpec = relativeFromRepo(specPath, opts.repoRoot);

    // ---- Step 3.5: regenerate GRAPH.md (sgr104 T4.2) ----
    // AFTER the rename batch, on purpose: renamePlan's contents are composed
    // from in-memory strings, so a disk-reading regen scheduled before it
    // would render the PRE-flip board and ship a GRAPH.md that disagrees
    // with the DEV.md row in the same commit.
    //
    // Warn-and-continue: a broken render never aborts a state flip (plan
    // Phase 4 §Context). `devx graph --check` (E-2) is the backstop.
    //
    // NB the board is rendered from the WORKING TREE, so uncommitted spec
    // edits in the main checkout are baked into the commit this claim
    // pushes. That is the same contract `devx graph` has always had (it too
    // renders what is on disk), and rendering the index instead would make
    // the hook disagree with the operator's own CLI — but it does mean an
    // overnight claim taken while the user has a half-written spec open
    // ships a board naming it. Accepted; `devx graph` re-run after the WIP
    // lands corrects it.
    const graphPath = join(opts.repoRoot, GRAPH_FILENAME);
    const relativeGraph = relativeFromRepo(graphPath, opts.repoRoot);
    // What rollback must put back: the pre-claim bytes, or `absent` when
    // this claim's regen is what created the file (rollback = unlink).
    let graphRestore: "absent" | { body: string } = "absent";
    // An unreadable pre-image means we could not roll back what we are about
    // to overwrite, so we do not overwrite it: skipping the regen keeps the
    // "a rolled-back claim leaves NO trace" contract intact. Rendering
    // anyway and warning at rollback time (the shape this replaced) left a
    // board asserting a claim that never happened, one WARN deep in the log.
    let graphReadable = true;
    try {
      if (fs.exists(graphPath)) {
        graphRestore = { body: fs.readFile(graphPath) };
      }
    } catch (e) {
      graphReadable = false;
      process.stderr.write(
        `devx claim: WARN — ${graphPath} is unreadable (${errMessage(e)}); skipping the regen so the claim stays rollback-clean — run \`devx graph\` once the file is readable\n`,
      );
    }
    // The `regen` seam is public (ClaimSpecOpts.regen), and only the DEFAULT
    // implementation carries the never-throws guarantee — the type can't
    // enforce it on an injected one. An escape here would skip both
    // releaseLock() and revertWorkingTree(), leaking the spec lock with
    // DEV.md already flipped, so the contract is enforced structurally.
    let regenResult: ReturnType<RegenFn> = {
      ok: false,
      warning: `${GRAPH_FILENAME} not regenerated: pre-claim copy unreadable`,
    };
    if (graphReadable) {
      try {
        regenResult = regen(fs, opts.repoRoot, engineConfigFrom(opts.config));
      } catch (e) {
        regenResult = {
          ok: false,
          warning: `${GRAPH_FILENAME} not regenerated: the regen hook threw (${errMessage(e)})`,
        };
      }
      if (!regenResult.ok) {
        process.stderr.write(`devx claim: WARN — ${regenResult.warning}\n`);
      }
    }
    // Did THIS claim write the board? Gates every rollback. Cleared once the
    // board has been put back by hand (see the contention drop below), so a
    // later rollback doesn't undo the restore a second time.
    let graphWritten = regenResult.ok;
    // Is the board part of the commit? A separate flag from `graphWritten`
    // because `git add` can refuse a path the regen wrote perfectly well
    // (a project that gitignores its generated board) — the claim survives
    // that; only the pathspec changes.
    let graphInCommit = false;
    // Restore-or-unlink (the derived file's rollback differs from the
    // authored artifacts': it may legitimately not have existed before this
    // claim, in which case "restore" means removing the orphan).
    const revertGraph = () => {
      if (!graphWritten) return;
      try {
        if (graphRestore === "absent") fs.unlink(graphPath);
        else fs.writeFile(graphPath, graphRestore.body);
      } catch (e) {
        process.stderr.write(
          `devx claim: WARN — failed to roll back ${graphPath}: ${errMessage(e)}; ` +
            `it may be stale — run \`devx graph\` to refresh it\n`,
        );
      }
    };
    /** Every git pathspec below, in fixed order. */
    const claimPaths = (): string[] =>
      graphInCommit
        ? [relativeDevMd, relativeSpec, relativeGraph]
        : [relativeDevMd, relativeSpec];

    // From here, the working tree has the claim edits but they are NOT
    // committed yet. A failure must restore the originals to the working
    // tree (the .tmp files have already been renamed away — there's no
    // .tmp left to recover from). If revert itself fails we surface a
    // WARN so the operator knows the working tree is dirty; without the
    // log they'd see only the original failure and miss the dirty index.
    const revertWorkingTree = () => {
      try {
        fs.writeFile(devMdAbs, devMdOriginal);
      } catch (e) {
        process.stderr.write(
          `devx claim: WARN — failed to restore ${devMdAbs} after rollback: ${errMessage(e)}; ` +
            `working tree is dirty, recover via \`git checkout -- ${relativeFromRepo(devMdAbs, opts.repoRoot)}\`\n`,
        );
      }
      try {
        fs.writeFile(specPath, specOriginal);
      } catch (e) {
        process.stderr.write(
          `devx claim: WARN — failed to restore ${specPath} after rollback: ${errMessage(e)}; ` +
            `working tree is dirty, recover via \`git checkout -- ${relativeFromRepo(specPath, opts.repoRoot)}\`\n`,
        );
      }
      revertGraph();
    };

    // ---- Step 4: claim commit on the base branch ----
    // We deliberately do NOT touch the lock file — it lives under
    // .devx-cache/ which is in .gitignore. Same applies for any other
    // .tmp.* files that may linger. `git add` is scoped to the claim's
    // explicit paths to avoid `git add -A` footguns (CLAUDE.md working
    // agreement: "git add <specific files>; never `git add -A`").
    const commitMessage = `chore: claim ${hash} for /devx`;
    // The two AUTHORED artifacts. Their staging failing is a real claim
    // failure. `git add` stages what it can before reporting a non-zero exit,
    // so un-stage before rolling back the working tree — otherwise the index
    // keeps a `[/]` flip whose working-tree copy says `ready`, and the next
    // bare `git commit` in this checkout sweeps a phantom claim to origin.
    const addResult = exec(
      "git",
      ["add", "--", relativeDevMd, relativeSpec],
      { cwd: opts.repoRoot },
    );
    if (addResult.exitCode !== 0) {
      exec("git", ["restore", "--staged", "--", relativeDevMd, relativeSpec], {
        cwd: opts.repoRoot,
      });
      revertWorkingTree();
      releaseLock();
      throw new ClaimError(
        "git-add",
        `git add failed (exit ${addResult.exitCode}): ${addResult.stderr.trim()}`,
      );
    }
    // The DERIVED board, staged separately and best-effort. `git add` refuses
    // an ignored path (exit 1) — and a project gitignoring its generated
    // board is an ordinary choice — so bundling GRAPH.md into the pathspec
    // above would make every claim in such a repo fail permanently over a
    // file the claim doesn't need. Warn-and-continue, same posture as the
    // regen itself: the board simply doesn't ride along this time.
    if (graphWritten) {
      const addGraph = exec("git", ["add", "--", relativeGraph], {
        cwd: opts.repoRoot,
      });
      if (addGraph.exitCode === 0) {
        graphInCommit = true;
      } else {
        process.stderr.write(
          `devx claim: WARN — git add ${relativeGraph} failed (exit ${addGraph.exitCode}): ${addGraph.stderr.trim()}; ` +
            `the claim commit ships without the board — run \`devx graph\` and commit it separately\n`,
        );
      }
    }
    // Pathspec-limited commit (v2l101 BH-MED-5 follow-through): a bare
    // `git commit -m` commits the ENTIRE staged index — anything the user
    // left staged in the main worktree (an overnight `devx loop` claims
    // while they sleep) would be silently swept into the claim commit and
    // pushed to origin. With the trailing pathspec, only the two claim
    // files are committed regardless of index state.
    const commitResult = exec(
      "git",
      ["commit", "-m", commitMessage, "--", ...claimPaths()],
      { cwd: opts.repoRoot },
    );
    if (commitResult.exitCode !== 0) {
      // Best-effort un-stage. We don't care about the exit status — even if
      // it fails we still revertWorkingTree() and release the lock; operator
      // sees a clean(er) working tree.
      exec("git", ["restore", "--staged", "--", ...claimPaths()], {
        cwd: opts.repoRoot,
      });
      revertWorkingTree();
      releaseLock();
      throw new ClaimError(
        "git-commit",
        `git commit failed (exit ${commitResult.exitCode}): ${commitResult.stderr.trim()}`,
      );
    }

    // ---- Step 5: push to origin/<pushTarget> BEFORE returning. The whole
    //              point of dvx101 is "claim-commit pushed before any
    //              subsequent gh pr create". Once this push succeeds, the
    //              claim is durable; if it fails, we git-reset --hard back
    //              to the pre-claim state to keep local main and origin/main
    //              in sync.
    let pushResult = exec("git", ["push", "origin", pushTarget], {
      cwd: opts.repoRoot,
    });
    // mlc104 (design §Architecture 3): a race-shaped rejection (peer pushed
    // to origin/<pushTarget> since our last fetch) is CONTENTION, not a
    // broken claim — rebase our claim commit onto the peer's tip and
    // re-push, bounded at CLAIM_PUSH_MAX_RETRIES rounds. All of this runs
    // inside the same backlog-lock hold, so only cross-process/cross-machine
    // peers (the actual R2 shape) ever reach it.
    // Tracks whether a `pull --rebase` RAN to completion — from then on the
    // captured pre-claim file content is stale (HEAD may carry peer
    // commits), so the rollback below must restore the two claim files
    // from HEAD, never from the capture. (Review BH-5: set on every
    // completed pull, including a no-op one — HEAD is the authoritative
    // pre-claim content either way.)
    let pulledRebase = false;
    // A rebase that failed AFTER a race-shaped rejection (conflicted pull —
    // the peer edited the same DEV.md region) is still contention even
    // though no re-push ran.
    let rebaseFailedAfterRace = false;
    // Actual re-pushes performed — reported on ClaimContendedError (review
    // BH-3: the constant would misreport "after 2 retries" on a
    // conflicted-rebase exit where zero re-pushes ran).
    let retriesUsed = 0;
    // sgr104: the derived board leaves the claim commit the moment we know
    // we are contended, BEFORE the first rebase.
    //
    // Two reasons, both fatal to the retry if we keep it. (a) GRAPH.md
    // carries a repo-wide summary banner that EVERY status transition
    // rewrites, so our commit and any peer commit that also flipped
    // something change the same line from the same ancestor — `pull
    // --rebase` conflicts, the abort below classifies contended with ZERO
    // retries used, and mlc104's rebase-retry is silently disabled for any
    // peer that touched the board. (b) Even a clean rebase would re-push a
    // board rendered against a tip that no longer exists, publishing the
    // exact drift this hook exists to prevent.
    //
    // The plan's own rule for this file (plan.md §Phase dependencies): "On
    // rebase conflict in GRAPH.md, never merge by hand — re-run `devx
    // graph`." Dropping it here is that rule, applied structurally: the
    // contended claim lands without a board, `devx graph --check` flags the
    // staleness, and the next regen (this claim's worktree work, or any
    // later flow's hook) refreshes it.
    if (
      graphInCommit &&
      pushResult.exitCode !== 0 &&
      isRejectedPush(pushResult.stderr)
    ) {
      const soft = exec("git", ["reset", "--soft", "HEAD~1"], {
        cwd: opts.repoRoot,
      });
      if (soft.exitCode !== 0) {
        // Couldn't rewrite the commit — leave it as it is and let the rebase
        // try anyway. Worst case is the conflict this was meant to avoid,
        // which the existing abort path already handles.
        process.stderr.write(
          `devx claim: WARN — could not drop ${relativeGraph} from the contended claim commit (git reset --soft exit ${soft.exitCode}): ${soft.stderr.trim()}; ` +
            `the rebase may conflict on the board — resolve by re-running \`devx graph\`\n`,
        );
      } else {
        exec("git", ["restore", "--staged", "--", relativeGraph], {
          cwd: opts.repoRoot,
        });
        // `pull --rebase` refuses a dirty tracked file, so the board has to
        // go back to HEAD's copy (or away entirely, on a first claim that
        // minted it) before we rebase.
        const restored = exec("git", ["checkout", "HEAD", "--", relativeGraph], {
          cwd: opts.repoRoot,
        });
        if (restored.exitCode !== 0) {
          // Not at HEAD — either this claim minted it, or the operator kept
          // the board untracked. `revertGraph` distinguishes those from the
          // pre-claim capture; a bare unlink here would delete an untracked
          // board the operator was keeping.
          revertGraph();
        }
        graphInCommit = false;
        // The board is already back to its pre-claim state — a later
        // rollback must not "restore" it a second time.
        graphWritten = false;
        const recommit = exec(
          "git",
          ["commit", "-m", commitMessage, "--", relativeDevMd, relativeSpec],
          { cwd: opts.repoRoot },
        );
        if (recommit.exitCode !== 0) {
          exec(
            "git",
            ["restore", "--staged", "--", relativeDevMd, relativeSpec],
            { cwd: opts.repoRoot },
          );
          revertWorkingTree();
          releaseLock();
          throw new ClaimError(
            "git-commit",
            `re-commit without ${relativeGraph} failed (exit ${recommit.exitCode}): ${recommit.stderr.trim()}`,
          );
        }
      }
    }
    for (
      let retry = 0;
      retry < CLAIM_PUSH_MAX_RETRIES &&
      pushResult.exitCode !== 0 &&
      isRejectedPush(pushResult.stderr);
      retry++
    ) {
      const pullResult = exec(
        "git",
        ["pull", "--rebase", "origin", pushTarget],
        { cwd: opts.repoRoot },
      );
      if (pullResult.exitCode !== 0) {
        // A failed pull leaves the repo mid-rebase — abort back to the
        // pre-pull state (claim commit at HEAD) so the standard rollback
        // below applies. NB (review BH-6): user WIP on tracked files makes
        // `git rebase` refuse outright (we never autostash — WIP is
        // sacrosanct), so an overnight race over a dirty checkout takes
        // this branch and classifies contended with zero retries; the item
        // is masked for the pass and a later claim retries from scratch.
        const abortResult = exec("git", ["rebase", "--abort"], {
          cwd: opts.repoRoot,
        });
        if (abortResult.exitCode !== 0 && !/no rebase in progress/i.test(abortResult.stderr)) {
          // Review EC-6: an abort that fails with the repo genuinely
          // mid-rebase means the rollback below runs against rebase
          // machinery — surface it instead of reporting a clean-sounding
          // "contended".
          process.stderr.write(
            `devx claim: WARN — git rebase --abort failed (exit ${abortResult.exitCode}): ${abortResult.stderr.trim()}; ` +
              `the repo may be mid-rebase — inspect \`git status\` before the next claim.\n`,
          );
        }
        rebaseFailedAfterRace = true;
        break;
      }
      pulledRebase = true;
      retriesUsed++;
      pushResult = exec("git", ["push", "origin", pushTarget], {
        cwd: opts.repoRoot,
      });
    }
    if (pushResult.exitCode !== 0) {
      // Pre-push commit is local-only; reverting is safe and matches the
      // party-mode locked decision (a) "reset local DEV.md to the pre-claim
      // state via `git reset HEAD~1` if the claim commit hasn't been pushed".
      //
      // v2l101 review HIGH finding: this rollback used `reset --hard HEAD~1`,
      // which reverts the ENTIRE working tree — an overnight `devx loop`
      // claim hitting a failing push would destroy the user's uncommitted
      // WIP repo-wide. The claim only ever touched DEV.md, the spec, and
      // (sgr104) the derived GRAPH.md, so the rollback must be scoped to
      // exactly those: `--soft` moves HEAD back without touching index or
      // working tree, then the claim's files are un-staged and restored to
      // their captured pre-claim content via revertWorkingTree() — which
      // unlinks GRAPH.md instead of restoring it when this claim's regen was
      // what created it. Everything else in the tree stays untouched.
      const resetResult = exec("git", ["reset", "--soft", "HEAD~1"], {
        cwd: opts.repoRoot,
      });
      if (resetResult.exitCode !== 0) {
        // Reset itself failed — local repo is now in a stale state with the
        // claim commit still on main. Surface this to the operator instead
        // of swallowing; without the warning they'd see only "git push
        // failed" and miss that the local branch needs `git reset` by hand.
        // Do NOT revert the working tree in this branch — HEAD still carries
        // the claim commit, and rewriting the files under it would leave a
        // confusing HEAD-vs-tree mismatch on top of the failed reset.
        process.stderr.write(
          `devx claim: WARN — git push origin ${pushTarget} failed AND the rollback reset failed (exit ${resetResult.exitCode}): ${resetResult.stderr.trim()}; ` +
            `local main has the claim commit at HEAD. Run \`git reset --soft HEAD~1\` (or restore origin) by hand.\n`,
        );
      } else {
        // Un-stage the two claim files (back to the pre-claim HEAD's index
        // state), then restore their pre-claim working-tree content.
        // Best-effort on the restore-staged — even if it fails, the content
        // rewrite below is what the next claim reads.
        exec("git", ["restore", "--staged", "--", ...claimPaths()], {
          cwd: opts.repoRoot,
        });
        if (pulledRebase) {
          // A pull --rebase ran, so HEAD may carry peer commits whose
          // DEV.md/spec content the captured pre-claim copy pre-dates —
          // writing the capture back would clobber the peer's flips in the
          // working tree. Restore from HEAD explicitly (`checkout HEAD`,
          // not bare `checkout --` — the bare form copies from the INDEX,
          // which still holds our claim content if the best-effort
          // restore-staged above failed; review BH-4). Checked + WARNed
          // (review EC-4): a silent failure here leaves our un-owned `[/]`
          // flip in the working tree for the NEXT claim to commit and push.
          const checkoutResult = exec(
            "git",
            ["checkout", "HEAD", "--", relativeDevMd, relativeSpec],
            { cwd: opts.repoRoot },
          );
          if (checkoutResult.exitCode !== 0) {
            process.stderr.write(
              `devx claim: WARN — failed to restore ${relativeDevMd} + ${relativeSpec} from HEAD after the contended rollback ` +
                `(exit ${checkoutResult.exitCode}): ${checkoutResult.stderr.trim()}; ` +
                `working tree may still carry this claim's flips — recover via \`git checkout HEAD -- ${relativeDevMd} ${relativeSpec}\`\n`,
            );
          }
          // GRAPH.md is checked out SEPARATELY (sgr104): after a rebase it may
          // not exist at HEAD at all — a first-claim regen minted it, or the
          // peer's tip predates the board — and bundling it into the pathspec
          // above would fail that checkout for BOTH authored artifacts over a
          // derived file. Prefer HEAD (post-rebase truth, possibly the peer's
          // copy); fall back to the pre-claim capture when HEAD has none.
          if (graphWritten) {
            const graphCheckout = exec(
              "git",
              ["checkout", "HEAD", "--", relativeGraph],
              { cwd: opts.repoRoot },
            );
            if (graphCheckout.exitCode !== 0) revertGraph();
          }
        } else {
          revertWorkingTree();
        }
      }
      releaseLock();
      // Classification is by the FINAL failure (review BH-2): contended
      // only when the last push was itself race-shaped, or the pull-rebase
      // failed after a race-shaped rejection. A non-race terminal failure
      // (auth expiry, network death mid-retry) stays ClaimError so the
      // driver's systemic budget sees it — even if an earlier round DID
      // lose a real race.
      if (rebaseFailedAfterRace || isRejectedPush(pushResult.stderr)) {
        throw new ClaimContendedError(
          hash,
          retriesUsed,
          `git push origin ${pushTarget} (exit ${pushResult.exitCode}): ${pushResult.stderr.trim()}`,
        );
      }
      throw new ClaimError(
        "git-push",
        `git push origin ${pushTarget} failed (exit ${pushResult.exitCode}): ${pushResult.stderr.trim()}`,
      );
    }

    // ---- Capture the claim SHA (commit is now durable) ----
    const headResult = exec("git", ["rev-parse", "HEAD"], {
      cwd: opts.repoRoot,
    });
    if (headResult.exitCode !== 0) {
      // Push succeeded but rev-parse failed — implausible but defend. Don't
      // attempt to revert (the commit IS pushed); release lock so a follow-up
      // /devx can pick up.
      releaseLock();
      throw new ClaimError(
        "rev-parse",
        `git rev-parse HEAD failed (exit ${headResult.exitCode}): ${headResult.stderr.trim()}`,
      );
    }
    const claimSha = headResult.stdout.trim();

    // ---- Step 6: worktree create ----
    // Locked decision: post-push worktree-create-failure leaves the claim
    // (it's already durable on origin) and surfaces the error. The operator
    // manually retries the worktree step. Lock is released so a subsequent
    // /devx invocation can attempt the worktree by hand.
    //
    // worktreeBase ≠ pushTarget on split-branch projects: the feature branch
    // forks off integration_branch (e.g. develop), even though the claim
    // commit was pushed to default_branch. See the pushTarget/worktreeBase
    // computation above.
    const worktreePath = join(
      opts.repoRoot,
      ".worktrees",
      `${type}-${hash}`,
    );
    // Attach mode (mss102): the spec's recorded branch exists, so the
    // worktree checks it out directly — no `-b`, no base. A remote-only
    // branch resolves via git's own DWIM (creates the local tracking
    // branch from origin/<branch>).
    const worktreeArgs =
      attachBranch !== null
        ? ["worktree", "add", worktreePath, branch]
        : ["worktree", "add", worktreePath, "-b", branch, worktreeBase];
    const worktreeResult = exec("git", worktreeArgs, { cwd: opts.repoRoot });
    if (worktreeResult.exitCode !== 0) {
      releaseLock();
      throw new ClaimError(
        "worktree",
        `git worktree add failed (exit ${worktreeResult.exitCode}): ${worktreeResult.stderr.trim()} ` +
          `(claim ${claimSha} is durable on origin/${pushTarget}; rerun \`git ${worktreeArgs.join(" ")}\` by hand)`,
      );
    }

    // Lock stays held — the worktree's owner now consumes the lock. /devx
    // Phase 8 cleanup is responsible for releasing it after merge. (The
    // lock release on cleanup is dvx107's responsibility; here we only
    // ensure the file is left in place.)
    return { branch, lockPath, claimSha };
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Does a fully-qualified ref exist? `git show-ref --verify <ref>` prints
 * `<sha> <ref>` on hit. Requiring the ref in stdout (not just exit 0) keeps
 * indeterminate exec results — including test fakes that blanket-return
 * exit 0 with empty stdout — on the derive path: only positive evidence of
 * an existing branch switches the claim into attach mode.
 */
function branchRefExists(exec: Exec, repoRoot: string, ref: string): boolean {
  const r = exec("git", ["show-ref", "--verify", ref], { cwd: repoRoot });
  return r.exitCode === 0 && r.stdout.includes(ref);
}

/**
 * Path of the worktree that currently has `branch` checked out, or null.
 * `git worktree list --porcelain` emits a `branch refs/heads/<name>` line
 * under the owning worktree's `worktree <path>` line.
 */
function worktreeHolding(
  exec: Exec,
  repoRoot: string,
  branch: string,
): string | null {
  const r = exec("git", ["worktree", "list", "--porcelain"], { cwd: repoRoot });
  if (r.exitCode !== 0) return null;
  let current: string | null = null;
  for (const line of r.stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      current = line.slice("worktree ".length).trim();
    } else if (line.trim() === `branch refs/heads/${branch}`) {
      return current;
    }
  }
  return null;
}

export interface InheritedBranchResolution {
  /** Non-null → attach mode: check this branch out instead of creating one. */
  branch: string | null;
  /** Operator-facing WARNs; each is a case where a recorded branch was
   *  present but deliberately not inherited. Never silent. */
  warnings: string[];
}

/**
 * Decide whether this claim inherits the spec's recorded `branch:` (mss102).
 *
 * Inheritance requires the recorded branch to DIFFER from the derived one —
 * a plan-emitted spec records its own derived name, so "recorded == derived"
 * is the ordinary case and must keep the pre-mss102 derive path (including
 * its loud `-b`-on-existing-branch failure when debris survives). A genuine
 * branch-handoff follow-up records its parent's branch, which never matches.
 *
 * Resolution order once inheritance is in play:
 *   1. reserved (default / integration branch) → refuse + WARN. Attaching
 *      would put every agent commit straight onto the branch PRs target.
 *   2. local `refs/heads/<b>` → attach (may carry unpushed work).
 *   3. otherwise fetch that one ref from origin and attach only if the
 *      fetch SUCCEEDS — a cold session has no tracking ref yet, and a stale
 *      tracking ref for a branch deleted upstream must not qualify. The
 *      local branch is then created explicitly from the fetched ref so the
 *      subsequent `worktree add` needs no single-remote DWIM.
 *   4. nothing found → WARN + derive.
 */
export function resolveInheritedBranch(args: {
  exec: Exec;
  repoRoot: string;
  recorded: string | null;
  derivedBranch: string;
  reserved: Array<string | null>;
}): InheritedBranchResolution {
  const { exec, repoRoot, recorded, derivedBranch } = args;
  if (recorded === null || recorded === derivedBranch) {
    return { branch: null, warnings: [] };
  }
  const reserved = args.reserved.filter((r): r is string => Boolean(r));
  if (reserved.includes(recorded)) {
    return {
      branch: null,
      warnings: [
        `spec records branch '${recorded}', which is this project's default/integration branch — refusing to attach (agent commits would land on it directly); deriving '${derivedBranch}' instead`,
      ],
    };
  }
  if (branchRefExists(exec, repoRoot, `refs/heads/${recorded}`)) {
    return { branch: recorded, warnings: [] };
  }
  const fetched = exec(
    "git",
    ["fetch", "origin", `+refs/heads/${recorded}:refs/remotes/origin/${recorded}`],
    { cwd: repoRoot },
  );
  if (
    fetched.exitCode === 0 &&
    branchRefExists(exec, repoRoot, `refs/remotes/origin/${recorded}`)
  ) {
    const created = exec(
      "git",
      ["branch", recorded, `refs/remotes/origin/${recorded}`],
      { cwd: repoRoot },
    );
    if (created.exitCode !== 0) {
      return {
        branch: null,
        warnings: [
          `spec records branch '${recorded}' and it exists on origin, but creating the local branch failed (exit ${created.exitCode}): ${created.stderr.trim()} — deriving '${derivedBranch}' instead; the inherited work is NOT in this worktree`,
        ],
      };
    }
    return { branch: recorded, warnings: [] };
  }
  return {
    branch: null,
    warnings: [
      `spec records branch '${recorded}' but it exists neither locally nor on origin — deriving '${derivedBranch}' instead; if this is a handed-off follow-up, its WIP branch was never pushed and that work is NOT in this worktree`,
    ],
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function relativeFromRepo(absPath: string, repoRoot: string): string {
  // node:path.relative handles trailing slashes, normalizes ".." segments,
  // and is portable across POSIX/Windows. Manual prefix slicing would
  // double-slash on `${repoRoot}/` when repoRoot already ends with `/`.
  return pathRelative(repoRoot, absPath);
}

/**
 * ISO-with-local-offset (matches the existing spec frontmatter shape:
 * "2026-04-28T19:30:00-07:00"). Same pattern as emit-retro-story's
 * formatTimestamps — duplicated here intentionally to keep this module
 * dependency-free of plan/* (avoids a back-edge in the import graph).
 */
function formatIsoLocal(d: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const yyyy = d.getFullYear();
  const mo = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  const offMin = -d.getTimezoneOffset();
  const sign = offMin >= 0 ? "+" : "-";
  const abs = Math.abs(offMin);
  const offHH = pad(Math.floor(abs / 60));
  const offMM = pad(abs % 60);
  return `${yyyy}-${mo}-${dd}T${hh}:${mm}:${ss}${sign}${offHH}:${offMM}`;
}
