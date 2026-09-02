#!/usr/bin/env node
// devx CLI entrypoint (cli301 scaffold; cli302 wired the 10 stubs).
//
// Commander dispatches via a static registration array. cli302 wired the 10
// stub commands (`ui`, `serve`, `tail`, `kill`, `restart`, `status`, `pause`,
// `resume`, `ask`, `eject`); cfg204 wired `devx config` (real); cli303 formats
// the `--help` listing. Static array (not glob discovery) per
// epic-cli-skeleton: explicit beats implicit; one file per command tested
// independently.
//
// Registration order is alphabetical by command name. cli303 owns the
// help-text re-sort (by phase ascending; ties broken alphabetically), so the
// order here is purely for grep-friendliness, not user-facing layout.
//
// Spec: dev/dev-cli301-2026-04-26T19:35-cli-package-scaffold.md
// Spec: dev/dev-cli302-2026-04-26T19:35-cli-stubs.md
// Spec: dev/dev-cli303-2026-04-26T19:35-cli-help-listing.md

import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";

import * as askCommand from "./commands/ask.js";
import * as configCommand from "./commands/config.js";
import * as doctorCommand from "./commands/doctor.js";
import * as devxHelperCommand from "./commands/devx-helper.js";
import * as ejectCommand from "./commands/eject.js";
import * as gateCommand from "./commands/gate.js";
import * as graphCommand from "./commands/graph.js";
import * as initCommand from "./commands/init.js";
import * as killCommand from "./commands/kill.js";
import * as layoutCommand from "./commands/layout.js";
import * as learnHelperCommand from "./commands/learn-helper.js";
import * as learnWatchCommand from "./commands/learn-watch.js";
import * as loopCommand from "./commands/loop.js";
import * as manageCommand from "./commands/manage.js";
import * as mergeGateCommand from "./commands/merge-gate.js";
import * as nextCommand from "./commands/next.js";
import * as outcomeCommand from "./commands/outcome.js";
import * as outlineCommand from "./commands/outline.js";
import * as pauseCommand from "./commands/pause.js";
import * as planHelperCommand from "./commands/plan-helper.js";
import * as prBodyCommand from "./commands/pr-body.js";
import * as restartCommand from "./commands/restart.js";
import * as resumeCommand from "./commands/resume.js";
import * as reviseCommand from "./commands/revise.js";
import * as serveCommand from "./commands/serve.js";
import * as splitCommand from "./commands/split.js";
import * as statusCommand from "./commands/status.js";
import * as tailCommand from "./commands/tail.js";
import * as todoCommand from "./commands/todo.js";
import * as uiCommand from "./commands/ui.js";
import * as workstreamCommand from "./commands/workstream.js";

import { isBuildStale, staleBuildWarning } from "./lib/devx/finalize.js";
import { installPhaseSortedHelp } from "./lib/help.js";
import { resolveVersion } from "./lib/version.js";

interface CommandModule {
  register(program: Command): void;
}

const commands: CommandModule[] = [
  askCommand,
  configCommand,
  devxHelperCommand,
  doctorCommand,
  ejectCommand,
  gateCommand,
  graphCommand,
  initCommand,
  killCommand,
  layoutCommand,
  learnHelperCommand,
  learnWatchCommand,
  loopCommand,
  manageCommand,
  mergeGateCommand,
  nextCommand,
  outcomeCommand,
  outlineCommand,
  pauseCommand,
  planHelperCommand,
  prBodyCommand,
  restartCommand,
  resumeCommand,
  reviseCommand,
  serveCommand,
  splitCommand,
  statusCommand,
  tailCommand,
  todoCommand,
  uiCommand,
  workstreamCommand,
];



export function buildProgram(): Command {
  const program = new Command();
  program
    .name("devx")
    .description("devx — self-contained closed-loop autonomous development system")
    .version(resolveVersion());

  for (const cmd of commands) {
    cmd.register(program);
  }

  // cli303: re-sort `--help` subcommands by phase ascending; ties alphabetical.
  // Each command's register() called attachPhase() with its target phase
  // (config = 0; stubs carry their (phase, epic) from cli302).
  installPhaseSortedHelp(program);

  return program;
}

