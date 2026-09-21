# 07 — Decision Ledger

Format: **D-n** — decision, status (`locked` = decided here and binding for
v2; `[user]` = needs Leo's explicit sign-off before the consuming phase;
`open` = tracked, not blocking). Statuses flip via normal PR edits to this
file; supersessions are appended, never rewritten.

## Re-decisions of v1 locked decisions

- **D-1 (locked)** — *BMAD is removed from the loop.* Supersedes the standing
  practice; the capture lives in `01-bmad-capture.md`. Final BMAD invocation
  is mgrret's retro. `_bmad-output/` is frozen history, never rewritten.
- **D-2 [user]** — *Re-word ROADMAP's "BMAD remains a library, not a fork;
  eject must always work" →* "The engine is native and ships in the devx
  package; markdown + git are ground truth; `devx eject` leaves a working
  repo with readable history, backlogs, specs, and workstream artifacts."
  The ejectability principle survives; the BMAD clause does not. Consumed by
  V2.2's docs sweep.
  *Evidence (2026-07-05): exercised in PR #64 (v2x101) — the docs sweep
  shipped the re-wording across CLAUDE.md/ROADMAP.md/DESIGN.md and the PR
  merged; the [user] marker stays until Leo flips it explicitly.*
- **D-3 (locked)** — *Interim retro discipline re-targets from
  `bmad-retrospective` to `/devx retro`,* keeping the LEARN.md row contract
  (confidence/blast-radius tags, ≥3-concordance promotion) byte-compatible.

## New v2 decisions

- **D-4 [user]** — ~~*Tour hosting: orphan `devx-tours` branch + htmlpreview
  link, raw-file fallback for private repos.*~~ **RETIRED 2026-08-04
  (tur101).** The review tour is gone; hosting is moot. Original alternatives
  considered: CI artifact upload (no stable URL, expires), GitHub Pages (extra
  repo setting, better render), committing tours on the feature branch
  (pollutes the PR diff — rejected). Shipped in V2.3, exercised on PRs #65–…,
  and retired on owner call: the per-PR narration step cost more time than the
  guided walkthrough returned on a solo pre-launch repo. The orphan
  `devx-tours` branch is left in place as an archive (see MANUAL.md).
