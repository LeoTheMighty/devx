<!-- human.md — the succinct human-readable digest of this stage. Mermaid
     first, prose second; every diagram must carry real content, not
     decoration. When <stage>/outline.md exists its structure IS this file's
     structure (the outline dictates the shape; agent.md keeps the gate
     sections). Refreshed by the stage before its gate runs. -->

# design — <workstream title> (human digest)

## Reading guide

<!-- MANDATORY on every design human render (ported from 8am-harness §31).
     An annotated table of contents that doubles as an audience map. A
     reviewer arrives with two questions before any technical one: what is
     the SHAPE of this document, and which parts am I responsible for. This
     answers both on the first screen.

     Rows, in order: Overview → each `###` mechanism under `## Design` in
     outline order → Migration plan → the scope sections, grouped into one
     row joined by `·`. Two levels max — `####` sub-parts are allowed only
     when they share their mechanism's audience; the moment sub-parts want
     different readers they are separate mechanisms, split at `###` where
     each earns its own row.

     "What it covers" is the QUESTION the section answers, derived from its
     outline bullet — not a teaser.

     Marks: ● read before signing off · ○ useful context · blank = skip.
     A role scans its own column and has its reading list.

     Columns come from `devx.config.yaml → engine.reading_guide_roles`
     (default: the plan-stage critique lenses — pm, architect, dev, qa — so
     the document is mapped in the vocabulary the repo already uses). Columns
     are the scarce resource: drop one that would carry no ● outside
     Overview.

     Structural sync is checked mechanically by `checkReadingGuide()` — every
     row must name a real heading in THIS file, and every `###` mechanism in
     agent.md must have a row. The audience marks are judgment and stay
     advisory. Replace the rows below; the shape to copy is:

       | Overview        | what this solves            | ● | ● | ● | ● |
       | Token bucket    | how spend is bounded        |   | ● | ● | ● |
       | Migration plan  | how today's state gets there| ○ | ○ | ● | ○ |
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
