---
gate: CONCERNS
status_reason: 'E-7 artifact ''_devx/workstreams/usage-window-governor/evals/E-7_live-night.md'' is an eval spec (.md); not mechanically runnable'
reviewer: 'devx gate evals'
updated: 2026-08-21
waiver: { active: false, approver: null, reason: null }
---

# RED report — _devx/workstreams/usage-window-governor — 2026-08-21

## Runs

### E-1: Window hit pauses, same item resumes, counters untouched (P0)

- **Artifact**: test/loop-usage-window.test.ts
- **Command**: `npm test --silent test/loop-usage-window.test.ts`
- **Exit code**: 2
- **Failure quote**:
  ```
  PASS  loadValidatedConfig: corrupt YAML in devx.config.yaml throws ConfigError
  PASS  loadValidatedConfig caches by projectPath; clearConfigCache resets
  PASS  loadValidatedConfig cache key includes userPath: switching user file invalidates cache
  PASS  loadValidatedConfig: end-to-end happy path with a real project on disk
  PASS  leftover `bmad:` key loads with a deprecation warning, not an error
  All cfg203 validator tests passed.
  build-info: 70e51c6 embedded in dist/build-info.json
  test/loop-usage-window.test.ts(41,8): error TS2307: Cannot find module '../src/lib/loop/usage-window.js' or its corresponding type declarations.
  test/loop-usage-window.test.ts(42,27): error TS2307: Cannot find module '../src/lib/loop/usage-governor.js' or its corresponding type declarations.
  test/loop-usage-window.test.ts(110,39): error TS7006: Parameter 'r' implicitly has an 'any' type.
  ```
- **RED verdict**: right-reason

### E-2: Mid-transcript marker with valid report is not a pause (P0)

- **Artifact**: test/loop-usage-window.test.ts
- **Command**: `npm test --silent test/loop-usage-window.test.ts`
- **Exit code**: 2
- **Failure quote**:
  ```
  PASS  loadValidatedConfig: corrupt YAML in devx.config.yaml throws ConfigError
  PASS  loadValidatedConfig caches by projectPath; clearConfigCache resets
  PASS  loadValidatedConfig cache key includes userPath: switching user file invalidates cache
  PASS  loadValidatedConfig: end-to-end happy path with a real project on disk
  PASS  leftover `bmad:` key loads with a deprecation warning, not an error
  All cfg203 validator tests passed.
  build-info: 70e51c6 embedded in dist/build-info.json
  test/loop-usage-window.test.ts(41,8): error TS2307: Cannot find module '../src/lib/loop/usage-window.js' or its corresponding type declarations.
  test/loop-usage-window.test.ts(42,27): error TS2307: Cannot find module '../src/lib/loop/usage-governor.js' or its corresponding type declarations.
  test/loop-usage-window.test.ts(110,39): error TS7006: Parameter 'r' implicitly has an 'any' type.
  ```
- **RED verdict**: right-reason

### E-3: Unknown reset degrades to probe cadence, bounded by max-pause (P1)

- **Artifact**: test/loop-usage-window.test.ts
- **Command**: `npm test --silent test/loop-usage-window.test.ts`
- **Exit code**: 2
- **Failure quote**:
  ```
  PASS  loadValidatedConfig: corrupt YAML in devx.config.yaml throws ConfigError
  PASS  loadValidatedConfig caches by projectPath; clearConfigCache resets
  PASS  loadValidatedConfig cache key includes userPath: switching user file invalidates cache
  PASS  loadValidatedConfig: end-to-end happy path with a real project on disk
  PASS  leftover `bmad:` key loads with a deprecation warning, not an error
  All cfg203 validator tests passed.
  build-info: 70e51c6 embedded in dist/build-info.json
  test/loop-usage-window.test.ts(41,8): error TS2307: Cannot find module '../src/lib/loop/usage-window.js' or its corresponding type declarations.
  test/loop-usage-window.test.ts(42,27): error TS2307: Cannot find module '../src/lib/loop/usage-governor.js' or its corresponding type declarations.
  test/loop-usage-window.test.ts(110,39): error TS7006: Parameter 'r' implicitly has an 'any' type.
  ```
