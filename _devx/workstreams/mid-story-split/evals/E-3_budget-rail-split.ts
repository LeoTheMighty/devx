// E-3 (P0): the loop budget rail splits instead of abandoning. RED until
// Phase 3 (loop split integration) merges. Runnable standalone:
// `npx tsx <this file>` — exit 0 = expectation met.
//
// Asserts (a) `ItemOutcome` gained the `"split"` member and the report
// module renders it (source scan of `src/lib/loop/report.ts` — the union
// and OUTCOME_LABEL are module-internal shapes, T3.3), (b) the driver
// carries the `splitItem` terminal helper and the pinned event names
// `item:split` / `item:split-fallback` (source scan of
// `src/lib/loop/driver.ts`, T3.4/T3.7), and (c) the permanent E-3 case
// group (describe-title marker `"E-3:"`) exists in
// `test/loop-driver.test.ts` and the file passes under vitest — the
// threshold's cases (real progress → outcome `split`, bookkeeping-only →
// abandon byte-identical, streak stays 0) live there (T3.8).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const failures: string[] = [];

// (a) `"split"` outcome across the report module.
const reportSource = readFileSync(join(repoRoot, "src", "lib", "loop", "report.ts"), "utf8");
if (!/\|\s*"split"/.test(reportSource)) {
  failures.push(
    'src/lib/loop/report.ts ItemOutcome has no "split" member — split is not a first-class outcome (feature missing, T3.3)',
  );
}

// (b) driver terminal helper + pinned events.
const driverSource = readFileSync(join(repoRoot, "src", "lib", "loop", "driver.ts"), "utf8");
if (!/\bsplitItem\b/.test(driverSource)) {
  failures.push(
    "src/lib/loop/driver.ts has no splitItem terminal helper beside abandonItem (feature missing, T3.4)",
  );
}
for (const event of ["item:split", "item:split-fallback"]) {
  if (!driverSource.includes(`"${event}"`)) {
    failures.push(`src/lib/loop/driver.ts never emits the "${event}" event (feature missing, T3.7)`);
  }
}

// (c) permanent case group exists and passes.
const testAbs = join(repoRoot, "test", "loop-driver.test.ts");
if (!existsSync(testAbs)) {
  failures.push("test/loop-driver.test.ts missing — driver suite not found (unexpected)");
} else if (!readFileSync(testAbs, "utf8").includes("E-3:")) {
  failures.push(
    'test/loop-driver.test.ts has no describe-title marker "E-3:" — budget-rail split cases (real progress → `split`, bookkeeping-only → abandon byte-identical, streak stays 0) are not pinned (T3.8)',
  );
} else if (failures.length === 0) {
  try {
    execFileSync("npx", ["vitest", "run", "test/loop-driver.test.ts"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch {
    failures.push("test/loop-driver.test.ts fails under vitest — E-3 threshold not met (T3.8)");
  }
}

if (failures.length > 0) {
  console.error("E-3 RED — the budget rail still abandons items with real progress:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("E-3 GREEN — `split` outcome + splitItem + events shipped; E-3 case group pinned and passing.");
