// `devx workstream new <slug> [--hash <hash>]` — CLI passthrough for the
// workstream scaffolder (v2e101). Mirrors the merge-gate/plan-helper
// pattern: thin driver, JSON on stdout, diagnostics on stderr.
//
// Exit codes:
//   0 — scaffolded (or clean no-op re-run; `noop: true` in the JSON).
//   1 — refusal: slug/hash conflict with existing state (dir claimed by a
//       different spec, spec bound to a different dir, dir with no spec
//       and no --hash). Nothing written.
//   2 — error: invalid slug/hash, missing engine templates, config load
//       failure.
//
// Spec: dev/dev-v2e101-2026-07-05T13:01-engine-cli-primitives.md
// Design: v2/02-engine.md §3, §8

import type { Command } from "commander";

import { attachPhase } from "../lib/help.js";
import { type Exec, realExec } from "../lib/exec.js";
import { loadEngineContext } from "../lib/engine/context.js";
import { baseBranchFrom } from "../lib/engine/outline.js";
import { PlanScopeError, checkStoryPlanScope, storyFromBranch } from "../lib/engine/plan-scope.js";
import {
  type EngineFs,
  WorkstreamError,
  WorkstreamRefusal,
  createWorkstream,
} from "../lib/engine/workstream.js";

export interface RunWorkstreamNewOpts {
  out?: (s: string) => void;
  err?: (s: string) => void;
  /** Test seam: explicit project config path (skip findProjectConfig walk). */
  projectPath?: string;
  fs?: Partial<EngineFs>;
  now?: () => Date;
}

