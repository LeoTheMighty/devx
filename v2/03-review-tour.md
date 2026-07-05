# 03 — PR-as-Review: the static HTML review tour

Every PR `/devx` opens ships with a **single self-contained static HTML file**
that presents the change as a guided tour — orientation, decision ledger,
dependency-ordered stops, verified call-chain trails, blast radius — heavily
adapted from `LeoTheMighty/code-review-tour`. The human reviews by taking the
tour; input flows back **exclusively through normal GitHub PR comments** (no
server, no side channel). This is the "PR-as-a-review-stage" surface.

## 1. What we take from code-review-tour

The research verdict: **the tour data model and ~700 of the 911 lines of
`tour.html` are directly reusable**; the repo's own V2 backlog already specced
the static no-server fallback we need. The parts:

### Keep (the product)
- **`tour.json` schema, unchanged**: `meta`, `fullDiff`, `orientation`
  (summary, CI, reading order, time-boxed line, flag index), `changeMap`
  (file/area/**weight**/what/stops), `decisions` (the 3–7 real technical
  decisions: what/where/implies/alternative), `stops` (priority
  must/should/skim, flags, files, narration, prev/next connections, per-stop
  diff), `trails` (grep-verified call chains, step tables), `blastRadius`
  (incl. callers-not-updated), `coverage` (per-stop testedBy/gaps).
- **Weight classes**: core / supporting / mechanical / tests — honesty about
  what's skimmable.
- **Stops = meaningful changes in dependency order** (schema → models → logic
  → interface → wiring → tests), never alphabetical; never one-stop-per-file.
- **The 4-flag attention vocabulary**: ⚠ decision · 🔍 scrutinize · 💬
  discussed · 🕳 gap. **No severity verdicts** — the tour presents and points;
  judging is the human's job (and `/devx`'s own self-review already happened).
- **Trails must be grep/read-verified** — every A-calls-B edge confirmed at
  the call site or marked 🕳. Never narrated from plausibility.
- **UI**: the full field-journal layout — sticky sidebar itinerary with
  waypoint dots, sections 01–07 + Total Diff, diff2html rendering, `j`/`k`
  navigation, and the killer interaction: **`path:line` auto-linkification**
  → click → scroll-to-row in Total Diff with flash highlight + back-pill.
- **Time-boxed line** ("~30 min: Stops 2, 5, Trail A, Blast Radius").

### Change (4 edits to make it fully static)
1. **Embed data**: replace `fetch("/tour.json")` with an inline
   `<script type="application/json" id="tour-data">` block (escape `</script>`
   as `<\/`). The generator template-substitutes at build time.
2. **Vendor dependencies inline**: diff2html JS+CSS (~200KB) and marked
   (~40KB) inlined; **drop Mermaid for v1** (trail step tables carry the full
   information — the diagram is garnish); Google Fonts → system stacks
   (`ui-monospace`, `system-ui`, `Georgia`). Result: one .html, zero network
   requests, CSP-safe, works from any host.
3. **Delete the comment server**: `server.py`, `/pending`, `/batch`,
   `/results`, `/finish`, the synthesize/polish loop, `ledger.json` — all
   gone. v1 keeps the inline composer backed by **localStorage only**, plus
   two buttons: per-comment **"Copy as PR comment"** (`` `path:line` — text ``)
   and a drawer-level **"Export review → clipboard as markdown"**. The human
   pastes into GitHub. (Both were already specced as the upstream repo's own
   V2 fallback.) Simplest viable fallback if the composer fights us: drop it
   entirely and rely on deep-linked `path:line` references — comment on
   GitHub directly.
4. **Re-point the generator inputs**: upstream assumes a live PR via
   `gh pr view/diff/checks` + JIRA intent. Ours runs at PR-open time from
   local state: `git diff <base>...feat/<type>-<hash>`, the **spec file**
   (Goal + ACs replace JIRA intent; ACs seed the `coverage` rows), commits on
   the branch, and LEARN.md working agreements standing in for `patterns.md`
   triggers. JIRA references: stripped entirely.

