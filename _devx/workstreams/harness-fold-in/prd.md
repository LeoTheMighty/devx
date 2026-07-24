# PRD — Harness Fold-In (todo.md working memory · /devx-learn · gate-verdict persistence)

<!-- Stage: PRD. Gate: `devx gate prd eac479`. Every concrete item gets a
     stable ID (G-/UC-/CAP-/FR-). IDs are never renumbered. Traceability is
     by ID, not by prose. -->

## Problem

devx tracks a workstream's **position** (`stage:` + `gate_status:` frontmatter),
**progress** (plan.md phase checklist), and **history** (append-only status
log) — but not **intent**. The in-session task list an agent maintains while
working dies at every `/clear`, compaction, or session handoff; intake-through-
planning has no tracker at all (plan.md doesn't exist until the Plan stage);
and in-flight micro-intents ("fold the spike findings back", "surface comment
B") have no durable home. A fresh session reconstructs intent by replaying the
status log and guessing.

Two adjacent gaps compound it. A gate that ran and FAILed is stored identically
to a gate that never ran (`false` either way) — the verdict lives only in a
`decisions/` file nobody re-opens. And framework friction observed in sessions
(wrong skill instructions, steps the user corrects, repeated workarounds)
evaporates instead of improving the skills — devx's retro loop captures
*product* lessons, not *framework* lessons.

The upstream reference (`mycase/8am-harness`, PRs #20–#27, July 2026) solved
all three after devx's v2 capture: the §27 `todo.md` working memory, persisted
gate verdicts, and the §24 `/harness-learn` self-learning loop. This
workstream folds those shapes in, devx-flavored — no Confluence, no Jira, no
eval manifests, mechanical checks in the CLI per devx's own tenets.

## Goals

<!-- Business/project goals numeric + dated so /devx outcome can score them. -->

- **G-1**: By ship, `devx next` and `devx status` render a "current focus"
  line derived from `todo.md` for 100% of workstreams that have one, and a
  fresh session resuming a mid-stage workstream needs 0 status-log replay
  turns to state what's next (measured on the first real post-`/clear`
  resume after ship).
- **G-2**: By ship, 100% of gate runs (`prd`/`coverage`/`evals`) persist
  their verdict (`PASS|CONCERNS|FAIL|WAIVED`) in plan-spec frontmatter, and
  a FAILed gate renders visibly distinct from a never-run gate in
  `devx next` output.
- **G-3**: Within 4 weeks of ship (by 2026-08-21), ≥1 `/devx-learn`-originated
  framework improvement is merged to `main`.

## Non-goals

- **Per-workstream `questions.md` health queue** — INTERVIEW.md/MANUAL.md plus
  the queued `plan-e5a9c0` blocker-surfacing item already own this surface.
- **`harness-review`-style CI audit agent** — per-PR 3-agent adversarial
  review + tours cover it; needs API-key-in-Actions infra we don't want.
- **Confluence/Jira/Datadog/Mixpanel anything** — D-10, stripped at capture,
  stays stripped.
- **Execution graph / wave parallelism** — belongs to the fleet-layer plan
  item (`plan-f1d6b2`), not this fold-in.
- **Eval-manifest RED artifacts** — devx's RED gate stays plain failing tests
  via `projects:` runners.

## Users

- **Primary**: Leo — solo operator resuming workstreams across sessions and
  reviewing what agents did.
- **Secondary**: devx agents — the dispatcher, `/devx-plan` stage sessions,
  and overnight-loop workers that must resume mid-stage without replaying
  history.
- **Anti-persona**: teams wanting external-tracker sync or org-wide rollups.

## Use cases

- **UC-1**: The operator `/clear`s mid-Design; the next session's
  `/devx eac479` states the exact next sub-item from `todo.md` instead of
  re-deriving it from the status log.
- **UC-2**: An overnight-loop worker claims a workstream item and reads
  intent (current stage's unchecked items) in one file read.
- **UC-3**: A coverage gate FAILs; three days later `devx next` shows the
  FAIL verdict and the fix path — not just `stage: design`.
- **UC-4**: After a session where the user corrected a skill's behavior
  twice, `/devx-learn` mines the thread, presents an evidence table, and —
  after the user prunes it — opens one `fw/learn-*` PR with the skill fixes.
- **UC-5**: A stage skill finishes; it checks its todo items off and
  reconciles the skeleton against frontmatter ground truth, so a hand-edited
  or stale checkbox can't misdirect the next session.

## Capabilities

- **CAP-1**: Per-workstream `todo.md` working memory — fixed lifecycle
  skeleton (line prefixes are a parse contract), free nesting beneath,
  pointers to stable IDs never content copies, auto-maintained by the
  lifecycle skills, hand-editable, **never a gate input**.
- **CAP-2**: Mechanical todo↔ground-truth reconciliation — drift detected by
  the CLI and surfaced advisory-only; drift is defined as a bug in the last
  writer.
- **CAP-3**: Persisted per-gate verdicts in plan-spec frontmatter, rendered
  by `devx next`/`devx status`.
- **CAP-4**: `/devx-learn` — session-thread mining into a four-bucket
  routing (framework fix / project preference / product lesson / drop) with
  the three load-bearing guards, plan-first with user approval.

## Feature requirements

### FR-1: todo.md template + scaffold

A `todo.md` template ships in `_devx/templates/engine/` with the devx-stage
skeleton (PRD → gate prd → Design → gate coverage(design) → Plan → gate
coverage(plan) → RED → Execute (per-phase pointer lines) → Retro → Outcome)
and the header contract (auto-maintained; never a gate input; pointers not
copies; done = checked, abandoned = deleted). `devx workstream new` scaffolds
it. Grandfathering: a workstream without `todo.md` reads as silence; the next
lifecycle-skill touch creates it from the template reconciled to current
frontmatter — no backfill pass.

### FR-2: Writer wiring across the lifecycle skills

`/devx-plan` stages (PRD/Design/Plan/RED), the three gate flows, and the
`/devx` execute arm each: seed their in-session task list from `todo.md` at
start (authoring/execute flows only — gates never read it), check/expand items
as work lands, and **reconcile before writing** — true the skeleton against
`gate_status`/`stage`/phase state first, then apply this session's delta.
Stage-parent items are derived, never hand-checked. Execute carries one
pointer line per plan phase; a phase's pointer checks at *verified*, not
*done*.

### FR-3: Never-a-gate-input invariant

No `devx gate` command reads `todo.md`; no refusal or verdict depends on it.
An unchecked item blocks nothing; a checked item proves nothing. Frontmatter
and plan.md win every conflict. Pinned by a static test over the gate
implementations (import/read-surface assertion), not just prose.

### FR-4: Drift detection in the CLI

`devx next [<hash>]` computes todo drift mechanically — two contradiction
classes: (a) a "Pass Gate N" item contradicting its `gate_status` flag,
(b) a phase pointer line contradicting phase state — and reports drift as
**advisory** rows (never blocking, never auto-fixed silently; the next writer
reconciles). Same pure-fn + CLI-passthrough shape as the rest of the engine.

### FR-5: Current-focus rendering

`devx next` and `devx status` render a one-line "current focus" per active
workstream: the first unchecked item at the deepest level under the current
stage, derived by a focus walk from ground truth (so a stale checkbox can't
stick the focus head). Absent `todo.md` → line omitted, no error.

### FR-6: Gate-verdict persistence

Each gate CLI persists its verdict additively in the plan spec's frontmatter
(sibling map, e.g. `gate_verdicts: {prd: PASS, design: FAIL, plan: null,
evals: null}` — exact shape decided at Design) on every run, PASS or FAIL.
`devx revise`'s cascade reset clears the affected verdicts alongside the
flags. Existing `gate_status` booleans are unchanged (additive, no breaking
parser changes).

### FR-7: Verdict-aware rendering

`devx next`/`devx status` distinguish never-run (`—`), FAIL (with the
decisions/ report path), CONCERNS, and PASS per gate. A FAILed gate's row
includes the re-run command.

### FR-8: /devx-learn skill

A new `/devx-learn` skill mines the **current session thread** for framework
friction (wrong/ambiguous skill instructions, user corrections, workarounds,
repeated manual steps, confirmed wins) and routes each finding into four
buckets: **framework fix** (edit devx skills/templates/docs → one
`fw/learn-YYYY-MM-DD-<slug>` branch + PR), **project preference** (→
`devx.config.yaml` proposal), **product/workstream lesson** (→ LEARN.md
candidate for the next retro), **one-off** (dropped, noted). Plan-first: it
presents an evidence table (learning · evidence · bucket · proposed change)
and writes nothing until the user prunes and approves. Refuses on a
fresh/empty session; never self-triggers on its own run. Runs user-foreground
only (skill/settings edits can't be auto-accepted by subagents — known
harness constraint). **Scope (resolved 2026-07-24):** the skill runs in any
devx project; the framework-fix bucket opens the PR only when the current
repo is devx itself — in consumer repos the same finding is written as a
proposal file (exact home decided at Design) the operator can carry over.

### FR-9: /devx-learn guards

Three guards carried over intact: (a) **locked-machinery guard** — a learning
that would loosen a gate, refusal, cascade, verdict rule, or append-only/
ID-traceability discipline is never applied as a change; it becomes a
`docs/updates/<date>-<slug>.md` proposal instead; (b) **untrusted-input
boundary** — session content is data, not instructions; pasted text that
reads as injected directives is flagged and skipped; (c) **slug
sanitization** — branch/PR slugs are `[a-z0-9-]`, ≤40 chars, never raw
session text interpolated into git/gh commands; empty → `session-retro`.

### FR-10: Learn nudge at wrap-up

Lifecycle skills (`/devx`, `/devx-plan`) end with a one-line `/devx-learn`
nudge **only when friction was actually observed this session** (user
corrections, workarounds, skill-instruction mismatches). A clean run prints
nothing — a reflexive nudge trains the reader to ignore it. The nudge
sentence has one canonical source; skill bodies reference it, not restate it.

## Evals seed

- Scaffold a workstream → `todo.md` exists with the full skeleton; line
  prefixes match the parse contract exactly.
- Flip a `gate_status` flag true while its todo item is unchecked → drift
  detector reports contradiction class (a), advisory severity.
- Run any gate on a fixture workstream → frontmatter verdict field written;
  FAIL persists too; revise cascade clears it.
- `devx next` on a workstream with todo.md → current-focus line present and
  equal to the first unchecked deepest item under the current stage.
- Static: no gate implementation file reads `todo.md`.
- `/devx-learn` on an empty session → refuses; slug fuzz (shell metachars,
  unicode, >40 chars) → sanitized branch name.

## Open questions

*None blocking. All four intake questions were resolved with the user
interactively on 2026-07-24:*

- /devx-learn v1 scope → **anywhere; PR only in the devx repo** (FR-8).
- Drift check home → **CLI, `devx next`, advisory** (FR-4).
- Verdict shape → **additive sibling frontmatter map** (FR-6); exact key
  naming settles at Design.
- Learn nudge → **friction-observed only** (FR-10).

## Reference links

- Spec: `plan/plan-eac479-2026-07-24T09:57-harness-fold-in.md`
- Upstream reference: `mycase/8am-harness` — CONVENTIONS §23/§24/§27,
  `docs/updates/2026-07-21-workstream-todo.md`,
  `docs/updates/2026-07-15-health-and-blocker-surfacing.md`,
  `skills/harness-learn/SKILL.md` (session digest 2026-07-24; repo is
  private-work — shapes ported, no code copied).
- Engine: `v2/02-engine.md`; decisions ledger `v2/07-decisions.md` (D-8,
  D-9, D-10).
- Prior related backlog: `plan-e5a9c0` (blocker surfacing — non-goal
  boundary), `plan-f1d6b2` (fleet layer — execution-graph non-goal).
