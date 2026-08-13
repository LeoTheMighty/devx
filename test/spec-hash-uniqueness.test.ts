// Cross-dir spec-hash uniqueness (debug-ea4f41 AC 3).
//
// A bare hash is the repo's universal handle: `devx merge-gate <hash>`,
// `devx split <hash>`, `devx next`, the graph model — all of them resolve a
// hash across every entry in SPEC_TYPE_DIRS. `findSpecForHashAnyType` fails
// CLOSED on a duplicate (AmbiguousSpecHashError) rather than guessing, so a
// second file minted under an existing hash makes the ORIGINAL spec
// unresolvable — Phase 8's own merge gate stops being able to gate the story
// that produced the duplicate.
//
// Until this test existed the class was caught only at the moment someone ran
// a by-hash CLI, which is always *after* the work is committed and pushed
// (sgr103/PR #112 hit it there; 4d1a9c shipped a second one that also
// mislabeled the 4d1a9c node in GRAPH.md, since the graph resolves a
// collision by first-dir-wins and `test/` sorts ahead of `debug/`).
//
// This is a repo-state assertion, not a library test: it reads the working
// tree the way the CLIs do. When it fails, the fix is to rename the newer
// file to a fresh hash in canonical spec form — never to widen the test.
//
// Spec: debug/debug-ea4f41-2026-08-03T09:52-qa-walkthrough-hash-collision.md

import { readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  findSpecForHashAnyType,
  SPEC_TYPE_DIRS,
} from "../src/lib/engine/frontmatter.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Every spec file in the repo, keyed by the hash the resolver reads off its
 *  filename. Mirrors `findSpecForHashIn`'s `<type>-<hash>-<rest>.md` shape — the
 *  `test/` dir also holds vitest sources, and those never match. */
function specsByHash(): Map<string, string[]> {
  const byHash = new Map<string, string[]>();
  for (const type of SPEC_TYPE_DIRS) {
    let names: string[];
    try {
      names = readdirSync(join(repoRoot, type));
    } catch {
      continue; // dir absent in this checkout — not every repo has all seven
    }
    const re = new RegExp(`^${type}-([a-z0-9]{3,12})-.+\\.md$`, "i");
    for (const name of names.sort()) {
      const m = name.match(re);
      if (!m) continue;
      const hash = m[1].toLowerCase();
      const list = byHash.get(hash) ?? [];
      list.push(`${type}/${name}`);
      byHash.set(hash, list);
    }
  }
  return byHash;
}

describe("spec hashes are unique across SPEC_TYPE_DIRS (ea4f41 AC 3)", () => {
  const byHash = specsByHash();

  it("finds spec files to check (guards against a silently empty scan)", () => {
    // A refactor that breaks the filename shape would otherwise turn this
    // whole file into a vacuous pass.
    expect(byHash.size).toBeGreaterThan(50);
  });

  it("no hash appears in more than one type dir", () => {
    const collisions = [...byHash.entries()]
      .filter(([, paths]) => paths.length > 1)
      .map(([hash, paths]) => `${hash}: ${paths.join(", ")}`);
    expect(
      collisions,
      "hashes must be unique across type dirs — rename the newer file to a " +
        "fresh hash in canonical `<type>/<type>-<hash>-<ts>-<slug>.md` form",
    ).toEqual([]);
  });

  it("every hash in the tree resolves through the real by-hash resolver", () => {
    // The uniqueness map above is our own reimplementation; this leg runs the
    // exact function `devx merge-gate` calls, so a divergence between the two
    // can't hide a live AmbiguousSpecHashError.
    const unresolvable: string[] = [];
    for (const [hash, paths] of byHash) {
      try {
        const hit = findSpecForHashAnyType(repoRoot, hash);
        if (hit === null) {
          unresolvable.push(`${hash}: resolver found nothing (${paths[0]})`);
          continue;
        }
        const rel = relative(repoRoot, hit.path).replace(/\\/g, "/");
        if (!paths.includes(rel)) {
          unresolvable.push(`${hash}: resolved to unexpected ${rel}`);
        }
      } catch (err) {
        unresolvable.push(`${hash}: ${(err as Error).message}`);
      }
    }
    expect(unresolvable).toEqual([]);
  });
});
