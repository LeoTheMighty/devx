// Handoff Snippet shape assertion (dvx107).
//
// Pins:
//   • The /devx skill body documents the snippet template structurally
//     (AC #1, #2, #3, #4) — fenced ```text``` block under "## Handoff
//     Snippet", with all 5 required sections + final "Continue from <…>."
//     line, plus the AC #4 suppression rule.
//   • The validator in `src/lib/devx/handoff-snippet.ts` accepts a realistic
//     fixture session (AC #5).
//   • The validator REJECTS each structurally-broken variant (negative
//     cases) — missing fence, missing each required section, missing the
//     final continue line. Negatives are how we tell "the validator works"
//     from "the validator passes everything".
//
// Why a discipline test on a markdown file: the skill body IS the program
// that runs the loop. The same regression vector that motivated dvx101
// (push-before-PR), mrg102 (merge-gate), prt102 (pr-body), dvx105
// (await-remote-ci), and dvx106 (Phase 8 dispatch) applies here — without
// a structural lock the prose drifts. dvx107's Handoff Snippet is the
// /clear-and-resume bridge; if it loses the "Continue from <…>." line or
// any of the 5 sections, a fresh agent re-discovers state we already
// figured out.
//
// Spec: dev/dev-dvx107-2026-04-28T19:30-devx-stop-after-handoff.md
// Epic: _bmad-output/planning-artifacts/epic-devx-skill.md

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  parseHandoffSnippet,
  REQUIRED_SECTION_HEADINGS,
  type RequiredSectionHeading,
} from "../src/lib/devx/handoff-snippet.js";

const REPO_ROOT = resolve(__dirname, "..");
const SKILL_PATH = resolve(REPO_ROOT, ".claude/commands/devx.md");
const FIXTURE_PATH = resolve(REPO_ROOT, "test/fixtures/handoff-snippet-realistic.md");

function loadSkill(): string {
  return readFileSync(SKILL_PATH, "utf8");
}

function loadFixture(): string {
  return readFileSync(FIXTURE_PATH, "utf8");
}

/**
 * Extract the body of `## Handoff Snippet …` up to the next top-level `## `
 * heading or EOF. Fence-aware: a `## ` line *inside* a fenced code block
 * (the snippet template uses `## Already done` etc. as inner section
 * headings) does NOT terminate the section. Without this, the extractor
 * cuts at the first inner heading and returns a truncated body.
 */
