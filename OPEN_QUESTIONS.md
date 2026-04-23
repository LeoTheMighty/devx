# Open Questions

Design decisions that aren't made yet. Each one links to where it would land in [`DESIGN.md`](./DESIGN.md) once resolved. The goal is to keep the README and DESIGN clean while preserving all the things we said we'd come back to.

---

## 1. Agent observability — "what is each agent doing right now?"

**The thought:** "Want to see what each agent is doing, would be cool to still be able to see this granularity."

**Why it matters:** Parallel agents across worktrees means the user can no longer just watch a single Claude Code session. If three DevAgents are running in three worktrees, we need some kind of dashboard — even if it's just a `tail -f` friendly format.

**Options:**
- **(a) Append-only event log per agent:** every agent writes to `.devx-cache/events/<agent-id>.jsonl` with one line per tool call / status change. A `devx watch` CLI tails all of them into a single feed. Cheap, portable, survives crashes.
- **(b) Structured log queryable via `devx status`:** snapshot view — "DevAgent-7 is in phase 3 of 6 on dev-a3f2b9, last heartbeat 12s ago." Rebuilt from (a) on demand.
- **(c) Just read the status log inside each spec file.** Zero extra infra; the info's already there. Downside: no live view of what an agent is doing *between* status log writes.

**Leaning:** (a) + (b). The event log is the source of truth; the status command is the summary view. Both read from the same jsonl files.

**Lands in:** DESIGN.md § "Agent roles" and a new § "Observability".

---

## 2. Manual backlog edits — control freak vs. triage agent

**The thought:** "I wonder if it's a good idea to let our triage agent do this, but I'm a control freak ngl."

**Why it matters:** The whole system depends on the backlog files being correct. If Triage gets priority wrong, or duplicates an item, or drops something, the rest of the graph follows. The user needs a way to intervene without the triage agent undoing their edit on the next pass.

**Options:**
- **(a) Respect `[locked]` tags:** any line marked `[locked]` is never rewritten by Triage. Triage can still insert new items around it.
- **(b) Two backlog files — `DEV.md` (user) + `.DEV.md.agent` (agent view, merged):** user edits are sacrosanct; agent view is advisory. Loses human-first clarity.
- **(c) Git diff-based review:** Triage opens a PR against the backlog files. User approves before it lands. Heavier but highly visible.
- **(d) Just let the user edit, and Triage picks up changes on the next pass:** simplest, and since backlogs are markdown, diff conflicts are tractable. Add a `last-edited-by: user` marker so Triage knows not to auto-revert.

**Leaning:** (d) + (a). Default is optimistic — assume user edits are intentional. `[locked]` for the cases where the user really wants no touching.

**Connection to self-healing:** every user edit of agent-written content is itself a trigger signal (§S3 in [`SELF_HEALING.md`](./SELF_HEALING.md)). So a user "correcting" Triage's backlog edits isn't lost work — LearnAgent uses it as training data. Control and learning are the same mechanism.

**Lands in:** DESIGN.md § "Agent roles" / `TriageAgent`.

---

## 3. Usage-limit handling — "stop at 95%, restart when it resets"

**The thought:** "I want a strong ability to both stop at a certain percentage of usage like 95% so that we can usually trust the triage agent to always be able to work. Also I want the ability to startup again the moment that the usage resets to avoid wasting time."

**Why it matters:** Claude Code has usage windows. If parallel agents burn through the window, Triage itself loses the ability to coordinate — which is the worst failure mode. Triage needs headroom.

**Options:**
- **(a) Reserved budget for Triage:** hardcoded ceiling (e.g., Triage never starts when usage > 85%; DevAgents pause when usage > 95%). Monitored via `/status` or a usage API. Triage is always last to stop, first to resume.
- **(b) Priority tiers:** Triage = priority 0 (always runs), DevAgent = priority 1, TestAgent/DebugAgent = priority 2, FocusAgent = priority 3. On usage pressure, lower priorities pause first. Cleaner framing than (a).
- **(c) Scheduled restart on reset:** use `ScheduleWakeup` or `cron` to re-invoke `/devx-triage` ~1 minute after the usage window resets. No wasted idle time.

