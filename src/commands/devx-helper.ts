// `devx devx-helper <subcommand>` — CLI passthrough for the `/devx` skill body.
//
// Mirrors the merge-gate (mrg102) and plan-helper (pln101/pln102/pln103)
// patterns: skill body invokes a small CLI helper, helper does the
// deterministic work (atomic claim, lock-coord, deterministic branch
// derivation, conditional-bmad-create-story decision), skill body uses
// the JSON result.
//
// Phase 1 surface:
//   • dvx101: `devx devx-helper claim <hash>`
//   • dvx102: `devx devx-helper should-create-story <hash>`
//   • dvx105: `devx devx-helper await-remote-ci <branch>` (later)
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
//   `should-create-story`:
//     • 0  → decision computed. JSON `{hash, canary, decision, effective,
//            inputs}` on stdout.
//     • 2  → resolve/load failure. JSON `{error, stage}` on stdout where
//            `stage ∈ {"config-load","resolve","read-spec","unknown"}`;
//            stderr has detail.
//     • 64 → usage error. stderr only.
//
// Spec: dev/dev-dvx101-... + dev/dev-dvx102-...
// Epic: _bmad-output/planning-artifacts/epic-devx-skill.md

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
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
  type ShouldCreateStoryConfig,
  effectivePhase2Action,
  readCanary,
  shouldCreateStory,
} from "../lib/devx/should-create-story.js";
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
// should-create-story (dvx102)
// ---------------------------------------------------------------------------

export interface RunShouldCreateStoryOpts {
  /** Test seam: route stdout off process.stdout. */
  out?: (s: string) => void;
  /** Test seam: route stderr off process.stderr. */
  err?: (s: string) => void;
  /** Test seam: explicit project config path. */
  projectPath?: string;
  /** Test seam: project repo root. */
  repoRoot?: string;
  /** Test seam: pre-loaded config (skip loadMerged). */
  configOverride?: ShouldCreateStoryConfig;
  /** Test seam: pre-resolved spec content (skip disk read). */
  specContentOverride?: string;
  /** Test seam: pre-resolved hasStoryFile (skip disk check). */
  hasStoryFileOverride?: boolean;
}

/**
 * Drive the should-create-story decision. Returns the exit code; emits
 * exactly-one JSON object on stdout and human-readable detail on stderr.
 *
 * stdout shape on exit 0:
 *
 *   {
 *     "hash": "<hash>",
 *     "canary": "off" | "active" | "default",
 *     "decision": { "invoke": boolean, "reason": string },
 *     "effective": { "action": "invoke" | "skip" | "read-existing", "statusLog": "..." },
 *     "inputs": { "acCount": number, "hasStoryFile": boolean }
 *   }
 *
 * The `effective.statusLog` field is the canonical Phase 2 status-log
 * line per spec AC #5 — the skill body writes it to the spec verbatim.
 */
export async function runShouldCreateStory(
  args: string[],
  opts: RunShouldCreateStoryOpts = {},
): Promise<number> {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const err = opts.err ?? ((s) => process.stderr.write(s));

  if (args.length !== 1) {
    err("usage: devx devx-helper should-create-story <hash>\n");
    return 64;
  }
  const hash = args[0];
  if (!HASH_RE.test(hash)) {
    err(
      `devx devx-helper should-create-story: invalid hash '${hash}' (expected hex/alnum 3-12 chars)\n`,
    );
    return 64;
  }

  let config: ShouldCreateStoryConfig;
  let repoRoot: string;
  if (opts.configOverride !== undefined) {
    config = opts.configOverride;
    if (!opts.repoRoot) {
      err(
        "devx devx-helper should-create-story: configOverride supplied without repoRoot — refusing to walk for a project root\n",
      );
      return 64;
    }
    repoRoot = opts.repoRoot;
  } else {
    const projectConfigPath = opts.projectPath ?? findProjectConfig();
    if (!projectConfigPath) {
      err(
        "devx devx-helper should-create-story: devx.config.yaml not found (walked up from cwd)\n",
      );
      return 64;
    }
    repoRoot = opts.repoRoot ?? dirname(projectConfigPath);
    try {
      const raw = loadMerged({ projectPath: projectConfigPath });
      config = (raw && typeof raw === "object"
        ? raw
        : {}) as ShouldCreateStoryConfig;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      out(`${JSON.stringify({ error: "rollback", stage: "config-load" })}\n`);
      err(
        `devx devx-helper should-create-story: config load failed: ${msg}\n`,
      );
      return 2;
    }
  }

  // Resolve spec content (real fs unless test override supplied).
  let specContent: string;
  if (opts.specContentOverride !== undefined) {
    specContent = opts.specContentOverride;
  } else {
    const specPath = findSpecPath(repoRoot, hash);
    if (!specPath) {
      out(`${JSON.stringify({ error: "rollback", stage: "resolve" })}\n`);
      err(
        `devx devx-helper should-create-story: no spec file found at ${join(repoRoot, "dev")}/dev-${hash}-*.md\n`,
      );
      return 2;
    }
    try {
      specContent = readFileSync(specPath, "utf8");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      out(`${JSON.stringify({ error: "rollback", stage: "read-spec" })}\n`);
      err(
        `devx devx-helper should-create-story: read spec failed: ${msg}\n`,
      );
      return 2;
    }
  }

  const acCount = countActionableAcs(specContent);
  const hasStoryFile =
    opts.hasStoryFileOverride !== undefined
      ? opts.hasStoryFileOverride
      : existsSync(
          join(
            repoRoot,
            "_bmad-output",
            "implementation-artifacts",
            `story-${hash}.md`,
          ),
        );

  const decision = shouldCreateStory(config, { acCount, hasStoryFile });
  const canary = readCanary(config);
  const effective = effectivePhase2Action(canary, decision);

  out(
    `${JSON.stringify({
      hash,
      canary,
      decision,
      effective,
      inputs: { acCount, hasStoryFile },
    })}\n`,
  );
  return 0;
}

