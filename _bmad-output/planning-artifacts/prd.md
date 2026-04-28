# PRD — devx Flutter Companion App (scope: v0.1 through real-time sync)

Derived from [`product-brief.md`](./product-brief.md) and [`../MOBILE.md`](../../MOBILE.md). This PRD scopes the mobile-companion slice into something `/dev-plan` can chunk into epics and `/dev` can ship. For the full multi-platform design, `MOBILE.md` remains the canonical reference.

## Goals

1. Ship a working iOS companion app installed on Leonid's physical iPhone within ~1 person-week of Flutter work.
2. Phone can read every devx backlog file + add new `/dev` items + answer `INTERVIEW.md` questions.
3. Phone receives push notifications for new `INTERVIEW` / `MANUAL` items + new PRs + CI failures.
4. Laptop picks up phone-originated commits within seconds (not poll cycles).
5. Zero-marginal-cost infrastructure: Apple fee already paid; Cloudflare free tier; no custom domain.

## Non-goals (this PRD)

- Android release to Play Store (multi-platform codebase ships, but distribution deferred).
- Desktop builds (macOS menu-bar widget is v0.7 per MOBILE.md).
- Multi-repo switcher (per `OPEN_QUESTIONS.md #18`, moved to v1.5).
- GitHub App OAuth (PAT is MVP; OAuth is v0.4 per MOBILE.md).
- Attachments (photo / voice note) — v0.5 per MOBILE.md.

## Users

- **Primary**: Leonid (solo founder-engineer persona) — see `focus-group/personas/persona-leonid-solo-founder.md`.
- **Secondary at v0.1**: none. Later: Dana, Sam, Jess.
- **Anti-persona**: Morgan. Any scope drift toward enterprise features should be flagged.

## Functional requirements

### FR-1: On-device iOS installation
The app builds from a Flutter project in `mobile/`, signs under Leonid's Apple Developer Team, and installs on his iPhone via TestFlight. One-tap launch; app opens to a first-run onboarding screen.

### FR-2: GitHub authentication
First-run flow accepts a fine-grained Personal Access Token. Token is stored via `flutter_secure_storage` (Keychain on iOS). Token scope: single repo, Contents (R/W), Pull requests (R/W), Issues (R/W), Metadata (R).

### FR-3: Repo selection
MVP: single repo, configured once at onboarding. `devx.config.yaml → mobile.repo` (or stored in app prefs). Multi-repo deferred.

### FR-4: Backlog read
Pull-to-refresh (and app-open) fetches all 8 backlog files in parallel via GitHub Contents API. Responses cache `sha` for next fetch (304s on unchanged). Parses each markdown file into structured item lists.

### FR-5: Inbox tab
Shows: `INTERVIEW.md` questions (answerable inline), `MANUAL.md` actions (checkable with comment), open PRs awaiting review (deep-link to GitHub). Empty state: "Nothing's waiting on you ✓".

### FR-6: Backlogs tab
Tab bar across the 8 backlog types. Each tab: scrollable list of items with status chips, tap → spec-file detail view rendering markdown + status log.

### FR-7: Add tab (the "(+)" button)
One text field + type picker (default `dev`). Submit constructs an atomic commit via Git Data API writing `dev/dev-<hash>-<ts>-<slug>.md` + appending to `DEV.md`, targeting `develop` branch. Confirmation shows "Added. Triage will pick this up in ~30s."

### FR-8: INTERVIEW answer (inline)
Tap an unanswered INTERVIEW item → inline `TextField` → submit writes a single-file edit to `INTERVIEW.md` via Contents API using optimistic-sha concurrency.

### FR-9: Offline queue
Any write initiated without network connectivity queues in `drift` (SQLite) as a `PendingWrite` row. Background isolate drains queue FIFO on network-up. UI shows "pending" badge on queued items.

### FR-10: Conflict handling
On 422 (ref moved) or 409 (sha stale): retry up to 3 times with exponential backoff. On persistent failure: surface a "tap to resolve" UI showing remote file content + the user's proposed change.

### FR-11: Push notifications
Cloudflare Worker receives GitHub webhooks (Contents changes to `INTERVIEW.md` / `MANUAL.md`; PR events; CI red events). Worker filters + fans out via FCM, which delivers to APNs (iOS) and FCM (Android when added). Flutter app receives + routes the notification to the relevant screen. Inline-reply on iOS allows answering `INTERVIEW` without opening the app.

### FR-12: Device registration
Flutter app registers its FCM token via `POST /devices/register` (PAT-authenticated). Worker stores mapping in KV. Token refresh re-registers automatically.

### FR-13: Laptop-side fast path
Laptop `/dev-triage` loop can optionally run a local webhook receiver (via Cloudflare Tunnel) that triggers an immediate `git fetch` + Triage tick on push to `develop`. Fallback: Triage polls every 30s. MVP: polling; fast-path is a nice-to-have inside this PRD's scope.

## Non-functional requirements

- **Latency (phone → laptop):** ≤ 30s via polling, ≤ 5s via fast-path.
- **Latency (laptop → phone):** ≤ 10s from commit to push notification.
- **Offline survivability:** 7+ days of offline use without data loss (bounded only by drift DB size).
- **Token security:** PAT never logged; never in plaintext on disk; biometric gate optional.
- **Build size:** iOS IPA ≤ 30 MB.
- **Cold start:** ≤ 2 seconds to Inbox tab rendering cached content.

## Layer coverage

- **Frontend (Flutter):** FR-1 through FR-10 and FR-12 (client side).
- **Backend (Cloudflare Worker):** FR-11, FR-12 (server side), FR-13 (webhook receiver).
- **Infrastructure:** Firebase project (FCM), Apple Developer signing + TestFlight, Cloudflare Worker deploy via wrangler, GitHub webhook configuration.

## Dependencies (external)

