// `devx devx-helper <subcommand>` — CLI passthrough for the `/devx` skill body.
//
// Mirrors the merge-gate (mrg102) and plan-helper (pln101/pln102/pln103)
// patterns: skill body invokes a small CLI helper, helper does the
// deterministic work (atomic claim, lock-coord, deterministic branch
// derivation), skill body uses the JSON result.
//
// Phase 1 surface (dvx101): `devx devx-helper claim <hash>` only. dvx102
// adds `should-create-story`; dvx105 adds `await-remote-ci` (each via its
// own helper module). Each subcommand is registered conditionally so the
// /devx skill body can rely on the absence/presence of a subcommand as a
// canary signal.
//
// Exit codes — consumed by the /devx Phase 1 step in shell-style:
//
//     LOCK_OUT=$(devx devx-helper claim "$HASH") || case $? in
//       1) echo "lock held — another /devx is on this hash"; exit 1 ;;
//       2) echo "rollback — see stderr"; exit 1 ;;
//     esac
//
//   • 0  → claim successful. JSON `{branch, lockPath, claimSha}` on stdout.
//   • 1  → lock-already-held. JSON `{error, lockPath}` on stdout (no
//          ambiguous parse — caller can pull the path out of stdout if
//          they want to surface it).
//   • 2  → rollback: any other claim failure. JSON `{error, stage}` on
//          stdout; stderr has the human-readable detail.
//   • 64 → usage error (bad argv, hash shape). stderr only.
//
// Spec: dev/dev-dvx101-2026-04-28T19:30-devx-claim-atomic.md
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
    // Keep the exit-2 → JSON-on-stdout contract intact (file header lines
    // 25-26). Without the JSON emission a config-load failure produced
    // exit 2 with empty stdout, breaking shell-side parsers that always
    // try to JSON.parse the stdout on non-zero.
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

  attachPhase(sub, 1);
}
