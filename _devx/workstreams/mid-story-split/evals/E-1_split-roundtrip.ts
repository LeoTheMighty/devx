// E-1 (P0): split primitive round-trip. RED until Phase 1 (split primitive
// lib + CLI) merges. Runnable standalone: `npx tsx <this file>` — exit 0 =
// expectation met.
//
// Asserts (a) `src/lib/devx/split.ts` exists and exports the four pinned
// symbols (`validateSplitPayload`, `composeSplit`, `writeSplitAtomically`,
// `performSplit` — design § Architecture 1), (b) the `devx split` CLI is
// registered (`src/commands/split.ts` + `src/cli.ts`), and (c) the
// permanent E-1 case group (describe-title marker `"E-1:"`) exists in
// `test/devx-split.test.ts` and that file passes under vitest — the
// threshold's ≥6 cases (both-shape round-trips, byte-identical rollback,
// exit-3 ownership refusal, carried-forward headings) live there; this
// wrapper stays outside the default suite glob so main CI is green while
// the expectation is still RED.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const failures: string[] = [];

// (a) library module + pinned exports.
try {
  const split = await import("../../../../src/lib/devx/split.js");
  for (const symbol of [
    "validateSplitPayload", // T1.1
    "composeSplit", // T1.2
    "writeSplitAtomically", // T1.3
    "performSplit", // T1.4
  ]) {
    if (typeof (split as Record<string, unknown>)[symbol] !== "function") {
      failures.push(`src/lib/devx/split.ts exports no ${symbol} (feature missing)`);
    }
  }
} catch {
  failures.push(
    "src/lib/devx/split.ts missing — split primitive not implemented (feature missing, T1.1–T1.4)",
  );
}

// (b) CLI command + registration.
if (!existsSync(join(repoRoot, "src", "commands", "split.ts"))) {
  failures.push("src/commands/split.ts missing — `devx split` CLI not implemented (feature missing, T1.6)");
}
const cliSource = readFileSync(join(repoRoot, "src", "cli.ts"), "utf8");
if (!/\bsplit\b/.test(cliSource)) {
  failures.push("src/cli.ts does not register a split command (feature missing, T1.6)");
}

// (c) permanent case group exists and passes.
const testAbs = join(repoRoot, "test", "devx-split.test.ts");
if (!existsSync(testAbs)) {
  failures.push(
    "test/devx-split.test.ts missing — the E-1 round-trip/rollback/ownership cases are not pinned in the default suite (feature missing, T1.7)",
  );
} else if (!readFileSync(testAbs, "utf8").includes("E-1:")) {
  failures.push(
    'test/devx-split.test.ts has no describe-title marker "E-1:" — the E-1 case group is not pinned (T1.7)',
  );
} else if (failures.length === 0) {
  // Only worth running once the feature + case group exist.
  try {
    execFileSync("npx", ["vitest", "run", "test/devx-split.test.ts"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch {
    failures.push("test/devx-split.test.ts fails under vitest — E-1 threshold not met (T1.7)");
  }
}

if (failures.length > 0) {
  console.error("E-1 RED — split primitive round-trip not in place yet:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("E-1 GREEN — split primitive + CLI shipped; E-1 case group pinned and passing.");
