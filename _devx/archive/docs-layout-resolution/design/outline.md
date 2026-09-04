<!-- HUMAN-ONLY. Agents never write this file (PreToolUse hook + `devx outline
     check` in CI + merge-gate). An agent may run `devx outline init` to create
     this scaffold; it never overwrites, so nothing you type here can be lost.

     STRUCTURE — bullet points, nothing else:
       * one thought per bullet, ≤ 12 words, no closing period
         * nest two spaces deeper for the detail that earns its place
       * name things in ticks: `runOutlineInit()`, `src/lib/engine/`, `--all`
       * code is EXCERPTS only — a signature or a call, never a block
       * no paragraphs, no tables, no headings below the title
     EXTREMELY brief is the target — the whole file skimmable in a minute.
     Delete the `<…>` hints as you go. Land it with: devx outline commit -->

# design outline — <workstream title>

* Shape
  * <the pieces, and how they connect>
* Seams
  * <where it plugs into existing code — `path/file.ts`>
* Data
  * <the types/state that move — `type Foo = { … }`>
* Failure modes
  * <what breaks, and what happens then>
* Rejected
  * <the alternative, and the one reason it lost>
* Non-goals
  * <what this design deliberately leaves alone>
