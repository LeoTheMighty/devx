# Self-healing

The devx system learns from its own work. When an agent gets blocked, when CI fails twice on the same thing, when the user edits an agent's output, when an INTERVIEW question gets answered the same way three times — those are signals. A dedicated **LearnAgent** reads those signals, extracts a lesson, and writes it back into the system so the next agent doesn't repeat the work.

The goal is a loop that gets **tighter over time**: your first devx project asks you 20 INTERVIEW questions; your tenth asks you 3, because the rest were answered once and baked in.

---

## What gets updated

Six write targets, ordered by blast radius (smallest to largest):

| Target | What lands there | Reversible how |
|---|---|---|
| **Spec-file templates** under `_bmad/devx/templates/` | Section-ordering tweaks, standard checklist items the agent forgot last time. | `git revert` the lesson commit. |
| **`devx.config.yaml`** | Tunable defaults: coverage percent, capacity cap, poll intervals, preferred deploy region. | Edit the yaml directly. |
| **Project memory** (`/Users/<you>/.claude/projects/<proj>/memory/`) | Facts about this project's preferences — "prefer MySQL for new services", "deploy region is us-east-1", "empty states use the palateful illustration set". | Remove or edit the memory file. |
| **`CLAUDE.md`** (repo-level) | Project-wide rules an agent must follow: tech stack invariants, naming conventions, "never commit to main directly", pre-push checklists. | PR-reviewable edit. |
| **Skill files** (`~/.claude/commands/devx-*.md`) | Improvements to a slash command's workflow: "always grep for existing migration before writing a new one". High blast — gates enforce review. | PR-reviewable edit + skill-change log. |
| **Agent system prompts** (per-role prompt templates under `skills/`) | Changes to the PlanAgent / DevAgent / TestAgent prompt itself. Highest blast — any change affects every future invocation of that agent class. Heaviest gates. | PR-reviewable edit + skill-change log + canary run. |

Every write target has a **reversibility story** and a **review gate** proportional to its blast radius.

---

## Trigger signals

LearnAgent watches seven event classes. Each is detected by grepping the filesystem + `git log`; no external telemetry required.

### S1. Blocker resolved

A spec file's status log contains:

```
[2026-04-23T14:28] blocked — see INTERVIEW.md q#4
[2026-04-23T15:10] unblocked — user answered: (c) make configurable
```

→ **Lesson candidate:** next time a similar item comes up, don't ask; default to (c).
→ **Likely target:** project memory ("for OAuth redirect URIs, default to configurable setting").

### S2. Repeated CI failure on the same root cause

`git log origin/develop` shows two-plus commits with `fix:` prefix citing the same error class (e.g., "missing GOOGLE_OAUTH_CLIENT_SECRET", "forgot migration for new model", "pubspec version not bumped").

→ **Lesson candidate:** preflight check before push — the thing that keeps getting forgotten.
→ **Likely target:** `CLAUDE.md` checklist, or a step in the `devx.md` skill's Phase 4 (Local CI Validation).

### S3. User edit after agent write

`git log` shows an agent commit (`devx-mobile:`, `Co-Authored-By: Claude`) followed by a human commit touching the same file within 24h.

→ **Lesson candidate:** the agent's default was wrong; the user's edit is the preferred shape.
→ **Likely target:** project memory, or the spec-file template if the edit was structural.

### S4. INTERVIEW question answered the same way 3+ times

`INTERVIEW.md` history in `git log` shows Q about "deploy region" answered `us-east-1` three times.

→ **Lesson candidate:** stop asking; make it a default.
→ **Likely target:** `devx.config.yaml` (infrastructure section).

### S5. Skill correction by the user

User manually edits `~/.claude/commands/devx-*.md`. A `pre-commit` hook in the devx repo logs every such edit to `.devx-cache/skill-edits.jsonl`.

→ **Lesson candidate:** propagate the correction to related skills if similar logic appears elsewhere (consistency).
→ **Likely target:** sibling skill files.

### S6. PR review surfaces the same issue repeatedly

