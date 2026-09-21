---
hash: ed8f8d
type: debug
created: 2026-09-21T13:30:00-06:00
title: "Three hash resolvers disagree on a hash duplicated within one spec dir"
from: debug/debug-7d96be-2026-09-20T10:21-claim-type-resolution-inconsistent.md
spawned: []
status: ready
owner: null
branch: null
---

## Goal

When one spec dir holds two files for the same hash, every hash resolver in
devx gives the same answer. Today three give three different answers.

## Evidence

From the retroactive three-agent review of PR #167 (7d96be), Edge Case
Hunter, finding B. Tiebreak verified with a fixture; the disagreement across
the three is from reading the code.

Given `dev/dev-dup111-…-aaa.md` and `dev/dev-dup111-…-zzz.md`:

| Resolver | Behaviour on a same-dir duplicate |
|---|---|
| `engine/frontmatter.ts` `findSpecForHashIn` / `findSpecForHashInFs` — used by claim, verify-claim, mark-done, split, finalize | silently picks the lexicographic **minimum** (`-aaa`), no warning |
| `manage/loop.ts:503` `resolveSpecPath` — manager's `blockSpecFile` | silently picks the lexicographic **maximum** (`-zzz`) |
| `doctor/detect.ts:155` `buildSpecIndex` | marks the hash **ambiguous** (`null`) |

So for one hash, claim and mark-done write to the oldest file, the manager
writes its block to the newest, and doctor calls it unresolvable.

7d96be's AC 2 already settled the principle for the *cross*-dir case — an
ambiguous hash gets a typed refusal naming both paths, never a silent pick.
The same-dir case was never covered, so the loop's resolvers still pick.

`resolveSpecPath` is also the "sixth resolver" the #167 review was asked
to hunt for. It is **not** a sixth dev-defaulting consumer — it takes its type
from the backlog row's path, so the type is right. It was missed by 7d96be's
AC 3 audit because it is a hand-rolled resolver rather than a type default.

## Blast radius today

Latent. A scan of every spec in devx and palateful found no hash duplicated
within a dir (or across dirs). This fires on the first one.

## Acceptance criteria

- [ ] `findSpecForHashIn` / `findSpecForHashInFs` treat two files for one
      hash in one dir as ambiguous — the same typed refusal as the cross-dir
      case, naming every path — instead of picking the minimum.
- [ ] `manage/loop.ts` `resolveSpecPath` delegates its fallback to the shared
      resolver rather than keeping its own `readdirSync` and max tiebreak.
- [ ] doctor's `buildSpecIndex` and the shared resolver agree (they
      already would, once the first AC lands).
- [ ] Tests: a same-dir duplicate refuses in claim and in the manager path.

## Technical notes

- **Check what is currently succeeding first.** Turning a silent pick into
  a refusal is a silent-to-loud change. Before landing it, confirm no
  in-flight spec is being resolved by the pick today — the scan above says
  none, but re-run it at implementation time.
- Deliberately not fixed in the #167 fix-forward PR: the coordinator asked
  for it to be filed, and it is a behaviour change to the manager, a
  component that PR does not otherwise touch.

## Status log

- 2026-09-21T13:30 — filed from the retroactive review of PR #167.
