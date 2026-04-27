// Stub command helper (cli302).
//
// Phase 0 ships the *surface area* of the devx CLI: every subcommand exists,
// even when the behavior won't land for several phases. Stubs print a single
// canonical line to stderr and exit 0 so that:
//
//   • shell pipelines, cron jobs, launchd / systemd units, and CI scripts can
//     reference `devx <subcmd>` today without breaking when wired-up later;
//   • `devx --help` (cli303) can list every command with its (phase, epic)
//     annotation derived from the same registration data;
//   • the eject stub in particular does ABSOLUTELY NOTHING — Leonid's #1 red
//     flag is destructive surprise, so the eject command in Phase 0 is a pure
//     stderr-write with zero side effects. The test in
//     test/eject-noop.test.ts pins this property.
//
// Spec: dev/dev-cli302-2026-04-26T19:35-cli-stubs.md
// Epic: _bmad-output/planning-artifacts/epic-cli-skeleton.md

import type { Command } from "commander";

import { attachPhase } from "./help.js";

/** Canonical wiring message — must stay byte-identical to the AC. */
export function stubMessage(phase: number, epic: string): string {
  return `not yet wired — ships in Phase ${phase} (${epic})`;
}

/**
 * A stub handler. Writes the canonical line + trailing newline to the supplied
 * sink (defaults to `process.stderr`) and returns. Tests pass an in-memory
 * sink to capture output without touching real stderr; production callers
 * (commander `.action`) just call `handler()` with no args.
 *
 * The handler does NOT call process.exit — commander's normal "action returns
 * successfully → exit 0" path is what gives stubs their exit code. Calling
 * exit explicitly here would race the stderr drain and could truncate the
 * message.
 */
export type StubHandler = (write?: (s: string) => void) => void;

export function makeStub(phase: number, epic: string): StubHandler {
  return (write) => {
    const sink = write ?? ((s: string) => process.stderr.write(s));
    sink(`${stubMessage(phase, epic)}\n`);
  };
}

export interface StubCommandModule {
  /** Subcommand name as it appears on the CLI (`ui`, `eject`, …). */
  readonly name: string;
  /** Target devx phase from docs/ROADMAP.md. */
  readonly phase: number;
  /** Target epic slug from _bmad-output/planning-artifacts/. */
  readonly epic: string;
  /** Pure handler — exposed for unit tests that bypass commander. */
  readonly handler: StubHandler;
  /** Wires the stub into a commander program. */
  readonly register: (program: Command) => void;
}

/**
 * Build a stub-command module. Each file in src/commands/ that ships a stub is
 * a one-liner: `export const { register, handler, ... } = defineStubCommand(...)`.
 *
 * `allowExcessArguments` + `allowUnknownOption` are both `true` so that
 * `devx eject --force foo bar` still hits the stub message and exits 0 — the
 * command isn't wired yet, so any flag the user types is by definition a
 * future flag and rejecting it would force users to remember which phase
 * accepts what.
 */
export function defineStubCommand(
  name: string,
  phase: number,
  epic: string,
): StubCommandModule {
  const handler = makeStub(phase, epic);
  const register = (program: Command): void => {
    const sub = program
      .command(name)
      .description(`(coming in Phase ${phase} — ${epic})`)
      .allowExcessArguments(true)
      .allowUnknownOption(true)
      .action(() => handler());
    // cli303 reads this back to sort `--help` by phase ascending.
    attachPhase(sub, phase);
  };
  return { name, phase, epic, handler, register };
}
