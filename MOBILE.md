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

## Push notifications (Flutter side)

- `firebase_messaging` registers the device with FCM (iOS devices get an APNs token that FCM forwards to).
- Device sends its FCM token to the Cloudflare Worker via a `POST /devices/register` (authenticated with the same GitHub PAT — Worker verifies the PAT corresponds to a real user with push access to the repo).
- Worker stores token → repo mapping in a Durable Object (or KV — free tier is fine).
- On GitHub webhook (`INTERVIEW.md` touched, `MANUAL.md` touched, PR opened, CI red), Worker fans out FCM messages to registered tokens.
- In Flutter, `FirebaseMessaging.onMessage` handler opens the relevant screen.

**Inline reply on iOS** uses `firebase_messaging`'s notification actions → answers the INTERVIEW without opening the app. Same UX pattern `palateful` already ships for reminders.

---

## Security

- PAT stored via `flutter_secure_storage` (Keychain/Keystore/WebCrypto). Never in shared prefs, never logged, never serialized to disk outside secure storage.
- Biometric gate on app open (`local_auth`): Face ID / Touch ID / fingerprint before revealing backlog contents. Optional, user can disable.
- Branch protection on `main` prevents mobile or any agent from pushing to production directly. Only the explicit `develop → main` promotion path can touch `main`.
- Worker secrets: APNs key, FCM service account, GitHub webhook signing secret. All three in Cloudflare Worker secret storage, never in the Flutter app.
- Webhook signatures verified in the Worker (`X-Hub-Signature-256`); reject unsigned requests.
- Commit signing on the laptop (`commit.gpgsign = true`); mobile commits are unsigned, prefixed `devx-mobile:`. This gives you a visual tripwire — if an unsigned commit appears with any other prefix, something's off.

---

## Delivery plan

| Phase | Scope | Effort |
|---|---|---|
| **v0.1** | Read backlogs + inbox, answer INTERVIEW, add `/dev` item, PAT auth, poll-only. iOS + Android from day one (Flutter) + web build. | ~1 week |
| **v0.2** | Offline queue via `drift`. | +1 day |
| **v0.3** | Push notifications via Cloudflare Worker + FCM. | +3 days |
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
├── worker/                    ← Cloudflare Worker for push
│   ├── src/index.ts
│   └── wrangler.toml
└── ...
```

The Flutter app is itself managed by devx — dogfood test. Agents working on `mobile/` go through the same develop/main branching, the same backlog flow, the same coverage gates.
