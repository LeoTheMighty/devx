# devx vs. the field — April 2026

## Comparison table

| Tool | Loop closed | State storage | Parallelism | Human-in-loop | Self-learning | Pricing / lock-in | Notable opinionated default |
|---|---|---|---|---|---|---|---|
| **devx** (this repo) | plan → exec → test/debug → ship → iterate | markdown files in user's git repo (8 backlogs + spec dirs) | worktrees, `.devx-cache/locks` for coordination, default cap 3 | `INTERVIEW.md`/`MANUAL.md` queues, Flutter mobile, slash commands | RetroAgent → LearnAgent two-stage, ≥3 concordant retros to mutate | $0 infra, BYO Anthropic/GitHub, `devx eject` escape | Mode × Project Shape 2-axis policy that cascades to every gate |
| **BMAD Method** | plan → exec | markdown in repo (`_bmad/`, story files) | parallel stories since v6.3.0 (Apr 11 2026) | host-CLI chat + `bmad-checkpoint-preview` | `bmad-retrospective` skill (per-epic, no cross-project) | OSS, host-agnostic | Everything is a skill micro-file; PRFAQ as a planning entrypoint |
| **Claude Agent SDK** | exec only | local by default; **Managed Agents** + Memory beta (Apr 23 2026) move it to Anthropic cloud | first-class subagents; concurrent | hooks (`PreToolUse`, etc.) — bring your own UI | built-in **Memory** for Managed Agents only | OSS SDK + $0.08/session-hr for Managed | Subagent results return only "relevant info," not full context |
| **Aider** | exec → ship (auto-commit) | local files + git | single REPL | terminal + git log | none beyond `CONVENTIONS.md` | OSS, BYOK | `--auto-accept-architect` defaults true |
| **Cline** | plan → exec (Plan/Act toggle) | shadow git checkpoint per tool call; user-curated Memory Bank | sequential; subagents are **read-only** | per-tool-call approval in VS Code | Focus Chain todos, no auto-learning | OSS extension free; Teams $20/seat after Q1 2026 | Subagents deliberately can't write or call MCP |
| **Continue.dev** | review → ship | `.continue/checks/` markdown in repo + Hub | concurrent checks per PR | GitHub PR status checks | rules system | Starter $3/M tok, Team $20/seat | Pivoted from IDE-first to **CI-as-the-surface** |
| **OpenHands V1** | plan → exec → review (+ ship via integrations) | event-sourced state, deterministic replay (Nov 12 2025) | concurrent conversations | web UI + Jira/Slack/GitHub | extensible, no turnkey memory | OSS; Cloud free w/ 10 daily caps; Enterprise VPC | Sandboxing is opt-in, not default |
| **Devin 3.0** | plan → exec → PR → iterate (DAG re-planning) | Cognition cloud only | parallel sessions (Feb 2026) | Slack-first, web, GitHub, Linear | **Knowledge** + auto-Wiki | $20/mo PAYG → ACUs at $2.25; hard cloud lock-in | Slack as primary surface, not IDE |
| **Factory Droids** | full SDLC | Factory cloud + **Org/User Memory** | "droid army" w/ per-task model swaps | IDE + Slack + Linear, all first-class | Org Memory product surface | $20–$200/mo per seat + tokens | Model-agnostic by design (mid-task swaps) |
| **Cursor 2/3** | plan → exec → PR | local IDE + cloud worktrees; AGENTS.md + opt-in MEMORIES.md | up to 8 parallel background agents (worktrees) | IDE + dashboard + mobile control | Memory (notepad) + Rules | $20–$200/mo; "Auto" model is unmetered | Worktrees as the unit of parallelism |
| **GH Copilot Agent** | issue → PR → review | GitHub Actions runner + agentic memory at repo level | one task = one runner/PR | issue assignment, PR UI, mobile, CLI | **agentic memory** + org instructions GA Apr 2026 | bundled per-seat; BYOK in CLI | **Issue is the task primitive** |
| **OpenAI Codex** | plan → exec → PR → automate | local CLI + Codex Cloud containers (no internet) + agent memory (Apr 2026) | worktrees + subagents | CLI, IDE, desktop, web | agent memory; AGENTS.md (humans-only-write rule) | bundled w/ ChatGPT plans | **No internet during cloud task** |
| **Replit Agent** | plan → exec → ship → iterate | Replit cloud + GitHub optional | **Parallel Agents** native | web + iOS/Android w/ **Live Activities** | unverified cross-project | effort-based; $20–$100/mo + creds | Live Activities show agent progress on lock screen |
| **v0 / Bolt / Lovable** | prompt → app → preview/deploy | vendor cloud (Vercel/StackBlitz/Lovable) ± GitHub sync | per-project, no agent fan-out | chat + browser preview + mobile (v0 only) | none documented | $20–$30/mo; vendor-runtime lock-in | Production handoff = transfer site / eject repo |
| **Augment Code** | exec → review (cross-repo) | Augment cloud Context Engine indexing whole org | cross-repo Agent sessions | VS Code/JetBrains/Vim/Neovim | **Memories** (auto-update across conversations) | $20–$200/mo, credits | Built for **large existing codebases**, not greenfield |
| **SWE-agent / mini-SWE-agent** | issue → patch | local | none | CLI | none | OSS (MIT), BYO via LiteLLM | Maintainers now recommend **mini** (~100 LOC) over original |
| **smol-developer / gpt-engineer** | spec → codebase | local | n/a | CLI | none | OSS | smol effectively stalled; gpt-engineer absorbed into Lovable |

