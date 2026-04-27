# MANUAL — Actions only the user can do

Items here block `/dev` when the user's action is required. Check off when done.

## For Epic 1 (Flutter scaffold & iOS on device)

- [ ] **M1.1 — Share Apple Developer Team ID.**
  - Why: `dev-a10003` needs it to configure iOS signing.
  - How: Apple Developer portal → Membership → copy Team ID (10-char string).
  - Blocks: `dev-a10003`.

- [ ] **M1.2 — Register iPhone UDID in Developer portal.**
  - Why: Development signing requires the device be registered.
  - How: Plug phone into Mac → Xcode → Window → Devices and Simulators → copy UDID → Apple Developer portal → Devices → Add.
  - Blocks: `dev-a10004`.

- [ ] **M1.3 — Upload first archive to App Store Connect / TestFlight.**
  - Why: One-time setup that can't be automated without App Store Connect API key. Subsequent builds can be scripted.
  - How: Xcode → Product → Archive → Distribute App → App Store Connect → Upload. Wait 10-20 minutes for processing.
  - Blocks: `dev-a10005`.

## For Epic 4 (Real-time updates)

- [ ] **M4.1 — Create Firebase project and download service account JSON.**
  - Why: Worker needs service account credentials to send FCM pushes.
  - How: firebase.google.com → Create project → Project Settings → Service Accounts → Generate new private key (JSON download).
  - Blocks: `dev-d40002`.

- [ ] **M4.2 — Upload APNs auth key to Firebase.**
  - Why: Firebase uses APNs under the hood to deliver iOS pushes.
  - How: Apple Developer → Keys → Create a new key with APNs enabled → download `.p8`. Firebase console → Project Settings → Cloud Messaging → Apple app configuration → upload `.p8`.
  - Blocks: `dev-d40002`.

- [ ] **M4.3 — Add GoogleService-Info.plist to mobile/ios/Runner/.**
  - Why: Flutter `firebase_messaging` needs this to identify the app with FCM.
  - How: Firebase console → Project Settings → Your apps → iOS app → download `GoogleService-Info.plist` → drop into `mobile/ios/Runner/` in Xcode.
  - Blocks: `dev-d40005`.
  - Note: gitignored to avoid leaking app-private config.

- [ ] **M4.4 — Create GitHub webhook on the devx repo pointing at Worker URL.**
  - Why: Without a webhook configured, GitHub never notifies the Worker.
  - How: devx repo → Settings → Webhooks → Add. Payload URL: `https://<worker-url>/webhook/github`. Content type: application/json. Secret: generate one; mirror into Worker secret `GH_WEBHOOK_SECRET`. Events: Push, Pull requests, Check suites, Workflow runs.
  - Blocks: `dev-d40003`.

## For Epic 4 — OS supervisor scaffold (Phase 0)

- [ ] **MS.1 — On-host launchd kill-and-watch-restart proof (macOS).**
  - Why: sup402's automated tests use a mocked `launchctl` so they run on Linux CI. The "the unit actually auto-restarts after a kill" check requires real launchd and can't be a CI step.
  - How: After `installSupervisor("manager", "launchd")` runs (e.g., from `/devx-init`), on a macOS host:
    ```sh
    launchctl print "gui/$(id -u)/dev.devx.manager"   # expect state = running
    launchctl kickstart -k "gui/$(id -u)/dev.devx.manager"
    sleep 12
    launchctl print "gui/$(id -u)/dev.devx.manager"   # expect state = running (PID changed)
    ```
  - Blocks: nothing (informational; Phase 1 supervisor body comes online before any user-visible signal depends on it).
  - Spec: `dev/dev-sup402-2026-04-26T19:35-supervisor-launchd.md`.

## For Epic 3 (prerequisite)

Both M3.1 and M3.2 are now N/A for this project — INTERVIEW Q#7 (2026-04-26)
opted out of the develop/main split + branch protection. The /devx-init flow
upstream still recommends both for non-YOLO projects; this project simply
declined. If/when this project upgrades to BETA or PROD, revisit.

- [x] ~~**M3.1 — Enable branch protection on `main`.**~~ N/A — `git.protect_main: false` per INTERVIEW Q#7. Re-enable if mode changes to BETA/PROD.

- [x] ~~**M3.2 — Create `develop` branch if absent.**~~ N/A — `git.integration_branch: null` per INTERVIEW Q#7. The develop branch was created and then collapsed back into main during the bootstrap session. Phone (Phase 8) will target main directly while this config holds.

## For Phase 0 — bookkeeping (filed by cfgret 2026-04-27)

- [ ] **MP0.1 — Backfill stale `sprint-status.yaml` story rows.**
  - Why: cfgret's formal retro found that several merged stories still carry `status: backlog` in `_bmad-output/implementation-artifacts/sprint-status.yaml`: `aud101`, `aud102`, `aud103`, `sup405`. Their PRs all merged (PR #1, #2, #3, #17) but `/devx` Phase 8.6 didn't flip their yaml rows. Currently harmless (no consumer reads the yaml) but becomes a behavior bug the moment LearnAgent or `/devx-manage` lands.
  - How: open `_bmad-output/implementation-artifacts/sprint-status.yaml`; flip the four rows from `status: backlog` to `status: done`. Single-line edit per row. Optionally also note ini501 (already shows `done`, included for completeness check). Commit as `chore: backfill stale sprint-status flips for aud101–103 + sup405`.
  - Blocks: nothing immediate. File a `chore:` debug spec instead if you'd rather have an agent do it (it's mechanical).
  - Source: `LEARN.md § epic-config-schema` E3, `_bmad-output/implementation-artifacts/epic-config-schema-retro-2026-04-27.md` §3.4.
