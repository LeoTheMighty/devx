// AC 3 (debug-9f24c7 / D-13): `readEngineState` stays SOFT — a half-edited
// spec must never crash a gate — but every call site that CAN report must
// consult `frontmatterParseError` and say "unreadable" instead of rendering
// a confident empty state.
//
// The three report-capable sites named by the AC:
//   - `devx next`  → a `frontmatter-unreadable` drift row (gather.ts)
//   - `devx status`→ a stderr line per unreadable plan spec (status.ts)
//   - the gates    → one warning at the shared `resolveOrFail` choke point
//
// Each assertion pairs the report with the silence it replaces: the same
// fixture is shown losing its `status:`/`stage:` to the parser first, so a
// regression that drops the warning is not mistaken for "nothing was wrong".
//
// Spec: debug/debug-9f24c7-2026-08-05T12:20-unparseable-spec-frontmatter-silent.md

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { gatherRepoSnapshot } from "../src/lib/next/gather.js";
import { runGatePrd } from "../src/commands/gate.js";
import { runStatus } from "../src/commands/status.js";
import { readEngineState } from "../src/lib/engine/frontmatter.js";
import { resolveWorkstream } from "../src/lib/engine/workstream.js";
import {
  type EngineRepo,
  captureIo,
  makeEngineRepo,
  validExpectations,
  validPrd,
} from "./fixtures/engine-repo.js";

const NOW = new Date("2026-08-20T12:00:00Z");
const ENGINE = {
  workstreamsRoot: "_devx/workstreams",
  expectationsMin: 3,
  proseBudgetKb: 60,
  readingGuideRoles: ["pm", "architect", "dev", "qa"],
};

/** The colon shape (dev-mgr102/mgr103, debug-7b3e2a): a bare `: ` inside an
 *  unquoted plain scalar. Everything BELOW the bad title is swallowed. */
const COLON_TITLE = "title: State persistence: schedule.json + manager.json";
/** The backtick shape (dev-cfg204/cli303/cli304): a leading YAML reserved
 *  character. Errors, but reads losslessly — so it must keep rendering. */
const BACKTICK_TITLE = "title: `devx --help` listing every command";

let repo: EngineRepo;
beforeEach(() => {
  repo = makeEngineRepo();
});
afterEach(() => repo.cleanup());

function gather() {
  return gatherRepoSnapshot({
    repoRoot: repo.root,
    merged: {},
    engine: ENGINE,
    exec: () => ({ stdout: "", stderr: "no gh", exitCode: 1 }),
    now: () => NOW,
    skipGh: true,
  });
}

// ---------------------------------------------------------------------------
// `devx next` — drift rows
// ---------------------------------------------------------------------------

const DEV_SPEC_REL = "dev/dev-aaa111-2026-08-05T12:00-fixture.md";

function writeDevSpec(titleLine: string): void {
  repo.write(
    DEV_SPEC_REL,
    [
      "---",
      "hash: aaa111",
      "type: dev",
      titleLine,
      "status: in-progress",
      "blocked_by: [bbb222]",
      "---",
      "",
      "body",
      "",
    ].join("\n"),
  );
  repo.write(
    "DEV.md",
    `# DEV\n\n- [ ] \`${DEV_SPEC_REL}\` — Fixture aaa111. Status: ready.\n`,
  );
}

