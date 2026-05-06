// Pure-function tests for /devx Phase 5 mode-derived coverage gate (dvx104).
//
// Covers spec AC #4 — "Tests cover all 4 modes × covered/uncovered touched
// lines × opt-out marker":
//   - 4 modes (YOLO, BETA, PROD, LOCKDOWN) ×
//     covered-only / uncovered-mix / fully-uncovered ×
//     with-opt-out / without-opt-out
//   - Plus standalone parseOptOutMarkers tests.
//
// Mirrors merge-gate-truth-table.test.ts shape (mrg101).
//
// Spec: dev/dev-dvx104-2026-04-28T19:30-devx-coverage-gate.md

import { describe, expect, it } from "vitest";

import {
  type CoverageGateInput,
  type FileLineCoverage,
  type Mode,
  coverageTouchedGate,
  parseOptOutMarkers,
} from "../src/lib/devx/coverage-touched.js";

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

/** All 5 touched lines covered. */
function fullyCovered(path = "src/foo.ts"): FileLineCoverage {
  return {
    path,
    touchedLines: [10, 11, 12, 13, 14],
    coveredLines: [10, 11, 12, 13, 14],
    optedOutLines: [],
  };
}

/** 4 of 5 touched lines covered → 80% exact. */
function mostlyCovered(path = "src/foo.ts"): FileLineCoverage {
  return {
    path,
    touchedLines: [10, 11, 12, 13, 14],
    coveredLines: [10, 11, 12, 13],
    optedOutLines: [],
  };
}

/** 3 of 5 touched lines covered → 60% (below BETA threshold). */
function partiallyCovered(path = "src/foo.ts"): FileLineCoverage {
  return {
    path,
    touchedLines: [10, 11, 12, 13, 14],
    coveredLines: [10, 11, 12],
    optedOutLines: [],
  };
}

/** No touched lines covered. */
function fullyUncovered(path = "src/foo.ts"): FileLineCoverage {
  return {
    path,
    touchedLines: [10, 11, 12, 13, 14],
    coveredLines: [],
    optedOutLines: [],
  };
}

/**
 * Add an opt-out marker on the single uncovered line of `mostlyCovered`,
 * reducing the denominator from 5 to 4 — all 4 remaining lines are
 * covered → 100%. Lifts BETA/PROD pass.
 */
function mostlyCoveredWithOptOut(path = "src/foo.ts"): FileLineCoverage {
  return {
    path,
    touchedLines: [10, 11, 12, 13, 14],
    coveredLines: [10, 11, 12, 13],
    optedOutLines: [14],
  };
}

/** All touched lines opted out → denominator zero → pct null. */
function allOptedOut(path = "src/foo.ts"): FileLineCoverage {
  return {
    path,
    touchedLines: [10, 11, 12, 13, 14],
    coveredLines: [],
    optedOutLines: [10, 11, 12, 13, 14],
  };
}

const MODES: readonly Mode[] = ["YOLO", "BETA", "PROD", "LOCKDOWN"] as const;

// ---------------------------------------------------------------------------
// 4 modes × covered/uncovered touched lines (no opt-out)
// ---------------------------------------------------------------------------