- **D-5 [user]** — *YOLO auto-merge stays the default; review becomes
  possible, not mandatory:* a `devx: hold` comment or a requested-changes
  review before CI-green blocks the merge tail; silence merges as today.
  Rationale: preserves the YOLO memory-rule ("never stop at PR awaiting human
  merge") while making human review actionable. Consumed by V2.3.
  *Survives tur101 — `devx devx-helper check-hold` is independent of the
  retired tour.*
  *Evidence (2026-07-05): exercised in PR #65 (v2t101) — `devx devx-helper
  check-hold` ran live in its own merge tail (`{hold:false}` → silence
  merged); [user] marker stays pending Leo's explicit flip.*
- **D-6 (locked)** — *gnhf's permission-bypass model is NOT adopted.* The
  loop's containment is transactional git + worktrees + merge-gate + harness
  permissions. `devx loop` is disabled entirely in LOCKDOWN mode.
- **D-7 (locked)** — *sprint-status.yaml is retired* (zero consumers, chronic
  drift class MP0.1/MP0.2). The spec graph + backlogs are the only tracking
  state. Frozen copy remains in `_bmad-output/`.
- **D-8 (locked)** — *Stage skipping is legal and recorded* (`entered_at:`),
  never silent — small work must not be forced through four gates
  (send-it thoroughness would die of ceremony otherwise).
- **D-9 (locked)** — *Verdict vocabulary is fixed:* `PASS | CONCERNS | FAIL |
  WAIVED`, WAIVED requires named approver + reason. Applies to every gate and
  checkpoint artifact.
- **D-10 (locked)** — *No JIRA/Confluence/external-tracker surface anywhere in
  v2* — templates, skills, config, docs. GitHub (PRs, comments, CI) is the
  only external surface. Enforced by a grep test in the engine's CI.
- **D-11 (locked)** — *Loop completion is not acceptance.* `acs_met` from a
  worker routes to the PR/CI/merge tail; merge-gate remains the only path to
  main; morning reports present claims, not verdicts.
- **D-12 (locked)** — *One plan phase ≙ one dev spec ≙ one PR.* Keeps v1's
  atomic-story rhythm as the engine's sizing invariant. *(Amended 2026-08-04,
  tur101: the trailing "≙ one tour" clause dropped with the review tour; the
  sizing invariant itself is unchanged.)*

- **D-13 (locked, 2026-08-20, debug-9f24c7)** — *`readEngineState` keeps
  failing SOFT; the call sites that can report must SAY "unreadable."* A spec
  whose frontmatter YAML doesn't parse still reads as a best-effort
  `EngineState` — the reader never throws, so a half-edited spec can never
  crash a gate, a board render, or the dispatcher (the posture the soft
  reader was chosen for; see the spec's Technical notes: "do NOT fix this by
  making `readEngineState` throw"). The bug was never the softness — it was
  that softness was *indistinguishable from absence*. So: the return shape is
  unchanged, and every consumer that has an output channel consults
  `frontmatterParseError(content)` and reports:
  - `devx next` → a `frontmatter-unreadable` **drift row** (`src/lib/next/gather.ts`).
    Load-bearing: `effectiveStatus = specStatus ?? row.status` silently
    substitutes the backlog row for the spec, and the *same* null also
    suppresses the `status-mismatch` row that would otherwise have been the
    only signal. The new row is the sole report on that path.
  - `devx status` → one stderr line per unreadable plan spec
    (`src/commands/status.ts`), emitted *before* the stage check — a swallowed
    `stage:` is otherwise indistinguishable from a legacy non-engine plan
    spec, and the entry drops out of the render in total silence.
  - the gates → one warning at `resolveOrFail`, the choke point every gate
    resolves through (`src/commands/gate.ts`); `ResolvedWorkstream` gained an
    additive `frontmatterError: string | null`. This names the cause *before*
    `applyEnginePatch` throws its own write-side error — the reader/writer
    asymmetry that is the bug's fingerprint. Pinned by
    `test/frontmatter-unreadable-reported.test.ts`.

  Every one of these is **advisory**: no verdict, exit code, or routed row
  changes, and nothing is auto-fixed (CAP-2). The mechanical guard against
  recurrence is the repo-wide canary `test/spec-frontmatter-parses.test.ts`;
  `devx doctor` (dev-db36af) remains the natural home for the `--fix` half.

  *Corollary — a file with NO frontmatter block at all* (e.g.
  `test/test-2e7b45`, a QA walkthrough parked in a spec dir) *stays legal and
  silent.* `frontmatterParseError` returns null for it by design: "not an
  engine artifact" is a real, common state, and reporting it would make the
  canary noisy enough to be ignored. Only a block that opens and fails to
  parse is a defect.

  *AC 4 (blast radius), verified against real history, not assumed:* all 624
  historical revisions of all 202 spec files were re-parsed. Exactly **six**
  files were ever unreadable — the five named in the spec plus
  `debug-7b3e2a` (filed 2026-08-07, i.e. the class recurred *after* the spec
  was written; fixed 2026-08-20). **No plan spec was ever affected**, so no
  `gate_verdicts:`, `stage:`, `entered_at:` or `outcome:` was ever read as
  absent, and none of the six carries a `phase:`. Only `mgr102`/`mgr103`
  genuinely lost keys on read (`status`, `plan`, `blocked_by`); the three
  backtick-shape specs read losslessly and were merely *frozen* to
  `applyEnginePatch`. The loss was masked because the DEV.md rows repeat both
  facts in prose (`Status: done. Blocked-by: mgr101.`) and the three merged in
  declared order (efa23bf → 4366ae5 → ca42895), so no invisible edge was ever
  violated. The one thing actually acted on as absent was `devx graph`'s edge
  set — which is exactly how sgr106 found this. **Durable-state loss: nil.**
  Note the mask is not a safety net going forward: the graph and the gates
  read frontmatter, not the row prose.

- **D-14 [user] (2026-09-21, 5c215e)** — *The S-1 full-run prose surface
  gets its own budget, `engine.full_run_prose_budget_kb: 128`, separate from
  the planning budget (`prose_budget_kb: 60`, unchanged).* Supersedes, in
  part, `02-engine.md` §6's "full feature end-to-end ≤ 60KB"; §6's row is
  kept as written and annotated. **Direction is Leo's** (raise it
  deliberately, as its own reviewed change, rather than let whoever next
  trips the tripwire decide); **the number and structure are proposed here**
  and need his sign-off, hence `[user]`. Answers INTERVIEW Q#9.

  *Why two knobs.* One knob used to set both thresholds: planning gated at
  1×, full run tripwired at 2×. So the 2× multiplier, documented as "drift
  tripwire only", was the full-run budget by accident — and raising it for
  the full run would silently have loosened a planning budget nobody is
  hitting (55,260 B of 61,440 on 2026-09-21). Loosening a limit nobody
  decided to loosen is the exact failure this decision exists to avoid.

  *What S-1 protects.* §6 calls token budget "the point of all this": v2
  exists to kill BMAD's ~550KB-per-feature prose load, because an agent
  that loads that much prose per run behaves worse. The original target
  (≤ 60KB, ~11% of BMAD) was a policy line, not a measured degradation
  threshold. **Nobody has measured where agent behaviour degrades against
  skill-body size in this repo**, so 128 is a policy line too, and this
  entry does not pretend otherwise. It is anchored to S-1's purpose rather
  than to current size: **128KB keeps a full run at ≤ ~23% of the BMAD
  baseline — still a >4× reduction** — and accepts, explicitly, roughly 2×
  the original end-to-end target.

  *Where the line is drawn, and why there.* A budget should force a
  correctness change to *pay for itself*; it should never force one *out*.
  The two correctness changes that hit the wall on 2026-09-21 show both
  halves: devx-b6's ~900 B addition replaced stale prose to fit (−354 net)
  and my own +515 B trimmed to +142 losing nothing true — the budget working
  as designed. The failure mode is headroom *smaller than one correctness
  edit* (28 B that day), where even a true change must cut elsewhere and
  someone may cut true prose to fit. 128KB gives ~8.2KB of headroom, i.e.
  roughly 9–16 correctness-sized edits at the sizes measured that day, so no
  correctness fix has to cut elsewhere for the foreseeable queue.

  *And why not more.* The dispatcher grew 37.6KB → 67.6KB between
  2026-07-05 and 2026-09-21 (+80% in 11 weeks, ~2.7KB/week). At that rate
  8.2KB lasts about three weeks. **That is intended.** A budget sized to
  absorb the trend (~160KB would last a quarter) is margin, not a budget.
  When this binds again, the growth *rate* is what needs deciding.

  *Where the overrun actually lives.* Not spread thin: `devx.md` carries six
  arms (dispatch/execute/debug/address/retro/loop) in one file and every run
  loads all of them, against §6's "Execute per story ≤ 10KB" — the
  dispatcher alone is ~6.7× that stage target. INTERVIEW Q#9's option (b),
  load only the arm a run needs, was rejected on 2026-07-05 as trading "a
  real regression class (arm drift across files) for a symbolic 4KB". **That
  price has changed: at today's size the saving per run is tens of KB, not
  4.** Not reopened here — Leo chose to raise — but it is the lever to pull
  next time, rather than another raise.

  Enforced by `test/engine-prose-budget.test.ts`, which now gates the full
  run directly at this knob (the 2× assertion is gone) and pins that the two
  knobs stay independent. Deliberately **not** written into new projects'
  configs by `devx init`: the canary lives only in this repo's suite, so
  downstream the key would be written and never read.

## Open questions (non-blocking, tracked)

- ~~**O-1** — Mermaid in tours~~ **CLOSED 2026-08-04 (tur101)** — moot; the
  tour is retired. *(Measured 2026-07-05, v2o101 retro: real published
  single-file tours came in at 1.41MB (v2d101), 1.49MB (v2t101), 1.65MB
  (v2l101) — template 42KB, the bulk being the inlined PR diff data island.
  Kept as the size datum if a guided-review artifact is ever revisited.)*
- ~~**O-2** — Planning-PR tours~~ **CLOSED 2026-08-04 (tur101)** — moot.
- **O-3** — Focus-group / persona panel integration with the critique step:
  the `focus-group/` panel predates v2 — fold personas in as critique lenses,
  or keep as a separate FOCUS.md-driven surface? (Decide at V2.1 planning.)
  *Status (2026-07-05): V2.1 shipped the critique step with the four engine
  lenses only (pm/architect/dev/qa — first live run at v2e102: 8 accepted +
  2 rejected-with-rationale findings); the persona panel was NOT folded in
  and remains a separate FOCUS.md-driven surface. De-facto status quo held;
  still open as a deliberate future fold-in.*
- **O-4** — `/devx-test` (Layer-2 exploratory QA, v1 Phase 5): design natively
  post-V2.4; the RED gate + coverage rows may shrink its scope. The orphaned
  BMAD tea module is *not* the template for it.
  *Status (2026-07-05): still open, nothing built. The precondition is now
  real — the RED gate + expectation-coverage rows shipped (v2e101/v2e102)
  and the BMAD tea module was deleted with the ejection (PR #64), so the
  native design starts from the engine's coverage surface, as intended.*
- **O-5** — Multi-repo workstreams (one PRD spanning app + worker repos):
  out of v2; single-repo invariant holds until mobile's Worker repo forces
  the question.
- **O-6** — Token accounting source for loop budgets (harness usage events vs
  estimated-from-transcript): pick during V2.5 implementation once the worker
  spawn path exposes usage.
  *Resolved-in-practice (2026-07-05): v2l101 shipped estimates-from-output —
  worker token spend is derived from output length (~chars/4) and flagged
  `estimated: true` end-to-end (`src/lib/loop/worker.ts` → driver accounting
  → morning report renders estimated totals with a `~` prefix). Harness
  usage events remain the upgrade path if/when the spawn path exposes them;
  the flag keeps the two sources distinguishable without a migration.*
  *Upgraded (2026-07-26, debug-494590): workers spawn with `--output-format
  stream-json --verbose`; the result event's cumulative `usage` is the
  authoritative source (chars/4 under-counted by ~3 orders of magnitude —
  the budget rails could never trip). Budgets count new tokens processed
  (input + output + cache-creation); cache reads are recorded + rendered
  but excluded from the counter (INTERVIEW Q#12 tracks the unit question).
  chars/4 survives only as the flagged-estimated fallback for sessions
  that emitted no usage events.*
