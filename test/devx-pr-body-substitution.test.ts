// Skill-body substitution unit tests for /devx Phase 7's PR-body renderer
// (prt102). This is the test file the spec ACs and epic-pr-template.md
// `## File structure` block name explicitly:
//   test/devx-pr-body-substitution.test.ts ← skill-body substitution unit
//                                            test (string-in → string-out).
//
// The tests pin the canonical-template substitution shape — every change to
// the `_devx/templates/pull_request_template.md` placeholder set or to
// `renderPrBody`'s line-anchoring discipline must update these expectations.
//
// Coverage targets (from prt102 ACs + epic-pr-template.md party-mode locked
// decisions #4 and #5):
//   1. Required substitutions: spec path + mode + AC checklist.
//   2. Optional substitutions: summary + test plan + notes.
//   3. First non-empty line of rendered body == `**Spec:**` line (AC 5).
//   4. Built-in fallback matches the canonical on-disk template byte-for-byte.
//   5. Line-anchoring: a placeholder inside a fenced code block must NOT
//      substitute (locked decision #4 — malicious-template fixture).
//   6. Unresolved-placeholder reporting (locked decision #5): missing AC
//      section / missing optional flags surface a name in the result, not
//      silent rendering.
//   7. Idempotency-marker stripping: `<!-- devx:mode -->` line is removed
//      from the rendered body so the **Spec:** invariant holds.
//   8. Mode is uppercased.
//   9. extractAcChecklist preserves `### ` sub-headings (prt101's spec splits
//      ACs into 3 sub-groups; reviewer-facing PR body must mirror that).
//
// Spec: dev/dev-prt102-2026-04-28T19:30-pr-template-substitution.md
// Epic: _bmad-output/planning-artifacts/epic-pr-template.md

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  AC_PLACEHOLDER,
  BUILTIN_TEMPLATE,
  MODE_PLACEHOLDER,
  NOTES_PLACEHOLDER,
  SPEC_PATH_PLACEHOLDER,
  SUMMARY_PLACEHOLDER,
  TEST_PLAN_PLACEHOLDER,
  extractAcChecklist,
  renderPrBody,
} from "../src/lib/pr-body.js";

const SPEC_PATH = "dev/dev-prt102-2026-04-28T19:30-pr-template-substitution.md";

const SAMPLE_SPEC = `---
hash: prt102
type: dev
title: /devx Phase 7 reads template + substitutes mode + spec path
status: in-progress
---

## Goal

Wire /devx Phase 7 PR-open step to read the template…

## Acceptance criteria

### New surface

- [ ] First AC line.
- [ ] Second AC line with sub-detail:
  - sub-bullet preserved
- [ ] Third AC line.

### Edge cases

- [ ] Edge AC.

## Technical notes

- Plain replaceAll, no template engine.

## Status log

- 2026-04-28T19:30 — created.
`;

