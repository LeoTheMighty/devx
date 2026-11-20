# /devx-loop — the overnight arm of /devx

> An arm of `/devx`: enter via `.claude/commands/devx.md`, whose Step 0
> (preflight; **Layout** — `engine.docs_layout`, names here are
> doc-set-relative), Branch model resolution and Core Principles bind here.

## Stage: Loop (`/devx loop` — good night, have fun)

Unattended operation. The trust model is transactional git + the failure
ladder + merge-gate — NOT permission bypass (D-6; LOCKDOWN refuses the loop
entirely).

1. Entry: `devx loop [--until <HH:MM>] [--max-items N] [--max-tokens N]
   [--only <type>] [--dry-run] [--force]`. Budgets come from
   `devx.config.yaml → loop:`; flags override downward only. Run `--dry-run`
   first when the user is present and show them the plan.
1b. **Scope (mlc106)** — `[--epic <slug|plan-hash>]…
   [--workstream <slug>]… [--items <h1,h2,…>] [--exclude <hash|epic>]…
   [--focus <text>]`. Repeated flags union within a dimension; different
   dimensions intersect. Scope MASKS, never drops: an out-of-scope row
   still blocks its in-scope dependents, and an in-scope item held by an
   out-of-scope unfinished blocker is reported by hash (stdout, event,
   morning report) rather than silently skipped. `--items` also dictates
   pick order. `--focus` masks nothing — it rides into every iteration
   prompt verbatim as a Specialty directive. Malformed scope flags — and
   any scope that selects zero claimable rows — exit 4 against the parsed
   backlog before any lock, claim, or file write. Use scope to run
   N loops on disjoint slices; the scope descriptor shows up in the
   instance file, `devx next` row 1, `devx status`, and the report
   header.
1.5. **Preflight main-health (lpf101).** The CLI probes the integration
   branch's remote CI before claiming anything and exits 5 when it's red —
   a red main converts the whole night into unmergeable open PRs (every
   branch inherits the red check; the tail hands every item off with zero
   merges). Fix main first. `--force` (or `loop.preflight_main_health:
   warn`) starts anyway and threads a "treat as baseline" line into every
   iteration prompt + the morning report; probe failure or no decisive
   signal never blocks the run.
2. The CLI owns the loop: item pick (reconcile), worker spawn, the
   iteration contract (fresh session per iteration; smallest verifiable
   slice; structured report), commit-or-reset transactions, the failure
   ladder (reported → continue; hard error → backoff; permanent → abort;
   3 strikes → abandon item, preserve worktree; 3 abandoned → stop), and
   the morning report. The skill's job is to start it, not to be it.
3. **Loop completion is not acceptance (D-11).** `acs_met` routes items
   into the normal PR + CI + merge-gate tail; nothing reaches main any
   other way.
4. Workers inside the loop obey the iteration contract verbatim: read the
   status log first, never commit, never edit the status log (the loop
   owns both), report failure instead of pivoting forever, stop background
   processes before finishing.
5. Morning: the first `/devx` of the day runs the morning review
   (dispatcher Routing rule 1) — reconstruct from disk, read the report's
   claims as claims, verify merges via `gh pr view` before trusting them.
