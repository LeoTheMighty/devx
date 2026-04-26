# Configuration

Every behavior in devx is configurable. This is the canonical list of what's tunable, where it lives, and what each knob does. `/devx-init` walks the user through the choices a sensible default can't be inferred for; this file is what `/devx-init` is asking about, and the reference for editing later.

## Where settings live

Two files, layered:

- **`devx.config.yaml`** at repo root — project-level settings, **committed to git** so the team shares them.
- **`~/.devx/config.yaml`** in the user's home — per-user settings (notification preferences, personal token caps) that don't belong in the repo.

Project overrides user. CLI flags override both. `devx config <key>` reads the merged result; `devx config <key> <value>` writes to the project file by default (`--user` flag writes to user file).

---

## 1. Risk & process

| Key | Type | Default | Notes |
|---|---|---|---|
| `mode` | enum | detected | `YOLO` / `BETA` / `PROD` / `LOCKDOWN`. See [`MODES.md`](./MODES.md). |
| `project.shape` | enum | detected | `empty-dream` / `bootstrapped-rewriting` / `mature-refactor-and-add` / `mature-yolo-rewrites` / `production-careful`. See DESIGN.md §Project shapes. |
| `thoroughness` | enum | `balanced` | `send-it` / `balanced` / `thorough`. See DESIGN.md §Thoroughness levels. |

These three are **the** strategic axes. Everything else trims around them.

---

## 2. Capacity & cost

| Key | Type | Default | Notes |
|---|---|---|---|
| `capacity.max_concurrent` | int | `3` | Simultaneous worker subprocesses. `1` = serial mode. |
| `capacity.usage_cap_pct` | int | `95` | Stop spawning new work above this Anthropic-org usage %. In-flight work continues. |
| `capacity.usage_hard_stop_pct` | int | `100` | At this %, kill in-flight work too. |
| `capacity.daily_spend_cap_usd` | float | `25` | Soft cap. Manager files `MANUAL.md` alert when crossed. |
| `capacity.daily_spend_hard_cap_usd` | float | `100` | Hard cap. Manager refuses to spawn anything until next day or user override. |
| `capacity.token_budget_per_spec` | int | `500_000` | Above this, worker pauses and asks via INTERVIEW. |
| `capacity.model_strategy` | enum | `balanced` | `cost-optimized` / `balanced` / `quality-first`. |

### Per-role model overrides

```yaml
capacity.models:
  manager:   claude-haiku-4-5      # thin loop, no need for big model
  concierge: claude-haiku-4-5      # router/notifier, not reasoner
  plan:      claude-opus-4-7       # research + synthesis
  dev:       claude-sonnet-4-6     # implementation
  test:      claude-sonnet-4-6     # implementation
  debug:     claude-sonnet-4-6     # diagnosis + fix
  focus:     claude-opus-4-7       # persona reasoning
  learn:     claude-opus-4-7       # cross-cutting pattern detection
```

`balanced` strategy = above defaults. `cost-optimized` = downshift dev/test/debug to Haiku. `quality-first` = Opus for everything except manager/concierge.

---

## 3. Permissions

What agents can run without asking. Mirrors Claude Code's permission system but lifted to project level.

```yaml
permissions:
  bash:
    allow:
      - git
      - gh
      - npm
      - bun
      - pnpm
      - yarn
      - pip
      - pytest
      - cargo
      - go
      - dart
      - flutter
      - playwright
      - eslint
      - prettier
    ask:
      - terraform
      - kubectl
      - docker
      - aws
      - gcloud
      - az
      - ssh
      - rsync
    deny:
      - "rm -rf /"
      - "curl https://*"      # exfiltration vector
      - "sudo *"
  network:
    allow_hosts:
      - github.com
      - api.anthropic.com
      - registry.npmjs.org
      - pypi.org
  file_writes:
    allow: ["**/*"]
    deny:
      - ".env"
      - ".env.*"
      - "secrets/**"
      - "id_rsa*"
      - "**/.aws/credentials"
      - "**/.ssh/**"
```

`/devx-init` interview questions:
- "Should agents run `terraform`?" → moves to `allow` if yes.
- "Should agents deploy to your cloud (`aws`/`gcloud`/`kubectl`)?" → moves to `allow` if yes.
- "Should agents install global packages?" → adds `npm install -g`, `pip install --user` to allow if yes.

`.env` and `id_rsa*` are **always** denied; users can't allow them via config. Hardcoded for safety.

---

## 4. Git strategy

```yaml
git:
  default_branch: main
  integration_branch: develop          # null = single-branch (no develop split)
  branch_prefix: develop/              # feature branches: develop/dev-a3f2b9
                                       # (use feat/ when integration_branch: null)
  pr_strategy: pr-to-develop           # direct-to-main | pr-to-main | pr-to-develop
  merge_method: squash                 # squash | merge | rebase
  protect_main: true                   # false to skip GitHub branch protection
  require_linear_history: true
  allow_force_push_main: false
  allow_force_push_develop: true       # agents may force-push their own feature branches
  delete_branch_on_merge: true
```

