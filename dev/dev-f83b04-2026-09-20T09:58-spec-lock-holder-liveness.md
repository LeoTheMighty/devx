---
hash: f83b04
type: dev
created: 2026-09-20T09:58:00-06:00
title: "Spec-lock liveness: record the holder, not the CLI that wrote the file"
from: null
spawned: []
status: ready
owner: null
branch: null
---

## Goal

Every spec lock written by an **interactive** claim is born dead. The lock
body's `pid` is `process.pid` of the `devx devx-helper claim` process
(`src/lib/devx/spec-lock.ts:82`, reached from `src/lib/devx/claim.ts:818`
with no `pid` override), and that process exits as soon as the claim
returns. The holder that actually owns the work — the Claude session or
`/devx` run — is never recorded. `classifySpecLock` therefore returns
`dead` for a perfectly healthy claim seconds after it is made.

The `session` token does not rescue this: `defaultSessionId()`
(`src/commands/devx-helper.ts:319-326`) is `<stamp>-${process.pid}` — the
same dying pid, stringified. Nothing in the body resolves to a live
process.

Field evidence (2026-09-20, `~/personal/palateful`, reported by the
coordinator session): all 17 locks in `.devx-cache/locks/` classify
`dead`, including `spec-rsh102.lock` claimed 20 minutes earlier by a
session that is actively working in `.worktrees/dev-rsh102`. Its body:

```json
{"schema":1,"pid":67490,"pid_started_at":"2026-09-20T15:54:04.394Z",
 "session":"2026-09-20T0954-67490","claimed_at":"2026-09-20T09:54:04-06:00"}
```

`ps -p 67490` → no such process. `pid_started_at` does not help; it exists
to catch PID *recycling*, and this pid is simply absent.

### What this is NOT (read before sizing the fix)

This is **not** an open double-claim hole, and the fix must not be
justified as closing one. `acquireSpecLock`'s `allowReap` gate
(`spec-lock.ts:325-338`, `claim.ts:826-834`) already refuses to reap a
reapable-classified lock unless the DEV.md row is `[ ]` ready — a live
peer's row is `[/]`, `flipDevMdRow` throws, and the contending claim exits
1 exactly as it did pre-mlc103. The behavior was reasoned about
deliberately at mlc103 review BH-F1 and is documented in three places,
including `doctor/detect.ts:209-221`, where `stale-lock` deliberately
refuses to use dead-PID as its predicate for this reason.

So mutual exclusion currently rests on **one** layer (row readiness), with
the pid layer contributing nothing. That is the real defect, and it has
concrete consequences today:

1. **`devx doctor`'s `dead-owner` detector is pure noise**
   (`detect.ts:805-822`). It fires on every healthy in-progress
   interactive claim — 17/17 in the palateful sample. A genuine orphan
   (the July worktrees with uncommitted work) is indistinguishable from a
   session that claimed 30 seconds ago, so the finding cannot be acted on
   and the detector's whole purpose is destroyed.
2. **The 2h stale-live-lock WARN never fires.** Both call sites
   (`next/gather.ts:753`, `loop/driver.ts:467`) are guarded by
   `cls.kind === "live"`, which an interactive claim never reaches. A
   genuinely wedged 12-hour claim raises nothing, anywhere.
3. **Pick-time masking is defeated** (`driver.ts:455-482`). A ready row
   whose lock a peer just took is supposed to mask out of loop picks
   until the backlog flip is observable; classified `dead` it stays
   pickable, and the loop burns a claim attempt on a guaranteed
   `LockHeldError`. Narrow (both sides run under the mlc102 backlog lock)
   but the layer is inert.
4. **The documented residual becomes reachable in practice.**
   `claim.ts:813-817` accepts that an operator who resets an in-progress
   row to ready re-opens it to a second claim. With `dead` universal,
   that is the *only* thing standing between a reset row and a
   double-claim — no second signal exists to catch the mistake.

The asymmetry is the crux: `driver.ts:831` calls `claimSpec` **in-process**
from the long-lived loop, where `process.pid` is genuinely correct. The
CLI path is short-lived, where it is meaningless. Nothing in the body says
which kind of holder wrote it, so a classifier cannot tell "dead because
the CLI exited normally" from "dead because the loop crashed" — and must
therefore treat both conservatively, which is what makes `dead`
worthless.

## Acceptance criteria

1. The lock body records **what kind of holder** it has, so the classifier
   can apply the right liveness rule instead of one rule that is correct
   for only one caller. Schema bump with the existing unknown-schema
   posture honored (`parseSpecLockBody` already degrades a future schema
   to unknown-pid/held — verify that path still works against the new
   body from an old binary).
2. A loop-driver claim keeps pid liveness — its pid is the loop process
   and is genuinely meaningful. No regression to the mlc103 reap/recycle
   behavior for that path.
3. An interactive claim classifies as something **other than `dead`** for
   as long as its holder is plausibly alive, and the chosen signal is
   documented with its failure modes. See Technical notes for the
   candidate shapes — this AC is a design decision, not a foregone
   implementation.
4. `devx doctor`'s `dead-owner` finding fires only on holders that are
   actually gone. Verified against a real corpus: a freshly-claimed
   in-progress item produces no finding; a genuine July orphan still
   does.
