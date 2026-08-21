---
gate: CONCERNS
status_reason: 'G-1 is ⚠️ partial (Live overnight ride-through is human-gated by construction; the design scopes it into its own phase so the reactive machinery ships green without it. Nothing in the design can make G-1 verifiable in-session.) FR-8 is ⚠️ partial (Deliberately parked as a separate spike story with no production code beyond a findings doc — the design records that placement but does not design the probe, because whether it CAN exist is the spike''s question.)'
reviewer: 'devx gate coverage (design mode)'
updated: 2026-08-21
waiver: { active: false, approver: null, reason: null }
---

# Verify — _devx/workstreams/usage-window-governor — 2026-08-21

## Subject

`design.md` reviewed against `prd.md` (design mode; workstream `c8e2d4`).

## Coverage

| ID | Status | Where covered | Note |
|---|---|---|---|
| G-1 | ⚠️ | design.md § Risks | Live overnight ride-through is human-gated by construction; the design scopes it into its own phase so the reactive machinery ships green without it. Nothing in the design can make G-1 verifiable in-session. |
| G-2 | ✅ | design.md § The decision the PRD deferred; D-UW1 | Pre-ladder interception means ladder state is never advanced for a window hit — zero counter movement is structural, not a set of exemptions. Iteration count is charged by the driver and the interception precedes it. |
| G-3 | ✅ | design.md § Architecture 4 | RunSummary gains windowPauses[]; the morning report gains a Usage-window pauses section plus header total. A pause that leaves no trace is indistinguishable from a hang. |
| UC-1 | ✅ | design.md § Architecture 2 (planPause parsed-reset path) + 3 | Parsed reset → wake at reset+slack; same item resumes because claim/lock/worktree are untouched across the pause. |
| UC-2 | ✅ | design.md § Architecture 2 | No parsed reset → probe cadence; cumulative pause > usage_max_pause_ms → clean abort with the weekly-limit reason rather than holding the machine. |
| UC-3 | ✅ | design.md § Architecture 4 | LoopStatus gains "paused"; gather's liveness predicate widens to running\|paused so a paused loop is never reported crashed. Age-based staleness unchanged. |
| UC-4 | ✅ | design.md § Architecture 3 | resume_on_reset is checked FIRST, short-circuiting before any governor code runs — today's behavior is restored by construction, not by matching. |
| UC-5 | ✅ | design.md § Architecture 1 | Corroboration rule: a tail marker is a hit only when the iteration also failed to produce a valid trailing report. A transcript mentioning the string but ending with a valid report is a success. |
| CAP-1 | ✅ | design.md § Architecture 1 | firstUsageMarkerInTail + corroboration, mirroring ladder.ts's review-hardened permanent-error discipline rather than inventing a second posture. |
| CAP-2 | ✅ | design.md § Architecture 1 | parseResetTime over three observed shapes; a past-dated parse returns null so a stale timestamp cannot produce a zero-length spinning pause. |
| CAP-3 | ✅ | design.md § Architecture 2 | planPause (pure — every bound testable without a clock) + runPause chunked sleep, which is also what makes the pause sleep-aware after a machine suspend. |
| CAP-4 | ✅ | design.md § Architecture 4 | Heartbeat keeps beating during the chunked sleep; windowPauses[] + report section carry the history. |
| CAP-5 | ✅ | design.md § Architecture 5 | Four loop: knobs in config.ts AND _devx/config-schema.json — the schema edit is called out because additionalProperties:false makes a knob-without-schema reject the setting it added. |
| CAP-6 | ✅ | design.md § Architecture 6 | probeUsage() inert, returning null; the rule that no path may branch on usage_cap_pct in a way that would silently start enforcing it. |
| FR-1 | ✅ | design.md § Architecture 1 | USAGE_LIMIT_MARKERS + tail-bounded matcher + corroboration. |
| FR-2 | ✅ | design.md § Architecture 1 | parseResetTime, three shapes, past→null. |
| FR-3 | ✅ | design.md § The decision the PRD deferred; D-UW1 | Closes the PRD's open question: pre-ladder interception, ladder.ts untouched. The four-exemptions argument is the reason. |
| FR-4 | ✅ | design.md § Architecture 2 | planPause bounds (reset+slack, probe cadence, max-pause abort, --until clamp) + chunked runPause. |
| FR-5 | ✅ | design.md § Architecture 4 | LoopStatus "paused", gather widening, windowPauses[], report section + header total. |
| FR-6 | ✅ | design.md § Architecture 5 | Knobs + kill switch + the schema two-file note + docs/CONFIG.md §15b. |
| FR-7 | ✅ | design.md § Architecture 6 | Inert seam + corrected prose in config comment, CONFIG.md §2 and the morning report; plus the no-silent-enforcement rule. |
| FR-8 | ⚠️ | design.md § Coverage table (FR-8 row) | Deliberately parked as a separate spike story with no production code beyond a findings doc — the design records that placement but does not design the probe, because whether it CAN exist is the spike's question. |

## Extras requiring product approval

- none

## Verdict detail

- G-1 is ⚠️ partial (Live overnight ride-through is human-gated by construction; the design scopes it into its own phase so the reactive machinery ships green without it. Nothing in the design can make G-1 verifiable in-session.)
- FR-8 is ⚠️ partial (Deliberately parked as a separate spike story with no production code beyond a findings doc — the design records that placement but does not design the probe, because whether it CAN exist is the spike's question.)
