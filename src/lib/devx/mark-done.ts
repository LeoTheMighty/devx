// `devx devx-helper mark-done <hash>` — merge-cleanup's mechanical host
// (sgr105 / story-graph plan Phase 5).
//
// The claim (dvx101) made the OPENING state flip mechanical; the CLOSING
// one stayed prose in `/devx` Phase 8 steps 4–7, and prose is what produced
// the `git add -A` cleanup-commit class (erratum `ba3c65b`, twice): an agent
// hand-editing DEV.md + the spec + todo.md on `main`, then staging with a
// blanket `git add` that swept a live peer's in-flight edits into its own
// commit. This helper does the four writes and RETURNS the exact pathspec
// list, so the skill has nothing left to improvise.
//
// FR-4's third regen host: after the flips land, GRAPH.md is regenerated
// here, so the cleanup commit carries a board that agrees with the DEV.md
// row inside it. E-5 (`evals/E-5_loop-freshness.ts`) goes green on the
// three-flow contract — claim, cleanup, emission — with no manual regen
// between any of them.
//
// WRITE-ONLY IN V1 (design/agent.md, recorded non-blocking question): the skill
// keeps owning `git add` + `git commit` + `git push`, symmetric with it
// owning the merge itself. Every git call this module makes is READ-ONLY and
// advisory: `rev-parse` (is this the main checkout?), `remote get-url`
// (what's the PR URL?), `check-ignore` (should the board ride along?).
//
// FAILURE POSTURE, three tiers:
//   • state mismatch (row not `[/]`, spec not `in-progress`) → throw,
//     exit 1. Nothing is written. This is the "you are marking something
//     that isn't in flight" signal and it must never be papered over.
//   • resolution failure (no spec, unreadable backlog, bad args) → throw,
//     exit 2.
//   • todo-sync / regen failure → WARN and continue. Both are derived
//     artifacts; a broken render must not undo a merge that has already
//     landed on origin. `devx graph --check` (E-2) is the backstop for the
//     board, `devx todo sync` for the todo. Same posture the claim's regen
//     hook took at sgr104.
//
// Spec: dev/dev-sgr105-2026-08-02T13:57-mark-done-phase8.md
// Design: _devx/workstreams/story-graph/design/agent.md §Architecture 4

import { randomBytes } from "node:crypto";
import { basename, join } from "node:path";

import { runTodoSync } from "../../commands/todo.js";

import {
  type BacklogLockFn,
  BacklogLockTimeoutError,
  withBacklogLock,
} from "../backlog/mutate.js";
import { type EngineConfig, engineConfigFrom } from "../engine/config.js";
import { readEngineState } from "../engine/frontmatter.js";
import { TODO_FILENAME } from "../engine/todo-truth.js";
import { resolveSpecWorkstream } from "../engine/workstream.js";
import { GRAPH_FILENAME, type RegenFn, regenerateGraph } from "../graph/regen.js";
import { PROJECT_FILENAME } from "../config-io.js";
import { isGitIgnored } from "../exec.js";
import { parseRepoSlug } from "../init-gh.js";
import { REV_PARSE_ARGS, interpretRevParse } from "../repo-root.js";
import { parseFrontmatterValue } from "../plan/validate-emit.js";
import {
  BACKLOG_BY_TYPE,
  CLAIMABLE_TYPES,
  type ClaimFs,
  type ClaimableType,
  type Exec,
  escapeRegex,
  findSpecForHash,
  formatIsoLocal,
  realExec,
  realFs,
  relativeFromRepo,
} from "./claim.js";
import { releaseSpecLockForClosedSpec, specLockPath } from "./spec-lock.js";
import { appendStatusLogLine } from "./status-log.js";

const HASH_RE = /^[a-z0-9]{3,12}$/i;
/** Git object names are 40 hex (SHA-1) or 64 (SHA-256); abbreviations run
 *  as short as 4. Bounded on BOTH ends so a caller passing a branch name or
 *  a PR title lands in the validation error rather than the DEV.md row. */
