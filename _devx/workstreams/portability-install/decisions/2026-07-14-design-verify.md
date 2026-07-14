---
gate: CONCERNS
status_reason: 'G-3 is ⚠️ partial (The S-5 live run is referenced and palateful prerequisites are assumed, but the symptom-to-merged-fix and devx loop --max-items 1 components of G-3 get no design treatment (no checklist shape, no mechanism) — deferred implicitly to the plan.) FR-3 is ⚠️ partial (Defaults AnswerProvider, INTERVIEW.md seeding, upgrade-mode idempotency, and --resume-gh compat are all designed, but stack detection is hand-waved: ''reuses the existing seed/template selection'' names the seeds without saying how ts/go/python/rust/flutter/empty is inferred non-interactively (the existing selection is interview-driven).) (+2 more)'
reviewer: 'devx gate coverage (design mode)'
updated: 2026-07-14
waiver: { active: false, approver: null, reason: null }
---

# Verify — _devx/workstreams/portability-install — 2026-07-14

## Subject

`design.md` reviewed against `prd.md` (design mode; workstream `b3f7a1`).

## Coverage

| ID | Status | Where covered | Note |
|---|---|---|---|
| G-1 | ✅ | design.md §Overview (Objective) + §Design/Architecture items 2-3 + §Assumptions | Non-interactive CLI scaffold + skills installer give a credible path to a working /devx on a fresh repo; S-5 live timing on palateful is named as the validation. |
| G-2 | ✅ | design.md §Design/Architecture item 1 + §Trade-offs (copies over symlinks) | skills/ mirror in package.json files, npm run sync:skills, and test/skills-sync.test.ts failing on divergence in either direction directly deliver 3/3 shipped + zero silent drift. |
| G-3 | ⚠️ | design.md §Overview + §Assumptions + §Unresolved design questions (E-7) | The S-5 live run is referenced and palateful prerequisites are assumed, but the symptom-to-merged-fix and devx loop --max-items 1 components of G-3 get no design treatment (no checklist shape, no mechanism) — deferred implicitly to the plan. |
| G-4 | ✅ | design.md §Migration plan + §Wrap, don't duplicate (docs rewrites) | Docs cut over in the same PR as the flow they describe, with zero-phantom-paths gated by the E-6 docs-accuracy eval from that point on. |
| UC-1 | ✅ | design.md §Design/Architecture item 4 + §Interfaces (install:global) | Build writes dist/build-info.json from git rev-parse; --version composes <semver>+<sha> at runtime; install:global = build + npm i -g . |
| UC-2 | ✅ | design.md §Design/Architecture items 2-3 + §Assumptions | Full scaffold via existing runInit()/init-write plus the new skills-install step; Claude Code slash-command discovery of .claude/commands/ is an explicit assumption re-verified by the live run. |
| UC-3 | ✅ | design.md §Design/Architecture item 2 + §Wrap, don't duplicate (runInitUpgrade) + §Migration plan | Idempotency via existing init-upgrade path; header-detection rule (headerless = user-owned = skip + MANUAL.md) protects hand-rolled files. |
| UC-4 | ✅ | design.md §Design/Architecture item 1 | Bidirectional drift check in npm test naming the divergent file matches the PRD's own definition of the guard (G-2/CAP-5 pin the mechanism to npm test). |
| CAP-1 | ✅ | design.md §Design/Architecture item 1 + §Data | skills/{devx,devx-plan,devx-interview}.md as git-tracked regular files listed in package.json files; canonical source for installers. |
| CAP-2 | ✅ | design.md §Design/Architecture item 3 + §Wrap, don't duplicate | Defaults AnswerProvider over the existing runInit()/scriptedAsk seam; /devx-init stays the interview wrapper over the same orchestrator (explicit backward-compat constraint). |
| CAP-3 | ✅ | design.md §Design/Architecture item 2 + §Interfaces | init-skills.ts installs version-header-stamped files to <repo>/.claude/commands/ by default, ~/.claude/commands/ via --global. |
| CAP-4 | ✅ | design.md §Design/Architecture item 4 + §Data | One resolved version string (semver+sha from dist/build-info.json) consumed by --version, the skill header, and init's devx_version stamp. |
| CAP-5 | ✅ | design.md §Design/Architecture item 1 + §Risks (E-2) | test/skills-sync.test.ts in npm test fails on divergence in either direction and names the file. |
| FR-1 | ✅ | design.md §Design/Architecture item 1 + §Risks (E-1 subprocess smoke) | Three canonical files in skills/, package.json files entry, and E-1 asserting the actual npm pack manifest (cli301 lesson applied). |
| FR-2 | ✅ | design.md §Resolved design questions + §Constraints + §Trade-offs | Symlink-vs-copy resolved to copies (npm pack drops symlinks; symlink would bypass the .claude/ harness gate) — the fallback FR-2 explicitly allowed; drift check + user-foreground .claude/ edit both addressed. |
| FR-3 | ⚠️ | design.md §Design/Architecture item 3 | Defaults AnswerProvider, INTERVIEW.md seeding, upgrade-mode idempotency, and --resume-gh compat are all designed, but stack detection is hand-waved: 'reuses the existing seed/template selection' names the seeds without saying how ts/go/python/rust/flutter/empty is inferred non-interactively (the existing selection is interview-driven). |
| FR-4 | ✅ | design.md §Design/Architecture item 2 + §Interfaces + §Data | Pure decision fn (file state x header presence x version) covering write/overwrite-on-version-change/skip-user-owned + MANUAL.md entry; --global target; CLI writes to other repos/~ explicitly ungated (Constraints). |
| FR-5 | ✅ | design.md §Design/Architecture item 4 + §Interfaces + §Discarded considerations | install:global = build (SHA embed via build-info.json) + npm i -g .; npm link explicitly discarded with the INSTALL.md warning rationale (links HEAD live). |
| FR-6 | ⚠️ | design.md §Wrap, don't duplicate + §Migration plan | Docs rewrites are named generically and gated by E-6, but the design never addresses the INSTALL.md work-repo caveat (BETA/PROD mode, org policy — INTERVIEW Q#11) that FR-6 requires; §Out of scope lists work-repo rollout without carving out the doc caveat. |
| FR-7 | ⚠️ | design.md §Risks (E-3) + §Wrap, don't duplicate (ini508 harness) + §Assumptions | Scripted side is solid (ini508 e2e fixture gains the fresh-repo CLI-scaffold scenario asserting the full artifact set incl. skills), but the live S-5 components — timed run, symptom-to-fix, loop run, and the nothing-written-outside-repo-except-~/.devx/ assertion — get only a passing 'the checklist records them' with no checklist design. |

