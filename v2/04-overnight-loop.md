# 04 — The Overnight Loop: good night, have fun

`devx loop` is the unattended mode: at bedtime you point it at the backlog and
in the morning you get merged PRs, clean rollbacks, and a report you can trust.
The design folds `kunchenguid/gnhf`'s loop discipline into devx's existing
outer machinery (manager, claim, worktrees, merge-gate).

**The composition insight from the research: gnhf is the *inner* iteration
engine devx lacks; devx is the *outer* backlog/PR/merge layer gnhf lacks.**
gnhf runs one free-text objective per run with no queue; devx has the queue
(DEV.md), the isolation (worktrees), and the merge gate (CI) — what it lacks
is gnhf's hardened iteration contract, failure ladder, and morning-report
discipline. We bolt the inner loop into the manager's worker cycle.

## 1. Trust model (why this can run while you sleep)

gnhf's trustworthiness is **not** permission scoping — it's:

1. **Transactional git semantics** — clean tree in; every iteration ends in
   exactly one of {commit, hard reset}; agent output is preserved, never
   deleted, on failure.
2. **A typed failure ladder with a hard stop** — distinct responses per
   failure class, converging on an N-consecutive-failures abort.
3. **Prompt-hang immunity** — nothing in the loop can block on a TTY.
4. **Orchestrator-owned append-only memory** read by fresh sessions — context
   rot designed out, not mitigated.
5. **Reconstruct-don't-recall reporting** — the morning state is computed
   from git + logs, never from a model's memory of the night.

devx adds its own rails on top: worktree isolation, spec locks + owner checks
(roc101), merge-gate + remote CI as the only path to main, and **devx keeps
its harness permission model** — no `--dangerously-skip-permissions`
equivalent; gnhf's blanket bypass is explicitly *not* adopted (its containment
was branch-level only; ours is gate-level too).

## 2. Loop shape

```
devx loop [--until 07:30] [--max-items N] [--max-tokens N] [--only <type>]
```

Two nested loops, both bounded:

**Outer (per backlog item)** — the manager's existing reconcile/spawn cycle
(mgr101–106) picks the top ready DEV.md/DEBUG.md item, claims it (dvx101
atomic claim + roc101 ownership check), spawns a worker in a worktree, and on
completion merges (YOLO gate) + cleans up. New: outer budgets (`--max-items`,
wall-clock `--until`, global token cap) checked before each claim.

**Inner (per iteration inside a worker)** — the gnhf contract:

1. **Pre-flight**: clean worktree required; iteration/token caps checked.
2. **Prompt frame** (adapted from gnhf's 62-line iteration prompt — the
   highest-leverage file in that repo):
   - "This is iteration N on spec `<hash>`. Read the spec's Status log first."
   - "Pick the next smallest logical unit of work that is individually
     verifiable. Do not attempt the whole spec."
   - "If your attempt didn't move the needle, record learnings and report
     failure rather than continuously pivoting."
   - "Run the relevant build/tests/linters before reporting success."
   - "Stop any background processes you started."
   - "Do NOT commit; do NOT edit the Status log — the loop owns both."
3. **Structured self-report**, schema-validated (retry on shape mismatch):
   `{success, summary, key_changes_made[], key_learnings[], acs_met}`.
   Control flow branches on this object, never on prose.
4. **Outcome handling**:
   - success → loop commits (`git add -A`, conventional message), appends the
     Status-log entry (Summary / Changes / Learnings).
   - reported failure → `git reset --hard && git clean -fd`; Status-log entry
     prefixed `[FAIL]` with the learnings (so the next fresh iteration knows
     what was tried).
   - **no-op detection**: no file changes ∧ no new learnings ⇒ counted as a
     failure — kills the burn-tokens-declaring-victory failure mode.
   - **commit failure** (hooks etc.): the one no-rollback path — preserve the
     work, log the git output, and dedicate the *next* iteration to a bounded
     repair prompt ("fix the existing uncommitted changes; no unrelated work").
5. **Exit conditions**: `acs_met` ⇒ hand off to the normal PR/CI/merge tail
   (ACs are the stop-condition — but **loop completion is not acceptance**;
   merge-gate + CI remain the real gate). Or caps hit. Or failure ladder.

### Memory mapping (gnhf → devx)
gnhf's `notes.md` ≡ the spec file's **append-only Status log** — same fields
(Summary/Changes/Learnings, `[FAIL]`/`[ERROR]` prefixes), same
only-the-orchestrator-writes rule, but ours lives on-branch in the spec so
the history merges. `key_learnings` additionally queue as LEARN.md candidates
for the next retro. Loop runtime state (iteration counter, token totals, caps)
lives in `.devx-cache/loop/<run-id>/` (gitignored), mirroring gnhf's run dir.

