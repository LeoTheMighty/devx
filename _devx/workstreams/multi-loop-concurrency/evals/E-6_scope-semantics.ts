// E-6 (P1): scope semantics — mask, never drop (FR-6, CAP-6, UC-1/2/3).
// RED until Phase 6 merges. Runnable standalone: `npx tsx <this file>`.
// Asserts (a) `parseDevMd` stamps rows with their `### Epic — {name}
// (plan: {hash})` section (today: headings are skipped — no partition key),
// (b) the scope module exists with buildScopeMask, and (c) `devx loop`
// accepts the five scope flags (today: commander rejects them as unknown
// options — the feature IS the missing flag surface).
// Ordering/blocker-reporting thresholds are enforced by the permanent suite
// (test/loop-scope.test.ts) once the flags exist.

import { rmSync } from "node:fs";
import { mkRepoFixture, runCli } from "./_fixture.js";

const failures: string[] = [];

// (a) epic-aware parsing.
try {
  const mod = await import("../../../../src/lib/backlog/parse.js");
  const parseDevMd = (mod as Record<string, unknown>).parseDevMd as (
    content: string,
    file?: string,
  ) => Array<Record<string, unknown>>;
  const rows = parseDevMd(
    [
      "# DEV",
      "",
      "### Epic — Alpha Wave (plan: ab12cd)",
      "",
      "- [ ] `dev/dev-aa1101-2026-07-28T08:00-one.md` — One. Status: ready.",
      "",
      "### Epic — Beta Ray (plan: ef34ab)",
      "",
      "- [ ] `dev/dev-bb2202-2026-07-28T08:00-two.md` — Two. Status: ready.",
      "",
    ].join("\n"),
    "DEV.md",
  );
  const one = rows.find((r) => r.hash === "aa1101");
  const two = rows.find((r) => r.hash === "bb2202");
  if (!one || !two) {
    failures.push("fixture rows did not parse — eval wiring problem (fix me)");
  } else {
    if (!("epicSlug" in one) || one.epicSlug == null) {
      failures.push(
        "DevRow carries no epicSlug for a row under '### Epic — Alpha Wave (plan: ab12cd)' — epic-aware parsing not implemented (T6.1)",
      );
    } else {
      if (one.epicSlug !== "alpha-wave" || one.epicPlanHash !== "ab12cd") {
        failures.push(
          `epic stamp wrong: got ${String(one.epicSlug)}/${String(one.epicPlanHash)}, want alpha-wave/ab12cd`,
        );
      }
      if (two.epicSlug !== "beta-ray" || two.epicPlanHash !== "ef34ab") {
        failures.push(
          `second epic stamp wrong: got ${String(two.epicSlug)}/${String(two.epicPlanHash)}, want beta-ray/ef34ab`,
        );
      }
    }
  }
} catch (err) {
  failures.push(
    `could not drive parseDevMd probe: ${err instanceof Error ? err.message : String(err)}`,
  );
}

// (b) scope module.
try {
  const mod = await import("../../../../src/lib/loop/scope.js");
  if (typeof (mod as Record<string, unknown>).buildScopeMask !== "function") {
    failures.push(
      "src/lib/loop/scope.ts exists but exports no buildScopeMask — feature incomplete (T6.2)",
    );
  }
} catch {
  failures.push(
    "src/lib/loop/scope.ts missing — scope module not implemented (T6.2)",
  );
}

// (c) the five flags on a --dry-run (no lock taken, no writes).
const fx = mkRepoFixture({
  prefix: "e6-scope",
  items: [["aa1101", "one"]],
});
try {
  const flagProbes: string[][] = [
    ["--epic", "alpha-wave"],
    ["--workstream", "multi-loop-concurrency"],
    ["--items", "aa1101"],
    ["--exclude", "bb2202"],
    ["--focus", "tests only"],
  ];
  for (const probe of flagProbes) {
    const res = runCli(["loop", "--dry-run", ...probe], fx.root);
    const out = res.stdout + res.stderr;
    if (/unknown option/i.test(out)) {
      failures.push(
        `devx loop rejects ${probe[0]} as an unknown option — scope flag not implemented (T6.3)`,
      );
    }
  }
} finally {
  rmSync(fx.root, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error("E-6 RED — scope model not implemented yet:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  "E-6 GREEN — epic-aware rows, scope module, and all five scope flags present.",
);
