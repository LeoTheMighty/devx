# Focus Group — persistent user-persona panel

A persistent cast of user personas that devx consults throughout a project's life. Unlike party-mode (team lenses — PM, UX, backend, infra) or the existing elicitation-mode (one-shot ephemeral personas), the focus group is **stateful**: created at `/devx-init`, stored in the repo, consulted on every meaningful change, and updated as real user data comes in.

This is the thing that makes `/devx-focus` rich. Today `/devx-focus` synthesizes telemetry; with the focus group it also simulates a user panel reacting to proposals before they ship.

---

## 1. BMAD foundation

BMAD ships with method #4 in `_bmad/.../advanced-elicitation/methods.csv`:

> **User Persona Focus Group** — "Gather your product's user personas to react to proposals and share frustrations - essential for validating features and discovering unmet needs."
>
> Flow: `reactions → concerns → priorities`.

That's the engine. What BMAD doesn't provide:

- A **persistent persona table** — BMAD's method invents personas ad-hoc each time.
- A **consultation schedule** — BMAD leaves it to you to invoke.
- **Persona evolution** — real user signals don't flow back into the personas.
- **Integration** with plan / dev / promotion gates.

devx supplies those four pieces. BMAD's elicitation method is the interaction primitive; devx turns it into an always-on subsystem.

---

## 2. Where personas live

```
focus-group/
├── index.md                          ← one-page summary of the whole panel
├── personas/
│   ├── persona-maya-habitual-reader.md
│   ├── persona-joel-list-completer.md
│   ├── persona-priya-power-reader.md
│   ├── persona-sam-casual-browser.md
│   └── persona-taylor-accessibility-first.md
├── sessions/                         ← consultation outputs, one per run
│   ├── session-2026-04-24-barcode-scan-review.md
│   ├── session-2026-04-27-import-csv-review.md
│   └── ...
└── prompts/                          ← reusable consultation prompts (LearnAgent editable)
    ├── new-feature-reaction.md
    ├── pre-merge-ux-check.md
    └── retrospective-after-launch.md
```

Each persona is one markdown file. One file per persona is deliberate: the panel should be small enough that the entire cast fits in your head. Default target: **4–6 personas**, never fewer than 3, rarely more than 8.

---

## 3. Persona schema

Each `persona-*.md` has a full profile — enough that an LLM prompted *as* this persona responds in a recognizable voice, not a generic "user":

```markdown
---
name: Maya
archetype: Habitual Reader
weight: 0.30                          ← approx share of target user base
created: 2026-04-23
revised: 2026-04-23
source: seeded-at-init
---

## Demographics
- 28–35, urban, works in non-technical white-collar field
- Primary device: iPhone, uses web rarely
- Spoken language: English
- Reading context: evening before bed, weekend mornings

## Goals with this product
- Keep a private record of what she's read without friction
- Notice patterns over months (which months she reads more, which genres)
- Revisit highlights from a book she finished 2 years ago

## Frustrations
- Apps that demand an account before showing any value
- Social features she didn't opt into ("who else is reading this")
- "Streak" gamification that pressures her when life gets busy
- Slow camera / barcode scanners

## Voice
Thoughtful, quiet, values calm. Prefers decisive UI copy over cheerful copy. Will write a 2-sentence App Store review only if something upset her.

## Tech savvy
Medium. Can follow a 3-step setup. Won't edit a config file.

## Accessibility
Wears reading glasses; some contrast requirements. Occasional one-handed use.

## Reactions library
Preferences the panel has established over prior sessions. LearnAgent updates this as sessions accrue.

- **Onboarding:** "If it asks for an account before I see my books, I close the app."
- **Barcode scan:** "Loves it. But must work in bedroom lighting."
- **Highlights:** "Only if it's as fast as a screenshot."
- **Gamification:** "Hard no on streaks, hard no on notifications shaming me."
- **Sync:** "Assumes it. Won't forgive if it breaks."

## Signature red flags
Things that cause Maya to silently uninstall, ranked:
1. Any onboarding step that isn't a book
2. A push notification in the first week
3. A bug that loses her highlights

## Signature delights
Things that make Maya recommend the app:
1. Barcode-scan-to-shelf in under 3 seconds
2. A monthly "what you read" card she'd actually screenshot
3. Working offline in airplane mode
```

