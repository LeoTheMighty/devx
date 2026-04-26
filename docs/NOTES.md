# Notes — Leonid's working scratchpad

This is a low-friction inbox. Drop thoughts here; they get absorbed into the formal docs in batches.

---

## Pending (not yet absorbed)

(none — current batch absorbed 2026-04-25 PM)

---

## Absorbed 2026-04-25 PM

### Agent flow diagram
> I want to get a really cool diagram showing how everything flows into everything else. PlanAgents create DEV entries or FOCUS_GROUP entries; DevAgents execute then create TEST entries or go back to PLAN entries. Seeing this and having a solid graph of what this flow looks like would help out a lot.

→ Absorbed into [`DESIGN.md § Agent flow graph`](./DESIGN.md#agent-flow-graph). ASCII diagram covers user→PLAN→DEV→TEST/DEBUG→retros→LESSONS, plus the FocusAgent feedback edge. Mobile Activity tab and `focus-group/index.md` will render the same shape.

### "Send it" / "Just do it" CLI
> There's some "Just do it" or "Send it" LLM cli that I'm completely forgetting the name of.

→ Absorbed as research item in [`OPEN_QUESTIONS.md § Q33`](./OPEN_QUESTIONS.md). Candidate list: aichat --yolo, opencode (sst), plandex, goose, llm + llm-cmd, aider --yes-always. Action: web-research pass before next planning pass.

### Levels of thoroughness
> Want levels of thoroughness here. My current approach is very research-thorough, but some might want to use fewer tokens and just send it.

→ Absorbed into [`DESIGN.md § Thoroughness levels`](./DESIGN.md#thoroughness-levels) as a third orthogonal axis (alongside Mode and Project Shape). Three tiers: `send-it`, `balanced` (default), `thorough`. Independent of mode but stacks (`YOLO + send-it`, `PROD + thorough`, etc.). New `devx.config.yaml → thoroughness:` knob with per-command and per-spec overrides.

---

## Absorbed 2026-04-25

### Self-healing as a separate retro loop
> Self-healing could be in a separate agent loop as well: every time we finish a dev/dev-plan we do a little retrospective on the story file, then a RetroAgent looks across many retros and only updates skills after seeing concordant patterns.

→ Absorbed into [`SELF_HEALING.md § Two-stage loop`](./SELF_HEALING.md#two-stage-loop-retroagent--learnagent). New `retros/` directory; RetroAgent runs per-completion; LearnAgent now requires ≥3 concordant retros (Q29) before proposing changes.

### Story-derived QA
> QA steps made by the stories could be really helpful here, already happens by default but we don't really do anything with it. Feels like making a really solid flow chart would be helpful to figure out here.

→ Absorbed into [`QA.md § Story-derived QA`](./QA.md#story-derived-qa-the-load-bearing-flow-we-were-ignoring) with a flow chart. `/dev` Phase 6 now auto-files `test/test-*-qa-walkthrough.md` from each story's QA section. TestAgent prefers those as top priority. FocusAgent ingests them as exploratory persona prompts. Open question Q30 covers the auto-translation grading.

### Bug — agent rip-through during CI wait
> Noticing a bug where it will wait for CI and then in another agent will just fucking rip through even when I don't want it to, scheduled a task and messed up things.

→ Absorbed into [`DESIGN.md § Agent coordination primitives`](./DESIGN.md#agent-coordination-primitives-preventing-the-rip-through-race). New `.devx-cache/locks/` files (`triage.lock`, `spec-<hash>.lock`, `ci-wait-<branch>.lock`). `/dev` Phase 7 now mandates holding `ci-wait` for the duration of CI poll. Triage reads locks + intents before spawning. Q31 tracks the integration test we still owe.

### Project shapes (the 5 categories)
> Empty directory; bootstrapped-but-rewriting; complete-minor-refactors; complete-fine-with-rewrites; production-careful.

→ Absorbed into [`DESIGN.md § Project shapes`](./DESIGN.md#project-shapes-orthogonal-to-mode). New axis orthogonal to MODES. Five shapes mapped: `empty-dream`, `bootstrapped-rewriting`, `mature-refactor-and-add`, `mature-yolo-rewrites`, `production-careful`. `/devx-init` is now 8 questions (added Q4 for shape). DevAgent reads both `mode` and `project.shape` and combines them. Open question Q32 covers nonsensical mode×shape combinations.

---

## Notes on absorption hygiene

- Items here are raw. Half-thought is fine. Profanity is fine.
- Absorption pulls quotes verbatim into the doc updates so traceability is intact.
- After absorption, items move down to the "Absorbed" section with a date + link to where they landed.
- Items >30 days old in "Pending" become a `MANUAL.md` reminder to either absorb or delete.