- **RED verdict**: right-reason

### E-4: Paused loop reads as alive, never crashed (P1)

- **Artifact**: test/loop-usage-window.test.ts
- **Command**: `npm test --silent test/loop-usage-window.test.ts`
- **Exit code**: 2
- **Failure quote**:
  ```
  PASS  loadValidatedConfig: corrupt YAML in devx.config.yaml throws ConfigError
  PASS  loadValidatedConfig caches by projectPath; clearConfigCache resets
  PASS  loadValidatedConfig cache key includes userPath: switching user file invalidates cache
  PASS  loadValidatedConfig: end-to-end happy path with a real project on disk
  PASS  leftover `bmad:` key loads with a deprecation warning, not an error
  All cfg203 validator tests passed.
  build-info: 70e51c6 embedded in dist/build-info.json
  test/loop-usage-window.test.ts(41,8): error TS2307: Cannot find module '../src/lib/loop/usage-window.js' or its corresponding type declarations.
  test/loop-usage-window.test.ts(42,27): error TS2307: Cannot find module '../src/lib/loop/usage-governor.js' or its corresponding type declarations.
  test/loop-usage-window.test.ts(110,39): error TS7006: Parameter 'r' implicitly has an 'any' type.
  ```
- **RED verdict**: right-reason

### E-5: Kill switch restores today's behavior (P1)

- **Artifact**: test/loop-usage-window.test.ts
- **Command**: `npm test --silent test/loop-usage-window.test.ts`
- **Exit code**: 2
- **Failure quote**:
  ```
  PASS  loadValidatedConfig: corrupt YAML in devx.config.yaml throws ConfigError
  PASS  loadValidatedConfig caches by projectPath; clearConfigCache resets
  PASS  loadValidatedConfig cache key includes userPath: switching user file invalidates cache
  PASS  loadValidatedConfig: end-to-end happy path with a real project on disk
  PASS  leftover `bmad:` key loads with a deprecation warning, not an error
  All cfg203 validator tests passed.
  build-info: 70e51c6 embedded in dist/build-info.json
  test/loop-usage-window.test.ts(41,8): error TS2307: Cannot find module '../src/lib/loop/usage-window.js' or its corresponding type declarations.
  test/loop-usage-window.test.ts(42,27): error TS2307: Cannot find module '../src/lib/loop/usage-governor.js' or its corresponding type declarations.
  test/loop-usage-window.test.ts(110,39): error TS7006: Parameter 'r' implicitly has an 'any' type.
  ```
- **RED verdict**: right-reason

### E-6: --until clamps a pause that outlives the deadline (P1)

- **Artifact**: test/loop-usage-window.test.ts
- **Command**: `npm test --silent test/loop-usage-window.test.ts`
- **Exit code**: 2
- **Failure quote**:
  ```
  PASS  loadValidatedConfig: corrupt YAML in devx.config.yaml throws ConfigError
  PASS  loadValidatedConfig caches by projectPath; clearConfigCache resets
  PASS  loadValidatedConfig cache key includes userPath: switching user file invalidates cache
  PASS  loadValidatedConfig: end-to-end happy path with a real project on disk
  PASS  leftover `bmad:` key loads with a deprecation warning, not an error
  All cfg203 validator tests passed.
  build-info: 70e51c6 embedded in dist/build-info.json
  test/loop-usage-window.test.ts(41,8): error TS2307: Cannot find module '../src/lib/loop/usage-window.js' or its corresponding type declarations.
  test/loop-usage-window.test.ts(42,27): error TS2307: Cannot find module '../src/lib/loop/usage-governor.js' or its corresponding type declarations.
  test/loop-usage-window.test.ts(110,39): error TS7006: Parameter 'r' implicitly has an 'any' type.
  ```
- **RED verdict**: right-reason

### E-7: Live overnight ride-through (P1)

- **Artifact**: _devx/workstreams/usage-window-governor/evals/E-7_live-night.md
- **Command**: (none)
- **Exit code**: (not run)
- **Failure quote**:
  ```
  (no output captured)
  ```
- **RED verdict**: not-run (eval-spec)

## Deferred stubs

- none
