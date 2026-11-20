<!-- questions.md — <workstream title> health queue. Gate concerns and parked
  questions, one `## Q-<n>: <title>` each, carrying exactly these bullets:

  Kind: gate-concern | open-question | discovered-gap | needs-revision ·
  Severity: blocking | concern (required — a missing one fails the parse) ·
  Blocks: gate-prd | gate-design | gate-plan | gate-evals | phase-N | — ·
  Origin · Recommendation (required when blocking) ·
  Status: open | asked | answered | resolved · Resolution

  Auto-populated: every `devx gate` run reconciles its own findings — adds,
  updates, resolves. Current-state, not append-only; never a gate INPUT; ids
  are never reused; hand-edits are legal and the next run reconciles them.
  `/devx-walk` resolves one entry per invocation. A human DECISION belongs in
  INTERVIEW.md and a human ACTION in MANUAL.md — file it there, point at it
  from `Resolution:`. Contract: src/lib/engine/questions.ts.
-->
