# How to use devx

The plain-language operator's manual. Everything else in `docs/` explains how
devx works inside; this explains what *you* type and what happens next.

---

## The mental model (30 seconds)

devx is a filesystem, not an app. Every unit of work is a markdown file:

- **Backlogs** are lists: `DEV.md` (features to build), `PLAN.md` (things to
  plan), `DEBUG.md` (bugs), `TEST.md` (test gaps). Plus two for you:
  `INTERVIEW.md` (decisions only you can make) and `MANUAL.md` (actions only
  you can take).
- **Specs** are the work items backlogs point at: `dev/dev-<hash>-….md`,
  `plan/…`, `debug/…`. Each has goals, acceptance criteria, and an
  append-only status log — the paper trail of who did what.
- **Workstreams** are where planning artifacts for big features live:
  `_devx/workstreams/<slug>/` holds `prd.md`, `design.md`, `plan.md`,
  `decisions/`, `evals/` for that one feature.
- **`LEARN.md`** is the system's memory: lessons from past work that future
  planning reads back.

Agents do the work in isolated git worktrees, open PRs, and (in YOLO mode)
merge them when CI is green. You steer; the files remember.

## The two commands

You only ever need two slash commands:

| Command | What it's for |
|---|---|
| `/devx` | "Do work." The universal dispatcher — routes anything you say to the right place. |
| `/devx-plan` | "Think first." Drives a big feature through PRD → Design → Plan → RED before any code. |

And one CLI question: **`devx next`** — "what should happen next?" computed
fresh from repo state. `/devx` with no arguments runs it for you.

## Daily driving

**Just say what you want to `/devx`.** It classifies your intent:

- `/devx` (nothing) → runs `devx next`, does the top thing. If an overnight
  loop ran, it reviews the morning report first.
- `/devx fix the login redirect, it 500s` → bug-shaped → files a debug spec,
  reproduces it *first* (failing test), then fixes through the normal loop.
- `/devx add a --json flag to devx status` → small clear feature → files a
  dev spec and executes it directly. No ceremony.
- `/devx build a customer billing portal` → big/vague → creates a workstream
  and hands off to `/devx-plan`.
- `/devx a1b2c3` → a spec hash → resumes that item wherever it left off.

The execute loop for any item is always the same: claim it on the backlog →
worktree → implement → adversarial self-review → local CI → PR (with a
review tour) → remote CI → merge → cleanup. You'll see the PR land; the spec
file's status log records every step.

## Starting something big (the planning pipeline)

For anything feature/epic-sized, `/devx-plan` walks four stages. Each stage
writes artifacts to `_devx/workstreams/<slug>/` and each gate is a mechanical
CLI check (`devx gate …`) — the agent can't hand-wave past it.

1. **PRD** — an interview with you. Produces `prd.md` (goals, use cases,
   requirements, all with stable IDs) and `expectations.md` (≥3 testable
   "when X, the system SHALL Y" blocks with priorities and thresholds).
2. **Design** — asks your design questions first, grounds itself in real
   code, writes `design.md` (the approach — explicitly *not* the task list).
   Gate 2 checks every PRD ID is covered by the design.
3. **Plan** — `plan.md`: phases sized so each lands as one reviewable PR.
   Gate 3 checks every expectation maps to a phase, every P0 to a runnable
   check.
4. **RED** — writes the P0 checks as *failing* tests and watches them fail
   for the right reason. If you didn't watch it fail, you don't know it
   tests the right thing. On pass, each plan phase becomes a dev spec on
   `DEV.md` — and `/devx` takes over.

Stage-skipping is legal and recorded: small clear work can enter at Plan or
go straight to execution. You don't pay ceremony you don't need.

**Changed your mind mid-flight?** `/devx revise <hash>` — amend the lowest
artifact the change touches; downstream gates reset automatically and force
the replay. You never hand-sync a stale plan.

## Overnight: `devx loop`

`devx loop` runs the backlog unattended: pick top ready item → full execute
loop → merge or cleanly park → next item. It has hard budgets (max items,
iterations, tokens), a 3-strikes abort, and it never deletes failed work —
abandoned worktrees are preserved for inspection.

**The morning report** (`.devx-cache/loop/<run-id>/report.md`) is its exit
summary: what it attempted, what merged (PR links), what it abandoned and
where the wreckage is, what's blocked on you, tokens spent. The first `/devx`
of your day reads it and re-verifies against disk — the report's claims are
claims, not verdicts.