**Leaning:** (b) + (c). Priority tiers for graceful degradation; scheduled wakeup for instant resume.

**Open:** what's the actual API for reading current usage? Need to check whether Claude Code exposes this to a running session, or whether we have to infer it from rate-limit errors.

**Lands in:** DESIGN.md § "Parallelism & worktrees" + a new § "Capacity management".

---

## 4. Terminal control — do we need it?

**The thought:** "More logistical things like how could we use and control different terminals from the triage agent, and get input/output from these terminals, or do we need to do this at all?"

**Why it matters:** Parallel agents could run as separate Claude Code processes (one per worktree, one per terminal tab). If Triage has to coordinate them, it needs a way to start/stop/read them.

**Options:**
- **(a) tmux-based:** Triage spawns `tmux new-session -d -s devx-dev-a3f2b9 'claude --resume ...'` per agent. Can `tmux send-keys` to interrupt, `tmux capture-pane` to read output. Mature, scriptable, works in terminal and in SSH sessions.
- **(b) Background `claude` CLI processes:** `claude --prompt "..." --output stream.jsonl &`. Simpler but no way to inspect or redirect mid-run.
- **(c) MCP server as coordinator:** devx runs an MCP server; agents are MCP-aware and check in with it. Heavier infra but first-class integration.
- **(d) Don't spawn separate terminals at all — use `Agent` tool from within a single Claude Code session:** each DevAgent is an `Agent` subtool invocation with `run_in_background: true`. Triage lives in the main session, spawns sub-agents from there. Matches how Claude Code already works; no terminal management.

**Leaning:** (d) as the MVP, (a) as the "I want to watch each one live in its own tmux pane" power-user option later. (c) is too much infra for now.

**Lands in:** DESIGN.md § "Parallelism & worktrees".

---

## 5. Notifications — ~~how do we talk to the user?~~ **RESOLVED**

**Decision (2026-04-23):** Flutter companion app is the primary channel. See [`MOBILE.md`](./MOBILE.md).

Companion is multi-platform (iOS + Android + web + desktop from one Flutter codebase) and talks to GitHub directly — no devx-specific backend. Push notifications go through one tiny Cloudflare Worker that relays GitHub webhooks → FCM (which fans out to APNs on iOS). The Worker is the only server-side code we write for the whole system.

Fallback channels still available:
- Desktop: macOS menu-bar widget (same Flutter codebase, v0.7 of the app).
- SMS / no-code: `ntfy.sh` subscription to the webhook if user doesn't want to install the app.
- GitHub native notifications still fire for PRs regardless.

---

## 6. `/devx-init` — the "simple guy to talk to"

**The thought:** "We want a REALLY REALLY good and solid `/devx-init` strategy to handle everything. When I first approached BMAD it gave me way too many options, I needed a simple guy to talk to about this all."

**Why it matters:** This is the onboarding. If `/devx-init` feels like raw BMAD's numbered menu of 40 options, we've failed before the user ever writes a line of code.

**Draft covered in DESIGN.md § "The /devx-init experience"** — 5 questions, empty-repo vs. existing-repo intake, idempotent re-run. Questions still open:

- **Should `/devx-init` be one long interview or a series of smaller commands?** e.g., `/devx-init` → `/devx-init-ci` → `/devx-init-observability`. Simpler to reason about, but fragments the "one simple conversation" feel.
- **What's the default answer bias?** Should it be aggressive ("yes, set up CI, yes, wire Playwright, yes, commit an initial scaffold") or conservative ("I'll ask before touching anything")? Leaning aggressive-by-default with a `--dry-run` flag for the cautious.
- **Should it detect and adopt an existing `/dev` / `/dev-plan` setup?** For users like you who already have the palateful commands working — don't overwrite, migrate.
- **How opinionated should the first seeded spec file be?** Is it a genuine "first slice" the user described, or a devx-builtin "hello world" that walks them through the loop? The former is more useful but risks the user getting something they didn't quite mean.

**Lands in:** DESIGN.md § "The /devx-init experience" (refine) + the actual `devx-init.md` skill.

---

## 7. What does BMAD actually cover, and where does devx add?