describe("coverageTouchedGate — 4 modes × covered/uncovered (no opt-out)", () => {
  describe("fully covered (100%)", () => {
    it("YOLO → informational", () => {
      const d = coverageTouchedGate({ mode: "YOLO", files: [fullyCovered()] });
      expect(d.outcome).toBe("informational");
      expect(d.pctTouched).toBe(1);
      expect(d.reason).toContain("never blocks merge");
    });

    it("BETA → informational (>= 80%)", () => {
      const d = coverageTouchedGate({ mode: "BETA", files: [fullyCovered()] });
      expect(d.outcome).toBe("informational");
      expect(d.pctTouched).toBe(1);
    });

    it("PROD → informational (100%)", () => {
      const d = coverageTouchedGate({ mode: "PROD", files: [fullyCovered()] });
      expect(d.outcome).toBe("informational");
      expect(d.pctTouched).toBe(1);
    });

    it("LOCKDOWN with browser-QA → informational", () => {
      const d = coverageTouchedGate({
        mode: "LOCKDOWN",
        files: [fullyCovered()],
        browserQaRan: true,
      });
      expect(d.outcome).toBe("informational");
    });

    it("LOCKDOWN without browser-QA → block (browser-QA missing)", () => {
      const d = coverageTouchedGate({
        mode: "LOCKDOWN",
        files: [fullyCovered()],
        browserQaRan: false,
      });
      expect(d.outcome).toBe("block");
      expect(d.reason).toContain("browser-QA pass has not run");
    });
  });

  describe("partially covered — 60% (below BETA threshold)", () => {
    it("YOLO → informational", () => {
      const d = coverageTouchedGate({
        mode: "YOLO",
        files: [partiallyCovered()],
      });
      expect(d.outcome).toBe("informational");
      expect(d.pctTouched).toBeCloseTo(0.6);
    });

    it("BETA → warn (< 80%)", () => {
      const d = coverageTouchedGate({
        mode: "BETA",
        files: [partiallyCovered()],
      });
      expect(d.outcome).toBe("warn");
      expect(d.reason).toContain("< 80%");
      expect(d.reason).toContain("still merges");
    });

    it("PROD → block (< 100%)", () => {
      const d = coverageTouchedGate({
        mode: "PROD",
        files: [partiallyCovered()],
      });
      expect(d.outcome).toBe("block");
      expect(d.reason).toContain("< 100%");
    });

    it("LOCKDOWN → block (< 100%)", () => {
      const d = coverageTouchedGate({
        mode: "LOCKDOWN",
        files: [partiallyCovered()],
        browserQaRan: true,
      });
      expect(d.outcome).toBe("block");
      expect(d.reason).toContain("< 100%");
    });
  });

  describe("mostlyCovered — 80% exact (BETA boundary)", () => {
    it("BETA at exactly 80% → informational (not warn)", () => {
      const d = coverageTouchedGate({
        mode: "BETA",
        files: [mostlyCovered()],
      });
      // The BETA spec is "warn if < 80%" — at exactly 80% the gate
      // passes silently (canonical merge-gate behavior: < is strict).
      expect(d.outcome).toBe("informational");
      expect(d.pctTouched).toBe(0.8);
    });

    it("PROD at 80% → block (< 100%)", () => {
      const d = coverageTouchedGate({
        mode: "PROD",
        files: [mostlyCovered()],
      });
      expect(d.outcome).toBe("block");
    });
  });

  describe("fully uncovered (0%)", () => {
    for (const mode of MODES) {
      it(`${mode} — 0% coverage`, () => {
        const d = coverageTouchedGate({
          mode,
          files: [fullyUncovered()],
          browserQaRan: true,
        });
        expect(d.pctTouched).toBe(0);
        if (mode === "YOLO") {
          expect(d.outcome).toBe("informational");
        } else if (mode === "BETA") {
          expect(d.outcome).toBe("warn");
        } else {
          // PROD / LOCKDOWN
          expect(d.outcome).toBe("block");
        }
      });
    }
  });
});

// ---------------------------------------------------------------------------
// 4 modes × opt-out marker effects
// ---------------------------------------------------------------------------

