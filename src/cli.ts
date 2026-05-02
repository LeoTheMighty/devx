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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";

import * as askCommand from "./commands/ask.js";
import * as configCommand from "./commands/config.js";
import * as ejectCommand from "./commands/eject.js";
import * as initCommand from "./commands/init.js";
import * as killCommand from "./commands/kill.js";
import * as mergeGateCommand from "./commands/merge-gate.js";
import * as pauseCommand from "./commands/pause.js";
import * as planHelperCommand from "./commands/plan-helper.js";
import * as prBodyCommand from "./commands/pr-body.js";
import * as restartCommand from "./commands/restart.js";
import * as resumeCommand from "./commands/resume.js";
import * as serveCommand from "./commands/serve.js";
import * as statusCommand from "./commands/status.js";
import * as tailCommand from "./commands/tail.js";
import * as uiCommand from "./commands/ui.js";

import { installPhaseSortedHelp } from "./lib/help.js";

interface CommandModule {
  register(program: Command): void;
}

const commands: CommandModule[] = [
  askCommand,
  configCommand,
  ejectCommand,
  initCommand,
  killCommand,
  mergeGateCommand,
  pauseCommand,
  planHelperCommand,
  prBodyCommand,
  restartCommand,
  resumeCommand,
  serveCommand,
  statusCommand,
  tailCommand,
  uiCommand,
];

function readPackageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // From dist/cli.js → ../package.json. From src/cli.ts (vitest) → ../package.json.
  const pkgPath = join(here, "..", "package.json");
  const raw = readFileSync(pkgPath, "utf8");
  const parsed = JSON.parse(raw) as { version?: unknown };
  if (typeof parsed.version !== "string") {
    throw new Error(`package.json at ${pkgPath} has no string "version" field`);
  }
  return parsed.version;
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("devx")
    .description("devx — autonomous development system built on BMAD")
    .version(readPackageVersion());

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

if (isMainEntry()) {
  buildProgram()
    .parseAsync(process.argv)
    .catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
}
