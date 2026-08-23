# Design — <workstream title>

<!-- Stage: Design. Gate: `devx gate coverage <hash>` (design mode — one
     tri-state row per G-/UC-/CAP-/FR- ID in prd.md). Hard rule: don't plan
     here. No phases, no tasks — design is the approach, not the sequence. -->

## Overview

- **Objective**: <one paragraph — what this design achieves>
- **Solution**: <one paragraph — the shape of the approach>

## Constraints

- <hard limits: platform, compatibility, perf, cost>

## Risks

- <risk> → <mitigation> → proven by <E-id>

## Trade-offs

- <chose X over Y because Z>

## Out of scope

- <what this design deliberately does not address>

## Assumptions

- <what we're taking as given; each is a revision trigger if it breaks>

## Discarded considerations

- <approach considered and rejected, with the one-line why — saves the next
   reader from re-deriving it>

## Wrap, don't duplicate

<!-- devx working agreement: wrap existing endpoints/tools/modules; never
     re-implement business logic that already exists. List what this design
     reuses and what it genuinely adds. -->

- Reuses: <existing modules/endpoints, with paths>
- Adds: <the genuinely new surface>

## Design

### Architecture

<components + responsibilities + how they compose; cite real code paths
(engine.code_citation_hints) — every cited path must exist>

### Interfaces

<API/CLI/function surfaces: name, inputs, outputs, errors>

### Data

<stores, schemas, migrations, retention>

## Migration plan

<how the world moves from current to desired without breaking; N/A for
greenfield>

## Resolved design questions

- <question> → <answer + where decided>

## Unresolved design questions

- <question> — <who/what resolves it; blocks Gate 2 only if a P0 depends on it>
