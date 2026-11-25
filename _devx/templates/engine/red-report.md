---
gate: <PASS | CONCERNS | FAIL>
status_reason: '<1–2 sentences>'
reviewer: 'devx gate evals'
updated: <YYYY-MM-DD>
waiver: { active: false, approver: null, reason: null }
---

# RED report — <workstream> — <YYYY-MM-DD>

<!-- Gate 4. Every P0 expectation's runnable artifact must be observed
     failing FOR THE RIGHT REASON (missing feature, not an import/wiring
     error) before implementation. The gate checks it ran and a test failed
     (D-19); the quote shows whether that is the missing feature. P1+ gaps
     → CONCERNS, never a block. -->

## Runs

### E-1: <name> (P0)

- **Artifact**: <path, exactly as expectations.md Verified-by names it>
- **Command**: `<exact command>`
- **Exit code**: <n>
- **Failure quote**:
  ```
  <the line(s) proving it fails for the right reason>
  ```
- **RED verdict**: <red (asserted) | red (reason unchecked) | wrong-reason (…) | not-run (deferred: …)>

### E-2: <…>

## Deferred stubs

- <E-id>: <why deferred (tests-after / human validation) + where the stub lives>
