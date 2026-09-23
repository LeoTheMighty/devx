---
hash: 99ad05
type: debug
created: 2026-09-22T19:40:00-06:00
title: "await-remote-ci's sha-mismatch is terminal, so the post-push race files an INTERVIEW for a healthy run"
from: null
status: ready
owner: null
branch: null
---

## Goal

`devx devx-helper await-remote-ci` must not halt a run and file a
human-attention row for a condition that resolves itself in under a minute.

Probing right after a push — the most likely moment for an agent to probe —
returns `sha-mismatch` whenever GitHub has not yet created runs for the new
commit, because the newest run is still the previous commit's. The `/devx`
skill treats that state as terminal: file an `INTERVIEW.md` entry citing both
shas, mark the PR `awaiting-approval`, and stop.

## Evidence

Measured on palateful by palateful-3b (relayed through the coordinator
session), while a monitor was waiting on its own PR:

- Pushed `b28032c3`, probed immediately → `{"state":"sha-mismatch"}`.
- ~30s later both workflows existed at `b28032c3` and were `in_progress`.
- Nothing was wrong. 3b worked around it by retrying inside its own monitor
  loop — a workaround in one caller, not a fix in the CLI.

Both halves confirmed in devx's own tree at `729baf1`:

- `src/lib/devx/await-remote-ci.ts:935` — the FIRST probe's `sha-mismatch`
  returns `{state:"workflow-no-run", reason:"sha-mismatch"}` immediately. The
  neighbouring `empty` branch (`:947`) sleeps `emptyRetryMs` and re-probes
  once before escalating. Same for the post-empty and mid-poll branches
  (`:963`, `:1004`).
- `.claude/commands/devx.md:450` — the skill's `sha-mismatch` row says file
  INTERVIEW, mark `awaiting-approval`, stop. The `empty` row (`:440`) already
  has the right shape: one 120s retry, then escalate.

The state's own comment (`:450`, and `await-remote-ci.ts:899`) describes the
case it was written for: an unpushed local change shifted HEAD after PR-open.
That case is real and should still escalate. The post-push race is a
different condition wearing the same label.

## Acceptance criteria

- [ ] AC 1: A probe issued immediately after a push, where GitHub has not yet
      created the run, does not escalate on the first observation.
- [ ] AC 2: The two conditions are discriminated rather than merged. 3b's
      proposed split, to be validated against the API's actual fields:
      - **race (retry):** no run exists at HEAD *and* the newest run is older
        than HEAD's push time;
      - **genuine (escalate):** a run exists at a different commit that is
        not an ancestor of HEAD.
      If the push time is not reliably available, say so and pick a bounded
      retry instead — but do not silently widen the retry to cover the
      genuine case, which is the state's whole purpose.
- [ ] AC 3: The genuine case still escalates with both shas, unchanged.
- [ ] AC 4: The retry is bounded and mirrors `empty`'s shape, so a persistent
      mismatch still reaches a human.
- [ ] AC 5: The skill body's Phase 7 `sha-mismatch` row is updated with the
      new contract; `empty`'s row is the template.
- [ ] AC 6: A test covers the race (probe 1 mismatched, probe 2 in-progress →
      no escalation) and the genuine case (mismatch that persists, or a
      non-ancestor run → escalation).

## Technical notes

- `pinnedOpts` pins `headSha` once at the start of the wait, deliberately, so
  a fix-forward push mid-poll does not discard the run being polled
  (`:897-905`). A retry added for the race must not undo that pin: the retry
  is for "the run for THIS sha does not exist YET", not "follow the new tip".
- The `empty` branch re-evaluates the second probe through the full
  discriminator, including `no-workflow`. Any `sha-mismatch` retry should do
  the same rather than assume the state can only stay or clear.
- `pr-conflicting` (c94f14) is the precedent for the opposite direction: a
  state that looked like it needed waiting was proven terminal and made to
  return immediately. This is that analysis run the other way.
- Cost of the current behavior is not just a wasted probe: it marks the PR
  `awaiting-approval` and files a row a human must read and dismiss.

## Status log

- 2026-09-22T19:40-06:00 — filed from a palateful finding (palateful-3b,
  measured on `b28032c3`; relayed by the coordinator session). Both halves —
  the CLI's immediate return and the skill's terminal prescription — verified
  against devx's tree at `729baf1` before filing, not taken on report.

## Links

- `src/lib/devx/await-remote-ci.ts` — `:935` (first probe), `:947` (`empty`'s
  retry, the template), `:963`, `:1004`.
- `.claude/commands/devx.md:450` — Phase 7's `sha-mismatch` row; `:440` is
  `empty`'s.
- `debug/debug-c94f14-2026-08-05T14:05-await-remote-ci-conflicting-pr-blind.md`
  — the `pr-conflicting` state, the precedent for
  deciding whether a no-run state is terminal.
