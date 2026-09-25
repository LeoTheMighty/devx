---
hash: 4821ec
type: dev
created: 2026-09-25T14:08:00-06:00
title: "Declare which gates need the dev-env lease in config, and take it inside claim/finalize"
from: null
status: ready
owner: null
branch: null
---

## Goal

The dev-env lease should be structural where devx executes, and declared —
not described — where the agent executes.

Phase 5 now carries the lease as prose (this repo's own `skills/devx.md`).
That was the right first move, because **devx never runs the project's gates
— the agent does**, so there was nowhere else to put it today. But this repo's
own thesis says prose is the regression vector: *"inlining the order in the
skill body has been the regression vector across all 25 Phase 0 stories"*, and
the CLI wrapper is what makes an order non-skippable (dvx101, mrg102, pln101).
This spec closes the gap the prose cannot.

## What the prose cannot fix

1. **Nothing verifies the lease was taken.** A run that skips it reports the
   same green as a run that took it. Under `observe` mode that is invisible;
   under `enforce` it is a denial mid-gate.
2. **The agent decides which gates need it** by matching a prose description
   against `~/.envlock/config.json`. Two agents will draw that line
   differently, and the line is knowable mechanically — the guard already
   computes it.
3. **devx's own main-checkout mutations are not the agent's to remember.**
   `devx devx-helper claim` commits and pushes on the base branch in the main
   checkout; `finalize` runs `pull --ff-only`, commits and pushes there. The
   guard's `GIT_MUTATING` set includes `commit`, and Write/Edit inside a
   guarded path is covered too — so on a repo whose main checkout is a leased
   path, **Phase 1 and Phase 8 are guarded operations**, not just Phase 5's
   gates. Those two run *inside* devx, which is exactly where a wrapper
   belongs.
4. **The prose costs budget that is nearly gone.** The Phase 5 block is
   3,037 B; S-1's full-run surface has **2,456 B free** after it (128,616 of
   131,072 — `engine.full_run_prose_budget_kb`, D-14). The next lease
   refinement does not fit. Declaration is cheaper than description, per
   surface and per run.

## Acceptance criteria

- [ ] AC 1: `devx.config.yaml` declares the lease per gate, not per prose
      paragraph — e.g. `projects[*].lease: stack` (and `stack.lease:` for the
      single-project shape), defaulting to none. Schema + `docs/CONFIG.md`.
- [ ] AC 2: A resolver exposes it — `devx gates <hash>` (or an added field on
      whatever Phase 5 already reads) emits, per affected project, the exact
      command to run **including its `envlock run` wrapper when a lease is
      declared, and bare when it is not**. The agent copies a command; it does
      not decide a policy.
- [ ] AC 3: `devx devx-helper claim` and `devx devx-helper finalize` acquire
      the lease for the main checkout themselves when one covers it, hold it
      only for their own git work, and release it — including on their
      existing rollback paths. A caller that forgot cannot skip it.
- [ ] AC 4: Both degrade to today's behavior when `envlock` is absent, when
      no resource covers the repo, or when the config declares no lease. No
      new hard dependency: devx must still run on a machine that has never
      heard of `dev-env-lock`.
- [ ] AC 5: `envlock` failures are classified, not swallowed — a denial
      (exit 3 / queued) is a wait, an internal error fails open with a warning
      that says the gate ran unleased. Silence in either direction is a bug.
- [ ] AC 6: A test proves AC 3 with a real fake-lease binary on PATH: the
      claim/finalize paths call it, and the call is skipped when it is absent.
- [ ] AC 7: The Phase 5 prose SHRINKS when AC 2 lands — it should end up
      naming the command source, not re-deriving which gates qualify. Net
      prose delta ≤ 0 bytes against the block this spec supersedes.

## Technical notes

- **Do not wrap `envlock run` in a `devx run`.** `envlock run` already
  heartbeats and releases; a second wrapper would duplicate that logic
  (CLAUDE.md: don't duplicate business logic) and add no ordering guarantee,
  because the ordering problem for gates is "did a lease exist while this ran",
  which `envlock run` answers by construction. The value devx adds is
  *declaration* (AC 1–2) and *its own* mutations (AC 3) — not a third CLI in
  the chain.
- The lease is per resource, not per run: the stack lease spans Phase 5's gate
  sequence, and the main-checkout lease is taken for seconds inside claim and
  finalize. Holding one lease from Phase 1 to Phase 8 would starve every other
  session across the remote-CI wait.
- Mode today is `observe`, so none of this can be verified end to end by
  behavior alone — the audit log (`~/.envlock/audit.ndjson`) is the only
  evidence that a run would have complied. Prefer an AC 6 test with a fake
  binary over waiting for `enforce`.
- Reference: `~/personal/dev-env-lock/README.md` (the checkout is there, not
  at the README's `~/.claude/dev-env-lock`), `~/.envlock/config.json`,
  `envlock/guard.py` for what is actually covered.

## Status log

- 2026-09-25T14:08-06:00 — filed alongside the Phase 5 prose that ships the
  lease today. Guard coverage verified by reading `envlock/guard.py`
  (`GIT_MUTATING` includes `commit`; Write/Edit inside a guarded path is
  covered), which is what establishes AC 3's claim that Phases 1 and 8 are
  guarded operations and not only Phase 5's gates. Budget figures measured,
  not estimated.
