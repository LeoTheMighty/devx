// a57f22 — no shipped skill body spells a workstream artifact path as if it
// were absolute truth.
//
// The failure this closes is the reader/writer split the
// docs-layout-resolution workstream exists to remove, one layer out. dlr101–106
// taught every CLI consumer — gates, `devx next`, `devx todo sync`, `devx
// outline init`, the scaffolder — to resolve artifact paths through
// `engine.docs_layout`. The WRITER's instructions live in the skill bodies, and
// those still hardcoded `_devx/workstreams/<slug>/prd/agent.md`. Under
// `project-level` an agent following that prose writes into a folder tree that
// no reader consults, and nothing fails loudly: the gate reports a missing
// subject while a perfectly good artifact sits three directories away.
//
// Modeled on `test/engine-layout-docs-truth.test.ts`, which pins the same
// invariant for `docs/CONFIG.md` §15 and the config schema. Same discipline:
// this scans PROSE, so every check is structural — a path-shape regex plus a
// proximity check — and never a wording diff. Everything a skill body says
// about layout is the author's; WHERE it claims an artifact lives is not.
//
// It deliberately does not require a layout gloss at each site. A skill body
// is loaded whole, so one anchor per document plus doc-set-relative names
// everywhere else is both correct and cheaper than N copies of §15's table —
// and a second copy of that table is precisely the failure dlr107 closed.
//
// Spec: dev/dev-a57f22-2026-09-02T15:10-skill-body-layout-paths.md

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ALL_ARTIFACT_KINDS,
  artifactRel,
} from "../src/lib/engine/artifacts.js";
import { ENGINE_DEFAULTS } from "../src/lib/engine/config.js";

const REPO_ROOT = join(__dirname, "..");
const COMMANDS_DIR = join(REPO_ROOT, ".claude", "commands");
const TEMPLATES_DIR = join(REPO_ROOT, "_devx", "templates", "engine");

/** The canonical workstreams root. Read from `ENGINE_DEFAULTS` rather than
 *  typed here so a repo that renames it does not silently narrow the scan to a
 *  string nothing writes any more. */
const WS_ROOT = ENGINE_DEFAULTS.workstreamsRoot;

/** Every shipped skill body. Globbed, not listed: a seventh command file must
 *  inherit the invariant on the day it lands, not on the day someone
 *  remembers to add it here. `skills/` is the byte-identical mirror
 *  (`skills-sync.test.ts` pins that), so scanning the canonical dir covers
 *  both. */
function skillBodies(): Array<{ rel: string; text: string }> {
  return readdirSync(COMMANDS_DIR)
    .filter((n) => n.endsWith(".md"))
    .sort()
    .map((n) => ({
      rel: `.claude/commands/${n}`,
      text: readFileSync(join(COMMANDS_DIR, n), "utf8"),
    }));
}

/** The engine templates, recursively. They are the OTHER prose an agent reads
 *  before writing an artifact — a scaffold whose header comment says where the
 *  file "lives" is a writer instruction exactly as a skill body is, and two of
 *  them carried the same hardcoded root this item removed. Same invariant,
 *  same scan; leaving them out would make the guarantee half-true. */
function engineTemplates(): Array<{ rel: string; text: string }> {
  const out: Array<{ rel: string; text: string }> = [];
  const walk = (prefix: string): void => {
    const dir = join(TEMPLATES_DIR, ...prefix.split("/").filter(Boolean));
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (entry.name.endsWith(".md")) {
        out.push({
          rel: `_devx/templates/engine/${rel}`,
          text: readFileSync(join(TEMPLATES_DIR, ...rel.split("/")), "utf8"),
        });
      }
    }
  };
  walk("");
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/** Everything the path-shape scan covers. */
const scanned = (): Array<{ rel: string; text: string }> => [
  ...skillBodies(),
  ...engineTemplates(),
];

