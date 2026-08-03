---
gate: CONCERNS
status_reason: 'FR-4 is ⚠️ partial (Claim and merge-cleanup explicitly guarantee same-commit inclusion (claim pathspec; mark-done {paths} JSON), but the RED-emission hook only writes GRAPH.md during writeRetroAtomically — the design never says how GRAPH.md joins the emission flow''s commit pathspec, so the ''same commit as the state flip'' requirement is unspecified for that flow.) FR-6 is ⚠️ partial (Package shipping is designed (src/commands/graph.ts registered in src/cli.ts; downstream repos run the updated global CLI), but the FR''s ''/devx-init (or its update path)'' leg is never addressed — nothing designs how downstream repos receive the rewritten Phase-8 skill body that invokes mark-done, without which their loops lack the FR-4 regen hooks.)'
reviewer: 'devx gate coverage (design mode)'
updated: 2026-08-02
waiver: { active: false, approver: null, reason: null }
---

# Verify — _devx/workstreams/story-graph — 2026-08-02

## Subject

`design.md` reviewed against `prd.md` (design mode; workstream `62bcd1`).

## Coverage

| ID | Status | Where covered | Note |
|---|---|---|---|
| G-1 | ✅ | Constraints (first bullet) + Design § Data (no caches) | Zero-AI/zero-network and <2s are named constraints; pure local readdir+parse over ~200 files budgeted inside 2s; E-1 live-repo run before merge verifies. |
| G-2 | ✅ | Constraints § Portability + Migration plan step 4 | Per-repo attended backfill PRs for devx, friend-finder-mesh, palateful via the updated global CLI; audited drift degrades with warnings, never crashes. |
| G-3 | ✅ | Design § Regen hooks (FR-4) + Interfaces --check | Regen lives inside claim/emission/mark-done helpers so unattended flows get it structurally; --check is the 4-week drift measurement instrument; warn-and-continue failure posture explicitly routed to --check. |
| UC-1 | ✅ | Design § Renderer + § Graph model (groups/nodes) | Subgraph per group, classDef per status, hash+short-title labels, blocking arrows, done-epic collapse — the pick-next-by-eye view is fully specified. |
| UC-2 | ✅ | Design § Regen hooks — RED emission | Regen slotted after writeRetroAtomically (emit-retro-story.ts:318), the last write of the emission flow, so the render sees the full new epic. |
| UC-3 | ✅ | Design § Regen hooks — Claim + Merge-cleanup | Claim regen joins claimSpec's tmp+rename plan, rollback closure, and commit pathspec; merge-cleanup hosted by the new mark-done helper emitting {paths} for the cleanup commit. |
| UC-4 | ✅ | Design § Regen hooks — Backfill + Migration plan step 4 | Pass 1 mechanical (union + phase:/plan.md/todo.md derivation), pass 2 reports underivable remainder for an attended session; lands as per-repo attended PRs; devx pre-convention history included first. |
| UC-5 | ✅ | Interfaces — --check + exit codes | Byte-compare against committed GRAPH.md, exit 1 on drift naming file + regen command, writes nothing; CI wiring deliberately deferred (matches sync:skills precedent), gate itself is designed. |
| CAP-1 | ✅ | Design § Graph model + Wrap-don't-duplicate § Reuses | Reuses parseDevMd/parseEpicHeadings/epicSlugify/frontmatter reads; readBacklogRows over all four backlogs plus a new cross-dir spec index; row+frontmatter edge union deduped, every token validated against the known-hash set. |
| CAP-2 | ✅ | Design § Renderer + § CLI | renderStoryGraph is pure with total sort orders (hash within groups; groups by kind,id; edges by from,to,kind), no timestamps, so byte-stable; thin CommandModule passthrough on top. |
| CAP-3 | ✅ | Design § Parser completion + hardening | PARALLEL_TEXT_RE for both annotation forms; splitHashes hardened for ~~/**/punctuation + spec-path forms; hyphen blocked-by: read via parseFrontmatterValue with warn; heading-variant tolerance; drift warned not fixed (devx doctor owns fix). |
| CAP-4 | ✅ | Design § Regen hooks + Constraints (single-writer) | All GRAPH.md writes via writeAtomic tmp+rename; --check follows the sync:skills diffMirror idiom; regenerateGraph() is the shared never-throws composition consumed by all three hooks. |
| CAP-5 | ✅ | Constraints § Portability + Design § Backfill + Migration plan | Ships in the package, runs against audited ffm/palateful drift with warn+degrade; backfill is mechanical-first with the AI part explicitly a session, not the CLI. |
| FR-1 | ✅ | Design § CLI + Interfaces | All specified flags (--check/--stdout/--format mermaid\|json/--epic/--workstream) present with exit-code contract; reads specs+backlogs+todo.md; atomic root write; worktree-safe resolveRepoRoot chosen deliberately over the config-walk. |
| FR-2 | ✅ | Design § Renderer + § Graph model | All eight sub-items (a)-(h) have mechanisms: subgraphs, status classDefs + struck exclusion, validated union edges with drop+warn, distinct parallel/lineage link classes, done-group collapse with count+lastMerged, standalone group, INTERVIEW/MANUAL badges via reverse Blocks:, plain cross-group edges; banner+legend, full determinism, blankFencedLines reused. Exact glyphs deferred (flagged non-blocking, class distinctness required). |
| FR-3 | ✅ | Design § Parser completion + § Graph model (validation, drift, cycle) | All six sub-items (a)-(f): parallel parser in parse.ts consumed via new DevRow.parallel_with; markup-strip + spec-path tokenization with known-hash validation and source-naming warnings; hyphen-key read+warn; heading variants; row-vs-frontmatter drift warning with both sets; DFS cycle check as hard error enumerating every member hash, no write. |
| FR-4 | ⚠️ | Design § Regen hooks (FR-4) | Claim and merge-cleanup explicitly guarantee same-commit inclusion (claim pathspec; mark-done {paths} JSON), but the RED-emission hook only writes GRAPH.md during writeRetroAtomically — the design never says how GRAPH.md joins the emission flow's commit pathspec, so the 'same commit as the state flip' requirement is unspecified for that flow. |
| FR-5 | ✅ | Design § Regen hooks — Backfill | Union + write-missing-side in canonical underscore form (hyphen normalized), derivation limited to phase:/plan.md pointer/todo.md POINTER_RE durable state, pass-2 underivable report, adds-only + idempotent (second run = 0 writes), discovery via resolveSpecWorkstream's three-arm chain which explicitly works without PLAN.md rows or plan.md; ffm done-row shape gets frontmatter-only writes. |
| FR-6 | ⚠️ | Wrap-don't-duplicate § Adds + Migration plan steps 3-4 | Package shipping is designed (src/commands/graph.ts registered in src/cli.ts; downstream repos run the updated global CLI), but the FR's '/devx-init (or its update path)' leg is never addressed — nothing designs how downstream repos receive the rewritten Phase-8 skill body that invokes mark-done, without which their loops lack the FR-4 regen hooks. |

## Extras requiring product approval

- EXTRA-1 — Design § Regen hooks — Merge-cleanup + Wrap-don't-duplicate § Adds
- EXTRA-2 — Interfaces — library surface
- EXTRA-3 — Interfaces — devx graph backfill [--dry-run]
- EXTRA-4 — Design § Parser hardening + Migration plan step 1

## Verdict detail

- FR-4 is ⚠️ partial (Claim and merge-cleanup explicitly guarantee same-commit inclusion (claim pathspec; mark-done {paths} JSON), but the RED-emission hook only writes GRAPH.md during writeRetroAtomically — the design never says how GRAPH.md joins the emission flow's commit pathspec, so the 'same commit as the state flip' requirement is unspecified for that flow.)
- FR-6 is ⚠️ partial (Package shipping is designed (src/commands/graph.ts registered in src/cli.ts; downstream repos run the updated global CLI), but the FR's '/devx-init (or its update path)' leg is never addressed — nothing designs how downstream repos receive the rewritten Phase-8 skill body that invokes mark-done, without which their loops lack the FR-4 regen hooks.)
