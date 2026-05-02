// Help-listing tests (cli303 + ini506 + mrg102 + prt102).
//
// Three layers of coverage:
//   1. Order: positions of the 14 command lines in `devx --help` are strictly
//      monotonically increasing in the canonical [config, init, merge-gate,
//      pr-body, ask, kill, pause, restart, resume, status, serve, tail, ui,
//      eject] order — the exact shape required by the AC (phase ASC; ties
//      alphabetical). ini506 added `init` as the second Phase-0 real command;
//      mrg102 added `merge-gate` as the first Phase-1 real command; prt102
//      added `pr-body` as the second Phase-1 real command (sorts after
//      merge-gate alphabetically within Phase 1).
//   2. Annotation: each of the 10 stubs has its `(coming in Phase N —
//      epic-<slug>)` annotation on its line; the four real commands
//      (`config`, `init`, `merge-gate`, `pr-body`) have no `(coming`
//      annotation. Drift (e.g. an editor replacing the em-dash with a
//      hyphen) fails this layer before reaching the snapshot.
//   3. Inline snapshot: full `--help` stdout pinned. Any wording change (the
//      program description, an option label, a stub epic slug) must update
//      the snapshot — that's the "atomic" property the spec asks for.
//
// Spec: dev/dev-cli303-2026-04-26T19:35-cli-help-listing.md
// Spec: dev/dev-ini506-2026-04-26T19:35-init-failure-modes.md (added `init`)
// Spec: dev/dev-mrg102-2026-04-28T19:30-merge-gate-cli.md (added `merge-gate`)
// Spec: dev/dev-prt102-2026-04-28T19:30-pr-template-substitution.md (added `pr-body`)

import { describe, expect, it } from "vitest";

import { buildProgram } from "../src/cli.js";

/**
 * Capture `devx --help` stdout. exitOverride() turns commander's normal
 * `process.exit()` into a thrown `commander.helpDisplayed` error we can
 * swallow; configureOutput() routes both streams to in-memory buffers so the
 * test runner's stdout stays clean.
 */
function captureHelp(): string {
  const program = buildProgram();
  program.exitOverride();
  let stdout = "";
  program.configureOutput({
    writeOut: (s) => {
      stdout += s;
    },
    writeErr: () => {},
  });
  try {
    program.parse(["node", "devx", "--help"]);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== "commander.helpDisplayed" && code !== "commander.help") {
      throw err;
    }
  }
  return stdout;
}

const expectedOrder = [
  "config",
  "init",
  "merge-gate",
  "pr-body",
  "ask",
  "kill",
  "pause",
  "restart",
  "resume",
  "status",
  "serve",
  "tail",
  "ui",
  "eject",
] as const;

const stubAnnotations: ReadonlyArray<{
  name: string;
  phase: number;
  epic: string;
}> = [
  { name: "ask", phase: 2, epic: "epic-devx-concierge-skill" },
  { name: "kill", phase: 2, epic: "epic-devx-concierge-skill" },
  { name: "pause", phase: 2, epic: "epic-devx-manage-minimal" },
  { name: "restart", phase: 2, epic: "epic-devx-concierge-skill" },
  { name: "resume", phase: 2, epic: "epic-devx-manage-minimal" },
  { name: "status", phase: 2, epic: "epic-devx-concierge-skill" },
  { name: "serve", phase: 4, epic: "epic-devx-serve-web" },
  { name: "tail", phase: 4, epic: "epic-devx-ui-tui" },
  { name: "ui", phase: 4, epic: "epic-devx-ui-tui" },
  { name: "eject", phase: 10, epic: "epic-eject-cli" },
];

/**
 * Find the line position of a command in commander's help output. Each
 * subcommand line begins with two spaces of indentation followed by the
 * command name and either whitespace or `[options]`. Anchoring to that
 * pattern stops false matches inside the program description text.
 */
function lineIndexOf(out: string, name: string): number {
  const re = new RegExp(`^  ${name}(\\s|\\[)`, "m");
  const m = re.exec(out);
  return m ? m.index : -1;
}

