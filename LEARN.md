# LEARN — Interim learnings backlog

What we changed about the *process* (not the product) while shipping each epic. Append-only; per-epic sections.

This file is the interim home for retrospective findings until Phase 5 ships `epic-retro-agent` + `epic-learn-agent` (and the proper `LESSONS.md` workflow with confidence-gated auto-apply). At that point `LearnAgent` will ingest this file's contents into `LESSONS.md` and the per-epic retro stories below become no-ops.

See [`docs/ROADMAP.md` § Locked decisions](./docs/ROADMAP.md#locked-decisions-cross-epic) — "Interim retro discipline".

---

## How this file is updated

Every epic ends with a `*ret` story (e.g. `audret`, `cfgret`) that:

1. Invokes the `bmad-retrospective` skill against the epic's shipped stories.
2. Appends findings to this file under the epic's section.
3. Applies low-blast-radius items immediately; files higher-blast items as `MANUAL.md` rows or new dev specs.

## Entry shape

Each finding is one row under its epic section:

```
- [confidence] [blast-radius] What worked / didn't / changes — applied | filed-as <ref> | pending
```

- **confidence**: `low` / `med` / `high` — based on signal strength (one anecdote vs. recurring pattern).
- **blast-radius**: `memory` / `skill` / `template` / `config` / `docs` / `code` — what surface the change touches; ceiling for auto-apply per `MODES.md`.
- **action**: `applied` (in this PR), `filed-as <ref>` (new dev spec / MANUAL row), or `pending` (waiting on something).

## Per-epic sections

Sections are added by each `*ret` story when it runs. Empty sections below are placeholders so the order matches `DEV.md`.

### Phase 0 — Foundation (plan: plan-a01000)

#### epic-bmad-audit

*Initial four findings below were extracted by hand on 2026-04-27 from status logs of aud101–aud103, ahead of `audret` running formally. Findings E1–E5 below them were added by the formal `bmad-retrospective` pass run during the audret PR (PR #19). The formal pass reconciled rather than duplicated the hand-extracted entries; the BMAD-shaped retro file lives at `_bmad-output/implementation-artifacts/epic-bmad-audit-retro-2026-04-27.md`.*

- [high] [skill+docs] **Stale `branch:` frontmatter on every spec.** Planner emitted `develop/dev-<hash>` as a default; project runs `git.integration_branch: null` + `branch_prefix: feat/`, so every claim had to "correct branch to feat/dev-<hash>". 3/3 stories hit this. — applied: `/devx-plan` + `/dev-plan` skills now derive `branch:` from `devx.config.yaml`; `docs/DESIGN.md § Spec file convention` adds a "Branch field — derived from `devx.config.yaml`" sub-section; sample frontmatter updated.
- [high] [docs] **Forward-pointing notes between sibling stories work well.** aud101 left a SKILL-not-vendored note for aud103, aud102 left three forward-pointing notes (qa-lens, shadow-vs-wrap, TEA ranking), aud103 resolved them all with explicit markers. The convention is: "leave a note in the produced artifact for the downstream story; the downstream story closes them out as part of its own ACs." — applied: noted here; promote to template/CLAUDE.md once a third epic confirms.
- [med] [docs] **No remote CI workflow yet → noisy "no required checks" log lines on every PR.** Resolves once `ini503` lands. — pending: ini503. *Update from formal pass: audret (PR #19) is the first PR to land after `.github/workflows/devx-ci.yml` was wired by cli305; this is the first /devx run that actually exercises CI-configured gating end-to-end.*
- [med] [config] **`bmad-audit.md` Risk 3 explicitly called out the missing `bmad-retrospective` wiring.** This is the trigger for the entire interim retro discipline (locked 2026-04-27). — applied: `LEARN.md` exists, retro stories filed for all 9 active epics, `/devx-plan` and `/dev-plan` updated to emit `*ret` rows.
- [E1] [high] [skill] **`bmad-agent-qa` ghost reference still unfixed at retro time.** `/devx-plan` and `/dev-plan` Phase 6 party-mode lens lists name a `bmad-agent-qa` skill that doesn't exist in `_bmad/_config/skill-manifest.csv`. `bmad-audit.md` §4.2 row 1 prescribes replacement with `bmad-tea` (Murat). — applied in audret PR #19: replaced in both `.claude/commands/devx-plan.md` and `.claude/commands/dev-plan.md`. Single-line text edit each; QA lens now resolves to a real BMAD skill.
- [E2] [med] [docs] **Long-lived doc artifacts should embed their own re-run trigger.** `bmad-audit.md` §5 names the precise inputs whose change should re-trigger the audit (`_bmad/_config/manifest.yaml → modules[].version`, etc.) instead of relying on out-of-band staleness detection. The pattern is reusable for research reports, plan files, and any artifact whose validity depends on inputs the document itself names. — pending-concordance: 1/4 epics observe this. Promote to `/devx-plan` epic-shape default once a second epic produces a re-run-trigger-bearing artifact.
- [E3] [med] [skill] **Party-mode personas can name filesystem paths that don't exist.** `epic-bmad-audit.md` party-mode minutes locked `_bmad/_cfg/manifest.yaml` as a path; the actual path is `_bmad/_config/manifest.yaml`. aud103 caught the mismatch and added a §5 footnote in `bmad-audit.md`, but the underlying epic file still carries the wrong path. Lesson: `/devx-plan` Phase 6 should verify any filesystem path a persona names before locking it as a decision. — pending-concordance: 1/4 epics. Promote to a Phase 5 LearnAgent rule (or earlier party-mode prompt-card) once a second epic confirms.
- [E4] [low] [docs] **Risk-severity calibration (gradient, not uniform) is a quality marker.** `bmad-audit.md` §3 ranks five risks by blast radius: TEA orphan = High, sprint-planning shadow + retrospective gap + manifest drift = Medium, UX timing = Low-conditional. The gradient lets downstream phases sequence work meaningfully. Codify as a §3 expectation in `/devx-plan` epic-shape prompts (not "list risks", but "rank risks by blast radius and name severity per row"). — pending-concordance: 1/4 epics. Note here; revisit at next retro.
- [E5] [med] [docs] **"Known gap to wire in Phase N" markers in plan locked-decisions should produce *interim discipline* rows in the parent plan, not just deferred-epic placeholders.** `epic-bmad-audit.md`'s "Locked decisions fed forward" already named the missing-`bmad-retrospective` gap. But the *interim discipline* (this LEARN.md + per-epic `*ret` story) had to be invented mid-flight when the user noticed the gap on 2026-04-27 — the original Phase 0 plan didn't carry it. Lesson: when a plan locks "X is a known gap, deferred to Phase N," it should also lock "interim approximation of X for Phases 0..N-1." — pending-concordance + higher blast radius (touches `/devx-plan` Phase 4 + `docs/DESIGN.md` "Locked decisions" convention); flag as a candidate dev spec under the Phase 5 LearnAgent epic when that lands.

#### epic-config-schema

*The first four findings below were extracted by hand on 2026-04-27 from the cfg201–cfg204 status logs, ahead of `cfgret` running formally. Findings E1–E7 below them were added by the formal `bmad-retrospective` pass run during the cfgret PR. The formal pass reconciled rather than duplicated the hand-extracted entries; the BMAD-shaped retro file lives at `_bmad-output/implementation-artifacts/epic-config-schema-retro-2026-04-27.md`.*

- [high] [docs] **Spec ACs vs. epic "locked decisions" precedence was undocumented.** cfg202 hit a real conflict: spec ACs said XDG-on-Linux, epic-config-schema.md "locked decisions" said `~/.devx/` everywhere. Author followed spec ACs (the right call) but with no rule to point at. — applied: `docs/DESIGN.md § Source-of-truth precedence` now codifies spec ACs > epic locked decisions > plan frontmatter > `devx.config.yaml` > skill defaults, with a "fix the loser in the same PR" rule. *Update from formal pass: cfg202 fixed only the rule's home doc, not the loser (epic-config-schema.md line 122). cfgret PR closes that gap — see E4 below.*
- [high] [code] **Self-review (edge-case-hunter) consistently catches real bugs.** cfg201 (5 issues fixed), cfg204 (12 findings, 5 actionable). The hits include real semantics issues (ajv-strict mutex idiom, eemeli/yaml setIn-on-Seq trap, type-coercion regex gaps) — not just lint. — applied: noted; recommend reinforcing self-review as a non-skippable step in `/devx` Phase 6 (already there per logs, but call it out in CLAUDE.md if absent). *Update from formal pass: cfg202 (1 load-bearing fix) + cfg203 (2) round out the picture — every cfg story turned up at least one self-review hit. Cross-epic-patterns row now applied: CLAUDE.md "Working agreements" gets an explicit "Self-review is non-skippable" bullet in cfgret PR.*
- [med] [code] **eemeli/yaml `setIn` on a Scalar replaces the node and loses inline comments.** Workaround: mutate `Scalar.value` in place, fall back to `setIn` only when the path doesn't exist. cfg202's "no comments lost" diff regression catches this. — applied: lives in source; flag as a `bmad-quick-dev` lesson if `bmad-quick-dev` ever touches yaml round-tripping.
- [low] [docs] **YOLO single-branch auto-merge confirmed across 3 stories** (cfg202 user-feedback, cfg204 self-driven, mirrored across cli/sup epics). — applied: `/devx` skill already enforces; record as a green check, no further action.
- [E1] [high] [skill] **`bmad-create-story` step in `/devx` Phase 2 silently skipped across all 4 Phase 0 epics.** No `_bmad-output/implementation-artifacts/story-*.md` file was produced for any of cfg201–cfg204 (or aud, cli, sup, ini); the only files in that directory are `epic-bmad-audit-retro-2026-04-27.md` and `sprint-status.yaml`. Spec ACs have been the de-facto source of truth; in YOLO + empty-dream they cover what `bmad-create-story` would generate. The /devx skill prescribes the step but reality has been "skip when spec ACs are sufficient." — pending-concordance + user-review: 4/4 epics observed, but the fix is a product decision (enforce / make conditional / drop). Filed for first LearnAgent pass when Phase 5 lands; no MANUAL row because it's a skill-prompt change, not a user-action. CLAUDE.md "How /devx runs" Phase 2 now carries an inline note acknowledging the drift.
- [E2] [high] [skill+docs] **Retro stories (`*ret`) are absent from `sprint-status.yaml`.** cfgret (this story) and audret (PR #19) are both filed in DEV.md but neither has a row in `_bmad-output/implementation-artifacts/sprint-status.yaml`. The /devx Phase 8.6 cleanup step "flip the matching `<hash>` to done" silently no-ops. Lesson: when `/devx-plan` or `/dev-plan` emits a `*ret` story, it must also append a sprint-status.yaml row. — pending-concordance: 2/2 retros observed; promote to skill-edit when a third retro confirms (cliret next).
- [E3] [high] [docs] **Pre-existing parent-story `sprint-status.yaml` flips drifting.** aud101–103 (`backlog`), cfg201 (`backlog`), sup405 (`backlog`) — all merged but yaml not updated by their respective /devx cleanup commits. Phase 8.6 IS supposed to flip these. Drift currently harmless (no consumer reads the yaml yet) but becomes a behavior bug the moment LearnAgent or `/devx-manage` lands. — applied for cfg201 (in-scope, same epic) in cfgret PR. Filed remainder as `MANUAL.md MP0.1` for user decision (mechanical four-row chore-commit, or new debug spec).
- [E4] [med] [docs] **"Fix the loser" half of the precedence rule was skipped.** cfg202 followed `docs/DESIGN.md § Source-of-truth precedence` but did NOT update the losing-side `epic-config-schema.md` "Locked decisions fed forward" line 122 — it kept claiming `~/.devx/` cross-platform when implementation is XDG-on-Linux. Survived four stories. — applied in cfgret PR: epic-config-schema.md line 122 now matches implementation.
- [E5] [med] [docs] **CLAUDE.md "How /devx runs" section was stale relative to the project's single-branch config.** Lines 184–185 prescribed `develop/dev-<hash>` worktrees off `develop`; line 195 said "Push + PR to `develop`". Self-inconsistent with the same file's §"Branching model" section that explicitly states the project is single-branch on `main`. — applied in cfgret PR: section rewritten with `feat/dev-<hash>` off `main`, `gh pr merge --squash --delete-branch` (the form that works without "Allow auto-merge"), explicit claim-commit-push-before-PR rule, and an inline note about the bmad-create-story drift.
- [E6] [low] [docs] **Phase-0 stub-policy carve-out for the only real-functional command (`devx config`).** cfg204 AC#7: no-args invocation prints usage to stderr and exits 0 (not 64) — Phase 0 stub policy applies even though config is real. The right ergonomic default for Phase 1+ commands too: keeps CLI behavior consistent across stub and real, so users can't distinguish "not implemented" from "needs args" by exit code alone. — pending-concordance: single instance; revisit when a second real Phase 1+ command lands.
- [E7] [low] [docs] **`docs/CONFIG.md § Schema validation` no-op resolved.** epic-config-schema.md flagged CONFIG.md as carrying a stale path (`_bmad/devx/config-schema.json`) for the JSON schema. Verified during cfgret: CONFIG.md line 443 now reads "ships embedded in the devx npm package and is resolved at runtime via `require.resolve`" — already corrected at some point during cfg201–204. No action needed; flagged here so the audit→correction trail is closed.

#### epic-cli-skeleton

*Findings extracted by hand on 2026-04-27 from cli301–cli305 status logs.*

- [high] [docs] **Same precedence issue as cfg202.** cli302: party-mode minutes proposed adding a `preview:` follow-up line to stub stderr; spec ACs required stderr to "match exactly." Author followed the spec and pinned a single-line property test so any future preview-line bolt-on must update both the spec and the regression test. — applied via the same `docs/DESIGN.md § Source-of-truth precedence` fix above.
- [high] [code] **Symlinked `bin` (npm i -g) breaks `isMainEntry` checks.** cli301 self-review caught it (HIGH); fix uses `realpathSync` on both sides + regression test. — applied: lives in source; note for future CLI scaffolds (and any `/devx-init` work).
- [high] [code] **`npm test` must `npm run build` first if subprocess smoke depends on `dist/`.** cli301 self-review found this (MED). — applied: lives in source.
- [med] [code+filed] **"Claim commit not pushed before PR open" race.** cli301 had to `reset --hard origin/main` after the squash subsumed an unpushed claim commit. Filed as `debug-flow01`. — filed-as `debug-flow01` (verify it's tracked; current DEV.md shows no debug/ folder yet — TODO check).
- [low] [config] **Trust-gradient threshold = 0 in YOLO single-branch makes auto-merge the steady-state.** cli302/cli304 explicitly cite "count=0/threshold=0". — applied: matches `/devx` skill behavior; record only.

#### epic-os-supervisor-scaffold

*Findings extracted by hand on 2026-04-27 from sup401–sup405 status logs.*

- [high] [code] **WSL Task Scheduler intentionally deviates from the AC.** sup404 substitutes `${HOME}` at install time because `wsl.exe --exec` doesn't spawn a shell. Deviation called out explicitly in the status log and tested. — applied: in source; the *pattern* (AC-deviation-with-explicit-rationale-in-status-log) is healthy and worth preserving; promote into template once a third epic confirms.
- [med] [template] **Idempotency state file pattern (SHA-256 of installed artifact at `~/.devx/state/<thing>.installed.json`) is a clean primitive that recurred** across sup401 (stub install) and likely will across other installer-style work (`ini505`, future Concierge/Manager state). — applied: noted; file as a candidate skill/template enhancement when `/devx-init` lands and we have a place to centralize it.
- [low] [code] **Test-count compounding is real.** Across the epic: sup401 116 → sup402 133 → sup403 153 → sup404 172 → sup405 199. Discipline is paying off; no action needed. — applied: green check.
- [med] [docs] **`docs/SUPERVISOR-TESTING.md` was added by sup405 as a how-to for manual host-level test cases that don't fit unit tests.** Pattern: when a story needs hands-on verification, file a per-feature `docs/<FEATURE>-TESTING.md` rather than burying steps in MANUAL.md. — applied via sup405 PR; promote to a `docs/TESTING/` convention when a second case shows up.

#### epic-init-skill

*(empty — `iniret` runs once ini502–ini508 ship.)*

### Mobile companion v0.1 (plan: plan-7a2d1f)

#### epic-flutter-scaffold-ios-device

#### epic-github-connection-read

#### epic-bidirectional-writes-offline

#### epic-realtime-updates-push

---

## Cross-epic patterns

Findings that recur across multiple epics get promoted up to this section once they hit ≥3 concordant retros (the Phase 5 `epic-learn-agent` threshold; we mirror it manually here). These are higher-confidence and warrant skill / template / `CLAUDE.md` edits rather than memory.

- [high] [skill+docs] **Planner-emitted `branch:` frontmatter ignored `devx.config.yaml`.** Hit on every Phase 0 story across all 4 shipped epics (aud × 3, cfg × 4, cli × 5, sup × 5 = 17/17). Promoted because it crossed the ≥3-epic threshold immediately. — applied to `/devx-plan`, `/dev-plan`, `docs/DESIGN.md` on 2026-04-27.
- [high] [docs] **Source-of-truth precedence rule** (spec ACs > epic locked decisions > plan frontmatter > `devx.config.yaml` > skill defaults) — surfaced by cfg202 (XDG vs `~/.devx/`) + cli302 (party-mode vs stderr-exact-match). Promoted because two independent epics needed the same rule. — applied to `docs/DESIGN.md § Source-of-truth precedence` on 2026-04-27.
- [high] [code] **`/devx` self-review step is non-skippable and consistently finds real bugs** — cfg201 (5), cfg202 (1 load-bearing — `setIn`-on-Scalar trap), cfg203 (2), cfg204 (5/12), cli301 (2 incl. one HIGH), cli304 (1/8), aud102 (4), aud103 (4). — applied in cfgret PR: CLAUDE.md "Working agreements" now carries an explicit **"Self-review is non-skippable"** bullet.
- [high] [skill] **`bmad-create-story` step in `/devx` Phase 2 silently skipped on every Phase 0 story** (4/4 epics: aud × 3, cfg × 4, cli × 5, sup × 5; ini partial). No `_bmad-output/implementation-artifacts/story-*.md` file was ever produced. Spec ACs have been the de-facto source of truth in YOLO + empty-dream. — applied (docs only) in cfgret PR: CLAUDE.md "How /devx runs" Phase 2 carries an inline acknowledgement of the drift. Pending-concordance + user-review for the actual skill change (enforce / make conditional / drop) — load-bearing skill prompt edits go through `self_healing.user_review_required_for: [skills]`.
- [high] [docs] **Stale `develop`-branch references inside CLAUDE.md "How /devx runs" section** despite the project being single-branch (CLAUDE.md's own §"Branching model" already says so). Self-inconsistency in a load-bearing context file. — applied in cfgret PR: section rewritten to reflect single-branch reality (`feat/<type>-<hash>` off `main`; squash+delete-branch merge form). Promote to a periodic CLAUDE.md self-consistency check for future refactors.
