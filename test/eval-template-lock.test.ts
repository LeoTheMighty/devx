// The shipped eval manifest template, held to two contracts (row B17).
//
// This is the evals-lock FIXTURE the row asks for, and the second contract
// is the load-bearing one: the template's lines must classify under
// `stepBodySha` exactly as its own header comment claims. A template that
// teaches a shape the lock disagrees with is worse than no template — an
// author follows it, stamps a run, and `devx gate evals --verify` reports
// their own untouched eval as softened. That is precisely the cry-wolf
// failure evals-lock.ts says gets a lock switched off, so the template is
// held to it by test rather than by review.
//
// Separate file from `eval-manifest.test.ts` so the parser's own tests do
// not depend on the shipped template existing.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  isOutcomeDeferredManifest,
  parseEvalManifest,
} from "../src/lib/engine/eval-manifest.js";
import { isResultOfRecordLine, stepBodySha } from "../src/lib/engine/evals-lock.js";
import { REAL_REPO_ROOT } from "./fixtures/engine-repo.js";

const TEMPLATE_PATH = join(
  REAL_REPO_ROOT,
  "_devx",
  "templates",
  "engine",
  "evals",
  "eval.md",
);
const template = (): string => readFileSync(TEMPLATE_PATH, "utf8");

describe("the shipped eval.md template", () => {
  it("parses as a manifest with one runnable and one deferred step", () => {
    const { isManifest, steps } = parseEvalManifest(template());
    expect(isManifest).toBe(true);
    // Both halves of the contract are demonstrated — an author who copies
    // the template sees the runnable shape AND the deferred shape.
    expect(steps.map((s) => s.type)).toEqual(["script", "metric"]);
    expect(steps.map((s) => s.deferredToOutcome)).toEqual([false, true]);
    expect(steps[1].window).not.toBeNull();
  });

  it("is NOT all-deferred, so it can never stand in for a P0 unedited", () => {
    // Guard against a future trim deleting the script step: the template
    // would then make every expectation that names it a free P0 pass.
    expect(isOutcomeDeferredManifest(template())).toBe(false);
  });

  it("classifies its frontmatter status/last_run as result of record", () => {
    for (const line of ["status: red", "last_run: null"]) {
      expect(isResultOfRecordLine(line), line).toBe(true);
    }
  });

  it("recording a run does not move the step-body sha", () => {
    const rel = "_devx/workstreams/demo/evals/E-1_x.md";
    const md = template();
    const base = stepBodySha(rel, md);
    const writable: Array<[string, string]> = [
      ["status flipped green", md.replace("status: red", "status: green")],
      ["last_run stamped", md.replace("last_run: null", "last_run: 2026-11-20")],
      [
        "a Runs row appended",
        `${md}| 2026-11-20 | devx outcome score | 22 | trailing 30d |\n`,
      ],
      [
        "the deferred step's Result filled in",
        md.replace("_(measured at outcome)_", "22"),
      ],
    ];
    for (const [what, variant] of writable) {
      expect(stepBodySha(rel, variant), what).toBe(base);
    }
  });

  it("softening a step DOES move the step-body sha", () => {
    const rel = "_devx/workstreams/demo/evals/E-1_x.md";
    const md = template();
    const base = stepBodySha(rel, md);
    const locked: Array<[string, string]> = [
      ["the Run command", md.replace("`<command>`", "`true`")],
      ["the Expected bar", md.replace(">= 20", ">= 2")],
      ["the observation window", md.replace("trailing 30d", "trailing 3d")],
      [
        "the deferral marker itself",
        md.replace("`(measured at outcome)`", ""),
      ],
    ];
    for (const [what, variant] of locked) {
      expect(stepBodySha(rel, variant), what).not.toBe(base);
    }
  });
});
