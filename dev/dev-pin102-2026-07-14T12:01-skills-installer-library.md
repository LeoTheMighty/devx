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
