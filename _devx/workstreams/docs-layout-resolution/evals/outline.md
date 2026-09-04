<!-- HUMAN-ONLY. Agents never write this file (PreToolUse hook + `devx outline
     check` in CI + merge-gate). An agent may run `devx outline init` to create
     this scaffold; it never overwrites, so nothing you type here can be lost.

     STRUCTURE — bullet points, nothing else:
       * one thought per bullet, ≤ 12 words, no closing period
         * nest two spaces deeper for the detail that earns its place
       * name things in ticks: `E-3`, `test/outline-guard.test.ts`, `--all`
       * no paragraphs, no tables, no headings below the title
     EXTREMELY brief is the target — the whole file skimmable in a minute.
     Delete the `<…>` hints as you go. Land it with: devx outline commit -->

# evals outline — <workstream title>

* Expectations to prove
  * <one bullet per E-* that must go RED first>
* Observed how
  * <the signal that says pass/fail — not the implementation>
* Fixtures
  * <the data or repo state each one needs>
* Out of scope
  * <what stays unproven here, and why that is fine>
