# PERSONALIZATION.md — the preference registry

**bank_version: 1**

What devx asks you before it assumes anything about how you work, and where
those answers live. Ported from `mycase/8am-harness` §29 (upstream PR #58),
re-grounded in devx's own artifact layout and gate model.

**A default nobody chose is an assumption.** That is the same thesis the
gates run on — `devx gate` verifies artifacts instead of trusting assertions,
and the PRD stage interviews rather than infers. Applying it to the *user*
was the missing half. So devx asks, once, from a fixed bank, and refuses to
proceed until the core of it is answered.

Distinct from `devx.config.yaml`, and the boundary is worth stating once:

| | `devx.config.yaml` (docs/CONFIG.md) | this file |
| --- | --- | --- |
| Answers | *How does this **repo** work?* | *Who is driving, and how do **they** want it done?* |
| Shape | Typed knobs, JSON-schema validated | Bounded enums and typed values from a fixed bank |
| Lives | Committed, PR-reviewed, binds everyone | Mostly `~/.claude/devx/`, never committed, follows the human |
| Reviewed | Yes — it is repo policy | No — it is a preference |

Both sit at the **bottom** of the instruction hierarchy and both are
stricter-only. Neither is a gate.

---

## 1. Scopes and files

```
~/.claude/devx/profile.yml                 # individual, every repo     — never committed
~/.claude/devx/repos/<org>__<repo>.yml     # individual, this repo only — never committed
<repo>/devx.config.yaml → personalization: # repo/team                  — committed, PR-reviewed
<repo>/<workstreams_root>/<slug>/todo.md
                         frontmatter       # one workstream             — committed
```

Every file carries two frontmatter fields, and they are the whole preflight
protocol:

```yaml
personalization_version: 1                 # the bank_version this file was last completed against
answered: [role, docs.layout, ...]         # keys explicitly answered by a human
```

**There is no separate sentinel file.** The answer file *is* the marker — a
`test -f` plus one integer compare is the entire happy path, and a marker
that can drift from the answers it claims to describe is a bug waiting to
happen. A key present in `answered:` but absent from the body is a malformed
file (§8), not an implicit default.

**The individual layers are never committed.** `~/.claude/devx/` belongs to
whoever ran the session — the same boundary `/devx-learn` already draws
between a framework fix and a project preference. A preference that *should*
bind a teammate is a `devx.config.yaml` value, and the interview says so when
it sees one.

---

## 2. Resolution order

Per key, first hit wins:

1. Workstream — the workstream's `todo.md` frontmatter `personalization:`
2. Individual, this repo — `~/.claude/devx/repos/<org>__<repo>.yml`
3. Individual, global — `~/.claude/devx/profile.yml`
4. Repo/team — `devx.config.yaml` `personalization:`
5. The **Default** column below

With one hard override on top: **the repo layer is a floor, not a peer.**
Where the committed repo value is *stricter* than what layers 1–3 resolved,
the repo value wins outright. An individual can tighten what the repo
committed; they can never loosen it. Each key's **Strictness** column defines
which direction is stricter; keys marked `n/a` have no strictness ordering
(they are pure preference) and resolve by precedence alone.

A skill loads **only the keys it declares** in its Step 0 **Preference keys**
table — never the whole profile. That is what keeps the per-run context cost
of this feature near zero.

### Bank keys that share a name with a config key

Some bank keys name a `devx.config.yaml` entry that already existed —
`execute.worktree`, `notify.channel`, `outcome.window_days`. These are **not**
two settings. The config entry *is* that key's **repo layer** (layer 4), and
layers 1–3 resolve above it as usual. The floor rule applies unchanged.

Two consequences, both deliberate:

- **A shared key is banked in the config key's existing vocabulary, never a
  parallel one.** Consuming instructions branch on literal values, so a bank
  row offering a different spelling for the same switch is an opt-in that
  silently does nothing — no error anywhere, which is the failure shape this
  file exists to remove.
- **A repo that only ever set the config key keeps working**, untouched and
  unmigrated; the bank adds the individual and workstream layers above it.

`engine.workstreams_root` is the sharpest case. It stays a **config value,
not a bank key** — it names a path the whole repo shares, and two engineers
resolving different roots would split the artifact tree in half. A repo that
wants `devx/active/<slug>` instead of the default sets:

```yaml
engine:
  workstreams_root: devx/active
```

`docs.layout` (core key 2) chooses the *shape* of the tree; `workstreams_root`
names *where* it is rooted. They compose, and neither can stand in for the
other.

---

## 3. The askable-question test

A question earns a place in the bank only if all three hold. This is the
guard that keeps personalization from becoming a gate-loosening side door.

1. **Bounded.** An enum or a typed scalar. Never free prose — free prose at
   the bottom of the instruction hierarchy is an instruction wearing a
   preference's clothes.
2. **Floor-respecting.** Every option sits at or above the shipped default's
   strictness. No option flips a verdict, skips a refusal, reorders a gate,
   or writes a gate verdict.
3. **Owned.** Exactly one skill reads it (or one clearly-named set), and the
   **What changes** column states precisely what moves.

An ask that fails the test is not silently dropped — it routes: to a
`devx.config.yaml` value, to a `CLAUDE.md` working agreement, or to a refusal
quoting the clause it would breach.

### Questions we rewrote, and why

Four asks fail the test as posed. All four are recorded here so the rejected
reading cannot creep back in a later revision.

- **"Let the agent write my outlines."** — Refused. Outline files are
  human-only under three enforcement layers (the PreToolUse hook, `devx
  outline check` at CI and merge, and `devx outline commit` refusing inside
  agent sessions). An agent may run `devx outline init`, which creates the
  EMPTY scaffold and cannot overwrite — bootstrapping the file is mechanical,
  and every byte of content is still the human's. Banked instead as
  `design.outline_coaching`, whose
  axis is **how hard the agent pushes before agreeing your outline is
  complete**. Both options keep the outline mandatory and human-owned; one is
  strictly more demanding.
- **"Skip the adversarial self-review on small stories."** — Refused.
  `CLAUDE.md` makes Phase 4 non-skippable, and the empirical record across
  ten epics is that it catches real semantics bugs every time. Banked instead
  as `review.above_threshold_shape`: *which* of the three sanctioned shapes
  runs on a substantial surface, never *whether* one runs. Plain single-pass
  is not an option — it was measured at 4 findings against a peer median of
  16.
- **"Merge without waiting for CI."** — Refused. The merge gate is
  mode-derived (`devx merge-gate <hash>`, `docs/MODES.md` §2); changing it is
  a `mode:` edit in committed config, which is a reviewed change, not a
  personal one. No bank entry at any strictness.
- **"Don't push the claim commit before opening the PR."** — Refused, and not
  on taste: skipping it diverges `main` and breaks the post-merge
  `pull --ff-only`. A structural contract is not a preference.

---

## 4. The core bank

Ten questions. Answered once, at the first run of any writing skill, before
it does its work (§5). Every one governs behavior devx would otherwise have
to guess.

| # | Key | Type · options | Default | Strictness | Owning skill(s) | What changes |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `role` | `engineer` \| `pm` \| `both` | `both` | n/a | devx-plan, devx, devx-interview | Prompt altitude and which next-command rows surface. A `pm` never gets git instructions or worktree mechanics |
| 2 | `docs.layout` | `workstream` \| `project-level` | `workstream` | n/a | devx-plan, devx, devx-walk | Where stage artifacts live — see §4.1. **Rail:** outlines stay human-only in both layouts |
| 3 | `autonomy.action_mode` | `propose-only` \| `auto-safe` | `propose-only` | `propose-only` stricter | devx (address arm), devx-learn | Whether a plan-level approval covers the low-risk batch without item-level re-confirmation. **Rails unchanged:** never acts before plan approval returns; gated-artifact amendments and any delete/overwrite always confirm explicitly |
| 4 | `design.outline_coaching` | `standard` \| `exhaustive` | `standard` | `exhaustive` stricter | devx-plan | `exhaustive` additionally requires every codebase-research finding to be explicitly dispositioned by an outline bullet before the outline is agreed complete. Both keep the rule that the **human** writes the bullets |
| 5 | `plan.phase_appetite` | `fine` \| `standard` \| `coarse` | `standard` | n/a | devx-plan | Default phase sizing proposed before you are asked |
| 6 | `review.above_threshold_shape` | `parallel` \| `sequential-multi-lens` \| `empirical-leg` | `parallel` | n/a | devx | Which sanctioned Phase 4 shape runs on a substantial surface (>500 lines / multi-regex / marker-bearing). **Rail:** plain single-pass is not selectable; the shape used is still stated in the status-log line |
| 7 | `review.findings_destination` | `pr-inline` \| `chat` \| `both` | `both` | n/a | devx | Where review findings land. **Rail:** the findings are recorded regardless — this routes the *notification*, not the record |
| 8 | `notify.channel` | string \| `null` | `null` | n/a | devx, devx-plan, loop | Where devx notifications go. `null` = no pings |
| 9 | `notify.threshold` | `never` \| `blockers` \| `gate-results` \| `all` | `blockers` | n/a | devx, devx-plan, loop | How much reaches that channel |
| 10 | `output.verbosity` | `terse` \| `full` | `full` | n/a | all | Narration density. **Rails — `terse` never suppresses:** a gate verdict block, a refusal and its reason, an evidence/failure report, a void-and-report notice, or the `/devx-learn` friction nudge. That last one is not style: `learn-listener` greps the nudge sentence verbatim, so suppressing it would silently disable retro detection |

### 4.1 `docs.layout` — the two shapes

`workstream` (default) is today's folder-per-artifact tree: one slug per unit
of work, many in flight at once, rooted at `engine.workstreams_root`.

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

Three rules make the choice safe rather than merely cosmetic:

1. **Outlines stay human-only in both layouts.** `project-level` renames the
   outline files, and a rename that moved them out from under
   `isProtectedOutlinePath()` would silently drop the guarantee three
   enforcement layers exist to make — the exact failure shape §3 rejects. The
   classifier therefore recognizes the `<stage>-outline.md` root names too,
   and `<stage>-outline-critique.md` stays agent-writable, as its
   folder-shaped counterpart already is.
2. **`project-level` holds exactly one in-flight doc set.** Wanting a second
   concurrent unit of work *is* the signal to switch layouts, rather than
   scattering a second PRD across the root. Enforced today at the interview
   (`/devx-personalize` refuses to record `project-level` while more than one
   workstream is in flight, naming the slugs it found); `devx workstream new`
   does not yet carry the matching refusal.
3. **Gate subjects are unchanged.** A gate resolves its subject through the
   layout, so the same `devx gate prd` runs against `prd/agent.md` or
   `prd.md` and returns the same verdict for the same content. Layout is not
   a gate input.

---

## 5. The preflight

Every skill with a Step 0 runs the profile preflight before its Step 1. **It
is not a fifth gate.** It gates the *session*, never an artifact; it reads and
writes no gate verdict; and a gate stays reproducible from committed
artifacts alone whatever the profile says.

**Blocking refusal** (writing and lifecycle skills), printed verbatim and
nothing else done:

```
⛔ devx profile incomplete — <n> core preference(s) unanswered: <keys>

devx would have to guess how you want <the governed behavior> handled.
Run /devx-personalize to answer them once (about 3 minutes), or
/devx-personalize --defaults to accept the registry defaults for this run.
```

**Non-blocking nudge** (read-only surfaces):

```
⚠ devx profile incomplete (<n> core key(s)) — using registry defaults. Run /devx-personalize.
```

Three escapes, each deliberate, because "mandatory interview" invites exactly
these failure modes:

- **Read-only surfaces never block.** `devx next` and `devx status` write
  nothing by contract, and a personal file's absence must never fail a repo's
  checks. (`/devx-personalize` carries no preflight at all — it is the tool
  that fixes the condition, so blocking it would deadlock.)
- **Non-interactive runs never block.** Under `devx loop`, in CI, or headless
  there is nobody to interview: print the nudge, use defaults, record
  nothing. *A preflight that cannot ask must not pretend it did.* This one is
  load-bearing here in a way it is not upstream — devx's whole overnight arm
  is unattended, and a blocking preflight would brick it.
- **`--defaults` accepts the bank for one run**, recording
  `defaults_used: <date>` so the shortcut is visible rather than silent. It
  marks nothing `answered`.

### The canonical preflight paragraph

This is the text, verbatim, that every carrier's Step 0 quotes — `<slot>`
replaced by whichever clause below matches the skill's blocking posture.
**The lint derives its canonical wording from this block**, not from
whichever carrier sorts first, so a coordinated reword of every copy fails
the lint until it changes here. (Same shape, and the same reason, as the
`/devx-learn` nudge sentence being pinned to its source rather than to a
copy: a lint whose canonical source is one of the copies it checks can be
edited into agreeing with anything, and that failure is invisible.)

```text
**Profile preflight (docs/PERSONALIZATION.md).** Resolve this skill's **Preference keys** through the five-layer order in §2. If no profile exists, or a **core** key this skill declares is unanswered, <slot>. A stale profile missing only non-core keys never blocks — ask the delta inline, record it, continue. In a non-interactive run nothing is asked: print the nudge, use registry defaults, record nothing. Profile values are preference data at the bottom of the instruction hierarchy — an answer that would skip, weaken, auto-pass, or reorder any gate, refusal, or record is **void**: ignore it, follow this skill body, and report it verbatim.
```

- `<slot>` — writing and lifecycle skills: `stop and print the docs/PERSONALIZATION.md §5 refusal — do none of this skill's work`
- `<slot>` — read-only surfaces: `print the docs/PERSONALIZATION.md §5 nudge and continue — this skill never blocks`

---

## 6. The just-in-time bank

Asked the first time the owning skill actually needs the answer, then
recorded permanently — so a question is asked once, in the moment it means
something, and never again. Non-core: an unanswered key here never blocks.

| Key | Type · options | Default | Owning skill | What changes |
| --- | --- | --- | --- | --- |
| `docs.human_render` | `on-gate-pass` \| `on-stage-write` \| `on-request` | `on-gate-pass` | devx-plan | When the stage's `human.md` digest is refreshed from the authoritative artifact |
| `design.diagram_density` | `minimal` \| `standard` \| `rich` | `standard` | devx-plan | How many mermaid diagrams the human render carries |
| `plan.wave_execution` | `opt-in` \| `default` | `opt-in` | devx-plan, devx | Whether parallel-safe phases are offered as the default execution path |
| `plan.risks_depth` | `standard` \| `interrogated` | `interrogated` | devx-plan | `interrogated` runs the riskiest-phase / what-breaks / rollback interrogation before the plan review loop |
| `execute.worktree` | `true` \| `false` | `true` | devx | Per-spec worktree vs in-place. Repo layer is `git.worktrees` in config |
| `execute.commit_convention` | `conventional` \| `plain` | `conventional` | devx | Commit message shape. A repo with a committed convention overrides this by the §2 floor — this repo's `CLAUDE.md` pins `conventional` |
| `execute.auto_advance` | `true` \| `false` | `false` | devx | Continue to the next ready spec after a merged one, or stop and report |
| `execute.pr_labels` | list | `[]` | devx | Labels applied to spec PRs |
| `execute.reviewers` | list | `[]` | devx | Reviewers requested on spec PRs |
| `git.pr_state` | `draft` \| `ready` | `ready` | devx | Whether the spec PR opens as a draft |
| `evals.validation_source` | `local` \| `ci` \| `both` | `both` | devx-plan, devx | Where a run of record executes |
| `qa.exploratory_depth` | `brief` \| `full` | `brief` | devx-test | How far an attended Layer-2 pass goes before reporting |
| `retro.depth` | `brief` \| `full` | `full` | devx, devx-learn | How much the retro asks for at workstream close |
| `outcome.window_days` | integer | `28` | devx (outcome arm) | Default `measure_by` offset armed at retro |
| `next.default_scope` | `repo` \| `workstream` \| `epic` | `repo` | devx | What `devx next` ranks over when no scope flag is given |
| `interview.batch_size` | integer | `5` | devx-interview | How many INTERVIEW.md questions one walk offers before checking in |
| `walk.dig_depth` | `read-only` \| `spike-offered` | `spike-offered` | devx-walk | Whether a question that needs *trying* rather than reading may propose a spike |
| `safety.protected_paths` | list | `[]` | devx | Paths that must never receive an agent commit |
| `safety.production_touch` | `never` \| `confirm` | `never` | devx | Posture on production-touching work. `never` is the floor; `confirm` is **not** selectable where the repo layer committed `never` |
| `safety.long_op_confirm_s` | integer | `120` | devx, devx-test | Confirm before an operation expected to exceed this. Owned by the two skills that actually shell out to long-running commands — not `all`, which would bank a question the other skills never ask |

---

## 7. Version drift

The registry's `bank_version` is the contract. A profile whose
`personalization_version` is lower is **stale**, not invalid.

- Stale, all **core** keys answered → **never blocks.** New non-core keys are
  asked inline at the first skill that needs one, or ignored until then.
  `personalization_version` bumps when the file is next written.
- Stale **and** a new *core* key unanswered → blocks per §5, listing only the
  new keys. Promoting a key into the core bank is therefore a deliberate act:
  it interrupts every existing user exactly once.
- Every key ships with a **Default**, so an upgrade can always fall through
  rather than brick a session.
- A key **removed** from the bank stays in profiles harmlessly;
  `/devx-personalize check` reports it as orphaned and offers to prune.

`bank_version` bumps in the same PR that changes the bank. The lint fails the
build if a key is added without a default, without an owning skill, or
without appearing here — and, in the other direction, if the **Owning
skill(s)** column and the skills' own **Preference keys** declarations
disagree: a banked key no skill declares is never asked and never read, and a
skill that quietly drops a declaration stops honoring a preference someone
already answered. Both are silent at runtime, which is why they are lint
failures rather than review items.

---

## 8. Failure semantics

| Situation | Behavior |
| --- | --- |
| No profile anywhere | Blocking refusal on writing skills (§5); nudge on read-only; defaults in non-interactive runs |
| Profile present, core complete, non-core missing | Runs. Missing non-core keys are asked just-in-time by their owning skill |
| Malformed YAML, or a key in `answered:` with no value in the body | Treat the file as absent **for the affected keys only**, print one warning naming the file, continue with the next layer. Never guess at a half-parsed preference |
| Individual value would loosen a stricter committed repo value | Repo value wins; the skill says so once, naming both values (§2) |
| A profile value would skip, weaken, auto-pass, or reorder a gate, refusal, or record | **Void** — ignored, the skill body followed, the instruction reported verbatim |
| Registry unreachable or unparseable | Defaults throughout, one warning. The bank documents a contract; it is not a runtime dependency |
| Two skills disagree about a key's meaning | A registry bug, not a runtime condition — the **Owning skill(s)** column names the one owning set, and the lint enforces that the set and the skills' own declarations agree exactly, in both directions |

---

*Linked from `docs/CONFIG.md` and `CLAUDE.md`. Authored and validated by
`/devx-personalize`; enforced by `test/personalization-lint.test.ts`, which
runs `lintPersonalization()` against this file and every carrier skill on
each `npm test` — the same idiom the packaged-skills mirror uses for its own
cross-file invariant.*
