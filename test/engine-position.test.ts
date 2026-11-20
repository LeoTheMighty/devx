// The gate-evidence reconciler — the mechanical half of `/devx-review`
// (row A16/B13/C13 of docs/updates/8am-harness-gap-analysis.md).
//
// Table tests over `reconcileGates`, one per check, because the module is
// pure: every disk fact arrives as a probe, so a check is a comparison and a
// comparison is testable without a repo. The two that matter most are the
// NEGATIVE ones — a clean state produces nothing, and a pure relocation is
// not a rewrite. A reconciler that cries wolf on every workstream is worse
// than no reconciler, because a report nobody reads is a report that hides
// the one real finding.
//
// State is built by running the REAL frontmatter parser over spec text
// rather than by hand-constructing `EngineState`. A hand-built state can
// express things the parser never produces, which is how a check passes its
// test and misses in production.

import { describe, expect, it } from "vitest";

import { readEngineState } from "../src/lib/engine/frontmatter.js";
import { VERDICTS } from "../src/lib/engine/verdict.js";
import {
  type GateEvidenceMap,
  type PathProbe,
  type PositionFinding,
  REVIEW_VERDICTS,
  reconcileGates,
  reviewVerdictFor,
  tallyFindings,
} from "../src/lib/engine/position.js";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/** Epoch seconds, far enough apart that ordering is unambiguous. */
const T_EARLY = 1_700_000_000;
const T_LATE = 1_700_100_000;

function probe(rel: string, over: Partial<PathProbe> = {}): PathProbe {
  return { rel, exists: true, changedAt: T_EARLY, dirty: false, ...over };
}

/** A workstream whose every gate is green and whose every record is present
 *  and newer than its subject — the shape that must produce nothing. */
function greenGates(over: Partial<Record<keyof GateEvidenceMap, Partial<GateEvidenceMap[keyof GateEvidenceMap]>>> = {}): GateEvidenceMap {
  const base: GateEvidenceMap = {
    prd: {
      subjects: [probe("prd/agent.md"), probe("expectations.md")],
      evidence: null,
      rerun: "devx gate prd abc123",
    },
    design: {
      subjects: [probe("design/agent.md")],
      evidence: probe("decisions/2026-01-01-design-verify.md", { changedAt: T_LATE }),
      rerun: "devx gate coverage abc123",
    },
    plan: {
      subjects: [probe("plan/agent.md")],
      evidence: probe("decisions/2026-01-01-plan-verify.md", { changedAt: T_LATE }),
      rerun: "devx gate coverage abc123",
    },
    evals: {
      subjects: [probe("evals/E-1_thing.ts")],
      evidence: probe("evals/RED-report.md", { changedAt: T_LATE }),
      rerun: "devx gate evals abc123",
    },
  };
  for (const [key, patch] of Object.entries(over)) {
    base[key as keyof GateEvidenceMap] = {
      ...base[key as keyof GateEvidenceMap],
      ...patch,
    } as GateEvidenceMap[keyof GateEvidenceMap];
  }
  return base;
}

const ALL_GREEN_FM = [
  "hash: abc123",
  "type: plan",
  "stage: executing",
  "gate_status:",
  "  prd_validated: true",
  "  design_verified: true",
  "  plan_verified: true",
  "  evals_red: true",
  "  evals_locked: true",
  "gate_verdicts:",
  "  prd: PASS",
  "  design: PASS",
  "  plan: PASS",
  "  evals: PASS",
];

function stateFrom(lines: string[]) {
  return readEngineState(["---", ...lines, "---", "", "body", ""].join("\n"));
}

const checks = (findings: readonly PositionFinding[]): string[] =>
  findings.map((f) => f.check);

const PASSING = {
  state: stateFrom(ALL_GREEN_FM),
  gates: greenGates(),
  prdRecheck: { verdict: "PASS" as const, gaps: [] },
};

// ---------------------------------------------------------------------------
// The negative controls come first — they are the expensive ones to get wrong
// ---------------------------------------------------------------------------

