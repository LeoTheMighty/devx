---
hash: e5a9c0
type: plan
created: 2026-07-14T10:42:00-07:00
title: "Vision-gap Track 3 — Interim blocker push: GitHub-native notifications until the mobile relay ships"
status: ready
from: PLAN.md#vision-gap-tracks (drift audit 2026-07-14; interim slice of plan-e01000's notification-filters scope)
spawned: []
mode: YOLO
project_shape: empty-dream
thoroughness: send-it
stack_layers: [backend]
blocked_by: []
---

## Goal

When the loop files an INTERVIEW/MANUAL blocker or aborts overnight, the
owner's phone buzzes — via GitHub's own mobile push — and there is a
phone-editable TODO surface, **with zero new infrastructure**, until the
Flutter app + FCM relay (paused mobile backlog) ships and retires this.

## Why now

Drift audit 2026-07-14: the `notifications:` config block
(`devx.config.yaml` §10) has **no sender** — grep for a consumer of
`notifications.events` across `src/lib/{loop,manage,next}` returns nothing.
Blockers surface pull-only (INTERVIEW.md/MANUAL.md + morning report +
`devx next`). Owner decision 2026-07-14: GitHub issue @mention as v1
transport, doubling as the phone-editable TODO checklist; GH mobile app
provides the push. INTERVIEW Q#5's answer (push for INTERVIEW+MANUAL only,
digest the rest) is finally enforceable.

## Scope

- **`src/lib/notify/`** — small sender consuming the existing
  `notifications.events` config mapping. v1 honors `push`-severity events
  only: `manual_filed`, `interview_filed`, `usage_cap_hit` (→ loop abort /
  usage-window stuck, composes with Track 2), `agent_crashed_repeatedly`,
  `heartbeat_stale`. `quiet_hours` honored, with the existing
  `usage_cap_hit` override.
- **v1 transport = `gh`**: maintain one pinned **"devx: blockers"** issue per
  repo. Body = checklist mirroring open INTERVIEW.md questions + unchecked
  MANUAL.md items with deep links to the files on main. New blocker →
  update body + `@<owner>` comment (GitHub mobile pushes mentions). Checking
  a box / replying on the phone is the TODO surface; INTERVIEW.md itself is
  also phone-editable via github.com (it lives on main).
- **Emit points**: loop driver events (abort, blocker files written during a
  run), `reconcile()` in the manager, and morning-report finalization.
- **Explicit non-goals (v1)**: issue-comment → INTERVIEW-answer sync
  (follow-up); email/SMTP transport; any new service. The mobile relay
  (paused `d40001`–`d40007`) is the real v1 and retires this track's
  transport — the `src/lib/notify/` event seam is what the relay later
  plugs into.

## Sub-specs to spawn

To be elicited by `/devx-plan`. Sketch: notify lib + config consumption →
gh blockers-issue transport (create/find pinned issue, body sync, mention
comment) → emit-point wiring (loop + reconcile + report) → ret.

## Acceptance criteria

- [ ] Filing a test INTERVIEW entry during a loop run updates the pinned
      "devx: blockers" issue and posts an @mention comment; phone push
      received via the GitHub mobile app.
- [ ] Issue body checklist mirrors open INTERVIEW questions + unchecked
      MANUAL items with working deep links; resolved items get checked on
      the next sync.
- [ ] `digest`/`silent` events (e.g. `pr_merged`, `pr_opened`) produce no
      issue activity.
- [ ] Quiet hours suppress pushes except `usage_cap_hit` (config
      `quiet_hours_override`).
- [ ] Loop abort overnight produces exactly one mention, not a storm
      (dedupe/coalesce within a run).

## Status log

- 2026-07-14T10:42 — filed from the vision-gap drift audit (plan
  sparkling-bubbling-pie, approved 2026-07-14). Track 3 of 4. Transport
  decision (GH issue + phone-editable checklist) made by owner in-session.

## Links

- Approved drift-audit plan: `~/.claude/plans/sparkling-bubbling-pie.md`
- Config contract: `devx.config.yaml` §10 `notifications:`; INTERVIEW Q#5
- Blocker surfaces today: `src/lib/next/gather.ts` (INTERVIEW writes),
  `src/lib/manage/reconcile.ts`, `src/lib/loop/report.ts`
- Retired by: mobile Epic 4 (`dev/dev-d40001…d40007`, paused) per
  `docs/MOBILE.md`
