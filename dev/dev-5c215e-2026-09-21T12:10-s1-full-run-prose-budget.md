---
hash: 5c215e
type: dev
created: 2026-09-21T12:10:00-06:00
title: "S-1: give the full-run prose surface its own deliberate budget"
from: INTERVIEW.md Q#9
status: done
owner: /devx-2026-09-21T1051-42433
branch: null
---

## Goal

Decide the S-1 full-run prose budget on purpose, as its own reviewed change,
instead of letting it be decided by whoever next trips the drift tripwire.

Leo's call (2026-09-21, relayed by the coordinator session): **raise it,
deliberately, with a stated reason.** This spec proposes the structure and
the number; the number is for his review on the PR.

## Why now

On 2026-09-21 `main` had **28 bytes** of headroom on the full-run surface:
122,852 B against the 2×-budget tripwire's 122,880 B. Two correctness
changes that day hit the wall — devx-b6 needed ~900 B to make two skill
bodies true and replaced existing prose to fit (−354 net); 7d96be needed
+515 B for its AC 4 and was trimmed to +142. The next prose edit to
`devx.md` by anyone would go red for margin it did not spend.

## Acceptance criteria

- [x] AC 1: The planning surface and the full-run surface are gated by
      **separate** knobs. Today one knob (`engine.prose_budget_kb`) sets
      both — the planning gate at 1× and the full-run tripwire at 2× — so
      raising it for the full run silently loosens the planning budget too,
      which nobody is hitting (6.2 KB free).
- [x] AC 2: The full-run surface is gated **directly** at its own budget,
      replacing the 2× "drift tripwire only" assertion, so the number that
      binds is the number that was chosen.
- [x] AC 3: The number is justified from what S-1 protects, not from
      current size plus margin — and the justification says plainly where
      it is a policy line rather than a measured threshold.
- [x] AC 4: Recorded as a decision in `v2/07-decisions.md`; `02-engine.md`
      §6/§7 point at it rather than being rewritten.
- [x] AC 5: INTERVIEW.md Q#9 answered with the decision, a pointer to this
      change, and a note that the direction was Leo's.
- [x] AC 6: Full suite green; typecheck clean.

## Status log

- 2026-09-21T12:10 — filed at the coordinator's request after Leo chose to
  raise the budget deliberately (INTERVIEW Q#9). Filed by the session that
  tripped the tripwire on 7d96be.
- 2026-09-21T10:51:22-06:00 — claimed by /devx in session /devx-2026-09-21T1051-42433
- 2026-09-21T12:40 — implemented. Two knobs (`prose_budget_kb: 60`
  unchanged, `full_run_prose_budget_kb: 128` new); the 2× tripwire replaced
  by a direct gate; an independence test pins that moving one knob never
  moves the other. Reasoning in D-14. Mutation-checked: a 119 KB budget
  fails the gate at today's 122,852 B, and re-coupling the knobs fails the
  independence test. The existing "defaults match 02-engine.md §7" guard
  caught §7 being stale mid-change — updated both sides.
- 2026-09-21T11:33:51-06:00 — merged via PR #168 (squash → 8ad6324)
- 2026-09-21T12:20 — phase 4: RETROACTIVE — single-pass self-review by the implementing session, NOT a parallel adversarial review: this item was run by hand through the devx helpers rather than the /devx skill, so no review agents were spawned (the parallel shape was unavailable, not skipped for size). 0 open findings at merge. Verification was mechanical rather than reviewer-based: mutation-checked (a 119KB budget fails the gate at 122,852 B; re-coupling the knobs fails the independence test), plus the existing defaults-match-§7 guard, which caught one stale-doc finding mid-change (§7 not updated) — fixed in-place. Appended after merge because `mark-done` flipped the spec to `done` without it and reddened `main` at 74d93cd (devx-status-log-discipline); filed as a finding.
