---
hash: d315b9
type: debug
created: 2026-09-21T12:05:00-06:00
title: "A merge through `gh pr merge` leaves the deployed devx behind main, and the only signal is a warning everyone has learned to strip"
from: debug/debug-2e1174-2026-08-21T16:05-blocking-pass-timeout-headroom.md
status: ready
owner: null
branch: null
---

## Goal

When a fix is merged to `main`, the `devx` every session actually runs
should either carry that fix or refuse to pretend it does. Today it does
neither: it keeps running the old build and prints a one-line warning that
is routinely ignored — and, in at least one session, filtered out by
construction.

## What happened (2026-09-21, measured)

- `dist/cli.js` in the main checkout was built at **10:24** by a `finalize`
  of 828385.
- #167 (7d96be — claim resolves any spec type) and #168 (D-14) were then
  merged by the coordinator session via **`gh pr merge`**, which does not
  run `finalize`, and `finalize` is the only thing that rebuilds `dist/`.
- So #167 was **merged but not deployed**. Proven by behaviour, not by
  timestamps: `devx devx-helper claim 2e1174` with no `--type` failed
  exactly the pre-#167 way — `no spec file found at …/dev/dev-2e1174-*.md`,
  exit 2 — on a binary whose own source on `main` said it should succeed.
- After a manual `npm run build:swap` at 11:35:40, `devx devx-helper
  verify-claim 2e1174` with no `--type` resolved the debug spec, exit 0.
  That is the fix arriving an hour after its merge, because someone noticed.

## The signal existed and did not work

`src/cli.ts:179-195` (`isBuildStale` → `staleBuildWarning`) printed a
stale-build warning on **every** `devx` invocation for that whole hour. It
changed nothing, for two different reasons, and the second is the sharper:

1. **Habituation.** The coordinator session reports reading straight past
   it for hours. Same cost cc raised about `f83b04`'s dead-owner noise: a
   warning that fires on every call is read as decoration.
2. **Filtered by construction.** The session that found this (palateful-fb)
   piped nearly every `devx` call that day through `grep -v "^devx: "` to
   get clean JSON — which strips exactly this warning, because it shares the
   `devx: ` prefix with ordinary chatter. It saw the warning only on the one
   call where it used `cat` instead. **The warning was not ignored; it was
   never shown.** Any agent that post-processes CLI output will do the same,
   and agents are the primary users.

A signal that shares its channel and its prefix with noise will be filtered
with the noise. That is a design property, not an operator failing.

## Acceptance criteria

- [ ] AC 1: A merge to `main` of a change under `src/` results in a rebuilt
      `dist/` without anyone remembering to run `finalize` — e.g. the merge
      path rebuilds, or `devx` rebuilds (or swaps) on first invocation after
      detecting staleness. Pick one; say why.
- [ ] AC 2: If a stale build is ever *run* (the rebuild failed, or was
      skipped), it is **not** a line of stderr sharing the `devx: ` prefix.
      Either the command refuses for mutating subcommands (claim, mark-done,
      finalize, split), or staleness is carried **in the structured
      output** — a field in the JSON every caller already parses — so a
      pipeline that keeps the JSON keeps the signal.
- [ ] AC 3: Regression test: a build older than HEAD running a mutating
      subcommand either refuses or reports staleness in the JSON payload;
      and `grep -v "^devx: "` applied to its output does NOT remove the
      signal.
- [ ] AC 4: Read-only subcommands keep working on a stale build — refusing
      `verify-claim` or `next` would turn a deploy lag into an outage.

## Technical notes

- `build:swap` is the atomic rebuild `finalize` already uses; the
  coordinator ran it by hand, after first confirming no peer was mid-work in
  the main checkout. Any automatic version of AC 1 has to preserve that
  property — swapping `dist/` under a session holding uncommitted work is
  the hazard 4f's untracked-spec lesson recorded.
- Relationship to `plan-4c827d` / `inert1`: this is a detector that *fires
  correctly* and still informs no one, because of where its output lands.
  Same family as AC 5 of `inert1` ("output lands somewhere consumed").

## Status log

- 2026-09-21T12:05 — filed at the coordinator's request, from 2e1174's
  claim. Found because a claim that #167 should have made succeed failed
  the old way; confirmed by behaviour before and after a manual swap.
  Includes the filer's own contribution to the miss (the `grep -v` filter).
