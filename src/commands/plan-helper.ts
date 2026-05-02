// `devx plan-helper <subcommand>` — CLI passthrough for the `/devx-plan`
// skill body. Mirrors the mrg102 pattern: skill body invokes a small Bash
// helper, helper does the deterministic work, skill body uses the result.
//
// Phase 1 surface: only `derive-branch <type> <hash>` is wired (pln101).
// Phase 1 follow-ups:
//   - pln102 adds `emit-retro-story` (with --epic-slug --parents flags).
//   - pln103 adds `validate-emit <epic-slug>`.
//
// Exit codes (per spec AC):
//   0  — success; derived branch printed on stdout.
//   1  — invalid input or config (missing devx.config.yaml, malformed type/hash,
//        config load throw). Reason on stderr.
//   2  — usage error from commander (handled by commander itself).
//
// Spec: dev/dev-pln101-2026-04-28T19:30-plan-derive-branch.md
// Epic: _bmad-output/planning-artifacts/epic-devx-plan-skill.md

import type { Command } from "commander";

import { findProjectConfig, loadMerged } from "../lib/config-io.js";
import { attachPhase } from "../lib/help.js";
import {
  type DeriveBranchConfig,
  deriveBranch,
} from "../lib/plan/derive-branch.js";

// Spec convention from CLAUDE.md: type ∈ {dev, plan, test, debug, focus, learn, qa}.
const KNOWN_TYPES: ReadonlySet<string> = new Set([
  "dev",
  "plan",
  "test",
  "debug",
  "focus",
  "learn",
  "qa",
]);

// Mirrors merge-gate.ts's hash regex — alphanum 3-12 chars covers every
// existing hash (aud101, mrg102, a10001, …) plus a little headroom.
const HASH_RE = /^[a-z0-9]{3,12}$/i;

export interface RunDeriveBranchOpts {
  /** Test seam: route stdout off process.stdout. */
  out?: (s: string) => void;
  /** Test seam: route stderr off process.stderr. */
  err?: (s: string) => void;
  /** Test seam: explicit project config path (skip findProjectConfig walk). */
  projectPath?: string;
}

export function runDeriveBranch(
  args: string[],
  opts: RunDeriveBranchOpts = {},
): number {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const err = opts.err ?? ((s) => process.stderr.write(s));

  if (args.length !== 2) {
    err("usage: devx plan-helper derive-branch <type> <hash>\n");
    return 1;
  }
  const [type, hash] = args;

  if (!KNOWN_TYPES.has(type)) {
    err(
      `devx plan-helper derive-branch: invalid type '${type}' (expected one of: ${[...KNOWN_TYPES].join(", ")})\n`,
    );
    return 1;
  }
  if (!HASH_RE.test(hash)) {
    err(
      `devx plan-helper derive-branch: invalid hash '${hash}' (expected hex/alnum 3-12 chars)\n`,
    );
    return 1;
  }

  const projectConfigPath = opts.projectPath ?? findProjectConfig();
  if (!projectConfigPath) {
    err(
      "devx plan-helper derive-branch: devx.config.yaml not found (walked up from cwd)\n",
    );
    return 1;
  }

  let merged: DeriveBranchConfig;
  try {
    const raw = loadMerged({ projectPath: projectConfigPath });
    // Same defensive narrow as merge-gate.ts: treat null/non-object as empty
    // so a config with no `git:` section still produces a default branch.
    merged = (raw && typeof raw === "object" ? raw : {}) as DeriveBranchConfig;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    err(`devx plan-helper derive-branch: config load failed: ${msg}\n`);
    return 1;
  }

  out(`${deriveBranch(merged, type, hash)}\n`);
  return 0;
}

export function register(program: Command): void {
  const sub = program
    .command("plan-helper")
    .description(
      "Helpers invoked by the /devx-plan skill body (Phase 1). Subcommand-driven; mirrors `devx merge-gate`'s passthrough pattern.",
    );

  sub
    .command("derive-branch")
    .description(
      "Print the branch name a fresh spec should record, derived from devx.config.yaml's git.{integration_branch, branch_prefix}.",
    )
    .argument("<type>", "spec type (dev, plan, test, debug, focus, learn, qa)")
    .argument("<hash>", "spec hash (e.g. 'aud101')")
    .action((type: string, hash: string) => {
      const code = runDeriveBranch([type, hash], {});
      if (code !== 0) {
        process.exit(code);
      }
    });

  attachPhase(sub, 1);
}