Code review findings on merged PRs are logged (BMAD's `code-review` workflow already produces these). Grep across the last N reviews for repeated findings categories.

→ **Lesson candidate:** add to a pre-review checklist so the agent catches it before review.
→ **Likely target:** `devx.md` skill Phase 3 (Code Review), or `CLAUDE.md`.

### S7. Flaky test or debug pattern

A `DEBUG.md` item resolved with "flaky test, retried and passed" three times → either the test is genuinely flaky (fix it), or the retry is load-bearing (document it).

→ **Lesson candidate:** flag the test; or codify the retry.
→ **Likely target:** `TEST.md` for explicit remediation work; or the skill's retry step.

---

## LearnAgent — the writer

`/devx-learn` is the slash command. LearnAgent can be invoked:

- **Manually** by the user, after a meaningful chunk of work ("hey, go digest what we just did").
- **On a schedule** via `/loop 24h /devx-learn` — nightly digest.
- **By TriageAgent** when it detects N accumulated trigger signals and capacity is free.
- **After a completed promotion** (`develop → main`) — high-signal moment, freshly-closed items to learn from.

### Loop

1. **Scan** every trigger source for candidate signals since the last LearnAgent run (stored in `.devx-cache/learn-cursor.json`).
2. **Cluster** signals by underlying cause. Three "forgot the migration" signals → one lesson, not three.
3. **Draft a lesson** per cluster: the extracted rule, the write target, the proposed edit (unified diff), and confidence (`high` / `medium` / `low`).
4. **Gate by confidence** (see next section) — high-confidence + low-blast autoapplies; everything else queues.
5. **Write to `LESSONS.md`** — the backlog file for pending lessons awaiting user review.
6. **Apply auto-promoted lessons** by making the edit on `develop` in a `develop/learn-<hash>` branch, PR'd to `develop` with the trigger-signal evidence in the PR description.
7. **Update the cursor.**

---

## Confidence and gates

LearnAgent never auto-edits agent system prompts. It never auto-edits `CLAUDE.md` without a PR. The gates are proportional to blast radius:

| Confidence | Target | Behavior |
|---|---|---|
| High | Spec-file template | Auto-apply, PR to `develop`, auto-merge after CI. |
| High | `devx.config.yaml` | Auto-apply, PR to `develop`, auto-merge after CI. |
| High | Project memory | Auto-apply directly (it's your personal memory, not the repo). |
| Medium — any target | Any | Write to `LESSONS.md`, PR opened but not auto-merged. User approves. |
| High | `CLAUDE.md` | PR opened, auto-merge after CI + 24h soak (so you can veto). |
| High | Skill file | PR opened, **never auto-merge**, requires explicit user approval. |
| High | Agent system prompt | PR opened, **never auto-merge**, requires user approval + canary run (see §Canary below). |

Confidence is computed from signal count + signal strength + prior-lesson overlap:

- **High:** ≥3 concordant signals, no contradicting signals, no prior lesson covers this.
- **Medium:** 2 signals, or 3+ with one contradiction.
- **Low:** 1 signal, or ambiguous clustering. Default to queueing for user review.

---

## `LESSONS.md` — the new backlog file

Eighth file at the repo root. Same shape as the others.

```markdown
- [ ] `learn/learn-b8c4e2-2026-04-23T18:00-oauth-redirect-uri-default.md`
  - Rule: default OAuth redirect URI strategy to "configurable" for new integrations.
  - Target: project memory (feedback type)
  - Confidence: high (3 signals: q#4 on dev-a3f2b9, q#11 on dev-e1c7d1, q#19 on dev-f2b9d0 — all answered "(c) make configurable")
  - Proposed edit: new memory file `feedback_oauth_redirect.md`
  - Status: auto-applied 2026-04-23T18:05 (high confidence, personal memory target)
```

Each entry points at a `learn/learn-<hash>-<ts>-<slug>.md` spec file with the full evidence (quoted status-log lines, git refs, the proposed diff).

### Who writes

- LearnAgent (primary).
- User can add hand-crafted lessons: "I want you to stop asking about deploy region" → `/devx-learn --add "default deploy region us-east-1"` → writes the lesson directly.

### Who reads

- TriageAgent — when deciding capacity, it checks if there's a pending high-value lesson to apply.
- The user — reviews and approves medium/low-confidence lessons.

---

## Canary runs (for agent prompt changes)

Editing an agent's system prompt is the heaviest change. LearnAgent gates these with a canary:

1. Lesson proposes a system prompt change for DevAgent.
2. LearnAgent creates a branch `develop/learn-<hash>` with the proposed prompt edit.
3. Next 3 DevAgent invocations run on the new prompt (picked up from the branch) **in parallel with a shadow run** on the current prompt. Both sets of PRs open; human compares.
4. If the new prompt performs equal-or-better on objective metrics (CI pass rate, coverage delta, review findings per PR), LearnAgent recommends merge. User approves.
5. If worse, LearnAgent closes the PR and archives the lesson as `status: rejected`.

Canary comparison is cheap because we have the evidence — PR outcomes, CI green rates, review-finding counts — already logged per agent run.

---

## Provenance

Every learned change carries a trail:

```markdown
---
hash: b8c4e2
type: learn
created: 2026-04-23T18:00:00-07:00
target: project-memory
confidence: high
triggers:
  - dev/dev-a3f2b9.md#status-log-line-3
  - dev/dev-e1c7d1.md#status-log-line-5
  - dev/dev-f2b9d0.md#status-log-line-4
proposed_edit: feedback_oauth_redirect.md (new file)
applied_commit: 8f2c9e1
applied_at: 2026-04-23T18:05:12-07:00
---
```

Given any surprising agent behavior after the fact, you can:

1. `git log --grep='devx-learn' --since='7 days ago'` — see every lesson applied recently.
2. For each, read the `triggers:` list — see the evidence that prompted it.
3. `git revert <applied_commit>` — roll back any lesson that turned out wrong.
4. `/devx-learn --reject <hash>` — mark the lesson rejected so it won't be re-proposed on the same signals.

---

## Anti-patterns (things self-healing must NOT do)

- **Don't learn from one example.** `confidence: low` stays queued for user review. The whole system breaks if a single weird incident mutates a shared skill.
- **Don't learn from the user changing their mind.** If user answered q#4 with (c) three times, then answered q#20 with (a), LearnAgent sees the contradiction and lowers confidence, doesn't silently flip.
- **Don't edit memories the user wrote by hand.** Personal memories flagged `source: user` are read-only to LearnAgent.
- **Don't drift from BMAD.** Skill edits that would break the contract with BMAD workflows (e.g., renaming a workflow the skill invokes) are rejected by a pre-merge check that parses the skill and verifies referenced workflow paths still exist.
- **Don't auto-apply during active agent runs.** LearnAgent always picks quiet moments (no DevAgent/DebugAgent/TestAgent active). Triage enforces this.
- **Don't accumulate silently.** If `LESSONS.md` grows past 20 pending items, `MANUAL.md` gets a "review lessons — backlog full" entry. Pressure on the user to review, so the loop doesn't stall.

---

## What this looks like in practice

### Example 1 — OAuth redirect URI

**Sequence:**
1. User builds 3 OAuth integrations across 2 months.
2. Each time, DevAgent filed an INTERVIEW question: "redirect URI on root domain or subdomain?"
3. Each time, user answered "(c) make it configurable."
4. Nightly `/devx-learn` runs, sees 3 concordant answers, clusters them into one lesson.
5. Writes a project memory: "For OAuth integrations, always default to a configurable redirect URI — the user has consistently chosen this over hardcoding either root or subdomain."
6. Fourth OAuth integration: DevAgent reads the memory, skips the INTERVIEW question, implements configurable from the start.

### Example 2 — migration checklist

**Sequence:**
1. DevAgent-7 pushes a branch touching `libraries/utils/utils/models/`. CI fails on `check-models` (model drift).
2. DevAgent-7 adds the migration, pushes again, green.
3. A week later, DevAgent-3 repeats the same mistake on a different model.
4. Repeat, a week after that, DevAgent-12.
5. `/devx-learn` sees three `fix:` commits citing `check-models`. High confidence.
6. Proposes a PR adding to `CLAUDE.md`: "When touching SQLAlchemy models under `libraries/utils/utils/models/`, always add a matching migration under `services/migrator/migrations/versions/` in the same commit."
7. User approves (single click). Merged to `develop`.
8. Next DevAgent reads updated `CLAUDE.md`, adds migration preemptively.

### Example 3 — prompt refinement via canary

**Sequence:**
1. `/devx-learn` observes that DevAgent's adversarial self-review catches MEDIUM issues reliably but misses LOW issues 40% of the time.
2. Proposes tightening the self-review step of the `devx.md` skill's Phase 3.
3. Opens a canary PR. Next 3 DevAgent runs execute under the new prompt; shadow runs execute under the old.
4. New prompt catches LOW issues 85% of the time, adds ~90s per run.
5. User reviews the canary report, approves. Skill updated.
6. Subsequent DevAgent runs benefit.

---

## Relationship to existing subsystems

- **Backlog files** — LearnAgent reads all seven existing backlogs plus their git history; writes only to `LESSONS.md`.
- **Worktrees** — LearnAgent operates in its own worktree on `develop/learn-<hash>` branches, same as any other agent.
- **TriageAgent** — schedules LearnAgent when capacity is idle and trigger signals have accumulated. Never preempts active work.
- **Mobile app** — `LESSONS.md` shows up in the Inbox tab. User can approve/reject lessons on the phone with the same inline-action pattern as INTERVIEW questions.
- **BMAD** — LearnAgent treats BMAD workflows as read-only. It can learn from workflow *outcomes* but won't edit `_bmad/` files. All learning lands in devx-owned files (skills, CLAUDE.md, config, memory).
