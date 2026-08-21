// Repo-wide spec-frontmatter canary (debug-9f24c7 AC 2).
//
// `readEngineState` fails SOFT by design — a half-edited spec must never
// crash a gate — so a spec whose frontmatter YAML does not parse reads as a
// spec that simply records nothing. `status:`, `blocked_by:`, `phase:` and
// every gate flag vanish, and `devx next`, the loop's pick, `reconcile`, the
// gate CLIs and the graph model all inherit the confusion without a warning
// anywhere. See test/engine-frontmatter.test.ts for the read-side repro.
//
// The class is unfixable at the reader (see the spec's Technical notes: making
// it throw reintroduces the failure mode the soft posture was chosen to
// avoid), so it is caught mechanically instead: one readdir per spec type dir,
// on every PR. `frontmatterParseError` is the same function `devx graph
// backfill` uses to skip unreadable specs — this wraps it, it does not
// re-implement it.
//
// If this test fails, QUOTE THE OFFENDING SCALAR. The two shapes that have
// actually shipped are both an unquoted `title:`:
//
//     title: State persistence: schedule.json + …   →  a bare ": " opens a
//         nested mapping and swallows every key below it
//     title: `devx --help` listing …                →  a leading backtick is
//         a YAML reserved character
//
// Both are fixed by wrapping the value in double quotes (or single quotes if
// the title itself contains a double quote). Do not add exclusions here.
//
// Spec: debug/debug-9f24c7-2026-08-05T12:20-unparseable-spec-frontmatter-silent.md

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  SPEC_TYPE_DIRS,
  frontmatterParseError,
  readEngineState,
  splitFrontmatter,
} from "../src/lib/engine/frontmatter.js";
import { REAL_REPO_ROOT } from "./fixtures/engine-repo.js";

interface SpecFile {
  /** Repo-relative path, e.g. `dev/dev-mgr102-….md`. */
  rel: string;
  content: string;
}

/** Every `<type>/<type>-*.md` under the seven spec type dirs. Files that do
 *  not match the spec naming convention (README, notes) are skipped — this
 *  guard is about specs, not about every markdown file that shares a dir. */
function allSpecs(): SpecFile[] {
  const out: SpecFile[] = [];
  for (const type of SPEC_TYPE_DIRS) {
    let names: string[];
    try {
      names = readdirSync(join(REAL_REPO_ROOT, type));
    } catch {
      continue; // type dir not created in this repo yet
    }
    for (const name of names.sort()) {
      if (!name.startsWith(`${type}-`) || !name.endsWith(".md")) continue;
      const rel = `${type}/${name}`;
      out.push({
        rel,
        content: readFileSync(join(REAL_REPO_ROOT, type, name), "utf8"),
      });
    }
  }
  return out;
}

describe("every spec's frontmatter parses (debug-9f24c7 AC 2)", () => {
  const specs = allSpecs();

  it("finds specs to check (guards against a silently-empty scan)", () => {
    // A readdir that matched nothing would make every assertion below pass
    // vacuously — exactly the silent-success shape this file exists to kill.
    expect(specs.length).toBeGreaterThan(50);
  });

  it("no spec has unparseable frontmatter YAML", () => {
    const broken = specs
      .map((s) => ({ rel: s.rel, err: frontmatterParseError(s.content) }))
      .filter((r): r is { rel: string; err: string } => r.err !== null)
      .map((r) => `  ${r.rel}\n    ${r.err}`);

    expect(
      broken,
      "Unparseable spec frontmatter — these specs read as recording NOTHING " +
        "(no status, no blocked_by, no phase) to every engine consumer. " +
        "Quote the offending scalar; it is almost always an unquoted `title:` " +
        "containing a colon or a backtick.\n" + broken.join("\n"),
    ).toEqual([]);
  });

  it("every spec's frontmatter hash matches the hash its filename encodes", () => {
    // Same silent-loss family, caught one layer up: `hash: 620337` is a legal
    // YAML integer, `hash: 0x1234` a legal hex one. Reading either through
    // toJS() yields a number, and coercing that back to a string gives the
    // WRONG hash for anything with a leading zero or an 0x prefix. The graph
    // model sidesteps this by keying off the filename; every readEngineState
    // consumer does not, so pin the two against each other.
    const mismatched = specs
      .filter((s) => splitFrontmatter(s.content) !== null)
      .map((s) => ({
        rel: s.rel,
        fromName: /^[a-z]+\/[a-z]+-([^-]+)-/.exec(s.rel)?.[1] ?? null,
        fromFm: readEngineState(s.content).hash,
      }))
      .filter((r) => r.fromName !== null && r.fromFm !== r.fromName)
      .map((r) => `  ${r.rel}: frontmatter hash ${JSON.stringify(r.fromFm)} !== filename hash ${JSON.stringify(r.fromName)}`);

    expect(mismatched, mismatched.join("\n")).toEqual([]);
  });

  it("every spec that has a frontmatter block reads back its own hash", () => {
    // The load-bearing consequence, asserted directly rather than through the
    // parse error: the `: `-in-title shape swallows keys positionally, so a
    // spec whose `hash:` sits below a broken `title:` reads as hashless and
    // is unresolvable by every hash-keyed CLI. Specs with no frontmatter at
    // all (QA walkthroughs parked in test/) are a different condition and are
    // deliberately not covered here — splitFrontmatter already reports it.
    const hashless = specs
      .filter((s) => splitFrontmatter(s.content) !== null)
      .filter((s) => readEngineState(s.content).hash === null)
      .map((s) => `  ${s.rel}`);

    expect(hashless, `Specs whose hash: is unreadable:\n${hashless.join("\n")}`).toEqual([]);
  });
});
