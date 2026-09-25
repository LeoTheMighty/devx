---
hash: 47b842
type: plan
created: 2026-09-25T09:37:00-06:00
title: "Scope review: keep, shrink or scrap `devx loop` and the mobile companion now that an orchestrator exists"
from: null
status: ready
owner: null
branch: null
---

## Goal

Answer one question with evidence, not preference: **now that an orchestrator
dispatches work to live Claude Code tabs, what is the unattended `devx loop`
for, and is it worth what it costs?** Same question, separately, for the
mobile companion.

The decision is Leo's. This spec is the research, the options, and a
recommendation.

**Nothing here proposes deleting anything today.** Every option below is
reversible except the last one, and even that one is a git revert.

## Measured

All figures measured on `main` at `2de95bb`, 2026-09-25, by reading the tree
and `.devx-cache/loop/`. Anything I could not establish is marked
**undetermined** rather than estimated.

### Size

| Surface | Source lines | Test lines |
|---|---:|---:|
| `src/lib/loop/` (16 files) | 9,003 | ~9,666 |
| — of which `driver.ts` | 3,340 | — |
| `src/lib/manage/` | 2,942 | ~835 |
| `mobile/` (12 `.dart` files) | 469 | — |
| whole `src/` | 63,312 | 81,625 |

The loop is **14.2% of `src/`** and **~11.8% of the test suite**.
`driver.ts` alone is 5.3% of `src/` and is the largest module in the repo.

### Use

Nine runs exist on disk, 2026-07-15 through **2026-08-19**. Nothing since —
**37 days idle** as of today. Aggregate across all nine:

| | count |
|---|---:|
| items attempted | 32 |
| merged | 20 (62%) |
| abandoned | 6 |
| handed off | 3 |
| claim-failed | 2 |
| in progress at exit | 1 |

Run-level: five runs ended cleanly on "no eligible backlog items", one
"stopped by signal", one hit the item cap, one attempted nothing, and one
(2026-08-13) **aborted on the systemic-failure ladder** — 6 attempted, 0
merged. The best run (2026-08-19) shipped 9 of 10.

Note the 62% is *merged*, not *merged and correct*: `hfi102` was
loop-implemented to near-done, abandoned at the iteration budget and revived
interactively; `hfi103` wedged and shipped interactively. Both are recorded
in CLAUDE.md's own workstream history.

### Cost since the last run

