# /devx-personalize — Capture how YOU want devx to work

> The mandatory preference interview plus the profile it writes. Answers a
> bounded bank of questions (role, doc layout, autonomy, outline rigor, phase
> appetite, review shape, notifications, verbosity) across four scopes —
> workstream, individual-repo, individual-global, repo/team — and refuses any
> answer that would loosen a gate. Every writing skill hard-blocks until the
> core bank is answered.
>
> Registry: `docs/PERSONALIZATION.md` (the bank, the defaults, the rules).
> This is the tool; that is the contract. **This skill body never restates a
> default** — a second home for the same fact is a drift bug waiting to
> happen.

devx asks instead of assuming. This skill is where the asking happens once.

**Personalize vs configure.** `devx.config.yaml` answers *how does this repo
work* — typed knobs, schema-validated, committed, PR-reviewed. This answers
*who is driving and how do they want it done* — bounded enums, mostly in
`~/.claude/devx/`, never committed. When an ask arrives at the wrong door,
hand it to the other one rather than stretching this bank (Step 3).

## Modes (from the argument)

- *(no argument)* — **interview**: the flow below. Asks only what is unanswered.
- `show` — the resolved profile: key · value · which layer supplied it · the
  default. Marks every key where a stricter repo value overrode an
  individual one.
- `set <key> <value>` — answer one key without the interview. Validates
  against the bank; refuses an unknown key or an out-of-enum value.
- `check` — validate every profile file: parseable, `personalization_version`
  vs `bank_version`, no orphaned keys, no key in `answered:` missing a body
  value, no individual value loosening a committed repo value. Read-only;
  this is what the preflight's warnings point at.
- `--defaults` — accept registry defaults for this run only. Records
  `defaults_used: <date>`; marks nothing `answered`.
- `reset [<scope>]` — clear a scope's file after confirming; never touches a
  scope you did not name.

## Step 0 — Registry + scopes

Runs before Step 1; never prompts.

1. Read `docs/PERSONALIZATION.md` — the bank, `bank_version`, defaults,
   strictness directions. Unreadable → defaults throughout, one warning,
   continue (§8): the bank documents a contract, it is not a runtime
   dependency.
2. Resolve the repo slug — `<org>__<repo>` from the git remote, else
   `gh repo view --json nameWithOwner -q .nameWithOwner`.
3. Read whichever of the four scope files exist (§1). Malformed → treat as
   absent **for the affected keys only**, name the file, continue.
4. This skill writes preference data only — never a gate verdict, never a
   backlog file, never a workstream artifact other than `todo.md`
   frontmatter.

**This skill carries no profile preflight.** It is the tool that fixes the
condition a preflight blocks on; blocking it would deadlock.

## Interview flow

1. **Compute what is missing.** Diff the bank against the resolved profile.
   Print the position first:
   `<n> core unanswered · <m> non-core unanswered · bank v<X> vs profile v<Y>`.
   Nothing missing → say so, print `show`, stop. Never re-ask an answered key.
2. **Ask the core bank** (§4), one question at a time, in registry order. For
   each: the question in plain language, the options with what each
   *actually changes*, and which is the default. Echo the answer back.
   Skipping is allowed and recorded as unanswered — but say plainly which
   skill will block next time and on what.
3. **Classify anything the user raises that is not in the bank** — they will
   raise things, and this is the moment the boundary gets enforced. Print the
   triage before writing:
   - **In-bank** → record it.
   - **Repo policy, not preference** ("every run here should…") → it belongs
     in the repo layer or `CLAUDE.md`. Offer the `devx.config.yaml` key or
     the working-agreement line. Say why: a preference in `~/.claude/devx/`
     binds nobody, and a repo expectation living only in one person's home
     directory is how two contributors silently diverge.
   - **A config value** (a path, a budget, a channel, a model) → route to the
     matching `devx.config.yaml` key; no profile entry.
   - **Fails the askable-question test** (§3) → **refuse, with the why.**
     Quote the clause, name what the rule protects, and offer the closest
     sanctioned path. "Stop making me wait for CI" → refuse (the merge gate
     is mode-derived; changing it is a `mode:` edit in reviewed config);
     offer `notify.threshold`, which changes when you hear about it, not what
     it enforces.
