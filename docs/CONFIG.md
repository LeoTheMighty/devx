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

## 15. Engine (v2 — replaces the BMAD integration section)

```yaml
engine:
  workstreams_root: _devx/workstreams   # where per-workstream artifacts live
  docs_layout: workstream               # workstream | project-level — the tree's SHAPE
  archive_root: _devx/archive           # closed/retired workstreams move here
  code_citation_hints: []               # paths the design stage grounds discussion in
  expectations_min: 3                   # Gate 1 floor: ≥N E-blocks in expectations.md
  prose_budget_kb: 60                   # S-1 canary threshold over shipped skill/template prose
  reading_guide_roles: [pm, architect, dev, qa]   # Reading Guide columns on a design human render
  critique:                             # re-homed party-mode (plan-stage critique)
    lenses: [pm, architect, dev, qa]
    min_surfaces: 2                     # thoroughness-gated, as party-mode was
```

Full engine contract: `v2/02-engine.md` §7. A leftover `bmad:` key from a
pre-v2 config loads with a deprecation warning, not an error (migration shim
in config-io); the section itself was retired at v2x101.

### `docs_layout` — the two shapes

`workstream` (default) is the folder-per-artifact tree: one slug per unit of
work, many in flight at once, rooted at `engine.workstreams_root`.

`project-level` is the flat shape for a repo where only one thing is ever
being designed at a time — the docs sit at the repo root and there is no slug.

| Artifact | `workstream` | `project-level` |
| --- | --- | --- |
| PRD (Gate 1 subject) | `<root>/<slug>/prd/agent.md` | `prd.md` |
| PRD human digest | `<root>/<slug>/prd/human.md` | `prd-human.md` |
| PRD outline (human-only) | `<root>/<slug>/prd/outline.md` | `prd-outline.md` |
| PRD outline critique | `<root>/<slug>/prd/outline-critique.md` | `prd-outline-critique.md` |
| Design (Gate 2 subject) | `<root>/<slug>/design/agent.md` | `design.md` |
| Design outline / critique | `<root>/<slug>/design/…` | `design-outline.md` / `design-outline-critique.md` |
| Plan (Gate 3 subject) | `<root>/<slug>/plan/agent.md` | `plan.md` |
| Plan outline / critique | `<root>/<slug>/plan/…` | `plan-outline.md` / `plan-outline-critique.md` |
| Expectations | `<root>/<slug>/expectations.md` | `expectations.md` |
| RED artifacts | `<root>/<slug>/evals/` | `evals/` |
| Working memory | `<root>/<slug>/todo.md` | `todo.md` |
| Decision records | `<root>/<slug>/decisions/` | `decisions/` |

Five rules make the choice safe rather than merely cosmetic:

1. **You are asked once, and the answer is written down.** `devx init` asks it
   (N14) and writes the key explicitly rather than leaning on the default —
   except on a repo that already has commits, where `workstream` is inferred
   silently with the reason in the transcript (an existing codebase almost
   never wants the one-doc-set shape, and `workstream` never needs a migration
   later). A repo predating the question gets an advisory warning from
   `devx next`, and the writing skills ask before their first artifact write —
   the canonical ask is the `layout-ask-canonical` block in
   `.claude/commands/devx-personalize.md`.
2. **This is config, not a preference.** It was a preference-bank key
   (`docs.layout`) until 2026-09-01, and that was a mistake: the layout names
   where files the whole repo shares get written, so two contributors
   resolving it differently would split the artifact tree in half. Same
   reasoning that always kept `workstreams_root` out of the bank. The old key
   is still read as a fallback (`docsLayoutFrom()`) so no repo silently flips
   layout on upgrade, and still validates so an existing config loads — but
   `engine.docs_layout` wins when both are present, and the old one should be
   deleted. See `docs/PERSONALIZATION.md` §3.
3. **Outlines stay human-only in both layouts.** `project-level` renames the
   outline files, and a rename that moved them out from under
   `isProtectedOutlinePath()` would silently drop the guarantee three
   enforcement layers exist to make. The classifier therefore recognizes the
   `<stage>-outline.md` root names too, and `<stage>-outline-critique.md`
   stays agent-writable, as its folder-shaped counterpart already is.
   `devx outline init` resolves this key to decide where a scaffold lands.
4. **`project-level` holds exactly one in-flight doc set.** Wanting a second
   concurrent unit of work *is* the signal to switch layouts, rather than
   scattering a second PRD across the root. **Not mechanically enforced
   today**: the refusal used to live in `/devx-personalize` (which no longer
   owns the key), and neither `devx workstream new` nor config validation
   carries it yet — tracked as `dev-lay101`.
