// Pure-function tests for shouldCreateStory + readCanary +
// effectivePhase2Action (dvx102).
//
// Spec AC #6: "Tests: 3×6 combinations (canary state × shouldCreateStory
// inputs)". The 6 input shapes exercise all 4 decision outcomes plus the
// priority order (story-file-exists > shape-not-empty-dream > few-acs >
// skip). The 18 effectivePhase2Action combos exercise the full canary
// truth table.
//
// Spec: dev/dev-dvx102-2026-04-28T19:30-devx-conditional-create-story.md

import { describe, expect, it } from "vitest";

import {
  type CanaryState,
  type ShouldCreateStoryConfig,
  type ShouldCreateStorySpecInput,
  effectivePhase2Action,
  readCanary,
  shouldCreateStory,
} from "../src/lib/devx/should-create-story.js";

// ---------------------------------------------------------------------------
// shouldCreateStory — pure decision over (project.shape, ACs, hasStoryFile)
// ---------------------------------------------------------------------------

interface InputCase {
  name: string;
  shape: string | undefined;
  acCount: number;
  hasStoryFile: boolean;
  expectInvoke: boolean;
  expectReason: string | RegExp;
}

const SIX_INPUTS: InputCase[] = [
  {
    // Canonical "skip" case — exactly what dvx102 ships to encode.
    name: "empty-dream + 5 ACs + no story file → skip",
    shape: "empty-dream",
    acCount: 5,
    hasStoryFile: false,
    expectInvoke: false,
    expectReason: /^project_shape=empty-dream \+ 5 ACs \+ no story file$/,
  },
  {
    // AC count below threshold — let bmad-create-story expand the spec.
    name: "empty-dream + 2 ACs + no story file → invoke (few-acs)",
    shape: "empty-dream",
    acCount: 2,
    hasStoryFile: false,
    expectInvoke: true,
    expectReason: "few-actionable-acs",
  },
  {
    // Story-file precedence over shape/AC — even an empty-dream skip
    // case yields invoke=true when a story file already exists, because
    // the existing-story short-circuit supersedes.
    name: "empty-dream + 5 ACs + story file exists → invoke (story-file-exists)",
    shape: "empty-dream",
    acCount: 5,
    hasStoryFile: true,
    expectInvoke: true,
    expectReason: "story-file-exists",
  },
  {
    // Story-file precedence covers the few-acs case too — we never
    // need to "create the story" if one already exists.
    name: "empty-dream + 2 ACs + story file exists → invoke (story-file-exists)",
    shape: "empty-dream",
    acCount: 2,
    hasStoryFile: true,
    expectInvoke: true,
    expectReason: "story-file-exists",
  },
  {
    // Shape != empty-dream → always invoke (regardless of AC count).
    name: "mature-refactor + 5 ACs + no story file → invoke (shape-not-empty-dream)",
    shape: "mature-refactor-and-add",
    acCount: 5,
    hasStoryFile: false,
    expectInvoke: true,
    expectReason: "shape-not-empty-dream",
  },
  {
    // Shape != empty-dream BUT story file exists — story-file precedence
    // wins over shape check (case 1 of the priority order).
    name: "mature-refactor + 5 ACs + story file exists → invoke (story-file-exists)",
    shape: "mature-refactor-and-add",
    acCount: 5,
    hasStoryFile: true,
    expectInvoke: true,
    expectReason: "story-file-exists",
  },
];

describe("shouldCreateStory — 6 input combinations", () => {
  for (const c of SIX_INPUTS) {
    it(c.name, () => {
      const config: ShouldCreateStoryConfig = c.shape
        ? { project: { shape: c.shape } }
        : {};
      const spec: ShouldCreateStorySpecInput = {
        acCount: c.acCount,
        hasStoryFile: c.hasStoryFile,
      };
      const decision = shouldCreateStory(config, spec);
      expect(decision.invoke).toBe(c.expectInvoke);
      if (c.expectReason instanceof RegExp) {
        expect(decision.reason).toMatch(c.expectReason);
      } else {
        expect(decision.reason).toBe(c.expectReason);
      }
    });
  }

  it("undefined shape (no project key) → invoke (shape-not-empty-dream)", () => {
    const decision = shouldCreateStory(
      {},
      { acCount: 5, hasStoryFile: false },
    );
    expect(decision.invoke).toBe(true);
    expect(decision.reason).toBe("shape-not-empty-dream");
  });

  it("AC count exactly at threshold (3) → skip", () => {
    const decision = shouldCreateStory(
      { project: { shape: "empty-dream" } },
      { acCount: 3, hasStoryFile: false },
    );
    expect(decision.invoke).toBe(false);
    expect(decision.reason).toMatch(/3 ACs/);
  });

  it("AC count just below threshold (2) → invoke (few-acs)", () => {
    const decision = shouldCreateStory(
      { project: { shape: "empty-dream" } },
      { acCount: 2, hasStoryFile: false },
    );
    expect(decision.invoke).toBe(true);
    expect(decision.reason).toBe("few-actionable-acs");
  });
});

// ---------------------------------------------------------------------------
// readCanary — defaults to "off" on missing/invalid; recognizes 3 valid states
// ---------------------------------------------------------------------------

