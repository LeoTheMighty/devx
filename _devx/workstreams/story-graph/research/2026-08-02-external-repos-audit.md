# Research — devx state audit: friend-finder-mesh + palateful (2026-08-02)

Explore-agent audit for the story-graph PRD (portability + backfill scope).
Both repos install devx via the global CLI copy (no npm dep); ffm at
`0.1.0+6447cef` (current), palateful at `0.1.0+9070cd3` (behind — predates
qa-walkthrough template + devx-test skill).

## friend-finder-mesh (ffm)

- 14 dev / 2 plan / 7 debug / 7 test specs; workstreams
  `friend-finder-mesh-features` (full artifacts) + `orb-companion-app`
  (prd+expectations only, **no plan.md**).
- Epic heading: `### friend-finder-mesh-features (workstream ba7c7a)` —
  no `Epic — ` prefix, `workstream <hash>` not `(plan: <hash>)` →
  `parseEpicHeadings` returns `[]`, all rows get `epicSlug=null`.
- **Edges live in frontmatter only for done stories**: DEV.md rows lose
  their `Blocked-by:` prose when a story merges (replaced by PR narration).
  8 real edges recoverable only from frontmatter `blocked_by:` (underscore
  form, used consistently).
- Frontmatter is rich: `from:` on all 14 (plan path for phase stories,
  parent dev spec for splits), `spawned: [<bare-hash>]`, `plan:` +
  `phase: 1..10` on phase stories (absent on splits; `ffmret`'s `plan:` is
  a plan-spec *path* not a workstream dir).
- plan.md Phase checklist carries `(dev spec: ffm101)` pointers — the
  supported optional marker form. Checkboxes stale (phases 1–4 unchecked,
  stories done).
- `test/qa-walkthrough-<hash>.md` (5 files) deliberately dodge `ROW_RE`
  (workaround for debug-7c40de) — invisible to the row parser.
- PLAN.md `Status: planning complete` is not a legal token → silent
  checkbox fallback (row `[x]`/done vs spec frontmatter `in-progress,
  stage: executing`).

## palateful

- 41 dev / 8 plan / 13 debug / 1 test specs; workstreams
  `browser-qa-agent` + `rotation-self-heal` (full artifacts, CONCERNS
  verdicts present); plus BMAD legacy (`_bmad-output/` referenced by
  `from:`), 6 BMAD-imported plan specs with minimal frontmatter + extra
  `mode:` key.
- Headings mixed depth (`##` and `###`), `workstream <hash>` form, and
  prose suffixes (`(active; ifh-1/2 already on main)`) → slugs parse but
  `planHash=null` on all 4; 7 rows under a non-epic heading (`## Loose
  ends…`) have `epicSlug=null` and belong to 7 different legacy epics
  named only in `from:`.
- **Edges live in DEV.md prose only**: 21/41 specs have no frontmatter
  blocked-by key (the whole rsh chain); **12 specs use `blocked-by:`
  (hyphen)** which `frontmatter.ts` (underscore-only) drops entirely; only
  5 use `blocked_by:`.
- **Phantom-edge factory**: prose-heavy `Blocked-by:` annotations tokenize
  into ~30 fake hashes across 7 rows (`green`, `main`, `test`, `after`,
  `gate`, …). Worst: rsh102 yields 7 phantoms and 0 real edges — the real
  blockers `~~rsh101~~` (tildes survive) and `debug-rshred1**:` (trailing
  bold/colon) both fail tokenization.
- Cross-type edge: `bqa102` blocked by a `debug/…` path. Split lineage via
  `spawned:`/`from:`/`superseded_by:` (rsh108 → 7c5cf2 → af8309 → 3a50ae);
  `spawned:` has two value forms (bare hashes vs full-path block list).
- `plan-41ee13` + `plan-462355` exist on disk with full gate frontmatter
  but **no PLAN.md row**; only mechanical bridge is dev-spec `from:` →
  plan path → plan frontmatter `workstream:` → workstream dir.
- No `phase:` frontmatter anywhere; plan.md phase lines carry no hash
  pointers (FR-ids + deadlines instead). Phase checkboxes all unchecked
  despite done stories.
- Hash lengths 4–11 chars (`ifh3` … `bugsimppho7`) — all legal per
  `{3,12}` but length signals nothing.
- Struck row with live checkbox: `[/] ~~…~~ superseded by af8309.`
  (canonical parser handles: struck wins). One row has `Blocked-by:`
  before `Status:`. 16 stale locks incl. done specs.
- `_devx/workstreams/run-eval.sh` + `_devx/import-2026-07-27.md` —
  non-workstream files a naive slug glob will enumerate.

## Ranked portability requirements for the graph/backfill

1. Tolerate epic-heading variants: optional `Epic — ` prefix; `workstream
   <hash>` as the linkage form; mixed `##`/`###`; prose suffixes.
2. **Union both edge sources** (DEV.md rows + frontmatter, deduped) — the
   authoritative side differs per repo and neither is complete anywhere.
3. Validate every parsed blocker against the known-hash set; drop + warn
   unknowns (kills the phantom-node class). Strip `~~`, `**`, trailing
   punctuation before tokenizing; accept spec-path blockers (cross-type).
4. Tolerate `blocked-by:` hyphen frontmatter key (12 specs).
5. Model lineage edges (`from:`/`spawned:`/`superseded_by:`) as a distinct
   class; `spawned:` in both value forms.
6. Workstream discovery must not require PLAN.md rows or plan.md presence;
   walk dev-spec `from:` → plan frontmatter `workstream:` as the primary
   bridge; skip non-directory entries in workstreams_root.
7. Phase ordering only where it exists (`phase:` frontmatter, `(dev spec:
   <hash>)` pointers, todo.md pointers); fall back to blocked_by topology.
8. Never trust plan.md phase checkboxes or PLAN.md status prose; spec
   frontmatter + row checkbox via the canonical precedence only.