- **Anthropic-side:** none (the companion app is not LLM-driven).
- **GitHub side:** fine-grained PAT, webhook configured on the devx repo.
- **Firebase side:** project created, APNs auth key uploaded to Firebase, service account key extracted for Worker.
- **Apple side:** Developer Program active (already paid), App ID created with Push Notifications capability.
- **Cloudflare side:** account with Workers free tier enabled.

## Release milestones

- **M1 — "Hello, iPhone"**: Empty Flutter app running on Leonid's iPhone (end of E1).
- **M2 — "I can see my backlogs"**: Phone reads + displays all 8 backlog files (end of E2).
- **M3 — "I can act from my phone"**: Phone can add `/dev` items + answer INTERVIEW, offline-tolerant (end of E3).
- **M4 — "It's real-time"**: Push notifications + fast-path sync (end of E4).

## Success metrics

- Time from `git log origin/develop` on laptop → phone notification ≤ 10s after webhook config.
- Zero data loss across a 24h offline test.
- PAT never recoverable from app bundle or disk dump.
- Leonid uses (+) at least 5 times per week in the first 30 days post-install.

## Open questions

- Q1: QR-pairing to onboard the PAT from the laptop instead of typing on phone? Deferred to v0.2.
- Q2: Should the Worker's device-token store be KV or Durable Objects? KV is fine at 1–3 devices; DO becomes useful if we ever support team devices. YOLO: KV.
- Q3: Push content — how much detail is in the notification payload (full question text vs. "You have 1 new question")? YOLO: full question text for INTERVIEW; summary only for MANUAL + PR + CI.
- Q4: Which GitHub events do we listen for? Target: `push` (filtered to backlog-file paths), `pull_request` (opened / review_requested / closed), `check_suite` (completed + conclusion != success), `workflow_run` (completed + conclusion != success).

---

## Addendum — 2026-04-26 — Phase 0 Foundation (devx itself)

