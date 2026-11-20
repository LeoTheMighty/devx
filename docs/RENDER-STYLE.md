# RENDER-STYLE.md — the bar for a stage's human digest

A stage's `human.md` (`design-human.md` under `engine.docs_layout:
project-level`) is the page a person reads; `agent.md` carries the depth the
gates need. This file is the bar the digest is held to. `devx render lint
<hash> <stage>` (`src/lib/engine/render-lint.ts`) measures the rules a program
can measure, the same numbers on every run; the rest are reviewed.

Ported from 8am-harness's `RENDER-STYLE.md` (gap analysis rows B9 / C16 / D6 /
E3) without its wiki-renderer and company-language rules. Its premise stands
unchanged: **the more you write, the less people read.** The digest says what
the design *is*, in the fewest words that drop nothing load-bearing, with
every fact stated once and pointed at from everywhere else.

---

## The rules

| # | Rule | Lint rule(s) |
| --- | --- | --- |
| R1 | **WHAT, not WHY.** State the current design; rationale is a decision-record link. Prose that comments on its own importance goes too | `why-heavy`, `old-design`, `meta-prose` |
| R2 | **Only what changes.** No restating how an existing tool already works, no "No X / Never X" unless the absence is the change, no narration of the old design | `non-change`, `old-design` |
| R3 | **One home per fact; footnotes point at it.** A fact lives in the section that owns it; every other mention is a superscript jump — never a restatement, never "(see X)" | `inline-crossref`, `duplicate-phrase`, `restated-fact`, `footnote-*` |
| R4 | **A section says what it owns.** A table column another section owns (Failure, Why, Rationale) is deleted, not trimmed | `duplicate-column` |
| R5 | **Nested bullets over paragraphs; a sub-heading per thing.** Headline on the bullet, context indented under it; a paragraph covering several things splits into `###` parts | `paragraph-length`, `bullet-length`, `section-length` |
| R6 | **A table cell is a phrase.** Tables are for scanning — ≤ 20 words a cell, 40 is the hard stop | `table-cell-length` |
| R7 | **Name the concrete thing.** `resolveWorkstream()`, not "the resolver"; every file and key says *new* or *existing* | reviewed |
| R8 | **Don't re-specify what exists.** An existing module, key or file is named, not described — only its *change* appears | reviewed |
| R9 | **Budgets** (below). A Decision log stays a links-only index, one line a row | `total-length`, `overview-length`, `section-length`, `decision-log-row` |
| R10 | **No engine apparatus.** No `E-N` / `G-N` / `UC-N` / `CAP-N` / `FR-N`, no `§` citations, no gate numbers — write the thing the ID names | `apparatus-leak` (HARD) |
| R11 | **Diagrams label existing vs new.** Every node in an architecture flowchart says which it is | reviewed |
| R12 | **A contested mechanism is presented as options, not deep-designed.** Two short option sub-sections and an open question naming who decides | reviewed |
| R13 | **A footnote's destination is marked.** The section a footnote jumps to carries `<sup>[n]</sup>` as its first line | `backref-missing`, `backref-place`, `backref-mismatch` (HARD) |

### Budgets

