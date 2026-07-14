# Design — Portability Install

<!-- Stage: Design. Gate: `devx gate coverage <hash>` (design mode — one
     tri-state row per G-/UC-/CAP-/FR- ID in prd.md). Hard rule: don't plan
     here. No phases, no tasks — design is the approach, not the sequence. -->

## Overview

- **Objective**: Make `devx` installable and initializable on any repo —
  skill bodies ship in the package, `devx init` scaffolds a working `/devx`
  non-interactively (including the skills), version provenance survives the
  install, and the docs describe only what exists — validated live on
  `palateful` (S-5, < 2 min).
- **Solution**: A packaged `skills/` mirror of this repo's live
  `.claude/commands/` (copies, not symlinks — see Resolved questions), a
  drift guard in `npm test`, a non-interactive `AnswerProvider` feeding the
  existing `runInit()` orchestrator, a skills-install write step alongside
  the existing init writes, and a build step that embeds the git SHA into
  the reported version. No new business logic — every piece wraps the
  Phase-0 init machinery.

## Constraints

- **This repo's `.claude/` is harness-gated** (LEARN.md cross-epic:
  bypass-permissions does NOT auto-accept skill edits) — any story touching
  `.claude/commands/` here is user-foreground. Target repos' and
  `~/.claude/` writes from the CLI are plain fs ops, ungated.
- **`npm pack` excludes symlinks** from tarballs — packaged skill files
  must be regular files.
- **`private: true` stays** — no registry publish; distribution is
  `npm i -g .` from this checkout (owner decision 2026-07-14).
- **Node ≥ 20, macOS/Linux/WSL** per INSTALL.md matrix; no new runtime
  deps.
- **Backward compatibility**: `devx init --resume-gh` behavior unchanged
  (src/commands/init.ts); `/devx-init` slash-command interview flow
  unchanged (same orchestrator underneath).

## Risks

- Packaged skills silently drift from the live commands → drift guard in
  `npm test` naming the divergent file → proven by E-2.
- `devx init` scaffold misses an artifact the slash-command flow writes
  (config/backlogs/CLAUDE.md/CI/skills) → e2e fixture scenario asserts the
  full artifact set → proven by E-3.
- Re-init clobbers a user's hand-rolled command file → header-detection
  rule (headerless = user-owned = skip + MANUAL.md entry, the
  MANUAL-as-designed-signal cross-epic pattern) → proven by E-4.
- Global install reports a version that doesn't identify the build →
  build-info SHA embedding + shape test → proven by E-5.
- Docs regress to phantom paths again → docs-accuracy eval → proven by
  E-6.
- Packaging realities invisible to in-process tests (cli301 lesson E6:
  symlinked bin, missing dist/) → subprocess smoke shape: E-1 asserts the
  actual `npm pack` manifest, E-5 the actual `--version` output → proven
  by E-1, E-5.

## Trade-offs

- **Copies over symlinks** for `skills/` ↔ `.claude/commands/`: symlinks
  don't survive `npm pack`, and a symlinked live command would let an
  ungated `skills/` edit mutate harness behavior, defeating the `.claude/`
  gate. Cost: a sync step; paid for by the E-2 drift guard.
- **`.claude/commands/` stays canonical** (not `skills/`): live-skill edits
  remain user-foreground exactly as today; `skills/` is the shipped mirror,
  refreshed mechanically (`npm run sync:skills`, ungated). The alternative
  (skills/ canonical) would move the editing surface out from under the
  harness gate.
- **Non-interactive defaults + INTERVIEW seeding over a CLI interview**:
  bare `devx init` must work unattended (fleet/loop future); real decisions
  are filed to INTERVIEW.md instead of silently defaulted or interactively
  blocked — no-silent-product-decisions holds.
- **`version+sha` over publishing versioned releases**: solo-dogfood
  provenance without registry ceremony.

## Out of scope