function handoffSnippetSection(skill: string): string {
  const start = skill.match(/^## Handoff Snippet[^\n]*\n/m);
  if (!start) throw new Error("Handoff Snippet section not found in skill body");
  const offset = (start.index ?? 0) + start[0].length;
  const lines = skill.slice(offset).split(/\r?\n/);
  const out: string[] = [];
  let openFence: string | null = null;
  for (const line of lines) {
    const fenceMatch = line.match(/^(`{3,})/);
    if (openFence === null && fenceMatch) {
      openFence = fenceMatch[1];
      out.push(line);
      continue;
    }
    if (openFence !== null && fenceMatch && fenceMatch[1] === openFence) {
      openFence = null;
      out.push(line);
      continue;
    }
    if (openFence === null && /^## /.test(line)) {
      break;
    }
    out.push(line);
  }
  return out.join("\n");
}

/**
 * Extract `### Phase 9: …` body up to the next heading at any level
 * (`### ` or `## `) or EOF. Phase 9 is the LAST `### ` heading in the skill
 * body — bounding only on `^### ` would let the slice spill through Handoff
 * Snippet, Finalization, Key References, etc. and silently weaken the
 * phase-9 assertions (a `halt early ... Handoff Snippet` regex match could
 * straddle two unrelated sections).
 */
function phase9Body(skill: string): string {
  const start = skill.match(/^### Phase 9:[^\n]*\n/m);
  if (!start) throw new Error("Phase 9 heading not found in skill body");
  const offset = (start.index ?? 0) + start[0].length;
  const rest = skill.slice(offset);
  const next = rest.match(/^(### |## )/m);
  return next ? rest.slice(0, next.index) : rest;
}

/**
 * Extract the `**stop_after**` argument entry from the routing/arguments
 * section. v2d101 reshaped the section from a `- **stop_after**` bullet
 * list ("## Arguments") into a numbered "## Routing (the dispatcher)" list
 * (`5. **stop_after**: …`) — accept both shapes so the pin survives the
 * dispatcher re-home while still locking the contract content.
 */
function stopAfterArgumentBullet(skill: string): string {
  const m = skill.match(
    /^(?:- |\d+\. )\*\*stop_after\*\*[^\n]*(?:\n {2,}[^\n]*)*/m,
  );
  if (!m) throw new Error("stop_after argument bullet not found");
  return m[0];
}

describe("devx skill — Arguments section documents stop_after (dvx107 AC #1)", () => {
  it("Arguments section lists all four stop_after values + default this-item", () => {
    const bullet = stopAfterArgumentBullet(loadSkill());
    // All four values must appear verbatim — the dispatch reads these from
    // the user's invocation, so renaming is a contract break.
    expect(bullet).toMatch(/`this-item`/);
    expect(bullet).toMatch(/`n-items`/);
    expect(bullet).toMatch(/`until-blocked`/);
    expect(bullet).toMatch(/`all`/);
    // Default must be this-item — single-shot is the safe default for an
    // unspecified invocation. Both phrasings pin the same contract:
    // "Default: `this-item`" (v1) / "`this-item` (default)" (v2 dispatcher).
    expect(bullet).toMatch(/Default:\s*`this-item`|`this-item`\s*\(default\)/);
  });

  it("Arguments section documents loop-back semantics for n-items / all", () => {
    const bullet = stopAfterArgumentBullet(loadSkill());
    // AC #1: "Supports loop-back to Phase 1 for next ready item under
    // n-items / all". We assert both keywords AND the loop-back verb appear
    // in the same bullet so the contract is locally readable.
    expect(bullet).toMatch(/loop[- ]?back|loop back|loops back|claim another/i);
  });
});

describe("devx skill — Phase 9 dispatches every stop_after state (dvx107 AC #1)", () => {
  it("Phase 9 enumerates this-item, n-items, until-blocked, and all", () => {
    const body = phase9Body(loadSkill());
    expect(body).toMatch(/stop_after == this-item/);
    expect(body).toMatch(/stop_after == n-items/);
    expect(body).toMatch(/stop_after == until-blocked/);
    expect(body).toMatch(/stop_after == all/);
  });

  it("Phase 9 documents the early-stop → Handoff Snippet bridge", () => {
    const body = phase9Body(loadSkill());
    // The early-stop bullet is what bridges the loop to the snippet — if a
    // future maintainer drops it, agents won't know to emit the snippet on
    // context-budget halts.
    expect(body).toMatch(/halt early[\s\S]*Handoff Snippet/);
  });
});

describe("devx skill — Handoff Snippet template shape (dvx107 AC #2, #3, #4)", () => {
  it("Handoff Snippet section exists and contains a fenced text block", () => {
    const section = handoffSnippetSection(loadSkill());
    // Fence count is 3+ backticks; skill body uses 4 to nest the template
    // in markdown. Validator below tolerates both.
    expect(section).toMatch(/^`{3,}text\s*$/m);
  });

  it("Handoff Snippet template parses cleanly through parseHandoffSnippet (AC #2 + #3)", () => {
    const section = handoffSnippetSection(loadSkill());
    const result = parseHandoffSnippet(section);
    if (!result.ok) {
      // Surface the structured errors so a failing assertion tells the
      // maintainer exactly which piece drifted.
      throw new Error(
        `skill body Handoff Snippet template failed validation: ${JSON.stringify(result.errors)}`,
      );
    }
    expect(result.snippet.continueLine).toMatch(/^Continue from .+\.\s*$/);
  });

  it("Handoff Snippet template documents the AC #4 suppression rule", () => {
    const section = handoffSnippetSection(loadSkill());
    // AC #4: "On full-run completion (all targeted items merged, no pending
    // work), the snippet is suppressed." The skill body must explicitly say
    // this — otherwise an agent could legitimately emit the snippet at the
    // end of every successful run, polluting the user's terminal.
    expect(section).toMatch(/Only emit when stopping early/);
    expect(section).toMatch(/Full-run completion[\s\S]*skips? the snippet/);
  });

  it("Handoff Snippet template enumerates every required section (AC #3)", () => {
    const section = handoffSnippetSection(loadSkill());
    // Each required heading must appear inside the section body — pinning
    // the strings here is the structural lock that catches a maintainer
    // renaming "## Gotchas" to "## Caveats" (the validator would also
    // catch it, but pinning here gives a clearer failure signal).
    for (const heading of REQUIRED_SECTION_HEADINGS) {
      expect(section).toContain(heading);
    }
    // Final `Continue from <…>.` line.
    expect(section).toMatch(/Continue from <next hash or slug>\./);
  });
});

describe("parseHandoffSnippet — fixture session (dvx107 AC #5)", () => {
  it("validates a realistic mid-loop fixture as ok", () => {
    const result = parseHandoffSnippet(loadFixture());
    if (!result.ok) {
      throw new Error(
        `fixture failed validation: ${JSON.stringify(result.errors, null, 2)}`,
      );
    }
    // ok-narrowed: snippet is defined.
    // Sanity-check parsed fields: fence is 3 backticks (runtime form),
    // continue line cites the next hash.
    expect(result.snippet.fence).toBe("```");
    expect(result.snippet.continueLine).toBe("Continue from dvx104.");
  });

  it("preserves snippet body content for downstream consumers", () => {
    const result = parseHandoffSnippet(loadFixture());
    if (!result.ok) {
      throw new Error("fixture should validate ok");
    }
    // The body must include each section's first bullet (sanity check that
    // we're returning the inner content, not just the fence-marker line).
    expect(result.snippet.body).toContain("dvx101: claim helper");
    expect(result.snippet.body).toContain("dvx104: mode-derived coverage gate");
    expect(result.snippet.body).toContain("Mode: YOLO");
  });
});

describe("parseHandoffSnippet — negative cases (dvx107 AC #5)", () => {
  // Build a baseline-valid snippet by reading the fixture, so each negative
  // case mutates one specific structural requirement off.
  function baselineSnippet(): string {
    return loadFixture();
  }

  it("rejects a message with no fenced text block at all", () => {
    const result = parseHandoffSnippet("Just some prose, no snippet here.\n");
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === "missing-fence")).toBe(true);
  });

  it("rejects a message with an unterminated fence", () => {
    const broken = "```text\n## Already done\n## Next up\n## State to trust\n## Gotchas\n## Do NOT\nContinue from x.\n";
    const result = parseHandoffSnippet(broken);
    expect(result.ok).toBe(false);
    expect(
      result.errors.some(
        (e) => e.code === "unterminated-fence" || e.code === "missing-fence",
      ),
    ).toBe(true);
  });

  for (const heading of REQUIRED_SECTION_HEADINGS) {
    it(`rejects a snippet missing the "${heading}" section`, () => {
      const fixture = baselineSnippet();
      // Strip the heading line and the section's bullet content up to the
      // next `## ` heading (or the trailing `Continue from`). The fixture's
      // headings have parentheticals (e.g. `## Already done (do not rerun)`)
      // — we anchor on `^## Already done` and walk up to the next `## ` or
      // `Continue from`.
      const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const stripRe = new RegExp(
        `^${escaped}[^\\n]*\\n(?:(?!^## |^Continue from )[\\s\\S])*`,
        "m",
      );
      const mutated = fixture.replace(stripRe, "");
      const result = parseHandoffSnippet(mutated);
      if (result.ok) {
        throw new Error(
          `expected validation failure for missing "${heading}" section`,
        );
      }
      const missing = result.errors.find(
        (e): e is { code: "missing-section"; section: RequiredSectionHeading } =>
          e.code === "missing-section",
      );
      expect(missing?.section).toBe(heading);
    });
  }

  it("rejects a snippet missing the final `Continue from <…>.` line", () => {
    const fixture = baselineSnippet();
    // Drop the "Continue from dvx104." line (and only that line — we must
    // keep the rest intact so this negative case isolates the missing
    // continue-line failure mode).
    const mutated = fixture.replace(/^Continue from [^\n]+\.\s*$/m, "");
    const result = parseHandoffSnippet(mutated);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === "missing-continue-line")).toBe(true);
  });
});

describe("parseHandoffSnippet — defensive tolerances (dvx107 review fixes)", () => {
  // These tests pin loosenings made during dvx107's adversarial review so a
  // future maintainer who tightens the regexes (e.g., back to literal-space
  // match) breaks an explicit assertion rather than silently regressing.
  const minimalSnippet = (
    fenceLine: string,
    spaceBetweenHeadingAndParen: string,
  ): string => `prose
${fenceLine}
## Already done${spaceBetweenHeadingAndParen}(do not rerun)
- a: PR #1, merged

## Next up (in order)
- b: next

## State to trust
- branch: main

## Gotchas from prior session (don't rediscover)
- nothing

## Do NOT
- redo

Continue from b.
\`\`\`
trailing prose
`;

  it("tolerates a CommonMark info-string after the `text` language tag", () => {
    // ` ```text title="snippet" ` is valid CommonMark; the validator must
    // still recognize the open fence so a future renderer that prepends a
    // title doesn't make every emitted snippet fail validation.
    const result = parseHandoffSnippet(
      minimalSnippet("```text title=\"snippet\"", " "),
    );
    expect(result.ok).toBe(true);
  });

  it("tolerates a tab between heading text and the trailing parenthetical", () => {
    // Editors that auto-format markdown sometimes emit tabs. The hasSection
    // check must accept any whitespace (space OR tab), not just a literal
    // space — otherwise `## Already done\t(do not rerun)` would falsely
    // emit `missing-section: ## Already done`.
    const result = parseHandoffSnippet(minimalSnippet("```text", "\t"));
    expect(result.ok).toBe(true);
  });

  it("strips trailing horizontal whitespace from the captured continue line", () => {
    // Stray editor whitespace on the continue line should not change the
    // canonical string callers compare against.
    const withTrailingSpaces = `prose
\`\`\`text
## Already done
- a

## Next up
- b

## State to trust
- branch

## Gotchas
- none

## Do NOT
- redo

Continue from b.${"   "}
\`\`\`
`;
    const result = parseHandoffSnippet(withTrailingSpaces);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snippet.continueLine).toBe("Continue from b.");
    }
  });
});
