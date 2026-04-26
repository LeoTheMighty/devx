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

## 9. Browser agent — ~~which harness?~~ **RESOLVED**

**Decision (2026-04-23):** Two layers, each with the right tool. See [`QA.md`](./QA.md).

- **Layer 1 (regression):** Playwright, scripted, runs in CI per PR. $0.
- **Layer 2 (exploratory):** `browser-use` (LLM-agnostic open-source Python agent). Runs as a subprocess with its own Anthropic API key — decoupled from the Claude Code usage window. Scheduled by `/devx-focus`, fire-and-forget, reads results on next Triage tick.

**Key architectural choice:** exploratory QA is NOT a Claude Code sub-agent. It's a subprocess. This keeps costs predictable, keeps the main session's rate limit free, and lets Triage spawn multiple QA runs in parallel.

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

## 16. Trust-gradient autonomy ladder — ~~what are the defaults?~~ **RESOLVED**

**Decision (2026-04-23):** N is mode-derived ([`MODES.md`](./MODES.md)). YOLO N=0, BETA N=3, PROD N=10, LOCKDOWN N=∞. On rollback, N halves; on hotfix-revert, N zeros. See DESIGN.md § "Trust-gradient autonomy ladder."

---

## 17. CLAUDE.md bloat — when to compact?

**Context:** LearnAgent grows `CLAUDE.md` with every applied lesson. Useful at first, unreadable at 1000+ lines.

**Options:**
- **(a) Size-based:** auto-compact when > 1000 lines.
- **(b) Age-based:** quarterly compaction pass.
- **(c) Signal-based:** triggered when user hand-edits CLAUDE.md to remove redundancy (self-healing signal S3).
- **(d) Hierarchical:** compact near-duplicates into grouped rules; never delete; retain full history under `docs/claude-md-history/`.

**Leaning:** (a) + (d). Size ceiling triggers a LearnAgent "compact" mode that groups near-duplicates into parent rules, preserving originals in history.

**Lands in:** SELF_HEALING.md § new "Compaction" section.

---

## 18. Team onboarding — first command for the second dev

**Context:** Walkthrough Moment 6 assumed the co-founder read the backlog files and got it. That's optimistic.

**Open:** do we need `/devx-onboard <their-name>`? What does it do? Walks through the eight backlog files, assigns their GitHub handle, seeds their personal memory with project context, registers their mobile device?

**Leaning:** Yes, `/devx-onboard` as a command. Not MVP but v1.5. Solo-first bias means deferring this.

**Lands in:** Future `DX.md` epic ("team collaboration").

---

## 19. CI setup escape hatch

**Context:** `/devx-init` scaffolds `.github/workflows/devx-ci.yml`. What if the user's repo can't run GitHub Actions (private runners only, client restrictions, whatever)?

**Answer:** `/devx-init --skip-ci` flag, plus a graceful degradation path: if CI is not available, agents skip the "wait for remote CI" phase and gate merges on local checks only. Log the downgrade explicitly in CLAUDE.md so every future agent knows.

**Lands in:** SETUP.md + `/devx-init` skill spec.

---

## 20. Monorepo per-subtree CI mapping

Same as Q12 — walkthrough confirmed this is real, not hypothetical. Concrete shape:

```yaml
# devx.config.yaml
projects:
  api:
    path: services/api
    lint: npx nx run api:lint
    test: npx nx run api:test
    coverage: coverage/api/lcov.info
  flutter:
    path: apps/flutter
    lint: dart analyze
    test: flutter test
    coverage: coverage/lcov.info
```

TestAgent selects the right commands based on which project's files were touched.

**Lands in:** DESIGN.md § "Opinionated defaults" → "Tests early" + devx.config.yaml schema.

---

## 21. Lock-in mitigation — build `devx eject`

**Context:** Portability claim in the brief must be testable. Solution: ship `devx eject` in v1.

**What it does:** removes `.devx-cache/`, `.worktrees/`, and `.claude/commands/devx-*` from the current project. Leaves `_bmad/`, `_bmad-output/`, backlog files, spec files, and CLAUDE.md intact. User is left with a vanilla BMAD project that can be driven entirely by raw `/bmad-*` commands. Git history is preserved; lessons are preserved in CLAUDE.md.