describe("reconcileGates — silence when there is nothing to say", () => {
  it("a fully green, fully evidenced workstream produces no findings", () => {
    expect(reconcileGates(PASSING)).toEqual([]);
    expect(reviewVerdictFor(reconcileGates(PASSING))).toBe("CLEAN");
  });

  it("an open gate is never a finding — that is the gate working", () => {
    const state = stateFrom([
      "hash: abc123",
      "stage: design",
      "gate_status:",
      "  prd_validated: true",
      "  design_verified: false",
      "  plan_verified: false",
      "  evals_red: false",
      "gate_verdicts:",
      "  prd: PASS",
      "  design: FAIL",
    ]);
    // design FAILed and is open: the report of record says so, and that is
    // not a reconciliation defect.
    expect(reconcileGates({ ...PASSING, state })).toEqual([]);
  });

  it("a relocation is not a rewrite: equal change times produce nothing", () => {
    // The folder-per-artifact migration moved every artifact long after its
    // gate. With `--diff-filter=AM` the subject's change time stays at the
    // commit that wrote it, so this must stay silent.
    const gates = greenGates({
      design: {
        subjects: [probe("design/agent.md", { changedAt: T_LATE })],
        evidence: probe("decisions/2026-01-01-design-verify.md", { changedAt: T_LATE }),
      },
    });
    expect(checks(reconcileGates({ ...PASSING, gates }))).toEqual([]);
  });

  it("an unknown change time skips the comparison rather than guessing", () => {
    const gates = greenGates({
      design: { subjects: [probe("design/agent.md", { changedAt: null })] },
    });
    expect(checks(reconcileGates({ ...PASSING, gates }))).toEqual([]);
  });

  it("a null prdRecheck is not a regression", () => {
    expect(reconcileGates({ ...PASSING, prdRecheck: null })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// One case per check
// ---------------------------------------------------------------------------

describe("reconcileGates — premature closure", () => {
  it("flags a green gate whose evidence record is missing", () => {
    const gates = greenGates({
      design: {
        evidence: probe("decisions/<date>-design-verify.md", { exists: false, changedAt: null }),
      },
    });
    const found = reconcileGates({ ...PASSING, gates });
    expect(checks(found)).toEqual(["premature-closure"]);
    expect(found[0].severity).toBe("blocking");
    expect(found[0].receipt).toContain("does not exist");
    expect(found[0].receipt).toContain("devx gate coverage abc123");
  });

  it("flags a green gate whose SUBJECT is missing", () => {
    const gates = greenGates({
      plan: { subjects: [probe("plan/agent.md", { exists: false })] },
    });
    expect(checks(reconcileGates({ ...PASSING, gates }))).toEqual(["subject-missing"]);
  });

  it("flags a subject changed after its record was written", () => {
    const gates = greenGates({
      plan: {
        subjects: [probe("plan/agent.md", { changedAt: T_LATE + 1 })],
        evidence: probe("decisions/2026-01-01-plan-verify.md", { changedAt: T_LATE }),
      },
    });
    const found = reconcileGates({ ...PASSING, gates });
    expect(checks(found)).toEqual(["stale-evidence"]);
    expect(found[0].severity).toBe("blocking");
    // The receipt is the command a reader runs to see it for themselves.
    expect(found[0].receipt).toContain("git log --follow");
  });

  it("checks EVERY subject of a gate, not just the first", () => {
    // Gate 1 gates two artifacts. A rewritten expectations.md behind an
    // untouched PRD is exactly what a single-subject probe would miss.
    const gates = greenGates({
      prd: { subjects: [probe("prd/agent.md"), probe("expectations.md", { dirty: true })] },
    });
    const found = reconcileGates({ ...PASSING, gates });
    expect(checks(found)).toEqual(["uncommitted-subject"]);
    expect(found[0].message).toContain("expectations.md");
  });

  it("reports a dirty subject as advisory, not blocking", () => {
    const gates = greenGates({
      design: { subjects: [probe("design/agent.md", { dirty: true })] },
    });
    const found = reconcileGates({ ...PASSING, gates });
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("advisory");
  });
});

describe("reconcileGates — frontmatter self-contradiction", () => {
  it("flags a flag-true gate whose persisted verdict is FAIL", () => {
    const state = stateFrom([
      ...ALL_GREEN_FM.slice(0, ALL_GREEN_FM.indexOf("gate_verdicts:")),
      "gate_verdicts:",
      "  prd: PASS",
      "  design: FAIL",
      "  plan: PASS",
      "  evals: PASS",
    ]);
    const found = reconcileGates({ ...PASSING, state });
    expect(checks(found)).toEqual(["verdict-disagrees"]);
    expect(found[0].severity).toBe("blocking");
  });

  it("collapses every unpersisted verdict into ONE advisory finding", () => {
    // A pre-verdict workstream has all four. Four rows about one migration
    // is how a reader learns to skim the report.
    const state = stateFrom([
      "hash: abc123",
      "stage: executing",
      "gate_status:",
      "  prd_validated: true",
      "  design_verified: true",
      "  plan_verified: true",
      "  evals_red: true",
      "  evals_locked: true",
    ]);
    const found = reconcileGates({ ...PASSING, state });
    expect(checks(found)).toEqual(["verdict-not-persisted"]);
    expect(found[0].message).toContain("prd, design, plan, evals");
  });

  it("flags a green gate behind an open one as unreachable", () => {
    const state = stateFrom([
      "hash: abc123",
      "stage: plan",
      "gate_status:",
      "  prd_validated: false",
      "  design_verified: true",
      "  plan_verified: false",
      "  evals_red: false",
      "gate_verdicts:",
      "  design: PASS",
    ]);
    const found = reconcileGates({ ...PASSING, state });
    expect(checks(found)).toContain("illegal-transition");
    expect(found.find((f) => f.check === "illegal-transition")?.message).toContain(
      "prd_validated",
    );
  });

  it("flags an executing stage with an open gate", () => {
    const state = stateFrom([
      "hash: abc123",
      "stage: executing",
      "gate_status:",
      "  prd_validated: true",
      "  design_verified: true",
      "  plan_verified: true",
      "  evals_red: false",
      "gate_verdicts:",
      "  prd: PASS",
      "  design: PASS",
      "  plan: PASS",
    ]);
    const found = reconcileGates({ ...PASSING, state });
    expect(checks(found)).toContain("stage-ahead-of-gates");
    expect(
      found.find((f) => f.check === "stage-ahead-of-gates")?.severity,
    ).toBe("blocking");
  });

  it("flags all-green flags at a planning stage as advisory", () => {
    const state = stateFrom([...ALL_GREEN_FM.filter((l) => l !== "stage: executing"), "stage: plan"]);
    const found = reconcileGates({ ...PASSING, state });
    expect(checks(found)).toEqual(["stage-behind-gates"]);
    expect(found[0].severity).toBe("advisory");
  });

  it("flags a blocker that arrived after Gate 1 passed", () => {
    const state = stateFrom([...ALL_GREEN_FM, "blocked_by: [q9]"]);
    const found = reconcileGates({ ...PASSING, state });
    expect(checks(found)).toEqual(["blocked-while-validated"]);
    expect(found[0].severity).toBe("blocking");
    expect(found[0].receipt).toContain("q9");
  });

  it("flags a Gate 4 that stamped no step bodies", () => {
    const state = stateFrom(ALL_GREEN_FM.filter((l) => l !== "  evals_locked: true"));
    const found = reconcileGates({ ...PASSING, state });
    expect(checks(found)).toEqual(["evals-unstamped"]);
    expect(found[0].receipt).toContain("--verify");
  });

  it("flags a done workstream whose outcome was never armed", () => {
    const state = stateFrom([
      ...ALL_GREEN_FM.filter((l) => l !== "stage: executing"),
      "stage: done",
    ]);
    const found = reconcileGates({ ...PASSING, state });
    expect(checks(found)).toEqual(["outcome-unarmed"]);
  });
});

describe("reconcileGates — Gate 1 re-applied", () => {
  it("flags a validated PRD whose own gate no longer passes", () => {
    const found = reconcileGates({
      ...PASSING,
      prdRecheck: {
        verdict: "FAIL",
        gaps: [
          {
            check: "covers-dangling",
            message: "E-1 Covers: names 'G-9', which prd/agent.md does not define",
            location: "expectations.md:7",
          },
          { check: "goal-orphan", message: "G-2 is covered by no expectation" },
        ],
      },
    });
    expect(checks(found)).toEqual(["gate-1-regression"]);
    expect(found[0].severity).toBe("blocking");
    expect(found[0].message).toContain("covers-dangling, goal-orphan");
    expect(found[0].message).toContain("2 gaps");
    // The receipt is the first gap's own location — a place to look.
    expect(found[0].receipt).toContain("expectations.md:7");
  });

  it("stays silent when Gate 1 is open (nothing claims it passed)", () => {
    const state = stateFrom([
      "hash: abc123",
      "stage: prd",
      "gate_status:",
      "  prd_validated: false",
      "  design_verified: false",
      "  plan_verified: false",
      "  evals_red: false",
    ]);
    const found = reconcileGates({
      ...PASSING,
      state,
      prdRecheck: { verdict: "FAIL", gaps: [{ check: "x", message: "y" }] },
    });
    expect(checks(found)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Invariants over the whole finding set
// ---------------------------------------------------------------------------

describe("every finding is receipted and ordered", () => {
  /** A state that trips as many checks at once as can legally coexist. */
  const messy = stateFrom([
    "hash: abc123",
    "stage: executing",
    "gate_status:",
    "  prd_validated: true",
    "  design_verified: true",
    "  plan_verified: true",
    "  evals_red: true",
    "blocked_by: [q1]",
  ]);
  const gates = greenGates({
    design: { evidence: probe("decisions/<date>-design-verify.md", { exists: false }) },
    plan: { subjects: [probe("plan/agent.md", { dirty: true })] },
  });
  const found = reconcileGates({ state: messy, gates, prdRecheck: null });

  it("trips several checks at once", () => {
    expect(found.length).toBeGreaterThanOrEqual(4);
  });

  it("gives every finding a non-empty check, message and receipt", () => {
    // §25's rule, enforced on the shape: a finding with no receipt is not a
    // finding. A blank string would satisfy the type and defeat the rule.
    for (const f of found) {
      expect(f.check, JSON.stringify(f)).not.toBe("");
      expect(f.message.trim(), f.check).not.toBe("");
      expect(f.receipt.trim(), f.check).not.toBe("");
    }
  });

  it("is deterministic — same inputs, same list, same order", () => {
    expect(reconcileGates({ state: messy, gates, prdRecheck: null })).toEqual(found);
  });

  it("reports gates in gate order", () => {
    const order = found.map((f) => f.check);
    expect(order.indexOf("premature-closure")).toBeLessThan(
      order.indexOf("uncommitted-subject"),
    );
  });
});

describe("the review verdict is deterministic and its own vocabulary", () => {
  const advisory: PositionFinding = {
    check: "a",
    severity: "advisory",
    message: "m",
    receipt: "r",
  };
  const blocking: PositionFinding = { ...advisory, check: "b", severity: "blocking" };

  it("BLOCKING beats CONCERNS beats CLEAN", () => {
    expect(reviewVerdictFor([])).toBe("CLEAN");
    expect(reviewVerdictFor([advisory])).toBe("CONCERNS");
    expect(reviewVerdictFor([advisory, blocking])).toBe("BLOCKING");
    // Order must not matter — a blocking finding found last still wins.
    expect(reviewVerdictFor([blocking, advisory])).toBe("BLOCKING");
  });

  it("tallies both severities", () => {
    expect(tallyFindings([advisory, blocking, blocking])).toEqual({
      blocking: 2,
      advisory: 1,
    });
  });

  it("borrows no DECIDING word from the D-9 gate vocabulary", () => {
    // `CONCERNS` is shared, deliberately: it means the same thing on both
    // sides (advance, with the concern recorded) and upstream's review
    // vocabulary already spells it that way. What must never be shared is a
    // word that DECIDES — a review that could say PASS, FAIL or WAIVED
    // would read as a gate's answer, and the whole point of the pass is that
    // it has no such authority.
    //
    // The firewall that actually holds is the KEY, not the words: a review
    // carries `review:`, never `gate:`, so `parseVerdictBlock` returns null
    // for it. That half is pinned in review-never-writes-gates.test.ts
    // against the shipped template.
    const deciding = ["PASS", "FAIL", "WAIVED"] as const;
    for (const word of deciding) {
      expect(
        (REVIEW_VERDICTS as readonly string[]).includes(word),
        `review vocabulary must not contain '${word}'`,
      ).toBe(false);
      // Negative control: the word really is in the gate vocabulary, so this
      // is a comparison and not a pair of assertions about nothing.
      expect((VERDICTS as readonly string[]).includes(word)).toBe(true);
    }
    expect([...REVIEW_VERDICTS]).not.toEqual([...VERDICTS]);
  });
});
