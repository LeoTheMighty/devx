# /devx-outcome — the outcome arm of /devx

> An arm of `/devx`, loaded by its Routing (`.claude/commands/devx.md`)
> after Step 0. Step 0's preflight, Branch model resolution and Core
> Principles there bind here. Reached any other way, load that file and
> start at Step 0.

## Stage: Outcome (`/devx outcome <hash>`)

Weeks after a workstream ships, score its numeric goals against reality —
the loop v1 never closed.

1. Arming happens at workstream close: `devx outcome arm <hash>
   [--measure-by <date|+Nw>]` (default +4 weeks). `devx next` surfaces due
   outcomes automatically (row 5.5).
2. When due: gather each `G-` goal's actual value with a real source (a
   metric, an eval run, a count — never vibes), then
   `devx outcome score <hash> --verdict keep|tune|restart|retire
   --goal G-N=<actual> --source G-N=<where> [...]`. The CLI writes
   RESULTS.md and applies the verdict mechanics.
3. Verdicts: **keep** is mechanical (goals hit). **tune** reopens via the
   revision cascade keyed to the missed expectations (`--reopen E-n,...`).
   **restart** links a successor workstream (`--successor <slug>`) with
   learns_from/superseded_by lineage. **retire** records the sunset.
4. tune/restart/retire are product judgments — when unattended, file the
   recommendation in INTERVIEW.md instead of deciding silently.
