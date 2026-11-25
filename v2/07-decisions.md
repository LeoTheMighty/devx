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
  *Evidence (2026-09-21): Leo approved 128KB (relayed by the coordinator
  session) and PR #168 merged as 8ad6324. **He approved it with the ~three-week
  horizon explicitly in view**: at the observed growth rate this budget
  binds again around mid-October, and that is the intended moment to decide
  Q#9 option (b) — load only the dispatcher arm a run needs — not a surprise
  and not a cue for another raise. The `[user]` marker stays until Leo flips
  it himself, per D-2's precedent.*
  *Lever pulled (2026-11-20, branch `feat/harness-devx-md-arm-split`): the
  budget bound at 131,045 B (27 free) with two streams queued behind it, and
  option (b) was taken instead of a raise — each `devx.md` arm became its own
  body beside the dispatcher. Neither knob moved. The full run stays charged
  for the Execute and Retro bodies (both §6 rows of a full feature run); only
  the debug, loop and outcome arms left the sum, which fell to 126,992 B. The
  lever is spent: what remains counted is what a full run loads.*

- **D-15 [user] (2026-09-25, `plan-47b842`)** — *`devx loop` is **frozen**,
  not retired.* Leo's decision, after a measured scope review prompted by the
  orchestrator standing up: an orchestrator that dispatches to live Claude
  Code tabs makes the unattended loop much less important, so the question
  was whether to scrap it. The answer is to stop investing without deleting.

  *What the measurements said.* 9,003 source lines (14.2% of `src/`;
  `driver.ts` alone 3,340) plus ~9,666 test lines. Nine runs, 2026-07-15 →
  2026-08-19, then idle. 32 items attempted, 20 merged, 6 abandoned, 3 handed
  off, 2 claim-failed; one run aborted on the systemic-failure ladder having
  merged nothing. No open loop bug today (all 18 loop debug specs closed).
  Nothing outside `src/lib/loop/` depends on it except two call sites that
  merely *report on* it (`devx status`, `devx next`); every shared primitive
  (merge-gate, await-remote-ci, pr-body, graph regen, claim/finalize) lives
  outside `loop/` and would survive its removal.

  *Why frozen and not scrapped.* The cost is already paid — tested, quiet,
  blocking nothing — so deletion buys simplicity, not velocity. And the one
  capability that dies has no replacement: an orchestrator dispatching to
  tabs is **attended by construction**, so overnight work and work nobody
  wants to watch have nowhere else to go. The argument for scrapping (a
  session-liveness lease system has no clean handle on a loop worker) is
  real, and was also the convenient answer: devx's tree contains **zero**
  references to the orchestrator, which has not yet earned the right to set
  devx's scope. Freezing lets the lease design exclude loop workers now
  without foreclosing anything.

  **What "frozen" obliges — read this before assuming anything.**
  1. **The code stays shipped.** `devx loop` and its subcommands remain in
     the CLI. Nothing is deprecated, nothing prints a removal warning.
  2. **It stays gated.** Every `test/loop-*.test.ts` keeps running in `npm
     test` and in CI. A change elsewhere that reddens a loop test is a
     regression to fix, not a frozen subsystem to skip.
  3. **It stays reported.** `devx status` and `devx next` keep rendering loop
     instances and `state.json` debris warnings. Freezing does not make the
     loop invisible.
  4. **No new loop work is claimed.** PLAN.md Tracks 2 (`c8e2d4`) and 4
     (`f1d6b2`) are `[-]`, blocked on the revisit rather than a dependency.
     Bug fixes that keep it honest are still in scope; features are not.
  5. **Before trusting it, a future reader checks three things:** whether
     `.devx-cache/loop/` holds a run newer than **2026-08-19** (as of this
     entry, nothing does); that the `loop-*` tests still pass; and that the
     surfaces it drives have not moved under it — the `/devx` skill body and
     the merge tail have both changed since the last real run (the plan-scope
     hand-off landed 2026-09-22, PR #175). **A green test suite is not
     evidence of a working overnight run**; the last observed end-to-end
     behaviour is 2026-08-19.
  6. **Known defect, deliberately left filed rather than fixed here:**
     `finalizeInstance` (`src/lib/loop/driver.ts:1342`) is straight-line
     after the item loop rather than in a `finally`. The exposure is narrow —
     the item loop's own `try/catch` converts any throw into `abortReason`
     and `writeMorningReport` has its own `try`, so only the ~60 lines of
     summary construction between them can escape — but it is real, and a
     frozen subsystem should still be correct.

  *The revisit is a date and a rule, not an intention.* **2026-11-24.** If
  the loop has still not run by then, scrap it then — that is the agreed
  rule, recorded now so nobody re-litigates it from scratch.

  *What would reverse this decision early.* If the lease design turns out to
  need loop *support* rather than loop *exclusion* — i.e. if refusing
  non-interactive workers is not implementable — the loop is imposing live
  cost on shipped work, and shrinking it to the parts an orchestrator reuses
  (`usage-window`, `usage-governor`) becomes right immediately. Related and
  unsettled: nothing in the orchestrator writes a session's `kind`, so
  whether a loop-spawned `claude -p` registers at all is **undetermined**;
  if it does not, loop workers are invisible for a simpler and worse reason
  than the `kind` filter at `registry.py:25`.

- **D-16 [user] (2026-09-25, `plan-47b842`)** — *The mobile companion is
  **retired**, not paused, and `docs/MOBILE.md` + `mobile/` are deleted.*
  Leo's decision, taken alongside D-15 and deliberately separate from it.

  *What was there.* `mobile/` was a Flutter scaffold and nothing more: 12
  Dart files, 469 lines, two commits (`a10001` scaffold + nav shell,
  `a10002` Riverpod/theme/router), both 2026-04, nothing since. `worker/` —
  the Cloudflare relay named by Epic 4 and listed in CLAUDE.md's layout —
  **was never written at all**. `docs/MOBILE.md` was 376 lines of contract
  for an app that never reached it. DEV.md had said PAUSED since 2026-07-14.

  *Why retired rather than paused again.* A pause is a claim that work
  resumes. Five months and a superseding architecture (the orchestrator) say
  otherwise, and "paused" was quietly costing: a `mobile` project row in
  `devx.config.yaml` pointed the touched-surface gate at `flutter analyze`
  in a repo with no Flutter toolchain step in CI, a `worker` row pointed at
  a directory that does not exist, and CLAUDE.md described both as part of
  the repo. Unlike the loop (D-15), mobile **never produced anything** —
  there is no "it worked 20 times" on the other side of the ledger.

  *What was deleted, and what was kept.* Deleted: `mobile/`,
  `docs/MOBILE.md`, the `mobile` and `worker` rows in `devx.config.yaml`,
  and the `ui.mobile` settings block (no reader). **Kept for audit:** all 26
  `dev-a10*` / `b20*` / `c30*` / `d40*` specs, `plan-7a2d1f`,
  `plan-a03000` and `test-c98aee` — marked `status: deleted`, with their
  backlog rows struck rather than removed, per the `~~…~~` convention. The
  two merged PRs (#76, #77) stay in history.

  *One knock-on, recorded because it is easy to miss.* Track 3's interim
  GitHub blocker-push notifier was retired 2026-09-04 **on the promise of
  Epic 4's mobile relay**. That relay is now retired too, so blocker push
  has no owner in either direction. This decision does not resurrect it; if
  it matters, it is new work with a live owner.

  *Reviving mobile is a new plan, not an unpause.* Nothing here forbids a
  phone client; it says this one is over. The retired specs are the record
  of what was intended, and a revival should re-derive its scope from the
  system as it is then, not inherit a 2026-04 backlog.

- **D-17 [user] (2026-11-20, `feat/prose-budget-62`)** — *This repo's S-1
  planning budget, `engine.prose_budget_kb`, goes from 60 to 62.* The full-run
  knob stays at 128, and the shipped default (`ENGINE_DEFAULTS.proseBudgetKb`,
  `02-engine.md` §7) stays at 60, so downstream repos are not moved by this
  repo's growth. **The decision is Leo's.** D-14 deliberately left this knob
  unchanged and put its direction with him: "raise it deliberately, as its own
  reviewed change". He chose this out of four options: raise the knob, trim
  the two incoming templates, land only one of the two streams, or cut
  unrelated template prose.

  *What forced it.* On main `0892be9` the planning sum (every `.md` under
  `_devx/templates/engine/` plus `/devx-plan`) measured 58,329 of 61,440 B,
  and the full run measured 126,992 of 131,072. Two harness-port PRs add to
  the planning sum. #183 (holistic review) adds +1,273 B; #184 (measurable
  goals) adds +2,333 B. Either fits alone. Together they put planning at
  61,935 B, 495 over 60 KB, and the full run at 130,598 (474 free). At 62 KB
  (63,488 B) both land with 1,553 B of planning headroom.

  *Arithmetic worth keeping straight.* #184's Outcome-stage hunk moves to
  `devx-outcome.md` on rebase. Neither that body nor `devx.md` is in the
  planning sum, so the move changes only the full run: 474 B free with it,
  44 B without. Planning is 495 over 60 KB either way.

  *Why this is not a raise standing in for work not done.* D-14 named the
  full-run lever, Q#9 option (b), and said a binding budget should pull it
  rather than raise. That lever was pulled first, the same day (PR #186):
  `devx.md`'s arms became their own bodies, freeing 4,053 B of full-run
  headroom with the Execute and Retro bodies still counted. The planning sum
  is a different surface. Nothing in the dispatcher could reach it, so there
  was no lever left to pull before deciding.

  *Why the planning surface is where the growth belongs.* The bytes pressing
  on it are artifacts the harness port exists to add: `review.md`,
  `evals/eval.md`, `questions.md`, the reworked `decision.md`, and Stream 4's
  research templates still to come. They are scaffolds agents fill, the
  engine's outputs, not a skill body that grew by restating itself. A budget
  that forced them out would be cutting the work the port was commissioned
  to do.

  *What the number is, and is not.* 62 is a policy line, like 60 and 128
  before it. D-14 already recorded that the original 60 KB was "a policy
  line, not a measured degradation threshold", and nobody has yet measured
  where agent behaviour degrades against prose size in this repo; this entry
  does not pretend otherwise. 62 KB keeps the planning surface at ~11.3% of
  BMAD's ~550 KB per-feature load (from ~10.9%). It is sized to land the two
  queued PRs with a margin of about one small template, not to absorb a
  trend. Stream 4 has not been measured against it, and if it does not fit,
  that is the next decision.

  *What is still true after the raise.* Every engine template stays counted
  (recursive walk, no exclusions). The two knobs stay independent (pinned in
  `test/engine-prose-budget.test.ts`). Every `.claude/commands/*.md` must be
  either counted or named in `OFF_THE_FULL_RUN` with a reason (the #186
  guard), so neither sum can be eased by moving prose into a new skill body.
  The next time either budget binds, it is a decision again — a cut, or a
  raise with its own reviewed record — never a habit.
  *Evidence (2026-11-20): Leo approved 62 KB. The coordinator session relayed
  it, and he confirmed it directly in the session that made this change. The
  `[user]` marker stays until Leo flips it himself, per D-2's precedent.*

- **D-18 (locked, 2026-11-24, `feat/workstream-split-combine`)** — *A
  workstream splits or combines by **retirement and re-earning**. No gate
  verdict crosses either operation, and either one refuses rather than
  guesses.* **This decision is the implementing session's, not Leo's.** It
  needs no sign-off because nothing in it loosens anything: every rule below
  either refuses or resets. Leo can overturn any refusal with a later entry.
  The primitives are `devx workstream split <hash> --into <a>,<b>[,…]
  --partition <file>` and `devx workstream combine <into-hash> <from-hash>`.
  Their pure core is `src/lib/engine/lifecycle.ts`, with all IO in
  `src/commands/workstream.ts`. `test/workstream-lifecycle.test.ts` pins
  them, and every refusal there asserts that the whole fixture tree is
  byte-identical afterwards.

  *The one rule.* A verdict is a claim about one artifact body. Both
  operations change an expectation set, and §4.9's cascade says an
  expectations change resets all four flags. So no verdict survives onto the
  new scope, and nothing is "carried with care".

  *Split.* The parent is **retired, not shrunk**: it gets `stage: retired`,
  `status: superseded`, `spawned: [children]`, a status-log line and
  `decisions/<date>-split.md`. Everything else in it stays byte-identical
  where it is: verdicts, `decisions/`, `checkpoints/`, outlines, digests and
  `questions.md`. History is never rewritten, and every link to it keeps
  resolving. Each child is exactly the `devx workstream new` scaffold (stage
  `prd`, every flag false, no `gate_verdicts:`, no lock), plus:
  - `expectations.md`: exactly the E-blocks the partition assigns to it,
    byte-identical, with their E-ids kept. A block assigned to two children
    is copied into both, and each child's gates must pass it separately.
  - `from:` pointing at the parent spec, and the parent's whole
    `blocked_by:`. Dropping an INTERVIEW blocker would let a child pass a
    Gate 1 its parent could not.
  - `decisions/<date>-split-from-<parent>.md`, listing:
    - its E-ids
    - the PRD IDs those E-ids Cover, which it must now define
    - the parent PRD's path
    - the eval targets it must re-author
    - the phases the parent already shipped, which Gate 4 will want waived
  - The **template** `prd/agent.md`, not a copy of the parent's. A copied PRD
    would keep the sibling's UC-/CAP-/FR- items. Gate 1 tolerates those as
    orphans, and Gate 2 would then demand that the child design them. With
    Covers copied verbatim, Gate 1 forces the child's PRD to define its own
    IDs (`covers-id-dangling`) and only its own goals (`goal-uncovered`).
  - No design, plan or evals. By §4.9, an expectations change invalidates
    both downstream stages.

  *Who partitions.* The partition comes from a human or a judgment skill,
  never from the CLI. `--partition` is required. Without it the command
  refuses, writes nothing, and prints a template listing every E-id with its
  Covers and Verified-by, for someone to fill in. The CLI only validates the
  partition. Every E-id must be assigned. Unknown E-ids and children are
  refused. Every child must get at least one E-id, and there must be at
  least two children.

  *Combine.* `<into>` survives and **absorbs** `<from>`. The absorbed side is
  retired exactly as a split parent is, and also gets `superseded_by:
  <into>`. The survivor goes through the `expectations.md` cascade via
  `computeRevise`: all flags false, verdicts null, stage back to `prd`. Its
  `blocked_by` becomes the union of both sides'. The absorbed E-blocks are
  appended **re-keyed**. Each E-id is renumbered past the highest one the
  survivor uses, and so is every G-, UC-, CAP- and FR- ID in their Covers.
  That is necessary, not tidy: Gate 1 never checks for duplicate IDs, so a
  verbatim append would let the absorbed `G-1` count as coverage of the
  survivor's unrelated `G-1`. A fresh ID dangles instead, and the survivor
  fails Gate 1 until someone defines it in the survivor's PRD. Both sides'
  records carry the ID map, with the absorbed PRD's text for each ID.
  Expectations with identical text are reported as likely duplicates and
  never merged, because deciding that two expectations are the same is
  judgment.

  *Refused, by either operation, with the tree byte-identical.* In each of
  these states the mechanical answer would be wrong:
  1. **A closed RED stage**: `evals_red`, `evals_locked`, or any
     `red_eval_shas`/`red_eval_ids` entry. The lock proves that *these* P0s
     failed before *this* work was built. If the lock were divided, a child
     would hold a stamp over evals it does not own. If a child had to
     re-earn it, a P0 that is already built could never be observed RED.
     `devx revise <hash> --touched plan` is the only sanctioned way to clear
     a lock, so a post-RED split goes through it first. Neither operation
     ever clears, carries or retires a lock.
  2. **A live emitted dev spec**: one whose `plan:` names either workstream
     and whose status is anything but `done`, `deleted` or `superseded`.
     - An in-progress spec holds a claim, a worktree and an open PR whose
       body cites the old plan. D-12 gives a phase exactly one home, and the
       CLI cannot pick which child that is.
     - A ready spec would become claimable against a retired or reopened
       plan.
     - Shipped specs stay with their workstream and are **never
       re-pointed**. Gate 4's shipped-green deferral keys on the `phase:`
       *number*. Re-point a parent's done phase 2 at a child, and the child's
       gate would defer whatever the child calls phase 2: a P0 passing that
       nobody built.
  3. **An unsettled dependent**: a spec whose `blocked_by` names the
     retiring plan. `superseded` counts as a settled blocker
     (`next/gather.ts`), so retiring the plan would make the dependent
     runnable for work that has not shipped. The fix is to re-point the
     dependent, and which child it waits on is judgment.
  4. **Parked human entries** (open and not `gate-concern`) in the retiring
     side's `questions.md`, or a `questions.md` that does not parse. Once
     retired, the workstream leaves the health queue, so those entries would
     go dark. Which child owns each one is judgment. Gate concerns pass
     through: the children's own gates re-derive them.
  5. Four more states with no mechanical answer: an outcome in flight, a
     stage of `done` or `retired`, unreadable frontmatter (D-13), and
     `engine.docs_layout: project-level`. That layout holds one doc set, so
     neither operation fits it.
  6. **Expectations that cannot be carried faithfully**:
     - a missing file, or one with no E-blocks
     - a duplicated E-id
     - an `## E-n` heading the parser would skip, so its block would vanish
       silently
     - for combine only, a workstream-local `Verified by: evals/<f>` whose
       path already exists in the survivor: the survivor's gate would run
       its own file for the absorbed expectation
  7. A child slug that is already taken, a decision-record path that is
     already taken (records are never overwritten), and a workstream asked
     to absorb itself. That last case includes two plan specs that claim
     one directory.

  *The contract callers build against* (a router included).
  - **Exit codes.** `0` means done, or a `--dry-run` that printed its plan.
    `1` means refused, and nothing was written. `2` means a usage, config
    or resolution error, or a write that failed after some files had
    landed; the message then names every file that did.
  - **A refusal** prints one JSON line on stdout: `{ "refused": true,
    "refusals": [{ "code", "message", "paths"? }], "template"? }`. It
    reports every refusal the state has earned, not only the first.
  - **`code`s are stable identifiers**, the `LifecycleRefusalCode` union in
    `lifecycle.ts`. A caller branches on the code, never on the prose.
  - **`partition-required`** carries `template`, which maps every E-id to
    `[]` and comes with a catalog (name, priority, Covers, Verified by).
    Fill it in and pass it back as `--partition`.
  - **Success JSON** has its keys in snake_case. Each split child reports
    `expectations`, `shared`, `covers_to_define`, `eval_targets`,
    `shipped_in_parent` and `record`. Combine reports `expectation_map`,
    `id_map`, `likely_duplicates`, `not_carried` and `eval_targets`. Both
    report `backlog_rows`, `warnings` and `graph`.
  - **`eval_targets`** names each carried `Verified by:` that will not
    resolve as written at its destination. A `local` target (`evals/<f>`)
    names a file the destination does not have yet. A `foreign` target is a
    repo path into another workstream's directory, which is how this repo's
    own story-graph expectations spell theirs.

  *Deliberately not done.* Neither operation copies eval artifacts, edits
  backlog rows, re-points dependents, moves dev specs, carries gate concerns
  or writes a `blocks` edge:
  - Children and the survivor re-author their evals at their own RED stage,
    from the paths in the records.
  - A retiring spec's PLAN.md row is reported for striking, not struck.

  GRAPH.md is regenerated, warn-and-continue as at claim and mark-done, so
  `devx graph --check` sees the new specs and their lineage edges.

  *A known adjacent exposure that this does not introduce.* Combine reopens
  a survivor with shipped phases exactly as `devx revise --touched
  expectations.md` does. If the re-authored plan then renumbers its phases,
  it meets the same phase-number keying as rule 2. Combine lists the
  survivor's shipped phases, and it reaches no state that `revise` cannot
  already reach.

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
