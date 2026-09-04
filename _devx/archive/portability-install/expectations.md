# Expectations — Portability Install

<!-- Gate 1 input. Minimum 3 E-blocks (config: engine.expectations_min).
     Every business goal (G-) must be covered by at least one expectation;
     every Covers: ID must resolve in prd.md. EARS regex enforced by
     `devx gate prd`: "When .+, the system SHALL .+". A P0 with a vague
     Verified-by target fails the gate. -->

## E-1: Skill bodies ship in the npm tarball

- **Priority:** P0
- **Covers:** G-2, UC-4, CAP-1, FR-1
- **Trigger:** `npm pack --dry-run --json` on the package
- **Expectation (EARS):** When the package is packed, the system SHALL
  include `skills/devx.md`, `skills/devx-plan.md`, and
  `skills/devx-interview.md` in the tarball file list.
- **Threshold:** 3/3 skill files present in the pack manifest.
- **Verified by:** _devx/workstreams/portability-install/evals/E-1_skills-packaging.ts

## E-2: Repo commands cannot silently diverge from packaged skills

- **Priority:** P0
- **Covers:** G-2, UC-4, CAP-5, FR-2
- **Trigger:** `npm test` run while `.claude/commands/<name>.md` content
  differs from `skills/<name>.md`
- **Expectation (EARS):** When any `.claude/commands/*.md` diverges from
  its `skills/*.md` counterpart, the system SHALL fail the test suite
  naming the divergent file.
- **Threshold:** 0 divergences tolerated; failure message names the file.
- **Verified by:** _devx/workstreams/portability-install/evals/E-2_skills-sync.ts

## E-3: `devx init` scaffolds a working repo including skills

- **Priority:** P0
- **Covers:** G-1, UC-2, CAP-2, CAP-3, FR-3, FR-4
- **Trigger:** bare `devx init` executed in a fresh non-devx git repo
- **Expectation (EARS):** When `devx init` runs in a fresh git repository,
  the system SHALL write devx.config.yaml, the eight backlog files, the
  spec directories, the CLAUDE.md devx block, the CI workflow, and
  `.claude/commands/{devx,devx-plan,devx-interview}.md` each carrying a
  `devx-skill` version header, exiting 0.
- **Threshold:** full artifact set present; exit code 0; 3/3 skill files
  carry the version header.
- **Verified by:** _devx/workstreams/portability-install/evals/E-3_init-scaffold.ts

## E-4: Re-init is idempotent and never clobbers user-owned files

- **Priority:** P1
- **Covers:** UC-3, FR-3, FR-4
- **Trigger:** second `devx init` run on an initialized repo where
  `.claude/commands/devx.md` was replaced by a user-owned file (no
  devx-skill header)
- **Expectation (EARS):** When `devx init` re-runs on an initialized
  repository containing a headerless user-owned skill file, the system
  SHALL leave that file byte-identical and SHALL record a MANUAL.md entry,
  while upgrading header-bearing skill files in place.
- **Threshold:** user-owned file unchanged; 1 MANUAL.md entry filed;
  header-bearing files carry the new version header.
- **Verified by:** _devx/workstreams/portability-install/evals/E-4_reinit-idempotent.ts

## E-5: Version provenance survives the global install

- **Priority:** P1
- **Covers:** G-2, UC-1, CAP-4, FR-5
- **Trigger:** `devx --version` on a build produced by
  `npm run install:global`
- **Expectation (EARS):** When `devx --version` runs on a globally
  installed build, the system SHALL report `<semver>+<git-sha>` with a
  short SHA of at least 7 hex chars.
- **Threshold:** output matches `/^\d+\.\d+\.\d+\+[0-9a-f]{7,}$/m`.
- **Verified by:** _devx/workstreams/portability-install/evals/E-5_version-sha.ts

## E-6: Docs reference only paths and flows that exist

- **Priority:** P2
- **Covers:** G-4, FR-6
- **Trigger:** docs-accuracy eval run over `INSTALL.md` + `docs/SETUP.md`
  install sections
- **Expectation (EARS):** When the docs-accuracy eval runs, the system
  SHALL find zero references to nonexistent repo paths (e.g. `install.sh`,
  retired v1 skill names) in the install documentation.
- **Threshold:** 0 phantom references.
- **Verified by:** _devx/workstreams/portability-install/evals/E-6_docs-paths.ts

## E-7: S-5 live — palateful init to working `/devx` in under two minutes

- **Priority:** P2
- **Covers:** G-1, G-3, UC-1, UC-2, FR-7
- **Trigger:** owner runs the timed S-5 checklist on `palateful`
  (install:global → `devx init` → open Claude Code → `/devx`)
- **Expectation (EARS):** When the S-5 checklist is executed on palateful,
  the system SHALL reach a rendered `/devx` dispatcher in under 2 minutes,
  SHALL carry one real bug from symptom to merged fix, and SHALL complete
  `devx loop --max-items 1` with a morning report, writing nothing outside
  the repo except `~/.devx/`.
- **Threshold:** < 120s to dispatcher; 1 merged PR; 1 morning report;
  0 out-of-repo writes (excluding `~/.devx/`).
- **Verified by:** _devx/workstreams/portability-install/evals/E-7_s5-palateful.md