/**
 * Locate `<repoRoot>/dev/dev-<hash>-*.md`. Mirrors claim.ts's resolver
 * shape (anchor on `dev-${hash}-` prefix to avoid hash-prefix collisions
 * like `mrg10` vs `mrg101`).
 *
 * `readdirSync` order is filesystem-dependent — APFS returns inode
 * order, ext4 returns hash-table order. Sort lexicographically so
 * duplicate-hash specs (a typo where two files share a hash) resolve
 * deterministically across runs. The newer `created:` timestamp is
 * embedded in the filename (`dev-<hash>-<ts>-<slug>.md`), so lexical
 * sort ascending = oldest-first; we still take the first match. A
 * future story can promote this to "warn on multiple matches"; for
 * now determinism alone is the win.
 */
function findSpecPath(repoRoot: string, hash: string): string | null {
  const dir = join(repoRoot, "dev");
  if (!existsSync(dir)) return null;
  const matches: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith(`dev-${hash}-`) && name.endsWith(".md")) {
      matches.push(name);
    }
  }
  if (matches.length === 0) return null;
  matches.sort();
  return join(dir, matches[0]);
}

/**
 * Count column-0 checkbox items under the spec's `## Acceptance criteria`
 * section, regardless of checkbox state. Matches `- [ ]`, `- [x]`,
 * `- [/]`, and `- [-]` per CLAUDE.md's checkbox convention — the count
 * is a STRUCTURAL property of the spec (how many criteria it imposes),
 * NOT a transient state count of unchecked items. A re-run of Phase 2
 * mid-impl with some ACs already checked must produce the same decision
 * as the first run.
 *
 * The canonical spec shape (per CLAUDE.md "Spec file convention") has
 * each AC at column 0; sub-bullets (indented) are explanatory notes,
 * not separate ACs. The matcher anchors on column 0 to enforce this.
 */
export function countActionableAcs(specContent: string): number {
  const heading = /^## Acceptance criteria\s*\n/m.exec(specContent);
  if (!heading) return 0;
  const sectionStart = heading.index + heading[0].length;
  const rest = specContent.slice(sectionStart);
  const next = /^## /m.exec(rest);
  const sectionEnd = next ? sectionStart + next.index : specContent.length;
  const section = specContent.slice(sectionStart, sectionEnd);
  // Column-0 + any single-char checkbox state. Matches ` `, `x`, `X`, `/`, `-`.
  const matches = section.match(/^- \[[ xX/-]\] /gm);
  return matches ? matches.length : 0;
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

  sub
    .command("should-create-story")
    .description(
      "Compute the conditional bmad-create-story decision for /devx Phase 2 (dvx102). Reads project.shape + AC count + story-file presence + canary flag; emits {hash, canary, decision, effective, inputs} JSON. effective.statusLog is the canonical Phase 2 status-log line.",
    )
    .argument("<hash>", "spec hash (e.g. 'dvx102')")
    .action(async (hash: string) => {
      const code = await runShouldCreateStory([hash], {});
      if (code !== 0) {
        process.exit(code);
      }
    });

  attachPhase(sub, 1);
}
