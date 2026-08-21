// `devx devx-helper <subcommand>` — CLI passthrough for the `/devx` skill body.
//
// Mirrors the merge-gate (mrg102) and plan-helper (pln101/pln102/pln103)
// patterns: skill body invokes a small CLI helper, helper does the
// deterministic work (atomic claim, lock-coord, deterministic branch
// derivation), skill body uses the JSON result.
//
// Phase 1 surface:
//   • dvx101: `devx devx-helper claim <hash>`
//   • dvx105: `devx devx-helper await-remote-ci <branch> [--once]`
//   • roc101: `devx devx-helper verify-claim <hash> [--session-token <token>]`
//   • v2t101: `devx devx-helper check-hold <pr-number>` (D-5 merge-tail hold)
//   • sgr105: `devx devx-helper mark-done <hash> --pr <n> --merge-sha <sha>`
//   • b931a1: `devx devx-helper finalize <hash> --pr <n> --merge-sha <sha>`
//            — the whole Phase 8 after-merge tail: pull, mark-done, scoped
//            commit, push, guarded lock release, worktree+branch removal,
//            dist refresh.
//
// (dvx102's `should-create-story` was retired by v2x101 — the v2 engine
// implements from spec ACs directly; the canary machinery went with it.)
//
// Each subcommand is registered conditionally so the /devx skill body
// can rely on the absence/presence of a subcommand as a canary signal.
//
// Exit codes — consumed by the /devx skill body in shell-style:
//
//     LOCK_OUT=$(devx devx-helper claim "$HASH") || case $? in
//       1) echo "lock held — another /devx is on this hash"; exit 1 ;;
//       2) echo "rollback — see stderr"; exit 1 ;;
//     esac
//
//   `claim`:
//     • 0  → claim successful. JSON `{branch, lockPath, claimSha}` on stdout.
//            (mlc104: a push race lost once may have been rebase-retried to
//            success transparently — the claim commit is at origin's tip.)
//     • 1  → retryable contention, nothing mutated. Three JSON shapes on
//            stdout: `{error: "lock held", lockPath}` (spec lock),
//            `{error: "backlog lock held", lockPath, holderPid}` (mlc102),
//            `{error: "claim-contended", hash, retries}` (mlc104 — push
//            race still lost after the bounded rebase-retries; rollback
//            already ran).
//     • 2  → rollback. JSON `{error, stage}` on stdout; stderr has detail.
//     • 64 → usage error. stderr only.
//
//   `await-remote-ci`:
//     • 0  → terminal (or single-shot probe complete). JSON shape varies
//            by mode:
//              --once : ProbeState (one of no-workflow / empty /
//                       pr-conflicting / sha-mismatch / in-progress /
//                       completed).
//              else   : AwaitState (one of no-workflow / workflow-no-run /
//                       pr-conflicting / completed).
//            `pr-conflicting` (c94f14) carries `{prNumber, mergeable,
//            mergeStateStatus}` — no workflow run exists because GitHub
//            can't build the PR's merge ref. Self-serviceable: merge the
//            base branch in, resolve, push, re-probe.
//     • 2  → gh probe failure. JSON `{error, stage}` on stdout where
//            `stage ∈ {"gh-run-list","gh-parse","git-rev-parse","unknown"}`;
//            stderr has detail. Operator-actionable (auth / network /
//            parse). `"unknown"` is the catch-all for non-GhProbeError
//            throws — argument validation, unhandled internal failures.
//     • 64 → usage error. stderr only.
//
//   `check-hold` (Phase 8 merge tail, AFTER merge-gate says merge:true):
//     • 0  → no hold. JSON `{"hold": false}` on stdout. D-5: silence merges.
//     • 3  → hold requested. JSON `{"hold": true, "reason": ...}` on stdout
//            — a `devx: hold` comment or an unresolved requested-changes
//            review. Skill body leaves the PR open + notifies.
//     • 2  → gh failure. JSON `{error, stage}` on stdout; stderr has detail.
//            Uncertainty defaults to safe: the skill body does NOT merge on
//            exit 2 (same posture as merge-gate's exit 2).
//     • 64 → usage error. stderr only.
//
//   `mark-done` (Phase 8 after-merge bookkeeping, AFTER the merge verified):
//     • 0  → written. JSON `{hash, paths, todoSynced}` on stdout; `paths`
//            are the repo-relative pathspecs to stage (backlog, spec,
//            [todo.md], [GRAPH.md]). Caller owns commit + push.
//     • 1  → state mismatch (backlog row not `[/]`, or spec frontmatter not
//            `status: in-progress`) — nothing written; JSON
//            `{error: "mark-done-failed", stage: "state"}`. Also the
//            backlog-lock contention shape `{error: "backlog lock held", …}`,
//            which is retryable for the same reason it is under `claim`.
//     • 2  → resolution/write failure. JSON `{error: "mark-done-failed",
//            stage}` where `stage ∈ {"validate","resolve","read","compose",
//            "write-tmp","rename","config-load","unknown"}`.
//     • 64 → usage error. stderr only.
//
//   `verify-claim`:
//     • 0  → caller owns the claim. JSON `{hash, owned, sessionToken}` on
//            stdout.
//     • 3  → owned by another session. JSON `{error:
//            "owned-by-other-session", hash, lockOwner, currentSession}` on
//            stdout. Skill body halts without touching the worktree.
//     • 4  → drift: spec `status: in-progress` but no lock file. JSON
//            `{error: "in-progress-without-lock", hash}` on stdout. Skill
//            body files an INTERVIEW.md row + halts.
//     • 2  → everything else. JSON `{error: "<stage>", hash}` on stdout
//            where `stage ∈ {"validate","resolve","read-spec","spec-parse",
//            "read-lock","lock-unparseable","spec-not-in-progress",
//            "unknown"}`; stderr has detail.
//     • 64 → usage error. stderr only.
//
// Spec: dev/dev-dvx101-... + dev/dev-dvx105-... + dev/dev-roc101-... +
//       dev/dev-v2x101-...
// Epic: _bmad-output/planning-artifacts/epic-devx-skill.md