**The thought:** "Let's actually get BMAD working in this project itself to iron out how to make this as good as possible."

**Action:** run `npx bmad-method install` in this very repo (with `core + bmm + tea`), then walk through each workflow it exposes and decide:
- Is this workflow something devx invokes directly? (e.g., `create-story`, `dev-story`, `code-review` — yes, these are the spine of `/devx`.)
- Is this workflow something devx exposes to the user as a first-class escape hatch? (e.g., `brainstorming`, `retrospective` — the user might want these directly.)
- Is this workflow something devx wraps with opinions? (e.g., `check-implementation-readiness` — devx probably wraps this into the pre-merge gate.)
- Is this workflow redundant given devx's model? (if any — need to audit.)

**Specific sub-questions:**
- The `tea` module has `testarch-atdd`, `testarch-automate`, `testarch-ci`, `testarch-framework`, `testarch-nfr`, `testarch-test-design`, `testarch-test-review`, `testarch-trace`. Which of these does `/devx-test` invoke automatically, and which stay as power-user tools?
- BMAD has `bmm-ux-designer` as a persona. How does `/devx-focus` relate to it? The UX persona weighs in during planning party-mode; the focus agent synthesizes real-user signal. They're different axes but may overlap.
- Does devx want its own `architecture.md` shape, or inherit BMAD's exactly?

**Lands in:** A new "BMAD integration audit" section in DESIGN.md, once we've done the install and read through each workflow.

---

## 8. CI/CD provider — GitHub Actions only, or pluggable?

**Default decision:** GitHub Actions. That's what devx's built-in `devx.yml` template generates, and `gh run watch` is the de facto CI-waiting loop.

**But:** some users are on GitLab CI, CircleCI, Buildkite, local-only. Should `/devx-init` offer a choice, or pick GitHub and require users on other providers to adapt?

**Leaning:** GitHub-first for MVP, document the extension point so adding `devx.gitlab-ci.yml` / etc. later is straightforward. Don't build provider abstraction until we have a second concrete provider to validate the abstraction against.

**Lands in:** DESIGN.md § new "CI integration" section.

---

## 9. Browser agent — which harness?

**Default decision:** Playwright. Mature, headless, scriptable, cross-platform, has a good Claude-friendly API via MCP or direct CLI.

**Alternatives considered:**
- **Puppeteer** — node-only, Chromium-only. Fewer features than Playwright.
- **Cypress** — test-first framing doesn't fit well with "drive the app like a user for exploratory QA".
- **Chrome DevTools Protocol direct** — more control, more work.

**Open:** does the browser agent run in CI (slow, expensive, comprehensive) or locally during `/devx-test` (fast, what-the-agent-is-doing-right-now)? Probably both: local for iteration, CI for gate.

**Lands in:** DESIGN.md § new "Browser agent" section.

---

## 10. Coverage policy — "100% coverage" on what surface?

**Stated opinion:** "100% coverage" for devx-managed projects.

