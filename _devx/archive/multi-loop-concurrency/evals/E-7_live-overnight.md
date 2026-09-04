# E-7 — Real overnight: two scoped loops on the live repo (P2, human)

Deferred artifact (legal for P2): this checklist is run by a human after
Phase 6 ships, on the first real multi-loop night (supervised, per the
MV2.1 precedent — S-3 shape). It is the Verified-by target for E-7 and the
scoring input for the workstream outcome (G-2).

## Setup (the night before)

- [ ] `devx doctor` (db36af) or `devx next` drift rows report zero
      mechanical repairs pending before starting.
- [ ] Start ≥2 loops with different scopes, e.g.:
      `devx loop --epic <epic-a> --until 07:00` and
      `devx loop --epic <epic-b> --until 07:00`.
- [ ] `devx next` row 1 lists BOTH instances with their scopes.
- [ ] Machine: lid open / power attached (sleep-inhibit caveat,
      `v2/04-overnight-loop.md` §4).

## Morning review (reconstruct from disk — never from memory)

- [ ] Each loop produced `.devx-cache/reports/<run-id>.md` with its scope
      in the header.
- [ ] Threshold: ≥1 merged PR per loop (PR links in the reports).
- [ ] Threshold: 0 mechanical repairs needed — no orphaned
      `locks/spec-*.lock` (all owners live or reaped), no DEV.md drift
      rows in `devx next`, no `[/]` rows without a live owner.
- [ ] Every claim in each report reconciles: spec status log lines exist,
      checkboxes match frontmatter, `git log` shows the claims/merges the
      reports assert.
- [ ] Cross-loop: no item appears in both reports' attempted lists.
- [ ] File outcome evidence in the workstream RESULTS.md and score via
      `/devx outcome 20eb6f` when it comes due.

Any unchecked box = E-7 fails; file findings as debug specs and re-run the
night after fixes.
