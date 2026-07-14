---
hash: pin102
type: dev
created: 2026-07-14T12:01:00-07:00
title: Skills installer library (init-skills.ts pure decision fn + atomic applier)
from: plan/plan-b3f7a1-2026-07-14T10:40-portability-install.md
plan: _devx/workstreams/portability-install
status: in-progress
owner: /devx-2026-07-14T1136-53237
blocked_by: [pin101]
branch: feat/dev-pin102
---

## Goal

`src/lib/init-skills.ts`: the library that installs packaged skills into a
target `.claude/commands/` (or `~/.claude/commands/`) with ownership rules
and version headers. Library-only phase (pure-fn + CLI-passthrough pattern,
library variant); the consumer lands in pin103. Phase 2 of workstream
`portability-install` (plan.md § Phase 2).

## Acceptance criteria

- [ ] Pure decision fn: (existing-file state × `devx-skill` header presence
      × version) → `write | overwrite | skip-user-owned`, truth-table
      tested: absent→write; header+older→overwrite; header+same→no-op;
      headerless→skip-user-owned; `force` override documented.
- [ ] `installSkills({targetDir, version, force?}): SkillInstallOutcome[]`
      applier: resolves the packaged `skills/` dir relative to the
      installed module (same technique as init-write's templatesRoot,
      src/lib/init-write.ts:117), writes via the atomic tmp+rename
      primitive (reuse `writeAtomic`, src/lib/supervisor-internal.ts —
      wrap-don't-duplicate), stamps header
      `<!-- devx-skill v<version> -->` as line 1, returns per-file
      outcomes.
- [ ] `skip-user-owned` files a MANUAL.md entry via the existing MANUAL
      append path — never aborts (MANUAL-as-designed-signal cross-epic
      pattern).
- [ ] `test/init-skills.test.ts`: truth table + applier fs tests in tmp
      dirs incl. no tmp droppings on injected write failure.
- [ ] Full suite green.

## Technical notes

- Header version string comes from the same resolved version surface
  pin104 later upgrades to `<semver>+<sha>` — take plain semver for now;
  no coupling.
- No CLI registration in this story (pin103 consumes).

## Status log

- 2026-07-14T12:01 — emitted by /devx-plan RED stage (b3f7a1, phase 2/5).
- 2026-07-14T11:36:30-06:00 — claimed by /devx in session /devx-2026-07-14T1136-53237
- 2026-07-14T11:39 — phase 2: spec ACs direct (v2 native); 5 ACs; workstream=portability-install; red-artifacts=none (phase 2 has no evals/ artifact — test/init-skills.test.ts authored red-first per plan § Phase 2 verification; watched fail before implementation).
- 2026-07-14T11:41 — phase 3: implemented src/lib/init-skills.ts (parseSkillHeader + decideSkillInstall pure fn + installSkills applier) reusing writeAtomic (supervisor-internal) + appendManualEntry (init-failure, newly exported); 22 tests green. Documented convergence rule: header + ANY version mismatch (incl. newer) → overwrite — header is an ownership marker, not a precedence record.
- 2026-07-14T11:49 — phase 4: 3-agent parallel adversarial review (Blind Hunter + Edge Case Hunter + Acceptance Auditor; marker-bearing surface); 12 unique findings (0 HIGH, 3 MED, 9 LOW/INFO); ALL fixed in-place — most load-bearing: CRLF/BOM/trailing-ws on the header line misclassified machine-owned files as user-owned, permanently wedging upgrades (parseSkillHeader now strips both); also replaced the vacuous injected-failure test (threw at readFileSync, never reached writeAtomic) with real EACCES + rename-failure injections, keyed MANUAL idempotency on resolved targetPath not basename, non-file targets → skip-user-owned instead of EISDIR crash, version validated up front. 22 → 35 tests. Re-review of fixed hunks clean.
- 2026-07-14T12:03 — phase 5: local CI green — full npm test 2095/2095 (schema smoke + config-io + config-validate + build + typecheck + vitest). One env repair: diff2html was missing from node_modules (pre-existing, failed identically on main; npm install fixed; no code change). Coverage: informational under YOLO.
