// `devx archive <hash|slug> [--restore] [--dry-run]` — move a CLOSED doc set
// out of the live tree, and back (arc101).
//
// Same house pattern as `devx layout migrate`, which it shares its executor
// with: `register()` runs no logic, `.action()` calls a `runX()` returning a
// number, `attachPhase` last. All judgment lives in `src/lib/archive/plan.ts`
// (the planner) and `src/lib/layout/migrate.ts` (the mover).
//
// Exit codes (house convention):
//   0 — archived/restored, or `--dry-run` rendered.
//   1 — refusal: a state where moving would lose information. 0 files moved,
//       `git status` byte-identical before and after. There is NO `--force`.
//   2 — usage, context/config failure, or an abort AFTER files moved — the
//       message carries the recovery command.
//
// Unlike `layout migrate` this changes NO layout, so it writes no config
// (`setLayout: null`). It is revert-safe in the ordinary sense — the inverse
// is `--restore` — but the same clean-tree precondition applies, because the
// recovery DURING a failed run is still `git reset --hard HEAD`.
//
// Spec: dev/dev-arc101-2026-09-03T11:00-devx-archive.md

import type { Command } from "commander";

import { attachPhase } from "../lib/help.js";
import { findProjectConfig } from "../lib/config-io.js";
import { type Exec, realExec } from "../lib/exec.js";
import { loadEngineContext } from "../lib/engine/context.js";
import { planArchive, renderArchivePlan } from "../lib/archive/plan.js";
import {
  MigrationAborted,
  MigrationRefused,
  type MigrateFs,
  type MigrateWriteFs,
  type Refusal,
  dirtyTreeRefusal,
  executeMigration,
  nestedRepoRootRefusal,
  realMigrateFs,
  realMigrateWriteFs,
  untrackedSourcesRefusal,
} from "../lib/layout/migrate.js";

export interface RunArchiveOpts {
  out?: (s: string) => void;
  err?: (s: string) => void;
  /** Test seam: explicit project config path (skip the findProjectConfig walk). */
  projectPath?: string;
  fs?: Partial<MigrateFs>;
  writeFs?: Partial<MigrateWriteFs>;
  exec?: Exec;
}

/** One refusal, rendered for a human who has to act on it. Bounded path list
 *  for the same reason `layout migrate`'s is: a refusal that scrolls its own
 *  reason off the screen is a refusal nobody reads. */
function renderRefusal(r: Refusal): string {
  const head = `devx archive: refused [${r.code}] — ${r.message}\n`;
  if (!r.paths || r.paths.length === 0) return head;
  const shown = r.paths.slice(0, 20);
  const more =
    r.paths.length > shown.length
      ? `  … and ${r.paths.length - shown.length} more\n`
      : "";
  return `${head}${shown.map((p) => `  ${p}\n`).join("")}${more}`;
}

export function runArchive(
  args: string[],
  flags: { restore?: boolean; dryRun?: boolean },
  opts: RunArchiveOpts = {},
): number {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const err = opts.err ?? ((s) => process.stderr.write(s));
  const exec = opts.exec ?? realExec;
  const fs: MigrateFs = { ...realMigrateFs, ...(opts.fs ?? {}) };
  const writeFs: MigrateWriteFs = { ...realMigrateWriteFs, ...(opts.writeFs ?? {}) };
  const restore = flags.restore === true;

  const target = args[0];
  if (target === undefined || target.trim() === "") {
    err("usage: devx archive <hash|slug> [--restore] [--dry-run]\n");
    return 2;
  }

  const configPath = opts.projectPath ?? findProjectConfig();
  if (configPath === null) {
    err("devx archive: devx.config.yaml not found (walked up from cwd)\n");
    return 2;
  }
  const ctx = loadEngineContext(configPath);
  if (!ctx.ok) {
    err(`devx archive: ${ctx.error}\n`);
    return 2;
  }
  const { repoRoot, engine } = ctx.ctx;

  const plan = planArchive({
    fs,
    repoRoot,
    engine,
    target: target.trim(),
    restore,
  });

  // Every refusal the state has earned, not just the first. The three
  // git-backed predicates are folded in here because they are repo state a
  // pure planner cannot see — and `untracked-sources` in particular has to be
  // evaluated for `--dry-run` too, or the dry run lies about the one thing it
  // exists to predict.
  const refusals: Refusal[] = [...plan.refusals];
  if (refusals.length === 0 || plan.moves.length > 0) {
    const nested = nestedRepoRootRefusal(exec, repoRoot);
    if (nested !== null) refusals.push(nested);
    const dirty = dirtyTreeRefusal(exec, repoRoot);
    if (dirty !== null) refusals.push(dirty);
    const untracked = untrackedSourcesRefusal(exec, repoRoot, plan.moves);
    if (untracked !== null && !(untracked.code === "not-a-git-repo" && dirty !== null)) {
      refusals.push(untracked);
    }
  }

  if (refusals.length > 0) {
    for (const r of refusals) err(renderRefusal(r));
    err(
      "devx archive: nothing was moved. There is no --force: every refusal above names a " +
        "state where moving loses information.\n",
    );
    return 1;
  }

  if (flags.dryRun === true) {
    out(`${renderArchivePlan(plan, restore)}\n`);
    out(`dry run — 0 of ${plan.moves.length} file(s) moved\n`);
    return 0;
  }

  try {
    // `setLayout: null` — archiving moves a doc set, never a layout. Writing
    // `engine.docs_layout` here would record a change that did not happen.
    const result = executeMigration({
      repoRoot,
      plan,
      configPath,
      exec,
      fs,
      writeFs,
      setLayout: null,
    });
    out(`${renderArchivePlan(plan, restore)}\n`);
    out(
      `${JSON.stringify({
        action: restore ? "restore" : "archive",
        slug: plan.slug,
        moved: result.moved.length,
        pruned: result.pruned,
        spec: result.specRewritten,
        workstream: plan.workstreamRel,
      })}\n`,
    );
    if (!restore) {
      err(
        `devx archive: '${plan.slug}' is archived. Its artifacts still resolve — the plan ` +
          "spec now points at them — so `devx status` and `devx outcome` keep working. " +
          "Undo with `devx archive " +
          `${plan.slug} --restore\`.\n`,
      );
    }
    return 0;
  } catch (e) {
    if (e instanceof MigrationRefused) {
      err(renderRefusal(e.refusal));
      err("devx archive: nothing was moved.\n");
      return 1;
    }
    if (e instanceof MigrationAborted) {
      err(`devx archive: ${e.message}\n`);
      return 2;
    }
    throw e;
  }
}

export function register(program: Command): void {
  const cmd = program
    .command("archive")
    .description(
      "Move a CLOSED workstream's doc set to engine.archive_root (and back with --restore), so the live tree lists what is in flight rather than everything ever worked on. `git mv`, then the plan spec's `workstream:` is re-pointed so the artifacts still resolve. Refuses (exit 1, 0 files moved) on: workstream-live, destination-occupied, no-workstream, unmapped-doc-set-files, dirty-tree, untracked-sources, nested-repo-root, not-a-git-repo. There is no --force.",
    )
    .argument("<target>", "plan-spec hash or workstream slug")
    .option("--restore", "move it back out of the archive")
    .option("--dry-run", "render the moves without making any of them")
    .action((target: string, cmdOpts: { restore?: boolean; dryRun?: boolean }) => {
      const code = runArchive([target], {
        restore: cmdOpts.restore,
        dryRun: cmdOpts.dryRun,
      });
      if (code !== 0) process.exit(code);
    });

  attachPhase(cmd, 1);
}
