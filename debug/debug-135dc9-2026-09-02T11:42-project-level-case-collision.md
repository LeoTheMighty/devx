---
hash: 135dc9
type: debug
created: 2026-09-02T11:42:00-06:00
title: "project-level artifact names collide with devx's own root backlogs on case-insensitive filesystems"
from: dev/dev-dlr104-2026-09-02T09:14-consumer-sweep-scaffolding.md
status: ready
owner: null
branch: null
---
## Goal

Under `engine.docs_layout: project-level` the doc set sits at the repo root
beside devx's own backlog files. `plan.md` (the plan artifact) and `PLAN.md`
(the planning backlog) differ only in case — and macOS (APFS/HFS+, default) and
Windows (NTFS, default) are case-INSENSITIVE. Every `fs.existsSync()` probe for
`plan.md` therefore answers TRUE on a repo that has only `PLAN.md`.

Expected: a probe for the `project-level` plan artifact answers false until an
agent authors `plan.md`.

## Repro

Found while implementing dlr104 — the doc-set probe refused UC-1 on every
invocation because it saw `PLAN.md` as the plan artifact:

```bash
R=$(mktemp -d) && cd "$R"
mkdir -p plan _devx/templates
cp -R <devx>/_devx/templates/engine _devx/templates/
printf 'mode: YOLO\nengine:\n  workstreams_root: _devx/workstreams\n  docs_layout: project-level\n  expectations_min: 3\n' > devx.config.yaml
printf '# PLAN\n' > PLAN.md          # devx's own planning backlog
node -e 'console.log(require("fs").existsSync("plan.md"))'   # -> true, on macOS
```

### Verified escalation: it is a WRITE hazard, not only a read one

Confirmed on macOS while writing dlr104's tests. In a repo holding `PLAN.md`:

```
writeFileSync("<root>/plan.md", "# Plan\n")
readdirSync("<root>")          -> [..., "PLAN.md", ...]   # NO plan.md entry
readFileSync("<root>/PLAN.md") -> "# Plan\n"              # the backlog is GONE
```

The directory entry keeps its original name and the planning backlog's content
is replaced. So authoring the `project-level` plan artifact in a repo that has
a `PLAN.md` destroys the backlog silently. dlr104's tests document this rather
than exercise it (`test/engine-layout-scaffold.test.ts`, the row-8 case).

## Acceptance criteria

- [ ] AC 1: A repro test pins the behavior, and is written so it is meaningful
      on a case-SENSITIVE filesystem too (Linux CI) — assert against the
      resolver's answer, not against `existsSync`, or the test passes
      vacuously in CI and fails only on the maintainer's laptop.
- [ ] AC 2: Root cause documented: which probes ask `fs.exists` for a
      `project-level` artifact whose name case-collides with a root backlog.
      The known colliding pair is `plan.md` / `PLAN.md`; check every other
      root file devx owns against `ArtifactKind`'s full name set as it stands
      after dlr105 (`DEV.md`, `LEARN.md`, `GRAPH.md`, `MANUAL.md`,
      `INTERVIEW.md` and the project-wide human-only root file).
- [ ] AC 3: Fixed at the resolver seam rather than per-probe — a rule 20 call
      sites must remember is the bug class docs-layout-resolution exists to
      close. `docSetPresentAt()` in `src/lib/engine/workstream.ts` already
      carries the local exact-name form (readdir + `Set.has`) and cites this
      spec; the fix generalizes that and deletes the local.
- [ ] AC 4: `devx doctor` surfaces a repo that has BOTH spellings on disk —
      on a case-insensitive filesystem they are one file, and one of the two
      readers is silently getting the other's content.
- [ ] AC 5: WRITES are refused, not just reads corrected. Authoring
      `<stage>.md` where a case-equal root file already exists must refuse
      with the colliding name rather than truncate it (evidence above). This
      is the highest-severity half and the one dlr104 could not close.

## Technical notes

Discovered by dlr104's Phase 4. `test/engine-layout-scaffold.test.ts` fails
without the exact-name probe, on macOS only.

dlr104 fixed only the scaffolding probe, deliberately: the general fix touches
every consumer and belongs with dlr105's privatization, where the resolver seam
is already being narrowed.

Not hypothetical for the migration: `devx layout migrate --to project-level`
(dlr106) would `git mv <ws>/plan/agent.md plan.md` into a repo that already has
`PLAN.md`. On a case-insensitive checkout that is a clobber of the planning
backlog. dlr106 should treat this as a refusal input.

## Status log

- 2026-09-02T11:42 — filed by /devx during dlr104 Phase 4 (out-of-scope bug
  found while implementing the doc-set probe).
