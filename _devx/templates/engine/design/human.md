<!-- human.md — the succinct human-readable digest of this stage. Mermaid
     first, prose second; every diagram must carry real content, not
     decoration. When <stage>/outline.md exists its structure IS this file's
     structure (the outline dictates the shape; agent.md keeps the gate
     sections). Refreshed by the stage before its gate runs, held to
     docs/RENDER-STYLE.md (`devx render lint <hash> design`). -->

# design — <workstream title> (human digest)

## Reading guide

<!-- MANDATORY on every design render (8am-harness §31): a table of contents
     that doubles as an audience map. Rows, in order: Overview → each `###`
     mechanism under agent.md's `## Design`, outline order → Migration plan →
     the scope sections as one `·`-joined row. `####` parts only when they
     share their mechanism's readers; else split at `###`, a row each.
     "What it covers" is the QUESTION the section answers, not a teaser.
     Marks: ● read before signing off · ○ useful context · blank = skip.
     Columns: `engine.reading_guide_roles` (default pm, architect, dev, qa);
     drop one with no ● outside Overview. `checkReadingGuide()` checks every
     row names a heading here and every mechanism has a row; marks are
     judgment. Footnotes? Add under the table: "A superscript number links
     to the section that owns that fact." Shape:

       | Token bucket    | how spend is bounded        |   | ● | ● | ● |
       | Constraints · Assumptions · Out of scope · Discarded | the edges | ○ | ○ | ○ | ○ |
-->

| Section | What it covers | pm | architect | dev | qa |
| --- | --- | :-: | :-: | :-: | :-: |
| Overview | <the problem this solves, in one line> | ● | ● | ● | ● |
| Architecture | <what shape, and why this shape> | ○ | ● | ● | |
| Interfaces | <what talks to what, across which seam> | | ● | ● | ○ |
| Data | <what is stored, and what changes about it> | | ● | ● | ○ |
| Migration plan | <how today's state gets to the new one> | ○ | ○ | ● | ○ |
| Risks | <what could go wrong, and who accepts it> | ● | ○ | ○ | ● |

## Overview

<!-- One paragraph. What this is and why it exists. -->

## Architecture

## Interfaces

## Data

## Migration plan

## Risks

<!-- The three mechanism headings above mirror agent.md's standing `### mechanisms`, so
     the scaffold ships structurally in sync with its own Reading Guide. When
     design/outline.md exists ITS structure wins: rename, split, or drop
     these, and re-derive the guide rows in the same pass — a row that
     outlives its section is the one failure the mechanical check exists to
     catch. -->
