---
gate: <PASS | CONCERNS | FAIL | WAIVED>
status_reason: '<1–2 sentences>'
reviewer: '<devx gate coverage (design|plan mode) | /devx prd --review | /devx-revise | /devx-address>'
updated: <YYYY-MM-DD>
waiver: { active: false, approver: null, reason: null }
---

# <Decision | Critique | Verify | Revision> — <workstream> — <YYYY-MM-DD>

<!-- Lives in the doc set's decisions/. FAIL = any ❌ or unmet P0
     floor. CONCERNS = only non-blocking ⚠️ (gate advances, concern
     recorded). WAIVED requires a named approver + reason.

     The FILENAME carries the record's type — there is no `type:` field to
     drift from it. `<date>-<type>[-<slug>].md`, type one of: `<mode>-verify`
     (a gate's own report) · `prd-critique` · `revision` (/devx-revise) ·
     `expectation-change` (mandatory when a LOCKED expectation moves) ·
     `pr-resolution` (/devx-address) · `design-question` · `spike` ·
     `arch-review`.

     A PR comment earns a pr-resolution record when it moves a locked
     expectation, sets a precedent, resolves an open question an artifact
     lists, or a reviewer asks. Never for a nit — the reply is the
     record. -->

## Subject

<what was reviewed/decided/revised, and against what source>

## Coverage

| ID | Status | Where covered | Note |
|---|---|---|---|
| <G-1 / E-1> | <✅ / ⚠️ / ❌> | <section / phase / path> | <detail> |

<!-- A revision swaps this table for what /devx-revise Step 4 names. -->

## Extras requiring product approval

<!-- Scope creep flagged neutrally: things present in the target that no
     source ID asked for. Needs sign-off, not deletion. -->

- <extra> — <where>

## Verdict detail

<why the frontmatter verdict; what unblocks a FAIL>
