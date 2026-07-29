---
hash: b931a1
type: dev
created: 2026-07-29T10:15:00-06:00
title: "`devx devx-helper finalize <hash>` — merge-tail primitive (scoped staging, lock release, clock-stamped line, dist rebuild)"
from: dev/dev-mlcret-2026-07-28T09:04-retro-multi-loop-concurrency.md
plan: plan/plan-20eb6f-2026-07-28T08:34-multi-loop-concurrency.md
status: ready
blocked_by: []
branch: feat/dev-b931a1
---

## Goal

Convert `/devx` Phase 8's after-merge bookkeeping tail from inline git prose
into a CLI primitive, closing the three defects mlcret found in it (E1, E2,
E3 + E5 in `LEARN.md § multi-loop-concurrency`).

The tail is the last major inline-git section of the `/devx` skill body, and
it is the section that runs **while peer sessions are live**. During
multi-loop-concurrency it failed three ways at once:

1. **Unscoped staging (E1).** mlc106's mark-done commit `ac0ccf2` used
   `git add -A` and swept in two files owned by the concurrently-live
   mss104 session. The rule it broke ("stage only files relevant to this
   item, never `git add -A`") is stated in *both* `CLAUDE.md` and
   `.claude/commands/devx.md` — prose duplication did not prevent it.
2. **No spec-lock release (E3).** The documented tail has no release step.
   Four of six mlc specs left a dead-owner lock on disk permanently
   (`spec-mlc101/103/104/106.lock`); mlc102 and mlc105 released theirs only
   because those authors thought of it. The loop driver releases; the
   interactive path never did. Nothing ever reaps a `done` spec's lock,
   since reaping only fires on a contending claim for the same hash.
3. **No rebuild of the self-hosted CLI (E2).** `devx` on PATH resolves to
   the main worktree's gitignored `dist/`, and a story's local-CI gate runs
   inside its *worktree*, so `npm test` refreshes the worktree's build and
   never main's. At mlcret time `devx loop --help | grep -c epic` returned
   `0` — mlc106's entire scope model was merged and unreachable from the
   CLI `/devx` itself invokes. The same lag split spec-lock body formats on
   disk (mlc104 wrote a legacy lock 36 min after the JSON format merged).

Plus one cheap rider: the tail already writes the merge status-log line, so
it should **stamp it from the clock** rather than from narrative (E5 —
mlc106's log compressed a ~15h overnight gap into 25 minutes and silently
switched timezone).

## Acceptance criteria

- [ ] `devx devx-helper finalize <hash>` exists as a pure-decision +
      impure-driver pair per the Cross-epic "pure-fn + CLI-passthrough"
      pattern, and performs the tail in fixed order with per-stage failure
      reporting.
- [ ] **Scoped staging**: it stages exactly the paths it owns — the spec
      file for `<hash>` and the backlog file whose row it flips — and never
      `git add -A` / `git add .`. A test proves that an unrelated dirty file
      belonging to a simulated peer session is NOT staged or committed.
- [ ] **Spec-lock release**: releases `spec-<hash>.lock` under the backlog
      lock using mlc103's guarded release (never unlinks a lock a peer has
      since re-acquired). A test covers the re-claimed-by-peer case.
- [ ] **Clock-stamped merge line, appended in the right section**: the
      status-log line's timestamp comes from the system clock in the repo's
      local-offset format used by every other line, not from a
      caller-supplied string — and it is inserted **under `## Status log`**,
      not at EOF. A test covers a spec whose `## Links` section follows the
      status log. (mss103 appended after `## Links` on 2026-07-29; the
      dvx103 discipline test bounds its scan to the `## Status log` section,
      so main went red for every PR branched off it and mlc106 burned an
      investigation cycle on an inherited red — repaired in `fb7561f`.)
- [ ] **dist freshness**: after a successful merge the primitive refreshes
      the main worktree's build (or emits an explicit, actionable warning
      when it cannot), so the next `/devx` claim runs on post-merge code.
      Additionally `devx` warns when its own build is older than `HEAD`.
- [ ] `.claude/commands/devx.md` + `skills/devx.md` Phase 8 after-merge
      steps are rewritten to invoke the primitive instead of enumerating git
      commands; the mirror pair stays byte-identical.
- [ ] Full suite green; the existing leaked locks are out of scope here
      (offline sweep belongs to `dev-db36af` / `devx doctor`).

## Scope note — do not duplicate the in-flight prose corrective

A concurrent `/devx-learn` session (mssret-adjacent, uncommitted on main at
the time this spec was filed, 2026-07-29) added the **prose + test** half of
defect 1: an explicit-pathspec staging rule in Phase 8 of both skill-body
copies, plus `test/devx-skill-phase8-discipline.test.ts` assertions pinning
the `never git add -A` sentence in **both** Phase 6 and Phase 8. Their note
records the sweep as having occurred twice, not once.

Before starting: check whether that work has landed. If it has, **keep it** —
do not revert or re-litigate the prose. This spec's contribution to defect 1
is the structural half (a primitive that cannot be called with the wrong
pathspec, making the prose rule advisory rather than load-bearing), and its
unique value is defects 2, 3 and the clock-stamp rider, which their change
does not touch. Update the Phase 8 prose to invoke the primitive while
preserving their pinned sentences, and extend rather than replace their
discipline assertions.

## Technical notes

- Filed by `mlcret` (retro of workstream multi-loop-concurrency,
  `_devx/workstreams/multi-loop-concurrency/RETRO-2026-07-29.md`).
- Directly reinforces `LEARN.md § Cross-epic patterns` → "Externalize
  behavior-as-CLI-primitive consumed via skill-body passthrough" (5th epic)
  and "First real run against the live repo" (extended: the run must
  exercise the *installed* artifact).
- Coordinate with `dev-db36af` (`devx doctor`): this spec stops NEW lock
  debris; db36af sweeps what already accumulated. Don't duplicate the
  classifier — reuse `classifySpecLock` from mlc103.
- The dist-rebuild step is the one part with real blast radius (it mutates
  the main worktree during a tail that may run while peers are live) —
  prefer a build into a temp dir + atomic swap, or gate it behind a config
  knob if that proves racy.

## Status log

- 2026-07-29T10:15 — created by mlcret (retro finding E1/E2/E3/E5).

## Links

- Retro: `_devx/workstreams/multi-loop-concurrency/RETRO-2026-07-29.md`
- LEARN rows: `LEARN.md § multi-loop-concurrency` E1, E2, E3, E5
- Related: `dev-db36af` (`devx doctor` — offline reconciliation sweep)
