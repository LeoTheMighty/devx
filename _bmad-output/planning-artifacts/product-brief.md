# Product Brief — devx

> BMAD product-mode walkthrough. Applies the discipline of `bmm-analyst` → `bmm-pm` → party-mode to devx itself. Output is the canonical product brief; sibling `prd.md` and `architecture.md` will follow once we commit to specific stories.

---

## 1. Analyst lens — domain research

### 1.1 Who is the user?

**Primary persona: the solo full-stack founder-engineer.**

- Ships real products (not toys) across frontend + backend + infra, usually alone.
- Already uses Claude Code or an equivalent AI coding tool daily.
- Has shipped enough to feel the next bottleneck: **it's not how fast the model writes code, it's how much orchestration the human still does between tasks.**
- Tolerates complexity iff it pays back quickly. Will abandon a tool that asks for 2 hours of setup for a 1-hour first payoff.
- Works in bursts. Not always at a desk. Has ideas in the shower and wants to queue them without opening a laptop.

**Secondary persona: the small team (2–5 devs) with no dedicated PM or QA.**

- Same pain, different scale. Multiple devs, but no one has cycles to run product discovery or test strategy between features.
- Wants the system to enforce hygiene (tests, CI, reviews) without becoming the thing they babysit.
- Will pick devx for a new project and keep using raw BMAD / raw Claude Code for legacy ones — devx has to co-exist, not colonize.

**Anti-persona: the enterprise team with a PM, an SRE, a QA lead, and a build team.**

- They already have the functions devx is trying to AI-ify. Doesn't need us.
- Not who we optimize for. Ignore their asks.

### 1.2 Job-to-be-done

> **"When I have an idea I want to build, I want to go from idea → shipped → iterated on real user feedback with the smallest possible number of manual context-switches, so that I can ship more ideas per unit of calendar time."**

Three sub-jobs nested under this:

1. **Go from idea to PR-ready.** Turn fuzzy requirements into planned, specced, implemented, tested, reviewed, merged code.
2. **Know what to build next.** Prioritize across new features, bugs, test gaps, user pain — without drowning in backlog grooming.
3. **Trust the process without watching it.** Sleep through a dev cycle and wake up with merged PRs and coherent status.

### 1.3 Competitive / adjacent landscape

