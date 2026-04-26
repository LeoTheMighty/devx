# QA subsystem — browser-driven testing + UX pain hunting

Two jobs to do, not one:

1. **Regression QA** — known user flows must keep working. Scripted, deterministic, fast. Runs on every agent PR.
2. **Exploratory QA** — find UX pain points we don't already know about. LLM-driven, semi-autonomous, slower. Runs on a cadence against `develop` (not per PR).

These are different problems and want different tools. Trying to do both with one system makes the deterministic tests flaky and the exploratory agent expensive. devx keeps them cleanly separated.

---

## Layer 1 — Regression QA (scripted Playwright)

**Tool:** [Playwright](https://playwright.dev) (Node or Python — match the repo's primary language). No LLM in the loop.

**Who writes the tests:** `TestAgent` writes them. When a `/devx` DevAgent declares an AC like "user can click Sign in with Google," `TestAgent` picks that up off `TEST.md` and writes the Playwright script that asserts it. Deterministic Playwright scripts are in-scope for LLM code-generation and well within the current `TestAgent` remit.

**Who runs the tests:** CI. Every PR to `develop` runs the Playwright suite in GitHub Actions. Passing is a merge gate.

**Why Playwright:**
- Multi-browser out of the box (Chromium, Firefox, WebKit).
- Headless-friendly, runs in CI.
- First-class Flutter web support via the `flutter drive` integration.
- Trace viewer gives agents a readable artifact to debug from when a test fails.
- Zero LLM cost — deterministic, fast, repeatable.

**Cost:** $0. Runs inside the existing GitHub Actions minutes budget.

**Limit:** Playwright tests only find regressions you already know to check. They don't tell you the onboarding is confusing. That's Layer 2.

---

## Layer 2 — Exploratory QA (LLM-driven browser agent)

This is the "is anything painful?" loop. An agent opens the app, explores it the way a new user would, and writes back a list of friction points. This is where tools like Anthropic's Computer Use / browser-use / Stagehand come in.

**What the agent does:**
1. Spin up a browser pointed at `develop`'s deployed preview URL (Cloudflare Pages or Vercel preview auto-deploys every PR).
2. Execute a persona prompt — "you are a first-time user trying to sign up and book a meal." The prompt library is per-project and gets richer over time (self-healing §S7 applies here).
3. Attempt the flow. Record screenshots, timings, retries, dead-ends.
4. Write findings to `FOCUS.md` as observations and/or to `DEBUG.md` if something is genuinely broken.
5. Terminate the browser session.

**This is scoped work** — one persona, one flow, bounded runtime. Not an open-ended "explore the whole app" session. `/devx-focus` schedules these one at a time, Triage decides when capacity allows.

### Tool options, ranked by fit

| Option | What it is | Claude-dependence | Cost/session | Recommendation |
|---|---|---|---|---|
| **[browser-use](https://github.com/browser-use/browser-use)** | Open-source Python agent that drives a browser via an LLM. Model-agnostic — you can point it at Claude, GPT, a local Llama, Gemini, whatever. | **None.** Works without Claude Code in the loop. | LLM tokens only (~$0.05–0.50 per run depending on model + flow length). Browser itself is free (local Chromium). | ✅ **Primary pick.** LLM-agnostic, self-hostable, scriptable, and cheap. Can run locally or in CI. |
| **[Stagehand](https://github.com/browserbase/stagehand)** | LLM-agnostic TypeScript/Python SDK from Browserbase. Cleaner API than browser-use; can run against local Playwright or Browserbase's cloud browsers. | **None.** | LLM tokens + optionally ~$0.05–0.20/session for Browserbase cloud browsers. | ✅ **Alternative.** Pick this if you want a cleaner API and/or cloud-hosted browsers for parallel sessions without CI overhead. |
| **Anthropic Computer Use (API)** | Claude with a `computer` tool that can see a screen + control mouse/keyboard. Called via API, spawns its own container. | Claude-only. | ~$0.30–$3/session depending on flow length (Claude Opus 4 is expensive). | Use when you specifically want Claude's judgment for a particularly nuanced flow. Not the default — cost adds up. |
| **Claude Code "cowork" / browser MCP** | Claude Code invoking a browser tool via MCP. Runs inside your Claude Code session. | Claude Code session required. | Uses your Claude Code usage window. | ❌ Don't use for automated QA. It couples exploratory runs to your interactive session's rate limit, which is exactly what we want to avoid. Fine for user-in-the-loop debugging. |
| **Raw Playwright + codegen (no LLM)** | Record human sessions into scripts. | None. | $0. | Useful for seeding Layer 1 from real user behavior; not a replacement for Layer 2's exploration. |

**Primary choice: browser-use** for v0.1. LLM-agnostic, open source, cheap. Start with Claude Sonnet or Haiku as the driver (cheaper than Opus, plenty smart enough for a "can I sign up?" flow). Swap to Stagehand if the API becomes limiting. Add Computer Use only for the hardest flows where the cheaper tools fail.

---

## Can Triage spawn these instances?

**Yes, without Triage itself needing to be in a Claude Code session.** The key is making exploratory QA runs **subprocesses**, not Claude Code sub-agents.

### How it works

Triage decides "time to QA the sign-up flow." It does one of:

**(a) Spawn a subprocess locally:**
```bash
# Triage invokes this as a Bash tool call from its Claude Code session,
# but the browser-use process runs independently.
python -m browser_use \
  --task "Sign up as a new user and book a meal" \
  --url https://devx-preview-<pr-sha>.pages.dev \
  --model claude-sonnet-4-6 \
  --output .devx-cache/qa-runs/qa-$(date +%s).json \
  > /dev/null 2>&1 &
```
The browser-use process has its own Anthropic API key, runs in its own Python process, writes its output to a JSON file, and terminates. Triage doesn't wait — it checks back on the output file on its next tick and files findings to `FOCUS.md` / `DEBUG.md`.

**Cost model**: pay-as-you-go Anthropic API tokens, billed to whichever API key the subprocess uses. Doesn't touch your Claude Code usage window.

**(b) Trigger a GitHub Action:**
```bash
gh workflow run qa-explore.yml \
  -f flow="sign-up" \
  -f url="https://devx-preview-<pr-sha>.pages.dev"
```
The workflow runs browser-use in a CI runner. Output is posted back to the PR as a comment. Same cost model, but runs off your machine.

**(c) Browserbase cloud browser via Stagehand:**
```bash
STAGEHAND_ENV=BROWSERBASE \
  npx stagehand run scripts/qa/sign-up.ts
```
Parallel sessions without local resource constraints. Pay-per-session on Browserbase.

### What Triage can and can't do here

- ✅ Triage can shell out to any CLI — browser-use, stagehand, gh workflow — via its Bash tool. It can pass arguments, read output files, and file findings.
- ✅ Triage can queue QA runs via `qa/` spec files exactly like it queues every other kind of work.
- ❌ Triage cannot drive the browser itself inside its own Claude Code session — that would burn the main session's rate limit and block every other agent.
- ❌ Triage cannot react to the QA run mid-flight. It's fire-and-forget, then read the result. Good: simpler. Bad: no interactive debugging. Acceptable for automated exploration.

### Which API key does browser-use use?

Not your Claude Code subscription. A separate pay-as-you-go Anthropic API key stored in `.env` (or Cloudflare Worker secret for GHA-triggered runs). Cost is ~$0.10/flow at Haiku, ~$0.30/flow at Sonnet, ~$1–3 at Opus. Budget $5–20/month for nightly exploratory QA at realistic usage.

This is the key architectural decision: **exploratory QA is its own cost center, on its own API key, completely decoupled from Claude Code usage.** Don't mix them.

---

## QA spec files and backlog flow

New spec-file type: `qa/qa-<hash>-<ts>-<flow>.md`.

`TEST.md` gets a new entry shape for exploratory runs (distinct from scripted test entries):

```markdown
- [ ] `qa/qa-d1f7a2-2026-04-25T02:00-signup-flow-exploration.md`
  - Type: exploratory
  - Persona: "first-time user, skeptical of asking for too much info"
  - Target: https://devx-preview-<pr-sha>.pages.dev
  - Runner: browser-use
  - Cadence: nightly on develop
  - Status: scheduled
```

On completion:
- Concrete bugs found → new items in `DEBUG.md`.
- UX friction observed → new items in `FOCUS.md`.
- No findings → spec file marked `status: done, clean`.
- Runner crashed → new item in `DEBUG.md` against devx itself (the QA infra, not the product).

---

## Preview URLs

For `/devx-focus` exploratory QA to work, every `develop` PR needs a live URL browser-use can hit. Two easy options:

- **Cloudflare Pages preview deploys** — free, auto-build per PR, predictable URL pattern (`devx-preview-<pr>.pages.dev`).
- **Vercel preview deploys** — same idea, also free on personal tier. Pick based on whichever the project uses.

`/devx-init` wires one of these by default based on stack detection (Flutter web build → Cloudflare Pages is a fine default).

**Cost:** $0 on personal tiers, well below the build-minute caps.

---

## Story-derived QA (the load-bearing flow we were ignoring)

DevAgent already writes a "QA walkthrough" section into every story file as it implements (it's part of the BMAD `dev-story` workflow output). For most of devx's history, this section was written and then ignored. That's the bug.

The flow chart that fixes it:

```
    /dev story implementation
              │
              ▼
   Story file gets a `## QA walkthrough` section
   (manual steps a human or browser-use would take to verify)
              │
              ├─────────────► [scripted path]
              │               TestAgent reads QA walkthrough →
              │               translates each step into a Playwright assertion →
              │               commits as test/test-<spec-hash>.md →
              │               regression suite gains new test
              │
              └─────────────► [exploratory path]
                              FocusAgent reads accumulated QA walkthroughs →
                              extracts user-flow patterns →
                              seeds browser-use persona prompts with them →
                              next nightly exploratory run includes new flows

         (Both paths run automatically; nothing new for the dev to do.)
```

**Required wiring (lands as a `dev/` story under E5 of any future planning run):**

1. `/dev` Phase 6 (commit) inspects the story file for a `## QA walkthrough` section. If present and non-empty, it auto-files a `test/test-<spec-hash>-qa-walkthrough.md` spec + appends to `TEST.md`.
2. `/dev-test` (TestAgent) prefers `test/*-qa-walkthrough.md` items as its top-priority work — these are the freshest signal of what to actually test.
3. `/dev-focus` (FocusAgent) maintains a rolling persona-prompt library under `qa/prompts/` that ingests new QA walkthroughs nightly. Today's exploratory run benefits from yesterday's shipped stories.

**Why this matters:** stories already encode "how a human would verify this works." That's free, dev-fresh QA intent. Throwing it away means TestAgent has to reinvent it; integrating it means QA coverage compounds with every shipped story.

---

## Layer 3 — User-in-the-loop QA (informal)

Not automated. When the user is actively using the app and hits a pain point, they open the devx companion (iOS/Flutter) and drop a line into `FOCUS.md` via the (+) button. That's it. Human signal, first-class, synthesized next time `/devx-focus` runs.

---

## Cadence (mode-derived)

| Layer | When it runs | Cost per run |
|---|---|---|
| Regression (Playwright) | Every agent PR to `develop` | $0 (CI minutes) |
| Exploratory (browser-use) | Per mode (see below) | $0.10–$0.50 (API tokens) per run |
| User-in-the-loop | Whenever user taps (+) on phone | $0 |

Exploratory cadence + spend cap are pulled from the project **mode** ([`MODES.md`](./MODES.md)):

| Mode | Cadence | Daily spend cap |
|---|---|---|
| YOLO | On-demand only | $1 |
| BETA | Nightly on develop | $5 |
| PROD | Nightly + pre-promotion | $10 |
| LOCKDOWN | Every commit on develop + every proposed promotion | $25 (temporary) |

Override in `devx.config.yaml → qa.exploratory.*` when needed.

---

## Anti-patterns

- **Don't run exploratory QA per-PR.** That's how costs spiral. Per-PR = regression; scheduled = exploratory.
- **Don't let browser-use drive in production.** Always against a preview deploy, never against `main`. `devx.config.yaml` guards the target URL.
- **Don't put exploration prompts under `_bmad/`.** They belong in `qa/prompts/` in the devx repo so self-healing (SELF_HEALING §S1/S3) can edit them over time.
- **Don't chain browser-use runs.** One persona, one flow, one spec file. Parallelism comes from Triage running multiple runs in parallel across separate subprocesses, not from one run doing multiple flows.

---

## Open questions

Tracked in [`OPEN_QUESTIONS.md`](./OPEN_QUESTIONS.md) once this subsystem starts being built. Key uncertainties:

- How does browser-use authenticate against the preview deploy if the app requires sign-in? (Likely: a seeded test user per project, credentials in a Worker secret.)
- How do we score "UX pain" objectively enough that `FOCUS.md` entries aren't 80% false positives? (Self-healing feedback loop — user rejects false findings; LearnAgent lowers the prompt's sensitivity.)
- Mobile app QA — do we run browser-use against the Flutter web build, or do we eventually add a device-farm layer (BrowserStack / Appium)? Web build is good enough for MVP; device farm is a v2 concern.