The develop/main split + branch protection on main are **recommended but not
required**. `/devx-init` asks once and recommends the split for non-YOLO
projects; users can decline either or both. Single-branch projects set
`integration_branch: null` and `protect_main: false`; the system collapses
the promotion gate into the merge gate. See `DESIGN.md` §"Branching model"
for the full single-branch shape.

`/devx-init` interview:
- **"Want a separate `develop` branch from `main`, with branch protection on
  `main`?"** — recommended yes for non-YOLO; recommended no for solo-YOLO.
  Single question covers both knobs (`integration_branch` and `protect_main`)
  because they're meaningless apart.
- **"PR or push direct?"** — `direct-to-main` only available in YOLO with
  single-branch (and warned).
- **"Squash, merge, or rebase?"** — squash default.
- **"Should agents be allowed to force-push their own feature branches?"** — yes default; some teams say no.

---

## 5. Promotion & autonomy

```yaml
promotion:
  gate: balanced                     # fast-ship-always | fast-ship | balanced | careful | manual-only
  soak_hours: 24                     # only used by `careful`
  required_checks:
    - ci
    - coverage
    - qa-layer-2
  block_on_new_debug_items: true     # PROD: no promotion if DEBUG.md grew in last 12h
  autonomy:
    initial_n: 3                     # promotions before auto-promote unlocks
    rollback_penalty: 0.5            # halve N on revert
    hotfix_zeroes: true              # main hotfix → reset N to 0
    veto_window_hours: 24
  agent: PromotionAgent              # null to require user every time
```

See DESIGN.md §Trust-gradient autonomy ladder. Mode sets the default `gate`:

| Mode | Default gate |
|---|---|
| YOLO | `fast-ship-always` |
| BETA | `fast-ship` |
| PROD | `careful` |
| LOCKDOWN | `manual-only` |

---

## 6. Coverage

```yaml
coverage:
  enabled: true
  target: touched-lines              # touched-lines | full-project | none
  threshold: 1.00                    # 100% on touched lines
  opt_out_marker: "devx:no-coverage"
  flaky_window_hours: 24
  flaky_action: file-test-md-entry   # file-test-md-entry | quarantine | none
  language_runners:                  # auto-detected; override to force
    python: pytest --cov
    typescript: vitest --coverage
    rust: cargo llvm-cov
    go: go test -cover
```

---

## 7. CI

```yaml
ci:
  provider: github-actions           # github-actions | gitlab | circleci | none
  workflow_path: .github/workflows/devx-ci.yml
  required_checks:
    - lint
    - test
    - coverage
  retry_on_flake: true
  max_retries: 2
  poll_interval_s: 30                # how often Manager polls CI status
  poll_timeout_min: 45               # give up after this and mark spec blocked
```

---

## 8. QA (browser & focus group)

```yaml
qa:
  browser_harness: playwright        # playwright | cypress | none
  layer_2_cadence: nightly           # nightly | per-pr | on-demand | off
  layer_2_personas: 4                # personas to run per session
  scripted_test_runner: playwright

focus_group:
  panel_size: 5                      # personas in the persistent panel
  consult_at:                        # when FocusAgent runs
    - plan
    - pre-promotion
  auto_evolve: true                  # FocusAgent updates persona reaction libs
  binding: false                     # PROD: set true to block promotion on panel red
```

---

## 9. Self-healing (LearnAgent)

```yaml
self_healing:
  enabled: true
  retro_concordance_threshold: 3     # # of concordant retros before lesson
  auto_apply:
    confidence_min: 0.85
    blast_radius_max: low            # low | medium | high
  canary_runs: 3                     # for skill/prompt changes
  user_review_required_for:
    - skills
    - prompts
    - agents
  user_review_optional_for:
    - memory
    - claude-md
    - config
  over_tuning_detector: true
  weekly_window_days: 7
```

See [`SELF_HEALING.md`](./SELF_HEALING.md).

---

## 10. Notifications

```yaml
notifications:
  channels:
    - kind: fcm
      topic: devx-${user_id}
    - kind: webhook
      url: https://hooks.slack.com/...
      template: slack
    - kind: email
      to: leonid@example.com
      digest_only: true              # only digest, no per-event
  events:
    context_rot_detected: silent     # log only, no push
    manual_filed: push
    interview_filed: push
    ci_failed: push
    pr_opened: silent
    pr_merged: digest
    promotion_ready: push
    heartbeat_stale: push
    usage_cap_hit: push
    daily_spend_cap_hit: push
    agent_crashed_repeatedly: push
  quiet_hours: "22:00-08:00"          # local time; only `push` muted, MANUAL still files
  quiet_hours_override:               # always push regardless of quiet hours
    - usage_cap_hit
    - daily_spend_cap_hit
  digest_schedule: "daily-09:00"      # rolls up `digest`-tagged events
```