5. **Gate subjects are unchanged.** A gate resolves its subject through the
   layout, so the same `devx gate prd` runs against `prd/agent.md` or
   `prd.md` and returns the same verdict for the same content. Layout is not
   a gate input.

**`docs_layout` and `workstreams_root` compose.** The former chooses the
*shape* of the tree; the latter names *where* a workstream tree is rooted. A
repo that wants `devx/active/<slug>` sets `engine.workstreams_root:
devx/active` and leaves `engine.docs_layout: workstream`.

**`reading_guide_roles`** names the columns of the **Reading Guide** — the
mandatory annotated table of contents that opens every design human render
(ported from `mycase/8am-harness` §31). A reviewer arrives with two questions
before any technical one: what is the shape of this document, and which parts
am I responsible for. The guide answers both on the first screen: one row per
section carrying the question that section answers, and one column per role
marked ● (read before signing off) · ○ (useful context) · blank (skip). A role
scans its own column and has its reading list.

It defaults to the **plan-stage critique lenses** rather than a parallel role
vocabulary — the same `[pm, architect, dev, qa]` the `engine.critique` block
already uses, so a repo has one set of reviewer names, not two.

Two properties keep it a routing map rather than decoration:

- **Columns are the scarce resource.** Add a role only when it would carry at
  least one ● outside Overview; a column of blanks teaches a reader to ignore
  the table.
- **Derivation-only.** The key shapes the columns; it never gates the guide's
  *presence*. No personalization key can suppress it either — a routing map
  only works if reviewers can rely on it being there.

Structural sync (every row names a real section; every `###` design mechanism
has a row) is mechanical, and lives in `checkReadingGuide()`
(`src/lib/engine/reading-guide.ts`): the Design stage self-reviews against it
before its gate, per `/devx-plan` step 3b. The audience marks themselves are
judgment and stay advisory. Renders predating the guide are grandfathered —
nudged, never failed.

**Not yet wired into the gate CLI.** `devx gate coverage` does not call the
checker today; the Design stage does. Promoting it to a blocking gate signal
is a deliberate follow-up, because it changes a verdict every existing
workstream would be re-scored against.

---

## 15b. Overnight loop budgets

```yaml
loop:
  max_iterations_per_item: 8            # per-item retry ceiling
  max_tokens_per_item: 2000000
  max_consecutive_failures: 3           # trip breaker for the whole loop
  max_items: 10                         # per-night item cap
  max_total_tokens: 10000000
  backoff_ms: [60000, 120000, 240000]   # consecutive-failure backoff ladder
  preflight_main_health: refuse         # lpf101: refuse | warn | off
```

Consumed by `devx loop` (v2l101); see `v2/04-overnight-loop.md` §3.

`preflight_main_health` (lpf101): at loop entry the driver probes the
integration branch's remote CI (`gh run list`, newest run per workflow).
`refuse` (default) declines to start while that branch is red — a red main
converts the whole night into unmergeable open PRs, since every feature
branch inherits the red check and the merge tail correctly hands every item
off. `warn` starts anyway and threads a "treat as baseline" line into every
iteration prompt and the morning report (same effect as `devx loop --force`
for one run). `off` skips the probe. Probe failures and inconclusive signals
never block the run — only a decisive red does.

Token budgets count **new tokens processed** — uncached input + output +
cache-creation, from the worker session's authoritative stream-json usage
(debug-494590). Cache reads are recorded and rendered in the morning report
but excluded from the budget counter (they re-bill the same context every
turn). Sessions that emit no usage events fall back to a chars/4 estimate,
flagged with `~` in the report.

---

## 15c. Retro listener

```yaml
learn:
  idle_minutes: 15               # transcript quiet window = "session over"
  retro_timeout_minutes: 360     # spawned retro past this retires as `timeout`
  home: ~/.claude/devx           # queue home (user-global, one per human)
  auto_allow: false              # unreviewed repos serve instead of prompting
  auto_apply: false              # an unattended retro applies, not just prints
```

Consumed by `devx learn-watch` (rtl102) and the `/devx-init` hook install
step; see `_devx/workstreams/retro-listener/design/agent.md` §Interfaces.

`idle_minutes` is how long the session transcript must go unmodified before
the watcher treats the session as over and spawns its retro; `retro_timeout_minutes`
bounds a spawned retro that never writes its done marker (the SIGKILL case the
wrapper's signal trap can't cover) — past it the entry retires with outcome
`timeout`. Non-positive / non-finite / wrong-typed values fall back to the
default **per key**: a half-typed edit degrades the watcher, it doesn't wedge
it.

