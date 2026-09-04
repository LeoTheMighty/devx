# Expectations — Mid Story Split

<!-- Gate 1 input. Minimum 3 E-blocks (config: engine.expectations_min).
     Every business goal (G-) must be covered by at least one expectation;
     every Covers: ID must resolve in prd.md. EARS regex enforced by
     `devx gate prd`: "When .+, the system SHALL .+". A P0 with a vague
     Verified-by target fails the gate. -->

## E-1: Split primitive round-trip

- **Priority:** P0
- **Covers:** G-3, UC-1, UC-4, CAP-1, CAP-2, CAP-5, FR-1, FR-2, FR-8
- **Trigger:** The split primitive is invoked against a claimed in-flight dev spec in a fixture repo with a remaining-work payload (title, ACs, carried-forward context).
- **Expectation (EARS):** When the split primitive runs against a claimed in-flight spec, the system SHALL atomically produce a follow-up spec (fresh legal hash, `from:` the parent, carried-forward sections present) plus a parseable DEV.md row with correct `Status:`/`Blocked-by:` text and parent bookkeeping, and SHALL leave the backlog byte-identical to before when any write in the transaction fails, and SHALL refuse with a distinct exit code when the caller does not own the parent's claim.
- **Threshold:** ≥6 test cases green with 0 failures — round-trip via `parseBacklog` (×2 shapes: merge-first blocked-by wiring, branch-handoff branch recording), injected rename-failure leaving 0 changed bytes in DEV.md, ownership-mismatch refusal (exit code ≠ 0), carried-forward sections present (100% of required section headings).
- **Verified by:** `test/devx-split.test.ts`

## E-2: Handoff Snippet grep-zero

- **Priority:** P0
- **Covers:** G-1, CAP-4, FR-7
- **Trigger:** A scan of the live surfaces (`.claude/commands/`, `src/`, `test/`, `docs/`, `v2/`) after the retirement phase ships.
- **Expectation (EARS):** When the live skill/code/test/doc surfaces are scanned for `Handoff Snippet` and `parseHandoffSnippet` tokens, the system SHALL contain zero matches outside designated historical archives (LEARN.md entries, shipped spec files, `_bmad-output/`), and `.claude/commands/devx.md` Phase 9 SHALL route early halts to the split primitive.
- **Threshold:** 0 non-historical matches; the eval script exits 0 only when the grep set is empty AND the Phase 9 replacement prose is present.
- **Verified by:** `_devx/workstreams/mid-story-split/evals/E-2_snippet-grep-zero.ts`

## E-3: Loop budget rail splits instead of abandoning

- **Priority:** P0
- **Covers:** G-2, UC-3, CAP-3, FR-6
- **Trigger:** A loop item reaches `maxIterationsPerItem` (or per-item token budget) exhaustion with ≥1 good iteration and real file changes in its worktree.
- **Expectation (EARS):** When the iteration budget exhausts on an item with real progress, the system SHALL end the item with outcome `split` — follow-up spec + DEV.md row committed on main, morning report naming the follow-up path — SHALL NOT increment the consecutive-abandonment streak, and SHALL preserve today's abandon behavior verbatim when there is zero real progress.
- **Threshold:** ≥3 driver/ladder test cases green with 0 failures — progress → outcome `split` (×1), bookkeeping-only → abandon-to-ready byte-identical to current behavior (×1), abandonment streak counter remains 0 after a `split` outcome (×1).
- **Verified by:** `test/loop-driver.test.ts`

## E-4: Worker-requested split

- **Priority:** P1
- **Covers:** UC-2, CAP-3, FR-5
- **Trigger:** A loop worker's iteration report carries a split-request payload (well-formed and malformed variants).
- **Expectation (EARS):** When an iteration report contains a well-formed split request, the system SHALL have the driver (never the worker) perform the split; when the request is malformed, the system SHALL reject it with a validation error that does not terminate or wedge the item.
- **Threshold:** ≥3 test cases green with 0 failures — well-formed request dispatches exactly 1 driver-side split, malformed request yields 1 validation error and 0 spec/backlog writes, item's iteration loop continues (iteration counter advances by 1, item not terminated).
- **Verified by:** `test/loop-iteration.test.ts`

## E-5: Fresh-claim viability of a follow-up

- **Priority:** P1
- **Covers:** G-3, UC-4, FR-2, FR-3, FR-4, FR-8
- **Trigger:** `devx next` + claim run against a post-split fixture repo (both shapes), with no access to any prior conversation state.
- **Expectation (EARS):** When `devx next` runs after a split, the system SHALL surface the follow-up as the ready pick (row 8) once its blockers resolve, SHALL claim it successfully with the recorded branch inheritance honored, and SHALL report zero split-attributable drift entries.
- **Threshold:** Dispatch + claim tests green on both merge-first and branch-handoff fixtures; drift assertion count = 0.
- **Verified by:** `test/devx-split.test.ts`