**Lands in:** DESIGN.md § "Contract between devx and BMAD" + `devx eject` CLI spec.

---

## 22. Focus-group panel size — how many personas?

Default: 4 real + 1 anti-persona = 5. Minimum 3 real; maximum 7 real.

**Open:** is mandatory anti-persona inclusion correct, or should it be opt-in? Leaning: mandatory. The anti-persona is the scope-discipline feature; making it optional would cause it to be skipped, which defeats the purpose.

**Lands in:** FOCUS_GROUP.md § "When the focus group is consulted" (already partially there; mandatory anti-persona behavior needs explicit decision).

---

## 23. Panel-blocking weight threshold for promotion gate

From `pre-merge-ux-check.md` prompt: `block_weight >= 0.40` → promotion blocked. Is 40% the right threshold?

**Options:**
- Lower (0.30): more cautious; more friction.
- Higher (0.50): more permissive; risks shipping things that hurt a plurality.

**Leaning:** 0.40 is a defensible starting default. LearnAgent should monitor: if real user churn correlates with persona blocks the gate didn't enforce, tighten. If the gate blocks things that shipped fine, loosen.

**Lands in:** `devx.config.yaml` + self-healing signal.

---

## 24. Persona-evolution UX — how does the user see panel changes?

Every persona edit proposed by LearnAgent goes through `LESSONS.md` → PR → approval. But small reaction-library updates accumulate quickly (new delight observed, old prediction invalidated).

**Options:**
- **(a) Per-edit items:** every change is its own `LESSONS.md` entry. Noisy.
- **(b) Weekly persona digest:** Sunday rollup of all persona changes, one approval burst per persona per week.
- **(c) Confidence-gated:** reaction-library updates auto-apply at high confidence, full-profile edits require approval.

**Leaning:** (b) + (c). Weekly digest for bulk reaction-library updates; individual items for new persona creation / persona retirement.

**Lands in:** SELF_HEALING.md § new "Persona evolution cadence" section.

---

## 25. Persona-seeded exploratory QA prompts

QA.md's exploratory layer (browser-use) takes a persona prompt. Now that `focus-group/personas/*.md` exist, those files should be the authoritative source for QA prompts.

**Decision (no longer open):** `/devx-test` exploratory runs read the persona file directly, render the persona into a browser-use persona prompt, and execute. Any divergence between persona-predicted behavior and actual browser-use behavior is itself a signal for persona evolution.

**Lands in:** QA.md § 2 update + FOCUS_GROUP.md § 11 wiring.

---

## 26. Mode — temporary YOLO windows inside PROD projects?

Sometimes you want "next 2 hours I'm rehearsing a migration on a scratch branch, treat it as YOLO" without downgrading the whole project.

**Options:**
- **(a) Per-branch mode override:** `.devx-branch-mode` file in a branch only; auto-reverts when branch merges or is deleted. Only allowed on non-`develop`, non-`main`.
- **(b) Time-boxed mode override:** `/devx-mode yolo --for 2h` sets a mode that auto-reverts to project default on timer. Global across branches.
- **(c) Don't support it.** Keep the mental model simple; use a separate scratch repo for high-risk rehearsal.

**Leaning:** (a) for v1.5. Branch-scoped reversible override is the right granularity; time-based expires risk getting forgotten.

**Lands in:** MODES.md § "Open questions" (already there).

---

## 27. Mode — per-epic or per-feature instead of per-project?

Some features are riskier than others even within one project.

**Decision:** No. Mode is per-project. Per-epic or per-feature mode adds cognitive load with marginal benefit. If one feature is meaningfully more dangerous than the project mode suggests, flag it in that epic's file and require an explicit `/devx-mode lockdown` window around the shipping.

**Lands in:** MODES.md § 4 "Why four modes" (already documented).

---

## 28. Mode-aware self-healing cadence

In YOLO we want fast iteration on lessons; in PROD we want slow and careful.