import { dirname } from "node:path";
import process from "node:process";

import type { Command } from "commander";

import { findProjectConfig, loadMerged } from "../lib/config-io.js";
import { attachPhase } from "../lib/help.js";
import {
  ClaimContendedError,
  ClaimError,
  type ClaimSpecOpts,
  type ClaimableType,
  LockHeldError,
  claimSpec,
} from "../lib/devx/claim.js";
import { BacklogLockTimeoutError } from "../lib/backlog/mutate.js";
import {
  type AwaitRemoteCiOpts,
  GhProbeError,
  awaitRemoteCi,
  probeRemoteCi,
} from "../lib/devx/await-remote-ci.js";
import {
  type VerifyClaimOpts,
  VerifyClaimError,
  verifyClaim,
} from "../lib/devx/verify-claim.js";
import {
  type HoldCheckOpts,
  HoldCheckError,
  checkHold,
} from "../lib/devx/hold-check.js";
import {
  MarkDoneError,
  type MarkDoneOpts,
  markDone,
} from "../lib/devx/mark-done.js";
import {
  FinalizeAbort,
  type FinalizeOpts,
  finalize,
} from "../lib/devx/finalize.js";
import type { DeriveBranchConfig } from "../lib/plan/derive-branch.js";

const HASH_RE = /^[a-z0-9]{3,12}$/i;

export interface RunClaimOpts {
  /** Test seam: route stdout off process.stdout. */
  out?: (s: string) => void;
  /** Test seam: route stderr off process.stderr. */
  err?: (s: string) => void;
  /** Test seam: explicit project config path (skip findProjectConfig walk). */
  projectPath?: string;
  /** Test seam: project repo root (defaults to dirname of resolved config). */
  repoRoot?: string;
  /** Test seam: forward through to claimSpec. */
  claimOpts?: Partial<ClaimSpecOpts>;
  /** Test seam: caller-supplied session id. Defaults to `<pid>-<isoMinute>`. */
  sessionId?: string;
}

/**
 * Drive the claim. Returns the exit code; emits exactly-one JSON object
 * on stdout and human-readable detail on stderr.
 */
export async function runClaim(
  args: string[],
  opts: RunClaimOpts = {},
): Promise<number> {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const err = opts.err ?? ((s) => process.stderr.write(s));

  // Hand-parse (mirrors runVerifyClaim) so test seams aren't dependent on
  // commander state. Accepted shapes: `<hash>` and `<hash> --type debug`
  // (flag position-independent).
  let type: string | undefined;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--type") {
      // A flag-shaped "value" means the real value was omitted — don't
      // swallow the next flag as the type.
      if (i + 1 >= args.length || args[i + 1].startsWith("--")) {
        err("devx devx-helper claim: --type requires a value\n");
        return 64;
      }
      type = args[i + 1];
      i++;
    } else if (a.startsWith("--")) {
      err(`devx devx-helper claim: unknown flag '${a}'\n`);
      return 64;
    } else {
      positional.push(a);
    }
  }
  if (positional.length !== 1) {
    err("usage: devx devx-helper claim <hash> [--type dev|debug]\n");
    return 64;
  }
  const hash = positional[0];
  if (!HASH_RE.test(hash)) {
    err(
      `devx devx-helper claim: invalid hash '${hash}' (expected hex/alnum 3-12 chars)\n`,
    );
    return 64;
  }
  if (type !== undefined && type !== "dev" && type !== "debug") {
    err(
      `devx devx-helper claim: invalid --type '${type}' (expected 'dev' or 'debug')\n`,
    );
    return 64;
  }

  const projectConfigPath = opts.projectPath ?? findProjectConfig();
  if (!projectConfigPath) {
    err(
      "devx devx-helper claim: devx.config.yaml not found (walked up from cwd)\n",
    );
    return 64;
  }
  const repoRoot = opts.repoRoot ?? dirname(projectConfigPath);

  let merged: DeriveBranchConfig & { git?: { default_branch?: string } };
  try {
    const raw = loadMerged({ projectPath: projectConfigPath });
    merged = (raw && typeof raw === "object" ? raw : {}) as typeof merged;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Keep the exit-2 → JSON-on-stdout contract intact (file header).
    // Without the JSON emission a config-load failure produced exit 2
    // with empty stdout, breaking shell-side parsers that always try
    // to JSON.parse the stdout on non-zero.
    out(`${JSON.stringify({ error: "rollback", stage: "config-load" })}\n`);
    err(`devx devx-helper claim: config load failed: ${msg}\n`);
    return 2;
  }

  const sessionId = opts.sessionId ?? defaultSessionId();

  try {
    const result = await claimSpec(hash, {
      sessionId,
      repoRoot,
      config: merged,
      ...(type !== undefined ? { type } : {}),
      ...(opts.claimOpts ?? {}),
    });
    // `sessionToken` (b931a1) is the token this claim WROTE into
    // `spec-<hash>.lock`. Emitting it is what makes the guarded release at
    // the other end of the story possible at all: the lock body records
    // `defaultSessionId()` of THIS short-lived CLI process, and Phase 8's
    // `finalize` runs in a different process minutes-to-hours later, so it
    // cannot re-derive it. Without this field the only recoverable source
    // would be the spec's `owner:` or the lock body itself — which CLAUDE.md
    // forbids precisely because a token read from the thing it is meant to
    // guard always matches and defeats the check (the E13 resume-collision
    // shape). Additive: existing consumers that destructure `branch`/
    // `lockPath`/`claimSha` are unaffected.
    out(`${JSON.stringify({ ...result, sessionToken: `/devx-${sessionId}` })}\n`);
    return 0;
  } catch (e) {
    if (e instanceof LockHeldError) {
      out(`${JSON.stringify({ error: "lock held", lockPath: e.lockPath })}\n`);
      err(`devx devx-helper claim: ${e.message}\n`);
      return 1;
    }
    if (e instanceof ClaimContendedError) {
      // mlc104: a push race lost after the bounded rebase-retries. The
      // rollback already ran (nothing durable was left), so this is the
      // retryable "someone else got there first" family — exit 1 like a
      // held lock, NOT the rollback exit 2 (the operator/loop response is
      // "pick another item or retry", not "investigate a broken claim").
      out(
        `${JSON.stringify({ error: "claim-contended", hash: e.hash, retries: e.retries })}\n`,
      );
      err(`devx devx-helper claim: ${e.message}\n`);
      return 1;
    }
    if (e instanceof BacklogLockTimeoutError) {
      // mlc102 (review BH-MED-2): a live peer holding the backlog lock past
      // the 30s deadline is the retryable "held" condition, not a rollback —
      // nothing was mutated (the timeout fires before step 1). Exit 1 like
      // the spec-lock held case; the JSON names the holder for diagnosis.
      out(
        `${JSON.stringify({ error: "backlog lock held", lockPath: e.lockPath, holderPid: e.holderPid })}\n`,
      );
      err(`devx devx-helper claim: ${e.message}\n`);
      return 1;
    }
    if (e instanceof ClaimError) {
      out(`${JSON.stringify({ error: "rollback", stage: e.stage })}\n`);
      err(`devx devx-helper claim: ${e.message}\n`);
      return 2;
    }
    const msg = e instanceof Error ? e.message : String(e);
    out(`${JSON.stringify({ error: "rollback", stage: "unknown" })}\n`);
    err(`devx devx-helper claim: unexpected error: ${msg}\n`);
    return 2;
  }
}