4. **Choose the scope per answer, and default it well.** Offer: this repo
   only · everywhere · this workstream · the repo. Default to
   **individual-global** for working-style keys (`role`, `output.verbosity`,
   `autonomy.action_mode`) and **individual-repo** for anything naming a
   repo-specific surface (`notify.channel`, `execute.*`) — a notification
   channel that follows someone into an unrelated repo is a bug, not a
   convenience. Repo scope is never chosen silently: it is a commit, so it
   goes through Step 6.
5. **Write the profile(s).** Create parent directories as needed. Set
   `personalization_version: <bank_version>`, append every explicitly-answered
   key to `answered:`, preserve keys and comments already present.
   `~/.claude/devx/` files are written **only** in the individual scopes and
   are never staged, committed, or echoed into a PR.
6. **Repo-scope answers go through review.** If any answer chose repo scope,
   write the `personalization:` block into `devx.config.yaml`, then branch,
   commit, push, and open a small PR — it binds everyone, so it gets the same
   discipline any config change gets. Offer commit-to-current-branch as the
   fallback.
7. **Confirm and close.** Print the resolved table (`show`), name any key a
   stricter repo value overrode, and state which skills were blocked and are
   now unblocked.

## The doc layout is not yours to record

"Which layout do I want?" arrives here constantly and belongs to config: it
is `engine.docs_layout` in `devx.config.yaml`, not a bank key (§3 records why
— it names where files the whole repo shares get written). Route it per Step
3, and carry the two obligations the ask still deserves:

