# PRD — GitHub-native blocker push

<!-- Stage: PRD. Gate: `devx gate prd e5a9c0`. Every concrete item gets a
     stable ID (G-/UC-/CAP-/FR-). IDs are never renumbered. Seed:
     owner-approved drift-audit plan (~/.claude/plans/sparkling-bubbling-pie.md
     § Track 3, approved 2026-07-14) + plan/plan-e5a9c0 § Scope. Code facts
     re-verified 2026-08-21. -->

## Problem

The loop can block on a human at 3am and the human finds out at 9am.

`devx.config.yaml` §10 declares a full `notifications:` block — channels,
per-event severities, quiet hours, an override list — and **nothing reads
it**. Verified 2026-08-21: the only `notifications` references in `src/` are
in `init-questions.ts`, which *writes* the block at init time. There is no
sender. So INTERVIEW Q#5's answer ("push for INTERVIEW + MANUAL only, digest
the rest") has been recorded as configuration and never enforced.

Today every blocker surface is **pull-only**: `INTERVIEW.md` / `MANUAL.md` on
disk, the morning report, and `devx next`. All of them require the owner to
come looking. An overnight run that files an INTERVIEW at 01:00 and then has
nothing else it may legally do sits idle for eight hours — not because the
question is hard, but because nobody was told it existed.

The real fix is the mobile companion (Flutter app + FCM relay, `d40001`–
`d40007`), which is **paused**. This workstream is the interim: the owner
decision of 2026-07-14 is to use GitHub's own mobile push as the transport,
which costs **zero new infrastructure** — `gh` is already a hard dependency
of the merge path, and the GitHub mobile app already pushes @mentions.

## Goals

<!-- Numeric + dated so `devx outcome` can score them. -->

- **G-1**: By 2026-09-15, an INTERVIEW or MANUAL blocker filed during a loop
  run reaches the owner's phone in **≤ 5 minutes**, measured from the file
  write to the GitHub notification, on ≥ 1 real overnight run.
- **G-2**: By ship, **0** notification storms: a single loop run produces at
  most **1** @mention comment per distinct blocker, verified across the fake
  suite and the G-1 live run's issue history.
- **G-3**: By ship, **100%** of `silent`/`digest`-severity events produce
  **zero** GitHub activity — no issue edits, no comments. A notification
  channel that cries wolf gets muted, and a muted channel is worth less than
  none.

## Non-goals

- **Issue-comment → INTERVIEW-answer sync.** Replying on the phone does not
  write the answer back into `INTERVIEW.md`. That is a follow-up; v1's TODO
  surface is read-and-check, plus `INTERVIEW.md` itself being editable at
  github.com because it lives on `main`.
- **Email / SMTP transport.** The `channels:` block declares an email
  channel; v1 implements the `gh` transport only and leaves email an
  unimplemented channel kind, honestly reported as such.
- **Any new service.** No relay, no daemon, no webhook receiver. If v1 needs
  infrastructure, v1 is wrong — the mobile relay is the version that gets
  infrastructure.
- **Retiring `notifications.channels`.** The mobile relay will consume the
  same event seam; this workstream must not design it out.
- **Digest delivery.** `digest_schedule: daily-09:00` stays unimplemented in
  v1. Only `push`-severity events get a transport.

## Users

- **Primary**: Leo (owner), asleep, with a phone, while `devx loop` runs.
- **Secondary**: the paused mobile relay (`d40001`–`d40007`), which will
  plug into the same `src/lib/notify/` event seam and retire the `gh`
  transport beneath it.
- **Anti-persona**: a repo with no GitHub remote, or a user with no GitHub
  mobile app. v1 must degrade to today's behavior for them, loudly enough to
  be diagnosable and quietly enough not to fail a run.

## Use cases

- **UC-1**: The loop files an INTERVIEW question at 01:00. The pinned
  "devx: blockers" issue gains the question as a checklist item and the
  owner is @mentioned. Their phone buzzes.
- **UC-2**: The owner wakes at 07:00, opens the issue on their phone, reads
  the checklist, and checks off a MANUAL item they have just done. The
  checkbox state is the TODO surface.
- **UC-3**: The same blocker is still open on the next run. The issue body
  is refreshed, but **no second @mention** — the owner was already told.
- **UC-4**: A `pr_merged` (digest) or `pr_opened` (silent) event occurs.
  Nothing happens on GitHub at all.
- **UC-5**: `usage_cap_hit` fires at 02:00, inside quiet hours. It pushes
  anyway — it is on `quiet_hours_override`, because a loop that has stopped
  is not a notification, it is an outage.
- **UC-6**: `interview_filed` fires at 02:00, inside quiet hours and NOT on
  the override list. The issue body is updated (so the morning view is
  correct) but the @mention is withheld until quiet hours end.
- **UC-7**: The repo has no GitHub remote, or `gh` is unauthenticated. The
  loop continues unaffected; the failure is recorded in the run's event log
  and the morning report, not raised.

## Capabilities

- **CAP-1**: Consume the existing `notifications` config — severities,
  quiet hours, override list — as the single source of truth for what is
  worth waking someone over.
- **CAP-2**: Maintain one pinned "devx: blockers" issue per repo as a
  living checklist mirroring open INTERVIEW questions + unchecked MANUAL
  items, with deep links to the files on `main`.