/** The banned shape: the workstreams root, with or without a path hanging off
 *  it. That root is exactly what `project-level` does not have — the doc set is
 *  the repo root — so naming it is a location claim that is false in one of the
 *  two layouts.
 *
 *  The trailing segment is OPTIONAL, and that is the whole point rather than a
 *  loose end. The bare `` `_devx/workstreams/` `` form is what devx-plan.md's
 *  own opening paragraph used ("artifacts live in …"), and it is the most
 *  misleading of the lot: it tells an agent where the tree is rooted and lets
 *  it join the rest of the path itself. A regex that required an artifact
 *  after the slash would have skipped the very site this item was filed for.
 *
 *  Anchored on the root, not on the artifact name: the point is not that
 *  `prd/agent.md` was mentioned, it is that prose asserted where the doc set
 *  sits. `_devx/templates/engine/…` and `_devx/retros/…` are layout-independent
 *  by construction (docs/CONFIG.md §15, "Deliberately absent") and never match,
 *  and neither does the config key `engine.workstreams_root`. */
const WS_PATH_RE = new RegExp(`${WS_ROOT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\s\`)]*`, "g");

/** Prose within `WINDOW` lines of a hit that resolves the layout: it names the
 *  config key, or names the other layout by name. Proximity rather than
 *  sentence parsing — markdown prose wraps mid-sentence, so a
 *  sentence-splitting scan would be the fragile half of this test. */
const WINDOW = 3;
const LAYOUT_MARKER_RE = /docs_layout|project-level/;

/** Is the hit at `lineIdx` layout-qualified by nearby prose? */
function qualifiedAt(lines: string[], lineIdx: number): boolean {
  const from = Math.max(0, lineIdx - WINDOW);
  const to = Math.min(lines.length, lineIdx + WINDOW + 1);
  return LAYOUT_MARKER_RE.test(lines.slice(from, to).join("\n"));
}

/** Artifact spellings that differ between the two layouts — the names a skill
 *  body may only use doc-set-relatively. Derived from the resolver, so a new
 *  `ArtifactKind` joins the set without anyone editing this file. */
function layoutDependentNames(): string[] {
  const names = new Set<string>();
  for (const kind of ALL_ARTIFACT_KINDS) {
    const ws = artifactRel("workstream", kind);
    if (ws !== artifactRel("project-level", kind)) names.add(ws);
  }
  return [...names].sort();
}

