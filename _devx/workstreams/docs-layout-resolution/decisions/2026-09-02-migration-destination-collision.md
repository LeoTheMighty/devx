# Decision — the migration's fourth refusal, and where G-3's verdict lives

**Date**: 2026-09-02
**Phase**: 6 (`devx layout migrate`, dlr106)
**Status**: decided (the ClassyLights verdict below is armed, not yet recorded)

## What happened

The plan names three refusals. Running the migration against a real fixture —
not reading the artifact map — turned up a fourth, and it is the one that
matters most on the platform this repo is developed on.

Under `project-level` the plan artifact's flat name is `plan.md`. Every devx
repo carries a `PLAN.md` backlog at the repo root. On macOS (APFS/HFS+) and
Windows (NTFS) those are the **same path**, so `git mv … plan.md` does not
reliably fail — it targets the backlog. The first real run of the executor
died with `fatal: destination exists` after moving two of twelve files.

Every exact-name predicate in the tree was **correct** and said nothing:
`docSetPresentAt` asks whether a DOC SET is at the destination, and there
genuinely is none. The collision is with a file that is not an artifact at all.
That is why the map could not have shown it and a fixture-only pass would not
have caught it: E-6's fixture is at `stage: plan` with the plan not yet
authored, so it has no `plan.md` to move.

## Decision

`destination-collision` is a refusal, computed in the pure planner alongside
the other three, before any move. It is the behaviour `debug-135dc9` already
assigned to this phase ("dlr106's migration must treat it as a refusal input —
a `git mv … plan.md` would clobber the backlog"), so this record confirms the
obligation rather than inventing a rule.

No `--force`, same as the other three: the two names cannot coexist on the
filesystem, so there is nothing to migrate *into*. The general fix — whether
the flat plan artifact should be named something other than `plan.md` — belongs
to `debug-135dc9`, not here.

## Second finding: the rollback, and the two further ways it stayed broken

`docSetPresentAt` reads a workstream directory's mere **existence** as a doc
set. `git mv` does not remove the directories it empties. So the forward
migration left `_devx/workstreams/<slug>/` behind as an empty shell, and the
reverse migration — the rollback R-5 documents as the ONLY recovery after the
fact — refused with `destination-occupied` forever.

The first fix pruned the directories **derived from the ancestors of moved
files**, and an earlier revision of this record claimed that closed the trap.
It did not. Phase 4's adversarial review found two more paths to the same dead
end, and both are worth recording because both were invisible to the fixture:

1. **Empty directories contribute no move, so an ancestor walk cannot see
   them.** `devx workstream new` scaffolds `decisions/`, `checkpoints/` and
   `evals/` empty, and `checkpoints/` stays empty until the first
   `/devx verify` — which is the shape of *every* mid-flight workstream,
   ClassyLights `b7e38f` included. The one fixture choice that hid this was
   writing a `.gitkeep` into `checkpoints/`. So MV-a494be.1 would have lost its
   rollback on the very repo it exists to migrate.
2. **Files the artifact map cannot name were never planned, never rendered,
   never refused.** A workstream directory also holds `RETRO-<date>.md`,
   `research/`, hand-written notes — six such files/dirs across six workstreams
   in devx's own repo today. The run reported success, moved the artifacts, and
   left the rest in a directory the flat layout has no place for; the source
   directory then survived, and the rollback refused again.

The prune is now walked from the doc-set directory itself, bounded to it and
its descendants — which also fixes an unbounded ancestor climb that deleted a
user's `docs/` under `workstreams_root: docs/planning/ws`. And the doc set,
not the artifact map, is now what the migration enumerates: an unclaimed file
is the `unmapped-doc-set-files` refusal, never silence.

Every one of these came from the same place: running the thing against a real
tree and diffing before/after. None is visible from the types, and none was
caught by E-6 or E-7 — whose fixtures contain only artifact files, which is
exactly the shape that cannot expose them.

## G-3's verdict: armed, not recorded

The fixture proves the mechanism. It cannot prove the migration on a repo devx
does not own, and this record does not claim it does. The real evidence is
`MANUAL.md` **MV-a494be.1** — the ClassyLights `b7e38f` run — which is
cross-repo and irreversible (R-5) and therefore cannot land inside a devx PR.

When that run happens, its verdict is recorded in
`decisions/<date>-classylights-migration.md`. Note that a
`[destination-clash]` refusal there is a **result, not a failure**: it would
mean ClassyLights has authored its plan, and the finding routes to
`debug-135dc9`.

## Postscript: the refusal set as shipped

The plan named three refusals. Eleven codes shipped, and the extra eight are
not scope creep — each is a state the three named refusals let through while a
`git mv` was already underway, found by running the executor rather than by
reading the map:

`two-live-workstreams` · `no-workstream` · `multiple-doc-sets` ·
`destination-occupied` · `destination-clash` · `unmapped-doc-set-files` ·
`destination-outside-repo` · `dirty-tree` · `untracked-sources` ·
`nested-repo-root` · `not-a-git-repo`

Two are worth their own line. `multiple-doc-sets` covers one live workstream
beside N *done* ones: the `>=2 live` rule passes, but under `project-level`
every spec resolves to the repo root, so each done workstream would then read
the migrated one's artifacts as its own — silent aliasing, which is worse than
the orphaning the original refusal was written to prevent. `nested-repo-root`
refuses when `devx.config.yaml` is not at the git top level, because this
command's recovery model is repo-wide (`git reset --hard HEAD`) and a nested
project would put the OUTER repo's uncommitted work inside a rollback's blast
radius.

`destination-clash` also stopped asserting a platform. It now asks the
filesystem whether two spellings are one file, so `--to project-level` is not
permanently blocked on Linux for a reason that is untrue there.