Derived from [`docs/ROADMAP.md § Phase 0`](../../docs/ROADMAP.md#phase-0--foundation-week-1) and [`plan/plan-a01000-2026-04-26T19:30-foundation.md`](../../plan/plan-a01000-2026-04-26T19:30-foundation.md). Scope: turn any repo onto the devx rails. Five epics, no execution loop, the *shape* of the system end-to-end.

### Goals

1. `/devx-init` runs on an empty repo and produces all foundational state in one conversation: 8 backlog files, `devx.config.yaml`, `.devx-cache/`, `.gitignore` updates, `CLAUDE.md` seed, CI workflow, PR template, branch protection on `main`, `develop` branch, supervisor units, and 5 seeded personas — without invoking any execution loop.
2. The full `devx.config.yaml` schema (all 15 sections from [`CONFIG.md`](../../docs/CONFIG.md)) is round-trippable via a real `devx config <key>` get/set CLI that preserves comments, ordering, and structure.
3. OS-level supervisor units (`dev.devx.manager` + `dev.devx.concierge`) are installed for the host platform and start at login — pointing at a placeholder script that runs forever and prints "not yet wired."
4. All 11 `devx <subcmd>` commands are registered and discoverable via `devx --help`. Stub commands print the phase + epic that ships them. Only `devx config` works for real in Phase 0.
5. `_bmad-output/planning-artifacts/bmad-audit.md` documents which BMAD workflows devx invokes / wraps / passes-through / shadows / leaves orphaned.

### Non-goals (this addendum)

- Any execution loop (`/devx-plan`, `/devx`, `/devx-manage`, `/devx-concierge`) — those land Phase 1+.
- TUI / web dashboard / mobile relay surfaces — Phase 4.
- Seeding INTERVIEW.md with live PlanAgent-generated questions — Phase 0 uses a fixed template per detected stack.
- Cloud-watchdog GitHub Action workflow file — Phase 2 (`epic-cloud-watchdog`).
- Promotion gate logic — `devx-promotion.yml` is a placeholder; YOLO/BETA wiring is Phase 1, PROD wiring is Phase 9.
- LearnAgent's compaction or canary primitives — Phase 5.
- `devx eject` actual implementation — Phase 0 ships only the stub message.

### Users

- **Primary:** Leonid (solo founder-engineer) — first /devx-init dogfood. See `focus-group/personas/persona-leonid-solo-founder.md`.
- **Anti-persona:** Morgan. Any "ceremony for ceremony's sake" / enterprise-flavored surface is a red flag and gets cut.

### Functional requirements

#### FR-A: `/devx-init` is a 13-question conversation per CONFIG.md

The interview asks the questions from [`CONFIG.md § What /devx-init actually asks`](../../docs/CONFIG.md). Conversational order departs from CONFIG.md's grouped order to follow narrative flow:

| New | CONFIG.md # | Question | Sets |
|---|---|---|---|
| N1 | Q1 | What are you building? | seeds `PLAN.md`, drives PRD |
| N2 | Q8 | First slice? | first `dev/dev-*.md` spec |
| N3 | Q2 | Who for? | persona panel seeds |
| N4 | Q5 | Solo or team? | persona priorities |
| N5 | Q6 | Stack? | language_runners, harness |
| N6 | Q4 | Project shape? | `project.shape` |
| N7 | Q3 | Real users? | `mode` |
| N8 | Q11 | Git strategy? | `git.*` |
| N9 | Q12 | Promotion? | `promotion.autonomy.*` |
| N10 | Q10 | Permissions? | `permissions.bash.*` |
| N11 | Q7 | Infra (CI / harness)? | `ci.provider`, `qa.browser_harness` |
| N12 | Q9 | Daily cost cap? | `capacity.daily_spend_cap_usd` |
| N13 | Q13 | Notifications? | `notifications.*` |

**Default-inference skip table** drops the asked-count when the repo + user-level config make defaults unambiguous:

| # | Skip when… | Inferred default |
|---|---|---|
| N1 | non-empty `README.md` | use README first paragraph; confirm |
| N3 | `focus-group/personas/` already populated | reuse |
| N5 | `git shortlog -sn` distinct authors > 1 in last 90d | team |
| N6 | detected `package.json` / `pubspec.yaml` / `Cargo.toml` / `go.mod` / `pyproject.toml` | always inferable except empty |
| N7 | `DATABASE_URL` / Sentry DSN / prod env vars | `mode = PROD`; else infer from `project.shape` |
| N6 mappings | empty repo → `empty-dream`; commits + tests + tags → `production-careful` | always inferable; confirm |
| N8 | existing `develop` branch + `protect_main` | keep |
| N11 | `.github/workflows/*` present | `ci.provider = github-actions` |
| N13 | `~/.devx/config.yaml` present | reuse user prefs |

**Best case (existing mature repo, returning user with `~/.devx/config.yaml`)**: 3 questions asked.
**Worst case (empty repo, first-time devx user)**: all 13.

#### FR-B: `/devx-init` is idempotent

- Detection signal: `devx_version: <semver>` at top of `devx.config.yaml`. No file → fresh init. File without version field → corrupt; halt and ask.
- Re-run = upgrade mode: load existing values; only prompt for keys whose schema is newer than installed `devx_version`. Final summary is "kept N / added M / migrated K," not "done."
- Per artifact:
  - Backlog files: never overwrite — touch only if missing.
  - `.gitignore`: managed lines wrapped in `# >>> devx` / `# <<< devx` markers; only missing lines added.
  - CI workflow: if `devx-ci.yml` exists → skip + diff to stdout; never overwrite.
  - PR template: append `## devx` section if file lacks the `<!-- devx:mode -->` marker; otherwise skip.
  - Branch protection on `main`: read live state via `gh api`; PUT the union of our required contexts and any stricter user rules; never replace.
  - `develop` branch: skip create if exists; respect non-`main` default branches.
  - `CLAUDE.md`: edit only inside `<!-- devx:start --> … <!-- devx:end -->` markers.
  - Personas: never overwrite; only seed standard 5 if `focus-group/personas/` is missing or empty.

#### FR-C: `/devx-init` failure modes degrade gracefully

- **BMAD install fails:** capture exit code + stderr; do not write `devx.config.yaml`; offer `[r]etry / [s]kip / [a]bort`. Skip writes a stub `bmad.modules: []` and seeds MANUAL.md with a re-run instruction.
- **`gh` not authenticated:** detect via `gh auth status`; complete all local steps; queue GH-side ops in `.devx-cache/pending-gh-ops.json`; final hand-off says "run `gh auth login`, then `devx init --resume-gh`." Surfaces as ONE MANUAL.md entry.
- **Repo has no remote:** detect `git remote -v` empty; skip branch-protection + workflow-push; still scaffold local files; promotion gate defaults to `manual-only` regardless of mode answered, with a one-line in-config explanation.
- All three: write top-level `init.partial: true` to `devx.config.yaml` until deferred work resolves. Other `/devx*` commands check this and refuse to spawn workers in modes ≥ BETA when partial.

#### FR-D: `devx.config.yaml` covers all 15 sections from CONFIG.md

The file `/devx-init` writes is a fully-commented YAML covering each of the 15 `CONFIG.md` sections. Sections whose answer was inferred / skipped are written with the default value plus a comment explaining the inference. Sections where a question was asked are written with the user's answer plus a comment for the inverse.

#### FR-E: `devx config <key>` get / set is real-functional

```bash
devx config mode                          # → BETA (reads merged: project then user)
devx config mode YOLO                     # writes to project file by default
devx config mode --user YOLO              # writes to user file
devx config capacity.daily_spend_cap_usd 50
devx config promotion.autonomy.initial_n  # nested-key access via dotted paths
```

YAML I/O preserves comments, ordering, anchors, and quoting. Writes restricted to leaf scalars in Phase 0 (replacing whole sub-trees safely is Phase 1).

#### FR-F: OS supervisor units installed per platform

- **macOS:** `~/Library/LaunchAgents/dev.devx.manager.plist` and `dev.devx.concierge.plist` with `KeepAlive=true`, `RunAtLoad=true`, `ProcessType=Interactive`, `ThrottleInterval=10`, log paths under `~/Library/Logs/devx/`.
- **Linux (systemd-user):** `~/.config/systemd/user/devx-manager.service` + `devx-concierge.service` with `Restart=always`, `RestartSec=10`, `StartLimitIntervalSec=0`, `WantedBy=default.target`, log paths under `$XDG_STATE_HOME/devx/` (or `~/.local/state/devx/`). `loginctl enable-linger $USER` invoked if user opts in to "run when logged out."
- **Windows / WSL:** Task Scheduler XML registered via `schtasks /Create /XML`; LogonTrigger; `RestartOnFailure Interval=PT10S Count=999`; ExecutionTimeLimit=PT0S; runs `wsl.exe -d <distro> -u <user> --exec ${HOME}/.devx/bin/devx-supervisor-stub.sh manager`.
- All three platforms invoke a single placeholder script `~/.devx/bin/devx-supervisor-stub.sh <role>` that prints "[devx-<role>] not yet wired" and `exec sleep infinity` so launchd/systemd/Task-Scheduler don't hot-restart-loop.
- Idempotency via sidecar `~/.devx/state/supervisor.installed.json` recording `{platform, hash, version}`. Re-init: rewrite only if hash differs.

#### FR-G: All 11 `devx <subcmd>` commands registered

Stubs present for: `ui`, `serve`, `tail`, `kill`, `restart`, `status`, `pause`, `resume`, `ask`, `eject`. Real implementations: `config`. `devx --help` lists all 11 with `(coming in Phase N)` annotation per stub. Stub message goes to **stderr**, exits 0; format: `not yet wired — ships in Phase <N> (<epic-slug>)`.

#### FR-H: `bmad-audit.md` deliverable

`_bmad-output/planning-artifacts/bmad-audit.md` covers:
- Module + workflow inventory (core, bmm, tea — every workflow listed).
- Devx → BMAD invocation map (every workflow classified: invoked / wrapped / escape-hatch / shadowed / orphaned).
- Notable risks: TEA module currently orphaned in `/devx-plan` and `/devx`; `bmad-sprint-planning` shadowed by `DEV.md`; `bmad-retrospective` not invoked (devx assumes manual `LESSONS.md`); UX-design timing mismatch (BMAD Phase 2 vs. devx party-mode Phase 6).
- Recommendations for Phase 5 (`/devx-test`) wiring of `tea` workflows.

#### FR-I: CI artifacts written by `/devx-init`

- `.github/workflows/devx-ci.yml`: real, stack-conditional. Jobs: `stack-detect` → `lint` → `test` → `coverage`. Empty-stack repos get echo-only no-op gates that exit 0 (so PRs can merge before code lands).
- `.github/workflows/devx-promotion.yml`: placeholder logging "not yet wired — Phase 1 (epic-promotion-gate-yolo-beta)."
- `.github/workflows/devx-deploy.yml`: empty stub triggered on main pushes.
- `.github/pull_request_template.md`: spec link section, mode marker `<!-- devx:mode -->`, test-plan checklist, risk + rollback section, `Co-Authored-By: devx-agent <noreply@devx.local>`.

#### FR-J: Branch protection + develop branch

- Create `develop` if absent (off `main`'s HEAD); set as repo default branch.
- `gh api PUT repos/:owner/:repo/branches/main/protection` with: required contexts `[lint, test, coverage]`, `enforce_admins: true`, `required_pull_request_reviews` non-null with `required_approving_review_count: 0`, `required_linear_history: true`, `allow_force_pushes: false`, `allow_deletions: false`.
- Free-tier private-repo degradation: detect `gh api repos/:owner/:repo -q .private,.plan.name`; if private + free → install pre-push git hook + write MANUAL.md warning explaining the gap.

#### FR-K: Backlog file empty-state copy

Each newly-created backlog file gets a short `<!-- devx-empty-state-start -->` block at top with 2–3 lines of "what goes here" guidance. Auto-deletes once the file holds N≥3 items. Files: DEV.md, PLAN.md, TEST.md, DEBUG.md, FOCUS.md, INTERVIEW.md, MANUAL.md, LESSONS.md.

#### FR-L: Seeded INTERVIEW.md from fixed stack template

INTERVIEW.md is seeded with 3 pre-canned questions chosen by detected stack. No live PlanAgent invocation in Phase 0 — that's Phase 1's responsibility once `/devx-plan` exists. Templates per stack live at `_devx/templates/interview-seed-<stack>.md`.

#### FR-M: Persona seeding

`focus-group/personas/` is created with 4 real + 1 anti-persona files derived from the answer to N3 ("who for?"). If the user answers "you propose," `/devx-init` falls back to a 5-template default (one-of-each archetype). The anti-persona is mandatory.

#### FR-N: CLAUDE.md seed

If absent, write a minimal `CLAUDE.md` with: project context derived from N1, devx invariants block (8 backlog files, branching model, mode, project shape, thoroughness — all wrapped in `<!-- devx:start --> … <!-- devx:end -->` markers).

### Non-functional requirements

- **Time to complete /devx-init:** ≤ 5 minutes on a typical project (≤ 2 min if defaults inferable). Wall clock, not human-attention time.
- **Idempotent re-run:** ≤ 30 seconds when nothing has changed.
- **Cross-platform:** macOS 13+, Linux (any systemd-user-capable distro), Windows 10+ via WSL2. Tested matrix: macOS / Ubuntu LTS / Windows-WSL2-Ubuntu.
- **No new runtimes:** Node ≥ 20 only (BMAD already requires this). No Python, no Go, no Rust prerequisite.
- **No network calls during config-only `devx config`** — fully local.
- **Zero pending state on success:** `init.partial:true` cleared only when every deferred GH op completes.

### Layer coverage

- **Frontend (CLI):** FR-A through FR-E, FR-G — the `/devx-init` conversation, `devx <subcmd>` skeleton, `devx config` round-trip.
- **Infrastructure:** FR-F (OS supervisor units), FR-I (CI workflows), FR-J (branch protection + develop), FR-N (CLAUDE.md). Idempotent, cross-platform, escape-hatchable.
- **Backend:** None — no daemon body, no server. Phase 1+.

### Dependencies (external)

- **Node ≥ 20** — covered by BMAD prereq.
- **`gh` CLI authenticated** — degrades to MANUAL.md entry if absent.
- **`git` ≥ 2.30** — for `git worktree` (used Phase 1+, but checked at init).
- **GitHub repo with push access** — degrades to no-remote path if absent.
- **Apple/MS/Linux init system** — launchd / systemd / Task Scheduler. All present by default on supported OSes.

### Release milestones

- **M0 — "Hello, init"**: `/devx-init` walks 13 questions on a fresh empty repo and produces all 8 backlog files + `devx.config.yaml` + `.gitignore` + `CLAUDE.md`. Failure modes covered. (epic-init-skill alone, sans CI/supervisor/CLI/BMAD-audit.)
- **M1 — "Config round-trips"**: `devx config <key>` and `devx config <key> <value>` work end-to-end against the merged project + user file. (epic-config-schema added.)
- **M2 — "Daemon shells, but stalled"**: OS-level supervisor units install on all three platforms; `launchctl list` / `systemctl --user status` / `schtasks /Query` confirm "running" — unit body is sleep-infinity. (epic-os-supervisor-scaffold added.)
- **M3 — "Surface area visible"**: All 11 `devx <subcmd>` discoverable; help lists each with phase/epic; stubs print to stderr and exit 0. (epic-cli-skeleton added.)
- **M4 — "Foundation complete"**: `bmad-audit.md` committed; CI workflows scaffolded; branch protection on main; `develop` is default; pull_request_template ships. (epic-bmad-audit + remaining epic-init-skill subtasks added.)

### Success metrics

- ≥ 95% of `/devx-init` runs complete on first attempt across the OS matrix (no half-bricked repos).
- ≤ 5 minutes to M0 on empty repo; ≤ 2 minutes on existing repo with inferable defaults.
- `devx config` round-trip preserves comments + ordering on a hand-edited `devx.config.yaml` 100% of the time.
- 0 commits ever pushed direct to `main` post-/devx-init (branch protection enforced for repo admins).
- 100% of `devx <subcmd>` stubs surface their target Phase + epic to the user.
- `bmad-audit.md` classifies every BMAD workflow we found in `_bmad/`.

### Open questions (resolved here)

- **OQ-A0.1 — CLI tech?** → Node TypeScript via `npm i -g @devx/cli`. (Reuses existing BMAD Node prereq; zero new runtime.)
- **OQ-A0.2 — YAML round-trip library?** → `eemeli/yaml` (`parseDocument` mode). Restrict Phase 0 writes to leaf scalars.
- **OQ-A0.3 — Stub command exit semantics?** → exit 0, message to stderr, format `not yet wired — ships in Phase <N> (<epic-slug>)`.
- **OQ-A0.4 — `devx` binary install path?** → global npm bin, on PATH. launchd/systemd reference `devx` directly; `command -v devx` verified at end of init.
- **OQ-A0.5 — Config schema location?** → ships embedded in the npm package (NOT under `_bmad/` per CONFIG.md's stale path). CONFIG.md gets corrected in epic-config-schema.
- **OQ-A0.6 — Cloud-watchdog stub workflow now?** → No. Defer entirely to Phase 2's `epic-cloud-watchdog`.
- **OQ-A0.7 — Seeded INTERVIEW.md from live PlanAgent?** → No (Phase 0 = no execution loop). Fixed-template-per-stack approach. Live generation lives in Phase 1's `/devx-plan`.
- **OQ-A0.8 — Question ordering?** → Reordered for narrative flow per FR-A's table.
- **OQ-A0.9 — Empty backlog files barren?** → No. Each gets a `<!-- devx-empty-state-start -->` comment block that auto-deletes when N≥3 items.
- **OQ-A0.10 — Failure-mode policy?** → Per FR-C; never half-brick; always degrade with one MANUAL.md entry per blocker.

### Open questions (escalated to user — none)

All Phase 0 surfaces resolved by existing locked decisions in `docs/CONFIG.md`, `docs/DESIGN.md`, `docs/MODES.md`, `docs/ROADMAP.md`, persona-leonid voice, and product-brief Moment 2. Phase 0 plan-spec mode is YOLO, project_shape is empty-dream — autonomous decisions are in scope per `/devx-plan` rules.

---

## Addendum — 2026-04-28 — Phase 1 Single-agent core loop (devx itself)

Derived from [`docs/ROADMAP.md § Phase 1`](../../docs/ROADMAP.md#phase-1--single-agent-core-loop-week-2) and [`plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md`](../../plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md). Plan mode: YOLO, project_shape: empty-dream, thoroughness: balanced. Stack layers (per plan frontmatter): backend + infra. No frontend layer in scope this phase.

### Goals

1. `/devx-plan` is the canonical PlanAgent skill — research → PRD → architecture → epic chunking → party-mode → focus-group (mode-gated) → DEV.md entries — emitting `branch:` frontmatter derived from `devx.config.yaml` (no hardcoded `develop/`), retro stories with sprint-status rows, and source-of-truth precedence applied. v0 bootstrap text in `.claude/commands/devx-plan.md` is refined in-place.
2. `/devx` is the canonical DevAgent skill — claim → worktree → (conditional bmad-create-story) → bmad-dev-story → adversarial self-review → mode-derived **merge gate** → push → wait remote-CI-if-configured → merge → cleanup. v0 bootstrap text in `.claude/commands/devx.md` is refined in-place. The `bmad-create-story` step becomes conditional on project_shape (empty-dream → skip with rationale, anything else → invoke); ships behind a canary that runs the conditional path on one in-flight story before flipping the default.
3. `/devx-manage` v0 exists as a thin scheduler+supervisor: reads backlogs, picks one runnable item from `DEV.md`, spawns one `claude /devx <hash>` subprocess (hard-capped at N=1), persists `.devx-cache/state/{schedule.json,manager.json}`, writes `heartbeat.json` every 60s, restarts the worker on plain crash (exit code != 0). No context-rot detection (Phase 2). No event-stream parsing (Phase 2).
4. `.github/pull_request_template.md` ships, with the spec-file link as the first line of every agent PR body and an explicit `Mode: <YOLO|BETA|PROD|LOCKDOWN>` line stamped at PR-open time so reviewers see the gate that auto-merge is using.
5. The mode-derived **merge gate** is implemented as a single primitive (`mergeGateFor(mode)` returning the gate predicate set) consumed by both `/devx`'s feature→main merge (single-branch) and the (not-yet-exercised-in-self-host) `/devx-manage` develop→main promotion. YOLO = CI green only; BETA = CI green + no blocking PR comments; PROD = CI green + no blocking comments + 100% touched-line coverage. Single implementation, single test surface, ready for split-mode users without rework.

### Non-goals (this addendum)

- Context-rot detection (`epic-context-rot-detection` — Phase 2). Manager v0 supervises by PID + exit-code only.
- Event-stream emission and consumption (`epic-events-stream` — Phase 2). Manager v0 reads spec status logs + `.devx-cache/state/*.json`, not jsonl streams.
- Restart-from-status-log resume protocol (`epic-restart-from-status-log` — Phase 2). v0 restart respawns against the same hash but does not synthesize a resume snippet; the existing v0 `/devx`'s "is this a resume?" check at Phase 1 of its loop carries the load.
- Crash recovery from disk after Manager dies (`epic-crash-recovery` — Phase 2). v0 logs a fatal line and exits; the OS supervisor unit (sup402/sup403/sup404) restarts it; the next tick rediscovers state from backlog files + `schedule.json`.
- Concierge (`epic-devx-concierge-skill` — Phase 2). User invokes `devx ask` and gets the existing stub.
- Mutual + cloud watchdog (`epic-mutual-watchdog`, `epic-cloud-watchdog` — Phase 2). v0 relies on the OS supervisor only.
- Locks, intents, parallelism (Phase 3). v0 hard-caps at one worker.
- TUI / web / mobile event relay (Phase 4).
- Test, debug, retro, learn agents as scheduled workers (Phase 5). The interim `*ret` per-epic retro-story discipline continues until then.
- Focus-group consultation in `/devx-plan` Phase 6.5 — skipped under YOLO per [`docs/MODES.md`](../../docs/MODES.md). The skill code path exists and is exercised under BETA/PROD only.
- LOCKDOWN mode wiring beyond "do not merge; leave PR open" — full LOCKDOWN gate cascade is Phase 9.
- Promotion-gate execution against a real develop/main project — the merge-gate primitive is built and unit-tested, but the develop→main flow is dead code in self-host until a non-YOLO devx user appears. ([`OQ-B1.4`](#open-questions-resolved-here-1) below.)

### Users

- **Primary:** Leonid (solo founder-engineer) — first user of the closed loop. Persona: `focus-group/personas/persona-leonid-solo-founder.md`.
- **Anti-persona:** Morgan. "Ceremony-for-ceremony's-sake" / enterprise-flavored gates are red flags and get cut.

### Functional requirements

#### FR-B1: `/devx-plan` runs the seven-phase loop end-to-end

The current `.claude/commands/devx-plan.md` (this skill) becomes the canonical PlanAgent skill, with the following invariants enforced:

- **Phase 1 — Intake.** Reads `devx.config.yaml`, all 8 backlog files, prd.md/architecture.md/epics.md if present, sprint-status.yaml, focus-group/personas/. Honors plan frontmatter overrides for `mode`, `project_shape`, `thoroughness`.
- **Phase 2 — Parallel research.** Spawns research agents per applicable axis (Domain + Codebase always; Frontend/Backend/Infra conditional on `stack.layers`; Market conditional on requirements). Each capped at 400 words. Synthesizes in-memory only (no research-doc write unless asked).
- **Phase 3 — PRD synthesis** via `bmad-create-prd`. Append-only addenda — never overwrite.
- **Phase 4 — Epic chunking.** 3–8 stories per epic. Every epic traces user action → every declared layer → result. Layer "None" allowed but must include a one-line rationale.
- **Phase 5 — Draft.** Writes `_bmad-output/planning-artifacts/epic-<slug>.md` with `<!-- draft: pre-critique -->`, `dev/dev-<hash>-<ts>-<slug>.md` per story (frontmatter: `branch:` derived from `devx.config.yaml`, never hardcoded `develop/`), DEV.md rows, sprint-status.yaml entries, epics.md addendum heading, **per-epic `*ret` retro story** (story + DEV.md row + sprint-status row, all three present and consistent — closes the LEARN.md cross-epic-pattern bug).
- **Phase 6 — Party-mode.** Sequential per epic; PM/UX/Dev/Architect/Infra/Murat lenses (skipped per absent layer); decisions feed forward to later epics via in-memory locked-decisions list. Rewrites epic file in place; flips comment to `<!-- refined: party-mode YYYY-MM-DD -->`.
- **Phase 6.5 — Focus-group.** Skipped under YOLO. Under BETA/PROD: per-epic persona panel via `focus-group/prompts/new-feature-reaction.md`; writes `focus-group/sessions/session-*.md`; cross-references back to epic.
- **Phase 7 — Readiness check** via `bmad-check-implementation-readiness`; fix in place.
- **Phase 8 — Final summary** including a `Next command` block with exact `/devx <hash>` invocations in dependency order. Never auto-pushes; never commits.

Ask-vs-YOLO discipline per the skill body: BMAD presentation menus → YOLO; net-new user-visible surface, candidate deferral, non-trivial trade-off → ask once and batch.

#### FR-B2: `/devx` runs the nine-phase loop end-to-end with mode-gated merge

The current `.claude/commands/devx.md` becomes the canonical DevAgent skill, with the following invariants enforced:

- **Phase 1 — Claim.** Resolve item (hash | slug | `next`); flip DEV.md `[ ]`→`[/]`; spec frontmatter `status: in-progress`; status log line; **push the claim commit to remote integration branch** before opening the PR (root-cause-fix for `feedback_devx_push_claim_before_pr.md`); create worktree on the resolved branch (prefix derived from `devx.config.yaml → git.{integration_branch,branch_prefix}`); enter worktree.
- **Phase 2 — BMAD story (conditional).** Skip with one-line rationale when `project.shape == empty-dream` AND no story file exists AND spec ACs ≥ 3 actionable items. Otherwise invoke `bmad-create-story`. Conditional ships behind a canary: one in-flight story exercises the new conditional path; if green, default flips. Spec ACs remain top of source-of-truth precedence regardless. (Resolves the LEARN.md `[high] [skill]` cross-epic pattern that hit 25/25 in Phase 0.)
- **Phase 3 — Implement** via `bmad-dev-story`; red-green-refactor; all tasks/subtasks; story File List updated; spec status log line.
- **Phase 4 — Self-review (adversarial, non-skippable)** via `bmad-code-review`. Find 3–10 issues minimum (zero = failed review, re-run stricter). Fix ALL HIGH/MED/LOW automatically. Re-review. (Closes the LEARN.md `[high] [code]` cross-epic pattern.)
- **Phase 5 — Local CI** per `devx.config.yaml → projects:` for the touched surface (single-project or monorepo). Coverage gate is mode-derived: YOLO informational; BETA warn <80%; PROD block <100% line-of-touched-surface (`# devx:no-coverage <reason>` per-line opt-out); LOCKDOWN block <100% AND require browser-QA pass.
- **Phase 6 — Commit.** One commit per story / sub-task; conventional-commit prefix; message links spec + story (when story exists). Stage files explicitly; never `git add -A`.
- **Phase 7 — Push, PR, remote CI.** Push branch; open PR targeting resolved base; remote CI detection per `.github/workflows/` presence (no workflow → local gates authoritative; workflow + no run for branch → file INTERVIEW + stop; workflow + run → poll until completion via `ScheduleWakeup`).
- **Phase 8 — Auto-merge (mode-gated via `mergeGateFor(mode)`).** YOLO: merge immediately on green; BETA: + no blocking comments; PROD: + coverage gate clear; LOCKDOWN: do not merge, file MANUAL.md, leave PR open. Trust-gradient `promotion.autonomy.count < initial_n` requires INTERVIEW approval (does not apply to this project; `count: 0, initial_n: 0`). After merge: `git fetch --prune && git pull --ff-only` on main worktree, remove worktree, delete local branch, update spec/sprint-status/DEV.md, commit + push the bookkeeping commit on `main`.
- **Phase 9 — Loop or finalize.** Honors `stop_after`; emits the Handoff Snippet on early stop.

Branching contract: every step reads `git.{default_branch,integration_branch,branch_prefix,pr_strategy}` from `devx.config.yaml`. `pr_strategy: direct-to-main` allowed only under YOLO single-branch. Non-existence of `integration_branch` collapses the promotion gate into the merge gate (single-branch).

#### FR-B3: `/devx-manage` v0 is a thin loop, hard-capped at N=1

A single TypeScript module under `src/lib/manage/` invokable as `devx manage` (the existing stub in `src/commands/` flips to real). Exits non-zero on fatal errors so the OS supervisor (sup402/3/4) restarts it. Per-tick:

1. **Read state.** `DEV.md`, `INTERVIEW.md`, `MANUAL.md` (for unblock detection); `.devx-cache/state/{schedule.json,manager.json}` if present; `.devx-cache/locks/manager.lock` (acquire-or-wait with `O_EXCL`-style atomic create — same primitive as `_devx/state/*.installed.json` from epic-os-supervisor-scaffold's `supervisor-internal.ts`).
2. **Reconcile.** Detect duplicate / superseded / completed entries. Detect INTERVIEW answers + MANUAL completions and unblock specs whose `blocked-by:` clears.
3. **Compute desired roster.** Top one `[ ]` ready spec from `DEV.md` whose blockers are clear. **Hard cap = 1** — explicit constant; not parameterized off `capacity.max_concurrent` until Phase 3. Unit test asserts spawn-2 is rejected with the exact "Phase 1 hard cap" error.
4. **Reconcile against running.** Read currently-spawned PIDs from `.devx-cache/state/manager.json`. If a child exists and its target spec is still ready → leave alone. If exited cleanly with target spec marked `done` → release slot, log to `manager.json`. If exited non-zero (plain crash, not rot) → respawn against the same spec, increment `crash_count`, fall back to `worker_crash_backoff_s` from config; after `manager.max_restarts_per_spec` (default 5) → mark spec `blocked` with status-log line "manager: max restarts exceeded" and file `INTERVIEW.md` entry.
5. **Spawn if room.** Spawn `claude /devx <hash>` as a detached child via `child_process.spawn`. Persist (pid, hash, started_at, model) to `manager.json`. Atomic write (`*.tmp` + `rename`).
6. **Heartbeat.** Append to `.devx-cache/state/heartbeat.json` (single line: `{ts, pid, generation}`); rotate at 1 MB.
7. **Sleep.** `manager.heartbeat_interval_s` (default 60s) before next tick. SIGTERM-clean: drains a pending tick and exits 0.

Out of scope for v0 (Phase 2): event-stream parsing, token-pct restart, max-worker-age restart, FOCUS reprioritization, LearnAgent scheduling, watchdog cooperation.

#### FR-B4: `pull_request_template.md` ships from `_devx/templates/`

`/devx-init` (epic-init-skill, already shipped) supplies templates from `_devx/templates/`. Add `pull_request_template.md` there. `/devx-init` writes it to `.github/pull_request_template.md` if not present (idempotent — never overwrite). Template body:

```markdown
<!-- devx:mode -->
**Spec:** `<dev/dev-<hash>-<ts>-<slug>.md>`
**Mode:** <!-- devx:auto:mode --> *(stamped at PR-open by /devx)*

## Summary
<1–3 bullets on what changed>

## Acceptance criteria
<checkbox list copied from spec>

## Test plan
<bulleted list of what local CI gates covered + any manual steps>

## Notes for reviewers
<surprises, deviations, follow-ups>
```

`/devx` Phase 7 PR-body construction reads this template, replaces `<!-- devx:auto:mode -->` with the current `devx.config.yaml → mode`, and emits the rendered body via `gh pr create --body`. Tests cover: (a) template substitution, (b) mode stamping, (c) idempotent re-write skip in `/devx-init`.

#### FR-B5: Mode-derived merge gate as a single primitive

A pure function `mergeGateFor(mode: Mode, signals: GateSignals): GateDecision` in `src/lib/merge-gate.ts`. Signals carry the inputs the gate cares about: `ciConclusion`, `blockingReviewComments`, `coveragePctTouched`, `lockdownActive`, `trustGradient: {count, initialN}`. Decision: `{merge: boolean, reason: string, advice?: string[]}`.

| Mode | merge=true iff |
|---|---|
| YOLO | `ciConclusion == 'success' OR ciConclusion == null` |
| BETA | YOLO conditions + `blockingReviewComments == 0` |
| PROD | BETA conditions + `coveragePctTouched >= 1.0` |
| LOCKDOWN | always false; reason = "lockdown active; manual merge required" |

Trust-gradient overrides ALL: if `trustGradient.count < trustGradient.initialN`, decision is "do not auto-merge; file INTERVIEW for approval" regardless of mode. (No-op for this project; both are 0.)

Consumed by:
- `/devx` Phase 8 (skill body — invokes via `devx merge-gate <hash>` CLI passthrough or inline TS import depending on harness; story decides).
- `/devx-manage` (when develop→main promotion lands; v0 doesn't exercise this) — re-uses the same primitive at the promotion step under split-branch projects.

Tests: gate truth table per mode; trust-gradient override; LOCKDOWN regardless; signals defaulting (e.g., absent CI workflow ↔ `ciConclusion: null` ↔ green for YOLO).

### Non-functional requirements

- **Context budget per /devx run:** ≤ `capacity.token_budget_per_spec` (current 500K). Manager kills + respawns if exceeded (Phase 2 — out of scope here; v0 lets it run to natural completion).
- **`/devx-manage` tick wall-clock:** ≤ 5s on a 30-spec backlog with one running worker. (Stays well under heartbeat interval.)
- **Heartbeat freshness:** `heartbeat.json` ts within 90s of wall-clock when manager is healthy. The OS supervisor restart cycle handles older-than-300s on Phase 2's mutual-watchdog epic.
- **Atomic state writes:** every `.devx-cache/state/*.json` write is `*.tmp` + `rename` so partial writes are impossible.
- **Single-branch correctness:** every `/devx` run on this self-host project pushes to `feat/dev-<hash>` off `main`, PRs to `main`, squash-merges, deletes branch — no `develop` references in the actual flow (only as fallback path in skill code for split-mode projects).

### Layer coverage

- **Backend (CLI / skill):** FR-B1, FR-B2, FR-B3, FR-B5. The `/devx-plan` and `/devx` skill bodies live as `.claude/commands/*.md` (text, exercised by Claude Code at runtime). `/devx-manage` v0 is TypeScript under `src/lib/manage/` + `src/commands/manage.ts`. Merge gate is `src/lib/merge-gate.ts`.
- **Infrastructure:** FR-B4 (PR template). `.github/pull_request_template.md`. The mode-stamping wire-up is in the `/devx` skill (which substitutes at PR open time via `gh pr create --body`).
- **Frontend:** None — this phase touches no UI surface. (Mobile companion runs in parallel via plan-7a2d1f.)

### Dependencies (external)

- **`gh` CLI authenticated** — required for `/devx` PR open + merge. (Already required by Phase 0.)
- **`claude` CLI on PATH** — required for `/devx-manage` v0 to spawn worker subprocesses. (Already required for any agent run.)
- **GitHub repo with push access** — required for `/devx` PR flow. Self-host already has it.
- **No new runtimes** — Node 20+, TypeScript, Bun all already required.

### Release milestones

- **M-B1.0 — `/devx-plan` runs its seven-phase loop on a real plan-spec without hand-edits to the emitted artifacts.** Test: `/devx-plan c4f1a2` (Phase 2 control plane, the next plan after this one) emits epic files + dev specs + sprint-status rows + retro stories with no hand-fixing of `branch:` frontmatter or sprint-status entries. (Validates end-to-end on the next plan that ships through this skill.)
- **M-B1.1 — `/devx` ships a single Phase 1 story end-to-end** including the conditional `bmad-create-story` skip + canary, with the retro story authored alongside.
- **M-B1.2 — `/devx-manage` runs as a foreground process and supervises one `/devx` invocation through claim → merge → cleanup** with crash-restart proven (kill -9 the child mid-run; manager respawns; second worker completes the same spec). Logs in `~/Library/Logs/devx/manager.log`.
- **M-B1.3 — `pull_request_template.md` ships and is rendered on the next `/devx` PR** with `Mode: YOLO` correctly stamped.
- **M-B1.4 — `mergeGateFor()` truth-table tests pass** for all four modes + trust-gradient override.

### Success metrics

- ≥ 1 Phase 2 story (i.e., something planned by /devx-plan after this Phase 1 lands) ships through `/devx-plan` → `/devx` with zero hand-edits to emitted artifacts.
- 0 of the 5 LEARN.md `[high]` cross-epic patterns regress (`branch:` derivation, retro-row presence, source-of-truth precedence application, self-review non-skippable, `bmad-create-story` skip rationalized).
- `/devx-manage` v0 survives 5 consecutive plain-crash restarts of its child worker without manual intervention.
- PR template renders with the spec link as the first line on 100% of /devx-emitted PRs.

### Open questions (resolved here)

- **OQ-B1.1 — Promotion-gate framing under single-branch.** → Q1=(c) Rebrand `epic-promotion-gate-yolo-beta` to `epic-merge-gate-modes`. Single primitive `mergeGateFor()` consumed by `/devx` (single-branch) and `/devx-manage` (split-branch promotion when used). Built and unit-tested under self-host; develop→main path is dead code until a split-branch user arrives.
- **OQ-B1.2 — `bmad-create-story` step in `/devx`.** → Q2=(c) Conditional + canary. Skip when `project.shape == empty-dream` AND spec ACs ≥ 3 actionable items AND no story file exists. Land via canary on one in-flight story before flipping default. Spec ACs remain top of source-of-truth precedence.
- **OQ-B1.3 — `/devx-manage` v0 worker count.** → Q3=Hard cap N=1. `capacity.max_concurrent: 5` from config is honored from Phase 3's epic-capacity-management. v0 has an explicit constant + a unit test asserting spawn-2 rejection with the exact error message.
- **OQ-B1.4 — Develop→main promotion code path under self-host.** → Built but not exercised. Pure-function merge gate keeps the dead code minimal (one function + tests). When a non-self-host devx user opts into split-branch, the develop→main code path runs without rework.
- **OQ-B1.5 — Skill-prompt edits and the `self_healing.user_review_required_for: [skills]` gate.** → The Phase 1 skill edits to `.claude/commands/devx.md` and `.claude/commands/devx-plan.md` ARE the user-review-required edits. They land via the standard `/devx` PR flow with the user as the merge-approver of the actual PR. (Self-host loop catches its own learning.)

### Open questions (escalated to user — resolved before this addendum was written)

- **Q1, Q2, Q3** above (resolved 2026-04-28 per user reply: Q1=(c), Q2=(c), Q3=hard-cap-1). Pinned in OQ-B1.1 / OQ-B1.2 / OQ-B1.3.