Five-or-so personas at this depth are much more useful than fifteen at surface depth. Depth enables *disagreement* — Maya's "hard no on streaks" lives next to Joel's "streaks are what keep me engaged," and that's where the best product decisions get surfaced.

---

## 4. When the focus group is consulted

Five triggers, matched to existing devx phases:

### 4.1 At `/devx-init` — persona creation

Question 6 of init (extension from the current 5-question flow):

> **devx:** Last one — who are you building for? One or two sentences per archetype is fine. Or say "propose some" and I'll draft a starter panel based on your project idea.

If the user gives archetypes, PlanAgent expands each one into a full persona file via the BMAD `advanced-elicitation` User Persona Focus Group method, drafts a `weight`, and writes to `focus-group/personas/`. If the user says "propose," devx drafts 4 personas appropriate to the project idea and asks for a thumbs-up on each before committing.

Output: `focus-group/personas/*.md` + `focus-group/index.md`. Added to the repo on `develop` as part of the init commit.

### 4.2 During `/devx-plan` — pre-build reaction

After party-mode (team lenses) refines an epic, the focus group (user lenses) gets a second pass. This is the "would our users even want this?" check before any code gets written.

The consultation prompt template (`focus-group/prompts/new-feature-reaction.md`):

```markdown
You are about to role-play each of the personas in this project's focus group.

Context: <epic summary, end-user flow, UX screens>

For EACH persona:
1. Read the persona's profile. Inhabit the voice.
2. React to the proposed change in 2–4 sentences (not bullets).
3. Flag any of the persona's signature red flags this would hit.
4. Flag any of the persona's signature delights this would hit.
5. Rate likelihood of using this feature in their first week (0-10).

After all personas react, synthesize:
- Which concerns are shared across ≥2 personas?
- Which persona would be most harmed if this shipped as drafted?
- Which persona would be most delighted?
- What one change would raise average first-week usage by the largest amount?
```

Output lands in `focus-group/sessions/session-<date>-<epic>-reaction.md` and is cross-referenced from the epic file under a "Focus group reactions" section. If synthesis identifies a shared concern strong enough to reshape the epic, it's appended to `INTERVIEW.md` for user decision.

### 4.3 Before promotion (`develop → main`) — pre-ship review

Second consultation trigger: right before the promotion gate. Different prompt (`focus-group/prompts/pre-merge-ux-check.md`):

```markdown
You are about to promote the accumulated develop changes to production.
Each persona reviews the user-visible changes since the last promotion.

For EACH persona, answer:
1. Does anything in this batch hit one of your red flags?
2. Does anything delight you?
3. If you tried the app for the first time today, would your impression change?
4. Is there anything you'd uninstall over?
```

Output: `focus-group/sessions/session-<date>-pre-promotion.md`. Any persona flagging a red flag adds a `blocking: focus-group` tag to the promotion gate. User can override but sees the objection.

### 4.4 Post-launch / real user signal — persona evolution

When real telemetry comes in via `FOCUS.md` synthesis:

- Patterns that match an existing persona's profile → that persona's `reactions library` gets strengthened (high confidence).
- Patterns that no existing persona would plausibly produce → new persona candidate proposed.
- A persona's drafted reaction that real users contradicted → persona profile gets corrected.

This is LearnAgent territory. Persona edits go through the same confidence gates as any other self-healing (`SELF_HEALING.md`):
- High confidence + single-persona-reaction-library update → auto-applied.
- New persona proposed → queued in `LESSONS.md` for user approval.
- Existing persona being retired or heavily rewritten → requires explicit approval.

### 4.5 On demand — `/devx-focus-group <question>`

Direct invocation:

