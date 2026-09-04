<!-- HUMAN-ONLY. Agents never write this file (PreToolUse hook + `devx outline
     check` in CI + merge-gate). An agent may run `devx outline init` to create
     this scaffold; it never overwrites, so nothing you type here can be lost.

     STRUCTURE — bullet points, nothing else:
       * one thought per bullet, ≤ 12 words, no closing period
         * nest two spaces deeper for the detail that earns its place
       * name things in ticks: `runOutlineInit()`, `src/lib/engine/`, `--all`
       * no paragraphs, no tables, no headings below the title
     EXTREMELY brief is the target — the whole file skimmable in a minute.
     Delete the `<…>` hints as you go. Land it with: devx outline commit -->

# plan outline — <workstream title>

* Phases
  * <one bullet per phase, in order>
* Verification
  * <how each phase is proven — tests-first or tests-alongside>
* Dependencies
  * <what must land first, inside or outside this workstream>
* Risks
  * <the phase most likely to go sideways, and the fallback>
