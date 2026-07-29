# Plan critique — 2026-07-29 (lenses: pm, architect, dev, qa)

Thoroughness is send-it, but the plan touches ≥2 stack layers (TS CLI,
config schema, skill prose, Claude settings, init distribution), so the
critique ran. Four parallel lens subagents, grounding rule enforced
(file-citing claims grep-verified). 20 findings raised; accepted and
applied:

- **pm/MED** Detection stayed dark until Phase 5 → this repo's
  `.claude/settings.json` activation moved into Phase 1 (T1.8): queue is
  durable, G-1's dataset starts collecting; Stop-hook non-2 exits are
  non-blocking so early activation is safe.
- **pm+qa/MED** E-7 latency measurement had no owning phase → added to
  Phase 1 success criteria (run eval post-build, record p95 in status log).
- **pm/MED** Last-hop habit had no day-one owner → T5.4 now files a
  MANUAL.md watcher-habit entry noting the deferred pending-count
  surfacing follow-up.
- **pm/LOW + qa** `list` output untested → Phase 4 case added.
- **architect/MED** Drain loop placement contradicted design + `runLoop`
  precedent → moved into `src/lib/learn/watch.ts`; command is thin wiring.
- **architect/MED** `removeFromQueue` keyed by sid couldn't retire sid-less
  malformed entries → entry identity (index/raw-line) specified in T1.2.
- **architect+qa/LOW-HIGH** E-2/E-3 artifacts named one suite while cases
  span two → both suites listed in expectations.md Verified-by + coverage
  table (E-2 is P0 — artifact honesty).
- **architect+dev/LOW** Design named `BacklogLockTimeoutError`; the
  path-lock family rethrows `PathLockHeldError` on deadline → design +
  plan corrected.
- **dev/HIGH** `canPrompt` foreground-group test not implementable in Node
  stdlib (no `getpgrp`/`tcgetpgrp`) → mechanism pinned: `isatty` AND
  `ps -o stat=` trailing `+`, injectable seam, re-checked at prompt time.
- **dev/MED** `test/help.test.ts` inline snapshot pins the top-level
  command listing → added to Phase 4 files.
- **dev/MED** `ts` format/undatable predicate unpinned (lenient
  `Date.parse` would give hand-edited date-only strings a fresh idle
  window, diverging from upstream strptime) → `toISOString()` write +
  strict-regex parse specified, date-only case pinned by test.
- **dev/LOW** osascript escaping unspecified → reference escaping ported +
  escape test added (T4.2/T4.5).
- **qa/HIGH** `manual` arm untested (upstream's 6h queue-hold bug) → Phase
  4 case: filed immediately, `awaitMarker` never entered; E-4 expectation
  extended to name the `manual` behavior.
- **qa/MED** skip-don't-starve + canPrompt-recheck untested → Phase 3
  cases added.
- **qa/MED** Hermeticity: real `git rev-parse` + wall-clock polls in tests
  → exec seam with memo reset for `repoKey`; injectable poll intervals.

Rejected: none. Cascade: expectations.md was touched (E-2/E-3/E-4), so
`devx revise 620c74 --touched expectations.md` replays prd → design →
plan gates.