// ---------------------------------------------------------------------------
// session id
// ---------------------------------------------------------------------------

/**
 * Default session id when the caller doesn't override. Goal: enough to
 * be grep-able in audits (PID + minute precision). NOT a UUID — these
 * land in spec frontmatter and human readers eyeball them.
 */
function defaultSessionId(): string {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const stamp =
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `${stamp}-${process.pid}`;
}

// ---------------------------------------------------------------------------
// await-remote-ci (dvx105)
// ---------------------------------------------------------------------------

export interface RunAwaitRemoteCiOpts {
  /** Test seam: route stdout off process.stdout. */
  out?: (s: string) => void;
  /** Test seam: route stderr off process.stderr. */
  err?: (s: string) => void;
  /** Test seam: explicit project repo root (skip findProjectConfig walk). */
  repoRoot?: string;
  /** Test seam: forward through to probeRemoteCi / awaitRemoteCi. */
  awaitOpts?: Partial<AwaitRemoteCiOpts>;
}

/**
 * Drive the remote-CI probe. Returns the exit code; emits exactly-one
 * JSON object on stdout and human-readable detail on stderr.
 *
 * `--once` mode runs `probeRemoteCi` (single shot, may return transient
 * `in-progress`) — the skill body's ScheduleWakeup-driven outer loop is
 * the canonical consumer. Without `--once`, runs `awaitRemoteCi` which
 * blocks (real sleep) until terminal.
 */
