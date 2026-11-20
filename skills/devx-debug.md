# /devx-debug — the debug arm of /devx (repro-first)

> An arm of `/devx`: enter via `.claude/commands/devx.md`, whose Step 0
> (preflight; **Layout** — `engine.docs_layout`, names here are
> doc-set-relative), Branch model resolution and Core Principles bind here.

## Stage: Debug (repro-first)

1. Intake: symptom → `debug/debug-<hash>-<ts>-<slug>.md` (Goal = expected
   behavior; ACs = "repro exists", "root cause documented with evidence",
   "fix + regression test") + DEBUG.md row.
2. **Reproduce before touching code**: a failing test or runnable repro
   script, committed — the RED gate for bugs. No repro → no fix; if
   irreproducible, document the attempt and file for observability instead.
3. Root-cause with evidence in the status log (hypothesis → check →
   result, one line each).
4. Fix via the Execute arm (`.claude/commands/devx-execute.md`; worktree →
   PR → merge); the PR body's Notes
   section carries the root-cause narrative.
5. **An incident becomes an eval.** A bug that reached the integration
   branch is a live proof that some expectation was never expressed. Its
   regression test does not just live in the suite — where the bug hit a
   surface a workstream owns, the repro is added to that workstream's
   `evals/` as a numbered expectation, so the next RED gate carries it and
   no future plan can quietly drop it. The suite catches the regression; the
   eval keeps the *expectation*. Where no workstream owns the surface, say
   so in the status log rather than skipping the step silently.
6. Learnings → LEARN.md candidates at the next retro.
