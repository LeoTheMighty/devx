// E-3 (P0): gate verdicts persist, including FAIL.
// RED until Phase 2 (gate-verdict persistence) merges. Runnable standalone:
// `npx tsx <this file>`.
// Asserts (a) the frontmatter plumbing exists (GATE_KEYS / FLAG_TO_GATE_KEY /
// gateVerdicts on EngineState + EnginePatch), (b) a gateVerdicts patch
// round-trips through applyEnginePatch → readEngineState without touching
// gate_status booleans, (c) the revise computation exposes verdictsCleared,
// and (d) the permanent suite test/gate-verdict-persist.test.ts exists
// (fixtures for all 3 gate commands incl. FAIL runs + devx next rendering).

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const failures: string[] = [];

const FIXTURE_SPEC = `---
hash: e3f1x0
type: plan
created: 2026-07-24T00:00:00-06:00
title: E3 Fixture
status: in-progress
stage: design
entered_at: prd
gate_status:
  prd_validated: true
  design_verified: false
  plan_verified: false
  evals_red: false
outcome:
  status: null
  measure_by: null
workstream: _devx/workstreams/e3-fixture
---

## Goal

Fixture.
`;

try {
  const fm = await import("../../../../src/lib/engine/frontmatter.js");

  // (a) plumbing exports.
  if (!Array.isArray((fm as Record<string, unknown>).GATE_KEYS)) {
    failures.push("frontmatter.ts exports no GATE_KEYS — gate_verdicts plumbing missing (T2.1)");
  }
  if (typeof (fm as Record<string, unknown>).FLAG_TO_GATE_KEY !== "object") {
    failures.push("frontmatter.ts exports no FLAG_TO_GATE_KEY — flag→gate-key map missing (T2.1)");
  }

  // (b) verdict patch round-trip, booleans untouched (the FAIL-run shape:
  //     verdict-only patch, no flag flip).
  const state0 = fm.readEngineState(FIXTURE_SPEC) as Record<string, unknown>;
  if (!("gateVerdicts" in state0)) {
    failures.push("EngineState carries no gateVerdicts — readEngineState not extended (T2.1)");
  } else {
    try {
      const patched = fm.applyEnginePatch(FIXTURE_SPEC, {
        gateVerdicts: { design: "FAIL" },
      } as never);
      const state1 = fm.readEngineState(patched) as {
        gateStatus: Record<string, boolean>;
        gateVerdicts?: Record<string, string | null>;
      };
      if (state1.gateVerdicts?.design !== "FAIL") {
        failures.push(
          `gateVerdicts patch did not round-trip (read back '${String(state1.gateVerdicts?.design)}', wanted 'FAIL')`,
        );
      }
      if (state1.gateStatus.design_verified !== false || state1.gateStatus.prd_validated !== true) {
        failures.push("verdict-only patch altered gate_status booleans — FAIL writes must leave flags alone");
      }
      if (state1.gateVerdicts?.prd !== null && state1.gateVerdicts?.prd !== undefined) {
        // Absent map entries must read null (absent ≡ all-null), and a
        // sibling write must not invent values for other gates.
        if (state1.gateVerdicts?.prd !== null) {
          failures.push(`untouched gate 'prd' reads verdict '${String(state1.gateVerdicts?.prd)}', wanted null`);
        }
      }
    } catch (err) {
      failures.push(
        `applyEnginePatch rejected a gateVerdicts patch: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // (c) revise clears verdicts for the flags its cascade row resets.
  const revise = await import("../../../../src/lib/engine/revise.js");
  const entry = revise.cascadeFor("plan.md");
  if (entry === null) {
    failures.push("cascadeFor('plan.md') returned null — revise module changed shape");
  } else {
    const comp = revise.computeRevise(
      fm.readEngineState(FIXTURE_SPEC) as never,
      entry,
    ) as Record<string, unknown>;
    if (!("verdictsCleared" in comp)) {
      failures.push("ReviseComputation carries no verdictsCleared — revise cascade does not clear verdicts (T2.3)");
    }
  }
} catch (err) {
  failures.push(
    `could not probe engine modules: ${err instanceof Error ? err.message : String(err)}`,
  );
}

// (d) permanent suite.
if (!existsSync(join(repoRoot, "test", "gate-verdict-persist.test.ts"))) {
  failures.push(
    "test/gate-verdict-persist.test.ts missing — 3-command fixtures (incl. FAIL runs + devx next FAIL-vs-never-run rendering) not pinned (feature missing, T2.6)",
  );
}

if (failures.length > 0) {
  console.error("E-3 RED — gate-verdict persistence not implemented yet:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("E-3 GREEN — verdicts round-trip additively, revise clears them, suite pinned.");
