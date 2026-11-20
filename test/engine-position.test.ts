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
      reopen: "`devx revise abc123 --touched prd`",
    },
    design: {
      subjects: [probe("design/agent.md")],
      evidence: probe("decisions/2026-01-01-design-verify.md", { changedAt: T_LATE }),
      reopen: "`devx revise abc123 --touched design`",
    },
    plan: {
      subjects: [probe("plan/agent.md")],
      evidence: probe("decisions/2026-01-01-plan-verify.md", { changedAt: T_LATE }),
      reopen: "`devx revise abc123 --touched plan`",
    },
    evals: {
      subjects: [probe("evals/E-1_thing.ts")],
      evidence: probe("evals/RED-report.md", { changedAt: T_LATE }),
      reopen: "`devx revise abc123 --touched plan`",
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
    expect(found[0].receipt).toContain("devx revise abc123 --touched design");
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

  it("leads with the premature-closure family", () => {
    // The whole point of the pass: a flag standing over a missing record is
    // what every downstream reader believes, so it must be the first thing a
    // human meets — ahead of a verdict-persistence note about a migration.
    expect(found[0].check).toBe("premature-closure");
    const order = found.map((f) => f.check);
    expect(order.indexOf("premature-closure")).toBeLessThan(
      order.indexOf("uncommitted-subject"),
    );
    expect(order.indexOf("blocked-while-validated")).toBeLessThan(
      order.indexOf("verdict-not-persisted"),
    );
  });

  it("keeps gate order inside one rank", () => {
    // The sort is stable, so two stale-evidence findings stay in gate order
    // (design before plan) rather than being reshuffled run to run.
    const gates = greenGates({
      design: {
        subjects: [probe("design/agent.md", { changedAt: T_LATE + 1 })],
      },
      plan: {
        subjects: [probe("plan/agent.md", { changedAt: T_LATE + 1 })],
      },
    });
    const stale = reconcileGates({ ...PASSING, gates }).filter(
      (f) => f.check === "stale-evidence",
    );
    expect(stale).toHaveLength(2);
    expect(stale[0].message).toContain("design_verified");
    expect(stale[1].message).toContain("plan_verified");
  });
});

