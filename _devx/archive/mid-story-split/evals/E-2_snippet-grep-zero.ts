// E-2 (P0): Handoff Snippet grep-zero. RED until Phase 4 (retirement
// sweep) merges — and a PERMANENT invariant from that merge on. Runnable
// standalone: `npx tsx <this file>` — exit 0 = expectation met.
//
// Conjunct 1: the live surfaces (`.claude/commands/`, `src/`, `test/`,
// `docs/`, `v2/`) contain zero `Handoff Snippet` / `parseHandoffSnippet`
// tokens. Historical archives (LEARN.md, shipped `dev/`+`plan/` specs,
// `_bmad-output/`) are simply outside the scanned set. One in-scope
// exemption: `test/devx-skill-phase9-split.test.ts` is the guard test that
// asserts the skill body is snippet-free — the detector cannot be a
// violation of the thing it detects (same principle as the bmad-eject
// eval's config-validate.ts exemption).
//
// Conjunct 2: `.claude/commands/devx.md` Phase 9 routes early halts to the
// split primitive — the `devx split` invocation string is present.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const failures: string[] = [];

// Conjunct 1 — token grep across the live surfaces.
const SCANNED_DIRS = [".claude/commands", "src", "test", "docs", "v2"];
const EXEMPT = ["test/devx-skill-phase9-split.test.ts"];
const TOKEN_RE = "Handoff Snippet|parseHandoffSnippet";
for (const dir of SCANNED_DIRS) {
  let out = "";
  try {
    out = execFileSync("grep", ["-rnaE", TOKEN_RE, join(repoRoot, dir)], {
      encoding: "utf8",
    });
  } catch {
    out = ""; // grep exit 1 = no matches = good
  }
  const hits = out
    .split("\n")
    .filter(Boolean)
    .filter((line) => !EXEMPT.some((path) => line.includes(path)));
  if (hits.length > 0) {
    failures.push(
      `${dir} has ${hits.length} live Handoff Snippet token(s): ${hits.slice(0, 3).join(" | ").slice(0, 300)}`,
    );
  }
}

// Conjunct 2 — Phase 9 replacement prose routes to `devx split`.
const skillBody = readFileSync(join(repoRoot, ".claude", "commands", "devx.md"), "utf8");
if (!skillBody.includes("devx split")) {
  failures.push(
    ".claude/commands/devx.md Phase 9 does not route early halts to `devx split` — replacement prose missing (T4.1)",
  );
}

if (failures.length > 0) {
  console.error("E-2 RED — the Handoff Snippet contract is still live:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("E-2 GREEN — live surfaces are snippet-free; Phase 9 routes early halts to `devx split`.");