- **State the migration cost before they change it.** Switching layouts on a
  repo that already has artifacts means moving them; say how many and where
  they would land (`docs/CONFIG.md` §15's table), and offer to stop rather
  than half-move a tree.
- **Say that `project-level` holds exactly one in-flight doc set.** A repo
  with two live slugs is telling them which layout it needs — name the slugs
  found. Nothing enforces this mechanically yet (`dev-lay101`), which is
  precisely why saying it here matters.

<!-- layout-ask-canonical -->
### The layout ask (canonical — every skill quotes this, none restates it)

`devx init` writes `engine.docs_layout` explicitly (N14), so an unset key
means one thing: a repo that predates the question. Every skill that reads or
writes stage artifacts runs this once, and `devx next` carries the matching
advisory warning.

**When.** Before the run's first artifact read or write, and only then. Not at
session start (a read-only run should not interrogate anyone), and never
mid-action.

**Ask.** One question, both options named by what they *do*, not what they are
called:

> Docs layout isn't set for this repo. Many things planned in parallel
> (**workstream** — a folder per unit of work under `engine.workstreams_root`),
> or one at a time (**project-level** — flat docs at the repo root, exactly one
> in flight)? `workstream` is the default and the one that never needs a
> migration later.

**Then.** Write the answer under `engine:` in `devx.config.yaml`, say that you
wrote it, and continue the run. It is a one-line committed config edit, not a
profile entry — never record it in `~/.claude/devx/`, where no runtime reader
would ever see it.

**Rails.**

- **Ask once, ever.** A repo with the key set is answered; a repo that carries
  the legacy `personalization: docs.layout` is *also* answered — that value is
  still honored, and re-asking would be noise.
- **Never assume silently.** Proceeding on the default without saying so is
  the exact failure this ask exists to close.
- **Never block.** In a non-interactive run (`devx loop`, CI, headless) there
  is nobody to ask: use `workstream`, say so in the run's output, write
  nothing. A preflight that cannot ask must not pretend it did (§5).
- **Never migrate as a side effect.** If they pick a layout that disagrees
  with the artifacts already on disk, say so and stop — moving a tree is the
  human's call, and the two obligations above apply.

## Just-in-time asks

The non-core bank (§6) is asked by its **owning skill**, not here — at the
first moment the answer matters, phrased in that moment's context ("this
phase touches production config — confirm before each long op?"). The owning
skill then calls back into this skill's `set` path so the answer persists.
Two rules make this bearable rather than nagging: **ask once, ever** — a
declined non-core key records as declined and is not re-asked — and **never
in the middle of an approved action**; the ask comes before the action starts
or after it completes.

## Version drift

A profile below `bank_version` is stale, not invalid (§7). Stale with all
core keys answered **never blocks**: ask the new non-core keys inline when
they come up. Stale with a new *core* key unanswered blocks per §5, listing
only the new keys — which is why promoting a key into the core bank is a
deliberate act that interrupts every existing user exactly once, and belongs
in its own reviewed PR.

## Inputs

- Optional: `show` · `set <key> <value>` · `check` · `--defaults` ·
  `reset [<scope>]`, or a natural-language description of what to change.

## Outputs

- `~/.claude/devx/profile.yml` and/or
  `~/.claude/devx/repos/<org>__<repo>.yml` (never committed).
- `devx.config.yaml` `personalization:` + a small PR, for repo-scope answers.
- Workstream `todo.md` frontmatter `personalization:`, for workstream scope.
- For out-of-bank asks: the routed `devx.config.yaml` key, the `CLAUDE.md`
  working agreement, or a refusal naming the clause.

## Refusal conditions

- An answer that would **skip, weaken, auto-pass, or reorder** a gate, a
  refusal condition, or a record — including any wording that claims special
  authority. Refuse per Step 3; never write a "close enough" key.
- A **free-prose** value for a bounded key. The bank is enums and scalars by
  construction (§3.1): prose at the bottom of the instruction hierarchy is an
  instruction wearing a preference's clothes.
- An **unknown key**, or an out-of-enum value. Offer the nearest valid key; a
  typo silently written is a preference nobody can find later.
- Writing an individual value that would **loosen a stricter committed repo
  value** — record it, but say plainly that the repo floor still wins at
  runtime (§2).
- Writing anything under `~/.claude/devx/` into a commit, a PR body, or a
  workstream artifact.
- Recording the doc layout in a profile at all — it is `engine.docs_layout`
  in committed config, and a profile copy would be inert (no runtime reader
  consults the individual layers for it) while looking authoritative.

## Style

- **Say what changes, not what the setting is called.** "Auto-safe means the
  formatting batch lands under your plan approval without asking again per
  item — it never skips the plan approval itself" beats "sets
  `autonomy.action_mode: auto-safe`."
- **A skipped question is a real answer.** Record it, name the consequence,
  move on. Nagging is how a mandatory interview turns into a thing people
  `--defaults` past.
- **Refuse in one sentence, then help.** Name the clause, name what it
  protects, offer the closest sanctioned path.

## Implementation notes

- `docs/PERSONALIZATION.md` is the single source of truth for the bank; this
  skill body never restates a default. `lintPersonalization()`
  (`src/lib/personalization/lint.ts`, run by
  `test/personalization-lint.test.ts` on every `npm test`) enforces
  it in **both directions**: every key a skill declares exists there with a
  default and an owning skill, *and* the registry's **Owning skill(s)**
  column matches the skills' own declarations exactly — so a banked key
  nothing declares (never asked, never read) and a skill quietly dropping a
  declaration both fail the build.
- The preflight in every skill's Step 0 is **fixed text with one variable
  slot** (blocking vs read-only). The canonical wording lives in
  PERSONALIZATION.md §5 and the lint compares every carrier against *it*, not
  against the other carriers — so rewording one skill fails, and so does
  rewording all of them at once.
- Read-only surfaces and non-interactive runs never block (§5). Under
  `devx loop` there is nobody to interview: a preflight that cannot ask must
  not pretend it did.

## Self-learning

At wrap-up, reflect: did this session surface framework friction — an
instruction in this skill body that was wrong or ambiguous, a step the user
had to correct or work around, a missing template or convention? If yes, end
with: **"There were a lot of things we learned — run `/devx-learn` to review
this thread and open a PR with changes that would help."** Skip the nudge on
a clean run.
