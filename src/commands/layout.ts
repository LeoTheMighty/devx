// `devx layout migrate --to <layout> [--dry-run]` — move a repo's artifact
// tree between the two `engine.docs_layout` shapes (docs/CONFIG.md §15).
//
// Thin driver on the `outline` / `workstream` house pattern: `register()` runs
// no logic, `.action()` calls a `runX()` that returns a number, `attachPhase`
// last. All judgment lives in `src/lib/layout/migrate.ts` — a pure planner and
// an executor that consumes its output.
//
// Exit codes (house convention):
//   0 — migrated, or `--dry-run` rendered, or already at the target layout.
//   1 — refusal: a state where moving would lose information. 0 files moved,
//       `git status` byte-identical before and after. There is NO `--force`.
//       `not-a-git-repo` lands here too: a rename git cannot see severs every
//       artifact's history, so it is a refusal rather than an fs.rename
//       fallback (AC 6), even though "you are not in a git repo" reads like
//       an environment error.
//   2 — usage (unknown/missing `--to`), context/config failure (no
//       devx.config.yaml), or an abort AFTER files moved — the message
//       carries the recovery command.
//
// R-5: not revert-safe for a repo that ran it. `--dry-run` first, always.
//
// Spec: dev/dev-dlr106-2026-09-02T09:14-layout-migrate.md
// Plan: _devx/workstreams/docs-layout-resolution/plan/agent.md §6

import type { Command } from "commander";

import { attachPhase } from "../lib/help.js";
import { findProjectConfig } from "../lib/config-io.js";
import { type Exec, realExec } from "../lib/exec.js";
import { loadEngineContext } from "../lib/engine/context.js";
import { DOCS_LAYOUTS, type DocsLayout } from "../lib/engine/artifacts.js";
import {
  MigrationAborted,
  MigrationRefused,
  type MigrateFs,
  type MigrateWriteFs,
  type Refusal,
  dirtyTreeRefusal,
  executeMigration,
  nestedRepoRootRefusal,
  planLayoutMigration,
  realMigrateFs,
  realMigrateWriteFs,
  renderMovePlan,
  untrackedSourcesRefusal,
} from "../lib/layout/migrate.js";

export interface RunLayoutMigrateOpts {
  out?: (s: string) => void;
  err?: (s: string) => void;
  /** Test seam: explicit project config path (skip the findProjectConfig walk). */
  projectPath?: string;
  fs?: Partial<MigrateFs>;
  writeFs?: Partial<MigrateWriteFs>;
  exec?: Exec;
}

const asLayout = (v: string): DocsLayout | null =>
  (DOCS_LAYOUTS as readonly string[]).includes(v) ? (v as DocsLayout) : null;

/** One refusal, rendered for a human who has to act on it. The code leads so
 *  the sentence can be grepped for; the paths follow so the operator can look
 *  at what was found instead of re-deriving it. */
function renderRefusal(r: Refusal): string {
  const head = `devx layout migrate: refused [${r.code}] — ${r.message}\n`;
  if (!r.paths || r.paths.length === 0) return head;
  // Bounded: a dirty tree can carry thousands of paths, and a refusal that
  // scrolls the reason off the screen is a refusal nobody reads.
  const shown = r.paths.slice(0, 20);
  const more =
    r.paths.length > shown.length
      ? `  … and ${r.paths.length - shown.length} more\n`
      : "";
  return `${head}${shown.map((p) => `  ${p}\n`).join("")}${more}`;
}