```
/devx-focus-group "Would any of these users pay $5/month for audiobook support?"
/devx-focus-group "We're considering a streak feature — poll the panel."
/devx-focus-group --persona maya "How do you feel about the new onboarding copy?"
```

Cheap, fast, runs the BMAD elicitation method with the persistent cast. Output goes to `focus-group/sessions/`.

---

## 5. The `/devx-focus` command — now does two jobs

Previous design: `/devx-focus` synthesizes telemetry + user feedback.

Expanded design: `/devx-focus` has two modes:

| Mode | When | Input | Output |
|---|---|---|---|
| **Simulated** | Pre-ship, during planning, ad hoc | Focus-group personas + proposed change | `focus-group/sessions/session-*.md` + entries to `DEV.md` / `INTERVIEW.md` |
| **Empirical** | Post-ship | Real user telemetry + explicit feedback | `FOCUS.md` rolling summary + entries to `DEV.md` / `DEBUG.md` |

The two modes reinforce each other. Simulated predicts; empirical validates; the diff between them is the tightest possible signal for persona evolution.

---

## 6. Consultation output shape

Every `focus-group/sessions/session-*.md` has the same shape so `/devx-focus` synthesis and LearnAgent scans can parse it:

```markdown
---
type: simulated-session
trigger: pre-merge  # or: planning | on-demand | post-launch
date: 2026-04-27
subject: epic-import-csv
personas_consulted: [maya, joel, priya, sam, taylor]
---

## Maya (Habitual Reader)
<2-4 sentences in her voice>
- Red flags hit: [list or "none"]
- Delights hit: [list or "none"]
- First-week usage: 4/10

## Joel (List Completer)
<...>

## Priya (Power Reader)
<...>

... [for each persona]

## Synthesis
**Shared concerns:** <bulleted>
**Most at-risk persona:** <name, reason>
**Most delighted persona:** <name, reason>
**Top recommended change:** <one sentence>

## Action items filed
- `INTERVIEW.md` q#<n>: <the decision we need from the user>
- `DEV.md`: `dev-<hash>` — <new spec file if synthesis surfaced a new feature to build>
```

Machine-readable + human-readable. LearnAgent reads synthesis; humans skim the reactions.

---

## 7. Persona evolution rules

Personas are not fixed. They're model fits to real users, and they should improve over time.

| Signal | Effect on persona |
|---|---|
| Empirical behavior matches a persona's predictions → | reinforce that reaction-library entry (confidence tag). |
| Empirical behavior contradicts → | correction via LearnAgent, queued for approval if large. |
| New behavior pattern unattributable to any persona → | new persona candidate (LearnAgent writes a draft, user approves). |
| Persona never fires a distinct reaction vs. another persona across 5 sessions → | "merge candidate" — the two personas are redundant; user decides. |
| Persona weight (share of user base) drifts > 15% from modeled → | re-weight, log in `focus-group/index.md` history. |

Every edit to a persona file is a git commit with a traceable trigger. You can always `git log focus-group/personas/persona-maya-*.md` to see how Maya evolved.

---

## 8. `focus-group/index.md` — the one-page cast sheet

```markdown
# Focus Group — Reading Tracker

Last updated: 2026-04-27

| Persona | Archetype | Weight | Primary device | Signature red flag | Signature delight |
|---|---|---|---|---|---|
| Maya | Habitual Reader | 30% | iPhone | Account before value | 3-second barcode-to-shelf |
| Joel | List Completer | 25% | iPhone | Loss of streak | Visible progress bars |
| Priya | Power Reader | 20% | iPad + web | No export | CSV import from Goodreads |
| Sam | Casual Browser | 15% | iPhone | Feels like "work" | Ambient widget |
| Taylor | Accessibility-First | 10% | iPhone + VoiceOver | Poor screen reader labels | Dynamic Type from day 1 |

## Panel dynamics
- **Strongest disagreement:** Maya and Joel on streaks. Joel loves them; Maya churns over them. Default: make streaks opt-in, default off.
- **Strongest agreement:** all personas want offline-first. Encoded as a locked decision in CLAUDE.md.
- **Underrepresented:** non-English speakers. Add a persona when we internationalize.
```

