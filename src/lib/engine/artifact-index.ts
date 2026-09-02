// The artifact map read BACKWARDS — a doc-set-relative path, in either
// layout's spelling, to the layout-independent `ArtifactKind` that names it.
//
// Separate from `artifacts.ts` on purpose, and the reason is structural rather
// than aesthetic. E-2 holds that the resolver module exports no callable
// without a production caller: an exported resolver nobody calls is a bypass
// waiting for its first caller, which is the whole failure class this
// workstream closes. `buildArtifactKindIndex` cannot satisfy that where it was
// — its only call site is the `REVERSE_MAP` construction directly beneath it,
// and it is exported solely so its collision guard has a negative control
// (a guard nothing can trip is a guard nobody knows works). Here the builder,
// the guard and the one index built from them are the module's whole subject,
// so the export has a caller and the control keeps its seam.
//
// The dependency runs one way — this file reads `artifacts.ts`, never the
// reverse. That matters more than the file count: `REVERSE_MAP` is built at
// module load and its guard throws, so a cycle between the two would make the
// throw depend on which module a command happened to import first.
//
// Spec: dev/dev-dlr105-2026-09-02T09:14-identity-rekey-privatization.md
// Plan: _devx/workstreams/docs-layout-resolution/plan/agent.md §5

import {
  ALL_ARTIFACT_KINDS,
  type ArtifactKind,
  DOCS_LAYOUTS,
  type DocsLayout,
  artifactKindIdentity,
  artifactRel,
  normalizeArtifactPath,
} from "./artifacts.js";

/** Build the reverse index over a kind list. Exported for its negative
 *  control: a guard nothing can trip is a guard nobody knows works, and the
 *  live table has no collision to prove it with. */
export function buildArtifactKindIndex(
  kinds: readonly ArtifactKind[],
  // Seam, and the only reason it exists: no two identities in the LIVE table
  // spell the same path, so a collision cannot be constructed through the
  // public API — and a guard that has never executed is a guard nobody knows
  // works. Injecting the resolver lets the throw be proven.
  relFor: (layout: DocsLayout, kind: ArtifactKind) => string = artifactRel,
): ReadonlyMap<string, ArtifactKind> {
  const map = new Map<string, ArtifactKind>();
  for (const kind of kinds) {
    for (const layout of DOCS_LAYOUTS) {
      // Keys are lowercased: this backs a user-typed surface (`devx revise
      // --touched`), the table's only uppercase basenames are `RESULTS.md`
      // and `RED-report.md`, and `outline.ts`'s classifier already lowercases.
      // Two case conventions in one repo is how a real path returns null.
      const rel = normalizeArtifactPath(relFor(layout, kind)).toLowerCase();
      const existing = map.get(rel);
      if (existing && artifactKindIdentity(existing) !== artifactKindIdentity(kind)) {
        throw new Error(
          `artifacts: '${rel}' is claimed by both ` +
            `'${artifactKindIdentity(existing)}' and '${artifactKindIdentity(kind)}'`,
        );
      }
      if (!existing) map.set(rel, kind);
    }
  }
  return map;
}

/** The same table read backwards, built once. Keyed on the doc-set-relative
 *  spelling in BOTH layouts, because a `--touched design.md` typed against a
 *  folder-layout repo (a flat-era shorthand) and the same string typed against
 *  a flat repo (the current name) must resolve to the same identity.
 *
 *  This runs at module load, and `engine/revise.ts` now imports this file for
 *  values — so a throw here would brick `devx revise`. It cannot: the input is
 *  two compile-time constant lists, so the guard is a dev-time assert that
 *  fires the moment a new `StageDir` or kind introduces a collision, and never
 *  on user input. */
const REVERSE_MAP = buildArtifactKindIndex(ALL_ARTIFACT_KINDS);

/** Reverse of `stageSubject()`'s kind→path half: a **doc-set-relative**
 *  artifact path in EITHER layout's spelling → its layout-independent
 *  identity, or `null` when the map does not own the path.
 *
 *  Doc-set-relative, and the distinction is load-bearing: `stageSubject`
 *  returns a REPO-relative `rel`, so under `workstream` this is NOT its
 *  inverse — `pathToArtifactKind("_devx/workstreams/x/prd/agent.md")` is
 *  `null`, and a caller round-tripping a `.rel` must strip the workstream
 *  prefix first. Under `project-level` the two coincide because the doc set
 *  IS the repo root.
 *
 *  Because it is layout-blind by design (both spellings resolve), composing
 *  it with `stageSubject` can RELOCATE a path: in a workstream repo a file
 *  genuinely named `design.md` maps to `{agent, design}` and back out to
 *  `design/agent.md`. Consumers that mean "the artifact at this exact path"
 *  must check the layout themselves; the map answers "which artifact is this
 *  the name of", which is the question `devx revise --touched` asks. */
export function pathToArtifactKind(rel: string): ArtifactKind | null {
  return REVERSE_MAP.get(normalizeArtifactPath(rel).toLowerCase()) ?? null;
}