describe("reconcileGates — a retired workstream is abandoned, not broken", () => {
  it("does not demand green gates of a retired workstream", () => {
    // Retiring something at the design stage leaves two gates open forever.
    // Treating that as premature closure would make every retirement a
    // BLOCKING finding — the opposite of what retiring means.
    const state = stateFrom([
      "hash: abc123",
      "stage: retired",
      "gate_status:",
      "  prd_validated: true",
      "  design_verified: false",
      "  plan_verified: false",
      "  evals_red: false",
      "gate_verdicts:",
      "  prd: PASS",
    ]);
    expect(checks(reconcileGates({ ...PASSING, state }))).toEqual([]);
  });

  it("still flags `done` with an open gate (the negative control)", () => {
    const state = stateFrom([
      "hash: abc123",
      "stage: done",
      "gate_status:",
      "  prd_validated: true",
      "  design_verified: false",
      "  plan_verified: false",
      "  evals_red: false",
      "gate_verdicts:",
      "  prd: PASS",
    ]);
    expect(checks(reconcileGates({ ...PASSING, state }))).toContain(
      "stage-ahead-of-gates",
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

// ---------------------------------------------------------------------------
// A receipt never names a command that refuses (#187 / #190)
// ---------------------------------------------------------------------------

describe("receipts name commands that can actually do what they claim", () => {
  /** Findings from every state that trips a check, unioned — so the scan
   *  below looks at the whole receipt surface and not at three rows. */
  function everyFinding(): PositionFinding[] {
    const out: PositionFinding[] = [];
    const push = (i: Parameters<typeof reconcileGates>[0]): void => {
      out.push(...reconcileGates(i));
    };
    // missing record / missing subject / stale evidence / dirty subject
    push({
      ...PASSING,
      gates: greenGates({
        design: { evidence: probe("decisions/x-design-verify.md", { exists: false }) },
        plan: { subjects: [probe("plan/agent.md", { exists: false, dirty: true })] },
        evals: {
          subjects: [probe("evals/E-1_thing.ts", { changedAt: T_LATE + 1 })],
          evidence: probe("evals/RED-report.md", { changedAt: T_LATE }),
        },
      }),
    });
    // the same, on a DONE workstream — the branch that names `outcome tune`
    push({
      ...PASSING,
      state: stateFrom([
        ...ALL_GREEN_FM.filter((l) => l !== "stage: executing"),
        "stage: done",
        "outcome:",
        "  status: pending",
      ]),
      gates: greenGates({
        evals: {
          subjects: [probe("evals/E-1_thing.ts", { changedAt: T_LATE + 1 })],
          evidence: probe("evals/RED-report.md", { changedAt: T_LATE }),
        },
      }),
    });
    // unstamped lock / unarmed outcome / blocked / illegal / stage skew
    push({ ...PASSING, state: stateFrom(ALL_GREEN_FM.filter((l) => l !== "  evals_locked: true")) });
    push({
      ...PASSING,
      state: stateFrom([...ALL_GREEN_FM.filter((l) => l !== "stage: executing"), "stage: done"]),
    });
    push({ ...PASSING, state: stateFrom([...ALL_GREEN_FM, "blocked_by: [q1]"]) });
    push({
      ...PASSING,
      state: stateFrom([
        "hash: abc123",
        "stage: plan",
        "gate_status:",
        "  prd_validated: false",
        "  design_verified: true",
        "  plan_verified: false",
        "  evals_red: false",
        "gate_verdicts:",
        "  design: PASS",
      ]),
    });
    push({
      ...PASSING,
      prdRecheck: { verdict: "FAIL", gaps: [{ check: "goal-orphan", message: "G-2 orphaned" }] },
    });
    // all four green at a planning stage — a rollback left the flags standing
    push({
      ...PASSING,
      state: stateFrom([...ALL_GREEN_FM.filter((l) => l !== "stage: executing"), "stage: plan"]),
    });
    // executing with Gate 4 still open — only Gate 4 advances past red
    push({
      ...PASSING,
      state: stateFrom([
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
      ]),
    });
    // flags green with no gate_verdicts at all — a pre-hfi102 workstream
    push({
      ...PASSING,
      state: stateFrom([
        "hash: abc123",
        "stage: executing",
        "gate_status:",
        "  prd_validated: true",
        "  design_verified: true",
        "  plan_verified: true",
        "  evals_red: true",
        "  evals_locked: true",
      ]),
    });
    return out;
  }

  const findings = everyFinding();

  it("exercises the whole receipt surface, not a sample", () => {
    // Without this the scan below could pass by looking at nothing. Every
    // check this module can emit must appear at least once.
    const seen = new Set(findings.map((f) => f.check));
    for (const check of [
      "premature-closure",
      "subject-missing",
      "stale-evidence",
      "uncommitted-subject",
      "gate-1-regression",
      "verdict-not-persisted",
      "illegal-transition",
      "stage-ahead-of-gates",
      "stage-behind-gates",
      "blocked-while-validated",
      "evals-unstamped",
      "outcome-unarmed",
    ]) {
      expect(seen.has(check), `no fixture trips ${check}`).toBe(true);
    }
  });

  it("no receipt tells a reader to re-run a gate that would refuse", () => {
    // Since #187 and #190 a CLOSED gate refuses a re-run and writes nothing,
    // and every gate-evidence finding here fires only when the flag is TRUE.
    // A receipt saying "re-run `devx gate …`" therefore sends the reader into
    // an exit 1 — this lens's own failure mode turned on itself: state
    // asserting more than its evidence supports.
    //
    // `--verify` is the single exception the refusal itself carves out, so it
    // is allowed rather than excluded: the test names the one legal form.
    for (const f of findings) {
      const m = /devx gate [a-z]+[^`]*/.exec(f.receipt);
      if (m === null) continue;
      expect(
        m[0],
        `${f.check} receipt names a gate command that refuses: ${m[0]}`,
      ).toContain("--verify");
    }
  });

  it("the gate-command scan is honest — it would catch one", () => {
    // Negative control: a scan whose regex stopped matching reports zero
    // offenders, therefore a pass, forever.
    const bad = /devx gate [a-z]+[^`]*/.exec("x does not exist; re-run `devx gate evals abc123`");
    expect(bad).not.toBeNull();
    expect((bad as RegExpExecArray)[0]).not.toContain("--verify");
    const ok = /devx gate [a-z]+[^`]*/.exec("`devx gate evals abc123 --verify` has nothing");
    expect((ok as RegExpExecArray)[0]).toContain("--verify");
  });

  it("every reopen receipt names the sanctioned path, not a gate", () => {
    const reopeners = findings.filter((f) =>
      ["premature-closure", "subject-missing", "stale-evidence"].includes(f.check),
    );
    expect(reopeners.length).toBeGreaterThanOrEqual(3);
    for (const f of reopeners) {
      expect(f.receipt, f.check).toContain("devx revise");
    }
  });

  it("a done workstream's evals finding offers the verification-scoped door first", () => {
    // `outcome ... --verdict tune` clears evals_red and rolls back to red;
    // `devx revise --touched plan` would also drop plan_verified. On a closed
    // workstream the narrower one is named first, with which is which.
    const onDone = findings.find(
      (f) => f.check === "stale-evidence" && f.receipt.includes("--verdict tune"),
    );
    expect(onDone, "no done-stage evals receipt names outcome tune").toBeDefined();
    expect((onDone as PositionFinding).receipt).toContain("verification-scoped");
    expect((onDone as PositionFinding).receipt).toContain("reopens the plan too");
    // `--reopen` is REQUIRED for tune, so the bare verdict would leave a
    // reader on an arg-shape error — the same defect as naming a command
    // that refuses. The E-id comes from the eval's own filename.
    expect((onDone as PositionFinding).receipt).toContain("--reopen E-1");
  });

  it("falls back to a placeholder when the artifact carries no E-id", () => {
    // A fixture or helper under evals/ has no E-id to extract. The receipt
    // must still name the flag rather than drop it, or the command it offers
    // is incomplete in a way the reader cannot see.
    const found = reconcileGates({
      ...PASSING,
      state: stateFrom([
        ...ALL_GREEN_FM.filter((l) => l !== "stage: executing"),
        "stage: done",
        "outcome:",
        "  status: pending",
      ]),
      gates: greenGates({
        evals: {
          subjects: [probe("evals/_fixture.ts", { changedAt: T_LATE + 1 })],
          evidence: probe("evals/RED-report.md", { changedAt: T_LATE }),
        },
      }),
    });
    const stale = found.find((f) => f.check === "stale-evidence");
    expect(stale?.receipt).toContain("--reopen <E-ids>");
  });

  it("an unarmed outcome names the command that arms it", () => {
    const f = findings.find((x) => x.check === "outcome-unarmed");
    expect(f?.receipt).toContain("devx outcome arm");
  });
});
