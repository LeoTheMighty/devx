# devx mobile companion — Flutter + GitHub

The mobile companion is a Flutter app. One codebase gives us iOS, Android, web, macOS, and Windows — so "all systems are usable" without rewriting the client for each. It talks to GitHub directly (no backend), with one tiny Cloudflare Worker handling push notifications.

---

## Why Flutter

- **Every surface covered in one codebase.** Native iOS + Android + responsive web + macOS/Windows menu-bar widgets, all from the same Dart. The user is on iOS today, but "my laptop's menu bar shows what Triage is doing" is a week of extra work in Flutter vs. a whole second codebase elsewhere.
- **Stack alignment.** The user already ships production Flutter (`palateful`). Same build tooling, same CI patterns, same preferred state management. devx mobile slots into an existing muscle group.
- **GitHub client story is solid.** `github` Dart package covers REST; `graphql_flutter` covers GraphQL; `http` + `dio` for anything custom. Nothing exotic required.
- **Push notifications are uniform.** `firebase_messaging` abstracts APNs (iOS) + FCM (Android) + web push, so the Cloudflare Worker sends to one endpoint regardless of device.

---

## Architecture (unchanged from the previous plan, just Flutter-ified)

```
┌──────────────────┐          ┌──────────────────┐          ┌──────────────────┐
│  Flutter app     │  HTTPS   │   GitHub API     │  git     │   Laptop         │
│  (devx_mobile)   │◄────────►│  REST + GraphQL  │◄────────►│   Triage loop    │
│  iOS/Android/web │          │  your-repo       │          │                  │
└────────┬─────────┘          │  + webhooks      │          └────────┬─────────┘
         │                    └────────┬─────────┘                   │
         │                             │ webhook POST                │
         │  FCM/APNs                   ▼                             │
         └──────────────────► ┌──────────────────┐ ◄─────────────────┘
                              │  Cloudflare      │  (fast-path
                              │  Worker (free)   │   webhook relay)
                              └──────────────────┘
```

Everything lives in the devx project repo. No app-specific backend.

---

## Flutter package choices

| Concern | Package | Why |
|---|---|---|
| HTTP + GitHub REST | `github` (pub.dev), fallback to `dio` | First-class GitHub types, auth handled. |
| GraphQL (file sha batch queries) | `graphql_flutter` | Efficient when reading 7 backlog files in one round-trip. |
| Secure token storage | `flutter_secure_storage` | Wraps Keychain (iOS/macOS), Keystore (Android), WebCrypto (web). One API. |
| Push notifications | `firebase_messaging` | APNs + FCM + web push via one SDK. |
| Local offline queue | `drift` (SQLite) or `hive` | Pending writes when offline; drained when network returns. |
| Markdown render | `flutter_markdown` | Show spec-file bodies and status logs. |
| State management | `flutter_riverpod` | Matches existing Palateful stack; async-aware for network-bound UI. |
| Commit construction | custom `GitDataApiClient` on top of `github` package | Git Data API isn't in the high-level `github` surface yet; ~200 lines to wrap. |

No native code. Pure Flutter + Dart on every platform.

---

## Communication patterns

These are identical to the GitHub plan from before — Flutter just implements them.

### Read backlogs (pull-to-refresh, every app open)

```dart
final res = await github.repositories.getContents(
  RepositorySlug('you', 'devx-project'),
  'DEV.md',
  ref: 'develop',   // ← important: read from develop, not main
);
// res.file.content is base64; res.file.sha is the concurrency key
```

Cache each file's `sha` in `drift`. Next read sends `If-None-Match` for a cheap 304.

### Append a `/dev` item (the "(+)" button)

Two-file atomic write via Git Data API, targeting `develop`:

```dart
final parentSha = await git.getRef('heads/develop');
final parentTree = await git.getCommit(parentSha).treeSha;

final specBlob = await git.createBlob(specFileContent);
final devMdBlob = await git.createBlob(newDevMdContent);

final newTree = await git.createTree(
  baseTree: parentTree,
  entries: [
    TreeEntry(path: 'dev/dev-$hash-$ts-$slug.md', sha: specBlob, mode: '100644'),
    TreeEntry(path: 'DEV.md', sha: devMdBlob, mode: '100644'),
  ],
);

final commit = await git.createCommit(
  message: 'devx-mobile: add dev-$hash ($slug)\n\nSource: mobile v0.1',
  tree: newTree,
  parents: [parentSha],
);

await git.updateRef('heads/develop', commit, force: false);
// If force: false fails with 422, re-read, rebuild the append, retry.
```