## 3. The failure ladder (steal whole)

| Class | Response | Counts toward |
|---|---|---|
| Agent-reported failure (`success:false`) | rollback; log learnings; **continue immediately** (the loop is healthy — it tried and concluded it couldn't) | consecutive-failures |
| Hard error (worker process crashed/threw) | rollback; **exponential backoff** 1 → 2 → 4 min | consecutive-failures + consecutive-errors |
| Permanent error (credits exhausted, auth dead) | rollback; **abort the whole loop now**, surface in report — never grind a dead API until dawn | immediate abort |
| Commit failure | preserve work; next iteration = repair-only | consecutive-failures |
| No-op iteration | treated as reported failure | consecutive-failures |

- **3 consecutive failures on one item** ⇒ abandon the item: release the
  claim, flip spec to `[-] blocked`, file the failure summary in the spec +
  DEBUG.md if it smells like a bug, **preserve the worktree** (never delete
  agent output on failure — print the path in the report), move to the next
  backlog item.
- **3 consecutive abandoned items** ⇒ stop the whole loop (systemic problem —
  don't churn the entire backlog into blocked).
- Config: `loop.max_iterations_per_item`, `loop.max_tokens_per_item`,
  `loop.max_consecutive_failures`, `loop.max_items`, `loop.max_total_tokens`,
  `loop.backoff_ms: [60000, 120000, 240000]` — all in `devx.config.yaml`,
  mode-sensitive per MODES.md.

## 4. Hang immunity + process hygiene (cheap, mandatory)

- `GIT_TERMINAL_PROMPT=0` injected into **every** git subprocess the loop
  runs; `-c commit.gpgsign=false -c tag.gpgsign=false` on loop commits.
- All git invocations via argv-array exec (no shell interpolation of
  agent-derived strings) — devx's git helpers already lean this way; add the
  injection regression test gnhf has.
- Push: never force, never auto-pull; a push failure aborts the item after
  preserving the local commit.
- Worker grace-kill: a worker that emitted its final structured report but
  didn't exit gets its process tree killed after ~15s.
- Sleep inhibition: adapt gnhf's `caffeinate` / `systemd-inhibit` re-exec into
  the supervisor entrypoint (sup40x scaffold already owns platform dispatch).
- Every iteration logs a git snapshot (head/branch/commit-count) to the JSONL
  lifecycle log — catches "the reset didn't land / wrong branch" bugs that
  otherwise look identical to agent failures. Error logs serialize full
  `error.cause` chains.

## 5. The morning report

Written to `.devx-cache/loop/<run-id>/report.md` **and** appended (summary
form) to the run's manager events; later phases push it via the mobile relay.
Contents (gnhf's exit-summary card, devx-flavored):

- Items: attempted / merged (PR links) / abandoned (spec + preserved worktree
  path + last failure) / blocked-on-human (INTERVIEW/MANUAL refs).
- Iterations good/failed per item; tokens in/out (`~` when estimated);
  wall-clock; abort reason if any.
- Per-merged-item: tour link, diff stat, test delta.
- **Next steps**: exact reproduce/review commands.

**Morning-review discipline (for the human's first `/devx` of the day, and
pinned in the skill body): reconstruct from disk — `git status`, `git log
--oneline`, open PRs, the report file, `pgrep` for a still-running loop —
never summarize an overnight run from memory. Read the night's claims as
claims, not evidence.**

## 6. What we do NOT adopt from gnhf

- The TUI (~2000 lines of meteors and moons) — devx is headless + mobile.
- The multi-agent adapter layer (Codex/Copilot/ACP) — Claude-native.
- Permission bypass flags — devx's harness gates + CI stay authoritative.
- Prompt-slug branch naming — `feat/<type>-<hash>` is stronger.
- Per-iteration push to a shared branch — PR-per-item flow stays.
- One-objective-per-run — the backlog IS the objective list.

## 7. Interplay with existing manager work (mgr101–106)

The manager already owns: schedule/heartbeat/lock state files, reconcile
(level-triggered, N=1), spawnWorker (detached `claude /devx <hash>`),
crash-restart with backoff + max-restarts, SIGTERM-clean. The loop is a
**mode of the manager**, not a new daemon: `devx loop` = manager run with
night budgets + the inner iteration contract injected into workers + the
morning report emitted at exit. Phase 2's old control-plane plan
(`plan-c4f1a2`: events, rot detection, restart-from-status-log, watchdogs) is
absorbed here — restart-from-status-log falls out of the iteration contract
(fresh session + Status log + structured state = restartable by
construction).