## Reviewing what agents did

- `devx tour <hash>` — a guided review tour of a PR: ordered stops through
  the diff with the decision narrative, on the `devx-tours` branch.
- `devx status` — where everything is.
- `devx outcome <hash>` — weeks after shipping, score the feature against
  the numeric goals from its PRD: keep / tune / restart / retire.
- Retros write to `LEARN.md`, and future PRD stages read it back — the
  system gets less naive over time.

## Your two inboxes

Agents never make product decisions silently. When blocked they write to:

- **`INTERVIEW.md`** — questions needing a decision. Answer with
  `/devx-interview` or edit inline.
- **`MANUAL.md`** — things only a human can do (create an account, approve a
  vendor, plug in a phone).

Check these when a morning report says something is "blocked on human."

---

## Worked example: a website for your therapist friend

New project, real (small) stakes. Here's the whole lifecycle:

**1. Scaffold the repo onto the rails** (~2 minutes)

```sh
mkdir therapist-site && cd therapist-site && git init
devx init
```

`devx init` writes `devx.config.yaml`, the backlog files, engine templates,
and installs the slash commands. Set the axes in `devx.config.yaml` for this
kind of project: `mode: YOLO` while it's just you two, `shape: empty-dream`,
`thoroughness: send-it`. (When she starts sending clients to it, bump to
BETA — that one config line is what adds merge caution everywhere.)

**2. Plan it — because "a website" is vague** (~20 minutes of conversation)

```
/devx-plan Anna is a therapist who needs a simple site: about page,
specialties, contact form, booking link to her Calendly, calm aesthetic,
mobile-first. No CMS, no accounts, cheap hosting.
```

- **PRD stage** interviews you: Who visits? (prospective clients, often
  anxious, on phones.) What's success? (G-1: contact-form submissions
  actually reach Anna's email; G-2: loads < 2s on mobile.) What's out of
  scope? (blog, payments, client portal.) Expectations come out testable:
  *"When a visitor submits the contact form, the system SHALL deliver the
  message to Anna's inbox — threshold: 100% of test submissions."*
- **Design stage** asks the real questions — static site or framework?
  where's the form backend? — and writes down *why* (e.g. Astro + a form
  service, static hosting; no server to maintain for a therapist who will
  never open a terminal).
- **Plan stage** cuts phases ≈ PRs: ① scaffold + deploy pipeline (deploy
  first, so every later phase is visible at a URL), ② pages + layout +
  styling, ③ contact form wired end-to-end, ④ SEO/meta/analytics.
- **RED stage** writes the failing checks (form-delivery test, build check,
  Lighthouse budget) and emits four dev specs onto `DEV.md`.

**3. Build it**

```
/devx          # executes phase 1 … repeat, or:
devx loop --max-items 4     # let it run the whole backlog while you sleep
```

Each phase: worktree → implement → self-review → CI → PR → merge. Next
morning, read the report, click the preview URL, click through the tour.

**4. Feedback and fixes**

Anna says the green is wrong and the form doesn't say it sent:

```
/devx the submit button gives no confirmation after sending — bug
/devx swap the palette to sage green, she sent hex codes: …
```

Bug-shaped goes repro-first; the palette tweak is a small dev spec. Neither
needs planning ceremony.

**5. Close the loop**

A month later: `devx outcome <hash>` — did form submissions reach her?
Verdict `keep`. The retro's lesson ("form-service free tier silently
rate-limits") lands in `LEARN.md`, and your next friend's site budgets
for it at PRD time.

---

## Cheat sheet

| You want | Type |
|---|---|
| "Just do whatever's next" | `/devx` |
| Fix a bug | `/devx <describe the bug>` |
| Small feature | `/devx <describe it>` |
| Big/vague feature | `/devx-plan <describe it>` |
| Resume a specific item | `/devx <hash>` |
| Change a plan mid-flight | `/devx revise <hash>` |
| Run the backlog overnight | `devx loop` |
| What's the state of everything? | `devx status` / `devx next` |
| Review a PR properly | `devx tour <hash>` |
| Answer agent questions | `/devx-interview` |
| Did the thing we shipped work? | `devx outcome <hash>` |
