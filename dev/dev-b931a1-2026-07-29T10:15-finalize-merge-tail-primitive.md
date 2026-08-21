---
hash: b931a1
type: dev
created: 2026-07-29T10:15:00-06:00
title: "`devx devx-helper finalize <hash>` — merge-tail primitive (scoped staging, lock release, clock-stamped line, dist rebuild)"
from: dev/dev-mlcret-2026-07-28T09:04-retro-multi-loop-concurrency.md
plan: plan/plan-20eb6f-2026-07-28T08:34-multi-loop-concurrency.md
status: in-progress
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
      lock — by **consuming `dev-ee7049`'s `devx devx-helper release-lock`**
      (or `releaseSpecLockGuarded` directly if ee7049 has not landed), never
      by writing a third release path. Never unlinks a lock a peer has since
      re-acquired; a test covers the re-claimed-by-peer case.
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

## Scope note — two neighbouring changes already landed; do not redo them

**1. PR #102 (`8bd514e`, merged 2026-07-29) already shipped the prose+test
half of defect 1.** An explicit-pathspec staging rule now sits in Phase 8 of
both skill-body copies, `test/devx-skill-phase8-discipline.test.ts` pins the
`never git add -A` sentence in **both** Phase 6 and Phase 8, the after-merge
list's numbering was repaired (it was 1,2,3,4,5,7,8,9 with a commit step
citing a nonexistent range `(4-6)`), and the missing workstream `todo sync`
step was added. **Keep all of it.** This spec's contribution to defect 1 is
the structural half — a primitive that cannot be called with the wrong
pathspec, demoting the prose rule from load-bearing to advisory. Rewrite the
Phase 8 prose to invoke the primitive while *preserving* their pinned
sentences, and **extend** their discipline assertions rather than replacing
them.

**2. `dev-ee7049` owns the release CLI.** Filed independently from the
mss104 gap sweep (`78a10b6`), it ships `devx devx-helper release-lock
<hash> --session-token <token>` wrapping `releaseSpecLockGuarded` for Phase
9's raw-`rm` handoff path. Consume it here; do not write a second release
path. If ee7049 has not landed when this starts, call
`releaseSpecLockGuarded` directly and leave the CLI to ee7049.

The three specs partition cleanly: ee7049 wraps the release path that goes
*around* the guarded primitive; this spec adds release to the path that has
*none*; `db36af` (`devx doctor`) sweeps locks that already leaked.

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
- 2026-08-06T10:03 — sgrret cross-reference: sgr105 (PR #118) shipped `devx devx-helper mark-done` — the structural half of defect 1 (bookkeeping flips under the backlog lock + explicit-pathspec return, Phase 8 after-merge prose rewritten to invoke it) plus the status-log splice extraction this spec's status-log AC describes. Before starting, re-cut this spec's ACs against what landed: remaining scope is spec-lock release (consume ee7049), the clock-stamped merge line, and the dist-freshness step — do not re-implement the flips or the staging rule. See `LEARN.md § epic-story-graph` E10.
- 2026-08-21T12:05 — claimed and executed interactively (harness sweep). Scope
  decision, recorded because it overrides the 2026-08-12 re-cut in `DEV.md`:
  that re-cut said "remaining scope: E2 only" and moved the spec-lock release
  to `db36af`. I built the **full `finalize` wrapper** anyway — pull,
  mark-done, scoped commit, push, lock release, worktree+branch, rebuild —
  because the thing the spec's Goal actually asks for is "the last major
  inline-git section of the skill body stops being prose", and E2 alone
  leaves five inline git commands in Phase 8. On the release specifically:
  finalize calls `releaseSpecLockGuarded` directly, which this spec's own AC 3
  explicitly permits when `ee7049` has not landed (it hasn't; it was absorbed
  into `db36af`). When `db36af` moves the release inside `mark-done`, this
  stage degrades to a no-op that reports "no lock on disk" — no code change
  needed, and no third release path was written.
- 2026-08-21T12:40 — phase 4: 3-agent parallel adversarial review (Blind
  Hunter + Edge Case Hunter + Acceptance Auditor; ~1,400-line surface,
  marker-bearing, well above the 500-line threshold). ~24 unique actionable
  findings; ALL fixed in-place, re-reviewed by re-running the suite. All
  three reviewers independently found the same HIGH: `finalize` re-derived
  the session token from its own process, which can NEVER equal the token the
  earlier `claim` process wrote into the lock — so the guarded release always
  returned `not-owner`, that was reported as "a peer re-claimed the hash"
  (a peer that did not exist), exit stayed 0, and the lock leaked. E3 was
  being reported green while remaining entirely open. Fixed by making
  `devx devx-helper claim` RETURN `sessionToken` (the only legitimate source
  — the spec's `owner:` and the lock body are both forbidden because a token
  read from the thing it guards always matches), threading it through the
  skill body, and making finalize fail loudly rather than invent one.
  Other load-bearing fixes: stage 7 ran `npm run build:swap` unconditionally,
  which would have made every merge in every CONSUMER repo exit 3 (`skills/`
  ships in the tarball) — now a skip via a `build:swap`-declared probe; the
  branch to delete was hardcoded `feat/<type>-<hash>` instead of
  `deriveBranch`, silently missing the real branch on a split-branch project;
  nothing verified the merge sha was an ancestor before a FORCE `git branch
  -D`; the staleness predicate compared reflog mtime and so fired on `/devx`'s
  own claim commit (now sha-vs-sha); `swap-dist.mjs` had no lock and two
  concurrent swaps could leave the repo with no `dist/` at all; and the
  worktree/release stages were ordered so a refused worktree removal left the
  spec done, unlocked and re-claimable.


## Links

- Retro: `_devx/workstreams/multi-loop-concurrency/RETRO-2026-07-29.md`
- LEARN rows: `LEARN.md § multi-loop-concurrency` E1, E2, E3, E5
- Related: `dev-db36af` (`devx doctor` — offline reconciliation sweep)
