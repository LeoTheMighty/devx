// Epic-aware DEV.md parsing (mlc106 T6.1 / AC 1) — `### Epic — <name>
// (plan: <hash>)` headings become a machine-readable partition key on every
// row below them, so `devx loop --epic` can carve the backlog.
//
// The fixtures below are deliberately the shapes THIS repo's DEV.md already
// contains (numbered epics, extra parenthetical prose before `plan:`,
// non-epic sibling headings, Phase-level `##` headings) — the parser has to
// survive the file it will actually be pointed at on day one.
//
// Spec: dev/dev-mlc106-2026-07-28T09:02-scope-model-flags.md

import { describe, expect, it } from "vitest";

import {
  epicSlugify,
  parseDevMd,
  parseEpicHeadings,
} from "../src/lib/backlog/parse.js";

const row = (hash: string, slug = "x"): string =>
  `- [ ] \`dev/dev-${hash}-2026-07-28T08:00-${slug}.md\` — Item ${hash}. Status: ready.`;

const byHash = (md: string): Map<string, ReturnType<typeof parseDevMd>[number]> =>
  new Map(parseDevMd(md).map((r) => [r.hash, r]));

describe("epicSlugify", () => {
  it("kebab-cases a display name", () => {
    expect(epicSlugify("Alpha Wave")).toBe("alpha-wave");
  });

  it("collapses punctuation runs and trims edge hyphens", () => {
    expect(epicSlugify("`/devx-init` skill")).toBe("devx-init-skill");
    expect(epicSlugify("  --Foo__Bar--  ")).toBe("foo-bar");
  });

  it("returns empty string for a name with no alphanumerics", () => {
    expect(epicSlugify("—— ()")).toBe("");
  });
});

