// Phase-sorted help (cli303).
//
// commander's default `--help` lists subcommands in registration order. cli303
// rewires the program-level help so `devx --help` lists all 11 commands sorted
// by `phase` ascending, with ties broken alphabetically by command name. The
// stub annotation `(coming in Phase N — epic-<slug>)` is already carried as
// each stub's commander description (set in src/lib/stub.ts), so the only job
// of this module is the SORT — descriptions are unchanged.
//
// `phase` lives in a WeakMap keyed by the commander Command instance so we
// don't pollute commander's public surface with a custom field. `attachPhase`
// is called from each command's register() at wiring time; PhaseSortedHelp
// reads it back when rendering. Commands that never call attachPhase (e.g.
// future commands added by a contributor who forgot the wiring) sort to the
// end via `Number.POSITIVE_INFINITY` — visible, but at the bottom — rather
// than throwing, since `--help` should never error.
//
// Spec: dev/dev-cli303-2026-04-26T19:35-cli-help-listing.md

import { type Command, Help } from "commander";

const phaseRegistry = new WeakMap<Command, number>();

export function attachPhase(cmd: Command, phase: number): void {
  phaseRegistry.set(cmd, phase);
}

export function phaseOf(cmd: Command): number | undefined {
  return phaseRegistry.get(cmd);
}

export class PhaseSortedHelp extends Help {
  visibleCommands(cmd: Command): Command[] {
    const base = super.visibleCommands(cmd);
    return [...base].sort((a, b) => {
      const pa = phaseRegistry.get(a) ?? Number.POSITIVE_INFINITY;
      const pb = phaseRegistry.get(b) ?? Number.POSITIVE_INFINITY;
      if (pa !== pb) return pa - pb;
      return a.name().localeCompare(b.name());
    });
  }
}

/**
 * Replace `program.createHelp` so `--help` builds a PhaseSortedHelp instance.
 * Preserves any `configureHelp({...})` overrides set elsewhere by Object.assign'ing
 * them onto the subclass instance — same pattern commander's default
 * createHelp uses, just rooted at our subclass.
 */
export function installPhaseSortedHelp(program: Command): void {
  program.createHelp = function () {
    const help = new PhaseSortedHelp();
    return Object.assign(help, this.configureHelp());
  };
}