export function runWorkstreamNew(
  args: string[],
  flags: { hash?: string },
  opts: RunWorkstreamNewOpts = {},
): number {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const err = opts.err ?? ((s) => process.stderr.write(s));

  // The arity check does NOT live here any more (dlr104). A missing slug is a
  // refusal under `workstream` and perfectly legal under `project-level`, and
  // only `createWorkstream` knows which — so the decision goes where the
  // layout is, and the message can name `engine.docs_layout` as the reason.
  if (args.length > 1) {
    err("usage: devx workstream new [slug] [--hash <hash>]\n");
    return 2;
  }
  // An explicitly EMPTY slug is absent, not a slug. Without this,
  // `devx workstream new ""` gives commander `args.length === 1`, so the
  // project-level default never runs and it exits 2 with `invalid slug ''` —
  // under the one layout where the slug is optional (review EC#8).
  const slug = args.length === 1 && args[0].trim() !== "" ? args[0] : undefined;

  const ctx = loadEngineContext(opts.projectPath);
  if (!ctx.ok) {
    err(`devx workstream new: ${ctx.error}\n`);
    return 2;
  }

  try {
    const result = createWorkstream({
      repoRoot: ctx.ctx.repoRoot,
      slug,
      hash: flags.hash,
      engine: ctx.ctx.engine,
      now: opts.now,
      fs: opts.fs,
    });
    out(`${JSON.stringify(result)}\n`);
    if (result.noop) {
      err(
        `devx workstream new: '${result.slug}' already scaffolded — nothing to do\n`,
      );
    }
    return 0;
  } catch (e) {
    if (e instanceof WorkstreamRefusal) {
      err(`devx workstream new: ${e.message}\n`);
      // A missing slug is the one refusal E-5 pins at exit 1 — it is the
      // engine saying no to a valid request, and the flat layout accepts the
      // same invocation. Every other refusal keeps 1 as it always did.
      return 1;
    }
    if (e instanceof WorkstreamError) {
      err(`devx workstream new: ${e.message}\n`);
      return 2;
    }
    err(
      `devx workstream new: unexpected failure: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    return 2;
  }
}

// ---------------------------------------------------------------------------
// scope-check (debug-2d6fc1)
// ---------------------------------------------------------------------------

export interface RunScopeCheckOpts {
  out?: (s: string) => void;
  err?: (s: string) => void;
  projectPath?: string;
  exec?: Exec;
  env?: Record<string, string | undefined>;
}

/**
 * `devx workstream scope-check [--diff <range>] [--story <hash>]`
 *
 * Fails (exit 1) when a workstream story's diff edits `plan/agent.md` lines
 * outside the story's own phase. The one allowed crossing: flipping another
 * phase's checklist row to `[x]` when that phase's spec is already `done` at
 * the base. Exit 0 = in scope, or not a workstream-phase story. Exit 2 =
 * could not tell (fail closed, like `devx outline check`).
 *
 * Runs in CI because CI is the gate a hand-merge still respects. The story
 * comes from `--story`, else `GITHUB_HEAD_REF`, else the current branch.
 */
export function runScopeCheck(
  flags: { diff?: string; story?: string },
  opts: RunScopeCheckOpts = {},
): number {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const err = opts.err ?? ((s) => process.stderr.write(s));
  const exec = opts.exec ?? realExec;
  const env = opts.env ?? process.env;
  const ctx = loadEngineContext(opts.projectPath);
  if (!ctx.ok) {
    err(`devx workstream scope-check: ${ctx.error}\n`);
    return 2;
  }
  const repoRoot = ctx.ctx.repoRoot;
  const git = (args: string[]) => exec("git", args, { cwd: repoRoot });

  const range = flags.diff ?? `origin/${baseBranchFrom(ctx.ctx.merged)}...HEAD`;
  const three = range.includes("...");
  const dots = three ? "..." : range.includes("..") ? ".." : null;
  if (dots === null) {
    err(`devx workstream scope-check: --diff needs a range (A...B or A..B), got '${range}'\n`);
    return 2;
  }
  const lhs = range.slice(0, range.indexOf(dots)).trim() || "HEAD";
  const head = range.slice(range.indexOf(dots) + dots.length).trim() || "HEAD";
  let base = lhs;
  if (three) {
    // A three-dot range diffs from the merge base, exactly as git does.
    const mb = git(["merge-base", lhs, head]);
    // (Two-dot ranges are validated inside the check: an unknown rev there is
    // exit 2, never a silent "nothing changed" — review round 1.)
    if (mb.exitCode !== 0) {
      err(`devx workstream scope-check: no merge base for '${range}': ${mb.stderr.trim()}\n`);
      return 2;
    }
    base = mb.stdout.trim();
  }

  let story = flags.story ?? null;
  if (story === null) {
    const branch =
      env.GITHUB_HEAD_REF && env.GITHUB_HEAD_REF.trim() !== ""
        ? env.GITHUB_HEAD_REF
        : git(["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim();
    story = storyFromBranch(branch);
    if (story === null) {
      // Non-story branches (planning, archival) are where whole-plan edits
      // legitimately happen, so they are skipped — but said out loud.
      out(`${JSON.stringify({ skipped: `branch '${branch}' is not a story branch` })}\n`);
      return 0;
    }
  }

  let report;
  try {
    report = checkStoryPlanScope({ repoRoot, base, head, story, exec });
  } catch (e) {
    if (e instanceof PlanScopeError) {
      err(`devx workstream scope-check: ${e.message}\n`);
      return 2;
    }
    throw e;
  }
  out(`${JSON.stringify(report)}\n`);
  if (report.unscoped.length > 0) {
    err(
      `devx workstream scope-check: WARN — ${report.skipped ?? "this story has no phase"}, but the diff changes ${report.unscoped.join(", ")}. ` +
        "Nothing holds it to a phase; make sure none of it is another session's work.\n",
    );
  }
  if (report.skipped !== null || report.files.length === 0) return 0;

  err(
    `devx workstream scope-check: story '${story}' (phase ${report.ownPhase}) edits plan lines outside its own phase.\n` +
      "A story trues only its own phase's rows; anything wider is a revision (`devx revise`). " +
      "The usual cause is carrying main's working copy of a shared plan/agent.md into the branch, " +
      "which brings every other session's uncommitted edits with it (debug-2d6fc1). " +
      "Edit the worktree's copy instead.\n",
  );
  for (const f of report.files) {
    if (f.reason !== null) {
      err(`  ${f.path}: ${f.reason}\n`);
      continue;
    }
    for (const v of f.violations.slice(0, 12)) {
      const where = v.phase === null ? "outside every phase" : `phase ${v.phase}`;
      err(`  ${f.path}:${v.line} ${v.side === "added" ? "+" : "-"} [${where}] ${v.text.slice(0, 100)}\n`);
    }
    if (f.violations.length > 12) err(`  … and ${f.violations.length - 12} more in ${f.path}\n`);
  }
  return 1;
}

export function register(program: Command): void {
  const sub = program
    .command("workstream")
    .description(
      "Workstream operations (v2 engine). `new <slug>` scaffolds _devx/workstreams/<slug>/ + the plan spec's engine frontmatter.",
    );

  sub
    .command("new")
    .description(
      "Scaffold a workstream: the PRD + expectations from templates, empty decisions/checkpoints/evals, plan-spec engine frontmatter. Idempotent. Artifact names follow `engine.docs_layout`.",
    )
    .argument(
      "[slug]",
      "workstream slug (kebab-case, ≤50 chars) — optional under `engine.docs_layout: project-level`",
    )
    .option("--hash <hash>", "bind an existing plan spec instead of creating one")
    .action((slug: string | undefined, cmdOpts: { hash?: string }) => {
      const code = runWorkstreamNew(slug === undefined ? [] : [slug], {
        hash: cmdOpts.hash,
      });
      if (code !== 0) process.exit(code);
    });

  sub
    .command("scope-check")
    .description(
      "Fail (exit 1) when a workstream story's diff edits plan/agent.md outside its own phase — the capture of another session's work that debug-2d6fc1 found. Exit 2 = could not tell (fail closed).",
    )
    .option("--diff <range>", "git diff range (default origin/<base>...HEAD)")
    .option("--story <hash>", "the story hash (default: from GITHUB_HEAD_REF or the current branch)")
    .action((cmdOpts: { diff?: string; story?: string }) => {
      const code = runScopeCheck({ diff: cmdOpts.diff, story: cmdOpts.story });
      if (code !== 0) process.exit(code);
    });

  attachPhase(sub, 1);
}
