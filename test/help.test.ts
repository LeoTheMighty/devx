// Help-listing tests (cli303).
//
// Three layers of coverage:
//   1. Order: positions of the 11 command lines in `devx --help` are strictly
//      monotonically increasing in the canonical [config, ask, kill, pause,
//      restart, resume, status, serve, tail, ui, eject] order — the exact
//      shape required by the AC (phase ASC; ties alphabetical).
//   2. Annotation: each of the 10 stubs has its `(coming in Phase N —
//      epic-<slug>)` annotation on its line; `config` has no `(coming`
//      annotation. Drift (e.g. an editor replacing the em-dash with a hyphen)
//      fails this layer before reaching the snapshot.
//   3. Inline snapshot: full `--help` stdout pinned. Any wording change (the
//      program description, an option label, a stub epic slug) must update
//      the snapshot — that's the "atomic" property the spec asks for.
//
// Spec: dev/dev-cli303-2026-04-26T19:35-cli-help-listing.md

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
  it("lists all 11 commands sorted by phase ASC; ties alphabetical", () => {
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

  it("config is listed without a (coming annotation", () => {
    const out = captureHelp();
    const configLineStart = lineIndexOf(out, "config");
    expect(configLineStart).toBeGreaterThanOrEqual(0);
    // Commander wraps long descriptions onto continuation lines indented to
    // the description column. Read until the next non-continuation line so we
    // capture the entire visual "config row".
    const lines = out.slice(configLineStart).split("\n");
    const configBlock: string[] = [lines[0]];
    for (let i = 1; i < lines.length; i++) {
      // Continuation lines are indented further than the command-name column
      // (two spaces) — they start with at least 4 spaces of padding.
      if (/^ {4,}\S/.test(lines[i])) configBlock.push(lines[i]);
      else break;
    }
    expect(configBlock.join("\n")).not.toContain("(coming");
  });

  it("snapshot of full --help output pins wording (run vitest -u to refresh)", () => {
    const out = captureHelp();
    expect(out).toMatchInlineSnapshot(`
      "Usage: devx [options] [command]

      devx — autonomous development system built on BMAD

      Options:
        -V, --version               output the version number
        -h, --help                  display help for command

      Commands:
        config [options] [args...]  Get or set values in devx.config.yaml (project)
                                    or ~/.devx/config.yaml (user)
        ask                         (coming in Phase 2 — epic-devx-concierge-skill)
        kill                        (coming in Phase 2 — epic-devx-concierge-skill)
        pause                       (coming in Phase 2 — epic-devx-manage-minimal)
        restart                     (coming in Phase 2 — epic-devx-concierge-skill)
        resume                      (coming in Phase 2 — epic-devx-manage-minimal)
        status                      (coming in Phase 2 — epic-devx-concierge-skill)
        serve                       (coming in Phase 4 — epic-devx-serve-web)
        tail                        (coming in Phase 4 — epic-devx-ui-tui)
        ui                          (coming in Phase 4 — epic-devx-ui-tui)
        eject                       (coming in Phase 10 — epic-eject-cli)
        help [command]              display help for command
      "
    `);
  });
});