### Drop for v1
Server + batching machinery, preferences.md/debrief loop (LEARN.md is our
version), Mermaid, concurrent-PR intersection, worktree phases (we're already
in one), the chat-walkthrough mode (PR comments are the channel).

## 2. Architecture

Split mechanical vs narrative, per the standing pattern:

```
devx tour build <hash>
  ├─ 1. gather (CLI, deterministic): diff vs base, per-file stats, commits,
  │      spec frontmatter+ACs, changed-file full contents
  ├─ 2. narrate (agent step in the /devx skill, schema-constrained):
  │      changeMap weights, stops (order/priority/flags/narration),
  │      decisions, trails (with grep-verify tool loop), blast radius,
  │      coverage vs ACs        → emits tour.json (JSON-schema validated)
  └─ 3. render (CLI, deterministic): tour.json + vendored template
         → .devx-cache/tours/<hash>/tour.html  (single file)
```

- Step 2's schema validation lives in the CLI (`devx tour validate`), so the
  agent retries on shape mismatch — same trio as pr-body/merge-gate.
- Big diffs (>~1500 lines / >25 files): subagent fan-out per semantic area /
  per candidate trail, synthesis in the main context ("the map must be
  coherent in one head").
- `parseHandoffSnippet`-style pinning: a test validates the tour template +
  schema against drift (the dvx107 move).

## 3. Hosting + PR integration

The upstream repo deliberately never solved hosting (localhost-only by
design). Our v1 leg — **orphan `devx-tours` branch** (recommended; D-4 in
`07-decisions.md`):

- `devx tour publish <hash>`: commits `tours/<hash>/tour.html` to the orphan
  branch (fetch-rebase-retry so parallel agents don't race), pushes.
- Link in the PR body via the existing `pr-body` template, new substitution:

  ```
  ## 🗺 Review tour
  [Take the tour](https://htmlpreview.github.io/?https://raw.githubusercontent.com/<org>/<repo>/devx-tours/tours/<hash>/tour.html)
  <details><summary>Orientation (text fallback)</summary>
  <tour orientation.summary + time-boxed line + stop list, as markdown>
  </details>
  ```

- The markdown fallback matters: it's what mobile + email + tour-hosting-
  failure see. Tour generation/publish failures are **fail-soft** — never
  block the PR (the harness's local-first rule, reapplied).
- Private-repo consideration: htmlpreview needs raw access; for private repos
  the v1 fallback is download-and-open (link to the raw file) — acceptable
  solo. GitHub Pages on the tours branch is the upgrade if/when wanted.
- Merge cleanup: tours for merged PRs are pruned by `devx tour prune`
  (retention: last N or unmerged-only) so the branch doesn't grow unbounded.

## 4. The review-response loop

The tour is write-only; steering comes back as PR comments. Two consumers:

1. **Pre-merge (YOLO nuance)**: auto-merge on green *remains the default*.
   If Leo wants to gate a specific PR, he comments `devx: hold` (or requests
   changes) before CI goes green — `await-remote-ci`/merge-gate Phase 8 gains
   a check for review-holds and unresolved change-requests. No hold → merges
   as today. (This keeps YOLO-merges-own-PRs intact while making review
   *possible* — D-5.)
2. **`/devx address <pr>`**: reads PR comments (`gh api`), maps each to
   spec/stop context (tour anchors are `path:line`, so mapping is mechanical),
   fixes in-scope items on the same branch, replies to each comment with what
   was done, files out-of-scope items as debug/test specs. Every comment gets
   a response — reply, commit, or spec — never silent resolution (harness
   discipline, kept).

## 5. Later (not v1)

- Live comment→GitHub posting from inside the tour via a GitHub-token
  pending-review mode (upstream's other V2 item).
- Tour for *planning* PRs (workstream artifact diffs get orientation + stops
  over prd/design/plan files — same engine, textual stops).
- LEARN.md-driven pattern triggers rendered as 🔍 pre-flags on stops.
- Mobile: tour URL in the push payload (`deep_link`), so phone review = open
  tour → comment via the GitHub app.