function isMainEntry(): boolean {
  // npm's global install ships `devx` as a symlink in the user's PATH dir
  // (~/.npm-global/bin/devx → …/node_modules/@devx/cli/dist/cli.js). Node
  // sets process.argv[1] to the symlink path, while import.meta.url resolves
  // to the real file. realpathSync both sides so the equality check holds.
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    const here = realpathSync(fileURLToPath(import.meta.url));
    const invoked = realpathSync(argv1);
    return here === invoked;
  } catch {
    return false;
  }
}

/**
 * Warn once, on stderr, when this CLI is running a build older than the
 * checkout's HEAD (b931a1 / LEARN.md § multi-loop-concurrency E2).
 *
 * `devx` on PATH resolves to the main worktree's gitignored `dist/`, but a
 * story's local gate rebuilds its WORKTREE's dist — so merged work is
 * routinely unreachable from the CLI `/devx` itself invokes. `devx
 * devx-helper finalize` now refreshes it after every merge; this is the
 * backstop for every other way a build goes stale (a hand `git pull`, a
 * branch checkout, a reset).
 *
 * Three deliberate constraints, because a warning that fires wrongly gets
 * trained away:
 *   • Never on a self-answer of "unknowable" — isBuildStale returns null for
 *     a tsx/src run, a tarball install, or a repo with no reflog.
 *   • Never under vitest: the suite asserts on stderr in dozens of places,
 *     and a global banner would be a fixture edit disguised as a feature.
 *   • Suppressible with DEVX_NO_STALE_WARN, for scripts that parse stderr.
 *
 * Cost matters: this runs before EVERY subcommand. It is two stat() calls
 * and no subprocess — deliberately not `git rev-parse HEAD` against the sha
 * in build-info.json, which would put a ~150ms process spawn in front of a
 * CLI whose whole value is being cheap to call.
 */
export interface StaleWarnDeps {
  /** Where the warning goes. Default: process.stderr. */
  write?: (s: string) => void;
  /** Env to consult for the two suppressions. Default: process.env. */
  env?: Record<string, string | undefined>;
  /** Directory of the executing module. Default: this file's. Tests point it
   *  at a fixture so the `dist` check and the repoRoot derivation are
   *  exercised rather than mocked away. */
  moduleDir?: string;
  /** Staleness predicate. Default: the real one. */
  stale?: (repoRoot: string) => boolean | null;
}

export function warnIfBuildStale(deps: StaleWarnDeps = {}): void {
  const env = deps.env ?? process.env;
  if (env.DEVX_NO_STALE_WARN) return;
  if (env.VITEST) return;
  const write = deps.write ?? ((s: string) => process.stderr.write(s));
  const stale = deps.stale ?? ((r: string) => isBuildStale(r));
  try {
    const here = deps.moduleDir ?? dirname(fileURLToPath(import.meta.url));
    // Running from `src/` under tsx/vitest is not a stale build — it is not
    // a build at all. `here` resolves to the repo root identically from
    // `src/` and `dist/`, so without this check a tsx run would read the
    // (possibly ancient) `dist/build-info.json` and warn about code it is
    // not executing.
    if (basename(here) !== "dist") return;
    // The package root of the build ACTUALLY EXECUTING — not the cwd's
    // project. `dist/cli.js` → `../..`, the same derivation resolveVersion
    // uses. This is what makes the warning correct when a session runs
    // `devx` from inside `.worktrees/<hash>`: the binary on PATH is the MAIN
    // checkout's, so main's HEAD is the thing it can be stale against.
    const repoRoot = join(here, "..");
    if (stale(repoRoot) === true) {
      write(staleBuildWarning(repoRoot));
    }
  } catch {
    // A staleness check must never be the thing that breaks the CLI.
  }
}

if (isMainEntry()) {
  warnIfBuildStale();
  buildProgram()
    .parseAsync(process.argv)
    .catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
}
