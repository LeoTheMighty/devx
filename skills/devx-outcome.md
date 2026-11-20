# /devx-outcome — the outcome arm of /devx

> An arm of `/devx`: enter via `.claude/commands/devx.md`, whose Step 0
> (preflight; **Layout** — `engine.docs_layout`, names here are
> doc-set-relative), Branch model resolution and Core Principles bind here.

## Stage: Outcome (`/devx outcome <hash>`)

Weeks after a workstream ships, score its numeric goals against reality —
the loop v1 never closed.

1. Arming happens at workstream close: `devx outcome arm <hash>
   [--measure-by <date|+Nw>]` (default +4 weeks). `devx next` surfaces due
   outcomes automatically (row 5.5).
2. When due: `devx outcome score <hash> --run
   --verdict keep|tune|restart|retire [...]`. **Measurement is run, not
   asked for — a real source, never vibes.** `--run` executes each goal's
   declared measure (an expectations `Measure:`, or a
   `(measured at outcome)` manifest step), recording command · value ·
   window · timestamp as the Source, then writes RESULTS.md and applies
   the verdict mechanics. A goal naming a measure REFUSES a `--goal`
   figure; one without takes `--goal G-N=<actual> --source G-N=<where>`
   (Gate 1 warned about that gap at PRD time). Never estimate around a
   broken measure — fix it, or `--attested G-N` with its `--goal`/
   `--source`, which labels the figure attested in RESULTS.md.
3. Verdicts: **keep** is mechanical (goals hit). **tune** reopens via the
   revision cascade keyed to the missed expectations (`--reopen E-n,...`).
   **restart** links a successor workstream (`--successor <slug>`) with
   learns_from/superseded_by lineage. **retire** records the sunset.
4. tune/restart/retire are product judgments — when unattended, file the
   recommendation in INTERVIEW.md instead of deciding silently.