export async function runAwaitRemoteCi(
  args: string[],
  opts: RunAwaitRemoteCiOpts = {},
): Promise<number> {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const err = opts.err ?? ((s) => process.stderr.write(s));

  // Hand-parse so test seams aren't dependent on commander state. Two
  // accepted shapes: `<branch>` and `<branch> --once` (or `--once <branch>`).
  let once = false;
  const positional: string[] = [];
  for (const a of args) {
    if (a === "--once") {
      once = true;
    } else if (a.startsWith("--")) {
      err(`devx devx-helper await-remote-ci: unknown flag '${a}'\n`);
      return 64;
    } else {
      positional.push(a);
    }
  }
  if (positional.length !== 1) {
    err("usage: devx devx-helper await-remote-ci <branch> [--once]\n");
    return 64;
  }
  const branch = positional[0];
  if (branch.trim() === "") {
    err("devx devx-helper await-remote-ci: branch must be non-empty\n");
    return 64;
  }

  let repoRoot: string;
  if (opts.repoRoot) {
    repoRoot = opts.repoRoot;
  } else {
    const projectConfigPath = findProjectConfig();
    if (!projectConfigPath) {
      err(
        "devx devx-helper await-remote-ci: devx.config.yaml not found (walked up from cwd)\n",
      );
      return 64;
    }
    repoRoot = dirname(projectConfigPath);
  }

  const awaitOpts: AwaitRemoteCiOpts = {
    repoRoot,
    ...(opts.awaitOpts ?? {}),
  };

  try {
    if (once) {
      const probe = await probeRemoteCi(branch, awaitOpts);
      out(`${JSON.stringify(probe)}\n`);
      return 0;
    }
    const result = await awaitRemoteCi(branch, awaitOpts);
    out(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (e) {
    if (e instanceof GhProbeError) {
      out(`${JSON.stringify({ error: "probe-failed", stage: e.stage })}\n`);
      err(`devx devx-helper await-remote-ci: ${e.message}\n`);
      return 2;
    }
    const msg = e instanceof Error ? e.message : String(e);
    out(`${JSON.stringify({ error: "probe-failed", stage: "unknown" })}\n`);
    err(`devx devx-helper await-remote-ci: unexpected error: ${msg}\n`);
    return 2;
  }
}

// ---------------------------------------------------------------------------
// verify-claim (roc101)
// ---------------------------------------------------------------------------

export interface RunVerifyClaimOpts {
  /** Test seam: route stdout off process.stdout. */
  out?: (s: string) => void;
  /** Test seam: route stderr off process.stderr. */
  err?: (s: string) => void;
  /** Test seam: explicit project repo root (skip findProjectConfig walk). */
  repoRoot?: string;
  /** Test seam: forward through to verifyClaim (fs seam). */
  verifyOpts?: Partial<VerifyClaimOpts>;
}

/**
 * Drive the resume-detection ownership check. Returns the exit code; emits
 * exactly-one JSON object on stdout and human-readable detail on stderr.
 *
 * Session token resolution: `--session-token <token>` when supplied,
 * otherwise auto-derived via `defaultSessionId()` — the SAME primitive
 * `runClaim` uses when the caller doesn't override, so a claim + verify in
 * one CLI process derive identically. A resuming skill session should pass
 * the token it claimed with (recorded in the spec's `owner:` frontmatter
 * and the lock file's first line) explicitly.
 */
export async function runVerifyClaim(
  args: string[],
  opts: RunVerifyClaimOpts = {},
): Promise<number> {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const err = opts.err ?? ((s) => process.stderr.write(s));

  // Hand-parse (mirrors runAwaitRemoteCi) so test seams aren't dependent
  // on commander state. Accepted shapes: `<hash>` and
  // `<hash> --session-token <token>` (flag position-independent).
  let sessionToken: string | undefined;
  let type: string | undefined;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--session-token") {
      // Flag-shaped "value" = the real value was omitted; don't swallow
      // the next flag as the token.
      if (i + 1 >= args.length || args[i + 1].startsWith("--")) {
        err(
          "devx devx-helper verify-claim: --session-token requires a value\n",
        );
        return 64;
      }
      sessionToken = args[i + 1];
      i++;
    } else if (a === "--type") {
      if (i + 1 >= args.length || args[i + 1].startsWith("--")) {
        err("devx devx-helper verify-claim: --type requires a value\n");
        return 64;
      }
      type = args[i + 1];
      i++;
    } else if (a.startsWith("--")) {
      err(`devx devx-helper verify-claim: unknown flag '${a}'\n`);
      return 64;
    } else {
      positional.push(a);
    }
  }
  if (positional.length !== 1) {
    err(
      "usage: devx devx-helper verify-claim <hash> [--session-token <token>] [--type dev|debug]\n",
    );
    return 64;
  }
  if (type !== undefined && type !== "dev" && type !== "debug") {
    err(
      `devx devx-helper verify-claim: invalid --type '${type}' (expected 'dev' or 'debug')\n`,
    );
    return 64;
  }
  const hash = positional[0];
  if (!HASH_RE.test(hash)) {
    err(
      `devx devx-helper verify-claim: invalid hash '${hash}' (expected hex/alnum 3-12 chars)\n`,
    );
    return 64;
  }
  if (sessionToken !== undefined && sessionToken.trim() === "") {
    err(
      "devx devx-helper verify-claim: --session-token value must be non-empty\n",
    );
    return 64;
  }

  let repoRoot: string;
  if (opts.repoRoot) {
    repoRoot = opts.repoRoot;
  } else {
    const projectConfigPath = findProjectConfig();
    if (!projectConfigPath) {
      err(
        "devx devx-helper verify-claim: devx.config.yaml not found (walked up from cwd)\n",
      );
      return 64;
    }
    repoRoot = dirname(projectConfigPath);
  }

  try {
    const result = verifyClaim(hash, {
      sessionToken: sessionToken ?? defaultSessionId(),
      repoRoot,
      ...(type !== undefined ? { type } : {}),
      ...(opts.verifyOpts ?? {}),
    });
    switch (result.status) {
      case "owned": {
        // Lock is the authoritative sentinel (the O_EXCL file claimSpec
        // created); frontmatter drift is surfaced on stderr, not fatal.
        if (result.specOwnerDrift) {
          err(
            `devx devx-helper verify-claim: WARN — spec owner '${result.specOwner}' disagrees with lock owner '${result.lockOwner}'; lock wins\n`,
          );
        }
        if (result.specStatusDrift) {
          err(
            `devx devx-helper verify-claim: WARN — lock held but spec status is not 'in-progress'; reconcile the spec frontmatter\n`,
          );
        }
        out(
          `${JSON.stringify({
            hash: result.hash,
            owned: true,
            sessionToken: result.sessionToken,
          })}\n`,
        );
        return 0;
      }
      case "owned-by-other-session": {
        out(
          `${JSON.stringify({
            error: "owned-by-other-session",
            hash: result.hash,
            lockOwner: result.lockOwner,
            currentSession: result.currentSession,
          })}\n`,
        );
        err(
          `devx devx-helper verify-claim: claim on '${hash}' is held by another session (lock owner '${result.lockOwner}', current session '${result.currentSession}') — halt without touching the worktree\n`,
        );
        return 3;
      }
      case "in-progress-without-lock": {
        out(
          `${JSON.stringify({
            error: "in-progress-without-lock",
            hash: result.hash,
          })}\n`,
        );
        err(
          `devx devx-helper verify-claim: spec '${hash}' is in-progress but no lock file exists${result.specOwner ? ` (last recorded owner: '${result.specOwner}')` : ""} — orphaned claim; file INTERVIEW.md and halt\n`,
        );
        return 4;
      }
    }
  } catch (e) {
    if (e instanceof VerifyClaimError) {
      out(`${JSON.stringify({ error: e.stage, hash })}\n`);
      err(`devx devx-helper verify-claim: ${e.message}\n`);
      return 2;
    }
    const msg = e instanceof Error ? e.message : String(e);
    out(`${JSON.stringify({ error: "unknown", hash })}\n`);
    err(`devx devx-helper verify-claim: unexpected error: ${msg}\n`);
    return 2;
  }
}

// ---------------------------------------------------------------------------
// check-hold (v2t101)
// ---------------------------------------------------------------------------

export interface RunCheckHoldOpts {
  /** Test seam: route stdout off process.stdout. */
  out?: (s: string) => void;
  /** Test seam: route stderr off process.stderr. */
  err?: (s: string) => void;
  /** Test seam: explicit project repo root (skip findProjectConfig walk). */
  repoRoot?: string;
  /** Test seam: forward through to checkHold (exec seam). */
  holdOpts?: Partial<HoldCheckOpts>;
}

/**
 * Drive the D-5 review-hold check. Returns the exit code; emits exactly-one
 * JSON object on stdout and human-readable detail on stderr.
 *
 * Runs in /devx Phase 8 AFTER `devx merge-gate <hash>` exits 0: exit 0 here
 * → proceed with the merge (silence merges); exit 3 → leave the PR open and
 * surface the reason; exit 2 → do NOT merge (uncertainty defaults to safe).
 */
