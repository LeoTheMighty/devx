# Plan — Portability Install

<!-- Stage: Plan. Gate: `devx gate coverage <hash>` (plan mode — one row per
     E-id; P0 floor: every P0 expectation `full` and naming a runnable
     artifact). Sizing rule: a phase is one cohesive concern with a
     verifiable exit, sized to land as a single reviewable PR. Default to
     more, smaller phases. One phase ≙ one dev spec ≙ one PR ≙ one tour. -->

## Current state

- Skill bodies exist only at `.claude/commands/{devx,devx-plan,devx-interview}.md`;
  `package.json → files` = dist, scripts, `_devx/config-schema.json`,
  `_devx/templates`, INSTALL.md — no skills anywhere in the tarball.
- `devx init` (src/commands/init.ts) only handles `--resume-gh`; the real
  scaffold flow is the `/devx-init` slash command over `runInit()`
  (src/lib/init-orchestrator.ts) — unreachable on a repo without the skill.
- `devx --version` reports plain package.json semver (src/cli.ts:99);
  no build provenance.
- `docs/SETUP.md` Part 2 documents a nonexistent `skills/` dir +
  `install.sh`; INSTALL.md assumes a published `@devx/cli`.

## Desired state

- `skills/` ships in the tarball, byte-locked to `.claude/commands/` by an
  `npm test` drift check; refresh via `npm run sync:skills`.
- Bare `devx init` scaffolds a working repo non-interactively (config,
  backlogs, spec dirs, CLAUDE.md block, CI workflow, skills with
  `devx-skill` version headers), idempotent on re-run, user-owned files
  preserved + MANUAL.md filed.
- `npm run install:global` installs from this checkout;
  `devx --version` → `<semver>+<sha>`.
- Docs describe only what exists; work-repo caveat present.
- S-5 proven: scripted fresh-repo scenario in CI + timed live run on
  `palateful` (< 2 min to `/devx`, one merged fix, one loop report,
  no out-of-repo writes beyond `~/.devx/`).

## What we're NOT doing

- npm registry publish (`private: true` stays).
- Fleet layer (f1d6b2), usage governor (c8e2d4), work-repo rollout
  (INTERVIEW Q#11 — only the doc caveat ships here).
- Skill auto-update daemon; postinstall-time skill installs.
- Any edit to this repo's `.claude/commands/*.md` (copies flow FROM it;
  it stays canonical and untouched).
- Windows-native (non-WSL) validation.

## Expectation coverage

| E-id | Priority | Verified in phase | Validation type | Eval artifact | Coverage |
|---|---|---|---|---|---|
| E-1 | P0 | 1 | tests-first | _devx/workstreams/portability-install/evals/E-1_skills-packaging.ts | full |
| E-2 | P0 | 1 | tests-first | _devx/workstreams/portability-install/evals/E-2_skills-sync.ts | full |
| E-3 | P0 | 3 | tests-first | _devx/workstreams/portability-install/evals/E-3_init-scaffold.ts | full |
| E-4 | P1 | 3 | tests-first | _devx/workstreams/portability-install/evals/E-4_reinit-idempotent.ts | full |
| E-5 | P1 | 4 | tests-first | _devx/workstreams/portability-install/evals/E-5_version-sha.ts | full |
| E-6 | P2 | 4 | tests-first | _devx/workstreams/portability-install/evals/E-6_docs-paths.ts | full |
| E-7 | P2 | 5 | human | _devx/workstreams/portability-install/evals/E-7_s5-palateful.md | full |

Eval artifacts are standalone tsx scripts under the workstream's `evals/`
(the `workstream-evals` runner; never part of `npm test`, so RED artifacts
don't break CI across this workstream's five PRs — the v2x101 precedent).
Each phase ALSO lands permanent vitest suites at the `test/*.test.ts`
paths named in its Files; the evals are the workstream's acceptance
checks and flip green as the phases ship.

## Phase checklist

- [ ] Phase 1: pin101 — packaged skills mirror + drift guard
- [ ] Phase 2: pin102 — skills installer library
- [ ] Phase 3: pin103 — `devx init` non-interactive scaffold
- [ ] Phase 4: pin104 — install:global + SHA provenance + docs-to-reality
- [ ] Phase 5: pin105 — S-5 validation (scripted + live checklist)

## Phases

### 1. Phase: pin101 — packaged skills mirror + drift guard

**Overview**: Create `skills/` as byte-identical copies of
`.claude/commands/*.md`, add it to `package.json → files`, add
`npm run sync:skills` and the drift test. First because every later phase
consumes the packaged skills. Reads `.claude/` only — no harness gate.