describe("renderPrBody — required substitutions", () => {
  it("substitutes spec path on the canonical **Spec:** line", () => {
    const r = renderPrBody({
      template: BUILTIN_TEMPLATE,
      mode: "YOLO",
      specPath: SPEC_PATH,
      acChecklist: "- [ ] thing",
    });
    expect(r.body).toContain(`**Spec:** \`${SPEC_PATH}\``);
    expect(r.body).not.toContain(SPEC_PATH_PLACEHOLDER);
    expect(r.unresolvedPlaceholders).not.toContain("spec-path");
  });

  it("substitutes mode (uppercased) and strips the trailing annotation", () => {
    const r = renderPrBody({
      template: BUILTIN_TEMPLATE,
      mode: "yolo",
      specPath: SPEC_PATH,
      acChecklist: "- [ ] thing",
    });
    expect(r.body).toContain("**Mode:** YOLO");
    expect(r.body).not.toContain("*(stamped at PR-open by /devx)*");
    expect(r.body).not.toContain(MODE_PLACEHOLDER);
    expect(r.unresolvedPlaceholders).not.toContain("mode");
  });

  it("substitutes the AC checklist as a multi-line block", () => {
    const acs = ["- [ ] First AC.", "- [ ] Second AC."].join("\n");
    const r = renderPrBody({
      template: BUILTIN_TEMPLATE,
      mode: "YOLO",
      specPath: SPEC_PATH,
      acChecklist: acs,
    });
    expect(r.body).toContain("- [ ] First AC.\n- [ ] Second AC.");
    expect(r.body).not.toContain(AC_PLACEHOLDER);
    expect(r.unresolvedPlaceholders).not.toContain("acceptance-criteria");
  });

  it("strips the `<!-- devx:mode -->` idempotency marker line", () => {
    const r = renderPrBody({
      template: BUILTIN_TEMPLATE,
      mode: "YOLO",
      specPath: SPEC_PATH,
      acChecklist: "- [ ] thing",
    });
    expect(r.body).not.toContain("<!-- devx:mode -->");
    expect(r.body).not.toMatch(/^<!--/);
  });

  it("strips ALL idempotency marker lines, not just the first (replaceAll discipline)", () => {
    // Self-review fix (Blind Hunter): MARKER_LINE_RE used to lack the `g`
    // flag, so a template with the marker on multiple line-starts (e.g. a
    // user accidentally pasted it twice, or `## devx` was appended on top
    // of an existing devx block) would leave the second copy in the
    // rendered body.
    const doubled = `<!-- devx:mode -->
**Spec:** \`<dev/dev-<hash>-<ts>-<slug>.md>\`
**Mode:** <!-- devx:auto:mode --> *(stamped at PR-open by /devx)*

<!-- devx:mode -->

## Summary
<1–3 bullets on what changed>

## Acceptance criteria
<checkbox list copied from spec>

## Test plan
<bulleted list of what local CI gates covered + any manual steps>

## Notes for reviewers
<surprises, deviations, follow-ups>
`;
    const r = renderPrBody({
      template: doubled,
      mode: "YOLO",
      specPath: SPEC_PATH,
      acChecklist: "- [ ] thing",
    });
    expect(r.body).not.toContain("<!-- devx:mode -->");
  });
});

describe("renderPrBody — first non-empty line invariant (AC 5)", () => {
  it("first non-empty line of the rendered body is the `**Spec:**` line", () => {
    const r = renderPrBody({
      template: BUILTIN_TEMPLATE,
      mode: "YOLO",
      specPath: SPEC_PATH,
      acChecklist: "- [ ] thing",
    });
    const firstNonEmpty = r.body.split("\n").find((l) => l.trim() !== "");
    expect(firstNonEmpty).toBe(`**Spec:** \`${SPEC_PATH}\``);
  });

  it("sliceAtMarker is line-anchored — user-prose mention of the marker substring does NOT slice", () => {
    // Self-review fix (Edge Case Hunter): sliceAtMarker used to be a plain
    // substring indexOf — a user's hand-edited preamble that mentioned the
    // marker text in prose (e.g. "we use <!-- devx:mode --> to detect
    // already-written templates") would slice from there, producing a body
    // whose first non-empty line was the user's mention rather than
    // **Spec:**. Now the slice fires only on a marker that appears alone on
    // its own line.
    const userPreamble = `## Internal review

We use the marker <!-- devx:mode --> in prose to refer to the idempotency token.
This is intentional and must NOT cause sliceAtMarker to fire here.

## devx

`;
    const template = userPreamble + BUILTIN_TEMPLATE;
    const r = renderPrBody({
      template,
      mode: "YOLO",
      specPath: SPEC_PATH,
      acChecklist: "- [ ] thing",
    });
    const firstNonEmpty = r.body.split("\n").find((l) => l.trim() !== "");
    expect(firstNonEmpty).toBe(`**Spec:** \`${SPEC_PATH}\``);
    expect(r.body).not.toContain("Internal review");
  });

  it("invariant holds even when template has user content above the marker", () => {
    // Simulates the `appended` branch of writePrTemplate (prt101) — user had
    // a hand-edited template, /devx-init appended a `## devx` section under
    // a fresh marker. renderPrBody must slice at the marker so the rendered
    // PR body starts cleanly with **Spec:**.
    const userPreamble = `## Internal review

- [ ] team lead approved
- [ ] design doc linked

## devx

`;
    const template = userPreamble + BUILTIN_TEMPLATE;
    const r = renderPrBody({
      template,
      mode: "YOLO",
      specPath: SPEC_PATH,
      acChecklist: "- [ ] thing",
    });
    const firstNonEmpty = r.body.split("\n").find((l) => l.trim() !== "");
    expect(firstNonEmpty).toBe(`**Spec:** \`${SPEC_PATH}\``);
    expect(r.body).not.toContain("Internal review");
    expect(r.body).not.toContain("team lead approved");
  });
});

