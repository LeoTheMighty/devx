// Truth table for deriveBranch() — pln101.
//
// Covers the 4 config shapes from the spec AC + the empty/whitespace
// integration_branch collapse + the LEARN.md cross-epic regression closure
// (single-branch config emits feat/dev-<hash> not develop/dev-<hash>).
//
// Spec: dev/dev-pln101-2026-04-28T19:30-plan-derive-branch.md
// Closes: LEARN.md cross-epic pattern — "Planner-emitted `branch:` frontmatter
//         ignored devx.config.yaml" (every Phase 0 story had to fix on claim).

import { describe, expect, it } from "vitest";

import {
  type DeriveBranchConfig,
  deriveBranch,
} from "../src/lib/plan/derive-branch.js";

interface Row {
  name: string;
  config: DeriveBranchConfig;
  type: string;
  hash: string;
  expected: string;
}

const truthTable: Row[] = [
  // ---------- Spec AC: 4 documented config shapes ----------
  {
    name: "single-branch + feat/ prefix → feat/dev-aud101",
    config: { git: { integration_branch: null, branch_prefix: "feat/" } },
    type: "dev",
    hash: "aud101",
    expected: "feat/dev-aud101",
  },
  {
    name: "single-branch + custom 'work/' prefix → work/dev-aud101",
    config: { git: { integration_branch: null, branch_prefix: "work/" } },
    type: "dev",
    hash: "aud101",
    expected: "work/dev-aud101",
  },
  {
    name: "develop split + 'develop/' prefix → develop/dev-aud101 (no doubling)",
    config: { git: { integration_branch: "develop", branch_prefix: "develop/" } },
    type: "dev",
    hash: "aud101",
    expected: "develop/dev-aud101",
  },
  {
    name: "develop split + 'feat/' prefix → develop/feat/dev-aud101 (nested)",
    config: { git: { integration_branch: "develop", branch_prefix: "feat/" } },
    type: "dev",
    hash: "aud101",
    expected: "develop/feat/dev-aud101",
  },

  // ---------- Empty/whitespace integration_branch collapses to null ----------
  {
    name: "empty-string integration_branch → single-branch path",
    config: { git: { integration_branch: "", branch_prefix: "feat/" } },
    type: "dev",
    hash: "aud101",
    expected: "feat/dev-aud101",
  },
  {
    name: "whitespace integration_branch → single-branch path",
    config: { git: { integration_branch: "   ", branch_prefix: "feat/" } },
    type: "dev",
    hash: "aud101",
    expected: "feat/dev-aud101",
  },
  {
    name: "tab/newline integration_branch → single-branch path",
    config: { git: { integration_branch: "\t\n", branch_prefix: "feat/" } },
    type: "dev",
    hash: "aud101",
    expected: "feat/dev-aud101",
  },

  // ---------- Type variation (covers other valid spec types) ----------
  {
    name: "type=plan + single-branch → feat/plan-b01000",
    config: { git: { integration_branch: null, branch_prefix: "feat/" } },
    type: "plan",
    hash: "b01000",
    expected: "feat/plan-b01000",
  },
  {
    name: "type=test + single-branch → feat/test-xyz123",
    config: { git: { integration_branch: null, branch_prefix: "feat/" } },
    type: "test",
    hash: "xyz123",
    expected: "feat/test-xyz123",
  },

  // ---------- Default-prefix fallback ----------
  {
    name: "missing branch_prefix + single-branch → defaults to feat/",
    config: { git: { integration_branch: null } },
    type: "dev",
    hash: "aud101",
    expected: "feat/dev-aud101",
  },
  {
    name: "missing branch_prefix + develop split → develop/dev-aud101 (default 'develop/')",
    config: { git: { integration_branch: "develop" } },
    type: "dev",
    hash: "aud101",
    // Per CLAUDE.md "Branching model": default branch_prefix is `develop/`
    // when split is enabled, `feat/` when single-branch. Defaulting to
    // `feat/` here would re-introduce the LEARN.md regression in a different
    // shape — emitting `develop/feat/dev-<hash>` for split projects that
    // didn't set the prefix explicitly.
    expected: "develop/dev-aud101",
  },

  // ---------- Missing git section entirely ----------
  {
    name: "missing git section → defaults (single-branch + feat/)",
    config: {},
    type: "dev",
    hash: "aud101",
    expected: "feat/dev-aud101",
  },

  // ---------- Trimming preserves trimmed integration value ----------
  {
    name: "padded integration 'develop  ' → trimmed to 'develop' + nests prefix",
    config: { git: { integration_branch: "  develop  ", branch_prefix: "feat/" } },
    type: "dev",
    hash: "aud101",
    expected: "develop/feat/dev-aud101",
  },
];

describe("deriveBranch truth table", () => {
  it("covers all 4 spec-AC config shapes", () => {
    // First 4 rows are the AC-named shapes; this asserts the table didn't
    // drift away from the spec by accidental row reordering.
    expect(truthTable.slice(0, 4).map((r) => r.expected)).toEqual([
      "feat/dev-aud101",
      "work/dev-aud101",
      "develop/dev-aud101",
      "develop/feat/dev-aud101",
    ]);
  });

  it.each(truthTable)("$name", (row) => {
    expect(deriveBranch(row.config, row.type, row.hash)).toBe(row.expected);
  });
});

// Regression test called out explicitly in the pln101 spec ACs. The Phase 0
// retros (audret + cfgret + cliret + supret + iniret) all flagged the
// hardcoded `develop/dev-<hash>` shape; this is the single regression test
// that pins it closed.
describe("LEARN.md cross-epic regression: single-branch projects", () => {
  it("emits feat/dev-<hash>, NOT develop/dev-<hash>, under this project's config shape", () => {
    // This is exactly the project's devx.config.yaml git section (per
    // INTERVIEW Q#7 / CLAUDE.md branching model). Any future planner that
    // calls deriveBranch with this config MUST get the single-branch path.
    const projectConfig: DeriveBranchConfig = {
      git: {
        integration_branch: null,
        branch_prefix: "feat/",
      },
    };
    const branch = deriveBranch(projectConfig, "dev", "aud101");
    expect(branch).toBe("feat/dev-aud101");
    expect(branch).not.toMatch(/^develop\//);
  });
});
