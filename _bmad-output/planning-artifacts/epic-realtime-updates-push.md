<!-- refined: party-mode 2026-04-23 -->

# Epic — Real-time updates (bidirectional)

**Plan:** `plan/plan-7a2d1f-2026-04-23T13:00-mobile-companion-v01.md`
**Slug:** `epic-realtime-updates-push`
**Order:** 4 of 4
**User sees:** "My phone buzzes the instant an agent needs me; my laptop picks up phone-added items within seconds."

## Overview
Close the loop with real-time bidirectional sync. The Cloudflare Worker (`worker/`) receives GitHub webhooks, verifies signatures, fans out to FCM for mobile push. Phone-side: `firebase_messaging` registers tokens with the Worker and handles incoming pushes. Laptop-side: optional fast-path webhook receiver via Cloudflare Tunnel triggers immediate Triage pickup on pushes to `develop` — MVP polls every 30s; fast-path is a story if budget allows.

## Goal
Every signal that matters — a new INTERVIEW question, a MANUAL action, a PR to review, a CI failure, a phone-added item — reaches the other side in under 10 seconds.

## End-user flow
1. An agent on Leonid's laptop writes a new INTERVIEW question into `INTERVIEW.md`, pushes to `develop`.
2. GitHub webhook fires; Cloudflare Worker receives, verifies HMAC, filters (was INTERVIEW.md touched?), calls FCM.
3. APNs delivers a push to Leonid's iPhone within ~5 seconds.
4. Notification shows "New question: <text>". Leonid taps "Reply" inline, types an answer, submits.
5. App writes the answer via Contents API; within 30s Triage polls and unblocks the waiting spec file.
6. Conversely: Leonid taps (+) on his phone, submits an item. The commit lands on `develop`; GitHub fires `push` webhook; Worker relays to laptop's local fast-path endpoint (if configured); Triage tick fires immediately instead of waiting.

## Frontend changes
- `lib/core/push/` — `firebase_messaging` integration, token registration, foreground + background handlers, notification categories.
- Deep-linking: tap a notification → navigate to the relevant screen (INTERVIEW → answer field pre-focused; PR → in-app webview of PR).
- Inline-reply notification action for INTERVIEW (iOS-specific).
- Badge count logic (Inbox-relevant items).

## Backend changes (Cloudflare Worker, net-new)
- `worker/` directory inside devx repo: `wrangler.toml`, `src/index.ts`, `package.json`.
- Webhook receiver: POST `/webhook/github`, verifies `X-Hub-Signature-256` with shared HMAC secret.
- Filters events: `push` (paths: INTERVIEW.md, MANUAL.md, DEV.md, and PR-adjacent), `pull_request`, `check_suite`, `workflow_run` with `conclusion != success`.
- Device registration: `POST /devices/register` (PAT-authenticated).
- FCM sender: reads Firebase service account from Worker secret, POSTs to `fcm.googleapis.com/fcm/send` fanning out to all registered tokens for this repo.
- Dead-letter log in KV for delivery failures.
- Optional: `POST /webhook/github/laptop-relay` endpoint that Cloudflare Tunnel on Leonid's laptop polls/receives.

## Infrastructure changes
- **Firebase project** — created manually in Firebase console (user `MANUAL.md` item); APNs auth key (`.p8`) uploaded; service account JSON exported; placed into Worker secrets.
- **Cloudflare account** — Worker deployed via `wrangler deploy`; KV namespace created for device tokens + dead-letter log; secrets configured.
- **GitHub webhook** — configured on the devx repo pointing at the Worker URL; HMAC secret generated; delivery retries enabled.
- **Apple Developer** — App ID has Push Notifications capability (already enabled in E1); APNs key downloaded and given to Firebase.
- **Laptop-side (optional fast-path)** — Cloudflare Tunnel configured (`cloudflared tunnel create devx-laptop`); local script listens and triggers Triage on push events. Documented but not required for MVP.

## Design principles (from research)
- **Worker is the only server code in the system.** Keep it under 500 lines. If it grows past that, reassess the architecture.
- **Webhook filters run on the Worker, not on GitHub's side.** GitHub can't filter by path, so the Worker decides what's notable. Keep filters in code, not config, so they evolve with the repo.
- **Push payloads are summary + deep-link, not full state.** App fetches full state on notification tap. Payload stays small.
- **Device registration is trust-on-first-use.** A PAT with repo access is sufficient auth to register a push token for that repo. No complicated device-pairing.
- **Laptop fast-path is best-effort.** If Cloudflare Tunnel is down, Triage's 30s poll covers the gap. Never block on the fast-path succeeding.

## File structure
```
worker/
├── wrangler.toml
├── package.json
├── src/
│   ├── index.ts                       ← router
│   ├── webhook_github.ts              ← HMAC verify + filter + fanout
│   ├── devices.ts                     ← register, list, remove
│   ├── fcm.ts                         ← service-account auth + /fcm/send
│   ├── filters.ts                     ← which events matter per backlog file
│   └── kv.ts                          ← device-token store
└── test/
    ├── webhook_github.test.ts
    ├── filters.test.ts
    └── fcm.test.ts

mobile/
├── pubspec.yaml                       ← +firebase_messaging, +firebase_core
├── lib/
│   ├── core/
│   │   └── push/
│   │       ├── push_service.dart      ← init FCM, request permission, register token
│   │       ├── notification_handler.dart
│   │       └── deep_linker.dart
│   └── features/
│       └── inbox/
│           └── inline_reply.dart      ← iOS notification-action handler

docs/
└── laptop-fastpath-setup.md           ← Cloudflare Tunnel + local webhook receiver
```