describe("coverageTouchedGate — opt-out marker × modes", () => {
  it("opt-out lifts BETA from warn to informational (80% → 100%)", () => {
    const without = coverageTouchedGate({
      mode: "BETA",
      files: [mostlyCovered()],
    });
    expect(without.pctTouched).toBe(0.8);
    expect(without.outcome).toBe("informational"); // exactly at threshold

    const with_ = coverageTouchedGate({
      mode: "BETA",
      files: [mostlyCoveredWithOptOut()],
    });
    expect(with_.pctTouched).toBe(1);
    expect(with_.outcome).toBe("informational");
  });

  it("opt-out lifts PROD from block to informational (80% → 100%)", () => {
    const without = coverageTouchedGate({
      mode: "PROD",
      files: [mostlyCovered()],
    });
    expect(without.outcome).toBe("block");

    const with_ = coverageTouchedGate({
      mode: "PROD",
      files: [mostlyCoveredWithOptOut()],
    });
    expect(with_.outcome).toBe("informational");
    expect(with_.pctTouched).toBe(1);
  });

  it("opt-out lifts LOCKDOWN coverage gate (browser-QA still required)", () => {
    const with_ = coverageTouchedGate({
      mode: "LOCKDOWN",
      files: [mostlyCoveredWithOptOut()],
      browserQaRan: true,
    });
    // 100% touched coverage AFTER opt-out + browser-QA → informational.
    expect(with_.outcome).toBe("informational");

    const noQa = coverageTouchedGate({
      mode: "LOCKDOWN",
      files: [mostlyCoveredWithOptOut()],
      browserQaRan: false,
    });
    // 100% coverage but browser-QA missing → still block.
    expect(noQa.outcome).toBe("block");
    expect(noQa.reason).toContain("browser-QA");
  });

  it("opt-out is informational under YOLO (mode dispatch unaffected)", () => {
    const d = coverageTouchedGate({
      mode: "YOLO",
      files: [mostlyCoveredWithOptOut()],
    });
    expect(d.outcome).toBe("informational");
    expect(d.pctTouched).toBe(1);
  });

  it("denominator zero (every line opted out) → pct null", () => {
    for (const mode of MODES) {
      const d = coverageTouchedGate({
        mode,
        files: [allOptedOut()],
        browserQaRan: true,
      });
      expect(d.pctTouched).toBeNull();
      // YOLO/BETA: nothing to grade → informational.
      // PROD/LOCKDOWN: missing data → block.
      if (mode === "YOLO" || mode === "BETA") {
        expect(d.outcome).toBe("informational");
      } else {
        expect(d.outcome).toBe("block");
      }
    }
  });

  it("opt-out and covered overlap — opt-out wins (line excluded entirely)", () => {
    // Adversarial-edge: a line that's BOTH covered and opted out should be
    // excluded from numerator AND denominator. Otherwise an operator who
    // adds an opt-out comment to a line that turns out to be covered
    // anyway would inflate the pct (numerator stays, denominator drops).
    const f: FileLineCoverage = {
      path: "src/foo.ts",
      touchedLines: [10, 11, 12, 13, 14],
      coveredLines: [10, 11, 12, 13, 14], // all covered
      optedOutLines: [14], // line 14 is BOTH covered and opted out
    };
    const d = coverageTouchedGate({ mode: "PROD", files: [f] });
    // With opt-out winning: denom=4 (lines 10-13), numer=4 → 100%.
    // If opt-out lost (opted-out covered line stays in numer but
    // dropped from denom), denom=4 numer=4 ALSO 100%. So this test
    // also enforces that the simple denom calculation is correct
    // regardless of overlap policy. Pin both: pctTouched=1 + opted-out
    // lines never contribute to the numerator (set semantics).
    expect(d.pctTouched).toBe(1);
    expect(d.outcome).toBe("informational");
  });
});

// ---------------------------------------------------------------------------
// 4 modes × covered/uncovered × opt-out — full Cartesian (per AC #4)
// ---------------------------------------------------------------------------