## Extras requiring product approval

- --skip-skills escape-hatch flag on devx init (not in any PRD FR/CAP) — design.md §Interfaces
- force? option on the installSkills() library surface (no PRD requirement for forced overwrite) — design.md §Interfaces
- builtAt field in dist/build-info.json (PRD only requires the git SHA) — design.md §Design/Architecture item 4 + §Data

## Verdict detail

- G-3 is ⚠️ partial (The S-5 live run is referenced and palateful prerequisites are assumed, but the symptom-to-merged-fix and devx loop --max-items 1 components of G-3 get no design treatment (no checklist shape, no mechanism) — deferred implicitly to the plan.)
- FR-3 is ⚠️ partial (Defaults AnswerProvider, INTERVIEW.md seeding, upgrade-mode idempotency, and --resume-gh compat are all designed, but stack detection is hand-waved: 'reuses the existing seed/template selection' names the seeds without saying how ts/go/python/rust/flutter/empty is inferred non-interactively (the existing selection is interview-driven).)
- FR-6 is ⚠️ partial (Docs rewrites are named generically and gated by E-6, but the design never addresses the INSTALL.md work-repo caveat (BETA/PROD mode, org policy — INTERVIEW Q#11) that FR-6 requires; §Out of scope lists work-repo rollout without carving out the doc caveat.)
- FR-7 is ⚠️ partial (Scripted side is solid (ini508 e2e fixture gains the fresh-repo CLI-scaffold scenario asserting the full artifact set incl. skills), but the live S-5 components — timed run, symptom-to-fix, loop run, and the nothing-written-outside-repo-except-~/.devx/ assertion — get only a passing 'the checklist records them' with no checklist design.)
