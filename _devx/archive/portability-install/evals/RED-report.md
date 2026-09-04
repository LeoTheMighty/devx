---
gate: PASS
status_reason: 'Every runnable expectation observed RED for the right reason (6 run(s), 1 deferred).'
reviewer: 'devx gate evals'
updated: 2026-07-14
waiver: { active: false, approver: null, reason: null }
---

# RED report — _devx/workstreams/portability-install — 2026-07-14

## Runs

### E-1: Skill bodies ship in the npm tarball (P0)

- **Artifact**: _devx/workstreams/portability-install/evals/E-1_skills-packaging.ts
- **Command**: `npx tsx portability-install/evals/E-1_skills-packaging.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
  E-1 RED — skill bodies do not ship in the npm tarball:
    - tarball manifest missing skills/devx.md
    - tarball manifest missing skills/devx-plan.md
    - tarball manifest missing skills/devx-interview.md
  npm notice
  npm notice New minor version of npm available! 11.5.1 -> 11.18.0
  npm notice Changelog: https://github.com/npm/cli/releases/tag/v11.18.0
  npm notice To update run: npm install -g npm@11.18.0
  npm notice
  ```
- **RED verdict**: right-reason

### E-2: Repo commands cannot silently diverge from packaged skills (P0)

- **Artifact**: _devx/workstreams/portability-install/evals/E-2_skills-sync.ts
- **Command**: `npx tsx portability-install/evals/E-2_skills-sync.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
  E-2 RED — skills mirror is absent or unguarded:
    - skills/devx.md missing (shipped mirror side)
    - skills/devx-plan.md missing (shipped mirror side)
    - skills/devx-interview.md missing (shipped mirror side)
    - test/skills-sync.test.ts missing — divergence would not fail npm test
  ```
- **RED verdict**: right-reason

### E-3: `devx init` scaffolds a working repo including skills (P0)

- **Artifact**: _devx/workstreams/portability-install/evals/E-3_init-scaffold.ts
- **Command**: `npx tsx portability-install/evals/E-3_init-scaffold.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
    - INTERVIEW.md missing
    - MANUAL.md missing
    - LESSONS.md missing
    - dev/ spec dir missing
    - plan/ spec dir missing
    - CLAUDE.md missing
    - .github/workflows/ missing (CI workflow not scaffolded)
    - .claude/commands/devx.md missing
    - .claude/commands/devx-plan.md missing
    - .claude/commands/devx-interview.md missing
  ```
- **RED verdict**: right-reason

### E-4: Re-init is idempotent and never clobbers user-owned files (P1)

- **Artifact**: _devx/workstreams/portability-install/evals/E-4_reinit-idempotent.ts
- **Command**: `npx tsx portability-install/evals/E-4_reinit-idempotent.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
  E-4 RED — re-init clobbers or ignores ownership rules:
    - first devx init did not produce .claude/commands/devx.md (exit 0)
  ```
- **RED verdict**: right-reason

### E-5: Version provenance survives the global install (P1)

- **Artifact**: _devx/workstreams/portability-install/evals/E-5_version-sha.ts
- **Command**: `npx tsx portability-install/evals/E-5_version-sha.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
  E-5 RED — version carries no build provenance:
    - scripts/build-info.mjs missing — nothing embeds the git SHA at build time
  ```
- **RED verdict**: right-reason

### E-6: Docs reference only paths and flows that exist (P2)

- **Artifact**: _devx/workstreams/portability-install/evals/E-6_docs-paths.ts
- **Command**: `npx tsx portability-install/evals/E-6_docs-paths.ts`
- **Exit code**: 1
- **Failure quote**:
  ```
  E-6 RED — install docs describe things that do not exist:
    - docs/SETUP.md still references phantom 'install.sh'
    - docs/SETUP.md still references phantom 'devx-triage'
    - docs/SETUP.md references skills/ but the directory does not exist
    - INSTALL.md does not document `npm run install:global` (the only working install path while the package is private)
    - INSTALL.md carries no npm-link warning
  ```
- **RED verdict**: right-reason

## Deferred stubs

- E-7: not-run (deferred: human) (P2)