describe("devx next — unreadable frontmatter is a drift row, not silence", () => {
  it("colon shape: reports the parse error the swallowed status can no longer signal", () => {
    writeDevSpec(COLON_TITLE);

    // The loss this row exists to announce: the keys below the bad title
    // are gone, so the ONLY other drift signal (status-mismatch, which
    // fires on `specStatus !== row.status`) is suppressed by the very
    // same null it should have been triggered by.
    const state = readEngineState(repo.read(DEV_SPEC_REL));
    expect(state.status).toBeNull();
    expect(state.blockedBy).toEqual([]);

    const s = gather();
    const unreadable = s.drift.filter((d) => d.kind === "frontmatter-unreadable");
    expect(unreadable).toHaveLength(1);
    expect(unreadable[0].hash).toBe("aaa111");
    expect(unreadable[0].backlog).toBe("DEV.md");
    expect(unreadable[0].detail).toContain("does not parse");
    expect(unreadable[0].detail).toMatch(/Nested mappings|implicit key/i);
    // The masking row really is absent — the new row is the only report.
    expect(s.drift.some((d) => d.kind === "status-mismatch")).toBe(false);

    // Reported, never fixed (CAP-2): both files byte-identical.
    expect(readEngineState(repo.read(DEV_SPEC_REL)).status).toBeNull();
    expect(repo.read("DEV.md")).toContain("Status: ready.");
  });

  it("backtick shape: reports even though the read is lossless", () => {
    writeDevSpec(BACKTICK_TITLE);
    // Nothing is lost on READ here — but `applyEnginePatch` refuses to
    // write to this file, so the spec is frozen. Silence would hide that.
    expect(readEngineState(repo.read(DEV_SPEC_REL)).status).toBe("in-progress");

    const s = gather();
    expect(s.drift.some((d) => d.kind === "frontmatter-unreadable")).toBe(true);
    // The status-mismatch row still fires: the two reports are independent.
    expect(s.drift.some((d) => d.kind === "status-mismatch")).toBe(true);
  });

  it("parseable spec: no unreadable row (the guard is not vacuous)", () => {
    writeDevSpec("title: 'State persistence: schedule.json + manager.json'");
    expect(readEngineState(repo.read(DEV_SPEC_REL)).status).toBe("in-progress");
    const s = gather();
    expect(s.drift.some((d) => d.kind === "frontmatter-unreadable")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// `devx status` + the gates — plan-spec surfaces
// ---------------------------------------------------------------------------

const WS = "_devx/workstreams/demo-feature";
const PLAN_SPEC_REL = "plan/plan-abc123-2026-08-05T12:00-demo-feature.md";

function seedWorkstream(titleLine: string): void {
  repo.write(
    PLAN_SPEC_REL,
    [
      "---",
      "hash: abc123",
      "type: plan",
      titleLine,
      "status: in-progress",
      "stage: prd",
      "entered_at: prd",
      "gate_status:",
      "  prd_validated: false",
      "  design_verified: false",
      "  plan_verified: false",
      "  evals_red: false",
      `workstream: ${WS}`,
      "---",
      "",
      "## Status log",
      "",
      "- created.",
      "",
    ].join("\n"),
  );
  repo.mkdir(WS);
  repo.write(`${WS}/prd/agent.md`, validPrd());
  repo.write(`${WS}/expectations.md`, validExpectations());
}

describe("devx status — unreadable plan frontmatter is announced", () => {
  it("colon shape: warns instead of dropping the workstream in silence", () => {
    seedWorkstream(COLON_TITLE);
    // The silence being replaced: `stage:` is swallowed, and a null stage
    // is exactly how a legacy (non-engine) plan spec is skipped — the
    // entry vanishes from the render with nothing said.
    expect(readEngineState(repo.read(PLAN_SPEC_REL)).stage).toBeNull();

    const io = captureIo();
    expect(runStatus({ ...io, projectPath: repo.configPath })).toBe(0);
    expect(io.stderr()).toContain(`plan/${PLAN_SPEC_REL.split("/")[1]}`);
    expect(io.stderr()).toContain("frontmatter does not parse");
  });

  it("backtick shape: warns AND still renders (soft reader, D-13)", () => {
    seedWorkstream(BACKTICK_TITLE);
    const io = captureIo();
    expect(runStatus({ ...io, projectPath: repo.configPath })).toBe(0);
    expect(io.stderr()).toContain("frontmatter does not parse");
    // Warning is advisory: the workstream still renders its gate summary.
    expect(io.stdout()).toContain("demo-feature");
  });

  it("parseable spec: silent (no phantom warnings)", () => {
    seedWorkstream("title: 'Demo feature'");
    const io = captureIo();
    expect(runStatus({ ...io, projectPath: repo.configPath })).toBe(0);
    expect(io.stderr()).not.toContain("does not parse");
    expect(io.stdout()).toContain("demo-feature");
  });
});

describe("gates — the reader stays soft, the gate says so", () => {
  it("resolveWorkstream carries the parse error to every gate", () => {
    seedWorkstream(COLON_TITLE);
    const ws = resolveWorkstream(repo.root, "abc123", ENGINE);
    expect(ws.frontmatterError).not.toBeNull();
    // Soft: it RESOLVED. A half-edited spec never crashes the gate.
    expect(ws.workstreamRel).toBe(WS);
    expect(ws.state.stage).toBeNull();
  });

  it("devx gate prd names the cause BEFORE the write-side failure", () => {
    seedWorkstream(COLON_TITLE);
    const io = captureIo();
    const code = runGatePrd(["abc123"], { ...io, projectPath: repo.configPath });
    const stderr = io.stderr();

    // The bug's fingerprint (spec Technical notes), now fully narrated:
    // the READER resolved the workstream and the gate computed PASS, then
    // `applyEnginePatch` — which fails LOUD on the same bytes — refused the
    // write. Exit 2. Before D-13 the only output was that write failure,
    // which reads as a writer bug; the warning now identifies the file as
    // unreadable up front, and it is emitted FIRST.
    expect(code).toBe(2);
    expect(stderr).toContain("frontmatter does not parse");
    expect(stderr).toContain("PASS computed but frontmatter write failed");
    expect(stderr.indexOf("frontmatter does not parse")).toBeLessThan(
      stderr.indexOf("PASS computed but frontmatter write failed"),
    );
  });

  it("parseable spec: gate passes silently (exit 0, no warning)", () => {
    seedWorkstream("title: 'Demo feature'");
    const io = captureIo();
    const code = runGatePrd(["abc123"], { ...io, projectPath: repo.configPath });
    expect(code).toBe(0);
    expect(io.stderr()).not.toContain("does not parse");
  });
});
