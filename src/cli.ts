#!/usr/bin/env node
// devx CLI entrypoint (cli301 scaffold).
//
// Commander dispatches via a static registration array. cli302 fills in the
// 10 stub commands, cfg204 wires `devx config` (real), and cli303 formats the
// `--help` listing. Until then, `devx` exposes only the global flags
// (--help / --version) — but the surface is in place so every later phase
// just appends to `commands` below.
//
// Static array (not glob discovery) per epic-cli-skeleton: explicit beats
// implicit; one file per command tested independently.
//
// Spec: dev/dev-cli301-2026-04-26T19:35-cli-package-scaffold.md

import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";

import * as configCommand from "./commands/config.js";

interface CommandModule {
  register(program: Command): void;
}

const commands: CommandModule[] = [
  // cli302 will append the 10 stub commands above/below this line.
  configCommand,
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
