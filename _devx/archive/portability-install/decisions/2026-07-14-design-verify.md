---
gate: PASS
status_reason: 'All 20 source IDs fully covered in design mode.'
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
| G-1 | ✅ | design.md §Overview, §Design/Architecture 2-3, §Migration plan (E-7 checklist contract) | Mechanism for a working /devx post-init (CLI scaffold path + skills installer + Claude Code discovery assumption) plus the live-timing contract pinned: E-7 checklist steps map 1:1 to G-3/FR-7 thresholds, human-timed. Step-by-step shape correctly deferred to plan stage. |
| G-2 | ✅ | design.md §Design/Architecture 1, §Risks (E-1, E-2) | skills/ in package.json files + npm pack manifest assertion (E-1) covers 3/3 shipping; test/skills-sync.test.ts fails on divergence in either direction, naming the file, wired into the suite — the 0-silent-divergence mechanism is concrete. |
| G-3 | ✅ | design.md §Migration plan (live S-5 components) | Symptom→merged-fix and devx loop --max-items 1 are live-validation items by nature; design pins the contract (each E-7 checklist step maps to one G-3/FR-7 threshold) rather than a mechanism, which is the right altitude for a human-run goal. Was the prior CONCERNS gap; now explicitly carved into the migration plan. |
| G-4 | ✅ | design.md §Migration plan, §Risks (E-6) | Docs cut over in the same PR that ships the flow; zero-phantom-paths gated by the E-6 docs-accuracy eval from that point on. |
| UC-1 | ✅ | design.md §Design/Architecture 4, §Interfaces | install:global = build + npm i -g .; build writes dist/build-info.json from git rev-parse; version string composed at runtime as <semver>+<sha> (E-5 asserts actual --version output as a subprocess smoke). PATH placement rides on npm i -g semantics — not separately verified in design, but standard mechanism. |
| UC-2 | ✅ | design.md §Design/Architecture 2-3, §Assumptions, §Risks (E-3) | Non-interactive AnswerProvider over runInit() + skills installer; e2e fixture scenario asserts the full artifact set including skills; '/devx working immediately' rests on the stated Claude Code command-discovery assumption, re-verified by the S-5 live run. |
| UC-3 | ✅ | design.md §Design/Architecture 2, §Wrap don't duplicate, §Risks (E-4) | runInitUpgrade() + compareSemver() reuse for idempotent re-init; header-detection rule (headerless = user-owned = skip + MANUAL.md entry) prevents clobbering; proven by E-4. |
| UC-4 | ✅ | design.md §Design/Architecture 1, §Trade-offs | Bidirectional drift check in npm test names the divergent file; copies-not-symlinks decision means divergence is detectable rather than impossible, but the guard matches CAP-5's 'wired into npm test' bar exactly. |
| CAP-1 | ✅ | design.md §Design/Architecture 1, §Data, §Resolved design questions | skills/ is git-tracked package content in package.json files, and installers resolve/copy from it. Nuance: design makes .claude/commands/ canonical for *editing* while skills/ stays the canonical *source installers copy from* — consistent with CAP-1's wording, decision recorded. |
| CAP-2 | ✅ | design.md §Design/Architecture 3, §Wrap don't duplicate, §Constraints | Bare devx init runs the existing runInit() orchestrator (file:line-cited) via a defaults AnswerProvider through the existing scriptedAsk() seam; /devx-init interview flow explicitly unchanged over the same modules. |
| CAP-3 | ✅ | design.md §Design/Architecture 2, §Interfaces | init-skills.ts installs to <repo>/.claude/commands/ by default with the version-stamped header, ~/.claude/commands/ via --global; both consumers named. |
| CAP-4 | ✅ | design.md §Design/Architecture 4, §Data | All three provenance surfaces (--version, scaffolded devx_version stamp, skill file header) explicitly consume the same runtime-resolved <semver>+<sha> string from dist/build-info.json; dev runs without build-info degrade to plain semver. |
| CAP-5 | ✅ | design.md §Design/Architecture 1, §Overview | test/skills-sync.test.ts runs in the suite (npm test), fails on any content divergence either direction, naming the file; refresh path is npm run sync:skills. |
| FR-1 | ✅ | design.md §Design/Architecture 1, §Risks (E-1) | Top-level skills/ with all three named files, listed in package.json files; E-1 asserts the actual npm pack manifest (subprocess smoke per cli301 lesson). |
| FR-2 | ✅ | design.md §Resolved design questions, §Trade-offs, §Constraints, §Migration plan | Design takes FR-2's sanctioned copy fallback with a real rationale (npm pack drops symlinks; symlink would route ungated skills/ edits into harness behavior); bidirectional drift test enforces lockstep; the .claude/ edit is flagged user-foreground in Constraints and Migration plan. |
| FR-3 | ✅ | design.md §Design/Architecture 3, §Trade-offs, §Constraints | Stack detection now concrete: existing detectStack() at src/lib/init-state.ts:248 with the full marker-file table, exposed via detectedStack/detectedStackFile (init-state.ts:101) — the amendment closing the prior CONCERNS hand-wave. Conservative defaults + INTERVIEW.md seeding (no-silent-decisions), fresh/upgrade idempotency via init-upgrade, --resume-gh unchanged. |
| FR-4 | ✅ | design.md §Design/Architecture 2, §Interfaces, §Constraints, §Data | Pure decision fn (existing-file state × header presence × version) → write \| overwrite \| skip-user-owned covers all three FR-4 rules; skip files MANUAL.md via existing append path; --global target and the ungated-outside-this-repo distinction both stated; header format matches FR-4 exactly. |
| FR-5 | ✅ | design.md §Design/Architecture 4, §Interfaces, §Discarded considerations | install:global = build (SHA embed via build-info.json) + npm i -g .; the npm link hazard (links HEAD live, loop semantics change mid-hack) is in Discarded considerations with INSTALL.md warning as the mitigation. |
| FR-6 | ✅ | design.md §Migration plan, §Wrap don't duplicate (Adds), §Risks (E-6) | Docs ship in the same PR as the flow, gated by E-6; the work-repo caveat is now pinned with actual content (BETA/PROD mode, never YOLO auto-merge, org policy = operator's call per Q#11) and scoped as caveat-text-in / rollout-out — the amendment closing the prior CONCERNS gap. SETUP.md rewrite itself is mechanism-light, appropriate for a docs FR. |
| FR-7 | ✅ | design.md §Wrap don't duplicate, §Risks (E-3), §Migration plan (E-7 contract) | Scripted: reuses the ini508 e2e fixture harness (test/init-e2e.test.ts) with a fresh-repo scenario asserting the full artifact set incl. skills. Live: E-7 checklist contract pinned (step↔threshold mapping) including a concrete out-of-repo write audit mechanism (find ~/.claude ~/.devx <repo> -newer <stamp>). Step sequencing correctly deferred to the plan stage. |

## Extras requiring product approval

- --skip-skills escape-hatch flag on devx init (no PRD ID requires it) — design.md §Interfaces
- Per-artifact outcome lines + JSON summary output contract for devx init (house CLI style; beyond PRD scope) — design.md §Interfaces
- Unresolved question: repo-level vs user-level /devx command precedence when both installed — flagged as non-blocking (no P0 depends on --global), resolves during E-7 live run — design.md §Unresolved design questions

## Verdict detail

PASS — every source ID is ✅ covered.