describe("renderPrBody — line-anchored substitution (locked decision #4)", () => {
  it("does NOT substitute spec-path placeholder inside a fenced code block", () => {
    // Malicious template fixture per locked decision #4 — substitution must
    // be line-anchored to the canonical `**Spec:**` line position only. A
    // placeholder appearing inside a code block (or any other position) must
    // be left alone.
    const malicious = `<!-- devx:mode -->
**Spec:** \`<dev/dev-<hash>-<ts>-<slug>.md>\`
**Mode:** <!-- devx:auto:mode --> *(stamped at PR-open by /devx)*

## Summary

\`\`\`
example placeholder: <dev/dev-<hash>-<ts>-<slug>.md>
\`\`\`

<1–3 bullets on what changed>

## Acceptance criteria
<checkbox list copied from spec>

## Test plan
<bulleted list of what local CI gates covered + any manual steps>

## Notes for reviewers
<surprises, deviations, follow-ups>
`;
    const r = renderPrBody({
      template: malicious,
      mode: "YOLO",
      specPath: SPEC_PATH,
      acChecklist: "- [ ] thing",
    });
    // The canonical **Spec:** line was substituted exactly once.
    const occurrences = r.body.match(/dev\/dev-prt102-/g) ?? [];
    expect(occurrences.length).toBe(1);
    // The code-block instance of the placeholder is preserved verbatim
    // (line-anchoring discipline).
    expect(r.body).toContain(
      "example placeholder: <dev/dev-<hash>-<ts>-<slug>.md>",
    );
  });

  it("does NOT substitute AC placeholder inside a fenced code block", () => {
    // Closes the locked-decision-#4 coverage gap surfaced in self-review:
    // spec-path and mode were exercised; AC was not. Same shape — a
    // canonical line + a code-block instance. Line-anchoring discipline
    // means only the canonical line substitutes; the code-block instance
    // is preserved verbatim.
    const malicious = `<!-- devx:mode -->
**Spec:** \`<dev/dev-<hash>-<ts>-<slug>.md>\`
**Mode:** <!-- devx:auto:mode --> *(stamped at PR-open by /devx)*

## Summary
<1–3 bullets on what changed>

## Acceptance criteria
<checkbox list copied from spec>

\`\`\`
example: <checkbox list copied from spec>
\`\`\`

## Test plan
<bulleted list of what local CI gates covered + any manual steps>

## Notes for reviewers
<surprises, deviations, follow-ups>
`;
    const r = renderPrBody({
      template: malicious,
      mode: "YOLO",
      specPath: SPEC_PATH,
      acChecklist: "- [ ] only ac",
    });
    // Canonical AC line was substituted exactly once; code-block instance
    // remains untouched (still says "<checkbox list copied from spec>").
    expect(r.body).toContain("- [ ] only ac");
    expect(r.body).toContain(
      "example: <checkbox list copied from spec>",
    );
    // Verify the canonical line is gone (we substituted it) — count remaining
    // placeholder occurrences: should be exactly 1 (the code-block one).
    const remaining = (r.body.match(/<checkbox list copied from spec>/g) ?? [])
      .length;
    expect(remaining).toBe(1);
  });

  it("does NOT substitute mode placeholder when not on the **Mode:** line", () => {
    const malicious = `<!-- devx:mode -->
**Spec:** \`<dev/dev-<hash>-<ts>-<slug>.md>\`
**Mode:** <!-- devx:auto:mode --> *(stamped at PR-open by /devx)*

> Note: the substitution placeholder <!-- devx:auto:mode --> appears in this
> blockquote too — it must NOT be substituted.

## Summary
<1–3 bullets on what changed>

## Acceptance criteria
<checkbox list copied from spec>

## Test plan
<bulleted list of what local CI gates covered + any manual steps>

## Notes for reviewers
<surprises, deviations, follow-ups>
`;
    const r = renderPrBody({
      template: malicious,
      mode: "YOLO",
      specPath: SPEC_PATH,
      acChecklist: "- [ ] thing",
    });
    // Canonical **Mode:** line substituted; blockquote occurrence preserved.
    expect(r.body).toContain("**Mode:** YOLO");
    expect(r.body).toContain(
      "> Note: the substitution placeholder <!-- devx:auto:mode --> appears in this",
    );
  });
});

