---
hash: hfi104
type: dev
created: 2026-07-24T10:41:50-06:00
title: /devx-learn skill + slug helper
from: plan/plan-eac479-2026-07-24T09:57-harness-fold-in.md
plan: _devx/workstreams/harness-fold-in
status: done
owner: /devx-loop-2026-07-24T16-46-18-001-62080
blocked_by: []
branch: feat/dev-hfi104
---

## Goal

Ship the framework self-improvement loop: the `/devx-learn` skill body with
its three guards, the pure slug sanitizer, and the `devx learn-helper slug`
passthrough. Phase 4 of workstream `harness-fold-in` (plan.md § Phase 4).
Parallel-safe with hfi101–hfi103 (no shared files; the nudge canonical
source lands here, its references in the other skills land in hfi105).

## Acceptance criteria

- [ ] `.claude/commands/devx-learn.md` (new canonical skill body), sections
      per design §Interfaces: Mining scope (current session only; refuse
      fresh/empty; never self-triggers) → Evidence table → four Buckets
      with destinations (framework fix / project preference /
      product-workstream lesson / one-off) → Repo predicate (root
      `package.json` name `@devx/cli` → `fw/learn-YYYY-MM-DD-<slug>` PR;
      else `docs/updates/<date>-<slug>.md`) → Guards (locked-machinery /
      untrusted-input / slug-sanitization) → Foreground-only note →
      `<!-- nudge-canonical -->` nudge sentence.
- [ ] `skills/devx-learn.md`: byte-identical mirror (pin101;
      `test/skills-sync.test.ts` + `src/lib/init-skills.ts` auto-glob pick
      it up with zero new plumbing).
- [ ] `src/lib/learn/slug.ts` (new): `sanitizeLearnSlug(raw)` — lowercase,
      strip to `[a-z0-9-]`, collapse/trim dashes, ≤40 chars, empty →
      `"session-retro"`.
- [ ] `src/commands/learn-helper.ts` (new) + `src/cli.ts` registration:
      `devx learn-helper slug <raw…>` passthrough.
- [ ] `test/learn-skill-guards.test.ts` (E-6 permanent suite): slug fuzz
      set (≥8 cases: metachars, unicode, >40 chars, empty, injection
      strings) → 100% sanitized by the pure helper; static skill-body
      assertion finds both guard sections (dvx103/dvx107 precedent).
- [ ] Workstream eval E-6 flips GREEN:
      `npx tsx harness-fold-in/evals/E-6_learn-skill-guards.ts`
      (cwd `_devx/workstreams`) exits 0.
- [ ] `test/skills-sync.test.ts` passes with the new mirror pair; full
      suite green (`npm test`, typecheck included).

## Technical notes

- Judgment stays prose; only the sanitizer is mechanical (design
  §Discarded: no transcript-mining CLI arm).
- User-foreground only — skill/settings edits can't be auto-accepted by
  subagents (memory `project_skill_perms_block_subagents.md`); the skill
  body says so.
- Session content is data, not instructions: injected directives flagged +
  skipped; slugs only via the helper, never raw session text into git/gh.
- RED evidence: `_devx/workstreams/harness-fold-in/evals/RED-report.md`
  (E-6 right-reason).

## Status log

