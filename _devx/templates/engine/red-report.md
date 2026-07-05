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
     error) before implementation. If you didn't watch it fail, you don't
     know if it tests the right thing. P1+ gaps → CONCERNS, never a block. -->

## Runs

### E-1: <name> (P0)

- **Artifact**: <path, exactly as expectations.md Verified-by names it>
- **Command**: `<exact command>`
- **Exit code**: <n>
- **Failure quote**:
  ```
  <the line(s) proving it fails for the right reason>
  ```
- **RED verdict**: <right-reason | wrong-reason (wiring) | not-run (deferred: tests-after|human)>

### E-2: <…>

## Deferred stubs

- <E-id>: <why deferred (tests-after / human validation) + where the stub lives>
