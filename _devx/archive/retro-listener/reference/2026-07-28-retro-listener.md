# Proposal: The retro listener — auto-spawn `/harness-learn` when a session prints the §24 nudge

> **Status:** Accepted — phase 1 implemented (same PR: `hooks/hooks.json` + `hooks/learn-listener.py` + `bin/harness-learn-watch`); phase 2 (unattended) deferred pending its own proposal · **Author:** Leo (+ Claude) · **Date:** 2026-07-28
> **Relates to:** `CONVENTIONS.md §24` (the self-learning loop — this automates its last manual step), `FUTURE.md §A` (the autonomous driver — same "run ahead, human at the boundary" shape; this would be the first piece of harness autonomy that actually runs), `FUTURE.md §B` (the canonical-nudge lint becomes load-bearing, not just hygiene)
> **Scope:** framework-level, but **zero skill-text changes in phase 1**. Adds a plugin-shipped Stop hook + a small watcher script. Does **not** touch gate decision logic, verdicts, or the cascade (§19); does not change `/harness-learn`'s approval boundary in phase 1.

---

## Summary

§24 gave the framework a learning loop with one collector (every skill's wrap-up nudge) and one outlet (`/harness-learn`). The loop still has a human relay in the middle: the nudge prints, and then *someone has to notice it, remember it, and run the retro* — usually at the exact moment they're done with the session and least inclined to start another one. Signal that survived the thread now dies at the terminal instead.

**The shift:** make the nudge machine-readable and the hand-off automatic. A **Stop hook** (shipped with the plugin, so it rides into every consuming repo) detects the canonical §24 sentence in the turn that just ended and enqueues the session. A **long-running watcher** — one terminal window, listening — waits for the session to actually finish, then spawns a *new* Claude session **forked from the original thread** (`claude --resume <session-id> --fork-session`) with `/harness-learn` as its first act. The retro arrives with the full thread as native context — exactly what `SKILL.md` step 1 declares as its primary source — and the human's role shrinks from "remember to run it" to "prune and approve the mined table," which is the part §24 says must stay human anyway.

Nothing about `/harness-learn` changes in phase 1: it still presents plan-first, still requires approval before any write, still opens `fw/learn-*` PRs for human review. The automation only moves the *invocation*.

---

## Problem

The §24 loop's weakest link is the unautomated hop between collector and outlet:

1. **The nudge fires at the worst moment for compliance.** Skills print it at wrap-up — when the engineer has just finished a design session or a gate and is context-switching away. Running a retro *right then* means re-mining a thread they just lived through; deferring it means the nudge scrolls away. Either way, the default outcome is the one §24 was built to prevent: the signal dies.
2. **The retro competes with the session for the same terminal.** `/harness-learn` mines "everything above this invocation" — so running it inline taxes an already-long context, and the retro's own churn (branch, edits, PR) lands in the middle of a workstream session's history.
3. **Nudge frequency will grow, not shrink.** Every new skill ships with the §24 block; more harness usage means more nudges. A manual relay that's already lossy at today's volume gets worse monotonically.

What §24 already got right makes automation cheap: the nudge wording is **canonical and byte-identical across every skill** (one source: §24's quoted sentence; `FUTURE.md §B` tracks a lint to enforce the copies). A signal that is guaranteed byte-stable is a signal a `grep` can detect with essentially no false negatives. The framework accidentally built a wire protocol; this proposal plugs a listener into it.

---

## Design

Three pieces: **emit** (already exists), **detect + queue** (new, tiny), **spawn** (new, tiny).

```
harness skill wraps up, prints §24 nudge
        │
        ▼
Stop hook (plugin-shipped, fires at every turn end)
  reads hook JSON from stdin — session_id, transcript_path, cwd,
  and last_assistant_message (the just-finished turn's text, provided
  directly by the hook API; no transcript parsing needed)
  greps last_assistant_message for the canonical sentence
  on hit → appends {session_id, transcript_path, cwd, ts} to
           ~/.claude/harness/learn-queue.jsonl   (dedupe by session_id)
        │
        ▼
harness-learn-watch (the listening terminal window)
  polls the queue; for each entry, waits until the session is over
  (SessionEnd marker, or transcript mtime idle > N min as fallback)
        │
        ▼
spawns, from the recorded cwd:
  claude --resume <session_id> --fork-session "/harness-learn"
  → a NEW session whose context is the full original thread,
    opened in a fresh terminal tab/tmux window for the human
```

### 1. Emit — no changes

The detection signal is the §24 sentence the skills already print. **Deliberately not** chosen: adding a queue-write command to the `## Self-learning (CONVENTIONS §24)` block in every skill. That block is documented as no-write and byte-identical across skills (§27's placement rules lean on this); turning it into a write step would touch 21 SKILL.md files, violate the no-write invariant, and make the nudge's behavior depend on the model reliably executing a side effect at wrap-up — the exact class of "hope the model does it" step the hook mechanism exists to replace. A hook fires deterministically; prose doesn't.

One consequence to accept explicitly: **the canonical sentence is now an interface, not just style.** Rewording it in §24 without updating the hook's pattern silently unplugs the listener. The `FUTURE.md §B` wording-equality lint (identical up to whitespace, since the hook collapses whitespace runs before matching) stops being nice-to-have hygiene and becomes the thing that keeps the wire protocol intact; the hook script should carry the pattern in exactly one place and a comment pointing back at §24.

### 2. Detect + queue — a plugin-shipped Stop hook

Claude Code plugins can ship hooks (`hooks/hooks.json` in the plugin, auto-discovered on install — no per-user setup); the harness plugin (`harness@8am`, installed from `main`) gains one registering a **Stop** hook. Every turn end, the hook script:

- reads the hook JSON from stdin — `session_id`, `transcript_path`, `cwd`, and `last_assistant_message`, the just-finished turn's text, **provided directly by the hook API**. The hook therefore never parses the transcript JSONL, whose format the docs explicitly mark internal and version-unstable; the one thing the design uses `transcript_path` for is an mtime check (idle detection), never content;
- greps `last_assistant_message` for the canonical sentence — last-turn-only by construction, so a nudge printed three turns ago (or quoted in discussion, or present in a forked retro's inherited history) never re-triggers;
- on a hit, appends one JSON line to `~/.claude/harness/learn-queue.jsonl`, skipping if that `session_id` is already queued (a session that nudges twice — two skills, two wrap-ups — retros once, over the fuller thread);
- exits 0 fast, always. The hook never blocks, never prompts, never talks to the model. Detection is its whole job.

A **SessionEnd** hook (same script, different event) drops a `<session_id>.ended` marker so the watcher knows the session is genuinely over the moment the user exits — rather than only inferring it from idle time.

Because the hook ships with the plugin, it fires in *whatever repo the harness session ran in* — mycase_app, this repo, anywhere the plugin is installed. That matches how harness sessions actually happen (workstream work runs in consuming repos) with zero per-repo setup.

### 3. Spawn — the watcher and the forked retro session

`harness-learn-watch` — a small script in this repo (`bin/`), run in a terminal window the way the proposal imagines: just listening. Loop:

1. Poll the queue (a few seconds' interval; this is a file read, not an API call).
2. For each unprocessed entry, wait until the session is over: the `.ended` marker exists, **or** the transcript's mtime has been stale for N minutes (default ~15 — the fallback for sessions that never cleanly exit). Retro-ing a session that's still going would fork a partial thread and miss exactly the late-session friction that's often the best material.
3. Spawn the retro **interactively, in a new terminal tab/tmux window**, from the entry's recorded `cwd` (sessions are stored per-project; the fork must launch where the original ran):

   ```
   claude --resume <session_id> --fork-session "/harness-learn"
   ```

   `--fork-session` mints a new session ID — the original session's history is never appended to, and the user can still resume the original independently. The forked session's context *is* the thread, natively — no transcript re-parsing, no lossy summarization hand-off, and `SKILL.md` step 1's "everything above this invocation" is satisfied by construction.
4. Mark the queue entry processed (move it to `learn-queue.done.jsonl` with the outcome).

**The watcher is serial: one retro at a time.** It spawns a retro, waits for that `claude` process to exit, marks the entry processed, then takes the next entry — so a backlog drain (start the watcher after a day of work, three sessions queued) presents as *finish one retro, the next tab appears*, never three tabs at once. This isn't just attention hygiene; concurrent retros genuinely collide: every harness-learn lands its changes in the same harness-repo checkout (cross-repo courtesy — two concurrent `git checkout -b fw/learn-*` fight over one working tree), and harness-learn's dedupe checks *open* `fw/learn-*` PRs, which two simultaneous runs would race (neither PR exists when the other checks). Per-retro git worktrees could buy parallelism later; expected nudge volume doesn't justify it.

The spawned session is a **normal interactive Claude Code session** — `/harness-learn` is its first message, not a headless run. The human can prune the mined table, redirect, approve, or quit, exactly as if they had forked the session and typed the command themselves.

**Advancing to the next retro = ending the current session**, any normal way: `/exit`, Ctrl-D, double Ctrl-C, or closing the tab. There is no watcher-specific gesture to learn. Mechanically, a process launched in a separate tab isn't the watcher's child, so it can't `wait()` on it — the spawn wraps the command in a completion marker the watcher polls for before dequeuing the next entry. The wrapper is a **trap**, not a trailing `touch`: closing the tab and `tmux kill-window` both deliver SIGHUP, which kills the shell before a `cmd; touch marker` ever reaches the `touch` — so the one exit gesture this doc advertises would wedge the queue permanently. `trap 'rc=$?; w "$rc"; exit "$rc"' HUP INT TERM`, plus a trailing status write, covers every exit path a shell can still observe. Note it traps the **signals only, with no `EXIT` trap** — bash defers a trap until the foreground command returns, so an `EXIT` trap alongside the signal trap would both fire and make the recorded outcome depend on their ordering (a closed tab logged `0`). Exactly one write happens on every path. That same deferral is why the trap **reads** `$?` instead of asserting an outcome: a single Ctrl-C in Claude Code clears the input line rather than exiting, so `claude` absorbs it and goes on to exit 0 — a trap hard-coding "interrupted" would mislabel a retro that finished cleanly. The marker also carries `claude`'s **exit status** rather than merely existing (`0` clean · `128+N` = killed by signal N, i.e. the tab went away · another nonzero = the fork failed · `error-cd` = the project dir is gone), because `learn-queue.done.jsonl` is the dataset the phase-2 debate is anchored on: an `outcome` that can't tell "retro ran" from "fork exploded" poisons exactly that evidence. The wait is bounded (`HARNESS_LEARN_RETRO_TIMEOUT_MINUTES`, default 6h) so a SIGKILL'd tab — the one case no trap catches — degrades to a warning instead of a hang. **Deferring instead of skipping:** exiting a retro marks its entry processed, so bailing on one you meant to do later would silently drop it — a `harness-learn-watch requeue <sid>` subcommand (reading from `learn-queue.done.jsonl`) puts it back at the end of the queue. Nothing is ever truly lost either way: the original session transcript persists, and a manual `claude --resume <sid> --fork-session "/harness-learn"` recreates the retro at any time.

The watcher is a shell script, not a Claude session. **Deliberately not** chosen: a `/loop`-style Claude session as the listener — it would burn tokens polling a file, and deterministic plumbing (watch, debounce, spawn) is exactly what scripts are for. The model's job starts where the fork begins.

### Why resume-fork instead of handing a fresh session the transcript path

| | `--resume --fork-session` (chosen) | fresh `claude` + "Read this transcript JSONL" |
| --- | --- | --- |
| Fidelity | The actual thread, byte-for-byte, as native context | A re-parse of a format the docs mark **internal and version-unstable** — tool results, images, and structure arrive second-hand and can break on any release |
| Token cost | One context load of the original thread | The same content *plus* the reading/re-serialization overhead on top |
| `/harness-learn` fit | Step 1's "this session's thread — everything above this invocation" holds literally | Skill needs a variant input mode ("mine this file instead of the thread") — a SKILL.md change phase 1 otherwise avoids |
| Session hygiene | New session ID; original untouched | Also fine |

The fork wins on all three axes and requires no skill changes. The transcript-path mode remains the natural fallback if a session's history has been compacted or its project dir moved — worth a line in the watcher's error handling, not a design pillar.

### The loop can't self-trigger

Five reinforcing guards, two of which already exist. The first is the only *mechanical* one, and it exists because the others aren't sufficient on their own:

- The spawned retro runs with **`HARNESS_RETRO=1`** (set by the watcher's wrapper and inherited by every hook `claude` runs), and the hook **returns before reading stdin** when it's set. This is the bound on the chain. Without it the guard below is aspirational: the hook matches on message **content, not authorship**, and `/harness-learn`'s job is mining and quoting framework text — §24 included — so a retro that ends by quoting the sentence queues *itself*, its child can do it again, and since each fork gets a fresh session id the dedupe never catches it and nothing caps the depth.
- `/harness-learn` **never prints the §24 nudge** (its own SKILL.md: "Don't self-trigger loops") — a convention that keeps the retro from *trying*, now backed by the env guard when it quotes one anyway.
- The hook greps **only `last_assistant_message`** — the inherited nudge in the fork's history is invisible to it.
- The queue **dedupes by session_id** — though note this catches a re-nudge from the *same* session, not a fork, which gets a new ID.
- `/harness-learn` **dedupes against open `fw/learn-*` PRs** (its step 4) — even a double-spawn converges to a pointer, not a duplicate PR.

---

## What this deliberately does not change (§19 / §24 boundaries)

- **No gate, verdict, cascade, or refusal logic is touched.** The retro listener is invocation plumbing.
- **`/harness-learn`'s approval boundary is intact in phase 1.** The spawned session is interactive; the human still prunes the mined table and approves before any branch or write, exactly as §24 requires ("after the user prunes the list"). What was manual is *noticing*; what stays manual is *judging*.
- **Review and merge stay human**, unchanged.

---

## Phases

**Phase 1 — attended (this proposal's ask).** Hook + queue + watcher + interactive fork. Roughly: a `hooks/` addition to the plugin (one JSON registration + one ~40-line script), one ~100-line watcher script, a README section. No SKILL.md or CONVENTIONS edits beyond a §24 pointer noting the nudge is now machine-detected (and the lint's new load-bearing status). Small, self-contained, reversible by deleting the hook.

**Phase 2 — unattended (explicitly deferred, needs its own debate).** Headless spawn (`claude -p --resume <sid> --fork-session "/harness-learn --unattended"`) with the retro running to a **draft PR** without a human in the loop. This *would* move `/harness-learn`'s approval boundary (today: "approval withheld → no branch, no writes"; unattended: approval happens at PR review instead) — a real policy change to a documented refusal condition, so per §19 discipline it gets its own `docs/updates/` proposal if phase 1 proves the volume justifies it. It also needs a permission profile for the headless run (git/gh allowlist) and a cost story (every retro replays a full session context). Phase 1 needs none of that.

**Sequencing note:** phase 1 is also the cheap experiment that sizes phase 2. The `learn-queue.done.jsonl` log *is* the dataset — how often the nudge fires, how often the spawned retro produced a PR vs. was closed as noise — and that's exactly the evidence a phase-2 debate should be anchored on (§14 applies to process claims too).

## Failure modes & mitigations

| Failure | Mitigation |
| --- | --- |
| §24 sentence reworded → listener silently deaf | Pattern lives in one place in the hook, commented back to §24, and the §B.6 wording-equality lint ships with this change (`bin/lint_nudge.py`, run by `.github/workflows/consistency-lint.yml` on any `skills/**`, `hooks/**`, or CONVENTIONS change): it asserts the hook pattern is a substring of §24's canonical sentence and that every nudging skill carries it verbatim. Rewording §24 itself must touch the hook in the same PR — noted in §24, and the lint fails until it does |
| Retro spawns while session still active | SessionEnd marker + idle-mtime fallback. When there's no transcript to `stat` — the field is absent, or the file is gone — readiness ages the entry out against its own queue `ts` rather than declaring the session over, so this path fails safe rather than spawning immediately; worst case the fork misses late material, and the original session's *next* nudge re-queues (dedupe is per unprocessed entry, cleared once processed) |
| User never exits the session (laptop lid, days-long terminal) | Idle-mtime fallback (default ~15 min) is the actual trigger in practice; the marker is just the fast path |
| Watcher isn't running when the nudge fires | The queue is durable — entries wait; the watcher drains the backlog on start. The hook works without the watcher; the watcher works without a live session |
| Several entries queued at once (backlog drain) | Serial spawning — one interactive retro at a time, next spawns when the previous `claude` process exits. Prevents both the attention pile-up and the real collisions: concurrent branch churn in the one harness-repo checkout, and two retros racing the open-PR dedupe check |
| Two watchers running → both take the head entry | The watcher holds an exclusive `flock` on `.watcher.lock` (a separate inode from the queue lock, which the hook needs) for its whole life; a second one exits with a message instead of starting. Serialism was otherwise enforced only by there happening to be one process — and the docs both suggest a spare terminal *and* give a `nohup` line, so two retro tabs for one session and two `completed` rows for one retro was a normal accident, not a contrived one. `--dry-run` is exempt from the lock: it never drains, and the steady state it exists to check is precisely one where a watcher is already running |
| Session history compacted / project dir moved → fork fails | The wrapper records `claude`'s exit status in the completion marker, so the entry is filed as `error-fork:<status>` (not `completed`); the watcher prints the transcript path and the manual `claude --resume …` command, and doesn't retry-loop |
| Retro tab closed / `tmux kill-window` (SIGHUP) → marker never written | The wrapper traps `HUP INT TERM` (deliberately no `EXIT` trap — it would race the signal trap) rather than trailing the command with `touch`; the entry records `completed-interrupted`. Belt-and-braces for SIGKILL: the watcher's wait is bounded (default 6h) and advances with a warning + requeue hint |
| Ctrl-C absorbed by Claude Code, session then ends cleanly | The trap **reads** `$?` rather than asserting a signal outcome. The same deferral that ruled out the `EXIT` trap cuts this way too: one Ctrl-C clears the input line instead of exiting, so `claude` goes on to exit 0 while the trap still runs — hard-coding an interrupted outcome there mislabelled a completed retro. Dataset fidelity only (both map into the completed family), but the done log is the phase-2 evidence base |
| `--dry-run` used to check a setup | Prints the spawn command and touches nothing else — no marker, no done-log row, no queue rewrite; entries stay pending. The first version faked a `0` marker, which walked each entry through to `finish()`, so a dry run silently drained the queue and wrote `completed` rows for retros that never ran |
| `/clear` or `/resume` mid-work misread as "session over" | SessionEnd fires for those too, so the hook ignores those reasons and lets the idle-mtime fallback decide — otherwise a retro tab would steal focus while the user is still working in that terminal. `logout` is denylisted alongside them for a different reason: the spawn would run `claude --resume` against an unauthenticated CLI and can only fail. Denylisted (not allowlisted) so an unrecognised reason still takes the fast path |
| A retro quotes the §24 sentence and queues itself | The wrapper sets `HARNESS_RETRO=1` and the hook returns early when it's set, so detection is inert inside a retro. Content-matching alone can't distinguish quoting from nudging, and each fork's fresh session id defeats the dedupe — so this is the bound, not the "never prints the nudge" convention |
| Nudge fires in a repo where retros don't make sense | The watcher only auto-spawns for queue entries whose `cwd` it can serve; a per-user allowlist keyed on the **repo root** (one prompt per repo, not per subdirectory), defaulting to "ask once per new repo" |
| Queue entry with no usable `cwd` (the hook records `payload.get("cwd")`, so `null` is writable by the normal path) | Retired as `error-malformed` alongside the id-less case, before the allow prompt or `spawn()` can see it. Past that guard a blank `cwd` only misbehaved: `spawn()` raised `KeyError` *before* `finish()` ran (re-crashing the watcher on the same head entry every restart — a permanent wedge of the serial queue), `cd ''` is a no-op so the fork ran in the wrong directory and filed as `error-fork`, and `repo_key(None) == ""` let the allow prompt write `{"": "allow"}` — poisoning the allowlist so every future cwd-less entry became servable non-interactively too |
| Unreviewed repo queued while the watcher runs non-interactively (`nohup`) | The candidate scan skips entries it can't serve instead of blocking on the first one, so one unanswerable repo can't starve every other repo's retro; each skip prints once. `can_prompt()` is re-checked immediately before the prompt, since a watcher `bg`'d *after* startup would take `SIGTTIN` on `input()` rather than raising something catchable |
| No tmux and not macOS → nothing to spawn into | The command is printed for the human and the entry is filed `manual` immediately. Deliberately not awaited: the completion marker on that branch can only come from the human, so waiting on it held the serial queue for the whole retro timeout (6h) per entry — with nothing actually spawned to serialize against. `requeue` puts it back under watcher control |

## Costs

- **Per-turn:** one interpreter start and one substring match over the `last_assistant_message` string the hook API already hands it on stdin — **no file is opened at all unless the nudge matches**, and the transcript JSONL is never read (only `stat`ed, later, by the watcher). Cheaper than an earlier draft of this line claimed ("one grep over the tail of a JSONL file"); stated precisely because this section is the honest-cost accounting. Negligible either way — but it's the first hook the plugin ships, so it's worth saying out loud that the plugin now executes code on the user's machine outside a model turn.
- **Per-retro:** one full-context session load (the fork replays the thread) plus the retro's own work. This is the same cost as running `/harness-learn` manually in-thread today — moved, not added — and it buys a fresh context for the retro instead of a taxed one.
- **Watcher steady state:** one queue read per 5s poll, and — since `repo_key` is memoized per `cwd` — zero subprocesses once each queued repo has been resolved. Before the memo, a backlog the watcher couldn't serve re-forked `git rev-parse` for every ready entry on every pass (~69k forks/day at four entries), indefinitely.
- **Nothing is garbage-collected yet, by choice:** `learn-queue.done.jsonl` grows without rotation (and `list`/`requeue` read it whole), `markers/` accumulates `.ended`/`.done` files — including one per `manual` entry, whose marker is written after the watcher has already moved on — and `.queue.lock` / `.watcher.lock` are left in place. The fastest-growing case is a **denied** repo: the hook has no allowlist, so every nudging session there re-queues and files another `skipped-denied-repo` row. At realistic volumes (a few retros a week) none of this bites for years, so it's recorded here rather than solved in code; the day `list` feels slow is the day it earns a `--prune`.

## Open questions

1. **Watcher UX:** plain new-terminal-tab spawn (macOS `osascript` / `tmux new-window`), or notify-then-spawn-on-keypress? Auto-spawn matches the proposal's intent; a one-keypress confirm is the conservative default for the first release.
2. **Queue location:** `~/.claude/harness/` (user-global, survives repo moves — proposed) vs. per-repo `.claude/`. User-global matches "one watcher, many repos."
3. **Should `/harness-status` surface pending queue entries?** ("1 session awaiting retro") — cheap, fits §23's health-surfacing pattern, but can land later.

---

## Verification of the underlying mechanics (checked 2026-07-28, Claude Code 2.1.220 + official docs)

- `--fork-session` — "When resuming, create a new session ID" — and `-r/--resume [value]`, `-p/--print` all present in `claude --help` locally.
- Stop-hook stdin JSON includes `session_id`, `transcript_path`, `cwd`, `hook_event_name`, and `last_assistant_message` (the field this design greps) — [hooks reference](https://code.claude.com/docs/en/hooks.md).
- Plugins ship hooks via `hooks/hooks.json` (or inline in `plugin.json` under `"hooks"`), auto-discovered when the plugin is installed/enabled — [plugins reference](https://code.claude.com/docs/en/plugins-reference.md).
- Sessions are stored per project directory (`~/.claude/projects/<project-slug>/<session-id>.jsonl`); `--resume` must run from the original project directory — hence the queue records `cwd` — and `claude -p --resume <sid>` is the documented headless continuation — [sessions](https://code.claude.com/docs/en/sessions.md), [CLI reference](https://code.claude.com/docs/en/cli.md).
- Transcript JSONL format is explicitly documented as internal and subject to change — the design reads it for **mtime only**, never content — [sessions](https://code.claude.com/docs/en/sessions.md).
- One inference, not a documented guarantee: Stop firing in `-p` (headless) runs is implied but not explicitly stated in the docs. Phase 1 doesn't depend on it (the watcher spawns interactive sessions); phase 2 should test it first.
