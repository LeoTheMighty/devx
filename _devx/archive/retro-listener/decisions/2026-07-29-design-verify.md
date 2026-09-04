---
gate: PASS
status_reason: 'All 22 source IDs fully covered in design mode.'
reviewer: 'devx gate coverage (design mode)'
updated: 2026-07-29
waiver: { active: false, approver: null, reason: null }
---

# Verify — _devx/workstreams/retro-listener — 2026-07-29

## Subject

`design.md` reviewed against `prd.md` (design mode; workstream `620c74`).

## Coverage

| ID | Status | Where covered | Note |
|---|---|---|---|
| G-1 | ✅ | Design § Data (learn-queue.done.jsonl) + Architecture § Watch | Mechanism for scoring is designed: done-log rows carry {processed_ts, outcome} incl. 'completed', explicitly called 'the phase-2 evidence dataset'; the merged-PR half is /devx-learn's existing unchanged output. Actual measurement is a devx-outcome concern, correctly not re-designed. |
| G-2 | ✅ | Design § Risks (rows 1–2) + Architecture § Pin + § Detect | Pin test (collapse(prose).includes(collapse(NUDGE_PATTERN)), imports the real constant, CI-gated in same suite) covers reword deafness; DEVX_RETRO short-circuit before stdin covers retro-of-retro; both tied to E-6/E-2. |
| G-3 | ✅ | Design § Constraints (bullet 1) + § Trade-offs (bullet 1) | Latency bound restated with the design consequence (no config load, no repo scan; stdin → substring → one locked append) and 'bounded and measured by E-7'; PRD's 'recorded in RED-report or status-log' location is not restated but delegated to E-7. |
| UC-1 | ✅ | Design § Overview + § Architecture (Emit → detect → queue → spawn) | Full walk-away flow designed end-to-end; resume-fork from original cwd preserves native context; human role stated as prune-and-approve. |
| UC-2 | ✅ | Design § Constraints (serial invariant) + § Architecture Watch/Spawn | Serial drain with awaitMarker; every normal ending covered via trap HUP INT TERM + rc=$? read (incl. the Ctrl-C-absorbed-by-claude case); ending the retro is what writes the marker that advances the loop. |
| UC-3 | ✅ | Design § Risks (SIGHUP row) + § Interfaces (requeue <sid>) | Tab-close → trap writes status ≥128 marker (outcome vocabulary incl. completed-interrupted adopted verbatim per FR-3); requeue restores from done log keeping original ts, refuses if pending. |
| UC-4 | ✅ | Design § Risks (retro-of-retro row) + § Architecture Detect/Spawn | Wrapper exports DEVX_RETRO=1; listener returns before reading stdin when set — mechanical, matches the PRD's cannot-self-trigger claim; proven by E-2. |
| UC-5 | ✅ | Design § Architecture Watch + § Data (repos.json) + § Resolved design questions | Allowlist keyed by git repo root, memoized, deny persisted in repos.json; 'ask-once-per-repo is the conservative valve' stated explicitly; prompt-ability re-checked at prompt time via foreground-process-group test. |
| UC-6 | ✅ | Design § Architecture Watch ('--dry-run changes nothing by construction') | Now explicit: singleton claim skipped with rationale (a held lock must not refuse a read-only setup check — the UC's concurrent-watcher case), print-only spawnRetro, no marker/done-log/queue writes; upstream round-4 fake-marker regression cited as the reason. |
| CAP-1 | ✅ | Design § Architecture Detect + Queue, § Constraints, § Risks (stale-lock row) | Whitespace-collapsed substring check, dedupe+append under queue lock, JSONL append precedent, top-level try/catch → exit 0 always; hook-side lock timeout drops the detection rather than delaying the turn. |
| CAP-2 | ✅ | Design § Architecture Detect (SessionEnd) + Watch (sessionOver) + § Risks (missing transcript_path row) | Denylist check + .ended marker for pending sessions; readiness = marker ∨ transcript-mtime idle ∨ entry-age when nothing to stat (fail-safe, aged against queue ts); adds an extra 'undatable hand-edited entry serves rather than wedges' behavior not in the PRD. |
| CAP-3 | ✅ | Design § Architecture Spawn + Watch (awaitMarker) + § Risks (SIGHUP row) | tmux/osascript arms, original cwd with cd guard, trap HUP INT TERM (no EXIT — rationale given), rc read not asserted, tmp+rename marker, bounded await for SIGKILL, SpawnFn test seam. |
| CAP-4 | ✅ | Design § Interfaces (learn-watch) + § Architecture Watch (dry-run passage) | All four ops designed: list, requeue, second-drainer refusal (exit 1, names lock path), and now dry-run-without-consuming stated explicitly ('changes nothing by construction': no marker, no done-log row, no queue rewrite, seen-set instead of finish). |
| CAP-5 | ✅ | Design § Architecture Pin + § Wrap don't duplicate (Adds) | collapse-substring equality against the marker, single-source constant commented back to the marker, in-memory negative cases, replaces upstream lint_nudge.py; realized as a NEW test file (test/learn-nudge-pin.test.ts) rather than literally extending the two existing tests — acceptable reading of 'extends'. |
| CAP-6 | ✅ | Design § Architecture Install + § Interfaces (installHooks) + § Assumptions (bullet 4) | Merge-preserving idempotent settings writer modeled on installSkills, template under _devx/templates/init/, wired into init-orchestrator, this repo's settings committed directly; user-foreground constraint for the prompt-able edit is captured. |
| FR-1 | ✅ | Design § Architecture Detect + Queue, § Interfaces (learn-helper listen) | All load-bearing behaviors designed (collapse match, dedupe under lock, entry shape, pending-only .ended marker, DEVX_RETRO before stdin, exit 0 always incl. garbage). The four concrete denylist reasons (clear/resume/bypass_permissions_disabled/logout) are not enumerated in the design — only 'reason-denylist' + the denylist-over-allowlist trade-off. |
| FR-2 | ✅ | Design § Architecture Install + § Interfaces (hook fragment, installHooks) + § Trade-offs (settings-over-plugin) | Both arms covered: committed .claude/settings.json here, idempotent merge (never clobber, unknown keys preserved, devx entries identified by command string) via /devx-init for consumers; the porting delta (settings vs plugin hooks.json) is an explicit trade-off row. |
| FR-3 | ✅ | Design § Architecture Watch + Spawn, § Interfaces, § Risks (malformed row) | Singleton fail-fast lock, three-way readiness, error-malformed retire before prompt/spawn, foreground-process-group promptability, trap wrapper exactly per FR (HUP INT TERM, no EXIT, rationale added), 360-min bound, UUID sid validation + cwd quoting; outcome vocabulary adopted 'verbatim from upstream' by reference rather than re-enumerated (only error-cd/manual named). |
| FR-4 | ✅ | Design § Interfaces (list / requeue) + § Architecture Watch (dry-run passage) | list (pending+readiness, last processed+outcomes — design adds a 'last 5' cap not in PRD) and requeue (keeps original ts, refuses if pending, exit 1 if not found) designed; dry-run now matches the FR exactly: prints the wrapper command, no marker/done-log/queue rewrite, per-run in-memory seen-set so pickReady doesn't re-print the head entry. |
| FR-5 | ✅ | Design § Architecture Pin + Adds (src/lib/learn/nudge.ts) | Whitespace-collapsed substring assertion against the nudge-canonical prose, real constant imported, single-source pattern commented back to the marker, same-PR CI failure via the already-gated suite; reword-negative cases included. |
| FR-6 | ✅ | Design § Interfaces (learnConfigFrom)  | learn: section with schema (additionalProperties: false), typed reader with per-field clamp/fallback, defaults 15/360/~/.claude/devx, env precedence via DEVX_LEARN_HOME > config > default; only the home env override is designed (PRD's 'env overrides' plural is otherwise unspecified, so acceptable). |
| FR-7 | ✅ | Design § Architecture 'Routing rework (FR-7)' bullet + § Migration plan | Ordered first-match over all five outlets (personal preference explicitly 'presented to the user and never committed'), all three checkability rules (deciding question named; framework promotion = evidence claim; coin flip → narrower outlet + record ambiguity), repo predicate + nudge-canonical marker byte-preserved, sync:skills, severable. Extra beyond PRD: claims test/learn-skill-guards.test.ts will assert the routing section's shape updates in the same change. |

## Extras requiring product approval

- Extras beyond the PRD: requeued_ts field on requeued entries — (not a PRD ID — design additions audit)
- 'last 5' cap on list output — (not a PRD ID — design additions audit)
- undatable hand-edited entry serves-not-wedges rule — (not a PRD ID — design additions audit)
- hook-side short lock-timeout that drops detections — (not a PRD ID — design additions audit)
- learn-watch exit-code table (0 on SIGINT/1 singleton/2 usage) — (not a PRD ID — design additions audit)
- installHooks {action,path} return shape — (not a PRD ID — design additions audit)
- DEVX_LEARN_HOME env name — (not a PRD ID — design additions audit)
- new guards-test shape assertion for the FR-7 routing section — (not a PRD ID — design additions audit)
- upstream round-4 fake-marker provenance note — (not a PRD ID — design additions audit)
- discarded sleep-inhibition — (not a PRD ID — design additions audit)
- deferred devx status/next pending-retro-count question. All benign elaborations, none contradict the PRD. — (not a PRD ID — design additions audit)

## Verdict detail

PASS — every source ID is ✅ covered.