describe("renderPrBody — optional placeholders + unresolved reporting", () => {
  it("substitutes summary / test plan / notes when provided; marks unresolved otherwise", () => {
    const withAll = renderPrBody({
      template: BUILTIN_TEMPLATE,
      mode: "YOLO",
      specPath: SPEC_PATH,
      acChecklist: "- [ ] thing",
      summary: "- shipped substitution\n- added CLI",
      testPlan: "- npm test (524/524)\n- ran devx pr-body manually",
      notes: "- none",
    });
    expect(withAll.body).toContain("- shipped substitution\n- added CLI");
    expect(withAll.body).toContain("- npm test (524/524)");
    expect(withAll.body).toContain("- none");
    expect(withAll.body).not.toContain(SUMMARY_PLACEHOLDER);
    expect(withAll.body).not.toContain(TEST_PLAN_PLACEHOLDER);
    expect(withAll.body).not.toContain(NOTES_PLACEHOLDER);
    expect(withAll.unresolvedPlaceholders).toEqual([]);

    const minimal = renderPrBody({
      template: BUILTIN_TEMPLATE,
      mode: "YOLO",
      specPath: SPEC_PATH,
      acChecklist: "- [ ] thing",
    });
    // Per locked decision #5: never silently render an empty section.
    // Placeholders for omitted free-text fields remain visible AND are listed
    // in unresolvedPlaceholders so the caller can append a status-log line.
    expect(minimal.body).toContain(SUMMARY_PLACEHOLDER);
    expect(minimal.body).toContain(TEST_PLAN_PLACEHOLDER);
    expect(minimal.body).toContain(NOTES_PLACEHOLDER);
    expect(minimal.unresolvedPlaceholders).toEqual([
      "summary",
      "test-plan",
      "notes",
    ]);
  });

  it("marks AC unresolved when checklist is empty (locked decision #5)", () => {
    const r = renderPrBody({
      template: BUILTIN_TEMPLATE,
      mode: "YOLO",
      specPath: SPEC_PATH,
      acChecklist: "",
    });
    expect(r.body).toContain(AC_PLACEHOLDER);
    expect(r.unresolvedPlaceholders).toContain("acceptance-criteria");
  });

  it("treats whitespace-only placeholder values as unresolved", () => {
    const r = renderPrBody({
      template: BUILTIN_TEMPLATE,
      mode: "YOLO",
      specPath: SPEC_PATH,
      acChecklist: "- [ ] thing",
      summary: "   \n  ",
    });
    expect(r.body).toContain(SUMMARY_PLACEHOLDER);
    expect(r.unresolvedPlaceholders).toContain("summary");
  });

  it("trims surrounding whitespace from substituted values", () => {
    const r = renderPrBody({
      template: BUILTIN_TEMPLATE,
      mode: "YOLO",
      specPath: SPEC_PATH,
      acChecklist: "- [ ] thing",
      summary: "   - real bullet\n",
    });
    expect(r.body).toContain("- real bullet");
    // No leading/trailing blank inside the Summary section.
    expect(r.body).not.toContain("\n   - real bullet");
  });
});

