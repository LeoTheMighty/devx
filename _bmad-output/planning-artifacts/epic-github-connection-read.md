<!-- refined: party-mode 2026-04-23 -->

# Epic — GitHub connection (read-only)

**Plan:** `plan/plan-7a2d1f-2026-04-23T13:00-mobile-companion-v01.md`
**Slug:** `epic-github-connection-read`
**Order:** 2 of 4
**User sees:** "I can see all my devx backlogs on my phone."

## Overview
Wire the Flutter app to GitHub via a fine-grained PAT. First-run onboarding captures the token + target repo. Read all 8 backlog files in parallel, parse them into structured items, and render Inbox + Backlogs tabs with real devx repo content.

## Goal
Phone becomes a read-only viewer onto the devx project's entire backlog state — the foundation for acting on items in E3.

## End-user flow
1. Leonid opens the freshly-installed app (from E1). First-run screen: "Paste a GitHub PAT" + "Repo (`owner/name`)" + "Connect."
2. He pastes a fine-grained PAT scoped to the devx repo. App validates by calling `GET /user` + `GET /repos/<owner>/<name>`.
3. PAT is stored in Keychain via `flutter_secure_storage`.
4. App transitions to Inbox tab. Inbox shows all current `INTERVIEW.md` questions, `MANUAL.md` actions, and any open PRs.
5. Leonid taps Backlogs — tab bar shows DEV / PLAN / TEST / DEBUG / FOCUS / INTERVIEW / MANUAL / LESSONS. Each tab lists items with status chips.
6. Leonid taps an item → spec detail view renders the underlying markdown (from `dev/*.md` etc.) + status log.
7. Pull-to-refresh refetches all 8 backlog files.

## Frontend changes
- `lib/core/auth/` — PAT storage + validation via `flutter_secure_storage`.
- `lib/core/github/` — GitHub client wrapper around the `github` pub.dev package, with a manual `ContentsClient` for sha-aware reads.
- `lib/core/parsers/` — markdown → structured models (`BacklogItem`, `InterviewQuestion`, `ManualAction`, `SpecFileSummary`).
- `lib/features/onboarding/` — PAT entry, repo entry, validation, store, navigate.
- `lib/features/inbox/` — real rendering of INTERVIEW + MANUAL + open-PR list. Empty state: "Nothing's waiting on you ✓".
- `lib/features/backlogs/` — TabBar across 8 types; list per tab; tap → detail.
- `lib/features/spec_detail/` — renders markdown + status log section for a spec file.
- Parallel fetch via `Future.wait` for all 8 files; sha cache in `drift` (added in E3, so here use a simple in-memory cache for v0.1 of this epic).

## Backend changes
None.

## Infrastructure changes
None.

## Design principles (from research)
- Read-only in this epic. Any "edit" affordance must be disabled / hidden; writes come in E3.
- PAT validation happens immediately — a bad token must not leave the user confused.
- Fetch performance: parallel, sha-aware. Full refresh should be < 1 second on decent connection.
- Markdown parsing is defensive — an item with a malformed line shouldn't crash the list.

## File structure
```
mobile/
├── pubspec.yaml                             ← +github, +flutter_secure_storage, +dio
├── lib/
│   ├── core/
│   │   ├── auth/
│   │   │   ├── auth_service.dart
│   │   │   └── providers.dart
│   │   ├── github/
│   │   │   ├── github_client.dart
│   │   │   ├── contents_client.dart
│   │   │   └── models.dart
│   │   └── parsers/
│   │       ├── backlog_parser.dart
│   │       └── spec_file_parser.dart
│   ├── features/
│   │   ├── onboarding/
│   │   │   ├── onboarding_screen.dart
│   │   │   └── onboarding_controller.dart
│   │   ├── inbox/
│   │   │   └── inbox_screen.dart
│   │   ├── backlogs/
│   │   │   ├── backlogs_screen.dart
│   │   │   └── backlog_tab.dart
│   │   └── spec_detail/
│   │       └── spec_detail_screen.dart
│   └── shared/
│       └── widgets/
│           ├── status_chip.dart
│           └── empty_state.dart
└── test/
    ├── parsers/
    │   └── backlog_parser_test.dart        ← golden-file tests against real devx DEV.md shapes
    └── features/
        └── inbox_test.dart
```