## Story list with ACs

### 4.1 Cloudflare Worker scaffold + HMAC verification
- [ ] `worker/` directory initialized via `wrangler init`
- [ ] POST `/webhook/github` verifies `X-Hub-Signature-256` against shared secret; 401 on mismatch
- [ ] KV namespace `DEVX_PUSH` bound; test inserts + reads a key
- [ ] `wrangler deploy` uploads successfully; Worker URL recorded in `devx.config.yaml → mobile.worker_url`
- [ ] Test coverage for HMAC verify (success + failure)

### 4.2 FCM sender + service account auth
- [ ] Firebase service account JSON stored as Worker secret `FCM_SA_JSON`
- [ ] `fcm.ts` signs a JWT using the service account and obtains an access token (cached in KV with TTL)
- [ ] `POST https://fcm.googleapis.com/v1/projects/<id>/messages:send` with a test payload lands on a test device
- [ ] Test coverage mocks `fetch` and asserts correct auth header + body shape

### 4.3 Event filters + fanout
- [ ] `filters.ts` classifies each incoming webhook event into `{kind, summary, deep_link}`
- [ ] `push` events filtered by changed paths (INTERVIEW.md, MANUAL.md, DEV.md)
- [ ] `pull_request` events handle opened / review_requested
- [ ] `check_suite` + `workflow_run` handle `conclusion != success` only
- [ ] Fanout reads device tokens for the repo from KV, calls FCM per token
- [ ] Failed deliveries logged to dead-letter KV with TTL

### 4.4 Device registration endpoint
- [ ] POST `/devices/register` accepts `{token, repo, device_id}`; validates PAT bearer via `GET /user` + repo access check
- [ ] Stores `repo:<owner/name>:<device_id> → token` in KV
- [ ] DELETE `/devices/:device_id` removes the mapping (called on app uninstall / token refresh)
- [ ] Returns 401 on invalid PAT, 403 on repo-access mismatch

### 4.5 Flutter push integration
- [ ] `firebase_messaging` + `firebase_core` added; `google-services.json` / `GoogleService-Info.plist` wired (user `MANUAL.md` item for setup)
- [ ] On first launch after onboarding: request notification permission, register token with Worker
- [ ] Foreground handler shows in-app banner; background handler sets badge + prepares deep-link
- [ ] Token-refresh listener re-registers
- [ ] Widget test mocks push service and covers permission granted + denied paths

### 4.6 Deep-linking + inline reply
- [ ] Notification payload includes `deep_link` (e.g., `/interview/q4`)
- [ ] Tapping notification opens the correct screen with the right state
- [ ] iOS inline reply for INTERVIEW posts the answer via Contents API without opening the app
- [ ] Success / failure toast on app-return after inline reply

### 4.7 Laptop-side fast-path (optional)
- [ ] `docs/laptop-fastpath-setup.md` walks the user through `cloudflared tunnel create`
- [ ] A `scripts/laptop-webhook-receiver.sh` (or Python equivalent) listens locally and invokes `git fetch origin develop` + writes a marker file Triage watches
- [ ] Worker is modified to POST a mirror of the filtered event to a configured laptop-relay URL (set via Worker env var per-user)
- [ ] Documented as "nice to have — polling works without this"

## Dependencies
- **Depends on:** Epic 3 (writes provide the event source; the flows on both directions exist because commits exist).
- **Blocks:** nothing in v0.1 scope.

## Open questions
1. **Firebase project creation is manual.** Console-based; can't be automated. File as `MANUAL.md` item at start of epic: "Create Firebase project; upload APNs key; download service-account JSON; paste into Worker secrets."
2. **Worker URL scheme.** `devx-push-<subdomain>.workers.dev` or use `workers.dev` default? Lock in: let wrangler pick; record the URL in config.
3. **Badge count semantics.** Count of unanswered INTERVIEW + unexecuted MANUAL? Or all Inbox items? Leaning: INTERVIEW + MANUAL only (things that require user action).
4. **Laptop fast-path priority.** Story 4.7 is optional for v0.1. Include only if 4.1–4.6 ship with time to spare.

## Milestone
**M4 — "It's real-time."** Success = laptop-originated INTERVIEW question appears as a notification on Leonid's phone in < 10s; phone-originated (+) item appears on the laptop in < 30s (polling) or < 5s (fast-path).

## Party-mode critique (team lenses)

- **PM**: This epic is the one that transforms the app from "useful" to "essential." If notifications don't land reliably, the whole companion story falls apart.
- **UX**: Notification content design is critical. "New question" with no preview fails. Full question text in INTERVIEW pushes is the right default. Worker payload shape locked.
- **Frontend**: Inline-reply is iOS-specific via `UNNotificationAction`. Requires setting up notification categories in `PushService.init`. Mobile test is painful — plan for manual device testing here.
- **Backend**: Worker HMAC verify is the single most important security control. Unit-test it thoroughly. Don't skip.
- **Infrastructure**: Firebase setup is a 30-min console click session. User `MANUAL.md` item up front avoids blocking mid-epic.
- **QA**: End-to-end test harness is ambitious. For v0.1, rely on manual testing on Leonid's phone + Worker unit tests + Flutter widget tests. Full integration test harness is v0.2.
- **Locked decisions fed forward**: Worker URL pattern (`*.workers.dev`); payload shape `{kind, summary, deep_link}`; badge semantics (INTERVIEW + MANUAL); FCM v1 HTTP API (not legacy FCM HTTP).

## Focus-group reactions
Skipped — YOLO mode.
