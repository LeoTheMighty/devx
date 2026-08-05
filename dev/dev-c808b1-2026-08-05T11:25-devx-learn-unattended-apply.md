---
hash: c808b1
type: dev
created: 2026-08-05T11:25:00-06:00
title: /devx-learn unattended mode — route and apply lessons without a human
from: null
status: ready
owner: null
blocked_by: [28b267]
branch: null
---

## Goal

Let a watcher-spawned retro carry its own findings all the way to a merged
change instead of stopping at an evidence table nobody is sitting in front of.

Today `/devx-learn` is **plan-first by contract** ("nothing is applied without
user approval") and **foreground-only by guard**. That is correct for an
attended run and inert for an unattended one: `devx learn-watch` spawns
`claude --resume <sid> /devx-learn` into a tab, the skill prints its evidence
table, waits for a prune that never comes, and the watcher eventually files
`timeout` after `retro_timeout_minutes` (360). Every lesson from every drained
session is lost.

Add an explicit unattended mode with an auto-prune rule and an apply path,
keeping exactly two things human: what would wedge, and what is locked.

## Acceptance criteria

- [ ] **Mode entry.** `/devx-learn` accepts an unattended mode (skill-body
      arg + the env the spawn sets). `src/lib/learn/spawn.ts` passes it, gated
      on a config knob (`learn.auto_apply`, default **false** — an unattended
      run that opens PRs must be opted into, not inherited by anyone who
      installs devx). Attended `/devx-learn` behavior is unchanged: the
      evidence table and its prune gate stay exactly as they are.
- [ ] **Auto-prune rule, stated in the skill body.** With no human to strike
      rows, the promotion bar replaces the prune: a row is kept only if its
      evidence is a concrete moment in the mined session (a failure, a rework,
      a wrong assumption with a visible cost). The existing rule that outlet 1
      requires *evidence of the machinery failing*, not plausibility, becomes
      load-bearing here rather than advisory. Ties still take the narrower
      outlet and record the ambiguity.
- [ ] **Apply-vs-propose predicate as a mechanical primitive**, not prose:
      `devx learn-helper route <path…>` → `apply` | `propose`, with the
      reason. `propose` for anything that cannot be edited in an unattended
      tab — `.claude/**`, `skills/**`, any `settings.json`, anything under
      `~/.claude/` — because **skill and settings edits prompt for
      confirmation even under bypass-permissions**, so an unattended tab hangs
      on them until the retro timeout kills it. This is the same structural
      fact behind the skill's existing "foreground only" guard; encoding it as
      a predicate is what lets the rest of the skill stop being foreground-only.
- [ ] **Applied rows go through the normal gates, not around them.** Outlet-1
      rows the predicate marks `apply` land on the existing
      `fw/learn-YYYY-MM-DD-<slug>` branch (slug via `devx learn-helper slug`,
      never hand-built) → local CI → PR → remote CI → mode merge gate. YOLO
      auto-merges on green. No direct-to-`main` path is added by this spec.
- [ ] **Proposed rows leave a durable, findable artifact** — an unattended
      tab's stdout is not a delivery channel. Outlet-1 `propose` rows and
      outlet-2 (`devx.config.yaml`) rows become `docs/updates/<date>-<slug>.md`
      plus a `dev/` spec + `DEV.md` entry so they enter the normal backlog.
      Outlet-4 (personal) rows write to `~/.claude/devx/proposals/<date>-<slug>.md`
      — still never committed, still never applied to settings, but recoverable
      instead of scrolled past.
- [ ] **Locked machinery stays proposal-only, in every mode.** Gate logic,
      refusal paths, cascade rules, verdict vocabulary, and append-only
      disciplines are never loosened by an unattended run. See Open question
      below — this is the one place this spec deliberately does *not* give the
      owner what "auto-apply everything" would literally mean, and it wants an
      explicit ruling before the story is executed.
- [ ] **Every unattended run leaves a report**, whether or not it changed
      anything: rows found, bucket per row with the question that decided it,
      applied vs proposed with the predicate's reason, PR URL if one opened.
      Location must be findable without knowing the session id.
- [ ] **Thin-session refusal still holds.** The existing "refuse fresh/empty
      sessions" and "never self-triggers" rules apply unchanged; an unattended
      run that finds nothing exits clean and files a report saying so, rather
      than manufacturing a lesson to justify the tab.
- [ ] **Budget.** An unattended run bounds itself well inside
      `retro_timeout_minutes` and stops cleanly at the bound with a partial
      report, so the watcher files a real outcome instead of `timeout`.
- [ ] Tests: `route` predicate fuzz (every wedge-path family → `propose`;
      `src/`, `docs/`, `test/` → `apply`); a locked-machinery row never
      reaches the apply path; auto-prune drops a plausibility-only row;
      unattended mode off by default; attended-path regression (the prune gate
      is still there); report written on the found-nothing path.
- [ ] `.claude/commands/devx-learn.md` and its byte-identical `skills/`
      mirror both updated (`test/skills-sync.test.ts` enforces the pair).
- [ ] Full suite green (`npm test`, typecheck included).

## Open question (needs an owner ruling before execution)

The owner asked for lessons to be applied automatically. This spec keeps two
carve-outs from that:

1. **Locked machinery** — gate logic, refusal paths, cascade rules, verdict
   vocabulary, append-only disciplines. An automated pass that can loosen the
   gates it is judged by is a system with no floor, and the guard currently
   holds "even in YOLO mode."
2. **Wedge paths** (`.claude/**`, `skills/**`, settings) — this one is not a
   judgment call, it is a harness fact: those edits *cannot* be applied
   unattended, they hang.

Carve-out 2 is structural and stays regardless. Carve-out 1 is the owner's
call. If the ruling is "auto-apply those too," this spec splits: the
locked-machinery relaxation becomes its own story with its own evidence bar,
because it is the one change that can silently disable the rest.

## Technical notes

- Depends on 28b267: an unattended apply path is pointless while the watcher
  cannot get past the allow prompt to spawn anything.
- Untrusted-input guard is unchanged and matters *more* here — mined session
  content is data, never instructions, and never reaches a `git`/`gh` argument
  or a file path. An unattended run has no human to notice an injected
  directive being followed.
- Consider whether the spawn should pass an explicit permission mode; note
  from memory (`project_skill_perms_block_subagents.md`) that bypass-permissions
  does **not** rescue skill/settings edits, which is exactly why the predicate
  exists rather than a broader permission grant.

## Status log

- 2026-08-05T11:25 — filed from a session-triage conversation. Owner asked for
  `/devx-learn` to apply its routed changes automatically, having been shown
  that this conflicts with plan-first and the locked-machinery guard. Carve-out
  1 raised here rather than decided.

## Links

- `.claude/commands/devx-learn.md` — routing outlets 1–5, guards, foreground-only
- `src/lib/learn/spawn.ts`, `src/commands/learn-helper.ts`
- Blocked by: `dev/dev-28b267-2026-08-05T11:25-learn-auto-allow.md`