export function runCheckHold(
  args: string[],
  opts: RunCheckHoldOpts = {},
): number {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const err = opts.err ?? ((s) => process.stderr.write(s));

  if (args.length !== 1) {
    err("usage: devx devx-helper check-hold <pr-number>\n");
    return 64;
  }
  const raw = args[0].trim();
  if (!/^\d+$/.test(raw)) {
    err(
      `devx devx-helper check-hold: invalid PR number '${args[0]}' (expected a positive integer)\n`,
    );
    return 64;
  }
  const prNumber = Number.parseInt(raw, 10);
  if (prNumber <= 0) {
    err(
      `devx devx-helper check-hold: invalid PR number '${args[0]}' (expected a positive integer)\n`,
    );
    return 64;
  }

  let repoRoot: string;
  if (opts.repoRoot) {
    repoRoot = opts.repoRoot;
  } else {
    const projectConfigPath = findProjectConfig();
    if (!projectConfigPath) {
      err(
        "devx devx-helper check-hold: devx.config.yaml not found (walked up from cwd)\n",
      );
      return 64;
    }
    repoRoot = dirname(projectConfigPath);
  }

  try {
    const result = checkHold(prNumber, {
      repoRoot,
      ...(opts.holdOpts ?? {}),
    });
    out(`${JSON.stringify(result)}\n`);
    if (result.hold) {
      err(
        `devx devx-helper check-hold: HOLD — ${result.reason}; leave the PR open (D-5)\n`,
      );
      return 3;
    }
    return 0;
  } catch (e) {
    if (e instanceof HoldCheckError) {
      out(`${JSON.stringify({ error: "hold-check-failed", stage: e.stage })}\n`);
      err(`devx devx-helper check-hold: ${e.message}\n`);
      return 2;
    }
    const msg = e instanceof Error ? e.message : String(e);
    out(`${JSON.stringify({ error: "hold-check-failed", stage: "unknown" })}\n`);
    err(`devx devx-helper check-hold: unexpected error: ${msg}\n`);
    return 2;
  }
}

// ---------------------------------------------------------------------------
// mark-done (sgr105)
// ---------------------------------------------------------------------------

export interface RunMarkDoneOpts {
  out?: (s: string) => void;
  err?: (s: string) => void;
  /** Test seam: explicit project config path (skip findProjectConfig walk). */
  projectPath?: string;
  /** Test seam: project repo root (defaults to dirname of resolved config). */
  repoRoot?: string;
  /** Test seam: forward through to markDone. */
  markDoneOpts?: Partial<MarkDoneOpts>;
}

/**
 * Drive the merge-cleanup writes. Emits exactly one JSON object on stdout;
 * human-readable detail goes to stderr.
 *
 * Exit codes (file header): 0 success · 1 state mismatch (row not `[/]` /
 * spec not `in-progress`) or backlog-lock contention · 2 resolution ·
 * 64 usage.
 */
export function runMarkDone(
  args: string[],
  opts: RunMarkDoneOpts = {},
): number {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const err = opts.err ?? ((s) => process.stderr.write(s));
  const usage =
    "usage: devx devx-helper mark-done <hash> --pr <n> --merge-sha <sha> [--type dev|debug]\n";

  // Hand-parsed, mirroring runClaim/runVerifyClaim: test seams stay
  // independent of commander state.
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  const KNOWN = new Set(["--pr", "--merge-sha", "--type"]);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (KNOWN.has(a)) {
      // A flag-shaped "value" means the real value was omitted — don't
      // swallow the next flag as this one's argument.
      if (i + 1 >= args.length || args[i + 1].startsWith("--")) {
        err(`devx devx-helper mark-done: ${a} requires a value\n`);
        return 64;
      }
      flags[a] = args[i + 1];
      i++;
    } else if (a.startsWith("--")) {
      err(`devx devx-helper mark-done: unknown flag '${a}'\n`);
      return 64;
    } else {
      positional.push(a);
    }
  }
  if (positional.length !== 1) {
    err(usage);
    return 64;
  }
  const hash = positional[0];
  if (!HASH_RE.test(hash)) {
    err(
      `devx devx-helper mark-done: invalid hash '${hash}' (expected hex/alnum 3-12 chars)\n`,
    );
    return 64;
  }
  if (flags["--pr"] === undefined || flags["--merge-sha"] === undefined) {
    err(usage);
    return 64;
  }
  // Parsed here rather than in the lib so a typo'd `--pr abc` is a usage
  // error (64) instead of a validation throw (2) — the operator's fix is
  // "retype the flag", not "investigate".
  if (!/^[0-9]+$/.test(flags["--pr"])) {
    err(
      `devx devx-helper mark-done: invalid --pr '${flags["--pr"]}' (expected a positive integer)\n`,
    );
    return 64;
  }
  const pr = Number(flags["--pr"]);
  if (pr <= 0 || !Number.isSafeInteger(pr)) {
    err(
      `devx devx-helper mark-done: invalid --pr '${flags["--pr"]}' (expected a positive integer)\n`,
    );
    return 64;
  }
  // Shape-checked here so an operator typo ("--merge-sha feat/dev-sgr105")
  // is a usage error to retype, not the exit-2 "investigate" tier. The lib
  // re-validates for its library-mode callers.
  if (!/^[0-9a-f]{4,64}$/i.test(flags["--merge-sha"])) {
    err(
      `devx devx-helper mark-done: invalid --merge-sha '${flags["--merge-sha"]}' (expected 4-64 hex chars)\n`,
    );
    return 64;
  }
  const type = flags["--type"];
  if (type !== undefined && type !== "dev" && type !== "debug") {
    err(
      `devx devx-helper mark-done: invalid --type '${type}' (expected 'dev' or 'debug')\n`,
    );
    return 64;
  }

  const projectConfigPath = opts.projectPath ?? findProjectConfig();
  if (!projectConfigPath) {
    err(
      "devx devx-helper mark-done: devx.config.yaml not found (walked up from cwd)\n",
    );
    return 64;
  }
  const repoRoot = opts.repoRoot ?? dirname(projectConfigPath);

  let merged: unknown;
  try {
    merged = loadMerged({ projectPath: projectConfigPath });
  } catch (e) {
    // Same posture as runClaim: keep the JSON-on-stdout contract intact so
    // shell-side parsers can always JSON.parse stdout on non-zero.
    out(`${JSON.stringify({ error: "mark-done-failed", stage: "config-load" })}\n`);
    err(
      `devx devx-helper mark-done: config load failed: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    return 2;
  }

  try {
    const result = markDone(hash, {
      repoRoot,
      config: merged,
      pr,
      mergeSha: flags["--merge-sha"],
      ...(type !== undefined ? { type } : {}),
      ...(opts.markDoneOpts ?? {}),
    });
    out(
      `${JSON.stringify({ hash: result.hash, paths: result.paths, todoSynced: result.todoSynced })}\n`,
    );
    return 0;
  } catch (e) {
    if (e instanceof BacklogLockTimeoutError) {
      // Retryable contention — nothing was mutated (the timeout fires before
      // the first read). Grouped with the exit-1 family for the same reason
      // the claim groups it there: the operator's response is "retry", not
      // "investigate".
      out(
        `${JSON.stringify({ error: "backlog lock held", lockPath: e.lockPath, holderPid: e.holderPid })}\n`,
      );
      err(`devx devx-helper mark-done: ${e.message}\n`);
      return 1;
    }
    if (e instanceof MarkDoneError) {
      out(`${JSON.stringify({ error: "mark-done-failed", stage: e.stage })}\n`);
      err(`devx devx-helper mark-done: ${e.message}\n`);
      return e.stage === "state" ? 1 : 2;
    }
    out(`${JSON.stringify({ error: "mark-done-failed", stage: "unknown" })}\n`);
    err(
      `devx devx-helper mark-done: unexpected error: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    return 2;
  }
}