describe("parseDevMd — epic stamping (AC 1)", () => {
  it("stamps rows with the slug + plan hash of their epic section", () => {
    const md = [
      "# DEV",
      "",
      "### Epic — Alpha Wave (plan: ab12cd)",
      "",
      row("aa1101"),
      "",
      "### Epic — Beta Ray (plan: ef34ab)",
      "",
      row("bb2202"),
      "",
    ].join("\n");
    const rows = byHash(md);
    expect(rows.get("aa1101")?.epicSlug).toBe("alpha-wave");
    expect(rows.get("aa1101")?.epicPlanHash).toBe("ab12cd");
    expect(rows.get("bb2202")?.epicSlug).toBe("beta-ray");
    expect(rows.get("bb2202")?.epicPlanHash).toBe("ef34ab");
  });

  it("gives rows above any heading null epic fields", () => {
    const md = ["# DEV", "", row("aa1101"), "", "### Epic — Later (plan: ab12cd)", "", row("bb2202")].join(
      "\n",
    );
    const rows = byHash(md);
    expect(rows.get("aa1101")?.epicSlug).toBeNull();
    expect(rows.get("aa1101")?.epicPlanHash).toBeNull();
    expect(rows.get("bb2202")?.epicSlug).toBe("later");
  });

  it("accepts a numbered epic heading and an absent plan hash", () => {
    const md = ["### Epic 3 — devx CLI skeleton", "", row("aa1101")].join("\n");
    const r = byHash(md).get("aa1101");
    expect(r?.epicSlug).toBe("devx-cli-skeleton");
    expect(r?.epicPlanHash).toBeNull();
  });

  it("pulls the plan hash out from behind other parenthetical prose", () => {
    // This repo's real shape: `### Epic — portability-install (Track 1, plan: b3f7a1)`
    const md = ["### Epic — portability-install (Track 1, plan: b3f7a1)", "", row("aa1101")].join("\n");
    const r = byHash(md).get("aa1101");
    expect(r?.epicSlug).toBe("portability-install");
    expect(r?.epicPlanHash).toBe("b3f7a1");
  });

  it("tolerates a `plan-` prefixed hash and normalizes case", () => {
    const md = ["### Epic — Legacy (plan: plan-A01000)", "", row("aa1101")].join("\n");
    expect(byHash(md).get("aa1101")?.epicPlanHash).toBe("a01000");
  });

  it("ends the section at a non-epic heading of the same depth", () => {
    const md = [
      "### Epic — Alpha (plan: ab12cd)",
      "",
      row("aa1101"),
      "",
      "### Self-healing state reconciliation",
      "",
      row("bb2202"),
    ].join("\n");
    const rows = byHash(md);
    expect(rows.get("aa1101")?.epicSlug).toBe("alpha");
    expect(rows.get("bb2202")?.epicSlug).toBeNull();
  });

  it("ends the section at a shallower heading", () => {
    const md = [
      "### Epic — Alpha (plan: ab12cd)",
      "",
      row("aa1101"),
      "",
      "## Phase 9 — something else",
      "",
      row("bb2202"),
    ].join("\n");
    const rows = byHash(md);
    expect(rows.get("aa1101")?.epicSlug).toBe("alpha");
    expect(rows.get("bb2202")?.epicSlug).toBeNull();
  });

  it("keeps the section across a DEEPER sub-heading", () => {
    // A `#### Notes` block inside an epic must not orphan the rows below it.
    const md = [
      "### Epic — Alpha (plan: ab12cd)",
      "",
      row("aa1101"),
      "",
      "#### Follow-ups",
      "",
      row("bb2202"),
    ].join("\n");
    const rows = byHash(md);
    expect(rows.get("aa1101")?.epicSlug).toBe("alpha");
    expect(rows.get("bb2202")?.epicSlug).toBe("alpha");
  });

  it("ignores an epic heading inside a fenced block", () => {
    const md = [
      "# DEV",
      "",
      "```markdown",
      "### Epic — Documentation Example (plan: ffffff)",
      "```",
      "",
      row("aa1101"),
    ].join("\n");
    expect(byHash(md).get("aa1101")?.epicSlug).toBeNull();
  });

  it("treats a heading that slugifies to nothing as a plain heading", () => {
    // `### Epic — ()` carries no usable partition key; an empty-string slug
    // would be matchable by `--epic ""`, which must never select anything.
    const md = ["### Epic — ()", "", row("aa1101")].join("\n");
    expect(byHash(md).get("aa1101")?.epicSlug).toBeNull();
  });

  it("is CRLF-tolerant", () => {
    const md = ["### Epic — Alpha Wave (plan: ab12cd)", "", row("aa1101")].join("\r\n");
    expect(byHash(md).get("aa1101")?.epicSlug).toBe("alpha-wave");
  });

  it("stamps DEBUG.md-shaped rows the same way (one parser, both backlogs)", () => {
    const md = [
      "### Epic — Alpha (plan: ab12cd)",
      "",
      "- [ ] `debug/debug-dd4404-2026-07-28T08:00-x.md` — Bug. Status: ready.",
    ].join("\n");
    const r = parseDevMd(md)[0];
    expect(r.type).toBe("debug");
    expect(r.epicSlug).toBe("alpha");
  });

  it("leaves every pre-existing field untouched (additive only)", () => {
    const md = [
      "### Epic — Alpha (plan: ab12cd)",
      "",
      "- [/] `dev/dev-aa1101-2026-07-28T08:00-one.md` — One. Status: in-progress. Blocked-by: bb2202.",
    ].join("\n");
    const r = parseDevMd(md)[0];
    expect(r.hash).toBe("aa1101");
    expect(r.status).toBe("in-progress");
    expect(r.blocked_by).toEqual(["bb2202"]);
    expect(r.struck).toBe(false);
    expect(r.title).toBe("One");
  });
});

// ─── review fixes (phase 4) ─────────────────────────────────────────────

describe("epic heading separators (review BH#2/EC#6)", () => {
  it("accepts a SPACED ASCII hyphen — epic headings are hand-typed", () => {
    const md = ["### Epic - beta ray", "", row("aa1101")].join("\n");
    expect(byHash(md).get("aa1101")?.epicSlug).toBe("beta-ray");
  });

  it("accepts a spaced double hyphen", () => {
    const md = ["### Epic -- beta ray", "", row("aa1101")].join("\n");
    expect(byHash(md).get("aa1101")?.epicSlug).toBe("beta-ray");
  });

  it("splits on the em dash, not on a hyphen inside the epic number", () => {
    const md = ["### Epic 2-b — gamma", "", row("aa1101")].join("\n");
    expect(byHash(md).get("aa1101")?.epicSlug).toBe("gamma");
  });

  it("a bare `### Epic` with no separator is not an epic heading", () => {
    const md = ["### Epic — alpha", "", "### Epic", "", row("aa1101")].join("\n");
    expect(byHash(md).get("aa1101")?.epicSlug).toBeNull();
  });
});