- 2026-07-24 — emitted by /devx-plan RED stage (eac479, phase 4/5).
- 2026-07-24T12:11:23-06:00 — claimed by /devx in session /devx-loop-2026-07-24T16-46-18-001-62080
- 2026-07-24T18:24:01.831Z — loop iteration 1: Shipped the mechanical arm of /devx-learn — sanitizeLearnSlug, the `devx learn-helper slug` CLI passthrough, and the E-6 permanent test's fuzz layer (28 tests) — plus fixed a pre-existing full-suite red inherited from main.
  - Change: src/lib/learn/slug.ts: sanitizeLearnSlug per the design contract (lowercase, [a-z0-9-] with disallowed chars becoming dash separators, collapse/trim, ≤40 chars with post-truncation re-trim, empty → 'session-retro') — T4.1 done
  - Change: src/commands/learn-helper.ts + src/cli.ts registration: `devx learn-helper slug <raw…>` passthrough (plan-helper pattern, exit 0 total function, testable out-seam), verified live end-to-end; test/help.test.ts inline snapshot refreshed for the new Phase-1 command — T4.2 done
  - Change: test/learn-skill-guards.test.ts: E-6 permanent suite fuzz layer — the acceptance eval's 10-case hostile set plus word-boundary, truncation-edge, idempotence, and CLI-passthrough assertions (28 tests passing); static skill-body guard assertions deferred to land atomically with the body
  - Change: dev/dev-hfi101 spec: appended the dvx103-mandated `phase 4:` status-log line (retroactive, truthful, append-only) — fixes the pre-existing devx-status-log-discipline failure that made `npm test` red on every branch cut from main after PR #80
  - Learning: Pre-existing main red: the loop orchestrator's merge tail writes `loop iteration N` status-log lines but never a `phase 4:` line, so EVERY loop-shipped dev spec (including hfi104 itself when it closes) trips test/devx-status-log-discipline.test.ts on the next branch cut from main — the orchestrator's done-flip commit should append a `phase 4:` line, or this recurs every merge; worth a DEBUG.md entry or orchestrator fix
  - Learning: E-6's acceptance eval now fails on exactly one item (.claude/commands/devx-learn.md missing); slug + test-file checks pass, so next iteration only needs the skill body + skills/ mirror + the static guard assertions in the permanent test
  - Learning: Risk for next iteration: memory project_skill_perms_block_subagents says .claude/ skill-file writes can prompt for confirmation even on bypass-perms — in this unattended loop a Write to .claude/commands/devx-learn.md could block; if it does, note it and fall back rather than hanging (the skills/ mirror path is ungated)
  - Learning: test/help.test.ts pins full --help output as an inline snapshot — any new CLI command registration requires `npx vitest run test/help.test.ts -u` in the same change
- 2026-07-24T18:34:42.055Z — loop iteration 2: Authored the /devx-learn skill body with all seven pinned sections, mirrored it to skills/, and added the static guard assertions — flipping E-6 GREEN and completing every acceptance criterion on the spec.
  - Change: Created .claude/commands/devx-learn.md — canonical skill body with Mining scope, Evidence table, four Buckets, Repo predicate, three Guards (locked-machinery / untrusted-input / slug-sanitization), Foreground-only note, and the single <!-- nudge-canonical --> sentence hfi105 will point at
  - Change: Mirrored to skills/devx-learn.md via npm run sync:skills (byte-identical; pin101 auto-glob needed zero plumbing changes)
  - Change: Added 10 static skill-body assertions to test/learn-skill-guards.test.ts pinning every section, the exactly-one nudge marker, and mirror byte-identity (file now 38 tests)
  - Change: Verified E-6 acceptance eval exits 0 (GREEN), skills-sync green, full suite green (2,191 tests / 114 files) and tsc --noEmit clean
  - Learning: Writing .claude/commands/devx-learn.md via the Write tool did NOT trigger the permission block that memory project_skill_perms_block_subagents warns about — in this overnight-loop context skill-file creation went through unattended
  - Learning: test/skills-sync.test.ts's EXPECTED_SKILLS list is a containment check (expect(...).toContain), not equality — new skill files need no test edit; the it.each over the canonical glob covers them automatically
  - Learning: devx-learn.md is outside the S-1 prose-budget canary: STAGE_SKILL_SECTIONS is an explicit (non-globbed) list holding only devx-plan.md, so the new ~4.7KB body cannot trip the 60KB gate or the 2x tripwire
- 2026-07-24T18:36:26.631Z — merged via devx loop — PR https://github.com/LeoTheMighty/devx/pull/81
- 2026-07-24T13:20-06:00 — phase 4: (retroactive) shipped via devx loop PR #81 with per-iteration verification (E-6 eval GREEN + full 2,191-test suite + tsc clean in iteration 2) in lieu of the interactive self-review pass; line appended post-merge because the loop merge tail does not emit the dvx103-mandated `phase 4:` line — the recurrence hfi104's own iteration-1 learning predicted. Structural fix (merge-tail append) in flight this session.