describe("cli303 — devx --help command listing", () => {
  it("lists all 14 commands sorted by phase ASC; ties alphabetical", () => {
    const out = captureHelp();
    const positions = expectedOrder.map((name) => ({
      name,
      idx: lineIndexOf(out, name),
    }));
    for (const p of positions) {
      expect(p.idx, `expected '${p.name}' on its own help line`).toBeGreaterThanOrEqual(0);
    }
    const indices = positions.map((p) => p.idx);
    const sorted = [...indices].sort((a, b) => a - b);
    expect(indices).toEqual(sorted);
  });

  it("each stub line carries its (coming in Phase N — epic-<slug>) annotation", () => {
    const out = captureHelp();
    for (const { phase, epic } of stubAnnotations) {
      expect(out).toContain(`(coming in Phase ${phase} — ${epic})`);
    }
  });

  it("uses an em dash, not a hyphen, in the stub annotation", () => {
    // Regression guard mirroring the cli302 stub.test.ts em-dash check —
    // an editor auto-correct could replace U+2014 with `-` and the help text
    // would still read fluently to a human but fail byte-equality. Pin the
    // codepoint here so the failure mode is unambiguous.
    const out = captureHelp();
    expect(out).toContain("— epic-");
    expect(out).not.toContain("- epic-");
  });

  it("real commands (config, init, merge-gate, pr-body) are listed without a (coming annotation", () => {
    const out = captureHelp();
    for (const name of ["config", "init", "merge-gate", "pr-body"]) {
      const lineStart = lineIndexOf(out, name);
      expect(lineStart, `expected '${name}' to appear in --help`).toBeGreaterThanOrEqual(0);
      // Commander wraps long descriptions onto continuation lines indented to
      // the description column. Read until the next non-continuation line so we
      // capture the entire visual row for this command.
      const lines = out.slice(lineStart).split("\n");
      const block: string[] = [lines[0]];
      for (let i = 1; i < lines.length; i++) {
        // Continuation lines are indented further than the command-name column
        // (two spaces) — they start with at least 4 spaces of padding.
        if (/^ {4,}\S/.test(lines[i])) block.push(lines[i]);
        else break;
      }
      expect(block.join("\n"), `'${name}' must not be marked '(coming…)'`).not.toContain(
        "(coming",
      );
    }
  });

  it("snapshot of full --help output pins wording (run vitest -u to refresh)", () => {
    const out = captureHelp();
    expect(out).toMatchInlineSnapshot(`
      "Usage: devx [options] [command]

      devx — autonomous development system built on BMAD

      Options:
        -V, --version                output the version number
        -h, --help                   display help for command

      Commands:
        config [options] [args...]   Get or set values in devx.config.yaml (project)
                                     or ~/.devx/config.yaml (user)
        init [options]               Resume deferred /devx-init work (--resume-gh).
                                     Fresh-init lives in the /devx-init slash
                                     command.
        merge-gate [options] <hash>  Compute the mode-derived merge decision for a
                                     spec PR (Phase 1). Emits JSON; exit 0 = merge, 1
                                     = no-merge, 2 = signal trouble.
        plan-helper                  Helpers invoked by the /devx-plan skill body
                                     (Phase 1). Subcommand-driven; mirrors \`devx
                                     merge-gate\`'s passthrough pattern.
        pr-body [options]            Render the canonical /devx PR body for a spec.
                                     Substitutes mode + spec path + AC checklist
                                     (Phase 1).
        ask                          (coming in Phase 2 — epic-devx-concierge-skill)
        kill                         (coming in Phase 2 — epic-devx-concierge-skill)
        pause                        (coming in Phase 2 — epic-devx-manage-minimal)
        restart                      (coming in Phase 2 — epic-devx-concierge-skill)
        resume                       (coming in Phase 2 — epic-devx-manage-minimal)
        status                       (coming in Phase 2 — epic-devx-concierge-skill)
        serve                        (coming in Phase 4 — epic-devx-serve-web)
        tail                         (coming in Phase 4 — epic-devx-ui-tui)
        ui                           (coming in Phase 4 — epic-devx-ui-tui)
        eject                        (coming in Phase 10 — epic-eject-cli)
        help [command]               display help for command
      "
    `);
  });
});
