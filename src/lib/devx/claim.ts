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
//   • Step 4 fails (commit). Working-tree edits are reverted via
//     `git checkout -- DEV.md <spec>`. Lock released. Throws (exit 2).
//   • Step 5 fails (push). Local commit reverted via
//     `git reset --hard HEAD~1`. Lock released. Throws (exit 2).
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

const realFs: ClaimFs = {
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
  const r = spawnSync(cmd, args, { encoding: "utf8", cwd: opts?.cwd });
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
  /** Pre-loaded config — used for deriveBranch + git.default_branch lookup. */
  config: DeriveBranchConfig & {
    git?: { default_branch?: string };
  };
  /** Test seam — defaults to wall-clock; tests inject a fixed Date. */
  now?: () => Date;
  /** Test seam — partial fs override (real fs for unspecified keys). */
  fs?: Partial<ClaimFs>;
  /** Test seam — replacement for the real `git` shell-out. */
  exec?: Exec;
  /** Spec type (default "dev"). Phase 1 only claims dev/* specs. */
  type?: string;
}

export interface ClaimSpecResult {
  /** Derived branch — `<branch_prefix><type>-<hash>`. */
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

const HASH_RE = /^[a-z0-9]{3,12}$/i;
const SPEC_DIR = "dev";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Flip the matching `- [ ] \`dev/dev-<hash>-…\`` row in DEV.md from `[ ]`
 * → `[/]` and `Status: ready` → `Status: in-progress`. Throws if the row
 * isn't found in `[ ]` state — that's the signal that another agent has
 * already claimed (or the row was never created).
 *
 * Textual splice rather than markdown-AST roundtrip: every backlog entry
 * in the repo follows the canonical `- [<state>] \`dev/...\`` shape, and
 * an AST roundtrip would reformat the rest of the file (loses intentional
 * blank-line separators between epic sections).
 */
export function flipDevMdRow(content: string, hash: string): string {
  if (!HASH_RE.test(hash)) {
    throw new Error(
      `flipDevMdRow: invalid hash '${hash}' (expected hex/alnum 3-12 chars)`,
    );
  }
  // Anchor on path-component boundary (`dev-${hash}-`) so a hash that's a
  // prefix of another (e.g. `mrg10` vs `mrg101`) doesn't match the wrong
  // row. Existing rows always look like `\`dev/dev-<hash>-<ts>` where
  // the char after the hash is always `-` followed by the timestamp.
  const probeRe = new RegExp(
    `^- \\[ \\] \`dev/dev-${escapeRegex(hash)}-`,
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
      `\`dev/dev-${escapeRegex(hash)}-`,
    );
    for (const line of lines) {
      if (anyStateRe.test(line)) {
        throw new Error(
          `flipDevMdRow: row for hash '${hash}' exists but is not in [ ] (ready) state — already claimed?`,
        );
      }
    }
    throw new Error(
      `flipDevMdRow: no DEV.md row found for hash '${hash}'`,
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
 * Locate a spec file by hash under <repoRoot>/dev/. Returns absolute path
 * or null. Mirrors merge-gate.ts's resolver — same shape, same boundary.
 */
export function findSpecForHash(
  fs: ClaimFs,
  repoRoot: string,
  hash: string,
): string | null {
  const dir = join(repoRoot, SPEC_DIR);
  if (!fs.exists(dir)) return null;
  for (const name of fs.readdir(dir)) {
    if (name.startsWith(`dev-${hash}-`) && name.endsWith(".md")) {
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
  const now = (opts.now ?? (() => new Date()))();
  const type = opts.type ?? "dev";
  const isoTimestamp = formatIsoLocal(now);

  const branch = deriveBranch(opts.config, type, hash);
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
  const devMdAbs = join(opts.repoRoot, "DEV.md");
  const specPath = findSpecForHash(fs, opts.repoRoot, hash);
  if (!specPath) {
    throw new ClaimError(
      "resolve",
      `no spec file found at ${join(opts.repoRoot, SPEC_DIR)}/dev-${hash}-*.md`,
    );
  }
  if (!fs.exists(devMdAbs)) {
    throw new ClaimError("resolve", `DEV.md not found at ${devMdAbs}`);
  }

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
  const lockBody = `${opts.sessionId}\npid=${process.pid}\nclaimed_at=${isoTimestamp}\n`;
  try {
    fs.openExclusive(lockPath, lockBody);
  } catch (e) {
    // EEXIST is the spec-defined "lock already held" path → exit 1.
    // Anything else (EACCES, ENOSPC, …) is a system-level failure → exit 2.
    if (isEexist(e)) {
      throw new LockHeldError(lockPath);
    }
    throw new ClaimError("lock", `openExclusive failed: ${errMessage(e)}`);
  }

  // From here on, releaseLock() must run on every error path.
  const releaseLock = () => fs.unlink(lockPath);

  // ---- Step 2 + 3: compose updated DEV.md + spec ----
  let devMdAfter: string;
  let specAfter: string;
  try {
    const devMdBefore = fs.readFile(devMdAbs);
    devMdAfter = flipDevMdRow(devMdBefore, hash);
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
  };

  // ---- Step 4: claim commit on the base branch ----
  // We deliberately do NOT touch the lock file — it lives under
  // .devx-cache/ which is in .gitignore. Same applies for any other
  // .tmp.* files that may linger. `git add` is scoped to the two
  // explicit paths to avoid `git add -A` footguns (CLAUDE.md working
  // agreement: "git add <specific files>; never `git add -A`").
  const relativeDevMd = relativeFromRepo(devMdAbs, opts.repoRoot);
  const relativeSpec = relativeFromRepo(specPath, opts.repoRoot);
  const commitMessage = `chore: claim ${hash} for /devx`;
  const addResult = exec(
    "git",
    ["add", "--", relativeDevMd, relativeSpec],
    { cwd: opts.repoRoot },
  );
  if (addResult.exitCode !== 0) {
    revertWorkingTree();
    releaseLock();
    throw new ClaimError(
      "git-add",
      `git add failed (exit ${addResult.exitCode}): ${addResult.stderr.trim()}`,
    );
  }
  const commitResult = exec(
    "git",
    ["commit", "-m", commitMessage],
    { cwd: opts.repoRoot },
  );
  if (commitResult.exitCode !== 0) {
    // Best-effort un-stage. We don't care about the exit status — even if
    // it fails we still revertWorkingTree() and release the lock; operator
    // sees a clean(er) working tree.
    exec("git", ["restore", "--staged", "--", relativeDevMd, relativeSpec], {
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
  const pushResult = exec("git", ["push", "origin", pushTarget], {
    cwd: opts.repoRoot,
  });
  if (pushResult.exitCode !== 0) {
    // Pre-push commit is local-only; reverting is safe and matches the
    // party-mode locked decision (a) "reset local DEV.md to the pre-claim
    // state via `git reset HEAD~1` if the claim commit hasn't been pushed".
    // `--hard` reverts the working tree atomically — the source of truth
    // for "post-revert state". (Don't pre-call revertWorkingTree() here;
    // reset --hard supersedes it.)
    const resetResult = exec("git", ["reset", "--hard", "HEAD~1"], {
      cwd: opts.repoRoot,
    });
    if (resetResult.exitCode !== 0) {
      // Reset itself failed — local repo is now in a stale state with the
      // claim commit still on main. Surface this to the operator instead
      // of swallowing; without the warning they'd see only "git push
      // failed" and miss that the local branch needs `git reset` by hand.
      process.stderr.write(
        `devx claim: WARN — git push origin ${pushTarget} failed AND the rollback reset failed (exit ${resetResult.exitCode}): ${resetResult.stderr.trim()}; ` +
          `local main has the claim commit at HEAD. Run \`git reset --hard HEAD~1\` (or restore origin) by hand.\n`,
      );
    }
    releaseLock();
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
    `dev-${hash}`,
  );
  const worktreeResult = exec(
    "git",
    [
      "worktree",
      "add",
      worktreePath,
      "-b",
      branch,
      worktreeBase,
    ],
    { cwd: opts.repoRoot },
  );
  if (worktreeResult.exitCode !== 0) {
    releaseLock();
    throw new ClaimError(
      "worktree",
      `git worktree add failed (exit ${worktreeResult.exitCode}): ${worktreeResult.stderr.trim()} ` +
        `(claim ${claimSha} is durable on origin/${pushTarget}; rerun \`git worktree add ${worktreePath} -b ${branch} ${worktreeBase}\` by hand)`,
    );
  }

  // Lock stays held — the worktree's owner now consumes the lock. /devx
  // Phase 8 cleanup is responsible for releasing it after merge. (The
  // lock release on cleanup is dvx107's responsibility; here we only
  // ensure the file is left in place.)
  return { branch, lockPath, claimSha };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isEexist(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const code = (e as { code?: string }).code;
  return code === "EEXIST";
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
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