// ---------------------------------------------------------------------------
// finalize (b931a1)
// ---------------------------------------------------------------------------

export interface RunFinalizeOpts {
  out?: (s: string) => void;
  err?: (s: string) => void;
  /** Test seam: explicit project config path (skip findProjectConfig walk). */
  projectPath?: string;
  /** Test seam: project repo root (defaults to dirname of resolved config). */
  repoRoot?: string;
  /** Test seam: forward through to finalize (exec, lock, markDone, exists). */
  finalizeOpts?: Partial<FinalizeOpts>;
  /** Test seam: forward through to the real markDone this wires up. */
  markDoneOpts?: Partial<MarkDoneOpts>;
}

/**
 * Drive the Phase 8 after-merge tail. Emits exactly one JSON object on
 * stdout; per-stage detail also goes to stderr as human-readable lines.
 *
 * Exit codes:
 *   0  — every stage succeeded (or was legitimately skipped).
 *   1  — mark-done's retryable tier: the backlog row is not `[/]`, the spec
 *        is not `in-progress`, or the backlog lock is held. NOTHING was
 *        written; the operator retries or reconciles.
 *   2  — aborted before the write boundary: bad usage, config load, running
 *        from a linked worktree, or `git pull --ff-only` still failing after
 *        one fetch retry. Nothing was written.
 *   3  — the flips landed and were (probably) pushed, but a later stage
 *        failed. Distinct from 1 and 2 because re-running finalize would now
 *        fail at mark-done (the row is already `[x]`): the fix is to finish
 *        the stages named in `steps` by hand.
 *  64  — usage.
 */