const SHA_RE = /^[0-9a-f]{4,64}$/i;
/** The merge note this appends: `PR: <url|#n> (merged <sha7>)`. Used only as
 *  the idempotence probe — see flipBacklogRowDone. */
const MERGE_NOTE_RE = /\sPR: (?:https?:\/\/\S+|#\d+) \(merged [0-9a-f]{4,64}\)/i;

/** Stages, ordered as the driver reaches them. `state` is the only one the
 *  CLI maps to exit 1 — everything else is exit 2. */
export type MarkDoneStage =
  | "validate"
  | "resolve"
  | "read"
  | "state"
  | "compose"
  | "write-tmp"
  | "rename";

export class MarkDoneError extends Error {
  readonly stage: MarkDoneStage;
  constructor(stage: MarkDoneStage, message: string) {
    super(`[${stage}] ${message}`);
    this.name = "MarkDoneError";
    this.stage = stage;
  }
}

export interface MarkDoneOpts {
  /** Project repo root (the main checkout — NOT an agent worktree; the
   *  backlog and specs this mutates live on `main`). */
  repoRoot: string;
  /** Merged devx.config.yaml. Only `engine:` is read (narrowed by
   *  `engineConfigFrom` for the board render + workstream resolution). */
  config: unknown;
  /** Merged PR number. */
  pr: number;
  /** Squash-merge commit sha (abbreviated is fine — it is re-abbreviated
   *  to 7 for the row and the log line). */
  mergeSha: string;
  /** Spec type: `dev` (default) or `debug`. Picks the spec dir and the
   *  backlog file, exactly as the claim's `--type` does. */
  type?: string;
  /** Test seam — defaults to wall clock. */
  now?: () => Date;
  /** Test seam — partial fs override (real fs for unspecified keys). */
  fs?: Partial<ClaimFs>;
  /** Test seam — replacement for the read-only `git remote get-url` probe. */
  exec?: Exec;
  /** Test seam — replaces the cross-process backlog lock. Fake-fs tests pass
   *  the identity lock `(label, fn) => fn()`. */
  lock?: BacklogLockFn;
  /** Test seam — the GRAPH.md regen hook. Defaults to `regenerateGraph`. */
  regen?: RegenFn;
  /** Test seam — the todo.md truing hook. Defaults to an in-process
   *  `runTodoSync` call. Returning `false` (or throwing) is warn-and-continue. */
  todoSync?: (planHash: string, repoRoot: string) => boolean;
}

export interface MarkDoneResult {
  hash: string;
  /** Repo-relative pathspecs the caller must stage, in fixed order:
   *  backlog, spec, [todo.md], [GRAPH.md]. Everything this call wrote and
   *  nothing else — the whole point is that the skill never has to guess
   *  (and so never reaches for `git add -A`). */
  paths: string[];
  /** Did the workstream todo.md get trued? False for workstream-less items
   *  and for a sync that failed (warn-and-continue — check stderr). */
  todoSynced: boolean;
  /** Warnings from the derived-artifact tier (todo sync, board regen).
   *  Already written to stderr; returned so callers can surface them too. */
  warnings: string[];
}

function isClaimableType(t: string): t is ClaimableType {
  return (CLAIMABLE_TYPES as readonly string[]).includes(t);
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Flip the matching `- [/] \`<type>/<type>-<hash>-…\`` backlog row to
 * `- [x]`, rewrite `Status: in-progress` → `Status: done`, and append the
 * merge suffix (`PR: <url> (merged <sha7>)`) at end of line.
 *
 * The sibling of `flipDevMdRow` (claim.ts), deliberately NOT a widening of
 * it: that function's contract is "throws unless the row is `[ ]`", and the
 * throw is what makes a double-claim safe. A shared function parameterised
 * by from/to state would have to relax that, and the two call sites would
 * then differ only by an argument — one transposition away from a claim
 * silently marking an item done.
 *
 * Throws when the row isn't in `[/]` state: that means the item was never
 * claimed, was already marked done, or the hash is wrong. All three are
 * "stop and look", not "write anyway".
 */
export function flipBacklogRowDone(
  content: string,
  hash: string,
  type: ClaimableType,
  suffix: string,
): string {
  if (!HASH_RE.test(hash)) {
    throw new MarkDoneError(
      "validate",
      `invalid hash '${hash}' (expected hex/alnum 3-12 chars)`,
    );
  }
  // Path-component boundary, same anchoring as flipDevMdRow: `mrg10` must
  // not match the `mrg101` row.
  const probeRe = new RegExp(
    `^- \\[/\\] \`${type}/${type}-${escapeRegex(hash)}-`,
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
    const anyStateRe = new RegExp(`\`${type}/${type}-${escapeRegex(hash)}-`);
    for (const line of lines) {
      if (anyStateRe.test(line)) {
        const marker = /^- \[(.)\]/.exec(line)?.[1] ?? "?";
        throw new MarkDoneError(
          "state",
          `row for hash '${hash}' is in [${marker}] state, not [/] (in-progress) — ` +
            `mark-done closes a claimed item; claim it first, or it is already done`,
        );
      }
    }
    throw new MarkDoneError(
      "state",
      `no ${BACKLOG_BY_TYPE[type]} row found for hash '${hash}'`,
    );
  }
  let line = lines[foundIdx];
  line = line.replace("- [/] ", "- [x] ");
  // Same `(?=[.\s]|$)` anchoring as the claim's flip: a bare `\b` would
  // rewrite `Status: in-progress-ish` into `Status: done-ish`.
  line = line.replace(/Status: in-progress(?=[.\s]|$)/, "Status: done");
  // Idempotence guard. The `[/]` probe above already makes a second call
  // impossible, but a hand-edited row that carries a stale merge note must
  // not end up with two of them. Anchored on the SUFFIX shape, not on the
  // bare string `PR: ` — a row whose title legitimately contains "PR:"
  // ("— Fix PR: body rendering") would otherwise silently lose its link.
  if (!MERGE_NOTE_RE.test(line)) {
    line = `${line.replace(/\s+$/, "")} ${suffix}`;
  }
  lines[foundIdx] = line;
  return lines.join("\n");
}

/**
 * Flip spec frontmatter `status: in-progress` → `status: done` and append
 * the merge status-log line.
 *
 * Throws on any other status — the spec's frontmatter is the source of
 * truth per CLAUDE.md, so a spec that doesn't say in-progress means this
 * item is not the one being closed.
 */
export function updateSpecForDone(
  content: string,
  isoTimestamp: string,
  logLine: string,
): string {
  const fmMatch = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!fmMatch) {
    throw new MarkDoneError("compose", "spec missing frontmatter block");
  }
  const fmLines = fmMatch[1].split("\n");
  let statusIdx = -1;
  for (let i = 0; i < fmLines.length; i++) {
    if (/^status:\s/.test(fmLines[i])) statusIdx = i;
  }
  if (statusIdx === -1) {
    throw new MarkDoneError("compose", "frontmatter missing `status:` line");
  }
  const current = fmLines[statusIdx].replace(/^status:\s*/, "").trim();
  if (current !== "in-progress") {
    throw new MarkDoneError(
      "state",
      `spec frontmatter says \`status: ${current}\`, not \`in-progress\` — ` +
        `mark-done closes a claimed item`,
    );
  }
  fmLines[statusIdx] = "status: done";
  const updated =
    content.slice(0, fmMatch.index) +
    `---\n${fmLines.join("\n")}\n---` +
    content.slice(fmMatch.index + fmMatch[0].length);
  return appendStatusLogLine(updated, `- ${isoTimestamp} — ${logLine}`);
}

/**
 * Build the row suffix. A GitHub remote yields the full PR URL every prior
 * row in this repo carries; anything else (no origin, GitHub Enterprise, a
 * self-hosted forge) degrades to `PR: #<n>`, which is honest rather than
 * a fabricated github.com link.
 */
export function mergeSuffix(repoSlug: string | null, pr: number, sha7: string): string {
  const ref =
    repoSlug !== null ? `https://github.com/${repoSlug}/pull/${pr}` : `#${pr}`;
  return `PR: ${ref} (merged ${sha7})`;
}

/**
 * Refuse to run from a linked worktree.
 *
 * `repoRoot` is resolved by walking up for `devx.config.yaml`, and an agent
 * worktree has its own copy — so a `mark-done` invoked from
 * `.worktrees/dev-<hash>` would flip that worktree's DEV.md and spec, on a
 * branch that Phase 8 is about to delete. The writes vanish, `main` still
 * says in-progress, and nothing errors. Phase 8's prose says "from the main
 * worktree", but prose is exactly what this helper exists to replace.
 * `debug-7e2b56` tracks the same hole in `emit-retro-story`.
 *
 * Classification is mlc101's `interpretRevParse` over the shared
 * `REV_PARSE_ARGS` probe — byte-identical to what `claimSpec` (claim.ts:582)
 * does, deliberately. A second hand-rolled `git-dir != common-dir` compare
 * would re-open the submodule / separate-git-dir misclassification that
 * module's header documents as an adversarial-review HIGH.
 *
 * Anything indeterminate — non-zero exit, unexpected shape, a non-git
 * fixture path — returns null and skips the check: a probe that cannot tell
 * must not block a legitimate merge cleanup.
 */
function linkedWorktreeRoot(exec: Exec, repoRoot: string): string | null {
  let rev;
  try {
    rev = exec("git", [...REV_PARSE_ARGS], { cwd: repoRoot });
  } catch {
    return null;
  }
  if (rev.exitCode !== 0) return null;
  const lines = rev.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  if (lines.length !== 3) return null;
  const info = interpretRevParse(lines[0], lines[1], lines[2], repoRoot);
  return info.isLinkedWorktree ? info.root : null;
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

/**
 * Run the merge-cleanup writes under the backlog lock. Synchronous — every
 * op is sync, and `withBacklogLock`'s contract requires it (a returned
 * Promise would escape the critical section).
 */
export function markDone(hash: string, opts: MarkDoneOpts): MarkDoneResult {
  if (!HASH_RE.test(hash)) {
    throw new MarkDoneError(
      "validate",
      `invalid hash '${hash}' (expected hex/alnum 3-12 chars)`,
    );
  }
  if (!Number.isInteger(opts.pr) || opts.pr <= 0) {
    throw new MarkDoneError(
      "validate",
      `invalid PR number '${opts.pr}' (expected a positive integer)`,
    );
  }
  if (!SHA_RE.test(opts.mergeSha)) {
    throw new MarkDoneError(
      "validate",
      `invalid merge sha '${opts.mergeSha}' (expected 4-64 hex chars)`,
    );
  }
  const type = opts.type ?? "dev";
  if (!isClaimableType(type)) {
    throw new MarkDoneError(
      "validate",
      `type '${type}' is not markable (expected one of: ${CLAIMABLE_TYPES.join(", ")})`,
    );
  }

  const fs: ClaimFs = { ...realFs, ...(opts.fs ?? {}) };
  const exec = opts.exec ?? realExec;
  const regen: RegenFn = opts.regen ?? regenerateGraph;
  const now = opts.now ?? (() => new Date());
  const engine: EngineConfig = engineConfigFrom(opts.config);
  const warnings: string[] = [];
  const warn = (msg: string): void => {
    warnings.push(msg);
    process.stderr.write(`devx mark-done: WARN — ${msg}\n`);
  };

  const specPath = findSpecForHash(fs, opts.repoRoot, hash, type);
  if (specPath === null) {
    throw new MarkDoneError(
      "resolve",
      `no ${type} spec found for hash '${hash}' under ${opts.repoRoot}/${type}/`,
    );
  }
  const mainRoot = linkedWorktreeRoot(exec, opts.repoRoot);
  if (mainRoot !== null) {
    throw new MarkDoneError(
      "resolve",
      `${opts.repoRoot} is a linked worktree — the backlog and specs this closes live in the canonical main checkout at ${mainRoot}, so writes here would land on a branch Phase 8 is about to delete. Re-run \`devx devx-helper mark-done\` from there.`,
    );
  }
  const backlogAbs = join(opts.repoRoot, BACKLOG_BY_TYPE[type]);
  if (!fs.exists(backlogAbs)) {
    throw new MarkDoneError(
      "resolve",
      `${BACKLOG_BY_TYPE[type]} not found at ${backlogAbs}`,
    );
  }

  const sha7 = opts.mergeSha.slice(0, 7).toLowerCase();
  // Read-only probe; a missing/unparseable remote is not a failure (see
  // mergeSuffix). Runs BEFORE the lock — it touches nothing and there is no
  // reason to hold the global mutation lock across a subprocess spawn.
  let repoSlug: string | null = null;
  try {
    const r = exec("git", ["remote", "get-url", "origin"], {
      cwd: opts.repoRoot,
    });
    if (r.exitCode === 0) repoSlug = parseRepoSlug(r.stdout.trim());
  } catch {
    // Non-git checkout / spawn failure — degrade to the `#<n>` form.
  }
  const suffix = mergeSuffix(repoSlug, opts.pr, sha7);
  const logLine = `merged via PR #${opts.pr} (squash → ${sha7})`;
  const isoTimestamp = formatIsoLocal(now());

  const backlogLock: BacklogLockFn =
    opts.lock ??
    ((label, fn) => {
      let entered = false;
      try {
        return withBacklogLock(join(opts.repoRoot, ".devx-cache"), label, () => {
          entered = true;
          return fn();
        });
      } catch (e) {
        // Same stage discipline as the claim: an acquisition failure that
        // isn't contention (locks dir EACCES/EROFS) is a resolution error —
        // nothing was mutated. fn's own errors and the timeout keep their
        // types so the CLI's exit-code branches still see them.
        if (entered || e instanceof BacklogLockTimeoutError) throw e;
        throw new MarkDoneError("resolve", errMessage(e));
      }
    });

  return backlogLock(`mark-done-${hash}`, (): MarkDoneResult => {
    // ---- Read ----
    let backlogBefore: string;
    let specBefore: string;
    try {
      backlogBefore = fs.readFile(backlogAbs);
      specBefore = fs.readFile(specPath);
    } catch (e) {
      throw new MarkDoneError("read", errMessage(e));
    }

    // ---- Compose (both flips, or neither) ----
    // MarkDoneError("state") propagates as-is: a state mismatch found while
    // composing must keep its stage so the CLI maps it to exit 1, not the
    // exit 2 that a genuine compose failure gets.
    let backlogAfter: string;
    let specAfter: string;
    try {
      backlogAfter = flipBacklogRowDone(backlogBefore, hash, type, suffix);
      specAfter = updateSpecForDone(specBefore, isoTimestamp, logLine);
    } catch (e) {
      if (e instanceof MarkDoneError) throw e;
      throw new MarkDoneError("compose", errMessage(e));
    }

    // ---- Write tmps + atomic rename batch (claim.ts's shape) ----
    const tag = `${process.pid}.${Date.now()}.${randomBytes(4).toString("hex")}`;
    const backlogTmp = `${backlogAbs}.tmp.${tag}`;
    const specTmp = `${specPath}.tmp.${tag}`;
    const tmpsWritten: string[] = [];
    try {
      fs.writeFile(backlogTmp, backlogAfter);
      tmpsWritten.push(backlogTmp);
      fs.writeFile(specTmp, specAfter);
      tmpsWritten.push(specTmp);
    } catch (e) {
      for (const t of tmpsWritten) fs.unlink(t);
      throw new MarkDoneError("write-tmp", errMessage(e));
    }

    const renamePlan: Array<{ tmp: string; dest: string; original: string }> = [
      { tmp: backlogTmp, dest: backlogAbs, original: backlogBefore },
      { tmp: specTmp, dest: specPath, original: specBefore },
    ];
    const renamesDone: Array<{ dest: string; original: string }> = [];
    try {
      for (const step of renamePlan) {
        fs.rename(step.tmp, step.dest);
        renamesDone.push({ dest: step.dest, original: step.original });
      }
    } catch (e) {
      // Put back every rename that DID land, then drop the tmps that didn't.
      for (const done of renamesDone) {
        try {
          fs.writeFile(done.dest, done.original);
        } catch {
          /* best-effort: recoverable from the git index */
        }
      }
      const renamedDests = new Set(renamesDone.map((r) => r.dest));
      for (const step of renamePlan) {
        if (!renamedDests.has(step.dest)) fs.unlink(step.tmp);
      }
      throw new MarkDoneError("rename", errMessage(e));
    }

    const paths = [
      relativeFromRepo(backlogAbs, opts.repoRoot),
      relativeFromRepo(specPath, opts.repoRoot),
    ];

    // ---- Derived artifact 1: workstream todo.md ----
    // AFTER the flips, on purpose: the truing reads the dev spec's status
    // off disk, so a sync scheduled earlier would true the phase pointer
    // against the pre-merge board.
    let todoSynced = false;
    const planHash = resolvePlanHash(fs, opts.repoRoot, engine, specAfter);
    if (planHash.hash !== null) {
      try {
        const sync = opts.todoSync ?? defaultTodoSync;
        todoSynced = sync(planHash.hash, opts.repoRoot);
        if (!todoSynced) {
          warn(
            `todo.md not synced for workstream plan '${planHash.hash}' — run \`devx todo sync ${planHash.hash}\``,
          );
        }
      } catch (e) {
        warn(
          `todo.md sync threw for plan '${planHash.hash}' (${errMessage(e)}) — run \`devx todo sync ${planHash.hash}\``,
        );
      }
      if (planHash.workstreamRel !== null) {
        const todoAbs = join(opts.repoRoot, planHash.workstreamRel, TODO_FILENAME);
        // Stage it whenever it exists, not only when the sync reported a
        // change: `git add` of an unchanged file is a no-op, whereas
        // omitting a file the sync DID rewrite leaves it uncommitted on
        // `main` for the next session to trip over.
        if (fs.exists(todoAbs)) {
          paths.push(relativeFromRepo(todoAbs, opts.repoRoot));
        }
      }
    }

    // ---- Derived artifact 2: GRAPH.md (FR-4's third host) ----
    // Warn-and-continue, same as the claim's hook: a cycle in the board
    // must not undo a merge that already landed on origin.
    const graphPath = join(opts.repoRoot, GRAPH_FILENAME);
    let regenResult;
    try {
      regenResult = regen(fs, opts.repoRoot, engine);
    } catch (e) {
      // The `regen` seam is public and only the DEFAULT carries the
      // never-throws guarantee; an injected one escaping here would skip
      // the return entirely, so contain it.
      regenResult = {
        ok: false as const,
        warning: `${GRAPH_FILENAME} not regenerated: the regen hook threw (${errMessage(e)})`,
      };
    }
    if (regenResult.ok) {
      // A project gitignoring its generated board is an ordinary choice, and
      // `git add` refuses an ignored path for the WHOLE pathspec list — so
      // returning GRAPH.md there would make the caller's step-5 commit fail
      // over a file it doesn't need. Same warn-and-continue posture the claim
      // takes on its own best-effort `git add` of the board (claim.ts:1065).
      const relGraph = relativeFromRepo(graphPath, opts.repoRoot);
      if (isGitIgnored(exec, opts.repoRoot, relGraph)) {
        warn(
          `${relGraph} was regenerated but is gitignored — it is not in the returned pathspecs, so the cleanup commit ships without the board; drop the ignore rule (or commit it with \`git add -f\`) if the board is meant to be tracked`,
        );
      } else {
        paths.push(relGraph);
      }
    } else {
      warn(regenResult.warning);
    }

    // ---- Source fix (db36af): release the lock the claim acquired ----
    //
    // Symmetry with `claim`, which acquires it in the OPENING flip. Until
    // this landed, nothing released a `done` spec's lock: reaping fires only
    // on a contending claim for the same hash, which never comes once the
    // item is `[x]`. 14 of them accumulated on disk by 2026-08-12, the
    // oldest 16 days old — and the leak was not historical debris from a
    // buggier era: lock #15 was created and orphaned by a clean, green,
    // correctly-executed run inside the very session that documented why
    // #1–14 existed.
    //
    // `releaseSpecLockForClosedSpec` is LIVENESS-GATED, not unguarded — read
    // its docstring before changing this call. A token-guarded release is
    // not available here (the lock records the CLAIM process's token and
    // this is a different process, so a re-derived one can never match — the
    // b931a1 finding), but an unconditional unlink is not safe either: the
    // first cut of this call deleted a live peer's lock when a row had been
    // reset and re-claimed, and `test/devx-finalize.test.ts`'s peer-reclaim
    // case caught it. A `live` holder is left alone; dead/recycled/
    // unparseable — the shapes that actually accumulated — are released.
    //
    // Warn-and-continue, like every other derived-artifact step: the merge
    // has already landed on origin, and a lock that survives is `devx
    // doctor`'s stale-lock finding, not a reason to unwind a merge.
    try {
      const released = releaseSpecLockForClosedSpec(specLockPath(opts.repoRoot, hash));
      if (!released.released && released.reason === "unreadable") {
        warn(
          `spec lock .devx-cache/locks/spec-${hash}.lock could not be removed — it is left on disk; \`devx doctor --fix\` sweeps this class, or delete it by hand`,
        );
      }
    } catch (e) {
      warn(`spec lock release for ${hash} failed: ${errMessage(e)}`);
    }

    return { hash, paths, todoSynced, warnings };
  });
}

/** Default todo hook: the real `devx todo sync <plan-hash>`, in-process —
 *  the command's driver is a plain function taking its seams as options, so
 *  this is a call, not a CLI re-entry. */
function defaultTodoSync(planHash: string, repoRoot: string): boolean {
  // Swallow the command's own stdout/stderr: mark-done owns this process's
  // stdout (exactly-one-JSON-object contract) and reports failures through
  // its own WARN channel.
  const code = runTodoSync([planHash], {
    out: () => {},
    err: () => {},
    projectPath: join(repoRoot, PROJECT_FILENAME),
  });
  return code === 0;
}

/**
 * Which workstream plan spec, if any, owns this dev spec — and therefore
 * whose todo.md needs truing.
 *
 * Membership resolution is `resolveSpecWorkstream` (the same walk `devx
 * next` and the loop's `--workstream` scoping use — mlc106 extracted it so
 * the three can't disagree). It hands back a `planHash` only when the spec
 * reached its workstream through a `plan/plan-<hash>-…` reference, so when
 * membership came via a workstream PATH the hash is recovered from the
 * claiming plan spec's filename.
 */
function resolvePlanHash(
  fs: ClaimFs,
  repoRoot: string,
  engine: EngineConfig,
  specContent: string,
): { hash: string | null; workstreamRel: string | null } {
  let membership;
  try {
    membership = resolveSpecWorkstream(
      fs,
      repoRoot,
      engine,
      specContent,
      parseFrontmatterValue,
    );
  } catch {
    return { hash: null, workstreamRel: null };
  }
  if (membership.workstreamRel === null) {
    return { hash: null, workstreamRel: null };
  }
  if (membership.planHash !== null) {
    return { hash: membership.planHash, workstreamRel: membership.workstreamRel };
  }
  // Path-resolved membership: find the plan spec claiming this dir and take
  // its hash off the filename (the `plan-<hash>-<ts>-<slug>.md` convention
  // `findSpecForHash` relies on in the other direction).
  const planDir = join(repoRoot, "plan");
  if (!fs.exists(planDir)) {
    return { hash: null, workstreamRel: membership.workstreamRel };
  }
  for (const name of [...fs.readdir(planDir)].sort()) {
    if (!name.endsWith(".md")) continue;
    try {
      const state = readEngineState(fs.readFile(join(planDir, name)));
      if (state.workstream !== membership.workstreamRel) continue;
    } catch {
      continue;
    }
    const m = /^plan-([a-z0-9]{3,12})-/.exec(basename(name));
    if (m) return { hash: m[1], workstreamRel: membership.workstreamRel };
  }
  return { hash: null, workstreamRel: membership.workstreamRel };
}