---

## Synthesis

### What devx is uniquely doing

**The 2-axis Mode × Shape policy lever.** Nobody else makes "do we have user data?" and "what shape is this codebase?" the orthogonal knobs that cascade to every gate. Devin/Factory have a single autonomy dial; Cursor has none; Replit has none. The asymmetric `down-out-of-PROD` friction and instant-`LOCKDOWN` are real product-design opinions you don't get anywhere else.

**Filesystem graph as a coordination primitive across roles.** Aider has local files + git. Continue has `.continue/checks/`. Codex has AGENTS.md. None of them have a *graph of backlogs* across plan/dev/test/debug/focus/learn that triage agents read and reorder. The closest analogue is Continue's PR-checks-as-markdown — and they only do one role's work that way.

**Two-stage self-healing with concordance gating.** Augment's Memories, Devin's Knowledge, Cursor's MEMORIES.md, Codex's agent memory — all of these mutate on a single session's signal. devx's RetroAgent → LearnAgent design (≥3 concordant retros) is the only one that requires an *independent confirmation threshold* before changing the system. This is a real differentiator if you ship it.

**Persistent stateful persona panel.** BMAD has a one-shot User Persona Focus Group elicitation method. devx makes it a stateful, evolving subsystem with empirical feedback loops. No competitor has this at all.

**$0 infra story.** Cloudflare Worker + GitHub + APNs/FCM piggybacked on already-paid dev fees. Devin/Factory/Replit/Cursor all want a SaaS subscription. Aider/Cline/SWE-agent are local-only but lose the mobile + push surface.

### What devx is doing worse

**Mobile companion is on paper; Replit and Cursor 3 already ship it.** Replit has Live Activities surfacing agent progress on the lock screen. Cursor 3 lets you launch and supervise cloud agents from phone/web/Slack/Linear in one sidebar. devx's plan is solid but the bar Replit set in this window is higher than the doc currently aims at.

**Parallelism is hand-rolled.** Cursor 2.0 ships 8 parallel background worktrees with auto-conflict-resolution; Codex has a documented subagent framework; OpenHands V1 has event-sourced state with deterministic replay. devx's `.devx-cache/locks/` is the right idea but is reinventing primitives that OpenHands V1 (Nov 2025) already published a paper on.

**Code-review workflow.** Continue.dev's pivot to PR-as-the-surface — checks defined as committed `.continue/checks/*.md` files reviewed in the GitHub PR UI — is a more *worked-out* version of "agents and humans meet at the PR" than what devx currently writes down. devx's PR template is one line; Continue's is a product.

**Memory loop time-to-value.** Augment's Memories, Cursor's MEMORIES.md, Devin's Knowledge are *shipping* and updating today. devx's two-stage retro loop is more rigorous but harder to land first.

### Things devx may be naively reinventing

- **Coordination state.** Read OpenHands V1's event-sourced state design before solidifying `.devx-cache/locks/`. Their immutable conversation-state object plus deterministic replay solves the rip-through bug at a different layer than file locks.
- **Per-PR markdown checks.** Continue's `.continue/checks/` is `TEST.md` + `DEBUG.md` reskinned. Worth studying their PR-render and rule format before inventing your own.
- **Skill micro-files / retro skills.** BMAD v6 already provides `bmad-retrospective` and `bmad-distillator` skills. Wire devx's RetroAgent through those rather than building a parallel retro pipeline.

### One pattern to steal, one to refuse

**Steal: Replit's Live Activities for agent progress.** The mobile companion's killer demo isn't "I added a `/dev` item from the subway" — it's "I watched DevAgent-7's CI go green on my lock screen while I made coffee." Live Activities + APNs critical alerts close the trust-gradient gap faster than any in-app inbox.

**Refuse: any metered-SaaS billing layer.** Devin's ACUs, Factory's per-seat + tokens, Cursor's credit pools, Replit's effort credits — they all collapse into the same shape: *the runtime owns the meter*. devx's positioning is "your infra, your bill, your repo." Adding a hosted tier or a "devx Cloud" SKU (even later) destroys the lock-in story that the README currently promises and the product-brief explicitly puts in anti-scope. Hold the line.

---

## Currency check

Rapidly-evolving competitors (Apr 2026): Devin 3.0, Factory ($150M Series C Apr 16), Cursor 2/3, Copilot (`.agent.md`, agentic memory, BYOK CLI), Codex superapp, OpenHands V1, Claude Managed Agents+Memory, BMAD v6.3.0, Continue's CI-pivot.

Stable-or-stalled: Aider, Cline, SWE-agent, Augment, smol-developer, gpt-engineer, PearAI, Sweep.

Anyone building in this space needs to watch Cursor and Replit on mobile/parallelism and OpenHands on coordination state most closely.