Prose words exclude the Reading guide, a Decision log, a Glossary, HTML
comments (template guidance never renders), and every fenced block (a
diagram's source is not prose). The budget unit is a `##` section with its
children — a devx digest puts each mechanism at `##`; a `## Design`
container budgets each `###` under it instead.

| Unit | Target | Hard stop |
| --- | --- | --- |
| Whole render | ≤ 4,000 words | 5,000 |
| Overview | ≤ 200 | — |
| Each section | ≤ 350 | — |
| Paragraph | ≤ 80 | — |
| Bullet (own text; nested children excluded) | ≤ 40 | — |
| Table cell | ≤ 20 | 40 |
| Decision log row (the decision cell) | ≤ 20 | — |
| Footnotes | ≤ 2.5 per 100 prose words | — |

`RENDER_BUDGETS` in `render-lint.ts` is the one copy of these numbers; this
table mirrors it. The ratio to `agent.md` is reported, never judged — an
absolute budget is what a reader feels.

---

## Footnotes — the one form

```markdown
…resolved through the artifact map<sup>[3](#the-artifact-map)</sup>.
```

- **Form:** `<sup>[n](#section-slug)</sup>`, the slug as GitHub mints it
  (lowercase, punctuation dropped, each space a `-`, so `&` leaves `--`).
  Nothing else — no `[^n]` end-notes, no notes list, no "(see X)".
- **Numbering:** document-global, first-appearance order, **one number per
  target section** — `³` means the same section every time. `devx render lint
  <hash> <stage> --renumber` rewrites them.
- **Placement:** directly after the phrase a reader would want explained;
  the sentence carries no restatement of the fact.
- **A target is a heading on the page.** A fact with no owning section earns
  one, or stays in `agent.md` — the digest grows no notes appendix.
- **The Reading guide glosses the convention once:** *"A superscript number
  links to the section that owns that fact; that section carries the number,
  so a jump shows where it landed."*

### The destination carries a back-reference (R13)

```markdown
## The artifact map
<sup>[3]</sup>

One union and one function own every path decision…
```

The owning section's first body line is `<sup>[n]</sup>` — the same number,
no link. Never inside the heading (it would change the slug the footnote
targets). One marker per destination; a marker whose number matches no
footnote into its section is a dead signpost, HARD like a misnumbered
footnote.

---

## Before / after — from this repo's own renders

**R1/R2 — current design, not its history** (`docs-layout-resolution`
design digest, The artifact map)

> *Before:* **The blast radius is ~15 modules and 40+ sites**, and this design
> said "two consumers, both dissolve" in an earlier draft. That was wrong by an
> order of magnitude. Stated honestly: …
>
> *After:* `- **Blast radius** — ~15 modules, 40+ sites` — the correction is a
> decision record, linked from the Decision log.

**R3 — one home per fact** (same digest; Overview and Guard discrimination
both state it)

> *Before (Overview):* …and a discriminator on three guards that currently
> read a root `prd.md` as proof of an unmigrated repo.
>
> *After (Overview):* …and a discriminator on three
> guards<sup>[5](#guard-discrimination)</sup>. The fact lives once, under
> Guard discrimination.

**R10 — no apparatus** (same digest, nine times)

> *Before:* **11 union variants render as the §15 table's 13 rows**
>
> *After:* **11 union variants render as the docs-layout table's 13 rows** —
> or a link to `docs/CONFIG.md`, which a reader can follow.

**R5 — headline on the bullet** (same digest, Closing the remaining bypasses,
a 61-word bullet)

> *Before:* `- **validate-emit.ts:184,306** — the hardest, because the layout
> changes the shape of the claim being validated, not just a path. Under …`
>
> *After:*
> ```markdown
> - **`validate-emit.ts`** — the layout changes the claim's shape, not just a path
>   - under `project-level` the plan is `plan.md` and the marker `.`
>   - probe and matcher read one resolver, so emitter and validator agree
> ```

---

## The shape of a mechanism

```markdown
## <Mechanism>

<One sentence: what it is.> <One sentence: the flow, arrows allowed.>

- **<Part>** — <what it does, one line>
  - <context a reader needs, one line each>
- **<Part>** — …<sup>[n](#owning-section)</sup>

### Failure handling            ← only when the mechanism has failure classes
- **<Class>** — <disposition>
```

Diagrams stay — they are the cheapest words on the page. Code fences are a
last resort, never a whole payload where a table of fields carries it.

---

## Running the check

```sh
devx render lint <hash> design            # text report: metrics block, then findings
devx render lint <hash> design --json     # the same, machine-readable
devx render lint <hash> design --renumber # fix footnote numbers in place, then lint
```

- **Exit codes** follow the engine convention: `0` no HARD finding
  (advisories may stand), `1` at least one HARD finding, `2` could not check
  (usage, unknown hash, no digest). Upstream exits 2 on HARD; devx keeps 2 for
  "fix the invocation", so a caller can tell it from "fix the page".
- **`/devx-plan` rule 9** runs it after writing a stage's digest and before
  that stage's gate, and fixes every HARD finding; advisories are fixed where
  they can be.
- **Gates never run it.** A human digest is not a gate input
  (`test/outline-isolation.test.ts` pins that firewall), so the bar is the
  stage's own discipline, not a verdict.

HARD findings: `total-length` over the hard stop, `table-cell-length` over
40, `apparatus-leak`, `footnote-form`, `footnote-target` (a dead jump),
`footnote-numbering`, `backref-mismatch`. Everything else is advisory — the
tool points, the author decides.

**Not ported from upstream, on purpose:** the 3-space bullet-nesting rule and
the heading-anchor character rule (both exist for a wiki renderer devx does
not publish to), the status-code / size-limit "contract detail" rule (written
for web-service designs), and every company-language rule.

**Calibration.** On the one design digest this repo has shipped
(`_devx/archive/docs-layout-resolution/design/human.md`, 2,831 prose words,
written before this bar existed) the lint reports 31 HARD — every one an
apparatus leak (`§15` ×9, E-/G-/UC-/FR- IDs) — and 15 advisories: two
sections over 350 words, five long bullets, two long paragraphs, four
"earlier draft" history lines, one restated fact, one why-heavy section. The
five judgment hits (history lines, restated fact) were read against the source
and are real; the rest are measurements. The first run also flagged a risk
table's "Why it matters" column as a rationale copy — it is the impact
column, so `duplicate-column` now matches whole cells only. Archived digests
are never re-gated, so none of this is a debt to pay down.
