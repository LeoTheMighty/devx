# /devx-retro — the retro arm of /devx

> An arm of `/devx`, loaded by its Routing (`.claude/commands/devx.md`)
> after Step 0. Step 0's preflight, Branch model resolution and Core
> Principles there bind here. Reached any other way, load that file and
> start at Step 0.

## Stage: Retro (native, replaces the retrospective workflow)

Runs at epic/workstream close (the `*ret` item). Contract (D-3): the
LEARN.md row format is byte-compatible with v1.

1. Evidence: read every shipped spec's status log, the epic's PR bodies
   (`gh pr view`), and the diff stats. Reconstruct from disk, not memory.
   **For loop-shipped items the spec status log IS the evidence** — the
   loop writes a thin, uniform PR body ("Overnight loop item; iteration
   history is in the spec's Status log on this branch") and the branch is
   deleted at merge, so `gh pr view` returns almost nothing. The status
   log's per-iteration `- Learning:` lines are the densest material in the
   epic: written at the moment of discovery by the agent that hit them.
   Mine them before anything else (epic-retro-listener F1/F5, where 16
   iterations produced ~70 of them across six PRs totalling +7,686 lines).
1b. **Process metrics — run them, don't estimate them.** Compute from git +
   the plan spec's Status log, never from memory: elapsed (first phase
   commit → last merge, calendar and working days), phases merged/planned,
   gate replays (re-runs of a gate that had already returned a verdict),
   rework commits (a commit touching a file an earlier phase in this same
   workstream already touched — the coupling the plan missed), and the
   loop-landed share. They go on the LEARN.md entry per
   `_devx/templates/engine/lessons-entry.md`. A number nobody computed is a
   vibe, and "that felt slow" is not a finding.

2. Write the workstream retro `RETRO-<date>.md`
   (standalone epics: `_devx/retros/<epic-slug>-<date>.md`): Outcome
   (test-count growth, wall-clock, review-pattern stats, the §1b metrics) +
   findings.
3. Append rows to `LEARN.md § <epic-slug>`:
   `- [confidence] [blast-radius] finding — applied|filed-as|pending`.
   Misses are the highest-value entries — tag them (miss).
4. Promotion check: any pattern with ≥3-retro concordance moves to
   `LEARN.md § Cross-epic patterns` with per-epic evidence.
5. Apply low-blast findings in the retro PR; file higher-blast ones as
   specs/backlog rows. Ship through the normal PR flow — the Execute arm's,
   `.claude/commands/devx-execute.md`.