describe("renderPrBody — built-in fallback parity with the on-disk canonical template", () => {
  it("BUILTIN_TEMPLATE matches _devx/templates/pull_request_template.md byte-for-byte", () => {
    // The BUILTIN_TEMPLATE constant is the only fallback when a repo predates
    // prt101 (no .github/pull_request_template.md on disk yet). It MUST stay
    // in lockstep with the on-disk canonical so the rendered PR body looks
    // identical regardless of which path the loader took. CRLF normalized
    // (matches loadTemplate's behavior).
    //
    // From test/foo.test.ts → ../../_devx/templates/pull_request_template.md
    const onDisk = readFileSync(
      resolve(__dirname, "..", "_devx", "templates", "pull_request_template.md"),
      "utf8",
    ).replace(/\r\n/g, "\n");
    expect(BUILTIN_TEMPLATE).toBe(onDisk);
  });
});

describe("extractAcChecklist", () => {
  it("returns the checkbox lines + indented continuations + ### sub-headings", () => {
    const acs = extractAcChecklist(SAMPLE_SPEC);
    expect(acs).toContain("### New surface");
    expect(acs).toContain("- [ ] First AC line.");
    expect(acs).toContain("  - sub-bullet preserved");
    expect(acs).toContain("### Edge cases");
    expect(acs).toContain("- [ ] Edge AC.");
  });

  it("stops at the next `## ` heading (does not bleed into Technical notes)", () => {
    const acs = extractAcChecklist(SAMPLE_SPEC);
    expect(acs).not.toContain("Plain replaceAll");
    expect(acs).not.toContain("Technical notes");
  });

  it("handles checked / blocked / done states ([x] / [-] / [/])", () => {
    const spec = `## Acceptance criteria

- [ ] open
- [x] done
- [-] blocked
- [/] in progress
`;
    const acs = extractAcChecklist(spec);
    expect(acs.split("\n")).toEqual([
      "- [ ] open",
      "- [x] done",
      "- [-] blocked",
      "- [/] in progress",
    ]);
  });

  it("returns empty string when no `## Acceptance criteria` section exists", () => {
    expect(extractAcChecklist("# title\n\nsome prose\n")).toBe("");
  });

  it("returns empty string when AC section exists but has no checkboxes", () => {
    expect(
      extractAcChecklist("## Acceptance criteria\n\nTBD — needs research.\n"),
    ).toBe("");
  });

  it("returns empty string when AC section has only `### ` sub-headings (no checkboxes)", () => {
    // Self-review fix (Edge Case Hunter): a section that captured only
    // sub-headings would render as empty section headers in the PR body.
    // AC 4 specifies "AC list from spec frontmatter (each `- [ ]` line)" —
    // a section with no checkboxes is not an AC list; treat as empty so
    // the caller marks it unresolved per locked decision #5.
    const spec = `## Acceptance criteria

### New surface

### Edge cases

## Technical notes

- some note
`;
    expect(extractAcChecklist(spec)).toBe("");
  });
});

describe("renderPrBody — golden-file shape (AC 6)", () => {
  it("renders a stable shape for the canonical fixture inputs", () => {
    const acs = extractAcChecklist(SAMPLE_SPEC);
    const r = renderPrBody({
      template: BUILTIN_TEMPLATE,
      mode: "YOLO",
      specPath: SPEC_PATH,
      acChecklist: acs,
      summary: "- wired prt102 substitution end-to-end",
      testPlan: "- npm test (cli project)\n- manual: gh pr view",
      notes: "- (none)",
    });
    // Inline snapshot pins the rendered shape. Updating requires
    // `vitest -u` AND a status-log line on whichever spec changed the
    // canonical template — both halves of the contract move together.
    expect(r.body).toMatchInlineSnapshot(`
      "**Spec:** \`dev/dev-prt102-2026-04-28T19:30-pr-template-substitution.md\`
      **Mode:** YOLO

      ## Summary
      - wired prt102 substitution end-to-end

      ## Acceptance criteria
      ### New surface

      - [ ] First AC line.
      - [ ] Second AC line with sub-detail:
        - sub-bullet preserved
      - [ ] Third AC line.

      ### Edge cases

      - [ ] Edge AC.

      ## Test plan
      - npm test (cli project)
      - manual: gh pr view

      ## Notes for reviewers
      - (none)
      "
    `);
    expect(r.unresolvedPlaceholders).toEqual([]);
  });
});
