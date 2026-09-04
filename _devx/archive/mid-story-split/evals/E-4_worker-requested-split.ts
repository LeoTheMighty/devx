// E-4 (P1): worker-requested split. RED until Phase 3 (loop split
// integration) merges. Runnable standalone: `npx tsx <this file>` —
// exit 0 = expectation met.
//
// Asserts (a) `validateIterationReport` explicitly copies a well-formed
// `split_request` through — the validator returns a fresh trimmed object,
// so an un-extended implementation silently drops the field (design
// § Constraints; T3.1), (b) a malformed `split_request` never fails the
// whole report (own error path — stripped, not fatal; T3.1), (c) the
// worker prompt contract mentions `split_request` (`OUTPUT_FIELD_LINES`
// source scan, T3.2), and (d) the permanent E-4 case group (describe-title
// marker `"E-4:"`) exists in `test/loop-iteration.test.ts` and the file
// passes under vitest (T3.8).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const failures: string[] = [];

const validReport = {
  success: true,
  summary: "landed the composer",
  key_changes_made: ["composeSplit implemented"],
  key_learnings: [],
  acs_met: false,
};
const wellFormedRequest = {
  title: "Finish the atomic writer",
  remaining_acs: ["writeSplitAtomically restores originals on partial failure"],
  carried_forward: {
    state_to_trust: ["composer output shape is final"],
    gotchas: ["withBacklogLock bodies must stay synchronous"],
    do_not: ["do not widen setBacklogRowState's union"],
  },
};

try {
  const iteration = await import("../../../../src/lib/loop/iteration.js");
  // (a) well-formed request passes through.
  const passThrough = iteration.validateIterationReport({
    ...validReport,
    split_request: wellFormedRequest,
  });
  if (!passThrough.ok) {
    failures.push(
      "a well-formed split_request makes validateIterationReport reject the whole report (T3.1)",
    );
  } else if (!("split_request" in passThrough.report) || !passThrough.report.split_request) {
    failures.push(
      "validateIterationReport silently drops a well-formed split_request — explicit copy-through not implemented (feature missing, T3.1)",
    );
  }
  // (b) malformed request must not fail the report (own error path).
  const malformed = iteration.validateIterationReport({
    ...validReport,
    split_request: { title: "multi\nline;bad", remaining_acs: [] },
  });
  if (!malformed.ok) {
    failures.push(
      "a malformed split_request fails the whole iteration report — it must be rejected on its own error path without wedging the item (T3.1)",
    );
  }
  // (c) worker prompt contract names the field.
  const iterationSource = readFileSync(
    join(repoRoot, "src", "lib", "loop", "iteration.ts"),
    "utf8",
  );
  if (!iterationSource.includes("split_request")) {
    failures.push(
      "src/lib/loop/iteration.ts never mentions split_request — OUTPUT_FIELD_LINES / prompt contract not extended (feature missing, T3.2)",
    );
  }
} catch (err) {
  failures.push(
    `could not drive validateIterationReport probe: ${err instanceof Error ? err.message : String(err)}`,
  );
}

// (d) permanent case group exists and passes.
const testAbs = join(repoRoot, "test", "loop-iteration.test.ts");
if (!existsSync(testAbs)) {
  failures.push("test/loop-iteration.test.ts missing — iteration suite not found (unexpected)");
} else if (!readFileSync(testAbs, "utf8").includes("E-4:")) {
  failures.push(
    'test/loop-iteration.test.ts has no describe-title marker "E-4:" — worker-requested split cases (well-formed → 1 driver-side split, malformed → 1 validation error + 0 writes, loop continues) are not pinned (T3.8)',
  );
} else if (failures.length === 0) {
  try {
    execFileSync("npx", ["vitest", "run", "test/loop-iteration.test.ts"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch {
    failures.push("test/loop-iteration.test.ts fails under vitest — E-4 threshold not met (T3.8)");
  }
}

if (failures.length > 0) {
  console.error("E-4 RED — worker-requested split not in place yet:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("E-4 GREEN — split_request validates + copies through; E-4 case group pinned and passing.");