**`auto_allow` (28b267) is what makes the watcher servable unattended.** The
watcher asks once per repo — `allow retros for <repo>? [y/N]` — and records the
answer in `<home>/repos.json`. With nobody at a terminal that prompt can never
be answered: `repoDecision` returns `unknown`, the run drops to
non-interactive, and every remaining unreviewed entry is walked past on every
pass, forever. (Observed 2026-08-05: two sessions pending since 2026-08-02
behind exactly that gate.) Setting `auto_allow: true` — or passing
`devx learn-watch --auto-allow`, which forces it on for one run — reads an
unreviewed repo as allowed, so `nohup devx learn-watch &` actually drains.

Two properties make it a *policy* rather than a blanket decision, and both are
asserted in the suite:

- **a recorded `deny` still wins.** The lookup in `repos.json` short-circuits
  ahead of the policy, so a repo you deliberately refused stays refused.
- **it never writes `repos.json`.** That file remains the record of what a
  *human* reviewed, so turning the knob back off restores prompting instead of
  leaving every repo the watcher ever touched permanently allowed.

Non-boolean values (`"yes"`, `1`, `null`) fall back to `false` rather than
being read as truthy — YAML already produces real booleans for `true`/`yes`/
`on`, so a value that arrives as a string or a number is a typo, and "allow
every unreviewed repo" is the wrong direction to guess. Note also that a
running watcher's skip-set is per-*run*: flipping the knob does not rescue
entries an already-running watcher walked past, so restart it.

**`auto_apply` (c808b1) is what makes a spawned retro worth spawning.**
`auto_allow` gets the watcher past the `[y/N]` gate; `auto_apply` decides what
the retro it spawns is allowed to do when it gets there. Set it in config, or
pass `devx learn-watch --auto-apply` to force it on for one run — same
one-directional flag as `--auto-allow` (its absence defers to config; turning
the policy off for a run is a config edit). Mechanically it is the mode the
spawn hands the retro: `DEVX_LEARN_UNATTENDED=1` in the wrapper's environment
plus an `unattended` argument on the `/devx-learn` invocation, both of which
are absent — byte-for-byte — from an attended spawn. Off, an unattended
`/devx-learn` behaves like the attended one — it prints its evidence table and
waits for a prune that never comes, until `retro_timeout_minutes` kills the tab
and every mined lesson goes with it. On, outlet-1 rows whose change set the
predicate clears land on `fw/learn-YYYY-MM-DD-<slug>` and go through the normal
gates: local CI → PR → remote CI → the mode merge gate. No direct-to-`main`
path exists in either setting.

It is deliberately **not** implied by `auto_allow`. Letting the watcher open a
tab is a strictly smaller grant than letting what runs in that tab open PRs
against your repo, and the second one needs the consent of whoever reviews
them. Same fail-closed typo handling as `auto_allow`, for a stronger reason.

Turning it on never widens *what* may be applied — two carve-outs hold in every
mode:

- **wedge paths**, decided mechanically by
  `devx learn-helper route <path…>` → `apply` | `propose`. Anything under
  `.claude/**` or `skills/**`, any `settings.json` / `settings.local.json`, and
  anything outside the repo routes `propose`, because **skill and settings
  edits prompt for confirmation even under bypass-permissions** — an unattended
  tab hangs on that prompt until the retro timeout kills it. This one is a
  harness fact, not a policy, so no knob relaxes it.
- **locked machinery** — gate logic, refusal paths, cascade rules, verdict
  vocabulary, append-only disciplines. An automated pass that can loosen the
  gates it is judged by is a system with no floor. No path pattern recognizes
  these (the same file holds loosenable and unloosenable lines), so the run
  declares it: `devx learn-helper route --locked <path…>` returns `propose`
  with the locked-machinery reason even when every path is ordinary `src/`
  code, and stamps that reason on every per-path verdict so nothing downstream
  can find an `apply`. The flag reads fail-closed — anything but
  `false`/absent counts as locked.

Rows in either carve-out become a durable artifact rather than tab stdout
nobody reads: `devx learn-helper propose` (JSON payload on stdin) writes
`docs/updates/<date>-<slug>.md` plus a `dev/` spec and a `DEV.md` row under
`### Learn proposals`, so the proposal enters the normal backlog and `devx
next` can offer it. `--target personal` is outlet 4's arm: it writes
`<learn-home>/proposals/<date>-<slug>.md` instead — still never committed and
still never applied to any settings file, just recoverable. The three repo
writes land as one transaction (doc → spec → backlog, restore-on-partial), so
a backlog row never points at a spec that was not written.

