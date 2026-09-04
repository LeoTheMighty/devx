<!-- OUTLINE.md — the project-wide outline. HUMAN-ONLY (PreToolUse hook +
     `devx outline check` in CI + merge-gate). An agent may run
     `devx outline init --project` to create this scaffold; it never
     overwrites, so nothing you type here can be lost. The agent reads it as
     seed context at every PRD stage and critiques it in OUTLINE-CRITIQUE.md.

     STRUCTURE — bullet points, nothing else:
       * one thought per bullet, ≤ 12 words, no closing period
         * nest two spaces deeper for the detail that earns its place
       * name things in ticks: `devx next`, `src/lib/engine/`, `main`
       * no paragraphs, no tables, no headings below the title
     EXTREMELY brief is the target — the whole file skimmable in a minute.
     Delete the `<…>` hints as you go. Land it with: devx outline commit -->

# project outline

* What this is
  * <the one-line pitch, in your words>
* Who it is for
  * <the user, and what they do instead today>
* Invariants
  * <what must never break, however the code moves>
* Boundaries
  * <what this project is deliberately not>
* Vocabulary
  * <the words this repo uses oddly, defined once>
