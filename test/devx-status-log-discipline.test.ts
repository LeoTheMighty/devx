// Phase 4 self-review status-log discipline assertion (dvx103).
//
// This test pins the regression-prevention rule that motivated dvx103: every
// shipped /devx-processed dev spec MUST include a `phase 4:` status-log line,
// because that line is the audit trail proving adversarial self-review ran.
// The motivating bug was dvx102 — its status log captured `phase 2:` and
// `phase 7:` but left the `phase 4:` line implicit, which loses the audit.
// dvx103 makes the line non-skippable (skill body change in
// `.claude/commands/devx.md` Phase 4) and this test is the lock that catches
// any future drift.
//
// Exemptions (documented per dvx103 AC #3):
//   1. Retro stories — hash ends in `ret` (e.g. `mrgret`, `plnret`). Retros
//      don't go through the implement → self-review → CI loop; their value is
//      cross-epic synthesis, not code review.
//   2. Pre-discipline grandfather — specs already shipped by the time dvx103
//      merges. The list below freezes the at-merge-time exemption set so
//      this test passes the moment dvx103 lands without retroactive edits.
//      Any new spec shipped post-dvx103 must include the line; do NOT add
//      hashes to the grandfather list to "fix" a CI failure — fix the
//      missing line in the spec instead.
//
// Spec: dev/dev-dvx103-2026-04-28T19:30-devx-self-review-discipline.md
// Epic: _bmad-output/planning-artifacts/epic-devx-skill.md
// Reaffirms: LEARN.md `[high] [code]` self-review-non-skippable cross-epic
// pattern (every retro since audret reaffirmed value at story-ship time).

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "..");
const DEV_DIR = resolve(REPO_ROOT, "dev");

// Grandfather: hashes of specs shipped before dvx103 introduced the
// non-skippable Phase 4 status-log discipline. Keep this list frozen at the
// dvx103-merge baseline. Adding new entries to silence a future CI failure
// defeats the point of the assertion.
const PRE_DISCIPLINE_GRANDFATHER: ReadonlySet<string> = new Set([
  // Phase 0 — Foundation (closed 2026-04-27)
  "aud101", "aud102", "aud103",
  "cfg201", "cfg202", "cfg203", "cfg204",
  "cli301", "cli302", "cli303", "cli304", "cli305",
  "sup401", "sup402", "sup403", "sup404", "sup405",
  "ini501", "ini502", "ini503", "ini504", "ini505",
  "ini506", "ini507", "ini508",
  // Phase 1 — Single-agent core loop (pre-dvx103)
  "mrg101", "mrg102", "mrg103",
  "prt101", "prt102",
  "pln102", "pln103", "pln104", "pln105", "pln106",
  "dvx102",
]);

interface SpecMeta {
  path: string;
  hash: string;
  status: string | null;
  isRetro: boolean;
  hasPhase4Line: boolean;
}

function parseSpec(absPath: string): SpecMeta {
  const raw = readFileSync(absPath, "utf-8");
  const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---/);
  const frontmatter = frontmatterMatch ? frontmatterMatch[1] : "";

  const hashMatch = frontmatter.match(/^hash:\s*(\S+)\s*$/m);
  const statusMatch = frontmatter.match(/^status:\s*(\S+)\s*$/m);
  const hash = hashMatch ? hashMatch[1] : "";
  const status = statusMatch ? statusMatch[1] : null;

  // Status log section starts at "## Status log" and runs to the next `## `
  // heading or EOF. Bounding to the next heading prevents a false positive
  // from a `phase 4:` token appearing in a later section (e.g., Links) of a
  // future spec that doesn't follow today's "status log is last" convention.
  const statusLogMatch = raw.match(/^## Status log\s*\n([\s\S]*?)(?=\n## |$(?![\r\n]))/m);
  const statusLogBody = statusLogMatch ? statusLogMatch[1] : "";

  // The mandate: a status-log line MUST contain `phase 4:` (case-sensitive,
  // colon-suffixed — matches the canonical zero-issue and non-zero forms in
  // .claude/commands/devx.md Phase 4 step 6). The check is on the status-log
  // body only; a `phase 4:` token elsewhere in the spec body (goal, ACs)
  // does not count.
  const hasPhase4Line = /^- .*\bphase 4:/m.test(statusLogBody);

  return {
    path: absPath,
    hash,
    status,
    isRetro: hash.endsWith("ret"),
    hasPhase4Line,
  };
}

function loadDevSpecs(): SpecMeta[] {
  return readdirSync(DEV_DIR)
    .filter((name) => name.startsWith("dev-") && name.endsWith(".md"))
    .map((name) => parseSpec(resolve(DEV_DIR, name)));
}

describe("Phase 4 status-log discipline (dvx103)", () => {
  it("every shipped non-retro non-grandfathered dev spec has a `phase 4:` status-log line", () => {
    const specs = loadDevSpecs();
    expect(specs.length).toBeGreaterThan(0);

    const violations = specs.filter(
      (s) =>
        s.status === "done" &&
        !s.isRetro &&
        !PRE_DISCIPLINE_GRANDFATHER.has(s.hash) &&
        !s.hasPhase4Line,
    );

    if (violations.length > 0) {
      const lines = violations.map(
        (v) => `  - ${v.path.replace(`${REPO_ROOT}/`, "")} (hash=${v.hash})`,
      );
      throw new Error(
        [
          `Phase 4 status-log discipline violated: ${violations.length} spec(s) missing the mandatory \`phase 4:\` line.`,
          "",
          "Each shipped non-retro non-grandfathered dev spec must include a `phase 4:` line in its `## Status log` section",
          "(see `.claude/commands/devx.md` Phase 4 step 6 for the canonical zero-issue + non-zero forms).",
          "",
          "Offenders:",
          ...lines,
          "",
          "Fix by appending a `phase 4: ...` line to the offending spec's status log — do NOT add the hash to PRE_DISCIPLINE_GRANDFATHER.",
        ].join("\n"),
      );
    }

    // Even with no violations, prove the assertion is wired to real data:
    // at least one done non-retro spec must have been checked.
    const checked = specs.filter(
      (s) =>
        s.status === "done" &&
        !s.isRetro &&
        !PRE_DISCIPLINE_GRANDFATHER.has(s.hash),
    );
    expect(checked.length).toBeGreaterThan(0);
  });

  it("grandfather list contains only hashes that exist on disk and are shipped", () => {
    const specs = loadDevSpecs();
    const shippedHashes = new Set(
      specs.filter((s) => s.status === "done").map((s) => s.hash),
    );
    const stale: string[] = [];
    for (const grandfatheredHash of PRE_DISCIPLINE_GRANDFATHER) {
      if (!shippedHashes.has(grandfatheredHash)) {
        stale.push(grandfatheredHash);
      }
    }
    expect(stale, `Grandfather entries missing from dev/: ${stale.join(", ")}`).toEqual([]);
  });

  it("retro stories are recognized by `*ret` hash suffix", () => {
    const specs = loadDevSpecs();
    const retros = specs.filter((s) => s.isRetro);
    // Sanity: at least the Phase 0 + Phase 1 retros should be visible
    // (audret, cfgret, cliret, supret, iniret + mrgret, prtret, plnret).
    expect(retros.length).toBeGreaterThanOrEqual(8);
    for (const r of retros) {
      expect(r.hash).toMatch(/ret$/);
    }
  });
});