describe("epic name extraction (review EC#7)", () => {
  it("keeps an INLINE parenthetical, stripping only the trailing one", () => {
    // Splitting at the first ` (` collapsed this to `devx`, merging two
    // distinct epics onto one --epic key.
    const md = ["### Epic — devx (v2) engine (plan: ab12cd)", "", row("aa1101")].join("\n");
    const r = byHash(md).get("aa1101");
    expect(r?.epicSlug).toBe("devx-v2-engine");
    expect(r?.epicPlanHash).toBe("ab12cd");
  });

  it("a heading that names ONLY plan metadata is nameless, not a phantom slug", () => {
    for (const heading of ["### Epic — (plan: ab12cd)", "### Epic — plan: ab12cd"]) {
      const md = [heading, "", row("aa1101")].join("\n");
      expect(byHash(md).get("aa1101")?.epicSlug).toBeNull();
    }
  });
});

describe("plan hash range check (review BH#9)", () => {
  it("rejects an over-long hash instead of silently yielding null on a valid one", () => {
    const long = ["### Epic — alpha (plan: abcdefghijklm)", "", row("aa1101")].join("\n");
    expect(byHash(long).get("aa1101")?.epicPlanHash).toBeNull();
    // …while a normal-length hash still lands.
    const ok = ["### Epic — alpha (plan: abcdef)", "", row("aa1101")].join("\n");
    expect(byHash(ok).get("aa1101")?.epicPlanHash).toBe("abcdef");
  });
});

describe("tilde fences (review BH#4)", () => {
  it("ignores an epic heading inside a ~~~ fence", () => {
    const md = ["~~~", "### Epic — fake (plan: ffffff)", "~~~", "", row("aa1101")].join("\n");
    expect(byHash(md).get("aa1101")?.epicSlug).toBeNull();
  });

  it("does not treat a struck row as a fence", () => {
    const md = [
      "### Epic — alpha (plan: ab12cd)",
      "",
      "- ~~`dev/dev-zz9999-2026-07-28T08:00-x.md` — Gone.~~",
      row("aa1101"),
    ].join("\n");
    expect(byHash(md).get("aa1101")?.epicSlug).toBe("alpha");
  });

  it("a ~~~ line inside a ``` block is content, not a terminator", () => {
    const md = [
      "```",
      "~~~",
      "### Epic — fake (plan: ffffff)",
      "```",
      "",
      row("aa1101"),
    ].join("\n");
    expect(byHash(md).get("aa1101")?.epicSlug).toBeNull();
  });
});

describe("parseEpicHeadings (review EC#8)", () => {
  it("lists sections that have no rows yet", () => {
    const md = [
      "### Epic — empty one (plan: ab12cd)",
      "",
      "prose only",
      "",
      "### Epic — has rows",
      "",
      row("aa1101"),
    ].join("\n");
    expect(parseEpicHeadings(md)).toEqual([
      { slug: "empty-one", planHash: "ab12cd" },
      { slug: "has-rows", planHash: null },
    ]);
  });

  it("returns [] for a file with no epic headings", () => {
    expect(parseEpicHeadings(["## Phase 1", "", row("aa1101")].join("\n"))).toEqual([]);
  });

  it("de-duplicates a slug declared twice", () => {
    const md = ["### Epic — alpha", "", "## Other", "", "### Epic — alpha"].join("\n");
    expect(parseEpicHeadings(md)).toHaveLength(1);
  });
});

// ─── Heading tolerance (sgr101 / T1.3, AC 3) ────────────────────────────
//
// Shapes lifted from the downstream audit
// (_devx/workstreams/story-graph/research/2026-08-02-external-repos-audit.md):
// friend-finder-mesh writes `### <slug> (workstream <hash>)` with no
// `Epic — ` prefix at all — which returned [] before sgr101 — and palateful
// mixes `##`/`###` depth with the same `workstream` linkage form.

