---
hash: <FRESH 6-hex hash — never the story's; a duplicate under a second type
  dir makes the story itself unresolvable by every by-hash CLI>
type: test
created: <ISO-8601 local time, e.g. 2026-08-07T12:15:00-06:00>
title: "QA walkthrough — <what changed> (<story-hash>)"
from: <path to the story spec this walkthrough documents>
status: ready
owner: null
branch: null
---
# QA walkthrough — Story `<story-hash>`

> <One-sentence scope: what changed, which user-visible surfaces it touches,
> and what this walkthrough deliberately does NOT cover.>

<!-- Emitted by /devx Phase 5 for any story with a user-visible surface, and
     committed with the story in Phase 6. Lives at
     test/test-<new-hash>-<ts>-<story-hash>-qa-walkthrough.md — canonical spec
     form with its OWN fresh hash, never the story's.

     Item contract (parsed by tooling — keep the shape exact):
     - Every check is a checkbox line tagged `machine` or `human`.
     - `machine` = runnable without a human eye. Execute it AT EMISSION,
       check the box `[x]`, and paste the real output into the evidence
       fence. An unchecked machine item is an unfinished walkthrough.
     - `human` = needs eyes, a device, or a judgment call. Leave it
       unchecked and give it a one-line "how to verify:" hint so the
       reviewer can run it without re-reading the diff.
     - Expected output is what PASS looks like; the invariant is why a
       change there is a bug, not a diff. -->

## Pre-flight

```bash
<setup that must succeed before any check below runs — checkout, deps,
services up, seed data, credentials. Each line copy-pasteable.>
```

## Manual checks

### 1. <Behavioral assertion — what must be true, not what to click>

- [ ] `machine` — <the one thing this check proves>

```bash
<exact command>
```

Expected:

```
<the output that means PASS — replaced with the real run at emission>
```

Invariant: <what must stay true here; why a change is a regression.>

### 2. <Behavioral assertion needing a human>

- [ ] `human` — <the one thing this check proves> · how to verify: <where to
  look and what you should see, in one line>

Invariant: <what must stay true here; why a change is a regression.>

## Regressions to watch

- **<Surface that could break silently>.** <Why this story could break it,
  and the fastest way to prove it didn't.>

## Post-merge follow-ups

- <Work this story deliberately left on the table, and who/what picks it up
  — a story hash, a workstream, or "next UI-touching change".>
