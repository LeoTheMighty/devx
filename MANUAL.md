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

- [x] **MP0.2 — Approve skill-prompt edit so retro rows auto-emit into `sprint-status.yaml`.** *Closed by pln102 (PR #39, merged 2026-05-03).* `src/lib/plan/emit-retro-story.ts` ships `emitRetroStory()` (pure) + `writeRetroAtomically()` (I/O driver) that co-emits all three artifacts (spec / DEV.md / sprint-status.yaml) per epic with fixed-order rename atomicity. `.claude/commands/devx-plan.md` Phase 5 §6 now invokes the helper via `devx plan-helper emit-retro-story`. Future retros emitted by `/devx-plan` after pln102's merge include the sprint-status row automatically; plnret was the **last** retro requiring manual backfill (it was emitted on 2026-04-28 before pln102 shipped). See `LEARN.md § epic-devx-plan-skill` E1 + Cross-epic patterns row "Retro stories absent from sprint-status.yaml" closure note.

- [ ] **MP1.1 — Approve skill-prompt edit to require explicit-zero status-log enumeration in `/devx`.**
  - Why: plnret's formal retro confirmed for the third time (sup 5/5 uniform + ini 4/8 mixed + pln 4/6 mixed) that `/devx` status logs sometimes omit per-phase milestones and self-review finding counts even when the underlying work is substantial. mrg (0/3 omit) and prt (0/2 omit) are positive counterexamples — when the run-style is rich, the logs are rich; the variance is `/devx` run-style rather than story-shape. Cumulative omission rate across the 3 confirming epics: 13/19 stories (~68%). The corrective is a one-line skill prompt-card addition.
  - How: edit `.claude/commands/devx.md` near Phase 4 (Self-review) and Phase 8 (Auto-merge / cleanup) — add a prompt-card line such as: "Status-log entries MUST enumerate per-phase milestones AND self-review finding counts. Use the explicit-zero shape ('self-review found nothing actionable' / 'self-reviewed (zero actionable findings)' per `LEARN.md § epic-merge-gate-modes` E7) when there's nothing to fix; never omit." Optionally add a complementary line near Phase 1 (Claim) requiring the claim line + push-before-PR confirmation, since pln103/104/105/106 status logs all omitted those too.
  - Blocks: nothing immediate. The status-log terseness is currently harmless (no consumer reads the logs except this retro pass) but becomes a behavior bug the moment LearnAgent lands and tries to harvest signal from per-phase milestone history.
  - User-review-required because `self_healing.user_review_required_for: [skills]`.
  - Source: `LEARN.md § Cross-epic patterns` row "Status-log terseness pattern (corrective-needs-promotion)", `_bmad-output/implementation-artifacts/epic-devx-plan-skill-retro-2026-05-05.md` §3.1.

## For V2.5 — overnight loop (filed by v2l101)

- [ ] **MV2.1 — Run the S-3 supervised night, then a real night.**
  - Why: v2/00-vision.md S-3 ("an overnight `devx loop` run completes ≥3 backlog items unattended, with every failure either recovered or cleanly rolled back, and produces a morning report reconstructable from disk alone") is a *behavioral* acceptance criterion — it can only be verified by actually running the loop, and the first run should be supervised (v2/06-phases.md § V2.5 "First supervised night (Leo awake), then first real night").
  - How: (1) with Leo awake, run `devx loop --dry-run` and review the plan; then `devx loop --until <bedtime+2h> --max-items 2` and watch one full item cycle (claim → iterations → PR → merge tail → report). (2) If the supervised run behaves, pick a real night: `devx loop --until 07:30`. (3) In the morning, run `devx next` (row 1 reads the report) and verify every claim from disk — `git log --oneline`, `gh pr view` per PR, preserved-worktree paths for any abandoned item.
  - Blocks: S-3 sign-off (v2/06-phases.md § V2.5 exit AC). The chaos test ships in-repo (`test/loop-chaos.test.ts`); this item is the human half.
  - Spec: `dev/dev-v2l101-2026-07-05T13:06-overnight-loop.md`.

- [ ] **MV2.2 — Keep the lid open (or power + display settings) for overnight `devx loop` runs.**
  - Why: `caffeinate -i` prevents idle sleep but NOT lid-close sleep; a suspended machine hangs every worker session mid-flight (the 2026-07-24 hfi103 incident — three "iterations" that mostly measured a sleeping laptop). The loop now detects suspend gaps and classes post-wake kills as environment failures instead of item failures (dc7514), but the night still produces nothing while the machine sleeps.
  - How: leave the lid open with the display allowed to sleep (system sleep off while `caffeinate` runs), or dock the machine on AC power with "Prevent automatic sleeping when the display is off" enabled.
  - Blocks: nothing structurally — this is throughput hygiene for real overnight runs.
  - Spec: `debug/debug-dc7514-2026-07-25T08:55-loop-infra-failure-classification.md`.

## MV-pin103.1 — Stale/rewritten devx launchd units on this Mac

During pin103's E-4 eval (2026-07-15 ~09:24), the pre-fix upgrade path ran the
real supervisor repair and rewrote `~/Library/LaunchAgents/dev.devx.manager.plist`.
Current host state: `dev.devx.manager` + `dev.devx.concierge` are loaded in
launchd with status 78, pointing at `~/.devx/bin/devx-supervisor-stub.sh`
which does NOT exist — they are broken regardless of origin (they may predate
today from Phase 0 supervisor testing). The code is fixed (bare/upgrade
`devx init` no longer touches launchd; PR pin103), but the host state is yours
to settle:

- [ ] Either remove the stale units: `launchctl bootout gui/$(id -u)/dev.devx.manager;
      launchctl bootout gui/$(id -u)/dev.devx.concierge; rm -f
      ~/Library/LaunchAgents/dev.devx.*.plist` — or reinstall properly via the
      interactive `/devx-init` when you want the supervisor running (MV2.1).

## MV-pin105.1 — S-5 live validation on palateful (owner at the keyboard)

The scripted half of pin105 shipped; these three steps close S-5 (G-1/G-3)
and feed `devx outcome` for the portability-install workstream. Full
step↔threshold table + results record:
`_devx/workstreams/portability-install/evals/E-7_s5-palateful.md`.

- [ ] **Timed init**: from the devx checkout `npm run install:global`, then
      `touch /tmp/devx-s5-stamp && cd ~/palateful && time devx init`, open
      Claude Code and confirm `/devx` renders the dispatcher. Threshold:
      < 120s total. Record the timing in E-7.
- [ ] **Bug pick → merged fix**: pick one real palateful bug and run
      `/devx "<symptom>"` through merge. Threshold: 1 merged PR. Record the
      PR link in E-7.
- [ ] **Loop + audit**: `devx loop --max-items 1` (overnight-style), then
      the write audit from E-7 step 4. Thresholds: morning report exists;
      outside the repo only `~/.devx/` was written. Record both in E-7.
- [ ] While you're in there (design § Unresolved): note which `/devx`
      command wins when both repo-level and user-level copies exist —
      record the observation in E-7's Results.

## For multi-loop-concurrency — E-7 real night (filed by mlcret 2026-07-29)

- [ ] **MV-mlc.1 — Run the E-7 supervised multi-loop night (G-2's only evidence).**
  - Why: `multi-loop-concurrency` shipped all six stories and passed every
    CI-runnable expectation (E-1…E-6 GREEN, E-8 4/4), but **G-2 is
    unverified** — the P2 human checklist at
    `_devx/workstreams/multi-loop-concurrency/evals/E-7_live-overnight.md`
    was never run. `.devx-cache/loop/instances/` is empty and the newest
    loop report predates the epic. An epic about making N concurrent loops
    safe was itself built entirely by concurrent *interactive* sessions.
    This is the outcome-scoring input for G-2 (due 2026-08-31).
  - **Blocked until `dev-b931a1` lands (or you rebuild by hand).** The
    globally-installed `devx` resolves to the main worktree's gitignored
    `dist/`, last built 2026-07-28 17:04 — before mlc106 merged. Today
    `devx loop --help | grep -c epic` returns `0`, so step 2 of the E-7
    checklist would fail with commander's `unknown option`. Minimum
    unblock: `npm run build` in the main checkout (or `npm run
    install:global`), then confirm `devx loop --help` lists `--epic`.
  - How: follow `evals/E-7_live-overnight.md` verbatim — it is the
    Verified-by target and already carries the thresholds. In short:
    confirm zero pending drift, start ≥2 loops with **different** scopes
    (e.g. `devx loop --epic <a> --until 07:00` and `devx loop --epic <b>
    --until 07:00`), check `devx next` row 1 lists both instances with
    their scopes, keep the lid open per MV2.2, then run the morning review
    reconstructing from disk.
  - Thresholds: ≥1 merged PR per loop; 0 mechanical repairs needed in the
    morning (no orphaned `locks/spec-*.lock`, no DEV.md drift rows, no
    `[/]` rows without a live owner); no item in both reports' attempted
    lists.
  - Then: file the evidence into the workstream and score with
    `devx outcome score 20eb6f` when it comes due.
  - Spec: `dev/dev-mlcret-2026-07-28T09:04-retro-multi-loop-concurrency.md`
    (retro E7); eval: `evals/E-7_live-overnight.md`.

## For retro-listener — day-one ownership of the last hop (filed by rtl105)

- [ ] **MV-rtl105.1 — Start `devx learn-watch` in a spare terminal.**
  - Why: the listener half is now automatic — this repo's committed
    `.claude/settings.json` (rtl101) and every repo `/devx-init` touches
    (rtl105) register `devx learn-helper listen` on Stop + SessionEnd, so
    nudged sessions enqueue themselves. **The watcher that drains that queue
    is opt-in and nobody starts it for you.** With no watcher running the
    queue grows silently and no retro ever spawns — detection without a
    drain is a no-op with extra steps.
  - How: in a terminal you keep open (one watcher serves every repo — the
    queue lives under `~/.claude/devx/`), run `devx learn-watch`. It is a
    foreground drain loop; Ctrl-C is safe at any moment (the queue is
    durable, restart anytime). `devx learn-watch list` shows what is pending
    plus the last few processed sessions and their outcomes. Requires
    `rtl104` merged + a rebuilt/global `devx` (`npm run install:global`).
  - Follow-up option (deferred, no owner): surface the pending count in
    `devx status` / `devx next` so a stopped watcher is visible from the
    normal loop instead of only from `learn-watch list`. If you want that,
    file it as a dev spec — it is not in the retro-listener workstream's
    scope.
  - Spec: `dev/dev-rtl105-2026-07-30T09:31-init-hook-distribution.md` (T5.4);
    workstream: `_devx/workstreams/retro-listener/`.

## For tur101 — the orphan `devx-tours` branch (filed by tur101)

- [ ] **MV-tur101.1 — Decide what happens to the `devx-tours` branch.**
  - Why: the review tour retired at tur101, but every tour ever published
    still lives on the orphan `devx-tours` branch (PRs #65 onward — roughly
    1.4–1.7MB per tour). Nothing reads it anymore. Deleting a remote branch
    is destructive and outward-facing, so no agent will do it for you.
  - How: leave it as an archive (the default — it costs nothing but clone
    size), or delete it with
    `git push origin --delete devx-tours && git branch -D devx-tours`.
    Old PR bodies keep their now-dead tour links either way; that's cosmetic
    on merged PRs.
  - Spec: `dev/dev-tur101-2026-08-04T10:00-retire-review-tour.md`;
    decision record: `v2/07-decisions.md` D-4.

## For story-graph — downstream GRAPH.md rollout (filed by sgr107, due with G-2: 2026-08-23)

Each row ends in a committed GRAPH.md in the named repo — that is G-2's
scoring condition (all three repos committed + rendering by 2026-08-23; the
devx repo's own GRAPH.md landed with sgr103/sgr106). E-7 proved the packaged
CLI serves a downstream-shaped repo with zero devx-repo state reads
(`_devx/workstreams/story-graph/evals/E-7_downstream-portability.ts`).

- [ ] **MV-sgr107.1 — Refresh the global `devx` install.**
  - Why: friend-finder-mesh + palateful run the globally-installed CLI; the
    graph surface (sgr101–sgr106) postdates your last `npm i -g`.
  - How: from the devx checkout, `npm run install:global`, then confirm
    `devx graph --help` renders.
  - Blocks: MV-sgr107.2 + MV-sgr107.3.

- [ ] **MV-sgr107.2 — friend-finder-mesh: `/devx-init` refresh, then attended backfill PR ending in a committed GRAPH.md.**
  - Why: skill bodies in downstream repos are frozen at their last
    `/devx-init` (rtl105 mechanism); the backfill run is attended-only by
    design (D-9 — the CLI never guesses, the pass-2 underivable report is
    yours to resolve). Backfill writes edges, not GRAPH.md — the render
    step is explicit.
  - How: in ffm, re-run `/devx-init` to refresh skill bodies; then on a
    branch: `devx graph backfill` (review the pass-1 diff edge-by-edge,
    resolve or explicitly defer the pass-2 report), `devx graph`, commit
    GRAPH.md in that same PR, merge.
  - Blocks: G-2 scoring (due 2026-08-23).

- [ ] **MV-sgr107.3 — palateful: same as MV-sgr107.2.**
  - How: identical sequence in the palateful repo: `/devx-init` refresh →
    branch → `devx graph backfill` (attended review) → `devx graph` →
    commit GRAPH.md in the same PR → merge.
  - Blocks: G-2 scoring (due 2026-08-23).
