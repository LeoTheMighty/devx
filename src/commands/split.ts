// `devx split <hash>` — top-level CLI over performSplit (mss101). A
// first-class lifecycle operation like `merge-gate` / `revise` / `outcome`:
// the interactive `/devx` Phase 9 route for early halts (phase 4 of the
// mid-story-split workstream rewires the skill prose), and hand-runnable.
// The loop driver calls performSplit directly (library seam), never this
// subprocess.
//
//   devx split <hash> --payload <file> --session-token <tok>
//     [--shape merge-first|branch-handoff]
//
// `--session-token` is ALWAYS explicit — no verify-claim-style
// omission-auto-derive (design § Interfaces: a freshly derived token would
// always mismatch the claimer's lock; split must never guess).
//
// No `--type` flag: the parent's type resolves from where the spec file
// lives (findSpecForHashAnyType) and the follow-up always inherits it.
//
// branch-handoff refuses unless the parent's recorded WIP branch exists on
// origin (`git ls-remote --heads origin <branch>` non-empty) — FR-4/FR-8:
// no worktree preserved without a reachable recorded pointer.
//
// Exit codes (devx-helper conventions):
//   0  → success. JSON {followUpHash, followUpSpecPath, devMdRow, shape}.
//   1  → backlog-lock contention (BacklogLockTimeoutError).
//   3  → ownership mismatch (no spec lock, or held by another session).
//   2  → any other failure (payload, resolve, compose, write, ls-remote
//        refusal). JSON {error, stage} on stdout; stderr has detail.
//   64 → usage error. stderr only.
//
// Spec: dev/dev-mss101-2026-07-28T13:43-split-primitive-lib-cli.md
// Design: _devx/workstreams/mid-story-split/design/agent.md § Architecture 2

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import process from "node:process";

import type { Command } from "commander";

import { findProjectConfig, loadMerged } from "../lib/config-io.js";
import { attachPhase } from "../lib/help.js";
import { REV_PARSE_ARGS, interpretRevParse } from "../lib/repo-root.js";
import { normalizeSessionToken } from "../lib/devx/verify-claim.js";
import {
  AmbiguousSpecHashError,
  findSpecForHashAnyType,
} from "../lib/engine/frontmatter.js";
import { BacklogLockTimeoutError } from "../lib/backlog/mutate.js";
import type { DeriveBranchConfig } from "../lib/plan/derive-branch.js";
import { CLAIMABLE_TYPES, type Exec } from "../lib/devx/claim.js";
import {
  type PerformSplitOpts,
  type SplitShape,
  SplitError,
  SplitOwnershipError,
  parseFrontmatterBranch,
  performSplit,
  validateSplitPayload,
} from "../lib/devx/split.js";

const HASH_RE = /^[a-z0-9]{3,12}$/i;

export interface RunSplitOpts {
  /** Test seam: route stdout off process.stdout. */
  out?: (s: string) => void;
  /** Test seam: route stderr off process.stderr. */
  err?: (s: string) => void;
  /** Test seam: explicit project config path (skip findProjectConfig walk). */
  projectPath?: string;
  /** Test seam: project repo root (defaults to dirname of resolved config). */
  repoRoot?: string;
  /** Test seam: pre-loaded config (skips loadMerged). */
  config?: DeriveBranchConfig;
  /** Test seam: payload-file reader (defaults to real readFileSync). */
  readFile?: (path: string) => string;
  /** Test seam: spec resolver (defaults to findSpecForHashAnyType). */
  resolveSpec?: (
    repoRoot: string,
    hash: string,
  ) => { path: string; type: string } | null;
  /** Test seam: replacement for the real `git ls-remote` shell-out. */
  exec?: Exec;
  /** Test seam: forward through to performSplit (fs, lock, now). */
  splitOpts?: Partial<PerformSplitOpts>;
}

const realExec: Exec = (cmd, args, opts) => {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    cwd: opts?.cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (r.error || r.status === null) {
    const detail = r.error ? r.error.message : "spawn returned null status";
    return { stdout: r.stdout ?? "", stderr: detail, exitCode: 127 };
  }
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", exitCode: r.status };
};

/**
 * Drive the split. Returns the exit code; emits exactly-one JSON object on
 * stdout (success or {error, stage}) and human-readable detail on stderr.
 */