describe("readCanary", () => {
  it("missing _internal section → off", () => {
    expect(readCanary({})).toBe("off");
  });

  it("missing skip_create_story_canary → off", () => {
    expect(readCanary({ _internal: {} })).toBe("off");
  });

  it("recognizes 'off'", () => {
    expect(
      readCanary({ _internal: { skip_create_story_canary: "off" } }),
    ).toBe("off");
  });

  it("recognizes 'active'", () => {
    expect(
      readCanary({ _internal: { skip_create_story_canary: "active" } }),
    ).toBe("active");
  });

  it("recognizes 'default'", () => {
    expect(
      readCanary({ _internal: { skip_create_story_canary: "default" } }),
    ).toBe("default");
  });

  it("typo (e.g. 'on') silently rejects → off (defensive default)", () => {
    expect(
      readCanary({ _internal: { skip_create_story_canary: "on" } }),
    ).toBe("off");
  });

  it("non-string value → off", () => {
    expect(
      // deliberate type-poke: simulate a hand-edit that puts a non-string
      readCanary({
        _internal: {
          skip_create_story_canary: 1 as unknown as string,
        },
      }),
    ).toBe("off");
  });
});

// ---------------------------------------------------------------------------
// effectivePhase2Action — full 3 × 6 = 18-cell truth table
// ---------------------------------------------------------------------------

const CANARY_STATES: CanaryState[] = ["off", "active", "default"];

interface ExpectedEffective {
  action: "invoke" | "skip" | "read-existing";
  /** Substring expected in the status-log line (the SKIPPED/INVOKED tag). */
  statusLogContains: string;
}

/**
 * Per-(canary, input) expected EffectiveAction. The 18 cells are derived
 * from the rules in should-create-story.ts:
 *   - hasStoryFile=true → action=read-existing for every canary
 *   - canary=off + hasStoryFile=false → action=invoke (helper not honored)
 *   - canary=active|default + hasStoryFile=false:
 *       decision.invoke=true → action=invoke
 *       decision.invoke=false → action=skip
 */
function expectedFor(
  canary: CanaryState,
  c: InputCase,
): ExpectedEffective {
  if (c.hasStoryFile) {
    return {
      action: "read-existing",
      statusLogContains: "SKIPPED (story-file-exists",
    };
  }
  if (canary === "off") {
    return {
      action: "invoke",
      statusLogContains: "INVOKED (canary=off",
    };
  }
  // canary in {active, default}
  if (c.expectInvoke) {
    return { action: "invoke", statusLogContains: "INVOKED" };
  }
  return { action: "skip", statusLogContains: "SKIPPED (helper)" };
}

describe("effectivePhase2Action — 3×6 truth table (canary × inputs)", () => {
  for (const canary of CANARY_STATES) {
    for (const c of SIX_INPUTS) {
      it(`canary=${canary} | ${c.name}`, () => {
        const config: ShouldCreateStoryConfig = c.shape
          ? { project: { shape: c.shape } }
          : {};
        const decision = shouldCreateStory(config, {
          acCount: c.acCount,
          hasStoryFile: c.hasStoryFile,
        });
        const eff = effectivePhase2Action(canary, decision);
        const expected = expectedFor(canary, c);
        expect(eff.action).toBe(expected.action);
        expect(eff.statusLog).toMatch(
          new RegExp(`^phase 2: canary=${canary}, shouldCreateStory=`),
        );
        expect(eff.statusLog).toContain(expected.statusLogContains);
      });
    }
  }

  it("status-log line includes the helper reason verbatim", () => {
    const decision = shouldCreateStory(
      { project: { shape: "empty-dream" } },
      { acCount: 7, hasStoryFile: false },
    );
    const eff = effectivePhase2Action("active", decision);
    expect(eff.statusLog).toContain(
      "shouldCreateStory=project_shape=empty-dream + 7 ACs + no story file",
    );
    expect(eff.action).toBe("skip");
    expect(eff.statusLog).toContain("SKIPPED (helper)");
  });

  it("canary=default behaves identically to active for the skip case", () => {
    const decision = shouldCreateStory(
      { project: { shape: "empty-dream" } },
      { acCount: 7, hasStoryFile: false },
    );
    const active = effectivePhase2Action("active", decision);
    const def = effectivePhase2Action("default", decision);
    expect(active.action).toBe("skip");
    expect(def.action).toBe("skip");
    // status log differs only in canary= prefix
    expect(active.statusLog.replace(/canary=active/, "canary=default")).toBe(
      def.statusLog,
    );
  });

  it("canary=off does not honor invoke=false (the load-bearing v0 preservation)", () => {
    // The whole point of canary=off as the post-ship default: the helper
    // can SAY skip, but Phase 2 keeps invoking. Ensures the canary doesn't
    // accidentally enable the conditional path before the rollout's ready.
    const decision = shouldCreateStory(
      { project: { shape: "empty-dream" } },
      { acCount: 5, hasStoryFile: false },
    );
    expect(decision.invoke).toBe(false);
    const eff = effectivePhase2Action("off", decision);
    expect(eff.action).toBe("invoke");
    expect(eff.statusLog).toContain("INVOKED (canary=off");
  });
});
