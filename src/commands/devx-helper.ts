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
//     • 1  → lock-already-held. JSON `{error, lockPath}` on stdout.
//     • 2  → rollback. JSON `{error, stage}` on stdout; stderr has detail.
//     • 64 → usage error. stderr only.
//
//   `await-remote-ci`:
//     • 0  → terminal (or single-shot probe complete). JSON shape varies
//            by mode:
//              --once : ProbeState (one of no-workflow / empty /
//                       sha-mismatch / in-progress / completed).
//              else   : AwaitState (one of no-workflow / workflow-no-run /
//                       completed).
//     • 2  → gh probe failure. JSON `{error, stage}` on stdout where
//            `stage ∈ {"gh-run-list","gh-parse","git-rev-parse","unknown"}`;
//            stderr has detail. Operator-actionable (auth / network /
//            parse). `"unknown"` is the catch-all for non-GhProbeError
//            throws — argument validation, unhandled internal failures.
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
  ClaimError,
  type ClaimSpecOpts,
  LockHeldError,
  claimSpec,
} from "../lib/devx/claim.js";
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

  if (args.length !== 1) {
    err("usage: devx devx-helper claim <hash>\n");
    return 64;
  }
  const hash = args[0];
  if (!HASH_RE.test(hash)) {
    err(
      `devx devx-helper claim: invalid hash '${hash}' (expected hex/alnum 3-12 chars)\n`,
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
      ...(opts.claimOpts ?? {}),
    });
    out(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (e) {
    if (e instanceof LockHeldError) {
      out(`${JSON.stringify({ error: "lock held", lockPath: e.lockPath })}\n`);
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
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--session-token") {
      if (i + 1 >= args.length) {
        err(
          "devx devx-helper verify-claim: --session-token requires a value\n",
        );
        return 64;
      }
      sessionToken = args[i + 1];
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
      "usage: devx devx-helper verify-claim <hash> [--session-token <token>]\n",
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
      "Atomically claim a DEV.md spec for /devx: lock + DEV.md flip + spec frontmatter + status log + claim commit + push + worktree. Closes feedback_devx_push_claim_before_pr.md structurally.",
    )
    .argument("<hash>", "spec hash (e.g. 'dvx101')")
    .action(async (hash: string) => {
      const code = await runClaim([hash], {});
      if (code !== 0) {
        process.exit(code);
      }
    });

  sub
    .command("await-remote-ci")
    .description(
      "Probe remote CI for a branch (dvx105). Without --once: blocks (real sleep) until terminal — emits AwaitState JSON {state: 'no-workflow' | 'workflow-no-run' | 'completed', ...}. With --once: single shot — emits ProbeState JSON (may include transient 'in-progress'/'empty'/'sha-mismatch'). Skill body Phase 7 uses --once + ScheduleWakeup 120s loop to stay cache-warm.",
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
    .action(async (hash: string, options: { sessionToken?: string }) => {
      const args =
        options.sessionToken !== undefined
          ? [hash, "--session-token", options.sessionToken]
          : [hash];
      const code = await runVerifyClaim(args, {});
      if (code !== 0) {
        process.exit(code);
      }
    });

  attachPhase(sub, 1);
}