On 422 (ref moved since step 1): retry from step 1. Cap 3 retries, then show a "conflict" UI with the remote file contents and let the user resolve.

### Answer an INTERVIEW question

Single-file Contents API write:

```dart
await github.repositories.createFile(
  slug,
  CreateFile(
    path: 'INTERVIEW.md',
    message: 'devx-mobile: answer q#$qNum',
    content: base64Encode(utf8.encode(newContent)),
    sha: currentSha,
    branch: 'develop',
  ),
);
```

### Quick attachments (photos, voice notes)

Camera/mic → upload binary as a blob → reference it from the spec file's frontmatter:

```yaml
---
hash: a3f2b9
type: dev
attachments:
  - dev/attachments/a3f2b9/screenshot-2026-04-23.png
  - dev/attachments/a3f2b9/voice-note.m4a
---
```

All committed atomically in the same tree write as the spec file itself.

---

## Branching model (decided: `develop/main` split)

devx is now opinionated on this. See [`DESIGN.md § Branching model`](./DESIGN.md#branching-model) for the full spec.

**Short version for the mobile app:**

- The mobile app **always** writes to `develop`. Never to `main`.
- `main` is production. Only Triage (after gates pass) and explicit user promotion merge `develop → main`.
- Agent branches are `develop/<type>-<hash>` and PR into `develop`.
- This means the mobile app can't accidentally deploy broken code to prod — worst case, phone adds a bad `/dev` item that lands in `develop`, Triage picks it up, its resulting agent-PR fails CI, never gets promoted to `main`.

---

## Screens (Flutter widgets)

| Screen | Widget root | What it shows |
|---|---|---|
| **Inbox** | `InboxScreen` | INTERVIEW questions (answerable inline with `TextField`), MANUAL actions (checkbox + comment), open PRs awaiting review (deep-link). |
| **Backlogs** | `BacklogsScreen` with `TabBar` | DEV / PLAN / TEST / DEBUG / FOCUS tabs, each a `ListView` of items with status `Chip`s. |
| **Spec detail** | `SpecDetailScreen` | `flutter_markdown` rendering spec body + status log. FAB to "add note to spec" (commits a comment line to status log). |
| **Add** | `AddItemScreen` | `(+)` button target. Text field + type picker + optional attachments. |
| **Activity** | `ActivityScreen` | Live feed (polled or webhook-driven): recent commits grouped by agent, PR status badges, CI status dots. |
| **Settings** | `SettingsScreen` | GitHub PAT / App install, default branch (`develop`), notification preferences, theme. |

Widget reuse with `palateful`: steal `AppShell`, nav patterns, theme tokens, and the Riverpod provider conventions you've already refined there.

---

## Offline behavior

1. User hits (+) while on the subway.
2. App writes the intended commit into `drift` as a `PendingWrite` row.
3. Background isolate polls connectivity. On network-up, drains queue in FIFO order.
4. Each drain attempt is a full Git Data API sequence — if rebase conflict, retry with fresh parent sha.
5. UI shows a "pending" badge on items still in the queue.

No data loss ever. The phone can be offline for a week; the queue drains when it comes back.

---

## Realtime updates — three-tier architecture

The git-commit-first invariant in DESIGN.md says every state change is a commit on `develop`. That's right for durable state, wrong for realtime. A commit per agent heartbeat would (a) blow up `git log` with status noise, (b) trigger CI on every tick, (c) eat GitHub API rate limit, and (d) saturate APNs push budget for trivia.

**Realtime updates are projections of state, not state.** Commit the durable facts; stream the derivative.

### Tier 1 — durable state (commits)

Spec-file status logs + backlog file mutations on `develop`. One commit per *meaningful* event only: claimed, blocked, unblocked, PR opened, merged, promoted, mode change. ~5–15 commits per feature. This is the source of truth; anything else is a cache.

### Tier 2 — realtime stream (Durable Object + WebSocket)

A Cloudflare **Durable Object** (one per project) holds a small ring buffer of recent agent events and fans them out over WebSocket to subscribed phones.

- **Laptop's TriageAgent** posts every `.devx-cache/events/<agent-id>.jsonl` line to `POST <worker>/event` (HMAC-signed with a shared secret in `devx.config.yaml`).
- **Foregrounded app** holds a WebSocket on `WSS <worker>/stream/<repo>` for sub-second updates.
- **Backgrounded app** drops the socket. The DO retains the last 50 events; next foreground gets a "missed while away" replay.
- DO storage stays in `state.storage` (free tier, no KV needed for the stream itself).

The DO is a cache. If it dies, the next foreground re-reads `develop` HEAD via the GitHub Contents API and rebuilds from spec-file status logs. **No data loss is possible.**

### Tier 3 — push notifications (two cadences)

APNs + FCM, but split:

| Tier | What it does | Examples | Volume |
|---|---|---|---|
| **High-priority** | banner + vibrate + Live Activity update | INTERVIEW filed, MANUAL filed, CI red on develop, promotion awaiting approval, mode auto-changed to LOCKDOWN | ~5/day |
| **Silent Live Activity** | updates lock-screen widget only, no banner | agent claimed, PR opened, CI green, merged | ~30–50/day |

APNs allows ~120 silent Live Activity updates per activity per hour for free; we're well under. Android equivalent is `flutter_foreground_task` with a persistent notification.

### Live Activity widget content

Lock-screen layout (iOS Dynamic Island and below):

```
┌────────────────────────────────────────┐
│ devx · palateful · [BETA]              │
│ 2 agents active · 1 PR awaiting promo  │
│ Last: DevAgent-7 → CI green ✓ (12s)    │
└────────────────────────────────────────┘
```

Three lines, deterministic shape. Updated via silent APNs from the Worker; the Flutter app never needs to be foregrounded for the widget to refresh.

### Architecture diagram

```
Laptop Triage  ──appends──▶  .devx-cache/events/<agent>.jsonl
       │
       ├──tier-3 critical──▶  POST /event (kind=critical)  ┐
       │                                                    ├──▶ Worker ──▶ APNs/FCM (banner)
       └──tier-2 all──────▶  POST /event (kind=stream)    ──┘                  │
                                       │                                       └──▶ Live Activity (silent)
                                       ▼
                              Durable Object (one per repo)
                                ├─ ring buffer (last 50)
                                └─ WebSocket fan-out
                                       ▲
                                       │ subscribes when foregrounded
                              Flutter app (iOS/Android)
                                       │ on cold start
                                       ▼
                              GitHub Contents API ─── reads `develop` HEAD
                                                       (truth; reconciles with stream)
```

### Why this stays cheap

| Component | Cost |
|---|---|
| Durable Object | Free tier: 1M req/day, 12.8M GB-s/mo. Realistic use: <0.1%. |
| Worker invocations | Free tier: 100k/day. Actual: ~100/day per active project. |
| KV (device-token storage, unchanged from before) | Free tier: 100k reads/day. |
| APNs/FCM sends (loud + silent Live Activity) | $0. Apple/Google don't charge. |
| **Total marginal cost** | **$0**, same as the existing webhook plan. |

### What survives `devx eject`

The Worker + DO are devx infra, not user infra. Ejecting just stops the laptop from posting events; the phone falls back to GitHub-Contents-API polling on app open. No loss of audit trail (it was always in commits anyway).

---

## Push notifications (Flutter side)

- `firebase_messaging` registers the device with FCM (iOS devices get an APNs token that FCM forwards to).
- Device sends its FCM token to the Cloudflare Worker via a `POST /devices/register` (authenticated with the same GitHub PAT — Worker verifies the PAT corresponds to a real user with push access to the repo).
- Worker stores token → repo mapping in a Durable Object (or KV — free tier is fine).
- On critical events relayed from the laptop (or from GitHub webhooks for `INTERVIEW.md`/`MANUAL.md` writes, PR opened, CI red), Worker fans out FCM messages to registered tokens.
- In Flutter, `FirebaseMessaging.onMessage` handler opens the relevant screen; `apns-push-type: liveactivity` payloads update the Live Activity without surfacing a banner.

**Inline reply on iOS** uses `firebase_messaging`'s notification actions → answers the INTERVIEW without opening the app. Same UX pattern `palateful` already ships for reminders.

---

## Mode-gated write permissions

The mobile app's write surface is scoped by the project's risk **mode** ([`MODES.md`](./MODES.md)):

| Mode | What the phone can do |
|---|---|
| YOLO | Everything: add items, answer INTERVIEW, approve promotions, trigger deploys |
| BETA | Everything except trigger production deploys |
| PROD | Add items, answer INTERVIEW, approve panel-flagged promotions; no direct deploy triggering; no destructive data ops |
| LOCKDOWN | Read-only: the phone sees incident state but can't change it |

The app shows the current mode as a persistent banner color — green (YOLO), yellow (BETA), red (PROD), purple (LOCKDOWN) — and disables buttons the mode forbids with an explanatory tooltip.

---

## Security

- PAT stored via `flutter_secure_storage` (Keychain/Keystore/WebCrypto). Never in shared prefs, never logged, never serialized to disk outside secure storage.
- Biometric gate on app open (`local_auth`): Face ID / Touch ID / fingerprint before revealing backlog contents. Optional, user can disable.
- Branch protection on `main` prevents mobile or any agent from pushing to production directly. Only the explicit `develop → main` promotion path can touch `main`.
- Worker secrets: APNs key, FCM service account, GitHub webhook signing secret. All three in Cloudflare Worker secret storage, never in the Flutter app.
- Webhook signatures verified in the Worker (`X-Hub-Signature-256`); reject unsigned requests.
- Commit signing on the laptop (`commit.gpgsign = true`); mobile commits are unsigned, prefixed `devx-mobile:`. This gives you a visual tripwire — if an unsigned commit appears with any other prefix, something's off.

---

## Infrastructure cost

**Marginal cost to the user: $0.** Apple Developer Program and Google Play developer fees are already paid from a separate project, so devx piggybacks on those.

| Component | Cost | Notes |
|---|---|---|
| Apple Developer Program | already paid | Required for iOS signing + APNs. Shared with existing app. |
| Google Play developer account | already paid | Only if shipping Android via Play Store. Sideload works for dev. |
| Cloudflare Worker (webhook → FCM relay) | $0 | Free tier: 100k requests/day. Actual use: ~20/day. |
| Cloudflare KV (device-token storage) | $0 | Free tier covers a fraction of what we'd use. |
| Firebase Cloud Messaging (APNs + FCM + web push) | $0 | Unlimited free; no paid tier exists. One API call per notification. |
| APNs / FCM sends themselves | $0 | Apple and Google don't charge for pushes. |
| Domain name | **skipped** | Worker ships under `*.workers.dev` — free, HTTPS-valid, routable by GitHub webhooks. Can be swapped for a custom domain later if the project outlives dogfood. |
| GitHub | $0 | Personal account, private repo, 5000 req/hr rate limit. Actual use: ~50/hr. |

Total new spend: nothing.

### What the Worker URL looks like without a domain

```
https://devx-push.<your-cf-subdomain>.workers.dev/webhook
```

Drop this into the devx repo's GitHub webhook config. HTTPS and signatures work out of the box; no DNS setup needed. If you ever want a custom domain later, point a CNAME at the Worker — no code changes, no reissued certs.

---

## Delivery plan

| Phase | Scope | Effort |
|---|---|---|
| **v0.1** | Read backlogs + inbox, answer INTERVIEW, add `/dev` item, PAT auth, poll-only. iOS + Android from day one (Flutter) + web build. | ~1 week |
| **v0.2** | Offline queue via `drift`. | +1 day |
| **v0.3** | Push notifications via Cloudflare Worker + FCM (high-priority tier). | +3 days |
| **v0.3.5** | Live Activities + Durable Object event stream (Tier 2 + Tier 3 silent). iOS first; Android persistent notification. | +2 days |
| **v0.4** | GitHub App OAuth (replaces PAT). | +2 days |
| **v0.5** | Attachments (photo, voice note) committed as blobs. | +2 days |
| **v0.6** | Spec-detail "add comment" (appends to status log). | +1 day |
| **v0.7** | macOS menu-bar widget (Flutter desktop) showing Triage live status. | +3 days |
| **v1.0** | Desktop (Linux/Windows), full platform parity. | +1 week |

MVP is ~1 person-week of Flutter. Every subsequent phase adds 1–3 days.

---

## Repo layout

Lives inside the devx monorepo (because the mobile app is part of devx, not a separate product):

```
devx/
├── skills/                    ← the /devx-* slash commands
├── mobile/                    ← Flutter app
│   ├── lib/
│   │   ├── main.dart
│   │   ├── core/              ← GitHub client, auth, offline queue
│   │   ├── features/
│   │   │   ├── inbox/
│   │   │   ├── backlogs/
│   │   │   ├── add_item/
│   │   │   └── activity/
│   │   └── shared/            ← theming, widgets, providers
│   ├── test/
│   ├── integration_test/
│   ├── ios/
│   ├── android/
│   ├── web/
│   ├── macos/
│   ├── pubspec.yaml
│   └── README.md
├── worker/                    ← Cloudflare Worker for push + realtime stream
│   ├── src/index.ts           ← /webhook, /event, /devices/register, /stream
│   ├── src/durable_object.ts  ← per-project DO: ring buffer + WS fan-out
│   └── wrangler.toml
└── ...
```

The Flutter app is itself managed by devx — dogfood test. Agents working on `mobile/` go through the same develop/main branching, the same backlog flow, the same coverage gates.