- **CAP-3**: Deliver a push by @mentioning the owner, exactly once per
  distinct blocker.
- **CAP-4**: Suppress everything not `push`-severity, and defer (not drop)
  pushes during quiet hours unless overridden.
- **CAP-5**: Degrade safely — a missing remote, an unauthenticated `gh`, a
  rate limit, or an API outage must never fail a loop run or a manage tick.
- **CAP-6**: Expose an event seam the mobile relay can later consume in
  place of the `gh` transport.

## Feature requirements

### FR-1: `src/lib/notify/` — the event seam and the policy

`NotifyEvent` (kind + payload) and `decideNotify(event, config, now)` →
`{ deliver: boolean; defer: Date | null; reason: string }`. **Pure.** The
policy — severity lookup, quiet-hours window, override list — is entirely
decidable without I/O, so all of G-3 and the quiet-hours behavior is unit
testable. `reason` is always populated, including on `deliver: true`, so a
run's event log can say *why* something was or was not sent.

### FR-2: The `gh` transport

`ensureBlockerIssue(repo)` finds-or-creates the pinned issue by a stable
title; `syncBlockerBody(issue, blockers)` rewrites the checklist;
`mentionOwner(issue, blocker)` posts the @mention comment. All three go
through `gh` — no new HTTP client, no token handling, no new dependency.

Body composition is **derived from `INTERVIEW.md` + `MANUAL.md`**, not
accumulated: the issue is a projection of the files, so it cannot drift from
them. Checkbox state the owner sets on the phone is preserved across syncs
by matching on the blocker's stable id (UC-2 depends on this).

### FR-3: Exactly-once mention, per blocker

A durable record under `.devx-cache/` of which blocker ids have been
mentioned. A blocker still open on a later run refreshes the body but does
not re-mention (UC-3, G-2). The dedupe key is the blocker's id (`Q#14`,
`MV-pin105.1`), not its text — an edited question is still the same
question.

### FR-4: Emit points

Three, and no more: the loop driver's blocker-file writes and abort path,
`reconcile()` in the manager, and morning-report finalization. Each calls
`notify(event)` and ignores the result — a transport failure is the
transport's problem, never the caller's.

### FR-5: Quiet-hours deferral, not suppression

Inside quiet hours a non-overridden push **updates the issue body but
withholds the @mention**, and the mention is delivered at the next emit
after the window ends. Deferral rather than suppression, because a blocker
the owner never hears about is exactly the failure this workstream exists to
remove — the quiet-hours setting is about *when* to buzz, not *whether*.

### FR-6: Safe degradation

Every transport call is wrapped. No remote, no `gh` auth, a rate limit, an
outage: the loop and the manage tick proceed, the failure is evented and
appears in the morning report. **CAP-5 is a hard requirement**: this is a
notification channel bolted onto a system whose job is to keep working
overnight, and it must not become a new way for that system to stop.

### FR-7: Config honesty

`docs/CONFIG.md` §10 gains a per-knob "implemented in v1?" column. The
`channels:` email kind, `digest_schedule` and `context_rot_detected` are
documented as **declared but not yet delivered**, because a config block
that looks implemented and is not is exactly the defect this workstream
started from.

## Evals seed

- `interview_filed` at 02:00, not overridden → body updated, mention
  withheld; after 08:00 → mention delivered.
- `usage_cap_hit` at 02:00 → mention delivered immediately (override).
- `pr_merged` / `pr_opened` → zero GitHub calls of any kind.
- Same blocker across two runs → 1 body sync each, exactly 1 mention total.
- Checkbox ticked on the phone → survives the next body sync.
- No remote / `gh` unauthenticated / rate-limited → loop unaffected, failure
  evented and reported.
- Live: a real blocker filed during a real overnight run reaches the phone
  in ≤ 5 minutes.

## Open questions

- **Who is "the owner"?** `gh api user` at send time, the repo owner from
  the remote, or a new config key? Leaning: derive from the remote and allow
  an override, so a fresh clone needs no configuration — owner: design.
- **Issue vs Discussion.** A pinned issue is simpler and `gh` supports it
  fully; Discussions have better threading for the eventual answer-sync
  follow-up. Leaning: issue, because the follow-up is a non-goal and
  reversing later costs one migration — owner: design.
- **Does the GitHub mobile app actually push @mentions on an issue the user
  authored?** The whole transport rests on this. It is checkable in minutes
  with a throwaway issue and must be verified **before** FR-2 is built, not
  after — owner: design stage, as a spike.

## Reference links

- Spec: `plan/plan-e5a9c0-2026-07-14T10:42-blocker-push-interim.md`
- Owner-approved plan: `~/.claude/plans/sparkling-bubbling-pie.md` § Track 3
- Config contract: `devx.config.yaml` §10; `docs/CONFIG.md` §10
- Provenance: INTERVIEW Q#5 (push for INTERVIEW + MANUAL only)
- Retired by: mobile Epic 4 (`dev-d40001`…`d40007`, paused) per `docs/MOBILE.md`
- Blocker surfaces today: `src/lib/next/gather.ts` (INTERVIEW writes),
  `src/lib/manage/reconcile.ts`, `src/lib/loop/report.ts`
- Composes with: `c8e2d4` (`usage_cap_hit` is the usage-window governor's
  abort event)