**Files**:
- `skills/devx.md`, `skills/devx-plan.md`, `skills/devx-interview.md` — copies from `.claude/commands/` (via the sync script, committed).
- `scripts/sync-skills.mjs` — refresh mirror from `.claude/commands/`; `--check` mode for tests.
- `package.json` — `files` gains `skills`; `scripts` gains `sync:skills`.
- `test/skills-packaging.test.ts` — E-1: `npm pack --dry-run --json` manifest contains 3/3 skill files.
- `test/skills-sync.test.ts` — E-2: byte-compare each pair; failure names the divergent file.

**Context**:
- Copies not symlinks (design § Resolved questions: npm pack drops
  symlinks; gate-bypass hazard). `.claude/commands/` canonical.
- Subprocess-smoke lesson (LEARN cli301 E6): E-1 asserts the real pack
  manifest, not an in-process approximation.

**Verification plan**:
- Type: tests-first
- Success criteria:
  - `npm test` green with skills/ present and in-sync; red (naming the
    file) when any byte diverges or a skill file is missing from the pack
    manifest.
  - `npm pack --dry-run` lists skills/*.md 3/3.

**Tasks**:
- [ ] T1.1 sync script + npm scripts — files: `scripts/sync-skills.mjs`, `package.json`
- [ ] T1.2 generate committed `skills/*` via the script — files: `skills/*.md`
- [ ] T1.3 make E-1 + E-2 RED artifacts pass — files: `test/skills-packaging.test.ts`, `test/skills-sync.test.ts`

### 2. Phase: pin102 — skills installer library

**Overview**: `src/lib/init-skills.ts` — pure decision fn
(file state × `devx-skill` header × version → `write | overwrite |
skip-user-owned`) + impure applier (resolves packaged `skills/` relative
to the installed module, tmp+rename writes, per-file outcomes,
MANUAL.md entry on skip-user-owned). Library-only phase (pure-fn +
CLI-passthrough pattern, library variant — consumer lands in Phase 3).

**Files**:
- `src/lib/init-skills.ts` — decision fn + `installSkills({targetDir, version, force?})`.
- `test/init-skills.test.ts` — decision truth table + applier fs tests (tmp dirs).

**Context**:
- Header marker: `<!-- devx-skill v<semver>+<sha> -->` (design § Data).
- Atomic writes cross-epic pattern (`writeAtomic`,
  src/lib/supervisor-internal.ts) — reuse, don't reimplement.
- MANUAL-as-designed-signal (LEARN cross-epic): skip never aborts.
- Packaged-dir resolution mirrors how init-write locates
  `_devx/templates` (templatesRoot default, src/lib/init-write.ts:117).

**Verification plan**:
- Type: tests-first
- Success criteria:
  - Truth table: absent→write; header+older→overwrite; header+same→no-op;
    headerless→skip + MANUAL entry; `--global` target dir honored.
  - Applier leaves no tmp droppings on failure injection.

**Tasks**:
- [ ] T2.1 decision fn + truth-table tests — files: `src/lib/init-skills.ts`, `test/init-skills.test.ts`
- [ ] T2.2 applier + MANUAL wiring + fs tests — files: same

### 3. Phase: pin103 — `devx init` non-interactive scaffold

**Overview**: Bare `devx init` = `detectInitState()` →
non-interactive AnswerProvider (stack answers from `detectedStack`,
src/lib/init-state.ts:101/248; conservative defaults + INTERVIEW.md seeds
for real decisions) → `runInit()` fresh|upgrade → `installSkills()`.
Flags: `--global`, `--skip-skills`; `--resume-gh` unchanged. E-3 + E-4
land here via a new scenario in the ini508 e2e fixture harness.

**Files**:
- `src/commands/init.ts` — scaffold path + flags (keep `--resume-gh` intact).
- `src/lib/init-defaults.ts` — the non-interactive AnswerProvider (wraps `scriptedAsk()` conventions, src/lib/init-orchestrator.ts:463).
- `test/init-cli-scaffold.test.ts` — E-3 fresh-repo full-artifact-set scenario + E-4 re-run idempotency/user-owned scenario (fixture-repo pattern from test/init-e2e.test.ts).

**Context**:
- Wrap, don't duplicate: zero new write logic — orchestrator + init-write
  + init-upgrade + init-skills do all writes.
- No-silent-product-decisions: undecidable answers file INTERVIEW seeds,
  same artifact `/devx-init` writes.
- First-real-run cross-epic rule: before this phase's PR merges, run
  `devx init` once on a real scratch repo and treat surprises as findings.

**Verification plan**:
- Type: tests-first
- Success criteria:
  - E-3: fresh fixture repo → full artifact set incl. 3 header-bearing
    skills, exit 0.
  - E-4: re-run upgrades header-bearing files, preserves headerless
    user file byte-identical, files 1 MANUAL entry.
  - `devx init --resume-gh` regression suite still green.

**Tasks**:
- [ ] T3.1 defaults AnswerProvider — files: `src/lib/init-defaults.ts`
- [ ] T3.2 CLI wiring + flags — files: `src/commands/init.ts`
- [ ] T3.3 e2e scenarios green (E-3, E-4) — files: `test/init-cli-scaffold.test.ts`
- [ ] T3.4 scratch-repo first-real-run + findings to status log

### 4. Phase: pin104 — install:global + SHA provenance + docs-to-reality

**Overview**: Build embeds `dist/build-info.json` (`git rev-parse --short
HEAD`); version surface composes `<semver>+<sha>` when present
(src/cli.ts:99 + the skills header + init's `devx_version` stamp consume
the same resolved string); `npm run install:global` = build + `npm i -g .`.
INSTALL.md + docs/SETUP.md rewritten to reality (incl. npm-link warning +
work-repo caveat). E-6's docs eval ships and passes here.

**Files**:
- `scripts/build-info.mjs` + `package.json` — build/install:global scripts.
- `src/cli.ts` (+ small `src/lib/version.ts`) — version composition.
- `test/version-sha.test.ts` — E-5: shape `/^\d+\.\d+\.\d+\+[0-9a-f]{7,}$/m` with build-info present; plain semver without.
- `INSTALL.md`, `docs/SETUP.md` — rewrite; delete phantom paths.
- `evals/E-6_docs-paths.ts` (workstream evals dir) — E-6: every repo-path-like reference in the install sections resolves; zero phantom names (`install.sh`, retired v1 skill names).

**Context**:
- dev runs without build-info stay plain semver (no codegen in src).
- Docs cut over in the same PR as the flow they describe (design §
  Migration plan).

**Verification plan**:
- Type: tests-first
- Success criteria:
  - E-5 green; `npm run install:global` on this machine yields
    `devx --version` = `0.1.0+<sha>` (recorded in status log).
  - E-6 eval exit 0 against the rewritten docs; nonzero against the
    pre-rewrite docs (verified once at RED).

**Tasks**:
- [ ] T4.1 build-info embed + version compose + E-5 — files: `scripts/build-info.mjs`, `src/cli.ts`, `src/lib/version.ts`, `test/version-sha.test.ts`
- [ ] T4.2 install:global script + INSTALL.md rewrite — files: `package.json`, `INSTALL.md`
- [ ] T4.3 SETUP.md Part 2 rewrite + E-6 eval green — files: `docs/SETUP.md`, `evals/E-6_docs-paths.ts`

### 5. Phase: pin105 — S-5 validation (scripted + live checklist)

**Overview**: Close the loop on G-1/G-3: author + execute the
`evals/E-7_s5-palateful.md` checklist. Scripted half runs here (timed
scratch-repo init via the e2e harness with a wall-clock assertion);
live half is owner-run on `palateful` (checklist steps map 1:1 to G-3/
FR-7 thresholds; out-of-repo write audit via `find -newer <stamp>`).
Owner-dependent steps are MANUAL.md entries (designed signal), not
blockers hidden in prose.

**Files**:
- `evals/E-7_s5-palateful.md` — step↔threshold checklist + results record.
- `test/init-cli-scaffold.test.ts` — timed scratch scenario (< 120s budget assert, generous CI margin documented).
- `MANUAL.md` — owner steps: run the timed palateful init; pick the bug; confirm phone-side `/devx` render.

**Context**:
- The checklist contract was pinned at design (§ Migration plan);
  this phase fills in the steps and RUNS them.
- Live results append to this workstream's spec status log +
  `evals/E-7_s5-palateful.md` results section; `devx outcome` scores
  G-1..G-4 from here later.

**Verification plan**:
- Type: human (with the scripted timed scenario as tests-first backstop)
- Success criteria:
  - Scratch: init completes < 120s in the harness.
  - Palateful (owner-run): `/devx` renders < 2 min; 1 symptom→merged PR;
    `devx loop --max-items 1` report exists; write audit clean.

**Tasks**:
- [ ] T5.1 checklist authored (step↔threshold map) — files: `evals/E-7_s5-palateful.md`
- [ ] T5.2 timed scratch scenario — files: `test/init-cli-scaffold.test.ts`
- [ ] T5.3 MANUAL entries + live run executed + results recorded — files: `MANUAL.md`, `evals/E-7_s5-palateful.md`
