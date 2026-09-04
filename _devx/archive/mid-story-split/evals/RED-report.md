---
gate: PASS
status_reason: 'Every runnable expectation observed RED for the right reason (5 run(s), 0 deferred).'
reviewer: 'devx gate evals'
updated: 2026-07-28
waiver: { active: false, approver: null, reason: null }
---

# RED report — _devx/workstreams/mid-story-split — 2026-07-28

## Runs

### E-1: Split primitive round-trip (P0)

- **Artifact**: _devx/workstreams/mid-story-split/evals/E-1_split-roundtrip.ts
- **Command**: `npx tsx mid-story-split/evals/E-1_split-roundtrip.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
  E-1 RED — split primitive round-trip not in place yet:
    - src/lib/devx/split.ts missing — split primitive not implemented (feature missing, T1.1–T1.4)
    - src/commands/split.ts missing — `devx split` CLI not implemented (feature missing, T1.6)
    - src/cli.ts does not register a split command (feature missing, T1.6)
    - test/devx-split.test.ts missing — the E-1 round-trip/rollback/ownership cases are not pinned in the default suite (feature missing, T1.7)
  ```
- **RED verdict**: right-reason

### E-2: Handoff Snippet grep-zero (P0)

- **Artifact**: _devx/workstreams/mid-story-split/evals/E-2_snippet-grep-zero.ts
- **Command**: `npx tsx mid-story-split/evals/E-2_snippet-grep-zero.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
  E-2 RED — the Handoff Snippet contract is still live:
    - .claude/commands has 3 live Handoff Snippet token(s): /Users/leonidbelyi/personal/devx/.claude/commands/devx.md:110:   (`--session-token` takes the token this session claimed with — the raw sessionId or the `/devx-<sessionId>` shape — but ONLY from this conversation's own memory: the claim performed earlier in this same session, or a Handoff Snippet th
    - src has 4 live Handoff Snippet token(s): /Users/leonidbelyi/personal/devx/src/lib/devx/handoff-snippet.ts:1:// Handoff Snippet shape validator (dvx107 AC #5). | /Users/leonidbelyi/personal/devx/src/lib/devx/handoff-snippet.ts:3:// The /devx skill emits a "Handoff Snippet" when it stops mid-loop (context | /Users/leonidbelyi/personal/devx/s
    - test has 29 live Handoff Snippet token(s): /Users/leonidbelyi/personal/devx/test/fixtures/handoff-snippet-realistic.md:27:- dvx107: stop_after handling + Handoff Snippet on early stop | /Users/leonidbelyi/personal/devx/test/devx-handoff-snippet.test.ts:1:// Handoff Snippet shape assertion (dvx107). | /Users/leonidbelyi/personal/devx/test/dev
    - v2 has 1 live Handoff Snippet token(s): /Users/leonidbelyi/personal/devx/v2/03-review-tour.md:90:- `parseHandoffSnippet`-style pinning: a test validates the tour template +
    - .claude/commands/devx.md Phase 9 does not route early halts to `devx split` — replacement prose missing (T4.1)
  ```
- **RED verdict**: right-reason

### E-3: Loop budget rail splits instead of abandoning (P0)

- **Artifact**: _devx/workstreams/mid-story-split/evals/E-3_budget-rail-split.ts
- **Command**: `npx tsx mid-story-split/evals/E-3_budget-rail-split.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
  E-3 RED — the budget rail still abandons items with real progress:
    - src/lib/loop/report.ts ItemOutcome has no "split" member — split is not a first-class outcome (feature missing, T3.3)
    - src/lib/loop/driver.ts has no splitItem terminal helper beside abandonItem (feature missing, T3.4)
    - src/lib/loop/driver.ts never emits the "item:split" event (feature missing, T3.7)
    - src/lib/loop/driver.ts never emits the "item:split-fallback" event (feature missing, T3.7)
    - test/loop-driver.test.ts has no describe-title marker "E-3:" — budget-rail split cases (real progress → `split`, bookkeeping-only → abandon byte-identical, streak stays 0) are not pinned (T3.8)
  ```
- **RED verdict**: right-reason

### E-4: Worker-requested split (P1)

- **Artifact**: _devx/workstreams/mid-story-split/evals/E-4_worker-requested-split.ts
- **Command**: `npx tsx mid-story-split/evals/E-4_worker-requested-split.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
  E-4 RED — worker-requested split not in place yet:
    - validateIterationReport silently drops a well-formed split_request — explicit copy-through not implemented (feature missing, T3.1)
    - src/lib/loop/iteration.ts never mentions split_request — OUTPUT_FIELD_LINES / prompt contract not extended (feature missing, T3.2)
    - test/loop-iteration.test.ts has no describe-title marker "E-4:" — worker-requested split cases (well-formed → 1 driver-side split, malformed → 1 validation error + 0 writes, loop continues) are not pinned (T3.8)
  ```
- **RED verdict**: right-reason

### E-5: Fresh-claim viability of a follow-up (P1)

- **Artifact**: _devx/workstreams/mid-story-split/evals/E-5_fresh-claim-viability.ts
- **Command**: `npx tsx mid-story-split/evals/E-5_fresh-claim-viability.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
  E-5 RED — a follow-up is not claimable cold yet:
    - parseSpecClaimFields does not surface the branch: frontmatter field — claim branch inheritance not implemented (feature missing, T2.1)
    - test/devx-split.test.ts missing — the E-5 dispatch/claim/drift cases are not pinned in the default suite (feature missing, T2.3)
  ```
- **RED verdict**: right-reason

## Deferred stubs

- none
