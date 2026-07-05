---
hash: v2e101
type: dev
created: 2026-07-05T13:01:00-06:00
title: V2.1-A — engine CLI primitives (workstream, gates, revise, next)
from: v2/06-phases.md
plan: v2/
status: in-review
owner: /devx-2026-07-05T1003-34264
blocked_by: [v2s101]
branch: feat/dev-v2e101
---

## Goal

The v2 engine's mechanical layer: workstream scaffolding, the three gate
validators, cascade-reset revise, and `devx next` v1 — all pure-fn +
CLI-passthrough + adversarial tests, per `v2/02-engine.md`.

## Acceptance criteria

- [ ] `devx workstream new <slug>` scaffolds `_devx/workstreams/<slug>/` from
      the engine templates + creates/extends the plan spec with `stage:`,
      `gate_status:` (4 flags false), `outcome:` frontmatter
      (`v2/02-engine.md` §3).
- [ ] Frontmatter parse/serialize helpers understand the new fields;
      round-trip preserves unknown fields + status-log body.
- [ ] `devx gate prd <hash>`: mechanical checks per §4.2 — non-placeholder
      sections; ≥3 E-blocks each with Priority + EARS regex
      (`When .+, the system SHALL .+`) + numeric Threshold + concrete
      Verified-by; bidirectional Covers/ID resolution; on pass flips
      `prd_validated` + `stage: design`; on fail prints gap report, writes
      nothing. Exit 0 pass / 1 fail / 2 error.
- [ ] `devx gate coverage <hash>`: two-mode (design|plan) detection per §4.4;
      emits `decisions/<date>-<mode>-verify.md` with verdict block
      (PASS|CONCERNS|FAIL|WAIVED), ID-keyed tri-state table, extras section;
      P0-floor enforcement in plan mode. Semantic covered/partial judgment is
      injectable (`--table <json>` input from the skill's subagent) so the CLI
      stays deterministic and testable.
- [ ] `devx gate evals <hash>`: runs each expectation's Verified-by target via
      `projects:` runner config; requires observed failure (nonzero exit) for
      P0s pre-implementation; writes `evals/RED-report.md` (command + exit
      code + failure quote per E-id); on pass flips `evals_red` +
      `stage: executing`. P1+ gaps → CONCERNS.
- [ ] `devx revise <hash> --touched <path>`: cascade-reset table per §4.9
      (prd/expectations → all 4 flags; design → 3; plan → 2), stage rollback,
      prints replay path; refuses on unknown artifact.
- [ ] `devx next [<hash>]` v1: workstream-stage rows (rows 9–12 of the
      dispatcher table in `v2/05-dispatcher.md` §2) — given a workstream,
      print the single next command; repo-level rows land in v2d101.
- [ ] Prose-budget canary test: sums bytes of engine templates + (once they
      exist) stage skill sections; fails above `engine.prose_budget_kb`
      default 60KB. Seeded with templates only for now.
- [ ] Adversarial tests for every command: seeded-defect fixtures (missing
      threshold, dangling Covers ID, orphan G-, non-RED P0, wrong-stage
      revise) must produce the exact refusal.
- [ ] Full suite green.

## Technical notes

- House patterns: follow merge-gate (pure fn + advice array) and
  plan-helper/validate-emit (structural checks + severities) as exemplars.
- Verdict-block writer shared across gate coverage / evals (one module).
- No skill-body changes in this item (that's v2e102).

## Status log

- 2026-07-05T13:01 — created from v2/06-phases.md § V2.1 epic A.
- 2026-07-05T10:03:35-06:00 — claimed by /devx in session /devx-2026-07-05T1003-34264
- 2026-07-05T10:40 — implemented: 8 engine lib modules (src/lib/engine/: frontmatter, verdict, config, context, expectations, gate-prd, gate-coverage, gate-evals, revise, next) + 4 CLI commands (workstream new, gate prd|coverage|evals, revise, next) registered in cli.ts; 9 test files, +200 tests (196 initial + 4 pinning self-review fixes); prose-budget canary seeded with the 9 v2s101 templates + empty STAGE_SKILL_SECTIONS constant for v2e102. Frontmatter writes go through eemeli/yaml parseDocument (comment/key-order/unknown-field-preserving) rather than extending the three flat-scalar regex parsers — nested gate_status/outcome maps are beyond their shape; rationale in the module header. engine.* keys read defensively with §7 defaults (no config/schema edit — v2x101). Branch rebased onto origin/main pre-work to pick up roc101's retroactive v2s101 phase-4 line (main was red at claim time).
- 2026-07-05T10:40 — phase 4: self-review — 5 findings (3 blind / 2 edge / 0 acceptance), all fixed: (1) yaml default 80-col line folding would reflow long v1-authored scalars on first gate flip → toString({lineWidth: 0}); (2) createWorkstream --hash path bypassed the fs seam for spec lookup → routed through findSpecForHashInFs; (3) gate evals passed vacuously on zero E-blocks → explicit FAIL; (4) placeholder regex false-positived on comparator prose ("p95 < 8s and retries > 3") → inner-edge \S refinement; (5) empty runner output rendered a blank failure quote → "(no output captured)" sentinel. Each pinned by a dedicated test. (Pre-review, the frontmatter round-trip test itself caught a splitFrontmatter delimiter-newline duplication — fixed before review started.)
