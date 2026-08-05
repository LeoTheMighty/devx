---
hash: 28b267
type: dev
created: 2026-08-05T11:25:00-06:00
title: learn.auto_allow — the retro watcher stops needing a human at the prompt
from: null
status: ready
owner: null
blocked_by: []
branch: null
---

## Goal

Make `devx learn-watch` servable without a human at the terminal. Today an
unreviewed repo is a hard stop for an unattended watcher: `repoDecision`
returns `unknown`, `drainPass` notes the skip and downgrades the rest of the
run to non-interactive, and `pickReady`'s non-interactive arm then walks past
every remaining unreviewed entry forever. The queue drains only if a human is
sitting in a foreground terminal to answer `[y/N]` once per repo.

Observed 2026-08-05: two sessions from this repo sat pending since 2026-08-02
behind exactly that gate, with `repos.json` never written —

```
skip 8975a139… — the allow prompt could not be answered; continuing non-interactively
skip 8274f44e… — repo not reviewed and this run can't ask
```

Add a policy knob that says "unreviewed means allowed" so the watcher can run
under `nohup` and still drain.

## Acceptance criteria

- [ ] `src/lib/learn/config.ts`: `LearnConfig` gains `autoAllow: boolean`,
      default `false` in `LEARN_DEFAULTS`, read from `learn.auto_allow` with
      the same per-key defensive fallback as the existing knobs (non-boolean
      → default; missing/wrong-shape `learn:` block → complete config).
- [ ] `_devx/config-schema.json`: `learn.auto_allow` boolean property with a
      description; `docs/CONFIG.md` gains its row.
- [ ] `src/lib/learn/watch.ts` — `repoDecision` gains `autoAllow?: boolean`
      and evaluates in this order, which is the contract:
      1. a **recorded** verdict short-circuits — so an explicit `deny` in
         `repos.json` still beats the blanket policy;
      2. `autoAllow` → `"allow"`;
      3. the existing interactive-prompt path.
- [ ] **`autoAllow` does not write `repos.json`.** A policy is not a
      decision: `repos.json` stays the record of what a *human* reviewed, so
      turning the knob back off restores prompting instead of leaving every
      repo the watcher ever touched permanently allowed. Assert this — an
      auto-allowed spawn leaves the file byte-identical (and absent if it was
      absent).
- [ ] `PickReadyOpts` gains `autoAllow?: boolean` and the non-interactive
      unservable arm (`watch.ts` — `!opts.interactive && repoLookup(...) ===
      null`) does **not** skip when it is set. Without this the entry never
      reaches `repoDecision` at all and the knob silently does nothing — the
      single most likely way to ship this broken.
- [ ] `drainPass` forwards `autoAllow` to both `pickReady` and
      `repoDecision`; `--dry-run` reports an unreviewed repo as *would
      auto-allow* rather than "repo not reviewed yet; a real run would ask
      first", since under the knob that sentence is a lie.
- [ ] `src/commands/learn-watch.ts`: `resolveLearnEnv` returns `autoAllow`
      from the merged config; a `--auto-allow` flag overrides it to true for
      one run (flag > config > default). The startup line names the policy
      when it is on, so an unattended watcher's log says why it never
      prompted.
- [ ] Tests (`test/`, alongside the existing learn-watch suites): config
      fallback fuzz for `auto_allow` (`"yes"`, `1`, `null`, absent → default);
      recorded `deny` beats `autoAllow`; recorded `allow` still short-circuits;
      unreviewed + `autoAllow` + non-interactive → **served**, not skipped
      (the `pickReady` regression above, asserted at the `drainPass` level);
      `repos.json` untouched after an auto-allowed spawn; `--dry-run` wording;
      flag-over-config precedence.
- [ ] Full suite green (`npm test`, typecheck included).

## Technical notes

- The knob is read via `loadMerged()` from the watcher's **launch cwd**, same
  as `idle_minutes` and `retro_timeout_minutes` — the watcher is user-global
  but its config is not. Don't try to fix that here; note it in `docs/CONFIG.md`
  so it isn't discovered as a bug later.
- Nothing in this spec touches `canPrompt`'s foreground/SIGTTIN logic. That
  check stays exactly as it is — auto-allow removes the *need* to prompt, it
  does not make prompting from a background process safe.
- The `seen` set is per-run, so flipping this knob does not rescue a watcher
  that already skipped an entry; it must be restarted. Worth one line in the
  command's help or the startup output.

## Status log

- 2026-08-05T11:25 — filed from a session-triage conversation (the two
  pending 2026-08-02 entries above). Owner asked for the watcher to stop
  needing a human at the prompt. Manual stopgap applied the same day:
  `~/.claude/devx/repos.json` hand-written with `allow` for this repo.

## Links

- `src/lib/learn/watch.ts` — `repoDecision`, `pickReady`, `drainPass`
- `src/lib/learn/config.ts`, `src/commands/learn-watch.ts`
- Sibling: `dev/dev-c808b1-2026-08-05T11:25-devx-learn-unattended-apply.md`
  (this spec unblocks the watcher; that one decides what the spawned retro is
  allowed to do without a human)