| Tool | Strength | Gap devx exploits |
|---|---|---|
| **BMAD alone** | Rigorous planning + story workflow | Loop is open — user manually wires /dev-plan → /dev. No triage, no self-healing, no UX feedback loop. |
| **Cursor / Windsurf / Zed** | Best-in-class edit-in-IDE experience | Single-session. Can't run overnight. No product discipline. |
| **Devin / Factory / Cognition** | Fully autonomous agents | Expensive, opinionated the wrong way for solo devs (SaaS billing, cloud-only, can't see the code). Not filesystem-native. |
| **v0 / Lovable / Bolt** | Instant prototypes | Prototype trap: great start, falls over at month 2 when real product concerns kick in. No CI, no tests, no iteration loop. |
| **Raw Claude Code** | Maximum flexibility, lowest abstraction | Everything is DIY. Every project reinvents the wheel. |
| **Linear / Shortcut + AI plugins** | Excellent human-facing PM | AI plugins are retrofits — the core unit is "ticket," not "spec file," and ticketing tools have no opinion on code execution. |

**Positioning statement:**

> devx is for the solo or very-small-team developer who has outgrown "Claude writes my code" and is ready for "Claude runs my project." It's BMAD with the loop closed, a filesystem as the database, and a strong opinion that git + CI + markdown files are the only infra you need.

### 1.4 Insights from the domain

- **Filesystems are underrated as databases.** Git gives you audit trail, concurrency primitives (hashes, refs), and distributed sync for free. Most project-management tools reinvent all three poorly.
- **Asynchrony is the killer feature.** The user isn't always at the keyboard. A system that accumulates work while they sleep and presents a clean hand-off queue on wake is fundamentally more productive than one that requires a live session.
- **Self-healing > configurability.** Solo devs don't want to tune. They want the system to learn their preferences and apply them silently. The tuning knob is "watch what I correct; don't re-ask."
- **Trust is a gating feature.** The solo dev will not let an agent merge to main without human approval until the system has earned trust on non-critical merges. Design for a trust gradient, not a big red autopilot button.

---

## 2. PM lens — product brief

### 2.1 Problem statement

The solo full-stack developer using AI coding tools spends disproportionate time on **inter-task orchestration**: figuring out what to do next, connecting planning output to execution, writing and running tests, investigating user reports, re-answering the same setup questions each time. The model writes code quickly; the human is the bottleneck on everything around the code.

Existing tools solve slices: Claude Code edits, BMAD plans, Linear tickets, Playwright tests. None close the loop. The dev is the integration layer.

### 2.2 Product vision

devx is an opinionated execution harness that turns a graph of specialized agents into a closed loop over a filesystem-backed backlog. The developer provides direction (ideas, answers to questions, approvals); devx handles planning, implementation, testing, debugging, QA, and triage across parallel worktrees, coordinated entirely through markdown files in the project's own git repo.

The system learns from its own work — repeated questions, failures, and corrections turn into memory/skill/config updates that make the next run tighter. Every layer is inspectable (it's just files), auditable (it's just git), and escape-hatchable (it's still BMAD underneath).

### 2.3 Users and segments

| Segment | Fit | Value prop |
|---|---|---|
| Solo founder-engineer (primary) | ✅ perfect | Ship 3× more ideas per calendar week |
| Small team without PM/QA | ✅ strong | Enforced hygiene without the hire |
| Indie hackers doing multiple projects | ✅ strong | Same rails on every project; per-project knowledge base |
| Students learning to ship | ⚠ conditional | Only if they've already shipped once — not a teaching tool |
| Enterprise / corporate teams | ❌ | Wrong shape, wrong price sensitivity, wrong ownership model |

### 2.4 Success metrics

What we measure to know devx is working — not vanity metrics, product metrics.

| Metric | Target at 6 months |
|---|---|
| **Time from `/devx-init` to first merged agent PR** | < 2 hours |
| **% of planned features that reach `main` without human code editing** | > 60% |
| **Median INTERVIEW questions answered per feature** (lower is better — means self-healing is working) | < 3 after first 10 features |
| **% of user-raised bugs caught by exploratory QA before user saw them** | > 30% after 3 months of running |
| **User's weekly active days on the project** (higher = devx makes the project fun to maintain) | no decline over 90 days |
| **$ of Anthropic API spend attributable to exploratory QA per PR** | < $1.00 |

### 2.5 Scope — what's in, what's out

**In scope (v1):**

- 8 slash commands (`/devx-init`, `/devx-plan`, `/devx`, `/devx-test`, `/devx-debug`, `/devx-focus`, `/devx-learn`, `/devx-triage`).
- 8 backlog files + 6 spec-file directories.
- `develop`/`main` branching with promotion gate.
- Worktree-based parallelism (cap 3 concurrent agents default).
- Self-healing with confidence gates (SELF_HEALING.md).
- Flutter mobile companion app (iOS + Android + web, with domain-free Cloudflare Worker push).
- Two-layer QA (scripted Playwright + browser-use exploratory).
- GitHub as sole datastore / coordination layer.
- BMAD as the underlying workflow engine (non-invasive, user can drop back to raw BMAD anytime).

**Explicitly out of scope (v1), revisit later:**

- Hosted SaaS version. Everything runs on user's machine + their own GitHub.
- Multi-repo / monorepo-across-repos coordination.
- Team collaboration primitives (multi-user backlog assignment, presence, etc.).
- Custom LLM provider abstraction. Anthropic-first; plug-in other providers when a specific need emerges.
- Visual dashboard / web UI beyond the mobile app.
- Plugin system for third-party agents.
- Billing, auth, user accounts, anything that implies a server we operate.

### 2.6 Anti-scope — things it's tempting to build but we won't

- **A web dashboard** — every dashboard feature should either live in the mobile app or be solvable by `ls`/`grep`/`gh`/the iOS app. Web dashboards require hosting; we refuse to host anything.
- **"devx Cloud" SaaS** — if we ever offer a hosted option, it's a product decision years away. Assume never for v1.
- **Proprietary skill format** — skills are just `.claude/commands/*.md` files. No custom DSL.
- **Opinions about language/framework/deploy target** — devx cares how you work, not what you build. It detects your stack and adapts.

---

## 3. The full developer experience — walked through, moment by moment

This is the core of this exercise. Six "moments" tracing a real solo dev from zero to iterating on a shipped product. Each moment calls out what the dev sees, does, feels, and what the system does behind the scenes.

### Moment 1 — Day 0: Discovering devx

**Dev's context:** Solo dev, just hit Saturday morning, has an idea to build a thing (let's say a "local-first reading tracker"). Already uses Claude Code daily. Reads a tweet thread about devx.

**What they see:**
- Single README.md. Scans it in 90 seconds.
- Three phrases hit: "the only tool you need", "closed loop", "no cloud infra".
- One install command: `./install.sh --global`.

**What they do:**
- Clone the devx repo, run the install. Takes < 30 seconds.
- Run `claude` in their empty `reading-tracker/` project dir.
- Type `/devx-init`.

**What they feel:**
- "Okay, I'm already invested. What happens next?"

**Design implications:**
- README has to pass the 90-second test. The current README does. Opening hook must promise a single payoff in one sentence.
- Install must be literally one command. No brew formula, no npm package search, no dependency flag gymnastics.
- `/devx-init` must greet them by taking the conversation, not giving them a menu.

### Moment 2 — The first 5 minutes: `/devx-init`

**Dev's context:** Empty repo. Has an idea. Has never talked to a BMAD-flavored anything.

**What they see:** A conversation, not a form.

> **devx:** Hey. I'm going to get this project set up in about 5 minutes. No menus, five quick questions. Answer however — one word or a paragraph is fine.
>
> **1 of 5 — What are you building?**
>
> **Dev:** A local-first reading tracker. Track books I'm reading, pages per day, highlights. Phone + web.
>
> **devx:** Got it — local-first reading tracker, cross-platform.
>
> **2 of 5 — Is this solo, or will you have help?**
>
> **Dev:** Solo for now, maybe a co-founder later.
>
> **devx:** Solo-first, co-founder-ready. Got it.
>
> **3 of 5 — Stack preference? (You can say "you pick" — I'll choose something that fits question 1.)**
>
> **Dev:** You pick. I like Flutter and Python.
>
> **devx:** I'll go with Flutter (app) + FastAPI (API, when you need one) + SQLite-locally-sync-to-Postgres-later. Sound right?
>
> **Dev:** Yeah.
>
> **4 of 5 — CI and deploy preferences? (If you don't care: GitHub Actions + Cloudflare Pages for the web build.)**
>
> **Dev:** Sure.
>
> **5 of 5 — What's the first slice? (One sentence. I'll seed it as your first DEV.md item. We'll refine.)**
>
> **Dev:** Let me add a book by scanning its barcode and see it in a list.
>
> **devx:** Locked. Setting up now…
>
> *(30 seconds of visible progress: BMAD installed ✓, backlog files scaffolded ✓, CI wired ✓, develop branch created ✓, first spec file drafted ✓, INTERVIEW.md seeded with 3 questions for later ✓, mobile companion linked ✓.)*
>
> **devx:** Done. Here's what's next:
>
> 1. I've put 3 questions for you in `INTERVIEW.md`. Nothing's blocked — they can wait.
> 2. Your first feature is in `DEV.md` — I can start on it now with `/devx`, or you can let `/devx-triage` pick it up.
> 3. If you want the mobile app, run this one command. If not, skip — everything works without it.
>
> Type `/devx-triage` or `/devx` to begin, or just tell me what you want.

**Why this works:**
- 5 questions, conversational, no menus.
- Every question has a "you pick" / "defaults" escape.
- Setup happens *while* they're still engaged — no "cd into this, run that, now edit this yaml."
- Ends with a choice of what to do next, not a wall of "here are all 8 commands."

**What's happening under the hood:**
- `/devx-init` runs BMAD's `install-module` if missing (skipped because we pre-installed).
- Scaffolds all 8 backlog files at project root.
- Creates `develop` branch off `main`, makes it default, enables branch protection on `main`.
- Writes `.github/workflows/devx-ci.yml`, `devx-promotion.yml`, `devx-deploy.yml`.
- Seeds CLAUDE.md with project-detected invariants.
- Drafts `dev/dev-<hash>-barcode-scan-and-list.md` from question #5.
- Seeds INTERVIEW.md with the 3 most valuable clarifying questions the PM persona would ask ("what book catalog API do you want to use?", "offline-first mode?", "accounts or single-user?") — never silently decided.
- Creates `devx.config.yaml` with detected/chosen defaults.

**Anti-patterns avoided:**
- No "please configure `_bmad/_cfg/...`." User never sees a config file path.
- No "choose your agents." They get all eight; triage decides what runs.
- No empty backlog files with instructions. The first `DEV.md` entry is theirs.

### Moment 3 — Day 1: The first closed-loop feature

**Dev's context:** Saturday afternoon. They ran `/devx-init` in the morning, answered one of the 3 INTERVIEW questions ("use Open Library API"), and said `/devx-triage`.

**What they see:** Terminal's quiet. Their editor shows files changing in `.worktrees/dev-<hash>/`. Periodically the main Claude Code session prints one-line status updates:

```
[14:02] PlanAgent refining dev-a3f2b9 → party-mode with UX + backend + infra lenses
[14:05] PlanAgent → new sub-items split: dev-e1c7d1 (scan UI), dev-f2b9d0 (lookup), dev-c4a7e2 (list screen)
[14:05] INTERVIEW q#4 added: "barcode types to support — ISBN-13 only or all EAN/UPC?"
[14:06] DevAgent-1 picked up dev-e1c7d1 (scan UI) — worktree .worktrees/dev-e1c7d1
[14:06] DevAgent-2 picked up dev-c4a7e2 (list screen) — worktree .worktrees/dev-c4a7e2
[14:06] dev-f2b9d0 (lookup) → blocked on q#4
```

**What they do:** Answer q#4 (`ISBN-13`) in `INTERVIEW.md`, get a cup of coffee.

**What they feel:** "Huh. Three things are happening at once. And none of them need me right now."

**10 minutes later:**

```
[14:16] DevAgent-1 PR #1 opened (scan UI) — CI green ✓
[14:17] DevAgent-2 PR #2 opened (list screen) — CI green ✓
[14:17] DevAgent-3 picked up dev-f2b9d0 (lookup) — unblocked
[14:18] TestAgent-1 picked up test-e1c7d1 (scan UI coverage)
[14:20] PR #1, PR #2 auto-merged to develop after review
[14:29] DevAgent-3 PR #3 opened (lookup) — CI green ✓
[14:30] PR #3 auto-merged to develop
[14:31] Promotion gate: develop ahead of main by 3 commits, all checks green. Promote?
```

**What they see next:** One question. `Promote develop → main? (y/n/detail)`. They type `y`. Production deploys.

**What they feel:** "That was a feature. That took me 45 minutes, mostly coffee time."

**Why this works:**
- Dev never had to think about what order to do things in. PlanAgent split, DevAgents parallelized, TestAgent covered, Triage coordinated.
- The one INTERVIEW question was genuinely load-bearing — a real decision they had to make.
- The promotion gate was the one "do you actually want this in production?" checkpoint. Trust gradient preserved.
- Nothing ran on their Claude Code rate limit that blocked them from other work — Triage delegated to sub-agents in worktrees.

**Design implications:**
- Status updates must be one line, not paragraphs. Scannable.
- Progress visibility is non-negotiable. The dev can't trust the loop if they can't see it.
- INTERVIEW questions must be triaged in quality too — never ask stupid ones. PlanAgent should prefer "make it configurable" as a default escape, as we've already learned.

### Moment 4 — Week 1: The phone enters the picture

**Dev's context:** Thursday. They're on the subway. Suddenly think: "I should add a reading goal feature."

**What they do:**
- Open the devx companion app.
- Tap the (+) on the Add tab.
- Type: "Add a daily page-count goal, configurable per book, with a streak indicator."
- Tap submit.

**What they see:** "Added to DEV.md. Triage will pick this up in ~30 seconds."

**On their laptop (still running at home):** Triage's next tick fetches the new commit, sees the new `DEV.md` entry, schedules a PlanAgent to turn the one-sentence idea into proper specs. That evening when they get home, the feature has been planned, implementation has started, one question is waiting in their INTERVIEW inbox ("goal is in pages or minutes?"), and two PRs are already in code review.

**What they feel:** "I just added a feature from the subway. And while I was at dinner, half of it got built."

**Why this works:**
- Mobile writes go to `develop`, not `main` — impossible to accidentally deploy a half-specced feature.
- The (+) is a single text field. Not a form with "priority / labels / assignee / epic" dropdowns.
- No domain name needed — Cloudflare Worker's `*.workers.dev` URL is the push endpoint.
- Notification strategy already solved (APNs via FCM, zero marginal cost).

**Design implications:**
- Mobile app's Add tab must be a single text field + optional type. No PM ceremony.
- The laptop must actually be running. Option 2 (Tailscale) becomes useful here as a fallback for when it isn't.

### Moment 5 — Month 1: Self-healing kicks in

**Dev's context:** They've shipped 15 features over the month. Used devx daily. Answered about 30 INTERVIEW questions, corrected ~8 agent-generated files after the fact, rolled back 2 bad merges.

**What they see on a Tuesday morning:** A `LESSONS.md` entry, auto-synthesized overnight by LearnAgent:

```markdown
- [x] `learn/learn-b8c4e2-default-offline-first.md` (auto-applied)
  - Rule: default to offline-first architecture for new screens
  - Confidence: high (4 signals: dev-a3f2b9, dev-e1c7d1, dev-f2b9d0, dev-g2c4d1)
  - Target: CLAUDE.md
  - Evidence: each of 4 screens asked "offline or online-first?" — user answered "offline" every time
  - Applied: commit 8f2c9e1

- [ ] `learn/learn-d4e9f1-promote-goal-model-naming.md` (pending review)
  - Rule: prefer Dart's `@freezed` over plain classes for data models
  - Confidence: medium (2 signals of user editing agent-written models to add @freezed)
  - Target: CLAUDE.md
  - Status: awaiting your approval — tap to accept
```

**What they do:** Tap accept on the pending one, mentally note the auto-applied one.

**What they feel:** "Oh — it noticed. I don't have to keep saying that."

**What's happening under the hood:**
- LearnAgent has been scanning every spec file's status log, every git commit, every skill-edit hook.
- Clusters signals. High confidence + low blast = applied; medium = queued.
- Every lesson is traceable back to the specific spec files that triggered it.
- Agent-prompt edits are gated by canary runs — they haven't happened yet, will appear around month 2–3 once enough data accumulates.

**Design implications:**
- Lessons surface in both `LESSONS.md` and the mobile app's Inbox tab.
- Every lesson shows evidence, so the dev's trust-gradient gets higher over time as they see LearnAgent is right.
- Rollback is always one command away.

### Moment 6 — Month 6: The system has mass

**Dev's context:** Reading tracker has launched, has 3,000 users, 50 GitHub stars, 5-star App Store rating. They've added a small team — one co-founder engineer joined 6 weeks in.

**What devx looks like now:**
- `DEV.md` has 12 items, prioritized by FOCUS synthesis of real user behavior.
- `DEBUG.md` has 4 items, two of which came from exploratory browser QA noticing the tutorial was confusing before any user reported it.
- `FOCUS.md` has this week's summary: "3 users abandoned on the import-from-CSV flow; 12 requested audiobook support."
- The CLAUDE.md has grown from 300 lines to 800, all of which LearnAgent added and the dev approved.
- Agent INTERVIEW rate has dropped from ~6 questions per feature to ~1.
- The co-founder learned the system in an afternoon because it's all markdown — they just read the files and got it.

**What they feel:** "This is how I want to build everything."

**What's happening under the hood:**
- `.devx-cache/learn-cursor.json` says 47 lessons applied, 6 pending.
- Exploratory QA has caught 9 UX issues before users hit them. $14.30 in API spend that month.
- Mobile app usage has plateaued at ~8 interactions/day — it's ambient.
- Promotion cadence has settled to roughly one `develop → main` promotion per day.

**Design implications:**
- The CLAUDE.md growth is healthy, but needs a periodic "re-consolidate" pass — otherwise it becomes unreadable. LearnAgent has a quarterly "compact" mode that groups related rules.
- The team-onboarding moment is critical. Make sure "read the eight backlog files" is enough to onboard a new dev. If it isn't, that's a bug.

---

## 4. Party-mode critique — seven lenses on the DX

BMAD party-mode discipline: have every relevant persona push back on the design. Each lens asks: *what could go wrong, what's missing, what's over-built?*

### PM / end-user lens — does this deliver the promise?

**Strengths:**
- The five-question init fulfills "simple guy to talk to, not a menu."
- The trust gradient is explicit — agents can't touch `main`, promotion is user-gated initially.
- Async-first matches how solo devs actually work.

**Concerns:**
- Six "moments" is an aspirational happy path. What's the *unhappy* path? First-time user on a weird stack (Rust + embedded), or a project where CI genuinely can't be set up day 1 (legacy monolith with flaky local tests). Need a Moment 0.5 for "it didn't work on day 1, here's how to salvage."
- "Promotion gate requires user approval" is great for trust but could become nagware. Need an escalating autonomy ladder: first 10 promotions require approval, next 20 auto-promote after extended gates pass, user can always rescind.
- Does the dev actually see enough to *trust* the loop, or will they feel anxious and open every worktree to verify? Need a "one glance = total confidence" status view. Mobile Activity tab is the candidate, but it needs to be ruthlessly good.

**Open action:** define a "Moment 0.5 — the broken path," codify trust-gradient autonomy tiers in config, harden the Activity view's information density.

### UX designer lens — empty states, errors, onboarding

**Strengths:**
- Init flow is designed as conversation.
- Mobile app has clear tabs and one (+).

**Concerns:**
- What does `DEV.md` look like when it's *empty*? First-time after init, the only entry is the dev's own seed. The file shouldn't feel barren. Add a short "what happens here" comment block at top of each backlog that auto-deletes once N items exist.
- INTERVIEW.md when there are no questions — does it say "no questions for you" or is it just an empty list? Lean toward "nothing's waiting on you ✓" — a small dopamine moment.
- Error state when Triage crashes, when CI is persistently red, when the agent is stuck on the same blocker for days. These need escalation paths into `MANUAL.md` with clear "something's wrong, here's what to try" language.
- What if the dev gets overwhelmed by the mobile Inbox? Pagination? Auto-grouping? Snooze?

**Open action:** draft the copy/empty-state spec for each backlog file. Add "stuck agent" detection + escalation to `MANUAL.md`. Add snooze/batch to mobile Inbox.

### Frontend (Flutter) lens — the companion app

**Strengths:**
- Stack choice (Flutter) matches user's existing muscles and covers every platform.
- Offline queue via `drift` is pragmatic.

**Concerns:**
- Authentication UX for first-run: typing a GitHub PAT on a phone keyboard is awful. Need deep-link from the laptop or QR-code-based pairing.
- Attachment upload (screenshot, voice note) on a 5MB-limit GitHub blob means voice notes > ~3 minutes break. Transcribe on-device (phone has decent Whisper) before committing.
- Push notifications going quiet when laptop is offline: the phone needs to know the laptop is offline and degrade gracefully ("queued locally, will sync when laptop is back").
- What about when the dev has multiple devx projects? Multi-project switcher isn't in the MVP but will be painful by project #3.

**Open action:** design QR-pairing for PAT onboarding. Clip long voice notes or transcribe on-device. Surface laptop-online-status in the app. Multi-project support moved from v2 to v1.5.

### Backend / execution lens — the agent runtime

**Strengths:**
- Worktrees + branches = correct parallelism model.
- Optimistic-hash writes + append-only backlogs = correct concurrency model.

**Concerns:**
- What if Triage itself crashes? Who notices? Need a Triage watchdog — a minimal shell script in `.github/workflows/devx-heartbeat.yml` that alerts via webhook if the local Triage hasn't touched anything in N hours.
- What's the cap on concurrent agents? We said 3. Is 3 enough? Why not 10? The real cap is Claude Code API rate limits + the fact that reviewing N simultaneous PRs creates more cognitive load than value. Keep 3 as default, let the user raise it, auto-degrade when usage > 85%.
- How does the dev debug a stuck agent? Can they tail its event log (`.devx-cache/events/<agent-id>.jsonl`)? Can they kill it with `devx kill <agent-id>`? These primitives need to exist day 1, not month 3.
- Spec files in worktrees — when an agent updates status in the main worktree, it's modifying the main working tree while the dev might have an open editor. Conflict risk. Need locking or a queued-write pattern.

**Open action:** build `devx heartbeat`, `devx tail`, `devx kill` CLIs. Decide the write-queueing pattern for spec-file status updates. Implement auto-degradation at 85% usage.

### Infrastructure / devops lens — CI, deploys, observability

**Strengths:**
- CI-as-ground-truth is the right call.
- `develop`/`main` split is industry standard + matches the safety model.
- No proprietary hosting.

**Concerns:**
- The promotion gate's "extended checks" — what are they exactly? "24h soak on develop" is not always feasible for a dev who ships three times a day. Gate needs to be configurable per-project: fast-ship mode vs. careful-mode.
- Observability wiring (logs / metrics / DB access) is the single biggest "you can't automate this" bottleneck. Most solo devs don't have Datadog or Grafana wired up. What do we recommend when they have nothing? Default → log to a file + Cloudflare Tail + a minimal metrics endpoint in the app. OpenTelemetry in, no specific backend.
- Preview deploys for exploratory QA require the repo to have a deployable preview. What if it's a Flutter mobile app that only builds as an IPA? QA layer 2 falls back to running browser-use against the Flutter web build of the app. Works for 80% of flows; the rest need device-farm automation (v2).
- Cost discipline: the exploratory QA is the only pay-per-use item. We need usage alarms in the Worker so a runaway scheduler doesn't burn $500 in a night. Add a hard daily cap in config.

**Open action:** define "fast-ship" vs. "careful" promotion modes in config. Ship OpenTelemetry + Cloudflare Tail as the default observability recommendation. Enforce a Worker-side daily API-spend cap.

### QA / test architect (TEA) lens — coverage, regressions, quality

**Strengths:**
- Two-layer split is clean.
- 100% coverage on touched surface is the right bar — not absolutist, not lax.

**Concerns:**
- "100% coverage on touched surface" implies a static analysis that knows what "touched" means. Is this line-level, file-level, module-level? Need a precise definition. Line-level via `git diff` is standard and works.
- Flaky tests kill trust in the loop faster than any other failure mode. Add a `TEST.md` auto-detection: any test that fails then passes on retry within a 24h window is flagged as suspect and a `TEST.md` item is filed automatically. TEA's `testarch-test-review` workflow gets invoked to stabilize.
- Regression tests for the mobile app itself — we're eating our own dog food, so the mobile app needs its own coverage gates. Meta-test coverage.
- Property-based testing is missing from the narrative. For data-model-heavy code (a reading tracker has data migrations), property tests catch things unit tests won't. TestAgent should know to reach for `hypothesis` / `fast-check` / `dart_hypothesis` when working on models.

**Open action:** formalize line-level touched-surface coverage. Add auto-flaky-test detection. Add property-testing bias for model code.

### Solo-dev (ground truth) lens — does this save more time than it costs?

**The harshest lens — because this is who we're building for.**

**Strengths:**
- Zero marginal cost (Apple/Google fees already paid for another project).
- No cloud infra to manage.
- Filesystem + git = muscle memory tools, not new ones.
- BMAD escape hatch — can drop back to raw BMAD if devx is the wrong shape.

**Concerns:**
- **Setup cost estimate (real):** Init = 5 min. First meaningful use = 30 min. First self-healed lesson = 1 week of usage. ROI positive after ~3 features built. This is acceptable but must be honest with the user — don't promise 5-min-to-productive if it's actually 30-min-to-productive.
- **Lock-in risk:** If devx grows enough opinion, a dev who wants to leave will find themselves with eight backlog files they need to migrate. Mitigation: BMAD's artifacts remain the canonical source of truth; `LESSONS.md` is purely additive; all devx-specific files are in `.devx-cache/` (gitignored) or are plain markdown (portable). Be explicit about this in the README.
- **Meta-work risk:** The dev starts spending time tuning devx instead of building the actual product. Symptom: `LESSONS.md` rejection rate climbs, custom skill edits proliferate. Mitigation: built-in "are you over-tuning?" detector that fires when user-initiated skill edits > agent-originated lesson applications in a 7-day window.
- **Cognitive load of 8 backlog files + 8 slash commands:** The dev's mental map has to hold all of this. The one-file-one-purpose naming helps. The mobile app helps (it's the "summary" layer). But we should *actively test* that an average user can name 5 of the 8 commands a week after init. If they can't, simplify.

**Open action:** honest ROI copy on the README. Explicit "how to leave devx" section in SETUP.md. Over-tuning detector in `LearnAgent`. User-testing the 5-of-8 command recall.

---

## 5. Decisions this walkthrough locks in

These become canonical; update DESIGN.md / README.md / OPEN_QUESTIONS.md to reflect:

1. **Trust-gradient autonomy ladder.** Per-project config. First N promotions require approval; subsequent auto-promote after extended gates. User can always revoke autonomy. Eliminates the "promotion gate is nagware" risk.
2. **"Moment 0.5" — the broken path.** `/devx-init` must have a failure mode that leaves the dev on a workable path even if auto-CI setup can't complete. The scaffolding is always optional-extensible, never all-or-nothing.
3. **Watchdog + heartbeat primitives.** `devx heartbeat`, `devx tail <agent-id>`, `devx kill <agent-id>` land in v0.1, not later. These are required for trust.
4. **Line-level touched-surface coverage.** Not file-level, not module-level. Use `git diff HEAD develop` to compute touched lines; gate fails only on those.
5. **Auto-flaky-test detection.** Any test that green-then-red-then-green within 24h auto-fills `TEST.md`.
6. **Fast-ship vs. careful promotion modes.** User picks in config. Fast-ship = CI green + no reviewer blockers = auto-promote. Careful = fast-ship + 24h soak + browser-QA pass.
7. **Daily API-spend cap on exploratory QA.** Hard-coded Worker-side ceiling, default $5/day, configurable. Worker refuses scheduled QA runs past cap.
8. **Over-tuning detector.** LearnAgent monitors user-originated skill edits vs. lesson applications and surfaces a gentle warning when the ratio inverts.
9. **Multi-project support moves from v2 to v1.5.** Solo devs run multiple projects routinely; 3+ project mobile switcher is near-MVP.
10. **Honest ROI in README.** "30 minutes to first real payoff, 2 weeks to felt benefit, 1 month to feel like you can't live without it." Real numbers, not marketing.
11. **"How to leave devx" section in SETUP.md.** Portability as a first-class feature.
12. **Onboarding copy / empty states as spec work.** Not an implementation detail — they're the product surface users see first and hardest.

---

## 6. New open questions that came out of this walkthrough

Appending to OPEN_QUESTIONS.md:

- **Q16. Trust-gradient defaults.** How many auto-promotions before the dev trusts the system enough to skip approval? Plausible range: 5–20. Pick a default, let config tune.
- **Q17. CLAUDE.md bloat management.** LearnAgent can grow CLAUDE.md unboundedly. What's the periodic "compact" trigger? Size-based (> 1000 lines), age-based (quarterly), or signal-based (user hand-edited CLAUDE.md to remove redundancy)?
- **Q18. Team onboarding UX.** When the second dev joins, what's the literal first command they run? `/devx-onboard <your-name>`? Does the system walk them through the eight backlog files and the branching model actively? Missing from MVP.
- **Q19. CI setup escape hatch.** What if GitHub Actions can't run (client repo, private runner politics)? The `/devx-init` CI-setup step must be skippable without breaking the rest.
- **Q20. Monorepo per-subtree CI mapping.** Already surfaced in Q12; this walkthrough confirms it's real. Decide the config shape.
- **Q21. Lock-in mitigation evidence.** What concrete test proves a user can leave devx in under an hour? "Run `devx eject`, get a vanilla BMAD project back." Build this as a literal command.

---

## 7. Next actions

In execution order (not importance):

1. **Commit this brief and the BMAD install to `develop`.** (Requires creating `develop` branch, since the repo doesn't have one yet.)
2. **Update `OPEN_QUESTIONS.md`** with Q16–Q21 from section 6.
3. **Update `README.md`** with the honest-ROI copy and the "How to leave" note (DESIGN decision 11).
4. **Update `DESIGN.md`** with the trust-gradient autonomy ladder, watchdog primitives, line-level coverage definition, fast-ship/careful modes, over-tuning detector.
5. **Write `PRD.md`** (next BMAD artifact) — detailed product requirements per command / per backlog file / per agent. This brief is the "why"; the PRD is the "what."
6. **Write `architecture.md`** (next BMAD artifact) — how the pieces actually fit. Much of DESIGN.md folds into this.
7. **Chunk into epics.** First epic: `/devx-init` itself (Moment 2 is the hardest UX and the foundation of everything else). Second epic: `/devx-triage` + one-agent execution. Third: parallel agents. Fourth: mobile. Fifth: self-healing. Sixth: exploratory QA.
8. **Party-mode each epic** before writing stories. Maintain the discipline the current `/dev-plan` enforces.

This brief intentionally stops before writing stories. Stories come from PRD + architecture + epic chunking, and those are the next BMAD phases. This document's job was to *think deeply about DX end-to-end*, which is analyst → PM → party-mode. That's done.
