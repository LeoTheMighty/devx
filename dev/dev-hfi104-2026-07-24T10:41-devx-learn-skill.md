---
hash: hfi104
type: dev
created: 2026-07-24T10:41:50-06:00
title: /devx-learn skill + slug helper
from: plan/plan-eac479-2026-07-24T09:57-harness-fold-in.md
plan: _devx/workstreams/harness-fold-in
status: in-progress
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