30 of the 360 commits since 2026-07-26 (8.3%) touch `src/lib/loop` or its
tests. 18 debug specs mention `devx loop`; **all of them are closed** — there
is no open loop bug today. Two structural fixes the loop's own runs forced
(PR #82 merge-tail contract, PR #84 infra-error classification) are recorded
in CLAUDE.md.

So the maintenance is real but not bleeding: the subsystem is quiet, tested,
and currently unused.

### What actually depends on it

Only two consumers outside `src/lib/loop/` and `src/commands/loop.ts`:

- `src/commands/status.ts` — imports `heartbeatIntervalMsFrom`,
  `listLiveInstances`, to render live loop instances.
- `src/lib/next/gather.ts` — imports from `loop/instances.js`, and reads
  `.devx-cache/loop/state.json` to warn about debris.

Both are *reporting on the loop*, not using it. `src/lib/learn/`'s two hits
are comments citing the loop as a precedent. Everything the loop shares with
interactive `/devx` lives outside it and survives its removal:
`merge-gate`, `await-remote-ci`, `pr-body`, `graph/regen`, `plan-scope`,
`backlog/parse`, `manage/lock`, `locks/classify`, `engine/*`.

`usage-window.ts` + `usage-governor.ts` (470 lines) are **loop-only** — the
one apparent outside hit is a comment in `plan-scope.ts`. That is the piece
most plausibly worth keeping for the orchestrator; see Option C.

### Mobile

- `mobile/` is a **Flutter scaffold and nothing more**: 12 Dart files, 469
  lines, 2 commits, both 2026-04 (`a10001` scaffold + nav shell, `a10002`
  Riverpod/theme/router).
- `a10003` (iOS config) is `[-]` blocked; `a10004`, `a10005`, `a10ret` are
  `[ ]` ready and have never been picked up. DEV.md calls the mobile backlog
  **paused** in its own header.
- `worker/` — the Cloudflare relay in CLAUDE.md's layout — **does not
  exist**. Only a comment in `devx-ci.yml` references it.
- `docs/MOBILE.md` is 376 lines of contract for an app that is a scaffold.
- `devx.config.yaml` still declares a `mobile` project with
  `lint: flutter analyze`, so it is wired into the touched-surface gate.
- **Undetermined:** whether CI can even run it (no Flutter step is visible in
  `devx-ci.yml`), and whether Leo has it installed on a device.

Nobody uses it. There is no ambiguity here, and I'd separate its decision
from the loop's — see Option E.

### The orchestrator-registry finding, checked

**Confirmed, and narrower than it sounds.**
`~/.claude/coordinator/lib/coordlib/registry.py:25` does filter
`if d.get("kind") not in (None, "interactive"): continue`. So a session
registered with any other `kind` is invisible to the orchestrator.

But: nothing in the orchestrator *writes* `kind` — the registry files come
from the harness. **Undetermined:** whether a loop-spawned `claude -p`
worker registers at all. If it does not register, the filter is irrelevant
and the real statement is simpler: *loop workers are invisible to the
orchestrator because they never announce themselves*, which is a stronger
argument for the lease problem, not a weaker one.

Either way the operational claim holds: **a lease system keyed on session
liveness has no clean handle on a loop worker today.**

### Two claims from the prior investigation, re-checked

- **`storage.worktree_root` is dead — confirmed.** Written by
  `init-write.ts:510`, declared in the schema, `devx.config.yaml:303` and
  `docs/CONFIG.md:377`. **No reader anywhere.** Four call sites hardcode
  `.worktrees` (`doctor/detect.ts:735`, `devx/claim.ts:1511`,
  `devx/finalize.ts:726`, `loop/driver.ts:1174`). Unrelated to this decision,
  worth its own one-line fix or removal.
- **"zero orchestrator references in `src/`" — true in substance.** There are
  51 case-insensitive hits, but every one is `/devx-init`'s own
  `init-orchestrator.ts` and friends. Nothing in devx knows Leo's
  orchestrator exists.
- **`finalizeInstance` not in a `finally` — confirmed, but the exposure is
  smaller than stated.** It is straight-line at `driver.ts:1342`. However the
  entire item loop above it is wrapped in `try/catch` (`:1024`–`:1279`) that
  converts *any* throw into `abortReason`, with `finally { clearInterval }`,
  and `writeMorningReport` has its own `try`. So a throw escaping
  `finalizeInstance` can only come from the ~60 lines of summary
  construction between them. Real, worth fixing if the loop stays, not the
  headline risk.

## What the loop uniquely provides

Judgement, informed by the above:

| Capability | Survives an orchestrator-only world? |
|---|---|
| Unattended overnight execution | **No.** A tab needs a human to open it. This is the one real loss. |
| Budget governance (tokens / iterations / items) | No, but an orchestrator dispatching to tabs inherits the human's own usage window; the need changes shape. |
| Failure ladder + systemic-abort | Partly — the orchestrator sees a tab fail, but has no per-item backoff/abandon contract today. |
| Morning report | **No.** Nothing else writes one. |
| `caffeinate` sleep-inhibit | Loop-only, and only matters unattended. |
| Usage-window governor | Loop-only today, **reusable** by an orchestrator. |
| Multi-loop scoping (`scope.ts`, 506 lines) | Dies with it; the orchestrator's equivalent is "which tab gets which repo". |
| Merge tail, gates, claim/finalize | **Yes** — all shared, all outside `loop/`. |

## Options

- **Option A — keep it, unchanged.** Cost: the 14% of `src/` stays, and the
  lease design must solve loop workers. Benefit: overnight throughput stays
  possible. Honest problem: it has not run in 37 days.
- **Option B (recommended) — freeze, don't scrap.** Stop investing: no new
  loop features, no loop items in the backlog, `devx loop` stays shipped and
  tested. Decide the lease design **for interactive tabs only**, and have it
  refuse loop workers loudly rather than support them. Revisit in 60 days
  with a rule agreed now: *if it has still not run, scrap it then.*
- **Option C — shrink to the parts that outlive it.** Keep
  `usage-window`/`usage-governor` (the orchestrator will want them) and the
  merge tail's shared pieces; delete `driver.ts`, `scope.ts`, `instances.ts`,
  `ladder.ts`, `report.ts`, `sleep-inhibit.ts`, `worker.ts`,
  `iteration.ts` and their tests. Removes ~7,000 source lines and the hardest
  lease case. Irreversible in practice — rebuilding an unattended runner from
  scratch is a phase, not a story.
- **Option D — scrap the loop entirely**, including `manage` (2,942 lines,
  which has never run here: `.devx-cache/` has no manage state at all).
  Largest simplification; forecloses unattended execution until someone
  rebuilds it.
- **Option E — mobile, decided separately: retire it.** Delete `mobile/`,
  `docs/MOBILE.md`, the `mobile` project row in `devx.config.yaml` and the
  mobile epics in DEV.md, keeping the two merged PRs in history. This one I
  would do now whichever way the loop goes.

## Recommendation, and the reasoning

**Option B for the loop. Option E for mobile.** Stated plainly because Leo
asked what I think, not for agreement.

Why not scrap the loop (Option C/D), even though the lease argument is real:

1. **The cost is mostly already paid.** 9,000 lines exist, are tested, have
   no open bugs, and are not slowing anything down. Deletion buys
   simplicity, not velocity. The thing devx is short of is not lines.
2. **The one capability that dies is the one nobody can replace.** An
   orchestrator dispatching to tabs is strictly a *attended* system — it
   needs a human with tabs open. "Work nobody wants to watch" and "work that
   happens at 3am" have no other home. 20 merged items say that path worked.
3. **The convenient-argument problem.** The lease design would get easier if
   the loop vanished. That is a real benefit, and it is also exactly the
   shape of reasoning that deletes a system for the convenience of a system
   that has not shipped yet. The orchestrator has zero references in devx's
   tree; it has not yet earned the right to set devx's scope.
4. **Freezing gets most of the benefit with none of the irreversibility.**
   The lease design can declare loop workers out of scope *without* the code
   being deleted. If the loop stays unused for another 60 days, the same
   decision is available and much better informed.

Why mobile is different, and should go: it is 469 lines that have not moved
in five months, its relay doesn't exist, its 376-line contract describes
nothing, and unlike the loop **it has never produced anything**. There is no
"it worked 20 times" to weigh. Keeping it costs a config row in the gate and
a chapter of CLAUDE.md that misdescribes the repo.

What would change my mind on the loop: if the lease design turns out to need
loop *support* rather than loop *exclusion* — i.e. if refusing loop workers
is not actually implementable — then the loop is imposing a live cost on
shipped work, and Option C becomes right immediately.

## Plan (if Option B is chosen)

1. Record the decision in `v2/07-decisions.md` as a dated entry: frozen, not
   retired, with the 60-day revisit and the scrap rule.
2. DEV.md / PLAN.md: mark the in-flight loop tracks (`c8e2d4`
   usage-window governor, `f1d6b2` fleet layer) `[-]` blocked-by this
   decision. Do not delete them.
3. Lease design: state "interactive sessions only; a non-interactive worker
   is refused with a named reason" as a constraint, and check that the
   refusal is implementable — that is the falsifier above.
4. Fix `finalizeInstance`'s narrow escape window (`driver.ts:1342`) — small,
   and the loop stays shipped so it should be correct.
5. Remove or wire `storage.worktree_root` (unrelated, already measured).
6. Mobile (Option E) rides its own PR: delete `mobile/`, `docs/MOBILE.md`,
   the config row, the DEV.md epics; add a CLAUDE.md correction — **Leo's
   file, so proposed, not edited**.
7. Calendar the revisit for 2026-11-24 with the rule written down.

## Status log

- 2026-09-25T09:37-06:00 — filed. Research measured on `main` at `2de95bb`;
  run history from `.devx-cache/loop/` (9 runs, 2026-07-15 → 2026-08-19);
  orchestrator registry filter read at
  `~/.claude/coordinator/lib/coordlib/registry.py:25`. Requested by Leo via
  the orchestrator session. Undetermined items are marked as such in-line:
  whether loop workers register with the harness at all, and whether mobile
  has ever been runnable in CI.
- 2026-09-25T10:12-06:00 — **decision: Leo chose Option B (freeze the loop)
  and Option E (retire mobile)**, relayed through the orchestrator session in
  his words ("freeze the loop and retire mobile. I like it"). Recorded as
  `v2/07-decisions.md` D-15 and D-16, each carrying what its state obliges —
  D-15 spells out that frozen means still shipped, still gated in CI, still
  reported by `devx status`/`devx next`, no new feature work, and the three
  things a future reader must check before trusting it (a run newer than
  2026-08-19, the `loop-*` tests, and whether the surfaces beneath it have
  moved). A frozen subsystem nobody can tell is frozen becomes a trap; the
  obligations exist so this one cannot. Revisit **2026-11-24** with the scrap
  rule agreed in advance. Two measured-but-out-of-scope defects are filed
  rather than fixed here, so neither rots in this spec's prose:
  `finalizeInstance`'s narrow escape window, and the dead
  `storage.worktree_root` knob.

