// Stub command tests (cli302).
//
// Three layers of coverage:
//   1. Pure unit — `stubMessage` and `makeStub` produce the canonical line for
//      every (phase, epic) pair the spec lists.
//   2. In-process — each per-command module (`src/commands/<name>.ts`) is
//      a defineStubCommand result with the expected (phase, epic, name).
//      Catches per-file copy-paste mistakes (wrong epic slug, wrong phase).
//   3. Subprocess — `node dist/cli.js <name>` exits 0, stdout empty, stderr
//      ends with the canonical line + newline. This is the AC test (the spec
//      says `devx ui` stderr must "match exactly"). Skipped when dist/ is not
//      built — the npm test script runs `npm run build` before vitest, so
//      dist is always present in CI.
//
// The eject "no destructive side effects" test lives in a separate file
// (test/eject-noop.test.ts) because it needs a fixture-repo + before/after
// snapshot harness that would clutter this file.
//
// Spec: dev/dev-cli302-2026-04-26T19:35-cli-stubs.md

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { makeStub, stubMessage } from "../src/lib/stub.js";

import * as askCommand from "../src/commands/ask.js";
import * as ejectCommand from "../src/commands/eject.js";
import * as killCommand from "../src/commands/kill.js";
import * as pauseCommand from "../src/commands/pause.js";
import * as restartCommand from "../src/commands/restart.js";
import * as resumeCommand from "../src/commands/resume.js";
import * as serveCommand from "../src/commands/serve.js";
import * as statusCommand from "../src/commands/status.js";
import * as tailCommand from "../src/commands/tail.js";
import * as uiCommand from "../src/commands/ui.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distEntry = resolve(repoRoot, "dist", "cli.js");

interface StubModule {
  readonly name: string;
  readonly phase: number;
  readonly epic: string;
  readonly handler: (write?: (s: string) => void) => void;
  readonly register: unknown;
}

// (Phase, epic) mapping is copied verbatim from the spec ACs. Tests assert
// against THIS table — if it drifts from the spec, the assertion catches the
// drift before commit. cli303's --help snapshot will catch the same drift
// later but we don't want to depend on cli303 landing first.
const expected: ReadonlyArray<{ name: string; phase: number; epic: string; module: StubModule }> = [
  { name: "ui",      phase: 4,  epic: "epic-devx-ui-tui",          module: uiCommand },
  { name: "serve",   phase: 4,  epic: "epic-devx-serve-web",       module: serveCommand },
  { name: "tail",    phase: 4,  epic: "epic-devx-ui-tui",          module: tailCommand },
  { name: "kill",    phase: 2,  epic: "epic-devx-concierge-skill", module: killCommand },
  { name: "restart", phase: 2,  epic: "epic-devx-concierge-skill", module: restartCommand },
  { name: "status",  phase: 2,  epic: "epic-devx-concierge-skill", module: statusCommand },
  { name: "pause",   phase: 2,  epic: "epic-devx-manage-minimal",  module: pauseCommand },
  { name: "resume",  phase: 2,  epic: "epic-devx-manage-minimal",  module: resumeCommand },
  { name: "ask",     phase: 2,  epic: "epic-devx-concierge-skill", module: askCommand },
  { name: "eject",   phase: 10, epic: "epic-eject-cli",            module: ejectCommand },
];

describe("cli302 — stubMessage formatting", () => {
  it("produces the canonical line for the AC example (`devx ui`)", () => {
    expect(stubMessage(4, "epic-devx-ui-tui")).toBe(
      "not yet wired — ships in Phase 4 (epic-devx-ui-tui)",
    );
  });

  it("uses an em dash, NOT a hyphen, between 'wired' and 'ships'", () => {
    // Regression guard: an editor or IDE auto-correct could replace `—`
    // (U+2014) with `-` and the message would still read fluently to a human
    // but fail any byte-equality test. Encode the assertion at the codepoint
    // level so the failure mode is unambiguous.
    expect(stubMessage(4, "epic-devx-ui-tui")).toContain("—");
    expect(stubMessage(4, "epic-devx-ui-tui")).not.toContain("wired - ships");
  });

  it("interpolates phase and epic for every (phase, epic) the spec lists", () => {
    for (const { phase, epic } of expected) {
      expect(stubMessage(phase, epic)).toBe(
        `not yet wired — ships in Phase ${phase} (${epic})`,
      );
    }
  });
});

describe("cli302 — makeStub handler", () => {
  it("writes the canonical line + trailing newline to the supplied sink", () => {
    let captured = "";
    const handler = makeStub(7, "epic-fake");
    handler((s) => {
      captured += s;
    });
    expect(captured).toBe("not yet wired — ships in Phase 7 (epic-fake)\n");
  });

  it("produces a single write (no leading whitespace, no preview line)", () => {
    // Party-mode minutes proposed adding a `preview:` follow-up line; the
    // cli302 spec ACs explicitly require the stderr to match the canonical
    // string EXACTLY. Pin the single-line property here so a future "let's add
    // a preview" change can't slip through without bumping the spec first.
    let writes = 0;
    const handler = makeStub(2, "epic-x");
    handler(() => {
      writes += 1;
    });
    expect(writes).toBe(1);
  });

  it("returns no value (void) — caller does not depend on a return", () => {
    const handler = makeStub(2, "epic-x");
    const ret = handler(() => {});
    expect(ret).toBeUndefined();
  });
});

describe("cli302 — per-command module shape", () => {
  it.each(expected)(
    "$name → Phase $phase ($epic)",
    ({ name, phase, epic, module }) => {
      expect(module.name).toBe(name);
      expect(module.phase).toBe(phase);
      expect(module.epic).toBe(epic);
      expect(typeof module.register).toBe("function");
      expect(typeof module.handler).toBe("function");
    },
  );

  it("each module's handler writes its module-bound canonical line", () => {
    for (const { phase, epic, module } of expected) {
      let captured = "";
      module.handler((s) => {
        captured += s;
      });
      expect(captured).toBe(`not yet wired — ships in Phase ${phase} (${epic})\n`);
    }
  });
});

describe("cli302 — subprocess (node dist/cli.js <name>)", () => {
  for (const { name, phase, epic } of expected) {
    it.skipIf(!existsSync(distEntry))(
      `\`devx ${name}\` exits 0 with empty stdout and canonical stderr`,
      () => {
        const result = run("node", [distEntry, name]);
        expect(result.status).toBe(0);
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe(
          `not yet wired — ships in Phase ${phase} (${epic})\n`,
        );
      },
    );
  }

  it.skipIf(!existsSync(distEntry))(
    "stub commands accept extra positional + unknown options without erroring",
    () => {
      // `devx eject --force --dry-run extra-arg` should still hit the stub and
      // exit 0. Future phases may give some of these flags real meaning; the
      // surface-area-first principle says the stub permits them silently
      // today.
      const result = run("node", [
        distEntry,
        "eject",
        "--force",
        "--dry-run",
        "extra-arg",
      ]);
      expect(result.status).toBe(0);
      expect(result.stderr).toContain("not yet wired");
    },
  );
});

interface CaptureResult {
  status: number;
  stdout: string;
  stderr: string;
}

/**
 * Run a subprocess and capture both streams + exit code without throwing on
 * non-zero exit. spawnSync would surface a thrown error otherwise on stub
 * regressions; capturing here lets the assertion message show the actual
 * stderr the stub wrote, which is what you want when debugging.
 */
function run(file: string, args: string[]): CaptureResult {
  const ret = spawnSync(file, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: ret.status ?? -1,
    stdout: ret.stdout ?? "",
    stderr: ret.stderr ?? "",
  };
}
