// E-5 (P1): fresh-claim viability of a follow-up. RED until Phase 2
// (claim branch inheritance) merges. Runnable standalone:
// `npx tsx <this file>` — exit 0 = expectation met.
//
// Asserts (a) `parseSpecClaimFields` reads a `branch:` frontmatter field —
// the single claim-path extension point (design § Interfaces; T2.1): a
// follow-up records its branch, and recording it is useless unless the
// claim parse surfaces it, and (b) the permanent E-5 case group
// (describe-title marker `"E-5:"`) exists in `test/devx-split.test.ts`
// and the file passes under vitest — the threshold's cases (row-8 dispatch
// pick on both shapes' fixtures, claim with branch inheritance honored /
// attach-not-`-b`, drift entries = 0) live there (T2.3).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const failures: string[] = [];

// (a) claim-path frontmatter parse surfaces `branch:`.
try {
  const verifyClaim = await import("../../../../src/lib/devx/verify-claim.js");
  const fields = verifyClaim.parseSpecClaimFields(
    [
      "---",
      "hash: abc123",
      "type: dev",
      "status: ready",
      "owner:",
      "branch: feat/dev-abc123",
      "---",
      "",
      "## Goal",
    ].join("\n"),
  ) as Record<string, unknown>;
  if (fields.branch !== "feat/dev-abc123") {
    failures.push(
      "parseSpecClaimFields does not surface the branch: frontmatter field — claim branch inheritance not implemented (feature missing, T2.1)",
    );
  }
} catch (err) {
  failures.push(
    `could not drive parseSpecClaimFields probe: ${err instanceof Error ? err.message : String(err)}`,
  );
}

// (b) permanent case group exists and passes.
const testAbs = join(repoRoot, "test", "devx-split.test.ts");
if (!existsSync(testAbs)) {
  failures.push(
    "test/devx-split.test.ts missing — the E-5 dispatch/claim/drift cases are not pinned in the default suite (feature missing, T2.3)",
  );
} else if (!readFileSync(testAbs, "utf8").includes("E-5:")) {
  failures.push(
    'test/devx-split.test.ts has no describe-title marker "E-5:" — the E-5 case group is not pinned (T2.3)',
  );
} else if (failures.length === 0) {
  try {
    execFileSync("npx", ["vitest", "run", "test/devx-split.test.ts"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch {
    failures.push("test/devx-split.test.ts fails under vitest — E-5 threshold not met (T2.3)");
  }
}

if (failures.length > 0) {
  console.error("E-5 RED — a follow-up is not claimable cold yet:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("E-5 GREEN — branch inheritance parsed on the claim path; E-5 case group pinned and passing.");
