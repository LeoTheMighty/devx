---
hash: d982ea
type: dev
created: 2026-09-20T10:37:00-06:00
title: "Warn at filing time when a new spec substantially overlaps an open one"
from: null
spawned: []
status: ready
owner: null
branch: null
---

## Goal

Two sessions that cannot see each other file the same bug minutes apart,
and nothing notices.

palateful's `imptb1` and `imptab1`: same surface, same three failing
tests, hashes one character apart, filed **three minutes apart** (18:50
and 18:53). `imptab1` was root-caused and fixed that evening. `imptb1`
stayed open and unowned for seven weeks, until a tab was dispatched
against it on 2026-09-20 and had to be stood down.

The signal was already in hand. Both rows were in the same backlog file
three minutes apart; nothing compared them.

**It recurred the same day, and the second instance is the real
argument.** On 2026-09-20 palateful-fb and palateful-2d independently
filed the identical bug — `wsmig1` and `debug-09451f`, for one
pre-existing red in `workstream-migration-integrity` — **within the
hour**. The coordinator had asked fb to file it and never told 2d it was
taken. 2d folded the duplicate on discovery.

So the case does not rest on a seven-week lapse in a quiet backlog. It
recurred **under a coordinator actively watching for exactly this class
of failure**, on the day the class was being catalogued. Attention was
present, engaged, and specifically primed — and still did not catch it.
That is the argument that the control has to fire mechanically at filing
time: this is not a vigilance problem that more vigilance fixes.

`devx next` already parses every backlog row and its spec. A warning at
filing time — when a new spec's title, or a test path it cites,
substantially overlaps an open row — costs one comparison against data
already loaded.

## Acceptance criteria

1. At spec-filing time, a new spec whose title or cited test/file paths
   substantially overlap an **open** row (`[ ]` / `[/]` / `[-]`, never
   `[x]` or struck) produces a warning naming the other hash and what
   matched.
2. It **warns, never blocks**. Two genuinely distinct specs can share a
   surface, and a filing path that refuses is worse than the duplicate
   it prevents. No gate, no exit code change.
3. The overlap predicate is stated and testable, not a similarity score
   tuned by feel. Start with the cheap signals the `imptb1`/`imptab1`
   pair would have tripped: shared cited test/file paths, and normalized
   title token overlap above a threshold. Record what it would have
   caught and what it would have missed against the existing corpus.
4. Measured false-positive rate against the real backlogs before the
   threshold is fixed. A warning that fires on every retro spec, or on
   every spec in an epic that shares a surface by design, is noise and
   will be ignored into uselessness — which is the failure mode this
   repo spent 2026-09-20 cataloguing.
5. Runs off data `devx next` already loads. No new store, no runtime
   component, no scheduled job.
6. Full suite green; `npm run typecheck` clean.

## Technical notes

Deliberately scoped to *warn at filing*, not *detect duplicates at
rest*. A repo-wide duplicate sweep is a bigger and much noisier surface;
the value here is the three-minute window, where one line of output
reaches someone who is still holding the context.

Where this sits relative to `plan-4c827d` (detector discrimination): it
is **not** a proxy misread — nothing measured the wrong thing, nothing
was measured at all. It belongs to that item's group 3 ("no detector
exists"), and it is deliberately **not** carried there as a specimen:
group 3 is explicitly out of that plan's scope, and the item already
refuses to absorb adjacent problems. Filed here instead, as its own
cheap concrete story.

### Cost, honestly

The originating session called this "the one that cost the most today."
It did not. The realized cost was one wasted dispatch, which that tab
converted into PR #26 and a follow-on story — so it was small and partly
recovered. The 51-day deploy freeze and the 50-for-50 blind check cost
far more.

The defensible claim is different and better: **cheapest fix with the
longest tail.** Seven weeks of an open duplicate row is a small
continuous tax on every triage pass that reads it, and the fix is one
comparison over data already in memory.

## Status log

- 2026-09-20T10:37-06:00 — filed. Proposed by palateful-0e via the
  coordinator session, from the `imptb1`/`imptab1` pair. Cost framing
  corrected at filing (see Technical notes) — the originating "cost the
  most today" claim does not survive comparison with the freeze or the
  blind check, and the story is justified on tail rather than magnitude.

## Links

- Proposed by: palateful-0e via coordinator session `leonidbelyi-41`,
  2026-09-20.
- `plan/plan-4c827d-2026-09-20T10:11-detector-discrimination.md` —
  group 3; scoped out of that item on purpose.