describe("heading tolerance — workstream linkage (sgr101 AC 3)", () => {
  it("accepts a heading with NO `Epic — ` prefix when it carries a workstream hash", () => {
    // friend-finder-mesh DEV.md, verbatim.
    const md = [
      "### friend-finder-mesh-features (workstream ba7c7a)",
      "",
      row("ffm101"),
    ].join("\n");
    const r = byHash(md).get("ffm101");
    expect(r?.epicSlug).toBe("friend-finder-mesh-features");
    expect(r?.epicPlanHash).toBe("ba7c7a");
    expect(parseEpicHeadings(md)).toEqual([
      { slug: "friend-finder-mesh-features", planHash: "ba7c7a" },
    ]);
  });

  it("reads `workstream <hash>` as the plan hash on an `Epic — ` heading too", () => {
    // palateful DEV.md, verbatim — prose after the hash inside the parens.
    const md = [
      "### Epic — browser-qa-agent (workstream 41ee13; RED gate passed 2026-07-27)",
      "",
      row("bqa101"),
    ].join("\n");
    const r = byHash(md).get("bqa101");
    expect(r?.epicSlug).toBe("browser-qa-agent");
    expect(r?.epicPlanHash).toBe("41ee13");
  });

  it("prefers `plan:` over `workstream` when a heading carries both", () => {
    const md = [
      "### Epic — alpha (plan: ab12cd, workstream ef34gh)",
      "",
      row("aa1101"),
    ].join("\n");
    expect(byHash(md).get("aa1101")?.epicPlanHash).toBe("ab12cd");
  });

  it("stamps rows under a `##`-depth epic heading", () => {
    // palateful writes `## Epic — …` and `### Epic — …` in the same file.
    const md = [
      "## Epic — import-flow-hardening (active; ifh-1/2 already on main)",
      "",
      row("ifh3"),
      "",
      "### Epic — browser-qa-agent (workstream 41ee13)",
      "",
      row("bqa101"),
    ].join("\n");
    const rows = byHash(md);
    expect(rows.get("ifh3")?.epicSlug).toBe("import-flow-hardening");
    expect(rows.get("ifh3")?.epicPlanHash).toBeNull();
    expect(rows.get("bqa101")?.epicSlug).toBe("browser-qa-agent");
  });

  it("drops prose that follows the linkage parenthetical", () => {
    const md = [
      "### Epic — alpha (plan: ab12cd) — Track 2, resumed",
      "",
      row("aa1101"),
    ].join("\n");
    const r = byHash(md).get("aa1101");
    expect(r?.epicSlug).toBe("alpha");
    expect(r?.epicPlanHash).toBe("ab12cd");
  });

  it("does NOT promote a container heading that merely cites a plan", () => {
    // This repo's own DEV.md: `## Phase 0 — Foundation (plan: plan-a01000)`
    // holds several `### Epic` sections and is not an epic itself.
    // Promoting it would invent an `--epic phase-0-foundation` key.
    const md = [
      "## Phase 0 — Foundation (plan: plan-a01000)",
      "",
      row("aa1101"),
      "",
      "### Epic 1 — BMAD audit",
      "",
      row("aud101"),
    ].join("\n");
    const rows = byHash(md);
    expect(rows.get("aa1101")?.epicSlug).toBeNull();
    expect(rows.get("aud101")?.epicSlug).toBe("bmad-audit");
    expect(parseEpicHeadings(md)).toEqual([{ slug: "bmad-audit", planHash: null }]);
  });

  it("does NOT promote a plain non-epic heading", () => {
    // palateful: `## Loose ends from executed epics (independent, parallel-safe)`
    const md = [
      "## Loose ends from executed epics (independent, parallel-safe)",
      "",
      row("aa1101"),
    ].join("\n");
    expect(byHash(md).get("aa1101")?.epicSlug).toBeNull();
    expect(parseEpicHeadings(md)).toEqual([]);
  });

  it("ends a workstream-linked section at a sibling-depth heading", () => {
    const md = [
      "### friend-finder-mesh-features (workstream ba7c7a)",
      "",
      row("ffm101"),
      "",
      "### Notes",
      "",
      row("aa1101"),
    ].join("\n");
    const rows = byHash(md);
    expect(rows.get("ffm101")?.epicSlug).toBe("friend-finder-mesh-features");
    expect(rows.get("aa1101")?.epicSlug).toBeNull();
  });

  it("range-checks a workstream hash the same way it range-checks plan:", () => {
    const md = [
      "### alpha (workstream abcdefghijklm)",
      "",
      row("aa1101"),
    ].join("\n");
    const r = byHash(md).get("aa1101");
    expect(r?.epicSlug).toBe("alpha");
    expect(r?.epicPlanHash).toBeNull();
  });
});

describe("linkage detection is hash-exact (sgr101 self-review F3)", () => {
  it("keeps an inline parenthetical that merely says 'workstreams'", () => {
    // Matching on the bare WORD would cut the name at `(workstreams
    // overview)` and collapse this onto the `devx` key — the EC#7 bug,
    // reintroduced through the new linkage path.
    const md = [
      "### Epic — devx (workstreams overview) engine (plan: ab12cd)",
      "",
      row("aa1101"),
    ].join("\n");
    const r = byHash(md).get("aa1101");
    expect(r?.epicSlug).toBe("devx-workstreams-overview-engine");
    expect(r?.epicPlanHash).toBe("ab12cd");
  });

  it("a paren naming a workstream with no hash does not make an epic", () => {
    const md = ["### notes on the workstream layout", "", row("aa1101")].join("\n");
    expect(byHash(md).get("aa1101")?.epicSlug).toBeNull();
    expect(parseEpicHeadings(md)).toEqual([]);
  });
});
