# Expectations — Execute re-home + BMAD ejection (V2.2)

## E-1: Execution surface is BMAD-free

- **Priority:** P0
- **Covers:** G-1, UC-1, FR-1, FR-2, CAP-1
- **Trigger:** the E-1 eval script scans src/, .claude/commands/,
  .claude/skills/, _bmad/, and the config for BMAD residue
- **Expectation (EARS):** When the eval script runs after v2x101 merges, the
  system SHALL report zero BMAD references (exit 0).
- **Threshold:** 0 matches / 0 surviving directories; script exit code 0.
- **Verified by:** _devx/workstreams/execute-rehome-bmad-eject/evals/E-1_bmad-free.ts

## E-2: Engine config block is first-class

- **Priority:** P0
- **Covers:** G-2, FR-3, CAP-3
- **Trigger:** the E-2 eval script loads devx.config.yaml and inspects the
  engine block
- **Expectation (EARS):** When the eval script runs after v2x101 merges, the
  system SHALL expose a schema-valid `engine:` block whose
  `workstreams_root` resolves to an existing directory (exit 0).
- **Threshold:** script exit code 0; `engine.workstreams_root` names an
  existing directory.
- **Verified by:** _devx/workstreams/execute-rehome-bmad-eject/evals/E-2_engine-config.ts

## E-3: Fresh-repo init ships no BMAD

- **Priority:** P1
- **Covers:** G-1, UC-3, FR-2
- **Trigger:** `devx init` scaffold generation paths in src/lib/init-*.ts
- **Expectation (EARS):** When init scaffolds a fresh repo after v2x101
  merges, the system SHALL write no BMAD install step, failure mode, or
  config key.
- **Threshold:** 0 BMAD references in init source + generated fixtures
  (ini508 e2e harness extension).
- **Verified by:** test/init-e2e.test.ts

## E-4: Zero regression through the ejection

- **Priority:** P1
- **Covers:** G-3
- **Trigger:** the v2x101 PR's local and remote CI runs
- **Expectation (EARS):** When the v2x101 PR runs CI, the system SHALL pass
  the full test suite with no count regression.
- **Threshold:** ≥1571 tests passing; 0 failures.
- **Verified by:** test/
