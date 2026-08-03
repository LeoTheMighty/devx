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
// TIMING (sgr103, PR #112 — the reason the trigger is not `status: done`
// alone). `status: done` is set by the merge-tail commit, which /devx pushes
// DIRECTLY to main after the PR has already merged. So a spec missing its
// `phase 4:` line produced a GREEN pull request and then reddened `main` on
// the bookkeeping commit — main sat red through three consecutive runs on
// 2026-08-03 (rtl106 14:57, rtl104 15:00) before anyone noticed, and every
// open PR inherited it via the merge commit.
//
// The fix is to trigger on evidence the spec reached the ship stage, which
// lands on the BRANCH and therefore fails the PR's own CI:
//   - `phase 5:` (local gate ran) or `phase 7:` (PR opened) — both are
//     written before the PR exists, so an attended story that skips its
//     review line now fails its own PR;
//   - `merged via PR` or `status: done` — the original post-merge triggers,
//     kept so nothing that used to be caught stops being caught.
//
// Known remaining gap (filed as `debug/debug-3b9e07`): a `devx loop` story
// writes neither `phase 5:` nor `phase 7:` — it logs `loop iteration N:` —
// so loop-shipped specs still cannot be caught before their merge-tail
// commit. Closing that half requires the loop's merge tail to emit the line
// itself; it cannot be done from this test.
//
// Spec: dev/dev-dvx103-2026-04-28T19:30-devx-self-review-discipline.md
// Spec: dev/dev-sgr103-2026-08-02T13:57-graph-render-cli.md (timing widening)
// Epic: _bmad-output/planning-artifacts/epic-devx-skill.md
// Reaffirms: LEARN.md `[high] [code]` self-review-non-skippable cross-epic
// pattern (every retro since audret reaffirmed value at story-ship time), and
// the `[high]` cross-epic pattern "attended-era contracts break on first
// unattended contact" — this is that pattern recurring on the audit trail.

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
  /** The spec reached the ship stage, by any of the four signals above.
   *  Two of them (`phase 5:`, `phase 7:`) land on the feature branch, so the
   *  assertion can fail a PR instead of only failing main afterwards. */
  reachedShipStage: boolean;
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

  // Ship-stage evidence. `phase 5:`/`phase 7:` are written on the feature
  // branch BEFORE the PR opens, so requiring the review line once either is
  // present makes this fail the PR rather than main (see TIMING above).
  const reachedShipStage =
    status === "done" ||
    /^- .*\bphase 5:/m.test(statusLogBody) ||
    /^- .*\bphase 7:/m.test(statusLogBody) ||
    /merged via PR/.test(statusLogBody);

  return {
    path: absPath,
    hash,
    status,
    isRetro: hash.endsWith("ret"),
    hasPhase4Line,
    reachedShipStage,
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
        s.reachedShipStage &&
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
          "Each non-retro non-grandfathered dev spec that has reached the ship stage must include a `phase 4:` line",
          "in its `## Status log` section (see `.claude/commands/devx.md` Phase 4 step 6 for the canonical",
          "zero-issue + non-zero forms). Ship stage = `status: done`, `merged via PR`, or a `phase 5:`/`phase 7:`",
          "line — the last two land on the feature branch, which is why this can now fail your PR rather than main.",
          "",
          "Offenders:",
          ...lines,
          "",
          "Fix by appending a `phase 4: ...` line to the offending spec's status log — do NOT add the hash to PRE_DISCIPLINE_GRANDFATHER.",
        ].join("\n"),
      );
    }

    // Even with no violations, prove the assertion is wired to real data:
    // at least one ship-stage non-retro spec must have been checked.
    const checked = specs.filter(
      (s) =>
        s.reachedShipStage &&
        !s.isRetro &&
        !PRE_DISCIPLINE_GRANDFATHER.has(s.hash),
    );
    expect(checked.length).toBeGreaterThan(0);
  });

  it("the branch-visible triggers catch a spec BEFORE it is marked done", () => {
    // The regression this pins is the timing bug itself, not the rule: under
    // the old `status: done`-only trigger, an in-progress spec carrying a
    // `phase 7:` line (PR open) was invisible, so the violation could only
    // ever surface on main after the merge-tail commit.
    const inFlightWithShipEvidence = loadDevSpecs().filter(
      (s) => s.status !== "done" && s.reachedShipStage,
    );
    for (const s of inFlightWithShipEvidence) {
      expect(
        s.hasPhase4Line,
        `${s.path.replace(`${REPO_ROOT}/`, "")} reached the ship stage while still in-flight but has no \`phase 4:\` line`,
      ).toBe(true);
    }
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