describe("a57f22 — skill bodies name the folder shape, not the layout", () => {
  it("scans a non-empty set of shipped prose surfaces", () => {
    // A glob that silently resolved to nothing would make every assertion
    // below pass by not looking. Same guard `engine-layout-docs-truth` puts
    // on its allowlist.
    const rels = scanned().map((b) => b.rel);
    expect(skillBodies().length).toBeGreaterThanOrEqual(6);
    expect(engineTemplates().length).toBeGreaterThanOrEqual(21);
    expect(rels).toContain(".claude/commands/devx.md");
    expect(rels).toContain(".claude/commands/devx-plan.md");
    // The two scaffolds that carried the hardcoded root before a57f22 — named
    // so a restructure that drops them from the walk fails loudly.
    expect(rels).toContain("_devx/templates/engine/checkpoint.md");
    expect(rels).toContain("_devx/templates/engine/decision.md");
  });

  it("the proximity check distinguishes qualified prose from unqualified", () => {
    // `qualifiedAt` is the only thing standing between "the invariant holds"
    // and "the invariant is never evaluated": if it returned true
    // unconditionally, the scan below would report green on any prose at all.
    // Today's repo has zero hits, so real data exercises neither branch —
    // these synthetic lines do.
    const near = ["prose", "under `project-level` this is flat", "the path"];
    const far = ["under `project-level` this is flat", "a", "b", "c", "d", "the path"];
    expect(qualifiedAt(near, 2), "marker 1 line away should qualify").toBe(true);
    expect(qualifiedAt(far, 5), "marker 5 lines away should NOT qualify").toBe(false);
    expect(qualifiedAt(["the path"], 0), "no marker at all").toBe(false);
    // Boundaries: a marker on the first line still qualifies a hit on it, and
    // the window must not run off either end of the file.
    expect(qualifiedAt(["`engine.docs_layout` decides; the path"], 0)).toBe(true);
  });

  it("the path-shape regex actually matches the shape it bans", () => {
    // The scanner's own RED. Without this a typo in WS_ROOT — or a rename
    // that left the constant pointing at a directory nothing uses — would
    // turn the invariant below into a tautology that reports green forever.
    const bad = [
      `${WS_ROOT}/<slug>/prd/agent.md`,
      `${WS_ROOT}/<slug>/todo.md`,
      `${WS_ROOT}/docs-layout-resolution/plan/agent.md`,
      `${WS_ROOT}/<slug>/RETRO-2026-01-01.md`,
      // The bare-root forms — the shape devx-plan.md's opening paragraph and
      // /devx's Key References used, and the reason the trailing segment is
      // optional above.
      `artifacts live in \`${WS_ROOT}/\``,
      `\`${WS_ROOT}\` holds them`,
    ];
    for (const s of bad) {
      expect(new RegExp(WS_PATH_RE.source).test(s), `missed: ${s}`).toBe(true);
    }
    // …and does not fire on the paths that genuinely keep one spelling in
    // both layouts (docs/CONFIG.md §15, "Deliberately absent").
    const fine = [
      "_devx/templates/engine/qa-walkthrough.md",
      "_devx/retros/v2-migration-2026-07-05.md",
      "docs/CONFIG.md",
      "prd/agent.md",
      // The config key that NAMES the root is not a path claim — a skill body
      // may reference `engine.workstreams_root` freely.
      "engine.workstreams_root",
    ];
    for (const s of fine) {
      expect(new RegExp(WS_PATH_RE.source).test(s), `false positive: ${s}`).toBe(false);
    }
  });

  it("no shipped prose spells a workstream-rooted artifact path unqualified", () => {
    const offenders: string[] = [];
    for (const { rel, text } of scanned()) {
      const lines = text.split("\n");
      lines.forEach((line, i) => {
        for (const hit of line.match(WS_PATH_RE) ?? []) {
          if (!qualifiedAt(lines, i)) offenders.push(`${rel}:${i + 1} — ${hit}`);
        }
      });
    }
    expect(
      offenders,
      [
        "A skill body names a workstream-rooted artifact path with nothing nearby",
        "that resolves the layout. Under `engine.docs_layout: project-level` that",
        "path does not exist — the doc set is the repo root — so an agent",
        "following this prose writes where no CLI reads.",
        "",
        "Fix it the way a57f22 did: name the CLI that already resolves the path",
        "(`devx todo sync`, `devx gate`, `devx outline init`, `devx next`), or",
        "write the artifact name doc-set-relatively and let the document's",
        "layout anchor cover it. Do NOT restate docs/CONFIG.md §15's table.",
        "",
        ...offenders.map((o) => `  ${o}`),
      ].join("\n"),
    ).toEqual([]);
  });

  it("a body using layout-dependent artifact names carries a layout anchor", () => {
    // The other half: dropping the `_devx/workstreams/<slug>/` prefix is only
    // honest if the document says somewhere that what is left is a NAME and
    // not a location. Structural — the anchor must name the config key; what
    // it says about it stays the author's.
    const names = layoutDependentNames();
    expect(names, "resolver reports no layout-dependent artifacts").not.toEqual([]);

    const missing: string[] = [];
    for (const { rel, text } of skillBodies()) {
      const used = names.filter((n) => text.includes(`\`${n}\``));
      if (used.length === 0) continue;
      if (!/engine\.docs_layout/.test(text)) {
        missing.push(`${rel} — uses ${used.join(", ")} with no \`engine.docs_layout\` anchor`);
      }
    }
    expect(
      missing,
      [
        "A skill body writes layout-dependent artifact names with no anchor",
        "telling the reader they are doc-set-relative. Add one sentence naming",
        "`engine.docs_layout` (see the **Layout:** line in /devx and /devx-plan)",
        "— one per document, not one per mention.",
        "",
        ...missing.map((m) => `  ${m}`),
      ].join("\n"),
    ).toEqual([]);
  });
});