export function runFinalize(
  args: string[],
  opts: RunFinalizeOpts = {},
): number {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const err = opts.err ?? ((s) => process.stderr.write(s));
  const usage =
    "usage: devx devx-helper finalize <hash> --pr <n> --merge-sha <sha> " +
    "[--type dev|debug] [--session-token <token>] [--branch <name>] [--no-rebuild]\n";

  // Hand-parsed, mirroring runClaim/runMarkDone: the test seams stay
  // independent of commander state.
  const flags: Record<string, string> = {};
  const bools = new Set<string>();
  const positional: string[] = [];
  const KNOWN = new Set(["--pr", "--merge-sha", "--type", "--session-token", "--branch"]);
  const KNOWN_BOOL = new Set(["--no-rebuild"]);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (KNOWN_BOOL.has(a)) {
      bools.add(a);
    } else if (KNOWN.has(a)) {
      if (i + 1 >= args.length || args[i + 1].startsWith("--")) {
        err(`devx devx-helper finalize: ${a} requires a value\n`);
        return 64;
      }
      flags[a] = args[i + 1];
      i++;
    } else if (a.startsWith("--")) {
      err(`devx devx-helper finalize: unknown flag '${a}'\n`);
      return 64;
    } else {
      positional.push(a);
    }
  }
  if (positional.length !== 1) {
    err(usage);
    return 64;
  }
  const hash = positional[0];
  if (!HASH_RE.test(hash)) {
    err(
      `devx devx-helper finalize: invalid hash '${hash}' (expected hex/alnum 3-12 chars)\n`,
    );
    return 64;
  }
  if (flags["--pr"] === undefined || flags["--merge-sha"] === undefined) {
    err(usage);
    return 64;
  }
  if (!/^[0-9]+$/.test(flags["--pr"])) {
    err(
      `devx devx-helper finalize: invalid --pr '${flags["--pr"]}' (expected a positive integer)\n`,
    );
    return 64;
  }
  const pr = Number(flags["--pr"]);
  if (pr <= 0 || !Number.isSafeInteger(pr)) {
    err(
      `devx devx-helper finalize: invalid --pr '${flags["--pr"]}' (expected a positive integer)\n`,
    );
    return 64;
  }
  if (!/^[0-9a-f]{4,64}$/i.test(flags["--merge-sha"])) {
    err(
      `devx devx-helper finalize: invalid --merge-sha '${flags["--merge-sha"]}' (expected 4-64 hex chars)\n`,
    );
    return 64;
  }
  const rawType = flags["--type"] ?? "dev";
  if (rawType !== "dev" && rawType !== "debug") {
    err(
      `devx devx-helper finalize: invalid --type '${rawType}' (expected 'dev' or 'debug')\n`,
    );
    return 64;
  }
  const type: ClaimableType = rawType;

  const projectConfigPath = opts.projectPath ?? findProjectConfig();
  if (!projectConfigPath) {
    err(
      "devx devx-helper finalize: devx.config.yaml not found (walked up from cwd)\n",
    );
    return 64;
  }
  const repoRoot = opts.repoRoot ?? dirname(projectConfigPath);

  let merged: unknown;
  try {
    merged = loadMerged({ projectPath: projectConfigPath });
  } catch (e) {
    out(`${JSON.stringify({ error: "finalize-failed", stage: "config-load" })}\n`);
    err(
      `devx devx-helper finalize: config load failed: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    return 2;
  }

  // The session token guards the lock release, and it is NOT defaulted.
  //
  // verify-claim gets away with auto-deriving because a mismatch there fails
  // SAFE (halt). Here a mismatch fails OPEN: the release is skipped and the
  // lock leaks. And a re-derived token can never match — the lock body
  // records the *claim* CLI process's `defaultSessionId()`
  // (`<minute-stamp>-<pid>`), and this is a different process, minutes or
  // hours later. Inventing one produced a guaranteed `not-owner` reported as
  // "a peer re-claimed the hash", which was false, exit 0, and E3 un-closed.
  //
  // So: absent → null, and finalize says so out loud. The token comes from
  // `devx devx-helper claim`'s `sessionToken` field, never from the spec's
  // `owner:` or the lock body (CLAUDE.md: a token read from the thing it
  // guards always matches and defeats the check).
  const rawToken = flags["--session-token"];
  if (rawToken !== undefined && rawToken.trim() === "") {
    // An empty string is "supplied" to `??` but disarms the guard for every
    // ordinary lock while STILL unlinking an empty-bodied one. Reject it as
    // usage rather than let it read as an intentional opt-out.
    err(
      "devx devx-helper finalize: --session-token must not be empty (omit the flag if you do not have the token)\n",
    );
    return 64;
  }
  const sessionToken = rawToken ?? null;

  // markDone's exceptions are the retryable/abort tier, so they are caught
  // here (outside finalize) and mapped to 1/2 exactly as runMarkDone maps
  // them. finalize itself only ever sees a successful return.
  let markDoneFailure: { code: number; body: Record<string, unknown>; msg: string } | null =
    null;
  const runMarkDoneInline = (): { paths: string[]; todoSynced: boolean } => {
    try {
      const r = markDone(hash, {
        repoRoot,
        config: merged,
        pr,
        mergeSha: flags["--merge-sha"],
        type,
        ...(opts.markDoneOpts ?? {}),
      });
      return { paths: r.paths, todoSynced: r.todoSynced };
    } catch (e) {
      if (e instanceof BacklogLockTimeoutError) {
        markDoneFailure = {
          code: 1,
          body: { error: "backlog lock held", lockPath: e.lockPath, holderPid: e.holderPid },
          msg: e.message,
        };
      } else if (e instanceof MarkDoneError) {
        markDoneFailure = {
          code: e.stage === "state" ? 1 : 2,
          body: { error: "mark-done-failed", stage: e.stage },
          msg: e.message,
        };
      } else {
        markDoneFailure = {
          code: 2,
          body: { error: "mark-done-failed", stage: "unknown" },
          msg: e instanceof Error ? e.message : String(e),
        };
      }
      throw e;
    }
  };

  try {
    const result = finalize(hash, {
      repoRoot,
      type,
      config: merged as DeriveBranchConfig & { git?: { default_branch?: string } },
      pr,
      mergeSha: flags["--merge-sha"],
      sessionToken,
      ...(flags["--branch"] !== undefined ? { branch: flags["--branch"] } : {}),
      ...(bools.has("--no-rebuild") ? { rebuild: false } : {}),
      markDone: runMarkDoneInline,
      err,
      ...(opts.finalizeOpts ?? {}),
    });
    out(`${JSON.stringify(result)}\n`);
    for (const s of result.steps) {
      const tag = s.ok ? (s.skipped ? "skip" : "ok  ") : "FAIL";
      err(`devx finalize: [${tag}] ${s.stage}${s.detail ? ` — ${s.detail}` : ""}\n`);
    }
    return result.ok ? 0 : 3;
  } catch (e) {
    if (markDoneFailure !== null) {
      const f = markDoneFailure as { code: number; body: Record<string, unknown>; msg: string };
      out(`${JSON.stringify(f.body)}\n`);
      err(`devx devx-helper finalize: mark-done: ${f.msg}\n`);
      return f.code;
    }
    if (e instanceof FinalizeAbort) {
      out(`${JSON.stringify({ error: "finalize-aborted", stage: e.stage })}\n`);
      err(`devx devx-helper finalize: ${e.message}\n`);
      return 2;
    }
    out(`${JSON.stringify({ error: "finalize-failed", stage: "unknown" })}\n`);
    err(
      `devx devx-helper finalize: unexpected error: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    return 2;
  }
}

// ---------------------------------------------------------------------------
// commander wiring
// ---------------------------------------------------------------------------