**Decision:** Yes — mode determines both (a) the auto-apply ceiling (already in MODES.md §2.3) and (b) the scan cadence. YOLO: after every merge. BETA: daily. PROD: weekly digest. LOCKDOWN: paused.

**Lands in:** SELF_HEALING.md § new "Cadence" section (needs adding).

---

## 29. RetroAgent threshold — how many concordant retros before LearnAgent acts?

The two-stage self-healing model (`SELF_HEALING.md § Two-stage loop`) requires ≥3 concordant retros before LearnAgent proposes anything. Is 3 right? Plausible 2–5.

**Leaning:** start at 3. Tune via `devx.config.yaml → learn.retro_threshold`. LearnAgent itself can adjust this over time (meta-learning) once enough data exists.

**Lands in:** `devx.config.yaml` schema; SELF_HEALING.md.

---

## 30. Story-derived QA — when is the QA walkthrough section "good enough" to auto-translate into Playwright?

Some QA walkthroughs are abstract ("user can sign up"); others are surgical ("tap Continue, expect green check"). Auto-translation works for the latter, not the former.

**Options:**
- **(a) TestAgent attempts translation; logs failures to `TEST.md` for manual fixup.**
- **(b) DevAgent grades its own QA walkthrough (auto: surgical, mixed, abstract); only auto-translation if surgical.**
- **(c) Two-pass: TestAgent does best-effort; FocusAgent re-uses abstract walkthroughs as exploratory persona prompts.**

**Leaning:** (c). Surgical → regression test. Abstract → exploratory prompt. Mixed → both.

**Lands in:** QA.md § "Story-derived QA"; `/dev` Phase 6 wiring.

---

## 31. Agent rip-through bug — was the lock primitive sufficient?

The CI-race bug ("waits for CI in one agent; another rips through") is fixed in spec only. We need:
- An integration test that intentionally races two `/dev` invocations against the same branch family and asserts the second backs off.
- A `learn/` entry retroactively documenting what happened (so when it recurs we recognize it instantly).

**Action item:** add to `MANUAL.md` once the lock primitive is implemented in code: "race-test the lock primitive end-to-end."

---

## 32. Project-shape mode interactions

Five project shapes × four modes = 20 combinations. Most won't ever be exercised. Which ones are actually nonsensical or worth blocking?

- `empty-dream + PROD` — silly (no users yet by definition); init refuses unless user explicitly confirms.
- `production-careful + YOLO` — contradictory; init refuses.
- All others: valid, with different DevAgent biases as described in DESIGN.md § Project shapes.

**Lands in:** `/devx-init` validation logic.

---

## 33. Identify the "send it" / "just do it" LLM CLI Leonid is half-remembering

**The thought:** "There's some 'Just do it' or 'Send it' LLM cli that I'm completely forgetting the name of that I want to look into what it is and does."

**Why it matters:** If something out there is already nailing the `send-it` thoroughness tier (DESIGN.md § Thoroughness levels), we should at minimum study it before reinventing.

**Research candidates to check:**
- `aichat --yolo` (sigoden/aichat) — multi-model TUI with a yolo execute mode.
- `opencode` (sst) — terminal coding agent with aggressive auto-approve.
- `plandex` — multi-step CLI agent with auto-apply.
- `goose` (Block) — desktop agent CLI; has an "auto" mode.
- `llm` (Simon Willison) plus the `llm-cmd` plugin.
- `just` — could be confused with the task runner of the same name; unlikely.
- Aider's `--yes-always` flag (functional equivalent without a name).
- `dyad`, `ona`, `sketch`, `vibe` — long-tail YC/indie tools; unverified.

**Action:** spawn an Explore-style web research pass on these candidates; paste findings here; pick the closest match. If none match, consider that Leonid's memory is conflating two tools and bail.

**Lands in:** add a comparison row to `COMPETITION.md` once identified; if the matching tool has a notable opinion in the `send-it` tier, fold into DESIGN.md § Thoroughness.

---

## Tracking this list

As items resolve, move them from here into DESIGN.md with a link-back in the commit message. Anything that stays here > 90 days probably needs a decision — revisit quarterly.