export function runSplit(args: string[], opts: RunSplitOpts = {}): number {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const err = opts.err ?? ((s) => process.stderr.write(s));

  // Hand-parse (mirrors runClaim/runVerifyClaim) so test seams aren't
  // dependent on commander state.
  let payloadPath: string | undefined;
  let sessionToken: string | undefined;
  let shape: string | undefined;
  const positional: string[] = [];
  const takeValue = (flag: string, i: number): string | null => {
    if (i + 1 >= args.length || args[i + 1].startsWith("--")) {
      err(`devx split: ${flag} requires a value\n`);
      return null;
    }
    return args[i + 1];
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--payload") {
      const v = takeValue(a, i);
      if (v === null) return 64;
      payloadPath = v;
      i++;
    } else if (a === "--session-token") {
      const v = takeValue(a, i);
      if (v === null) return 64;
      sessionToken = v;
      i++;
    } else if (a === "--shape") {
      const v = takeValue(a, i);
      if (v === null) return 64;
      shape = v;
      i++;
    } else if (a.startsWith("--")) {
      err(`devx split: unknown flag '${a}'\n`);
      return 64;
    } else {
      positional.push(a);
    }
  }
  if (positional.length !== 1) {
    err(
      "usage: devx split <hash> --payload <file> --session-token <token> [--shape merge-first|branch-handoff]\n",
    );
    return 64;
  }
  const hash = positional[0];
  if (!HASH_RE.test(hash)) {
    err(`devx split: invalid hash '${hash}' (expected hex/alnum 3-12 chars)\n`);
    return 64;
  }
  if (payloadPath === undefined) {
    err("devx split: --payload <file> is required\n");
    return 64;
  }
  if (
    sessionToken === undefined ||
    normalizeSessionToken(sessionToken) === ""
  ) {
    // Normalize-then-check (review EC-7): a token of exactly `/devx-`
    // strips to empty and is a usage error here, not a deep exit-2.
    err(
      "devx split: --session-token is required and must be non-empty after normalization (the token this session claimed with — split never auto-derives)\n",
    );
    return 64;
  }
  if (shape !== undefined && shape !== "merge-first" && shape !== "branch-handoff") {
    err(
      `devx split: invalid --shape '${shape}' (expected 'merge-first' or 'branch-handoff')\n`,
    );
    return 64;
  }
  const resolvedShape: SplitShape = (shape as SplitShape | undefined) ?? "merge-first";

  // ---- Project resolution.
  let repoRoot = opts.repoRoot;
  let config = opts.config;
  if (repoRoot === undefined || config === undefined) {
    const projectConfigPath = opts.projectPath ?? findProjectConfig();
    if (!projectConfigPath) {
      err("devx split: devx.config.yaml not found (walked up from cwd)\n");
      return 64;
    }
    repoRoot = repoRoot ?? dirname(projectConfigPath);
    if (config === undefined) {
      try {
        const raw = loadMerged({ projectPath: projectConfigPath });
        config = (raw && typeof raw === "object" ? raw : {}) as DeriveBranchConfig;
      } catch (e) {
        out(`${JSON.stringify({ error: "split-failed", stage: "config-load" })}\n`);
        err(`devx split: config load failed: ${errMessage(e)}\n`);
        return 2;
      }
    }
  }

  // ---- Canonical-root assertion (mlc101 R1 class, review BH-3): a split
  //      run from inside a linked worktree would probe locks and mutate
  //      DEV.md/specs in the worktree's forked universe — claimSpec
  //      already refuses this; split applies the same probe. Anything
  //      indeterminate (non-zero exit, unexpected shape) skips the check
  //      rather than blocking legitimate runs — same posture as claim.
  {
    const exec = opts.exec ?? realExec;
    const rev = exec("git", [...REV_PARSE_ARGS], { cwd: repoRoot });
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
          repoRoot,
        );
        if (rootInfo.isLinkedWorktree) {
          out(`${JSON.stringify({ error: "split-failed", stage: "validate" })}\n`);
          err(
            `devx split: repo root ${repoRoot} is a linked worktree — splits must run against the canonical main checkout at ${rootInfo.root}\n`,
          );
          return 2;
        }
      }
    }
  }

  // ---- Payload file → validated payload.
  const readFile = opts.readFile ?? ((p: string) => readFileSync(p, "utf8"));
  let payloadRaw: unknown;
  try {
    payloadRaw = JSON.parse(readFile(payloadPath));
  } catch (e) {
    out(`${JSON.stringify({ error: "split-failed", stage: "payload" })}\n`);
    err(`devx split: could not read/parse payload file '${payloadPath}': ${errMessage(e)}\n`);
    return 2;
  }

  try {
    const payload = validateSplitPayload(payloadRaw);

    // ---- Resolve the parent's type from where the spec lives (no --type
    //      flag; the follow-up always inherits).
    const resolveSpec = opts.resolveSpec ?? findSpecForHashAnyType;
    const resolution = resolveSpec(repoRoot, hash);
    if (!resolution) {
      out(`${JSON.stringify({ error: "split-failed", stage: "resolve" })}\n`);
      err(`devx split: no spec file found for hash '${hash}' in any spec type dir\n`);
      return 2;
    }
    if (!(CLAIMABLE_TYPES as readonly string[]).includes(resolution.type)) {
      out(`${JSON.stringify({ error: "split-failed", stage: "resolve" })}\n`);
      err(
        `devx split: spec '${hash}' is type '${resolution.type}' — only ${CLAIMABLE_TYPES.join("/")} specs can split\n`,
      );
      return 2;
    }

    // ---- branch-handoff precondition: the parent's recorded WIP branch
    //      must be pushed (ls-remote non-empty) BEFORE the split rewires
    //      the backlog — otherwise the follow-up records a pointer nobody
    //      can fetch (FR-4/FR-8).
    if (resolvedShape === "branch-handoff") {
      const parentBranch = parseFrontmatterBranch(readFile(resolution.path));
      if (parentBranch === null) {
        out(`${JSON.stringify({ error: "split-failed", stage: "branch-check" })}\n`);
        err(
          `devx split: parent spec has no \`branch:\` frontmatter — branch-handoff needs the recorded WIP branch\n`,
        );
        return 2;
      }
      const exec = opts.exec ?? realExec;
      const lsRemote = exec(
        "git",
        ["ls-remote", "--heads", "origin", parentBranch],
        { cwd: repoRoot },
      );
      if (lsRemote.exitCode !== 0) {
        out(`${JSON.stringify({ error: "split-failed", stage: "branch-check" })}\n`);
        err(
          `devx split: git ls-remote --heads origin ${parentBranch} failed (exit ${lsRemote.exitCode}): ${lsRemote.stderr.trim()}\n`,
        );
        return 2;
      }
      if (lsRemote.stdout.trim() === "") {
        out(`${JSON.stringify({ error: "split-failed", stage: "branch-check" })}\n`);
        err(
          `devx split: branch '${parentBranch}' not found on origin — push the WIP branch before a branch-handoff split\n`,
        );
        return 2;
      }
    }

    const result = performSplit(hash, {
      sessionToken,
      repoRoot,
      config,
      payload,
      shape: resolvedShape,
      type: resolution.type,
      ...(opts.splitOpts ?? {}),
    });
    out(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (e) {
    if (e instanceof SplitOwnershipError) {
      out(
        `${JSON.stringify({
          error: "owned-by-other-session",
          hash,
          lockOwner: e.lockOwner,
          currentSession: e.currentSession,
        })}\n`,
      );
      err(`devx split: ${e.message}\n`);
      return 3;
    }
    if (e instanceof BacklogLockTimeoutError) {
      out(
        `${JSON.stringify({ error: "backlog lock held", lockPath: e.lockPath, holderPid: e.holderPid })}\n`,
      );
      err(`devx split: ${e.message}\n`);
      return 1;
    }
    if (e instanceof AmbiguousSpecHashError) {
      out(`${JSON.stringify({ error: "split-failed", stage: "resolve" })}\n`);
      err(`devx split: ${e.message}\n`);
      return 2;
    }
    if (e instanceof SplitError) {
      out(`${JSON.stringify({ error: "split-failed", stage: e.stage })}\n`);
      err(`devx split: ${e.message}\n`);
      return 2;
    }
    out(`${JSON.stringify({ error: "split-failed", stage: "unknown" })}\n`);
    err(`devx split: unexpected error: ${errMessage(e)}\n`);
    return 2;
  }
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------
// commander wiring
// ---------------------------------------------------------------------------

export function register(program: Command): void {
  const sub = program
    .command("split")
    .description(
      "Split an in-progress spec: emit a follow-up spec + backlog row for the remaining work (mss101). merge-first (default): parent lands at reduced scope, follow-up Blocked-by parent. branch-handoff: parent superseded, follow-up inherits the pushed WIP branch. Requires the claimer's --session-token; exit 0 ok / 1 backlog-lock contention / 3 ownership mismatch / 2 other.",
    )
    .argument("<hash>", "in-progress spec hash (e.g. 'mss101')")
    .option("--payload <file>", "JSON payload file (title, remaining_acs, carried_forward)")
    .option(
      "--session-token <token>",
      "the token this session claimed with (raw sessionId or /devx-<sessionId>); never auto-derived",
    )
    .option("--shape <shape>", "merge-first (default) or branch-handoff")
    .action(
      (hash: string, options: { payload?: string; sessionToken?: string; shape?: string }) => {
        const args = [hash];
        if (options.payload !== undefined) args.push("--payload", options.payload);
        if (options.sessionToken !== undefined) {
          args.push("--session-token", options.sessionToken);
        }
        if (options.shape !== undefined) args.push("--shape", options.shape);
        const code = runSplit(args, {});
        if (code !== 0) {
          process.exit(code);
        }
      },
    );

  attachPhase(sub, 1);
}