export function runLayoutMigrate(
  flags: { to?: string; dryRun?: boolean },
  opts: RunLayoutMigrateOpts = {},
): number {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const err = opts.err ?? ((s) => process.stderr.write(s));
  const exec = opts.exec ?? realExec;
  const fs: MigrateFs = { ...realMigrateFs, ...(opts.fs ?? {}) };
  const writeFs: MigrateWriteFs = { ...realMigrateWriteFs, ...(opts.writeFs ?? {}) };

  if (flags.to === undefined || flags.to.trim() === "") {
    err(
      `usage: devx layout migrate --to <${DOCS_LAYOUTS.join("|")}> [--dry-run]\n`,
    );
    return 2;
  }
  const target = asLayout(flags.to.trim());
  if (target === null) {
    err(
      `devx layout migrate: unknown layout '${flags.to}' — expected one of ${DOCS_LAYOUTS.join(", ")}\n`,
    );
    return 2;
  }

  const configPath = opts.projectPath ?? findProjectConfig();
  if (configPath === null) {
    err("devx layout migrate: devx.config.yaml not found (walked up from cwd)\n");
    return 2;
  }
  const ctx = loadEngineContext(configPath);
  if (!ctx.ok) {
    err(`devx layout migrate: ${ctx.error}\n`);
    return 2;
  }
  const { repoRoot, engine } = ctx.ctx;

  const plan = planLayoutMigration(fs, repoRoot, engine, target);
  // Migrating to the layout you are already in is a no-op, not a refusal, and
  // it is checked before git is consulted: a repo already in the target shape
  // has nothing to lose, so a dirty tree is not this command's business.
  //
  // Unless config and disk disagree. Then "nothing to migrate" is true of the
  // config and false of the repo, and BOTH `--to` values are dead ends — so it
  // exits 1 with the mismatch named rather than 0 with a reassurance.
  if (plan.noop) {
    out(renderMovePlan(plan));
    return plan.treeMismatch === null ? 0 : 1;
  }

  // Every refusal the state has earned, not just the first — an operator with
  // three of them should fix three, rather than discovering them one run at a
  // time. (The planner still short-circuits its STRUCTURAL refusals, the ones
  // that make the rest uncomputable; it says so where it does.)
  //
  // The three git-backed predicates are folded in here because they are the
  // repo state a pure function cannot see. `untracked-sources` in particular
  // has to be evaluated HERE and not only inside the executor: it is the one
  // refusal `--dry-run` used to sail past, which made the dry run a liar about
  // the only thing it exists to predict.
  const refusals: Refusal[] = [...plan.refusals];
  const nested = nestedRepoRootRefusal(exec, repoRoot);
  if (nested !== null) refusals.push(nested);
  const dirty = dirtyTreeRefusal(exec, repoRoot);
  if (dirty !== null) refusals.push(dirty);
  const untracked = untrackedSourcesRefusal(exec, repoRoot, plan.moves);
  // A non-git directory earns one message, not two: `dirtyTreeRefusal` already
  // reported it with the same code.
  if (untracked !== null && !(untracked.code === "not-a-git-repo" && dirty !== null)) {
    refusals.push(untracked);
  }

  if (refusals.length > 0) {
    for (const r of refusals) err(renderRefusal(r));
    err(
      "devx layout migrate: nothing was moved. There is no --force: every refusal above " +
        "names a state where migrating loses information.\n",
    );
    return 1;
  }

  // The refusal set is evaluated identically for a dry run — a `--dry-run`
  // that succeeds where the real run would refuse is a dry run that lied, and
  // predicting the real run is its entire job.
  if (flags.dryRun === true) {
    out(renderMovePlan(plan));
    out(`dry run — 0 of ${plan.moves.length} file(s) moved\n`);
    return 0;
  }

  try {
    const result = executeMigration({
      repoRoot,
      plan,
      configPath,
      exec,
      fs,
      writeFs,
    });
    out(renderMovePlan(plan));
    out(
      `${JSON.stringify({
        from: plan.from,
        to: plan.to,
        moved: result.moved.length,
        // Emptied source directories this run removed. Reported because a
        // delete nobody reported is a delete nobody can audit.
        pruned: result.pruned,
        spec: result.specRewritten,
        workstream: plan.workstreamRel,
        config: result.configWritten,
      })}\n`,
    );
    err(
      "devx layout migrate: this is NOT revert-safe — reverting a commit does not un-migrate a tree. " +
        `To go back, run \`devx layout migrate --to ${plan.from}\`.\n`,
    );
    return 0;
  } catch (e) {
    if (e instanceof MigrationRefused) {
      err(renderRefusal(e.refusal));
      err("devx layout migrate: nothing was moved.\n");
      return 1;
    }
    if (e instanceof MigrationAborted) {
      err(`devx layout migrate: ${e.message}\n`);
      return 2;
    }
    err(
      `devx layout migrate: unexpected failure: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    return 2;
  }
}

// ---------------------------------------------------------------------------
// registration
// ---------------------------------------------------------------------------

export function register(program: Command): void {
  const sub = program
    .command("layout")
    .description(
      "Artifact-tree layout operations (engine.docs_layout). `migrate --to <layout>` moves the doc set between the workstream and project-level shapes with `git mv`.",
    );

  sub
    .command("migrate")
    .description(
      "Move the doc set to another engine.docs_layout: git mv the artifacts, re-point the plan spec's `workstream:`, then write the config. Refuses (exit 1, 0 files moved) on: two-live-workstreams, no-workstream, multiple-doc-sets, destination-occupied, destination-clash, unmapped-doc-set-files, destination-outside-repo, dirty-tree, untracked-sources, nested-repo-root, not-a-git-repo. There is no --force — each one names a state where moving loses information. NOT revert-safe: use --dry-run first.",
    )
    // `.option`, not `.requiredOption`: commander's required-option failure
    // exits 1, and 1 is this command's REFUSAL code. A missing flag is usage,
    // so the arity check lives in `runLayoutMigrate` where it can exit 2.
    // (Same reasoning as `src/commands/devx-helper.ts`.)
    .option("--to <layout>", `target layout: ${DOCS_LAYOUTS.join(" | ")}`)
    .option("--dry-run", "render the moves without making any of them")
    .action((cmdOpts: { to?: string; dryRun?: boolean }) => {
      const code = runLayoutMigrate({
        to: cmdOpts.to,
        dryRun: cmdOpts.dryRun,
      });
      if (code !== 0) process.exit(code);
    });

  attachPhase(sub, 1);
}
