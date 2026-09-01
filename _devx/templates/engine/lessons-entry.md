<!-- Prepended to LEARN.md's epic/workstream section at retro time. Row
     format is the v1 contract, unchanged: confidence ∈ {high, med, low};
     blast-radius ∈ {low, med, high}; disposition ∈ {applied, filed-as: <ref>,
     pending}. Cross-epic promotion at ≥3-retro concordance. Misses (things
     review/gates should have caught but didn't) are the highest-value
     entries — tag them (miss). -->

## <epic-or-workstream-slug> (<YYYY-MM-DD>)

<!-- Process metrics — RUN, not estimated. Computed at retro time from git +
     the plan spec's Status log, never recalled from memory:

       elapsed        first phase commit → last merge (calendar + working days)
       phases         merged / planned
       gate replays   count of re-runs per gate that had already returned a
                      verdict — the cost of a gate that passed on the second try
       rework         commits touching a file a previous phase in THIS
                      workstream already touched (the coupling the plan missed)
       loop share     phases landed by `devx loop` vs interactively

     These are the per-workstream slice of the outcome record. They exist to
     make "that felt slow" checkable; a number nobody computed is a vibe. -->

**Metrics:** elapsed <N>d (<M> working) · phases <merged>/<planned> · gate
replays <n> · rework commits <n> · loop-landed <n>/<merged>

- [<confidence>] [<blast-radius>] <finding — one sentence, specific enough to
  act on> — <applied | filed-as: <spec/ref> | pending>
