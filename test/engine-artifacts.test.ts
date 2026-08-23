// engine/artifacts — the central artifact-path resolver. Pins the
// workstream-relative display constants, the abs joiners, and the
// evals/ authored-entry classification that routes `devx next`
// rows 10↔11.

import { describe, expect, it } from "vitest";
import { join } from "node:path";

import {
  DECISIONS_DIR_REL,
  DESIGN_REL,
  EVALS_DIR_REL,
  EXPECTATIONS_REL,
  PLAN_REL,
  PRD_REL,
  RED_REPORT_REL,
  SCAFFOLD_SUBDIRS,
  TODO_REL,
  artifactAbs,
  designAbs,
  evalsDirAbs,
  expectationsAbs,
  isAuthoredEvalEntry,
  planAbs,
  prdAbs,
  redReportAbs,
  todoAbs,
} from "../src/lib/engine/artifacts.js";

const WS = join("/tmp", "repo", "_devx", "workstreams", "slug");

describe("artifact path resolvers", () => {
  it("joins workstream-relative paths onto the workstream dir", () => {
    expect(prdAbs(WS)).toBe(artifactAbs(WS, PRD_REL));
    expect(designAbs(WS)).toBe(artifactAbs(WS, DESIGN_REL));
    expect(planAbs(WS)).toBe(artifactAbs(WS, PLAN_REL));
    expect(expectationsAbs(WS)).toBe(artifactAbs(WS, EXPECTATIONS_REL));
    expect(todoAbs(WS)).toBe(artifactAbs(WS, TODO_REL));
    expect(evalsDirAbs(WS)).toBe(artifactAbs(WS, EVALS_DIR_REL));
  });

  it("splits multi-segment rel paths on / so Windows joins stay correct", () => {
    expect(redReportAbs(WS)).toBe(join(WS, ...RED_REPORT_REL.split("/")));
  });

  it("keeps the RED report inside the evals dir", () => {
    expect(RED_REPORT_REL.startsWith(`${EVALS_DIR_REL}/`)).toBe(true);
  });

  it("scaffold subdirs include decisions/checkpoints/evals", () => {
    expect(SCAFFOLD_SUBDIRS).toContain(DECISIONS_DIR_REL);
    expect(SCAFFOLD_SUBDIRS).toContain(EVALS_DIR_REL);
    expect(SCAFFOLD_SUBDIRS).toContain("checkpoints");
  });
});

describe("isAuthoredEvalEntry", () => {
  it("counts E-* runnables and fixtures as authored", () => {
    expect(isAuthoredEvalEntry("E-1_check-drift.ts")).toBe(true);
    expect(isAuthoredEvalEntry("E-8_degenerate-case.md")).toBe(true);
    expect(isAuthoredEvalEntry("_fixture.ts")).toBe(true);
  });

  it("excludes the gate's own report", () => {
    expect(isAuthoredEvalEntry("RED-report.md")).toBe(false);
  });

  it("excludes human-facing companion docs (folder layout)", () => {
    expect(isAuthoredEvalEntry("human.md")).toBe(false);
    expect(isAuthoredEvalEntry("outline.md")).toBe(false);
    expect(isAuthoredEvalEntry("outline-critique.md")).toBe(false);
  });

  it("excludes dotfiles", () => {
    expect(isAuthoredEvalEntry(".DS_Store")).toBe(false);
  });
});
