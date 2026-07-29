---
hash: lpf101
type: dev
created: 2026-07-26T15:57:00-06:00
title: Loop preflight main-health check
from: dev/dev-hfiret-2026-07-24T10:43-retro-harness-fold-in.md
status: done
owner: /devx-2026-07-28T0915-70985
branch: feat/dev-lpf101
---

## Goal

`devx loop` probes main's health at run start and refuses (or loudly flags)
starting a run when main is already red — a red main taxes every worker with
re-learning "that failure is baseline" and blurs the `acs_met` signal.

Evidence (hfiret retro, `LEARN.md § epic-harness-fold-in` E7): the
hfi101-induced discipline red sat on main ~a day during the epic's loop runs;
four separate hfi102 iterations re-derived the discount, and hfi104 fixed
main's red from inside an unrelated item because its own suite couldn't go
green otherwise.

## Acceptance criteria

- [x] Loop entry runs a cheap main-health probe before claiming any item.
      Cheapest sufficient signal (implementer's choice, justify in status
      log): last remote-CI conclusion on `main` via `gh run list --branch
      main --limit 1` — do NOT run the full local suite (~7 min) as preflight.
- [x] When main is red: default behavior is refuse-with-reason (report names
      the failing run/commit); a `--force` / config knob permits starting
      anyway, in which case the morning report and every iteration prompt
      carry a "main is red at <sha>: <failing check> — treat as baseline"
      line so workers don't re-derive it.
- [x] When the probe itself fails (gh auth/network), the loop proceeds but
      records the unknown-health state in the report (uncertainty must not
      block an overnight run, per the failure-ladder philosophy).
- [x] Tests: red-main refusal, forced-start baseline line threading,
      probe-failure passthrough.

## Technical notes

- Home: `src/lib/loop/` (entry/preflight), config under `loop:` in
  `devx.config.yaml` + `docs/CONFIG.md` row.
- Sibling of the dc7514 sleep-aware ceiling work — same "the loop must model
  its substrate honestly" class.

## Status log

- 2026-07-26T15:57:00-06:00 — filed by hfiret retro (E7, med/code).
- 2026-07-28T09:15:51-06:00 — claimed by /devx in session /devx-2026-07-28T0915-70985
- 2026-07-28T09:30:00-06:00 — phase 2: spec ACs direct (v2 native); 4 ACs; workstream=none; red-artifacts=none.
- 2026-07-28T09:40:00-06:00 — phase 3: implemented src/lib/loop/preflight.ts (probeMainHealth + baseBranchFrom + baselineLine + describeMainHealth), `loop.preflight_main_health` knob (refuse|warn|off, default refuse) in loop/config.ts + config-schema + docs/CONFIG.md, driver wiring (probe before dry-run/lock, exit 5 refusal, forced-start warning, baseline threaded into RunItemArgs → buildIterationPrompt `## Baseline warning` section, summary.mainHealth → morning-report header), `--force` on the loop CLI, and the skill-body Stage: Loop 1.5 bullet (mirror synced). Probe-shape justification (AC #1 asks): `gh run list --branch <base> --limit 15` folded to the NEWEST run per workflow, NOT `--limit 1` — arci1 proved a green sibling workflow shadows a red one when only the newest run is consulted; a workflow's own newer green still forgives its older red. Red = {failure, timed_out, startup_failure, action_required}; cancelled/skipped prove nothing; probe failure/empty/in-flight ⇒ unknown ⇒ proceed (uncertainty never blocks the night). Motivating incident: palateful loop-2026-07-27T17-03 — 8 attempted, 0 merged, 5 handed off, all red on main's own inherited pytest break.
- 2026-07-28T09:50:00-06:00 — phase 4: single-pass adversarial review (surface < 500 changed lines); 3 findings (0 HIGH, 2 MED, 1 LOW): (MED) probe originally ran before flag validation — moved after so bad flags still exit 4 without a gh call; (MED) config-schema `additionalProperties: false` would have rejected the new key in user configs — schema updated + smoke-tested; (LOW) dry-run needed the would-refuse NOTE or a red-main dry run silently implies a real run would start. ALL fixed in-place; re-review clean.
- 2026-07-28T09:52:00-06:00 — phase 5: local gates green — typecheck clean; vitest 2346 passed / 23 skipped incl. new test/loop-preflight.test.ts (19 tests); schema-smoke + config-io + config-validate pass; skills mirror synced (sync-skills). One strict-equality fixture in loop-config.test.ts extended for the new key.
- 2026-07-29T10:15:00-06:00 — phase 7: merge tail resumed in a fresh session
  (branch had sat ~24h while mlc104/mlc105/mss101–104/mlc106 landed; PR #90
  went CONFLICTING/DIRTY). Two `git merge origin/main` rounds, 10 conflicts
  total, ALL additive — lpf101's preflight and mlc105's instance registry +
  mlc106's scope model touch the same structures without contending.
  Round 1 (vs 391d073, 7 conflicts): `LoopFlags.force` alongside
  `scope`; the mlc105 admission block replaced the `manager.lock` acquire
  lpf101 still assumed, so the preflight refusal was ordered BEFORE
  admission — a red-main exit 5 must not consume a capacity slot or
  register an instance; `mainHealth` folded into the `loop:start` event
  mlc105 had rewritten with `runId`/`scope`. Round 2 (vs 78a10b6,
  6 conflicts): mlc106 renamed the event's `scope` → `scopeDescriptor`,
  so `mainHealth` was added to main's naming rather than reinstating the
  old key; `mainRedBaseline` + `focus` coexist in buildIterationPrompt;
  `RunSummary` carries both field groups; skill body gained `--force` on
  the entry line with `1b.` scope then `1.5.` preflight. Skill-body edits
  were made ONLY to `.claude/commands/devx.md` and mirrored via
  `npm run sync:skills` (test/skills-sync.test.ts fails on any drift).
  Local gates after round 2: typecheck clean; vitest 131 files / 2662
  tests passed. Remote CI green at 72ecf59 (run 30469618457, headSha
  verified against branch tip).
- 2026-07-29T10:16:00-06:00 — phase 8: check-hold {"hold":false} +
  `devx merge-gate lpf101` {"merge":true} re-run against the post-merge
  diff (the pre-merge green did not carry). merged via PR #90
  (squash → 7b08627).