export function register(program: Command): void {
  const sub = program
    .command("devx-helper")
    .description(
      "Helpers invoked by the /devx skill body (Phase 1). Subcommand-driven; mirrors `devx merge-gate` + `devx plan-helper`.",
    );

  sub
    .command("claim")
    .description(
      "Atomically claim a backlog spec for /devx: lock + backlog-row flip (DEV.md, or DEBUG.md with --type debug) + spec frontmatter + status log + claim commit + push + worktree. Closes feedback_devx_push_claim_before_pr.md structurally.",
    )
    .argument("<hash>", "spec hash (e.g. 'dvx101')")
    .option("--type <type>", "spec type: 'dev' (default) or 'debug' (v2d101 debug loop)")
    .action(async (hash: string, options: { type?: string }) => {
      const args =
        options.type !== undefined ? [hash, "--type", options.type] : [hash];
      const code = await runClaim(args, {});
      if (code !== 0) {
        process.exit(code);
      }
    });

  sub
    .command("await-remote-ci")
    .description(
      "Probe remote CI for a branch (dvx105). Without --once: blocks (real sleep) until terminal — emits AwaitState JSON {state: 'no-workflow' | 'workflow-no-run' | 'pr-conflicting' | 'completed', ...}. With --once: single shot — emits ProbeState JSON (may include transient 'in-progress'/'empty'/'sha-mismatch'). 'pr-conflicting' (c94f14) means no run exists because the PR is unmergeable — merge the base branch in and re-probe, don't escalate. Skill body Phase 7 uses --once + ScheduleWakeup 120s loop to stay cache-warm.",
    )
    .argument("<branch>", "branch name (e.g. 'feat/dev-dvx105')")
    .option("--once", "single-shot probe; do not block on in-progress")
    .action(async (branch: string, options: { once?: boolean }) => {
      const args = options.once ? [branch, "--once"] : [branch];
      const code = await runAwaitRemoteCi(args, {});
      if (code !== 0) {
        process.exit(code);
      }
    });

  sub
    .command("verify-claim")
    .description(
      "Verify claim ownership before resuming an in-progress spec (roc101). Reads .devx-cache/locks/spec-<hash>.lock + spec frontmatter owner:; compares against the current session token. Exit 0 owned / 3 owned-by-other-session / 4 in-progress-without-lock / 2 other errors. Skill body Phase 1 resume-detection runs this BEFORE any worktree edit.",
    )
    .argument("<hash>", "spec hash (e.g. 'roc101')")
    .option(
      "--session-token <token>",
      "current session's token (raw sessionId or /devx-<sessionId> owner shape); auto-derived when omitted",
    )
    .option("--type <type>", "spec type: 'dev' (default) or 'debug' (v2d101 debug loop)")
    .action(
      async (hash: string, options: { sessionToken?: string; type?: string }) => {
        const args = [hash];
        if (options.sessionToken !== undefined) {
          args.push("--session-token", options.sessionToken);
        }
        if (options.type !== undefined) {
          args.push("--type", options.type);
        }
        const code = await runVerifyClaim(args, {});
        if (code !== 0) {
          process.exit(code);
        }
      },
    );

  sub
    .command("mark-done")
    .description(
      "Merge-cleanup writes for /devx Phase 8 (sgr105): spec `status: done` + status-log line, backlog `[/]→[x]` + PR-URL append, workstream todo.md sync, GRAPH.md regen — all under the backlog lock. Emits {hash, paths, todoSynced}; the caller stages `paths` by explicit pathspec and owns the commit + push. Exit 0 / 1 state mismatch or lock contention / 2 resolution.",
    )
    .argument("<hash>", "spec hash (e.g. 'sgr105')")
    // NOT `.requiredOption`: commander enforces those itself and exits 1
    // before the action runs, and exit 1 is this subcommand's "state
    // mismatch / retryable contention" signal — a forgotten flag would read
    // to the skill body as a claimed-item mismatch. `runMarkDone` owns the
    // required-flag check and answers 64, like every other usage error here.
    .option("--pr <number>", "merged PR number (required)")
    .option("--merge-sha <sha>", "squash-merge commit sha (required)")
    .option("--type <type>", "spec type: 'dev' (default) or 'debug'")
    .action(
      (
        hash: string,
        options: { pr?: string; mergeSha?: string; type?: string },
      ) => {
        const args = [hash];
        if (options.pr !== undefined) args.push("--pr", options.pr);
        if (options.mergeSha !== undefined) {
          args.push("--merge-sha", options.mergeSha);
        }
        if (options.type !== undefined) args.push("--type", options.type);
        const code = runMarkDone(args, {});
        if (code !== 0) {
          process.exit(code);
        }
      },
    );

  sub
    .command("finalize")
    .description(
      "The whole /devx Phase 8 after-merge tail as one call (b931a1): git pull --ff-only, mark-done, `git add -- <returned paths>` + commit + push (bounded rebase-retry), guarded spec-lock release, worktree + branch removal, and a swap-in rebuild of the main worktree's dist/ so the next claim runs post-merge code. Exit 0 all stages / 1 mark-done state mismatch or lock contention (nothing written) / 2 aborted before any write / 3 flips landed but a later stage failed — read `steps`.",
    )
    .argument("<hash>", "spec hash (e.g. 'b931a1')")
    .option("--pr <number>", "merged PR number (required)")
    .option("--merge-sha <sha>", "squash-merge commit sha (required)")
    .option("--type <type>", "spec type: 'dev' (default) or 'debug'")
    .option(
      "--session-token <token>",
      "session whose claim this is; guards the spec-lock release. NEVER pass a token copied from the spec's owner: or the lock body — that always matches and defeats the guard.",
    )
    .option("--branch <name>", "branch to delete (default: feat/<type>-<hash>)")
    .option("--no-rebuild", "skip the dist/ refresh")
    .action(
      (
        hash: string,
        options: {
          pr?: string;
          mergeSha?: string;
          type?: string;
          sessionToken?: string;
          branch?: string;
          rebuild?: boolean;
        },
      ) => {
        const args = [hash];
        if (options.pr !== undefined) args.push("--pr", options.pr);
        if (options.mergeSha !== undefined) {
          args.push("--merge-sha", options.mergeSha);
        }
        if (options.type !== undefined) args.push("--type", options.type);
        if (options.sessionToken !== undefined) {
          args.push("--session-token", options.sessionToken);
        }
        if (options.branch !== undefined) args.push("--branch", options.branch);
        // commander maps `--no-rebuild` to `rebuild: false`.
        if (options.rebuild === false) args.push("--no-rebuild");
        const code = runFinalize(args, {});
        if (code !== 0) {
          process.exit(code);
        }
      },
    );

  sub
    .command("check-hold")
    .description(
      "D-5 review-hold check for the /devx Phase 8 merge tail (v2t101). Inspects PR comments + reviews via gh for a 'devx: hold' comment or an unresolved requested-changes review. Exit 0 {hold:false} → silence merges / 3 {hold:true, reason} → leave PR open / 2 gh failure → do not merge.",
    )
    .argument("<pr-number>", "PR number (e.g. '64')")
    .action((prNumber: string) => {
      const code = runCheckHold([prNumber], {});
      if (code !== 0) {
        process.exit(code);
      }
    });

  attachPhase(sub, 1);
}