`silent` = log to events stream only. `push` = immediate FCM/webhook/email. `digest` = batched into the digest send.

---

## 11. UI

```yaml
ui:
  tui:
    enabled: true
    layout: three-pane                # three-pane | stack | minimal
    theme: dark                       # dark | light | auto
    sidebar_density: comfortable      # comfortable | compact
    keybinds: vim                     # vim | emacs | default
    refresh_ms: 500
    show_token_usage: true
    show_phase_timing: true
    sidebar_groups:
      - workers
      - system                        # manager + concierge
      - inboxes
  web:
    enabled: true
    port: 7321
    bind: 127.0.0.1
    theme: dark
    show_diff: true
    show_pr_preview: true
    enable_drag_reorder: true
  mobile:
    enabled: true
    activity_feed_depth: 50
    show_phase_changes: true
    show_token_usage: true
    swipe_to_kill: true
```

---

## 12. Manager & Concierge

```yaml
manager:
  heartbeat_interval_s: 60
  restart_on_token_pct: 0.85          # rot detector: restart at 85% context
  max_worker_age_min: 90              # force restart even without rot signal
  worker_crash_backoff_s: [10, 30, 90, 300]   # exponential
  max_restarts_per_spec: 5            # then mark blocked, file MANUAL
  cloud_watchdog: true
  cloud_watchdog_cadence: "*/30 * * * *"
  cloud_spillover:
    enabled: false                    # v2: kick work to cloud on idle laptop
    target: github-actions            # github-actions | cloudflare-containers | fly
  os_supervisor: auto                 # auto | launchd | systemd | task-scheduler | none
  log_dir: ~/Library/Logs/devx        # auto on Linux: $XDG_STATE_HOME/devx

concierge:
  always_on: true
  context_window_target: 0.40         # restart if it ever goes above
  digest_interval_min: 60
  status_endpoint:
    bind: 127.0.0.1
    port: 7322                        # cloud-watchdog polls this
  intent_routing:
    feature_request: DEV.md
    bug_report: DEBUG.md
    question: INTERVIEW.md
    feedback: FOCUS.md
```

---

## 13. Storage

```yaml
storage:
  worktree_root: .worktrees
  cache_dir: .devx-cache
  log_retention_days: 14
  spec_archive_after_days: 90         # move done/ specs to archive/
  archive_path: archive/
  gitignore_managed: true             # devx maintains .gitignore entries for itself
```

---

## 14. Observability

```yaml
observability:
  log_level: info                     # debug | info | warn | error
  redact:
    - api_keys
    - emails
    - tokens
    - aws_access_keys
  telemetry:
    enabled: false
    endpoint: null
    anonymized: true
```

---

## 15. BMAD integration

```yaml
bmad:
  modules: [core, bmm, tea]           # which BMAD modules to install
  output_root: _bmad-output
  preserve_on_eject: true             # devx eject leaves these files intact
  workflows_path: _bmad/              # never written by devx
```

---

## What `/devx-init` actually asks

Out of all the above, the interview only asks where a sensible default can't be inferred. The rest are written with defaults and surfaced in `devx.config.yaml` as commented blocks the user can uncomment to override.

| # | Question | Sets |
|---|---|---|
| 1 | What are you building? | seeds `PLAN.md` |
| 2 | Who for? | personas, persona panel |
| 3 | Real users? | `mode` |
| 4 | Project shape? | `project.shape` |
| 5 | Solo or team? | persona priorities, second-dev scaffolding |
| 6 | Stack? | detected; ask if empty repo |
| 7 | Infra prefs (CI, browser harness)? | `ci.provider`, `qa.browser_harness` |
| 8 | First slice? | seeds `DEV.md` |
| 9 | **Daily cost cap?** | `capacity.daily_spend_cap_usd` |
| 10 | **Permissions: terraform / cloud CLIs / docker / global installs?** | `permissions.bash.*` |
| 11 | **Git strategy: develop branch + main protection? PR vs direct? squash vs merge?** | `git.*` (recommends split for non-YOLO; both knobs are optional) |
| 12 | **Promotion: auto after N green, or always ask?** | `promotion.autonomy.*` |
| 13 | **Notifications: which channels + which events?** | `notifications.*` |

Everything else is defaulted by mode + shape + thoroughness. The user edits `devx.config.yaml` directly later, or runs `devx config set <key> <value>` for one-offs.

---

## Schema validation

`devx.config.yaml` is validated on load. Unknown keys produce a warning (not an error — devx upgrades may add keys); missing required keys (`mode`, `project.shape`) abort with a pointer to `/devx-init`. The full JSON schema lives at `_bmad/devx/config-schema.json` and is what `devx config <key>` autocompletes against.
