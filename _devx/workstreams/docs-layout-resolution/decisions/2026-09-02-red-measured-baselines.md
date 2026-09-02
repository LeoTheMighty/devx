# RED-measured baselines — Docs Layout Resolution

**Date:** 2026-09-02 · **Stage:** RED (Gate 4 PASS) · **Hash:** a494be

Three of this workstream's numeric baselines were *estimated* in the PRD and
*re-grounded* in the plan. Authoring the RED evals measured them directly.
This file records what the evals actually observed, so `devx outcome` scores
G-2 against reality rather than against a number nobody re-checked. It is a
companion to `2026-09-02-deferred-prd-corrections.md`, which records the
corrections the owner chose not to propagate via `devx revise`.

**No phase changes.** Every correction here makes an existing phase's job
larger or better-specified; none moves work between phases.

## The measurements

| Quantity | PRD / expectations | Plan (re-grounded) | RED measured | Eval |
|---|---|---|---|---|
| Functions reading the layout key | 2 | 2 | **3** | E-2 |
| Orphaned exported resolvers in `artifacts.ts` | 2 | 8 (R-9) | **8** | E-2 |
| Hand-joined stage-subject paths outside the resolver | 4 | 5 (+ named message sites) | **15** distinct | E-3 |

### 1. Three layout readers, not two

`docsLayoutFrom()` (`artifacts.ts:169`) and `docsLayoutUnset()`
(`gather.ts:1169`) were known. The third is **`renderInitConfig`
(`init-write.ts:510`)**, which reads `config.engine?.docs_layout ?? "workstream"`
when echoing the answer back into the file `devx init` writes.

It was missed by every prior count for a specific and instructive reason: the
first version of E-2's scanner stripped comments with
`/\/\*[\s\S]*?\*\//g`, and a comment opener inside a string literal elsewhere
in that file opened a "comment" that swallowed 40 lines — including this one.
The scan reported 2 and GREEN. Only after the scanner moved to TypeScript's
own parser did the third reader appear.

**Consequence for dlr101 (phase 1):** AC 5 says exactly one function reads the
key. That now means routing `init-write.ts:510` through `resolveDocsLayout()`
too, not only deleting `docsLayoutUnset()`. G-2's "exactly one function" is
unchanged; the work to reach it is one site larger.

### 2. Eight orphans confirms the plan, not the PRD

E-2's scan found precisely the set R-9 named: `stageFileRel`, `outlineRel`,
`outlineCritiqueRel`, `humanRel`, `projectAgentRel`, `projectHumanRel`,
`projectOutlineCritiqueRel`, `checkpointsDirAbs`. E-2's own threshold text
("down from 2") remains stale in `expectations.md` by the owner's deferral
decision; the plan and this file carry the real number.

This is also why E-2 is verified in **phase 5**, not phase 1 — an additive
phase gives nothing a caller, so the orphan floor is unsatisfiable there.

### 3. Fifteen hand-joins, not four

E-3's scan flags an expression that *composes a path* from a base and a
stage-subject name — a `join()` with both, or a template where a `/` abuts the
subject. Prose that merely names a subject (`` `${PRD_REL} is missing the ##
Goals section` ``) is deliberately excluded; including it would report ~40
sites and drown the real ones.

The 15:

- **The five the plan named** — `todo-truth.ts:49`, `commands/todo.ts:86`,
  `mark-done.ts:525`, `validate-emit.ts:184`, `outcome.ts:492`.
- **`validate-emit.ts:306`** — the second `PLAN_REL` join, in the regex.
- **`gather.ts:900`** — prints a path that does not exist under
  `project-level`. Correctness, and the plan names it.
- **`render.ts:119,124`** — existing paths with a stray `./`. Cosmetic, and
  the plan names them (T4.8).
- **`gate.ts:360,492,508,548`** and **`outcome.ts:316,335`** — refusal and
  probe strings that compose `workstreamRel` + a subject constant. Phase 2
  owns the `gate.ts` four (T2.2/T2.3); phase 4 owns the `outcome.ts` two.

Every one of the fifteen already falls inside a task in phases 2 or 4. The
baseline was wrong; the plan's coverage was not.

## What this does NOT change

- No E-id is retargeted. Every eval sits at the path the plan's coverage table
  agreed at Gate 3.
- No phase boundary moves.
- `expectations.md`'s stale thresholds stay stale by the owner's 2026-09-01
  deferral (a `devx revise --touched prd` resets all four gate flags). This
  file plus `2026-09-02-deferred-prd-corrections.md` are the non-plan source
  `devx outcome` reads instead.

## Separately filed

`debug-75563d` — Gate 4 never calls `stampEvalShas()`, so the RED eval lock is
inert repo-wide and this workstream lands unstamped. Out of scope here.