This file is the scan-layer for the whole subsystem. The mobile app's "Panel" tab renders directly from it.

---

## 9. Integration with existing commands

| Command | Focus-group interaction |
|---|---|
| `/devx-init` | Creates the seed panel (personas + index + prompts). |
| `/devx-plan` | After party-mode (team lenses), runs focus-group reaction on each epic; synthesizes concerns into `INTERVIEW.md`. |
| `/devx` | No direct interaction. Implementation runs against specs that have already been focus-grouped. |
| `/devx-test` | Uses persona "signature red flags" as exploratory-QA persona prompts for browser-use (see QA.md). |
| `/devx-debug` | When a bug matches a persona's red flag pattern, increments priority. |
| `/devx-focus` | Dual-mode: simulated (pre-ship) + empirical (post-ship). |
| `/devx-focus-group` | Direct invocation. |
| `/devx-triage` | Reads focus-group synthesis items as an input signal for reprioritization. |
| `/devx-learn` | Evolves personas from real-user signal. |

---

## 10. Cost and runtime

Per consultation session:
- 4–6 personas × 2–4 paragraphs each = ~500–1500 output tokens.
- Plus synthesis = ~300 tokens.
- Plus input (epic summary + all persona profiles) = ~2000–4000 tokens.
- Total: ~4,000–7,000 tokens per session.

At Claude Sonnet 4.6 rates: ~$0.05–0.15 per session. Budget assumption: ~2 sessions per shipped feature + ~1 pre-promotion + occasional on-demand = **roughly $0.30–1.00 per feature.**

Per-project upfront cost at `/devx-init`: one deeper session (~10k tokens, ~$0.30) to expand seed archetypes into full persona profiles.

Runs on the same separate pay-as-you-go Anthropic API key used for exploratory QA (not the Claude Code usage window).

---

## 11. Anti-patterns

- **Don't let the panel replace real users.** Personas are models; models drift. Empirical post-launch data always outranks panel predictions when they conflict.
- **Don't run the panel on every PR.** Per-PR consultation is noise. Consult during `/devx-plan` (before building) and pre-promotion (before shipping). Those are the decision moments.
- **Don't vote.** Focus groups are for surfacing reactions, not settling them democratically. Synthesis summarizes; the user decides.
- **Don't let personas converge into one voice.** If two personas never disagree, they're redundant — merge them. Disagreement across personas is the whole point.
- **Don't grow the panel past 8.** Cognitive limit. If a new distinct archetype emerges, consider which existing persona it replaces, not just adds.
- **Don't forget the anti-persona.** A persona the product is explicitly *not* for. Including one prevents scope creep from "but what about users like X?" The anti-persona is referenced at promotion time: "does this batch drift us toward serving the anti-persona?"

---

## 12. Open questions

Appending to OPEN_QUESTIONS.md:

- **Q22. How many personas at init is the sweet spot?** 4? 5? Dependent on project complexity. Default 4, add a 5th (the anti-persona) mandatorily.
- **Q23. How does a persona "vote" on pre-promotion blocking?** Mode-derived block threshold (see [`MODES.md`](./MODES.md)): panel skipped in YOLO, advisory in BETA, binding at 40% weighted block in PROD, binding at 10% in LOCKDOWN. Resolved.
- **Q24. Panel-evolution transparency.** Does the user see every persona edit LearnAgent proposes? Yes — via `LESSONS.md`. But small reaction-library updates are a lot; consider batched weekly summaries instead of per-edit items.
- **Q25. Persona-specific exploratory QA.** browser-use runs already persona-prompted (QA.md §2). The focus-group subsystem now provides richer persona profiles. Wire them together so `/devx-test` pulls `persona.md` content directly as the QA prompt seed. (Straightforward integration; just needs to be specified.)
