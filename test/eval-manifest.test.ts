// Eval-manifest parser (row B17).
//
// `parseEvalManifest` reads typed steps, their fields, and the
// deferred-to-outcome marker, tolerantly: a missing field is null and
// validation is the caller's job, exactly as `parseExpectations` works.
//
// The SHIPPED template is held to this contract — and to the RED lock's
// result-of-record split — in `eval-template-lock.test.ts`.

import { describe, expect, it } from "vitest";

import {
  OUTCOME_MARKER_RE,
  isOutcomeDeferredManifest,
  outcomeMeasures,
  parseEvalManifest,
} from "../src/lib/engine/eval-manifest.js";

describe("parseEvalManifest — step parsing", () => {
  it("reads a numbered typed step with its fields", () => {
    const { isManifest, steps } = parseEvalManifest(
      [
        "# E-1: x",
        "",
        "## Steps",
        "",
        "### 1. script — the route answers",
        "",
        "- **Run:** `npm test -- route`",
        "- **Expected:** exit 0 and `200` in stdout",
        "- **RED today because:** the route does not exist",
        "",
      ].join("\n"),
    );
    expect(isManifest).toBe(true);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      index: 1,
      type: "script",
      title: "the route answers",
      run: "npm test -- route",
      expected: "exit 0 and `200` in stdout",
      deferredToOutcome: false,
    });
  });

  it("accepts every step type and both heading punctuations", () => {
    const { steps } = parseEvalManifest(
      [
        "### 1. script — a",
        "### 2) judge: b",
        "### metric - c",
        "#### 4. human — d",
      ].join("\n"),
    );
    expect(steps.map((s) => s.type)).toEqual(["script", "judge", "metric", "human"]);
    // An unnumbered heading falls back to its ordinal rather than 0/NaN.
    expect(steps.map((s) => s.index)).toEqual([1, 2, 3, 4]);
  });

  it("is not a manifest when no typed step heading appears", () => {
    // The freeform markdown evals that shipped before this shape existed —
    // every consumer must keep treating them exactly as before.
    const freeform = [
      "# E-7 — Live overnight ride-through",
      "",
      "## Procedure",
      "",
      "1. Start a supervised run.",
      "",
      "## Pass criteria",
      "",
      "- at least one real pause segment",
    ].join("\n");
    expect(parseEvalManifest(freeform).isManifest).toBe(false);
    expect(isOutcomeDeferredManifest(freeform)).toBe(false);
  });

  it("folds a wrapped field value into one string", () => {
    const { steps } = parseEvalManifest(
      [
        "### 1. metric — adoption",
        "",
        "- **Run:** `gh api repos/o/r/pulls",
        "  --paginate | jq length`",
        "",
      ].join("\n"),
    );
    expect(steps[0].run).toBe("gh api repos/o/r/pulls --paginate | jq length");
  });

  it("takes a fenced command block as the Run value", () => {
    const { steps } = parseEvalManifest(
      ["### 1. script — x", "", "- **Run:**", "", "```bash", "bin/count.sh", "```", ""].join(
        "\n",
      ),
    );
    expect(steps[0].run).toBe("bin/count.sh");
  });

  it("keeps a step heading inside a fence out of the step list", () => {
    // Otherwise an example in a header comment or a doc block becomes a
    // step, and `isOutcomeDeferredManifest` answers about prose.
    const { steps } = parseEvalManifest(
      [
        "### 1. metric — real `(measured at outcome)`",
        "",
        "- **Run:** `bin/real.sh`",
        "",
        "```md",
        "### 2. script — just an example",
        "- **Run:** `not-a-command`",
        "```",
      ].join("\n"),
    );
    expect(steps).toHaveLength(1);
    expect(steps[0].run).toBe("bin/real.sh");
  });

  it("first occurrence of a duplicated field wins", () => {
    const { steps } = parseEvalManifest(
      ["### 1. script — x", "", "- **Run:** `first`", "- **Run:** `second`"].join("\n"),
    );
    expect(steps[0].run).toBe("first");
  });

  it("a non-step heading closes the step's field scan", () => {
    const { steps } = parseEvalManifest(
      [
        "### 1. script — x",
        "",
        "- **Run:** `a`",
        "",
        "## Runs",
        "",
        "- **Expected:** not part of step 1",
      ].join("\n"),
    );
    expect(steps[0].expected).toBeNull();
  });
});

describe("parseEvalManifest — the deferred-to-outcome marker", () => {
  it("accepts the marker in the heading, in the body, and with a /devx prefix", () => {
    for (const variant of [
      "### 1. metric — x `(measured at outcome)`\n\n- **Run:** `a`",
      "### 1. metric — x\n\n- **Run:** `a`\n- note: (measured at outcome)",
      "### 1. metric — x (measured at /devx outcome)\n\n- **Run:** `a`",
      "### 1. metric — x (Measured At Outcome)\n\n- **Run:** `a`",
    ]) {
      expect(
        parseEvalManifest(variant).steps[0].deferredToOutcome,
        variant,
      ).toBe(true);
    }
  });

  it("strips the marker — and its backticks — out of the step title", () => {
    const { steps } = parseEvalManifest(
      "### 2. metric — adoption rate `(measured at outcome)`\n\n- **Run:** `a`",
    );
    expect(steps[0].title).toBe("adoption rate");
  });

  it("a metric step without the marker is NOT deferred", () => {
    // The marker is the contract, not the step type: a `metric` step that
    // can run today should run today.
    const { steps } = parseEvalManifest("### 1. metric — x\n\n- **Run:** `a`");
    expect(steps[0].deferredToOutcome).toBe(false);
    expect(isOutcomeDeferredManifest("### 1. metric — x\n\n- **Run:** `a`")).toBe(false);
  });

  it("isOutcomeDeferredManifest is all-or-nothing", () => {
    const deferredOnly = [
      "### 1. metric — a `(measured at outcome)`",
      "- **Run:** `x`",
      "",
      "### 2. metric — b `(measured at outcome)`",
      "- **Run:** `y`",
    ].join("\n");
    expect(isOutcomeDeferredManifest(deferredOnly)).toBe(true);
    // One runnable step and the strict P0 rule applies again: the "only
    // unmet step" is no longer the deferred one.
    const mixed = `${deferredOnly}\n\n### 3. script — c\n- **Run:** \`z\``;
    expect(isOutcomeDeferredManifest(mixed)).toBe(false);
  });

  it("outcomeMeasures returns only the deferred steps, in order", () => {
    const md = [
      "### 1. script — setup",
      "- **Run:** `seed`",
      "",
      "### 2. metric — adoption `(measured at outcome)`",
      "- **Run:** `bin/adoption.sh`",
      "- **Window:** trailing 30d",
      "",
      "### 3. metric — cost `(measured at outcome)`",
      "- **Run:** `bin/cost.sh`",
    ].join("\n");
    expect(outcomeMeasures(md).map((s) => s.run)).toEqual([
      "bin/adoption.sh",
      "bin/cost.sh",
    ]);
    expect(outcomeMeasures(md)[0].window).toBe("trailing 30d");
  });

  it("the marker regex does not match near-misses", () => {
    for (const near of [
      "(measure at outcome)",
      "measured at outcome",
      "(measured at the outcome gate)",
    ]) {
      expect(OUTCOME_MARKER_RE.test(near), near).toBe(false);
    }
  });
});