**Every unattended run leaves a report**, including the one that mined nothing:
`devx learn-helper report` writes `<learn-home>/reports/<YYYY-MM-DDTHH-MM>-<slug>.md`
and appends one line to `<learn-home>/reports/index.md`. The report names each
row's bucket, the question that decided it, applied-vs-proposed with the
`route` predicate's reason, and the PR URL if one opened. The index is the
reason you never need a session id to find last night's retros — `ls` the
directory or grep the index. A run that stops at its budget bound writes a
partial report rather than nothing, so the watcher files a real outcome instead
of `timeout`.

**All of `learn:` is read from the watcher's launch cwd**, via the same
`loadMerged()` walk every other section uses — the watcher is user-global but
its config is not. Launching it from a different repo (or from `~`) picks up
that directory's `devx.config.yaml`, or the defaults if there isn't one. This
is a known wrinkle, not a bug to rediscover: put `auto_allow`, `idle_minutes`,
and `retro_timeout_minutes` in the config of whatever directory you actually
launch the watcher from, or pass `--auto-allow` / `--auto-apply` explicitly.

**Home precedence — `DEVX_LEARN_HOME` env > `learn.home` > `~/.claude/devx`.**
The env var wins everywhere and is what tests and hook installs use to redirect
the queue. A leading `~/` in `learn.home` expands against the current home
directory; an env value is honored verbatim (the shell has already expanded
it). The Stop/SessionEnd listener (`devx learn-helper listen`) **never loads
config at all** — it runs at every turn end in every hooked repo under a
<500ms p95 budget, so it resolves the env var and the built-in default only.
Which means a non-default `learn.home` reaches the listener the one way a
config value can reach a config-free process: the hook install step reads it
and materializes it as `DEVX_LEARN_HOME` in the registration it writes. Until
that step runs (or if you register the hook by hand), a custom `learn.home`
moves the watcher and leaves the listener on the default — so when you
relocate the queue, set the env var too.

---

## 16. Personalization (the repo layer of the preference bank)

```yaml
personalization:
  role: engineer                     # engineer | pm | both
  autonomy.action_mode: propose-only # propose-only | auto-safe
  review.above_threshold_shape: parallel
  output.verbosity: full             # terse | full
  safety.production_touch: never     # floor — an individual cannot loosen this
```

Full registry — every key, its default, its strictness direction, and which
skill owns it — is `docs/PERSONALIZATION.md`. **This section constrains shape
only; it never restates a default.** A second home for the same fact is a
drift bug waiting to happen, which is why the lint reads the registry rather
than this file.

Four things distinguish this block from every other section above:

- **It is one layer of five, not the setting itself.** Per key the order is
  workstream → individual-this-repo → individual-global → *this block* →
  registry default. The individual layers live in `~/.claude/devx/` and are
  never committed.
- **It is a floor, not a peer.** Where a value here is stricter than what an
  individual profile resolved, this one wins outright. An individual can
  tighten what the repo committed; never loosen it.
- **Nothing here is a gate input.** A value that would skip, weaken,
  auto-pass, or reorder a gate, refusal, or record is **void** at runtime —
  ignored, and reported verbatim. A gate stays reproducible from committed
  artifacts alone whatever a profile says.
- **Keys are dotted strings, not nested maps.** `notify.channel` is one key,
  not `notify: { channel: ... }` — the bank's key names are the registry's key
  names, so a grep for a key finds every place it is set.

**The artifact layout is NOT in this block.** It was (`docs.layout`) until
2026-09-01; it now lives at `engine.docs_layout` (§15), because it names where
files the whole repo shares get written rather than how one person likes to
work. The old key still validates and is still read as a fallback, so an
existing config keeps its layout — but it belongs in `engine:` now.

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
| 14 | **Docs layout: many things in parallel, or one at a time?** | `engine.docs_layout` (inferred as `workstream` on a repo with commits — see §15) |

Everything else is defaulted by mode + shape + thoroughness. The user edits `devx.config.yaml` directly later, or runs `devx config set <key> <value>` for one-offs.

---

## Schema validation

`devx.config.yaml` is validated on load. Unknown keys produce a warning (not an error — devx upgrades may add keys); missing required keys (`mode`, `project.shape`) abort with a pointer to `/devx-init`. The JSON schema (Phase 0 cfg201) ships embedded in the devx npm package and is resolved at runtime via `require.resolve` from the installed package; `devx config <key>` autocompletes against it. (All devx assets — schema, engine templates, skill bodies — ship in the devx package itself; there is no external framework directory hosting any of them.)