5. The 2h stale-live-lock WARN (`gather.ts:753`, `driver.ts:467`) becomes
   reachable for interactive claims, with a test that drives it.
6. Pick-time masking (`driver.ts:455`) masks a ready row whose lock was
   just taken by a live interactive peer.
7. `allowReap` row-readiness gating **stays** as defense-in-depth. Two
   independent layers, not one replaced by another. A test pins that a
   contending claim against a live peer's in-progress row still refuses
   even if the liveness signal were to say reapable.
8. Legacy (pre-mlc103) and schema-1 bodies still parse and classify under
   the existing conservative posture. No existing lock file on disk
   becomes reapable as a result of this change.
9. Migration is read-only: existing schema-1 bodies in the wild keep
   classifying at least as conservatively as they do today. **No lock
   files are reaped, rewritten, or cleaned up by this story** (see
   Constraints).
10. Full suite green; `npm run typecheck` clean.

## Technical notes

### Candidate shapes for AC 3 (pick one, justify it)

- **(a) Owner PID passed in.** `composeSpecLockBody` already accepts
  `opts.pid`; the `/devx` skill would pass the owning Claude session's
  pid via a new `--owner-pid` flag. Cleanest model, but needs a reliable
  way for a Bash tool call to learn its session's pid — `$PPID` is the
  harness's shell spawner, not the session. Harness-coupled and worth a
  timeboxed spike before committing to it.
- **(b) Heartbeat.** Liveness = lock mtime (or a sidecar) refreshed
  recently. Works uniformly for both holders and is harness-independent,
  but interactive `/devx` has no daemon to do the refreshing — it would
  have to be touched at each phase boundary, which makes "stale" and
  "dead" the same signal with a long fuse.
- **(c) Holder-kind + grace window.** Record `holder: "loop" |
  "interactive"`; loop keeps pid liveness, interactive gets an explicit
  never-pid-classified posture (held until a human or `devx doctor`
  resolves it, with age surfaced). Smallest change, keeps the
  conservative bias, but does not actually *detect* a dead interactive
  holder — it only stops lying about one.

(c) is the floor — it fixes consequences 1, 2 and 4 by making the
classification honest, without claiming detection it cannot deliver. (a)
is the ceiling. Do not ship (a) on an unverified assumption about the
harness; spike it first and fall back to (c) if the pid is not reliably
obtainable.

### Files

- `src/lib/devx/spec-lock.ts` — `composeSpecLockBody`,
  `parseSpecLockBody`, `classifySpecLock`, `SpecLockClassification`.
- `src/lib/devx/claim.ts:818` — the interactive compose call site.
- `src/lib/loop/driver.ts:831` — the in-process loop call site (correct
  today; must stay correct).
- `src/commands/devx-helper.ts:319` — `defaultSessionId()`; the session
  token's embedded pid is the same bug wearing a different hat.
- `src/lib/locks/classify.ts` — shared `defaultPidAlive` /
  `RECYCLING_GRACE_MS`.
- `src/lib/doctor/detect.ts:805` — `dead-owner`;
  `src/lib/next/gather.ts:747` + `src/lib/loop/driver.ts:456` — the
  liveness-gated consumers.
- `test/spec-lock.test.ts` (incl. the BH-F1 case at :311),
  `test/claim-contention.test.ts`, `test/loop-scope.test.ts`.

### Constraints (from the reporting coordinator session)

- **Do not mass-reap the existing dead locks.** Several are genuine July
  orphans holding real uncommitted work in `.worktrees/`. devx's own
  doctor note pins why: "whether to release depends on what the worktree
  holds, not on owner liveness (2026-08-12: two identical signatures
  needed opposite actions)". Fix the write path; cleanup is a separate
  call.
- **Do not run anything that mutates lock state in `~/personal/palateful`**
  — it has live locks from three working tabs.
- **Rebuild before trusting observed behavior.** The `devx` on PATH lags
  HEAD (`dev-b931a1` E2, still open). `npm run build` first.

## Status log

- 2026-09-20T09:58-06:00 — filed. Root cause verified in source at
  `d6585d7`, not reproduced at runtime (the PATH build is stale and the
  only live corpus is off-limits per Constraints). Reported by the
  coordinator session `leonidbelyi-41`; its stated impact ("a contending
  claim reaps a live worker's lock") was checked against `allowReap` and
  does **not** hold on the normal path — see §"What this is NOT". The
  defect is real but is degraded detection and a single-layer mutual
  exclusion, not an open double-claim.

## Links

- Reported by: coordinator session `leonidbelyi-41`, 2026-09-20. Two
  sibling bugs of the same class (stale bookkeeping; stranded PRs with no
  detector) filed in `~/personal/palateful`.
- `dev/dev-mlc103-2026-07-28T09:02-spec-lock-lifecycle.md` — the story
  that introduced the classifier and the `allowReap` gate (review BH-F1).
- `dev/dev-db36af-2026-07-25T08:55-devx-doctor-reconcile.md` — `devx
  doctor`, whose `dead-owner` detector this un-breaks.
- `_devx/workstreams/multi-loop-concurrency/design/agent.md` §Architecture
  4 — classification posture, E-3.
