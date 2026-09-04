# Expectations — GitHub-native blocker push

<!-- Gate 1 input. Every G- covered; every Covers: ID resolves in prd.md.
     P0 Verified-by targets are runnable test paths (the RED stage authors
     the failing tests at exactly these paths). -->

## E-1: A push-severity blocker updates the issue and mentions the owner, once

- **Priority:** P0
- **Covers:** G-1, G-2, UC-1, UC-3, CAP-2, CAP-3, FR-2, FR-3
- **Trigger:** `interview_filed` for `Q#99` outside quiet hours, against a
  fake `gh` transport; then the same event again on a second run with the
  blocker still open.
- **Expectation (EARS):** When a `push`-severity blocker event fires, the
  system SHALL find-or-create the pinned "devx: blockers" issue, sync its
  checklist body from `INTERVIEW.md` + `MANUAL.md`, and post exactly one
  `@owner` comment for that blocker id — and on a subsequent firing for the
  same id SHALL sync the body again but post no further comment.
- **Threshold:** run 1 → issue-create-or-find calls == 1, body syncs == 1,
  mention comments == 1. Run 2 → body syncs == 1, mention comments == 0.
  Total mentions across both runs == 1. The dedupe key is the blocker id,
  not its text: editing `Q#99`'s wording between runs still yields 0 new
  mentions.
- **Verified by:** test/notify-blocker-push.test.ts

## E-2: Non-push severities produce ZERO GitHub activity

- **Priority:** P0
- **Covers:** G-3, UC-4, CAP-1, CAP-4, FR-1
- **Trigger:** `pr_merged` (digest), `pr_opened` (silent),
  `context_rot_detected` (silent), `ci_failed` (digest) — each fired against
  a fake transport that records every call.
- **Expectation (EARS):** When an event whose configured severity is not
  `push` fires, the system SHALL make no GitHub calls of any kind — no
  issue lookup, no body sync, no comment.
- **Threshold:** transport call count == 0 for all four events. `decideNotify`
  returns `deliver: false` with a `reason` naming the severity. A channel
  that cries wolf gets muted, and a muted channel is worth less than none —
  which is why this is P0 alongside E-1.
- **Verified by:** test/notify-blocker-push.test.ts

## E-3: Quiet hours DEFER the mention, they do not drop the blocker

- **Priority:** P0
- **Covers:** UC-6, CAP-4, FR-1, FR-5
- **Trigger:** `interview_filed` at 02:00 with `quiet_hours: "22:00-08:00"`
  and `interview_filed` NOT on `quiet_hours_override`; then a later emit at
  08:30 with the blocker still open.
- **Expectation (EARS):** When a push-severity event fires inside quiet
  hours without an override, the system SHALL sync the issue body but
  withhold the `@owner` mention, and SHALL deliver that mention at the first
  emit after the window ends.
- **Threshold:** at 02:00 → body syncs == 1, mentions == 0,
  `decideNotify().defer` is a Date inside 08:00–08:01. At 08:30 → mentions
  == 1. The blocker is never silently dropped: total mentions == 1, not 0.
- **Verified by:** test/notify-blocker-push.test.ts

## E-4: An overridden event pushes through quiet hours

- **Priority:** P1
- **Covers:** UC-5, CAP-4, FR-1
- **Trigger:** `usage_cap_hit` at 02:00, with `usage_cap_hit` present on
  `quiet_hours_override`.
- **Expectation (EARS):** When an event on the override list fires inside
  quiet hours, the system SHALL deliver the mention immediately.
- **Threshold:** mentions == 1 at 02:00; `decideNotify().defer == null` and
  `reason` names the override. (A loop that has stopped is not a
  notification, it is an outage.)
- **Verified by:** test/notify-blocker-push.test.ts

## E-5: A checkbox ticked on the phone survives the next body sync

- **Priority:** P1
- **Covers:** UC-2, CAP-2, FR-2
- **Trigger:** Issue body contains `- [x] MV-pin105.1 …` (owner ticked it on
  their phone); a later sync runs while that MANUAL item is still unchecked
  in `MANUAL.md`.
- **Expectation (EARS):** When the issue body is re-synced, the system SHALL
  preserve the checked state of any item whose blocker id is already checked
  in the existing body.
- **Threshold:** the item remains `- [x]` after the sync. Without this the
  TODO surface resets itself every run and is unusable — UC-2 is the whole
  reason the transport is an issue rather than a comment.
- **Verified by:** test/notify-blocker-push.test.ts

## E-6: Transport failure never touches the run

- **Priority:** P0
- **Covers:** UC-7, CAP-5, FR-6
- **Trigger:** Each of: no `origin` remote; `gh` exits non-zero with an auth
  error; `gh` exits with a rate-limit error; the transport throws.
- **Expectation (EARS):** When the transport fails for any reason, the
  system SHALL leave the caller's control flow unchanged, SHALL record the
  failure in the run's event log, and SHALL surface it in the morning
  report.
- **Threshold:** `notify()` resolves (never rejects) in all four cases; the
  caller's return value is byte-identical to a run with notifications
  disabled; exactly 1 `notify:failed` event per failure with a reason
  string. P0 because this is a notification channel bolted onto a system
  whose job is to keep working overnight — it must not become a new way for
  that system to stop.
- **Verified by:** test/notify-blocker-push.test.ts

## E-7: The GitHub mobile app actually pushes the mention

- **Priority:** P0
- **Covers:** G-1, UC-1
- **Trigger:** A throwaway issue in this repo, an `@owner` comment, and a
  phone with the GitHub mobile app installed and notifications enabled.
- **Expectation (EARS):** When the system posts an `@owner` mention on an
  issue, the system SHALL cause a push notification to arrive on the owner's
  device within 5 minutes.
- **Threshold:** notification observed on the device; elapsed time from
  comment to buzz recorded. **This must be verified BEFORE FR-2 is built,
  not after** — the entire transport choice rests on it, and it is
  checkable in minutes. If GitHub does not push mentions on an issue the
  user themselves authored, the design changes.
- **Verified by:** evals/E-7_mobile-push-spike.md

## E-8: A real blocker reaches the phone during a real run

- **Priority:** P1
- **Covers:** G-1
- **Trigger:** A real overnight `devx loop` run that files a real INTERVIEW
  or MANUAL blocker.
- **Expectation (EARS):** When a real run files a real blocker, the system
  SHALL cause a push notification to arrive on the owner's device within 5
  minutes of the file write.
- **Threshold:** ≤ 5 minutes from the `INTERVIEW.md`/`MANUAL.md` write
  timestamp to the observed notification; the pinned issue's checklist
  matches the files; exactly 1 mention.
- **Verified by:** evals/E-8_live-blocker.md