describe("coverageTouchedGate — full Cartesian (mode × coverage × opt-out)", () => {
  interface CovCase {
    name: string;
    file: () => FileLineCoverage;
    expectedPct: number | null;
  }
  const COVERAGE_CASES: CovCase[] = [
    { name: "fully-covered", file: fullyCovered, expectedPct: 1 },
    { name: "partially-covered", file: partiallyCovered, expectedPct: 0.6 },
    { name: "fully-uncovered", file: fullyUncovered, expectedPct: 0 },
  ];

  interface OptOutCase {
    name: string;
    /** Files passed to the gate. */
    files: FileLineCoverage[];
    /** Manual override of expected pct when opt-out changes the denominator. */
    expectedPctOverride?: number | null;
  }

  for (const mode of MODES) {
    for (const cc of COVERAGE_CASES) {
      const optOutCases: OptOutCase[] = [
        { name: "no-opt-out", files: [cc.file()] },
      ];
      // Add an opt-out variant if the input has at least one uncovered
      // touched line that we can opt out (otherwise opt-out is a no-op).
      const f = cc.file();
      const uncoveredTouched = f.touchedLines.find(
        (ln) => !f.coveredLines.includes(ln),
      );
      if (uncoveredTouched !== undefined) {
        const fOpt: FileLineCoverage = {
          ...f,
          optedOutLines: [uncoveredTouched],
        };
        const remaining = f.touchedLines.filter(
          (ln) => ln !== uncoveredTouched,
        );
        const remainingCovered = remaining.filter((ln) =>
          f.coveredLines.includes(ln),
        );
        const newPct =
          remaining.length === 0
            ? null
            : remainingCovered.length / remaining.length;
        optOutCases.push({
          name: "with-opt-out-on-one-uncovered",
          files: [fOpt],
          expectedPctOverride: newPct,
        });
      }

      for (const oc of optOutCases) {
        it(`${mode} | ${cc.name} | ${oc.name}`, () => {
          const input: CoverageGateInput = {
            mode,
            files: oc.files,
            browserQaRan: mode === "LOCKDOWN" ? true : undefined,
          };
          const d = coverageTouchedGate(input);
          const expectedPct =
            oc.expectedPctOverride !== undefined
              ? oc.expectedPctOverride
              : cc.expectedPct;
          if (expectedPct === null) {
            expect(d.pctTouched).toBeNull();
          } else {
            expect(d.pctTouched).toBeCloseTo(expectedPct);
          }
          // Verify outcome by mode + pct.
          if (mode === "YOLO") {
            expect(d.outcome).toBe("informational");
          } else if (mode === "BETA") {
            if (expectedPct === null || expectedPct >= 0.8) {
              expect(d.outcome).toBe("informational");
            } else {
              expect(d.outcome).toBe("warn");
            }
          } else {
            // PROD / LOCKDOWN
            if (expectedPct === 1) {
              expect(d.outcome).toBe("informational");
            } else {
              expect(d.outcome).toBe("block");
            }
          }
        });
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("coverageTouchedGate — input validation", () => {
  it("unknown mode → block (fail closed, mirrors merge-gate)", () => {
    const d = coverageTouchedGate({
      mode: "STAGING" as Mode,
      files: [fullyCovered()],
    });
    expect(d.outcome).toBe("block");
    expect(d.reason).toContain("unknown mode");
  });

  it("empty files list → pct null + outcome by mode", () => {
    const yolo = coverageTouchedGate({ mode: "YOLO", files: [] });
    expect(yolo.pctTouched).toBeNull();
    expect(yolo.outcome).toBe("informational");

    const prod = coverageTouchedGate({ mode: "PROD", files: [] });
    expect(prod.pctTouched).toBeNull();
    expect(prod.outcome).toBe("block");
    expect(prod.reason).toContain("coverage data missing");
  });
});

// ---------------------------------------------------------------------------
// parseOptOutMarkers
// ---------------------------------------------------------------------------

describe("parseOptOutMarkers", () => {
  it("matches `# devx:no-coverage <reason>` (Python/YAML/Ruby comment)", () => {
    const src = [
      "x = 1",
      "y = 2  # devx:no-coverage trivial assignment",
      "z = 3",
    ].join("\n");
    expect(parseOptOutMarkers(src)).toEqual([2]);
  });

  it("matches `// devx:no-coverage` (JS/TS/Dart comment)", () => {
    const src = [
      "const a = 1;",
      "const b = unused(); // devx:no-coverage flag-removed-in-followup",
      "const c = 3;",
    ].join("\n");
    expect(parseOptOutMarkers(src)).toEqual([2]);
  });

  it("matches multiple lines", () => {
    const src = [
      "// devx:no-coverage line 1",
      "x",
      "// devx:no-coverage line 3",
      "y",
      "// devx:no-coverage line 5",
    ].join("\n");
    expect(parseOptOutMarkers(src)).toEqual([1, 3, 5]);
  });

  it("matches without a reason after the marker", () => {
    expect(parseOptOutMarkers("// devx:no-coverage")).toEqual([1]);
    expect(parseOptOutMarkers("// devx:no-coverage\n")).toEqual([1]);
  });

  it("does NOT match an extended marker — devx:no-coverage-extended", () => {
    // Word boundary policy: trailing `-` must NOT extend the marker.
    // Otherwise an operator who introduces a separate marker like
    // `devx:no-coverage-deprecated` would silently exclude lines.
    const src = "// devx:no-coverage-extended description";
    expect(parseOptOutMarkers(src)).toEqual([]);
  });

  it("does NOT match a substring inside an unrelated identifier", () => {
    const src = "const xdevx_no_coverage_thing = 1;";
    expect(parseOptOutMarkers(src)).toEqual([]);
  });

  it("matches at start of line (no leading whitespace)", () => {
    expect(parseOptOutMarkers("devx:no-coverage")).toEqual([1]);
  });

  it("does not match when nothing on the line", () => {
    const src = "\n\n";
    expect(parseOptOutMarkers(src)).toEqual([]);
  });

  it("respects custom marker override", () => {
    const src = "// my-marker exclude this\n// other";
    expect(parseOptOutMarkers(src, "my-marker")).toEqual([1]);
  });

  it("empty marker → no matches (defensive)", () => {
    const src = "any line\nanother";
    // An empty marker would otherwise match every position — explicitly
    // return [] so a hand-edited config can't accidentally exclude
    // every line.
    expect(parseOptOutMarkers(src, "")).toEqual([]);
  });

  it("handles regex meta-chars in the marker safely", () => {
    // Marker with `:` and `-` already exercised; pin meta-chars: `.`
    // and `*` (which would be wildcards if not escaped).
    const src =
      "// foo.bar* literal\n// foo_bar_other\n// other line";
    expect(parseOptOutMarkers(src, "foo.bar*")).toEqual([1]);
  });
});
