---
gate: <PASS | CONCERNS | FAIL | WAIVED>
status_reason: '<1–2 sentences>'
reviewer: '<devx gate coverage (design|plan mode) | /devx prd --review | /devx revise>'
updated: <YYYY-MM-DD>
waiver: { active: false, approver: null, reason: null }
---

# <Decision | Critique | Verify | Revision> — <workstream> — <YYYY-MM-DD>

<!-- Lives in _devx/workstreams/<slug>/decisions/. FAIL = any ❌ or unmet P0
     floor. CONCERNS = only non-blocking ⚠️ (gate advances, concern
     recorded). WAIVED requires a named approver + reason. -->

## Subject

<what was reviewed/decided/revised, and against what source>

## Coverage

| ID | Status | Where covered | Note |
|---|---|---|---|
| <G-1 / E-1> | <✅ / ⚠️ / ❌> | <section / phase / path> | <detail> |

## Extras requiring product approval

<!-- Scope creep flagged neutrally: things present in the target that no
     source ID asked for. Needs sign-off, not deletion. -->

- <extra> — <where>

## Verdict detail

<why the frontmatter verdict; what unblocks a FAIL>