- npm registry publish; fleet layer (f1d6b2); usage governor (c8e2d4);
  work-repo rollout (INTERVIEW Q#11); skill auto-update daemon;
  Windows-native (non-WSL) validation.

## Assumptions

- Claude Code discovers `<repo>/.claude/commands/*.md` and
  `~/.claude/commands/*.md` as slash commands without registration (holds
  today for this repo; S-5 live run re-verifies on palateful).
- The existing `runInit()` orchestrator + `init-write.ts` writes are
  complete for a working repo — nothing else in this repo's setup is
  load-bearing for `/devx` to function (v2d101's init v2 already
  de-BMAD'd the path; e2e test re-verifies).
- `palateful` is a git repo with a GitHub remote + `gh` auth (S-5
  prerequisites; the checklist records them).

## Discarded considerations

- **Symlinking `.claude/commands/` → `skills/`** — npm pack drops
  symlinks; gate-bypass hazard (above).
- **Shipping skills inside `_devx/templates/init/`** — skills are not
  per-stack templates; they're versioned package content consumed by both
  per-repo and `--global` installs. Separate top-level dir keeps the
  init-template tree stack-shaped.
- **`npm link` as the blessed dev install** — links HEAD live; an
  overnight loop's semantics could change mid-hack. INSTALL.md warns
  instead; `npm i -g .` snapshots.
- **postinstall-time skill install into `~/.claude/`** — surprising global
  side effect from a package install; skills install is an explicit `devx
  init` / `--global` action instead.
- **Interactive CLI interview for `devx init`** — duplicates `/devx-init`;
  the unattended path is the one that doesn't exist yet.

## Wrap, don't duplicate

- Reuses: `runInit()` + `OrchestratorMode` + `scriptedAsk()`/AnswerProvider
  seam (`src/lib/init-orchestrator.ts:81-463`); all write primitives in
  `src/lib/init-write.ts` (config, backlogs, dirs, CLAUDE.md
  create/append/update, gitignore block) incl. its `devx_version` stamp;
  `runInitUpgrade()` + `compareSemver()` (`src/lib/init-upgrade.ts:229,461`)
  for idempotent re-init; the ini508 e2e fixture harness
  (`test/init-e2e.test.ts`) for the fresh-repo scenario; commander
  `.version()` wiring (`src/cli.ts:99`); atomic tmp+rename write helpers
  (cross-epic pattern, `src/lib/supervisor-internal.ts`).
- Adds: `skills/` package dir (content mirror); a skills-install write
  module (`src/lib/init-skills.ts` — new, but pure-fn + consumed by init
  like every other `init-*.ts`); a defaults AnswerProvider for
  non-interactive mode; a `scripts/sync-skills` + test-side drift check;
  a build-info SHA embedding step; docs rewrites.

## Design

### Architecture

Four thin pieces around the existing init core:

1. **Package content**: `skills/{devx,devx-plan,devx-interview}.md` —
   byte-identical copies of `.claude/commands/*.md`, listed in
   `package.json → files`. `npm run sync:skills` (plain node script)
   refreshes the mirror from `.claude/commands/`; `test/skills-sync.test.ts`
   fails on divergence (either direction), naming the file. The live
   `.claude/commands/` remains the editing surface (user-foreground);
   the mirror refresh is mechanical and ungated.
2. **Skills installer** (`src/lib/init-skills.ts`): pure decision fn
   (existing-file state × header presence × version) → action
   (`write | overwrite | skip-user-owned`), plus an impure applier that
   resolves the packaged `skills/` dir relative to the installed module
   (same technique `init-write.ts` uses for `_devx/templates`), writes
   files with header `<!-- devx-skill v<version>+<sha> -->` via
   tmp+rename, and returns per-file outcomes. `skip-user-owned` files a
   MANUAL.md entry through the existing MANUAL append path. Consumed by
   both per-repo installs (`<repo>/.claude/commands/`) and `--global`
   (`~/.claude/commands/`).
3. **CLI scaffold path** (`src/commands/init.ts` + a defaults
   AnswerProvider): bare `devx init` detects repo state via the existing
   `detectInitState()` — which already includes non-interactive stack
   detection by marker file (`src/lib/init-state.ts:248` `detectStack()`:
   pubspec.yaml → flutter, Cargo.toml → rust, go.mod → go,
   pyproject.toml → python, package.json → ts, none → empty; exposed as
   `detectedStack`/`detectedStackFile` at `init-state.ts:101`) — then runs
   `runInit()` in `fresh` or `upgrade` mode with a non-interactive
   AnswerProvider that answers stack-derived questions from
   `detectedStack` and takes the conservative default for the rest,
   filing INTERVIEW.md seeds for real decisions — the same artifact
   `/devx-init` writes — instead of silently deciding. Then the skills
   installer runs. Exit codes: 0 success, nonzero with the existing
   failure-mode handling (`init-failure.ts` queue for gh ops).
4. **Version provenance**: the build (`npm run build`, consumed by
   `install:global`) writes `dist/build-info.json` `{ sha, builtAt }` from
   `git rev-parse --short HEAD`; `src/cli.ts`'s `readPackageVersion()`
   grows a sibling that appends `+<sha>` when build-info exists (dev runs
   without it stay plain semver). The skills header and init's
   `devx_version` stamp consume the same resolved string.

### Interfaces

- `devx init` — non-interactive scaffold (fresh or upgrade), then skills
  install. Flags: `--global` (skills to `~/.claude/commands/` instead of
  the repo), `--resume-gh` (unchanged), `--skip-skills` (escape hatch).
  Output: per-artifact outcome lines + JSON summary (matches the house
  CLI style, e.g. `workstream new`).
- `npm run install:global` — build (with SHA embed) + `npm i -g .`.
- `npm run sync:skills` — refresh `skills/` from `.claude/commands/`.
- `installSkills({targetDir, version, force?}): SkillInstallOutcome[]` —
  the library surface; pure decision fn exported separately
  (pure-fn + CLI-passthrough cross-epic pattern).

### Data

- `skills/*.md` — package content, git-tracked regular files.
- `dist/build-info.json` — build artifact, not git-tracked.
- Installed skill header line: `<!-- devx-skill v<semver>+<sha> -->` —
  the marker the idempotency/ownership rules key on.
- No new state files; `~/.devx/` untouched by this track.

## Migration plan

- This repo: one user-foreground commit replaces nothing — `skills/` is
  created FROM `.claude/commands/` (copies), `.claude/` content unchanged;
  only the sync check makes the relationship binding. No target-repo
  migration (greenfield scaffolds); already-initialized repos (this one)
  simply gain skills on the next `devx init` upgrade run if absent.
- Docs cut over in the same PR that ships the flow they describe (G-4's
  zero-phantom-paths is gated by E-6 from that point on). The INSTALL.md
  rewrite carries the **work-repo caveat section** FR-6 requires — one
  paragraph: shared/work repos must run BETA/PROD mode (never YOLO
  auto-merge) and org policy on sending code to Claude is the operator's
  call (INTERVIEW Q#11) — the *caveat text* is in scope here even though
  the work-repo *rollout* is out of scope.
- The live S-5 components of G-3/FR-7 (timed init, symptom→merged-fix,
  `devx loop --max-items 1`, out-of-repo write audit) are a human-run
  checklist artifact — `evals/E-7_s5-palateful.md` — whose step-by-step
  shape is plan-stage material (the val phase's verification plan);
  this design fixes only its contract: each checklist step maps to one
  G-3/FR-7 threshold, and the out-of-repo audit runs via
  `find ~/.claude ~/.devx <repo> -newer <stamp>` comparison recorded in
  the checklist output.

## Resolved design questions

- **Symlink vs copy for `skills/`** (PRD open question) → **copies**:
  `npm pack` excludes symlinks, and symlinking the live commands to an
  ungated path would defeat the harness's `.claude/` review gate. Decided
  here; PRD FR-2 already carried the copy fallback, so no `devx revise`
  needed. The plan spec's Scope wording ("become symlinks") is superseded
  by this entry (recorded in the spec status log per the override flow).
- **Which side is canonical** → `.claude/commands/` (the live, gated
  surface); `skills/` is the shipped mirror.
- **Where the SHA lives** → `dist/build-info.json` written at build time;
  version string composed at runtime. No source-file codegen.

## Unresolved design questions

- Whether Claude Code merges repo-level and user-level commands when both
  define `/devx` (affects `--global` + per-repo coexistence UX, not
  correctness — per-repo wins are assumed). Resolves during E-7's live S-5
  run; does not block Gate 2 (no P0 depends on `--global`).