**Nuance needed:**
- 100% of what? Lines, branches, functions? (Branches — it's the most meaningful.)
- On what surface? All code, or only code touched by the current PR? (Touched surface — enforcing global 100% on existing codebases is a non-starter; it would refuse every first PR.)
- What about unreachable defensive code, generated code, vendored code? (Explicit opt-out comment: `# devx:no-coverage <reason>`.)
- What's the escape hatch when 100% is genuinely not the right answer? (Per-item override in the spec file frontmatter: `coverage_target: 80`.)

**Leaning:** 100% branch coverage on touched surface, opt-out requires a documented reason. Default; override per-item.

**Lands in:** DESIGN.md § "Opinionated defaults" → "Tests early".

---

## 11. State when multiple Claude Code sessions edit the same backlog

**Scenario:** user is in one terminal editing `INTERVIEW.md` directly; `/devx-triage` is running in another and wants to update the same file.

**Options:**
- **(a) File locks:** `.DEV.md.lock` presence = someone's editing. Simple, prone to stale locks.
- **(b) Content-hash optimistic concurrency:** agent reads, notes hash, writes only if hash unchanged; on conflict, re-read and merge. Works for markdown.
- **(c) Single-writer rule:** only Triage writes to backlog files; user edits go through a `/devx-edit` command that queues the change for Triage to apply. Safest, most restrictive.
- **(d) git-merge based:** every agent edit is a commit on a throwaway branch; conflicts surface as git merge conflicts. Heavy.

**Leaning:** (b) for MVP — it's the minimum required correctness. Document `[locked]` tags (from open question #2) as the user's explicit "don't touch" signal.

**Lands in:** DESIGN.md § new "Concurrency" section.

---

## 12. Can devx manage a monorepo?

**Scenario:** `palateful/` has `app/`, `services/api/`, `services/worker/`, `libraries/utils/`, `terraform/`. Can one DevAgent working `dev-a3f2b9` touch code in 3 of those subtrees?

**Yes, probably** — worktrees are repo-wide, not subtree-wide, and BMAD's story-writing already considers multi-layer work (frontend + backend + infra). But there are sub-questions:
- Coverage gates are per-project (`api:test` vs. `utils:test` vs. `flutter test`). `/devx-test` must know the mapping.
- CI for monorepos is more complex (Nx task graphs, affected-only builds). The generated `devx.yml` needs to match.

**Leaning:** Start with a single-project template. Add a `devx.config.yaml` section `projects:` for monorepo users where they list each subtree + its lint/test/coverage commands. Detect monorepos during `/devx-init` (presence of `nx.json`, `pnpm-workspace.yaml`, `turbo.json`, Cargo workspaces) and offer the monorepo path.

**Lands in:** DESIGN.md § "The /devx-init experience" / existing-project intake.

---

## 13. Self-healing — how aggressive should auto-apply be by default?

**Context:** [`SELF_HEALING.md`](./SELF_HEALING.md) defines confidence gates per write target. But the actual thresholds are calibrated defaults — `high` confidence means "≥3 concordant signals, no contradictions." Those numbers are guesses.

**Open:** do we let users tune thresholds in `devx.config.yaml` from day one, or ship with fixed defaults and tune based on real feedback?

**Leaning:** ship with fixed defaults, log confidence-vs-outcome for every applied lesson, expose tuning once we have ~50 applied lessons to calibrate from. Don't design the knob before we have the data.

**Lands in:** `devx.config.yaml` schema + a `.devx-cache/lesson-outcomes.jsonl` log.

---

## 14. Self-healing — global vs. per-project memory?

**Context:** Some lessons are project-specific ("for palateful, default DB is Postgres"). Some are user-specific ("leonid prefers terse summaries"). Some are general best practices ("always add migrations when touching models").

**Open:** where does each kind of lesson land?

**Leaning:**
- Project-specific → repo's `CLAUDE.md` or project memory.
- User-specific → global user memory (`~/.claude/memory/`).
- General best practices → devx repo's baked-in skill content (merged via PR to devx itself, distributed on next install).

LearnAgent classifies as it writes, based on signal scope (one project = project memory; same pattern across two+ projects using devx = promote to global).

**Lands in:** SELF_HEALING.md § new "Scope classification" section, once we've seen real examples.

---

## 15. Self-healing — unlearning

**Context:** A lesson that was right at the time becomes wrong later. "Default DB is Postgres" → team migrates to DynamoDB. LearnAgent shouldn't keep applying the old rule forever.

**Open:** how do we detect a lesson has gone stale?

**Options:**
- **(a) Contradiction detection:** when new signals contradict an applied lesson, LearnAgent proposes an "unlearn" — rolling back or inverting. Same confidence/gate system applies.
- **(b) TTL on lessons:** every lesson has an expiration (6 months default), after which LearnAgent re-evaluates whether signals still support it.
- **(c) User-driven:** user explicitly retracts a lesson via `/devx-learn --retract <hash>`. No automatic unlearning.

**Leaning:** (a) + (c). No TTLs — that's time-based churn for no reason. Contradiction-driven + explicit retraction covers real cases.

**Lands in:** SELF_HEALING.md § new "Unlearning" section.

---

## Tracking this list

As items resolve, move them from here into DESIGN.md with a link-back in the commit message. Anything that stays here > 90 days probably needs a decision — revisit quarterly.