## Story list with ACs

### 2.1 Auth service + onboarding screen
- [ ] `flutter_secure_storage` stores + retrieves a PAT under key `github_pat`
- [ ] Onboarding screen has a text field (obscured), repo field, "Connect" button
- [ ] On submit, calls `GET /user` and `GET /repos/<owner>/<name>`; on 401/404 shows precise error text
- [ ] On success, stores PAT + repo config, navigates to Inbox
- [ ] Biometric gate on app-open is added behind a setting; default OFF for v0.1

### 2.2 GitHub client wrapper
- [ ] `GithubClient` wraps the `github` pub.dev package + raw `dio` for Contents API
- [ ] `ContentsClient.readBacklog(path)` returns `(content, sha)`; supports `If-None-Match` for 304
- [ ] Rate-limit handling: on 403 rate-limited, surface banner "GitHub rate limit hit — wait N seconds"
- [ ] Unit tests mock `dio` and cover success, 304, 401, 403, 404

### 2.3 Backlog parsing
- [ ] `BacklogParser` parses each of the 8 backlog files into typed items
- [ ] Tolerates missing fields, extra whitespace, unknown emoji
- [ ] Golden-file tests against this repo's actual `DEV.md` + `INTERVIEW.md` + `MANUAL.md` + `LESSONS.md` formats
- [ ] `SpecFileSummary` extracts frontmatter + title + status from a spec file's markdown

### 2.4 Inbox tab
- [ ] INTERVIEW questions render with question text + context + options (if any)
- [ ] MANUAL actions render with action text + "why" + "how" links
- [ ] Open PRs render with title + author + status
- [ ] Empty state: "Nothing's waiting on you ✓"
- [ ] Pull-to-refresh triggers full refetch
- [ ] Widget tests cover each item type

### 2.5 Backlogs tab + spec detail
- [ ] TabBar with 8 tabs (DEV / PLAN / TEST / DEBUG / FOCUS / INTERVIEW / MANUAL / LESSONS)
- [ ] Each tab lists items with title + status chip + source-file handle
- [ ] Tap → spec detail screen fetches `dev/dev-<hash>-*.md` (or equivalent) and renders via `flutter_markdown`
- [ ] Status log section formatted as a timeline
- [ ] Back navigation preserves scroll position

## Dependencies
- **Depends on:** Epic 1 (needs the installed app).
- **Blocks:** Epic 3 (writes need the auth layer).

## Open questions
1. **QR-pairing for PAT onboarding** — typing a 40-char PAT on a phone keyboard is miserable. Defer to v0.2 per MOBILE.md.
2. **Multi-repo.** MVP single-repo. Multi-project switcher moved to v1.5 per OPEN_QUESTIONS #18.
3. **Spec file resolution.** The backlog entries reference `dev/dev-<hash>-<ts>-<slug>.md`. The app needs to fetch these lazily on detail view — not pre-fetch all. OK.

## Milestone
**M2 — "I can see my backlogs."** Success = Leonid can open the app, see every open INTERVIEW question and MANUAL action, navigate into any spec file.

## Party-mode critique (team lenses)

- **PM**: Getting end-to-end read right is 50% of the value of the whole app. Users who can't even see their backlog won't trust write features. Approve.
- **UX**: Inbox ordering matters — INTERVIEW first (highest urgency), then MANUAL, then PRs. Empty state must feel positive ("Nothing's waiting on you ✓"), not absent.
- **Frontend**: Parsing is the risky part. Goldent-file tests against the real devx repo's own backlogs (bootstrap dogfood) is the right test strategy.
- **Backend**: N/A.
- **Infrastructure**: Rate-limit at 5000/hr with ~50/hr use is fine. No concerns.
- **QA**: Parser tests MUST include our own real-world backlog files, since format drift is the #1 regression risk. Lock in golden files as CI gate.
- **Locked decisions fed forward**: `ContentsClient` is the abstraction for E3 writes; parser types (`BacklogItem` etc.) are the shared shape; PAT storage pattern reused for Worker-auth in E4.

## Focus-group reactions
Skipped — YOLO mode.
